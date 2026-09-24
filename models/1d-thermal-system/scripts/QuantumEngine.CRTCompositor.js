/*
 * REQUIRED CORE INTEGRATION
 *
 * In QuantumEngine.Core.js, inside animate(), replace:
 *
 *   renderer.render(scene, camera);
 *
 * with:
 *
 *   if (
 *     window.QuantumEngine.CRTCompositor &&
 *     typeof window.QuantumEngine.CRTCompositor.render === "function"
 *   ) {
 *     window.QuantumEngine.CRTCompositor.render(deltaTime);
 *   } else {
 *     renderer.render(scene, camera);
 *   }
 *
 * Keep this replacement after the update callbacks, inside the existing
 * visibility check. Do not add another animation loop or register this
 * compositor as an update callback. Core must render only once per frame.
 */

(function () {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  if (window.QuantumEngine.CRTCompositor) {
    return;
  }

  const SETTINGS = {
    bloomStrength: 2.1,
    bloomRadius: 0.55,
    bloomThreshold: 0.85,
    exposure: 0.95,
    curvature: 0.045,
    chromaticPixels: 0.85,
    scanlineStrength: 0.10,
    scanlinePitch: 3.0,
    vignetteStrength: 0.22
  };

  let renderer = null;
  let scene = null;
  let camera = null;
  let composer = null;
  let scenePass = null;
  let bloomPass = null;
  let crtPass = null;

  let initialized = false;
  let failed = false;
  let rendering = false;
  let hdr = false;

  let cachedWidth = -1;
  let cachedHeight = -1;
  let cachedRatio = -1;

  let size = null;
  let frameState = null;
  let resizeState = null;
  let contextCanvas = null;

  const targets = [];

  const CRT_VERTEX_SHADER = `
    varying vec2 vUv;

    void main() {
      vUv = uv;

      gl_Position = projectionMatrix *
        modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const CRT_FRAGMENT_SHADER = `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uExposure;
    uniform float uCurvature;
    uniform float uChromaticPixels;
    uniform float uScanlineStrength;
    uniform float uScanlinePitch;
    uniform float uVignetteStrength;

    varying vec2 vUv;

    vec3 readScreen(vec2 coordinate) {
      if (
        coordinate.x < 0.0 || coordinate.x > 1.0 ||
        coordinate.y < 0.0 || coordinate.y > 1.0
      ) {
        return vec3(0.0);
      }

      return max(
        texture2D(tDiffuse, coordinate).rgb,
        vec3(0.0)
      );
    }

    // Narkowicz's public-domain ACES fitted curve.
    // This performs the pipeline's only tone-mapping operation.
    vec3 filmicCurve(vec3 value) {
      value = min(max(value, vec3(0.0)), vec3(64.0));

      vec3 numerator = value * (2.51 * value + 0.03);
      vec3 denominator = value * (2.43 * value + 0.59) + 0.14;

      return clamp(numerator / denominator, 0.0, 1.0);
    }

    vec3 encodeDisplay(vec3 linearColor) {
      vec3 low = 12.92 * linearColor;

      vec3 high = 1.055 *
        pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;

      return mix(
        low,
        high,
        step(vec3(0.0031308), linearColor)
      );
    }

    void main() {
      vec2 centered = vUv * 2.0 - 1.0;
      float radiusSquared = dot(centered, centered);

      vec2 curved = centered *
        (1.0 + uCurvature * radiusSquared);

      vec2 sampleUv = curved * 0.5 + 0.5;

      vec2 colorOffset = centered *
        (0.25 + 0.75 * radiusSquared) *
        uChromaticPixels / max(uResolution, vec2(1.0));

      vec3 color = vec3(
        readScreen(sampleUv + colorOffset).r,
        readScreen(sampleUv).g,
        readScreen(sampleUv - colorOffset).b
      );

      float vignette = 1.0 - uVignetteStrength *
        smoothstep(0.20, 1.80, radiusSquared);

      color = filmicCurve(color * uExposure * vignette);
      color = encodeDisplay(color);

      float scanPhase = 6.283185307179586 *
        gl_FragCoord.y / max(uScanlinePitch, 2.0);

      float scanline = 1.0 - uScanlineStrength *
        (0.5 + 0.5 * cos(scanPhase));

      vec2 edgePixels = min(
        sampleUv,
        vec2(1.0) - sampleUv
      ) * uResolution;

      float bezel = smoothstep(
        0.0,
        2.0,
        min(edgePixels.x, edgePixels.y)
      );

      gl_FragColor = vec4(
        clamp(color * scanline * bezel, 0.0, 1.0),
        1.0
      );
    }
  `;

  function createState(THREE) {
    return {
      clearColor: new THREE.Color(),
      viewport: new THREE.Vector4(),
      scissor: new THREE.Vector4()
    };
  }

  function captureState(state) {
    state.target = renderer.getRenderTarget();
    state.cubeFace = renderer.getActiveCubeFace();
    state.mipLevel = renderer.getActiveMipmapLevel();

    state.clearAlpha = renderer.getClearAlpha();
    state.autoClear = renderer.autoClear;
    state.autoClearColor = renderer.autoClearColor;
    state.autoClearDepth = renderer.autoClearDepth;
    state.autoClearStencil = renderer.autoClearStencil;

    state.toneMapping = renderer.toneMapping;
    state.exposure = renderer.toneMappingExposure;
    state.outputEncoding = renderer.outputEncoding;

    state.scissorTest = renderer.getScissorTest();
    state.overrideMaterial = scene.overrideMaterial;
    state.sceneAutoUpdate = scene.autoUpdate;

    renderer.getClearColor(state.clearColor);
    renderer.getViewport(state.viewport);
    renderer.getScissor(state.scissor);
  }

  function restoreState(state) {
    renderer.autoClear = state.autoClear;
    renderer.autoClearColor = state.autoClearColor;
    renderer.autoClearDepth = state.autoClearDepth;
    renderer.autoClearStencil = state.autoClearStencil;

    renderer.toneMapping = state.toneMapping;
    renderer.toneMappingExposure = state.exposure;
    renderer.outputEncoding = state.outputEncoding;

    scene.overrideMaterial = state.overrideMaterial;
    scene.autoUpdate = state.sceneAutoUpdate;

    renderer.setClearColor(state.clearColor, state.clearAlpha);
    renderer.setViewport(state.viewport);
    renderer.setScissor(state.scissor);
    renderer.setScissorTest(state.scissorTest);

    // Binding last restores a render target's own viewport and scissor.
    renderer.setRenderTarget(
      state.target,
      state.cubeFace,
      state.mipLevel
    );
  }

  function supportsHDR(THREE) {
    const extensions = renderer.extensions;

    if (renderer.capabilities.isWebGL2) {
      return extensions.has("EXT_color_buffer_float") ||
        extensions.has("EXT_color_buffer_half_float");
    }

    return extensions.has("OES_texture_half_float") &&
      extensions.has("OES_texture_half_float_linear") &&
      extensions.has("EXT_color_buffer_half_float") &&
      THREE.HalfFloatType !== undefined;
  }

  function configureTargets(THREE, useHDR) {
    const type = useHDR
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];

      target.dispose();

      target.texture.type = type;
      target.texture.format = THREE.RGBAFormat;
      target.texture.encoding = THREE.LinearEncoding;
      target.texture.minFilter = THREE.LinearFilter;
      target.texture.magFilter = THREE.LinearFilter;
      target.texture.generateMipmaps = false;

      target.stencilBuffer = false;

      // The scene buffers need depth; bloom intermediates do not.
      target.depthBuffer = index < 2;
    }

    hdr = useHDR;

    bloomPass.strength = useHDR
      ? SETTINGS.bloomStrength
      : 1.75;

    bloomPass.radius = SETTINGS.bloomRadius;

    bloomPass.threshold = useHDR
      ? SETTINGS.bloomThreshold
      : 0.72;

    bloomPass.highPassUniforms.smoothWidth.value = 0.08;
  }

  function validateTargets() {
    const gl = renderer.getContext();

    if (gl.isContextLost()) {
      throw new Error("The WebGL context is unavailable.");
    }

    for (let index = 0; index < targets.length; index += 1) {
      renderer.setRenderTarget(targets[index]);

      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(
          "A post-processing framebuffer could not be allocated."
        );
      }
    }
  }

  function syncSize(force) {
    const THREE = window.THREE;

    renderer.getSize(size);

    const ratio = Math.max(0.1, renderer.getPixelRatio());
    const width = Math.max(1 / ratio, size.x);
    const height = Math.max(1 / ratio, size.y);

    if (
      !force &&
      width === cachedWidth &&
      height === cachedHeight &&
      ratio === cachedRatio
    ) {
      return;
    }

    captureState(resizeState);

    try {
      // Composer takes CSS dimensions and applies its pixel ratio once.
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);

      crtPass.uniforms.uResolution.value.set(
        composer.renderTarget1.width,
        composer.renderTarget1.height
      );

      try {
        validateTargets();
      } catch (error) {
        if (!hdr || renderer.getContext().isContextLost()) {
          throw error;
        }

        // Release half-float buffers before retrying the complete byte chain.
        renderer.setRenderTarget(null);
        configureTargets(THREE, false);
        validateTargets();
      }

      cachedWidth = width;
      cachedHeight = height;
      cachedRatio = ratio;
    } finally {
      restoreState(resizeState);
    }
  }

  function disposePipeline() {
    const materials = new Set();

    if (composer && composer.copyPass) {
      materials.add(composer.copyPass.material);
    }

    if (crtPass) {
      materials.add(crtPass.material);
    }

    if (bloomPass) {
      materials.add(bloomPass.materialHighPassFilter);
      materials.add(bloomPass.compositeMaterial);
      materials.add(bloomPass.materialCopy);
      materials.add(bloomPass.basic);

      for (
        let index = 0;
        index < bloomPass.separableBlurMaterials.length;
        index += 1
      ) {
        materials.add(bloomPass.separableBlurMaterials[index]);
      }
    }

    for (let index = 0; index < targets.length; index += 1) {
      targets[index].dispose();
    }

    materials.forEach(function disposeMaterial(material) {
      if (material) {
        material.dispose();
      }
    });

    // r128 FullScreenQuad geometry is shared by all passes, so leave it owned
    // by Three.js. Only this module's targets and materials are disposed here.
    targets.length = 0;

    composer = null;
    scenePass = null;
    bloomPass = null;
    crtPass = null;

    initialized = false;
    cachedWidth = -1;
    cachedHeight = -1;
    cachedRatio = -1;
  }

  function onContextRestored() {
    disposePipeline();
    failed = false;
    init();
  }

  function init() {
    if (initialized) {
      return composer;
    }

    const THREE = window.THREE;
    const core = window.QuantumEngine.Core;

    try {
      if (!THREE || !core) {
        throw new Error(
          "Three.js and QuantumEngine.Core must load first."
        );
      }

      if (!core.getScene()) {
        core.init();
      }

      renderer = core.getRenderer();
      scene = core.getScene();
      camera = core.getCamera();

      if (!renderer || !scene || !camera) {
        throw new Error("The graphics core is not initialized.");
      }

      if (contextCanvas !== renderer.domElement) {
        if (contextCanvas) {
          contextCanvas.removeEventListener(
            "webglcontextrestored",
            onContextRestored
          );
        }

        contextCanvas = renderer.domElement;

        contextCanvas.addEventListener(
          "webglcontextrestored",
          onContextRestored
        );
      }

      const dependencies = [
        "EffectComposer",
        "RenderPass",
        "UnrealBloomPass",
        "ShaderPass",
        "CopyShader",
        "LuminosityHighPassShader"
      ];

      for (let index = 0; index < dependencies.length; index += 1) {
        if (!THREE[dependencies[index]]) {
          throw new Error(
            "Missing Three.js dependency: " + dependencies[index]
          );
        }
      }

      size = new THREE.Vector2();
      frameState = createState(THREE);
      resizeState = createState(THREE);

      composer = new THREE.EffectComposer(renderer);

      targets.push(
        composer.renderTarget1,
        composer.renderTarget2
      );

      scenePass = new THREE.RenderPass(scene, camera);
      composer.addPass(scenePass);

      bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(
          Math.max(1, window.innerWidth),
          Math.max(1, window.innerHeight)
        ),
        1.5,
        0.4,
        0.85
      );

      targets.push(bloomPass.renderTargetBright);

      for (let index = 0; index < bloomPass.nMips; index += 1) {
        targets.push(
          bloomPass.renderTargetsHorizontal[index],
          bloomPass.renderTargetsVertical[index]
        );
      }

      composer.addPass(bloomPass);

      crtPass = new THREE.ShaderPass({
        uniforms: {
          tDiffuse: { value: null },
          uResolution: {
            value: new THREE.Vector2(1, 1)
          },
          uExposure: {
            value: SETTINGS.exposure
          },
          uCurvature: {
            value: SETTINGS.curvature
          },
          uChromaticPixels: {
            value: SETTINGS.chromaticPixels
          },
          uScanlineStrength: {
            value: SETTINGS.scanlineStrength
          },
          uScanlinePitch: {
            value: SETTINGS.scanlinePitch
          },
          uVignetteStrength: {
            value: SETTINGS.vignetteStrength
          }
        },
        vertexShader: CRT_VERTEX_SHADER,
        fragmentShader: CRT_FRAGMENT_SHADER
      });

      crtPass.material.name = "QuantumCRTOutputMaterial";
      crtPass.material.toneMapped = false;
      crtPass.material.depthTest = false;
      crtPass.material.depthWrite = false;

      composer.addPass(crtPass);
      composer.renderToScreen = true;

      configureTargets(THREE, supportsHDR(THREE));
      syncSize(true);

      failed = false;
      initialized = true;

      return composer;
    } catch (error) {
      disposePipeline();
      failed = true;

      console.warn(
        "[QuantumEngine.CRTCompositor] Post-processing unavailable; using direct rendering.",
        error
      );

      return null;
    }
  }

  function prepareScreen(toneMapping, encoding) {
    renderer.getSize(size);

    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, size.x, size.y);
    renderer.setScissorTest(false);
    renderer.setClearColor(0x000000, 1);

    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;

    renderer.toneMapping = toneMapping;
    renderer.toneMappingExposure = SETTINGS.exposure;
    renderer.outputEncoding = encoding;
  }

  function render(deltaTime) {
    if (rendering) {
      return;
    }

    if (!initialized && !failed) {
      init();
    }

    const THREE = window.THREE;

    if (!THREE || !renderer || !scene || !camera) {
      return;
    }

    if (renderer.getContext().isContextLost()) {
      return;
    }

    if (!size) {
      size = new THREE.Vector2();
    }

    if (!frameState) {
      frameState = createState(THREE);
    }

    const delta = Number.isFinite(deltaTime) && deltaTime >= 0
      ? deltaTime
      : 0;

    rendering = true;
    captureState(frameState);

    try {
      if (initialized && !failed) {
        try {
          syncSize(false);

          // All intermediate passes stay linear and un-tonemapped.
          // The CRT shader performs the only display conversion.
          prepareScreen(
            THREE.NoToneMapping,
            THREE.LinearEncoding
          );

          composer.render(delta);
          return;
        } catch (error) {
          restoreState(frameState);
          disposePipeline();
          failed = true;

          console.warn(
            "[QuantumEngine.CRTCompositor] Post-processing stopped; using direct rendering.",
            error
          );
        }
      }

      // Native ACES is a simpler fallback; its color response differs slightly
      // from the final CRT shader's fitted curve.
      prepareScreen(
        THREE.ACESFilmicToneMapping,
        THREE.sRGBEncoding
      );

      renderer.render(scene, camera);
    } finally {
      restoreState(frameState);
      rendering = false;
    }
  }

  window.QuantumEngine.CRTCompositor = { init, render };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());