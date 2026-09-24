/* script.js */
(() => {
  "use strict";

  /*
   * Scientific references:
   * https://arxiv.org/pdf/1709.07024 — bosonic 11D supergravity action.
   * https://arxiv.org/pdf/hep-th/9608117 — M2/M5 worldvolumes and tensions.
   * https://arxiv.org/pdf/1206.6699 — M-theory/type IIA scale relations.
   *
   * The scene is a procedural geometric illustration.
   * The displayed M5 is a two-dimensional spatial slice.
   * Flux curves illustrate a four-form through a schematic projection.
   * The normalized tension matrix is a display convention.
   */

  const container = document.getElementById("canvas-container");
  const statusElement = document.getElementById("render-status");
  const flightStateElement = document.getElementById("flight-state");
  const progressElement = document.getElementById("flight-progress");
  const panelElement = document.getElementById("info-panel");

  function showStatus(message) {
    statusElement.textContent = message;
    statusElement.hidden = false;
  }

  function clearStatus() {
    statusElement.hidden = true;
    statusElement.textContent = "";
  }

  const requiredComponents = [
    "WebGLRenderer",
    "OrbitControls",
    "EffectComposer",
    "RenderPass",
    "ShaderPass",
    "UnrealBloomPass",
    "FXAAShader"
  ];

  if (!window.THREE) {
    showStatus("The Three.js library could not load. Check the connection and reload.");
    return;
  }

  for (const component of requiredComponents) {
    if (!THREE[component]) {
      showStatus("A rendering component could not load: " + component + ". Reload to retry.");
      return;
    }
  }

  const CONFIG = Object.freeze({
    background: 0x020208,
    fogDensity: 0.002,
    segments: 224,
    terrainWidth: 220,
    m2Height: 144,
    m5Height: 110,
    tilt: Math.PI / 3,
    trackCount: 32,
    nodesPerTrack: 192,
    junctionCount: 1024,
    flightDuration: 180,
    timeScale: 0.28
  });

  const SIN_TILT = Math.sin(CONFIG.tilt);
  const COS_TILT = Math.cos(CONFIG.tilt);

  const scene = new THREE.Scene();
  const labelScene = new THREE.Scene();

  scene.background = new THREE.Color(CONFIG.background).convertSRGBToLinear();
  scene.fog = new THREE.FogExp2(0x020208, 0.002);
  scene.fog.color.convertSRGBToLinear();

  const camera = new THREE.PerspectiveCamera(
    52,
    window.innerWidth / Math.max(1, window.innerHeight),
    0.035,
    1400
  );

  // In the terrain coordinates, Z is the vertical direction.
  camera.up.set(0, 0, 1);

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
    showStatus("WebGL could not start on this device: " + error.message);
    return;
  }

  const hasDerivatives =
    renderer.capabilities.isWebGL2 ||
    Boolean(renderer.extensions.get("OES_standard_derivatives"));

  if (!hasDerivatives) {
    renderer.dispose();
    showStatus("This visualization requires WebGL support for screen-space derivatives.");
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.LinearEncoding;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(scene.background, 1);

  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("role", "img");
  renderer.domElement.setAttribute(
    "aria-label",
    "Animated M-theory terrain. Drag to explore, scroll to zoom, press Space to pause, R to resume flight, and H to hide the scientific panel."
  );

  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.rotateSpeed = 0.42;
  controls.zoomSpeed = 0.72;
  controls.panSpeed = 0.55;
  controls.screenSpacePanning = true;
  controls.minDistance = 0.6;
  controls.maxDistance = 420;
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

  renderer.domElement.addEventListener("pointerdown", () => {
    renderer.domElement.focus({ preventScroll: true });
  });

  renderer.domElement.addEventListener("contextmenu", event => {
    event.preventDefault();
  });

  function linearColor(hex) {
    return new THREE.Color(hex).convertSRGBToLinear();
  }

  scene.add(new THREE.AmbientLight(0x9baed9, 0.4));

  const keyLight = new THREE.DirectionalLight(0xffdeb0, 1.8);
  keyLight.position.set(-35, -20, 100);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x239fff, 2.2, 160, 2);
  rimLight.position.set(45, -10, 45);
  scene.add(rimLight);

  /*
   * The scene is rendered into a linear target, bloomed, tone-mapped,
   * converted to sRGB, and then antialiased.
   */
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
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(window.innerWidth, window.innerHeight);

  const renderPass = new THREE.RenderPass(scene, camera);
  composer.addPass(renderPass);

  const bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.92,
    0.68,
    0.7
  );

  bloomPass.renderTargetBright.texture.type = targetType;

  for (const target of bloomPass.renderTargetsHorizontal) {
    target.texture.type = targetType;
  }

  for (const target of bloomPass.renderTargetsVertical) {
    target.texture.type = targetType;
  }

  composer.addPass(bloomPass);

  const gradePass = new THREE.ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uExposure: { value: 1.12 },
      uFrame: { value: 0 }
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
      uniform float uFrame;
      varying vec2 vUv;

      vec3 filmic(vec3 x) {
        const float a = 2.51;
        const float b = 0.03;
        const float c = 2.43;
        const float d = 0.59;
        const float e = 0.14;

        return clamp(
          (x * (a * x + b)) / (x * (c * x + d) + e),
          0.0,
          1.0
        );
      }

      vec3 linearToSRGB(vec3 color) {
        vec3 low = color * 12.92;
        vec3 high = 1.055 * pow(
          max(color, vec3(0.0)),
          vec3(1.0 / 2.4)
        ) - 0.055;

        return mix(low, high, step(vec3(0.0031308), color));
      }

      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec3 color = texture2D(tDiffuse, vUv).rgb * uExposure;

        vec2 centered = vUv - 0.5;
        float vignette = 1.0 - 0.24 * dot(centered, centered);

        color = linearToSRGB(filmic(color * vignette));

        float dither = (
          hash(gl_FragCoord.xy + mod(uFrame, 127.0)) - 0.5
        ) / 255.0;

        gl_FragColor = vec4(clamp(color + dither, 0.0, 1.0), 1.0);
      }
    `
  });

  composer.addPass(gradePass);

  const fxaaPass = new THREE.ShaderPass(THREE.FXAAShader);
  composer.addPass(fxaaPass);

  const timeUniform = { value: 0 };
  const fogUniform = { value: CONFIG.fogDensity };
  const pointScaleUniform = { value: 1 };
  const intersectionUniform = { value: new THREE.Vector3() };

  const gl = renderer.getContext();
  const pointSizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
  const pointMaximumUniform = {
    value: Math.min(64, pointSizeRange[1])
  };

  /*
   * Both terrain shaders and the junction solver use these exact functions.
   * Irrational-frequency detail layers prevent a short visible repeat of
   * the requested base interference pattern.
   */
  const surfaceGLSL = `
    float baseWave(float x, float y, float t) {
      return sin(x * 0.1 + t) * cos(y * 0.15 - t * 0.5)
           + sin(y * 0.05 + t * 0.2);
    }

    float baseDy(float x, float y, float t) {
      return -0.15 * sin(x * 0.1 + t)
                   * sin(y * 0.15 - t * 0.5)
           + 0.05 * cos(y * 0.05 + t * 0.2);
    }

    float h2(float x, float y, float t) {
      float a = 0.071 * x + 0.113 * y + sqrt(2.0) * 0.43 * t;
      float b = 0.037 * x - 0.093 * y - sqrt(3.0) * 0.19 * t;
      float c = 0.181 * x - 0.077 * y + sqrt(5.0) * 0.17 * t;

      return 2.4 * baseWave(x, y, t)
           + 0.7 * sin(a) * cos(b)
           + 0.35 * sin(c);
    }

    float h2Dy(float x, float y, float t) {
      float a = 0.071 * x + 0.113 * y + sqrt(2.0) * 0.43 * t;
      float b = 0.037 * x - 0.093 * y - sqrt(3.0) * 0.19 * t;
      float c = 0.181 * x - 0.077 * y + sqrt(5.0) * 0.17 * t;

      return 2.4 * baseDy(x, y, t)
           + 0.7 * (
               0.113 * cos(a) * cos(b)
             + 0.093 * sin(a) * sin(b)
           )
           - 0.02695 * cos(c);
    }

    float h5(float x, float y, float t) {
      return 1.65 * baseWave(x + 17.0, y - 9.0, 0.83 * t + 0.8)
           + 0.45 * sin(
               0.061 * x - 0.117 * y - sqrt(7.0) * 0.12 * t
           );
    }

    float h5Dy(float x, float y, float t) {
      return 1.65 * baseDy(x + 17.0, y - 9.0, 0.83 * t + 0.8)
           - 0.05265 * cos(
               0.061 * x - 0.117 * y - sqrt(7.0) * 0.12 * t
           );
    }

    vec3 intersectionAt(float x, float t) {
      const float s = 0.8660254037844386;
      const float c = 0.5;

      float v = 0.0;

      for (int iteration = 0; iteration < 9; iteration++) {
        float height = h5(x, v, t);
        float slope = h5Dy(x, v, t);
        float y = c * v - s * height;

        float residual = s * v + c * height - h2(x, y, t);
        float derivative =
          s + c * slope - h2Dy(x, y, t) * (c - s * slope);

        v -= clamp(residual / derivative, -6.0, 6.0);
      }

      float height = h5(x, v, t);

      return vec3(
        x,
        c * v - s * height,
        s * v + c * height
      );
    }
  `;

  function baseWave(x, y, t) {
    return Math.sin(x * 0.1 + t) * Math.cos(y * 0.15 - t * 0.5)
      + Math.sin(y * 0.05 + t * 0.2);
  }

  function baseDy(x, y, t) {
    return -0.15 * Math.sin(x * 0.1 + t)
      * Math.sin(y * 0.15 - t * 0.5)
      + 0.05 * Math.cos(y * 0.05 + t * 0.2);
  }

  function h2(x, y, t) {
    const a = 0.071 * x + 0.113 * y + Math.SQRT2 * 0.43 * t;
    const b = 0.037 * x - 0.093 * y - Math.sqrt(3) * 0.19 * t;
    const c = 0.181 * x - 0.077 * y + Math.sqrt(5) * 0.17 * t;

    return 2.4 * baseWave(x, y, t)
      + 0.7 * Math.sin(a) * Math.cos(b)
      + 0.35 * Math.sin(c);
  }

  function h2Dy(x, y, t) {
    const a = 0.071 * x + 0.113 * y + Math.SQRT2 * 0.43 * t;
    const b = 0.037 * x - 0.093 * y - Math.sqrt(3) * 0.19 * t;
    const c = 0.181 * x - 0.077 * y + Math.sqrt(5) * 0.17 * t;

    return 2.4 * baseDy(x, y, t)
      + 0.7 * (
        0.113 * Math.cos(a) * Math.cos(b)
        + 0.093 * Math.sin(a) * Math.sin(b)
      )
      - 0.02695 * Math.cos(c);
  }

  function h5(x, y, t) {
    return 1.65 * baseWave(x + 17, y - 9, 0.83 * t + 0.8)
      + 0.45 * Math.sin(
        0.061 * x - 0.117 * y - Math.sqrt(7) * 0.12 * t
      );
  }

  function h5Dy(x, y, t) {
    return 1.65 * baseDy(x + 17, y - 9, 0.83 * t + 0.8)
      - 0.05265 * Math.cos(
        0.061 * x - 0.117 * y - Math.sqrt(7) * 0.12 * t
      );
  }

  function intersectionAt(x, t, result) {
    let v = 0;

    for (let iteration = 0; iteration < 9; iteration++) {
      const height = h5(x, v, t);
      const slope = h5Dy(x, v, t);
      const y = COS_TILT * v - SIN_TILT * height;

      const residual =
        SIN_TILT * v + COS_TILT * height - h2(x, y, t);

      const derivative =
        SIN_TILT + COS_TILT * slope
        - h2Dy(x, y, t) * (COS_TILT - SIN_TILT * slope);

      v -= THREE.MathUtils.clamp(residual / derivative, -6, 6);
    }

    const height = h5(x, v, t);

    return result.set(
      x,
      COS_TILT * v - SIN_TILT * height,
      SIN_TILT * v + COS_TILT * height
    );
  }

  /*
   * Barycentric edge shading produces antialiased emissive wireframes.
   * The underlying meshes each contain 224 × 224 plane subdivisions.
   */
  function makeTerrainGeometry(width, height) {
    const indexed = new THREE.PlaneGeometry(
      width,
      height,
      CONFIG.segments,
      CONFIG.segments
    );

    const geometry = indexed.toNonIndexed();
    indexed.dispose();

    const vertexCount = geometry.attributes.position.count;
    const barycentric = new Float32Array(vertexCount * 3);

    for (let vertex = 0; vertex < vertexCount; vertex++) {
      barycentric[vertex * 3 + vertex % 3] = 1;
    }

    geometry.setAttribute(
      "aBarycentric",
      new THREE.BufferAttribute(barycentric, 3)
    );

    geometry.deleteAttribute("normal");
    return geometry;
  }

  function makeTerrainMaterial(color, braneType) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uFogDensity: fogUniform,
        uColor: { value: linearColor(color) },
        uBraneType: { value: braneType }
      },

      extensions: {
        derivatives: true
      },

      vertexShader: `
        precision highp float;

        uniform float uTime;
        uniform float uBraneType;

        attribute vec3 aBarycentric;

        varying vec3 vBarycentric;
        varying vec2 vUv;
        varying float vHeight;
        varying float vDepth;

        ${surfaceGLSL}

        void main() {
          vec3 displaced = position;

          displaced.z = uBraneType < 0.5
            ? h2(position.x, position.y, uTime)
            : h5(position.x, position.y, uTime);

          vBarycentric = aBarycentric;
          vUv = uv;
          vHeight = displaced.z;

          vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);
          vDepth = max(0.0, -viewPosition.z);

          gl_Position = projectionMatrix * viewPosition;
        }
      `,

      fragmentShader: `
        precision highp float;

        uniform float uTime;
        uniform float uFogDensity;
        uniform vec3 uColor;

        varying vec3 vBarycentric;
        varying vec2 vUv;
        varying float vHeight;
        varying float vDepth;

        void main() {
          vec3 derivative = max(fwidth(vBarycentric), vec3(0.00001));
          vec3 interior = smoothstep(
            vec3(0.0),
            derivative * 1.08,
            vBarycentric
          );

          float edge = 1.0 - min(
            interior.x,
            min(interior.y, interior.z)
          );

          float boundaryFade =
            smoothstep(0.0, 0.035, vUv.x)
            * smoothstep(0.0, 0.035, 1.0 - vUv.x)
            * smoothstep(0.0, 0.05, vUv.y)
            * smoothstep(0.0, 0.05, 1.0 - vUv.y);

          float swell = 0.88 + 0.24 * sin(vHeight * 0.8 + uTime);
          float fog = exp(-pow(uFogDensity * vDepth, 2.0));

          vec3 emission = uColor * (1.5 + swell);
          float alpha = (0.006 + edge * 0.49) * boundaryFade * fog;

          gl_FragColor = vec4(emission, alpha);
        }
      `,

      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      toneMapped: false
    });
  }

  const m2 = new THREE.Mesh(
    makeTerrainGeometry(CONFIG.terrainWidth, CONFIG.m2Height),
    makeTerrainMaterial(0x00d2ff, 0)
  );

  m2.name = "M2 — displaced spatial worldvolume";
  m2.frustumCulled = false;
  m2.renderOrder = 1;
  scene.add(m2);

  const m5 = new THREE.Mesh(
    makeTerrainGeometry(CONFIG.terrainWidth, CONFIG.m5Height),
    makeTerrainMaterial(0xb500ff, 1)
  );

  m5.name = "M5 — displaced two-dimensional spatial slice";
  m5.rotation.x = CONFIG.tilt;
  m5.frustumCulled = false;
  m5.renderOrder = 2;
  scene.add(m5);

  const particleFragmentShader = `
    precision highp float;

    uniform float uFogDensity;

    varying vec3 vColor;
    varying float vFade;
    varying float vDepth;

    void main() {
      float radius = length(gl_PointCoord - 0.5) * 2.0;

      float boundary = 1.0 - smoothstep(0.72, 1.0, radius);
      float halo = exp(-5.5 * radius * radius);
      float core = exp(-55.0 * radius * radius);
      float fog = exp(-pow(uFogDensity * vDepth, 2.0));

      float alpha = boundary * (0.5 * halo + core) * vFade * fog;

      if (alpha < 0.002) {
        discard;
      }

      gl_FragColor = vec4(vColor * (0.9 + 1.7 * core), alpha);
    }
  `;

  const junctionPositions = new Float32Array(CONFIG.junctionCount * 3);
  const junctionPhases = new Float32Array(CONFIG.junctionCount);

  for (let index = 0; index < CONFIG.junctionCount; index++) {
    const phase = index / (CONFIG.junctionCount - 1);
    junctionPositions[index * 3] = -108 + phase * 216;
    junctionPhases[index] = phase;
  }

  const junctionGeometry = new THREE.BufferGeometry();

  junctionGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(junctionPositions, 3)
  );

  junctionGeometry.setAttribute(
    "aPhase",
    new THREE.BufferAttribute(junctionPhases, 1)
  );

  function junctionVertexShader(moving) {
    return `
      precision highp float;

      uniform float uTime;
      uniform float uPointScale;
      uniform float uPointMaximum;
      uniform float uSize;

      attribute float aPhase;

      varying vec3 vColor;
      varying float vFade;
      varying float vDepth;

      ${surfaceGLSL}

      void main() {
        float x = ${
          moving
            ? "-108.0 + 216.0 * fract(aPhase + uTime * 0.014)"
            : "position.x"
        };

        vec3 junction = intersectionAt(x, uTime);
        vec4 viewPosition = modelViewMatrix * vec4(junction, 1.0);

        vDepth = max(0.001, -viewPosition.z);
        vFade = 1.0 - smoothstep(96.0, 108.0, abs(x));

        float pulse = 0.5 + 0.5 * sin(x * 0.23 - uTime * 1.8);
        vColor = mix(
          vec3(1.0, 0.58, 0.17),
          vec3(1.0, 0.96, 0.82),
          0.65 + 0.35 * pulse
        ) * 2.1;

        gl_PointSize = clamp(
          uSize * uPointScale / vDepth,
          1.0,
          uPointMaximum
        );

        gl_Position = projectionMatrix * viewPosition;
      }
    `;
  }

  const junctionPointsMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uFogDensity: fogUniform,
      uPointScale: pointScaleUniform,
      uPointMaximum: pointMaximumUniform,
      uSize: { value: 0.42 }
    },
    vertexShader: junctionVertexShader(true),
    fragmentShader: particleFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });

  const junctionPoints = new THREE.Points(
    junctionGeometry,
    junctionPointsMaterial
  );

  junctionPoints.name = "Numerically tracked brane intersection";
  junctionPoints.frustumCulled = false;
  junctionPoints.renderOrder = 5;
  scene.add(junctionPoints);

  const junctionLineMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uFogDensity: fogUniform,
      uPointScale: pointScaleUniform,
      uPointMaximum: pointMaximumUniform,
      uSize: { value: 1 }
    },

    vertexShader: junctionVertexShader(false),

    fragmentShader: `
      precision highp float;

      uniform float uFogDensity;

      varying vec3 vColor;
      varying float vFade;
      varying float vDepth;

      void main() {
        float fog = exp(-pow(uFogDensity * vDepth, 2.0));
        gl_FragColor = vec4(vColor, 0.62 * vFade * fog);
      }
    `,

    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });

  const junctionLine = new THREE.Line(
    junctionGeometry,
    junctionLineMaterial
  );

  junctionLine.frustumCulled = false;
  junctionLine.renderOrder = 4;
  scene.add(junctionLine);

  /*
   * Cubic Bézier flux paths are evaluated directly on the GPU.
   * Each of the 32 paths carries 192 particles: 6,144 total.
   */
  const fluxLineGroup = new THREE.Group();
  scene.add(fluxLineGroup);

  const fluxCurves = [];
  const fluxCount = CONFIG.trackCount * CONFIG.nodesPerTrack;

  const controlOne = new Float32Array(fluxCount * 3);
  const controlTwo = new Float32Array(fluxCount * 3);
  const controlThree = new Float32Array(fluxCount * 3);
  const phases = new Float32Array(fluxCount);
  const seeds = new Float32Array(fluxCount);

  const origin = new THREE.Vector3();
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let track = 0; track < CONFIG.trackCount; track++) {
    const axial = 1 - 2 * (track + 0.5) / CONFIG.trackCount;
    const radial = Math.sqrt(1 - axial * axial);
    const angle = track * goldenAngle;

    const direction = new THREE.Vector3(
      axial,
      radial * Math.cos(angle),
      radial * Math.sin(angle) * 0.65
    ).normalize();

    const reference = Math.abs(direction.z) > 0.85
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(0, 0, 1);

    const side = new THREE.Vector3()
      .crossVectors(direction, reference)
      .normalize();

    const secondSide = new THREE.Vector3()
      .crossVectors(direction, side)
      .normalize();

    const length = 76 + 40 * (0.5 + 0.5 * Math.sin(track * 1.71));

    const p1 = direction.clone().multiplyScalar(length * 0.23)
      .addScaledVector(side, 8 * Math.sin(track * 0.83));

    const p2 = direction.clone().multiplyScalar(length * 0.64)
      .addScaledVector(side, 18 * Math.sin(track * 1.13 + 0.7))
      .addScaledVector(secondSide, 12 * Math.cos(track * 0.67));

    const p3 = direction.clone().multiplyScalar(length);

    const curve = new THREE.CubicBezierCurve3(
      origin.clone(),
      p1,
      p2,
      p3
    );

    fluxCurves.push(curve);

    const linePoints = curve.getPoints(180);
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints);
    const lineColors = new Float32Array(linePoints.length * 3);

    const baseColor = linearColor(
      track % 3 === 0 ? 0x52ffc1 : 0x00a7ce
    );

    for (let point = 0; point < linePoints.length; point++) {
      const u = point / (linePoints.length - 1);
      const fade = Math.sin(Math.PI * u) * 0.7 + 0.05;

      lineColors[point * 3] = baseColor.r * fade;
      lineColors[point * 3 + 1] = baseColor.g * fade;
      lineColors[point * 3 + 2] = baseColor.b * fade;
    }

    lineGeometry.setAttribute(
      "color",
      new THREE.BufferAttribute(lineColors, 3)
    );

    const line = new THREE.Line(
      lineGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.16,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: true,
        toneMapped: false
      })
    );

    fluxLineGroup.add(line);

    for (let node = 0; node < CONFIG.nodesPerTrack; node++) {
      const index = track * CONFIG.nodesPerTrack + node;
      const offset = index * 3;

      p1.toArray(controlOne, offset);
      p2.toArray(controlTwo, offset);
      p3.toArray(controlThree, offset);

      phases[index] = (node + track / CONFIG.trackCount)
        / CONFIG.nodesPerTrack;

      seeds[index] = track / CONFIG.trackCount;
    }
  }

  const fluxGeometry = new THREE.BufferGeometry();

  fluxGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(controlOne, 3)
  );

  fluxGeometry.setAttribute(
    "aControlTwo",
    new THREE.BufferAttribute(controlTwo, 3)
  );

  fluxGeometry.setAttribute(
    "aControlThree",
    new THREE.BufferAttribute(controlThree, 3)
  );

  fluxGeometry.setAttribute(
    "aPhase",
    new THREE.BufferAttribute(phases, 1)
  );

  fluxGeometry.setAttribute(
    "aSeed",
    new THREE.BufferAttribute(seeds, 1)
  );

  const fluxMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uOrigin: intersectionUniform,
      uFogDensity: fogUniform,
      uPointScale: pointScaleUniform,
      uPointMaximum: pointMaximumUniform,
      uGreen: { value: linearColor(0x55ffc0) },
      uCyan: { value: linearColor(0x00d2ff) }
    },

    vertexShader: `
      precision highp float;

      uniform float uTime;
      uniform vec3 uOrigin;
      uniform float uPointScale;
      uniform float uPointMaximum;
      uniform vec3 uGreen;
      uniform vec3 uCyan;

      attribute vec3 aControlTwo;
      attribute vec3 aControlThree;
      attribute float aPhase;
      attribute float aSeed;

      varying vec3 vColor;
      varying float vFade;
      varying float vDepth;

      void main() {
        float t = fract(aPhase + uTime * (0.027 + aSeed * 0.01));
        float inverse = 1.0 - t;

        vec3 point =
          3.0 * inverse * inverse * t * position
          + 3.0 * inverse * t * t * aControlTwo
          + t * t * t * aControlThree
          + uOrigin;

        vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);
        vDepth = max(0.001, -viewPosition.z);

        float colorPhase =
          0.5 + 0.5 * sin(t * 5.0 + aSeed * 6.283185 - uTime * 0.3);

        vColor = mix(uGreen, uCyan, colorPhase) * 1.7;

        vFade = smoothstep(0.0, 0.04, t)
              * (1.0 - smoothstep(0.86, 1.0, t));

        float size = 0.16 + 0.085 * aSeed;

        gl_PointSize = clamp(
          size * uPointScale / vDepth,
          1.0,
          uPointMaximum
        );

        gl_Position = projectionMatrix * viewPosition;
      }
    `,

    fragmentShader: particleFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });

  const fluxParticles = new THREE.Points(fluxGeometry, fluxMaterial);
  fluxParticles.name = "F4 schematic — 6144 Bézier particle nodes";
  fluxParticles.frustumCulled = false;
  fluxParticles.renderOrder = 3;
  scene.add(fluxParticles);

  /*
   * Compactification glyph:
   * a thickened S1, a threaded membrane cylinder, and reduction guides.
   */
  const compactGroup = new THREE.Group();
  compactGroup.position.set(54, -28, 30);
  compactGroup.rotation.set(0.18, -0.35, -0.12);
  scene.add(compactGroup);

  const torusGeometry = new THREE.TorusGeometry(
    7.5,
    0.42,
    64,
    192
  );

  const torus = new THREE.Mesh(
    torusGeometry,
    new THREE.MeshStandardMaterial({
      color: linearColor(0xffaa00),
      emissive: linearColor(0xffaa00),
      emissiveIntensity: 1.3,
      roughness: 0.25,
      metalness: 0.45
    })
  );

  torus.name = "Thickened depiction of the compact S1";
  compactGroup.add(torus);

  const torusDetail = new THREE.Mesh(
    torusGeometry,
    new THREE.MeshBasicMaterial({
      color: linearColor(0xffe2a0),
      wireframe: true,
      transparent: true,
      opacity: 0.12,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  torusDetail.scale.setScalar(1.002);
  compactGroup.add(torusDetail);

  const cylinderGeometry = new THREE.CylinderGeometry(
    1.55,
    1.55,
    23,
    64,
    120,
    true
  );

  // CylinderGeometry starts on local Y; the torus opening faces local Z.
  cylinderGeometry.rotateX(Math.PI / 2);

  const membraneCylinder = new THREE.Mesh(
    cylinderGeometry,
    new THREE.MeshBasicMaterial({
      color: linearColor(0x00aaff),
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  membraneCylinder.name = "Wrapped M2 compactification glyph";
  compactGroup.add(membraneCylinder);

  const helixPoints = [];

  for (let index = 0; index <= 480; index++) {
    const u = index / 480;
    const angle = u * Math.PI * 2 * 6;

    helixPoints.push(new THREE.Vector3(
      Math.cos(angle) * 1.64,
      Math.sin(angle) * 1.64,
      (u - 0.5) * 23
    ));
  }

  const helixCurve = new THREE.CatmullRomCurve3(helixPoints);

  const helix = new THREE.Mesh(
    new THREE.TubeGeometry(helixCurve, 640, 0.045, 8, false),
    new THREE.MeshBasicMaterial({
      color: linearColor(0x6fe7ff).multiplyScalar(2),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  compactGroup.add(helix);

  const reductionPoints = [];

  for (let index = 0; index < 8; index++) {
    const angle = index / 8 * Math.PI * 2;
    const x = Math.cos(angle) * 1.6;
    const y = Math.sin(angle) * 1.6;

    reductionPoints.push(
      new THREE.Vector3(x, y, 11.5),
      new THREE.Vector3(x * 0.08, y * 0.08, 34)
    );
  }

  const reductionLines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(reductionPoints),
    new THREE.LineBasicMaterial({
      color: linearColor(0x56cfff),
      transparent: true,
      opacity: 0.44,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  compactGroup.add(reductionLines);

  const stringLimit = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 23),
      new THREE.Vector3(0, 0, 43)
    ]),
    new THREE.LineBasicMaterial({
      color: linearColor(0xc7f6ff).multiplyScalar(1.6),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    })
  );

  compactGroup.add(stringLimit);

  /*
   * Canvas labels are rendered after bloom.
   * They remain genuine world-positioned sprites, but their text avoids
   * the bloom pass so mathematical notation stays legible.
   */
  const labels = [];

  function createLabel(title, subtitle, color, width, updatePosition) {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = subtitle ? 236 : 150;

    const context = canvas.getContext("2d");

    if (!context) {
      return null;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);

    const background = context.createLinearGradient(0, 0, canvas.width, 0);
    background.addColorStop(0, "rgba(2, 2, 8, 0.88)");
    background.addColorStop(0.8, "rgba(2, 2, 8, 0.65)");
    background.addColorStop(1, "rgba(2, 2, 8, 0)");

    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.fillStyle = color;
    context.fillRect(0, 12, 5, canvas.height - 24);

    context.font = "500 58px Consolas, Menlo, monospace";
    context.textBaseline = "middle";
    context.fillText(title, 35, subtitle ? 77 : 75, 950);

    if (subtitle) {
      context.fillStyle = "#c3cfde";
      context.font = "36px Georgia, serif";
      context.fillText(subtitle, 36, 165, 945);
    }

    const texture = new THREE.CanvasTexture(canvas);

    // This overlay is already in display color space.
    texture.encoding = THREE.LinearEncoding;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;

    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
      toneMapped: false
    });

    const sprite = new THREE.Sprite(material);
    sprite.scale.set(
      width,
      width * canvas.height / canvas.width,
      1
    );

    sprite.name = title;
    sprite.renderOrder = 100;
    labelScene.add(sprite);

    labels.push({
      sprite,
      updatePosition
    });

    return sprite;
  }

  const coordinateNames = [
    "x⁰ / time",
    "x¹",
    "x²",
    "x³",
    "x⁴",
    "x⁵",
    "x⁶",
    "x⁷",
    "x⁸",
    "x⁹",
    "x¹⁰ / compact"
  ];

  for (let index = 0; index < coordinateNames.length; index++) {
    const curve = fluxCurves[index * 2];
    const anchor = curve.getPoint(0.36 + (index % 3) * 0.08);
    const color = index === 0 || index === 10 ? "#ffd381" : "#8ee8ff";

    createLabel(
      coordinateNames[index],
      "",
      color,
      index === 0 || index === 10 ? 8.5 : 4.3,
      sprite => {
        sprite.position.copy(anchor).add(intersectionUniform.value);
        sprite.position.z += 1.2;
      }
    );
  }

  createLabel(
    "M2 / C₃ COUPLING",
    "ξᵃ = (τ, σ¹, σ²)",
    "#71e5ff",
    20,
    (sprite, t) => {
      sprite.position.set(-28, -26, h2(-28, -26, t) + 3.2);
    }
  );

  createLabel(
    "M5 / SPATIAL SLICE",
    "ζᴬ : one time + five spatial coordinates",
    "#df9aff",
    24,
    (sprite, t) => {
      const x = 25;
      const v = 25;
      const height = h5(x, v, t);

      sprite.position.set(
        x,
        COS_TILT * v - SIN_TILT * height,
        SIN_TILT * v + COS_TILT * height + 3
      );
    }
  );

  createLabel(
    "F₄ / FLUX SCHEMATIC",
    "F₄ = dC₃",
    "#86ffd4",
    18,
    sprite => {
      sprite.position.copy(intersectionUniform.value);
      sprite.position.add(new THREE.Vector3(-10, 8, 16));
    }
  );

  const compactLabelAnchor = new THREE.Vector3(0, 11, 2);

  createLabel(
    "S¹ / COMPACT x¹⁰",
    "R₁₁ = gₛℓₛ",
    "#ffcc72",
    18,
    sprite => {
      sprite.position.copy(compactLabelAnchor)
        .applyMatrix4(compactGroup.matrixWorld);
    }
  );

  const stringLabelAnchor = new THREE.Vector3(5, 0, 33);

  createLabel(
    "10D / TYPE IIA LIMIT",
    "T_F1 = 2πR₁₁T_M2",
    "#b2eeff",
    18,
    sprite => {
      sprite.position.copy(stringLabelAnchor)
        .applyMatrix4(compactGroup.matrixWorld);
    }
  );

  /*
   * The closed camera spline enters low over M2, crosses the tilted M5,
   * then arcs around the compactification glyph before returning.
   */
  const flightPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-105, -50, 32),
    new THREE.Vector3(-72, -30, 13),
    new THREE.Vector3(-34, -9, 7),
    new THREE.Vector3(2, -3, 6),
    new THREE.Vector3(30, 12, 15),
    new THREE.Vector3(65, 28, 28),
    new THREE.Vector3(98, 5, 46),
    new THREE.Vector3(82, -50, 58),
    new THREE.Vector3(43, -67, 40),
    new THREE.Vector3(12, -46, 23),
    new THREE.Vector3(-35, -65, 31),
    new THREE.Vector3(-89, -76, 42)
  ], true, "centripetal");

  const lookPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-38, 0, 0),
    new THREE.Vector3(-15, 0, 0),
    new THREE.Vector3(10, 3, 0),
    new THREE.Vector3(35, 13, 9),
    new THREE.Vector3(56, 18, 10),
    new THREE.Vector3(54, -28, 30),
    new THREE.Vector3(54, -28, 30),
    new THREE.Vector3(54, -28, 30),
    new THREE.Vector3(54, -28, 30),
    new THREE.Vector3(18, 0, 4),
    new THREE.Vector3(-15, 0, 0),
    new THREE.Vector3(-38, 0, 0)
  ], true, "centripetal");

  const flightNames = [
    "CORRIDOR ENTRY",
    "C₃ SWELL APPROACH",
    "LOW ALTITUDE TRANSIT",
    "M5 VEIL CROSSING",
    "INTERSECTION DEPARTURE",
    "COMPACTIFICATION APPROACH",
    "S¹ WIDE ORBIT",
    "WRAPPED M2 / IIA LIMIT",
    "GOLD RING REVERSE ANGLE",
    "FLUX CORRIDOR RETURN",
    "HYPERSURFACE PANORAMA",
    "RETURN TO ENTRY"
  ];

  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  );

  let autoFlight = !motionPreference.matches;
  let paused = motionPreference.matches;
  let elapsed = 0;
  let flightElapsed = 0;
  let lastTimestamp = null;
  let animationId = 0;
  let running = false;
  let contextLost = false;
  let previousStatus = "";

  const destination = new THREE.Vector3();
  const lookDestination = new THREE.Vector3();
  const smoothedLookTarget = new THREE.Vector3();
  const cameraRig = new THREE.PerspectiveCamera();
  cameraRig.up.copy(camera.up);  

  flightPath.getPoint(0, camera.position);
  lookPath.getPoint(0, smoothedLookTarget);

  if (motionPreference.matches) {
    camera.position.set(-104, -88, 76);
    smoothedLookTarget.set(12, -3, 10);
  }

  camera.lookAt(smoothedLookTarget);
  controls.target.copy(smoothedLookTarget);
  controls.update();

  controls.addEventListener("start", () => {
    autoFlight = false;
  });

  function resumeFlight() {
    autoFlight = true;
    paused = false;

    // Flush any residual manual damping before the camera rig takes over.
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = true;

    smoothedLookTarget.copy(controls.target);
  }

  window.addEventListener("keydown", event => {
    const target = event.target;

    if (
      target &&
      (target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();

      if (!event.repeat) {
        paused = !paused;
      }
    }

    if (event.code === "KeyR" && !event.repeat) {
      resumeFlight();
    }

    if (event.code === "KeyH" && !event.repeat) {
      panelElement.classList.toggle("is-hidden");
    }
  });

  function handleMotionPreference(event) {
    if (event.matches) {
      paused = true;
      autoFlight = false;
    }
  }

  if (motionPreference.addEventListener) {
    motionPreference.addEventListener("change", handleMotionPreference);
  } else {
    motionPreference.addListener(handleMotionPreference);
  }

  function updateCamera(delta, progress) {
    if (!autoFlight) {
      controls.update();
      smoothedLookTarget.copy(controls.target);
      return;
    }

    flightPath.getPoint(progress, destination);
    lookPath.getPoint(progress, lookDestination);

    const surfaceHeight = h2(
      destination.x,
      destination.y,
      timeUniform.value
    );

    destination.z = Math.max(destination.z, surfaceHeight + 2.3);

    const positionSmoothing = 1 - Math.exp(-1.8 * delta);
    const rotationSmoothing = 1 - Math.exp(-2.8 * delta);

    camera.position.lerp(destination, positionSmoothing);
    smoothedLookTarget.lerp(lookDestination, positionSmoothing);

    cameraRig.position.copy(camera.position);
    cameraRig.lookAt(smoothedLookTarget);
    cameraRig.rotateZ(Math.sin(progress * Math.PI * 4) * 0.022);

    camera.quaternion.slerp(cameraRig.quaternion, rotationSmoothing);
    controls.target.copy(smoothedLookTarget);
  }

  function updateLabels() {
    compactGroup.updateMatrixWorld(true);

    for (const label of labels) {
      label.updatePosition(label.sprite, timeUniform.value);

      const distance = camera.position.distanceTo(label.sprite.position);

      const nearFade = THREE.MathUtils.smoothstep(distance, 3, 9);
      const farFade = 1 - THREE.MathUtils.smoothstep(distance, 145, 245);

      label.sprite.material.opacity = nearFade * farFade;
      label.sprite.visible = label.sprite.material.opacity > 0.015;
    }
  }

  function updateFlightCaption(progress) {
    const phaseIndex = Math.min(
      flightNames.length - 1,
      Math.floor(progress * flightNames.length)
    );

    const state = paused
      ? "PAUSED"
      : autoFlight
        ? flightNames[phaseIndex]
        : "MANUAL EXPLORATION";

    if (state !== previousStatus) {
      flightStateElement.textContent = state;
      previousStatus = state;
    }

    progressElement.style.transform = "scaleX(" + progress + ")";
  }

  function handleResize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height);

    composer.setPixelRatio(pixelRatio);
    composer.setSize(width, height);

    fxaaPass.material.uniforms.resolution.value.set(
      1 / (width * pixelRatio),
      1 / (height * pixelRatio)
    );

    pointScaleUniform.value =
      height * pixelRatio
      / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  }

  window.addEventListener("resize", handleResize, { passive: true });

  function animate(timestamp) {
    if (!running) {
      return;
    }

    const delta = lastTimestamp === null
      ? 0
      : Math.min((timestamp - lastTimestamp) / 1000, 0.05);

    lastTimestamp = timestamp;

    if (!paused) {
      elapsed += delta;

      if (autoFlight) {
        flightElapsed += delta;
      }
    }

    timeUniform.value = elapsed * CONFIG.timeScale;

    const progress =
      (flightElapsed % CONFIG.flightDuration) / CONFIG.flightDuration;

    intersectionAt(0, timeUniform.value, intersectionUniform.value);
    fluxLineGroup.position.copy(intersectionUniform.value);

    helix.rotation.z = elapsed * 0.055;

    if (!paused || !autoFlight) {
      updateCamera(delta, progress);
    }

    updateLabels();
    updateFlightCaption(progress);

    gradePass.uniforms.uFrame.value = Math.floor(elapsed * 24);

    composer.render(delta);

    // Draw crisp world-space annotations over the completed cinematic image.
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(labelScene, camera);
    renderer.autoClear = true;

    animationId = requestAnimationFrame(animate);
  }

  function startAnimation() {
    if (running || contextLost || document.hidden) {
      return;
    }

    running = true;
    lastTimestamp = null;
    animationId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    running = false;
    lastTimestamp = null;
    cancelAnimationFrame(animationId);
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
    showStatus("The graphics context was interrupted. Waiting for the GPU to restore it.");
  });

  renderer.domElement.addEventListener("webglcontextrestored", () => {
    contextLost = false;
    clearStatus();
    handleResize();
    startAnimation();
  });

  handleResize();
  intersectionAt(0, 0, intersectionUniform.value);
  fluxLineGroup.position.copy(intersectionUniform.value);
  updateLabels();
  updateFlightCaption(0);
  startAnimation();
})();