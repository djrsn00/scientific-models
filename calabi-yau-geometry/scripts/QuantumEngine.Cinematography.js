/*
 * QuantumEngine.Cinematography.js
 *
 * A 120-second closed, centripetal Catmull-Rom tour of the projected section.
 * Arc-length sampling is combined with a radius-dependent pacing table so
 * the inner passages receive substantial screen time.
 *
 * Camera controls owned here:
 *   qe-toggle-tour, qe-reset-view, qe-tour-progress, qe-tour-status;
 *   canvas C/R shortcuts and OrbitControls pointer/wheel/arrow navigation.
 *
 * Telemetry can read scene.userData.cinematography, including the current
 * mathematical waypoint. It should not bind the camera controls a second time.
 * Global simulation transport, fullscreen and equation rendering remain with
 * their respective owners.
 *
 * The path traverses an animated projection, not a collision-tested physical
 * six-dimensional space. Core's clipping planes and field of view are retained.
 * dispose() is required by the accepted loader.
 */
(function quantumEngineCinematographyModule(window) {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};
  const engine = window.QuantumEngine;

  if (typeof engine !== "object" || engine === null) {
    throw new TypeError("window.QuantumEngine must be an object.");
  }

  if (engine.Cinematography !== undefined) {
    throw new Error("QuantumEngine.Cinematography has already been registered.");
  }

  const LOOP_SECONDS = 120;
  const RESUME_SECONDS = 2.4;
  const ARC_SAMPLES_PER_SEGMENT = 256;
  const PACING_SAMPLES = 4096;
  const MAX_PITCH = Math.PI * 0.47;

  const WAYPOINTS = Object.freeze([
    Object.freeze({
      index: 0,
      start: 0,
      id: "macro",
      title: "Ten-dimensional compactification",
      latex: "M_{10}=M_{3,1}\\times X_6",
      description:
        "The distant view introduces the compact internal factor through its three-dimensional visualization."
    }),
    Object.freeze({
      index: 1,
      start: 4 / 36,
      id: "approach",
      title: "Approaching the Fermat quintic",
      latex: "z_1^5+z_2^5+z_3^5+z_4^5+z_5^5=0",
      description:
        "The displayed sheets come from a finite two-real-dimensional section of the quintic threefold."
    }),
    Object.freeze({
      index: 2,
      start: 8 / 36,
      id: "kahler",
      title: "Entering the projected folds",
      latex: "dJ=0",
      description:
        "Closure of the Kähler form is a geometric condition; the camera now enters the projected interior."
    }),
    Object.freeze({
      index: 3,
      start: 13 / 36,
      id: "phase",
      title: "Phase and projection",
      latex: "e^{i\\theta}=\\cos\\theta+i\\sin\\theta",
      description:
        "Complex phase rotations animate the visualization map while the original algebraic section remains fixed."
    }),
    Object.freeze({
      index: 4,
      start: 18 / 36,
      id: "volume",
      title: "Holomorphic volume structure",
      latex: "d\\Omega=0",
      description:
        "The closed holomorphic volume form motivates this geometric reference; luminous transport is illustrative."
    }),
    Object.freeze({
      index: 5,
      start: 23 / 36,
      id: "chern",
      title: "Topological condition",
      latex: "c_1(X_6)=0",
      description:
        "A vanishing first Chern class is part of the Calabi–Yau framework, beyond what this projection alone can display."
    }),
    Object.freeze({
      index: 6,
      start: 27 / 36,
      id: "ricci",
      title: "Leaving the inner passages",
      latex: "R_{mn}=0",
      description:
        "Ricci-flatness describes the metric condition; the visible optical surface is not a numerical metric solution."
    }),
    Object.freeze({
      index: 7,
      start: 31 / 36,
      id: "flux",
      title: "Flux and the return to scale",
      latex: "\\int_{\\Sigma_p}F_p=N",
      description:
        "Flux quantization is shown schematically, with normalization absorbed into F. The camera returns to its macro orbit."
    })
  ]);

  const listeners = [];
  const uiRestorers = [];
  const capturedPointers = new Set();

  let THREE = null;
  let context = null;
  let camera = null;
  let scene = null;
  let canvas = null;
  let manifold = null;
  let controls = null;
  let curve = null;
  let pacing = null;
  let curveLength = 0;
  let localRadius = 1;
  let worldRadius = 1;

  let state = "idle";
  let initializationPromise = null;
  let unsubscribeUpdate = null;
  let originalPose = null;
  let originalTouchAction = "";
  let originalTouchPriority = "";
  let originalTabIndex = null;
  let canvasStateSaved = false;

  let tourButton = null;
  let resetButton = null;
  let progressElement = null;
  let statusElement = null;
  let motionControl = null;
  let metadata = null;
  let previousMetadata;
  let hadPreviousMetadata = false;

  let guided = true;
  let resuming = false;
  let interacting = false;
  let resumeAfterInteraction = false;
  let resetAfterInteraction = false;
  let routeSeconds = 0;
  let activeTourSeconds = 0;
  let loopCount = 0;
  let arcProgress = 0;
  let parameterProgress = 0;
  let resumeElapsed = 0;
  let autoYaw = 0;
  let autoPitch = 0;
  let desiredYaw = 0;
  let desiredPitch = 0;
  let desiredFocus = 1;
  let currentFocus = 1;
  let resumeYaw = 0;
  let resumePitch = 0;
  let resumeFocus = 1;
  let uiElapsed = 0;
  let uiDirty = true;

  let worldUp = null;
  let worldCenter = null;
  let localPosition = null;
  let localAhead = null;
  let localBehind = null;
  let localTangent = null;
  let worldPosition = null;
  let worldAhead = null;
  let worldTangent = null;
  let direction = null;
  let lookTarget = null;
  let resumePosition = null;
  let forward = null;
  let lookMatrix = null;
  let centerQuaternion = null;
  let forwardQuaternion = null;
  let blendedQuaternion = null;

  function wrap01(value) {
    return value - Math.floor(value);
  }

  function wrapAngle(value) {
    return Math.atan2(Math.sin(value), Math.cos(value));
  }

  function smoothstep(lower, upper, value) {
    const t = Math.max(0, Math.min(1, (value - lower) / (upper - lower)));
    return t * t * (3 - 2 * t);
  }

  function smootherstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  function assertActive() {
    if (
      state === "disposed" ||
      (context && context.signal && context.signal.aborted)
    ) {
      throw new window.DOMException(
        "Cinematography initialization was aborted.",
        "AbortError"
      );
    }
  }

  function addListener(target, type, handler, options) {
    if (!target) return;

    target.addEventListener(type, handler, options);
    listeners.push({ target, type, handler, options });
  }

  function reducedMotion() {
    return motionControl
      ? motionControl.value === "reduced"
      : window.document.documentElement.dataset.motion === "reduced";
  }

  function simulationPaused() {
    return Boolean(context && context.paused);
  }

  function createTrack() {
    // Coordinates are multiples of the Manifold's conservative local radius.
    // The final point is distinct: closed=true provides the closing segment.
    const coordinates = [
      [ 6.80,  3.00, 18.00],
      [ 9.20,  3.60, 15.00],
      [10.40,  2.80, 10.00],
      [ 8.00,  1.50,  6.00],
      [ 4.00,  0.80,  3.50],
      [ 2.20,  0.35,  2.15],
      [ 1.10,  0.24,  1.05],
      [ 0.45,  0.18,  0.62],
      [ 0.12,  0.055, 0.26],
      [-0.12, -0.04,  0.10],
      [-0.38, -0.18,  0.24],
      [-0.62, -0.12,  0.06],
      [-0.50,  0.20, -0.32],
      [-0.19,  0.29, -0.46],
      [ 0.16,  0.12, -0.30],
      [ 0.055,-0.035,-0.045],
      [ 0.30, -0.19,  0.10],
      [ 0.61, -0.27, -0.15],
      [ 0.68,  0.10, -0.60],
      [ 0.30,  0.43, -0.83],
      [-0.28,  0.31, -0.68],
      [-0.64,  0.06, -0.32],
      [-0.76, -0.24,  0.22],
      [-0.34, -0.43,  0.56],
      [ 0.22, -0.32,  0.55],
      [ 0.54,  0.08,  0.23],
      [ 0.58,  0.42, -0.15],
      [ 0.26,  0.70, -0.78],
      [-0.70,  0.90, -1.05],
      [-1.60,  0.85, -0.45],
      [-2.25,  0.65,  1.05],
      [-1.45,  0.55,  2.65],
      [ 0.40,  0.80,  4.30],
      [ 2.80,  1.40,  7.80],
      [ 4.30,  2.00, 12.40],
      [ 4.80,  2.40, 16.50]
    ];

    const points = coordinates.map(function (p) {
      return new THREE.Vector3(p[0], p[1], p[2]).multiplyScalar(localRadius);
    });

    curve = new THREE.CatmullRomCurve3(points, true, "centripetal");

    // Align arc-length samples with every control-point boundary.
    curve.arcLengthDivisions = points.length * ARC_SAMPLES_PER_SEGMENT;
    curve.updateArcLengths();
    curveLength = curve.getLength();

    if (!Number.isFinite(curveLength) || curveLength <= 0) {
      throw new Error("Cinematography generated an invalid spline.");
    }
  }

  async function createPacingTable() {
    pacing = new Float64Array(PACING_SAMPLES + 1);
    const sample = new THREE.Vector3();

    function density(arc) {
      curve.getPointAt(arc, sample);

      const radius = sample.length() / localRadius;
      const speed = 0.28 + 4.72 * smoothstep(0.60, 6.0, radius);

      return 1 / speed;
    }

    let previousDensity = density(0);
    let accumulated = 0;

    for (let i = 1; i <= PACING_SAMPLES; i++) {
      const nextDensity = density(i / PACING_SAMPLES);

      accumulated += 0.5 * (previousDensity + nextDensity);
      pacing[i] = accumulated;
      previousDensity = nextDensity;

      if (i % 1024 === 0) {
        await new Promise(function (resolve) {
          window.setTimeout(resolve, 0);
        });

        assertActive();
      }
    }

    for (let i = 1; i <= PACING_SAMPLES; i++) {
      pacing[i] /= accumulated;
    }

    pacing[PACING_SAMPLES] = 1;
  }

  function phaseToArc(phase) {
    const time = wrap01(phase);
    let low = 0;
    let high = PACING_SAMPLES;

    while (high - low > 1) {
      const middle = (low + high) >> 1;

      if (pacing[middle] <= time) {
        low = middle;
      } else {
        high = middle;
      }
    }

    const span = pacing[high] - pacing[low];
    const fraction = span > 0 ? (time - pacing[low]) / span : 0;

    return (low + fraction) / PACING_SAMPLES;
  }

  function updateFrameOfReference() {
    manifold.updateWorldMatrix(true, false);

    worldCenter.setFromMatrixPosition(manifold.matrixWorld);
    worldRadius = localRadius * manifold.matrixWorld.getMaxScaleOnAxis();

    if (!Number.isFinite(worldRadius) || worldRadius <= 0) {
      throw new Error(
        "Cinematography requires a finite, nonzero Manifold scale."
      );
    }

    if (controls) {
      controls.cursor.copy(worldCenter);

      controls.minDistance = Math.max(
        camera.near * 4,
        worldRadius * 0.0001
      );

      controls.maxDistance = Math.max(
        controls.minDistance * 2,
        Math.min(camera.far * 0.75, worldRadius * 60)
      );

      controls.maxTargetRadius = worldRadius * 4;
    }
  }

  function evaluateRoute() {
    arcProgress = phaseToArc(routeSeconds / LOOP_SECONDS);
    parameterProgress = curve.getUtoTmapping(arcProgress);

    curve.getPointAt(arcProgress, localPosition);
    curve.getTangentAt(arcProgress, localTangent);

    // The inherited tangent method uses one-sided endpoint differences.
    // Wrapped samples remove that small mismatch at the closed-loop seam.
    const seamWindow = 2 / curve.arcLengthDivisions;

    if (arcProgress < seamWindow || arcProgress > 1 - seamWindow) {
      curve.getPointAt(wrap01(arcProgress + seamWindow), localAhead);
      curve.getPointAt(wrap01(arcProgress - seamWindow), localBehind);

      localTangent.subVectors(localAhead, localBehind).normalize();
    }

    const lookAheadArc = localRadius * 0.12 / curveLength;

    curve.getPointAt(
      wrap01(arcProgress + lookAheadArc),
      localAhead
    );

    worldPosition.copy(localPosition).applyMatrix4(manifold.matrixWorld);
    worldAhead.copy(localAhead).applyMatrix4(manifold.matrixWorld);
    worldTangent.copy(localTangent).transformDirection(manifold.matrixWorld);

    if (worldAhead.distanceToSquared(worldPosition) < 1.0e-10) {
      worldAhead
        .copy(worldPosition)
        .addScaledVector(worldTangent, worldRadius * 0.12);
    }

    lookMatrix.lookAt(worldPosition, worldAhead, worldUp);
    forwardQuaternion.setFromRotationMatrix(lookMatrix);

    const centerDistance = worldPosition.distanceTo(worldCenter);

    if (centerDistance > worldRadius * 1.0e-5) {
      lookMatrix.lookAt(worldPosition, worldCenter, worldUp);
      centerQuaternion.setFromRotationMatrix(lookMatrix);
    } else {
      centerQuaternion.copy(forwardQuaternion);
    }

    const radius = localPosition.length() / localRadius;
    const followPath = 1 - smoothstep(0.55, 1.60, radius);

    // Quaternion interpolation avoids a zero-length gaze when the forward
    // and center directions oppose each other on an outbound segment.
    blendedQuaternion.slerpQuaternions(
      centerQuaternion,
      forwardQuaternion,
      followPath
    );

    direction
      .set(0, 0, -1)
      .applyQuaternion(blendedQuaternion)
      .normalize();

    const horizontal = Math.hypot(direction.x, direction.z);

    desiredYaw = horizontal > 1.0e-7
      ? Math.atan2(direction.x, -direction.z)
      : autoYaw;

    desiredPitch = Math.max(
      -MAX_PITCH,
      Math.min(
        MAX_PITCH,
        Math.asin(Math.max(-1, Math.min(1, direction.y)))
      )
    );

    const interiorFocus = Math.max(
      worldRadius * 0.22,
      worldPosition.distanceTo(worldAhead)
    );

    desiredFocus = Math.max(
      worldRadius * 0.04,
      centerDistance * (1 - followPath) + interiorFocus * followPath
    );
  }

  function applyHeading(yaw, pitch, focus) {
    const cosine = Math.cos(pitch);

    forward.set(
      Math.sin(yaw) * cosine,
      Math.sin(pitch),
      -Math.cos(yaw) * cosine
    );

    lookTarget
      .copy(camera.position)
      .addScaledVector(forward, focus);

    camera.up.copy(worldUp);
    camera.lookAt(lookTarget);
    camera.updateMatrixWorld(true);

    currentFocus = focus;

    if (controls) {
      controls.target.copy(lookTarget);
    }
  }

  function seedManualTarget() {
    camera.getWorldDirection(forward);

    currentFocus = Math.max(worldRadius * 0.04, currentFocus);

    controls.target
      .copy(camera.position)
      .addScaledVector(forward, currentFocus);
  }

  function pauseTour() {
    if (state !== "ready") return;

    resumeAfterInteraction = false;

    if (guided || resuming) {
      seedManualTarget();
    }

    guided = false;
    resuming = false;
    uiDirty = true;

    refreshMetadata();
    refreshUI(true);
  }

  function resumeTour() {
    if (state !== "ready") return;

    if (interacting) {
      if (!resetAfterInteraction) {
        resumeAfterInteraction = true;
      }

      return;
    }

    updateFrameOfReference();

    resumePosition.copy(camera.position);
    camera.getWorldDirection(direction);

    resumeYaw = Math.atan2(direction.x, -direction.z);
    resumePitch = Math.asin(Math.max(-1, Math.min(1, direction.y)));

    resumeFocus = Math.max(
      worldRadius * 0.04,
      camera.position.distanceTo(controls.target)
    );

    evaluateRoute();

    // Keep this yaw unwrapped throughout the blend so crossing +/-pi does
    // not change the chosen direction of the return rotation.
    autoYaw = resumeYaw + wrapAngle(desiredYaw - resumeYaw);
    autoPitch = desiredPitch;
    resumeElapsed = 0;
    guided = true;
    resuming = true;
    resumeAfterInteraction = false;
    uiDirty = true;

    refreshMetadata();
    refreshUI(true);
  }

  function resetTour() {
    if (state !== "ready") return;

    if (interacting) {
      resetAfterInteraction = true;
      resumeAfterInteraction = false;
      return;
    }

    resetAfterInteraction = false;
    routeSeconds = 0;
    activeTourSeconds = 0;
    loopCount = 0;
    resumeElapsed = 0;
    resuming = false;
    resumeAfterInteraction = false;
    guided = true;

    updateFrameOfReference();
    evaluateRoute();

    autoYaw = desiredYaw;
    autoPitch = desiredPitch;

    camera.position.copy(worldPosition);
    applyHeading(autoYaw, autoPitch, desiredFocus);

    controls.update();

    uiDirty = true;

    refreshMetadata();
    refreshUI(true);
  }

  function onInteractionStart() {
    if (state !== "ready") return;

    interacting = true;
    pauseTour();
  }

  function onInteractionEnd() {
    if (state !== "ready") return;

    interacting = false;

    if (resetAfterInteraction) {
      resetTour();
    } else if (resumeAfterInteraction) {
      resumeTour();
    }
  }

  function onPointerDown(event) {
    if (state !== "ready") return;

    capturedPointers.add(event.pointerId);
    canvas.focus({ preventScroll: true });
    pauseTour();
  }

  function onPointerFinished(event) {
    capturedPointers.delete(event.pointerId);
  }

  function onCanvasKeyDown(event) {
    if (
      state !== "ready" ||
      event.target !== canvas ||
      event.defaultPrevented ||
      event.isComposing
    ) {
      return;
    }

    if (
      event.code === "ArrowLeft" ||
      event.code === "ArrowRight" ||
      event.code === "ArrowUp" ||
      event.code === "ArrowDown"
    ) {
      pauseTour();
      return;
    }

    if (
      event.repeat ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }

    if (event.code === "KeyC") {
      event.preventDefault();
      event.stopPropagation();

      if (guided) {
        pauseTour();
      } else {
        resumeTour();
      }
    } else if (event.code === "KeyR") {
      event.preventDefault();
      event.stopPropagation();
      resetTour();
    }
  }

  function markUIDirty() {
    uiDirty = true;
  }

  function refreshMetadata() {
    if (!metadata) return;

    const reduced = reducedMotion();

    metadata.mode = !guided ? "manual"
      : reduced ? "reduced-motion"
      : simulationPaused() ? "paused"
      : resuming ? "resuming"
      : "guided";

    metadata.guided = guided;
    metadata.reducedMotion = reduced;
    metadata.progress = routeSeconds / LOOP_SECONDS;
    metadata.arcProgress = arcProgress;
    metadata.elapsedTime = activeTourSeconds;
    metadata.loopCount = loopCount;
    metadata.distance = camera.position.distanceTo(worldCenter);

    let waypoint = WAYPOINTS[0];

    for (let i = 1; i < WAYPOINTS.length; i++) {
      if (parameterProgress < WAYPOINTS[i].start) break;
      waypoint = WAYPOINTS[i];
    }

    if (metadata.waypoint !== waypoint) {
      uiDirty = true;
    }

    metadata.waypoint = waypoint;
  }

  function refreshUI(force) {
    if (
      !metadata ||
      (!force && !uiDirty && uiElapsed < 0.1)
    ) {
      return;
    }

    uiElapsed = 0;
    uiDirty = false;

    const percent = Math.round(metadata.progress * 100);

    if (tourButton) {
      tourButton.setAttribute(
        "aria-pressed",
        guided ? "true" : "false"
      );

      tourButton.textContent = guided ? "Pause tour" : "Guided tour";
    }

    if (progressElement) {
      progressElement.max = 1;
      progressElement.value = metadata.progress;
      progressElement.textContent = percent + "%";

      progressElement.setAttribute(
        "aria-valuetext",
        percent + "% — " + metadata.waypoint.title
      );
    }

    if (statusElement) {
      const messages = {
        manual:
          "Manual camera — choose Guided tour or press C to resume.",
        "reduced-motion":
          "Reduced motion — automatic camera travel is paused.",
        paused:
          "Simulation paused — tour position held.",
        resuming:
          "Returning smoothly to the guided path.",
        guided:
          metadata.waypoint.title + " — " + percent + "% of the tour."
      };

      statusElement.textContent = messages[metadata.mode];
    }
  }

  function update(deltaTime) {
    if (state !== "ready") return;

    assertActive();
    updateFrameOfReference();

    const dt = Number.isFinite(deltaTime)
      ? Math.max(0, Math.min(0.05, deltaTime))
      : 0;

    uiElapsed += dt;

    if (
      guided &&
      !reducedMotion() &&
      !simulationPaused() &&
      dt > 0
    ) {
      const advanced = routeSeconds + dt;

      if (advanced >= LOOP_SECONDS) {
        loopCount++;
      }

      routeSeconds = advanced % LOOP_SECONDS;
      activeTourSeconds += dt;

      evaluateRoute();

      const response = 1 - Math.exp(-5.5 * dt);

      autoYaw += wrapAngle(desiredYaw - autoYaw) * response;
      autoPitch += (desiredPitch - autoPitch) * response;

      if (resuming) {
        resumeElapsed = Math.min(
          RESUME_SECONDS,
          resumeElapsed + dt
        );

        const blend = smootherstep(resumeElapsed / RESUME_SECONDS);

        camera.position.lerpVectors(
          resumePosition,
          worldPosition,
          blend
        );

        applyHeading(
          resumeYaw + (autoYaw - resumeYaw) * blend,
          resumePitch + (autoPitch - resumePitch) * blend,
          resumeFocus + (desiredFocus - resumeFocus) * blend
        );

        if (resumeElapsed >= RESUME_SECONDS) {
          resuming = false;
          uiDirty = true;
        }
      } else {
        camera.position.copy(worldPosition);
        applyHeading(autoYaw, autoPitch, desiredFocus);
      }
    } else if (!guided) {
      // Damping and auto-rotation are disabled, so this cannot drift on its
      // own. Manual exploration remains available while simulation is paused.
      controls.update(dt);

      currentFocus = Math.max(
        worldRadius * 0.04,
        camera.position.distanceTo(controls.target)
      );
    }

    const previousMode = metadata.mode;

    refreshMetadata();

    if (metadata.mode !== previousMode) {
      uiDirty = true;
    }

    refreshUI(false);
  }

  function saveUI(element, attributes) {
    if (!element) return;

    const text = element.textContent;

    const values = attributes.map(function (name) {
      return [name, element.getAttribute(name)];
    });

    uiRestorers.push(function () {
      element.textContent = text;

      for (const entry of values) {
        if (entry[1] === null) {
          element.removeAttribute(entry[0]);
        } else {
          element.setAttribute(entry[0], entry[1]);
        }
      }
    });
  }

  async function initialize(sharedContext) {
    try {
      context = sharedContext || null;

      const dependencies = engine.Dependencies;
      THREE = dependencies && dependencies.THREE;

      const OrbitControls = dependencies && dependencies.OrbitControls;
      const core = engine.Core;

      if (
        !THREE ||
        typeof THREE.CatmullRomCurve3 !== "function" ||
        typeof OrbitControls !== "function" ||
        !core ||
        typeof core.getCamera !== "function" ||
        typeof core.getScene !== "function" ||
        typeof core.getRenderer !== "function" ||
        typeof core.registerUpdateCallback !== "function"
      ) {
        throw new Error(
          "Cinematography requires the accepted Core, Three.js and OrbitControls."
        );
      }

      assertActive();

      camera = window.QuantumEngine.Core.getCamera();
      scene = core.getScene();

      const renderer = core.getRenderer();

      canvas = context && context.canvas
        ? context.canvas
        : renderer && renderer.domElement;

      if (
        !camera ||
        !camera.isPerspectiveCamera ||
        camera.parent ||
        !scene ||
        !scene.isScene ||
        !canvas
      ) {
        throw new Error(
          "Cinematography requires Core's unparented perspective camera, scene and canvas."
        );
      }

      manifold = scene.getObjectByName("QuantumEngine.Manifold");

      const geometryInfo = manifold && manifold.userData.manifold;
      localRadius = geometryInfo && geometryInfo.boundingRadius;

      if (
        !manifold ||
        !Number.isFinite(localRadius) ||
        localRadius <= 0
      ) {
        throw new Error(
          "Cinematography requires the initialized Manifold bounds."
        );
      }

      originalPose = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        up: camera.up.clone()
      };

      originalTouchAction = canvas.style.getPropertyValue("touch-action");
      originalTouchPriority = canvas.style.getPropertyPriority("touch-action");
      originalTabIndex = canvas.getAttribute("tabindex");
      canvasStateSaved = true;

      const dom = context && context.dom
        ? context.dom
        : engine.DOM || {};

      tourButton = dom["qe-toggle-tour"] || null;
      resetButton = dom["qe-reset-view"] || null;
      progressElement = dom["qe-tour-progress"] || null;
      statusElement = dom["qe-tour-status"] || null;
      motionControl = dom["qe-motion-mode"] || null;

      worldUp = new THREE.Vector3(0, 1, 0);
      worldCenter = new THREE.Vector3();
      localPosition = new THREE.Vector3();
      localAhead = new THREE.Vector3();
      localBehind = new THREE.Vector3();
      localTangent = new THREE.Vector3();
      worldPosition = new THREE.Vector3();
      worldAhead = new THREE.Vector3();
      worldTangent = new THREE.Vector3();
      direction = new THREE.Vector3();
      lookTarget = new THREE.Vector3();
      resumePosition = new THREE.Vector3();
      forward = new THREE.Vector3();
      lookMatrix = new THREE.Matrix4();
      centerQuaternion = new THREE.Quaternion();
      forwardQuaternion = new THREE.Quaternion();
      blendedQuaternion = new THREE.Quaternion();

      createTrack();

      await createPacingTable();

      assertActive();
      updateFrameOfReference();
      evaluateRoute();

      camera.up.copy(worldUp);
      camera.position.copy(worldPosition);

      autoYaw = desiredYaw;
      autoPitch = desiredPitch;

      applyHeading(autoYaw, autoPitch, desiredFocus);

      canvas.setAttribute("tabindex", "0");

      addListener(
        canvas,
        "pointerdown",
        onPointerDown,
        { capture: true }
      );

      addListener(
        canvas,
        "pointerup",
        onPointerFinished,
        { capture: true }
      );

      addListener(
        canvas,
        "pointercancel",
        onPointerFinished,
        { capture: true }
      );

      addListener(
        canvas,
        "keydown",
        onCanvasKeyDown,
        { capture: true }
      );

      controls = new OrbitControls(camera, canvas);
      controls.enableDamping = false;
      controls.autoRotate = false;
      controls.enablePan = true;
      controls.enableRotate = true;
      controls.enableZoom = true;
      controls.zoomToCursor = false;
      controls.rotateSpeed = 0.45;
      controls.zoomSpeed = 0.75;
      controls.panSpeed = 0.65;
      controls.keyPanSpeed = 12;
      controls.minPolarAngle = 0.015;
      controls.maxPolarAngle = Math.PI - 0.015;
      controls.target.copy(lookTarget);

      updateFrameOfReference();

      controls.update();
      controls.listenToKeyEvents(canvas);

      addListener(controls, "start", onInteractionStart);
      addListener(controls, "end", onInteractionEnd);
      addListener(controls, "change", markUIDirty);

      addListener(tourButton, "click", function () {
        if (guided) {
          pauseTour();
        } else {
          resumeTour();
        }
      });

      addListener(resetButton, "click", resetTour);
      addListener(motionControl, "change", markUIDirty);

      saveUI(tourButton, ["aria-pressed"]);
      saveUI(progressElement, ["max", "value", "aria-valuetext"]);
      saveUI(statusElement, []);

      metadata = {
        mode: "guided",
        guided: true,
        reducedMotion: reducedMotion(),
        duration: LOOP_SECONDS,
        progress: 0,
        arcProgress: 0,
        elapsedTime: 0,
        loopCount: 0,
        distance: 0,
        waypoint: WAYPOINTS[0],
        waypoints: WAYPOINTS,
        controlPointCount: curve.points.length,
        controlsOwner: "QuantumEngine.Cinematography"
      };

      hadPreviousMetadata = Object.prototype.hasOwnProperty.call(
        scene.userData,
        "cinematography"
      );

      previousMetadata = scene.userData.cinematography;
      scene.userData.cinematography = metadata;

      unsubscribeUpdate = window.QuantumEngine.Core.registerUpdateCallback(
        update,
        {
          priority: 20,
          phase: "update",
          label: "Cinematic camera"
        }
      );

      state = "ready";

      refreshMetadata();
      refreshUI(true);

      return camera;
    } catch (error) {
      try {
        dispose();
      } catch (cleanupError) {
        window.console.error(
          "Cinematography cleanup failed:",
          cleanupError
        );
      }

      throw error;
    }
  }

  function init(sharedContext) {
    if (state === "disposed") {
      throw new Error(
        "Cinematography has been disposed. Reload before initializing again."
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

    unsubscribeUpdate = null;

    while (listeners.length) {
      const listener = listeners.pop();

      release(function () {
        listener.target.removeEventListener(
          listener.type,
          listener.handler,
          listener.options
        );
      });
    }

    if (controls) {
      release(function () {
        controls.dispose();
      });
    }

    if (canvas) {
      for (const pointerId of capturedPointers) {
        release(function () {
          if (canvas.hasPointerCapture(pointerId)) {
            canvas.releasePointerCapture(pointerId);
          }
        });
      }
    }

    capturedPointers.clear();

    while (uiRestorers.length) {
      release(uiRestorers.pop());
    }

    if (canvas && canvasStateSaved) {
      release(function () {
        if (originalTouchAction) {
          canvas.style.setProperty(
            "touch-action",
            originalTouchAction,
            originalTouchPriority
          );
        } else {
          canvas.style.removeProperty("touch-action");
        }

        if (originalTabIndex === null) {
          canvas.removeAttribute("tabindex");
        } else {
          canvas.setAttribute("tabindex", originalTabIndex);
        }
      });
    }

    if (camera && originalPose) {
      release(function () {
        camera.position.copy(originalPose.position);
        camera.quaternion.copy(originalPose.quaternion);
        camera.up.copy(originalPose.up);
        camera.updateMatrixWorld(true);
      });
    }

    if (
      scene &&
      metadata &&
      scene.userData.cinematography === metadata
    ) {
      if (hadPreviousMetadata) {
        scene.userData.cinematography = previousMetadata;
      } else {
        delete scene.userData.cinematography;
      }
    }

    controls = null;
    curve = null;
    pacing = null;
    context = null;
    camera = null;
    scene = null;
    canvas = null;
    manifold = null;
    originalPose = null;
    tourButton = null;
    resetButton = null;
    progressElement = null;
    statusElement = null;
    motionControl = null;
    metadata = null;
    previousMetadata = undefined;
    worldUp = null;
    worldCenter = null;
    localPosition = null;
    localAhead = null;
    localBehind = null;
    localTangent = null;
    worldPosition = null;
    worldAhead = null;
    worldTangent = null;
    direction = null;
    lookTarget = null;
    resumePosition = null;
    forward = null;
    lookMatrix = null;
    centerQuaternion = null;
    forwardQuaternion = null;
    blendedQuaternion = null;
    THREE = null;

    if (errors.length) {
      throw new AggregateError(
        errors,
        "Cinematography cleanup failed."
      );
    }
  }

  engine.Cinematography = Object.freeze({ init, dispose });
})(window);