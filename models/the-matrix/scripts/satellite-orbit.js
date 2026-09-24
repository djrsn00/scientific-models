(function installSatelliteOrbit(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.SatelliteOrbit";
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  const PLANE_COUNT = 8;
  const SATELLITES_PER_PLANE = 30;
  const SATELLITE_COUNT = PLANE_COUNT * SATELLITES_PER_PLANE;
  const WALKER_PHASE = 3;

  const LASER_CAPACITY = 12;
  const LASER_LIFETIME = 0.45;
  const MIN_ELEVATION = Math.sin(8 * DEG);
  const MIN_ELEVATION_SQUARED = MIN_ELEVATION * MIN_ELEVATION;

  const terrestrialClasses = new Set([
    "HTTP_PING",
    "BACKUP_PAYLOAD",
    "TLS_HANDSHAKE"
  ]);

  if (
    engine.SatelliteOrbit &&
    engine.SatelliteOrbit.moduleId === MODULE_ID &&
    !engine.SatelliteOrbit.disposed
  ) {
    engine.SatelliteOrbit.init();
    return;
  }

  const satellites = [];
  const planes = [];
  const orbitTracks = [];
  const laserPool = [];
  const activeUplinks = [];

  const stationAnchors = Object.create(null);
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();
  const ownedTextures = new Set();
  const timeUniform = { value: 0 };

  let THREE = null;
  let satelliteGroup = null;
  let satelliteMesh = null;
  let satelliteGlow = null;
  let glowPositions = null;

  let planetRadius = 100;
  let orbitRadius = 135;
  let visualScale = 1;
  let angularVelocity = 0.095;
  let probability = 0.30;
  let simulationTime = 0;

  let running = true;
  let initialized = false;
  let initializing = false;
  let disposed = false;
  let registered = false;
  let unsubscribe = null;

  let arrivalListenerBound = false;
  let arrivalEvent = "NetworkEngine:PacketArrived";
  let handoverEvent = "NetworkEngine:LaserHandover";

  let bootstrapTimer = null;
  let bootstrapDelay = 50;
  let hudObserver = null;

  let receivedArrivals = 0;
  let handoverCount = 0;
  let unavailableCount = 0;

  let inverseEarth = null;
  let inverseOrbit = null;
  let inverseScene = null;
  let earthInScene = null;
  let earthNormalMatrix = null;
  let workMatrix = null;

  let groundLocal = null;
  let groundNormal = null;
  let groundWorld = null;
  let difference = null;
  let beamDirection = null;
  let upAxis = null;

  function positive(value, fallback) {
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function ownGeometry(geometry) {
    ownedGeometries.add(geometry);
    return geometry;
  }

  function ownMaterial(material) {
    ownedMaterials.add(material);
    return material;
  }

  function eventName(value, fallback) {
    return typeof value === "string" && value.trim() ? value : fallback;
  }

  function createStationAnchors(contract) {
    if (
      !contract.stations ||
      typeof contract.stations !== "object" ||
      typeof contract.latLonToVector3 !== "function"
    ) {
      throw new TypeError(
        "SatelliteOrbit requires stations and latLonToVector3 in DataContract."
      );
    }

    const cables = engine.CableMatrix;
    const surfaceRadius = cables
      ? positive(cables.surfaceRadius, planetRadius * 1.004)
      : planetRadius * 1.004;

    for (const station of Object.values(contract.stations)) {
      if (
        !station ||
        typeof station.id !== "string" ||
        !station.id.trim() ||
        !Number.isFinite(station.lat) ||
        station.lat < -90 ||
        station.lat > 90 ||
        !Number.isFinite(station.lon) ||
        station.lon < -180 ||
        station.lon > 180
      ) {
        throw new TypeError("SatelliteOrbit found an invalid landing station.");
      }

      const point = contract.latLonToVector3(
        station.lat,
        station.lon,
        surfaceRadius
      );

      if (
        !point ||
        !point.isVector3 ||
        !Number.isFinite(point.lengthSq()) ||
        point.lengthSq() <= 0
      ) {
        throw new TypeError(
          "SatelliteOrbit received invalid coordinates for " + station.id
        );
      }

      stationAnchors[station.id] = point.clone();
    }
  }

  function createGlowTexture() {
    const size = 32;
    const data = new Uint8Array(size * size * 4);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const dx = (x + 0.5) / size * 2 - 1;
        const dy = (y + 0.5) / size * 2 - 1;
        const distance = dx * dx + dy * dy;
        const edge = Math.max(0, 1 - distance);
        const offset = (y * size + x) * 4;

        data[offset] = 255;
        data[offset + 1] = 255;
        data[offset + 2] = 255;
        data[offset + 3] = Math.round(
          255 * Math.exp(-distance * 4) * edge * edge
        );
      }
    }

    const texture = new THREE.DataTexture(
      data,
      size,
      size,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );

    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    ownedTextures.add(texture);

    return texture;
  }

  function createConstellation() {
    const trackSegments = 192;
    const trackPositions = new Float32Array(trackSegments * 3);

    for (let i = 0; i < trackSegments; i += 1) {
      const angle = TAU * i / trackSegments;

      trackPositions[i * 3] = Math.cos(angle) * orbitRadius;
      trackPositions[i * 3 + 1] = Math.sin(angle) * orbitRadius;
    }

    const trackGeometry = ownGeometry(new THREE.BufferGeometry());

    trackGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(trackPositions, 3)
    );
    trackGeometry.computeBoundingSphere();

    const trackMaterial = ownMaterial(new THREE.LineBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.055,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    }));

    for (let planeIndex = 0; planeIndex < PLANE_COUNT; planeIndex += 1) {
      const ascendingNode = TAU * planeIndex / PLANE_COUNT;
      const inclinationDegrees = 45 + 27 * planeIndex / (PLANE_COUNT - 1);
      const inclination = inclinationDegrees * DEG;

      const cosine = Math.cos(ascendingNode);
      const sine = Math.sin(ascendingNode);
      const cosInclination = Math.cos(inclination);
      const sinInclination = Math.sin(inclination);

      // Y-up orbital basis: u is the ascending node, v points northward.
      const u = new THREE.Vector3(cosine, 0, -sine);
      const v = new THREE.Vector3(
        -sine * cosInclination,
        sinInclination,
        -cosine * cosInclination
      );
      const normal = new THREE.Vector3().crossVectors(u, v).normalize();

      const track = new THREE.LineLoop(trackGeometry, trackMaterial);

      track.name = "orbitTrack:" + (planeIndex + 1);
      track.matrix.makeBasis(u, v, normal);
      track.matrixAutoUpdate = false;
      track.matrixWorldNeedsUpdate = true;
      track.renderOrder = 2;

      track.userData.planeIndex = planeIndex;
      track.userData.inclinationDegrees = inclinationDegrees;

      satelliteGroup.add(track);
      orbitTracks.push(track);

      planes.push({
        index: planeIndex,
        ascendingNode,
        inclination,
        inclinationDegrees,
        u,
        v,
        normal,
        track
      });

      for (let slot = 0; slot < SATELLITES_PER_PLANE; slot += 1) {
        const phase = (
          TAU * slot / SATELLITES_PER_PLANE +
          TAU * WALKER_PHASE * planeIndex / SATELLITE_COUNT
        ) % TAU;

        const index = satellites.length;

        satellites.push({
          id: "LEO-P" + String(planeIndex + 1).padStart(2, "0") +
            "-S" + String(slot + 1).padStart(2, "0"),
          index,
          planeIndex,
          slotIndex: slot,
          phase,
          meanAnomaly: phase,
          angularVelocity,
          position: new THREE.Vector3(),
          worldPosition: new THREE.Vector3()
        });
      }
    }

    const diamondGeometry = ownGeometry(
      new THREE.OctahedronGeometry(1, 0)
    );

    const diamondMaterial = ownMaterial(new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.96,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    }));

    satelliteMesh = new THREE.InstancedMesh(
      diamondGeometry,
      diamondMaterial,
      SATELLITE_COUNT
    );

    satelliteMesh.name = "LEOConstellation";
    satelliteMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    satelliteMesh.frustumCulled = false;
    satelliteMesh.renderOrder = 7;
    satelliteMesh.userData.satelliteIds = satellites.map(
      satellite => satellite.id
    );

    satelliteGroup.add(satelliteMesh);

    const glowGeometry = ownGeometry(new THREE.BufferGeometry());

    glowPositions = new THREE.BufferAttribute(
      new Float32Array(SATELLITE_COUNT * 3),
      3
    );

    glowPositions.setUsage(THREE.DynamicDrawUsage);
    glowGeometry.setAttribute("position", glowPositions);

    const glowMaterial = ownMaterial(new THREE.PointsMaterial({
      color: 0x00f0ff,
      map: createGlowTexture(),
      size: 3.8 * visualScale,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false
    }));

    satelliteGlow = new THREE.Points(glowGeometry, glowMaterial);
    satelliteGlow.name = "LEOGlows";
    satelliteGlow.frustumCulled = false;
    satelliteGlow.renderOrder = 6;

    satelliteGroup.add(satelliteGlow);
  }

  function createLaserPool() {
    const geometry = ownGeometry(
      new THREE.CylinderGeometry(1, 1, 1, 6, 12, true)
    );

    const coreRadius = 0.055 * visualScale;
    const haloRadius = 0.23 * visualScale;
    const jitterRadius = 0.085 * visualScale;
    const cyan = new THREE.Color(0x00f0ff);

    const chunks = THREE.ShaderChunk || {};
    const output = chunks.colorspace_fragment
      ? "#include <colorspace_fragment>"
      : chunks.encodings_fragment
        ? "#include <encodings_fragment>"
        : "";

    const vertexShader = `
      uniform float time;
      uniform float phase;
      uniform float jitterAmplitude;

      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 p = position;
        float along = clamp(position.y + 0.5, 0.0, 1.0);
        float envelope = 4.0 * along * (1.0 - along);

        p.x += sin(along * 34.0 + time * 89.0 + phase) *
          envelope * jitterAmplitude;

        p.z += cos(along * 47.0 + time * 113.0 + phase) *
          envelope * jitterAmplitude;

        vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);

        vNormal = normalize(normalMatrix * normal);
        vViewPosition = -viewPosition.xyz;

        gl_Position = projectionMatrix * viewPosition;
      }
    `;

    const fragmentShader = `
      uniform vec3 color;
      uniform float opacity;

      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        float facing = abs(dot(
          normalize(vNormal),
          normalize(vViewPosition)
        ));

        float softness = pow(clamp(facing, 0.0, 1.0), 0.55);
        float alpha = opacity * softness;

        if (alpha < 0.001) {
          discard;
        }

        gl_FragColor = vec4(color, alpha);

        ${output}
      }
    `;

    for (let i = 0; i < LASER_CAPACITY; i += 1) {
      const phaseUniform = { value: Math.random() * TAU };

      const coreUniforms = {
        time: timeUniform,
        phase: phaseUniform,
        jitterAmplitude: { value: jitterRadius / coreRadius },
        color: { value: cyan },
        opacity: { value: 0 }
      };

      const haloUniforms = {
        time: timeUniform,
        phase: phaseUniform,
        jitterAmplitude: { value: jitterRadius / haloRadius },
        color: { value: cyan },
        opacity: { value: 0 }
      };

      const coreMaterial = ownMaterial(new THREE.ShaderMaterial({
        uniforms: coreUniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      }));

      const haloMaterial = ownMaterial(new THREE.ShaderMaterial({
        uniforms: haloUniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      }));

      const laserMesh = new THREE.Mesh(geometry, coreMaterial);

      laserMesh.name = "spaceLaser:" + i;
      laserMesh.visible = false;
      laserMesh.frustumCulled = false;
      laserMesh.renderOrder = 9;

      const haloMesh = new THREE.Mesh(geometry, haloMaterial);

      haloMesh.name = "spaceLaserHalo:" + i;
      haloMesh.scale.set(
        haloRadius / coreRadius,
        1,
        haloRadius / coreRadius
      );
      haloMesh.frustumCulled = false;
      haloMesh.renderOrder = 8;

      laserMesh.add(haloMesh);
      satelliteGroup.add(laserMesh);

      laserPool.push({
        laserMesh,
        haloMesh,
        stationVector: new THREE.Vector3(),
        startLocal: new THREE.Vector3(),
        endLocal: new THREE.Vector3(),
        satelliteIndex: -1,
        stationId: "",
        lifetime: 0,
        maxLifetime: LASER_LIFETIME,
        active: false,
        coreRadius,
        phaseUniform,
        coreUniforms,
        haloUniforms
      });
    }
  }

  function updateFrameTransforms() {
    const earth = engine.EarthCore;
    const scene = engine.scene;

    if (
      !earth ||
      earth.disposed ||
      !earth.earthGroup ||
      !scene ||
      !satelliteGroup ||
      satelliteGroup.parent !== scene
    ) {
      return false;
    }

    earth.earthGroup.updateWorldMatrix(true, false);
    scene.updateWorldMatrix(true, false);

    inverseEarth.copy(earth.earthGroup.matrixWorld).invert();
    earthNormalMatrix.getNormalMatrix(earth.earthGroup.matrixWorld);
    inverseScene.copy(scene.matrixWorld).invert();

    earthInScene.multiplyMatrices(
      inverseScene,
      earth.earthGroup.matrixWorld
    );

    // Follow the planet's center and scale without inheriting its axial rotation.
    satelliteGroup.position.setFromMatrixPosition(earthInScene);
    satelliteGroup.scale.setFromMatrixScale(earthInScene);
    satelliteGroup.updateWorldMatrix(true, false);

    inverseOrbit.copy(satelliteGroup.matrixWorld).invert();

    return true;
  }

  function updateSatellites(delta) {
    const sx = 0.64 * visualScale;
    const sy = 0.35 * visualScale;
    const sz = 0.72 * visualScale;
    const glowArray = glowPositions.array;

    for (let i = 0; i < satellites.length; i += 1) {
      const satellite = satellites[i];
      const plane = planes[satellite.planeIndex];

      satellite.meanAnomaly = (
        satellite.meanAnomaly + satellite.angularVelocity * delta
      ) % TAU;

      const cosine = Math.cos(satellite.meanAnomaly);
      const sine = Math.sin(satellite.meanAnomaly);

      const rx = plane.u.x * cosine + plane.v.x * sine;
      const ry = plane.u.y * cosine + plane.v.y * sine;
      const rz = plane.u.z * cosine + plane.v.z * sine;

      const tx = -plane.u.x * sine + plane.v.x * cosine;
      const ty = -plane.u.y * sine + plane.v.y * cosine;
      const tz = -plane.u.z * sine + plane.v.z * cosine;

      satellite.position.set(
        rx * orbitRadius,
        ry * orbitRadius,
        rz * orbitRadius
      );

      workMatrix.set(
        tx * sx, plane.normal.x * sy, rx * sz, satellite.position.x,
        ty * sx, plane.normal.y * sy, ry * sz, satellite.position.y,
        tz * sx, plane.normal.z * sy, rz * sz, satellite.position.z,
        0, 0, 0, 1
      );

      satelliteMesh.setMatrixAt(i, workMatrix);

      glowArray[i * 3] = satellite.position.x;
      glowArray[i * 3 + 1] = satellite.position.y;
      glowArray[i * 3 + 2] = satellite.position.z;

      satellite.worldPosition
        .copy(satellite.position)
        .applyMatrix4(satelliteGroup.matrixWorld);
    }

    satelliteMesh.instanceMatrix.needsUpdate = true;
    glowPositions.needsUpdate = true;
  }

  function refreshSatelliteWorldPositions() {
    for (let i = 0; i < satellites.length; i += 1) {
      satellites[i].worldPosition
        .copy(satellites[i].position)
        .applyMatrix4(satelliteGroup.matrixWorld);
    }
  }

  function resolveStationWorld(stationId, target) {
    const anchor = stationAnchors[stationId];

    if (!anchor) {
      return false;
    }

    const cables = engine.CableMatrix;
    const node = cables && cables.nodes && cables.nodes[stationId];

    if (node && typeof node.getWorldPosition === "function") {
      node.getWorldPosition(target);
    } else {
      target
        .copy(anchor)
        .applyMatrix4(engine.EarthCore.earthGroup.matrixWorld);
    }

    return (
      Number.isFinite(target.x) &&
      Number.isFinite(target.y) &&
      Number.isFinite(target.z)
    );
  }

  function computeGroundNormal(stationVector) {
    groundLocal.copy(stationVector).applyMatrix4(inverseEarth);

    if (groundLocal.lengthSq() < planetRadius * planetRadius * 0.99999) {
      return false;
    }

    groundNormal
      .copy(groundLocal)
      .applyMatrix3(earthNormalMatrix)
      .normalize();

    return groundNormal.lengthSq() > 0;
  }

  function hasLineOfSight(stationVector, satellitePosition) {
    difference.subVectors(satellitePosition, stationVector);

    const distanceSquared = difference.lengthSq();

    if (distanceSquared <= 1e-12) {
      return false;
    }

    const elevation = difference.dot(groundNormal);

    return (
      elevation > 0 &&
      elevation * elevation >=
        distanceSquared * MIN_ELEVATION_SQUARED
    );
  }

  function nearestVisibleSatellite(stationVector) {
    if (!computeGroundNormal(stationVector)) {
      return -1;
    }

    let nearest = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < satellites.length; i += 1) {
      const position = satellites[i].worldPosition;

      difference.subVectors(position, stationVector);

      const distanceSquared = difference.lengthSq();

      if (distanceSquared >= bestDistance || distanceSquared <= 1e-12) {
        continue;
      }

      const elevation = difference.dot(groundNormal);

      if (
        elevation <= 0 ||
        elevation * elevation < distanceSquared * MIN_ELEVATION_SQUARED
      ) {
        continue;
      }

      nearest = i;
      bestDistance = distanceSquared;
    }

    return nearest;
  }

  function acquireLaser(stationId) {
    for (let i = 0; i < activeUplinks.length; i += 1) {
      if (activeUplinks[i].stationId === stationId) {
        return activeUplinks[i];
      }
    }

    for (let i = 0; i < laserPool.length; i += 1) {
      if (!laserPool[i].active) {
        laserPool[i].active = true;
        activeUplinks.push(laserPool[i]);

        return laserPool[i];
      }
    }

    let oldest = activeUplinks[0];

    for (let i = 1; i < activeUplinks.length; i += 1) {
      if (activeUplinks[i].lifetime > oldest.lifetime) {
        oldest = activeUplinks[i];
      }
    }

    return oldest;
  }

  function releaseLaser(index) {
    const beam = activeUplinks[index];
    const last = activeUplinks.pop();

    if (index < activeUplinks.length) {
      activeUplinks[index] = last;
    }

    beam.active = false;
    beam.laserMesh.visible = false;
    beam.coreUniforms.opacity.value = 0;
    beam.haloUniforms.opacity.value = 0;
    beam.stationId = "";
    beam.satelliteIndex = -1;
  }

  function clearLasers() {
    while (activeUplinks.length > 0) {
      releaseLaser(activeUplinks.length - 1);
    }
  }

  function placeLaser(beam) {
    const satellite = satellites[beam.satelliteIndex];

    beam.startLocal.copy(beam.stationVector).applyMatrix4(inverseOrbit);
    beam.endLocal.copy(satellite.position);

    beamDirection.subVectors(beam.endLocal, beam.startLocal);

    const length = beamDirection.length();

    if (!Number.isFinite(length) || length <= 1e-8) {
      return false;
    }

    beam.laserMesh.position
      .copy(beam.startLocal)
      .add(beam.endLocal)
      .multiplyScalar(0.5);

    beamDirection.multiplyScalar(1 / length);
    beam.laserMesh.quaternion.setFromUnitVectors(upAxis, beamDirection);

    const phase = beam.phaseUniform.value;
    const flicker = 0.88 + 0.12 * Math.sin(simulationTime * 105 + phase);
    const pulse = 1 + 0.075 * Math.sin(simulationTime * 91 + phase);
    const age = Math.min(1, beam.lifetime / beam.maxLifetime);
    const fade = Math.pow(1 - age, 1.45);

    beam.laserMesh.scale.set(
      beam.coreRadius * pulse,
      length,
      beam.coreRadius * pulse
    );

    beam.coreUniforms.opacity.value = 0.98 * fade * flicker;
    beam.haloUniforms.opacity.value = 0.24 * fade * flicker;
    beam.laserMesh.visible = true;

    return true;
  }

  function triggerHandover(stationId) {
    if (
      !initialized ||
      disposed ||
      !running ||
      typeof stationId !== "string" ||
      !stationAnchors[stationId]
    ) {
      return false;
    }

    if (!updateFrameTransforms()) {
      return false;
    }

    refreshSatelliteWorldPositions();

    if (!resolveStationWorld(stationId, groundWorld)) {
      return false;
    }

    const satelliteIndex = nearestVisibleSatellite(groundWorld);

    if (satelliteIndex < 0) {
      unavailableCount += 1;
      return false;
    }

    const beam = acquireLaser(stationId);

    beam.stationId = stationId;
    beam.stationVector.copy(groundWorld);
    beam.satelliteIndex = satelliteIndex;
    beam.lifetime = 0;
    beam.phaseUniform.value = Math.random() * TAU;

    beam.laserMesh.userData.stationId = stationId;
    beam.laserMesh.userData.satelliteId = satellites[satelliteIndex].id;

    if (!placeLaser(beam)) {
      releaseLaser(activeUplinks.indexOf(beam));
      return false;
    }

    handoverCount += 1;

    const detail = {
      stationId,
      satelliteId: satellites[satelliteIndex].id,
      frequencyThz: 193.4,
      uplinkLatencyMs: 3.8,
      timestamp: Date.now()
    };

    // Publish after initialization so listeners may safely inspect or dispose it.
    global.dispatchEvent(new global.CustomEvent(handoverEvent, { detail }));

    return true;
  }

  function onPacketArrived(event) {
    if (!initialized || disposed || !running) {
      return;
    }

    const detail = event && event.detail;

    if (!detail || !terrestrialClasses.has(detail.packetClass)) {
      return;
    }

    receivedArrivals += 1;

    if (Math.random() < probability) {
      triggerHandover(detail.targetStation);
    }
  }

  function animationHook(delta, elapsed) {
    if (!initialized || disposed) {
      return;
    }

    if (!updateFrameTransforms()) {
      dispose();
      return;
    }

    const dt = running && Number.isFinite(delta) && delta > 0
      ? Math.min(delta, 0.1)
      : 0;

    simulationTime += dt;
    timeUniform.value = simulationTime % TAU;

    updateSatellites(dt);

    for (let i = activeUplinks.length - 1; i >= 0; i -= 1) {
      const beam = activeUplinks[i];

      beam.lifetime += dt;

      if (
        beam.lifetime >= beam.maxLifetime ||
        !resolveStationWorld(beam.stationId, beam.stationVector) ||
        !computeGroundNormal(beam.stationVector) ||
        !hasLineOfSight(
          beam.stationVector,
          satellites[beam.satelliteIndex].worldPosition
        ) ||
        !placeLaser(beam)
      ) {
        releaseLaser(i);
      }
    }
  }

  function updateNodeCount() {
    if (!initialized || disposed || !global.document) {
      return false;
    }

    const element = global.document.getElementById("node-count");

    if (!element) {
      return false;
    }

    element.textContent = String(satellites.length);

    if (hudObserver) {
      hudObserver.disconnect();
      hudObserver = null;
    }

    return true;
  }

  function connectHud() {
    if (
      updateNodeCount() ||
      !global.document ||
      !global.document.documentElement ||
      typeof global.MutationObserver !== "function"
    ) {
      return;
    }

    hudObserver = new global.MutationObserver(updateNodeCount);

    hudObserver.observe(global.document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function setRunning(enabled) {
    running = Boolean(enabled);

    if (!running) {
      clearLasers();
    }
  }

  function setHandoverProbability(value) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(
        "SatelliteOrbit handover probability must be between 0 and 1."
      );
    }

    probability = value;
  }

  function getStats() {
    return {
      initialized,
      running: running && initialized && !disposed,
      satellites: satellites.length,
      orbitalPlanes: planes.length,
      activeUplinks: activeUplinks.length,
      laserCapacity: LASER_CAPACITY,
      receivedPacketEvents: receivedArrivals,
      completedHandovers: handoverCount,
      unavailableHandovers: unavailableCount,
      handoverProbability: probability,
      simulationSeconds: simulationTime
    };
  }

  function stopBootstrap() {
    if (bootstrapTimer !== null) {
      global.clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }

    global.removeEventListener("NetworkEngine:Ready", tryBootstrap);

    if (global.document) {
      global.document.removeEventListener("DOMContentLoaded", tryBootstrap);
    }
  }

  function init() {
    if (initialized) {
      return true;
    }

    if (disposed || initializing) {
      return false;
    }

    const contract = engine.DataContract;
    const earth = engine.EarthCore;

    if (
      !global.THREE ||
      !contract ||
      !earth ||
      !engine.scene ||
      typeof engine.scene.add !== "function" ||
      typeof engine.registerHook !== "function"
    ) {
      return false;
    }

    if (!earth.earthGroup && typeof earth.init === "function") {
      earth.init();
    }

    if (!earth.earthGroup) {
      return false;
    }

    initializing = true;
    THREE = global.THREE;

    try {
      const constants = contract.constants || {};

      planetRadius = positive(
        earth.radius,
        positive(
          constants.RADIUS_EARTH,
          positive(constants.PLANET_RADIUS, 100)
        )
      );

      orbitRadius = positive(
        constants.RADIUS_LEO,
        positive(constants.LEO_SHELL_RADIUS, 135)
      );

      if (orbitRadius <= planetRadius * 1.025) {
        throw new RangeError(
          "SatelliteOrbit requires a LEO shell outside the planetary atmosphere."
        );
      }

      visualScale = planetRadius / 100;
      angularVelocity = positive(constants.LEO_ANGULAR_VELOCITY, 0.095);

      arrivalEvent = eventName(
        constants.EVENT_PACKET_ARRIVED,
        "NetworkEngine:PacketArrived"
      );

      handoverEvent = eventName(
        constants.EVENT_LASER_HANDOVER,
        "NetworkEngine:LaserHandover"
      );

      inverseEarth = new THREE.Matrix4();
      inverseOrbit = new THREE.Matrix4();
      inverseScene = new THREE.Matrix4();
      earthInScene = new THREE.Matrix4();
      earthNormalMatrix = new THREE.Matrix3();
      workMatrix = new THREE.Matrix4();

      groundLocal = new THREE.Vector3();
      groundNormal = new THREE.Vector3();
      groundWorld = new THREE.Vector3();
      difference = new THREE.Vector3();
      beamDirection = new THREE.Vector3();
      upAxis = new THREE.Vector3(0, 1, 0);

      createStationAnchors(contract);

      satelliteGroup = new THREE.Group();
      satelliteGroup.name = "satelliteGroup";

      satelliteGroup.userData.planetRadius = planetRadius;
      satelliteGroup.userData.orbitRadius = orbitRadius;
      satelliteGroup.userData.satelliteCount = SATELLITE_COUNT;
      satelliteGroup.userData.orbitalPlanes = PLANE_COUNT;

      createConstellation();
      createLaserPool();

      engine.scene.add(satelliteGroup);

      if (!updateFrameTransforms()) {
        throw new Error("SatelliteOrbit could not initialize its scene frame.");
      }

      updateSatellites(0);
      initialized = true;

      global.addEventListener(arrivalEvent, onPacketArrived);
      arrivalListenerBound = true;
      registered = true;

      const registration = engine.registerHook(animationHook);

      if (
        typeof registration === "function" &&
        registration !== animationHook
      ) {
        unsubscribe = registration;
      }

      connectHud();
      stopBootstrap();

      return true;
    } catch (error) {
      dispose();
      throw error;
    } finally {
      initializing = false;
    }
  }

  function tryBootstrap() {
    if (bootstrapTimer !== null) {
      global.clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }

    if (disposed || init()) {
      return;
    }

    bootstrapTimer = global.setTimeout(tryBootstrap, bootstrapDelay);
    bootstrapDelay = Math.min(bootstrapDelay * 2, 1000);
  }

  function dispose() {
    if (disposed) {
      return;
    }

    disposed = true;
    initialized = false;

    stopBootstrap();

    if (arrivalListenerBound) {
      global.removeEventListener(arrivalEvent, onPacketArrived);
      arrivalListenerBound = false;
    }

    if (hudObserver) {
      hudObserver.disconnect();
      hudObserver = null;
    }

    try {
      if (unsubscribe) {
        unsubscribe();
      } else if (
        registered &&
        typeof engine.unregisterHook === "function"
      ) {
        engine.unregisterHook(animationHook);
      }
    } finally {
      unsubscribe = null;
      registered = false;

      clearLasers();

      if (satelliteGroup && satelliteGroup.parent) {
        satelliteGroup.parent.remove(satelliteGroup);
      }

      if (satelliteMesh && typeof satelliteMesh.dispose === "function") {
        satelliteMesh.dispose();
      }

      for (const geometry of ownedGeometries) {
        geometry.dispose();
      }

      for (const material of ownedMaterials) {
        material.dispose();
      }

      for (const texture of ownedTextures) {
        texture.dispose();
      }

      ownedGeometries.clear();
      ownedMaterials.clear();
      ownedTextures.clear();

      satellites.length = 0;
      planes.length = 0;
      orbitTracks.length = 0;
      laserPool.length = 0;

      for (const id of Object.keys(stationAnchors)) {
        delete stationAnchors[id];
      }

      if (global.document) {
        const element = global.document.getElementById("node-count");

        if (element && element.textContent === String(SATELLITE_COUNT)) {
          element.textContent = "0";
        }
      }

      satelliteGroup = null;
      satelliteMesh = null;
      satelliteGlow = null;
      glowPositions = null;

      inverseEarth = null;
      inverseOrbit = null;
      inverseScene = null;
      earthInScene = null;
      earthNormalMatrix = null;
      workMatrix = null;

      groundLocal = null;
      groundNormal = null;
      groundWorld = null;
      difference = null;
      beamDirection = null;
      upAxis = null;
    }
  }

  // Satellite positions are orbit-local; worldPosition and stationVector are world-space.
  // Orbital angular velocity is measured in radians per simulation second.
  engine.SatelliteOrbit = Object.freeze({
    moduleId: MODULE_ID,

    init,
    dispose,
    setRunning,
    setHandoverProbability,
    triggerHandover,
    getStats,

    satellites,
    planes,
    orbitTracks,
    laserPool,
    activeUplinks,

    get initialized() {
      return initialized;
    },

    get disposed() {
      return disposed;
    },

    get running() {
      return running && initialized && !disposed;
    },

    get satelliteGroup() {
      return satelliteGroup;
    },

    get satelliteMesh() {
      return satelliteMesh;
    },

    get satelliteGlow() {
      return satelliteGlow;
    },

    get planetRadius() {
      return planetRadius;
    },

    get orbitRadius() {
      return orbitRadius;
    }
  });

  global.addEventListener("NetworkEngine:Ready", tryBootstrap);

  if (global.document) {
    global.document.addEventListener(
      "DOMContentLoaded",
      tryBootstrap,
      { once: true }
    );
  }

  tryBootstrap();
})(window);