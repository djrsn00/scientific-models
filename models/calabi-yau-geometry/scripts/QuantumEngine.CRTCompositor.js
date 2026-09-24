/*
 * QuantumEngine.CRTCompositor.js
 *
 * RenderPass + HDR resolve -> UnrealBloomPass -> CRT ShaderPass -> OutputPass.
 *
 * An additional edge-AA pass runs only when HDR multisampling is unavailable
 * or exceeds the framebuffer memory budget. The full retina resolution stays
 * unchanged. The scene target alone uses multisampling; post-process targets
 * remain single-sampled.
 *
 * Core owns the only animation loop. init(context) installs its render hook
 * and resize subscription. dispose() releases both and satisfies the accepted
 * loader's lifecycle contract.
 *
 * Addon constructors come from QuantumEngine.Dependencies, as established by
 * index.html. They are not attached to the imported THREE namespace.
 */
(function quantumEngineCRTCompositorModule(window) {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};
  const engine = window.QuantumEngine;

  if (typeof engine !== "object" || engine === null) {
    throw new TypeError("window.QuantumEngine must be an object.");
  }

  if (engine.CRTCompositor !== undefined) {
    throw new Error(
      "QuantumEngine.CRTCompositor has already been registered."
    );
  }

  const MAX_TARGET_BYTES = 256 * 1024 * 1024;
  const BLOOM_THRESHOLD = 1.0;
  const BLOOM_RADIUS = 0.66;
  const BLOOM_STRENGTH = 1.8;
  const TIME_PERIOD = 200;

  const ownedPasses = [];

  let THREE = null;
  let context = null;
  let renderer = null;
  let scene = null;
  let camera = null;

  let composer = null;
  let unownedTarget = null;
  let sceneTarget = null;
  let resolvePass = null;
  let renderPass = null;
  let bloomPass = null;
  let crtPass = null;
  let outputPass = null;
  let edgeAAPass = null;

  let releaseRender = null;
  let releaseResize = null;
  let state = "idle";
  let initializationPromise = null;

  let sampleCounts = [];
  let targetSizeLimit = 1;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;

  let crtTime = 0;
  let previousElapsed = 0;
  let savedClearColor = null;

  let bloomControl = null;
  let crtControl = null;
  let motionControl = null;

  let overlay = null;
  let overlayDisplay = "";
  let overlayPriority = "";
  let overlayHidden = false;

  let metrics = null;
  let previousMetrics;
  let hadPreviousMetrics = false;

  const FULLSCREEN_VERTEX_SHADER = `
precision highp float;
precision highp int;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

  const RESOLVE_FRAGMENT_SHADER = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tDiffuse;

varying vec2 vUv;

void main() {
  gl_FragColor = texture2D(tDiffuse, vUv);
}
`;

  const CRT_FRAGMENT_SHADER = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tDiffuse;
uniform vec2 uResolution;
uniform float uPixelRatio;
uniform float uTime;
uniform float uCurvature;
uniform float uAberration;
uniform float uScanStrength;

varying vec2 vUv;

const float TAU = 6.283185307179586;

vec3 sampleGlass(vec2 sampleUV) {
  vec2 resolution = max(uResolution, vec2(1.0));
  vec2 halfTexel = 0.5 / resolution;

  // Mask each channel's lookup separately. Clamp-to-edge alone would
  // stretch bright pixels into colored streaks outside the curved image.
  vec2 edgeDistance = min(sampleUV, 1.0 - sampleUV) * resolution;

  vec2 coverage = smoothstep(
    vec2(-0.5),
    vec2(0.5),
    edgeDistance
  );

  vec3 color = texture2D(
    tDiffuse,
    clamp(sampleUV, halfTexel, 1.0 - halfTexel)
  ).rgb;

  return color * coverage.x * coverage.y;
}

void main() {
  vec2 resolution = max(uResolution, vec2(1.0));
  vec2 aspect = resolution / min(resolution.x, resolution.y);
  vec2 centered = vUv - 0.5;
  vec2 radial = 2.0 * centered * aspect;

  float radiusSquared = dot(radial, radial) / dot(aspect, aspect);

  vec2 curvedUV = 0.5
    + centered * (1.0 + uCurvature * radiusSquared);

  vec2 radialDirection = radial / max(length(radial), 1.0e-6);

  vec2 separation = radialDirection
    * (uAberration * uPixelRatio * radiusSquared)
    / resolution;

  vec3 color = vec3(
    sampleGlass(curvedUV + separation).r,
    sampleGlass(curvedUV).g,
    sampleGlass(curvedUV - separation).b
  );

  // Screen-space scanlines keep a fixed physical frequency under curvature.
  // A period of at least three pixels stays below the sampling limit.
  float scanPeriod = max(3.0, 3.0 * uPixelRatio);
  float scanPhase = vUv.y * resolution.y / scanPeriod - 0.08 * uTime;
  float scanline = 0.5 + 0.5 * cos(TAU * scanPhase);
  float scanGain = 1.0 - uScanStrength * scanline;

  float rollingBand = 0.5 + 0.5 * cos(
    TAU * (vUv.y - 0.035 * uTime)
  );

  float sweepGain = 1.0 + 0.018 * rollingBand * rollingBand;
  float vignette = 1.0 - 0.12 * radiusSquared * radiusSquared;

  color *= scanGain * sweepGain * vignette;

  // Keep values above 1.0 for HDR highlights. OutputPass alone performs
  // tone mapping and display color conversion after this linear pass.
  gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
}
`;

  const EDGE_AA_FRAGMENT_SHADER = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D tDiffuse;
uniform vec2 uTexelSize;

varying vec2 vUv;

vec3 readDisplayColor(vec2 sampleUV) {
  vec2 inset = 0.5 * uTexelSize;

  return texture2D(
    tDiffuse,
    clamp(sampleUV, inset, 1.0 - inset)
  ).rgb;
}

float displayLuminance(vec3 color) {
  return dot(color, vec3(0.299, 0.587, 0.114));
}

void main() {
  vec3 center = readDisplayColor(vUv);
  vec3 nw = readDisplayColor(vUv + vec2(-1.0, 1.0) * uTexelSize);
  vec3 ne = readDisplayColor(vUv + vec2(1.0, 1.0) * uTexelSize);
  vec3 sw = readDisplayColor(vUv + vec2(-1.0, -1.0) * uTexelSize);
  vec3 se = readDisplayColor(vUv + vec2(1.0, -1.0) * uTexelSize);

  float lm = displayLuminance(center);
  float lnw = displayLuminance(nw);
  float lne = displayLuminance(ne);
  float lsw = displayLuminance(sw);
  float lse = displayLuminance(se);

  float minimum = min(
    lm,
    min(min(lnw, lne), min(lsw, lse))
  );

  float maximum = max(
    lm,
    max(max(lnw, lne), max(lsw, lse))
  );

  // Leave low-contrast detail and the deliberately subtle scanlines intact.
  if (maximum - minimum < max(0.04, 0.10 * maximum)) {
    gl_FragColor = vec4(center, 1.0);
    return;
  }

  vec2 direction = vec2(
    (lsw + lse) - (lnw + lne),
    (lnw + lsw) - (lne + lse)
  );

  float reduction = max(
    (lnw + lne + lsw + lse) * 0.03125,
    1.0 / 128.0
  );

  float reciprocal = 1.0
    / (min(abs(direction.x), abs(direction.y)) + reduction);

  direction = clamp(
    direction * reciprocal,
    -6.0,
    6.0
  ) * uTexelSize;

  vec3 narrow = 0.5 * (
    readDisplayColor(vUv - direction / 6.0)
    + readDisplayColor(vUv + direction / 6.0)
  );

  vec3 wide = 0.5 * narrow + 0.25 * (
    readDisplayColor(vUv - 0.5 * direction)
    + readDisplayColor(vUv + 0.5 * direction)
  );

  float candidateLuminance = displayLuminance(wide);

  vec3 filtered = candidateLuminance < minimum
    || candidateLuminance > maximum
      ? narrow
      : wide;

  // Input is already display-encoded by OutputPass; do not encode it again.
  gl_FragColor = vec4(mix(center, filtered, 0.80), 1.0);
}
`;

  function ownPass(pass) {
    ownedPasses.push(pass);
    return pass;
  }

  function assertActive() {
    if (
      state === "disposed"
      || (context.signal && context.signal.aborted)
    ) {
      throw new window.DOMException(
        "CRTCompositor initialization was aborted.",
        "AbortError"
      );
    }
  }

  function configureFullscreenMaterial(material) {
    material.precision = "highp";
    material.depthTest = false;
    material.depthWrite = false;
    material.toneMapped = false;
  }

  function createShaderPass(
    ShaderPass,
    name,
    fragmentShader,
    uniforms
  ) {
    const pass = ownPass(new ShaderPass({
      name,
      uniforms,
      vertexShader: FULLSCREEN_VERTEX_SHADER,
      fragmentShader
    }));

    configureFullscreenMaterial(pass.material);
    pass.material.blending = THREE.NoBlending;

    return pass;
  }

  function inspectHardware() {
    const gl = renderer.getContext();

    if (
      typeof gl.getInternalformatParameter !== "function"
      || !renderer.extensions.has("EXT_color_buffer_float")
    ) {
      throw new Error(
        "CRTCompositor requires WebGL2 and renderable floating-point targets."
      );
    }

    const colorSamples = Array.from(
      gl.getInternalformatParameter(
        gl.RENDERBUFFER,
        gl.RGBA16F,
        gl.SAMPLES
      ) || []
    );

    const depthSamples = Array.from(
      gl.getInternalformatParameter(
        gl.RENDERBUFFER,
        gl.DEPTH_COMPONENT24,
        gl.SAMPLES
      ) || []
    );

    sampleCounts = colorSamples.filter(function (count) {
      return count >= 2
        && count <= 4
        && depthSamples.includes(count);
    }).sort(function (a, b) {
      return b - a;
    });

    targetSizeLimit = Math.min(
      renderer.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)
    );
  }

  function chooseSamples(bufferWidth, bufferHeight) {
    const pixels = bufferWidth * bufferHeight;

    for (const samples of sampleCounts) {
      // Three RGBA16F textures, scene depth, and one multisampled
      // RGBA16F + depth24 pair. Bloom has its own smaller mip buffers.
      const estimatedBytes = pixels * (28 + 12 * samples);

      if (estimatedBytes <= MAX_TARGET_BYTES) {
        return samples;
      }
    }

    return 0;
  }

  function validateTargets() {
    const gl = renderer.getContext();
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();

    try {
      for (const target of [
        composer.renderTarget1,
        composer.renderTarget2
      ]) {
        renderer.setRenderTarget(target);

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(
            "CRTCompositor HDR target is incomplete: 0x"
            + status.toString(16)
            + "."
          );
        }
      }

      renderer.setRenderTarget(sceneTarget);

      let status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

      if (
        status !== gl.FRAMEBUFFER_COMPLETE
        && sceneTarget.samples > 0
      ) {
        renderer.setRenderTarget(null);
        sceneTarget.dispose();
        sceneTarget.samples = 0;

        renderer.setRenderTarget(sceneTarget);
        status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      }

      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          "CRTCompositor scene target is incomplete: 0x"
          + status.toString(16)
          + "."
        );
      }
    } finally {
      renderer.setRenderTarget(
        previousTarget,
        previousFace,
        previousMip
      );
    }

    edgeAAPass.enabled = sceneTarget.samples === 0;
  }

  function resize(viewport) {
    if (state === "disposed") return;

    const nextWidth = Math.max(1, Math.floor(viewport.width));
    const nextHeight = Math.max(1, Math.floor(viewport.height));
    const nextRatio = Math.min(viewport.pixelRatio, 2);

    if (
      !Number.isFinite(nextWidth)
      || !Number.isFinite(nextHeight)
      || !Number.isFinite(nextRatio)
      || nextRatio <= 0
    ) {
      throw new Error(
        "CRTCompositor received an invalid Core viewport."
      );
    }

    if (
      width === nextWidth
      && height === nextHeight
      && pixelRatio === nextRatio
    ) {
      return;
    }

    const bufferWidth = Math.max(
      1,
      Math.floor(nextWidth * nextRatio)
    );

    const bufferHeight = Math.max(
      1,
      Math.floor(nextHeight * nextRatio)
    );

    if (
      bufferWidth > targetSizeLimit
      || bufferHeight > targetSizeLimit
    ) {
      throw new Error(
        "CRTCompositor viewport exceeds this GPU's render-target size limit."
      );
    }

    const samples = chooseSamples(bufferWidth, bufferHeight);

    if (sceneTarget.samples !== samples) {
      sceneTarget.dispose();
      sceneTarget.samples = samples;
    }

    if (pixelRatio !== nextRatio) {
      composer.setPixelRatio(nextRatio);
    }

    composer.setSize(nextWidth, nextHeight);
    sceneTarget.setSize(bufferWidth, bufferHeight);

    crtPass.uniforms.uResolution.value.set(
      bufferWidth,
      bufferHeight
    );

    crtPass.uniforms.uPixelRatio.value = nextRatio;

    edgeAAPass.uniforms.uTexelSize.value.set(
      1 / bufferWidth,
      1 / bufferHeight
    );

    validateTargets();

    width = nextWidth;
    height = nextHeight;
    pixelRatio = nextRatio;

    metrics.width = bufferWidth;
    metrics.height = bufferHeight;
    metrics.pixelRatio = nextRatio;
    metrics.samples = sceneTarget.samples;

    metrics.antialiasing = edgeAAPass.enabled
      ? "Retina rendering with edge AA"
      : sceneTarget.samples + "x HDR MSAA";
  }

  function readBloomStrength() {
    const value = bloomControl
      ? Number(bloomControl.value)
      : 1.25;

    return Number.isFinite(value)
      ? Math.max(0, Math.min(3, value))
      : 1.25;
  }

  function updateControls(deltaTime, elapsedTime) {
    if (Number.isFinite(elapsedTime)) {
      if (elapsedTime < previousElapsed) {
        crtTime = 0;
      }

      previousElapsed = elapsedTime;
    }

    const crtEnabled = crtControl
      ? crtControl.checked
      : true;

    const reducedMotion = motionControl
      ? motionControl.value === "reduced"
      : window.document.documentElement.dataset.motion === "reduced";

    const dt = Number.isFinite(deltaTime)
      ? Math.max(0, Math.min(0.05, deltaTime))
      : 0;

    // The two scan frequencies complete integer cycles in 200 seconds,
    // so wrapping time preserves continuity and float precision.
    if (crtEnabled && !reducedMotion) {
      crtTime = (crtTime + dt) % TIME_PERIOD;
    }

    const bloomMultiplier = readBloomStrength();

    bloomPass.strength = BLOOM_STRENGTH * bloomMultiplier;
    bloomPass.enabled = bloomMultiplier > 0;
    crtPass.enabled = crtEnabled;
    crtPass.uniforms.uTime.value = crtTime;

    metrics.crtEnabled = crtEnabled;
    metrics.bloomStrength = bloomPass.strength;
    metrics.reducedMotion = reducedMotion;

    return dt;
  }

  function renderFrame(deltaTime, elapsedTime) {
    if (state !== "ready") return;

    assertActive();

    const dt = updateControls(deltaTime, elapsedTime);

    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();

    const previousAutoClear = renderer.autoClear;
    const previousClearColorFlag = renderer.autoClearColor;
    const previousClearDepthFlag = renderer.autoClearDepth;
    const previousClearStencilFlag = renderer.autoClearStencil;
    const previousClearAlpha = renderer.getClearAlpha();

    const previousToneMapping = renderer.toneMapping;
    const previousExposure = renderer.toneMappingExposure;
    const previousColorSpace = renderer.outputColorSpace;
    const previousXR = renderer.xr.enabled;

    renderer.getClearColor(savedClearColor);

    try {
      renderer.xr.enabled = false;
      renderer.autoClearColor = true;
      renderer.autoClearDepth = true;
      renderer.autoClearStencil = false;

      renderer.setClearColor(0x000000, 1);
      renderer.toneMapping = THREE.NeutralToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      composer.render(dt);
    } finally {
      // Stock passes restore state on successful return; this guard also
      // restores it if Core's shader-error handler throws during a pass.
      renderer.autoClear = previousAutoClear;
      renderer.autoClearColor = previousClearColorFlag;
      renderer.autoClearDepth = previousClearDepthFlag;
      renderer.autoClearStencil = previousClearStencilFlag;

      renderer.setClearColor(savedClearColor, previousClearAlpha);
      renderer.toneMapping = previousToneMapping;
      renderer.toneMappingExposure = previousExposure;
      renderer.outputColorSpace = previousColorSpace;
      renderer.xr.enabled = previousXR;

      renderer.setRenderTarget(
        previousTarget,
        previousFace,
        previousMip
      );
    }
  }

  async function initialize(sharedContext) {
    try {
      context = sharedContext;

      const dependencies = engine.Dependencies;
      THREE = dependencies && dependencies.THREE;

      const core = engine.Core;

      if (
        !context
        || typeof context.setRenderCallback !== "function"
        || typeof context.registerResizeCallback !== "function"
        || !context.viewport
      ) {
        throw new Error(
          "CRTCompositor.init must receive Core's shared initialization context."
        );
      }

      if (
        !THREE
        || !core
        || typeof core.getRenderer !== "function"
        || typeof core.getScene !== "function"
        || typeof core.getCamera !== "function"
      ) {
        throw new Error(
          "CRTCompositor requires the accepted Three.js and Core."
        );
      }

      for (const name of [
        "EffectComposer",
        "RenderPass",
        "UnrealBloomPass",
        "ShaderPass",
        "OutputPass"
      ]) {
        if (typeof dependencies[name] !== "function") {
          throw new Error(
            "CRTCompositor requires QuantumEngine.Dependencies."
            + name
            + "."
          );
        }
      }

      assertActive();

      renderer = window.QuantumEngine.Core.getRenderer();
      scene = window.QuantumEngine.Core.getScene();
      camera = window.QuantumEngine.Core.getCamera();

      if (!renderer || !scene || !scene.isScene || !camera) {
        throw new Error(
          "CRTCompositor requires an initialized Core renderer, scene and camera."
        );
      }

      const dom = context.dom || engine.DOM || {};

      bloomControl = dom["qe-bloom-strength"] || null;
      crtControl = dom["qe-crt-enabled"] || null;
      motionControl = dom["qe-motion-mode"] || null;

      savedClearColor = new THREE.Color();

      inspectHardware();

      metrics = {
        width: 1,
        height: 1,
        pixelRatio: 1,
        samples: 0,
        antialiasing: "Pending",
        crtEnabled: true,
        bloomStrength: 0,
        reducedMotion: false
      };

      hadPreviousMetrics = Object.prototype.hasOwnProperty.call(
        scene.userData,
        "crtCompositor"
      );

      previousMetrics = scene.userData.crtCompositor;
      scene.userData.crtCompositor = metrics;

      unownedTarget = new THREE.WebGLRenderTarget(1, 1, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        internalFormat: "RGBA16F",

        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,

        generateMipmaps: false,
        colorSpace: THREE.NoColorSpace,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0
      });

      composer = new dependencies.EffectComposer(
        renderer,
        unownedTarget
      );

      unownedTarget = null;
      composer.renderToScreen = true;

      composer.renderTarget1.texture.name = "QuantumEngine.CRT.Ping";
      composer.renderTarget2.texture.name = "QuantumEngine.CRT.Pong";

      sceneTarget = composer.renderTarget1.clone();
      sceneTarget.texture.name = "QuantumEngine.CRT.Scene";
      sceneTarget.depthBuffer = true;
      sceneTarget.resolveDepthBuffer = false;

      resolvePass = createShaderPass(
        dependencies.ShaderPass,
        "QuantumEngine.CRT.Resolve",
        RESOLVE_FRAGMENT_SHADER,
        {
          tDiffuse: { value: null }
        }
      );

      resolvePass.renderToScreen = false;

      renderPass = ownPass(
        new dependencies.RenderPass(scene, camera)
      );

      renderPass.clear = true;
      renderPass.clearDepth = false;

      const drawScene = renderPass.render.bind(renderPass);

      renderPass.render = function renderResolvedScene(
        activeRenderer,
        writeBuffer,
        readBuffer,
        deltaTime,
        maskActive
      ) {
        drawScene(
          activeRenderer,
          writeBuffer,
          sceneTarget,
          deltaTime,
          maskActive
        );

        // Three resolves sceneTarget.texture at the end of the scene draw.
        // Copy that texture before bloom: the multisample color renderbuffer
        // may have been invalidated and must not receive additive write-back.
        resolvePass.render(
          activeRenderer,
          readBuffer,
          sceneTarget,
          deltaTime,
          false
        );
      };

      composer.addPass(renderPass);

      bloomPass = ownPass(new dependencies.UnrealBloomPass(
        new THREE.Vector2(1, 1),
        BLOOM_STRENGTH * readBloomStrength(),
        BLOOM_RADIUS,
        BLOOM_THRESHOLD
      ));

      bloomPass.highPassUniforms.smoothWidth.value = 0.08;

      // Bloom needs color only. Avoid allocating unused depth buffers for
      // the bright texture and ten blur targets.
      const bloomTargets = [
        bloomPass.renderTargetBright,
        ...bloomPass.renderTargetsHorizontal,
        ...bloomPass.renderTargetsVertical
      ];

      for (const target of bloomTargets) {
        target.depthBuffer = false;
        target.stencilBuffer = false;
      }

      for (const material of [
        bloomPass.materialHighPassFilter,
        ...bloomPass.separableBlurMaterials,
        bloomPass.compositeMaterial,
        bloomPass.blendMaterial
      ]) {
        configureFullscreenMaterial(material);
      }

      composer.addPass(bloomPass);

      crtPass = createShaderPass(
        dependencies.ShaderPass,
        "QuantumEngine.CRT.Glass",
        CRT_FRAGMENT_SHADER,
        {
          tDiffuse: { value: null },
          uResolution: { value: new THREE.Vector2(1, 1) },
          uPixelRatio: { value: 1 },
          uTime: { value: 0 },
          uCurvature: { value: 0.018 },
          uAberration: { value: 1.35 },
          uScanStrength: { value: 0.075 }
        }
      );

      composer.addPass(crtPass);

      outputPass = ownPass(new dependencies.OutputPass());

      configureFullscreenMaterial(outputPass.material);
      composer.addPass(outputPass);

      edgeAAPass = createShaderPass(
        dependencies.ShaderPass,
        "QuantumEngine.CRT.EdgeAA",
        EDGE_AA_FRAGMENT_SHADER,
        {
          tDiffuse: { value: null },
          uTexelSize: { value: new THREE.Vector2(1, 1) }
        }
      );

      edgeAAPass.enabled = false;
      composer.addPass(edgeAAPass);

      await new Promise(function (resolve) {
        window.setTimeout(resolve, 0);
      });

      assertActive();

      resize(context.viewport);

      previousElapsed = context.clock
        && Number.isFinite(context.clock.elapsedTime)
          ? context.clock.elapsedTime
          : 0;

      updateControls(0, previousElapsed);

      releaseResize = context.registerResizeCallback(
        resize,
        false
      );

      releaseRender = context.setRenderCallback(renderFrame);

      // The accepted stylesheet already provides a fallback CRT overlay.
      // Hide it while GPU optics are active, then restore its exact inline
      // display declaration when this module is disposed.
      overlay = window.document.querySelector(".qe-crt-overlay");

      if (overlay) {
        overlayDisplay = overlay.style.getPropertyValue("display");
        overlayPriority = overlay.style.getPropertyPriority("display");

        overlay.style.setProperty(
          "display",
          "none",
          "important"
        );

        overlayHidden = true;
      }

      state = "ready";

      return composer;
    } catch (error) {
      try {
        dispose();
      } catch (cleanupError) {
        window.console.error(
          "CRTCompositor cleanup failed:",
          cleanupError
        );
      }

      throw error;
    }
  }

  function init(sharedContext) {
    if (state === "disposed") {
      throw new Error(
        "CRTCompositor has been disposed. Reload before initializing again."
      );
    }

    if (initializationPromise) return initializationPromise;

    state = "initializing";
    initializationPromise = initialize(sharedContext);

    return initializationPromise;
  }

  function dispose() {
    if (state === "disposed") return;

    state = "disposed";
    const errors = [];

    function release(operation) {
      try {
        operation();
      } catch (error) {
        errors.push(error);
      }
    }

    if (releaseRender) release(releaseRender);
    if (releaseResize) release(releaseResize);

    releaseRender = null;
    releaseResize = null;

    if (overlay && overlayHidden) {
      release(function () {
        if (overlayDisplay) {
          overlay.style.setProperty(
            "display",
            overlayDisplay,
            overlayPriority
          );
        } else {
          overlay.style.removeProperty("display");
        }
      });
    }

    if (
      scene
      && metrics
      && scene.userData.crtCompositor === metrics
    ) {
      if (hadPreviousMetrics) {
        scene.userData.crtCompositor = previousMetrics;
      } else {
        delete scene.userData.crtCompositor;
      }
    }

    // r180 UnrealBloomPass.dispose() omits this particular material.
    if (bloomPass && bloomPass.materialHighPassFilter) {
      release(function () {
        bloomPass.materialHighPassFilter.dispose();
      });
    }

    for (let i = ownedPasses.length - 1; i >= 0; i--) {
      const pass = ownedPasses[i];

      release(function () {
        pass.dispose();
      });
    }

    ownedPasses.length = 0;

    if (composer) {
      release(function () {
        composer.dispose();
      });

      composer.passes.length = 0;
    }

    if (unownedTarget) {
      release(function () {
        unownedTarget.dispose();
      });
    }

    if (sceneTarget) {
      release(function () {
        sceneTarget.dispose();
      });
    }

    composer = null;
    unownedTarget = null;
    sceneTarget = null;

    resolvePass = null;
    renderPass = null;
    bloomPass = null;
    crtPass = null;
    outputPass = null;
    edgeAAPass = null;

    renderer = null;
    scene = null;
    camera = null;
    context = null;
    THREE = null;

    bloomControl = null;
    crtControl = null;
    motionControl = null;

    overlay = null;
    overlayHidden = false;
    savedClearColor = null;

    metrics = null;
    previousMetrics = undefined;
    sampleCounts = [];

    if (errors.length) {
      throw new AggregateError(
        errors,
        "CRTCompositor resource cleanup failed."
      );
    }
  }

  engine.CRTCompositor = Object.freeze({
    init,
    dispose
  });
})(window);