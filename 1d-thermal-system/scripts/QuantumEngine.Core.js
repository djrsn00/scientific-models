(function () {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  if (window.QuantumEngine.Core) {
    return;
  }

  let scene = null;
  let camera = null;
  let renderer = null;
  let clock = null;
  let container = null;
  let initialized = false;
  let animationFrameId = null;

  const updateCallbacks = [];

  function getScene() {
    return scene;
  }

  function getCamera() {
    return camera;
  }

  function getRenderer() {
    return renderer;
  }

  // Each registration is independent, even when the same function is reused.
  // The returned function unregisters only that registration.
  function registerUpdateCallback(fn) {
    if (typeof fn !== "function") {
      throw new TypeError(
        "[QuantumEngine.Core] Update callbacks must be functions."
      );
    }

    let active = true;

    function callback(deltaTime) {
      if (active) {
        fn(deltaTime);
      }
    }

    function unregister() {
      if (!active) {
        return;
      }

      active = false;

      const index = updateCallbacks.indexOf(callback);

      if (index !== -1) {
        updateCallbacks.splice(index, 1);
      }
    }

    callback.unregister = unregister;
    updateCallbacks.push(callback);

    return unregister;
  }

  function setStatus(message, state) {
    const status = document.getElementById("engine-status");

    if (status) {
      status.textContent = message;
    }

    if (document.body) {
      document.body.dataset.engineState = state;
    }
  }

  function showError(message, error) {
    console.error("[QuantumEngine.Core] " + message, error);

    const notice = document.getElementById("render-error-notice");
    const description = document.getElementById("render-error-message");
    const details = document.getElementById("render-error-details");

    if (description) {
      description.textContent = message;
    }

    if (details) {
      details.textContent = error && error.message
        ? error.message
        : String(error);
    }

    if (notice) {
      notice.hidden = false;
    }

    setStatus("Graphics runtime unavailable", "error");
  }

  function resize() {
    if (!renderer || !camera || !container) {
      return;
    }

    const width = Math.max(1, container.clientWidth || window.innerWidth || 1);
    const height = Math.max(1, container.clientHeight || window.innerHeight || 1);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(width, height, false);
  }

  function resetClock() {
    if (clock) {
      clock.start();
    }
  }

  function animate() {
    animationFrameId = null;

    try {
      if (!document.hidden) {
        const deltaTime = clock.getDelta();

        // Additions take effect next frame; removals take effect immediately.
        const callbacks = updateCallbacks.slice();

        for (let index = 0; index < callbacks.length; index += 1) {
          const callback = callbacks[index];

          try {
            callback(deltaTime);
          } catch (error) {
            callback.unregister();
            console.error(
              "[QuantumEngine.Core] An update callback failed and was removed.",
              error
            );
          }
        }

        renderer.render(scene, camera);
      }

      animationFrameId = window.requestAnimationFrame(animate);
    } catch (error) {
      showError("The graphics render loop stopped.", error);
    }
  }

  function init() {
    if (initialized) {
      return window.QuantumEngine.Core;
    }

    try {
      const THREE = window.THREE;

      if (!THREE || typeof THREE.WebGLRenderer !== "function") {
        throw new Error(
          "Three.js is unavailable. Check the Three.js CDN script and reload."
        );
      }

      container = document.getElementById("canvas-container");

      if (!container) {
        throw new Error('The required element "#canvas-container" was not found.');
      }

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);

      camera = new THREE.PerspectiveCamera(60, 1, 0.1, 5000);
      camera.position.set(0, 0, 100);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance"
      });

      renderer.setClearColor(0x000000, 1);
      renderer.domElement.setAttribute(
        "aria-label",
        "One-dimensional quantum wavefunction and particle exhibits"
      );

      resize();
      container.appendChild(renderer.domElement);

      clock = new THREE.Clock();
      clock.start();

      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", resetClock);

      const notice = document.getElementById("render-error-notice");

      if (notice) {
        notice.hidden = true;
      }

      setStatus("Graphics runtime online", "core-ready");

      animationFrameId = window.requestAnimationFrame(animate);
      initialized = true;

      return window.QuantumEngine.Core;
    } catch (error) {
      if (animationFrameId !== null) {
        window.cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }

      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", resetClock);

      if (renderer) {
        renderer.domElement.remove();
        renderer.dispose();
      }

      scene = null;
      camera = null;
      renderer = null;
      clock = null;
      container = null;
      initialized = false;

      showError("The graphics engine could not initialize.", error);
      return null;
    }
  }

  window.QuantumEngine.Core = {
    init,
    getScene,
    getCamera,
    getRenderer,
    registerUpdateCallback
  };

  // Deferred scripts run after parsing, making the core available to later modules.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}());