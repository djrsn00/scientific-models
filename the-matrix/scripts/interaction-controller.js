(function installInteractionController(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.InteractionController";
  const CLASS_NAMES = [
    "ALL",
    "HTTP_PING",
    "BACKUP_PAYLOAD",
    "TLS_HANDSHAKE",
    "LEO_UPLINK"
  ];
  const COLORS = [0xffd000, 0x5c6ac4, 0x00ff66];
  const BOOST_CAPACITY = 64;
  const TAIL_SAMPLES = 4;
  const TWEEN_SECONDS = 0.8;
  const HUD_FADE_MS = 220;

  if (
    engine.InteractionController &&
    engine.InteractionController.moduleId === MODULE_ID
  ) {
    engine.InteractionController.init();
    return;
  }

  const soloUniform = { value: 0 };
  const bindings = new Map();
  const materialPatches = new Map();
  const attributePatches = new Map();
  const pausedModules = new Map();
  const frozenUniforms = new Map();
  const nodeLookup = new Map();
  const routeLookup = new Map();
  const curveLookup = new Map();
  const pickTargets = [];
  const stations = [];
  const intersections = [];
  const pendingLogs = [];
  const pointerIds = new Set();
  const warned = new Set();

  let THREE = null;
  let camera = null;
  let controls = null;
  let renderer = null;
  let canvas = null;
  let initialized = false;
  let destroyed = false;
  let initializing = false;
  let paused = false;
  let initialPaused = false;
  let solo = 0;
  let hudVisible = true;
  let hud = null;
  let hudSnapshot = null;
  let restoreButton = null;
  let reticle = null;
  let reticleSnapshot = null;
  let hideTimer = null;
  let retryTimer = null;
  let refreshTimer = null;
  let fallbackFrame = null;
  let unregister = null;
  let hookRegistered = false;
  let registeredHook = null;
  let generation = 0;
  let logEvent = "NetworkEngine:TerminalLog";

  let earthGroup = null;
  let frozenEarth = null;
  let frozenRotation = null;
  let orbitVisibility = null;
  let cachedPipeline = null;
  let cachedPipelineReady = null;
  let effectGroup = null;
  let selectionRing = null;
  let ringStarted = -Infinity;
  let focusNode = null;
  let focusStationId = null;
  let selectedCable = null;
  let boostCurve = null;
  let boostRemaining = 0;
  let boostCount = 0;
  let boostPoints = null;
  let boostPosition = null;
  let boostColor = null;
  let boostFade = null;
  let boostClass = null;
  let boostProgress = null;
  let boostSpeed = null;
  let boostDirection = null;
  let radius = 100;
  let lastHookTime = -Infinity;
  let lastReticleTime = -Infinity;
  let lastGestureTime = -Infinity;
  let fallbackRenderFrame = -1;

  let raycaster = null;
  let pointer = null;
  let localRay = null;
  let occlusionSphere = null;
  let inverseEarth = null;
  let inverseEffects = null;
  let center = null;
  let cameraWorld = null;
  let worldPoint = null;
  let localPoint = null;
  let projected = null;
  let scratch = null;
  let scratch2 = null;
  let worldScale = null;
  let drawingSize = null;
  let zAxis = null;
  let defaultPosition = null;
  let defaultTarget = null;
  let defaultZoom = 1;
  let tween = null;

  const gesture = {
    id: null,
    x: 0,
    y: 0,
    time: 0,
    moved: false,
    type: "mouse"
  };

  function now() {
    return global.performance &&
      typeof global.performance.now === "function"
      ? global.performance.now()
      : Date.now();
  }

  function finite(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function clean(value, fallback) {
    if (typeof value !== "string" && typeof value !== "number") {
      return fallback;
    }

    return (
      String(value)
        .slice(0, 300)
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim() || fallback
    );
  }

  function warn(message) {
    if (warned.has(message)) {
      return;
    }

    warned.add(message);

    if (global.console && typeof global.console.warn === "function") {
      global.console.warn("[InteractionController] " + message);
    }
  }

  function setting(name, value) {
    if (!engine.settings || typeof engine.settings !== "object") {
      engine.settings = {};
    }

    try {
      if (!Reflect.set(engine.settings, name, value)) {
        warn(
          "Settings are read-only; use the controller to read interaction state."
        );
      }
    } catch (error) {
      warn(
        "Settings are read-only; interaction state remains available on the controller."
      );
    }
  }

  function constants() {
    return engine.DataContract
      ? engine.DataContract.constants || {}
      : {};
  }

  function first(selector) {
    return global.document
      ? global.document.querySelector(selector)
      : null;
  }

  function onTerminalLog(event) {
    const detail = event.detail;

    if (
      !initialized ||
      !detail ||
      typeof detail.message !== "string"
    ) {
      return;
    }

    const terminal = engine.TerminalStream;

    if (
      terminal &&
      typeof terminal.enqueue === "function" &&
      terminal.enqueue(detail.message, detail.tag, detail.color)
    ) {
      return;
    }

    if (pendingLogs.length === 24) {
      pendingLogs.shift();
    }

    pendingLogs.push(detail);
  }

  function emitLog(tag, message, metadata) {
    const detail = {
      tag,
      message,
      color: "#00ff66",
      timestamp: Date.now(),
      metadata: metadata || null
    };

    global.dispatchEvent(
      new global.CustomEvent(logEvent, { detail })
    );
  }

  function flushLogs() {
    const terminal = engine.TerminalStream;

    if (!terminal || typeof terminal.enqueue !== "function") {
      return;
    }

    while (pendingLogs.length) {
      const entry = pendingLogs[0];

      if (!terminal.enqueue(entry.message, entry.tag, entry.color)) {
        break;
      }

      pendingLogs.shift();
    }
  }

  function updateWorld() {
    earthGroup = engine.EarthCore && engine.EarthCore.earthGroup;

    if (!earthGroup) {
      return false;
    }

    earthGroup.updateWorldMatrix(true, false);
    camera.updateWorldMatrix(true, false);
    earthGroup.getWorldPosition(center);
    earthGroup.getWorldScale(worldScale);
    camera.getWorldPosition(cameraWorld);
    inverseEarth.copy(earthGroup.matrixWorld).invert();

    return true;
  }

  function visibleObject(object) {
    for (let node = object; node; node = node.parent) {
      if (node.visible === false) {
        return false;
      }
    }

    return true;
  }

  function visiblePoint(point) {
    scratch.subVectors(point, cameraWorld);
    const distance = scratch.length();

    if (distance < 0.000001) {
      return false;
    }

    scratch.multiplyScalar(1 / distance);
    localRay
      .set(cameraWorld, scratch)
      .applyMatrix4(inverseEarth);

    const hit = localRay.intersectSphere(
      occlusionSphere,
      scratch2
    );

    if (!hit) {
      return true;
    }

    hit.applyMatrix4(earthGroup.matrixWorld);

    const tolerance =
      radius *
      0.008 *
      Math.max(worldScale.x, worldScale.y, worldScale.z);

    return cameraWorld.distanceTo(hit) + tolerance >= distance;
  }

  function stationData(id) {
    const registry =
      engine.DataContract && engine.DataContract.stations;

    if (!registry) {
      return null;
    }

    return (
      registry[id] ||
      Object.values(registry).find(station => station.id === id) ||
      null
    );
  }

  function stationNode(id) {
    const cables = engine.CableMatrix;

    if (cables && cables.nodes && cables.nodes[id]) {
      return cables.nodes[id];
    }

    for (const entry of stations) {
      if (entry.id === id) {
        return entry.object;
      }
    }

    return null;
  }

  function identify(object) {
    for (let node = object; node; node = node.parent) {
      const data = node.userData || {};
      const station = nodeLookup.get(node) || data.stationId;

      if (station) {
        return {
          type: "station",
          id: station,
          object: node
        };
      }

      const route = routeLookup.get(node) || data.routeId;

      if (route) {
        return {
          type: "route",
          id: route,
          object
        };
      }
    }

    return null;
  }

  function refreshPickTargets() {
    pickTargets.length = 0;
    stations.length = 0;
    nodeLookup.clear();
    routeLookup.clear();
    curveLookup.clear();

    const cables = engine.CableMatrix;

    if (!cables || !cables.cableGroup) {
      return;
    }

    if (cables.curves) {
      for (const id of Object.keys(cables.curves)) {
        curveLookup.set(cables.curves[id], id);
      }
    }

    if (cables.nodes) {
      for (const id of Object.keys(cables.nodes)) {
        const object = cables.nodes[id];

        if (object && object.isObject3D) {
          nodeLookup.set(object, id);
          stations.push({ id, object });
        }
      }
    }

    cables.cableGroup.traverse(object => {
      if (!object.isMesh || object.userData.interactionOwned) {
        return;
      }

      const path =
        object.geometry && object.geometry.parameters
          ? object.geometry.parameters.path
          : null;

      if (path && curveLookup.has(path)) {
        routeLookup.set(object, curveLookup.get(path));
      }

      const metadata = identify(object);

      if (!metadata) {
        return;
      }

      pickTargets.push(object);

      if (
        metadata.type === "station" &&
        !stations.some(entry => entry.id === metadata.id)
      ) {
        const node = metadata.object;
        nodeLookup.set(node, metadata.id);
        stations.push({ id: metadata.id, object: node });
      }
    });
  }

  function pick(clientX, clientY, pointerType) {
    if (!initialized || !updateWorld()) {
      return false;
    }

    const rectangle = canvas.getBoundingClientRect();

    if (
      rectangle.width <= 0 ||
      rectangle.height <= 0 ||
      clientX < rectangle.left ||
      clientY < rectangle.top ||
      clientX > rectangle.right ||
      clientY > rectangle.bottom
    ) {
      return false;
    }

    const cables = engine.CableMatrix;

    if (cables && cables.cableGroup) {
      cables.cableGroup.updateWorldMatrix(true, true);
    }

    pointer.set(
      ((clientX - rectangle.left) / rectangle.width) * 2 - 1,
      -((clientY - rectangle.top) / rectangle.height) * 2 + 1
    );

    raycaster.setFromCamera(pointer, camera);

    // Screen-space padding makes microscopic beacons usable on touchscreens.
    let nearStation = null;
    let bestPixels = pointerType === "touch" ? 18 * 18 : 10 * 10;

    for (const entry of stations) {
      if (!visibleObject(entry.object)) {
        continue;
      }

      entry.object.getWorldPosition(worldPoint);

      if (!visiblePoint(worldPoint)) {
        continue;
      }

      projected.copy(worldPoint).project(camera);

      if (projected.z < -1 || projected.z > 1) {
        continue;
      }

      const x =
        rectangle.left +
        (projected.x + 1) * 0.5 * rectangle.width;

      const y =
        rectangle.top +
        (1 - projected.y) * 0.5 * rectangle.height;

      const distance =
        (x - clientX) * (x - clientX) +
        (y - clientY) * (y - clientY);

      if (distance < bestPixels) {
        bestPixels = distance;
        nearStation = entry.id;
      }
    }

    if (nearStation) {
      return focusStation(nearStation);
    }

    intersections.length = 0;
    raycaster.intersectObjects(pickTargets, false, intersections);

    for (const hit of intersections) {
      if (
        !visibleObject(hit.object) ||
        !visiblePoint(hit.point)
      ) {
        continue;
      }

      const metadata = identify(hit.object);

      if (metadata && metadata.type === "station") {
        return focusStation(metadata.id);
      }

      if (metadata && metadata.type === "route") {
        return selectRoute(metadata.id, hit.object);
      }
    }

    return false;
  }

  function setCameraWorld(position) {
    scratch.copy(position);

    if (camera.parent) {
      camera.parent.updateWorldMatrix(true, false);
      camera.parent.worldToLocal(scratch);
    }

    camera.position.copy(scratch);
  }

  function cancelTween() {
    if (!tween || !tween.active) {
      return;
    }

    tween.active = false;
    controls.enabled = tween.saved.enabled;
    controls.enableDamping = tween.saved.enableDamping;
    controls.autoRotate = tween.saved.autoRotate;

    updateIndicators();
  }

  function beginTween(position, target, kind, node) {
    cancelTween();
    updateWorld();

    tween.fromPosition.copy(cameraWorld);
    tween.fromTarget.copy(controls.target);
    tween.toPosition.copy(position);
    tween.toTarget.copy(target);
    tween.fromZoom = camera.zoom;
    tween.toZoom = kind === "reset" ? defaultZoom : camera.zoom;
    tween.kind = kind;
    tween.node = node || null;
    tween.started = now();
    tween.saved.enabled = controls.enabled;
    tween.saved.enableDamping = controls.enableDamping;
    tween.saved.autoRotate = controls.autoRotate;

    controls.enabled = false;
    controls.enableDamping = false;
    controls.autoRotate = false;

    // Drain OrbitControls inertia, then restore the exact starting pose.
    controls.update(0);
    setCameraWorld(tween.fromPosition);
    controls.target.copy(tween.fromTarget);
    controls.update(0);

    tween.fromPosition.copy(cameraWorld);
    camera.getWorldPosition(tween.fromPosition);
    tween.active = true;

    updateIndicators();
    ensureFallbackFrame();
  }

  function updateTween(time) {
    if (!tween.active || !updateWorld()) {
      return;
    }

    if (tween.node && tween.node.parent) {
      tween.node.getWorldPosition(tween.toTarget);
      scratch.subVectors(tween.toTarget, center).normalize();

      tween.toPosition
        .copy(tween.toTarget)
        .addScaledVector(scratch, tween.focusDistance);
    }

    const fraction = Math.min(
      1,
      Math.max(
        0,
        (time - tween.started) / (TWEEN_SECONDS * 1000)
      )
    );

    const eased = fraction * fraction * (3 - 2 * fraction);

    tween.fromDirection.subVectors(tween.fromPosition, center);
    tween.toDirection.subVectors(tween.toPosition, center);

    const fromDistance = tween.fromDirection.length();
    const toDistance = tween.toDirection.length();

    tween.fromDirection.normalize();
    tween.toDirection.normalize();

    // Spherical interpolation keeps the camera's route outside the globe.
    tween.rotation.setFromUnitVectors(
      tween.fromDirection,
      tween.toDirection
    );

    tween.interpolatedRotation
      .identity()
      .slerp(tween.rotation, eased);

    worldPoint
      .copy(tween.fromDirection)
      .applyQuaternion(tween.interpolatedRotation);

    const clearance =
      radius *
      1.06 *
      Math.max(worldScale.x, worldScale.y, worldScale.z);

    const distance = Math.max(
      clearance,
      fromDistance + (toDistance - fromDistance) * eased
    );

    worldPoint.multiplyScalar(distance).add(center);
    setCameraWorld(worldPoint);

    controls.target.lerpVectors(
      tween.fromTarget,
      tween.toTarget,
      eased
    );

    const zoom =
      tween.fromZoom +
      (tween.toZoom - tween.fromZoom) * eased;

    if (Math.abs(camera.zoom - zoom) > 0.000001) {
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
    }

    controls.update(0);

    if (fraction === 1) {
      cancelTween();
    }
  }

  function clearSelection() {
    if (selectedCable) {
      if (
        selectedCable.object.material === selectedCable.highlight
      ) {
        selectedCable.object.material = selectedCable.original;
      }

      const materials = Array.isArray(selectedCable.highlight)
        ? selectedCable.highlight
        : [selectedCable.highlight];

      for (const material of materials) {
        material.dispose();
      }

      selectedCable = null;
    }

    focusNode = null;
    focusStationId = null;

    if (selectionRing) {
      selectionRing.visible = false;
    }

    boostRemaining = 0;
    boostCount = 0;
    boostCurve = null;

    if (boostPoints) {
      boostPoints.visible = false;
      boostPoints.geometry.setDrawRange(0, 0);
    }
  }

  function resetCamera() {
    if (!initialized) {
      return false;
    }

    clearSelection();
    beginTween(defaultPosition, defaultTarget, "reset", null);

    const chroma = engine.ChromaMatrixPass;

    if (chroma && typeof chroma.resetHistory === "function") {
      chroma.resetHistory();
    }

    return true;
  }

  function focusStation(id) {
    if (!initialized || !updateWorld()) {
      return false;
    }

    const node = stationNode(id);

    if (!node || !node.isObject3D) {
      return false;
    }

    clearSelection();
    focusNode = node;
    focusStationId = id;

    node.getWorldPosition(worldPoint);
    scratch2.copy(worldPoint);
    scratch.subVectors(worldPoint, center).normalize();

    const scale = Math.max(
      worldScale.x,
      worldScale.y,
      worldScale.z
    );

    const minimum = Math.max(
      0,
      finite(controls.minDistance, 0)
    );

    const maximum = Math.max(
      minimum,
      finite(controls.maxDistance, radius * scale * 10)
    );

    tween.focusDistance = Math.min(
      maximum,
      Math.max(minimum, radius * scale * 1.35)
    );

    localPoint
      .copy(worldPoint)
      .addScaledVector(scratch, tween.focusDistance);

    beginTween(localPoint, scratch2, "station", node);
    ringStarted = now();
    selectionRing.visible = true;

    const station = stationData(id) || node.userData;

    const detail = {
      stationId: id,
      name: clean(station.name, id),
      tier: clean(station.tier, "UNKNOWN"),
      capacityTbps: finite(station.capacityTbps, 0),
      region: clean(station.region, "UNKNOWN")
    };

    emitLog(
      "STATION_INSPECT",
      "Station: " +
        detail.name +
        " | Tier: " +
        detail.tier +
        " | Capacity: " +
        detail.capacityTbps +
        " Tbps | Region: " +
        detail.region,
      detail
    );

    return true;
  }

  function highlightMaterial(material) {
    const clone = material.clone();

    if (clone.color && typeof clone.color.setHex === "function") {
      clone.color.setHex(0x00f0ff);
    }

    if (clone.uniforms) {
      const color =
        clone.uniforms.uColor || clone.uniforms.color;

      if (
        color &&
        color.value &&
        typeof color.value.setHex === "function"
      ) {
        color.value.setHex(0x00f0ff);
      }
    }

    clone.transparent = true;
    clone.opacity = 0.92;
    clone.depthWrite = false;
    clone.blending = THREE.AdditiveBlending;
    clone.toneMapped = false;

    return clone;
  }

  function selectRoute(id, object) {
    if (!initialized) {
      return false;
    }

    const cables = engine.CableMatrix;
    const curve =
      cables && cables.curves && cables.curves[id];

    if (!curve) {
      return false;
    }

    if (!object) {
      object = pickTargets.find(target => {
        const metadata = identify(target);

        return (
          metadata &&
          metadata.type === "route" &&
          metadata.id === id
        );
      });
    }

    if (!object || !object.material) {
      return false;
    }

    clearSelection();
    cancelTween();

    const original = object.material;
    const highlight = Array.isArray(original)
      ? original.map(highlightMaterial)
      : highlightMaterial(original);

    object.material = highlight;
    selectedCable = { id, object, original, highlight };

    startRouteBoost(curve);

    const chroma = engine.ChromaMatrixPass;

    if (chroma && typeof chroma.pulse === "function") {
      chroma.pulse(0.55, 0.65);
    }

    emitLog(
      "CORRIDOR_INSPECT",
      "Route: " +
        id +
        " | Corridor highlighted | Temporary packet density boost active.",
      {
        routeId: id,
        supplementalPackets: boostCount
      }
    );

    return true;
  }

  function createEffects() {
    effectGroup = new THREE.Group();
    effectGroup.name = "interactionEffects";
    effectGroup.userData.interactionOwned = true;

    const parent =
      engine.CableMatrix && engine.CableMatrix.cableGroup
        ? engine.CableMatrix.cableGroup
        : engine.EarthCore.earthGroup;

    parent.add(effectGroup);

    selectionRing = new THREE.Mesh(
      new THREE.RingGeometry(1, 1.16, 48),
      new THREE.MeshBasicMaterial({
        color: 0x00ff66,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false
      })
    );

    selectionRing.name = "stationInspectionPulse";
    selectionRing.userData.interactionOwned = true;
    selectionRing.visible = false;
    selectionRing.renderOrder = 15;
    effectGroup.add(selectionRing);

    const vertices = BOOST_CAPACITY * TAIL_SAMPLES;
    const geometry = new THREE.BufferGeometry();

    boostPosition = new THREE.BufferAttribute(
      new Float32Array(vertices * 3),
      3
    );

    boostColor = new THREE.BufferAttribute(
      new Float32Array(vertices * 3),
      3
    );

    boostFade = new THREE.BufferAttribute(
      new Float32Array(vertices),
      1
    );

    boostClass = new THREE.BufferAttribute(
      new Float32Array(vertices),
      1
    );

    boostPosition.setUsage(THREE.DynamicDrawUsage);
    boostFade.setUsage(THREE.DynamicDrawUsage);

    geometry.setAttribute("position", boostPosition);
    geometry.setAttribute("aColor", boostColor);
    geometry.setAttribute("aFade", boostFade);
    geometry.setAttribute("aClass", boostClass);
    geometry.setDrawRange(0, 0);

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uSolo: soloUniform,
        uPixelHeight: { value: 1 },
        uSize: { value: radius * 0.013 }
      },

      vertexShader: `
        uniform float uPixelHeight;
        uniform float uSize;

        attribute vec3 aColor;
        attribute float aFade;
        attribute float aClass;

        varying vec3 vColor;
        varying float vFade;
        varying float vClass;

        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          float scale = length(modelViewMatrix[0].xyz);

          float size =
            uSize *
            scale *
            uPixelHeight *
            projectionMatrix[1][1] *
            0.5;

          if (projectionMatrix[2][3] < -0.5) {
            size /= max(0.1, -view.z);
          }

          gl_PointSize = clamp(size, 1.0, 36.0);
          gl_Position = projectionMatrix * view;

          vColor = aColor;
          vFade = aFade;
          vClass = aClass;
        }
      `,

      fragmentShader: `
        uniform float uSolo;

        varying vec3 vColor;
        varying float vFade;
        varying float vClass;

        void main() {
          if (uSolo > 0.5 && abs(uSolo - vClass) > 0.25) {
            discard;
          }

          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);

          if (r2 >= 1.0) {
            discard;
          }

          float halo = pow(1.0 - r2, 2.5);
          gl_FragColor = vec4(vColor * 1.65, halo * vFade);
        }
      `,

      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    });

    boostPoints = new THREE.Points(geometry, material);
    boostPoints.name = "interactionRoutePackets";
    boostPoints.userData.interactionOwned = true;
    boostPoints.frustumCulled = false;
    boostPoints.visible = false;
    boostPoints.renderOrder = 14;
    effectGroup.add(boostPoints);

    boostProgress = new Float64Array(BOOST_CAPACITY);
    boostSpeed = new Float64Array(BOOST_CAPACITY);
    boostDirection = new Int8Array(BOOST_CAPACITY);

    const colors = COLORS.map(color => new THREE.Color(color));
    const factors = [1.4, 0.7, 1.2];

    for (let i = 0; i < BOOST_CAPACITY; i += 1) {
      const type = i % 3;

      boostSpeed[i] = 0.18 * factors[type];
      boostDirection[i] = i % 2 ? -1 : 1;

      for (let tail = 0; tail < TAIL_SAMPLES; tail += 1) {
        const index = i * TAIL_SAMPLES + tail;

        boostColor.setXYZ(
          index,
          colors[type].r,
          colors[type].g,
          colors[type].b
        );

        boostClass.setX(index, type + 1);
      }
    }
  }

  function startRouteBoost(curve) {
    const cables = engine.CableMatrix;

    if (
      cables &&
      cables.cableGroup &&
      effectGroup.parent !== cables.cableGroup
    ) {
      cables.cableGroup.add(effectGroup);
    }

    let activePackets = 0;
    const pipeline = engine.PacketPipeline;

    if (pipeline && typeof pipeline.getStats === "function") {
      activePackets = finite(
        pipeline.getStats().activePackets,
        0
      );
    }

    const maximum = finite(
      constants().MAX_ACTIVE_PACKETS,
      1200
    );

    boostCount = Math.floor(
      Math.min(
        BOOST_CAPACITY,
        Math.max(0, maximum - activePackets)
      )
    );

    boostCurve = curve;
    boostRemaining = 6;

    for (let i = 0; i < boostCount; i += 1) {
      boostProgress[i] = Math.random();
    }

    boostPoints.geometry.setDrawRange(
      0,
      boostCount * TAIL_SAMPLES
    );

    boostPoints.visible = boostCount > 0;
    updateBoost(0);
  }

  function updateBoost(delta) {
    if (!boostCurve || boostCount === 0) {
      return;
    }

    boostRemaining = Math.max(0, boostRemaining - delta);

    if (boostRemaining === 0) {
      boostPoints.visible = false;
      boostCurve = null;
      return;
    }

    renderer.getDrawingBufferSize(drawingSize);
    boostPoints.material.uniforms.uPixelHeight.value =
      drawingSize.y;

    const fade = Math.min(1, boostRemaining / 0.6);

    for (let i = 0; i < boostCount; i += 1) {
      let progress =
        boostProgress[i] +
        boostDirection[i] * boostSpeed[i] * delta;

      progress = ((progress % 1) + 1) % 1;
      boostProgress[i] = progress;

      for (let tail = 0; tail < TAIL_SAMPLES; tail += 1) {
        const index = i * TAIL_SAMPLES + tail;

        const t = Math.max(
          0,
          Math.min(
            1,
            progress - boostDirection[i] * tail * 0.006
          )
        );

        boostCurve.getPointAt(t, localPoint);

        boostPosition.setXYZ(
          index,
          localPoint.x,
          localPoint.y,
          localPoint.z
        );

        boostFade.setX(
          index,
          fade * Math.pow(1 - tail / TAIL_SAMPLES, 2)
        );
      }
    }

    boostPosition.needsUpdate = true;
    boostFade.needsUpdate = true;
  }

  function updateRing(time) {
    if (
      !selectionRing.visible ||
      !focusNode ||
      !focusNode.parent
    ) {
      return;
    }

    const age = (time - ringStarted) / 850;

    if (age >= 1) {
      selectionRing.visible = false;
      return;
    }

    effectGroup.updateWorldMatrix(true, false);
    inverseEffects.copy(effectGroup.matrixWorld).invert();

    focusNode.getWorldPosition(worldPoint);
    localPoint.copy(worldPoint).applyMatrix4(inverseEffects);
    scratch.copy(center).applyMatrix4(inverseEffects);
    scratch2.subVectors(localPoint, scratch).normalize();

    selectionRing.position
      .copy(localPoint)
      .addScaledVector(scratch2, radius * 0.002);

    selectionRing.quaternion.setFromUnitVectors(
      zAxis,
      scratch2
    );

    selectionRing.scale.setScalar(
      radius * 0.014 * (1 + age * 3.5)
    );

    selectionRing.material.opacity =
      Math.pow(1 - age, 2) * 0.9;
  }

  function mainBounds(source) {
    const cleanSource = source.replace(
      /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
      text => " ".repeat(text.length)
    );

    const match =
      /\bvoid\s+main\s*\(\s*(?:void\s*)?\)\s*\{/.exec(
        cleanSource
      );

    if (!match) {
      return null;
    }

    const start = match.index + match[0].length;
    let depth = 1;

    for (let i = start; i < cleanSource.length; i += 1) {
      if (cleanSource[i] === "{") {
        depth += 1;
      } else if (cleanSource[i] === "}") {
        depth -= 1;

        if (depth === 0) {
          return { start, end: i };
        }
      }
    }

    return null;
  }

  function addShaderHeader(source, header) {
    header = "precision highp float;\n" + header;

    const version = /^\s*#version[^\n]*\n/.exec(source);

    return version
      ? source.slice(0, version[0].length) +
          header +
          source.slice(version[0].length)
      : header + source;
  }

  function patchPacketMaterial(material, vertexColor) {
    if (!material || materialPatches.has(material)) {
      return;
    }

    const oldHook = material.onBeforeCompile;
    const oldKey = material.customProgramCacheKey;
    const glsl3 =
      THREE.GLSL3 !== undefined &&
      material.glslVersion === THREE.GLSL3;

    const hook = function networkPacketFilter(
      shader,
      activeRenderer
    ) {
      if (typeof oldHook === "function") {
        oldHook.call(this, shader, activeRenderer);
      }

      const vertexBounds = mainBounds(shader.vertexShader);
      const fragmentBounds = mainBounds(shader.fragmentShader);

      if (!vertexBounds || !fragmentBounds) {
        return;
      }

      shader.uniforms.uNetworkSolo = soloUniform;

      if (vertexColor) {
        const vertexCode = `
          vec3 networkColor = max(
            aNetworkPacketColor,
            vec3(0.0)
          );

          vNetworkPacketClass =
            networkColor.b > max(networkColor.r, networkColor.g)
              ? 2.0
              : (
                  networkColor.g > networkColor.r * 1.15
                    ? 3.0
                    : 1.0
                );
        `;

        shader.vertexShader =
          shader.vertexShader.slice(0, vertexBounds.start) +
          vertexCode +
          shader.vertexShader.slice(vertexBounds.start);

        shader.vertexShader = addShaderHeader(
          shader.vertexShader,
          (glsl3 ? "in" : "attribute") +
            " vec3 aNetworkPacketColor;\n" +
            (glsl3 ? "out" : "varying") +
            " float vNetworkPacketClass;\n"
        );

        shader.fragmentShader =
          shader.fragmentShader.slice(
            0,
            fragmentBounds.start
          ) +
          `
            if (
              uNetworkSolo > 0.5 &&
              abs(uNetworkSolo - vNetworkPacketClass) > 0.25
            ) {
              discard;
            }
          ` +
          shader.fragmentShader.slice(fragmentBounds.start);

        shader.fragmentShader = addShaderHeader(
          shader.fragmentShader,
          "uniform float uNetworkSolo;\n" +
            (glsl3 ? "in" : "varying") +
            " float vNetworkPacketClass;\n"
        );
      } else {
        const output =
          /\bout\s+(?:highp\s+|mediump\s+)?vec4\s+(\w+)\s*;/.exec(
            shader.fragmentShader
          );

        const outputName = output ? output[1] : "gl_FragColor";

        shader.fragmentShader =
          shader.fragmentShader.slice(0, fragmentBounds.end) +
          `
            vec3 networkColor = max(
              ${outputName}.rgb,
              vec3(0.0)
            );

            float networkClass =
              networkColor.b > max(networkColor.r, networkColor.g)
                ? 2.0
                : (
                    networkColor.g > networkColor.r * 1.15
                      ? 3.0
                      : 1.0
                  );

            if (
              uNetworkSolo > 0.5 &&
              abs(uNetworkSolo - networkClass) > 0.25
            ) {
              discard;
            }
          ` +
          shader.fragmentShader.slice(fragmentBounds.end);

        shader.fragmentShader = addShaderHeader(
          shader.fragmentShader,
          "uniform float uNetworkSolo;\n"
        );
      }
    };

    const key = function networkFilterCacheKey() {
      return (
        (typeof oldKey === "function"
          ? oldKey.call(this)
          : "") +
        "|NetworkEngine.InteractionController:" +
        (vertexColor ? "attribute" : "fragment")
      );
    };

    materialPatches.set(material, {
      oldHook,
      oldKey,
      hook,
      key
    });

    material.onBeforeCompile = hook;
    material.customProgramCacheKey = key;
    material.needsUpdate = true;
  }

  function installPacketFilters() {
    const pipeline = engine.PacketPipeline;

    if (!pipeline) {
      return;
    }

    const ready = pipeline.initialized;

    if (
      pipeline === cachedPipeline &&
      ready === cachedPipelineReady
    ) {
      return;
    }

    cachedPipeline = pipeline;
    cachedPipelineReady = ready;

    const objects = new Set();

    const visitObject = object => {
      if (
        !object ||
        !object.isObject3D ||
        object === earthGroup ||
        object === engine.scene
      ) {
        return;
      }

      object.traverse(child => {
        if (
          (child.isMesh || child.isPoints || child.isLine) &&
          !child.userData.interactionOwned
        ) {
          objects.add(child);
        }
      });
    };

    for (const key of Object.keys(pipeline)) {
      const value = pipeline[key];

      if (value && value.isObject3D) {
        visitObject(value);
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (entry && entry.isObject3D) {
            visitObject(entry);
          } else if (
            entry &&
            entry.mesh &&
            entry.mesh.isObject3D
          ) {
            visitObject(entry.mesh);
          }
        }
      }
    }

    if (objects.size === 0 && earthGroup) {
      earthGroup.traverse(object => {
        if (
          (object.isPoints || object.isMesh || object.isLine) &&
          /packet|payload|handshake|arrivalburst/i.test(
            object.name
          ) &&
          !object.userData.interactionOwned
        ) {
          objects.add(object);
        }
      });
    }

    const candidates = new Map();

    for (const object of objects) {
      const geometry = object.geometry;

      if (!geometry) {
        continue;
      }

      const attributes = geometry.attributes || {};

      let color =
        object.instanceColor ||
        attributes.color ||
        attributes.aColor;

      if (!color) {
        const key = Object.keys(attributes).find(
          name =>
            /color/i.test(name) &&
            attributes[name].itemSize >= 3
        );

        color = key ? attributes[key] : null;
      }

      if (
        color &&
        color.itemSize >= 3 &&
        !attributePatches.has(geometry)
      ) {
        const old = geometry.getAttribute(
          "aNetworkPacketColor"
        );

        geometry.setAttribute(
          "aNetworkPacketColor",
          color
        );

        attributePatches.set(geometry, {
          old,
          installed: color
        });
      }

      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];

      for (const material of materials) {
        const available = Boolean(
          color && color.itemSize >= 3
        );

        candidates.set(
          material,
          candidates.has(material)
            ? candidates.get(material) && available
            : available
        );
      }
    }

    for (const entry of candidates) {
      patchPacketMaterial(entry[0], entry[1]);
    }
  }

  function applyOrbitVisibility() {
    const orbit = engine.SatelliteOrbit;
    const group = orbit && orbit.satelliteGroup;

    if (!group) {
      return;
    }

    if (!orbitVisibility || orbitVisibility.group !== group) {
      if (orbitVisibility) {
        orbitVisibility.group.visible =
          orbitVisibility.visible;
      }

      orbitVisibility = {
        group,
        visible: group.visible
      };
    }

    group.visible =
      orbitVisibility.visible && (solo === 0 || solo === 4);
  }

  function setSoloLayer(layer) {
    if (!initialized) {
      return false;
    }

    const next = Number(layer);

    if (!Number.isInteger(next) || next < 0 || next > 4) {
      return false;
    }

    solo = next;
    soloUniform.value = solo;

    setting(
      "soloLayer",
      solo === 0 ? null : CLASS_NAMES[solo]
    );

    installPacketFilters();
    applyOrbitVisibility();
    updateIndicators();

    const chroma = engine.ChromaMatrixPass;

    if (chroma && typeof chroma.resetHistory === "function") {
      chroma.resetHistory();
    }

    return true;
  }

  function toggleLayer(layer) {
    return setSoloLayer(solo === layer ? 0 : layer);
  }

  function capturePauseModules() {
    for (const module of [
      engine.PacketPipeline,
      engine.SatelliteOrbit
    ]) {
      if (
        !module ||
        typeof module.setRunning !== "function" ||
        pausedModules.has(module)
      ) {
        continue;
      }

      let wasRunning =
        module.initialized === false
          ? true
          : module.running;

      if (
        typeof wasRunning !== "boolean" &&
        typeof module.getStats === "function"
      ) {
        wasRunning = module.getStats().running;
      }

      pausedModules.set(module, wasRunning !== false);
      module.setRunning(false);
    }

    const earth =
      engine.EarthCore && engine.EarthCore.earthGroup;

    if (earth && frozenEarth !== earth) {
      frozenEarth = earth;
      frozenRotation.copy(earth.quaternion);

      earth.traverse(object => {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];

        for (const material of materials) {
          if (!material || !material.uniforms) {
            continue;
          }

          for (const key of ["time", "uTime"]) {
            const uniform = material.uniforms[key];

            if (
              uniform &&
              typeof uniform.value === "number" &&
              !frozenUniforms.has(uniform)
            ) {
              frozenUniforms.set(uniform, uniform.value);
            }
          }
        }
      });
    }
  }

  function restorePauseModules() {
    for (const entry of pausedModules) {
      const module = entry[0];

      if (
        !module.disposed &&
        typeof module.setRunning === "function"
      ) {
        module.setRunning(entry[1]);
      }
    }

    pausedModules.clear();
    frozenUniforms.clear();
    frozenEarth = null;
  }

  function setPaused(value) {
    if (!initialized) {
      return false;
    }

    const next = Boolean(value);

    if (next === paused) {
      return true;
    }

    paused = next;
    setting("paused", paused);

    if (
      typeof engine.setPaused === "function" &&
      engine.setPaused !== setPaused
    ) {
      engine.setPaused(paused);
    }

    if (paused) {
      capturePauseModules();
      ensureFallbackFrame();
    } else {
      restorePauseModules();

      const chroma = engine.ChromaMatrixPass;

      if (chroma && typeof chroma.resetHistory === "function") {
        chroma.resetHistory();
      }
    }

    updateIndicators();
    return true;
  }

  function togglePause() {
    return setPaused(!paused);
  }

  function styleSnapshot(element, names) {
    const snapshot = {};

    for (const name of names) {
      snapshot[name] = element.style[name];
    }

    return snapshot;
  }

  function restoreStyles(element, snapshot) {
    for (const name of Object.keys(snapshot)) {
      element.style[name] = snapshot[name];
    }
  }

  function createRestoreButton() {
    if (
      restoreButton ||
      !global.document ||
      !global.document.body
    ) {
      return;
    }

    restoreButton = global.document.createElement("button");
    restoreButton.type = "button";
    restoreButton.textContent = "[ SHOW HUD ]";
    restoreButton.setAttribute(
      "aria-label",
      "Show interface"
    );

    Object.assign(restoreButton.style, {
      position: "fixed",
      right: "calc(14px + env(safe-area-inset-right, 0px))",
      bottom: "calc(14px + env(safe-area-inset-bottom, 0px))",
      zIndex: "2147483000",
      minWidth: "44px",
      minHeight: "44px",
      padding: "8px 12px",
      border: "1px solid rgba(0,255,102,0.55)",
      borderRadius: "3px",
      color: "#00ff66",
      background: "rgba(3,8,4,0.88)",
      font: "12px 'Courier New', monospace",
      cursor: "pointer",
      touchAction: "manipulation",
      display: "none"
    });

    restoreButton.addEventListener("click", toggleHud);
    global.document.body.appendChild(restoreButton);
  }

  function setHudVisible(value) {
    hudVisible = Boolean(value);
    setting("hudVisible", hudVisible);

    if (hideTimer !== null) {
      global.clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (restoreButton) {
      restoreButton.style.display = hudVisible
        ? "none"
        : "block";
    }

    if (hud) {
      if (hudVisible) {
        hud.hidden = false;
        hud.inert = false;
        hud.style.visibility = "visible";
        hud.style.opacity = "1";
        hud.style.pointerEvents =
          hudSnapshot.styles.pointerEvents || "";
        hud.setAttribute("aria-hidden", "false");
      } else {
        if (
          restoreButton &&
          hud.contains(global.document.activeElement)
        ) {
          restoreButton.focus({ preventScroll: true });
        }

        hud.inert = true;
        hud.style.opacity = "0";
        hud.style.pointerEvents = "none";
        hud.setAttribute("aria-hidden", "true");

        const hiding = hud;

        hideTimer = global.setTimeout(() => {
          hideTimer = null;

          if (!hudVisible && hud === hiding) {
            hud.hidden = true;
            hud.style.visibility = "hidden";
          }
        }, HUD_FADE_MS);
      }
    }

    updateIndicators();
    updateReticle(now(), true);

    return hudVisible;
  }

  function toggleHud() {
    return setHudVisible(!hudVisible);
  }

  function actionFor(element) {
    const action = element.getAttribute("data-action");

    if (
      element.id === "btn-hide-interface" ||
      element.id === "btn-toggle-hud" ||
      action === "toggle-hud"
    ) {
      return "h";
    }

    if (
      element.id === "btn-pause" ||
      action === "pause" ||
      action === "toggle-pause"
    ) {
      return "space";
    }

    if (
      element.id === "btn-reset-camera" ||
      action === "reset-camera"
    ) {
      return "r";
    }

    const layer = element.getAttribute("data-spectrum-layer");

    if (layer && /^[1-4]$/.test(layer)) {
      return layer;
    }

    const key =
      element.getAttribute("data-key") ||
      element.getAttribute("data-shortcut");

    if (key) {
      const normalized = key
        .toLowerCase()
        .replace(/[\[\]\s]/g, "");

      return /^(space|r|h|[1-4])$/.test(normalized)
        ? normalized
        : null;
    }

    const match = /^\s*\[?\s*(SPACE|R|H|[1-4])\b/i.exec(
      element.textContent || ""
    );

    return match ? match[1].toLowerCase() : null;
  }

  function performAction(action) {
    if (action === "space") {
      togglePause();
    } else if (action === "r") {
      resetCamera();
    } else if (action === "h") {
      toggleHud();
    } else if (/^[1-4]$/.test(action)) {
      toggleLayer(Number(action));
    }
  }

  function updateIndicators() {
    for (const entry of bindings) {
      const element = entry[0];
      const record = entry[1];

      const selected =
        record.action === "space"
          ? paused
          : record.action === "h"
            ? !hudVisible
            : record.action === "r"
              ? Boolean(
                  tween &&
                  tween.active &&
                  tween.kind === "reset"
                )
              : Number(record.action) === solo;

      element.classList.toggle("active", selected);
      element.classList.toggle("is-active", selected);
      element.setAttribute(
        "aria-pressed",
        String(selected)
      );

      if (record.action === "space") {
        element.setAttribute(
          "aria-label",
          paused ? "Resume simulation" : "Pause simulation"
        );
      } else if (record.action === "h") {
        element.setAttribute(
          "aria-label",
          hudVisible ? "Hide interface" : "Show interface"
        );
      }
    }
  }

  function refreshDom() {
    if (!global.document) {
      return;
    }

    const nextHud = first("#hud-overlay");

    if (nextHud !== hud) {
      if (hud && hudSnapshot) {
        restoreStyles(hud, hudSnapshot.styles);
        hud.hidden = hudSnapshot.hidden;
        hud.inert = hudSnapshot.inert;

        restoreAttribute(
          hud,
          "aria-hidden",
          hudSnapshot.ariaHidden
        );
      }

      hud = nextHud;

      if (hud) {
        hudSnapshot = {
          styles: styleSnapshot(hud, [
            "opacity",
            "pointerEvents",
            "visibility",
            "transition"
          ]),
          hidden: hud.hidden,
          inert: Boolean(hud.inert),
          ariaHidden: hud.getAttribute("aria-hidden")
        };

        hud.style.transition = "opacity 220ms ease";
      }
    }

    createRestoreButton();

    const nextReticle = first(
      "#focus-reticle, #reticle, [data-focus-reticle]"
    );

    if (nextReticle !== reticle) {
      if (reticle && reticleSnapshot) {
        restoreStyles(reticle, reticleSnapshot);
      }

      reticle = nextReticle;

      if (reticle) {
        reticleSnapshot = styleSnapshot(reticle, [
          "position",
          "left",
          "top",
          "visibility",
          "transform",
          "pointerEvents"
        ]);

        reticle.style.position = "fixed";
        reticle.style.pointerEvents = "none";

        const style = global.getComputedStyle(reticle);

        if (style.transform === "none") {
          reticle.style.transform = "translate(-50%, -50%)";
        }
      }
    }

    for (const entry of bindings) {
      if (entry[0].isConnected === false) {
        unbindButton(entry[0], entry[1]);
        bindings.delete(entry[0]);
      }
    }

    const buttons = global.document.querySelectorAll(
      "#btn-hide-interface, #btn-toggle-hud, #btn-pause, " +
      "#btn-reset-camera, .keybind-pill, [data-spectrum-layer], " +
      "[data-action='toggle-hud'], [data-action='toggle-pause'], " +
      "[data-action='pause'], [data-action='reset-camera']"
    );

    for (const element of buttons) {
      if (bindings.has(element)) {
        continue;
      }

      const action = actionFor(element);

      if (!action) {
        continue;
      }

      const record = {
        action,
        active: element.classList.contains("active"),
        isActive: element.classList.contains("is-active"),
        pressed: element.getAttribute("aria-pressed"),
        label: element.getAttribute("aria-label"),
        role: element.getAttribute("role"),
        tabIndex: element.getAttribute("tabindex"),
        click: null,
        keydown: null
      };

      record.click = event => {
        event.preventDefault();
        performAction(action);
      };

      record.keydown = event => {
        if (
          element.tagName !== "BUTTON" &&
          element.tagName !== "A" &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          event.stopPropagation();

          if (!event.repeat) {
            performAction(action);
          }
        }
      };

      if (
        element.tagName !== "BUTTON" &&
        element.tagName !== "A"
      ) {
        element.setAttribute("role", "button");

        if (!element.hasAttribute("tabindex")) {
          element.setAttribute("tabindex", "0");
        }
      }

      element.addEventListener("click", record.click);
      element.addEventListener("keydown", record.keydown);
      bindings.set(element, record);
    }

    updateIndicators();

    if (hud && !hudVisible) {
      hud.style.opacity = "0";
      hud.style.pointerEvents = "none";
      hud.inert = true;
    }

    if (restoreButton) {
      restoreButton.style.display = hudVisible
        ? "none"
        : "block";
    }
  }

  function updateReticle(time, force) {
    if (
      !reticle ||
      (!force && time - lastReticleTime < 33)
    ) {
      return;
    }

    lastReticleTime = time;

    if (
      !hudVisible ||
      !focusNode ||
      !focusNode.parent ||
      !updateWorld()
    ) {
      reticle.style.visibility = focusNode
        ? "hidden"
        : reticleSnapshot.visibility || "";

      if (!focusNode) {
        reticle.style.left =
          reticleSnapshot.left || "50%";
        reticle.style.top =
          reticleSnapshot.top || "50%";
      }

      if (!hudVisible) {
        reticle.style.visibility = "hidden";
      }

      return;
    }

    focusNode.getWorldPosition(worldPoint);
    projected.copy(worldPoint).project(camera);

    const visible =
      visiblePoint(worldPoint) &&
      projected.z >= -1 &&
      projected.z <= 1 &&
      Math.abs(projected.x) <= 1 &&
      Math.abs(projected.y) <= 1;

    reticle.style.visibility = visible
      ? "visible"
      : "hidden";

    if (visible) {
      const rectangle = canvas.getBoundingClientRect();

      reticle.style.left =
        (
          rectangle.left +
          (projected.x + 1) * rectangle.width * 0.5
        ).toFixed(2) + "px";

      reticle.style.top =
        (
          rectangle.top +
          (1 - projected.y) * rectangle.height * 0.5
        ).toFixed(2) + "px";
    }
  }

  function onKeyDown(event) {
    if (
      !initialized ||
      event.defaultPrevented ||
      event.repeat ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    const target = event.target;

    if (
      target &&
      (
        target.isContentEditable ||
        (
          target.closest &&
          target.closest(
            "input, textarea, select, " +
            "[role='textbox'], [role='slider']"
          )
        )
      )
    ) {
      return;
    }

    let action = String(event.key || "").toLowerCase();

    if (
      event.code === "Space" ||
      action === " " ||
      action === "spacebar"
    ) {
      if (
        target &&
        target.closest &&
        target.closest("button, a, [role='button']")
      ) {
        return;
      }

      action = "space";
    } else if (
      /^(Digit|Numpad)[1-4]$/.test(event.code || "")
    ) {
      action = event.code.slice(-1);
    }

    if (!/^(space|r|h|[1-4])$/.test(action)) {
      return;
    }

    event.preventDefault();
    performAction(action);
  }

  function onPointerDown(event) {
    pointerIds.add(event.pointerId);
    cancelTween();

    if (
      pointerIds.size > 1 ||
      event.isPrimary === false
    ) {
      gesture.moved = true;
      return;
    }

    if (event.button !== 0) {
      return;
    }

    gesture.id = event.pointerId;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    gesture.time = now();
    gesture.type = event.pointerType || "mouse";
    gesture.moved = false;
  }

  function onPointerMove(event) {
    if (event.pointerId !== gesture.id) {
      return;
    }

    const threshold = gesture.type === "touch" ? 12 : 6;

    if (
      Math.abs(event.clientX - gesture.x) > threshold ||
      Math.abs(event.clientY - gesture.y) > threshold
    ) {
      gesture.moved = true;
    }
  }

  function onPointerUp(event) {
    pointerIds.delete(event.pointerId);

    if (event.pointerId !== gesture.id) {
      return;
    }

    onPointerMove(event);
    lastGestureTime = now();

    const click =
      !gesture.moved &&
      lastGestureTime - gesture.time < 700;

    gesture.id = null;

    if (click) {
      pick(
        event.clientX,
        event.clientY,
        gesture.type
      );
    }
  }

  function onPointerCancel(event) {
    pointerIds.delete(event.pointerId);

    if (event.pointerId === gesture.id) {
      gesture.id = null;
      gesture.moved = true;
      lastGestureTime = now();
    }
  }

  function onClick(event) {
    if (
      event.detail !== 0 &&
      now() - lastGestureTime < 800
    ) {
      return;
    }

    const rectangle = canvas.getBoundingClientRect();

    pick(
      event.detail === 0
        ? rectangle.left + rectangle.width * 0.5
        : event.clientX,
      event.detail === 0
        ? rectangle.top + rectangle.height * 0.5
        : event.clientY,
      "mouse"
    );
  }

  function onWheel() {
    cancelTween();
    ensureFallbackFrame();
  }

  function onControlsChange() {
    if (paused) {
      ensureFallbackFrame();
    }
  }

  function onBlur() {
    gesture.id = null;
    gesture.moved = false;
    pointerIds.clear();
  }

  function uiFrame(time, simulationDelta) {
    if (!initialized) {
      return;
    }

    if (paused && frozenEarth) {
      frozenEarth.quaternion.copy(frozenRotation);

      for (const entry of frozenUniforms) {
        entry[0].value = entry[1];
      }
    }

    updateWorld();
    updateTween(time);
    updateRing(time);

    updateBoost(
      paused
        ? 0
        : Math.max(0, Math.min(simulationDelta, 0.1))
    );

    updateReticle(time, false);
  }

  function animationHook(delta, elapsed) {
    if (!initialized) {
      return;
    }

    lastHookTime = now();
    uiFrame(lastHookTime, finite(delta, 0));
  }

  function ensureFallbackFrame() {
    if (fallbackFrame === null && initialized) {
      fallbackFrame = global.requestAnimationFrame(
        fallbackUiFrame
      );
    }
  }

  function fallbackUiFrame() {
    fallbackFrame = null;

    if (!initialized) {
      return;
    }

    const time = now();

    if (time - lastHookTime > 40) {
      uiFrame(time, 0);
      controls.update(0);

      // Keep camera navigation responsive if the core suspends rendering.
      const frame =
        renderer.info && renderer.info.render
          ? renderer.info.render.frame
          : null;

      if (
        frame !== null &&
        frame === fallbackRenderFrame
      ) {
        if (
          engine.composer &&
          typeof engine.composer.render === "function"
        ) {
          engine.composer.render(0);
        } else {
          renderer.render(engine.scene, camera);
        }
      }

      fallbackRenderFrame =
        renderer.info && renderer.info.render
          ? renderer.info.render.frame
          : null;
    }

    if (paused || tween.active) {
      ensureFallbackFrame();
    }
  }

  function refresh() {
    if (!initialized) {
      return;
    }

    refreshPickTargets();
    installPacketFilters();
    applyOrbitVisibility();
    refreshDom();
    flushLogs();

    if (paused) {
      capturePauseModules();
    }
  }

  function restoreAttribute(element, name, value) {
    if (value === null) {
      element.removeAttribute(name);
    } else {
      element.setAttribute(name, value);
    }
  }

  function unbindButton(element, record) {
    element.removeEventListener("click", record.click);
    element.removeEventListener("keydown", record.keydown);

    element.classList.toggle("active", record.active);
    element.classList.toggle("is-active", record.isActive);

    restoreAttribute(
      element,
      "aria-pressed",
      record.pressed
    );

    restoreAttribute(
      element,
      "aria-label",
      record.label
    );

    restoreAttribute(element, "role", record.role);
    restoreAttribute(element, "tabindex", record.tabIndex);
  }

  function init() {
    if (initialized) {
      return true;
    }

    if (initializing) {
      return false;
    }

    const earth =
      engine.EarthCore && engine.EarthCore.earthGroup;

    const activeRenderer =
      engine.renderer ||
      (engine.composer && engine.composer.renderer);

    if (
      !global.THREE ||
      !engine.scene ||
      !engine.camera ||
      !engine.controls ||
      !engine.controls.target ||
      !activeRenderer ||
      !activeRenderer.domElement ||
      !earth ||
      typeof engine.registerHook !== "function"
    ) {
      return false;
    }

    initializing = true;
    destroyed = false;
    THREE = global.THREE;
    renderer = activeRenderer;
    camera = engine.camera;
    controls = engine.controls;
    canvas = renderer.domElement;
    earthGroup = earth;

    radius = finite(
      engine.EarthCore.radius,
      finite(constants().RADIUS_EARTH, 100)
    );

    try {
      raycaster = new THREE.Raycaster();
      pointer = new THREE.Vector2();
      localRay = new THREE.Ray();

      occlusionSphere = new THREE.Sphere(
        new THREE.Vector3(),
        radius
      );

      inverseEarth = new THREE.Matrix4();
      inverseEffects = new THREE.Matrix4();
      center = new THREE.Vector3();
      cameraWorld = new THREE.Vector3();
      worldPoint = new THREE.Vector3();
      localPoint = new THREE.Vector3();
      projected = new THREE.Vector3();
      scratch = new THREE.Vector3();
      scratch2 = new THREE.Vector3();
      worldScale = new THREE.Vector3();
      drawingSize = new THREE.Vector2();
      zAxis = new THREE.Vector3(0, 0, 1);
      frozenRotation = new THREE.Quaternion();

      updateWorld();

      defaultPosition = cameraWorld.clone();
      defaultTarget = controls.target.clone();
      defaultZoom = finite(camera.zoom, 1);

      tween = {
        active: false,
        kind: "",
        node: null,
        started: 0,
        fromPosition: new THREE.Vector3(),
        toPosition: new THREE.Vector3(),
        fromTarget: new THREE.Vector3(),
        toTarget: new THREE.Vector3(),
        fromDirection: new THREE.Vector3(),
        toDirection: new THREE.Vector3(),
        rotation: new THREE.Quaternion(),
        interpolatedRotation: new THREE.Quaternion(),
        focusDistance: radius * 1.35,
        fromZoom: 1,
        toZoom: 1,
        saved: {}
      };

      initialPaused = Boolean(
        engine.settings && engine.settings.paused
      );

      paused = false;
      solo = 0;
      soloUniform.value = 0;

      hudVisible =
        !engine.settings ||
        engine.settings.hudVisible !== false;

      lastHookTime = -Infinity;
      lastReticleTime = -Infinity;
      lastGestureTime = -Infinity;
      fallbackRenderFrame = -1;

      logEvent = clean(
        constants().EVENT_TERMINAL_LOG,
        "NetworkEngine:TerminalLog"
      );

      createEffects();
      initialized = true;

      global.addEventListener(logEvent, onTerminalLog);
      global.addEventListener("keydown", onKeyDown);
      global.addEventListener("pointerup", onPointerUp);
      global.addEventListener("pointercancel", onPointerCancel);
      global.addEventListener("blur", onBlur);

      canvas.addEventListener(
        "pointerdown",
        onPointerDown,
        true
      );

      canvas.addEventListener(
        "pointermove",
        onPointerMove
      );

      canvas.addEventListener("click", onClick);

      canvas.addEventListener("wheel", onWheel, {
        capture: true,
        passive: true
      });

      controls.addEventListener("start", cancelTween);
      controls.addEventListener(
        "change",
        onControlsChange
      );

      refresh();
      setHudVisible(hudVisible);

      const activeGeneration = ++generation;

      registeredHook = (delta, elapsed) => {
        if (
          initialized &&
          generation === activeGeneration
        ) {
          animationHook(delta, elapsed);
        }
      };

      hookRegistered = true;

      const registration = engine.registerHook(
        registeredHook
      );

      if (
        typeof registration === "function" &&
        registration !== registeredHook
      ) {
        unregister = registration;
      }

      refreshTimer = global.setInterval(refresh, 1000);

      if (initialPaused) {
        setPaused(true);
      }

      stopBootstrap();
      return true;
    } catch (error) {
      destroy();

      warn(
        "Initialization failed: " +
        (error.message || String(error))
      );

      return false;
    } finally {
      initializing = false;
    }
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

  function tryBootstrap() {
    if (retryTimer !== null) {
      global.clearTimeout(retryTimer);
      retryTimer = null;
    }

    if (!destroyed && !init()) {
      retryTimer = global.setTimeout(
        tryBootstrap,
        250
      );
    }
  }

  function destroy() {
    stopBootstrap();

    if (hideTimer !== null) {
      global.clearTimeout(hideTimer);
      hideTimer = null;
    }

    if (refreshTimer !== null) {
      global.clearInterval(refreshTimer);
      refreshTimer = null;
    }

    if (fallbackFrame !== null) {
      global.cancelAnimationFrame(fallbackFrame);
      fallbackFrame = null;
    }

    cancelTween();
    restorePauseModules();

    if (paused) {
      setting("paused", initialPaused);

      if (
        typeof engine.setPaused === "function" &&
        engine.setPaused !== setPaused
      ) {
        engine.setPaused(initialPaused);
      }
    }

    paused = false;
    initialized = false;
    destroyed = true;
    generation += 1;

    if (hookRegistered) {
      if (unregister) {
        unregister();
      } else if (
        typeof engine.unregisterHook === "function"
      ) {
        engine.unregisterHook(registeredHook);
      }
    }

    hookRegistered = false;
    registeredHook = null;
    unregister = null;

    global.removeEventListener(logEvent, onTerminalLog);
    global.removeEventListener("keydown", onKeyDown);
    global.removeEventListener("pointerup", onPointerUp);
    global.removeEventListener(
      "pointercancel",
      onPointerCancel
    );
    global.removeEventListener("blur", onBlur);

    if (canvas) {
      canvas.removeEventListener(
        "pointerdown",
        onPointerDown,
        true
      );

      canvas.removeEventListener(
        "pointermove",
        onPointerMove
      );

      canvas.removeEventListener("click", onClick);
      canvas.removeEventListener("wheel", onWheel, true);
    }

    if (controls) {
      controls.removeEventListener("start", cancelTween);
      controls.removeEventListener(
        "change",
        onControlsChange
      );
    }

    for (const entry of bindings) {
      unbindButton(entry[0], entry[1]);
    }

    bindings.clear();

    if (hud && hudSnapshot) {
      restoreStyles(hud, hudSnapshot.styles);
      hud.hidden = hudSnapshot.hidden;
      hud.inert = hudSnapshot.inert;

      restoreAttribute(
        hud,
        "aria-hidden",
        hudSnapshot.ariaHidden
      );
    }

    if (reticle && reticleSnapshot) {
      restoreStyles(reticle, reticleSnapshot);
    }

    if (restoreButton) {
      restoreButton.removeEventListener(
        "click",
        toggleHud
      );

      restoreButton.remove();
    }

    soloUniform.value = 0;

    if (orbitVisibility) {
      orbitVisibility.group.visible =
        orbitVisibility.visible;
    }

    for (const entry of materialPatches) {
      const material = entry[0];
      const record = entry[1];

      if (material.onBeforeCompile === record.hook) {
        material.onBeforeCompile = record.oldHook;
      }

      if (material.customProgramCacheKey === record.key) {
        material.customProgramCacheKey = record.oldKey;
      }

      material.needsUpdate = true;
    }

    for (const entry of attributePatches) {
      const geometry = entry[0];
      const record = entry[1];

      if (
        geometry.getAttribute("aNetworkPacketColor") ===
        record.installed
      ) {
        if (record.old) {
          geometry.setAttribute(
            "aNetworkPacketColor",
            record.old
          );
        } else {
          geometry.deleteAttribute(
            "aNetworkPacketColor"
          );
        }
      }
    }

    clearSelection();

    if (effectGroup) {
      if (effectGroup.parent) {
        effectGroup.parent.remove(effectGroup);
      }

      effectGroup.traverse(object => {
        if (object.geometry) {
          object.geometry.dispose();
        }

        if (object.material) {
          object.material.dispose();
        }
      });
    }

    materialPatches.clear();
    attributePatches.clear();
    nodeLookup.clear();
    routeLookup.clear();
    curveLookup.clear();

    pickTargets.length = 0;
    stations.length = 0;
    intersections.length = 0;
    pendingLogs.length = 0;
    pointerIds.clear();
    gesture.id = null;

    hud = null;
    hudSnapshot = null;
    restoreButton = null;
    reticle = null;
    reticleSnapshot = null;
    orbitVisibility = null;
    cachedPipeline = null;
    cachedPipelineReady = null;
    effectGroup = null;
    selectionRing = null;
    boostPoints = null;
    boostPosition = null;
    boostColor = null;
    boostFade = null;
    boostClass = null;
    boostProgress = null;
    boostSpeed = null;
    boostDirection = null;
    tween = null;
    canvas = null;
    controls = null;
    camera = null;
    renderer = null;
  }

  engine.InteractionController = Object.freeze({
    moduleId: MODULE_ID,
    init,
    destroy,
    setPaused,
    togglePause,
    resetCamera,
    focusStation,
    selectRoute,
    setSoloLayer,
    toggleLayer,
    setHudVisible,
    toggleHud,
    clearSelection,

    get initialized() {
      return initialized;
    },

    get destroyed() {
      return destroyed;
    },

    get paused() {
      return paused;
    },

    get soloLayer() {
      return solo === 0 ? null : CLASS_NAMES[solo];
    },

    get hudVisible() {
      return hudVisible;
    },

    get selectedStationId() {
      return focusStationId;
    },

    get selectedRouteId() {
      return selectedCable ? selectedCable.id : null;
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