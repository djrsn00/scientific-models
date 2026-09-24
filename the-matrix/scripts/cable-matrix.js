// scripts/cable-matrix.js

(function installCableMatrix(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.CableMatrix";
  const TAU = Math.PI * 2;
  const ANGLE_EPSILON = 1e-12;

  if (
    engine.CableMatrix &&
    engine.CableMatrix.moduleId === MODULE_ID &&
    !engine.CableMatrix.disposed
  ) {
    engine.CableMatrix.init();
    return;
  }

  const curves = Object.create(null);
  const nodes = Object.create(null);
  const stationPositions = Object.create(null);
  const routeMeshes = Object.create(null);
  const pickables = [];
  const pulseRecords = [];
  const ownedGeometries = new Set();
  const ownedMaterials = new Set();

  let THREE = null;
  let cableGroup = null;
  let radius = 100;
  let surfaceRadius = 100.4;
  let tubeRadius = 0.32;
  let sampleSegments = 64;
  let initialized = false;
  let initializing = false;
  let disposed = false;
  let registered = false;
  let unsubscribe = null;
  let bootstrapTimer = null;
  let bootstrapDelay = 50;
  let pulsingEnabled = true;
  let animationTime = 0;

  function ownGeometry(geometry) {
    ownedGeometries.add(geometry);
    return geometry;
  }

  function ownMaterial(material) {
    ownedMaterials.add(material);
    return material;
  }

  function clearDictionary(dictionary) {
    for (const key of Object.keys(dictionary)) {
      delete dictionary[key];
    }
  }

  function isCoreHub(tier) {
    const label = String(tier)
      .toUpperCase()
      .replace(/[\s_-]+/g, "");

    return /^(1|T1|TIER1(CORE(HUB)?)?|CORE(HUB)?)$/.test(label);
  }

  function stationPhase(id) {
    let hash = 2166136261;

    for (let i = 0; i < id.length; i += 1) {
      hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
    }

    return ((hash >>> 0) / 4294967296) * TAU;
  }

  function validateContract(contract) {
    if (
      !contract.stations ||
      typeof contract.stations !== "object" ||
      Array.isArray(contract.stations) ||
      !Array.isArray(contract.routes) ||
      typeof contract.latLonToVector3 !== "function"
    ) {
      throw new TypeError(
        "CableMatrix requires stations, routes, and latLonToVector3 in DataContract."
      );
    }

    const stationIds = new Set();

    for (const [key, station] of Object.entries(contract.stations)) {
      if (
        !station ||
        typeof station.id !== "string" ||
        !station.id.trim() ||
        station.id !== key ||
        stationIds.has(station.id)
      ) {
        throw new TypeError(
          "CableMatrix found an invalid station ID: " + key
        );
      }

      if (
        !Number.isFinite(station.lat) ||
        station.lat < -90 ||
        station.lat > 90 ||
        !Number.isFinite(station.lon) ||
        station.lon < -180 ||
        station.lon > 180
      ) {
        throw new RangeError(
          "CableMatrix found invalid coordinates for station " +
          station.id
        );
      }

      if (
        typeof station.name !== "string" ||
        !station.name.trim() ||
        typeof station.region !== "string" ||
        !Number.isFinite(station.capacityTbps) ||
        station.capacityTbps < 0 ||
        (
          typeof station.tier !== "number" &&
          typeof station.tier !== "string"
        )
      ) {
        throw new TypeError(
          "CableMatrix found incomplete metadata for station " +
          station.id
        );
      }

      stationIds.add(station.id);
    }

    const routeIds = new Set();

    for (const route of contract.routes) {
      if (
        !route ||
        typeof route.id !== "string" ||
        !route.id.trim() ||
        routeIds.has(route.id)
      ) {
        throw new TypeError(
          "CableMatrix requires unique, nonempty route IDs."
        );
      }

      if (
        !stationIds.has(route.source) ||
        !stationIds.has(route.target) ||
        route.source === route.target
      ) {
        throw new RangeError(
          "CableMatrix route " + route.id +
          " requires two registered stations."
        );
      }

      if (
        route.arcAltitude !== undefined &&
        (
          !Number.isFinite(route.arcAltitude) ||
          route.arcAltitude < 1 ||
          route.arcAltitude > 1.25
        )
      ) {
        throw new RangeError(
          "CableMatrix route " + route.id +
          " requires an arcAltitude multiplier between 1 and 1.25."
        );
      }

      routeIds.add(route.id);
    }
  }

  function createSharedAssets() {
    return {
      coreGeometry: ownGeometry(
        new THREE.SphereGeometry(1, 16, 12)
      ),

      innerRingGeometry: ownGeometry(
        new THREE.RingGeometry(0.82, 0.94, 48)
      ),

      outerRingGeometry: ownGeometry(
        new THREE.RingGeometry(1.35, 1.44, 64)
      ),

      coreMaterial: ownMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x00ff66,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        })
      ),

      innerRingMaterial: ownMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x00ff66,
          transparent: true,
          opacity: 0.50,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        })
      ),

      outerRingMaterial: ownMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x00ff66,
          transparent: true,
          opacity: 0.25,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        })
      ),

      cableMaterial: ownMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x007744,
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        })
      )
    };
  }

  function addStationMesh(
    node,
    geometry,
    material,
    metadata,
    component
  ) {
    const mesh = new THREE.Mesh(geometry, material);

    mesh.name =
      "station:" + metadata.stationId + ":" + component;

    mesh.renderOrder = 5;

    Object.assign(mesh.userData, metadata, { component });

    node.add(mesh);
    pickables.push(mesh);

    return mesh;
  }

  function createStations(contract, shared) {
    const outwardAxis = new THREE.Vector3(0, 0, 1);
    const visualScale = radius / 100;

    for (const station of Object.values(contract.stations)) {
      const converted = contract.latLonToVector3(
        station.lat,
        station.lon,
        surfaceRadius
      );

      if (
        !converted ||
        !converted.isVector3 ||
        !Number.isFinite(converted.x) ||
        !Number.isFinite(converted.y) ||
        !Number.isFinite(converted.z) ||
        converted.lengthSq() === 0
      ) {
        throw new TypeError(
          "CableMatrix received an invalid position for station " +
          station.id
        );
      }

      const position = converted.clone().setLength(surfaceRadius);
      const normal = position.clone().normalize();
      const coreHub = isCoreHub(station.tier);

      const metadata = {
        kind: "station",
        stationId: station.id,
        name: station.name,
        capacityTbps: station.capacityTbps,
        region: station.region,
        tier: station.tier,
        isCoreHub: coreHub
      };

      const node = new THREE.Group();

      node.name = "station:" + station.id;
      node.position.copy(position);
      node.quaternion.setFromUnitVectors(outwardAxis, normal);
      node.scale.setScalar(visualScale);

      Object.assign(node.userData, metadata);

      const core = addStationMesh(
        node,
        shared.coreGeometry,
        shared.coreMaterial,
        metadata,
        "core"
      );

      const coreScale = coreHub ? 0.52 : 0.29;
      core.scale.setScalar(coreScale);

      let innerRing = null;
      let outerRing = null;

      if (coreHub) {
        innerRing = addStationMesh(
          node,
          shared.innerRingGeometry,
          shared.innerRingMaterial,
          metadata,
          "innerRing"
        );

        outerRing = addStationMesh(
          node,
          shared.outerRingGeometry,
          shared.outerRingMaterial,
          metadata,
          "outerRing"
        );

        innerRing.position.z = 0.015;
        outerRing.position.z = 0.030;
      }

      nodes[station.id] = node;
      stationPositions[station.id] = position;

      cableGroup.add(node);

      pulseRecords.push({
        core,
        coreScale,
        innerRing,
        outerRing,
        phase: stationPhase(station.id)
      });
    }
  }

  function createRouteCurve(route) {
    const source = stationPositions[route.source];
    const target = stationPositions[route.target];

    const a = source.clone().normalize();
    const b = target.clone().normalize();

    const dot = Math.max(-1, Math.min(1, a.dot(b)));
    const cross = new THREE.Vector3().crossVectors(a, b);
    const sine = cross.length();
    const angle = Math.atan2(sine, dot);

    if (angle <= ANGLE_EPSILON) {
      throw new RangeError(
        "CableMatrix route " + route.id +
        " has coincident endpoints; a nonzero cable path is required."
      );
    }

    const tangent = new THREE.Vector3();

    if (sine > ANGLE_EPSILON) {
      tangent.crossVectors(cross, a).normalize();
    } else {
      // Antipodal endpoints have no unique great circle.
      // Select a stable plane using the least aligned coordinate axis.
      const ax = Math.abs(a.x);
      const ay = Math.abs(a.y);
      const az = Math.abs(a.z);

      if (ax <= ay && ax <= az) {
        tangent.set(1, 0, 0);
      } else if (ay <= az) {
        tangent.set(0, 1, 0);
      } else {
        tangent.set(0, 0, 1);
      }

      tangent
        .addScaledVector(a, -tangent.dot(a))
        .normalize();
    }

    const altitude = route.arcAltitude === undefined
      ? 1.035
      : route.arcAltitude;

    const requestedLoft = Math.max(
      0,
      radius * altitude - surfaceRadius
    );

    // Nearby anchors receive lower loft to avoid tall local hairpins.
    const loft = Math.min(
      requestedLoft,
      radius * angle * 0.25
    );

    const points = new Array(sampleSegments + 1);

    points[0] = source.clone();
    points[sampleSegments] = target.clone();

    for (let i = 1; i < sampleSegments; i += 1) {
      const t = i / sampleSegments;
      const angularPosition = angle * t;

      // This orthonormal form of SLERP avoids division by sin(angle).
      const direction = a.clone()
        .multiplyScalar(Math.cos(angularPosition))
        .addScaledVector(
          tangent,
          Math.sin(angularPosition)
        )
        .normalize();

      const elevatedRadius =
        surfaceRadius + loft * Math.sin(Math.PI * t);

      points[i] = direction.multiplyScalar(elevatedRadius);
    }

    const curve = new THREE.CatmullRomCurve3(
      points,
      false,
      "centripetal"
    );

    curve.arcLengthDivisions = Math.max(
      256,
      sampleSegments * 8
    );

    curve.updateArcLengths();

    curve.userData = {
      routeId: route.id,
      source: route.source,
      target: route.target,
      cableName: route.cableName,
      distanceKm: route.distanceKm,
      baseLatencyMs: route.baseLatencyMs,
      centralAngleRadians: angle,
      surfaceRadius,
      peakRadius: surfaceRadius + loft,
      coordinateSpace: "cableGroup"
    };

    return curve;
  }

  function createCables(contract, shared) {
    for (const route of contract.routes) {
      const curve = createRouteCurve(route);

      const geometry = ownGeometry(
        new THREE.TubeGeometry(
          curve,
          64,
          tubeRadius,
          6,
          false
        )
      );

      geometry.computeBoundingSphere();

      const mesh = new THREE.Mesh(
        geometry,
        shared.cableMaterial
      );

      mesh.name = "cable:" + route.id;
      mesh.renderOrder = 4;

      Object.assign(mesh.userData, {
        kind: "cable",
        routeId: route.id,
        source: route.source,
        target: route.target,
        cableName: route.cableName,
        distanceKm: route.distanceKm,
        baseLatencyMs: route.baseLatencyMs
      });

      curves[route.id] = curve;
      routeMeshes[route.id] = mesh;

      cableGroup.add(mesh);
    }
  }

  function animationHook(delta, elapsed) {
    if (
      !initialized ||
      disposed ||
      !pulsingEnabled ||
      !cableGroup.visible
    ) {
      return;
    }

    const dt = Number.isFinite(delta) && delta > 0
      ? Math.min(delta, 0.1)
      : 0;

    animationTime =
      Number.isFinite(elapsed) && elapsed >= 0
        ? elapsed
        : animationTime + dt;

    for (const record of pulseRecords) {
      const phase = record.phase;
      const pulse = Math.sin(
        animationTime * 1.35 + phase
      );

      record.core.scale.setScalar(
        record.coreScale * (1 + pulse * 0.055)
      );

      if (record.innerRing) {
        record.innerRing.scale.setScalar(
          1 +
          Math.sin(
            animationTime * 1.15 + phase + 0.7
          ) * 0.035
        );

        record.outerRing.scale.setScalar(
          1 +
          Math.sin(
            animationTime * 0.95 + phase + 1.4
          ) * 0.055
        );
      }
    }
  }

  function setPulsingEnabled(enabled) {
    pulsingEnabled = Boolean(enabled);

    if (!pulsingEnabled) {
      for (const record of pulseRecords) {
        record.core.scale.setScalar(record.coreScale);

        if (record.innerRing) {
          record.innerRing.scale.setScalar(1);
          record.outerRing.scale.setScalar(1);
        }
      }
    }
  }

  function stopBootstrap() {
    if (bootstrapTimer !== null) {
      global.clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
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

    const contract = engine.DataContract;
    const earth = engine.EarthCore;

    if (
      !global.THREE ||
      !contract ||
      !earth ||
      typeof engine.registerHook !== "function"
    ) {
      return false;
    }

    if (
      !earth.earthGroup &&
      typeof earth.init === "function"
    ) {
      earth.init();
    }

    if (!earth.earthGroup) {
      return false;
    }

    initializing = true;
    THREE = global.THREE;

    try {
      validateContract(contract);

      const constants = contract.constants || {};

      // The initialized planet is authoritative if data loaded afterward.
      const radiusCandidates = [
        earth.radius,
        constants.RADIUS_EARTH,
        constants.PLANET_RADIUS,
        100
      ];

      radius = radiusCandidates.find(
        value => Number.isFinite(value) && value > 0
      );

      const requestedSegments =
        constants.CABLE_CURVE_SEGMENTS;

      sampleSegments = Number.isFinite(requestedSegments)
        ? Math.max(
            32,
            Math.min(64, Math.round(requestedSegments))
          )
        : 64;

      tubeRadius = 0.32 * (radius / 100);

      // Clear the surface shader and grid while keeping endpoints rooted.
      surfaceRadius = radius * 1.004;

      cableGroup = new THREE.Group();
      cableGroup.name = "cableGroup";
      cableGroup.userData.coordinateSpace = "earthGroup";
      cableGroup.userData.radius = radius;
      cableGroup.userData.surfaceRadius = surfaceRadius;

      const shared = createSharedAssets();

      createStations(contract, shared);
      createCables(contract, shared);

      cableGroup.userData.stationCount =
        Object.keys(nodes).length;

      cableGroup.userData.routeCount =
        Object.keys(curves).length;

      earth.earthGroup.add(cableGroup);

      initialized = true;
      registered = true;

      const registration =
        engine.registerHook(animationHook);

      if (
        typeof registration === "function" &&
        registration !== animationHook
      ) {
        unsubscribe = registration;
      }

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

    bootstrapTimer = global.setTimeout(
      tryBootstrap,
      bootstrapDelay
    );

    bootstrapDelay = Math.min(
      bootstrapDelay * 2,
      1000
    );
  }

  function dispose() {
    if (disposed) {
      return;
    }

    disposed = true;
    initialized = false;

    stopBootstrap();

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

      if (cableGroup && cableGroup.parent) {
        cableGroup.parent.remove(cableGroup);
      }

      for (const geometry of ownedGeometries) {
        geometry.dispose();
      }

      for (const material of ownedMaterials) {
        material.dispose();
      }

      ownedGeometries.clear();
      ownedMaterials.clear();

      pulseRecords.length = 0;
      pickables.length = 0;

      clearDictionary(curves);
      clearDictionary(nodes);
      clearDictionary(stationPositions);
      clearDictionary(routeMeshes);

      cableGroup = null;
    }
  }

  // Curves and stationPositions are local to cableGroup.
  // Parent packet objects to cableGroup, or convert samples with localToWorld().
  // Use curve.getPointAt(progress, targetVector) for uniform visual travel speed.
  engine.CableMatrix = Object.freeze({
    moduleId: MODULE_ID,
    init,
    dispose,
    setPulsingEnabled,
    curves,
    nodes,
    stationPositions,
    routeMeshes,
    pickables,

    get initialized() {
      return initialized;
    },

    get disposed() {
      return disposed;
    },

    get cableGroup() {
      return cableGroup;
    },

    get radius() {
      return radius;
    },

    get surfaceRadius() {
      return surfaceRadius;
    },

    get tubeRadius() {
      return tubeRadius;
    },

    get sampleSegments() {
      return sampleSegments;
    },

    get pulsingEnabled() {
      return pulsingEnabled;
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