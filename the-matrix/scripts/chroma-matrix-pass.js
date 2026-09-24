(function installChromaMatrixPass(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.ChromaMatrixPass";

  if (
    engine.ChromaMatrixPass &&
    engine.ChromaMatrixPass.moduleId === MODULE_ID &&
    !engine.ChromaMatrixPass.disposed
  ) {
    engine.ChromaMatrixPass.init();
    return;
  }

  const uniforms = {
    uTime: { value: 0 },
    uPrideBlend: { value: 0 },
    uSpectrumShift: { value: 0 },
    uSurge: { value: 0 },
    uDispersionPixels: { value: 3.5 },
    uCauchyA: { value: 1.5046 },
    uCauchyB: { value: 0.0042 },
    uTau: { value: 0.19 },
    uPersistence: { value: 0.34 },
    uExcitationThreshold: { value: 0.22 },
    uExposure: { value: 1 },
    uFlicker: { value: 1 },
    uEffectsEnabled: { value: 1 }
  };

  const diagnostics = new Set();
  const savedTargets = [];

  let THREE = null;
  let composer = null;
  let renderer = null;
  let renderPass = null;
  let bloomPass = null;
  let shaderPass = null;
  let previousPasses = null;
  let installedPasses = null;
  let drawingSize = null;
  let logicalSize = null;
  let bufferType = null;
  let canvas = null;

  let initialized = false;
  let initializing = false;
  let disposed = false;
  let failed = false;
  let effectsEnabled = true;
  let contextLost = false;
  let registered = false;
  let unsubscribe = null;
  let status = "waiting";

  let retryTimer = null;
  let retryDelay = 50;
  let retryCount = 0;
  let previousWidth = 0;
  let previousHeight = 0;
  let previousPixelRatio = 0;
  let localTime = 0;
  let lastDelta = 1 / 60;
  let surgeTau = 0.15;

  let packetEvent = "NetworkEngine:PacketArrived";
  let laserEvent = "NetworkEngine:LaserHandover";
  let eventsBound = false;

  const vertexShader = `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;

  const historyFragmentShader = `
    uniform sampler2D tDiffuse;
    uniform sampler2D tHistory;

    uniform float uHistoryValid;
    uniform float uDecayFactor;
    uniform float uHistoryCeiling;
    uniform float uHistoryFloor;
    uniform float uExcitationThreshold;

    varying vec2 vUv;

    float peak(vec3 color) {
      return max(color.r, max(color.g, color.b));
    }

    void main() {
      vec3 source = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));

      float intensity = peak(source);
      float threshold = max(uExcitationThreshold, 0.001);

      float excitation = intensity *
        smoothstep(threshold, threshold * 2.5, intensity);

      float retained = 0.0;

      if (uHistoryValid > 0.5) {
        retained = texture2D(tHistory, vUv).r * uDecayFactor;

        if (retained < uHistoryFloor) {
          retained = 0.0;
        }
      }

      // Re-excitation replaces the decaying peak instead of accumulating energy.
      float signal = min(
        max(excitation, retained),
        uHistoryCeiling
      );

      gl_FragColor = vec4(signal, signal, signal, 1.0);
    }
  `;

  const outputFragmentShader = `
    uniform sampler2D tDiffuse;
    uniform sampler2D tHistory;

    uniform vec2 uResolution;

    uniform float uTime;
    uniform float uPrideBlend;
    uniform float uSpectrumShift;
    uniform float uSurge;
    uniform float uDispersionPixels;
    uniform float uCauchyA;
    uniform float uCauchyB;
    uniform float uPersistence;
    uniform float uExcitationThreshold;
    uniform float uHistoryCeiling;
    uniform float uExposure;
    uniform float uRendererExposure;
    uniform float uFlicker;
    uniform float uEffectsEnabled;
    uniform float uEncodeSRGB;

    varying vec2 vUv;

    const float TAU = 6.283185307179586;

    // Pride flag stops converted from the specified sRGB hex values to linear sRGB.
    const vec3 PRIDE_RED = vec3(1.0, 0.0, 0.009134059);
    const vec3 PRIDE_ORANGE = vec3(1.0, 0.376262123, 0.025186860);
    const vec3 PRIDE_YELLOW = vec3(1.0, 1.0, 0.052860647);
    const vec3 PRIDE_GREEN = vec3(0.0, 0.215860500, 0.009134059);
    const vec3 PRIDE_BLUE = vec3(0.0, 0.0, 0.947306537);
    const vec3 PRIDE_VIOLET = vec3(0.238397574, 0.002124689, 0.191201683);

    const vec3 P31_GREEN = vec3(0.0, 1.0, 0.132868322);
    const vec3 P31_PALE = vec3(0.033104767, 1.0, 0.246201327);

    float peak(vec3 color) {
      return max(color.r, max(color.g, color.b));
    }

    vec3 pridePalette(float phase) {
      float band = fract(phase) * 6.0;
      float blend = smoothstep(0.0, 1.0, fract(band));

      if (band < 1.0) {
        return mix(PRIDE_RED, PRIDE_ORANGE, blend);
      }

      if (band < 2.0) {
        return mix(PRIDE_ORANGE, PRIDE_YELLOW, blend);
      }

      if (band < 3.0) {
        return mix(PRIDE_YELLOW, PRIDE_GREEN, blend);
      }

      if (band < 4.0) {
        return mix(PRIDE_GREEN, PRIDE_BLUE, blend);
      }

      if (band < 5.0) {
        return mix(PRIDE_BLUE, PRIDE_VIOLET, blend);
      }

      return mix(PRIDE_VIOLET, PRIDE_RED, blend);
    }

    float refractiveIndex(float wavelengthNm) {
      // Cauchy B is expressed in square micrometers.
      float wavelengthUm = clamp(wavelengthNm, 380.0, 700.0) * 0.001;

      return uCauchyA + uCauchyB / (wavelengthUm * wavelengthUm);
    }

    vec2 safeUV(vec2 value) {
      vec2 border = 0.5 / max(uResolution, vec2(1.0));

      return clamp(value, border, vec2(1.0) - border);
    }

    vec3 disperse(vec3 source, float blend) {
      vec2 centered = vUv - 0.5;

      vec2 radial = vec2(
        centered.x * uResolution.x / max(uResolution.y, 1.0),
        centered.y
      );

      float radius = length(radial);
      vec2 direction = radial / max(radius, 0.0001);
      float angle = atan(radial.y + 0.000001, radial.x + 0.000001);

      float phase = fract(
        angle / TAU +
        uSpectrumShift +
        uTime * 0.035 +
        0.065 * sin(radial.y * 5.0 + uTime * 0.32)
      );

      float referenceIndex = refractiveIndex(550.0);

      float spread = max(uDispersionPixels, 0.0) *
        (0.35 + min(radius, 1.5)) * blend;

      vec2 pixelDirection = direction / max(uResolution, vec2(1.0));
      vec3 spectrum = vec3(0.0);
      float sampledEnergy = 0.0;

      for (int i = 0; i < 6; i++) {
        float band = float(i);
        float wavelengthNm = 700.0 - band * 64.0;

        // Thin-prism dispersion relative to the green reference wavelength.
        float deviation = (
          refractiveIndex(wavelengthNm) - referenceIndex
        ) / 0.02;

        vec3 sampleColor = max(texture2D(
          tDiffuse,
          safeUV(vUv + pixelDirection * spread * deviation)
        ).rgb, vec3(0.0));

        float energy = peak(sampleColor);

        spectrum += pridePalette(band / 6.0 + phase) * energy;
        sampledEnergy += energy;
      }

      spectrum *= 0.35;
      sampledEnergy /= 6.0;

      vec3 hue = pridePalette(phase);
      float energy = max(peak(source), sampledEnergy);

      vec3 rainbow = hue *
        (energy / max(peak(hue), 0.08)) * 1.35;

      rainbow = mix(rainbow, spectrum, 0.35);

      float highlightMask = smoothstep(0.04, 0.55, energy);

      return mix(source, rainbow, blend * highlightMask);
    }

    vec3 acesFit(vec3 color) {
      vec3 numerator = color * (2.51 * color + 0.03);
      vec3 denominator = color * (2.43 * color + 0.59) + 0.14;

      return clamp(numerator / denominator, 0.0, 1.0);
    }

    vec3 linearToSRGB(vec3 color) {
      vec3 low = color * 12.92;

      vec3 high = 1.055 * pow(
        max(color, vec3(0.0)),
        vec3(1.0 / 2.4)
      ) - 0.055;

      return mix(
        low,
        high,
        step(vec3(0.0031308), color)
      );
    }

    void main() {
      vec3 source = max(texture2D(tDiffuse, vUv).rgb, vec3(0.0));
      vec3 color = source;

      if (uEffectsEnabled > 0.5) {
        float blend = clamp(uPrideBlend + uSurge, 0.0, 1.0);

        if (blend > 0.0001) {
          color = disperse(source, blend);
        }

        float intensity = peak(source);
        float threshold = max(uExcitationThreshold, 0.001);

        float excitation = min(
          intensity * smoothstep(threshold, threshold * 2.5, intensity),
          uHistoryCeiling
        );

        float history = texture2D(tHistory, vUv).r;
        float afterglow = max(history - excitation, 0.0);

        vec3 phosphor = mix(
          P31_GREEN,
          P31_PALE,
          clamp(history * 0.2, 0.0, 1.0)
        );

        color += phosphor * afterglow * max(uPersistence, 0.0);
        color *= uFlicker;
      }

      color *= max(uExposure, 0.0) * max(uRendererExposure, 0.0);
      color = acesFit(max(color, vec3(0.0)));

      if (uEncodeSRGB > 0.5) {
        color = linearToSRGB(color);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function diagnostic(message) {
    if (diagnostics.has(message)) {
      return;
    }

    diagnostics.add(message);

    if (global.console && typeof global.console.warn === "function") {
      global.console.warn("[ChromaMatrixPass] " + message);
    }
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function requireNumber(value, label) {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "ChromaMatrixPass " + label + " must be finite."
      );
    }

    return value;
  }

  function eventName(value, fallback) {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  function supportsHalfFloat() {
    const extensions = renderer.extensions;
    const context = renderer.getContext();

    if (!extensions || typeof extensions.has !== "function") {
      return false;
    }

    const webgl2 = Boolean(
      (renderer.capabilities && renderer.capabilities.isWebGL2) ||
      typeof context.texStorage2D === "function"
    );

    if (webgl2) {
      return extensions.has("EXT_color_buffer_float");
    }

    return (
      extensions.has("OES_texture_half_float") &&
      extensions.has("OES_texture_half_float_linear") &&
      extensions.has("EXT_color_buffer_half_float")
    );
  }

  function configureTarget(target, preserve) {
    if (!target || !target.texture) {
      return;
    }

    const texture = target.texture;

    if (
      preserve &&
      !savedTargets.some(record => record.target === target)
    ) {
      savedTargets.push({
        target,
        type: texture.type,
        colorSpace: texture.colorSpace,
        encoding: texture.encoding
      });
    }

    let changed = texture.type !== bufferType;
    texture.type = bufferType;

    if (
      "colorSpace" in texture &&
      THREE.LinearSRGBColorSpace !== undefined
    ) {
      changed = changed ||
        texture.colorSpace !== THREE.LinearSRGBColorSpace;

      texture.colorSpace = THREE.LinearSRGBColorSpace;
    } else if (
      "encoding" in texture &&
      THREE.LinearEncoding !== undefined
    ) {
      changed = changed ||
        texture.encoding !== THREE.LinearEncoding;

      texture.encoding = THREE.LinearEncoding;
    }

    if (changed) {
      target.dispose();
    }
  }

  function disposeShaderPass(pass) {
    if (!pass) {
      return;
    }

    const baseDispose = THREE.ShaderPass.prototype.dispose;

    if (typeof baseDispose === "function") {
      baseDispose.call(pass);
    } else {
      if (pass.material) {
        pass.material.dispose();
      }

      if (pass.fsQuad && typeof pass.fsQuad.dispose === "function") {
        pass.fsQuad.dispose();
      }
    }
  }

  function buildShaderPass() {
    class ChromaMatrixShaderPass extends THREE.ShaderPass {
      constructor() {
        super({
          name: "ChromaMatrixOutputShader",

          uniforms: {
            tDiffuse: { value: null },
            tHistory: { value: null },
            uResolution: { value: new THREE.Vector2(1, 1) },

            uHistoryCeiling: {
              value: bufferType === THREE.HalfFloatType ? 16 : 1
            },

            uRendererExposure: { value: 1 },
            uEncodeSRGB: { value: 1 }
          },

          vertexShader,
          fragmentShader: outputFragmentShader
        });

        this.name = "ChromaMatrixShaderPass";
        this.isOutputPass = true;
        this.needsSwap = true;

        this.historyPass = null;
        this.historyRead = null;
        this.historyWrite = null;
        this.historyValid = false;

        this.width = 0;
        this.height = 0;
        this.released = false;

        Object.assign(this.uniforms, uniforms);

        this.material.depthTest = false;
        this.material.depthWrite = false;
        this.material.toneMapped = false;
        this.material.blending = THREE.NoBlending;

        try {
          this.historyPass = new THREE.ShaderPass({
            name: "P31PersistenceShader",

            uniforms: {
              tDiffuse: { value: null },
              tHistory: { value: null },
              uHistoryValid: { value: 0 },
              uDecayFactor: { value: 0 },
              uHistoryFloor: { value: 0.00005 },
              uHistoryCeiling: { value: 1 },
              uExcitationThreshold: { value: 0.22 }
            },

            vertexShader,
            fragmentShader: historyFragmentShader
          });

          this.historyPass.uniforms.uHistoryCeiling =
            this.uniforms.uHistoryCeiling;

          this.historyPass.uniforms.uExcitationThreshold =
            uniforms.uExcitationThreshold;

          this.historyPass.material.depthTest = false;
          this.historyPass.material.depthWrite = false;
          this.historyPass.material.toneMapped = false;
          this.historyPass.material.blending = THREE.NoBlending;

          const options = {
            type: bufferType,
            format: THREE.RGBAFormat,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            wrapS: THREE.ClampToEdgeWrapping,
            wrapT: THREE.ClampToEdgeWrapping,
            depthBuffer: false,
            stencilBuffer: false,
            generateMipmaps: false
          };

          this.historyRead = new THREE.WebGLRenderTarget(
            1,
            1,
            options
          );

          this.historyWrite = new THREE.WebGLRenderTarget(
            1,
            1,
            options
          );

          this.historyRead.texture.name = "P31HistoryA";
          this.historyWrite.texture.name = "P31HistoryB";

          configureTarget(this.historyRead, false);
          configureTarget(this.historyWrite, false);

          this.historyRead.texture.generateMipmaps = false;
          this.historyWrite.texture.generateMipmaps = false;
        } catch (error) {
          this.dispose();
          throw error;
        }
      }

      setSize(width, height) {
        const w = Math.max(1, Math.floor(width));
        const h = Math.max(1, Math.floor(height));

        if (w === this.width && h === this.height) {
          return;
        }

        this.width = w;
        this.height = h;

        this.uniforms.uResolution.value.set(w, h);

        if (this.historyRead) {
          this.historyRead.setSize(w, h);
        }

        if (this.historyWrite) {
          this.historyWrite.setSize(w, h);
        }

        this.resetHistory();
      }

      resetHistory() {
        this.historyValid = false;

        if (this.historyPass) {
          this.historyPass.uniforms.uHistoryValid.value = 0;
        }
      }

      render(activeRenderer, writeBuffer, readBuffer, delta, maskActive) {
        if (this.released || contextLost) {
          return;
        }

        this.setSize(readBuffer.width, readBuffer.height);

        const dt = Math.max(0, finite(delta, lastDelta));

        const tau = clamp(
          finite(uniforms.uTau.value, 0.19),
          0.001,
          5
        );

        if (dt > 0.5) {
          this.resetHistory();
        }

        this.uniforms.uRendererExposure.value = Math.max(
          0,
          finite(activeRenderer.toneMappingExposure, 1)
        );

        this.uniforms.uEncodeSRGB.value = (
          (
            THREE.LinearSRGBColorSpace !== undefined &&
            activeRenderer.outputColorSpace === THREE.LinearSRGBColorSpace
          ) ||
          (
            activeRenderer.outputColorSpace === undefined &&
            THREE.LinearEncoding !== undefined &&
            activeRenderer.outputEncoding === THREE.LinearEncoding
          )
        ) ? 0 : 1;

        if (effectsEnabled) {
          const historyUniforms = this.historyPass.uniforms;

          // I(t) = I0 * exp(-t / tau), evaluated once per rendered frame.
          const decay = Math.exp(-dt / tau);

          historyUniforms.uDecayFactor.value = decay;
          historyUniforms.uHistoryValid.value = this.historyValid ? 1 : 0;
          historyUniforms.tHistory.value = this.historyRead.texture;

          // Stop sub-quantum values from sticking indefinitely in 8-bit buffers.
          historyUniforms.uHistoryFloor.value = (
            bufferType === THREE.UnsignedByteType && dt > 0
          ) ? Math.max(
              0.00005,
              0.51 / (255 * Math.max(1 - decay, 0.000001))
            ) : 0.00005;

          const stencil = activeRenderer.state &&
            activeRenderer.state.buffers &&
            activeRenderer.state.buffers.stencil;

          if (maskActive && stencil) {
            stencil.setTest(false);
          }

          try {
            this.historyPass.renderToScreen = false;

            this.historyPass.render(
              activeRenderer,
              this.historyWrite,
              readBuffer,
              dt,
              false
            );
          } finally {
            if (maskActive && stencil) {
              stencil.setTest(true);
            }
          }

          this.uniforms.tHistory.value = this.historyWrite.texture;
        } else {
          this.resetHistory();
        }

        super.render(
          activeRenderer,
          writeBuffer,
          readBuffer,
          dt,
          maskActive
        );

        if (effectsEnabled) {
          const previous = this.historyRead;

          this.historyRead = this.historyWrite;
          this.historyWrite = previous;
          this.historyValid = true;
        }
      }

      dispose() {
        if (this.released) {
          return;
        }

        this.released = true;

        if (this.historyPass) {
          disposeShaderPass(this.historyPass);
        }

        if (this.historyRead) {
          this.historyRead.dispose();
        }

        if (this.historyWrite) {
          this.historyWrite.dispose();
        }

        this.historyPass = null;
        this.historyRead = null;
        this.historyWrite = null;

        disposeShaderPass(this);
      }
    }

    return new ChromaMatrixShaderPass();
  }

  function buildRenderPass() {
    class LinearSceneRenderPass extends THREE.RenderPass {
      render(activeRenderer, writeBuffer, readBuffer, delta, maskActive) {
        const originalToneMapping = activeRenderer.toneMapping;

        activeRenderer.toneMapping = THREE.NoToneMapping;

        try {
          super.render(
            activeRenderer,
            writeBuffer,
            readBuffer,
            delta,
            maskActive
          );
        } finally {
          activeRenderer.toneMapping = originalToneMapping;
        }
      }
    }

    const pass = new LinearSceneRenderPass(
      engine.scene,
      engine.camera
    );

    pass.name = "ChromaMatrixScenePass";
    pass.clear = true;

    return pass;
  }

  function syncSize() {
    if (!initialized || contextLost) {
      return;
    }

    renderer.getDrawingBufferSize(drawingSize);

    const width = Math.max(1, Math.floor(drawingSize.x));
    const height = Math.max(1, Math.floor(drawingSize.y));
    const ratio = Math.max(0.1, finite(renderer.getPixelRatio(), 1));

    if (
      width === previousWidth &&
      height === previousHeight &&
      ratio === previousPixelRatio
    ) {
      return;
    }

    renderer.getSize(logicalSize);

    if (
      typeof composer.setPixelRatio === "function" &&
      ratio !== previousPixelRatio
    ) {
      composer.setPixelRatio(ratio);
    }

    composer.setSize(
      Math.max(1, logicalSize.x),
      Math.max(1, logicalSize.y)
    );

    previousWidth = width;
    previousHeight = height;
    previousPixelRatio = ratio;
  }

  function resetHistory() {
    if (shaderPass) {
      shaderPass.resetHistory();
    }
  }

  function pulse(strength, duration) {
    const amount = clamp(
      finite(strength, 0.85),
      0,
      1
    );

    const seconds = clamp(
      finite(duration, 0.65),
      0.05,
      5
    );

    if (disposed || !effectsEnabled) {
      return;
    }

    uniforms.uSurge.value = Math.max(
      uniforms.uSurge.value,
      amount
    );

    surgeTau = seconds / Math.log(100);
  }

  function onPacketArrived(event) {
    if (!initialized || !effectsEnabled || !event.detail) {
      return;
    }

    if (event.detail.packetClass === "TLS_HANDSHAKE") {
      pulse(0.24, 0.4);
    }
  }

  function onLaserHandover() {
    if (initialized && effectsEnabled) {
      pulse(0.9, 0.7);
    }
  }

  function onContextLost() {
    contextLost = true;
    resetHistory();
  }

  function onContextRestored() {
    contextLost = false;
    previousWidth = 0;
    previousHeight = 0;

    resetHistory();
    syncSize();
  }

  function onVisibilityChange() {
    resetHistory();
    uniforms.uSurge.value = 0;
  }

  function animationHook(delta, elapsed) {
    if (!initialized || disposed || contextLost) {
      return;
    }

    const dt = Math.max(0, finite(delta, 0));

    lastDelta = dt;
    localTime = Number.isFinite(elapsed) ? elapsed : localTime + dt;

    uniforms.uTime.value = localTime;
    uniforms.uSurge.value *= Math.exp(-dt / surgeTau);

    if (uniforms.uSurge.value < 0.001) {
      uniforms.uSurge.value = 0;
    }

    uniforms.uFlicker.value = 0.991 +
      0.006 * Math.sin(localTime * Math.PI * 2 * 59.7) +
      0.003 * Math.sin(localTime * Math.PI * 2 * 23.1);

    if (dt > 0.5) {
      resetHistory();
    }

    syncSize();
  }

  function bindEvents() {
    global.addEventListener(packetEvent, onPacketArrived);
    global.addEventListener(laserEvent, onLaserHandover);
    global.addEventListener("resize", syncSize);

    if (global.document) {
      global.document.addEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    }

    canvas = renderer.domElement;

    if (canvas && typeof canvas.addEventListener === "function") {
      canvas.addEventListener(
        "webglcontextlost",
        onContextLost
      );

      canvas.addEventListener(
        "webglcontextrestored",
        onContextRestored
      );
    }

    eventsBound = true;
  }

  function unbindEvents() {
    if (!eventsBound) {
      return;
    }

    global.removeEventListener(packetEvent, onPacketArrived);
    global.removeEventListener(laserEvent, onLaserHandover);
    global.removeEventListener("resize", syncSize);

    if (global.document) {
      global.document.removeEventListener(
        "visibilitychange",
        onVisibilityChange
      );
    }

    if (canvas && typeof canvas.removeEventListener === "function") {
      canvas.removeEventListener(
        "webglcontextlost",
        onContextLost
      );

      canvas.removeEventListener(
        "webglcontextrestored",
        onContextRestored
      );
    }

    eventsBound = false;
    canvas = null;
  }

  function releasePipeline() {
    unbindEvents();

    if (registered) {
      try {
        if (unsubscribe) {
          unsubscribe();
        } else if (typeof engine.unregisterHook === "function") {
          engine.unregisterHook(animationHook);
        }
      } catch (error) {
        diagnostic(
          "The animation hook could not be removed: " + error.message
        );
      }
    }

    registered = false;
    unsubscribe = null;

    if (
      composer &&
      installedPasses &&
      Array.isArray(composer.passes)
    ) {
      for (let i = composer.passes.length - 1; i >= 0; i -= 1) {
        if (installedPasses.includes(composer.passes[i])) {
          composer.passes.splice(i, 1);
        }
      }

      if (previousPasses) {
        let insertionIndex = 0;

        for (const pass of previousPasses) {
          if (!composer.passes.includes(pass)) {
            composer.passes.splice(insertionIndex, 0, pass);
          }

          insertionIndex = composer.passes.indexOf(pass) + 1;
        }
      }
    }

    for (const record of savedTargets) {
      const texture = record.target.texture;

      texture.type = record.type;

      if ("colorSpace" in texture) {
        texture.colorSpace = record.colorSpace;
      } else if ("encoding" in texture) {
        texture.encoding = record.encoding;
      }

      record.target.dispose();
    }

    savedTargets.length = 0;

    if (composer && previousPasses && renderer && logicalSize) {
      try {
        renderer.getSize(logicalSize);

        composer.setSize(
          Math.max(1, logicalSize.x),
          Math.max(1, logicalSize.y)
        );
      } catch (error) {
        diagnostic(
          "The restored passes could not be resized: " + error.message
        );
      }
    }

    for (const pass of [shaderPass, bloomPass, renderPass]) {
      if (pass && typeof pass.dispose === "function") {
        try {
          pass.dispose();
        } catch (error) {
          diagnostic(
            "A post-processing resource could not be released: " +
            error.message
          );
        }
      }
    }

    shaderPass = null;
    bloomPass = null;
    renderPass = null;
    previousPasses = null;
    installedPasses = null;
    composer = null;
    renderer = null;
    drawingSize = null;
    logicalSize = null;

    previousWidth = 0;
    previousHeight = 0;
    previousPixelRatio = 0;
  }

  function stopBootstrap() {
    if (retryTimer !== null) {
      global.clearTimeout(retryTimer);
      retryTimer = null;
    }

    global.removeEventListener(
      "NetworkEngine:Ready",
      tryBootstrap
    );

    if (global.document) {
      global.document.removeEventListener(
        "DOMContentLoaded",
        tryBootstrap
      );
    }
  }

  function init() {
    if (initialized) {
      return true;
    }

    if (disposed || initializing) {
      return false;
    }

    const candidate = global.THREE;

    const dependencies = [
      "EffectComposer",
      "RenderPass",
      "ShaderPass",
      "UnrealBloomPass"
    ];

    const missing = dependencies.filter(
      name => !candidate || typeof candidate[name] !== "function"
    );

    if (missing.length) {
      status = "waiting";

      diagnostic(
        "Waiting for THREE." + missing.join(", THREE.") +
        ". The existing scene renderer remains active."
      );

      return false;
    }

    const activeComposer = engine.composer;

    const activeRenderer = activeComposer && (
      activeComposer.renderer || engine.renderer
    );

    if (
      !activeComposer ||
      !Array.isArray(activeComposer.passes) ||
      typeof activeComposer.addPass !== "function" ||
      typeof activeComposer.setSize !== "function" ||
      !activeRenderer ||
      !engine.scene ||
      !engine.camera ||
      typeof engine.registerHook !== "function"
    ) {
      status = "waiting";

      diagnostic(
        "Waiting for NetworkEngine scene, camera, renderer, composer, and registerHook."
      );

      return false;
    }

    initializing = true;
    failed = false;

    THREE = candidate;
    composer = activeComposer;
    renderer = activeRenderer;

    try {
      bufferType = (
        THREE.HalfFloatType !== undefined &&
        supportsHalfFloat()
      ) ? THREE.HalfFloatType : THREE.UnsignedByteType;

      if (bufferType === THREE.UnsignedByteType) {
        diagnostic(
          "Half-float color buffers are unavailable; using an 8-bit optical fallback."
        );
      }

      drawingSize = new THREE.Vector2();
      logicalSize = new THREE.Vector2();

      renderPass = buildRenderPass();

      bloomPass = new THREE.UnrealBloomPass(
        renderer.getDrawingBufferSize(drawingSize),
        1.4,
        0.5,
        0.25
      );

      bloomPass.name = "ChromaMatrixBloomPass";
      bloomPass.enabled = effectsEnabled;

      configureTarget(bloomPass.renderTargetBright, false);

      for (const targets of [
        bloomPass.renderTargetsHorizontal,
        bloomPass.renderTargetsVertical
      ]) {
        if (Array.isArray(targets)) {
          for (const target of targets) {
            configureTarget(target, false);
          }
        }
      }

      shaderPass = buildShaderPass();

      configureTarget(composer.readBuffer, true);
      configureTarget(composer.writeBuffer, true);

      // Retain the original pass objects so disposal can restore the prior pipeline.
      previousPasses = composer.passes.slice();
      installedPasses = [renderPass, bloomPass, shaderPass];

      composer.passes.length = 0;

      for (const pass of installedPasses) {
        composer.addPass(pass);
      }

      const constants = engine.DataContract
        ? engine.DataContract.constants || {}
        : {};

      packetEvent = eventName(
        constants.EVENT_PACKET_ARRIVED,
        "NetworkEngine:PacketArrived"
      );

      laserEvent = eventName(
        constants.EVENT_LASER_HANDOVER,
        "NetworkEngine:LaserHandover"
      );

      initialized = true;
      status = "ready";

      syncSize();
      bindEvents();

      registered = true;

      const registration = engine.registerHook(animationHook);

      if (
        typeof registration === "function" &&
        registration !== animationHook
      ) {
        unsubscribe = registration;
      }

      stopBootstrap();

      return true;
    } catch (error) {
      initialized = false;
      failed = true;
      status = "unavailable";

      releasePipeline();

      diagnostic(
        "Optical initialization failed; the previous pipeline was restored. " +
        (error && error.message ? error.message : String(error))
      );

      return false;
    } finally {
      initializing = false;
    }
  }

  function tryBootstrap() {
    if (retryTimer !== null) {
      global.clearTimeout(retryTimer);
      retryTimer = null;
    }

    if (disposed || init() || failed) {
      return;
    }

    retryCount += 1;

    if (retryCount >= 40) {
      status = "unavailable";

      diagnostic(
        "Post-processing is unavailable. Call ChromaMatrixPass.init() after loading the dependencies."
      );

      return;
    }

    retryTimer = global.setTimeout(
      tryBootstrap,
      retryDelay
    );

    retryDelay = Math.min(retryDelay * 2, 1000);
  }

  function setEnabled(enabled) {
    effectsEnabled = Boolean(enabled);
    uniforms.uEffectsEnabled.value = effectsEnabled ? 1 : 0;

    if (bloomPass) {
      bloomPass.enabled = effectsEnabled;
    }

    uniforms.uSurge.value = 0;
    resetHistory();
  }

  function setPrideBlend(value) {
    uniforms.uPrideBlend.value = clamp(
      requireNumber(value, "Pride blend"),
      0,
      1
    );
  }

  function setSpectrumShift(value) {
    const phase = requireNumber(value, "spectrum shift");

    uniforms.uSpectrumShift.value = ((phase % 1) + 1) % 1;
  }

  function setDecayTime(value) {
    uniforms.uTau.value = clamp(
      requireNumber(value, "decay time"),
      0.001,
      5
    );
  }

  function dispose() {
    if (disposed) {
      return;
    }

    disposed = true;
    initialized = false;
    status = "disposed";

    stopBootstrap();
    releasePipeline();
  }

  engine.ChromaMatrixPass = Object.freeze({
    moduleId: MODULE_ID,

    uniforms,

    init,
    dispose,
    pulse,
    resetHistory,
    setEnabled,
    setPrideBlend,
    setSpectrumShift,
    setDecayTime,

    get initialized() {
      return initialized;
    },

    get disposed() {
      return disposed;
    },

    get status() {
      return status;
    },

    get enabled() {
      return initialized && effectsEnabled && !disposed;
    },

    get renderPass() {
      return renderPass;
    },

    get bloomPass() {
      return bloomPass;
    },

    get shaderPass() {
      return shaderPass;
    },

    get composer() {
      return composer;
    }
  });

  global.addEventListener(
    "NetworkEngine:Ready",
    tryBootstrap
  );

  if (global.document) {
    global.document.addEventListener(
      "DOMContentLoaded",
      tryBootstrap,
      { once: true }
    );
  }

  tryBootstrap();
})(window);