(function installNetworkRuntime(global) {
  "use strict";

  const document = global.document;
  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.MasterOrchestrator";

  const MODULES = [
    ["EarthCore", "earth-core.js"],
    ["CableMatrix", "cable-matrix.js"],
    ["PacketPipeline", "packet-pipeline.js"],
    ["SatelliteOrbit", "satellite-orbit.js"],
    ["ChromaMatrixPass", "chroma-matrix-pass.js"],
    ["TerminalStream", "terminal-stream.js"],
    ["InteractionController", "interaction-controller.js"]
  ];

  const LOG_LIMIT = 64;
  const INIT_TIMEOUT = 15000;

  const COLORS = {
    INFO: "#00ff66",
    WARN: "#ffd000",
    ERROR: "#ff4466"
  };

  if (
    engine.Runtime &&
    engine.Runtime.moduleId === MODULE_ID
  ) {
    return;
  }

  let state = "idle";
  let stage = "Preflight";
  let bootPromise = null;
  let rebootPromise = null;
  let cleanupPromise = null;
  let bootedAt = null;
  let lastError = null;
  let generation = 0;
  let blocked = true;
  let logTimer = null;
  let hardwareTimer = null;
  let boundaryInstalled = false;
  let previousOnError = null;
  let hookBoundary = null;
  let launchWave = null;
  let noticeHost = null;
  let hardware = null;

  const logQueue = [];
  const recentErrors = new Map();
  const hookRecords = new Map();

  function time() {
    return global.performance
      ? global.performance.now()
      : Date.now();
  }

  function text(value, fallback = "") {
    if (value === null || value === undefined) {
      return fallback;
    }

    try {
      return String(value)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .slice(0, 1800);
    } catch (error) {
      return fallback;
    }
  }

  function errorMessage(error) {
    if (error && typeof error.message === "string") {
      return text(error.message);
    }

    if (typeof error === "string") {
      return text(error);
    }

    try {
      return text(
        JSON.stringify(error),
        "Unknown runtime error"
      );
    } catch (ignored) {
      return "An error was raised with an unreadable reason.";
    }
  }

  function report(message, tag = "SYSTEM", level = "INFO") {
    if (logQueue.length >= LOG_LIMIT) {
      logQueue.shift();
    }

    logQueue.push({
      message: text(message),
      tag: text(tag),
      color: COLORS[level] || COLORS.INFO,
      timestamp: Date.now()
    });
  }

  function reportError(error, location = "Runtime") {
    const message = location + ": " + errorMessage(error);
    const previous = recentErrors.get(message);
    const current = time();

    if (
      previous !== undefined &&
      current - previous < 2000
    ) {
      return;
    }

    if (recentErrors.size >= 64) {
      recentErrors.delete(
        recentErrors.keys().next().value
      );
    }

    recentErrors.set(message, current);
    report(message, "RUNTIME_ERROR", "ERROR");
  }

  function flushLogs() {
    if (
      !document ||
      !document.body ||
      logQueue.length === 0
    ) {
      return;
    }

    const terminal = engine.TerminalStream;
    let container = null;
    let follow = false;
    let fragment = null;
    let added = 0;

    for (
      let i = 0;
      i < 8 && logQueue.length;
      i += 1
    ) {
      const entry = logQueue[0];
      let accepted = false;

      if (
        terminal &&
        typeof terminal.enqueue === "function"
      ) {
        try {
          accepted =
            terminal.enqueue(
              entry.message,
              entry.tag,
              entry.color
            ) !== false;
        } catch (ignored) {
          accepted = false;
        }
      }

      if (accepted) {
        logQueue.shift();
        continue;
      }

      if (!container) {
        container = document.getElementById("terminal-body");

        if (!container) {
          break;
        }

        follow =
          container.scrollHeight -
          container.scrollTop -
          container.clientHeight <=
          28;

        fragment = document.createDocumentFragment();
      }

      const line = document.createElement("div");

      line.className = "terminal-line runtime-log";
      line.style.color = entry.color;
      line.style.fontFamily = "'Courier New', monospace";
      line.style.whiteSpace = "pre-wrap";
      line.style.overflowWrap = "anywhere";

      line.textContent =
        "[" +
        new Date(entry.timestamp)
          .toISOString()
          .slice(11, 23) +
        "] [" +
        entry.tag +
        "] " +
        entry.message;

      fragment.appendChild(line);
      logQueue.shift();
      added += 1;
    }

    if (container && added) {
      while (
        container.children.length + added > 50 &&
        container.firstElementChild
      ) {
        container.removeChild(container.firstElementChild);
      }

      container.appendChild(fragment);

      if (follow) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }

  function onWindowError(
    message,
    source,
    line,
    column,
    error
  ) {
    reportError(
      error || message,
      source
        ? text(source) +
            ":" +
            (line || 0) +
            ":" +
            (column || 0)
        : "Window"
    );

    if (typeof previousOnError === "function") {
      try {
        return (
          previousOnError.apply(global, arguments) === true
        );
      } catch (previousError) {
        reportError(
          previousError,
          "Previous window.onerror handler"
        );
      }
    }

    return false;
  }

  function onRejection(event) {
    reportError(
      event.reason,
      "Unhandled promise rejection"
    );
  }

  function onResourceError(event) {
    const target = event.target;

    if (!target || target === global) {
      return;
    }

    if (
      target.tagName === "SCRIPT" ||
      target.tagName === "LINK"
    ) {
      reportError(
        "Failed to load " + text(target.src || target.href),
        "Dependency loader"
      );
    }
  }

  function installBoundary() {
    if (boundaryInstalled) {
      return;
    }

    previousOnError = global.onerror;
    global.onerror = onWindowError;

    global.addEventListener(
      "unhandledrejection",
      onRejection
    );

    global.addEventListener(
      "error",
      onResourceError,
      true
    );

    boundaryInstalled = true;
    logTimer = global.setInterval(flushLogs, 100);
  }

  function removeBoundary() {
    if (!boundaryInstalled) {
      return;
    }

    if (global.onerror === onWindowError) {
      global.onerror = previousOnError;
    }

    global.removeEventListener(
      "unhandledrejection",
      onRejection
    );

    global.removeEventListener(
      "error",
      onResourceError,
      true
    );

    if (logTimer !== null) {
      global.clearInterval(logTimer);
    }

    logTimer = null;
    boundaryInstalled = false;
  }

  function showNotice(message) {
    if (!document || !document.body) {
      return;
    }

    let notice = document.getElementById(
      "render-error-notice"
    );

    if (!notice) {
      notice = document.createElement("div");
      notice.id = "render-error-notice";
      document.body.appendChild(notice);
    }

    notice.textContent = message;
    notice.setAttribute("role", "alert");
    notice.hidden = false;
    notice.style.display = "block";
    notice.style.whiteSpace = "pre-wrap";
    notice.style.overflowWrap = "anywhere";

    noticeHost =
      notice.closest(
        "dialog, [role='dialog'], .error-modal"
      ) || notice;

    if (noticeHost === notice) {
      Object.assign(notice.style, {
        position: "fixed",
        inset:
          "max(16px, env(safe-area-inset-top)) 16px 16px",
        zIndex: "2147483647",
        boxSizing: "border-box",
        overflow: "auto",
        padding: "24px",
        background: "rgba(2,5,3,0.98)",
        color: "#ff637c",
        border: "1px solid #ff003c",
        font: "14px/1.7 'Courier New', monospace"
      });
    }

    for (
      let node = notice;
      node && node !== document.body;
      node = node.parentElement
    ) {
      node.hidden = false;
      node.inert = false;
      node.classList.remove(
        "hidden",
        "is-hidden",
        "d-none"
      );
      node.setAttribute("aria-hidden", "false");
      node.style.visibility = "visible";
      node.style.opacity = "1";
      node.style.pointerEvents = "auto";

      if (
        global.getComputedStyle(node).display === "none"
      ) {
        node.style.display = "block";
      }
    }

    if (
      typeof noticeHost.showModal === "function" &&
      !noticeHost.open
    ) {
      try {
        noticeHost.showModal();
      } catch (ignored) {
        noticeHost.setAttribute("open", "");
      }
    }

    notice.tabIndex = -1;
    notice.focus({ preventScroll: true });
  }

  function hideNotice() {
    const notice = document.getElementById(
      "render-error-notice"
    );

    if (!notice) {
      return;
    }

    const host =
      noticeHost ||
      notice.closest(
        "dialog, [role='dialog'], .error-modal"
      ) ||
      notice;

    if (
      typeof host.close === "function" &&
      host.open
    ) {
      host.close();
    }

    host.hidden = true;
    host.style.display = "none";
    host.setAttribute("aria-hidden", "true");
  }

  function healthCheck() {
    const problems = [];
    const three = global.THREE;

    if (!three) {
      problems.push(
        "THREE — Three.js has not loaded."
      );
    }

    if (
      !three ||
      typeof three.OrbitControls !== "function"
    ) {
      problems.push(
        "THREE.OrbitControls — the OrbitControls plugin is missing."
      );
    }

    if (
      !three ||
      typeof three.EffectComposer !== "function"
    ) {
      problems.push(
        "THREE.EffectComposer — the EffectComposer plugin is missing."
      );
    }

    if (typeof engine.initialize !== "function") {
      problems.push(
        "NetworkEngine.initialize — scripts/engine-core.js is missing or failed to evaluate."
      );
    }

    const data = engine.DataContract;

    if (!data) {
      problems.push(
        "NetworkEngine.DataContract — scripts/network-data.js is missing or failed to evaluate."
      );
    } else {
      if (
        !data.constants ||
        !data.stations ||
        !data.routes ||
        !data.packetClasses
      ) {
        problems.push(
          "DataContract — constants, stations, routes and packetClasses are required."
        );
      }

      if (
        typeof data.latLonToVector3 !== "function"
      ) {
        problems.push(
          "DataContract.latLonToVector3 — the coordinate helper is missing."
        );
      }

      const stations = data.stations
        ? Object.values(data.stations)
        : [];

      const routes = data.routes
        ? Object.values(data.routes)
        : [];

      const stationIds = new Set();
      const routeIds = new Set();

      if (!stations.length) {
        problems.push(
          "DataContract.stations — the station registry is empty."
        );
      }

      if (!routes.length) {
        problems.push(
          "DataContract.routes — the route registry is empty."
        );
      }

      for (const station of stations) {
        if (
          !station ||
          typeof station.id !== "string" ||
          !station.id
        ) {
          problems.push(
            "DataContract.stations — a station has no valid id."
          );
          continue;
        }

        if (stationIds.has(station.id)) {
          problems.push(
            "DataContract.stations — duplicate id " +
              station.id +
              "."
          );
        }

        stationIds.add(station.id);

        if (
          !Number.isFinite(station.lat) ||
          Math.abs(station.lat) > 90 ||
          !Number.isFinite(station.lon) ||
          Math.abs(station.lon) > 180
        ) {
          problems.push(
            "DataContract.stations — invalid coordinates for " +
              station.id +
              "."
          );
        }
      }

      for (const route of routes) {
        if (
          !route ||
          typeof route.id !== "string" ||
          !route.id
        ) {
          problems.push(
            "DataContract.routes — a route has no valid id."
          );
          continue;
        }

        if (routeIds.has(route.id)) {
          problems.push(
            "DataContract.routes — duplicate id " +
              route.id +
              "."
          );
        }

        routeIds.add(route.id);

        if (
          !stationIds.has(route.source) ||
          !stationIds.has(route.target)
        ) {
          problems.push(
            "DataContract.routes — " +
              route.id +
              " references an unknown landing station."
          );
        }
      }

      for (const id of [
        "HTTP_PING",
        "BACKUP_PAYLOAD",
        "TLS_HANDSHAKE",
        "LEO_UPLINK"
      ]) {
        if (
          !data.packetClasses ||
          !data.packetClasses[id]
        ) {
          problems.push(
            "DataContract.packetClasses — missing " +
              id +
              "."
          );
        }
      }
    }

    for (const [name, file] of MODULES) {
      const module = engine[name];

      if (!module) {
        problems.push(
          "NetworkEngine." +
            name +
            " — scripts/" +
            file +
            " is missing or failed to evaluate."
        );
      } else if (
        typeof module.init !== "function"
      ) {
        problems.push(
          "NetworkEngine." +
            name +
            ".init — scripts/" +
            file +
            " has an incomplete API."
        );
      } else if (module.disposed === true) {
        problems.push(
          "NetworkEngine." +
            name +
            " was disposed. Use NetworkEngine.reboot() to reload it."
        );
      }
    }

    return Object.freeze({
      ok: problems.length === 0,
      problems: Object.freeze(problems)
    });
  }

  function installHookBoundary() {
    if (
      typeof engine.registerHook !== "function"
    ) {
      return;
    }

    if (
      hookBoundary &&
      engine.registerHook === hookBoundary.register
    ) {
      return;
    }

    restoreHookBoundary();

    const originalRegister = engine.registerHook;
    const originalUnregister = engine.unregisterHook;

    function register(callback) {
      if (typeof callback !== "function") {
        throw new TypeError(
          "Animation hooks must be functions."
        );
      }

      if (hookRecords.has(callback)) {
        return hookRecords.get(callback).unsubscribe;
      }

      const owner = stage;

      const record = {
        enabled: true,
        failures: 0,
        nativeRelease: null,
        safe: null,
        unsubscribe: null
      };

      record.safe = function guardedAnimationHook(
        delta,
        elapsed
      ) {
        if (!record.enabled || blocked) {
          return;
        }

        try {
          callback.call(this, delta, elapsed);
          record.failures = 0;
        } catch (error) {
          record.failures += 1;

          reportError(
            error,
            owner +
              " / " +
              (callback.name || "animation hook")
          );

          if (record.failures >= 3) {
            record.enabled = false;

            report(
              owner +
                " animation hook disabled after three consecutive failures.",
              "HOOK_ISOLATED",
              "WARN"
            );
          }
        }
      };

      record.unsubscribe = function unsubscribe() {
        if (!hookRecords.has(callback)) {
          return;
        }

        record.enabled = false;
        hookRecords.delete(callback);

        if (
          typeof record.nativeRelease === "function"
        ) {
          record.nativeRelease();
        } else if (
          typeof originalUnregister === "function"
        ) {
          originalUnregister.call(
            engine,
            record.safe
          );
        }
      };

      const result = originalRegister.call(
        engine,
        record.safe
      );

      if (
        typeof result === "function" &&
        result !== record.safe &&
        result !== callback
      ) {
        record.nativeRelease = result;
      }

      hookRecords.set(callback, record);
      return record.unsubscribe;
    }

    function unregister(callback) {
      const record = hookRecords.get(callback);

      if (record) {
        return record.unsubscribe();
      }

      if (
        typeof originalUnregister === "function"
      ) {
        return originalUnregister.call(
          engine,
          callback
        );
      }
    }

    engine.registerHook = register;
    engine.unregisterHook = unregister;

    hookBoundary = {
      originalRegister,
      originalUnregister,
      register,
      unregister
    };
  }

  function restoreHookBoundary() {
    for (
      const record of Array.from(hookRecords.values())
    ) {
      try {
        record.unsubscribe();
      } catch (error) {
        reportError(
          error,
          "Animation hook cleanup"
        );
      }
    }

    hookRecords.clear();

    if (!hookBoundary) {
      return;
    }

    if (
      engine.registerHook === hookBoundary.register
    ) {
      engine.registerHook =
        hookBoundary.originalRegister;
    }

    if (
      engine.unregisterHook === hookBoundary.unregister
    ) {
      if (
        hookBoundary.originalUnregister === undefined
      ) {
        delete engine.unregisterHook;
      } else {
        engine.unregisterHook =
          hookBoundary.originalUnregister;
      }
    }

    hookBoundary = null;
  }

  function withTimeout(value, milliseconds, label) {
    if (
      !value ||
      typeof value.then !== "function"
    ) {
      return Promise.resolve(value);
    }

    return new Promise((resolve, reject) => {
      const timer = global.setTimeout(() => {
        reject(
          new Error(
            label +
              " did not complete within " +
              milliseconds +
              " ms."
          )
        );
      }, milliseconds);

      Promise.resolve(value).then(
        result => {
          global.clearTimeout(timer);
          resolve(result);
        },
        error => {
          global.clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function validateInitialized(
    name,
    module,
    result
  ) {
    if (
      result === false ||
      module.initialized === false ||
      module.disposed === true
    ) {
      throw new Error(
        name +
          ".init() did not reach a usable initialized state."
      );
    }

    if (name === "NetworkEngine") {
      for (const key of [
        "scene",
        "camera",
        "renderer",
        "controls",
        "composer"
      ]) {
        if (!engine[key]) {
          throw new Error(
            "engine-core.js did not create NetworkEngine." +
              key +
              "."
          );
        }
      }

      if (
        typeof engine.registerHook !== "function"
      ) {
        throw new Error(
          "engine-core.js did not expose NetworkEngine.registerHook()."
        );
      }

      if (
        typeof engine.renderer.getContext !== "function"
      ) {
        throw new Error(
          "The initialized renderer does not provide a WebGL context."
        );
      }
    } else if (
      name === "EarthCore" &&
      !module.earthGroup
    ) {
      throw new Error(
        "EarthCore.init() did not create earthGroup."
      );
    } else if (name === "CableMatrix") {
      if (
        !module.cableGroup ||
        !module.curves
      ) {
        throw new Error(
          "CableMatrix.init() did not create cableGroup and curves."
        );
      }

      for (
        const route of Object.values(
          engine.DataContract.routes
        )
      ) {
        if (
          !module.curves[route.id] ||
          typeof module.curves[route.id].getPointAt !==
            "function"
        ) {
          throw new Error(
            "CableMatrix.curves is missing a usable spline for " +
              route.id +
              "."
          );
        }
      }
    } else if (
      name === "SatelliteOrbit" &&
      !module.satelliteGroup
    ) {
      throw new Error(
        "SatelliteOrbit.init() did not create satelliteGroup."
      );
    }
  }

  async function initialize(name, module, ticket) {
    stage = name;

    const methodName = name === "NetworkEngine" ? "initialize" : "init";

    const result = await withTimeout(
      module[methodName].call(module),
      INIT_TIMEOUT,
      name + "." + methodName + "()"
    );

    if (ticket !== generation) {
      const dispose =
        typeof module.destroy === "function"
          ? module.destroy
          : module.dispose;

      if (typeof dispose === "function") {
        await withTimeout(
          dispose.call(module),
          2000,
          name + " cancellation cleanup"
        );
      }

      throw new Error("Startup was cancelled.");
    }

    validateInitialized(name, module, result);
    report(name + " initialized.", "BOOT");
  }

  function satelliteCount() {
    const orbit = engine.SatelliteOrbit;

    if (!orbit) {
      return 0;
    }

    if (
      orbit.satelliteMesh &&
      Number.isFinite(orbit.satelliteMesh.count)
    ) {
      return Math.max(
        0,
        Math.floor(orbit.satelliteMesh.count)
      );
    }

    if (Array.isArray(orbit.satellites)) {
      return orbit.satellites.length;
    }

    if (typeof orbit.getStats === "function") {
      const stats = orbit.getStats();

      for (const key of [
        "activeSatellites",
        "satelliteCount",
        "count"
      ]) {
        if (Number.isFinite(stats[key])) {
          return Math.max(
            0,
            Math.floor(stats[key])
          );
        }
      }
    }

    return 0;
  }

  function readHardware() {
    const gl = engine.renderer.getContext();

    if (
      !gl ||
      (
        typeof gl.isContextLost === "function" &&
        gl.isContextLost()
      )
    ) {
      throw new Error(
        "The WebGL rendering context is unavailable or lost."
      );
    }

    let vendor = text(
      gl.getParameter(gl.VENDOR),
      "Unavailable"
    );

    let renderer = text(
      gl.getParameter(gl.RENDERER),
      "Unavailable"
    );

    const version = text(
      gl.getParameter(gl.VERSION),
      "WebGL"
    );

    try {
      const extension = gl.getExtension(
        "WEBGL_debug_renderer_info"
      );

      if (extension) {
        vendor = text(
          gl.getParameter(
            extension.UNMASKED_VENDOR_WEBGL
          ),
          vendor
        );

        renderer = text(
          gl.getParameter(
            extension.UNMASKED_RENDERER_WEBGL
          ),
          renderer
        );
      }
    } catch (ignored) {
      report(
        "Detailed GPU identification is unavailable; using standard WebGL identifiers.",
        "HARDWARE",
        "WARN"
      );
    }

    hardware = Object.freeze({
      vendor,
      renderer,
      webglVersion: version
    });
  }

  function updateReadouts(selector, value) {
    const nodes = document.querySelectorAll(selector);

    for (const node of nodes) {
      if (node.textContent !== value) {
        node.textContent = value;
      }
    }

    return nodes.length;
  }

  function syncHardware() {
    if (!hardware) {
      return;
    }

    const vendorFields = updateReadouts(
      "#gpu-vendor, [data-metric='gpu-vendor']",
      hardware.vendor
    );

    const rendererFields = updateReadouts(
      "#gpu-renderer, #gpu-metric, #gpu-info, [data-metric='gpu']",
      vendorFields
        ? hardware.renderer
        : hardware.vendor + " / " + hardware.renderer
    );

    const versionFields = updateReadouts(
      "#webgl-version, #webgl-metric, [data-metric='webgl-version']",
      hardware.webglVersion
    );

    updateReadouts(
      "#node-count, [data-metric='node-count']",
      String(satelliteCount())
    );

    if (!rendererFields || !versionFields) {
      const overlay = document.getElementById(
        "hud-overlay"
      );

      if (!overlay) {
        return;
      }

      let fallback = document.getElementById(
        "runtime-hardware-readout"
      );

      if (!fallback) {
        fallback = document.createElement("div");
        fallback.id = "runtime-hardware-readout";

        Object.assign(fallback.style, {
          position: "absolute",
          top:
            "calc(10px + env(safe-area-inset-top, 0px))",
          left:
            "calc(12px + env(safe-area-inset-left, 0px))",
          maxWidth: "min(74vw, 720px)",
          color: "#00ff66",
          opacity: "0.65",
          font: "10px/1.5 'Courier New', monospace",
          overflowWrap: "anywhere",
          pointerEvents: "none"
        });

        overlay.appendChild(fallback);
      }

      fallback.textContent =
        hardware.vendor +
        " | " +
        hardware.renderer +
        " | " +
        hardware.webglVersion;
    }
  }

  function findTrunks() {
    const data = engine.DataContract;

    const stationMap = new Map(
      Object.values(data.stations).map(station => [
        station.id,
        station
      ])
    );

    const candidates = Object.values(data.routes).filter(
      route => engine.CableMatrix.curves[route.id]
    );

    const atlantic = [];
    const pacific = [];

    for (const route of candidates) {
      const source = stationMap.get(route.source);
      const target = stationMap.get(route.target);
      const pair = new Set([
        source.region,
        target.region
      ]);

      const label =
        route.id +
        " " +
        route.cableName +
        " " +
        route.source +
        " " +
        route.target;

      if (
        pair.has("EU") &&
        (
          pair.has("NA") ||
          pair.has("LATAM")
        )
      ) {
        atlantic.push({
          route,
          score: /NYC/i.test(label) ? 2 : 1
        });
      }

      if (
        (
          pair.has("NA") &&
          pair.has("APAC")
        ) ||
        /transpacific|trans-pacific/i.test(label) ||
        (
          /TKO|TYO|JPN/i.test(label) &&
          /HNL|SYD/i.test(label)
        )
      ) {
        pacific.push({
          route,
          score: /TKO|TYO|HNL/i.test(label) ? 2 : 1
        });
      }
    }

    atlantic.sort((a, b) => b.score - a.score);
    pacific.sort((a, b) => b.score - a.score);

    const selected = new Map();

    for (
      const entry of atlantic
        .slice(0, 2)
        .concat(pacific.slice(0, 2))
    ) {
      selected.set(entry.route.id, entry.route);
    }

    if (!selected.size) {
      for (const route of candidates.slice(0, 4)) {
        selected.set(route.id, route);
      }
    }

    return Array.from(selected.values());
  }

  function stopLaunchWave() {
    if (!launchWave) {
      return;
    }

    const wave = launchWave;
    launchWave = null;

    if (typeof wave.release === "function") {
      wave.release();
    }

    if (wave.points.parent) {
      wave.points.parent.remove(wave.points);
    }

    wave.geometry.dispose();
    wave.material.dispose();
  }

  function igniteTraffic() {
    const interaction = engine.InteractionController;

    if (
      interaction &&
      typeof interaction.setPaused === "function"
    ) {
      interaction.setPaused(false);
    }

    for (const name of [
      "PacketPipeline",
      "SatelliteOrbit"
    ]) {
      const module = engine[name];

      if (
        typeof module.setRunning === "function"
      ) {
        module.setRunning(true);
      }
    }

    const routes = findTrunks();

    if (!routes.length) {
      throw new Error(
        "No initialized cable curves are available for traffic."
      );
    }

    const pipeline = engine.PacketPipeline;

    const stats =
      typeof pipeline.getStats === "function"
        ? pipeline.getStats()
        : {};

    const occupied = Number.isFinite(
      stats.activePackets
    )
      ? stats.activePackets
      : 800;

    const limit = Number.isFinite(
      engine.DataContract.constants.MAX_ACTIVE_PACKETS
    )
      ? engine.DataContract.constants.MAX_ACTIVE_PACKETS
      : 1200;

    const count = Math.min(
      48,
      Math.max(
        0,
        Math.floor(limit - occupied)
      )
    );

    // The launch wave follows shared cable curves.
    // PacketPipeline continues to own steady traffic.
    if (!count) {
      report(
        "The packet pool is already full; existing traffic is active.",
        "TRAFFIC"
      );
      return;
    }

    const THREE = global.THREE;
    const tails = 3;
    const geometry = new THREE.BufferGeometry();

    const positions = new THREE.BufferAttribute(
      new Float32Array(count * tails * 3),
      3
    );

    const colors = new THREE.BufferAttribute(
      new Float32Array(count * tails * 3),
      3
    );

    positions.setUsage(THREE.DynamicDrawUsage);
    colors.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute("position", positions);
    geometry.setAttribute("color", colors);

    const radius =
      engine.DataContract.constants.RADIUS_EARTH || 100;

    const material = new THREE.PointsMaterial({
      size: radius * 0.011,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false
    });

    const points = new THREE.Points(
      geometry,
      material
    );

    points.name = "BackboneLaunchWave";
    points.frustumCulled = false;

    engine.CableMatrix.cableGroup.add(points);

    const classes = [
      "HTTP_PING",
      "BACKUP_PAYLOAD",
      "TLS_HANDSHAKE"
    ];

    const palette = [
      new THREE.Color(0xffd000),
      new THREE.Color(0x5c6ac4),
      new THREE.Color(0x00ff66)
    ];

    const factors = [1.4, 0.7, 1.2];
    const sizes = [4096, 8388608, 24576];
    const packets = new Array(count);
    const point = new THREE.Vector3();

    let lastSolo = undefined;
    let lastArrival = -Infinity;
    let seconds = 0;

    for (let i = 0; i < count; i += 1) {
      packets[i] = {
        route: routes[i % routes.length],
        type: i % 3,
        direction: i % 2 ? -1 : 1,
        progress: 0.02 + (i % 12) * 0.018,
        speed: 0.24 * factors[i % 3],
        arrived: false
      };
    }

    function updateLaunchWave(delta) {
      const controller = engine.InteractionController;

      const isPaused =
        controller &&
        typeof controller.paused === "boolean"
          ? controller.paused
          : Boolean(
              engine.settings &&
              engine.settings.paused
            );

      const step = isPaused
        ? 0
        : Math.max(
            0,
            Math.min(
              Number.isFinite(delta) ? delta : 0,
              0.1
            )
          );

      const solo = controller
        ? controller.soloLayer
        : null;

      const recolor = solo !== lastSolo;
      seconds += step;

      let alive = 0;

      for (
        let i = 0;
        i < packets.length;
        i += 1
      ) {
        const packet = packets[i];
        let justArrived = false;

        if (!packet.arrived) {
          packet.progress = Math.min(
            1,
            packet.progress + packet.speed * step
          );

          if (packet.progress === 1) {
            packet.arrived = true;
            justArrived = true;

            if (
              seconds - lastArrival >= 0.125
            ) {
              lastArrival = seconds;

              const route = packet.route;

              const detail = {
                routeId: route.id,
                sourceStation:
                  packet.direction === 1
                    ? route.source
                    : route.target,
                targetStation:
                  packet.direction === 1
                    ? route.target
                    : route.source,
                packetClass: classes[packet.type],
                bytesTransferred: sizes[packet.type],
                latencyMs: Number.isFinite(
                  route.baseLatencyMs
                )
                  ? route.baseLatencyMs
                  : 0,
                timestamp: Date.now()
              };

              global.dispatchEvent(
                new global.CustomEvent(
                  engine.DataContract.constants
                    .EVENT_PACKET_ARRIVED ||
                    "NetworkEngine:PacketArrived",
                  { detail }
                )
              );
            }
          } else {
            alive += 1;
          }
        }

        const visible =
          !packet.arrived &&
          (
            !solo ||
            solo === "ALL" ||
            solo === classes[packet.type]
          );

        for (
          let tail = 0;
          tail < tails;
          tail += 1
        ) {
          const index = i * tails + tail;

          const progress = Math.max(
            0,
            packet.progress - tail * 0.008
          );

          const t =
            packet.direction === 1
              ? progress
              : 1 - progress;

          if (!packet.arrived) {
            engine.CableMatrix.curves[
              packet.route.id
            ].getPointAt(t, point);

            positions.setXYZ(
              index,
              point.x,
              point.y,
              point.z
            );
          }

          if (recolor || justArrived) {
            const color = palette[packet.type];

            const fade = visible
              ? Math.pow(
                  1 - tail / tails,
                  2
                )
              : 0;

            colors.setXYZ(
              index,
              color.r * fade,
              color.g * fade,
              color.b * fade
            );
          }
        }
      }

      lastSolo = solo;
      positions.needsUpdate = true;
      colors.needsUpdate = true;

      if (!alive) {
        stopLaunchWave();
      }
    }

    launchWave = {
      points,
      geometry,
      material,
      release: null
    };

    updateLaunchWave(0);

    launchWave.release = engine.registerHook(
      updateLaunchWave
    );

    report(
      "Launch traffic active on " +
        routes.map(route => route.id).join(", ") +
        ".",
      "TRAFFIC"
    );
  }

  function stopCore() {
    try {
      if (typeof engine.stop === "function") {
        engine.stop();
      } else if (
        typeof engine.setPaused === "function"
      ) {
        engine.setPaused(true);
      }

      if (
        engine.settings &&
        typeof engine.settings === "object"
      ) {
        Reflect.set(
          engine.settings,
          "paused",
          true
        );
      }
    } catch (error) {
      reportError(error, "Stopping the core");
    }
  }

  function cleanupSubsystems() {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    blocked = true;

    if (hardwareTimer !== null) {
      global.clearInterval(hardwareTimer);
    }

    hardwareTimer = null;
    stopCore();
    stopLaunchWave();

    const pending = [];

    for (
      let i = MODULES.length - 1;
      i >= 0;
      i -= 1
    ) {
      const name = MODULES[i][0];
      const module = engine[name];

      if (!module) {
        continue;
      }

      const method =
        typeof module.destroy === "function"
          ? module.destroy
          : module.dispose;

      if (typeof method !== "function") {
        continue;
      }

      try {
        const result = method.call(module);

        if (
          result &&
          typeof result.then === "function"
        ) {
          pending.push(
            withTimeout(
              result,
              2000,
              name + " cleanup"
            ).catch(error => {
              reportError(
                error,
                name + " cleanup"
              );
            })
          );
        }
      } catch (error) {
        reportError(error, name + " cleanup");
      }
    }

    restoreHookBoundary();
    stopCore();

    const disposeCore =
      typeof engine.destroy === "function"
        ? engine.destroy
        : engine.dispose;

    if (typeof disposeCore === "function") {
      try {
        const result = disposeCore.call(engine);

        if (
          result &&
          typeof result.then === "function"
        ) {
          pending.push(
            withTimeout(
              result,
              2000,
              "Core cleanup"
            ).catch(error => {
              reportError(
                error,
                "Core cleanup"
              );
            })
          );
        }
      } catch (error) {
        reportError(error, "Core cleanup");
      }
    }

    cleanupPromise = Promise.all(pending);
    return cleanupPromise;
  }

  function boot() {
    if (state === "online") {
      return Promise.resolve(true);
    }

    if (bootPromise) {
      return bootPromise;
    }

    if (
      state === "rebooting" ||
      state === "stopped"
    ) {
      return Promise.resolve(false);
    }

    const ticket = ++generation;

    cleanupPromise = null;
    state = "booting";
    blocked = true;
    lastError = null;

    installBoundary();

    bootPromise = (async () => {
      try {
        const health = healthCheck();

        if (!health.ok) {
          throw new Error(
            "Dependency verification failed:\n\n" +
              health.problems.join("\n")
          );
        }

        hideNotice();

        if (
          engine.settings &&
          typeof engine.settings === "object"
        ) {
          Reflect.set(
            engine.settings,
            "paused",
            false
          );
        }

        installHookBoundary();

        await initialize(
          "NetworkEngine",
          engine,
          ticket
        );

        installHookBoundary();

        for (const [name] of MODULES) {
          await initialize(
            name,
            engine[name],
            ticket
          );
        }

        stage = "Traffic ignition";

        readHardware();
        syncHardware();
        igniteTraffic();

        state = "online";
        blocked = false;
        bootedAt = Date.now();

        report(
          "SYSTEM_ONLINE: Backbone telemetry active. 12/12 modules initialized successfully.",
          "SYSTEM_ONLINE"
        );

        flushLogs();

        hardwareTimer = global.setInterval(() => {
          if (state !== "online") {
            return;
          }

          try {
            syncHardware();
          } catch (error) {
            reportError(
              error,
              "Hardware telemetry"
            );
          }
        }, 1000);

        global.dispatchEvent(
          new global.CustomEvent(
            "NetworkEngine:Online",
            {
              detail: {
                timestamp: bootedAt,
                hardware,
                satelliteCount: satelliteCount()
              }
            }
          )
        );

        return true;
      } catch (error) {
        if (ticket !== generation) {
          return false;
        }

        lastError =
          stage + ": " + errorMessage(error);

        state = "failed";

        reportError(
          error,
          "Startup / " + stage
        );

        await cleanupSubsystems();

        showNotice(
          "BACKBONE STARTUP ABORTED\n\n" +
            "Stage: " +
            stage +
            "\n\n" +
            (
              error && error.message
                ? error.message
                : errorMessage(error)
            ) +
            "\n\nLoad the listed dependencies before scripts/script.js, correct the reported error, then reload the page."
        );

        flushLogs();
        return false;
      } finally {
        if (ticket === generation) {
          bootPromise = null;
        }
      }
    })();

    return bootPromise;
  }

  function shutdown() {
    if (state === "stopped") {
      return Promise.resolve();
    }

    generation += 1;
    state = "stopped";
    blocked = true;

    document.removeEventListener(
      "DOMContentLoaded",
      onReady
    );

    global.removeEventListener(
      "pagehide",
      onPageHide
    );

    global.removeEventListener(
      "pageshow",
      onPageShow
    );

    const pending = cleanupSubsystems();

    flushLogs();
    removeBoundary();

    return pending;
  }

  function reboot() {
    if (rebootPromise) {
      return rebootPromise;
    }

    rebootPromise = (async () => {
      generation += 1;
      state = "rebooting";
      blocked = true;

      report(
        "Restart requested; releasing subsystems.",
        "SYSTEM_REBOOT"
      );

      flushLogs();
      await cleanupSubsystems();

      // A fresh document recreates modules with irreversible dispose lifecycles.
      global.location.reload();

      return true;
    })().catch(error => {
      state = "failed";
      lastError = errorMessage(error);

      reportError(error, "Reboot");

      showNotice(
        "BACKBONE REBOOT FAILED\n\n" +
          lastError +
          "\n\nReload this page to start a fresh runtime."
      );

      rebootPromise = null;
      return false;
    });

    return rebootPromise;
  }

  function onReady() {
    document.removeEventListener(
      "DOMContentLoaded",
      onReady
    );

    void boot();
  }

  function onPageHide(event) {
    if (event.persisted) {
      return;
    }

    void shutdown();
  }

  function onPageShow(event) {
    if (
      !event.persisted ||
      state !== "online"
    ) {
      return;
    }

    try {
      if (
        engine.clock &&
        typeof engine.clock.getDelta === "function"
      ) {
        engine.clock.getDelta();
      }

      const chroma = engine.ChromaMatrixPass;

      if (
        chroma &&
        typeof chroma.resetHistory === "function"
      ) {
        chroma.resetHistory();
      }

      syncHardware();
    } catch (error) {
      reportError(
        error,
        "Restoring the page"
      );
    }
  }

  engine.Runtime = Object.freeze({
    moduleId: MODULE_ID,
    boot,
    shutdown,
    reboot,
    healthCheck,

    get state() {
      return state;
    },

    get stage() {
      return stage;
    },

    get bootedAt() {
      return bootedAt;
    },

    get lastError() {
      return lastError;
    },

    get hardware() {
      return hardware;
    }
  });

  engine.reboot = reboot;

  installBoundary();

  global.addEventListener(
    "pagehide",
    onPageHide
  );

  global.addEventListener(
    "pageshow",
    onPageShow
  );

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      onReady,
      { once: true }
    );
  } else {
    onReady();
  }
})(window);