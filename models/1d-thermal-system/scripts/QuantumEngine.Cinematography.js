(function () {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  if (window.QuantumEngine.Cinematography) {
    return;
  }

  const ARC_SAMPLES_PER_SEGMENT = 128;
  const LOOK_RESPONSE = 4.0;
  const DOLLY_RESPONSE = 2.5;
  const FRAME_MARGIN = 1.12;

  let initialized = false;
  let camera = null;

  function createShots(THREE) {
    function shot(x, y, z, focus, duration, label) {
      return {
        position: new THREE.Vector3(x, y, z),
        focus: focus,
        duration: duration,
        label: label
      };
    }

    // Durations describe travel from this waypoint to the next.
    // The open route ends in a stationary shot rather than teleporting back.
    return [
      shot(-94, 40, 132, "entry", 8, "Wide approach"),
      shot(-72, 26, 80, "entry", 8, "Incoming field"),
      shot(-52, 19, 42, "wire", 10, "Wire tracking"),
      shot(-24, 16, 33, "wireExit", 5, "Along the main wire"),
      shot(-35, 39, 25, "electron", 5, "Gallery approach"),
      shot(-48, 51, 0, "electron", 7, "Electron approach"),
      shot(-45, 50, -19, "electron", 12, "Electron inspection"),
      shot(-31, 46, -17, "electron", 7, "Electron orbit"),
      shot(-19, 47, -17, "photon", 10, "Photon approach"),
      shot(-3, 47, -19, "photon", 12, "Photon inspection"),
      shot(9, 44, -16, "photon", 7, "Transverse fields"),
      shot(22, 48, -17, "gluon", 12, "Gluon approach"),
      shot(36, 46, -20, "gluon", 10, "Gluon inspection"),
      shot(47, 50, -14, "gluon", 4, "Leaving the gallery"),
      shot(47, 54, 12, "barrier", 4, "Return to the main wire"),
      shot(24, 31, 38, "barrier", 6, "Barrier approach"),
      shot(-8, 18, 40, "barrier", 10, "Potential barrier"),
      shot(-15, 11, 32, "barrier", 10, "Barrier inspection"),
      shot(4, 16, 39, "barrier", 7, "Barrier departure"),
      shot(28, 22, 44, "gate", 8, "Measurement approach"),
      shot(54, 23, 45, "gate", 9, "Gate orbit"),
      shot(73, 17, 30, "gate", 11, "Final approach"),
      shot(84, 12, 20, "gate", 0, "Measurement gate")
    ];
  }

  function createFocusAnchors(THREE, scene) {
    function anchor(name, fallback, offset, radius) {
      return {
        object: scene.getObjectByName(name) || null,
        fallback: new THREE.Vector3(
          fallback[0],
          fallback[1],
          fallback[2]
        ),
        offset: new THREE.Vector3(
          offset[0],
          offset[1],
          offset[2]
        ),
        radius: radius
      };
    }

    return {
      entry: anchor(
        "quantum-wavefunction",
        [-40, 0, 0],
        [-40, 0, 0],
        21
      ),

      wire: anchor(
        "quantum-wavefunction",
        [-26, 0, 0],
        [-26, 0, 0],
        19
      ),

      wireExit: anchor(
        "quantum-wavefunction",
        [-10, 0, 0],
        [-10, 0, 0],
        19
      ),

      electron: anchor(
        "electron-probability-cloud",
        [-34, 28, -40],
        [0, 0, 0],
        15
      ),

      photon: anchor(
        "photon-transverse-wave",
        [0, 28, -40],
        [0, 0, 0],
        15
      ),

      gluon: anchor(
        "gluon-flux-tube",
        [34, 28, -40],
        [0, 0, 0],
        15
      ),

      barrier: anchor(
        "potential-barrier",
        [8, 0, 0],
        [0, 0, 0],
        26
      ),

      gate: anchor(
        "measurement-gate",
        [42, 0, 0],
        [0, 0, 0],
        20.2
      )
    };
  }

  function readAnchor(anchor, destination) {
    if (anchor.object) {
      anchor.object.getWorldPosition(destination);
      destination.add(anchor.offset);
    } else {
      destination.copy(anchor.fallback);
    }

    return destination;
  }

  function createTimeline(curve, shots) {
    const count = shots.length;
    const times = new Float64Array(count);
    const progressKeys = new Float64Array(count);
    const slopes = new Float64Array(count);
    const speeds = new Float64Array(count - 1);

    curve.arcLengthDivisions =
      (count - 1) * ARC_SAMPLES_PER_SEGMENT;

    const lengths = curve.getLengths();
    const totalLength = lengths[lengths.length - 1];

    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      throw new Error("The camera flight path has no usable length.");
    }

    for (let index = 0; index < count; index += 1) {
      // A control point uses parametric t=i/(count-1), not arc-length u.
      progressKeys[index] =
        lengths[index * ARC_SAMPLES_PER_SEGMENT] / totalLength;

      if (index > 0) {
        const duration = shots[index - 1].duration;

        if (!Number.isFinite(duration) || duration <= 0) {
          throw new Error(
            "Every camera travel segment needs a positive duration."
          );
        }

        times[index] = times[index - 1] + duration;

        speeds[index - 1] =
          (progressKeys[index] - progressKeys[index - 1]) / duration;
      }
    }

    progressKeys[0] = 0;
    progressKeys[count - 1] = 1;

    // Monotone cubic interpolation changes speed smoothly without stopping
    // at every waypoint or allowing the camera to reverse along the curve.
    for (let index = 1; index < count - 1; index += 1) {
      const previousSpeed = speeds[index - 1];
      const nextSpeed = speeds[index];

      if (previousSpeed <= 0 || nextSpeed <= 0) {
        slopes[index] = 0;
        continue;
      }

      const previousDuration = times[index] - times[index - 1];
      const nextDuration = times[index + 1] - times[index];

      const firstWeight = 2 * nextDuration + previousDuration;
      const secondWeight = nextDuration + 2 * previousDuration;

      slopes[index] = (firstWeight + secondWeight) / (
        firstWeight / previousSpeed +
        secondWeight / nextSpeed
      );
    }

    slopes[0] = 0;
    slopes[count - 1] = 0;

    for (let index = 0; index < count - 1; index += 1) {
      const speed = speeds[index];

      if (speed <= 0) {
        slopes[index] = 0;
        slopes[index + 1] = 0;
        continue;
      }

      const a = slopes[index] / speed;
      const b = slopes[index + 1] / speed;
      const magnitudeSquared = a * a + b * b;

      if (magnitudeSquared > 9) {
        const scale = 3 / Math.sqrt(magnitudeSquared);

        slopes[index] = scale * a * speed;
        slopes[index + 1] = scale * b * speed;
      }
    }

    return {
      times: times,
      progressKeys: progressKeys,
      slopes: slopes,
      duration: times[count - 1],
      length: totalLength
    };
  }

  function findSegment(times, elapsed) {
    let low = 0;
    let high = times.length - 2;

    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);

      if (times[middle] <= elapsed) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }

    return low;
  }

  function evaluateProgress(timeline, segment, elapsed) {
    const startTime = timeline.times[segment];
    const duration = timeline.times[segment + 1] - startTime;

    const t = Math.max(
      0,
      Math.min(1, (elapsed - startTime) / duration)
    );

    const t2 = t * t;
    const t3 = t2 * t;

    const start = timeline.progressKeys[segment];
    const end = timeline.progressKeys[segment + 1];

    const value =
      (2 * t3 - 3 * t2 + 1) * start +
      (t3 - 2 * t2 + t) * duration * timeline.slopes[segment] +
      (-2 * t3 + 3 * t2) * end +
      (t3 - t2) * duration * timeline.slopes[segment + 1];

    return Math.max(start, Math.min(end, value));
  }

  function init() {
    if (initialized) {
      return camera;
    }

    const THREE = window.THREE;
    const core = window.QuantumEngine.Core;

    if (!THREE || !core) {
      throw new Error(
        "[QuantumEngine.Cinematography] Three.js and QuantumEngine.Core must load first."
      );
    }

    if (!core.getScene()) {
      core.init();
    }

    const scene = core.getScene();
    camera = core.getCamera();

    if (!scene || !camera || !camera.isPerspectiveCamera) {
      throw new Error(
        "[QuantumEngine.Cinematography] A perspective camera and initialized scene are required."
      );
    }

    const originalPosition = camera.position.clone();
    const originalQuaternion = camera.quaternion.clone();
    const originalUp = camera.up.clone();

    const previousTelemetry = camera.userData.cinematography;

    const hadTelemetry = Object.prototype.hasOwnProperty.call(
      camera.userData,
      "cinematography"
    );

    let unregisterUpdate = null;

    try {
      const shots = createShots(THREE);
      const anchors = createFocusAnchors(THREE, scene);

      const curve = new THREE.CatmullRomCurve3(
        shots.map(function positionOf(shot) {
          return shot.position;
        }),
        false,
        "centripetal"
      );

      const timeline = createTimeline(curve, shots);

      const flightPosition = new THREE.Vector3();
      const firstTarget = new THREE.Vector3();
      const secondTarget = new THREE.Vector3();
      const desiredTarget = new THREE.Vector3();
      const smoothTarget = new THREE.Vector3();
      const dollyDirection = new THREE.Vector3();
      const viewDirection = new THREE.Vector3();

      let elapsed = 0;
      let progress = 0;
      let pullback = 0;
      let firstFrame = true;

      // These shots frame the existing standing-wave model and schematic
      // exhibits. Their timing does not imply tunneling or collapse events.
      const telemetry = {
        progress: 0,
        elapsedTime: 0,
        duration: timeline.duration,
        pathLength: timeline.length,
        shotIndex: 0,
        shot: shots[0].label,
        mode: "tour",
        complete: false,
        target: new THREE.Vector3()
      };

      camera.userData.cinematography = telemetry;

      function update(deltaTime) {
        const delta = Number.isFinite(deltaTime) && deltaTime > 0
          ? deltaTime
          : 0;

        elapsed = Math.min(timeline.duration, elapsed + delta);

        const complete = elapsed >= timeline.duration;
        const segment = findSegment(timeline.times, elapsed);

        progress = complete
          ? 1
          : evaluateProgress(timeline, segment, elapsed);

        curve.getPointAt(progress, flightPosition);

        const startProgress = timeline.progressKeys[segment];
        const endProgress = timeline.progressKeys[segment + 1];

        const localProgress = THREE.MathUtils.clamp(
          (progress - startProgress) /
            Math.max(1e-9, endProgress - startProgress),
          0,
          1
        );

        const blend = localProgress * localProgress *
          (3 - 2 * localProgress);

        const firstAnchor = anchors[shots[segment].focus];
        const secondAnchor = anchors[shots[segment + 1].focus];

        readAnchor(firstAnchor, firstTarget);
        readAnchor(secondAnchor, secondTarget);

        desiredTarget.lerpVectors(
          firstTarget,
          secondTarget,
          blend
        );

        const framingRadius = THREE.MathUtils.lerp(
          firstAnchor.radius,
          secondAnchor.radius,
          blend
        );

        const zoom = Math.max(0.01, camera.zoom);

        const verticalHalfFov = Math.atan(
          Math.tan(
            THREE.MathUtils.degToRad(camera.fov) * 0.5
          ) / zoom
        );

        const horizontalHalfFov = Math.atan(
          Math.tan(verticalHalfFov) *
            Math.max(0.01, camera.aspect)
        );

        const limitingHalfFov = Math.max(
          0.01,
          Math.min(verticalHalfFov, horizontalHalfFov)
        );

        const requiredDistance = Math.min(
          camera.far * 0.45,
          framingRadius * FRAME_MARGIN /
            Math.sin(limitingHalfFov)
        );

        dollyDirection.subVectors(
          flightPosition,
          desiredTarget
        );

        let pathDistance = dollyDirection.length();

        if (pathDistance < 0.001) {
          dollyDirection.set(0, 0.25, 1).normalize();
          pathDistance = 1;

          flightPosition.copy(desiredTarget).addScaledVector(
            dollyDirection,
            pathDistance
          );
        } else {
          dollyDirection.multiplyScalar(1 / pathDistance);
        }

        const desiredPullback = Math.max(
          0,
          requiredDistance - pathDistance
        );

        if (firstFrame) {
          smoothTarget.copy(desiredTarget);
          pullback = desiredPullback;
          firstFrame = false;
        } else {
          const lookAlpha = 1 - Math.exp(-LOOK_RESPONSE * delta);
          const dollyAlpha = 1 - Math.exp(-DOLLY_RESPONSE * delta);

          smoothTarget.lerp(desiredTarget, lookAlpha);

          pullback = THREE.MathUtils.lerp(
            pullback,
            desiredPullback,
            dollyAlpha
          );
        }

        // Follow the spline, with an outward framing correction on narrow views.
        camera.position.copy(flightPosition).addScaledVector(
          dollyDirection,
          pullback
        );

        viewDirection.subVectors(
          smoothTarget,
          camera.position
        );

        if (viewDirection.lengthSq() < 1e-8) {
          smoothTarget.copy(camera.position).addScaledVector(
            dollyDirection,
            -1
          );

          viewDirection.subVectors(
            smoothTarget,
            camera.position
          );
        }

        viewDirection.normalize();

        // Keep a level horizon; blend the up axis only near a vertical view.
        const verticalAlignment = Math.abs(viewDirection.y);

        const upBlend = THREE.MathUtils.smoothstep(
          verticalAlignment,
          0.96,
          0.999
        );

        camera.up.set(0, 1 - upBlend, upBlend).normalize();
        camera.lookAt(smoothTarget);
        camera.updateMatrixWorld(true);

        telemetry.progress = progress;
        telemetry.elapsedTime = elapsed;
        telemetry.shotIndex = complete ? shots.length - 1 : segment;
        telemetry.shot = shots[telemetry.shotIndex].label;
        telemetry.mode = complete ? "hold" : "tour";
        telemetry.complete = complete;
        telemetry.target.copy(smoothTarget);
      }

      update(0);
      unregisterUpdate = core.registerUpdateCallback(update);

      initialized = true;
      return camera;
    } catch (error) {
      if (unregisterUpdate) {
        unregisterUpdate();
      }

      camera.position.copy(originalPosition);
      camera.quaternion.copy(originalQuaternion);
      camera.up.copy(originalUp);

      if (hadTelemetry) {
        camera.userData.cinematography = previousTelemetry;
      } else {
        delete camera.userData.cinematography;
      }

      camera.updateMatrixWorld(true);

      camera = null;
      initialized = false;

      throw error;
    }
  }

  function start() {
    try {
      init();
    } catch (error) {
      console.error(
        "[QuantumEngine.Cinematography] Initialization failed.",
        error
      );

      const status = document.getElementById("engine-status");

      if (status) {
        status.textContent = "Camera tour initialization failed";
      }
    }
  }

  window.QuantumEngine.Cinematography = { init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}());