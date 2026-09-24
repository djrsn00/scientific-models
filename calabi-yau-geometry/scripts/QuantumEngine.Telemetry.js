/*
 * QuantumEngine.Telemetry.js
 *
 * Surface-tethered KaTeX equations, cinematic waypoints, measured diagnostics,
 * and the remaining observer-console controls.
 *
 * Anchors use real aComplex vertices and the Manifold's animated projection.
 * CRT correction aligns them with the displayed green channel.
 * Equations describe geometric conditions, not quantities measured here.
 *
 * Cinematography owns tour/reset/C/R. Core owns rendering and time.
 * dispose() satisfies the accepted index.html lifecycle contract.
 */
(function quantumEngineTelemetryModule(window) {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};
  const engine = window.QuantumEngine;

  if (!engine || typeof engine !== "object") {
    throw new TypeError("window.QuantumEngine must be an object.");
  }



/*
 * QuantumEngine.Telemetry.js
 *
 * Surface-tethered KaTeX equations, cinematic waypoints, measured diagnostics,
 * and the remaining observer-console controls.
 *
 * Anchors use real aComplex vertices and the Manifold's animated projection.
 * CRT correction aligns them with the displayed green channel.
 * Equations describe geometric conditions, not quantities measured here.
 *
 * Cinematography owns tour/reset/C/R. Core owns rendering and time.
 * dispose() satisfies the accepted index.html lifecycle contract.
 */



if (engine.Telemetry !== undefined) {
  throw new Error("QuantumEngine.Telemetry has already been registered.");
}

  const CRT_CURVATURE = 0.018;
  const MAX_LOG_ENTRIES = 120;

  const DEFINITIONS = [
    {
      id: "macro",
      branch: 0,
      u: 0.30,
      v: 0.34,
      title: "Product compactification",
      latex: "M_{10}=M_{3,1}\\times X_6",
      fullDistance: 6,
      fadeDistance: 24
    },
    {
      id: "approach",
      branch: 7,
      u: 0.54,
      v: 0.65,
      title: "Fermat quintic section",
      latex: "z_1^5+z_2^5+z_3^5+z_4^5+z_5^5=0",
      fullDistance: 1.1,
      fadeDistance: 4.5
    },
    {
      id: "kahler",
      branch: 13,
      u: 0.23,
      v: 0.43,
      title: "Closed Kähler form",
      latex: "dJ=0",
      fullDistance: 0.85,
      fadeDistance: 2.4
    },
    {
      id: "phase",
      branch: 19,
      u: 0.64,
      v: 0.28,
      title: "Projection phase",
      latex: "e^{i\\theta}=\\cos\\theta+i\\sin\\theta",
      fullDistance: 0.85,
      fadeDistance: 2.4
    },
    {
      id: "volume",
      branch: 21,
      u: 0.42,
      v: 0.72,
      title: "Holomorphic volume form",
      latex: "d\\Omega=0",
      fullDistance: 0.85,
      fadeDistance: 2.4
    },
    {
      id: "chern",
      branch: 11,
      u: 0.72,
      v: 0.39,
      title: "First Chern class",
      latex: "c_1(X_6)=0",
      fullDistance: 0.85,
      fadeDistance: 2.4
    },
    {
      id: "ricci",
      branch: 4,
      u: 0.36,
      v: 0.61,
      title: "Ricci-flat metric condition",
      latex: "R_{mn}=0",
      fullDistance: 0.85,
      fadeDistance: 2.4
    },
    {
      id: "flux",
      branch: 17,
      u: 0.57,
      v: 0.46,
      title: "Normalized flux period",
      latex: "\\int_{\\Sigma_p}F_p=N,\\quad N\\in\\mathbb{Z}",
      fullDistance: 1.1,
      fadeDistance: 3.5
    }
  ];

  const OVERLAY_CSS = `
.qe-telemetry-layer {
  position: absolute;
  inset: 0;
  z-index: 10;
  overflow: hidden;
  pointer-events: none;
  color: #00ff66;
  font-family: "Courier New", "Fira Code", monospace;
}

.qe-telemetry-anchor {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  visibility: hidden;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
}

.qe-telemetry-dot {
  position: absolute;
  left: -3px;
  top: -3px;
  width: 6px;
  height: 6px;
  box-sizing: border-box;
  border: 1px solid #00ff66;
  border-radius: 50%;
  background: #000000;
  box-shadow: 0 0 6px rgba(0, 255, 102, 0.5);
}

.qe-telemetry-leader {
  position: absolute;
  left: 0;
  top: 0;
  height: 1px;
  background: rgba(0, 255, 102, 0.65);
  transform-origin: 0 50%;
}

.qe-telemetry-card {
  position: absolute;
  left: 0;
  top: 0;
  box-sizing: border-box;
  width: max-content;
  max-width: min(290px, calc(100vw - 32px));
  padding: 8px 10px;
  border: 1px solid #00ff66;
  background: rgba(0, 16, 0, 0.72);
  color: #00ff66;
  font-size: 11px;
  line-height: 1.4;
  text-shadow: 0 0 5px rgba(0, 255, 102, 0.22);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
}

.qe-telemetry-card strong {
  display: block;
  margin: 0 0 4px;
  font: inherit;
  font-size: 9px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.qe-telemetry-math {
  max-width: 100%;
  overflow: hidden;
  color: inherit;
  white-space: nowrap;
}

.qe-telemetry-math .katex {
  color: inherit;
  font-size: 1.12em;
}

.qe-telemetry-anchor[data-current="true"] .qe-telemetry-card {
  box-shadow: 0 0 12px rgba(0, 255, 102, 0.13);
}

@media (max-width: 520px) {
  .qe-telemetry-card {
    font-size: 10px;
    padding: 6px 8px;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .qe-telemetry-card {
    background: #000000;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }
}

@media (forced-colors: active) {
  .qe-telemetry-card {
    color: CanvasText;
    border-color: CanvasText;
    background: Canvas;
  }

  .qe-telemetry-dot {
    border-color: CanvasText;
    background: Canvas;
  }

  .qe-telemetry-leader {
    background: CanvasText;
  }
}
`;

  let state = "idle";
  let initializationPromise = null;

  let context;
  let THREE;
  let katex;
  let document;
  let dom;
  let scene;
  let camera;
  let renderer;
  let canvas;
  let manifold;
  let surface;
  let particles;
  let layer;
  let styleElement;
  let observer;

  let unsubscribeUpdate = null;
  let unsubscribeResize = null;

  let cameraPosition;
  let viewPoint;
  let projected;
  let bufferSize;

  let previousMotionAttribute = null;
  let motionAttributeSaved = false;
  let lastWaypoint = null;
  let lastCameraMode = null;
  let lastPaused = null;
  let lastFrameTime = null;
  let sampleStart = null;
  let sampleIntervals = 0;
  let fps = null;
  let frameMilliseconds = null;
  let lastReadoutTime = -Infinity;
  let fullscreenPending = false;
  let measureLabels = true;

  const anchors = [];
  const listeners = [];
  const restorers = [];
  const savedElements = new Set();
  const logNodes = new Set();
  const blockers = [];
  const candidates = [];
  const occupied = [];

  function assertActive() {
    if (
      state === "disposed" ||
      (context && context.signal.aborted)
    ) {
      throw new window.DOMException(
        "Telemetry initialization was aborted.",
        "AbortError"
      );
    }
  }

  function usable() {
    return state === "ready" &&
      !context.signal.aborted &&
      !(engine.Boot && engine.Boot.state === "failed");
  }

  function element(id) {
    return (dom && dom[id]) || document.getElementById(id);
  }

  function listen(target, type, handler, options) {
    if (!target) return;

    target.addEventListener(type, handler, options);
    listeners.push({ target, type, handler, options });
  }

  function remember(node, attributes, content) {
    if (!node || savedElements.has(node)) return;

    savedElements.add(node);

    const values = attributes.map(function (name) {
      return [name, node.getAttribute(name)];
    });

    const children = content
      ? Array.from(node.childNodes, function (child) {
        return child.cloneNode(true);
      })
      : null;

    restorers.push(function () {
      if (children) {
        node.replaceChildren(...children);
      }

      for (const pair of values) {
        if (pair[1] === null) {
          node.removeAttribute(pair[0]);
        } else {
          node.setAttribute(pair[0], pair[1]);
        }
      }
    });
  }

  function setText(id, value) {
    const node = element(id);

    if (node && node.textContent !== value) {
      node.textContent = value;
    }
  }

  function smoothstep(a, b, value) {
    const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  function number(value, digits) {
    return Number.isFinite(value)
      ? value.toFixed(digits)
      : "Unavailable";
  }

  function integer(value) {
    return Number.isFinite(value)
      ? Math.max(0, Math.round(value)).toLocaleString("en-US")
      : "Unavailable";
  }

  function simulationTime() {
    const value = context && context.clock.elapsedTime;
    return Number.isFinite(value) ? value : 0;
  }

  function log(message, level) {
    const list = element("qe-terminal-log");

    if (!list || state === "disposed") return;

    const follow =
      list.scrollHeight - list.scrollTop - list.clientHeight < 24;

    const node = document.createElement("li");
    node.className = "qe-terminal__entry";
    node.dataset.level = level || "info";
    node.textContent =
      "[" + simulationTime().toFixed(1) + "s] " + message;

    list.appendChild(node);
    logNodes.add(node);

    while (list.children.length > MAX_LOG_ENTRIES) {
      const first = list.firstElementChild;
      logNodes.delete(first);
      first.remove();
    }

    if (follow) {
      list.scrollTop = list.scrollHeight;
    }
  }

  function announce(message) {
    setText("qe-announcement", message);
  }

  function renderEquation(node, latex, displayMode) {
    katex.render(latex, node, {
      displayMode,
      output: "htmlAndMathml",
      throwOnError: true,
      strict: "error",
      trust: false,
      maxExpand: 1000
    });
  }

  /*
   * Exact CPU counterpart of:
   *   Manifold.projectSection(aComplex, uTime, uScale)
   *
   * Only eight sampled vertices use it. No GPU readback or mesh rebuild occurs.
   */
  function projectSection(q, time, scale, out) {
    const energy =
      q[0] * q[0] +
      q[1] * q[1] +
      q[2] * q[2] +
      q[3] * q[3];

    let angle =
      0.19 * time +
      0.10 * Math.sin(0.23 * time + energy);

    let c = Math.cos(angle);
    let s = Math.sin(angle);

    const ax = c * q[0] - s * q[1];
    const ay = s * q[0] + c * q[1];

    angle =
      -0.13 * time +
      0.08 * Math.sin(0.17 * time - energy);

    c = Math.cos(angle);
    s = Math.sin(angle);

    const bx = c * q[2] - s * q[3];
    const by = s * q[2] + c * q[3];

    const projectionAngle =
      0.74 + 0.22 * Math.sin(0.11 * time);

    let x = ax;
    let y = bx;
    let z =
      Math.cos(projectionAngle) * ay +
      Math.sin(projectionAngle) * by;

    let previous;

    angle = 0.16 * Math.sin(0.31 * time + 0.65 * energy);
    c = Math.cos(angle);
    s = Math.sin(angle);

    previous = x;
    x = c * x - s * z;
    z = s * previous + c * z;

    angle = 0.09 * Math.sin(0.23 * time);
    c = Math.cos(angle);
    s = Math.sin(angle);

    previous = y;
    y = c * y - s * z;
    z = s * previous + c * z;

    angle = 0.04 * time;
    c = Math.cos(angle);
    s = Math.sin(angle);

    previous = x;
    x = c * x - s * y;
    y = s * previous + c * y;

    angle = 0.07 * time;
    c = Math.cos(angle);
    s = Math.sin(angle);

    previous = x;
    x = c * x - s * z;
    z = s * previous + c * z;

    const amplitude =
      scale * (1 + 0.075 * Math.sin(0.73 * time + 0.85 * energy));

    return out.set(
      x * amplitude,
      y * amplitude,
      z * amplitude
    );
  }

  function createAnchors() {
    const info = manifold.userData.manifold;
    const attribute = surface.geometry.getAttribute("aComplex");
    const segments = info.segments;

    if (
      !attribute ||
      attribute.itemSize !== 4 ||
      !Number.isInteger(segments) ||
      segments < 1 ||
      info.branchCount !== 25
    ) {
      throw new Error(
        "Telemetry requires the accepted Manifold's aComplex vertex layout."
      );
    }

    const row = segments + 1;

    for (const definition of DEFINITIONS) {
      const index =
        definition.branch * row * row +
        Math.round(definition.v * segments) * row +
        Math.round(definition.u * segments);

      if (index >= attribute.count) {
        throw new Error(
          "Telemetry anchor exceeds the Manifold vertex buffer."
        );
      }

      const q = [
        attribute.getX(index),
        attribute.getY(index),
        attribute.getZ(index),
        attribute.getW(index)
      ];

      if (!q.every(Number.isFinite)) {
        throw new Error(
          "Telemetry encountered a non-finite Manifold vertex."
        );
      }

      const root = document.createElement("div");
      root.className = "qe-telemetry-anchor";
      root.dataset.anchor = definition.id;

      const dot = document.createElement("span");
      dot.className = "qe-telemetry-dot";

      const leader = document.createElement("span");
      leader.className = "qe-telemetry-leader";

      const card = document.createElement("div");
      card.className = "qe-telemetry-card";

      const title = document.createElement("strong");
      title.textContent = definition.title;

      const equation = document.createElement("div");
      equation.className = "qe-telemetry-math";

      renderEquation(equation, definition.latex, false);

      card.append(title, equation);
      root.append(leader, dot, card);
      layer.appendChild(root);

      anchors.push({
        definition,
        q,
        root,
        card,
        leader,
        world: new THREE.Vector3(),
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        alpha: 0,
        targetAlpha: 0,
        valid: false,
        selected: false,
        placement: 0,
        score: 0
      });
    }
  }

  function markMeasurementsDirty() {
    measureLabels = true;
  }

  function resetFrameSample() {
    lastFrameTime = null;
    sampleStart = null;
    sampleIntervals = 0;
    fps = null;
    frameMilliseconds = null;
    lastReadoutTime = -Infinity;
  }

  function sampleFrame(now) {
    let dt = 0;

    if (lastFrameTime !== null && now >= lastFrameTime) {
      dt = Math.min(0.1, (now - lastFrameTime) / 1000);
    }

    lastFrameTime = now;

    if (sampleStart === null || now < sampleStart) {
      sampleStart = now;
      sampleIntervals = 0;
      return dt;
    }

    sampleIntervals++;

    const elapsed = now - sampleStart;

    if (elapsed >= 500) {
      fps = sampleIntervals * 1000 / elapsed;
      frameMilliseconds = elapsed / sampleIntervals;
      sampleStart = now;
      sampleIntervals = 0;
    }

    return dt;
  }

  function syncWaypoint() {
    const tour = scene.userData.cinematography;
    if (!tour) return;

    const waypoint = tour.waypoint;
    const panel = element("qe-waypoint");

    if (waypoint && waypoint !== lastWaypoint) {
      lastWaypoint = waypoint;

      setText(
        "qe-waypoint-index",
        "Cinematic waypoint " +
          (waypoint.index + 1) +
          " / " +
          tour.waypoints.length
      );

      setText("qe-waypoint-title", waypoint.title);
      setText("qe-waypoint-description", waypoint.description);

      const equation = element("qe-waypoint-equation");

      if (equation) {
        equation.dataset.latex = waypoint.latex;
        renderEquation(equation, waypoint.latex, true);
      }

      if (panel) {
        panel.hidden = false;
      }

      log(
        "Waypoint " +
          (waypoint.index + 1) +
          ": " +
          waypoint.title
      );

      measureLabels = true;
    }

    if (tour.mode !== lastCameraMode) {
      if (lastCameraMode !== null) {
        log("Camera: " + tour.mode + ".");
      }

      lastCameraMode = tour.mode;
    }
  }

  function intersects(a, b, padding) {
    return (
      a.left < b.right + padding &&
      a.right > b.left - padding &&
      a.top < b.bottom + padding &&
      a.bottom > b.top - padding
    );
  }

  function updateAnchors(dt) {
    // Read layout before writing this frame's transforms and opacity.
    const canvasRect = canvas.getBoundingClientRect();
    const layerRect = layer.getBoundingClientRect();
    const width = layer.clientWidth;
    const height = layer.clientHeight;

    if (
      canvasRect.width <= 0 ||
      canvasRect.height <= 0 ||
      layerRect.width <= 0 ||
      layerRect.height <= 0 ||
      !width ||
      !height
    ) {
      for (const anchor of anchors) {
        anchor.alpha = 0;
        anchor.root.style.visibility = "hidden";
      }

      return;
    }

    const sx = layerRect.width / width;
    const sy = layerRect.height / height;

    const canvasBounds = {
      left: Math.max(
        0,
        (canvasRect.left - layerRect.left) / sx
      ),
      right: Math.min(
        width,
        (canvasRect.right - layerRect.left) / sx
      ),
      top: Math.max(
        0,
        (canvasRect.top - layerRect.top) / sy
      ),
      bottom: Math.min(
        height,
        (canvasRect.bottom - layerRect.top) / sy
      )
    };

    occupied.length = 0;

    for (const blocker of blockers) {
      if (blocker.hidden) continue;

      const rect = blocker.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;

      const box = {
        left: (rect.left - layerRect.left) / sx,
        right: (rect.right - layerRect.left) / sx,
        top: (rect.top - layerRect.top) / sy,
        bottom: (rect.bottom - layerRect.top) / sy
      };

      if (intersects(box, canvasBounds, 0)) {
        occupied.push(box);
      }
    }

    if (measureLabels) {
      for (const anchor of anchors) {
        anchor.width = anchor.card.offsetWidth;
        anchor.height = anchor.card.offsetHeight;
      }

      measureLabels = false;
    }

    camera.updateMatrixWorld(true);
    surface.updateWorldMatrix(true, false);

    cameraPosition.setFromMatrixPosition(camera.matrixWorld);

    const radius =
      manifold.userData.manifold.boundingRadius *
      surface.matrixWorld.getMaxScaleOnAxis();

    const uniforms = surface.material.uniforms;
    const time = uniforms.uTime.value;
    const scale = uniforms.uScale.value;

    if (
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(time) ||
      !Number.isFinite(scale)
    ) {
      throw new Error(
        "Telemetry requires finite Manifold projection uniforms and bounds."
      );
    }

    const crt = scene.userData.crtCompositor;

    const bufferWidth =
      crt && crt.width > 0 ? crt.width : canvas.width;

    const bufferHeight =
      crt && crt.height > 0 ? crt.height : canvas.height;

    const aspectSquaredX = bufferWidth * bufferWidth;
    const aspectSquaredY = bufferHeight * bufferHeight;
    const aspectSum = Math.max(1, aspectSquaredX + aspectSquaredY);
    const currentID = lastWaypoint ? lastWaypoint.id : "";

    candidates.length = 0;

    for (const anchor of anchors) {
      anchor.valid = false;
      anchor.selected = false;
      anchor.targetAlpha = 0;

      projectSection(anchor.q, time, scale, anchor.world);
      anchor.world.applyMatrix4(surface.matrixWorld);

      viewPoint
        .copy(anchor.world)
        .applyMatrix4(camera.matrixWorldInverse);

      const depth = -viewPoint.z;

      if (depth <= camera.near || depth >= camera.far) {
        continue;
      }

      projected.copy(anchor.world).project(camera);

      if (
        !Number.isFinite(projected.x) ||
        !Number.isFinite(projected.y) ||
        !Number.isFinite(projected.z) ||
        Math.abs(projected.x) > 1 ||
        Math.abs(projected.y) > 1 ||
        projected.z < -1 ||
        projected.z > 1
      ) {
        continue;
      }

      // Invert the compositor's display-to-source radial warp.
      // The green channel has no chromatic-aberration offset.
      let x = 0.5 * projected.x;
      let y = 0.5 * projected.y;

      if (crt && crt.crtEnabled) {
        const r2 =
          4 * (
            x * x * aspectSquaredX +
            y * y * aspectSquaredY
          ) / aspectSum;

        const k = CRT_CURVATURE * r2;
        let factor = 1;

        for (let iteration = 0; iteration < 3; iteration++) {
          factor -=
            (factor + k * factor * factor * factor - 1) /
            (1 + 3 * k * factor * factor);
        }

        x *= factor;
        y *= factor;
      }

      anchor.x = (
        canvasRect.left +
        (0.5 + x) * canvasRect.width -
        layerRect.left
      ) / sx;

      anchor.y = (
        canvasRect.top +
        (0.5 - y) * canvasRect.height -
        layerRect.top
      ) / sy;

      anchor.valid = true;

      const distance =
        cameraPosition.distanceTo(anchor.world) / radius;

      const definition = anchor.definition;

      const proximity = 1 - smoothstep(
        definition.fullDistance,
        definition.fadeDistance,
        distance
      );

      const nearFade = smoothstep(0.035, 0.16, distance);

      const edgeDistance = Math.min(
        anchor.x - canvasBounds.left,
        canvasBounds.right - anchor.x,
        anchor.y - canvasBounds.top,
        canvasBounds.bottom - anchor.y
      );

      anchor.targetAlpha =
        proximity *
        nearFade *
        smoothstep(3, 24, edgeDistance);

      anchor.score =
        anchor.targetAlpha +
        (definition.id === currentID ? 0.35 : 0) +
        (anchor.alpha > 0.1 ? 0.08 : 0);

      if (anchor.targetAlpha > 0.01) {
        candidates.push(anchor);
      }
    }

    candidates.sort(function (a, b) {
      return b.score - a.score;
    });

    const maximumLabels =
      width < 520 ? 1 :
      width < 1000 ? 2 :
      3;

    let visibleCount = 0;

    for (const anchor of candidates) {
      if (visibleCount >= maximumLabels) break;
      if (!anchor.width || !anchor.height) continue;

      for (let attempt = 0; attempt < 4; attempt++) {
        const choice = (anchor.placement + attempt) % 4;
        const leftSide = choice === 1 || choice === 3;
        const below = choice >= 2;

        const dx = leftSide ? -anchor.width - 15 : 15;
        const dy = below ? 12 : -anchor.height - 12;

        const box = {
          left: anchor.x + dx,
          right: anchor.x + dx + anchor.width,
          top: anchor.y + dy,
          bottom: anchor.y + dy + anchor.height
        };

        if (
          box.left < canvasBounds.left + 8 ||
          box.right > canvasBounds.right - 8 ||
          box.top < canvasBounds.top + 8 ||
          box.bottom > canvasBounds.bottom - 8 ||
          occupied.some(function (other) {
            return intersects(box, other, 6);
          })
        ) {
          continue;
        }

        anchor.selected = true;
        anchor.placement = choice;

        anchor.card.style.transform =
          "translate(" + dx + "px," + dy + "px)";

        const leaderX = leftSide ? dx + anchor.width : dx;
        const leaderY = below ? dy : dy + anchor.height;

        anchor.leader.style.width =
          Math.hypot(leaderX, leaderY).toFixed(2) + "px";

        anchor.leader.style.transform =
          "rotate(" + Math.atan2(leaderY, leaderX) + "rad)";

        occupied.push(box);
        visibleCount++;
        break;
      }
    }

    const reduced =
      element("qe-motion-mode").value === "reduced";

    const response = reduced ? 1 : 1 - Math.exp(-9 * dt);

    for (const anchor of anchors) {
      if (!anchor.valid) {
        anchor.alpha = 0;
        anchor.root.style.visibility = "hidden";
        anchor.root.style.opacity = "0";
        continue;
      }

      const target = anchor.selected ? anchor.targetAlpha : 0;
      anchor.alpha += (target - anchor.alpha) * response;

      if (Math.abs(target - anchor.alpha) < 0.001) {
        anchor.alpha = target;
      }

      anchor.root.style.transform =
        "translate3d(" +
        anchor.x.toFixed(2) + "px," +
        anchor.y.toFixed(2) + "px,0)";

      anchor.root.style.opacity = anchor.alpha.toFixed(3);

      anchor.root.style.visibility =
        anchor.alpha > 0.005 ? "visible" : "hidden";

      anchor.root.dataset.current =
        anchor.definition.id === currentID ? "true" : "false";
    }
  }

  function syncPauseControl(report) {
    const paused = context.paused === true;
    const button = element("qe-toggle-simulation");

    button.textContent =
      paused ? "Resume simulation" : "Pause simulation";

    button.setAttribute(
      "aria-pressed",
      paused ? "true" : "false"
    );

    if (
      report &&
      lastPaused !== null &&
      lastPaused !== paused
    ) {
      const message =
        paused ? "Simulation paused." : "Simulation resumed.";

      log(message);
      announce(message);
    }

    lastPaused = paused;
  }

  function togglePause() {
    if (!usable()) return;

    context.setPaused(!context.paused);
    syncPauseControl(true);
  }

  function syncFullscreenControl() {
    const button = element("qe-toggle-fullscreen");
    const app = element("qe-app");
    const active = document.fullscreenElement === app;

    const supported =
      typeof app.requestFullscreen === "function" &&
      typeof document.exitFullscreen === "function" &&
      document.fullscreenEnabled !== false;

    button.disabled = fullscreenPending || !supported;

    button.setAttribute(
      "aria-pressed",
      active ? "true" : "false"
    );

    button.textContent = !supported
      ? "Fullscreen unavailable"
      : active
        ? "Exit fullscreen"
        : "Enter fullscreen";
  }

  async function toggleFullscreen() {
    if (!usable() || fullscreenPending) return;

    const activeDocument = document;
    const app = element("qe-app");

    if (
      typeof app.requestFullscreen !== "function" ||
      typeof activeDocument.exitFullscreen !== "function" ||
      activeDocument.fullscreenEnabled === false
    ) {
      syncFullscreenControl();
      return;
    }

    fullscreenPending = true;
    syncFullscreenControl();

    try {
      // Invoke directly in the original click/keyboard activation task.
      if (activeDocument.fullscreenElement) {
        await activeDocument.exitFullscreen();
      } else {
        await app.requestFullscreen();
      }
    } catch (error) {
      if (usable()) {
        log(
          "Fullscreen request was not completed: " +
          (error && error.message ? error.message : String(error)),
          "warning"
        );

        announce("Fullscreen could not be changed.");
      }
    } finally {
      fullscreenPending = false;

      if (usable()) {
        syncFullscreenControl();
      }
    }
  }

  function onFullscreenChange() {
    if (!usable()) return;

    syncFullscreenControl();
    markMeasurementsDirty();
  }

  function onCanvasKeyDown(event) {
    if (
      !usable() ||
      event.target !== canvas ||
      event.defaultPrevented ||
      event.isComposing ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    if (event.code !== "Space" && event.code !== "KeyF") {
      return;
    }

    event.preventDefault();

    if (event.repeat) return;

    if (event.code === "Space") {
      togglePause();
    } else {
      void toggleFullscreen();
    }
  }

  function bindSlider(inputID, outputID, label) {
    const input = element(inputID);
    const output = element(outputID);

    remember(output, [], true);
    remember(input, ["aria-valuetext"], false);

    function sync() {
      const value = Number(input.value);

      const text = Number.isFinite(value)
        ? value.toFixed(2) + "×"
        : "Unavailable";

      if (output.textContent !== text) {
        output.textContent = text;
      }

      input.setAttribute("aria-valuetext", text);
    }

    sync();
    listen(input, "input", sync);

    listen(input, "change", function () {
      if (!usable()) return;

      sync();
      log(label + ": " + output.textContent);
    });
  }

  function bindControls() {
    remember(
      element("qe-toggle-simulation"),
      ["aria-pressed"],
      true
    );

    remember(
      element("qe-toggle-fullscreen"),
      ["aria-pressed", "disabled"],
      true
    );

    listen(
      element("qe-toggle-simulation"),
      "click",
      togglePause
    );

    listen(
      element("qe-toggle-fullscreen"),
      "click",
      function () {
        void toggleFullscreen();
      }
    );

    listen(canvas, "keydown", onCanvasKeyDown);
    listen(document, "fullscreenchange", onFullscreenChange);

    bindSlider(
      "qe-phase-speed",
      "qe-phase-speed-value",
      "Projection phase speed"
    );

    bindSlider(
      "qe-flux-intensity",
      "qe-flux-intensity-value",
      "Flux intensity"
    );

    bindSlider(
      "qe-bloom-strength",
      "qe-bloom-strength-value",
      "Bloom strength"
    );

    previousMotionAttribute =
      document.documentElement.getAttribute("data-motion");

    motionAttributeSaved = true;

    const motion = element("qe-motion-mode");

    document.documentElement.dataset.motion =
      motion.value === "reduced" ? "reduced" : "full";

    listen(motion, "change", function () {
      if (!usable()) return;

      const reduced = motion.value === "reduced";

      document.documentElement.dataset.motion =
        reduced ? "reduced" : "full";

      const message = reduced
        ? "Reduced motion enabled."
        : "Full cinematic motion enabled.";

      log(message);
      announce(message);
    });

    listen(element("qe-crt-enabled"), "change", function () {
      if (usable()) {
        log(
          "CRT optics " +
          (element("qe-crt-enabled").checked ? "enabled." : "disabled.")
        );
      }
    });

    syncPauseControl(false);
    syncFullscreenControl();
  }

  function updateDiagnostics() {
    const info = renderer.info.render;
    const field = manifold.userData.manifold;
    const flux = particles.userData.topologicalFlux;
    const tour = scene.userData.cinematography;

    renderer.getDrawingBufferSize(bufferSize);

    setText(
      "qe-fps",
      fps === null ? "Sampling" : fps.toFixed(1) + " fps"
    );

    setText(
      "qe-frame-time",
      frameMilliseconds === null
        ? "Sampling"
        : frameMilliseconds.toFixed(2) + " ms"
    );

    setText(
      "qe-resolution",
      integer(bufferSize.x) + " × " + integer(bufferSize.y)
    );

    setText(
      "qe-pixel-ratio",
      number(renderer.getPixelRatio(), 2) + "×"
    );

    let visible = true;

    for (let object = particles; object; object = object.parent) {
      if (!object.visible) {
        visible = false;
        break;
      }
    }

    setText(
      "qe-particle-count",
      integer(
        visible && flux.intensity > 0
          ? flux.particleCount
          : 0
      )
    );

    setText("qe-draw-calls", integer(info.calls));
    setText("qe-triangle-count", integer(info.triangles));
    setText("qe-phase-value", number(field.phase, 3) + " rad");

    setText(
      "qe-camera-mode",
      tour ? tour.mode.replace(/-/g, " ") : "Unavailable"
    );

    setText(
      "qe-camera-distance",
      number(tour && tour.distance, 2) + " scene units"
    );

    setText(
      "qe-simulation-time",
      simulationTime().toFixed(2) + " s"
    );

    syncPauseControl(true);
    syncFullscreenControl();
  }

  function update(deltaTime, elapsedTime, clock) {
    if (!usable()) return;

    const now =
      clock &&
      Number.isFinite(clock.timestamp) &&
      clock.timestamp > 0
        ? clock.timestamp
        : window.performance.now();

    const presentationDelta = sampleFrame(now);

    syncWaypoint();
    updateAnchors(presentationDelta);

    if (now - lastReadoutTime >= 250) {
      lastReadoutTime = now;
      updateDiagnostics();
    }
  }

  async function initialize(sharedContext) {
    try {
      context = sharedContext;
      THREE = engine.Dependencies && engine.Dependencies.THREE;
      katex = engine.Dependencies && engine.Dependencies.katex;

      const core = engine.Core;

      document = window.document;
      dom = context && context.dom ? context.dom : engine.DOM;

      if (
        !context ||
        !context.signal ||
        !context.clock ||
        !context.capabilities ||
        typeof context.setPaused !== "function" ||
        typeof context.registerResizeCallback !== "function" ||
        !THREE ||
        !katex ||
        typeof katex.render !== "function" ||
        !core ||
        typeof core.getCamera !== "function" ||
        typeof core.getScene !== "function" ||
        typeof core.getRenderer !== "function" ||
        typeof core.registerUpdateCallback !== "function"
      ) {
        throw new Error(
          "Telemetry requires the accepted Core shared context, Three.js and KaTeX."
        );
      }

      assertActive();

      camera = window.QuantumEngine.Core.getCamera();
      scene = core.getScene();
      renderer = core.getRenderer();
      canvas = renderer && renderer.domElement;

      if (
        !camera ||
        !camera.isPerspectiveCamera ||
        !scene ||
        !canvas
      ) {
        throw new Error(
          "Telemetry requires Core's initialized camera, renderer and canvas."
        );
      }

      manifold = scene.getObjectByName("QuantumEngine.Manifold");
      surface = scene.getObjectByName("QuantumEngine.Manifold.Surface");
      particles = scene.getObjectByName("QuantumEngine.TopologicalFlux");

      if (
        !manifold ||
        !manifold.userData.manifold ||
        !surface ||
        !surface.material.uniforms.uTime ||
        !surface.material.uniforms.uScale ||
        !particles ||
        !particles.userData.topologicalFlux ||
        !scene.userData.cinematography
      ) {
        throw new Error(
          "Telemetry requires the initialized Manifold, Flux and Cinematography modules."
        );
      }

      for (const id of [
        "qe-app",
        "qe-stage",
        "qe-motion-mode",
        "qe-crt-enabled",
        "qe-toggle-simulation",
        "qe-toggle-fullscreen",
        "qe-phase-speed",
        "qe-phase-speed-value",
        "qe-flux-intensity",
        "qe-flux-intensity-value",
        "qe-bloom-strength",
        "qe-bloom-strength-value"
      ]) {
        if (!element(id)) {
          throw new Error(
            "Telemetry requires #" + id + " from index.html."
          );
        }
      }

      cameraPosition = new THREE.Vector3();
      viewPoint = new THREE.Vector3();
      projected = new THREE.Vector3();
      bufferSize = new THREE.Vector2();

      for (const id of [
        "qe-webgl-status",
        "qe-renderer-name",
        "qe-fps",
        "qe-frame-time",
        "qe-resolution",
        "qe-pixel-ratio",
        "qe-antialias",
        "qe-shader-precision",
        "qe-float-targets",
        "qe-particle-count",
        "qe-draw-calls",
        "qe-triangle-count",
        "qe-phase-value",
        "qe-camera-mode",
        "qe-camera-distance",
        "qe-simulation-time"
      ]) {
        remember(element(id), ["title"], true);
      }

      for (const id of [
        "qe-waypoint-index",
        "qe-waypoint-title",
        "qe-waypoint-description",
        "qe-announcement"
      ]) {
        remember(element(id), [], true);
      }

      remember(
        element("qe-waypoint-equation"),
        ["data-latex"],
        true
      );

      remember(
        element("qe-waypoint"),
        ["hidden"],
        false
      );

      const caps = context.capabilities;

      setText("qe-webgl-status", "WebGL " + caps.webglVersion);
      setText("qe-renderer-name", String(caps.renderer));
      setText("qe-antialias", caps.antialias ? "Enabled" : "Unavailable");
      setText("qe-shader-precision", String(caps.precision));

      setText(
        "qe-float-targets",
        caps.floatRenderTargets ? "Supported" : "Unavailable"
      );

      const frameTimeField = element("qe-frame-time");

      if (frameTimeField) {
        frameTimeField.title =
          "Average real frame interval; not GPU execution time.";
      }

      for (const id of ["qe-draw-calls", "qe-triangle-count"]) {
        const node = element(id);

        if (node) {
          node.title =
            "Whole-frame submissions, including GPU compute and post-processing.";
        }
      }

      styleElement = document.createElement("style");
      styleElement.textContent = OVERLAY_CSS;
      document.head.appendChild(styleElement);

      layer = document.createElement("div");
      layer.className = "qe-telemetry-layer";

      // Accessible equations remain in the theory atlas and waypoint panel.
      layer.setAttribute("aria-hidden", "true");

      element("qe-stage").appendChild(layer);
      createAnchors();

      for (const id of [
        "qe-theory-panel",
        "qe-diagnostics-panel",
        "qe-controls",
        "qe-waypoint"
      ]) {
        const node = element(id);

        if (node) {
          blockers.push(node);
        }
      }

      const app = element("qe-app");

      for (const selector of [".qe-header", ".qe-footer"]) {
        const node = app.querySelector(selector);

        if (node) {
          blockers.push(node);
        }
      }

      bindControls();

      listen(
        window,
        "resize",
        markMeasurementsDirty,
        { passive: true }
      );

      listen(document, "visibilitychange", resetFrameSample);
      listen(window, "pageshow", resetFrameSample);

      if (window.visualViewport) {
        listen(
          window.visualViewport,
          "resize",
          markMeasurementsDirty,
          { passive: true }
        );
      }

      if (document.fonts) {
        listen(
          document.fonts,
          "loadingdone",
          markMeasurementsDirty
        );
      }

      if (typeof window.ResizeObserver === "function") {
        observer = new window.ResizeObserver(markMeasurementsDirty);
        observer.observe(canvas);
        observer.observe(layer);

        for (const anchor of anchors) {
          observer.observe(anchor.card);
        }
      }

      unsubscribeResize =
        context.registerResizeCallback(markMeasurementsDirty);

      unsubscribeUpdate =
        window.QuantumEngine.Core.registerUpdateCallback(
          update,
          {
            phase: "afterRender",
            priority: 100,
            label: "Telemetry and projected equations"
          }
        );

      assertActive();

      state = "ready";

      syncWaypoint();
      log("Eight surface anchors linked to the animated projection.");
      log("Frame counters include the complete compute and compositor pipeline.");
      updateDiagnostics();

      return layer;
    } catch (error) {
      try {
        dispose();
      } catch (cleanupError) {
        window.console.error(
          "Telemetry cleanup failed:",
          cleanupError
        );
      }

      throw error;
    }
  }

  function init(sharedContext) {
    if (state === "disposed") {
      throw new Error(
        "Telemetry has been disposed. Reload before initializing again."
      );
    }

    if (initializationPromise) {
      return initializationPromise;
    }

    state = "initializing";
    initializationPromise = initialize(sharedContext);

    return initializationPromise;
  }

  function dispose() {
    if (state === "disposed") return;

    state = "disposed";

    const errors = [];

    function release(operation) {
      try {
        operation();
      } catch (error) {
        errors.push(error);
      }
    }

    if (unsubscribeUpdate) {
      release(unsubscribeUpdate);
    }

    if (unsubscribeResize) {
      release(unsubscribeResize);
    }

    unsubscribeUpdate = null;
    unsubscribeResize = null;

    if (observer) {
      release(function () {
        observer.disconnect();
      });
    }

    observer = null;

    while (listeners.length) {
      const item = listeners.pop();

      release(function () {
        item.target.removeEventListener(
          item.type,
          item.handler,
          item.options
        );
      });
    }

    if (layer) {
      release(function () {
        layer.remove();
      });
    }

    if (styleElement) {
      release(function () {
        styleElement.remove();
      });
    }

    for (const node of logNodes) {
      release(function () {
        node.remove();
      });
    }

    logNodes.clear();

    while (restorers.length) {
      release(restorers.pop());
    }

    savedElements.clear();

    if (document && motionAttributeSaved) {
      release(function () {
        if (previousMotionAttribute === null) {
          document.documentElement.removeAttribute("data-motion");
        } else {
          document.documentElement.setAttribute(
            "data-motion",
            previousMotionAttribute
          );
        }
      });
    }

    // Disposal does not reverse the user's fullscreen or control preferences.
    anchors.length = 0;
    blockers.length = 0;
    candidates.length = 0;
    occupied.length = 0;

    layer = null;
    styleElement = null;
    cameraPosition = null;
    viewPoint = null;
    projected = null;
    bufferSize = null;
    lastWaypoint = null;
    context = null;
    dom = null;
    scene = null;
    camera = null;
    renderer = null;
    canvas = null;
    manifold = null;
    surface = null;
    particles = null;
    katex = null;
    THREE = null;
    document = null;

    if (errors.length) {
      throw new AggregateError(
        errors,
        "Telemetry cleanup failed."
      );
    }
  }

  engine.Telemetry = Object.freeze({ init, dispose });
})(window);