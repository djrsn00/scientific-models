/*
 * QuantumEngine.Core.js
 *
 * Primary API:
 *   init(), getScene(), getCamera(), getRenderer(),
 *   registerUpdateCallback(callback, options)
 *
 * start() and dispose() are required lifecycle hooks used by the accepted
 * index.html. init() prepares resources and initializes registered modules;
 * start() begins the single animation loop.
 *
 * Subsystem initialization order:
 *   Manifold -> TopologicalFlux -> CRTCompositor -> Cinematography -> Telemetry
 *
 * Each subsystem receives the same frozen context from init(context).
 * Subsystems own their resources, honor context.signal after asynchronous
 * work, and dispose only themselves. They must not await Core.dispose()
 * from inside their own init() or dispose().
 *
 * Custom scene shaders must include Three.js logarithmic-depth chunks:
 *   logdepthbuf_pars_vertex, logdepthbuf_vertex,
 *   logdepthbuf_pars_fragment, logdepthbuf_fragment.
 * This is required by the 0.001-to-50000 camera range used here.
 */
(function quantumEngineCoreModule(window) {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  const engine = window.QuantumEngine;
  const document = window.document;

  if (typeof engine !== "object" || engine === null) {
    throw new TypeError("window.QuantumEngine must be an object.");
  }

  if (engine.Core !== undefined) {
    throw new Error("QuantumEngine.Core has already been registered.");
  }

  const MODULE_ORDER = Object.freeze([
    "Manifold",
    "TopologicalFlux",
    "CRTCompositor",
    "Cinematography",
    "Telemetry"
  ]);

  const CAMERA_FOV = 55;
  const CAMERA_NEAR = 0.001;
  const CAMERA_FAR = 50000;
  const MAX_DELTA_TIME = 0.05;

  let state = "idle";
  let THREE = null;
  let scene = null;
  let camera = null;
  let renderer = null;
  let canvas = null;
  let context = null;
  let abortController = null;
  let initializationPromise = null;
  let disposalPromise = null;
  let pendingModuleInitialization = null;
  let fatalError = null;

  let animationFrameId = null;
  let previousTime = null;
  let resizePending = true;
  let pageSuspended = false;
  let paused = false;
  let callbackSequence = 0;
  let updateCallbacks = [];
  let resizeCallbacks = [];
  let renderCallback = null;

  const initializedModules = [];
  const listeners = [];

  const viewportState = {
    width: 0,
    height: 0,
    pixelRatio: 1,
    bufferWidth: 0,
    bufferHeight: 0
  };

  const clockState = {
    frame: 0,
    deltaTime: 0,
    rawDeltaTime: 0,
    elapsedTime: 0,
    activeTime: 0,
    timestamp: 0
  };

  const viewport = Object.freeze({
    get width() {
      return viewportState.width;
    },
    get height() {
      return viewportState.height;
    },
    get pixelRatio() {
      return viewportState.pixelRatio;
    },
    get bufferWidth() {
      return viewportState.bufferWidth;
    },
    get bufferHeight() {
      return viewportState.bufferHeight;
    }
  });

  const clock = Object.freeze({
    get frame() {
      return clockState.frame;
    },
    get deltaTime() {
      return clockState.deltaTime;
    },
    get rawDeltaTime() {
      return clockState.rawDeltaTime;
    },
    get elapsedTime() {
      return clockState.elapsedTime;
    },
    get activeTime() {
      return clockState.activeTime;
    },
    get timestamp() {
      return clockState.timestamp;
    },
    get paused() {
      return paused;
    }
  });

  function asError(reason, message) {
    const error = reason instanceof Error
      ? reason
      : new Error(String(reason));

    return message ? new Error(message, { cause: error }) : error;
  }

  function cancellationError() {
    return new window.DOMException(
      "QuantumEngine initialization was cancelled.",
      "AbortError"
    );
  }

  function assertUsable() {
    if (
      state === "disposing" ||
      state === "disposed" ||
      state === "failed"
    ) {
      throw new Error("QuantumEngine.Core is " + state + ".");
    }
  }

  function assertInitializationActive() {
    if (
      !abortController ||
      abortController.signal.aborted ||
      state !== "initializing"
    ) {
      throw cancellationError();
    }
  }

  function addListener(target, type, callback, options) {
    target.addEventListener(type, callback, options);
    listeners.push({ target, type, callback, options });
  }

  function stopFrameScheduling() {
    if (animationFrameId !== null) {
      window.cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }

    previousTime = null;
  }

  function scheduleFrame() {
    if (
      state === "running" &&
      !document.hidden &&
      !pageSuspended &&
      animationFrameId === null
    ) {
      animationFrameId = window.requestAnimationFrame(renderFrame);
    }
  }

  function requireSynchronous(result, label) {
    if (result && typeof result.then === "function") {
      Promise.resolve(result).catch(function (error) {
        console.error(
          "[QuantumEngine] Asynchronous callback rejected:",
          error
        );
      });

      throw new TypeError(label + " must be synchronous.");
    }
  }

  /**
   * Registers callback(deltaTime, elapsedTime, frame).
   *
   * options.priority: finite number; lower priorities run first.
   * options.phase: "update" (default) or "afterRender".
   * options.label: name included in runtime error messages.
   *
   * deltaTime and elapsedTime are simulation seconds. deltaTime is zero while
   * paused and capped at 0.05 seconds after a slow frame. frame.rawDeltaTime
   * preserves the measured interval for telemetry and manual camera damping.
   *
   * Additions take effect on the next frame. Unsubscription takes effect
   * immediately. The returned unsubscribe function is idempotent.
   */
  function registerUpdateCallback(callback, options) {
    assertUsable();

    if (typeof callback !== "function") {
      throw new TypeError("registerUpdateCallback requires a function.");
    }

    const settings = options === undefined ? {} : options;

    if (!settings || typeof settings !== "object") {
      throw new TypeError("Update callback options must be an object.");
    }

    const priority = settings.priority === undefined
      ? 0
      : settings.priority;

    const phase = settings.phase === undefined
      ? "update"
      : settings.phase;

    if (!Number.isFinite(priority)) {
      throw new TypeError(
        "Update callback priority must be a finite number."
      );
    }

    if (phase !== "update" && phase !== "afterRender") {
      throw new TypeError(
        'Update callback phase must be "update" or "afterRender".'
      );
    }

    const record = {
      callback,
      priority,
      phase,
      sequence: callbackSequence++,
      label: String(
        settings.label || callback.name || "anonymous update"
      ),
      active: true
    };

    updateCallbacks = updateCallbacks
      .concat(record)
      .sort(function (a, b) {
        return a.priority - b.priority || a.sequence - b.sequence;
      });

    return function unsubscribeUpdate() {
      if (!record.active) return;

      record.active = false;

      updateCallbacks = updateCallbacks.filter(function (entry) {
        return entry !== record;
      });
    };
  }

  /**
   * Context-only resize subscription: callback(viewport).
   *
   * The live, read-only viewport uses CSS pixels for width/height and physical
   * pixels for bufferWidth/bufferHeight. Notification is immediate by default.
   */
  function registerResizeCallback(callback, immediate) {
    assertUsable();

    if (typeof callback !== "function") {
      throw new TypeError("registerResizeCallback requires a function.");
    }

    if (immediate !== undefined && typeof immediate !== "boolean") {
      throw new TypeError(
        "The immediate resize option must be a boolean."
      );
    }

    const record = {
      callback,
      active: true
    };

    resizeCallbacks = resizeCallbacks.concat(record);

    function unsubscribeResize() {
      if (!record.active) return;

      record.active = false;

      resizeCallbacks = resizeCallbacks.filter(function (entry) {
        return entry !== record;
      });
    }

    if (immediate !== false && viewportState.width > 0) {
      try {
        requireSynchronous(
          callback(viewport),
          "Resize callback"
        );
      } catch (error) {
        unsubscribeResize();
        throw error;
      }
    }

    return unsubscribeResize;
  }

  /**
   * Installs one replacement for the default render operation.
   *
   * The callback receives (deltaTime, elapsedTime, frame).
   * Ownership stays with Core's RAF loop; the returned function releases it.
   */
  function setRenderCallback(callback) {
    assertUsable();

    if (typeof callback !== "function") {
      throw new TypeError("setRenderCallback requires a function.");
    }

    if (renderCallback !== null) {
      throw new Error("A render callback is already installed.");
    }

    const record = {
      callback,
      active: true
    };

    renderCallback = record;

    return function releaseRenderCallback() {
      record.active = false;

      if (renderCallback === record) {
        renderCallback = null;
      }
    };
  }

  function setPaused(value) {
    assertUsable();

    if (typeof value !== "boolean") {
      throw new TypeError("setPaused requires a boolean.");
    }

    paused = value;
    previousTime = window.performance.now();

    if (paused) {
      clockState.deltaTime = 0;
    }

    return paused;
  }

  function resetTime() {
    assertUsable();

    clockState.elapsedTime = 0;
    clockState.deltaTime = 0;
    clockState.rawDeltaTime = 0;
    previousTime = window.performance.now();
  }

  function resizeRenderer() {
    if (!renderer || !camera) return;

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio, 2);

    const sizeChanged =
      width !== viewportState.width ||
      height !== viewportState.height;

    const ratioChanged =
      pixelRatio !== viewportState.pixelRatio;

    resizePending = false;

    if (!sizeChanged && !ratioChanged) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (ratioChanged || viewportState.width === 0) {
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }

    if (sizeChanged) {
      renderer.setSize(width, height, false);
    }

    const gl = renderer.getContext();

    viewportState.width = width;
    viewportState.height = height;
    viewportState.pixelRatio = pixelRatio;
    viewportState.bufferWidth = gl.drawingBufferWidth;
    viewportState.bufferHeight = gl.drawingBufferHeight;

    const scheduled = resizeCallbacks;

    for (let index = 0; index < scheduled.length; index += 1) {
      if (
        state === "disposing" ||
        state === "disposed" ||
        state === "failed"
      ) {
        break;
      }

      const record = scheduled[index];

      if (record.active) {
        requireSynchronous(
          record.callback(viewport),
          "Resize callback"
        );
      }
    }
  }

  function onWindowResize() {
    resizePending = true;

    if (
      state === "initializing" ||
      state === "ready" ||
      (
        state === "running" &&
        (document.hidden || pageSuspended)
      )
    ) {
      try {
        resizeRenderer();
      } catch (error) {
        reportFatalError(
          asError(error, "Renderer resize failed.")
        );
      }
    }
  }

  function onVisibilityChange() {
    if (document.hidden) {
      stopFrameScheduling();
      return;
    }

    resizePending = true;
    previousTime = window.performance.now();
    scheduleFrame();
  }

  function onPageHide(event) {
    pageSuspended = true;
    stopFrameScheduling();

    if (!event.persisted) {
      dispose().catch(function (error) {
        console.error(
          "[QuantumEngine] Page shutdown failed:",
          error
        );
      });
    }
  }

  function onPageShow() {
    pageSuspended = false;
    resizePending = true;
    previousTime = window.performance.now();
    scheduleFrame();
  }

  function onContextLost(event) {
    event.preventDefault();

    reportFatalError(new Error(
      "The WebGL context was lost. Reload the engine to rebuild its graphics resources."
    ));
  }

  function reportFatalError(reason) {
    if (
      fatalError ||
      state === "disposing" ||
      state === "disposed"
    ) {
      return;
    }

    fatalError = asError(reason);
    state = "failed";
    stopFrameScheduling();

    const shutdown = dispose();

    shutdown.catch(function (error) {
      console.error(
        "[QuantumEngine] Resource cleanup failed:",
        error
      );
    });

    if (engine.Boot && typeof engine.Boot.fail === "function") {
      try {
        Promise.resolve(engine.Boot.fail(fatalError))
          .catch(function (error) {
            console.error(
              "[QuantumEngine] Error display failed:",
              error
            );
          });
      } catch (error) {
        console.error(
          "[QuantumEngine] Error display failed:",
          error
        );
      }
    } else {
      console.error("[QuantumEngine]", fatalError);
    }
  }

  function runCallbacks(scheduled, phase, deltaTime, elapsedTime) {
    for (let index = 0; index < scheduled.length; index += 1) {
      if (state !== "running") return;

      const record = scheduled[index];

      if (!record.active || record.phase !== phase) {
        continue;
      }

      try {
        requireSynchronous(
          record.callback(deltaTime, elapsedTime, clock),
          record.label
        );
      } catch (error) {
        throw asError(
          error,
          'QuantumEngine callback "' +
            record.label +
            '" failed: ' +
            asError(error).message
        );
      }
    }
  }

  function renderFrame() {
    animationFrameId = null;

    if (state !== "running") return;

    if (document.hidden || pageSuspended) {
      previousTime = null;
      return;
    }

    const now = window.performance.now();

    const rawDeltaTime = previousTime === null
      ? 0
      : Math.max(0, (now - previousTime) / 1000);

    previousTime = now;

    const deltaTime = paused
      ? 0
      : Math.min(rawDeltaTime, MAX_DELTA_TIME);

    clockState.frame += 1;
    clockState.timestamp = now;
    clockState.rawDeltaTime = rawDeltaTime;
    clockState.deltaTime = deltaTime;
    clockState.elapsedTime += deltaTime;
    clockState.activeTime += rawDeltaTime;

    // Subscription changes replace the array; frames do not allocate copies.
    const scheduled = updateCallbacks;
    const elapsedTime = clockState.elapsedTime;

    try {
      // DPR can change when moving the window between different displays.
      if (
        resizePending ||
        viewportState.width !== Math.max(1, window.innerWidth) ||
        viewportState.height !== Math.max(1, window.innerHeight) ||
        viewportState.pixelRatio !== Math.min(window.devicePixelRatio, 2)
      ) {
        resizeRenderer();
      }

      if (state !== "running") return;

      // Count the complete frame, including future offscreen render passes.
      renderer.info.reset();

      runCallbacks(
        scheduled,
        "update",
        deltaTime,
        elapsedTime
      );

      if (state !== "running") return;

      if (renderCallback && renderCallback.active) {
        requireSynchronous(
          renderCallback.callback(
            deltaTime,
            elapsedTime,
            clock
          ),
          "Render callback"
        );
      } else {
        renderer.render(scene, camera);
      }

      if (state !== "running") return;

      runCallbacks(
        scheduled,
        "afterRender",
        deltaTime,
        elapsedTime
      );
    } catch (error) {
      reportFatalError(error);
      return;
    }

    scheduleFrame();
  }

  function createCapabilities() {
    const gl = renderer.getContext();
    const attributes = gl.getContextAttributes();

    if (!attributes || gl.isContextLost()) {
      throw new Error("The WebGL context is unavailable.");
    }

    return Object.freeze({
      webglVersion: 2,
      renderer: String(
        gl.getParameter(gl.RENDERER) || "Unavailable"
      ),
      antialias: attributes.antialias === true,
      precision: renderer.capabilities.precision,
      logarithmicDepthBuffer:
        renderer.capabilities.logarithmicDepthBuffer,
      maxTextureSize: renderer.capabilities.maxTextureSize,
      maxSamples: renderer.capabilities.maxSamples,
      floatRenderTargets:
        renderer.extensions.has("EXT_color_buffer_float")
    });
  }

  function createContext(capabilities) {
    return Object.freeze({
      THREE,
      dependencies: engine.Dependencies,
      dom: engine.DOM || null,
      canvas,
      scene,
      camera,
      renderer,
      signal: abortController.signal,
      capabilities,
      viewport,
      clock,
      registerUpdateCallback,
      registerResizeCallback,
      setRenderCallback,
      setPaused,
      resetTime,
      get state() {
        return state;
      },
      get paused() {
        return paused;
      }
    });
  }

  async function initializeEngine() {
    let phase = "dependencies";

    try {
      assertInitializationActive();

      THREE = engine.Dependencies && engine.Dependencies.THREE;

      if (
        !THREE ||
        typeof THREE.WebGLRenderer !== "function" ||
        typeof THREE.Scene !== "function" ||
        typeof THREE.PerspectiveCamera !== "function"
      ) {
        throw new Error(
          "Load the Three.js dependency through index.html before Core.init()."
        );
      }

      const modules = MODULE_ORDER.map(function (name) {
        const api = engine[name];

        if (
          !api ||
          typeof api.init !== "function" ||
          typeof api.dispose !== "function"
        ) {
          throw new Error(
            "QuantumEngine." + name + " must expose init() and dispose()."
          );
        }

        return { name, api };
      });

      phase = "canvas";

      canvas = (
        engine.DOM && engine.DOM["qe-canvas"]
      ) || document.getElementById("qe-canvas");

      if (
        !canvas ||
        canvas.nodeName !== "CANVAS" ||
        typeof canvas.getContext !== "function"
      ) {
        throw new Error(
          'The required canvas element "#qe-canvas" is missing.'
        );
      }

      phase = "renderer";

      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        powerPreference: "high-performance",
        alpha: false,
        depth: true,
        stencil: false,
        precision: "highp",
        logarithmicDepthBuffer: true,
        preserveDrawingBuffer: false
      });

      if (renderer.capabilities.precision !== "highp") {
        throw new Error(
          "High-precision vertex and fragment shaders are required."
        );
      }

      renderer.setClearColor(0x000000, 1);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.autoClear = true;
      renderer.info.autoReset = false;
      renderer.debug.checkShaderErrors = true;

      renderer.debug.onShaderError = function (
        gl,
        program,
        vertexShader,
        fragmentShader
      ) {
        const diagnostics = [
          gl.getProgramInfoLog(program),
          gl.getShaderInfoLog(vertexShader),
          gl.getShaderInfoLog(fragmentShader)
        ].filter(Boolean).join("\n");

        throw new Error(
          "Shader compilation or linking failed.\n" + diagnostics
        );
      };

      phase = "scene and camera";

      scene = new THREE.Scene();
      scene.name = "QuantumEngine.Scene";
      scene.background = new THREE.Color(0x000000);

      camera = new THREE.PerspectiveCamera(
        CAMERA_FOV,
        Math.max(1, window.innerWidth) /
          Math.max(1, window.innerHeight),
        CAMERA_NEAR,
        CAMERA_FAR
      );

      camera.name = "QuantumEngine.Camera";
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld(true);

      resizeRenderer();

      const capabilities = createCapabilities();
      context = createContext(capabilities);

      addListener(
        window,
        "resize",
        onWindowResize,
        { passive: true }
      );

      addListener(
        document,
        "visibilitychange",
        onVisibilityChange
      );

      addListener(window, "pagehide", onPageHide);
      addListener(window, "pageshow", onPageShow);
      addListener(canvas, "webglcontextlost", onContextLost);

      for (let index = 0; index < modules.length; index += 1) {
        assertInitializationActive();

        const module = modules[index];
        phase = "QuantumEngine." + module.name;

        // Include partially initialized modules in reverse-order cleanup.
        initializedModules.push(module);

        const pending = Promise.resolve().then(function () {
          assertInitializationActive();
          return module.api.init(context);
        });

        pendingModuleInitialization = pending;

        try {
          await pending;
        } finally {
          if (pendingModuleInitialization === pending) {
            pendingModuleInitialization = null;
          }
        }

        assertInitializationActive();
      }

      // A resize may have happened while a subsystem was awaiting GPU work.
      resizeRenderer();
      assertInitializationActive();

      state = "ready";
      return context;
    } catch (reason) {
      const error = reason && reason.name === "AbortError"
        ? reason
        : asError(
          reason,
          "QuantumEngine.Core.init failed during " +
            phase +
            ": " +
            asError(reason).message
        );

      try {
        await dispose();
      } catch (cleanupError) {
        console.error(
          "[QuantumEngine] Initialization cleanup failed:",
          cleanupError
        );
      }

      throw error;
    }
  }

  /**
   * Resolves with the shared context after all registered subsystems initialize.
   * Repeated calls during initialization or normal operation share one promise.
   * Disposal is terminal; reload the document to create a fresh engine.
   */
  function init() {
    assertUsable();

    if (initializationPromise) {
      return initializationPromise;
    }

    state = "initializing";
    abortController = new window.AbortController();
    initializationPromise = initializeEngine();

    return initializationPromise;
  }

  function start() {
    if (state === "running") {
      return context;
    }

    if (state !== "ready") {
      throw new Error(
        "Core.start() requires a successfully completed Core.init()."
      );
    }

    state = "running";
    resizePending = true;
    previousTime = window.performance.now();

    scheduleFrame();

    return context;
  }

  /**
   * Cancels work immediately, then tears down modules in reverse order.
   *
   * Waiting for the in-flight module promise is safe: dispose never waits for
   * initializationPromise, whose failure handler itself awaits this cleanup.
   */
  function dispose() {
    if (disposalPromise) {
      return disposalPromise;
    }

    let resolveDisposal;
    let rejectDisposal;

    disposalPromise = new Promise(function (resolve, reject) {
      resolveDisposal = resolve;
      rejectDisposal = reject;
    });

    state = "disposing";
    stopFrameScheduling();

    const pending = pendingModuleInitialization;
    const errors = [];

    updateCallbacks.forEach(function (record) {
      record.active = false;
    });

    resizeCallbacks.forEach(function (record) {
      record.active = false;
    });

    if (renderCallback) {
      renderCallback.active = false;
    }

    updateCallbacks = [];
    resizeCallbacks = [];
    renderCallback = null;

    while (listeners.length > 0) {
      const listener = listeners.pop();

      try {
        listener.target.removeEventListener(
          listener.type,
          listener.callback,
          listener.options
        );
      } catch (error) {
        errors.push(asError(error));
      }
    }

    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }

    Promise.resolve()
      .then(async function releaseResources() {
        if (pending) {
          try {
            await pending;
          } catch (error) {
            // Startup reports this error; cleanup owns the partial module.
            if (error && error.name !== "AbortError") {
              console.debug(
                "[QuantumEngine] Pending initialization ended:",
                error
              );
            }
          }
        }

        for (
          let index = initializedModules.length - 1;
          index >= 0;
          index -= 1
        ) {
          const module = initializedModules[index];

          try {
            await module.api.dispose();
          } catch (error) {
            errors.push(asError(
              error,
              "QuantumEngine." + module.name + ".dispose() failed."
            ));
          }
        }

        initializedModules.length = 0;

        if (scene) {
          try {
            scene.clear();
          } catch (error) {
            errors.push(asError(error));
          }
        }

        if (renderer) {
          try {
            renderer.dispose();
          } catch (error) {
            errors.push(asError(error));
          }

          try {
            renderer.forceContextLoss();
          } catch (error) {
            errors.push(asError(error));
          }
        }

        context = null;
        canvas = null;
        scene = null;
        camera = null;
        renderer = null;
        THREE = null;
        pendingModuleInitialization = null;
        state = "disposed";

        if (errors.length > 0) {
          throw new AggregateError(
            errors,
            "QuantumEngine cleanup encountered errors."
          );
        }
      })
      .then(resolveDisposal, rejectDisposal);

    return disposalPromise;
  }

  function getScene() {
    return scene;
  }

  function getCamera() {
    return camera;
  }

  function getRenderer() {
    return renderer;
  }

  engine.Core = Object.freeze({
    init,
    getScene,
    getCamera,
    getRenderer,
    registerUpdateCallback,
    start,
    dispose
  });
})(window);