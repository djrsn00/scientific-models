/*
 * QuantumEngine.TopologicalFlux.js
 *
 * 524,288 particles, simulated entirely on the GPU.
 *
 * Two ping-pong framebuffers each own two RGBA32F color attachments:
 *   position = (normalized u, normalized v, quintic branch A, branch B)
 *   velocity = (du/dt, dv/dt, pulse phase, persistent random seed)
 *
 * One MRT compute draw advances both attachments consistently. The rendering
 * shader maps these intrinsic coordinates through the accepted Manifold's
 * quintic section and animated projection. No particle state is read back.
 *
 * Curl noise supplies illustrative transport along the displayed section.
 * dOmega = 0 is a geometric closure condition, not a gravitational force law;
 * this module does not claim to solve a Ricci-flat metric or quantum dynamics.
 *
 * Requires the accepted Three.js r180 Core and Manifold, WebGL2, and
 * EXT_color_buffer_float. dispose() fulfills the accepted loader contract.
 */
(function quantumEngineTopologicalFluxModule(window) {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};
  const engine = window.QuantumEngine;

  if (typeof engine !== "object" || engine === null) {
    throw new TypeError("window.QuantumEngine must be an object.");
  }

  if (engine.TopologicalFlux !== undefined) {
    throw new Error(
      "QuantumEngine.TopologicalFlux has already been registered."
    );
  }

  const STATE_WIDTH = 1024;
  const STATE_HEIGHT = 512;
  const PARTICLE_COUNT = STATE_WIDTH * STATE_HEIGHT;
  const MAX_SUBSTEP = 1 / 60;
  const MAX_SUBSTEPS = 6;

  const ownedResources = [];
  const targets = [];

  let THREE = null;
  let renderer = null;
  let signal = null;
  let state = "idle";
  let initializationPromise = null;
  let unsubscribeUpdate = null;

  let computeScene = null;
  let computeCamera = null;
  let computeMaterial = null;
  let particleMaterial = null;
  let particles = null;

  let manifold = null;
  let manifoldMetadata = null;
  let manifoldTime = null;
  let fluxControl = null;
  let viewportScratch = null;

  let pointSizeMinimum = 1;
  let pointSizeMaximum = 1;
  let currentTarget = 0;
  let lastProjectionTime = 0;
  let simulationTime = 0;
  let simulationSteps = 0;

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

  const COMPUTE_VERTEX_SHADER = `
precision highp float;
precision highp int;

void main() {
  vec2 corner = vec2(
    float((gl_VertexID << 1) & 2),
    float(gl_VertexID & 2)
  );

  gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0);
}
`;

  const COMPUTE_FRAGMENT_SHADER = `
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uPositionState;
uniform sampler2D uVelocityState;
uniform bool uInitialize;
uniform float uDeltaTime;
uniform float uFieldTime;

layout(location = 0) out vec4 nextPositionState;
layout(location = 1) out vec4 nextVelocityState;

const float PI = 3.141592653589793;

uint hashBits(uint value) {
  value ^= value >> 16;
  value *= 0x7feb352du;
  value ^= value >> 15;
  value *= 0x846ca68bu;
  value ^= value >> 16;
  return value;
}

float random01(uint value) {
  return float(hashBits(value) >> 8) * (1.0 / 16777216.0);
}

vec2 latticeGradient(ivec2 cell) {
  uint h = hashBits(
    uint(cell.x) * 0x8da6b343u
    ^ uint(cell.y) * 0xd8163841u
  ) & 7u;

  if (h == 0u) return vec2(1.0, 0.0);
  if (h == 1u) return vec2(-1.0, 0.0);
  if (h == 2u) return vec2(0.0, 1.0);
  if (h == 3u) return vec2(0.0, -1.0);

  return vec2(
    (h & 1u) == 0u ? 0.7071067811865476 : -0.7071067811865476,
    (h & 2u) == 0u ? 0.7071067811865476 : -0.7071067811865476
  );
}

// Returns gradient-noise value and its analytic derivatives (value, dx, dy).
// The quintic interpolation makes neighboring noise cells join smoothly.
vec3 noiseWithGradient(vec2 p) {
  ivec2 cell = ivec2(floor(p));
  vec2 f = fract(p);

  vec2 blend = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 derivative = 30.0 * f * f * (f * (f - 2.0) + 1.0);

  vec2 g00 = latticeGradient(cell);
  vec2 g10 = latticeGradient(cell + ivec2(1, 0));
  vec2 g01 = latticeGradient(cell + ivec2(0, 1));
  vec2 g11 = latticeGradient(cell + ivec2(1, 1));

  float n00 = dot(g00, f);
  float n10 = dot(g10, f - vec2(1.0, 0.0));
  float n01 = dot(g01, f - vec2(0.0, 1.0));
  float n11 = dot(g11, f - vec2(1.0, 1.0));

  float lower = mix(n00, n10, blend.x);
  float upper = mix(n01, n11, blend.x);

  float dxLower = mix(g00.x, g10.x, blend.x)
    + (n10 - n00) * derivative.x;

  float dxUpper = mix(g01.x, g11.x, blend.x)
    + (n11 - n01) * derivative.x;

  float dy = mix(
    mix(g00.y, g10.y, blend.x),
    mix(g01.y, g11.y, blend.x),
    blend.y
  ) + (upper - lower) * derivative.y;

  return vec3(
    mix(lower, upper, blend.y),
    mix(dxLower, dxUpper, blend.y),
    dy
  );
}

vec2 targetFlow(vec2 chart, vec2 branch) {
  vec2 frequency = vec2(2.4, 1.8);

  vec2 drift = vec2(
    0.7 * sin(0.07 * uFieldTime),
    0.5 * cos(0.11 * uFieldTime)
  );

  vec2 domain = chart * frequency
    + branch * vec2(1.73, 2.19)
    + drift;

  vec3 low = noiseWithGradient(domain);
  vec3 high = noiseWithGradient(domain * 2.03 + vec2(7.1, -4.9));

  float noiseValue = 0.60 + 0.32 * low.x + 0.16 * high.x;

  vec2 noiseGradient = frequency
    * (0.32 * low.yz + 0.16 * 2.03 * high.yz);

  float sx = sin(PI * chart.x);
  float cx = cos(PI * chart.x);
  float sy = sin(0.5 * PI * chart.y);
  float cy = cos(0.5 * PI * chart.y);

  float envelope = sx * cy;
  float envelopeX = PI * cx * cy;
  float envelopeY = -0.5 * PI * sx * sy;

  // Curl of the streamfunction psi = envelope * noiseValue.
  // Its normal component vanishes at all four chart boundaries.
  vec2 flow = 0.32 * vec2(
    envelopeY * noiseValue + envelope * noiseGradient.y,
    -envelopeX * noiseValue - envelope * noiseGradient.x
  );

  return flow * min(1.0, 1.2 / max(length(flow), 1.0e-6));
}

void reflectInterval(
  inout float position,
  inout float velocity,
  float lower,
  float upper
) {
  float width = upper - lower;
  float folded = mod(position - lower, 2.0 * width);

  if (folded < width) {
    position = lower + folded;
  } else {
    position = lower + 2.0 * width - folded;
    velocity = -velocity;
  }

  if (position <= lower) velocity = abs(velocity);
  if (position >= upper) velocity = -abs(velocity);
}

void seedParticle(uint id) {
  uint branch = id % 25u;

  vec2 chart = vec2(
    mix(0.0001, 0.9999, random01(id ^ 0xa511e9b3u)),
    mix(-0.9998, 0.9998, random01(id ^ 0x63d83595u))
  );

  vec2 branches = vec2(
    float(branch / 5u),
    float(branch % 5u)
  );

  float seed = random01(id ^ 0x9e3779b9u);
  float phase = random01(id ^ 0xb5297a4du);

  nextPositionState = vec4(chart, branches);
  nextVelocityState = vec4(targetFlow(chart, branches), phase, seed);
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  uint id = uint(pixel.y) * uint(STATE_WIDTH) + uint(pixel.x);

  if (uInitialize) {
    seedParticle(id);
    return;
  }

  vec4 positionState = texelFetch(uPositionState, pixel, 0);
  vec4 velocityState = texelFetch(uVelocityState, pixel, 0);

  if (
    any(isnan(positionState))
    || any(isinf(positionState))
    || any(isnan(velocityState))
    || any(isinf(velocityState))
    || any(greaterThan(abs(positionState.xy), vec2(4.0)))
  ) {
    seedParticle(id);
    return;
  }

  vec2 desiredVelocity = targetFlow(positionState.xy, positionState.zw);

  vec2 velocity = mix(
    velocityState.xy,
    desiredVelocity,
    1.0 - exp(-7.0 * uDeltaTime)
  );

  velocity *= min(1.0, 1.2 / max(length(velocity), 1.0e-6));

  vec2 chart = positionState.xy + velocity * uDeltaTime;

  reflectInterval(chart.x, velocity.x, 0.0, 1.0);
  reflectInterval(chart.y, velocity.y, -1.0, 1.0);

  float phase = fract(
    velocityState.z + uDeltaTime * (0.05 + 0.06 * velocityState.w)
  );

  nextPositionState = vec4(chart, positionState.zw);
  nextVelocityState = vec4(velocity, phase, velocityState.w);
}
`;

  const PARTICLE_VERTEX_SHADER = `
precision highp float;
precision highp int;
precision highp sampler2D;

#include <common>
#include <logdepthbuf_pars_vertex>

uniform sampler2D uPositionState;
uniform sampler2D uVelocityState;

uniform float uTime;
uniform float uScale;
uniform float uVLimit;
uniform float uRadius;
uniform vec2 uViewportPixels;
uniform vec2 uPointSizeRange;
uniform float uNear;
uniform float uGain;

varying vec2 vDirection;
varying vec3 vColor;
varying float vBrightness;
varying float vVisibility;

${PROJECTION_GLSL}

${SPECTRUM_GLSL}

vec2 fifthPowerSection(vec2 value, float branch) {
  float magnitudeSquared = dot(value, value);

  // atan(0,0) is undefined; handle branch points before computing the angle.
  if (magnitudeSquared < 1.0e-20) return vec2(0.0);

  float angle = 0.4 * atan(value.y, value.x)
    + QE_TAU * branch / 5.0;

  return pow(magnitudeSquared, 0.2) * vec2(cos(angle), sin(angle));
}

vec4 sectionCoordinates(vec4 state) {
  float u = clamp(state.x, 0.0, 1.0) * (0.5 * QE_PI);
  float v = clamp(state.y, -1.0, 1.0) * uVLimit;

  float positive = exp(v);
  float negative = exp(-v);
  float coshV = 0.5 * (positive + negative);
  float sinhV = 0.5 * (positive - negative);

  float su = state.x <= 0.0
    ? 0.0
    : state.x >= 1.0 ? 1.0 : sin(u);

  float cu = state.x <= 0.0
    ? 1.0
    : state.x >= 1.0 ? 0.0 : cos(u);

  vec2 a = fifthPowerSection(
    vec2(cu * coshV, -su * sinhV),
    state.z
  );

  vec2 b = fifthPowerSection(
    vec2(su * coshV, cu * sinhV),
    state.w
  );

  return vec4(a, b);
}

void main() {
  int id = gl_VertexID;
  ivec2 pixel = ivec2(id % STATE_WIDTH, id / STATE_WIDTH);

  vec4 positionState = texelFetch(uPositionState, pixel, 0);
  vec4 velocityState = texelFetch(uVelocityState, pixel, 0);

  vec4 q = sectionCoordinates(positionState);
  vec3 localPosition = projectSection(q, uTime, uScale);
  vec4 viewPosition = modelViewMatrix * vec4(localPosition, 1.0);

  gl_Position = projectionMatrix * viewPosition;

  float depth = -viewPosition.z;
  float nearStart = max(uNear * 4.0, 0.08);

  float nearFade = smoothstep(
    nearStart,
    max(0.75, nearStart * 2.0),
    depth
  );

  float edgeFade = 1.0 - smoothstep(
    0.88,
    1.0,
    abs(positionState.y)
  );

  vDirection = vec2(1.0, 0.0);
  vColor = vec3(0.0);
  vBrightness = 0.0;
  vVisibility = 0.0;
  gl_PointSize = max(1.0, uPointSizeRange.x);

  if (depth <= max(uNear * 1.1, 0.02) || uGain <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  } else {
    // A short forward sample includes both intrinsic flow and the membrane's
    // own phase motion. It is evaluated on the GPU, with no CPU readback.
    const float tangentInterval = 0.002;

    vec4 futureState = positionState;
    futureState.xy = clamp(
      positionState.xy + velocityState.xy * tangentInterval,
      vec2(0.0, -1.0),
      vec2(1.0, 1.0)
    );

    vec3 futurePosition = projectSection(
      sectionCoordinates(futureState),
      uTime + tangentInterval,
      uScale
    );

    vec3 localVelocity = (futurePosition - localPosition) / tangentInterval;

    vec4 clipVelocity = projectionMatrix
      * modelViewMatrix
      * vec4(localVelocity, 0.0);

    vec2 screenTangent = (
      clipVelocity.xy * gl_Position.w
      - gl_Position.xy * clipVelocity.w
    ) * uViewportPixels;

    float tangentLengthSquared = dot(screenTangent, screenTangent);

    if (tangentLengthSquared > 1.0e-12) {
      vDirection = screenTangent * inversesqrt(tangentLengthSquared);
    }

    float speed = length(localVelocity);

    float physicalLength = mix(
      0.10,
      0.24,
      smoothstep(0.0, 25.0, speed)
    );

    float projectedSize = physicalLength
      * 0.5
      * uViewportPixels.y
      * projectionMatrix[1][1]
      / depth;

    gl_PointSize = clamp(
      projectedSize,
      uPointSizeRange.x,
      uPointSizeRange.y
    );

    // Preserve subpixel energy instead of making every distant particle
    // artificially as bright as a fully covered hardware-minimum point.
    float coverage = min(
      1.0,
      projectedSize * projectedSize
        / max(gl_PointSize * gl_PointSize, 1.0e-6)
    );

    vec3 normalizedPosition = localPosition / uRadius;

    float hue = safePolarAngle(normalizedPosition.xy) / QE_TAU + 0.5
      + 0.24 * normalizedPosition.z
      + 0.08 * sin(dot(q, q) * 1.8 + uTime * 0.09)
      + uTime * 0.03 / QE_TAU
      + 0.07 * smoothstep(0.0, 30.0, speed);

    float pulse = 0.5 + 0.5 * sin(
      QE_TAU * velocityState.z + 0.73 * uTime + dot(q, q)
    );

    vColor = prideSpectrum(hue);

    vBrightness = uGain
      * (1.8 + 2.2 * pulse)
      * (0.75 + 0.65 * smoothstep(0.0, 25.0, speed));

    vVisibility = nearFade * edgeFade * coverage;
  }

  #include <logdepthbuf_vertex>
}
`;

  const PARTICLE_FRAGMENT_SHADER = `
precision highp float;
precision highp int;

#include <common>
#include <logdepthbuf_pars_fragment>

varying vec2 vDirection;
varying vec3 vColor;
varying float vBrightness;
varying float vVisibility;

void main() {
  #include <logdepthbuf_fragment>

  // gl_PointCoord has downward-positive Y; the projected tangent uses Y-up.
  vec2 p = vec2(
    2.0 * gl_PointCoord.x - 1.0,
    1.0 - 2.0 * gl_PointCoord.y
  );

  float along = dot(p, vDirection);
  float across = dot(p, vec2(-vDirection.y, vDirection.x));

  // Rounded luminous capsule: a microscopic needle with a softer envelope.
  vec2 capsule = vec2(
    max(abs(along) - 0.56, 0.0),
    across
  );

  float distanceToCore = length(capsule) - 0.105;
  float antialiasWidth = max(fwidth(distanceToCore), 0.025);

  float core = 1.0 - smoothstep(
    -antialiasWidth,
    antialiasWidth,
    distanceToCore
  );

  float halo = exp(-5.0 * along * along - 22.0 * across * across);
  float boundary = 1.0 - smoothstep(0.80, 1.0, length(p));
  float mask = (0.78 * core + 0.22 * halo) * boundary;
  float opacity = 0.30 * mask * vVisibility;

  if (opacity < 0.0001) discard;

  // Standard AdditiveBlending supplies the source-alpha factor itself.
  // Keep radiance unpremultiplied so the mask is applied exactly once.
  gl_FragColor = vec4(vColor * vBrightness, opacity);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

  function own(resource) {
    ownedResources.push(resource);
    return resource;
  }

  function assertActive() {
    if (state === "disposed" || (signal && signal.aborted)) {
      throw new window.DOMException(
        "TopologicalFlux initialization was aborted.",
        "AbortError"
      );
    }
  }

  function yieldToBrowser() {
    return new Promise(function (resolve) {
      window.setTimeout(resolve, 0);
    });
  }

  function verifyHardware() {
    const gl = renderer.getContext();

    if (
      typeof gl.drawBuffers !== "function"
      || typeof gl.texStorage2D !== "function"
    ) {
      throw new Error("TopologicalFlux requires WebGL2.");
    }

    if (!renderer.extensions.has("EXT_color_buffer_float")) {
      throw new Error(
        "TopologicalFlux requires EXT_color_buffer_float for RGBA32F state."
      );
    }

    if (
      renderer.capabilities.maxTextureSize < STATE_WIDTH
      || renderer.capabilities.maxVertexTextures < 2
      || gl.getParameter(gl.MAX_DRAW_BUFFERS) < 2
      || gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) < 2
    ) {
      throw new Error(
        "TopologicalFlux requires 1024-pixel textures and two simultaneous "
        + "float color attachments and vertex texture samplers."
      );
    }

    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);

    if (
      !range
      || !Number.isFinite(range[0])
      || !Number.isFinite(range[1])
      || range[0] <= 0
      || range[1] < range[0]
    ) {
      throw new Error(
        "TopologicalFlux received an invalid GPU point-size range."
      );
    }

    pointSizeMinimum = range[0];
    pointSizeMaximum = range[1];
  }

  function createStateTarget(index) {
    const target = own(new THREE.WebGLRenderTarget(
      STATE_WIDTH,
      STATE_HEIGHT,
      {
        count: 2,
        format: THREE.RGBAFormat,
        type: THREE.FloatType,
        internalFormat: "RGBA32F",

        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,

        generateMipmaps: false,
        colorSpace: THREE.NoColorSpace,
        depthBuffer: false,
        stencilBuffer: false,
        samples: 0
      }
    ));

    target.textures[0].name = "QuantumEngine.Flux.Position." + index;
    target.textures[1].name = "QuantumEngine.Flux.Velocity." + index;

    return target;
  }

  function renderCompute(target, checkFramebuffer) {
    const previousTarget = renderer.getRenderTarget();
    const previousFace = renderer.getActiveCubeFace();
    const previousMip = renderer.getActiveMipmapLevel();
    const previousAutoClear = renderer.autoClear;
    const previousXR = renderer.xr.enabled;
    const previousShadowUpdate = renderer.shadowMap.autoUpdate;

    try {
      renderer.autoClear = false;
      renderer.xr.enabled = false;
      renderer.shadowMap.autoUpdate = false;

      // setRenderTarget applies the target's viewport/scissor, then restores
      // the previous target's settings on return. Global settings stay intact.
      renderer.setRenderTarget(target);

      if (checkFramebuffer) {
        const gl = renderer.getContext();
        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          throw new Error(
            "TopologicalFlux framebuffer is incomplete: 0x"
            + status.toString(16)
            + "."
          );
        }
      }

      renderer.render(computeScene, computeCamera);
    } finally {
      renderer.autoClear = previousAutoClear;
      renderer.xr.enabled = previousXR;
      renderer.shadowMap.autoUpdate = previousShadowUpdate;

      renderer.setRenderTarget(
        previousTarget,
        previousFace,
        previousMip
      );
    }
  }

  function prepareSeed() {
    const uniforms = computeMaterial.uniforms;

    uniforms.uInitialize.value = true;
    uniforms.uDeltaTime.value = 0;
    uniforms.uFieldTime.value = manifoldTime.value;

    // Unbind both state samplers before writing either target, including
    // during reset, so neither seed draw can form a texture feedback loop.
    uniforms.uPositionState.value = null;
    uniforms.uVelocityState.value = null;
  }

  function bindCurrentState() {
    const source = targets[currentTarget];

    particleMaterial.uniforms.uPositionState.value = source.textures[0];
    particleMaterial.uniforms.uVelocityState.value = source.textures[1];
  }

  function resetSimulation() {
    prepareSeed();

    renderCompute(targets[0], false);
    renderCompute(targets[1], false);

    computeMaterial.uniforms.uInitialize.value = false;
    currentTarget = 0;
    simulationTime = 0;
    simulationSteps = 0;

    bindCurrentState();
  }

  function advanceSimulation(deltaTime, fieldTime) {
    const source = targets[currentTarget];
    const destination = targets[1 - currentTarget];
    const uniforms = computeMaterial.uniforms;

    uniforms.uInitialize.value = false;
    uniforms.uPositionState.value = source.textures[0];
    uniforms.uVelocityState.value = source.textures[1];
    uniforms.uDeltaTime.value = deltaTime;
    uniforms.uFieldTime.value = fieldTime;

    renderCompute(destination, false);

    currentTarget = 1 - currentTarget;
    simulationTime += deltaTime;
    simulationSteps++;
  }

  function readIntensity() {
    const value = fluxControl ? Number(fluxControl.value) : 1.5;

    return Number.isFinite(value)
      ? Math.max(0, Math.min(3, value))
      : 1.5;
  }

  function update(deltaTime) {
    if (state !== "ready" || (signal && signal.aborted)) return;

    const gain = readIntensity();

    particleMaterial.uniforms.uGain.value = gain;
    particles.visible = gain > 0;

    const projectionTime = manifoldMetadata.elapsedProjectionTime;

    if (!Number.isFinite(projectionTime)) {
      throw new Error(
        "TopologicalFlux received a non-finite Manifold clock."
      );
    }

    let advance = projectionTime - lastProjectionTime;

    if (advance < 0) {
      resetSimulation();
      advance = 0;
    }

    lastProjectionTime = projectionTime;

    const dt = Number.isFinite(deltaTime)
      ? Math.max(0, Math.min(0.05, deltaTime))
      : 0;

    // Manifold's elapsed time already incorporates phase speed, pause and
    // reduced motion. The 2x UI limit allows at most 0.1 simulated seconds.
    advance = dt > 0
      ? Math.max(0, Math.min(advance, 2 * dt))
      : 0;

    const steps = gain > 0 && advance > 0
      ? Math.min(MAX_SUBSTEPS, Math.ceil(advance / MAX_SUBSTEP))
      : 0;

    if (steps > 0) {
      const stepTime = advance / steps;
      const fieldStart = manifoldTime.value - advance;

      for (let step = 0; step < steps; step++) {
        advanceSimulation(
          stepTime,
          fieldStart + stepTime * (step + 1)
        );
      }

      bindCurrentState();
    }

    const info = particles.userData.topologicalFlux;

    info.elapsedTime = simulationTime;
    info.simulationSteps = simulationSteps;
    info.substepsLastFrame = steps;
    info.intensity = gain;
  }

  function updateRenderUniforms(activeRenderer, activeScene, camera) {
    activeRenderer.getCurrentViewport(viewportScratch);

    const uniforms = particleMaterial.uniforms;

    uniforms.uViewportPixels.value.set(
      Math.max(1, viewportScratch.z),
      Math.max(1, viewportScratch.w)
    );

    const pixelRatio = Math.min(activeRenderer.getPixelRatio(), 2);

    uniforms.uPointSizeRange.value.set(
      pointSizeMinimum,
      Math.max(
        pointSizeMinimum,
        Math.min(pointSizeMaximum, 8 * pixelRatio)
      )
    );

    uniforms.uNear.value = camera.near;
  }

  async function initialize(context) {
    try {
      signal = context && context.signal ? context.signal : null;
      THREE = engine.Dependencies && engine.Dependencies.THREE;

      const core = engine.Core;

      if (
        !THREE
        || typeof THREE.RawShaderMaterial !== "function"
        || !core
        || typeof core.getScene !== "function"
        || typeof core.getRenderer !== "function"
        || typeof core.registerUpdateCallback !== "function"
      ) {
        throw new Error(
          "TopologicalFlux.init requires the accepted Three.js and Core."
        );
      }

      assertActive();

      const scene = window.QuantumEngine.Core.getScene();
      renderer = core.getRenderer();

      if (!scene || !scene.isScene || !renderer) {
        throw new Error(
          "TopologicalFlux.init requires an initialized Core scene."
        );
      }

      manifold = scene.getObjectByName(
        "QuantumEngine.Manifold.Surface"
      );

      const root = scene.getObjectByName("QuantumEngine.Manifold");
      manifoldMetadata = root && root.userData.manifold;

      const membrane = manifold && manifold.material;
      const membraneUniforms = membrane && membrane.uniforms;

      if (
        !manifold
        || !manifoldMetadata
        || manifoldMetadata.branchCount !== 25
        || !membraneUniforms
        || !membraneUniforms.uTime
        || !membraneUniforms.uScale
        || !membraneUniforms.uRadius
        || !Number.isFinite(manifoldMetadata.parameterVLimit)
        || !Number.isFinite(manifoldMetadata.boundingRadius)
      ) {
        throw new Error(
          "TopologicalFlux.init requires the accepted initialized Manifold."
        );
      }

      manifoldTime = membraneUniforms.uTime;
      lastProjectionTime = manifoldMetadata.elapsedProjectionTime;

      const dom = context && context.dom ? context.dom : engine.DOM;

      fluxControl = dom && dom["qe-flux-intensity"]
        ? dom["qe-flux-intensity"]
        : null;

      verifyHardware();

      targets.push(createStateTarget(0));
      targets.push(createStateTarget(1));

      computeMaterial = own(new THREE.RawShaderMaterial({
        name: "QuantumEngine.TopologicalFlux.Compute",
        glslVersion: THREE.GLSL3,
        precision: "highp",

        defines: {
          STATE_WIDTH
        },

        uniforms: {
          uPositionState: { value: null },
          uVelocityState: { value: null },
          uInitialize: { value: true },
          uDeltaTime: { value: 0 },
          uFieldTime: { value: manifoldTime.value }
        },

        vertexShader: COMPUTE_VERTEX_SHADER,
        fragmentShader: COMPUTE_FRAGMENT_SHADER,

        depthTest: false,
        depthWrite: false,
        blending: THREE.NoBlending,
        toneMapped: false
      }));

      // r180 supports explicit draw ranges with gl_VertexID and no vertex
      // attributes. Both the fullscreen triangle and the swarm use this.
      const computeGeometry = own(new THREE.BufferGeometry());

      computeGeometry.setDrawRange(0, 3);
      computeGeometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(),
        2
      );

      const computeMesh = new THREE.Mesh(
        computeGeometry,
        computeMaterial
      );

      computeMesh.frustumCulled = false;

      computeScene = new THREE.Scene();
      computeScene.add(computeMesh);

      computeCamera = new THREE.OrthographicCamera(
        -1,
        1,
        1,
        -1,
        0,
        1
      );

      await yieldToBrowser();
      assertActive();

      prepareSeed();
      renderCompute(targets[0], true);

      await yieldToBrowser();
      assertActive();

      renderCompute(targets[1], true);
      computeMaterial.uniforms.uInitialize.value = false;

      const radius = manifoldMetadata.boundingRadius * 1.02;
      const particleGeometry = own(new THREE.BufferGeometry());

      particleGeometry.setDrawRange(0, PARTICLE_COUNT);

      particleGeometry.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(),
        radius
      );

      particleGeometry.boundingBox = new THREE.Box3(
        new THREE.Vector3(-radius, -radius, -radius),
        new THREE.Vector3(radius, radius, radius)
      );

      particleMaterial = own(new THREE.ShaderMaterial({
        name: "QuantumEngine.TopologicalFlux.Needles",
        precision: "highp",

        defines: {
          STATE_WIDTH
        },

        uniforms: {
          uPositionState: { value: null },
          uVelocityState: { value: null },

          uTime: membraneUniforms.uTime,
          uScale: membraneUniforms.uScale,
          uVLimit: { value: manifoldMetadata.parameterVLimit },
          uRadius: membraneUniforms.uRadius,

          uViewportPixels: {
            value: new THREE.Vector2(1, 1)
          },

          uPointSizeRange: {
            value: new THREE.Vector2(
              pointSizeMinimum,
              pointSizeMaximum
            )
          },

          uNear: { value: 0.001 },
          uGain: { value: readIntensity() }
        },

        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,

        transparent: true,
        blending: THREE.AdditiveBlending,
        premultipliedAlpha: false,
        depthTest: true,
        depthWrite: false,
        toneMapped: true
      }));

      viewportScratch = new THREE.Vector4();

      particles = new THREE.Points(
        particleGeometry,
        particleMaterial
      );

      particles.name = "QuantumEngine.TopologicalFlux";
      particles.renderOrder = 2;
      particles.frustumCulled = true;
      particles.onBeforeRender = updateRenderUniforms;

      // GPU positions have no CPU picking proxy; exclude the swarm from
      // Three.js's default Points.raycast, which needs a CPU position array.
      particles.raycast = function raycastGPUOnlyParticles() {
        return undefined;
      };

      particles.userData.topologicalFlux = {
        particleCount: PARTICLE_COUNT,
        stateWidth: STATE_WIDTH,
        stateHeight: STATE_HEIGHT,
        stateBytes: PARTICLE_COUNT * 4 * 4 * 2 * 2,
        simulation: "GPU curl flow in quintic section coordinates",
        elapsedTime: 0,
        simulationSteps: 0,
        substepsLastFrame: 0,
        intensity: readIntensity()
      };

      bindCurrentState();
      assertActive();

      // Inherit every transform applied to the actual surface.
      manifold.add(particles);

      unsubscribeUpdate = window.QuantumEngine.Core.registerUpdateCallback(
        update,
        {
          priority: 10,
          phase: "update",
          label: "Topological flux compute"
        }
      );

      state = "ready";
      update(0);

      return particles;
    } catch (error) {
      try {
        dispose();
      } catch (cleanupError) {
        window.console.error(
          "TopologicalFlux cleanup failed:",
          cleanupError
        );
      }

      throw error;
    }
  }

  function init(context) {
    if (state === "disposed") {
      throw new Error(
        "TopologicalFlux has been disposed. Reload before initializing again."
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

    if (particles) {
      release(function () {
        particles.removeFromParent();
      });

      particles.onBeforeRender = THREE.Object3D.prototype.onBeforeRender;
    }

    if (computeScene) {
      release(function () {
        computeScene.clear();
      });
    }

    for (let i = ownedResources.length - 1; i >= 0; i--) {
      const resource = ownedResources[i];

      release(function () {
        resource.dispose();
      });
    }

    ownedResources.length = 0;
    targets.length = 0;

    computeScene = null;
    computeCamera = null;
    computeMaterial = null;
    particleMaterial = null;
    particles = null;

    manifold = null;
    manifoldMetadata = null;
    manifoldTime = null;
    fluxControl = null;
    viewportScratch = null;

    renderer = null;
    signal = null;
    THREE = null;

    if (errors.length) {
      throw new AggregateError(
        errors,
        "TopologicalFlux resource cleanup failed."
      );
    }
  }

  engine.TopologicalFlux = Object.freeze({
    init,
    dispose
  });
})(window);