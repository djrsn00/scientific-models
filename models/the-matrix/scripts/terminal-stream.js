(function installTerminalStream(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.TerminalStream";

  if (
    engine.TerminalStream &&
    engine.TerminalStream.moduleId === MODULE_ID
  ) {
    engine.TerminalStream.init();
    return;
  }

  const FLUSH_MS = 100;
  const HUD_MS = 500;
  const HEARTBEAT_MS = 5000;

  const MAX_LINES = 50;
  const MAX_BATCH = 12;
  const QUEUE_CAPACITY = 256;

  const LATENCY_WINDOW_MS = 10000;
  const LATENCY_CAPACITY = 2048;

  const TRAFFIC_WINDOW_MS = 5000;
  const BUCKET_MS = 250;
  const BUCKET_COUNT = TRAFFIC_WINDOW_MS / BUCKET_MS + 1;
  const COUNTER_CAPACITY = 32;

  const SCROLL_TOLERANCE = 24;

  const GREEN = "#00ff66";
  const CYAN = "#00f0ff";
  const GOLD = "#ffd000";
  const INDIGO = "#5c6ac4";

  const selectors = {
    terminal: [
      "#terminal-body",
      "#terminal-log",
      "#terminal-stream",
      "[data-terminal-body]"
    ],

    latency: [
      "#latency-metric",
      "#latency-value",
      "[data-metric='latency']",
      "[data-telemetry='latency']"
    ],

    nodes: [
      "#node-count",
      "#satellite-count",
      "[data-metric='node-count']",
      "[data-metric='satellites']"
    ],

    throughput: [
      "#throughput-metric",
      "#throughput-value",
      "[data-metric='throughput']",
      "[data-telemetry='throughput']"
    ]
  };

  const heartbeats = [
    {
      tag: "SIM_BGP",
      message:
        "BGP keepalive received | Route reflectors synchronized | Hold timer renewed."
    },
    {
      tag: "SIM_OPTICS",
      message:
        "Optical transponder check | Dispersion compensation recalibrated | Carrier lock stable."
    },
    {
      tag: "SIM_FEC",
      message:
        "FEC parity verification complete | Decoder synchronized | No simulated uncorrectable blocks."
    },
    {
      tag: "SIM_ATMOSPHERE",
      message:
        "Atmospheric link model refreshed | Adaptive optics aligned | Uplink tracking nominal."
    }
  ];

  const eventQueue = [];

  const latencyValues = new Float64Array(LATENCY_CAPACITY);
  const latencyTimes = new Float64Array(LATENCY_CAPACITY);
  const medianScratch = [];

  const byteBuckets = new Float64Array(BUCKET_COUNT);
  const bucketEpochs = new Float64Array(BUCKET_COUNT);

  const counterBytes = new Float64Array(COUNTER_CAPACITY);
  const counterTimes = new Float64Array(COUNTER_CAPACITY);

  const metrics = {
    medianLatencyMs: null,
    throughputTbps: 0,
    throughputSource: "event-stream",
    nodeCount: null,
    latencySampleCount: 0,
    updatedAt: 0
  };

  let active = false;
  let destroyed = false;

  let terminal = null;
  let latencyElement = null;
  let nodeElement = null;
  let throughputElement = null;

  let flushTimer = null;
  let hudTimer = null;
  let heartbeatTimer = null;

  let packetEvent = null;
  let laserEvent = null;
  let nextAnchorCheck = 0;

  let queueRead = 0;
  let queueWrite = 0;
  let queueCount = 0;
  let droppedEvents = 0;

  let latencyHead = 0;
  let latencyCount = 0;

  let counterHead = 0;
  let counterCount = 0;
  let counterSource = null;

  let startedAt = 0;
  let previousHudTime = 0;

  let displayedLatency = null;
  let displayedThroughput = 0;
  let throughputDisplayReady = false;

  let heartbeatIndex = 0;
  let receivedPackets = 0;
  let receivedHandovers = 0;
  let receivedBytes = 0;

  let followTail = true;
  let scrollRequested = false;
  let expectedScrollTop = null;

  bucketEpochs.fill(-1);

  function now() {
    return global.performance &&
      typeof global.performance.now === "function"
      ? global.performance.now()
      : Date.now();
  }

  function nonnegative(value) {
    return typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
      ? value
      : null;
  }

  function inlineText(value, fallback, limit) {
    let text;

    if (typeof value === "string") {
      text = value;
    } else if (
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      text = String(value);
    } else {
      return fallback;
    }

    text = text
      .slice(0, limit)
      .replace(
        /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
        " "
      )
      .trim();

    return text || fallback;
  }

  function stationId(value) {
    if (value && typeof value === "object") {
      return inlineText(value.id, "UNKNOWN", 96);
    }

    return inlineText(value, "UNKNOWN", 96);
  }

  function timestamp(value) {
    return Number.isFinite(value) &&
      Math.abs(value) <= 8640000000000000
      ? value
      : Date.now();
  }

  function utcStamp(value) {
    const date = new Date(value);

    return "[" +
      String(date.getUTCHours()).padStart(2, "0") + ":" +
      String(date.getUTCMinutes()).padStart(2, "0") + ":" +
      String(date.getUTCSeconds()).padStart(2, "0") + "." +
      String(date.getUTCMilliseconds()).padStart(3, "0") +
      "]";
  }

  function enqueueRecord(record) {
    if (!active) {
      return false;
    }

    // Fixed-capacity ring: discard the oldest queued record under backpressure.
    if (queueCount === QUEUE_CAPACITY) {
      eventQueue[queueRead] = null;
      queueRead = (queueRead + 1) % QUEUE_CAPACITY;
      queueCount -= 1;
      droppedEvents += 1;
    }

    eventQueue[queueWrite] = record;
    queueWrite = (queueWrite + 1) % QUEUE_CAPACITY;
    queueCount += 1;

    return true;
  }

  function dequeueRecord() {
    if (queueCount === 0) {
      return null;
    }

    const record = eventQueue[queueRead];

    eventQueue[queueRead] = null;
    queueRead = (queueRead + 1) % QUEUE_CAPACITY;
    queueCount -= 1;

    return record;
  }

  function recordLatency(value, time) {
    if (value === null) {
      return;
    }

    if (latencyCount === LATENCY_CAPACITY) {
      latencyHead = (latencyHead + 1) % LATENCY_CAPACITY;
      latencyCount -= 1;
    }

    const index = (
      latencyHead + latencyCount
    ) % LATENCY_CAPACITY;

    latencyValues[index] = value;
    latencyTimes[index] = time;
    latencyCount += 1;
  }

  function recordEventBytes(bytes, time) {
    const epoch = Math.floor(time / BUCKET_MS);
    const index = epoch % BUCKET_COUNT;

    if (bucketEpochs[index] !== epoch) {
      bucketEpochs[index] = epoch;
      byteBuckets[index] = 0;
    }

    byteBuckets[index] += bytes;
  }

  function onPacketArrived(event) {
    if (
      !active ||
      !event.detail ||
      typeof event.detail !== "object"
    ) {
      return;
    }

    const detail = event.detail;
    const time = now();
    const bytes = nonnegative(detail.bytesTransferred);
    const latency = nonnegative(detail.latencyMs);

    receivedPackets += 1;
    receivedBytes += bytes === null ? 0 : bytes;

    recordLatency(latency, time);
    recordEventBytes(bytes === null ? 0 : bytes, time);

    enqueueRecord({
      kind: "packet",
      timestamp: timestamp(detail.timestamp),
      routeId: inlineText(detail.routeId, "UNKNOWN", 96),
      sourceStation: stationId(detail.sourceStation),
      targetStation: stationId(detail.targetStation),
      packetClass: inlineText(detail.packetClass, "UNKNOWN", 48),
      bytesTransferred: bytes,
      latencyMs: latency
    });
  }

  function onLaserHandover(event) {
    if (
      !active ||
      !event.detail ||
      typeof event.detail !== "object"
    ) {
      return;
    }

    const detail = event.detail;

    receivedHandovers += 1;

    // A handover is not counted again as transferred terrestrial payload.
    enqueueRecord({
      kind: "laser",
      timestamp: timestamp(detail.timestamp),
      stationId: stationId(detail.stationId),
      satelliteId: inlineText(detail.satelliteId, "UNKNOWN", 96),
      frequencyThz: nonnegative(detail.frequencyThz),
      uplinkLatencyMs: nonnegative(detail.uplinkLatencyMs)
    });
  }

  function refreshEventBindings() {
    const constants = engine.DataContract
      ? engine.DataContract.constants || {}
      : {};

    const nextPacket = inlineText(
      constants.EVENT_PACKET_ARRIVED,
      "NetworkEngine:PacketArrived",
      160
    );

    const nextLaser = inlineText(
      constants.EVENT_LASER_HANDOVER,
      "NetworkEngine:LaserHandover",
      160
    );

    if (packetEvent !== nextPacket) {
      if (packetEvent) {
        global.removeEventListener(
          packetEvent,
          onPacketArrived
        );
      }

      packetEvent = nextPacket;

      global.addEventListener(
        packetEvent,
        onPacketArrived
      );
    }

    if (laserEvent !== nextLaser) {
      if (laserEvent) {
        global.removeEventListener(
          laserEvent,
          onLaserHandover
        );
      }

      laserEvent = nextLaser;

      global.addEventListener(
        laserEvent,
        onLaserHandover
      );
    }
  }

  function findElement(candidates) {
    if (!global.document) {
      return null;
    }

    for (const selector of candidates) {
      const element = global.document.querySelector(selector);

      if (element) {
        return element;
      }
    }

    return null;
  }

  function onScroll() {
    if (!terminal) {
      return;
    }

    if (
      expectedScrollTop !== null &&
      Math.abs(terminal.scrollTop - expectedScrollTop) <= 1
    ) {
      expectedScrollTop = null;
      return;
    }

    expectedScrollTop = null;

    followTail = (
      terminal.scrollHeight -
      terminal.clientHeight -
      terminal.scrollTop
    ) <= SCROLL_TOLERANCE;
  }

  function refreshAnchors(force) {
    const time = now();

    if (!force && time < nextAnchorCheck) {
      return;
    }

    nextAnchorCheck = time + 1000;

    const nextTerminal = findElement(selectors.terminal);

    if (nextTerminal !== terminal) {
      if (terminal) {
        terminal.removeEventListener("scroll", onScroll);
      }

      terminal = nextTerminal;
      followTail = true;
      scrollRequested = true;
      expectedScrollTop = null;

      if (terminal) {
        terminal.addEventListener(
          "scroll",
          onScroll,
          { passive: true }
        );
      }
    }

    latencyElement = findElement(selectors.latency);
    nodeElement = findElement(selectors.nodes);
    throughputElement = findElement(selectors.throughput);

    refreshEventBindings();
  }

  function fixed(value, digits) {
    return value === null ? "N/A" : value.toFixed(digits);
  }

  function packetColor(packetClass) {
    if (packetClass === "HTTP_PING") {
      return GOLD;
    }

    if (packetClass === "BACKUP_PAYLOAD") {
      return INDIGO;
    }

    return GREEN;
  }

  function createLine(record) {
    const document = global.document;

    const line = document.createElement("div");
    const time = document.createElement("span");
    const tag = document.createElement("span");
    const message = document.createElement("span");

    line.className = "terminal-line terminal-line--" + record.kind;
    line.style.fontFamily = "'Courier New', monospace";
    line.style.whiteSpace = "pre-wrap";
    line.style.overflowWrap = "anywhere";
    line.style.color = GREEN;

    time.className = "terminal-timestamp";
    time.style.color = "#6aaa80";
    time.textContent = utcStamp(record.timestamp) + " ";

    tag.className = "terminal-tag";
    tag.style.fontWeight = "700";

    message.className = "terminal-message";

    if (record.kind === "packet") {
      tag.style.color = packetColor(record.packetClass);
      tag.textContent = "[TERRESTRIAL_RX]";

      // Decimal SI units: 1 KB = 1000 bytes; 1 Tbps = 10^12 bits/second.
      const kilobytes = record.bytesTransferred === null
        ? null
        : record.bytesTransferred / 1000;

      message.textContent = " Route: " + record.routeId +
        " | Hop: " + record.sourceStation +
        " -> " + record.targetStation +
        " | Size: " + fixed(kilobytes, 2) + " KB" +
        " | Delta: " + fixed(record.latencyMs, 1) + "ms";
    } else if (record.kind === "laser") {
      tag.style.color = CYAN;
      tag.textContent = "[LEO_LASER_TX]";

      const satellite = record.satelliteId.startsWith("SAT_")
        ? record.satelliteId
        : "SAT_" + record.satelliteId;

      message.textContent = " Uplink Node: " + record.stationId +
        " -> " + satellite +
        " | Optical Carrier: " + fixed(record.frequencyThz, 1) + " THz" +
        " | Lock Delay: " + fixed(record.uplinkLatencyMs, 1) + "ms";
    } else {
      tag.style.color = record.color || GREEN;
      tag.textContent = "[" + record.tag + "]";
      message.textContent = " " + record.message;
    }

    line.appendChild(time);
    line.appendChild(tag);
    line.appendChild(message);

    return line;
  }

  function setScrollTop(value) {
    terminal.scrollTop = value;
    expectedScrollTop = terminal.scrollTop;
  }

  function flushQueue() {
    if (!active) {
      return;
    }

    refreshAnchors(false);

    if (
      !terminal ||
      terminal.isConnected === false ||
      (global.document && global.document.hidden)
    ) {
      return;
    }

    const count = Math.min(queueCount, MAX_BATCH);

    if (count === 0) {
      if (followTail && scrollRequested) {
        setScrollTop(terminal.scrollHeight);
        scrollRequested = false;
      }

      return;
    }

    const fragment = global.document.createDocumentFragment();

    for (let i = 0; i < count; i += 1) {
      fragment.appendChild(createLine(dequeueRecord()));
    }

    const removals = Math.max(
      0,
      terminal.children.length + count - MAX_LINES
    );

    // A surviving row anchors the viewport while older rows are evicted.
    const anchor = !followTail
      ? terminal.children[removals] || null
      : null;

    const anchorTop = anchor
      ? anchor.getBoundingClientRect().top
      : 0;

    for (let i = 0; i < removals; i += 1) {
      const oldest = terminal.firstElementChild;

      if (!oldest) {
        break;
      }

      terminal.removeChild(oldest);
    }

    terminal.appendChild(fragment);

    if (followTail) {
      setScrollTop(terminal.scrollHeight);
    } else if (anchor && anchor.parentNode === terminal) {
      const displacement =
        anchor.getBoundingClientRect().top - anchorTop;

      setScrollTop(
        Math.max(0, terminal.scrollTop + displacement)
      );
    }

    scrollRequested = false;
  }

  function medianLatency(time) {
    const cutoff = time - LATENCY_WINDOW_MS;

    while (
      latencyCount > 0 &&
      latencyTimes[latencyHead] < cutoff
    ) {
      latencyHead = (latencyHead + 1) % LATENCY_CAPACITY;
      latencyCount -= 1;
    }

    medianScratch.length = latencyCount;

    for (let i = 0; i < latencyCount; i += 1) {
      medianScratch[i] = latencyValues[
        (latencyHead + i) % LATENCY_CAPACITY
      ];
    }

    if (latencyCount === 0) {
      return null;
    }

    medianScratch.sort(function ascending(a, b) {
      return a - b;
    });

    const middle = Math.floor(latencyCount / 2);

    return latencyCount % 2
      ? medianScratch[middle]
      : (medianScratch[middle - 1] + medianScratch[middle]) / 2;
  }

  function eventThroughput(time) {
    const cutoff = Math.max(
      startedAt,
      time - TRAFFIC_WINDOW_MS
    );

    const currentEpoch = Math.floor(time / BUCKET_MS);

    let bytes = 0;

    for (let i = 0; i < BUCKET_COUNT; i += 1) {
      const epoch = bucketEpochs[i];
      const end = (epoch + 1) * BUCKET_MS;

      if (
        epoch < 0 ||
        epoch > currentEpoch ||
        end <= cutoff
      ) {
        continue;
      }

      const start = epoch * BUCKET_MS;

      const weight = epoch === currentEpoch
        ? 1
        : Math.min(
            1,
            Math.max(
              0,
              (end - Math.max(start, cutoff)) / BUCKET_MS
            )
          );

      bytes += byteBuckets[i] * weight;
    }

    const seconds = Math.max(
      HUD_MS,
      time - cutoff
    ) / 1000;

    return bytes * 8 / seconds / 1e12;
  }

  function resetCounterWindow() {
    counterHead = 0;
    counterCount = 0;
    counterSource = null;
  }

  function pipelineThroughput(time) {
    const pipeline = engine.PacketPipeline;

    let snapshot = null;

    if (
      pipeline &&
      typeof pipeline.getStats === "function"
    ) {
      try {
        snapshot = pipeline.getStats();
      } catch (error) {
        snapshot = null;
      }
    }

    const total = snapshot
      ? nonnegative(snapshot.totalBytesTransferred)
      : null;

    if (
      !snapshot ||
      snapshot.initialized === false ||
      snapshot.running === undefined ||
      total === null
    ) {
      resetCounterWindow();
      return null;
    }

    const previousIndex = (
      counterHead + counterCount - 1 + COUNTER_CAPACITY
    ) % COUNTER_CAPACITY;

    if (
      counterSource !== pipeline ||
      (
        counterCount > 0 &&
        total < counterBytes[previousIndex]
      )
    ) {
      resetCounterWindow();
      counterSource = pipeline;
    }

    if (counterCount === COUNTER_CAPACITY) {
      counterHead = (counterHead + 1) % COUNTER_CAPACITY;
      counterCount -= 1;
    }

    const index = (
      counterHead + counterCount
    ) % COUNTER_CAPACITY;

    counterBytes[index] = total;
    counterTimes[index] = time;
    counterCount += 1;

    if (counterCount < 2) {
      return null;
    }

    const cutoff = time - TRAFFIC_WINDOW_MS;

    while (counterCount > 2) {
      const next = (counterHead + 1) % COUNTER_CAPACITY;

      if (counterTimes[next] > cutoff) {
        break;
      }

      counterHead = next;
      counterCount -= 1;
    }

    let baselineTime = counterTimes[counterHead];
    let baselineBytes = counterBytes[counterHead];

    if (baselineTime < cutoff) {
      const next = (counterHead + 1) % COUNTER_CAPACITY;
      const span = counterTimes[next] - baselineTime;

      if (span > 0) {
        const fraction = Math.min(
          1,
          (cutoff - baselineTime) / span
        );

        baselineBytes += (
          counterBytes[next] - baselineBytes
        ) * fraction;

        baselineTime = cutoff;
      }
    }

    const seconds = (time - baselineTime) / 1000;

    return seconds > 0
      ? Math.max(0, total - baselineBytes) * 8 / seconds / 1e12
      : null;
  }

  function nodeCount() {
    const orbit = engine.SatelliteOrbit;

    // Keep node-count consistent with SatelliteOrbit's satellite HUD readout.
    return orbit && Array.isArray(orbit.satellites)
      ? orbit.satellites.length
      : null;
  }

  function throughputText(value) {
    if (value <= 0) {
      return "0.0 Tbps";
    }

    if (value < 0.000001) {
      return value.toExponential(2) + " Tbps";
    }

    const decimals = value >= 1
      ? 1
      : Math.min(
          6,
          Math.max(
            1,
            2 - Math.floor(Math.log10(value))
          )
        );

    return value.toFixed(decimals) + " Tbps";
  }

  function writeMetric(element, text) {
    if (
      element &&
      element.isConnected !== false &&
      element.textContent !== text
    ) {
      element.textContent = text;
    }
  }

  function updateHud() {
    if (!active) {
      return;
    }

    const time = now();
    const delta = Math.max(0, time - previousHudTime);

    previousHudTime = time;

    const measured = pipelineThroughput(time);

    const throughput = measured === null
      ? eventThroughput(time)
      : measured;

    const latency = medianLatency(time);
    const count = nodeCount();
    const smoothing = 1 - Math.exp(-delta / 850);

    metrics.medianLatencyMs = latency;
    metrics.throughputTbps = throughput;

    metrics.throughputSource = measured === null
      ? "event-stream"
      : "pipeline-counters";

    metrics.nodeCount = count;
    metrics.latencySampleCount = latencyCount;
    metrics.updatedAt = Date.now();

    if (latency === null) {
      displayedLatency = null;
    } else {
      displayedLatency = displayedLatency === null
        ? latency
        : displayedLatency +
          (latency - displayedLatency) * smoothing;
    }

    if (!throughputDisplayReady) {
      displayedThroughput = throughput;
      throughputDisplayReady = true;
    } else {
      displayedThroughput += (
        throughput - displayedThroughput
      ) * smoothing;
    }

    if (
      throughput === 0 &&
      displayedThroughput < 1e-12
    ) {
      displayedThroughput = 0;
    }

    refreshAnchors(false);

    if (global.document && global.document.hidden) {
      return;
    }

    writeMetric(
      latencyElement,
      displayedLatency === null
        ? "— ms"
        : displayedLatency.toFixed(1) + " ms"
    );

    writeMetric(
      throughputElement,
      throughputText(displayedThroughput)
    );

    if (count !== null) {
      writeMetric(nodeElement, String(count));
    }
  }

  function enqueueHeartbeat() {
    if (
      !active ||
      (global.document && global.document.hidden)
    ) {
      return;
    }

    const heartbeat = heartbeats[heartbeatIndex];

    heartbeatIndex = (
      heartbeatIndex + 1
    ) % heartbeats.length;

    enqueueRecord({
      kind: "heartbeat",
      timestamp: Date.now(),
      tag: heartbeat.tag,
      message: heartbeat.message,
      color: GREEN
    });
  }

  function enqueue(message, tag, color) {
    const text = inlineText(message, "", 1000);

    if (!text) {
      return false;
    }

    const label = inlineText(tag, "SYSTEM", 32)
      .toUpperCase()
      .replace(/[^A-Z0-9_:-]/g, "_");

    return enqueueRecord({
      kind: "system",
      timestamp: Date.now(),
      tag: label,
      message: text,

      color: typeof color === "string" &&
        /^#[0-9a-f]{6}$/i.test(color)
        ? color
        : GREEN
    });
  }

  function pauseAutoScroll() {
    followTail = false;
    scrollRequested = false;
  }

  function resumeAutoScroll() {
    followTail = true;
    scrollRequested = true;
  }

  function resetState() {
    eventQueue.length = 0;
    queueRead = 0;
    queueWrite = 0;
    queueCount = 0;
    droppedEvents = 0;

    latencyHead = 0;
    latencyCount = 0;

    latencyValues.fill(0);
    latencyTimes.fill(0);
    medianScratch.length = 0;

    byteBuckets.fill(0);
    bucketEpochs.fill(-1);

    counterBytes.fill(0);
    counterTimes.fill(0);
    resetCounterWindow();

    receivedPackets = 0;
    receivedHandovers = 0;
    receivedBytes = 0;
    heartbeatIndex = 0;

    displayedLatency = null;
    displayedThroughput = 0;
    throughputDisplayReady = false;

    followTail = true;
    scrollRequested = false;
    expectedScrollTop = null;

    metrics.medianLatencyMs = null;
    metrics.throughputTbps = 0;
    metrics.throughputSource = "event-stream";
    metrics.nodeCount = null;
    metrics.latencySampleCount = 0;
    metrics.updatedAt = 0;
  }

  function init() {
    if (active) {
      return true;
    }

    resetState();

    active = true;
    destroyed = false;
    startedAt = now();
    previousHudTime = startedAt;
    nextAnchorCheck = 0;

    refreshEventBindings();
    refreshAnchors(true);

    // Establish a cumulative-byte baseline before the first 500 ms HUD interval.
    pipelineThroughput(startedAt);

    flushTimer = global.setInterval(
      flushQueue,
      FLUSH_MS
    );

    hudTimer = global.setInterval(
      updateHud,
      HUD_MS
    );

    heartbeatTimer = global.setInterval(
      enqueueHeartbeat,
      HEARTBEAT_MS
    );

    enqueue(
      "Telemetry bridge online | UTC timestamps | Awaiting network events.",
      "SYSTEM",
      GREEN
    );

    return true;
  }

  function destroy() {
    if (!active && destroyed) {
      return;
    }

    active = false;
    destroyed = true;

    if (flushTimer !== null) {
      global.clearInterval(flushTimer);
      flushTimer = null;
    }

    if (hudTimer !== null) {
      global.clearInterval(hudTimer);
      hudTimer = null;
    }

    if (heartbeatTimer !== null) {
      global.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (packetEvent) {
      global.removeEventListener(
        packetEvent,
        onPacketArrived
      );
    }

    if (laserEvent) {
      global.removeEventListener(
        laserEvent,
        onLaserHandover
      );
    }

    if (terminal) {
      terminal.removeEventListener(
        "scroll",
        onScroll
      );
    }

    packetEvent = null;
    laserEvent = null;

    terminal = null;
    latencyElement = null;
    nodeElement = null;
    throughputElement = null;

    resetState();
  }

  function getMetrics() {
    return {
      medianLatencyMs: metrics.medianLatencyMs,
      throughputTbps: metrics.throughputTbps,
      throughputSource: metrics.throughputSource,
      nodeCount: metrics.nodeCount,
      latencySampleCount: metrics.latencySampleCount,
      updatedAt: metrics.updatedAt
    };
  }

  function getStats() {
    return {
      initialized: active,
      queueLength: queueCount,
      queueCapacity: QUEUE_CAPACITY,
      droppedEvents,
      receivedPackets,
      receivedHandovers,
      receivedBytes,
      terminalLines: terminal ? terminal.children.length : 0,
      lineLimit: MAX_LINES,
      autoScroll: followTail
    };
  }

  engine.TerminalStream = Object.freeze({
    moduleId: MODULE_ID,

    init,
    destroy,
    enqueue,
    pauseAutoScroll,
    resumeAutoScroll,
    getMetrics,
    getStats,

    get initialized() {
      return active;
    },

    get destroyed() {
      return destroyed;
    },

    get queueLength() {
      return queueCount;
    },

    get autoScroll() {
      return followTail;
    }
  });

  init();
})(window);