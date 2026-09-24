/*
 * QuantumEngine.Manifold.js
 *
 * A finite section of the Fermat quintic, using all 25 branches of
 * Hanson's complex-power construction:
 *
 *   z1 = exp(2*pi*i*k1/5) * cos(u + i*v)^(2/5)
 *   z2 = exp(2*pi*i*k2/5) * sin(u + i*v)^(2/5)
 *   z3 = exp(i*pi/5), z4 = z5 = 0
 *
 * Thus z1^5 + z2^5 + z3^5 + z4^5 + z5^5 = 0.
 *
 * This is a two-real-dimensional section of a six-real-dimensional
 * threefold. Its finite v range has open ends. The animated 4D-to-3D
 * visualization map does not alter the original algebraic samples.
 * The optical materials and emissive volume are visual interpretations,
 * not a numerical Ricci-flat metric or a quantum-state solver.
 *
 * init(context) receives Core's shared context and resolves to the group.
 * dispose() is retained for the accepted loader's lifecycle contract.
 */
(function quantumEngineManifoldModule(window) {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};
  const engine = window.QuantumEngine;

  if (typeof engine !== "object" || engine === null) {
    throw new TypeError("window.QuantumEngine must be an object.");
  }

  if (engine.Manifold !== undefined) {
    throw new Error("QuantumEngine.Manifold has already been registered.");
  }

  const TAU = Math.PI * 2;
  const DEGREE = 5;
  const WORLD_SCALE = 26;
  const V_LIMIT = 1.35;
  const BREATH_AMPLITUDE = 0.075;

  // Every temporal frequency in the shaders completes a whole number of
  // cycles over this interval, allowing a continuous precision-safe wrap.
  const TIME_PERIOD = TAU * 100;

  let THREE = null;
  let sharedContext = null;
  let signal = null;
  let state = "idle";
  let initializationPromise = null;
  let unsubscribeUpdate = null;

  let group = null;
  let surface = null;
  let volume = null;
  let surfaceGeometry = null;
  let volumeGeometry = null;
  let surfaceMaterial = null;
  let volumeMaterial = null;

  let timeUniform = null;
  let animationTime = 0;
  let elapsedProjectionTime = 0;
  let previousCoreTime = 0;
  let phaseSpeedControl = null;
  let motionControl = null;

  const PROJECTION_GLSL = `
vec2 rotatePlane(vec2 p, float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

vec3 projectSection(vec4 q, float t, float scale) {
  float energy = dot(q, q);
  vec2 a = rotatePlane(q.xy, 0.19 * t + 0.10 * sin(0.23 * t + energy));
  vec2 b = rotatePlane(q.zw, -0.13 * t + 0.08 * sin(0.17 * t - energy));
  float projectionAngle = 0.74 + 0.22 * sin(0.11 * t);

  vec3 p = vec3(
    a.x,
    b.x,
    cos(projectionAngle) * a.y + sin(projectionAngle) * b.y
  );

  float breathing = 1.0 + 0.075 * sin(0.73 * t + 0.85 * energy);
  p.xz = rotatePlane(p.xz, 0.16 * sin(0.31 * t + 0.65 * energy));
  p.yz = rotatePlane(p.yz, 0.09 * sin(0.23 * t));
  p.xy = rotatePlane(p.xy, 0.04 * t);
  p.xz = rotatePlane(p.xz, 0.07 * t);

  return p * (scale * breathing);
}
`;

  const SPECTRUM_GLSL = `
const float QE_PI = 3.141592653589793;
const float QE_TAU = 6.283185307179586;

float safePolarAngle(vec2 p) {
  return dot(p, p) > 1.0e-10 ? atan(p.y, p.x) : 0.0;
}

vec3 srgbToLinear(vec3 color) {
  vec3 low = color / 12.92;
  vec3 high = pow((color + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), color));
}

vec3 prideSpectrum(float hue) {
  float position = fract(hue) * 6.0;
  float blend = smoothstep(0.0, 1.0, fract(position));

  vec3 violet = vec3(0.48, 0.015, 1.0);
  vec3 cobalt = vec3(0.015, 0.18, 1.0);
  vec3 emerald = vec3(0.01, 1.0, 0.24);
  vec3 yellow = vec3(1.0, 0.96, 0.015);
  vec3 orange = vec3(1.0, 0.29, 0.008);
  vec3 crimson = vec3(1.0, 0.008, 0.10);
  vec3 color;

  if (position < 1.0) {
    color = mix(violet, cobalt, blend);
  } else if (position < 2.0) {
    color = mix(cobalt, emerald, blend);
  } else if (position < 3.0) {
    color = mix(emerald, yellow, blend);
  } else if (position < 4.0) {
    color = mix(yellow, orange, blend);
  } else if (position < 5.0) {
    color = mix(orange, crimson, blend);
  } else {
    color = mix(crimson, violet, blend);
  }

  return srgbToLinear(color);
}
`;

  const SURFACE_VERTEX_SHADER = `
precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_vertex>

attribute vec4 aComplex;

uniform float uTime;
uniform float uScale;

varying vec3 vObjectPosition;
varying vec3 vViewPosition;
varying float vEnergy;
varying float vParameterV;

${PROJECTION_GLSL}

void main() {
  vec3 transformed = projectSection(aComplex, uTime, uScale);
  vec4 viewPosition = modelViewMatrix * vec4(transformed, 1.0);

  vObjectPosition = transformed;
  vViewPosition = viewPosition.xyz;
  vEnergy = dot(aComplex, aComplex);
  vParameterV = uv.y;

  gl_Position = projectionMatrix * viewPosition;

  #include <logdepthbuf_vertex>
}
`;

  const SURFACE_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uRadius;
uniform float uOpacity;

varying vec3 vObjectPosition;
varying vec3 vViewPosition;
varying float vEnergy;
varying float vParameterV;

${SPECTRUM_GLSL}

// Three representative wavelengths, in nanometers, approximate white-light
// interference through an air / dielectric film / dielectric substrate stack.
vec3 thinFilmReflectance(float cosIncident, float thicknessNm) {
  const float n0 = 1.0;
  const float n1 = 1.38;
  const float n2 = 1.52;

  float sinIncidentSquared = max(0.0, 1.0 - cosIncident * cosIncident);

  float cosFilm = sqrt(max(
    0.0,
    1.0 - (n0 * n0 / (n1 * n1)) * sinIncidentSquared
  ));

  float cosSubstrate = sqrt(max(
    0.0,
    1.0 - (n0 * n0 / (n2 * n2)) * sinIncidentSquared
  ));

  float r01s = (n0 * cosIncident - n1 * cosFilm)
    / max(n0 * cosIncident + n1 * cosFilm, 1.0e-5);

  float r12s = (n1 * cosFilm - n2 * cosSubstrate)
    / max(n1 * cosFilm + n2 * cosSubstrate, 1.0e-5);

  float r01p = (n1 * cosIncident - n0 * cosFilm)
    / max(n1 * cosIncident + n0 * cosFilm, 1.0e-5);

  float r12p = (n2 * cosFilm - n1 * cosSubstrate)
    / max(n2 * cosFilm + n1 * cosSubstrate, 1.0e-5);

  vec3 wavelengths = vec3(650.0, 510.0, 440.0);

  vec3 interference = cos(
    (4.0 * QE_PI * n1 * thicknessNm * cosFilm) / wavelengths
  );

  float productS = r01s * r12s;
  float productP = r01p * r12p;

  vec3 reflectanceS = (
    vec3(r01s * r01s + r12s * r12s) + 2.0 * productS * interference
  ) / max(
    vec3(1.0 + productS * productS) + 2.0 * productS * interference,
    vec3(1.0e-4)
  );

  vec3 reflectanceP = (
    vec3(r01p * r01p + r12p * r12p) + 2.0 * productP * interference
  ) / max(
    vec3(1.0 + productP * productP) + 2.0 * productP * interference,
    vec3(1.0e-4)
  );

  return clamp(0.5 * (reflectanceS + reflectanceP), 0.0, 1.0);
}

void main() {
  #include <logdepthbuf_fragment>

  float viewLengthSquared = dot(vViewPosition, vViewPosition);

  vec3 viewDirection = viewLengthSquared > 1.0e-12
    ? -vViewPosition * inversesqrt(viewLengthSquared)
    : vec3(0.0, 0.0, 1.0);

  // Derivatives follow the animated surface, including its changing folds.
  vec3 normalVector = cross(dFdx(vViewPosition), dFdy(vViewPosition));
  float normalLengthSquared = dot(normalVector, normalVector);

  vec3 surfaceNormal = normalLengthSquared > 1.0e-20
    ? normalVector * inversesqrt(normalLengthSquared)
    : viewDirection;

  if (dot(surfaceNormal, viewDirection) < 0.0) {
    surfaceNormal = -surfaceNormal;
  }

  float cosIncident = clamp(dot(surfaceNormal, viewDirection), 0.001, 1.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - cosIncident, 5.0);
  vec3 p = vObjectPosition / uRadius;

  float hue = safePolarAngle(p.xy) / QE_TAU + 0.5
    + 0.24 * p.z
    + 0.08 * sin(vEnergy * 1.8 + uTime * 0.09)
    + uTime * 0.03 / QE_TAU;

  vec3 spectrumColor = prideSpectrum(hue);

  float thicknessNm = 390.0
    + 145.0 * sin(dot(p, vec3(4.0, 3.0, 5.0)) + uTime * 0.17)
    + 65.0 * sin(vEnergy * 2.4 - uTime * 0.11);

  vec3 film = thinFilmReflectance(cosIncident, thicknessNm);
  vec3 filmHue = film / max(max(film.r, max(film.g, film.b)), 0.025);

  vec3 keyLight = normalize(vec3(-0.55, 0.75, 1.0));
  vec3 fillLight = normalize(vec3(0.8, -0.25, 0.45));

  float diffuse = 0.68 * max(dot(surfaceNormal, keyLight), 0.0)
    + 0.32 * max(dot(surfaceNormal, fillLight), 0.0);

  vec3 halfVector = keyLight + viewDirection;
  halfVector *= inversesqrt(max(dot(halfVector, halfVector), 1.0e-8));

  float specular = pow(max(dot(surfaceNormal, halfVector), 0.0), 18.0);
  float pulse = 0.5 + 0.5 * sin(0.73 * uTime + vEnergy);

  vec3 membrane = mix(
    spectrumColor,
    spectrumColor * (0.5 + filmHue),
    0.34
  );

  vec3 radiance = membrane * (0.25 + 0.58 * diffuse);

  radiance += mix(spectrumColor, filmHue, 0.28)
    * (1.5 * fresnel + 0.24 * specular);

  radiance += spectrumColor * (0.13 + 0.19 * pulse);

  // Beer-Lambert membrane transmission. Alpha blending reveals deeper
  // sheets; this does not refract a sampled scene-color texture.
  vec3 absorptionCoefficient = vec3(0.65) - 0.42 * spectrumColor;
  float opticalThickness = thicknessNm * 0.001 / max(cosIncident, 0.12);
  vec3 transmission = exp(-absorptionCoefficient * opticalThickness);

  float absorbed = 1.0 - dot(
    transmission,
    vec3(0.2126, 0.7152, 0.0722)
  );

  // Only the two finite-v truncation boundaries fade; branch seams do not.
  float edgeFade = 1.0 - smoothstep(
    0.88,
    1.0,
    abs(2.0 * vParameterV - 1.0)
  );

  float opacity = clamp(
    0.16 + 0.40 * absorbed + 0.65 * fresnel,
    0.14,
    0.94
  ) * uOpacity * edgeFade;

  if (opacity < 0.003) discard;

  gl_FragColor = vec4(radiance, opacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  const VOLUME_VERTEX_SHADER = `
precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_vertex>

varying vec3 vLocalPosition;

void main() {
  vLocalPosition = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);

  #include <logdepthbuf_vertex>
}
`;

  const VOLUME_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_fragment>

uniform float uTime;
uniform float uRadius;
uniform float uGlowGain;
uniform vec3 uCameraLocal;

varying vec3 vLocalPosition;

${SPECTRUM_GLSL}

// This gyroid-shaped emissive density is an illustrative lighting field,
// not a computed Ricci-flat metric or a physical quantum probability.
float glowDensity(vec3 p) {
  float radius = length(p);
  float envelope = 1.0 - smoothstep(0.50, 0.98, radius);
  float centralCavity = smoothstep(0.045, 0.22, radius);

  vec3 q = p * 4.2 + vec3(
    0.22 * sin(0.09 * uTime),
    0.19 * sin(0.07 * uTime),
    0.21 * cos(0.11 * uTime)
  );

  float gyroid = dot(sin(q), cos(q.yzx));
  float sheet = exp(-1.8 * gyroid * gyroid);
  float pulse = 0.82 + 0.18 * sin(0.73 * uTime + radius * 7.0);

  return envelope * centralCavity * (0.055 + 0.945 * sheet) * pulse;
}

void main() {
  #include <logdepthbuf_fragment>

  vec3 rayVector = vLocalPosition - uCameraLocal;
  float rayLengthSquared = dot(rayVector, rayVector);

  if (rayLengthSquared < 1.0e-12) discard;

  vec3 rayDirection = rayVector * inversesqrt(rayLengthSquared);
  vec3 rayOrigin = uCameraLocal / uRadius;

  float b = dot(rayOrigin, rayDirection);
  float c = dot(rayOrigin, rayOrigin) - 1.0;
  float discriminant = b * b - c;

  if (discriminant <= 0.0) discard;

  float root = sqrt(discriminant);
  float entrance = max(0.0, -b - root);
  float exitDistance = -b + root;

  if (exitDistance <= entrance) discard;

  float stepLength = (exitDistance - entrance) / float(VOLUME_STEPS);
  float distanceAlongRay = entrance + 0.5 * stepLength;
  float transmittance = 1.0;
  vec3 radiance = vec3(0.0);

  for (int i = 0; i < VOLUME_STEPS; i++) {
    vec3 p = rayOrigin + rayDirection * distanceAlongRay;
    float density = glowDensity(p);
    float absorption = 1.0 - exp(-density * stepLength * 2.4);

    float hue = safePolarAngle(p.xy) / QE_TAU + 0.5
      + 0.24 * p.z
      + 0.03 * uTime / QE_TAU;

    radiance += transmittance * absorption
      * prideSpectrum(hue) * uGlowGain;

    transmittance *= 1.0 - absorption;

    if (transmittance < 0.025) break;

    distanceAlongRay += stepLength;
  }

  if (max(radiance.r, max(radiance.g, radiance.b)) < 0.0001) discard;

  // Radiance already contains integrated opacity. One/One blending avoids
  // applying source alpha a second time.
  gl_FragColor = vec4(radiance, 1.0 - transmittance);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  function assertActive() {
    if (state === "disposed" || (signal && signal.aborted)) {
      throw new window.DOMException(
        "Manifold initialization was aborted.",
        "AbortError"
      );
    }
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 0);
    });
  }

  function chooseSegments(renderer) {
    const coarsePointer = typeof window.matchMedia === "function"
      && window.matchMedia("(pointer: coarse)").matches;

    const cores = window.navigator.hardwareConcurrency;
    const limitedCPU = Number.isFinite(cores) && cores <= 4;
    const limitedTextureSize = renderer.capabilities.maxTextureSize < 8192;

    return coarsePointer || limitedCPU || limitedTextureSize ? 48 : 64;
  }

  // Match projectSection(q, 0, WORLD_SCALE) without per-vertex allocations.
  function writeRestPosition(positions, offset, ar, ai, br, bi) {
    const energy = ar * ar + ai * ai + br * br + bi * bi;
    const angleA = 0.10 * Math.sin(energy);
    const angleB = 0.08 * Math.sin(-energy);

    const aReal = Math.cos(angleA) * ar - Math.sin(angleA) * ai;
    const aImaginary = Math.sin(angleA) * ar + Math.cos(angleA) * ai;
    const bReal = Math.cos(angleB) * br - Math.sin(angleB) * bi;
    const bImaginary = Math.sin(angleB) * br + Math.cos(angleB) * bi;

    const x = aReal;
    const y = bReal;
    const z = Math.cos(0.74) * aImaginary + Math.sin(0.74) * bImaginary;

    const twist = 0.16 * Math.sin(0.65 * energy);
    const c = Math.cos(twist);
    const s = Math.sin(twist);

    const scale = WORLD_SCALE
      * (1 + BREATH_AMPLITUDE * Math.sin(0.85 * energy));

    positions[offset] = (c * x - s * z) * scale;
    positions[offset + 1] = y * scale;
    positions[offset + 2] = (s * x + c * z) * scale;
  }

  async function buildGeometryData(segments) {
    const row = segments + 1;
    const verticesPerPatch = row * row;
    const patchCount = DEGREE * DEGREE;
    const vertexCount = patchCount * verticesPerPatch;

    const positions = new Float32Array(vertexCount * 3);
    const complex = new Float32Array(vertexCount * 4);
    const uv = new Float32Array(vertexCount * 2);
    const indices = new Uint32Array(patchCount * segments * segments * 6);

    const base = new Float64Array(verticesPerPatch * 4);
    const rootCosines = new Float64Array(DEGREE);
    const rootSines = new Float64Array(DEGREE);

    let maximumEnergy = 0;

    for (let k = 0; k < DEGREE; k++) {
      rootCosines[k] = Math.cos(TAU * k / DEGREE);
      rootSines[k] = Math.sin(TAU * k / DEGREE);
    }

    // Both quality levels have an even segment count, so v=0 is sampled.
    for (let j = 0; j <= segments; j++) {
      const v = V_LIMIT * (2 * j / segments - 1);
      const coshV = Math.cosh(v);
      const sinhV = Math.sinh(v);

      for (let i = 0; i <= segments; i++) {
        const u = 0.5 * Math.PI * i / segments;

        // Exact endpoint zeros prevent fractional powers from magnifying
        // sin(pi) / cos(pi/2) floating-point residuals at branch seams.
        const sinU = i === 0 ? 0 : i === segments ? 1 : Math.sin(u);
        const cosU = i === 0 ? 1 : i === segments ? 0 : Math.cos(u);

        const cosineReal = cosU * coshV;
        const cosineImaginary = -sinU * sinhV;
        const sineReal = sinU * coshV;
        const sineImaginary = cosU * sinhV;

        const cosineAmplitude = Math.pow(
          cosineReal * cosineReal + cosineImaginary * cosineImaginary,
          1 / DEGREE
        );

        const sineAmplitude = Math.pow(
          sineReal * sineReal + sineImaginary * sineImaginary,
          1 / DEGREE
        );

        const cosineArgument = (2 / DEGREE)
          * Math.atan2(cosineImaginary, cosineReal);

        const sineArgument = (2 / DEGREE)
          * Math.atan2(sineImaginary, sineReal);

        const offset = (j * row + i) * 4;

        base[offset] = cosineAmplitude * Math.cos(cosineArgument);
        base[offset + 1] = cosineAmplitude * Math.sin(cosineArgument);
        base[offset + 2] = sineAmplitude * Math.cos(sineArgument);
        base[offset + 3] = sineAmplitude * Math.sin(sineArgument);

        maximumEnergy = Math.max(
          maximumEnergy,
          cosineAmplitude * cosineAmplitude + sineAmplitude * sineAmplitude
        );
      }
    }

    let indexOffset = 0;

    for (let branchA = 0; branchA < DEGREE; branchA++) {
      for (let branchB = 0; branchB < DEGREE; branchB++) {
        assertActive();

        const patch = branchA * DEGREE + branchB;
        const patchStart = patch * verticesPerPatch;

        const ca = rootCosines[branchA];
        const sa = rootSines[branchA];
        const cb = rootCosines[branchB];
        const sb = rootSines[branchB];

        for (let j = 0; j <= segments; j++) {
          for (let i = 0; i <= segments; i++) {
            const localIndex = j * row + i;
            const source = localIndex * 4;
            const vertex = patchStart + localIndex;
            const destination = vertex * 4;

            const ar = base[source];
            const ai = base[source + 1];
            const br = base[source + 2];
            const bi = base[source + 3];

            complex[destination] = ca * ar - sa * ai;
            complex[destination + 1] = sa * ar + ca * ai;
            complex[destination + 2] = cb * br - sb * bi;
            complex[destination + 3] = sb * br + cb * bi;

            writeRestPosition(
              positions,
              vertex * 3,
              complex[destination],
              complex[destination + 1],
              complex[destination + 2],
              complex[destination + 3]
            );

            uv[vertex * 2] = i / segments;
            uv[vertex * 2 + 1] = j / segments;
          }
        }

        for (let j = 0; j < segments; j++) {
          for (let i = 0; i < segments; i++) {
            const a = patchStart + j * row + i;
            const b = a + 1;
            const c = a + row;
            const d = c + 1;

            indices[indexOffset++] = a;
            indices[indexOffset++] = b;
            indices[indexOffset++] = d;

            indices[indexOffset++] = a;
            indices[indexOffset++] = d;
            indices[indexOffset++] = c;
          }
        }
      }

      // Give startup UI and cancellation a turn between batches.
      await yieldToBrowser();
      assertActive();
    }

    // The projection has operator norm <= 1; all following transforms are
    // rotations plus bounded breathing. This encloses every animation pose.
    const radius = Math.sqrt(maximumEnergy)
      * WORLD_SCALE
      * (1 + BREATH_AMPLITUDE)
      * 1.01;

    return {
      positions,
      complex,
      uv,
      indices,
      radius,
      vertexCount,
      triangleCount: indices.length / 3,
      patchCount
    };
  }

  function update(deltaTime) {
    if (state !== "ready" || !timeUniform) return;

    const clock = sharedContext && sharedContext.clock;

    if (clock && Number.isFinite(clock.elapsedTime)) {
      if (clock.elapsedTime < previousCoreTime) {
        animationTime = 0;
        elapsedProjectionTime = 0;
      }

      previousCoreTime = clock.elapsedTime;
    }

    const reducedMotion = motionControl
      ? motionControl.value === "reduced"
      : window.document.documentElement.dataset.motion === "reduced";

    const requestedSpeed = phaseSpeedControl
      ? Number(phaseSpeedControl.value)
      : 1;

    const speed = Number.isFinite(requestedSpeed)
      ? Math.max(0, Math.min(2, requestedSpeed))
      : 1;

    const dt = Number.isFinite(deltaTime)
      ? Math.max(0, Math.min(0.05, deltaTime))
      : 0;

    // Freeze the current pose in reduced-motion mode; resuming is continuous.
    if (!reducedMotion) {
      const advance = dt * speed;
      elapsedProjectionTime += advance;
      animationTime = (animationTime + advance) % TIME_PERIOD;
    }

    timeUniform.value = animationTime;
    group.userData.manifold.elapsedProjectionTime = elapsedProjectionTime;
    group.userData.manifold.phase = (animationTime * 0.19) % TAU;
  }

  async function initialize(context) {
    try {
      const core = engine.Core;

      THREE = engine.Dependencies && engine.Dependencies.THREE;
      sharedContext = context || null;
      signal = context && context.signal ? context.signal : null;

      if (!THREE || typeof THREE.ShaderMaterial !== "function") {
        throw new Error(
          "Manifold.init requires QuantumEngine.Dependencies.THREE."
        );
      }

      if (
        !core
        || typeof core.getScene !== "function"
        || typeof core.getRenderer !== "function"
        || typeof core.registerUpdateCallback !== "function"
      ) {
        throw new Error(
          "Manifold.init requires the initialized QuantumEngine.Core."
        );
      }

      assertActive();

      const scene = window.QuantumEngine.Core.getScene();
      const renderer = core.getRenderer();

      if (!scene || !scene.isScene || !renderer) {
        throw new Error(
          "Manifold.init requires an existing Core scene and renderer."
        );
      }

      const dom = context && context.dom ? context.dom : engine.DOM;

      phaseSpeedControl = dom && dom["qe-phase-speed"]
        ? dom["qe-phase-speed"]
        : null;

      motionControl = dom && dom["qe-motion-mode"]
        ? dom["qe-motion-mode"]
        : null;

      const segments = chooseSegments(renderer);
      const data = await buildGeometryData(segments);

      assertActive();

      surfaceGeometry = new THREE.BufferGeometry();

      surfaceGeometry.setAttribute(
        "position",
        new THREE.BufferAttribute(data.positions, 3)
      );

      surfaceGeometry.setAttribute(
        "aComplex",
        new THREE.BufferAttribute(data.complex, 4)
      );

      surfaceGeometry.setAttribute(
        "uv",
        new THREE.BufferAttribute(data.uv, 2)
      );

      surfaceGeometry.setIndex(
        new THREE.BufferAttribute(data.indices, 1)
      );

      surfaceGeometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(0, 0, 0),
        data.radius
      );

      surfaceGeometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(-data.radius, -data.radius, -data.radius),
        new THREE.Vector3(data.radius, data.radius, data.radius)
      );

      timeUniform = { value: 0 };
      const radiusUniform = { value: data.radius };

      surfaceMaterial = new THREE.ShaderMaterial({
        name: "QuantumEngine.Manifold.Membrane",
        precision: "highp",

        uniforms: {
          uTime: timeUniform,
          uScale: { value: WORLD_SCALE },
          uRadius: radiusUniform,
          uOpacity: { value: 0.86 }
        },

        vertexShader: SURFACE_VERTEX_SHADER,
        fragmentShader: SURFACE_FRAGMENT_SHADER,

        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
        toneMapped: true
      });

      // Separate back/front draws improve transparency through folded sheets.
      // Intersecting transparent triangles still use conventional alpha blending.
      surfaceMaterial.forceSinglePass = false;

      volumeGeometry = new THREE.SphereGeometry(data.radius, 32, 20);

      const cameraLocal = new THREE.Vector3();
      const inverseVolumeMatrix = new THREE.Matrix4();

      volumeMaterial = new THREE.ShaderMaterial({
        name: "QuantumEngine.Manifold.InnerVolume",
        precision: "highp",

        defines: {
          VOLUME_STEPS: 16
        },

        uniforms: {
          uTime: timeUniform,
          uRadius: radiusUniform,
          uGlowGain: { value: 0.72 },
          uCameraLocal: { value: cameraLocal }
        },

        vertexShader: VOLUME_VERTEX_SHADER,
        fragmentShader: VOLUME_FRAGMENT_SHADER,

        transparent: true,
        side: THREE.BackSide,
        depthTest: true,
        depthWrite: false,

        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,

        blendEquationAlpha: THREE.AddEquation,
        blendSrcAlpha: THREE.ZeroFactor,
        blendDstAlpha: THREE.OneFactor,

        toneMapped: true
      });

      group = new THREE.Group();
      group.name = "QuantumEngine.Manifold";

      group.userData.manifold = {
        construction: "Finite affine Fermat quintic section",
        section: "z3 = exp(i*pi/5), z4 = z5 = 0",
        realSectionDimension: 2,
        ambientThreefoldRealDimension: 6,
        branchCount: data.patchCount,
        segments,
        vertexCount: data.vertexCount,
        triangleCount: data.triangleCount,
        parameterVLimit: V_LIMIT,
        boundingRadius: data.radius,
        elapsedProjectionTime: 0,
        phase: 0
      };

      surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
      surface.name = "QuantumEngine.Manifold.Surface";
      surface.renderOrder = 1;
      surface.frustumCulled = true;

      volume = new THREE.Mesh(volumeGeometry, volumeMaterial);
      volume.name = "QuantumEngine.Manifold.Volume";
      volume.renderOrder = 0;
      volume.frustumCulled = true;

      // Read the camera immediately before rendering, after Cinematography's
      // update. The same hook also supports subsequent composer render passes.
      volume.onBeforeRender = function onBeforeVolumeRender(
        activeRenderer,
        activeScene,
        camera
      ) {
        inverseVolumeMatrix.copy(this.matrixWorld).invert();

        cameraLocal
          .setFromMatrixPosition(camera.matrixWorld)
          .applyMatrix4(inverseVolumeMatrix);
      };

      group.add(volume, surface);

      assertActive();
      scene.add(group);

      unsubscribeUpdate = window.QuantumEngine.Core.registerUpdateCallback(
        update,
        {
          priority: 0,
          phase: "update",
          label: "Manifold projection"
        }
      );

      state = "ready";
      update(0);

      return group;
    } catch (error) {
      try {
        dispose();
      } catch (cleanupError) {
        window.console.error("Manifold cleanup failed:", cleanupError);
      }

      throw error;
    }
  }

  function init(context) {
    if (state === "disposed") {
      throw new Error(
        "Manifold has been disposed. Reload before initializing again."
      );
    }

    if (initializationPromise) return initializationPromise;

    state = "initializing";
    initializationPromise = initialize(context);

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

    if (unsubscribeUpdate) release(unsubscribeUpdate);
    unsubscribeUpdate = null;

    if (group) {
      release(function () {
        group.removeFromParent();
      });

      release(function () {
        group.clear();
      });
    }

    if (volume && THREE) {
      volume.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
    }

    if (surfaceGeometry) {
      release(function () {
        surfaceGeometry.dispose();
      });
    }

    if (volumeGeometry) {
      release(function () {
        volumeGeometry.dispose();
      });
    }

    if (surfaceMaterial) {
      release(function () {
        surfaceMaterial.dispose();
      });
    }

    if (volumeMaterial) {
      release(function () {
        volumeMaterial.dispose();
      });
    }

    group = null;
    surface = null;
    volume = null;
    surfaceGeometry = null;
    volumeGeometry = null;
    surfaceMaterial = null;
    volumeMaterial = null;
    timeUniform = null;

    phaseSpeedControl = null;
    motionControl = null;
    sharedContext = null;
    signal = null;
    THREE = null;

    if (errors.length) {
      throw new AggregateError(
        errors,
        "Manifold resource cleanup failed."
      );
    }
  }

  engine.Manifold = Object.freeze({
    init,
    dispose
  });
})(window);