(function () {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  if (window.QuantumEngine.Wavefunction) {
    return;
  }

  const LENGTH = 100;
  const SEGMENTS = 3072;
  const RADIAL_SEGMENTS = 8;
  const PARTICLE_COUNT = 24000;
  const MODE_NUMBER = 8;
  const HARMONIC_WEIGHT = 0.35;
  const PHASE_FREQUENCY = 0.7;
  const VISUAL_AMPLITUDE = 10;
  const RIBBON_RADIUS = 0.14;
  const FOG_RADIUS = 2.4;
  const TWO_PI = Math.PI * 2;
  const CYCLE_DURATION = TWO_PI / PHASE_FREQUENCY;

  let initialized = false;
  let root = null;

  // Analytic infinite-square-well state:
  // psi = sqrt(2 / (L * (1 + a^2))) *
  //       [sin(k*x')*exp(-i*w*t) + a*sin(2*k*x')*exp(-i*4*w*t)].
  // x' = x + L/2, k = n*pi/L. Time is expressed in scaled units.
  // The shaders share this expression and its analytic spatial derivative.
  // Thermal colors encode relative probability density, not temperature.
  const WAVE_GLSL = `
    uniform float uTime;
    uniform float uLength;
    uniform float uModeNumber;
    uniform float uHarmonicWeight;
    uniform float uPhaseFrequency;
    uniform float uAmplitude;

    const float PI = 3.141592653589793;

    struct WaveState {
      vec2 displacement;
      vec2 derivative;
      float density;
    };

    WaveState evaluateWave(float x) {
      float k = uModeNumber * PI / uLength;
      float spatialPhase = k * (x + 0.5 * uLength);
      float temporalPhase = uPhaseFrequency * uTime;

      vec2 fundamentalRotation = vec2(
        cos(temporalPhase),
        -sin(temporalPhase)
      );

      vec2 harmonicRotation = vec2(
        cos(4.0 * temporalPhase),
        -sin(4.0 * temporalPhase)
      );

      float normalization = sqrt(
        2.0 / (uLength * (1.0 + uHarmonicWeight * uHarmonicWeight))
      );

      vec2 psi = normalization * (
        sin(spatialPhase) * fundamentalRotation +
        uHarmonicWeight * sin(2.0 * spatialPhase) * harmonicRotation
      );

      vec2 derivative = normalization * k * (
        cos(spatialPhase) * fundamentalRotation +
        2.0 * uHarmonicWeight *
        cos(2.0 * spatialPhase) * harmonicRotation
      );

      float amplitudeBound = normalization *
        (1.0 + abs(uHarmonicWeight));

      WaveState wave;
      wave.displacement = uAmplitude * psi / amplitudeBound;
      wave.derivative = uAmplitude * derivative / amplitudeBound;
      wave.density = clamp(
        dot(psi, psi) / (amplitudeBound * amplitudeBound),
        0.0,
        1.0
      );

      return wave;
    }
  `;

  const THERMAL_GLSL = `
    vec3 thermalColor(float density) {
      float heat = clamp(
        pow(max(density, 0.0), 0.65) * 1.32,
        0.0,
        1.0
      );

      vec3 cobalt = vec3(0.008, 0.025, 0.65);
      vec3 magenta = vec3(0.90, 0.004, 0.62);
      vec3 crimson = vec3(1.00, 0.008, 0.035);
      vec3 whiteHot = vec3(1.00, 0.93, 0.88);

      if (heat < 0.38) {
        return mix(cobalt, magenta, smoothstep(0.0, 0.38, heat));
      }

      if (heat < 0.72) {
        return mix(magenta, crimson, smoothstep(0.38, 0.72, heat));
      }

      return mix(crimson, whiteHot, smoothstep(0.72, 1.0, heat));
    }
  `;

  const RIBBON_VERTEX_SHADER = WAVE_GLSL + `
    varying float vDensity;
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;

    void main() {
      WaveState wave = evaluateWave(position.x);

      vec3 tangent = normalize(vec3(1.0, wave.derivative));
      vec3 frameNormal = normalize(vec3(-tangent.y, tangent.x, 0.0));
      vec3 frameBinormal = normalize(cross(tangent, frameNormal));

      vec3 radialOffset =
        frameNormal * position.y +
        frameBinormal * position.z;

      float thickness = mix(0.22, 1.0, sqrt(wave.density));

      vec3 displaced = vec3(position.x, wave.displacement) +
        radialOffset * thickness;

      vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);

      vDensity = wave.density;
      vViewNormal = normalize(normalMatrix * normalize(radialOffset));
      vViewPosition = -viewPosition.xyz;

      gl_Position = projectionMatrix * viewPosition;
    }
  `;

  const RIBBON_FRAGMENT_SHADER = THERMAL_GLSL + `
    varying float vDensity;
    varying vec3 vViewNormal;
    varying vec3 vViewPosition;

    void main() {
      float density = clamp(vDensity, 0.0, 1.0);
      float facing = abs(dot(
        normalize(vViewNormal),
        normalize(vViewPosition)
      ));

      float hot = smoothstep(0.18, 0.72, density);
      float radiance = mix(0.65, 3.8, hot * hot);
      float profile = mix(0.55, 1.0, pow(facing, 0.65));
      float opacity = mix(0.28, 0.96, sqrt(density));

      vec3 color = thermalColor(density) * radiance * profile;

      gl_FragColor = vec4(color, opacity);

      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }
  `;

  // Fog visibility exaggerates density for display.
  // The surrounding sprites are illustrative, not measurement samples.
  const FOG_VERTEX_SHADER = WAVE_GLSL + `
    uniform float uFogRadius;
    uniform float uFogOpacity;
    uniform float uPointSize;
    uniform float uDrawingBufferHeight;
    uniform float uMaxPointSize;

    attribute float aSelection;
    attribute float aSize;
    attribute float aPhase;

    varying float vDensity;
    varying float vOpacity;

    void main() {
      WaveState wave = evaluateWave(position.x);

      float occupancy = smoothstep(
        aSelection,
        aSelection + 0.08,
        wave.density
      );

      vDensity = wave.density;
      vOpacity = uFogOpacity * occupancy * wave.density;

      if (vOpacity <= 0.00001) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        return;
      }

      float angle = uTime * uPhaseFrequency + aPhase;
      float cosine = cos(angle);
      float sine = sin(angle);

      vec2 transverse = vec2(
        cosine * position.y - sine * position.z,
        sine * position.y + cosine * position.z
      );

      float spread = uFogRadius * pow(wave.density, 0.4);
      vec2 center = wave.displacement + transverse * spread;

      vec4 viewPosition = modelViewMatrix *
        vec4(position.x, center, 1.0);

      if (viewPosition.z >= -0.1) {
        vOpacity = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        gl_PointSize = 1.0;
        return;
      }

      float worldDiameter = uPointSize * aSize *
        (0.7 + 2.2 * sqrt(wave.density));

      float pixelsPerWorldUnit = 0.5 * uDrawingBufferHeight *
        abs(projectionMatrix[1][1]) / (-viewPosition.z);

      gl_PointSize = clamp(
        worldDiameter * pixelsPerWorldUnit,
        1.0,
        uMaxPointSize
      );

      gl_Position = projectionMatrix * viewPosition;
    }
  `;

  const FOG_FRAGMENT_SHADER = THERMAL_GLSL + `
    varying float vDensity;
    varying float vOpacity;

    void main() {
      vec2 offset = gl_PointCoord * 2.0 - 1.0;
      float radiusSquared = dot(offset, offset);

      if (radiusSquared >= 1.0 || vOpacity <= 0.00001) {
        discard;
      }

      float edge = 1.0 - smoothstep(0.65, 1.0, radiusSquared);
      float halo = exp(-3.8 * radiusSquared) * edge;
      float nucleus = exp(-20.0 * radiusSquared);
      float opacity = vOpacity * (0.65 * halo + 0.35 * nucleus);

      if (opacity <= 0.00001) {
        discard;
      }

      float hot = smoothstep(0.18, 0.72, vDensity);
      vec3 color = thermalColor(vDensity) *
        (0.8 + 3.2 * hot * hot);

      gl_FragColor = vec4(color, opacity);

      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }
  `;

  function createRandom(seed) {
    let state = seed >>> 0;

    return function random() {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return (state + 0.5) / 4294967296;
    };
  }

  function setDisplacedBounds(THREE, geometry) {
    // Include shader displacement, fog spread, and the point-sprite radius.
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, 0, 0),
      Math.hypot(
        LENGTH * 0.5 + RIBBON_RADIUS,
        VISUAL_AMPLITUDE + 3 * FOG_RADIUS + 2
      )
    );
  }

  function createRibbonGeometry(THREE) {
    const vertexCount = (SEGMENTS + 1) * RADIAL_SEGMENTS;
    const positions = new Float32Array(vertexCount * 3);
    const indices = new Uint16Array(SEGMENTS * RADIAL_SEGMENTS * 6);

    let positionOffset = 0;

    for (let segment = 0; segment <= SEGMENTS; segment += 1) {
      const x = -LENGTH * 0.5 + LENGTH * segment / SEGMENTS;

      for (let side = 0; side < RADIAL_SEGMENTS; side += 1) {
        const angle = TWO_PI * side / RADIAL_SEGMENTS;

        positions[positionOffset++] = x;
        positions[positionOffset++] = Math.cos(angle) * RIBBON_RADIUS;
        positions[positionOffset++] = Math.sin(angle) * RIBBON_RADIUS;
      }
    }

    let indexOffset = 0;

    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const currentRing = segment * RADIAL_SEGMENTS;
      const nextRing = currentRing + RADIAL_SEGMENTS;

      for (let side = 0; side < RADIAL_SEGMENTS; side += 1) {
        const nextSide = (side + 1) % RADIAL_SEGMENTS;

        const a = currentRing + side;
        const b = nextRing + side;
        const c = currentRing + nextSide;
        const d = nextRing + nextSide;

        indices[indexOffset++] = a;
        indices[indexOffset++] = c;
        indices[indexOffset++] = b;

        indices[indexOffset++] = c;
        indices[indexOffset++] = d;
        indices[indexOffset++] = b;
      }
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );

    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    setDisplacedBounds(THREE, geometry);

    return geometry;
  }

  function createFogGeometry(THREE) {
    const random = createRandom(0x51a7c0de);
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const selections = new Float32Array(PARTICLE_COUNT);
    const sizes = new Float32Array(PARTICLE_COUNT);
    const phases = new Float32Array(PARTICLE_COUNT);

    for (let index = 0; index < PARTICLE_COUNT; index += 1) {
      const offset = index * 3;
      const x = -LENGTH * 0.5 +
        LENGTH * (index + random()) / PARTICLE_COUNT;

      const radius = Math.min(3, Math.sqrt(-2 * Math.log(random())));
      const angle = random() * TWO_PI;

      positions[offset] = x;
      positions[offset + 1] = Math.cos(angle) * radius;
      positions[offset + 2] = Math.sin(angle) * radius;

      selections[index] = random();
      sizes[index] = 0.65 + random() * 0.85;
      phases[index] = random() * TWO_PI;
    }

    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
      "aSelection",
      new THREE.BufferAttribute(selections, 1)
    );

    geometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(sizes, 1)
    );

    geometry.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(phases, 1)
    );

    setDisplacedBounds(THREE, geometry);

    return geometry;
  }

  function init() {
    if (initialized) {
      return root;
    }

    const THREE = window.THREE;
    const core = window.QuantumEngine.Core;

    if (!THREE || !core) {
      throw new Error(
        "[QuantumEngine.Wavefunction] Three.js and QuantumEngine.Core must load first."
      );
    }

    if (!core.getScene()) {
      core.init();
    }

    const scene = core.getScene();
    const renderer = core.getRenderer();

    if (!scene || !renderer) {
      throw new Error(
        "[QuantumEngine.Wavefunction] The graphics core is not initialized."
      );
    }

    const resources = [];
    let unregisterUpdate = null;

    try {
      const drawingBufferSize = new THREE.Vector2();
      const gl = renderer.getContext();
      const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);

      const maxPointSize = pointSizeRange
        ? Math.max(1, Math.min(96, pointSizeRange[1]))
        : 64;

      renderer.getDrawingBufferSize(drawingBufferSize);

      const uniforms = {
        uTime: { value: 0 },
        uLength: { value: LENGTH },
        uModeNumber: { value: MODE_NUMBER },
        uHarmonicWeight: { value: HARMONIC_WEIGHT },
        uPhaseFrequency: { value: PHASE_FREQUENCY },
        uAmplitude: { value: VISUAL_AMPLITUDE },
        uFogRadius: { value: FOG_RADIUS },
        uFogOpacity: { value: 0.32 },
        uPointSize: { value: 0.35 },
        uDrawingBufferHeight: {
          value: Math.max(1, drawingBufferSize.y)
        },
        uMaxPointSize: { value: maxPointSize }
      };

      const ribbonGeometry = createRibbonGeometry(THREE);
      resources.push(ribbonGeometry);

      const ribbonMaterial = new THREE.ShaderMaterial({
        name: "QuantumThermalRibbonMaterial",
        uniforms: uniforms,
        vertexShader: RIBBON_VERTEX_SHADER,
        fragmentShader: RIBBON_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      });
      resources.push(ribbonMaterial);

      const fogGeometry = createFogGeometry(THREE);
      resources.push(fogGeometry);

      const fogMaterial = new THREE.ShaderMaterial({
        name: "QuantumProbabilityFogMaterial",
        uniforms: uniforms,
        vertexShader: FOG_VERTEX_SHADER,
        fragmentShader: FOG_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
      resources.push(fogMaterial);

      const ribbon = new THREE.Mesh(ribbonGeometry, ribbonMaterial);
      ribbon.name = "quantum-wavefunction-ribbon";

      const fog = new THREE.Points(fogGeometry, fogMaterial);
      fog.name = "quantum-probability-fog";

      root = new THREE.Group();
      root.name = "quantum-wavefunction";
      root.add(ribbon);
      root.add(fog);

      root.userData.domain = [-LENGTH * 0.5, LENGTH * 0.5];
      root.userData.modeNumbers = [MODE_NUMBER, MODE_NUMBER * 2];
      root.userData.colorQuantity = "relative-probability-density";

      scene.add(root);

      let elapsedTime = 0;

      unregisterUpdate = core.registerUpdateCallback(function update(deltaTime) {
        if (Number.isFinite(deltaTime) && deltaTime > 0) {
          // Both harmonics and the decorative fog motion share this period.
          elapsedTime = (elapsedTime + deltaTime) % CYCLE_DURATION;
          uniforms.uTime.value = elapsedTime;
        }

        renderer.getDrawingBufferSize(drawingBufferSize);

        uniforms.uDrawingBufferHeight.value = Math.max(
          1,
          drawingBufferSize.y
        );
      });

      initialized = true;
      return root;
    } catch (error) {
      if (unregisterUpdate) {
        unregisterUpdate();
      }

      if (root && root.parent) {
        root.parent.remove(root);
      }

      for (let index = resources.length - 1; index >= 0; index -= 1) {
        resources[index].dispose();
      }

      root = null;
      initialized = false;
      throw error;
    }
  }

  function start() {
    try {
      init();
    } catch (error) {
      console.error(
        "[QuantumEngine.Wavefunction] Initialization failed.",
        error
      );

      const status = document.getElementById("engine-status");

      if (status) {
        status.textContent = "Wavefunction initialization failed";
      }
    }
  }

  window.QuantumEngine.Wavefunction = { init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}());