/* script.js */
(() => {
  "use strict";

  /*
   * Physical reference values:
   * https://physics.nist.gov/cuu/Constants/Table/allascii.txt
   * https://www.nasa.gov/science-research/astrophysics/how-big-is-space-we-asked-a-nasa-expert-episode-61/
   *
   * Interpretation:
   * - The visual zoom multiplier is not a physical metre multiplier.
   * - More than 60 physical decades are compressed into six visual regimes.
   * - Hydrogen 2p lobes represent excited-state probability density.
   * - The central atomic torus is a separate 3d_z² schematic.
   * - Stringlike paths illustrate an 11D M-theory motif.
   * - S³ is a hypothetical boundaryless spatial geometry.
   * - Its mathematical embedding and the multiverse are speculative.
   */

  const dom = {
    container: document.getElementById("canvas-container"),
    status: document.getElementById("render-status"),
    panel: document.getElementById("info-panel"),
    overlay: document.getElementById("flight-overlay"),
    metric: document.getElementById("metric-value"),
    unknown: document.getElementById("unknown-scale"),
    coefficient: document.getElementById("metric-coefficient"),
    exponent: document.getElementById("metric-exponent"),
    zoom: document.getElementById("zoom-value"),
    regimeTitle: document.getElementById("regime-title"),
    regimeDescription: document.getElementById("regime-description"),
    equationHeading: document.getElementById("equation-heading"),
    equationValue: document.getElementById("equation-value"),
    equationCaption: document.getElementById("equation-caption"),
    rows: Array.from(document.querySelectorAll("[data-tier]")),
    nodeCount: document.getElementById("node-count"),
    flightState: document.getElementById("flight-state"),
    progress: document.getElementById("ascension-progress"),
    progressFill: document.getElementById("ascension-fill")
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
    background: 0x010105,
    fogDensity: 0.0012,
    ascentDuration: 120,
    cycleDuration: 144,
    maximumCoordinate: 5.1,
    visualOctavesPerTier: 4,
    planckLength: 1.616255e-35,
    bohrRadius: 5.29177210544e-11,
    observableDiameter: 92e9 * 9.4607304725808e15,
    seed: 35001126
  });

  const scene = new THREE.Scene();
  const labelScene = new THREE.Scene();

  scene.background = new THREE.Color(CONFIG.background).convertSRGBToLinear();
  scene.fog = new THREE.FogExp2(0x010105, 0.0012);
  scene.fog.color.convertSRGBToLinear();

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.035,
    2500
  );

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
    "A logarithmic scale journey through six cosmic regimes. Scroll during flight to change scale, drag to orbit, press Space to pause, R to resume, H to toggle the panel, and Home to restart."
  );

  dom.container.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0x9d94c5, 0.6));

  const keyLight = new THREE.DirectionalLight(0xffe1bd, 1.6);
  keyLight.position.set(30, 40, 55);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x6eabff, 0.8);
  fillLight.position.set(-35, -10, 25);
  scene.add(fillLight);

  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let automatic = !motionPreference.matches;
  let paused = motionPreference.matches;
  let stageTime = 0;
  let animationTime = 0;
  let scaleCoordinate = 0;
  let masterScaleMultiplier = 1;
  let hasLooped = false;
  let running = false;
  let contextLost = false;
  let animationId = 0;
  let lastTimestamp = null;
  let currentPixelRatio = 0;
  let resizeId = 0;
  let totalNodes = 0;
  let previousTier = -1;
  let previousMode = "";
  let previousProgress = -1;
  let readoutClock = 0;

  const timeUniform = { value: 0 };
  const coordinateUniform = { value: 0 };
  const pointScaleUniform = { value: 1 };
  const fogUniform = { value: CONFIG.fogDensity };
  const fadeUniform = { value: 0 };

  const gl = renderer.getContext();
  const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const pointMaximumUniform = {
    value: Math.min(80, pointRange[1])
  };

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
    return clamp(
      Math.sqrt(-2 * Math.log(u)) * Math.cos(random() * Math.PI * 2),
      -3,
      3
    );
  }

  function direction() {
    const y = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(1 - y * y);

    return new THREE.Vector3(
      Math.cos(angle) * radial,
      y,
      Math.sin(angle) * radial
    );
  }

  function color(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
  }

  const palette = {
    orange: color(0xff6b35),
    violet: color(0x9c58f5),
    pink: color(0xf27dbb),
    cyan: color(0x6de3ff),
    blue: color(0x659fff),
    emerald: color(0x69edb5),
    gold: color(0xe8c58b),
    pearl: color(0xf4f0e6),
    white: color(0xeaf5ff),
    red: color(0xd54532)
  };

  function mixColor(first, second, amount) {
    return first.clone().lerp(second, amount);
  }

  renderer.domElement.addEventListener("wheel", event => {
    if (!automatic) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const delta = event.deltaMode === 1
      ? event.deltaY * 16
      : event.deltaMode === 2
        ? event.deltaY * window.innerHeight
        : event.deltaY;

    stageTime = clamp(
      stageTime + delta * 0.025,
      0,
      CONFIG.ascentDuration
    );

    hasLooped = false;
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
  controls.minDistance = 0.5;
  controls.maxDistance = 750;
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

  const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: targetType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
    stencilBuffer: false
  });

  renderTarget.texture.generateMipmaps = false;

  const composer = new THREE.EffectComposer(renderer, renderTarget);
  composer.addPass(new THREE.RenderPass(scene, camera));

  const bloom = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.85,
    0.68,
    0.72
  );

  bloom.renderTargetBright.texture.type = targetType;

  for (const target of bloom.renderTargetsHorizontal) {
    target.texture.type = targetType;
  }

  for (const target of bloom.renderTargetsVertical) {
    target.texture.type = targetType;
  }

  composer.addPass(bloom);

  const grade = new THREE.ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: 1.08 },
      uFade: fadeUniform
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
      uniform float uFade;
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
        radiance *= 1.0 - 0.23 * dot(centered, centered);

        vec3 displayColor = linearToSRGB(filmic(radiance));
        displayColor += (hash(gl_FragCoord.xy) - 0.5) / 255.0;

        vec3 background = vec3(1.0, 1.0, 5.0) / 255.0;

        gl_FragColor = vec4(
          mix(clamp(displayColor, 0.0, 1.0), background, uFade),
          1.0
        );
      }
    `
  });

  composer.addPass(grade);

  const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
  composer.addPass(fxaa);

  function createRadialTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;

    const context = canvas.getContext("2d");

    if (!context) {
      throw new Error("Canvas textures are unavailable.");
    }

    const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.12, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.3, "rgba(255,255,255,0.36)");
    gradient.addColorStop(0.65, "rgba(255,255,255,0.045)");
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
    radialTexture = createRadialTexture();
  } catch (error) {
    showStatus(error.message);
    return;
  }

  const tiers = [];
  const labels = [];
  const rotatingObjects = [];
  const driftingGalaxies = [];

  function createTier(index, name) {
    const group = new THREE.Group();
    group.name = name;
    scene.add(group);

    const tier = {
      index,
      group,
      alpha: { value: 0 },
      rawWeight: 0,
      visualScale: 1,
      materialFades: []
    };

    tiers.push(tier);
    return tier;
  }

  for (let index = 0; index < 6; index++) {
    createTier(index, "Nested scale regime " + (index + 1));
  }

  function trackMaterial(tier, material, opacity) {
    tier.materialFades.push({ material, opacity });
    return material;
  }

  function builder() {
    return {
      positions: [],
      colors: [],
      sizes: [],
      opacities: [],
      phases: [],
      modes: []
    };
  }

  function addPoint(data, point, tint, size, opacity, mode = 0) {
    data.positions.push(point.x, point.y, point.z);
    data.colors.push(tint.r, tint.g, tint.b);
    data.sizes.push(size);
    data.opacities.push(opacity);
    data.phases.push(random() * Math.PI * 2);
    data.modes.push(mode);
  }

  const foamGLSL = `
    vec3 foamDisplacement(vec3 p, float t) {
      return vec3(
        sin(p.y * 0.67 + t * 0.85)
          + 0.38 * cos(p.z * 0.93 - t * 0.44),
        cos(p.z * 0.63 - t * 0.69)
          + 0.32 * sin(p.x * 0.87 + t * 0.53),
        sin(p.x * 0.71 + t * 0.61)
          + 0.35 * cos(p.y * 0.82 - t * 0.37)
      ) * 0.65;
    }
  `;

  function makePoints(tier, data, name, parent = tier.group) {
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
      "aPhase",
      new THREE.Float32BufferAttribute(data.phases, 1)
    );

    geometry.setAttribute(
      "aMode",
      new THREE.Float32BufferAttribute(data.modes, 1)
    );

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uCoordinate: coordinateUniform,
        uAlpha: tier.alpha,
        uTier: { value: tier.index },
        uPointScale: pointScaleUniform,
        uPointMaximum: pointMaximumUniform,
        uFogDensity: fogUniform,
        uSprite: { value: radialTexture }
      },

      vertexShader: `
        precision highp float;

        uniform float uTime;
        uniform float uCoordinate;
        uniform float uAlpha;
        uniform float uTier;
        uniform float uPointScale;
        uniform float uPointMaximum;

        attribute vec3 aColor;
        attribute float aSize;
        attribute float aOpacity;
        attribute float aPhase;
        attribute float aMode;

        varying vec3 vColor;
        varying float vOpacity;
        varying float vDepth;
        varying float vSoft;

        ${foamGLSL}

        void main() {
          vec3 displaced = position;

          if (aMode > 0.5 && aMode < 1.5) {
            displaced += foamDisplacement(position, uTime);
          }

          if (aMode > 1.5 && aMode < 2.5) {
            displaced += vec3(
              sin(uTime * 0.13 + aPhase),
              cos(uTime * 0.11 + aPhase * 1.3),
              sin(uTime * 0.09 + aPhase * 0.7)
            ) * 0.38;
          }

          if (aMode > 2.5 && aMode < 3.5) {
            displaced.z += sin(
              position.x * 0.21 + position.y * 0.17 + uTime * 0.24
            ) * 0.07;
          }

          vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);

          vDepth = max(0.01, -viewPosition.z);
          vColor = aColor;
          vSoft = aMode > 1.5 && aMode < 2.5 ? 1.0 : 0.0;

          if (uTier < 0.5) {
            float phase = 0.5 + 0.5 * sin(
              aPhase + uTime * 0.37 + uCoordinate * 1.7
            );

            vColor = mix(
              vec3(0.24, 0.035, 0.75),
              vec3(1.0, 0.17, 0.035),
              phase
            ) * 1.4;
          }

          if (uTier > 3.5 && uTier < 4.5) {
            float redness = smoothstep(3.65, 4.75, uCoordinate);

            vColor = mix(
              aColor,
              aColor * vec3(1.4, 0.24, 0.12)
                + vec3(0.22, 0.012, 0.004),
              redness * 0.8
            );
          }

          if (uTier > 4.5) {
            float iridescence = 0.5 + 0.5 * sin(
              aPhase + uTime * 0.16 + position.y * 0.03
            );

            vec3 pearl = mix(
              vec3(0.84, 0.63, 0.30),
              vec3(0.95, 0.98, 1.0),
              iridescence
            );

            vColor = mix(aColor, pearl, 0.78) * 1.45;
          }

          float shimmer = 0.87 + 0.13 * sin(uTime * 0.8 + aPhase * 4.0);
          vOpacity = aOpacity * uAlpha * shimmer;

          float worldScale = length(modelMatrix[0].xyz);

          gl_PointSize = clamp(
            aSize * worldScale * uPointScale / vDepth,
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
        varying float vDepth;
        varying float vSoft;

        void main() {
          vec2 centered = gl_PointCoord - 0.5;
          float profile = texture2D(uSprite, gl_PointCoord).a;

          float spike =
            exp(-abs(centered.x) * 120.0)
              * exp(-centered.y * centered.y * 20.0)
            + exp(-abs(centered.y) * 120.0)
              * exp(-centered.x * centered.x * 20.0);

          profile += spike * 0.08 * (1.0 - vSoft);

          float fog = exp(-pow(uFogDensity * vDepth, 2.0));
          float alpha = profile * vOpacity * fog;

          if (alpha < 0.0015) discard;

          float core = exp(-dot(centered, centered) * 105.0);

          gl_FragColor = vec4(
            vColor * (0.9 + core * 1.25),
            alpha
          );
        }
      `,

      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });

    const points = new THREE.Points(geometry, material);
    points.name = name;
    points.frustumCulled = false;
    parent.add(points);

    totalNodes += data.positions.length / 3;
    return points;
  }

  function makeLines(
    tier,
    positions,
    tint,
    opacity,
    kind = 0,
    parent = tier.group
  ) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uCoordinate: coordinateUniform,
        uAlpha: tier.alpha,
        uColor: { value: tint },
        uOpacity: { value: opacity },
        uKind: { value: kind },
        uFogDensity: fogUniform
      },

      vertexShader: `
        uniform float uTime;
        uniform float uKind;

        varying float vDepth;
        varying float vPhase;

        ${foamGLSL}

        void main() {
          vec3 displaced = position;
          vPhase = position.y;

          if (uKind > 0.5 && uKind < 1.5) {
            float t = position.x;
            float id = position.y;
            float radius = 5.8 + 0.23 * id;

            displaced = vec3(
              sin(t * 3.0 + uTime * 0.23 + id * 0.7),
              cos(t * 2.0 - uTime * 0.19 + id * 0.53),
              sin(t * 5.0 + uTime * 0.13 + id * 0.41) * 0.72
            ) * radius;
          }

          if (uKind > 1.5 && uKind < 2.5) {
            displaced += foamDisplacement(position, uTime);
          }

          vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
          vDepth = max(0.0, -viewPosition.z);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,

      fragmentShader: `
        uniform float uTime;
        uniform float uCoordinate;
        uniform float uAlpha;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uKind;
        uniform float uFogDensity;

        varying float vDepth;
        varying float vPhase;

        void main() {
          vec3 tint = uColor;

          if (uKind > 0.5 && uKind < 1.5) {
            float phase = 0.5 + 0.5 * sin(
              vPhase * 0.7 + uTime * 0.25
            );

            tint = mix(
              vec3(0.32, 0.08, 0.95),
              vec3(1.0, 0.32, 0.09),
              phase
            ) * 1.5;
          }

          float fog = exp(-pow(uFogDensity * vDepth, 2.0));

          gl_FragColor = vec4(
            tint,
            uOpacity * uAlpha * fog
          );
        }
      `,

      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });

    const lines = new THREE.LineSegments(geometry, material);
    lines.frustumCulled = false;
    parent.add(lines);
    return lines;
  }

  function glowMaterial(tier, firstColor, secondColor, opacity) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uAlpha: tier.alpha,
        uFirst: { value: firstColor },
        uSecond: { value: secondColor },
        uOpacity: { value: opacity },
        uFogDensity: fogUniform
      },

      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        varying float vDepth;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);

          vNormal = normalize(normalMatrix * normal);
          vView = -viewPosition.xyz;
          vLocal = position;
          vDepth = max(0.0, -viewPosition.z);

          gl_Position = projectionMatrix * viewPosition;
        }
      `,

      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform vec3 uFirst;
        uniform vec3 uSecond;
        uniform float uOpacity;
        uniform float uFogDensity;

        varying vec3 vNormal;
        varying vec3 vView;
        varying vec3 vLocal;
        varying float vDepth;

        void main() {
          float facing = abs(dot(
            normalize(vNormal),
            normalize(vView)
          ));

          float rim = pow(1.0 - facing, 2.4);
          float phase = 0.5 + 0.5 * sin(
            vLocal.y * 0.28 + uTime * 0.19 + facing * 4.0
          );

          vec3 tint = mix(uFirst, uSecond, phase);
          float fog = exp(-pow(uFogDensity * vDepth, 2.0));

          gl_FragColor = vec4(
            tint * (1.1 + rim * 0.8),
            (0.035 + rim * 0.5) * uOpacity * uAlpha * fog
          );
        }
      `,

      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
      toneMapped: false
    });
  }

  /*
   * TIER 1 — vibrating curves and a deformed quantum-foam grid.
   */
  const foam = builder();

  for (let x = -7; x <= 7; x++) {
    for (let y = -7; y <= 7; y++) {
      for (let z = -7; z <= 7; z++) {
        addPoint(
          foam,
          new THREE.Vector3(x * 0.8, y * 0.8, z * 0.8),
          mixColor(palette.orange, palette.violet, random()),
          0.075 + random() * 0.085,
          0.46,
          1
        );
      }
    }
  }

  makePoints(tiers[0], foam, "Roiling quantum-foam nodes");

  const foamLines = [];

  for (let first = -6; first <= 6; first += 3) {
    for (let second = -6; second <= 6; second += 3) {
      for (let segment = -7; segment < 7; segment++) {
        const a = segment * 0.8;
        const b = (segment + 1) * 0.8;

        foamLines.push(
          a, first * 0.8, second * 0.8,
          b, first * 0.8, second * 0.8,

          first * 0.8, a, second * 0.8,
          first * 0.8, b, second * 0.8,

          first * 0.8, second * 0.8, a,
          first * 0.8, second * 0.8, b
        );
      }
    }
  }

  makeLines(tiers[0], foamLines, palette.violet, 0.17, 2);

  const strings = [];

  for (let curve = 0; curve < 18; curve++) {
    for (let segment = 0; segment < 256; segment++) {
      strings.push(
        segment / 256 * Math.PI * 2, curve, 0,
        (segment + 1) / 256 * Math.PI * 2, curve, 0
      );
    }
  }

  makeLines(tiers[0], strings, palette.orange, 0.54, 1);

  /*
   * TIER 2 — hydrogen orbital motifs within a schematic rigid lattice.
   */
  const atomicGrid = [];

  for (let a = -1; a <= 1; a++) {
    for (let b = -1; b <= 1; b++) {
      atomicGrid.push(
        -9, a * 9, b * 9, 9, a * 9, b * 9,
        a * 9, -9, b * 9, a * 9, 9, b * 9,
        a * 9, b * 9, -9, a * 9, b * 9, 9
      );
    }
  }

  makeLines(tiers[1], atomicGrid, palette.cyan, 0.27);

  const nucleusGeometry = new THREE.SphereGeometry(0.16, 14, 10);

  const nucleusMaterial = trackMaterial(
    tiers[1],
    new THREE.MeshBasicMaterial({
      color: palette.white,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false
    }),
    0.95
  );

  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        const nucleus = new THREE.Mesh(nucleusGeometry, nucleusMaterial);
        nucleus.position.set(x * 9, y * 9, z * 9);
        tiers[1].group.add(nucleus);
      }
    }
  }

  const orbitalCenters = [
    new THREE.Vector3(9, 0, 0),
    new THREE.Vector3(-9, 0, 0),
    new THREE.Vector3(0, 9, 0),
    new THREE.Vector3(0, -9, 0),
    new THREE.Vector3(0, 0, 9),
    new THREE.Vector3(0, 0, -9)
  ];

  const lobeGeometry = new THREE.SphereGeometry(1, 64, 48);
  const positiveLobeMaterial = glowMaterial(
    tiers[1], palette.orange, palette.gold, 0.54
  );
  const negativeLobeMaterial = glowMaterial(
    tiers[1], palette.violet, palette.cyan, 0.54
  );

  const atomicPoints = builder();

  for (const orbitalCenter of orbitalCenters) {
    for (const sign of [-1, 1]) {
      const lobe = new THREE.Mesh(
        lobeGeometry,
        sign > 0 ? positiveLobeMaterial : negativeLobeMaterial
      );

      lobe.position.copy(orbitalCenter);
      lobe.position.y += sign * 1.85;
      lobe.scale.set(1.2, 2.0, 1.2);
      tiers[1].group.add(lobe);
    }

    for (let sample = 0; sample < 420; sample++) {
      let radius = 0;

      for (let factor = 0; factor < 5; factor++) {
        radius -= Math.log(Math.max(random(), 0.000001));
      }

      radius = Math.min(radius, 17) * 0.37;

      const cosine = (random() < 0.5 ? -1 : 1) * Math.cbrt(random());
      const sine = Math.sqrt(1 - cosine * cosine);
      const angle = random() * Math.PI * 2;

      const point = new THREE.Vector3(
        Math.cos(angle) * sine * radius,
        cosine * radius,
        Math.sin(angle) * sine * radius
      ).add(orbitalCenter);

      addPoint(
        atomicPoints,
        point,
        cosine > 0 ? palette.orange : palette.violet,
        0.055 + random() * 0.055,
        0.58
      );
    }
  }

  const centralOrbital = new THREE.Group();
  tiers[1].group.add(centralOrbital);

  for (const sign of [-1, 1]) {
    const lobe = new THREE.Mesh(lobeGeometry, positiveLobeMaterial);
    lobe.position.y = sign * 3.2;
    lobe.scale.set(1.7, 3.0, 1.7);
    centralOrbital.add(lobe);
  }

  const orbitalTorus = new THREE.Mesh(
    new THREE.TorusGeometry(2.55, 0.65, 48, 160),
    glowMaterial(tiers[1], palette.violet, palette.pink, 0.62)
  );

  orbitalTorus.rotation.x = Math.PI / 2;
  centralOrbital.add(orbitalTorus);

  for (let index = 0; index < 900; index++) {
    const angle = random() * Math.PI * 2;
    const ringSample = index % 3 === 0;
    let point;

    if (ringSample) {
      const radius = 2.55 + gaussian() * 0.3;

      point = new THREE.Vector3(
        Math.cos(angle) * radius,
        gaussian() * 0.35,
        Math.sin(angle) * radius
      );
    } else {
      const sign = index % 2 ? -1 : 1;

      point = new THREE.Vector3(
        gaussian() * 0.8,
        sign * (1.2 + random() * 4.8),
        gaussian() * 0.8
      );
    }

    addPoint(
      atomicPoints,
      point,
      ringSample ? palette.violet : palette.orange,
      0.065,
      0.56
    );
  }

  makePoints(tiers[1], atomicPoints, "Hydrogen orbital probability motifs");

  /*
   * TIER 3 — planetary point spheres, stellar clusters, and nebular gas.
   */
  const planetCenters = [
    new THREE.Vector3(-9, -3, 5),
    new THREE.Vector3(8, 4, 2),
    new THREE.Vector3(1, -6, -10)
  ];

  for (let planet = 0; planet < planetCenters.length; planet++) {
    const group = new THREE.Group();
    group.position.copy(planetCenters[planet]);
    tiers[2].group.add(group);

    const radius = [3.9, 3.1, 2.3][planet];
    const planetPoints = builder();

    const shellMaterial = trackMaterial(
      tiers[2],
      new THREE.MeshPhongMaterial({
        color: planet === 1 ? 0x6b4831 : 0x092c43,
        emissive: planet === 1 ? 0x100603 : 0x010812,
        specular: 0x809cb3,
        shininess: 28,
        transparent: true,
        opacity: 0,
        depthWrite: false
      }),
      0.82
    );

    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.997, 64, 48),
      shellMaterial
    ));

    for (let index = 0; index < 800; index++) {
      const normal = direction();

      const terrain =
        Math.sin(normal.x * 8 + Math.sin(normal.z * 7))
        * Math.cos(normal.y * 9 - normal.z * 3);

      let tint;

      if (planet === 1) {
        const bands = 0.5 + 0.5 * Math.sin(normal.y * 48);
        tint = mixColor(palette.orange, palette.gold, bands);
      } else {
        tint = terrain > 0.15
          ? mixColor(palette.emerald, palette.gold, random() * 0.18)
          : mixColor(palette.blue, palette.cyan, random() * 0.5);
      }

      addPoint(
        planetPoints,
        normal.multiplyScalar(radius),
        tint,
        0.085 + random() * 0.045,
        0.78
      );
    }

    makePoints(tiers[2], planetPoints, "Planetary surface point sphere", group);

    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.04, 48, 32),
      glowMaterial(
        tiers[2],
        planet === 1 ? palette.gold : palette.blue,
        palette.cyan,
        0.5
      )
    );

    group.add(atmosphere);

    if (planet === 1) {
      const ringPositions = [];

      for (let ring = 0; ring < 11; ring++) {
        const ringRadius = radius * 1.35 + ring * 0.13;

        for (let segment = 0; segment < 144; segment++) {
          const a = segment / 144 * Math.PI * 2;
          const b = (segment + 1) / 144 * Math.PI * 2;

          ringPositions.push(
            Math.cos(a) * ringRadius, Math.sin(a) * ringRadius * 0.38,
            Math.sin(a) * ringRadius * 0.92,
            Math.cos(b) * ringRadius, Math.sin(b) * ringRadius * 0.38,
            Math.sin(b) * ringRadius * 0.92
          );
        }
      }

      makeLines(tiers[2], ringPositions, palette.gold, 0.32, 0, group);
    }

    rotatingObjects.push({ group, speed: 0.08 + planet * 0.025 });
  }

  const neighborhood = builder();

  const clusterCenters = [
    new THREE.Vector3(-20, 12, -7),
    new THREE.Vector3(20, 10, -14),
    new THREE.Vector3(5, -17, 8)
  ];

  for (const center of clusterCenters) {
    for (let index = 0; index < 650; index++) {
      const point = direction()
        .multiplyScalar(4.5 * Math.pow(random(), 1.6))
        .add(center);

      addPoint(
        neighborhood,
        point,
        mixColor(palette.white, palette.blue, random()),
        0.085 + random() * 0.16,
        0.67
      );
    }
  }

  for (let index = 0; index < 1400; index++) {
    const angle = random() * Math.PI * 2;
    const radius = 9 + random() * 19;

    const point = new THREE.Vector3(
      Math.cos(angle) * radius,
      Math.sin(angle * 1.4) * 11 + gaussian() * 2,
      Math.sin(angle) * radius * 0.62 + gaussian() * 3
    );

    addPoint(
      neighborhood,
      point,
      index % 2
        ? mixColor(palette.violet, palette.pink, random())
        : mixColor(palette.blue, palette.emerald, random()),
      1.5 + random() * 3.2,
      0.023 + random() * 0.018,
      2
    );
  }

  for (let index = 0; index < 1200; index++) {
    addPoint(
      neighborhood,
      direction().multiplyScalar(12 + random() * 35),
      mixColor(palette.white, palette.cyan, random() * 0.5),
      0.08 + random() * 0.12,
      0.45
    );
  }

  makePoints(tiers[2], neighborhood, "Local stellar and nebular volume");

  /*
   * TIER 4 — logarithmic spiral galaxies.
   */
  const galaxyCenters = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(-26, 13, -9),
    new THREE.Vector3(28, -12, -7),
    new THREE.Vector3(-16, -22, 10),
    new THREE.Vector3(20, 22, -16)
  ];

  for (let galaxy = 0; galaxy < galaxyCenters.length; galaxy++) {
    const group = new THREE.Group();
    group.position.copy(galaxyCenters[galaxy]);
    group.rotation.x = galaxy === 0 ? 0.22 : (random() - 0.5) * 1.2;
    tiers[3].group.add(group);

    const data = builder();
    const radiusMaximum = galaxy === 0 ? 18 : 9 + random() * 5;
    const initialRadius = 0.24;
    const spiralGrowth = 0.30;
    const thetaMaximum = Math.log(radiusMaximum / initialRadius) / spiralGrowth;
    const arms = galaxy % 2 ? 3 : 4;

    for (let index = 0; index < 1800; index++) {
      let point;
      let tint;

      if (index < 320) {
        point = direction().multiplyScalar(
          2.3 * Math.pow(random(), 1.8)
        );
        point.z *= 0.5;
        tint = mixColor(palette.gold, palette.white, random() * 0.7);
      } else {
        const u = Math.pow(random(), 0.46);
        const theta = u * thetaMaximum;
        const radius = initialRadius * Math.exp(spiralGrowth * theta);
        const angle =
          theta + index % arms * Math.PI * 2 / arms
          + gaussian() * 0.045;

        point = new THREE.Vector3(
          Math.cos(angle) * radius + gaussian() * 0.2,
          Math.sin(angle) * radius + gaussian() * 0.2,
          gaussian() * (0.1 + radius * 0.018)
        );

        tint = mixColor(
          palette.gold,
          index % 9 ? palette.blue : palette.pink,
          u
        );
      }

      addPoint(
        data,
        point,
        tint,
        0.09 + random() * 0.14,
        0.72,
        3
      );
    }

    makePoints(tiers[3], data, "Logarithmic spiral galaxy", group);

    driftingGalaxies.push({
      group,
      origin: galaxyCenters[galaxy].clone(),
      speed: galaxy % 2 ? -0.026 : 0.021,
      phase: random() * Math.PI * 2,
      central: galaxy === 0
    });
  }

  /*
   * TIER 5 — a connected filament network with dense particle sampling.
   */
  const anchors = [];

  for (let index = 0; index < 160; index++) {
    anchors.push(
      direction().multiplyScalar(27 * Math.cbrt(random()))
    );
  }

  const edgeKeys = new Set();
  const webEdges = [];

  function addWebEdge(first, second) {
    const a = Math.min(first, second);
    const b = Math.max(first, second);
    const key = a + ":" + b;

    if (a === b || edgeKeys.has(key)) return;

    edgeKeys.add(key);
    webEdges.push([a, b]);
  }

  for (let index = 0; index < anchors.length; index++) {
    const nearest = [];

    for (let other = 0; other < anchors.length; other++) {
      if (index === other) continue;

      nearest.push({
        index: other,
        distance: anchors[index].distanceToSquared(anchors[other])
      });
    }

    nearest.sort((a, b) => a.distance - b.distance);

    for (let neighbor = 0; neighbor < 3; neighbor++) {
      addWebEdge(index, nearest[neighbor].index);
    }
  }

  // A nearest-to-existing spanning tree guarantees global connectivity.
  const connected = new Set([0]);

  while (connected.size < anchors.length) {
    let bestFirst = -1;
    let bestSecond = -1;
    let bestDistance = Infinity;

    for (const first of connected) {
      for (let second = 0; second < anchors.length; second++) {
        if (connected.has(second)) continue;

        const distance = anchors[first].distanceToSquared(anchors[second]);

        if (distance < bestDistance) {
          bestDistance = distance;
          bestFirst = first;
          bestSecond = second;
        }
      }
    }

    addWebEdge(bestFirst, bestSecond);
    connected.add(bestSecond);
  }

  const webPoints = builder();
  const webLines = [];

  for (const edge of webEdges) {
    const first = anchors[edge[0]];
    const second = anchors[edge[1]];
    const difference = second.clone().sub(first);
    const bend = direction().multiplyScalar(1.2);

    const curve = new THREE.CubicBezierCurve3(
      first.clone(),
      first.clone().addScaledVector(difference, 0.33).add(bend),
      first.clone().addScaledVector(difference, 0.67).add(bend),
      second.clone()
    );

    const samples = curve.getPoints(18);

    for (let sample = 0; sample < samples.length - 1; sample++) {
      samples[sample].toArray(webLines, webLines.length);
      samples[sample + 1].toArray(webLines, webLines.length);
    }

    for (let sample = 0; sample < 46; sample++) {
      const point = curve.getPoint(random());

      point.add(new THREE.Vector3(
        gaussian() * 0.17,
        gaussian() * 0.17,
        gaussian() * 0.17
      ));

      addPoint(
        webPoints,
        point,
        mixColor(palette.cyan, palette.gold, random() * 0.6),
        0.07 + random() * 0.12,
        0.56
      );
    }
  }

  for (const anchor of anchors) {
    for (let index = 0; index < 8; index++) {
      const point = anchor.clone().add(
        direction().multiplyScalar(random() * 0.55)
      );

      addPoint(
        webPoints,
        point,
        mixColor(palette.white, palette.gold, random()),
        0.13 + random() * 0.13,
        0.85
      );
    }
  }

  makePoints(tiers[4], webPoints, "Observable cosmic web particle network");
  makeLines(tiers[4], webLines, palette.red, 0.23);

  /*
   * TIER 6 — a hypothetical S³ projection, not a measured universe shape.
   */
  const universe = new THREE.Group();
  tiers[5].group.add(universe);

  const primaryRadius = 24;
  const sphereGeometry = new THREE.SphereGeometry(primaryRadius, 72, 48);
  const wireGeometry = new THREE.WireframeGeometry(sphereGeometry);

  makeLines(
    tiers[5],
    wireGeometry.attributes.position.array,
    palette.gold,
    0.19,
    0,
    universe
  );

  wireGeometry.dispose();

  universe.add(new THREE.Mesh(
    sphereGeometry,
    glowMaterial(tiers[5], palette.gold, palette.pearl, 0.54)
  ));

  /*
   * Orthographic projections of circles on S³:
   * (cosη cosξ, cosη sinξ, sinη cos(ξ+φ), sinη sin(ξ+φ)).
   * A slow rotation mixes the first and fourth embedding coordinates.
   */
  const projectionPositions = [];
  const projectionW = [];

  for (let circle = 0; circle < 28; circle++) {
    const eta = (circle + 0.5) / 28 * Math.PI / 2;
    const phase = circle * Math.PI * (3 - Math.sqrt(5));

    for (let segment = 0; segment < 160; segment++) {
      for (let endpoint = 0; endpoint < 2; endpoint++) {
        const angle = (segment + endpoint) / 160 * Math.PI * 2;

        projectionPositions.push(
          primaryRadius * Math.cos(eta) * Math.cos(angle),
          primaryRadius * Math.cos(eta) * Math.sin(angle),
          primaryRadius * Math.sin(eta) * Math.cos(angle + phase)
        );

        projectionW.push(
          primaryRadius * Math.sin(eta) * Math.sin(angle + phase)
        );
      }
    }
  }

  const projectionGeometry = new THREE.BufferGeometry();

  projectionGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(projectionPositions, 3)
  );

  projectionGeometry.setAttribute(
    "aW",
    new THREE.Float32BufferAttribute(projectionW, 1)
  );

  const projection = new THREE.LineSegments(
    projectionGeometry,
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uAlpha: tiers[5].alpha,
        uFogDensity: fogUniform
      },

      vertexShader: `
        uniform float uTime;
        attribute float aW;

        varying float vDepth;
        varying float vPhase;

        void main() {
          float angle = uTime * 0.027;
          float x = position.x * cos(angle) - aW * sin(angle);

          vec3 projected = vec3(x, position.y, position.z);
          vec4 viewPosition = modelViewMatrix * vec4(projected, 1.0);

          vDepth = max(0.0, -viewPosition.z);
          vPhase = aW * 0.06 + position.y * 0.045;

          gl_Position = projectionMatrix * viewPosition;
        }
      `,

      fragmentShader: `
        uniform float uTime;
        uniform float uAlpha;
        uniform float uFogDensity;

        varying float vDepth;
        varying float vPhase;

        void main() {
          float blend = 0.5 + 0.5 * sin(vPhase + uTime * 0.14);

          vec3 color = mix(
            vec3(0.95, 0.64, 0.25),
            vec3(0.89, 0.96, 1.0),
            blend
          );

          float fog = exp(-pow(uFogDensity * vDepth, 2.0));

          gl_FragColor = vec4(
            color * 1.7,
            uAlpha * 0.35 * fog
          );
        }
      `,

      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  projection.frustumCulled = false;
  universe.add(projection);

  const bulk = builder();

  for (let index = 0; index < 2600; index++) {
    const point = direction().multiplyScalar(
      32 + Math.pow(random(), 0.65) * 260
    );

    addPoint(
      bulk,
      point,
      mixColor(
        index % 3 === 0 ? palette.violet : palette.gold,
        palette.pearl,
        random()
      ),
      0.13 + random() * 0.28,
      0.20 + random() * 0.33,
      2
    );
  }

  makePoints(tiers[5], bulk, "Speculative bulk hyperspace dust");

  const interior = builder();

  for (let index = 0; index < 640; index++) {
    addPoint(
      interior,
      direction().multiplyScalar(
        primaryRadius * 0.94 * Math.cbrt(random())
      ),
      mixColor(palette.gold, palette.pearl, random()),
      0.12 + random() * 0.15,
      0.48
    );
  }

  makePoints(tiers[5], interior, "Local S3 projection interior", universe);

  const alternateCenters = [
    new THREE.Vector3(-90, 25, -115),
    new THREE.Vector3(95, -24, -150),
    new THREE.Vector3(20, 82, -205),
    new THREE.Vector3(-145, -70, -225),
    new THREE.Vector3(150, 65, -280),
    new THREE.Vector3(-35, -110, -310)
  ];

  for (let index = 0; index < alternateCenters.length; index++) {
    const group = new THREE.Group();
    group.position.copy(alternateCenters[index]);
    tiers[5].group.add(group);

    const radius = 10 + index * 2.2;
    const geometry = new THREE.SphereGeometry(radius, 32, 22);
    const wire = new THREE.WireframeGeometry(geometry);

    makeLines(
      tiers[5],
      wire.attributes.position.array,
      mixColor(palette.gold, palette.violet, index / 10),
      0.055,
      0,
      group
    );

    group.add(new THREE.Mesh(
      geometry,
      glowMaterial(tiers[5], palette.gold, palette.pearl, 0.12)
    ));

    wire.dispose();

    rotatingObjects.push({
      group,
      speed: 0.009 + index * 0.0015
    });
  }

  /*
   * Readable canvas-textured labels anchored to their corresponding tiers.
   * Screen-size stabilization prevents labels exploding during transitions.
   */
  function createLabel(tier, title, lineOne, lineTwo, anchor, tint) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 300;

    const context = canvas.getContext("2d");

    if (!context) return;

    const background = context.createLinearGradient(0, 0, 1200, 0);
    background.addColorStop(0, "rgba(3,3,13,0.92)");
    background.addColorStop(0.86, "rgba(3,3,13,0.8)");
    background.addColorStop(1, "rgba(3,3,13,0.16)");

    context.fillStyle = background;
    context.fillRect(0, 0, 1200, 300);

    context.strokeStyle = "rgba(178,190,222,0.3)";
    context.lineWidth = 2;
    context.strokeRect(1, 1, 1198, 298);

    context.fillStyle = tint;
    context.fillRect(0, 0, 5, 300);

    context.font = "500 43px Consolas, Menlo, monospace";
    context.fillText(title, 34, 75, 1120);

    context.fillStyle = "#d6deec";
    context.font = "37px Georgia, serif";
    context.fillText(lineOne, 35, 164, 1120);

    context.fillStyle = "#94a4bd";
    context.font = "29px Consolas, Menlo, monospace";
    context.fillText(lineTwo, 35, 241, 1120);

    const texture = new THREE.CanvasTexture(canvas);
    texture.encoding = THREE.LinearEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: false,
      fog: false,
      toneMapped: false
    }));

    labelScene.add(sprite);

    labels.push({
      tier,
      sprite,
      anchor: new THREE.Vector3(anchor[0], anchor[1], anchor[2]),
      aspect: 4
    });
  }

  createLabel(
    tiers[0],
    "Planck Length: 1.6 × 10⁻³⁵ m",
    "11D M-theory motif · projected geometry",
    "Stringlike curves and quantum foam are conceptual.",
    [11, 9, 4],
    "#d59aff"
  );

  createLabel(
    tiers[1],
    "Bohr Radius: 5.3 × 10⁻¹¹ m",
    "Hydrogen: excited 2p probability lobes",
    "Central torus and lobes: a separate 3d_z² schematic.",
    [13, 12, 5],
    "#a1dbff"
  );

  createLabel(
    tiers[2],
    "Macro Neighborhood",
    "Planets · star clusters · interstellar nebulae",
    "A scale montage with normalized visual sizes.",
    [18, 17, 4],
    "#8eeaca"
  );

  createLabel(
    tiers[3],
    "The Galactic Swirl",
    "Logarithmic spiral: r = a exp(bθ)",
    "Rotating stellar disks within a larger hierarchy.",
    [19, 18, 5],
    "#adcfff"
  );

  createLabel(
    tiers[4],
    "Observable Universe: ≈92 Gly",
    "Diameter · ≈46 Gly radius",
    "Present-day proper distances; total size unknown.",
    [22, 20, 6],
    "#ffc5a6"
  );

  createLabel(
    tiers[5],
    "Bulk Hyperspace Boundary",
    "Outside Local S³ · speculative embedding",
    "S³ has no physical edge; bulk scale is unknown.",
    [24, 24, 7],
    "#ead8af"
  );

  dom.nodeCount.textContent = totalNodes.toLocaleString("en-US");

  const regimes = [
    {
      title: "The Planck basement",
      description: "Vibrating curves and a roiling particle grid illustrate quantum geometry.",
      heading: "NATURAL QUANTUM-GRAVITY SCALE",
      equation: "ℓ<sub>P</sub> = √(ℏG/c<sup>3</sup>)",
      caption: "A characteristic scale, not an established smallest length."
    },
    {
      title: "The atomic lattice",
      description: "Excited hydrogen orbital motifs emerge inside a schematic molecular framework.",
      heading: "CHARACTERISTIC ATOMIC LENGTH",
      equation: "a<sub>0</sub> = 4πε<sub>0</sub>ℏ<sup>2</sup> / (m<sub>e</sub>e<sup>2</sup>)",
      caption: "Opposite lobe colors indicate orbital phase, not negative probability."
    },
    {
      title: "The macro neighborhood",
      description: "Planetary surfaces, dense stellar clusters, and translucent interstellar gas share the view.",
      heading: "PLANETARY TO INTERSTELLAR SCALES",
      equation: "1 AU ≈ 1.496 × 10<sup>11</sup> m",
      caption: "Planet and nebula motifs are normalized within this visual montage."
    },
    {
      title: "The galactic swirl",
      description: "Spiral galaxies rotate and drift outward as their surrounding hierarchy becomes visible.",
      heading: "LOGARITHMIC SPIRAL",
      equation: "r(θ) = a e<sup>bθ</sup>",
      caption: "A procedural geometric model of spiral structure."
    },
    {
      title: "The cosmic web hierarchy",
      description: "Galaxy-scale detail condenses into interconnected filaments spanning an observable patch.",
      heading: "OBSERVABLE PATCH",
      equation: "D<sub>obs</sub> ≈ 92 Gly",
      caption: "Approximately 46 Gly in radius; this is not the full universe’s measured size."
    },
    {
      title: "Hypersphere / speculative bulk",
      description: "A slowly turning globe and projected S³ circles form a hypothetical external embedding view.",
      heading: "SPATIAL S³ EMBEDDED IN ℝ⁴",
      equation: "x<sub>1</sub><sup>2</sup> + x<sub>2</sub><sup>2</sup> + x<sub>3</sub><sup>2</sup> + x<sub>4</sub><sup>2</sup> = R<sup>2</sup>",
      caption: "Three-dimensional, finite, and boundaryless. R and any physical bulk are unknown."
    }
  ];

  const metricAnchors = [
    Math.log10(CONFIG.planckLength),
    Math.log10(CONFIG.bohrRadius),
    13,
    21,
    Math.log10(CONFIG.observableDiameter)
  ];

  const cameraDestination = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const zero = new THREE.Vector3();
  const cameraRig = new THREE.PerspectiveCamera();
  cameraRig.up.copy(camera.up);

  function cameraPose(coordinate, time, result) {
    const azimuth = 0.64 + Math.sin(time * 0.015) * 0.18;
    const elevation = 0.30 + Math.cos(time * 0.018) * 0.045;

    const portraitScale = Math.max(
      1,
      0.78 / Math.max(0.1, camera.aspect)
    );

    const distance = (58 + coordinate * 5.0) * portraitScale;

    return result.set(
      Math.sin(azimuth) * Math.cos(elevation) * distance,
      Math.sin(elevation) * distance,
      Math.cos(azimuth) * Math.cos(elevation) * distance
    );
  }

  function updateScaleEngine() {
    scaleCoordinate = CONFIG.maximumCoordinate * clamp(
      stageTime / CONFIG.ascentDuration,
      0,
      1
    );

    coordinateUniform.value = scaleCoordinate;

    masterScaleMultiplier = Math.exp(
      Math.LN2 * CONFIG.visualOctavesPerTier * scaleCoordinate
    );

    let weightSum = 0;

    for (const tier of tiers) {
      const entrance = tier.index === 0
        ? 1
        : smoothstep(
          tier.index - 0.85,
          tier.index - 0.18,
          scaleCoordinate
        );

      const departure = tier.index === 5
        ? 1
        : 1 - smoothstep(
          tier.index + 0.72,
          tier.index + 1.25,
          scaleCoordinate
        );

      tier.rawWeight = entrance * departure;
      weightSum += tier.rawWeight;
    }

    for (const tier of tiers) {
      tier.alpha.value = tier.rawWeight / Math.max(1, weightSum);
      tier.group.visible = tier.rawWeight > 0.0001;

      /*
       * All tiers use the same master multiplier.
       * Local coordinates remain small; physical metre magnitudes never
       * enter the GPU's single-precision coordinate system.
       */
      tier.visualScale =
        Math.pow(2, CONFIG.visualOctavesPerTier * tier.index)
        / masterScaleMultiplier;

      tier.group.scale.setScalar(tier.visualScale);

      for (const entry of tier.materialFades) {
        entry.material.opacity = entry.opacity * tier.alpha.value;
      }
    }
  }

  function updateCamera(delta, immediate = false) {
    if (!automatic && !immediate) {
      controls.update();
      lookTarget.copy(controls.target);
      return;
    }

    if (paused && !immediate) return;

    cameraPose(scaleCoordinate, animationTime, cameraDestination);

    if (immediate) {
      camera.position.copy(cameraDestination);
      lookTarget.set(0, 0, 0);
      camera.lookAt(zero);
    } else {
      const blend = 1 - Math.exp(-2.4 * delta);
      camera.position.lerp(cameraDestination, blend);
      lookTarget.lerp(zero, blend);

      cameraRig.position.copy(camera.position);
      cameraRig.lookAt(lookTarget);
      camera.quaternion.slerp(cameraRig.quaternion, blend);
    }

    controls.target.copy(lookTarget);
  }

  function updateLabels(fade) {
    const pixelWidth = clamp(window.innerWidth * 0.21, 200, 330);

    const scalePerPixel =
      2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
      / Math.max(1, window.innerHeight);

    for (const tier of tiers) {
      tier.group.updateMatrixWorld(true);
    }

    for (const label of labels) {
      label.sprite.position.copy(label.anchor)
        .applyMatrix4(label.tier.group.matrixWorld);

      const distance = camera.position.distanceTo(label.sprite.position);
      const nearFade = smoothstep(4, 12, distance);
      const farFade = 1 - smoothstep(240, 500, distance);

      label.sprite.material.opacity =
        label.tier.alpha.value * nearFade * farFade * (1 - fade);

      label.sprite.visible =
        label.tier.group.visible &&
        label.sprite.material.opacity > 0.075;

      const width = pixelWidth * scalePerPixel;

      label.sprite.scale.set(
        width,
        width / label.aspect,
        1
      );
    }
  }

  function updateInterface(delta, fade) {
    let activeTier = 0;
    let strongest = -1;

    for (const tier of tiers) {
      if (tier.alpha.value > strongest) {
        strongest = tier.alpha.value;
        activeTier = tier.index;
      }
    }

    if (activeTier !== previousTier) {
      const regime = regimes[activeTier];

      dom.regimeTitle.textContent = regime.title;
      dom.regimeDescription.textContent = regime.description;
      dom.equationHeading.textContent = regime.heading;
      dom.equationValue.innerHTML = regime.equation;
      dom.equationCaption.textContent = regime.caption;

      for (let index = 0; index < dom.rows.length; index++) {
        const active = index === activeTier;
        dom.rows[index].classList.toggle("active", active);

        if (active) {
          dom.rows[index].setAttribute("aria-current", "step");
        } else {
          dom.rows[index].removeAttribute("aria-current");
        }
      }

      previousTier = activeTier;
    }

    readoutClock += delta;

    if (readoutClock >= 0.10 || delta === 0) {
      readoutClock = 0;

      const speculative = scaleCoordinate >= 4.65;
      dom.metric.hidden = speculative;
      dom.unknown.hidden = !speculative;

      if (!speculative) {
        const cursor = Math.min(scaleCoordinate, 4);
        const lower = Math.min(3, Math.floor(cursor));
        const fraction = cursor - lower;

        const exponent =
          metricAnchors[lower]
          + (metricAnchors[lower + 1] - metricAnchors[lower]) * fraction;

        const integerExponent = Math.floor(exponent);
        const coefficient = Math.pow(10, exponent - integerExponent);

        dom.coefficient.textContent = coefficient.toFixed(2);
        dom.exponent.textContent = String(integerExponent).replace("-", "−");
      }

      dom.zoom.textContent = masterScaleMultiplier < 10000
        ? "×" + masterScaleMultiplier.toFixed(2)
        : "×10^" + Math.log10(masterScaleMultiplier).toFixed(2);
    }

    const mode = paused
      ? "TIME PAUSED"
      : automatic
        ? "AUTOMATED ASCENSION"
        : "MANUAL EXPLORATION";

    if (mode !== previousMode) {
      dom.flightState.textContent = mode;
      previousMode = mode;
    }

    const progress = scaleCoordinate / CONFIG.maximumCoordinate;
    const percent = Math.round(progress * 100);

    dom.progressFill.style.transform = "scaleX(" + progress + ")";

    if (percent !== previousProgress) {
      dom.progress.setAttribute("aria-valuenow", String(percent));
      previousProgress = percent;
    }

    dom.panel.style.opacity = String(1 - fade);
    dom.overlay.style.opacity = String(1 - fade);
  }

  function resumeFlight() {
    automatic = true;
    paused = false;

    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;

    lookTarget.copy(controls.target);
  }

  function restart() {
    stageTime = 0;
    animationTime = 0;
    hasLooped = false;
    paused = motionPreference.matches;
    automatic = !motionPreference.matches;

    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;

    updateScaleEngine();
    updateCamera(0, true);
    updateLabels(0);
    updateInterface(0, 0);
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

    if (event.code === "Home" && !event.repeat) {
      event.preventDefault();
      restart();
    }
  });

  function handleMotionPreference(event) {
    if (event.matches) {
      paused = true;
      automatic = false;
    }
  }

  if (motionPreference.addEventListener) {
    motionPreference.addEventListener("change", handleMotionPreference);
  } else {
    motionPreference.addListener(handleMotionPreference);
  }

  function resize() {
    resizeId = 0;

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    camera.aspect = width / height;
    camera.clearViewOffset();

    if (width >= 900) {
      camera.setViewOffset(
        width,
        height,
        -Math.min(135, width * 0.095),
        0,
        width,
        height
      );
    }

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
        stageTime += delta;

        if (stageTime >= CONFIG.cycleDuration) {
          stageTime -= CONFIG.cycleDuration;
          hasLooped = true;
          updateScaleEngine();
          updateCamera(0, true);
        }
      }
    }

    timeUniform.value = animationTime;
    updateScaleEngine();
    updateCamera(delta);

    for (const object of rotatingObjects) {
      object.group.rotation.y = animationTime * object.speed;
    }

    for (const galaxy of driftingGalaxies) {
      galaxy.group.rotation.z = galaxy.phase + animationTime * galaxy.speed;

      const outward = galaxy.central
        ? 1
        : 1 + 18 * smoothstep(3.25, 3.95, scaleCoordinate);

      galaxy.group.position.copy(galaxy.origin).multiplyScalar(outward);
    }

    universe.rotation.y = animationTime * 0.024;
    universe.rotation.z = Math.sin(animationTime * 0.018) * 0.07;

    const entryFade = hasLooped
      ? 1 - smoothstep(0, 5, stageTime)
      : 0;

    const departureFade = smoothstep(136, 144, stageTime);

    const fade = automatic
      ? Math.max(entryFade, departureFade)
      : 0;

    fadeUniform.value = fade;

    bloom.strength =
      0.85 + smoothstep(4.3, 5.1, scaleCoordinate) * 0.1;

    updateLabels(fade);
    updateInterface(delta, fade);

    composer.render(delta);

    // Labels bypass bloom so small scientific notation remains readable.
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(labelScene, camera);
    renderer.autoClear = true;

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
    restart();
    controls.update();

    renderer.compile(scene, camera);
    renderer.compile(labelScene, camera);

    dom.status.hidden = true;
    startAnimation();
  } catch (error) {
    stopAnimation();
    showStatus("The visualization could not start: " + error.message);
  }
})();