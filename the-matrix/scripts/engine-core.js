(function () {
  "use strict";

  const Engine = window.NetworkEngine = window.NetworkEngine || {};

  if (Engine.coreVersion && Engine.state && !Engine.state.disposed) {
    return;
  }

  /*
   * Frame hooks are synchronous: fn(simulationDelta, elapsedTime, Engine).
   * Paused frames receive delta = 0; camera inspection remains available.
   * Register callbacks through the helpers; do not edit the hook arrays.
   *
   * The baseline uses linear, unsigned-byte composer targets, scene ACES,
   * and one sRGB conversion in outputPass. A chroma output pass may take
   * over tone mapping with setOutputPass(pass, "output"). In that mode,
   * the core suppresses scene tone mapping during composer rendering.
   * The chroma module owns any HDR target upgrade and history textures.
   *
   * Custom scene shaders must implement Three.js log-depth chunks when
   * state.capabilities.logarithmicDepthBuffer is true.
   */

  const suppliedSettings = Engine.settings || {};

  const settings = Engine.settings = Object.assign({
    postProcessing: true,
    pixelRatioCap: 2,
    exposure: 1.08,
    logarithmicDepthBuffer: true,
    maxDelta: 0.05,
    timeScale: 1
  }, suppliedSettings);

  settings.camera = Object.assign({
    fov: 45,
    near: 0.1,
    far: 5000,
    position: [0, 155, 360],
    target: [0, 0, 0],
    minDistance: 120,
    maxDistance: 800,
    maxPanDistance: 35,
    dampingFactor: 0.05,
    rotateSpeed: 0.45,
    zoomSpeed: 0.7,
    panSpeed: 0.35,
    minPolarAngle: 0.04,
    maxPolarAngle: Math.PI - 0.04
  }, suppliedSettings.camera || {});

  const state = Engine.state = Object.assign(Engine.state || {}, {
    initialized: false,
    disposed: false,
    running: false,
    runRequested: false,
    paused: false,
    contextLost: false,
    pageHidden: false,
    hasViewport: false,
    status: "waiting",
    cameraOwner: "controls",
    toneMappingStage: "scene",
    postProcessingActive: false,
    postProcessingFailed: false,
    deltaTime: 0,
    frameDelta: 0,
    elapsedTime: 0,
    frameCount: 0,
    width: 0,
    height: 0,
    pixelRatio: 1,
    capabilities: {},
    warnings: [],
    error: null
  });

  Engine.coreVersion = "1.0.0-r128";
  Engine.scene = null;
  Engine.camera = null;
  Engine.renderer = null;
  Engine.composer = null;
  Engine.clock = null;
  Engine.controls = null;
  Engine.renderPass = null;
  Engine.outputPass = null;
  Engine.cameraHome = null;

  Engine.renderHooks = Array.isArray(Engine.renderHooks)
    ? Engine.renderHooks
    : [];

  Engine.resizeHooks = [];
  Engine.disposeHooks = [];

  Engine.events = Object.assign(Engine.events || {}, {
    ready: "NetworkEngineReady",
    resize: "NetworkEngineResize",
    pause: "NetworkEnginePause",
    visibility: "NetworkEngineVisibility",
    contextLost: "NetworkEngineContextLost",
    contextRestored: "NetworkEngineContextRestored",
    warning: "NetworkEngineWarning",
    error: "NetworkEngineError",
    disposed: "NetworkEngineDisposed"
  });

  let THREE = null;
  let container = null;
  let canvas = null;
  let animationId = null;
  let resizeObserver = null;
  let resizePending = true;
  let baselineOutputPass = null;
  let orbitOrigin = null;
  let panOffset = null;
  let orbitOffset = null;
  let lastFocus = null;
  let errorVisible = false;
  let inertRecords = [];
  let initializationCode = "ENGINE_INIT_FAILURE";

  const listenerRemovers = [];
  const frameSnapshot = [];
  const resizeSnapshot = [];

  function finite(value, fallback, minimum, maximum) {
    const number = Number(value);

    return Number.isFinite(number)
      ? Math.min(maximum, Math.max(minimum, number))
      : fallback;
  }

  function setText(id, value) {
    const element = document.getElementById(id);

    if (element && element.textContent !== String(value)) {
      element.textContent = String(value);
    }
  }

  function emit(type, detail) {
    window.dispatchEvent(
      new window.CustomEvent(Engine.events[type] || type, {
        detail: detail
      })
    );
  }

  function warn(code, message, error) {
    const record = {
      code: code,
      message: message
    };

    state.warnings.push(record);

    if (state.warnings.length > 32) {
      state.warnings.shift();
    }

    console.warn(
      "[NetworkEngine][" + code + "] " + message,
      error || ""
    );

    emit("warning", record);
  }

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options);

    listenerRemovers.push(function () {
      target.removeEventListener(type, callback, options);
    });
  }

  function updateStatus() {
    let status = "ready";
    let message = "Runtime ready";

    if (state.error) {
      status = "error";
      message = state.contextLost
        ? "Graphics context interrupted"
        : "Runtime unavailable";
    } else if (state.pageHidden || document.hidden) {
      status = "suspended";
      message = "Runtime suspended";
    } else if (!state.running) {
      status = "stopped";
      message = "Runtime stopped";
    } else if (state.paused) {
      status = "paused";
      message = "Simulation paused · orbit available";
    } else if (state.postProcessingFailed) {
      message = "Runtime active · direct rendering";
    } else {
      message = "Runtime active";
    }

    state.status = status;

    if (document.body) {
      document.body.dataset.engineState = status;
    }

    setText("system-status", message);

    const pip = document.getElementById("system-status-pip");

    if (pip) {
      pip.dataset.state = status === "error"
        ? "error"
        : status === "paused"
          ? "paused"
          : state.running
            ? "active"
            : "waiting";
    }
  }

  function ensureErrorNotice() {
    let notice = document.getElementById("render-error-notice");

    if (notice) {
      return notice;
    }

    notice = document.createElement("section");
    notice.id = "render-error-notice";
    notice.hidden = true;
    notice.tabIndex = -1;

    notice.setAttribute("role", "alertdialog");
    notice.setAttribute("aria-modal", "true");
    notice.setAttribute("aria-labelledby", "render-error-title");
    notice.setAttribute("aria-describedby", "render-error-message");

    const card = document.createElement("div");
    card.className = "error-card glass-panel";

    const heading = document.createElement("h2");
    heading.id = "render-error-title";
    heading.textContent = "Visualization unavailable";

    const message = document.createElement("p");
    message.id = "render-error-message";

    const code = document.createElement("p");
    code.id = "render-error-code";

    const details = document.createElement("pre");
    details.id = "render-error-details";

    const reload = document.createElement("a");
    reload.className = "control-button error-reload";
    reload.href = "index.html";
    reload.textContent = "Reload visualization";

    card.appendChild(heading);
    card.appendChild(message);
    card.appendChild(code);
    card.appendChild(details);
    card.appendChild(reload);

    notice.appendChild(card);
    (document.body || document.documentElement).appendChild(notice);

    return notice;
  }

  function trapErrorFocus(event) {
    if (!errorVisible || event.key !== "Tab") {
      return;
    }

    const notice = document.getElementById("render-error-notice");

    if (!notice) {
      return;
    }

    const focusable = Array.from(
      notice.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), summary, [tabindex="0"]'
      )
    ).filter(function (element) {
      return element.getClientRects().length > 0;
    });

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;

    if (!first) {
      event.preventDefault();
      notice.focus({ preventScroll: true });
    } else if (
      event.shiftKey &&
      (
        current === first ||
        current === notice ||
        !notice.contains(current)
      )
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (
        current === last ||
        current === notice ||
        !notice.contains(current)
      )
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  function showError(code, message, error) {
    const diagnostic = error instanceof Error
      ? error.name + ": " + error.message
      : String(error || message);

    state.error = {
      code: code,
      message: message,
      diagnostic: diagnostic
    };

    const notice = ensureErrorNotice();

    setText("render-error-code", code);
    setText("render-error-message", message);
    setText("render-error-details", diagnostic);

    if (!errorVisible) {
      lastFocus = document.activeElement;
      inertRecords = [];

      document.querySelectorAll(
        "#webgl-canvas-container, .hud-component, #hud-toggle"
      ).forEach(function (element) {
        if (element === notice || element.contains(notice)) {
          return;
        }

        inertRecords.push({
          element: element,
          inert: element.inert,
          ariaHidden: element.getAttribute("aria-hidden")
        });

        element.inert = true;
        element.setAttribute("aria-hidden", "true");
      });

      document.addEventListener("keydown", trapErrorFocus, true);
    }

    errorVisible = true;
    notice.hidden = false;
    notice.focus({ preventScroll: true });

    updateStatus();

    console.error(
      "[NetworkEngine][" + code + "] " + message,
      diagnostic
    );

    emit("error", state.error);
  }

  function clearError() {
    const notice = document.getElementById("render-error-notice");

    if (notice) {
      notice.hidden = true;
    }

    inertRecords.forEach(function (record) {
      record.element.inert = record.inert;

      if (record.ariaHidden === null) {
        record.element.removeAttribute("aria-hidden");
      } else {
        record.element.setAttribute("aria-hidden", record.ariaHidden);
      }
    });

    inertRecords = [];
    errorVisible = false;
    state.error = null;

    document.removeEventListener("keydown", trapErrorFocus, true);

    if (
      lastFocus &&
      lastFocus.isConnected &&
      typeof lastFocus.focus === "function"
    ) {
      lastFocus.focus({ preventScroll: true });
    }

    lastFocus = null;
  }

  function register(list, callback) {
    if (typeof callback !== "function") {
      throw new TypeError("NetworkEngine hooks must be functions.");
    }

    if (state.disposed) {
      throw new Error("NetworkEngine has been disposed.");
    }

    if (list.indexOf(callback) < 0) {
      list.push(callback);
    }

    return function unregister() {
      const index = list.indexOf(callback);

      if (index >= 0) {
        list.splice(index, 1);
      }
    };
  }

  Engine.registerHook = function (callback) {
    return register(Engine.renderHooks, callback);
  };

  Engine.registerResizeHook = function (callback) {
    const unregister = register(Engine.resizeHooks, callback);

    if (state.initialized && state.hasViewport) {
      try {
        callback(
          state.width,
          state.height,
          state.pixelRatio,
          Engine
        );
      } catch (error) {
        unregister();

        warn(
          "RESIZE_HOOK_DISABLED",
          "A resize callback failed and was removed.",
          error
        );
      }
    }

    return unregister;
  };

  Engine.registerDisposeHook = function (callback) {
    return register(Engine.disposeHooks, callback);
  };

  function runFrameHooks(delta) {
    const hooks = Engine.renderHooks;

    frameSnapshot.length = hooks.length;

    for (let i = 0; i < hooks.length; i += 1) {
      frameSnapshot[i] = hooks[i];
    }

    for (let i = 0; i < frameSnapshot.length; i += 1) {
      const callback = frameSnapshot[i];

      if (hooks.indexOf(callback) < 0) {
        continue;
      }

      try {
        callback(delta, state.elapsedTime, Engine);
      } catch (error) {
        const index = hooks.indexOf(callback);

        if (index >= 0) {
          hooks.splice(index, 1);
        }

        warn(
          "FRAME_HOOK_DISABLED",
          "A frame callback failed and was removed.",
          error
        );
      }

      if (state.disposed || state.contextLost || !state.running) {
        break;
      }
    }
  }

  function desiredPixelRatio() {
    const deviceRatio = finite(window.devicePixelRatio, 1, 0.25, 16);
    const cap = finite(settings.pixelRatioCap, 2, 0.25, 2);

    return Math.min(deviceRatio, cap, 2);
  }

  function updateGPUReadout() {
    const capabilities = state.capabilities;

    const profile = (capabilities.webgl2 ? "WebGL 2" : "WebGL 1")
      + " · " + capabilities.precision
      + " · " + state.pixelRatio.toFixed(2).replace(/\.?0+$/, "") + "×";

    setText("gpu-profile", profile);

    const readout = document.getElementById("gpu-profile");

    if (readout) {
      readout.dataset.state = "ready";
    }
  }

  function disablePostProcessing(error) {
    if (!state.postProcessingFailed) {
      warn(
        "POST_PROCESSING_FALLBACK",
        "Post-processing is unavailable; using direct scene rendering.",
        error
      );
    }

    state.postProcessingFailed = true;
    state.postProcessingActive = false;

    updateStatus();
  }

  function resizeViewport() {
    if (
      !Engine.renderer ||
      !container ||
      state.contextLost ||
      state.disposed
    ) {
      return;
    }

    resizePending = false;

    const width = Math.floor(container.clientWidth);
    const height = Math.floor(container.clientHeight);

    state.hasViewport = width > 0 && height > 0;

    if (!state.hasViewport) {
      return;
    }

    const requestedRatio = desiredPixelRatio();
    const maxSize = state.capabilities.maxRenderSize;

    const ratio = Math.min(
      requestedRatio,
      maxSize / width,
      maxSize / height
    );

    state.requestedPixelRatio = requestedRatio;

    if (
      width === state.width &&
      height === state.height &&
      ratio === state.pixelRatio
    ) {
      return;
    }

    state.width = width;
    state.height = height;
    state.pixelRatio = ratio;

    Engine.camera.aspect = width / height;
    Engine.camera.updateProjectionMatrix();

    Engine.renderer.setPixelRatio(ratio);
    Engine.renderer.setSize(width, height, false);

    if (Engine.composer && !state.postProcessingFailed) {
      try {
        Engine.composer.setPixelRatio(ratio);
        Engine.composer.setSize(width, height);
      } catch (error) {
        disablePostProcessing(error);
      }
    }

    updateGPUReadout();

    resizeSnapshot.length = Engine.resizeHooks.length;

    for (let i = 0; i < Engine.resizeHooks.length; i += 1) {
      resizeSnapshot[i] = Engine.resizeHooks[i];
    }

    for (let i = 0; i < resizeSnapshot.length; i += 1) {
      const callback = resizeSnapshot[i];

      if (Engine.resizeHooks.indexOf(callback) < 0) {
        continue;
      }

      try {
        callback(width, height, ratio, Engine);
      } catch (error) {
        const index = Engine.resizeHooks.indexOf(callback);

        if (index >= 0) {
          Engine.resizeHooks.splice(index, 1);
        }

        warn(
          "RESIZE_HOOK_DISABLED",
          "A resize callback failed and was removed.",
          error
        );
      }

      if (state.disposed) {
        return;
      }
    }

    emit("resize", {
      width: width,
      height: height,
      pixelRatio: ratio
    });
  }

  Engine.resize = function () {
    resizePending = true;

    if (state.initialized && !state.contextLost) {
      resizeViewport();
    }
  };

  function configureRenderer() {
    const renderer = Engine.renderer;

    renderer.setClearColor(0x000000, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = finite(
      settings.exposure,
      1.08,
      0.01,
      8
    );

    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;
    renderer.sortObjects = true;
    renderer.debug.checkShaderErrors = true;
  }

  function createComposer() {
    const required = [
      "EffectComposer",
      "RenderPass",
      "ShaderPass",
      "CopyShader"
    ];

    const missing = required.filter(function (name) {
      return !THREE[name];
    });

    if (missing.length) {
      throw new Error(
        "Missing post-processing dependencies: " + missing.join(", ")
      );
    }

    const composer = new THREE.EffectComposer(Engine.renderer);
    let outputPass = null;

    try {
      composer.renderToScreen = true;

      [
        composer.renderTarget1,
        composer.renderTarget2
      ].forEach(function (target) {
        target.texture.encoding = THREE.LinearEncoding;
        target.texture.format = THREE.RGBAFormat;
        target.texture.generateMipmaps = false;
        target.depthBuffer = true;
        target.stencilBuffer = false;
      });

      const renderPass = new THREE.RenderPass(
        Engine.scene,
        Engine.camera
      );

      outputPass = new THREE.ShaderPass(THREE.CopyShader);

      outputPass.material.name = "NetworkEngine.BaselineOutput";
      outputPass.material.toneMapped = false;
      outputPass.material.depthTest = false;
      outputPass.material.depthWrite = false;
      outputPass.material.blending = THREE.NoBlending;

      outputPass.material.fragmentShader =
        outputPass.material.fragmentShader.replace(
          /\}\s*$/,
          "#include <encodings_fragment>\n}"
        );

      outputPass.material.needsUpdate = true;
      outputPass.renderToScreen = true;

      composer.addPass(renderPass);
      composer.addPass(outputPass);

      Engine.composer = composer;
      Engine.renderPass = renderPass;
      Engine.outputPass = outputPass;
      baselineOutputPass = outputPass;
      state.toneMappingStage = "scene";
    } catch (error) {
      if (outputPass) {
        disposePass(outputPass);
      }

      disposePass(composer.copyPass);
      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();

      throw error;
    }
  }

  function requireComposer() {
    if (
      !state.initialized ||
      state.disposed ||
      !Engine.composer
    ) {
      throw new Error("The post-processing composer is not available.");
    }

    return Engine.composer;
  }

  function validatePass(pass) {
    if (
      !pass ||
      typeof pass.render !== "function" ||
      typeof pass.setSize !== "function"
    ) {
      throw new TypeError("Expected a Three.js post-processing pass.");
    }
  }

  Engine.addPostPass = function (pass) {
    validatePass(pass);

    const composer = requireComposer();

    if (composer.passes.indexOf(pass) >= 0) {
      return pass;
    }

    const index = composer.passes.indexOf(Engine.outputPass);

    if (index < 0) {
      throw new Error("The final output pass is missing.");
    }

    pass.renderToScreen = false;

    try {
      composer.insertPass(pass, index);
    } catch (error) {
      composer.removePass(pass);
      throw error;
    }

    return pass;
  };

  Engine.removePostPass = function (pass) {
    const composer = requireComposer();

    if (pass === Engine.renderPass || pass === Engine.outputPass) {
      throw new Error(
        "Core render/output passes must remain in the pipeline."
      );
    }

    composer.removePass(pass);

    return pass;
  };

  Engine.setOutputPass = function (pass, toneMappingStage) {
    validatePass(pass);

    const composer = requireComposer();
    const stage = toneMappingStage || "output";

    if (stage !== "scene" && stage !== "output") {
      throw new TypeError(
        'Tone-mapping stage must be "scene" or "output".'
      );
    }

    if (pass === Engine.renderPass) {
      throw new Error("RenderPass cannot be the output pass.");
    }

    if (pass === baselineOutputPass && stage !== "scene") {
      throw new Error(
        "The baseline output pass requires scene tone mapping."
      );
    }

    const previousPasses = composer.passes.slice();

    try {
      composer.removePass(Engine.outputPass);
      composer.removePass(pass);
      composer.addPass(pass);
    } catch (error) {
      composer.passes.length = 0;

      previousPasses.forEach(function (previous) {
        composer.passes.push(previous);
      });

      throw error;
    }

    pass.enabled = true;
    pass.renderToScreen = true;

    Engine.outputPass = pass;
    state.toneMappingStage = stage;

    return pass;
  };

  Engine.setPostProcessingEnabled = function (enabled) {
    settings.postProcessing = Boolean(enabled);

    if (!state.initialized || state.contextLost || state.disposed) {
      return false;
    }

    if (settings.postProcessing) {
      try {
        if (!Engine.composer) {
          createComposer();
        }

        state.postProcessingFailed = false;

        Engine.composer.setPixelRatio(state.pixelRatio);
        Engine.composer.setSize(
          Math.max(1, state.width),
          Math.max(1, state.height)
        );
      } catch (error) {
        disablePostProcessing(error);
      }
    }

    state.postProcessingActive =
      settings.postProcessing &&
      Boolean(Engine.composer) &&
      !state.postProcessingFailed;

    updateStatus();

    return state.postProcessingActive;
  };

  function constrainOrbit() {
    const controls = Engine.controls;
    const camera = Engine.camera;
    const config = settings.camera;

    const maxPan = finite(config.maxPanDistance, 35, 0, 100);
    const minimum = finite(config.minDistance, 120, 1, 1000);

    const maximum = Math.max(
      minimum + maxPan + 1,
      finite(config.maxDistance, 800, 2, 4500)
    );

    panOffset.subVectors(controls.target, orbitOrigin);

    if (panOffset.length() > maxPan) {
      panOffset.setLength(maxPan);

      orbitOffset.copy(controls.target);
      controls.target.copy(orbitOrigin).add(panOffset);
      orbitOffset.sub(controls.target);

      camera.position.sub(orbitOffset);
    }

    // Preserve a planet-centered clearance after the orbit target is panned.
    controls.minDistance = minimum + panOffset.length();
    controls.maxDistance = maximum;

    orbitOffset.subVectors(camera.position, controls.target);

    if (orbitOffset.lengthSq() < 1e-12) {
      orbitOffset.set(0, 0, 1);
    }

    orbitOffset.clampLength(
      controls.minDistance,
      controls.maxDistance
    );

    camera.position.copy(controls.target).add(orbitOffset);
    camera.updateMatrixWorld(true);
  }

  function clearControlDamping() {
    const controls = Engine.controls;

    const position = Engine.camera.position.clone();
    const quaternion = Engine.camera.quaternion.clone();
    const target = controls.target.clone();
    const damping = controls.enableDamping;

    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;

    controls.target.copy(target);
    Engine.camera.position.copy(position);
    Engine.camera.quaternion.copy(quaternion);
    Engine.camera.updateMatrixWorld(true);
  }

  Engine.setCameraOwner = function (owner) {
    if (owner !== "controls" && owner !== "external") {
      throw new TypeError(
        'Camera owner must be "controls" or "external".'
      );
    }

    if (!Engine.controls || state.disposed) {
      return;
    }

    if (state.cameraOwner === owner) {
      return;
    }

    clearControlDamping();

    state.cameraOwner = owner;
    Engine.controls.enabled = owner === "controls";

    // External controllers must align controls.target with their final pose.
  };

  function restoreDefaultFramebuffer() {
    const renderer = Engine.renderer;

    renderer.setRenderTarget(null);
    renderer.setViewport(0, 0, state.width, state.height);
    renderer.setScissorTest(false);

    renderer.autoClear = true;
    renderer.autoClearColor = true;
    renderer.autoClearDepth = true;
    renderer.autoClearStencil = true;

    renderer.setClearColor(0x000000, 1);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    renderer.toneMappingExposure = finite(
      settings.exposure,
      1.08,
      0.01,
      8
    );
  }

  function renderFrame(delta) {
    const renderer = Engine.renderer;
    const composer = Engine.composer;

    restoreDefaultFramebuffer();

    if (
      settings.postProcessing &&
      composer &&
      !state.postProcessingFailed
    ) {
      const autoUpdate = Engine.scene.autoUpdate;
      const overrideMaterial = Engine.scene.overrideMaterial;

      try {
        if (state.toneMappingStage === "output") {
          renderer.toneMapping = THREE.NoToneMapping;
        }

        composer.render(delta);
        state.postProcessingActive = true;

        return;
      } catch (error) {
        if (renderer.getContext().isContextLost()) {
          return;
        }

        disablePostProcessing(error);
      } finally {
        Engine.scene.autoUpdate = autoUpdate;
        Engine.scene.overrideMaterial = overrideMaterial;
        restoreDefaultFramebuffer();
      }
    }

    state.postProcessingActive = false;
    renderer.render(Engine.scene, Engine.camera);
  }

  function haltLoop() {
    if (animationId !== null) {
      window.cancelAnimationFrame(animationId);
      animationId = null;
    }

    state.running = false;
    state.deltaTime = 0;
    state.frameDelta = 0;

    if (Engine.clock) {
      Engine.clock.stop();
    }
  }

  function fatal(code, message, error) {
    state.runRequested = false;

    haltLoop();
    showError(code, message, error);
  }

  function animate() {
    animationId = null;

    if (!state.running || state.disposed || state.contextLost) {
      return;
    }

    try {
      const rawDelta = Engine.clock.getDelta();

      const maximumDelta = finite(
        settings.maxDelta,
        0.05,
        0.001,
        0.1
      );

      const frameDelta = Math.min(
        Math.max(rawDelta, 0),
        maximumDelta
      );

      state.frameDelta = frameDelta;

      if (
        resizePending ||
        desiredPixelRatio() !== state.requestedPixelRatio
      ) {
        resizeViewport();
      }

      if (state.hasViewport && !state.disposed) {
        const scale = finite(settings.timeScale, 1, 0, 20);
        const delta = state.paused ? 0 : frameDelta * scale;

        state.deltaTime = delta;
        state.elapsedTime += delta;

        if (
          state.cameraOwner === "controls" &&
          Engine.controls.enabled
        ) {
          const baseDamping = finite(
            settings.camera.dampingFactor,
            0.05,
            0.001,
            0.99
          );

          Engine.controls.dampingFactor =
            1 - Math.pow(1 - baseDamping, frameDelta * 60);

          Engine.controls.update();
          constrainOrbit();
        }

        runFrameHooks(delta);

        if (
          state.running &&
          !state.disposed &&
          !state.contextLost
        ) {
          renderFrame(delta);
          state.frameCount += 1;
        }
      } else {
        state.deltaTime = 0;
      }
    } catch (error) {
      if (!state.contextLost && !state.disposed) {
        fatal(
          "FRAME_FAILURE",
          "The rendering loop encountered an unrecoverable error.",
          error
        );
      }
    }

    if (
      state.running &&
      !state.disposed &&
      !state.contextLost &&
      animationId === null
    ) {
      animationId = window.requestAnimationFrame(animate);
    }
  }

  function resumeLoopIfAllowed() {
    if (
      !state.initialized ||
      state.disposed ||
      state.contextLost ||
      state.error ||
      !state.runRequested ||
      document.hidden ||
      state.pageHidden ||
      state.running
    ) {
      return;
    }

    Engine.clock.start();

    resizePending = true;
    state.running = true;

    animationId = window.requestAnimationFrame(animate);

    updateStatus();
  }

  Engine.start = function () {
    if (state.disposed || state.error) {
      return false;
    }

    state.runRequested = true;
    resumeLoopIfAllowed();

    return state.running;
  };

  Engine.stop = function () {
    state.runRequested = false;

    haltLoop();
    updateStatus();
  };

  Engine.setPaused = function (paused) {
    const next = Boolean(paused);

    if (next === state.paused || state.disposed) {
      return;
    }

    state.paused = next;
    state.deltaTime = 0;

    updateStatus();

    emit("pause", {
      paused: next,
      elapsedTime: state.elapsedTime
    });
  };

  function handleVisibility() {
    if (document.hidden || state.pageHidden) {
      haltLoop();
    } else {
      resumeLoopIfAllowed();
    }

    updateStatus();

    emit("visibility", {
      hidden: Boolean(document.hidden || state.pageHidden)
    });
  }

  function handleContextLost(event) {
    event.preventDefault();

    if (state.disposed || state.contextLost) {
      return;
    }

    state.contextLost = true;
    state.postProcessingActive = false;

    haltLoop();

    showError(
      "WEBGL_CONTEXT_LOST",
      "The graphics context was interrupted. Rendering will resume if the browser restores it.",
      "WebGL context lost; simulation time is frozen."
    );

    emit("contextLost", {
      elapsedTime: state.elapsedTime
    });
  }

  function handleContextRestored() {
    if (state.disposed || !state.initialized) {
      return;
    }

    try {
      state.contextLost = false;

      configureRenderer();

      state.width = 0;
      state.height = 0;
      resizePending = true;

      resizeViewport();
      clearError();

      emit("contextRestored", {
        clearHistory: true
      });

      resumeLoopIfAllowed();
      updateStatus();
    } catch (error) {
      fatal(
        "WEBGL_RESTORE_FAILURE",
        "The graphics context could not be restored.",
        error
      );
    }
  }

  function disposePass(pass) {
    if (!pass) {
      return;
    }

    if (typeof pass.dispose === "function") {
      pass.dispose();
    } else if (
      pass.material &&
      typeof pass.material.dispose === "function"
    ) {
      pass.material.dispose();
    }
  }

  Engine.dispose = function () {
    if (state.disposed) {
      return;
    }

    state.runRequested = false;

    haltLoop();

    state.disposed = true;

    const callbacks = Engine.disposeHooks.slice().reverse();

    callbacks.forEach(function (callback) {
      try {
        callback(Engine);
      } catch (error) {
        warn(
          "DISPOSE_HOOK_FAILURE",
          "A cleanup callback failed.",
          error
        );
      }
    });

    listenerRemovers.splice(0).forEach(function (remove) {
      remove();
    });

    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    resizeObserver = null;

    if (Engine.controls) {
      Engine.controls.dispose();
    }

    const composer = Engine.composer;

    if (composer) {
      const passes = new Set(composer.passes);

      passes.add(composer.copyPass);
      passes.add(baselineOutputPass);

      passes.forEach(function (pass) {
        try {
          disposePass(pass);
        } catch (error) {
          warn(
            "PASS_DISPOSE_FAILURE",
            "A post-processing cleanup failed.",
            error
          );
        }
      });

      composer.renderTarget1.dispose();
      composer.renderTarget2.dispose();
    }

    if (Engine.renderer) {
      Engine.renderer.dispose();
    }

    if (canvas && canvas.parentNode) {
      canvas.parentNode.removeChild(canvas);
    }

    clearError();

    Engine.renderHooks.length = 0;
    Engine.resizeHooks.length = 0;
    Engine.disposeHooks.length = 0;

    frameSnapshot.length = 0;
    resizeSnapshot.length = 0;

    Engine.scene = null;
    Engine.camera = null;
    Engine.renderer = null;
    Engine.composer = null;
    Engine.controls = null;
    Engine.clock = null;
    Engine.renderPass = null;
    Engine.outputPass = null;
    Engine.cameraHome = null;

    baselineOutputPass = null;

    state.initialized = false;
    state.postProcessingActive = false;
    state.status = "disposed";

    if (document.body) {
      document.body.dataset.engineState = "disposed";
    }

    setText("system-status", "Runtime disposed");

    const pip = document.getElementById("system-status-pip");

    if (pip) {
      pip.dataset.state = "waiting";
    }

    emit("disposed", {});
  };

  function initialize() {
    if (state.initialized || state.disposed || state.error) {
      return;
    }

    try {
      initializationCode = "CANVAS_MOUNT_MISSING";

      container = document.getElementById("webgl-canvas-container");

      if (!container) {
        throw new Error(
          'Required element "#webgl-canvas-container" was not found.'
        );
      }

      initializationCode = "DEPENDENCY_FAILURE";
      THREE = window.THREE;

      if (!THREE || typeof THREE.WebGLRenderer !== "function") {
        throw new Error(
          "Three.js did not load. Check the pinned CDN scripts and internet connection."
        );
      }

      if (String(THREE.REVISION) !== "128") {
        throw new Error(
          "This engine requires Three.js r128; received revision "
          + THREE.REVISION + "."
        );
      }

      if (typeof THREE.OrbitControls !== "function") {
        throw new Error(
          "The r128 OrbitControls dependency did not load."
        );
      }

      initializationCode = "WEBGL_INIT_FAILURE";

      canvas = document.createElement("canvas");
      canvas.dataset.networkEngine = "core";
      canvas.setAttribute("aria-hidden", "true");

      const contextAttributes = {
        alpha: true,
        antialias: true,
        depth: true,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      };

      let context = null;
      let contextName = "";

      const names = [
        "webgl2",
        "webgl",
        "experimental-webgl"
      ];

      for (let i = 0; i < names.length; i += 1) {
        try {
          context = canvas.getContext(names[i], contextAttributes);
        } catch (error) {
          context = null;
        }

        if (context) {
          contextName = names[i];
          break;
        }
      }

      if (!context) {
        throw new Error(
          "The browser could not create a WebGL rendering context."
        );
      }

      const supportsLogDepth =
        contextName === "webgl2" ||
        Boolean(context.getExtension("EXT_frag_depth"));

      Engine.renderer = new THREE.WebGLRenderer(
        Object.assign({}, contextAttributes, {
          canvas: canvas,
          context: context,
          logarithmicDepthBuffer: Boolean(
            settings.logarithmicDepthBuffer && supportsLogDepth
          )
        })
      );

      configureRenderer();
      Engine.renderer.setPixelRatio(desiredPixelRatio());

      const capabilities = Engine.renderer.capabilities;

      state.capabilities = {
        webgl2: capabilities.isWebGL2,
        precision: capabilities.precision,
        logarithmicDepthBuffer: Boolean(
          settings.logarithmicDepthBuffer && supportsLogDepth
        ),
        maxRenderSize: Math.min(
          capabilities.maxTextureSize,
          context.getParameter(context.MAX_RENDERBUFFER_SIZE)
        ),
        antialias: Boolean(context.getContextAttributes().antialias)
      };

      if (settings.logarithmicDepthBuffer && !supportsLogDepth) {
        warn(
          "LOG_DEPTH_UNAVAILABLE",
          "Using standard depth buffering on this graphics context."
        );
      }

      Engine.scene = new THREE.Scene();
      Engine.scene.name = "NetworkEngine.Scene";

      Engine.clock = new THREE.Clock(false);

      const cameraSettings = settings.camera;

      const near = finite(
        cameraSettings.near,
        0.1,
        0.001,
        10
      );

      const far = Math.max(
        near + 1,
        finite(cameraSettings.far, 5000, 1000, 100000)
      );

      Engine.camera = new THREE.PerspectiveCamera(
        finite(cameraSettings.fov, 45, 20, 90),
        1,
        near,
        far
      );

      Engine.camera.name = "NetworkEngine.Camera";
      Engine.camera.up.set(0, 1, 0);

      const position = cameraSettings.position;
      const target = cameraSettings.target;

      if (
        !Array.isArray(position) ||
        position.length !== 3 ||
        !position.every(Number.isFinite) ||
        !Array.isArray(target) ||
        target.length !== 3 ||
        !target.every(Number.isFinite)
      ) {
        throw new TypeError(
          "Camera position and target must be finite three-number arrays."
        );
      }

      Engine.camera.position.fromArray(position);

      orbitOrigin = new THREE.Vector3().fromArray(target);
      panOffset = new THREE.Vector3();
      orbitOffset = new THREE.Vector3();

      Engine.camera.lookAt(orbitOrigin);
      Engine.camera.updateMatrixWorld(true);

      container.appendChild(canvas);

      initializationCode = "CONTROLS_INIT_FAILURE";

      Engine.controls = new THREE.OrbitControls(
        Engine.camera,
        canvas
      );

      const controls = Engine.controls;

      controls.target.copy(orbitOrigin);
      controls.enableDamping = true;

      controls.dampingFactor = finite(
        cameraSettings.dampingFactor,
        0.05,
        0.001,
        0.99
      );

      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.enablePan = true;
      controls.screenSpacePanning = false;
      controls.autoRotate = false;

      controls.rotateSpeed = finite(
        cameraSettings.rotateSpeed,
        0.45,
        0.05,
        2
      );

      controls.zoomSpeed = finite(
        cameraSettings.zoomSpeed,
        0.7,
        0.05,
        2
      );

      controls.panSpeed = finite(
        cameraSettings.panSpeed,
        0.35,
        0.01,
        2
      );

      controls.minPolarAngle = finite(
        cameraSettings.minPolarAngle,
        0.04,
        0.001,
        1
      );

      controls.maxPolarAngle = Math.max(
        controls.minPolarAngle + 0.01,
        finite(
          cameraSettings.maxPolarAngle,
          Math.PI - 0.04,
          1.01,
          Math.PI - 0.001
        )
      );

      constrainOrbit();
      controls.update();

      Engine.camera.updateMatrixWorld(true);
      controls.saveState();

      Engine.cameraHome = {
        position: Engine.camera.position.clone(),
        quaternion: Engine.camera.quaternion.clone(),
        target: controls.target.clone()
      };

      if (settings.postProcessing) {
        try {
          createComposer();
        } catch (error) {
          disablePostProcessing(error);
        }
      }

      listen(
        canvas,
        "webglcontextlost",
        handleContextLost,
        false
      );

      listen(
        canvas,
        "webglcontextrestored",
        handleContextRestored,
        false
      );

      listen(window, "resize", function () {
        resizePending = true;
      }, { passive: true });

      if (window.visualViewport) {
        listen(window.visualViewport, "resize", function () {
          resizePending = true;
        }, { passive: true });
      }

      listen(
        document,
        "visibilitychange",
        handleVisibility,
        false
      );

      listen(window, "pagehide", function () {
        state.pageHidden = true;
        handleVisibility();
      }, false);

      listen(window, "pageshow", function () {
        state.pageHidden = false;
        handleVisibility();
      }, false);

      if (typeof window.ResizeObserver === "function") {
        resizeObserver = new window.ResizeObserver(function () {
          resizePending = true;
        });

        resizeObserver.observe(container);
      }

      state.initialized = true;

      state.postProcessingActive = Boolean(
        settings.postProcessing &&
        Engine.composer &&
        !state.postProcessingFailed
      );

      resizeViewport();
      Engine.start();
      updateStatus();

      emit("ready", {
        engine: Engine
      });
    } catch (error) {
      fatal(
        initializationCode,
        "The global network graphics runtime could not initialize.",
        error
      );
    }
  }

  Engine.initialize = initialize;

  if (document.readyState === "loading") {
    listen(
      document,
      "DOMContentLoaded",
      initialize,
      { once: true }
    );
  } else {
    initialize();
  }
}());
