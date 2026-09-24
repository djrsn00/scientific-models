// scripts/packet-pipeline.js

(function installPacketPipeline(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.PacketPipeline";
  const MIN_PACKETS = 300;
  const MAX_PACKETS = 800;
  const TAIL_SEGMENTS = 6;
  const BURST_SECONDS = 0.35;
  const EVENT_INTERVAL_MS = 1000 / 6;

  if (
    engine.PacketPipeline &&
    engine.PacketPipeline.moduleId === MODULE_ID &&
    !engine.PacketPipeline.disposed
  ) {
    engine.PacketPipeline.init();
    return;
  }

  const defaults = [
    {
      id: "HTTP_PING",
      color: "#ffd000",
      velocityFactor: 1.4,
      weight: 0.46,
      minBytes: 64,
      maxBytes: 2048,
      diameter: 2.0,
      tailWidth: 0.18,
      tailLength: 3.6
    },
    {
      id: "BACKUP_PAYLOAD",
      color: "#5c6ac4",
      velocityFactor: 0.7,
      weight: 0.18,
      minBytes: 262144,
      maxBytes: 8388608,
      diameter: 3.2,
      tailWidth: 0.30,
      tailLength: 2.8
    },
    {
      id: "TLS_HANDSHAKE",
      color: "#00ff66",
      velocityFactor: 1.2,
      weight: 0.36,
      minBytes: 512,
      maxBytes: 16384,
      diameter: 2.4,
      tailWidth: 0.22,
      tailLength: 3.9
    }
  ];

  const pool = [];
  const burstPool = [];
  const routes = [];
  const classes = [];
  const draws = [];
  const geometries = new Set();
  const materials = new Set();
  const classArrivals = new Float64Array(3);
  const classBytes = new Float64Array(3);

  const pending = {
    ready: false,
    count: 0,
    routeId: "",
    sourceStation: "",
    targetStation: "",
    packetClass: "",
    bytesTransferred: 0,
    latencyMs: 0,
    timestamp: 0
  };

  let THREE = null;
  let cableMatrix = null;
  let headMesh = null;
  let tailMesh = null;
  let burstMesh = null;
  let headAttributes = null;
  let tailAttributes = null;
  let burstAttributes = null;
  let scratchA = null;
  let scratchB = null;
  let radius = 100;
  let visualScale = 1;
  let capacity = 0;
  let requestedCount = 600;
  let activeCount = 0;
  let activeBursts = 0;
  let simulationTime = 0;
  let maxVisualSeconds = 18;
  let arrivalEvent = "NetworkEngine:PacketArrived";
  let nextEventAt = 0;
  let totalArrivals = 0;
  let totalBytes = 0;
  let eventsEmitted = 0;
  let running = true;
  let initialized = false;
  let initializing = false;
  let disposed = false;
  let registered = false;
  let unsubscribe = null;
  let bootstrapTimer = null;
  let bootstrapDelay = 50;

  function clockNow() {
    return (
      global.performance &&
      typeof global.performance.now === "function"
    )
      ? global.performance.now()
      : Date.now();
  }

  function positive(value, fallback) {
    return Number.isFinite(value) && value > 0
      ? value
      : fallback;
  }

  function firstFinite(values, fallback) {
    for (let i = 0; i < values.length; i += 1) {
      if (Number.isFinite(values[i])) {
        return values[i];
      }
    }

    return fallback;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function ownGeometry(geometry) {
    geometries.add(geometry);
    return geometry;
  }

  function ownMaterial(material) {
    materials.add(material);
    return material;
  }

  function createClasses(contract) {
    if (
      !contract.packetClasses ||
      typeof contract.packetClasses !== "object"
    ) {
      throw new TypeError(
        "PacketPipeline requires DataContract.packetClasses."
      );
    }

    let totalWeight = 0;

    for (let i = 0; i < defaults.length; i += 1) {
      const fallback = defaults[i];
      const definition = contract.packetClasses[fallback.id];

      if (!definition || typeof definition !== "object") {
        throw new TypeError(
          "PacketPipeline is missing packet class " + fallback.id
        );
      }

      const envelope =
        definition.byteSizeEnvelope ||
        definition.byteSizeRange ||
        definition.byteEnvelope ||
        definition.byteSize ||
        definition.sizeBytes ||
        definition.payloadBytes ||
        definition.bytes ||
        {};

      const minimum = firstFinite([
        definition.minBytes,
        definition.bytesMin,
        envelope.min,
        envelope.minBytes,
        envelope[0]
      ], fallback.minBytes);

      const maximum = firstFinite([
        definition.maxBytes,
        definition.bytesMax,
        envelope.max,
        envelope.maxBytes,
        envelope[1]
      ], fallback.maxBytes);

      const minBytes = Math.ceil(minimum);
      const maxBytes = Math.floor(maximum);

      if (
        !Number.isSafeInteger(minBytes) ||
        !Number.isSafeInteger(maxBytes) ||
        minBytes < 0 ||
        maxBytes < minBytes
      ) {
        throw new RangeError(
          "PacketPipeline found an invalid byte envelope for " +
          fallback.id
        );
      }

      const weight = Math.max(0, firstFinite([
        definition.trafficWeight,
        definition.spawnWeight,
        definition.weight
      ], fallback.weight));

      const colorValue = definition.color === undefined
        ? fallback.color
        : definition.color;

      classes.push({
        id: fallback.id,
        definition,
        color: new THREE.Color(colorValue),
        velocityFactor: positive(
          definition.velocityFactor,
          fallback.velocityFactor
        ),
        weight,
        minBytes,
        maxBytes,
        diameter: fallback.diameter * visualScale,
        tailWidth: fallback.tailWidth * visualScale,
        tailLength: fallback.tailLength * visualScale
      });

      totalWeight += weight;
    }

    if (totalWeight <= 0) {
      throw new RangeError(
        "PacketPipeline requires a positive traffic weight."
      );
    }
  }

  function createRoutes(contract, constants) {
    if (!Array.isArray(contract.routes)) {
      throw new TypeError(
        "PacketPipeline requires DataContract.routes."
      );
    }

    const animationScale = positive(
      constants.PACKET_ANIMATION_TIME_SCALE,
      80
    );

    const minimumMs = Math.max(
      500,
      positive(constants.MIN_PACKET_ANIMATION_MS, 900)
    );

    const maximumMs = Math.max(
      minimumMs,
      positive(constants.MAX_PACKET_ANIMATION_MS, 18000)
    );

    const fiberSpeed = positive(
      constants.FIBER_SPEED_KM_PER_SECOND,
      200000
    );

    const earthKm = positive(
      constants.EARTH_RADIUS_KM,
      6371.0088
    );

    const seen = new Set();

    maxVisualSeconds = maximumMs / 1000;

    for (const definition of contract.routes) {
      if (
        !definition ||
        typeof definition.id !== "string" ||
        seen.has(definition.id)
      ) {
        throw new TypeError(
          "PacketPipeline requires unique route IDs."
        );
      }

      const curve = cableMatrix.curves[definition.id];

      if (
        !curve ||
        typeof curve.getPointAt !== "function" ||
        typeof curve.getLength !== "function"
      ) {
        throw new TypeError(
          "PacketPipeline cannot find the cable curve for " +
          definition.id
        );
      }

      const length = curve.getLength();

      if (!Number.isFinite(length) || length <= 0) {
        throw new RangeError(
          "PacketPipeline requires a nonzero curve: " +
          definition.id
        );
      }

      const distanceKm = positive(
        definition.distanceKm,
        length / radius * earthKm
      );

      const latencyMs = positive(
        definition.baseLatencyMs,
        distanceKm / fiberSpeed * 1000
      );

      const sourcePosition = curve.getPointAt(
        0,
        new THREE.Vector3()
      );

      const targetPosition = curve.getPointAt(
        1,
        new THREE.Vector3()
      );

      if (
        !Number.isFinite(sourcePosition.lengthSq()) ||
        !Number.isFinite(targetPosition.lengthSq()) ||
        sourcePosition.lengthSq() <= 0 ||
        targetPosition.lengthSq() <= 0
      ) {
        throw new RangeError(
          "PacketPipeline found invalid endpoints: " +
          definition.id
        );
      }

      routes.push({
        id: definition.id,
        source: definition.source,
        target: definition.target,
        curve,
        length,
        latencyMs,
        visualSeconds: clamp(
          latencyMs * animationScale,
          minimumMs,
          maximumMs
        ) / 1000,
        sourcePosition,
        targetPosition
      });

      seen.add(definition.id);
    }

    if (routes.length === 0) {
      throw new RangeError(
        "PacketPipeline requires at least one cable curve."
      );
    }
  }

  function quadGeometry() {
    const geometry = ownGeometry(
      new THREE.InstancedBufferGeometry()
    );

    geometry.setIndex([0, 1, 2, 0, 2, 3]);

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([
        -0.5, -0.5, 0,
         0.5, -0.5, 0,
         0.5,  0.5, 0,
        -0.5,  0.5, 0
      ], 3)
    );

    geometry.setAttribute(
      "uv",
      new THREE.Float32BufferAttribute([
        0, 0,
        1, 0,
        1, 1,
        0, 1
      ], 2)
    );

    geometry.instanceCount = 0;

    return geometry;
  }

  function dynamicAttribute(geometry, name, components, count) {
    const attribute = new THREE.InstancedBufferAttribute(
      new Float32Array(count * components),
      components
    );

    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);

    return attribute;
  }

  function makeMaterial(vertexShader, fragmentShader) {
    return ownMaterial(
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    );
  }

  function makeDraw(name, geometry, material, order) {
    const mesh = new THREE.Mesh(geometry, material);

    mesh.name = name;
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;

    draws.push(mesh);

    return mesh;
  }

  function createVisuals() {
    const chunks = THREE.ShaderChunk || {};

    const output = chunks.colorspace_fragment
      ? "#include <colorspace_fragment>"
      : chunks.encodings_fragment
        ? "#include <encodings_fragment>"
        : "";

    const headGeometry = quadGeometry();

    headAttributes = {
      center: dynamicAttribute(
        headGeometry, "aCenter", 3, capacity
      ),
      tint: dynamicAttribute(
        headGeometry, "aTint", 3, capacity
      ),
      size: dynamicAttribute(
        headGeometry, "aSize", 1, capacity
      )
    };

    headMesh = makeDraw(
      "packetHeads",
      headGeometry,
      makeMaterial(`
        attribute vec3 aCenter;
        attribute vec3 aTint;
        attribute float aSize;

        varying vec2 vUv;
        varying vec3 vTint;

        void main() {
          vec4 center = modelViewMatrix * vec4(aCenter, 1.0);
          float modelScale = length(modelViewMatrix[0].xyz);

          center.xy += position.xy * aSize * modelScale;

          vUv = uv;
          vTint = aTint;

          gl_Position = projectionMatrix * center;
        }
      `, `
        varying vec2 vUv;
        varying vec3 vTint;

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float radiusSquared = dot(p, p);

          if (radiusSquared >= 1.0) {
            discard;
          }

          float core = 1.0 - smoothstep(
            0.015,
            0.19,
            radiusSquared
          );

          float halo = exp(-radiusSquared * 4.5);

          float edge = 1.0 - smoothstep(
            0.64,
            1.0,
            radiusSquared
          );

          float alpha =
            (0.70 * halo + 0.30 * core) * edge;

          vec3 color = mix(
            vTint,
            vec3(1.0),
            core * 0.50
          );

          gl_FragColor = vec4(color, alpha);

          ${output}
        }
      `),
      8
    );

    const tailGeometry = quadGeometry();
    const tailCount = capacity * TAIL_SEGMENTS;

    tailAttributes = {
      start: dynamicAttribute(
        tailGeometry, "aStart", 3, tailCount
      ),
      end: dynamicAttribute(
        tailGeometry, "aEnd", 3, tailCount
      ),
      tint: dynamicAttribute(
        tailGeometry, "aTint", 3, tailCount
      ),
      alpha: dynamicAttribute(
        tailGeometry, "aAlpha", 2, tailCount
      ),
      width: dynamicAttribute(
        tailGeometry, "aWidth", 1, tailCount
      )
    };

    tailMesh = makeDraw(
      "packetTails",
      tailGeometry,
      makeMaterial(`
        attribute vec3 aStart;
        attribute vec3 aEnd;
        attribute vec3 aTint;
        attribute vec2 aAlpha;
        attribute float aWidth;

        varying vec3 vTint;
        varying float vAlpha;
        varying float vAcross;

        void main() {
          vec4 start = modelViewMatrix * vec4(aStart, 1.0);
          vec4 end = modelViewMatrix * vec4(aEnd, 1.0);

          vec2 direction = end.xy - start.xy;
          float magnitude = length(direction);

          direction = magnitude > 0.000001
            ? direction / magnitude
            : vec2(1.0, 0.0);

          vec2 perpendicular = vec2(
            -direction.y,
            direction.x
          );

          float along = position.x + 0.5;
          float modelScale = length(modelViewMatrix[0].xyz);
          vec4 point = mix(start, end, along);

          point.xy +=
            perpendicular *
            position.y *
            aWidth *
            modelScale;

          vTint = aTint;
          vAlpha = mix(aAlpha.x, aAlpha.y, along);
          vAcross = position.y * 2.0;

          gl_Position = projectionMatrix * point;
        }
      `, `
        varying vec3 vTint;
        varying float vAlpha;
        varying float vAcross;

        void main() {
          float edge = 1.0 - smoothstep(
            0.15,
            1.0,
            abs(vAcross)
          );

          float alpha = vAlpha * edge;

          if (alpha < 0.002) {
            discard;
          }

          gl_FragColor = vec4(vTint, alpha);

          ${output}
        }
      `),
      7
    );

    const ringSource = new THREE.RingGeometry(
      0.72,
      1,
      48,
      1
    );

    const ringGeometry = ownGeometry(
      new THREE.InstancedBufferGeometry().copy(ringSource)
    );

    ringSource.dispose();
    ringGeometry.instanceCount = 0;

    burstAttributes = {
      center: dynamicAttribute(
        ringGeometry, "aCenter", 3, capacity
      ),
      tint: dynamicAttribute(
        ringGeometry, "aTint", 3, capacity
      ),
      scale: dynamicAttribute(
        ringGeometry, "aScale", 1, capacity
      ),
      opacity: dynamicAttribute(
        ringGeometry, "aOpacity", 1, capacity
      )
    };

    const burstMaterial = makeMaterial(`
      attribute vec3 aCenter;
      attribute vec3 aTint;
      attribute float aScale;
      attribute float aOpacity;

      varying vec3 vTint;
      varying float vOpacity;
      varying vec2 vRing;

      void main() {
        vec3 normal = normalize(aCenter);

        vec3 reference = abs(normal.y) > 0.95
          ? vec3(1.0, 0.0, 0.0)
          : vec3(0.0, 1.0, 0.0);

        vec3 east = normalize(cross(reference, normal));
        vec3 north = cross(normal, east);

        vec3 point = aCenter +
          (
            east * position.x +
            north * position.y
          ) * aScale;

        vTint = aTint;
        vOpacity = aOpacity;
        vRing = position.xy;

        gl_Position =
          projectionMatrix *
          modelViewMatrix *
          vec4(point, 1.0);
      }
    `, `
      varying vec3 vTint;
      varying float vOpacity;
      varying vec2 vRing;

      void main() {
        float radius = length(vRing);

        float edge =
          smoothstep(0.72, 0.80, radius) *
          (1.0 - smoothstep(0.93, 1.0, radius));

        float alpha = vOpacity * edge;

        if (alpha < 0.002) {
          discard;
        }

        gl_FragColor = vec4(vTint, alpha);

        ${output}
      }
    `);

    burstMaterial.side = THREE.DoubleSide;
    burstMaterial.forceSinglePass = true;

    burstMesh = makeDraw(
      "packetArrivalBursts",
      ringGeometry,
      burstMaterial,
      6
    );
  }

  function chooseClass() {
    const boost = simulationTime % 5 < 0.45 ? 1.8 : 1;
    const first = classes[0].weight;
    const second = classes[1].weight;
    const third = classes[2].weight * boost;
    const choice = Math.random() * (first + second + third);

    return choice < first
      ? 0
      : choice < first + second
        ? 1
        : 2;
  }

  function respawn(packet, prewarm) {
    const route = routes[
      Math.floor(Math.random() * routes.length)
    ];

    const classIndex = chooseClass();
    const model = classes[classIndex];

    const duration = clamp(
      route.visualSeconds / model.velocityFactor,
      0.5,
      maxVisualSeconds
    );

    packet.active = true;
    packet.route = route;
    packet.routeId = route.id;
    packet.curve = route.curve;
    packet.direction = Math.random() < 0.5 ? 1 : -1;

    packet.progress = prewarm
      ? Math.random()
      : packet.direction === 1
        ? 0
        : 1;

    packet.speed = 1 / duration;
    packet.packetClass = model.id;
    packet.classIndex = classIndex;
    packet.classDefinition = model.definition;

    packet.bytesTransferred =
      model.minBytes +
      Math.floor(
        Math.random() *
        (model.maxBytes - model.minBytes + 1)
      );

    packet.latencyMs = route.latencyMs;

    packet.tailSpan = Math.min(
      0.14,
      model.tailLength / route.length
    );
  }

  function createPools() {
    for (let i = 0; i < capacity; i += 1) {
      // mesh plus instanceId identifies this packet's batched GPU instance.
      pool.push({
        id: i,
        instanceId: i,
        mesh: headMesh,
        active: false,
        route: null,
        routeId: "",
        curve: null,
        progress: 0,
        speed: 0,
        direction: 1,
        packetClass: "",
        classIndex: 0,
        classDefinition: null,
        bytesTransferred: 0,
        latencyMs: 0,
        tailSpan: 0,
        position: new THREE.Vector3()
      });

      burstPool.push({
        active: false,
        age: 0,
        x: 0,
        y: 0,
        z: 0,
        classIndex: 0
      });
    }
  }

  function writeVector(array, offset, vector) {
    array[offset] = vector.x;
    array[offset + 1] = vector.y;
    array[offset + 2] = vector.z;
  }

  function writeColor(array, offset, color) {
    array[offset] = color.r;
    array[offset + 1] = color.g;
    array[offset + 2] = color.b;
  }

  function writePacket(packet) {
    const index = packet.instanceId;
    const model = classes[packet.classIndex];
    const progress = clamp(packet.progress, 0, 1);

    packet.curve.getPointAt(progress, packet.position);

    writeVector(
      headAttributes.center.array,
      index * 3,
      packet.position
    );

    writeColor(
      headAttributes.tint.array,
      index * 3,
      model.color
    );

    headAttributes.size.array[index] = model.diameter;

    const traveled = packet.direction === 1
      ? progress
      : 1 - progress;

    const span = Math.min(packet.tailSpan, traveled);

    let start = packet.position;
    let end = scratchA;

    for (
      let segment = 0;
      segment < TAIL_SEGMENTS;
      segment += 1
    ) {
      const instance = index * TAIL_SEGMENTS + segment;
      const first = segment / TAIL_SEGMENTS;
      const last = (segment + 1) / TAIL_SEGMENTS;

      const tailProgress = clamp(
        progress - packet.direction * span * last,
        0,
        1
      );

      packet.curve.getPointAt(tailProgress, end);

      writeVector(
        tailAttributes.start.array,
        instance * 3,
        start
      );

      writeVector(
        tailAttributes.end.array,
        instance * 3,
        end
      );

      writeColor(
        tailAttributes.tint.array,
        instance * 3,
        model.color
      );

      tailAttributes.alpha.array[instance * 2] =
        0.78 * (1 - first) * (1 - first);

      tailAttributes.alpha.array[instance * 2 + 1] =
        0.78 * (1 - last) * (1 - last);

      tailAttributes.width.array[instance] =
        model.tailWidth;

      start = end;
      end = end === scratchA ? scratchB : scratchA;
    }
  }

  function triggerBurst(packet, residualSeconds) {
    let burst;

    if (activeBursts < capacity) {
      burst = burstPool[activeBursts];
      activeBursts += 1;
    } else {
      let oldest = 0;

      for (let i = 1; i < activeBursts; i += 1) {
        if (burstPool[i].age > burstPool[oldest].age) {
          oldest = i;
        }
      }

      burst = burstPool[oldest];
    }

    const endpoint = packet.direction === 1
      ? packet.route.targetPosition
      : packet.route.sourcePosition;

    burst.active = true;
    burst.age = residualSeconds;
    burst.x = endpoint.x * 1.00015;
    burst.y = endpoint.y * 1.00015;
    burst.z = endpoint.z * 1.00015;
    burst.classIndex = packet.classIndex;
  }

  function ageBursts(delta) {
    let i = 0;

    while (i < activeBursts) {
      const burst = burstPool[i];

      burst.age += delta;

      if (burst.age >= BURST_SECONDS) {
        burst.active = false;
        activeBursts -= 1;

        burstPool[i] = burstPool[activeBursts];
        burstPool[activeBursts] = burst;
      } else {
        i += 1;
      }
    }
  }

  function writeBursts() {
    for (let i = 0; i < activeBursts; i += 1) {
      const burst = burstPool[i];

      const progress = clamp(
        burst.age / BURST_SECONDS,
        0,
        1
      );

      const remaining = 1 - progress;
      const offset = i * 3;

      burstAttributes.center.array[offset] = burst.x;
      burstAttributes.center.array[offset + 1] = burst.y;
      burstAttributes.center.array[offset + 2] = burst.z;

      writeColor(
        burstAttributes.tint.array,
        offset,
        classes[burst.classIndex].color
      );

      burstAttributes.scale.array[i] =
        (
          0.55 +
          3.4 * (1 - remaining * remaining * remaining)
        ) * visualScale;

      burstAttributes.opacity.array[i] =
        0.90 * remaining * remaining;
    }

    burstMesh.geometry.instanceCount = activeBursts;
  }

  function recordArrival(packet) {
    totalArrivals += 1;
    totalBytes += packet.bytesTransferred;
    classArrivals[packet.classIndex] += 1;
    classBytes[packet.classIndex] += packet.bytesTransferred;

    pending.count += 1;

    // Each arrival has an equal chance of representing this telemetry window.
    if (!pending.ready || Math.random() < 1 / pending.count) {
      pending.ready = true;
      pending.routeId = packet.routeId;

      pending.sourceStation = packet.direction === 1
        ? packet.route.source
        : packet.route.target;

      pending.targetStation = packet.direction === 1
        ? packet.route.target
        : packet.route.source;

      pending.packetClass = packet.packetClass;
      pending.bytesTransferred = packet.bytesTransferred;
      pending.latencyMs = packet.latencyMs;
      pending.timestamp = Date.now();
    }
  }

  function advancePacket(packet, delta) {
    const next =
      packet.progress +
      packet.direction * packet.speed * delta;

    const arrived = packet.direction === 1
      ? next >= 1
      : next <= 0;

    if (arrived) {
      const terminal = packet.direction === 1 ? 1 : 0;

      const residual = clamp(
        Math.abs(next - terminal) / packet.speed,
        0,
        delta
      );

      packet.progress = terminal;

      triggerBurst(packet, residual);
      recordArrival(packet);
      respawn(packet, false);

      packet.progress +=
        packet.direction * packet.speed * residual;
    } else {
      packet.progress = next;
    }

    writePacket(packet);
  }

  function markAttributes(attributes) {
    for (const name in attributes) {
      attributes[name].needsUpdate = true;
    }
  }

  function uploadChanges() {
    markAttributes(headAttributes);
    markAttributes(tailAttributes);
    markAttributes(burstAttributes);
  }

  function syncTransforms() {
    const group = cableMatrix.cableGroup;

    if (group.matrixAutoUpdate) {
      group.updateMatrix();
    }

    for (let i = 0; i < draws.length; i += 1) {
      draws[i].matrix.copy(group.matrix);
      draws[i].matrixWorldNeedsUpdate = true;
    }
  }

  function emitTelemetry() {
    const now = clockNow();

    if (!pending.ready || now < nextEventAt) {
      return;
    }

    const detail = {
      routeId: pending.routeId,
      sourceStation: pending.sourceStation,
      targetStation: pending.targetStation,
      packetClass: pending.packetClass,
      bytesTransferred: pending.bytesTransferred,
      latencyMs: pending.latencyMs,
      timestamp: pending.timestamp
    };

    pending.ready = false;
    pending.count = 0;
    nextEventAt = now + EVENT_INTERVAL_MS;
    eventsEmitted += 1;

    global.dispatchEvent(
      new global.CustomEvent(arrivalEvent, { detail })
    );
  }

  function animationHook(delta, elapsed) {
    if (!initialized || disposed) {
      return;
    }

    if (
      !engine.EarthCore ||
      cableMatrix.disposed ||
      !cableMatrix.cableGroup ||
      cableMatrix.cableGroup.parent !==
        engine.EarthCore.earthGroup
    ) {
      dispose();
      return;
    }

    syncTransforms();

    if (!running) {
      return;
    }

    const dt = Number.isFinite(delta) && delta > 0
      ? Math.min(delta, 0.1)
      : 0;

    simulationTime += dt;

    ageBursts(dt);

    for (let i = 0; i < activeCount; i += 1) {
      advancePacket(pool[i], dt);
    }

    writeBursts();
    uploadChanges();

    // A telemetry listener may safely pause, reset, or dispose the pipeline.
    emitTelemetry();
  }

  function reset() {
    if (!initialized || disposed) {
      return false;
    }

    simulationTime = 0;
    activeBursts = 0;
    totalArrivals = 0;
    totalBytes = 0;
    eventsEmitted = 0;

    classArrivals.fill(0);
    classBytes.fill(0);

    pending.ready = false;
    pending.count = 0;
    nextEventAt = clockNow() + EVENT_INTERVAL_MS;

    for (let i = 0; i < capacity; i += 1) {
      burstPool[i].active = false;
      burstPool[i].age = 0;
      pool[i].active = i < activeCount;

      if (i < activeCount) {
        respawn(pool[i], true);
        writePacket(pool[i]);
      }
    }

    headMesh.geometry.instanceCount = activeCount;
    tailMesh.geometry.instanceCount =
      activeCount * TAIL_SEGMENTS;
    burstMesh.geometry.instanceCount = 0;

    syncTransforms();
    uploadChanges();

    return true;
  }

  function setPacketCount(count) {
    const limit = initialized ? capacity : MAX_PACKETS;

    if (
      !Number.isInteger(count) ||
      count < MIN_PACKETS ||
      count > limit
    ) {
      throw new RangeError(
        "PacketPipeline packet count must be an integer from " +
        MIN_PACKETS + " to " + limit + "."
      );
    }

    requestedCount = count;

    if (!initialized || disposed) {
      return;
    }

    for (let i = activeCount; i < count; i += 1) {
      respawn(pool[i], true);
      writePacket(pool[i]);
    }

    for (let i = count; i < activeCount; i += 1) {
      pool[i].active = false;
    }

    activeCount = count;

    headMesh.geometry.instanceCount = count;
    tailMesh.geometry.instanceCount = count * TAIL_SEGMENTS;

    markAttributes(headAttributes);
    markAttributes(tailAttributes);
  }

  function setRunning(enabled) {
    const next = Boolean(enabled);

    if (running !== next) {
      running = next;
      pending.ready = false;
      pending.count = 0;
      nextEventAt = clockNow() + EVENT_INTERVAL_MS;
    }
  }

  function getStats() {
    return {
      initialized,
      running: running && initialized && !disposed,
      activePackets: activeCount,
      packetCapacity: capacity,
      activeBursts,
      totalArrivals,
      totalBytesTransferred: totalBytes,
      telemetryEventsEmitted: eventsEmitted,
      telemetryIsSampled: true,
      simulationSeconds: simulationTime,
      classes: {
        HTTP_PING: {
          arrivals: classArrivals[0],
          bytesTransferred: classBytes[0]
        },
        BACKUP_PAYLOAD: {
          arrivals: classArrivals[1],
          bytesTransferred: classBytes[1]
        },
        TLS_HANDSHAKE: {
          arrivals: classArrivals[2],
          bytesTransferred: classBytes[2]
        }
      }
    };
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
    const cables = engine.CableMatrix;

    if (
      !global.THREE ||
      !contract ||
      !earth ||
      !cables ||
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

    if (
      !cables.cableGroup &&
      typeof cables.init === "function"
    ) {
      cables.init();
    }

    if (
      !earth.earthGroup ||
      !cables.cableGroup ||
      !cables.curves
    ) {
      return false;
    }

    initializing = true;
    THREE = global.THREE;
    cableMatrix = cables;

    try {
      if (cables.cableGroup.parent !== earth.earthGroup) {
        throw new Error(
          "PacketPipeline requires cableGroup directly inside earthGroup."
        );
      }

      const constants = contract.constants || {};

      const maximum = Math.floor(
        positive(constants.MAX_ACTIVE_PACKETS, MAX_PACKETS)
      );

      if (maximum < MIN_PACKETS) {
        throw new RangeError(
          "PacketPipeline requires MAX_ACTIVE_PACKETS to be at least 300."
        );
      }

      capacity = Math.min(MAX_PACKETS, maximum);
      activeCount = Math.min(requestedCount, capacity);

      radius = positive(
        earth.radius,
        positive(
          constants.RADIUS_EARTH,
          positive(constants.PLANET_RADIUS, 100)
        )
      );

      visualScale = radius / 100;

      arrivalEvent =
        typeof constants.EVENT_PACKET_ARRIVED === "string" &&
        constants.EVENT_PACKET_ARRIVED.trim()
          ? constants.EVENT_PACKET_ARRIVED
          : "NetworkEngine:PacketArrived";

      scratchA = new THREE.Vector3();
      scratchB = new THREE.Vector3();

      createClasses(contract);
      createRoutes(contract, constants);
      createVisuals();
      createPools();

      for (let i = 0; i < draws.length; i += 1) {
        earth.earthGroup.add(draws[i]);
      }

      initialized = true;

      reset();

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

      for (let i = 0; i < draws.length; i += 1) {
        if (draws[i].parent) {
          draws[i].parent.remove(draws[i]);
        }
      }

      for (const geometry of geometries) {
        geometry.dispose();
      }

      for (const material of materials) {
        material.dispose();
      }

      geometries.clear();
      materials.clear();

      draws.length = 0;
      pool.length = 0;
      burstPool.length = 0;
      routes.length = 0;
      classes.length = 0;

      activeCount = 0;
      activeBursts = 0;

      pending.ready = false;
      pending.count = 0;

      headMesh = null;
      tailMesh = null;
      burstMesh = null;
      headAttributes = null;
      tailAttributes = null;
      burstAttributes = null;
      scratchA = null;
      scratchB = null;
      cableMatrix = null;
    }
  }

  // Pool entries are reused. Event details are independent snapshots.
  // latencyMs describes the modeled cable delay; animation duration is separate.
  engine.PacketPipeline = Object.freeze({
    moduleId: MODULE_ID,
    init,
    dispose,
    reset,
    setRunning,
    setPacketCount,
    getStats,
    pool,
    burstPool,

    get initialized() {
      return initialized;
    },

    get disposed() {
      return disposed;
    },

    get running() {
      return running && initialized && !disposed;
    },

    get activeCount() {
      return activeCount;
    },

    get capacity() {
      return capacity;
    },

    get headMesh() {
      return headMesh;
    },

    get tailMesh() {
      return tailMesh;
    },

    get burstMesh() {
      return burstMesh;
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