/* script.js */
(() => {
  "use strict";

  /*
   * Scientific context:
   * https://science.nasa.gov/universe/overview/
   * https://science.nasa.gov/mission/webb/science-overview/science-explainers/what-were-the-first-stars-like/
   * https://www.esa.int/Science_Exploration/Space_Science/Planck/History_of_cosmic_structure_formation
   * https://www.nasa.gov/universe/nasas-james-webb-space-telescope-and-the-big-bang-a-short-qa-with-nobel-laureate-dr-john-mather/
   *
   * Z is an artistic timeline coordinate, not a cosmological distance.
   * The hot Big Bang has no spatial center.
   * Visible depth colors and the primordial core are symbolic.
   */

  const dom = {
    container: document.getElementById("canvas-container"),
    panel: document.getElementById("info-panel"),
    overlay: document.getElementById("flight-overlay"),
    status: document.getElementById("render-status"),
    epochTitle: document.getElementById("epoch-title"),
    epochAge: document.getElementById("epoch-age"),
    epochDescription: document.getElementById("epoch-description"),
    epochRows: Array.from(document.querySelectorAll("[data-epoch]")),
    nodeCount: document.getElementById("node-count"),
    mode: document.getElementById("flight-mode"),
    progress: document.getElementById("journey-progress"),
    progressFill: document.getElementById("journey-fill")
  };

  function showStatus(message) {
    dom.status.hidden = false;
    dom.status.textContent = message;
  }

  if (!window.THREE) {
    showStatus("Three.js could not load. Check the connection and reload.");
    return;
  }

  const required = [
    "OrbitControls",
    "EffectComposer",
    "RenderPass",
    "ShaderPass",
    "UnrealBloomPass",
    "FXAAShader"
  ];

  for (const component of required) {
    if (!THREE[component]) {
      showStatus("A rendering component could not load: " + component + ".");
      return;
    }
  }

  const CONFIG = Object.freeze({
    background: 0x020105,
    fogDensity: 0.003,
    startZ: 76,
    endZ: -347,
    coreZ: -350,
    travelDuration: 140,
    cycleDuration: 150,
    seed: 13800380
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(CONFIG.background).convertSRGBToLinear();
  scene.fog = new THREE.FogExp2(0x020105, 0.003);
  scene.fog.color.convertSRGBToLinear();

  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.035,
    1500
  );

  scene.add(camera);

  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      precision: "highp",
      depth: true,
      stencil: false
    });
  } catch (error) {
    showStatus("WebGL could not start: " + error.message);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.LinearEncoding;
  renderer.toneMapping = THREE.NoToneMapping;

  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "A cinematic journey through cosmic history. Scroll during automated flight to move through time. Drag to orbit. Press Space to pause, R to resume flight, and H to hide the information panel."
  );

  dom.container.appendChild(renderer.domElement);

  const timeUniform = { value: 0 };
  const cameraZUniform = { value: CONFIG.startZ };
  const redshiftUniform = { value: 1 };
  const coreProximityUniform = { value: 0 };
  const fogUniform = { value: CONFIG.fogDensity };
  const pointScaleUniform = { value: 1 };
  const cmbRevealUniform = { value: 0 };
  const whiteoutUniform = { value: 0 };

  const gl = renderer.getContext();
  const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const pointMaximumUniform = {
    value: Math.min(96, pointRange[1])
  };

  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let automatic = !motionPreference.matches;
  let paused = motionPreference.matches;
  let cycleTime = 6;
  let animationTime = 0;
  let running = false;
  let contextLost = false;
  let animationId = 0;
  let lastTimestamp = null;
  let currentPixelRatio = 0;
  let resizeId = 0;
  let totalNodes = 0;
  let previousEpoch = -1;
  let previousMode = "";
  let previousProgress = -1;

  const spinners = [];
  const planets = [];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function smoothstep(minimum, maximum, value) {
    const t = clamp((value - minimum) / (maximum - minimum), 0, 1);
    return t * t * (3 - 2 * t);
  }

  function seededRandom(seed) {
    let state = seed >>> 0;

    return () => {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  const random = seededRandom(CONFIG.seed);

  function gaussian() {
    const u = Math.max(random(), 0.000001);
    const v = random();

    return clamp(
      Math.sqrt(-2 * Math.log(u)) * Math.cos(Math.PI * 2 * v),
      -3,
      3
    );
  }

  function direction() {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radius = Math.sqrt(1 - y * y);

    return new THREE.Vector3(
      Math.cos(angle) * radius,
      y,
      Math.sin(angle) * radius
    );
  }

  function color(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
  }

  const palette = {
    white: color(0xeaf5ff),
    blue: color(0x70caff),
    emerald: color(0x6dffc4),
    violet: color(0x8152ea),
    magenta: color(0xf267d4),
    gold: color(0xffd69a),
    orange: color(0xff7844),
    coreOrange: color(0xff4500),
    coreViolet: color(0x4b0082)
  };

  function mixed(first, second, amount) {
    return first.clone().lerp(second, amount);
  }

  /*
   * Wheel events are intercepted before OrbitControls only during flight.
   * Manual mode preserves native OrbitControls zoom behavior.
   */
  renderer.domElement.addEventListener("wheel", event => {
    if (!automatic) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * window.innerHeight
        : event.deltaY;

    cycleTime = clamp(cycleTime + delta * 0.022, 6, 140);
    placeFlightCamera(true);
  }, {
    passive: false,
    capture: true
  });

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.rotateSpeed = 0.43;
  controls.zoomSpeed = 0.72;
  controls.panSpeed = 0.58;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.4;
  controls.maxDistance = 500;
  controls.enableKeys = false;

  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };

  controls.addEventListener("start", () => {
    automatic = false;
  });

  renderer.domElement.addEventListener("pointerdown", () => {
    renderer.domElement.focus({ preventScroll: true });
  });

  renderer.domElement.addEventListener("contextmenu", event => {
    event.preventDefault();
  });

  const supportsHDR =
    renderer.capabilities.isWebGL2 &&
    Boolean(renderer.extensions.get("EXT_color_buffer_float"));

  const targetType = supportsHDR
    ? THREE.HalfFloatType
    : THREE.UnsignedByteType;

  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: targetType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false
  });

  target.texture.generateMipmaps = false;

  const composer = new THREE.EffectComposer(renderer, target);
  composer.addPass(new THREE.RenderPass(scene, camera));

  const bloom = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.95,
    0.72,
    0.65
  );

  bloom.renderTargetBright.texture.type = targetType;

  for (const buffer of bloom.renderTargetsHorizontal) {
    buffer.texture.type = targetType;
  }

  for (const buffer of bloom.renderTargetsVertical) {
    buffer.texture.type = targetType;
  }

  composer.addPass(bloom);

  const grade = new THREE.ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: 1.1 },
      uWhiteout: whiteoutUniform
    },

    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix
                    * vec4(position, 1.0);
      }
    `,

    fragmentShader: `
      precision highp float;

      uniform sampler2D tDiffuse;
      uniform float uExposure;
      uniform float uWhiteout;
      varying vec2 vUv;

      vec3 filmic(vec3 value) {
        return clamp(
          (value * (2.51 * value + 0.03))
          / (value * (2.43 * value + 0.59) + 0.14),
          0.0,
          1.0
        );
      }

      vec3 linearToSRGB(vec3 value) {
        vec3 low = value * 12.92;
        vec3 high = 1.055 * pow(
          max(value, vec3(0.0)),
          vec3(1.0 / 2.4)
        ) - 0.055;

        return mix(low, high, step(vec3(0.0031308), value));
      }

      float hash(vec2 point) {
        return fract(
          sin(dot(point, vec2(12.9898, 78.233))) * 43758.5453
        );
      }

      void main() {
        vec3 radiance = texture2D(tDiffuse, vUv).rgb * uExposure;

        vec2 centered = vUv - 0.5;
        float vignette = 1.0 - 0.26 * dot(centered, centered);

        vec3 displayColor = linearToSRGB(filmic(radiance * vignette));
        displayColor += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

        displayColor = mix(
          clamp(displayColor, 0.0, 1.0),
          vec3(1.0),
          uWhiteout
        );

        gl_FragColor = vec4(displayColor, 1.0);
      }
    `
  });

  composer.addPass(grade);

  const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
  composer.addPass(fxaa);

  function makeRadialTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas textures are unavailable.");
    }

    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.09, "rgba(255,255,255,0.98)");
    gradient.addColorStop(0.24, "rgba(255,255,255,0.56)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.12)");
    gradient.addColorStop(0.78, "rgba(255,255,255,0.025)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    context.fillStyle = gradient;
    context.fillRect(0, 0, 128, 128);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  let radialTexture;

  try {
    radialTexture = makeRadialTexture();
  } catch (error) {
    showStatus(error.message);
    return;
  }

  const particleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uCameraZ: cameraZUniform,
      uRedshift: redshiftUniform,
      uCoreProximity: coreProximityUniform,
      uPointScale: pointScaleUniform,
      uPointMaximum: pointMaximumUniform,
      uFogDensity: fogUniform,
      uSprite: { value: radialTexture },
      uCoreOrange: { value: palette.coreOrange },
      uCoreViolet: { value: palette.coreViolet }
    },

    vertexShader: `
      precision highp float;

      uniform float uTime;
      uniform float uCameraZ;
      uniform float uRedshift;
      uniform float uCoreProximity;
      uniform float uPointScale;
      uniform float uPointMaximum;
      uniform vec3 uCoreOrange;
      uniform vec3 uCoreViolet;

      attribute vec3 aColor;
      attribute float aSize;
      attribute float aOpacity;
      attribute float aKind;
      attribute float aPhase;

      varying vec3 vColor;
      varying float vOpacity;
      varying float vKind;
      varying float vDepth;

      void main() {
        vec3 displaced = position;

        bool dawn = (
          (aKind > 1.5 && aKind < 2.5)
          || aKind > 5.5
        );

        bool core = aKind > 2.5 && aKind < 3.5;
        bool galaxy = aKind > 4.5 && aKind < 5.5;

        if (dawn) {
          float amplitude = 0.18 + 0.62 * uCoreProximity;

          displaced.x += sin(
            position.z * 0.055 + uTime * 0.31 + aPhase
          ) * amplitude;

          displaced.y += cos(
            position.z * 0.043 - uTime * 0.23 + aPhase
          ) * amplitude;

          displaced.z += sin(
            position.x * 0.17 + uTime * 0.18
          ) * 0.16;
        }

        if (galaxy) {
          displaced.z += sin(
            position.x * 0.19 + position.y * 0.14 + uTime * 0.26
          ) * 0.10;
        }

        if (core) {
          float breathing = 1.0
            + 0.035 * sin(uTime * 0.87 + aPhase * 0.5);

          displaced *= breathing;

          displaced.x += sin(
            position.y * 0.52 + uTime * 0.8 + aPhase
          ) * 0.34;

          displaced.y += cos(
            position.z * 0.47 - uTime * 0.63 + aPhase
          ) * 0.34;

          displaced.z += sin(
            position.x * 0.39 + uTime * 0.52
          ) * 0.30;
        }

        vec4 worldPosition = modelMatrix * vec4(displaced, 1.0);
        vec4 viewPosition = viewMatrix * worldPosition;

        vDepth = max(0.01, -viewPosition.z);
        vKind = aKind;

        float chronologicalDepth = clamp(
          (-worldPosition.z - 20.0) / 330.0,
          0.0,
          1.0
        );

        float distanceAhead = clamp(
          (uCameraZ - worldPosition.z) / 280.0,
          0.0,
          1.0
        );

        float redshift = pow(chronologicalDepth, 1.25)
          * (0.28 + 0.72 * distanceAhead)
          * uRedshift;

        vec3 warmSpectrum =
          aColor * vec3(1.18, 0.36, 0.16)
          + vec3(0.18, 0.013, 0.006);

        vColor = mix(aColor, warmSpectrum, clamp(redshift, 0.0, 0.92));

        float shimmer = 0.88 + 0.12 * sin(
          uTime * 0.8 + aPhase * 7.0
        );

        vOpacity = aOpacity * shimmer;

        if (core) {
          float spectrum = 0.5 + 0.5 * sin(
            uTime * 0.56 + aPhase * 0.22
          );

          float concentration = exp(
            -dot(position, position) * 0.065
          );

          float pulse = 1.0
            + 0.25 * sin(uTime * 1.2)
            + 0.12 * cos(uTime * 1.73);

          vColor = (
            mix(uCoreOrange, uCoreViolet, spectrum) * 4.0
            + vec3(1.0, 0.88, 0.68) * concentration * 3.8
          ) * pulse;

          vOpacity = aOpacity;
        }

        gl_PointSize = clamp(
          aSize * uPointScale / vDepth,
          1.0,
          uPointMaximum
        );

        gl_Position = projectionMatrix * viewPosition;
      }
    `,

    fragmentShader: `
      precision highp float;

      uniform sampler2D uSprite;
      uniform float uFogDensity;

      varying vec3 vColor;
      varying float vOpacity;
      varying float vKind;
      varying float vDepth;

      void main() {
        vec2 centered = gl_PointCoord - 0.5;
        float radiusSquared = dot(centered, centered);

        float profile = texture2D(uSprite, gl_PointCoord).a;
        float spike = 0.0;

        bool sharp =
          vKind < 0.5
          || (vKind > 1.5 && vKind < 2.5)
          || (vKind > 3.5 && vKind < 5.5);

        if (sharp) {
          spike =
            exp(-abs(centered.x) * 125.0)
            * exp(-centered.y * centered.y * 18.0)
            + exp(-abs(centered.y) * 125.0)
            * exp(-centered.x * centered.x * 18.0);
        }

        float fog = exp(-pow(uFogDensity * vDepth, 2.0));
        float alpha = (profile + spike * 0.12) * vOpacity * fog;

        if (alpha < 0.0015) discard;

        float hotCenter = exp(-radiusSquared * 100.0);

        gl_FragColor = vec4(
          vColor * (0.88 + hotCenter * 1.2),
          alpha
        );
      }
    `,

    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  });

  function builder() {
    return {
      positions: [],
      colors: [],
      sizes: [],
      opacities: [],
      kinds: [],
      phases: []
    };
  }

  function addNode(data, x, y, z, tint, size, opacity, kind) {
    data.positions.push(x, y, z);
    data.colors.push(tint.r, tint.g, tint.b);
    data.sizes.push(size);
    data.opacities.push(opacity);
    data.kinds.push(kind);
    data.phases.push(random() * Math.PI * 2);
  }

  function makePoints(data, name, parent = scene, order = 1) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(data.positions, 3)
    );

    geometry.setAttribute(
      "aColor",
      new THREE.Float32BufferAttribute(data.colors, 3)
    );

    geometry.setAttribute(
      "aSize",
      new THREE.Float32BufferAttribute(data.sizes, 1)
    );

    geometry.setAttribute(
      "aOpacity",
      new THREE.Float32BufferAttribute(data.opacities, 1)
    );

    geometry.setAttribute(
      "aKind",
      new THREE.Float32BufferAttribute(data.kinds, 1)
    );

    geometry.setAttribute(
      "aPhase",
      new THREE.Float32BufferAttribute(data.phases, 1)
    );

    const points = new THREE.Points(geometry, particleMaterial);
    points.name = name;
    points.frustumCulled = false;
    points.renderOrder = order;
    parent.add(points);

    totalNodes += data.positions.length / 3;
    return points;
  }

  /*
   * Modern neighborhood: 900 field stars, 1,400 nebular samples,
   * 1,350 cluster stars, and 1,400 planetary surface nodes.
   */
  const neighborhood = builder();

  for (let index = 0; index < 900; index++) {
    const tint = index % 7 === 0
      ? mixed(palette.blue, palette.emerald, random())
      : mixed(palette.blue, palette.white, random());

    addNode(
      neighborhood,
      (random() - 0.5) * 92,
      (random() - 0.5) * 62,
      random() * 50,
      tint,
      0.10 + random() * 0.24,
      0.55 + random() * 0.4,
      0
    );
  }

  makePoints(neighborhood, "Modern neighborhood star field");

  const nebulae = builder();

  for (let index = 0; index < 1400; index++) {
    const second = index >= 700;
    const t = random() * Math.PI * 2;

    const x = (second ? 14 : -13)
      + Math.cos(t) * (4 + random() * 7)
      + gaussian() * 2.4;

    const y = (second ? -8 : 9)
      + Math.sin(t * 1.3) * 5
      + gaussian() * 1.8;

    const z = clamp(
      (second ? 14 : 29)
      + Math.cos(t * 0.8) * 8
      + gaussian() * 4,
      0.5,
      49.5
    );

    const tint = second
      ? mixed(palette.emerald, palette.blue, random())
      : mixed(palette.violet, palette.magenta, random());

    addNode(
      nebulae,
      x,
      y,
      z,
      tint,
      2.2 + random() * 4.8,
      0.018 + random() * 0.035,
      1
    );
  }

  makePoints(nebulae, "Volumetric molecular clouds", scene, 0);

  const clusterCenters = [
    new THREE.Vector3(-20, -10, 43),
    new THREE.Vector3(20, 14, 29),
    new THREE.Vector3(-4, 14, 8)
  ];

  const clusters = builder();

  for (const clusterCenter of clusterCenters) {
    for (let index = 0; index < 450; index++) {
      const offset = direction().multiplyScalar(
        4.2 * Math.pow(random(), 1.8)
      );

      const tint = mixed(
        palette.white,
        index % 4 === 0 ? palette.gold : palette.blue,
        random() * 0.65
      );

      addNode(
        clusters,
        clusterCenter.x + offset.x,
        clusterCenter.y + offset.y,
        clamp(clusterCenter.z + offset.z, 0.5, 49.5),
        tint,
        0.12 + random() * 0.23,
        0.75,
        0
      );
    }
  }

  makePoints(clusters, "Dense stellar clusters");

  const noiseGLSL = `
    float hash3(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.13, 0.17, 0.19));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise3(vec3 p) {
      vec3 cell = floor(p);
      vec3 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);

      float n000 = hash3(cell);
      float n100 = hash3(cell + vec3(1.0, 0.0, 0.0));
      float n010 = hash3(cell + vec3(0.0, 1.0, 0.0));
      float n110 = hash3(cell + vec3(1.0, 1.0, 0.0));
      float n001 = hash3(cell + vec3(0.0, 0.0, 1.0));
      float n101 = hash3(cell + vec3(1.0, 0.0, 1.0));
      float n011 = hash3(cell + vec3(0.0, 1.0, 1.0));
      float n111 = hash3(cell + vec3(1.0, 1.0, 1.0));

      return mix(
        mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
        mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
        f.z
      );
    }

    float fbm(vec3 p) {
      float value = 0.0;
      float amplitude = 0.5;

      for (int octave = 0; octave < 4; octave++) {
        value += noise3(p) * amplitude;
        p = p * 2.03 + vec3(7.1, 4.3, 9.2);
        amplitude *= 0.5;
      }

      return value;
    }
  `;

  function createPlanet(position, radius, gasGiant) {
    const group = new THREE.Group();
    group.position.copy(position);
    group.rotation.z = gasGiant ? 0.34 : -0.2;
    scene.add(group);

    const surfaceMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uGas: { value: gasGiant ? 1 : 0 },
        uFogDensity: fogUniform,
        uOcean: { value: color(0x063858) },
        uLand: { value: color(0x3b9d77) },
        uWarm: { value: color(0xc48759) }
      },

      vertexShader: `
        varying vec3 vLocal;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vDepth;

        void main() {
          vLocal = normalize(position);
          vNormal = normalize(normalMatrix * normal);

          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);

          vView = -viewPosition.xyz;
          vDepth = max(0.0, -viewPosition.z);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,

      fragmentShader: `
        precision highp float;

        uniform float uTime;
        uniform float uGas;
        uniform float uFogDensity;
        uniform vec3 uOcean;
        uniform vec3 uLand;
        uniform vec3 uWarm;

        varying vec3 vLocal;
        varying vec3 vNormal;
        varying vec3 vView;
        varying float vDepth;

        ${noiseGLSL}

        void main() {
          vec3 n = normalize(vLocal);
          float terrain = fbm(n * 4.6 + vec3(1.7, 4.1, 0.3));

          vec3 surface = mix(
            uOcean,
            uLand * (0.55 + terrain),
            smoothstep(0.47, 0.54, terrain)
          );

          float clouds = smoothstep(
            0.58,
            0.75,
            fbm(n * 6.5 + vec3(uTime * 0.009, 0.0, 0.0))
          );

          surface = mix(surface, vec3(0.79, 0.88, 0.94), clouds * 0.82);

          if (uGas > 0.5) {
            float bands = 0.5 + 0.5 * sin(
              n.y * 57.0 + terrain * 12.0
            );

            surface = mix(
              uWarm * 0.5,
              vec3(0.72, 0.59, 0.40),
              bands
            );

            surface += terrain * vec3(0.08, 0.04, 0.02);
          }

          vec3 normal = normalize(vNormal);
          vec3 viewDirection = normalize(vView);
          vec3 lightDirection = normalize(vec3(-0.45, 0.55, 1.0));

          float diffuse = max(dot(normal, lightDirection), 0.0);
          float rim = pow(
            1.0 - max(dot(normal, viewDirection), 0.0),
            3.0
          );

          vec3 halfVector = normalize(lightDirection + viewDirection);
          float specular = pow(
            max(dot(normal, halfVector), 0.0),
            72.0
          );

          vec3 radiance =
            surface * (0.06 + diffuse * 1.4)
            + vec3(0.20, 0.57, 0.85) * rim * 0.17
            + specular * vec3(0.55);

          float fog = exp(-pow(uFogDensity * vDepth, 2.0));

          gl_FragColor = vec4(radiance * fog, 1.0);
        }
      `,

      toneMapped: false
    });

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 96, 64),
      surfaceMaterial
    );

    group.add(sphere);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.055, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: {
          uTint: { value: gasGiant ? palette.gold : palette.blue }
        },

        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vView;

          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = -viewPosition.xyz;
            gl_Position = projectionMatrix * viewPosition;
          }
        `,

        fragmentShader: `
          uniform vec3 uTint;

          varying vec3 vNormal;
          varying vec3 vView;

          void main() {
            float facing = abs(dot(
              normalize(vNormal),
              normalize(vView)
            ));

            float rim = pow(1.0 - facing, 3.5);
            gl_FragColor = vec4(uTint * 1.6, rim * 0.42);
          }
        `,

        transparent: true,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );

    group.add(atmosphere);

    const surfaceNodes = builder();

    for (let index = 0; index < 700; index++) {
      const point = direction().multiplyScalar(radius * 1.008);

      addNode(
        surfaceNodes,
        point.x,
        point.y,
        point.z,
        gasGiant
          ? mixed(palette.gold, palette.white, random())
          : mixed(palette.emerald, palette.blue, random()),
        0.035 + random() * 0.025,
        0.36,
        4
      );
    }

    makePoints(surfaceNodes, "Planetary surface microstructure", group, 2);

    if (gasGiant) {
      const rings = new THREE.Mesh(
        new THREE.RingGeometry(radius * 1.32, radius * 2.0, 160, 32),
        new THREE.ShaderMaterial({
          uniforms: {
            uInner: { value: radius * 1.32 },
            uOuter: { value: radius * 2.0 },
            uColor: { value: palette.gold }
          },

          vertexShader: `
            varying vec3 vLocal;

            void main() {
              vLocal = position;
              gl_Position = projectionMatrix * modelViewMatrix
                          * vec4(position, 1.0);
            }
          `,

          fragmentShader: `
            uniform float uInner;
            uniform float uOuter;
            uniform vec3 uColor;

            varying vec3 vLocal;

            void main() {
              float radius = length(vLocal.xy);
              float normalized = (radius - uInner) / (uOuter - uInner);

              float bands =
                0.45 + 0.30 * sin(radius * 44.0)
                + 0.15 * sin(radius * 103.0);

              float edge =
                smoothstep(0.0, 0.05, normalized)
                * (1.0 - smoothstep(0.94, 1.0, normalized));

              float gap = 1.0 - smoothstep(
                0.025,
                0.0,
                abs(normalized - 0.58)
              );

              gl_FragColor = vec4(
                uColor * 0.9,
                max(0.0, bands) * edge * (0.2 + 0.8 * gap) * 0.55
              );
            }
          `,

          transparent: true,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false
        })
      );

      rings.rotation.x = 0.95;
      rings.rotation.y = 0.22;
      group.add(rings);
    }

    planets.push({
      group,
      speed: gasGiant ? 0.035 : 0.021,
      initial: random() * Math.PI * 2
    });
  }

  createPlanet(new THREE.Vector3(-12, 2, 31), 5.2, false);
  createPlanet(new THREE.Vector3(12, -5, 10), 3.8, true);

  /*
   * Spiral galaxies use r = r0 exp(b theta).
   * All three centers lie directly on the automated flight axis.
   */
  function createSpiralGalaxy(z, radius, arms, index) {
    const group = new THREE.Group();
    group.position.set(0, 0, z);
    group.rotation.x = index === 1 ? -0.10 : 0.09;
    group.rotation.y = index === 2 ? 0.10 : -0.06;
    scene.add(group);

    const data = builder();
    const r0 = 0.25;
    const b = 0.30;
    const thetaMaximum = Math.log(radius / r0) / b;

    for (let node = 0; node < 1800; node++) {
      let x;
      let y;
      let height;
      let tint;

      if (node < 330) {
        const point = direction().multiplyScalar(
          2.7 * Math.pow(random(), 1.7)
        );

        x = point.x;
        y = point.y;
        height = point.z * 0.4;
        tint = mixed(palette.gold, palette.white, random() * 0.7);
      } else {
        const u = Math.pow(random(), 0.45);
        const theta = u * thetaMaximum;
        const r = r0 * Math.exp(b * theta);
        const arm = node % arms;

        const angle =
          theta + arm * Math.PI * 2 / arms
          + gaussian() * (0.035 + 0.03 * u);

        const armWidth = 0.12 + r * 0.027;

        x = Math.cos(angle) * r + gaussian() * armWidth;
        y = Math.sin(angle) * r + gaussian() * armWidth;
        height = gaussian() * (0.12 + 0.014 * r);

        tint = mixed(
          palette.gold,
          node % 7 === 0 ? palette.magenta : palette.blue,
          Math.pow(u, 0.7)
        );
      }

      addNode(
        data,
        x,
        y,
        height,
        tint,
        0.10 + random() * 0.20,
        0.62 + random() * 0.28,
        5
      );
    }

    makePoints(data, "Logarithmic spiral galaxy " + (index + 1), group);

    spinners.push({
      group,
      initial: random() * Math.PI * 2,
      speed: index % 2 ? -0.018 : 0.016
    });
  }

  createSpiralGalaxy(-64, 19, 4, 0);
  createSpiralGalaxy(-101, 18, 3, 1);
  createSpiralGalaxy(-138, 21, 5, 2);

  const ellipticalCenters = [
    new THREE.Vector3(-28, 11, -79),
    new THREE.Vector3(26, -11, -115),
    new THREE.Vector3(-27, -17, -140)
  ];

  const ellipticals = builder();

  for (const galaxyCenter of ellipticalCenters) {
    for (let index = 0; index < 550; index++) {
      const point = direction().multiplyScalar(
        Math.pow(random(), 1.55)
      );

      addNode(
        ellipticals,
        galaxyCenter.x + point.x * 8.5,
        galaxyCenter.y + point.y * 5.4,
        galaxyCenter.z + point.z * 3.6,
        mixed(palette.gold, palette.white, random() * 0.55),
        0.10 + random() * 0.18,
        0.72,
        5
      );
    }
  }

  makePoints(ellipticals, "Dense elliptical galaxy fields");

  /*
   * Primordial filaments stop before the starless dark-ages interval.
   * Gas samples use larger, more transparent sprites than stellar nodes.
   */
  const dawn = builder();

  for (let index = 0; index < 3400; index++) {
    const branch = index % 8;
    const u = random();
    const phase = branch * Math.PI * 2 / 8;
    const gas = index % 3 === 0;

    const x =
      (branch - 3.5) * 3.7
      + Math.sin(u * 4.6 + phase) * 6.5
      + gaussian() * (gas ? 1.7 : 0.65);

    const y =
      Math.sin(u * 6.2 + phase * 0.7) * 9
      + Math.cos(u * 2.4 + phase) * 4
      + gaussian() * (gas ? 1.4 : 0.5);

    const z = clamp(
      -156 - u * 132 + gaussian() * 0.35,
      -288.7,
      -155.2
    );

    addNode(
      dawn,
      x,
      y,
      z,
      mixed(palette.gold, palette.white, random() * 0.7),
      gas ? 1.4 + random() * 2.6 : 0.13 + random() * 0.22,
      gas ? 0.026 : 0.67,
      gas ? 6 : 2
    );
  }

  makePoints(dawn, "Cosmic dawn — gas filaments and first stars");

  /*
   * A false-color last-scattering transition occupies the interval
   * between the dark ages and the symbolic primordial plasma.
   */
  const cmb = new THREE.Mesh(
    new THREE.PlaneGeometry(160, 120, 1, 1),
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uReveal: cmbRevealUniform
      },

      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix
                      * vec4(position, 1.0);
        }
      `,

      fragmentShader: `
        precision highp float;

        uniform float uTime;
        uniform float uReveal;
        varying vec2 vUv;

        ${noiseGLSL}

        void main() {
          vec2 centered = vUv - 0.5;

          float structure = fbm(
            vec3(vUv * 19.0, 0.5 + uTime * 0.008)
          );

          float fine = fbm(
            vec3(vUv * 58.0, 2.0 - uTime * 0.005)
          );

          vec3 cold = vec3(0.34, 0.035, 0.017);
          vec3 hot = vec3(1.6, 0.78, 0.27);

          vec3 color = mix(
            cold,
            hot,
            smoothstep(0.22, 0.72, structure)
          );

          color += vec3(0.25, 0.09, 0.02) * fine;

          float border = 1.0 - smoothstep(
            0.30,
            0.67,
            length(centered)
          );

          gl_FragColor = vec4(color, uReveal * border);
        }
      `,

      transparent: true,
      side: THREE.FrontSide,
      depthWrite: false,
      toneMapped: false
    })
  );

  cmb.position.z = -324;
  cmb.renderOrder = 8;
  scene.add(cmb);

  /*
   * Dense layered primordial plasma. Its location is a cinematic endpoint,
   * not a claim that the universe began at a point in existing space.
   */
  const coreGroup = new THREE.Group();
  coreGroup.position.set(0, 0, CONFIG.coreZ);
  scene.add(coreGroup);

  const core = builder();

  for (let index = 0; index < 3200; index++) {
    const layer = index % 4;
    const radius = layer === 0
      ? 3.2 * Math.pow(random(), 0.85)
      : layer === 1
        ? 7.2 * Math.pow(random(), 0.65)
        : 12 * Math.cbrt(random());

    const point = direction().multiplyScalar(radius);

    addNode(
      core,
      point.x,
      point.y,
      point.z,
      palette.coreOrange,
      layer === 0
        ? 0.45 + random() * 1.2
        : 0.8 + random() * 2.8,
      layer === 0 ? 0.62 : 0.18 + random() * 0.13,
      3
    );
  }

  makePoints(core, "Symbolic hot primordial plasma", coreGroup, 4);

  /*
   * Sparse camera-relative motion streaks reinforce forward travel.
   * They are cinematic effects, separate from the chronology's particles.
   */
  const streakPositions = [];
  const streakPhases = [];

  for (let index = 0; index < 128; index++) {
    const angle = random() * Math.PI * 2;
    const radius = 4 + random() * 24;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const phase = random();

    streakPositions.push(x, y, 0, x, y, 1);
    streakPhases.push(phase, phase);
  }

  const streakGeometry = new THREE.BufferGeometry();

  streakGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(streakPositions, 3)
  );

  streakGeometry.setAttribute(
    "aPhase",
    new THREE.Float32BufferAttribute(streakPhases, 1)
  );

  const streaks = new THREE.LineSegments(
    streakGeometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uCoreProximity: coreProximityUniform
      },

      vertexShader: `
        uniform float uTime;
        uniform float uCoreProximity;

        attribute float aPhase;
        varying float vOpacity;

        void main() {
          float progress = fract(aPhase + uTime * 0.22);
          float z = -65.0 + progress * 62.0;

          float length = 0.45 + uCoreProximity * 1.5;
          vec3 displaced = vec3(
            position.xy,
            z - position.z * length
          );

          vOpacity =
            smoothstep(0.0, 0.12, progress)
            * (1.0 - smoothstep(0.82, 1.0, progress))
            * (0.07 + uCoreProximity * 0.06);

          gl_Position = projectionMatrix * modelViewMatrix
                      * vec4(displaced, 1.0);
        }
      `,

      fragmentShader: `
        varying float vOpacity;

        void main() {
          gl_FragColor = vec4(0.45, 0.71, 1.0, vOpacity);
        }
      `,

      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  streaks.frustumCulled = false;
  streaks.renderOrder = 9;
  camera.add(streaks);

  dom.nodeCount.textContent = totalNodes.toLocaleString("en-US");

  const epochs = [
    {
      title: "Modern cosmos",
      age: "Age ≈13.8 billion years",
      description: "Planets, mature star clusters, and luminous nebulae."
    },
    {
      title: "Galaxy assembly",
      age: "Billions of years of cosmic history",
      description: "Spiral disks and elliptical galaxies form a compressed montage of evolving structure."
    },
    {
      title: "Cosmic dawn",
      age: "First stars roughly 100–200 million years",
      description: "Primordial gas gathers into the earliest stellar systems. The onset remains model dependent."
    },
    {
      title: "The dark ages",
      age: "After ≈380,000 years, before the first stars",
      description: "Predominantly neutral hydrogen and helium fill a universe without luminous stars."
    },
    {
      title: "Last scattering / CMB",
      age: "≈380,000 years · redshift ≈1,100",
      description: "The universe becomes transparent. This warm veil is a false-color depiction of the transition."
    },
    {
      title: "Hot primordial universe",
      age: "First minutes and earlier",
      description: "An intensely hot, dense plasma. The luminous destination symbolizes the hot Big Bang."
    }
  ];

  function epochForZ(z) {
    if (z >= -45) return 0;
    if (z >= -148) return 1;
    if (z >= -290) return 2;
    if (z >= -319) return 3;
    if (z >= -333) return 4;
    return 5;
  }

  const flightPosition = new THREE.Vector3();
  const flightTarget = new THREE.Vector3();
  const rig = new THREE.PerspectiveCamera();
  rig.up.copy(camera.up);

  function journeyZ() {
    const progress = clamp(
      cycleTime / CONFIG.travelDuration,
      0,
      1
    );

    return CONFIG.startZ
      + (CONFIG.endZ - CONFIG.startZ) * progress;
  }

  function placeFlightCamera(immediate, delta = 0) {
    const z = journeyZ();

    flightPosition.set(0, 0, z);
    flightTarget.set(0, 0, z - 42);

    if (immediate) {
      camera.position.copy(flightPosition);
      camera.lookAt(flightTarget);
    } else {
      const blend = 1 - Math.exp(-3.2 * delta);
      camera.position.lerp(flightPosition, blend);

      rig.position.copy(camera.position);
      rig.lookAt(flightTarget);
      camera.quaternion.slerp(rig.quaternion, blend);
    }

    controls.target.copy(flightTarget);
  }

  function resumeFlight() {
    automatic = true;
    paused = false;

    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;
  }

  window.addEventListener("keydown", event => {
    if (
      event.target &&
      (event.target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName))
    ) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      if (!event.repeat) paused = !paused;
    }

    if (event.code === "KeyR" && !event.repeat) {
      resumeFlight();
    }

    if (event.code === "KeyH" && !event.repeat) {
      dom.panel.classList.toggle("is-hidden");
    }
  });

  function handleMotionPreference(event) {
    if (event.matches) {
      automatic = false;
      paused = true;
    }
  }

  if (motionPreference.addEventListener) {
    motionPreference.addEventListener("change", handleMotionPreference);
  } else {
    motionPreference.addListener(handleMotionPreference);
  }

  function updateInterface(whiteout) {
    const epochIndex = epochForZ(camera.position.z);

    if (epochIndex !== previousEpoch) {
      const epoch = epochs[epochIndex];

      dom.epochTitle.textContent = epoch.title;
      dom.epochAge.textContent = epoch.age;
      dom.epochDescription.textContent = epoch.description;

      for (let index = 0; index < dom.epochRows.length; index++) {
        const active = index === epochIndex;
        dom.epochRows[index].classList.toggle("active", active);

        if (active) {
          dom.epochRows[index].setAttribute("aria-current", "step");
        } else {
          dom.epochRows[index].removeAttribute("aria-current");
        }
      }

      previousEpoch = epochIndex;
    }

    const mode = paused
      ? "TIME PAUSED"
      : automatic
        ? "AUTOMATED FLIGHT"
        : "MANUAL EXPLORATION";

    if (mode !== previousMode) {
      dom.mode.textContent = mode;
      previousMode = mode;
    }

    const progress = clamp(cycleTime / CONFIG.travelDuration, 0, 1);
    const percentage = Math.round(progress * 100);

    dom.progressFill.style.transform = "scaleX(" + progress + ")";

    if (percentage !== previousProgress) {
      dom.progress.setAttribute("aria-valuenow", String(percentage));
      previousProgress = percentage;
    }

    const interfaceOpacity = 1 - smoothstep(0.45, 0.96, whiteout);

    dom.panel.style.opacity = String(interfaceOpacity);
    dom.overlay.style.opacity = String(interfaceOpacity);
  }

  function resize() {
    resizeId = 0;

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    if (pixelRatio !== currentPixelRatio) {
      renderer.setPixelRatio(pixelRatio);
      composer.setPixelRatio(pixelRatio);
      currentPixelRatio = pixelRatio;
    }

    renderer.setSize(width, height);
    composer.setSize(width, height);

    bloom.setSize(
      Math.round(width * pixelRatio * 0.7),
      Math.round(height * pixelRatio * 0.7)
    );

    fxaa.material.uniforms.resolution.value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio)
    );

    pointScaleUniform.value =
      height * pixelRatio
      / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  function queueResize() {
    if (!resizeId) {
      resizeId = requestAnimationFrame(resize);
    }
  }

  window.addEventListener("resize", queueResize, { passive: true });

  function animate(timestamp) {
    if (!running) return;

    const delta = lastTimestamp === null
      ? 0
      : Math.min((timestamp - lastTimestamp) / 1000, 0.05);

    lastTimestamp = timestamp;

    if (!paused) {
      animationTime += delta;

      if (automatic) {
        cycleTime += delta;

        if (cycleTime >= CONFIG.cycleDuration) {
          cycleTime -= CONFIG.cycleDuration;

          // Both sides of this reset are completely covered by white.
          placeFlightCamera(true);
        }
      }
    }

    if (automatic) {
      if (!paused) {
        placeFlightCamera(false, delta);
      }
    } else {
      controls.update();
    }

    timeUniform.value = animationTime;
    cameraZUniform.value = camera.position.z;

    const distanceToCore = camera.position.distanceTo(coreGroup.position);

    coreProximityUniform.value =
      1 - smoothstep(8, 105, distanceToCore);

    // Camera-dependent grading drives each particle's shader independently.
    redshiftUniform.value =
      0.82 + 0.18 * smoothstep(30, -340, camera.position.z);

    for (const spinner of spinners) {
      spinner.group.rotation.z =
        spinner.initial + animationTime * spinner.speed;
    }

    for (const planet of planets) {
      planet.group.rotation.y =
        planet.initial + animationTime * planet.speed;
    }

    coreGroup.rotation.z = animationTime * 0.028;

    const cmbDistance = Math.abs(camera.position.z + 324);

    cmbRevealUniform.value =
      0.97 * Math.pow(1 - clamp(cmbDistance / 30, 0, 1), 2);

    const entryWhite = 1 - smoothstep(0, 6, cycleTime);
    const finalWhite = smoothstep(137, 147, cycleTime);

    const whiteout = automatic
      ? Math.max(entryWhite, finalWhite)
      : 0;

    whiteoutUniform.value = whiteout;

    bloom.strength = 0.95 + coreProximityUniform.value * 0.35;
    grade.uniforms.uExposure.value =
      1.1 + coreProximityUniform.value * 0.12;

    streaks.visible = automatic && !paused;

    updateInterface(whiteout);
    composer.render(delta);

    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    if (pixelRatio !== currentPixelRatio) {
      queueResize();
    }

    animationId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    running = false;
    lastTimestamp = null;
    cancelAnimationFrame(animationId);
  }

  function startAnimation() {
    if (running || contextLost || document.hidden) return;

    running = true;
    lastTimestamp = null;
    animationId = requestAnimationFrame(animate);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });

  window.addEventListener("pagehide", stopAnimation);
  window.addEventListener("pageshow", startAnimation);

  renderer.domElement.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    contextLost = true;
    stopAnimation();

    showStatus(
      "The graphics context was interrupted. Waiting for the GPU to restore it."
    );
  });

  renderer.domElement.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    resize();
    dom.status.hidden = true;
    startAnimation();
  });

  try {
    resize();
    placeFlightCamera(true);
    controls.update();

    cameraZUniform.value = camera.position.z;
    updateInterface(0);

    renderer.compile(scene, camera);

    dom.status.hidden = true;
    startAnimation();
  } catch (error) {
    stopAnimation();
    showStatus("The visualization could not start: " + error.message);
  }
})();