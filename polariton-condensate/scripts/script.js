(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const SIGMA = 0.72;
  const CORE = 0.14;
  const FIELD_SCALE = 4.8;
  const BETA = 0.35;
  const RABI = 1;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mix = (a, b, t) => a + (b - a) * t;

  const ease = t => {
    t = clamp(t, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };

  function spectrum(q, detuning) {
    const ec = detuning + q * q;
    const gap = Math.hypot(ec, RABI);
    const photon = 0.5 * (1 - ec / gap);

    return {
      ec,
      lp: (ec - gap) / 2,
      up: (ec + gap) / 2,
      photon,
      exciton: 1 - photon,
      gap
    };
  }

  class Population {
    constructor() {
      this.reset();
    }

    reset() {
      this.z = Math.log(1e-4);
      this.r = 0;
      this.time = 0;
    }

    get n() {
      return Math.exp(this.z);
    }

    advance(dt, pump) {
      const steps = Math.max(1, Math.ceil(dt / 0.02));
      const h = dt / steps;
      const rate = (z, r) =>
        BETA * (pump - (1 + Math.exp(z)) * r);

      for (let i = 0; i < steps; i++) {
        const z = this.z;
        const r = this.r;

        const a = r - 1;
        const b = rate(z, r);

        const c = r + h * b / 2 - 1;
        const d = rate(z + h * a / 2, r + h * b / 2);

        const e = r + h * d / 2 - 1;
        const f = rate(z + h * c / 2, r + h * d / 2);

        const g = r + h * f - 1;
        const j = rate(z + h * e, r + h * f);

        this.z += h * (a + 2 * c + 2 * e + g) / 6;
        this.r += h * (b + 2 * d + 2 * f + j) / 6;
        this.time += h;
      }

      if (!Number.isFinite(this.z + this.r) || this.r < -1e-9) {
        throw new Error(
          "The population integrator left its valid domain."
        );
      }
    }
  }

  function vortexIntegral() {
    const count = 2048;
    const h = 8 / count;
    let sum = 0;

    for (let i = 0; i <= count; i++) {
      const t = i * h;
      const s = SIGMA * SIGMA * t * t;
      const value =
        t * Math.exp(-t * t) * s / (s + CORE * CORE);

      sum += value * (
        i === 0 || i === count ? 1 : i % 2 ? 4 : 2
      );
    }

    return TAU * SIGMA * SIGMA * sum * h / 3;
  }

  const NORMS = [
    Math.PI * SIGMA * SIGMA,
    vortexIntegral()
  ];

  function profile(x, y, ell) {
    const r2 = x * x + y * y;

    return Math.exp(-r2 / (SIGMA * SIGMA)) *
      (ell ? r2 / (r2 + CORE * CORE) : 1) /
      NORMS[ell ? 1 : 0];
  }

  const FIELD_VERTEX = `
    uniform float uN;
    uniform float uEll;
    uniform float uNorm;
    uniform float uScale;

    varying vec2 vR;

    void main() {
      vR = position.xy / uScale;

      float r2 = dot(vR, vR);
      float core = mix(
        1.0,
        r2 / (r2 + 0.0196),
        abs(uEll)
      );

      float rho =
        uN * exp(-r2 / 0.5184) * core / uNorm;

      vec3 p = position;
      p.z += 0.42 * log(1.0 + 3.0 * rho);

      gl_Position =
        projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  const FIELD_FRAGMENT = `
    precision highp float;

    uniform float uN;
    uniform float uEll;
    uniform float uNorm;
    uniform float uPhase;
    uniform float uMode;
    uniform float uOpacity;
    uniform vec3 uTint;

    varying vec2 vR;

    vec3 phaseColor(float t) {
      vec3 a = vec3(0.929, 0.502, 0.808);
      vec3 b = vec3(0.569, 0.482, 0.957);
      vec3 c = vec3(0.400, 0.608, 1.000);
      vec3 d = vec3(0.400, 0.937, 0.906);
      vec3 e = vec3(0.663, 0.871, 0.765);
      vec3 f = vec3(0.949, 0.808, 0.529);

      if (t < 0.18) return mix(a, b, t / 0.18);
      if (t < 0.35) return mix(b, c, (t - 0.18) / 0.17);
      if (t < 0.52) return mix(c, d, (t - 0.35) / 0.17);
      if (t < 0.68) return mix(d, e, (t - 0.52) / 0.16);
      if (t < 0.83) return mix(e, f, (t - 0.68) / 0.15);

      return mix(f, a, (t - 0.83) / 0.17);
    }

    void main() {
      float r2 = dot(vR, vR);

      float core = mix(
        1.0,
        r2 / (r2 + 0.0196),
        abs(uEll)
      );

      float rho =
        uN * exp(-r2 / 0.5184) * core / uNorm;

      float angle =
        r2 > 1e-12 ? atan(vR.y, vR.x) : 0.0;

      float phase =
        0.55 * vR.x +
        0.08 * vR.y +
        uEll * angle -
        uPhase;

      float hue = fract(phase / 6.28318530718 + 0.5);
      vec3 col = mix(phaseColor(hue), uTint, uMode);

      float light = 1.0 - exp(-rho * 4.0);

      float contour = pow(
        0.5 + 0.5 * cos(log(1.0 + rho * 10.0) * 22.0),
        18.0
      );

      float alpha = light * uOpacity;
      if (alpha < 0.0003) discard;

      gl_FragColor = vec4(
        col * (0.42 + 2.4 * light + 0.12 * contour),
        alpha * 0.88
      );
    }
  `;

  const STANDING_VERTEX = `
    varying vec2 vUV;

    void main() {
      vUV = uv;

      gl_Position =
        projectionMatrix *
        modelViewMatrix *
        vec4(position, 1.0);
    }
  `;

  const STANDING_FRAGMENT = `
    precision highp float;

    uniform float uTime;
    uniform float uOpacity;
    uniform float uOffset;
    uniform vec3 uColor;

    varying vec2 vUV;

    void main() {
      float x = (vUV.x - 0.5) * 2.0;
      float mode = cos((vUV.y - 0.5) * 3.14159265359);
      float signedField = mode * cos(uTime * 1.1 + uOffset);

      float intensity =
        signedField * signedField * exp(-2.5 * x * x);

      float alpha = intensity * uOpacity;
      if (alpha < 0.001) discard;

      gl_FragColor = vec4(
        uColor * (0.35 + intensity),
        alpha
      );
    }
  `;

  const POINT_VERTEX = `
    attribute float aSize;

    uniform float uSize;
    uniform float uPixelRatio;

    varying float vFade;

    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);

      gl_PointSize = clamp(
        aSize * uSize * uPixelRatio / max(1.0, -mv.z),
        1.0,
        24.0
      );

      vFade = clamp((-mv.z - 0.2) * 0.4, 0.0, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const POINT_FRAGMENT = `
    precision highp float;

    uniform vec3 uColor;
    uniform float uOpacity;

    varying float vFade;

    void main() {
      vec2 d = gl_PointCoord - 0.5;
      float r = dot(d, d);

      if (r > 0.25) discard;

      float glow =
        exp(-r * 20.0) *
        (1.0 - smoothstep(0.12, 0.25, r));

      gl_FragColor = vec4(
        uColor,
        glow * uOpacity * vFade
      );
    }
  `;

  function boot() {
    const $ = id => {
      const el = document.getElementById(id);

      if (!el) {
        throw new Error("Missing interface element: " + id);
      }

      return el;
    };

    const body = document.body;
    const controlsUI = [
      ...document.querySelectorAll("[data-engine-control]")
    ];

    const notice = $("render-notice");
    let app = null;

    function announce(message) {
      $("accessibility-status").textContent = message;
    }

    function gate(enabled) {
      controlsUI.forEach(el => {
        el.disabled = !enabled;
      });
    }

    function fail(error) {
      if (app) {
        app.failed = true;
        app.ready = false;
        app.orbit.enabled = false;
      }

      gate(false);
      body.classList.add("render-failed");
      body.classList.remove("is-loading");
      notice.hidden = false;

      $("notice-title").textContent =
        "The visualization could not render";

      $("notice-message").textContent =
        "Reload after checking WebGL support and the library connection.";

      $("notice-detail").textContent =
        error instanceof Error ? error.message : String(error);

      $("notice-reload").hidden = false;
      $("model-status").textContent = "Renderer unavailable";

      announce(
        "Rendering stopped. A recovery message is displayed."
      );
    }

    $("notice-reload").addEventListener("click", () => {
      location.reload();
    });

    try {
      const names = [
        "WebGLRenderer",
        "OrbitControls",
        "CSS2DRenderer",
        "CSS2DObject",
        "EffectComposer",
        "RenderPass",
        "ShaderPass",
        "UnrealBloomPass",
        "FXAAShader",
        "CopyShader",
        "LuminosityHighPassShader"
      ];

      if (!window.THREE || names.some(name => !THREE[name])) {
        throw new Error(
          "A Three.js CDN library did not load. Check your connection and reload."
        );
      }

      app = createApp($, gate, announce, fail);
      app.start();
    } catch (error) {
      fail(error);
    }
  }

  function createApp($, gate, announce, fail) {
    const T = THREE;
    const V = (x = 0, y = 0, z = 0) =>
      new T.Vector3(x, y, z);

    const body = document.body;
    const host = $("canvas-container");
    const pop = new Population();

    const state = {
      detuning: -0.65,
      q: 0,
      pump: 1.6,
      ell: 0,
      wantedEll: 0,
      fieldFade: 1,
      field: "phase",
      paused: matchMedia(
        "(prefers-reduced-motion: reduce)"
      ).matches,
      mode: "auto",
      hud: true,
      tour: 0,
      chapter: 0,
      inspection: null,
      ready: false,
      failed: false,
      lost: false,
      visualTime: 0,
      width: 1,
      height: 1,
      dpr: 1,
      viewShift: 0,
      focusDistance: 35,
      reveal: 1
    };

    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");

    const attributes = {
      alpha: false,
      antialias: false,
      powerPreference: "high-performance"
    };

    const gl =
      canvas.getContext("webgl2", attributes) ||
      canvas.getContext("webgl", attributes);

    if (!gl) {
      throw new Error("WebGL is unavailable in this browser.");
    }

    const renderer = new T.WebGLRenderer({
      canvas,
      context: gl,
      ...attributes
    });

    renderer.setClearColor(0x03060c, 1);
    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    host.appendChild(canvas);

    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0x03060c, 0.005);

    const camera = new T.PerspectiveCamera(46, 1, 0.12, 350);
    const controlCamera = camera.clone();
    const orbit = new T.OrbitControls(controlCamera, canvas);

    orbit.enabled = false;
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 2;
    orbit.maxDistance = 140;
    orbit.maxPolarAngle = Math.PI * 0.94;
    orbit.screenSpacePanning = true;
    orbit.rotateSpeed = 0.55;
    orbit.zoomSpeed = 0.7;

    const labels = new T.CSS2DRenderer();
    labels.domElement.className = "label-layer";
    $("observatory").appendChild(labels.domElement);

    const leaderSVG = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg"
    );

    leaderSVG.classList.add("world-leaders");
    leaderSVG.setAttribute("aria-hidden", "true");
    $("observatory").appendChild(leaderSVG);

    const hdr =
      renderer.capabilities.isWebGL2 &&
      !!renderer.extensions.get("EXT_color_buffer_float");

    const renderTarget = new T.WebGLRenderTarget(1, 1, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(
      renderer,
      renderTarget
    );

    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      0.48,
      0.45,
      0.68
    );

    composer.addPass(bloom);

    const output = new T.ShaderPass({
      uniforms: {
        tDiffuse: { value: null }
      },

      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;

          gl_Position =
            projectionMatrix *
            modelViewMatrix *
            vec4(position, 1.0);
        }
      `,

      fragmentShader: `
        precision highp float;

        uniform sampler2D tDiffuse;
        varying vec2 vUv;

        void main() {
          vec3 x = max(
            texture2D(tDiffuse, vUv).rgb * 1.12,
            vec3(0.0)
          );

          vec3 y = clamp(
            (x * (2.51 * x + 0.03)) /
            (x * (2.43 * x + 0.59) + 0.14),
            0.0,
            1.0
          );

          vec3 low = 12.92 * y;
          vec3 high =
            1.055 * pow(y, vec3(1.0 / 2.4)) - 0.055;

          gl_FragColor = vec4(
            mix(
              low,
              high,
              step(vec3(0.0031308), y)
            ),
            1.0
          );
        }
      `
    });

    composer.addPass(output);

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    scene.add(new T.AmbientLight(0x6686b0, 0.5));

    const key = new T.DirectionalLight(0xbbefff, 1);
    key.position.set(8, 20, 12);
    scene.add(key);

    const rim = new T.DirectionalLight(0x7255e8, 0.65);
    rim.position.set(-20, 5, -15);
    scene.add(rim);

    let seed = 0x4a91;

    function random() {
      seed = (
        Math.imul(seed, 1664525) + 1013904223
      ) >>> 0;

      return seed / 4294967296;
    }

    function gaussian() {
      return Math.sqrt(
        -2 * Math.log(Math.max(1e-9, random()))
      ) * Math.cos(TAU * random());
    }

    const pointMaterials = [];
    const standingMaterials = [];
    const fieldMaterials = [];
    const photonColor = new T.Color(0x65b5ff);

    function points(
      count,
      color,
      size,
      opacity,
      fill,
      parent = scene
    ) {
      const positions = new Float32Array(count * 3);
      const sizes = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        positions.set(fill(i), i * 3);
        sizes[i] = 0.7 + random() * 0.6;
      }

      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        "position",
        new T.BufferAttribute(positions, 3)
      );

      geometry.setAttribute(
        "aSize",
        new T.BufferAttribute(sizes, 1)
      );

      const material = new T.ShaderMaterial({
        uniforms: {
          uColor: { value: new T.Color(color) },
          uOpacity: { value: opacity },
          uSize: { value: size },
          uPixelRatio: { value: 1 }
        },
        vertexShader: POINT_VERTEX,
        fragmentShader: POINT_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      pointMaterials.push(material);

      const mesh = new T.Points(geometry, material);
      parent.add(mesh);

      return mesh;
    }

    function line(
      vertices,
      color,
      opacity = 1,
      parent = scene,
      dashed = false
    ) {
      const geometry =
        new T.BufferGeometry().setFromPoints(vertices);

      const Material = dashed
        ? T.LineDashedMaterial
        : T.LineBasicMaterial;

      const material = new Material({
        color,
        transparent: true,
        opacity,
        depthWrite: false,
        dashSize: 0.35,
        gapSize: 0.25
      });

      const object = new T.Line(geometry, material);

      if (dashed) {
        object.computeLineDistances();
      }

      parent.add(object);
      return object;
    }

    function ring(radius, y, color, parent = scene) {
      const vertices = [];

      for (let i = 0; i <= 128; i++) {
        const a = i * TAU / 128;
        vertices.push(
          V(Math.cos(a) * radius, y, Math.sin(a) * radius)
        );
      }

      return line(vertices, color, 0.3, parent);
    }

    function field(
      parent,
      n = 1,
      ell = 0,
      scale = 1,
      tint = 0x66efe7
    ) {
      const material = new T.ShaderMaterial({
        uniforms: {
          uN: { value: n },
          uEll: { value: ell },
          uNorm: { value: NORMS[ell ? 1 : 0] },
          uScale: { value: FIELD_SCALE },
          uPhase: { value: 0 },
          uMode: { value: 0 },
          uOpacity: { value: 1 },
          uTint: { value: new T.Color(tint) }
        },
        vertexShader: FIELD_VERTEX,
        fragmentShader: FIELD_FRAGMENT,
        side: T.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      fieldMaterials.push(material);

      const mesh = new T.Mesh(
        new T.PlaneBufferGeometry(28, 28, 80, 80),
        material
      );

      mesh.rotation.x = -Math.PI / 2;
      mesh.scale.setScalar(scale);
      parent.add(mesh);

      return mesh;
    }

    function standing(
      parent,
      width,
      height,
      opacity = 0.2,
      color = 0x65b5ff
    ) {
      const material = new T.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uOpacity: { value: opacity },
          uOffset: { value: 0 },
          uColor: { value: new T.Color(color) }
        },
        vertexShader: STANDING_VERTEX,
        fragmentShader: STANDING_FRAGMENT,
        side: T.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      standingMaterials.push(material);

      const mesh = new T.Mesh(
        new T.PlaneBufferGeometry(width, height),
        material
      );

      parent.add(mesh);
      return mesh;
    }

    const sphereGeometry =
      new T.SphereBufferGeometry(1, 20, 12);

    function bead(parent, position, radius, color) {
      const mesh = new T.Mesh(
        sphereGeometry,
        new T.MeshBasicMaterial({ color })
      );

      mesh.position.copy(position);
      mesh.scale.setScalar(radius);
      parent.add(mesh);

      return mesh;
    }

    function exciton(parent, scale = 1) {
      const group = new T.Group();
      group.scale.setScalar(scale);
      parent.add(group);

      points(
        240,
        0xf18fdc,
        38,
        0.2,
        () => [
          gaussian() * 0.8,
          gaussian() * 0.24,
          gaussian() * 0.6
        ],
        group
      );

      bead(group, V(-0.47, 0, 0), 0.12, 0x65b5ff);

      const hole = new T.Mesh(
        new T.TorusBufferGeometry(0.17, 0.025, 8, 36),
        new T.MeshBasicMaterial({ color: 0xf18fdc })
      );

      hole.position.x = 0.47;
      group.add(hole);

      line(
        [V(-0.35, 0, 0), V(0.3, 0, 0)],
        0xb59aff,
        0.45,
        group,
        true
      );

      return group;
    }

    points(380, 0x779bc3, 100, 0.38, () => {
      const theta = random() * TAU;
      const y = random() * 2 - 1;
      const r = 95 + random() * 60;

      return [
        r * Math.sqrt(1 - y * y) * Math.cos(theta),
        r * y,
        r * Math.sqrt(1 - y * y) * Math.sin(theta)
      ];
    });

    const cavity = new T.Group();
    scene.add(cavity);

    const plateGeometry =
      new T.BoxBufferGeometry(30, 0.1, 26);

    const plateEdges = new T.EdgesGeometry(plateGeometry);
    const mirrorMaterials = [];

    for (const sign of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const color = i % 2 ? 0x817ac8 : 0x578cae;

        const material = new T.MeshPhongMaterial({
          color,
          transparent: true,
          opacity: 0.055,
          shininess: 75,
          depthWrite: false,
          side: T.DoubleSide
        });

        mirrorMaterials.push(material);

        const plate = new T.Mesh(plateGeometry, material);
        plate.position.y = sign * (3.25 + i * 0.18);
        cavity.add(plate);

        const edge = new T.LineSegments(
          plateEdges,
          new T.LineBasicMaterial({
            color,
            transparent: true,
            opacity: i === 0 ? 0.44 : 0.16,
            depthWrite: false
          })
        );

        edge.position.copy(plate.position);
        cavity.add(edge);
      }
    }

    const well = new T.Mesh(
      new T.PlaneBufferGeometry(28, 24),
      new T.MeshBasicMaterial({
        color: 0x8b55c9,
        transparent: true,
        opacity: 0.055,
        side: T.DoubleSide,
        depthWrite: false
      })
    );

    well.rotation.x = -Math.PI / 2;
    well.position.y = -0.08;
    cavity.add(well);

    line(
      [
        V(-14, -0.07, -12),
        V(14, -0.07, -12),
        V(14, -0.07, 12),
        V(-14, -0.07, 12),
        V(-14, -0.07, -12)
      ],
      0xb777e3,
      0.45,
      cavity
    );

    ring(10.8, -0.04, 0x8e6ae1, cavity);
    ring(18, -5, 0x305e83);
    ring(19, -5, 0x28455f);

    for (let i = 0; i < 36; i++) {
      const a = i * TAU / 36;
      const r1 = 18.3;
      const r2 = i % 3 === 0 ? 19.2 : 18.7;

      line(
        [
          V(Math.cos(a) * r1, -5, Math.sin(a) * r1),
          V(Math.cos(a) * r2, -5, Math.sin(a) * r2)
        ],
        0x426e91,
        0.32
      );
    }

    const photonSheets = [];

    for (const z of [-6, 0, 6]) {
      const sheet = standing(cavity, 25, 6.4, 0.12);
      sheet.position.z = z;
      photonSheets.push(sheet);
    }

    const mainExciton = exciton(cavity, 1.8);
    mainExciton.position.set(-7, 0.5, 3);

    const condensate = field(cavity, pop.n);
    condensate.position.y = 0.12;

    const reservoir = points(
      1000,
      0xd5a879,
      52,
      0,
      () => {
        const a = random() * TAU;
        const r = Math.sqrt(random()) * 7.5;

        return [
          Math.cos(a) * r,
          0.25 + Math.abs(gaussian()) * 0.45,
          Math.sin(a) * r
        ];
      },
      cavity
    );

    const pumpStart = V(-15, 17, -5);
    const pumpEnd = V(0, 0.25, 0);
    const pumpDirection = pumpEnd.clone().sub(pumpStart);

    const beamMaterial = new T.MeshBasicMaterial({
      color: 0xf3ce87,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending
    });

    const beam = new T.Mesh(
      new T.CylinderBufferGeometry(
        0.42,
        1.15,
        pumpDirection.length(),
        24,
        1,
        true
      ),
      beamMaterial
    );

    beam.position.copy(pumpStart).add(pumpEnd).multiplyScalar(0.5);

    beam.quaternion.setFromUnitVectors(
      V(0, 1, 0),
      pumpDirection.clone().normalize()
    );

    scene.add(beam);
    line([pumpStart, pumpEnd], 0xf3ce87, 0.17);

    const pumpSeeds = Array.from(
      { length: 85 },
      () => [random(), random() * TAU, random() * 0.45]
    );

    const pumpPoints = points(
      85,
      0xffd591,
      50,
      0.6,
      () => [0, 0, 0]
    );

    pumpPoints.frustumCulled = false;

    const emissionSeeds = Array.from(
      { length: 200 },
      () => [gaussian() * 2, gaussian() * 2, random()]
    );

    const emission = points(
      200,
      0x77ceff,
      58,
      0,
      () => [0, 0, 0]
    );

    emission.frustumCulled = false;

    const arrowPositions = new Float32Array(160 * 18);
    const arrowGeometry = new T.BufferGeometry();

    arrowGeometry.setAttribute(
      "position",
      new T.BufferAttribute(arrowPositions, 3)
        .setUsage(T.DynamicDrawUsage)
    );

    const arrows = new T.LineSegments(
      arrowGeometry,
      new T.LineBasicMaterial({
        color: 0xb9f8f6,
        transparent: true,
        opacity: 0.45,
        depthWrite: false
      })
    );

    arrows.frustumCulled = false;
    cavity.add(arrows);

    const arrowSites = [];

    for (let ix = -5; ix <= 5; ix++) {
      for (let iy = -5; iy <= 5; iy++) {
        const x = ix * 0.27;
        const y = iy * 0.27;
        const r2 = x * x + y * y;

        if (r2 < 2.1 && r2 > 0.04) {
          arrowSites.push([x, y]);
        }
      }
    }

    const board = new T.Group();
    board.position.set(43, 7, -10);
    scene.add(board);

    const boardBack = new T.Mesh(
      new T.PlaneBufferGeometry(29, 27),
      new T.MeshBasicMaterial({
        color: 0x071525,
        transparent: true,
        opacity: 0.65,
        side: T.DoubleSide
      })
    );

    boardBack.position.set(0, 4.5, -0.3);
    board.add(boardBack);

    for (let q = -2; q <= 2.01; q += 0.5) {
      line(
        [V(q * 6, -8), V(q * 6, 17.5)],
        0x315675,
        0.16,
        board
      );
    }

    for (let e = -2; e <= 6; e++) {
      line(
        [V(-12, e * 2.7), V(12, e * 2.7)],
        0x315675,
        0.16,
        board
      );
    }

    line([V(-13, -8), V(13, -8)], 0x7697b2, 0.7, board);
    line([V(-13, -8), V(-13, 17.5)], 0x7697b2, 0.7, board);

    const curveCount = 181;
    const curves = {};

    for (const [name, color, dashed] of [
      ["ec", 0x65b5ff, true],
      ["ex", 0xf18fdc, true],
      ["up", 0xf3ce87, false],
      ["lp", 0x66f5ed, false]
    ]) {
      const vertices = Array.from(
        { length: curveCount },
        () => V()
      );

      curves[name] = line(
        vertices,
        color,
        name === "ec" || name === "ex" ? 0.45 : 1,
        board,
        dashed
      );

      curves[name].geometry.attributes.position
        .setUsage(T.DynamicDrawUsage);

      curves[name].frustumCulled = false;
    }

    const lpMarker = bead(board, V(), 0.2, 0x83fff4);
    const upMarker = bead(board, V(), 0.17, 0xffdb95);

    const gapLine = line(
      [V(), V()],
      0xd7edf9,
      0.7,
      board,
      true
    );

    gapLine.frustumCulled = false;

    const shelf = new T.Group();
    scene.add(shelf);

    const inspectionPositions = {};
    const referenceFields = [];
    const referenceWaves = [];

    [
      "photon",
      "exciton",
      "upper",
      "lower",
      "reservoir",
      "vortex"
    ].forEach((name, i) => {
      const root = new T.Group();
      root.position.set(-20 + i * 8, 0, 28);
      shelf.add(root);

      inspectionPositions[name] =
        root.position.clone().add(V(0, 1, 0));

      ring(2.7, -1.5, 0x426c92, root);
      ring(2.5, -1.5, 0x314a65, root);

      if (name === "photon") {
        const wave = standing(root, 4.5, 3, 0.62);
        referenceWaves.push(wave);

        line(
          [V(-2.3, -1.5), V(2.3, -1.5)],
          0x75b6eb,
          0.8,
          root
        );

        line(
          [V(-2.3, 1.5), V(2.3, 1.5)],
          0x75b6eb,
          0.8,
          root
        );
      } else if (name === "exciton") {
        exciton(root, 1.4);
      } else if (name === "reservoir") {
        points(
          180,
          0xf3ce87,
          45,
          0.6,
          () => [
            gaussian() * 0.9,
            Math.abs(gaussian()),
            gaussian() * 0.9
          ],
          root
        );

        line(
          [V(-1, 3, 0), V(0, 0.1, 0)],
          0xf3ce87,
          0.5,
          root
        );
      } else {
        const referenceField = field(
          root,
          1,
          name === "vortex" ? 1 : 0,
          0.2,
          name === "upper" ? 0xf3ce87 : 0x66efe7
        );

        if (name !== "vortex") {
          referenceField.material.uniforms.uMode.value = 1;
        }

        referenceFields.push({
          name,
          mesh: referenceField
        });

        if (name !== "vortex") {
          const wave = standing(root, 3.5, 2, 0.45);

          wave.material.uniforms.uOffset.value =
            name === "lower" ? Math.PI : 0;

          referenceWaves.push(wave);
        }
      }
    });

    let lastDetuning = NaN;

    function updateSpectrum() {
      if (state.detuning !== lastDetuning) {
        for (let i = 0; i < curveCount; i++) {
          const q = -2 + 4 * i / (curveCount - 1);
          const s = spectrum(q, state.detuning);

          for (const name of ["ec", "ex", "up", "lp"]) {
            curves[name].geometry.attributes.position.setXYZ(
              i,
              q * 6,
              (name === "ex" ? 0 : s[name]) * 2.7,
              0
            );
          }
        }

        for (const object of Object.values(curves)) {
          object.geometry.attributes.position.needsUpdate = true;

          if (object.material.isLineDashedMaterial) {
            object.computeLineDistances();
          }
        }

        lastDetuning = state.detuning;
      }

      const s = spectrum(state.q, state.detuning);

      lpMarker.position.set(
        state.q * 6,
        s.lp * 2.7,
        0.1
      );

      upMarker.position.set(
        state.q * 6,
        s.up * 2.7,
        0.1
      );

      const p = gapLine.geometry.attributes.position;

      p.setXYZ(0, state.q * 6, s.lp * 2.7, 0.05);
      p.setXYZ(1, state.q * 6, s.up * 2.7, 0.05);
      p.needsUpdate = true;

      gapLine.computeLineDistances();
    }

    function updateVisuals(dt) {
      if (state.ell !== state.wantedEll) {
        state.fieldFade = Math.max(
          0,
          state.fieldFade - dt * 2.5
        );

        if (state.fieldFade === 0) {
          state.ell = state.wantedEll;
        }
      } else {
        state.fieldFade = Math.min(
          1,
          state.fieldFade + dt * 2
        );
      }

      const n = pop.n;
      const t = state.visualTime;
      const c0 = spectrum(0, state.detuning).photon;
      const fu = condensate.material.uniforms;

      fu.uN.value = n;
      fu.uEll.value = state.ell;
      fu.uNorm.value = NORMS[state.ell ? 1 : 0];
      fu.uPhase.value = (pop.time * 0.75) % TAU;
      fu.uMode.value = state.field === "density" ? 1 : 0;

      const revealTarget = state.mode === "auto"
        ? (
          state.chapter === 1 || state.chapter === 2
            ? 0.08
            : state.chapter === 3
              ? 0.08 + 0.92 * ease(localProgress)
              : 1
        )
        : 1;

      state.reveal = mix(
        state.reveal,
        revealTarget,
        1 - Math.exp(-dt * 1.8)
      );

      fu.uOpacity.value =
        state.fieldFade * state.reveal;

      for (const material of standingMaterials) {
        material.uniforms.uTime.value = t;
      }

      const bare =
        state.chapter === 1 ? 0.30 :
        state.chapter === 3 ? 0.23 :
        0.08;

      for (const sheet of photonSheets) {
        const uniform = sheet.material.uniforms.uOpacity;

        uniform.value = mix(
          uniform.value,
          bare,
          1 - Math.exp(-dt * 2)
        );
      }

      for (const { name, mesh } of referenceFields) {
        mesh.material.uniforms.uPhase.value =
          (t * 0.4) % TAU;

        if (name !== "vortex") {
          const fraction = name === "lower" ? c0 : 1 - c0;

          mesh.material.uniforms.uTint.value
            .set(0xf18fdc)
            .lerp(photonColor, fraction);
        }
      }

      reservoir.material.uniforms.uOpacity.value =
        0.2 * (1 - Math.exp(-pop.r));

      beamMaterial.opacity = 0.035 * state.pump;

      pumpPoints.material.uniforms.uOpacity.value =
        0.55 * (1 - Math.exp(-state.pump));

      emission.material.uniforms.uOpacity.value =
        0.85 * (1 - Math.exp(-c0 * n));

      const pp = pumpPoints.geometry.attributes.position;

      for (let i = 0; i < pumpSeeds.length; i++) {
        const [offset, a, r] = pumpSeeds[i];
        const u = (offset + t * 0.16) % 1;

        pp.setXYZ(
          i,
          mix(pumpStart.x, pumpEnd.x, u) + Math.cos(a) * r,
          mix(pumpStart.y, pumpEnd.y, u),
          mix(pumpStart.z, pumpEnd.z, u) + Math.sin(a) * r
        );
      }

      pp.needsUpdate = true;

      const ep = emission.geometry.attributes.position;

      for (let i = 0; i < emissionSeeds.length; i++) {
        const [x, z, offset] = emissionSeeds[i];
        const u = (offset + t * 0.075) % 1;

        ep.setXYZ(
          i,
          x * (1 + u * 0.35),
          4.7 + u * 18,
          z * (1 + u * 0.35)
        );
      }

      ep.needsUpdate = true;

      let ai = 0;

      for (const [x, y] of arrowSites) {
        const r2 = x * x + y * y;
        const rho = n * profile(x, y, state.ell);

        if (
          rho < 0.012 ||
          (state.ell && r2 < 0.065)
        ) {
          continue;
        }

        let gx = 0.55 - state.ell * y / r2;
        let gy = 0.08 + state.ell * x / r2;

        const gradientMagnitude = Math.hypot(gx, gy);
        gx /= gradientMagnitude;
        gy /= gradientMagnitude;

        const length =
          0.35 + Math.min(0.3, gradientMagnitude * 0.09);

        const sx = x * FIELD_SCALE;
        const sz = -y * FIELD_SCALE;
        const sy = 0.25 + 0.42 * Math.log(1 + 3 * rho);

        const ex = sx + gx * length;
        const ez = sz - gy * length;

        arrowPositions.set([
          sx, sy, sz,
          ex, sy, ez,

          ex, sy, ez,
          ex - gx * 0.15 + gy * 0.085,
          sy,
          ez + gy * 0.15 + gx * 0.085,

          ex, sy, ez,
          ex - gx * 0.15 - gy * 0.085,
          sy,
          ez + gy * 0.15 - gx * 0.085
        ], ai);

        ai += 18;
      }

      arrowGeometry.setDrawRange(0, ai / 3);
      arrowGeometry.attributes.position.needsUpdate = true;

      arrows.material.opacity =
        0.42 * state.fieldFade * state.reveal;

      updateSpectrum();
    }

    const chapters = [
      [
        55,
        "MICROCAVITY",
        "Where light meets matter.",
        "An optical cavity confines light around a semiconductor quantum well. Two resonances can form new hybrid states.",
        "Mirror dimensions and optical timing are schematic. The quantum fluid is planar.",
        [29, 19, 36],
        [0, 0, 0],
        46,
        ["cavity"]
      ],
      [
        48,
        "PHOTON MODE",
        "Light, confined.",
        "A standing cavity mode places an electric-field antinode at the quantum well. Its in-plane dispersion is approximately parabolic.",
        "Bare-mode overlay: the optical oscillation is slowed for inspection.",
        [8, 2.2, 18],
        [0, 0, 0],
        43,
        ["photon"]
      ],
      [
        48,
        "EXCITON",
        "Matter has a resonance.",
        "An exciton is a bound electron–hole excitation. Its nearly flat reference dispersion contrasts with the lighter cavity mode.",
        "The two markers indicate a correlated pair, not an electron orbit.",
        [-13, 2.3, 17],
        [-7, 0.5, 3],
        40,
        ["exciton"]
      ],
      [
        55,
        "STRONG COUPLING",
        "The eigenstates become hybrid.",
        "The bare-mode overlays give way to a lower-polariton field. Diagonalizing the coupled modes also creates an upper branch.",
        "This is a visual reveal; the reference coupling energy remains ΔR / E₀ = 1.",
        [9, 10, 25],
        [0, 0.5, 0],
        46,
        ["coupling"]
      ],
      [
        65,
        "DISPERSION",
        "A crossing becomes a gap.",
        "The dashed bare modes cross. The upper and lower polariton branches avoid crossing, with a minimum lossless gap of ΔR.",
        "Momentum and energy axes use reference units. A spectral plot is not a physical trajectory.",
        [49, 15, 36],
        [43, 9, -10],
        45,
        ["upper", "lower"]
      ],
      [
        55,
        "MIXED CHARACTER",
        "One state, changing composition.",
        "Follow the lower-branch probe through momentum space. Its photon and exciton fractions change continuously and sum to one.",
        "The probe samples the spectrum. The condensate remains near q = 0.",
        [43, 10, 25],
        [43, 7, -10],
        42,
        ["lower"]
      ],
      [
        42,
        "PUMP / RESERVOIR",
        "Replenishment begins upstream.",
        "A nonresonant pump feeds a reservoir of excitations. Stimulated transfer into the low-energy mode competes with finite loss.",
        "Preparation reset: n_c = 10⁻⁴ and r = 0. This chapter uses a pump below the reference threshold.",
        [-21, 14, 24],
        [-4, 4, 0],
        46,
        ["reservoir"]
      ],
      [
        78,
        "CONDENSATION",
        "A low-energy mode fills.",
        "The pump rises through the population threshold. Reservoir feeding supports an increasingly occupied lower-polariton mode.",
        "The rate equations calculate occupation. Coherent phase and the spatial envelope are prescribed.",
        [15, 11, 25],
        [0, 0.3, 0],
        43,
        ["condensate"]
      ],
      [
        68,
        "QUANTUM FLUID",
        "Read amplitude and phase separately.",
        "Density sets brightness; phase sets hue. The arrows follow the gradient of the displayed analytic phase field.",
        "The surface height encodes density for visibility. It is not a third fluid dimension.",
        [5, 2.5, 17],
        [0, 0.2, 0],
        39,
        ["condensate"]
      ],
      [
        46,
        "VORTEX",
        "A full turn around a depleted core.",
        "The imposed phase winds by 2π around one core. Density vanishes at the center, where phase is undefined.",
        "A prescribed ℓ = +1 vortex is introduced during a field fade. Vortex nucleation is not simulated.",
        [0, 2.6, 10],
        [0, 0.12, 0],
        38,
        ["vortex"]
      ],
      [
        48,
        "EMISSION",
        "The cavity lets us look inside.",
        "The photonic component leaks out as emitted light. Its relative signal follows the low-momentum photon fraction and mode occupation.",
        "J_opt = |C₀|² n_c is a relative optical proxy, not a complete or calibrated condensate measurement.",
        [9, 2.7, 19],
        [0, 5, 0],
        44,
        ["emission"]
      ],
      [
        56,
        "DRIVEN-DISSIPATIVE CYCLE",
        "A fluid maintained by exchange.",
        "Pump → reservoir → lower-polariton mode → emission and loss. Continuous replenishment balances a finite lifetime.",
        "Reference loss and transfer coefficients are held fixed as detuning changes.",
        [25, 20, 31],
        [0, 3, 0],
        46,
        ["reservoir", "emission"]
      ],
      [
        56,
        "FULL SYSTEM",
        "Hybrid states, collective behavior.",
        "Cavity light and a matter resonance form polaritons. A driven low-energy mode connects their quantum character to a collective field.",
        "Analytic spectrum · integrated mode populations · prescribed spatial field.",
        [34, 22, 42],
        [3, 1, 0],
        47,
        ["cavity", "condensate"]
      ]
    ];

    const starts = [0];

    for (const chapter of chapters) {
      starts.push(starts[starts.length - 1] + chapter[0]);
    }

    const duration = starts[13];

    const eyeCurve = new T.CatmullRomCurve3(
      chapters.map(chapter => V(...chapter[5])),
      true,
      "catmullrom",
      0.18
    );

    const aimCurve = new T.CatmullRomCurve3(
      chapters.map(chapter => V(...chapter[6])),
      true,
      "catmullrom",
      0.18
    );

    const scratchCamera = new T.PerspectiveCamera();

    const flightPose = {
      position: V(),
      target: V(),
      quaternion: new T.Quaternion(),
      fov: 46
    };

    let transition = null;
    let localProgress = 0;

    function locate(time) {
      let index = 0;

      while (index < 12 && time >= starts[index + 1]) {
        index++;
      }

      return index;
    }

    function sampleFlight(time, out) {
      const index = locate(time);
      const u =
        (time - starts[index]) / chapters[index][0];

      const t = ease(u);
      const path = (index + t) / 13;

      eyeCurve.getPoint(path, out.position);
      aimCurve.getPoint(path, out.target);

      out.fov = mix(
        chapters[index][7],
        chapters[(index + 1) % 13][7],
        t
      );

      scratchCamera.position.copy(out.position);
      scratchCamera.lookAt(out.target);
      out.quaternion.copy(scratchCamera.quaternion);

      return out;
    }

    function setCaption(
      title,
      description,
      note,
      eyebrow
    ) {
      $("scene-title").textContent = title;
      $("scene-description").textContent = description;
      $("scene-model-note").textContent = note;
      $("chapter-value").textContent = eyebrow;
    }

    function enterChapter(index, prepare = true) {
      state.chapter = index;
      state.inspection = null;

      for (const [name, item] of Object.entries(cardObjects)) {
        item.object.position.copy(cardAnchors[name]);
      }

      const chapter = chapters[index];

      setCaption(
        chapter[2],
        chapter[3],
        chapter[4],
        String(index + 1).padStart(2, "0") +
          " / " + chapter[1]
      );

      document.querySelectorAll("[data-chapter]")
        .forEach(button => {
          const active =
            Number(button.dataset.chapter) === index;

          button.classList.toggle("is-active", active);

          if (active) {
            button.setAttribute("aria-current", "step");
          } else {
            button.removeAttribute("aria-current");
          }
        });

      document.querySelectorAll("[data-inspect]")
        .forEach(button => {
          button.setAttribute("aria-pressed", "false");
        });

      if (prepare && index === 6) {
        pop.reset();
        state.pump = 0.75;

        announce(
          "Pump preparation: occupation seed and reservoir were reset."
        );
      }

      state.wantedEll = index === 9 ? 1 : 0;
      $("vortex-select").value = String(state.wantedEll);

      $("stage-counter").textContent =
        String(index + 1).padStart(2, "0") + " / 13";
    }

    function syncOrbit() {
      orbit.enabled = false;

      orbit.enableDamping = false;
      orbit.update();
      orbit.enableDamping = true;

      controlCamera.copy(camera, false);
      controlCamera.updateProjectionMatrix();

      const direction = V();
      camera.getWorldDirection(direction);

      orbit.target.copy(camera.position)
        .addScaledVector(direction, state.focusDistance);

      orbit.update();

      orbit.enabled =
        state.ready &&
        !state.lost &&
        state.mode === "manual";
    }

    function enterManual() {
      if (!state.ready || state.lost) return;

      if (state.mode !== "manual" || transition) {
        transition = null;
        state.mode = "manual";
        syncOrbit();

        announce(
          "Manual inspection. Model time continues unless paused."
        );
      }

      updateButtons();
    }

    function moveTo(pose, after) {
      transition = {
        from: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        fov: camera.fov,
        position: pose.position.clone(),
        target: pose.target.clone(),
        rotation: pose.quaternion.clone(),
        endFov: pose.fov,
        elapsed: 0,
        duration: 4,
        after,
        lift: Math.min(
          6,
          camera.position.distanceTo(pose.position) * 0.08
        )
      };

      state.mode = "returning";
      orbit.enabled = false;
      updateButtons();
    }

    function resume() {
      if (!state.ready) return;

      state.paused = false;
      state.inspection = null;

      enterChapter(locate(state.tour), false);
      sampleFlight(state.tour, flightPose);
      moveTo(flightPose, "auto");

      announce(
        "Returning smoothly to the guided flight. Playback is enabled."
      );
    }

    function updateCamera(dt) {
      const panelRect =
        $("sidebar-ui").getBoundingClientRect();

      const desiredShift =
        state.hud && state.width > 760
          ? (panelRect.right + 10) / 2
          : 0;

      state.viewShift = mix(
        state.viewShift,
        desiredShift,
        1 - Math.exp(-dt * 5)
      );

      for (const cam of [camera, controlCamera]) {
        cam.aspect = state.width / state.height;

        cam.setViewOffset(
          state.width,
          state.height,
          -state.viewShift,
          0,
          state.width,
          state.height
        );
      }

      if (transition) {
        transition.elapsed += dt;

        const u = ease(
          transition.elapsed / transition.duration
        );

        camera.position.lerpVectors(
          transition.from,
          transition.position,
          u
        );

        camera.position.y +=
          Math.sin(Math.PI * u) ** 2 * transition.lift;

        camera.quaternion.slerpQuaternions(
          transition.quaternion,
          transition.rotation,
          u
        );

        camera.fov = mix(
          transition.fov,
          transition.endFov,
          u
        );

        state.focusDistance =
          camera.position.distanceTo(transition.target);

        if (u === 1 && state.fieldFade > 0.999) {
          state.mode = transition.after;
          transition = null;

          if (state.mode === "manual") {
            syncOrbit();
          }

          updateButtons();
        }
      } else if (state.mode === "auto") {
        sampleFlight(state.tour, flightPose);

        camera.position.copy(flightPose.position);
        camera.quaternion.copy(flightPose.quaternion);
        camera.fov = flightPose.fov;

        state.focusDistance =
          camera.position.distanceTo(flightPose.target);
      } else {
        orbit.update();

        const f = 1 - Math.exp(-dt * 13);

        camera.position.lerp(controlCamera.position, f);
        camera.quaternion.slerp(controlCamera.quaternion, f);
        camera.fov = controlCamera.fov;

        state.focusDistance =
          camera.position.distanceTo(orbit.target);
      }

      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
    }

    const cardObjects = {};

    const cardAnchors = {
      cavity: V(10, 3.8, 2),
      photon: V(1, 1.2, 0),
      exciton: V(-7, 0.7, 3),
      coupling: V(0, 1.5, 0),
      upper: V(43, 10, -10),
      lower: V(43, 6, -10),
      reservoir: V(-2, 1.2, -1),
      condensate: V(1, 0.6, 0),
      vortex: V(0, 0.15, 0),
      emission: V(1, 9, 0)
    };

    for (const name of Object.keys(cardAnchors)) {
      const element = $(name + "-card-template")
        .content.firstElementChild.cloneNode(true);

      const card = element.querySelector(".world-card");

      labels.domElement.appendChild(element);

      const object = new T.CSS2DObject(element);
      object.position.copy(cardAnchors[name]);
      scene.add(object);

      const leader = document.createElementNS(
        leaderSVG.namespaceURI,
        "line"
      );

      leaderSVG.appendChild(leader);

      cardObjects[name] = {
        object,
        element,
        card,
        leader,
        fade: 0,
        screen: V(),
        w: 278,
        h: 240
      };

      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    const tags = [];

    function tag(text, position, kind) {
      const el = document.createElement("span");
      el.className = "world-tag";
      el.textContent = text;
      el.setAttribute("aria-hidden", "true");

      const object = new T.CSS2DObject(el);
      object.position.copy(position);
      scene.add(object);

      tags.push({ object, kind });
    }

    tag("UPPER DBR", V(12, 4.5, -8), "cavity");
    tag("QUANTUM WELL", V(12, 0, -8), "cavity");
    tag("LOWER DBR", V(12, -4.5, -8), "cavity");
    tag("NONRESONANT PUMP", pumpStart.clone(), "pump");

    tag("q = k / k*", V(43, -4.5, -10), "board");
    tag("(E − Eₓ) / E₀", V(29, 25, -10), "board");

    for (const q of [-2, 0, 2]) {
      tag(String(q), V(43 + q * 6, -2, -10), "board");
    }

    for (const e of [-2, 0, 2, 4, 6]) {
      tag(
        String(e),
        V(29, 7 + e * 2.7, -10),
        "board"
      );
    }

    for (const [name, position] of Object.entries(
      inspectionPositions
    )) {
      tag(
        name.toUpperCase(),
        position.clone().add(V(0, -2.4, 0)),
        "shelf"
      );
    }

    const hudObstacles = [];
    let labelClock = 0;
    let activeCards = [];

    function overlaps(a, b, pad = 10) {
      return (
        a.x < b.x + b.w + pad &&
        a.x + a.w + pad > b.x &&
        a.y < b.y + b.h + pad &&
        a.y + a.h + pad > b.y
      );
    }

    function layoutLabels(dt) {
      labelClock += dt;

      if (labelClock > 0.12) {
        labelClock = 0;
        hudObstacles.length = 0;

        if (state.hud) {
          for (const id of [
            "sidebar-ui",
            "flight-controls",
            "scene-caption",
            "reference-legend"
          ]) {
            const el = $(id);
            const r = el.getBoundingClientRect();

            if (
              r.width &&
              r.height &&
              getComputedStyle(el).display !== "none"
            ) {
              hudObstacles.push({
                x: r.left,
                y: r.top,
                w: r.width,
                h: r.height
              });
            }
          }
        }

        activeCards = state.inspection
          ? [state.inspection]
          : chapters[state.chapter][8];
      }

      const occupied = hudObstacles.slice();
      const maxCards = state.width < 1000 ? 1 : 2;
      let placed = 0;

      if (!state.inspection) {
        cardObjects.upper.object.position
          .copy(board.position)
          .add(upMarker.position);

        cardObjects.lower.object.position
          .copy(board.position)
          .add(lpMarker.position);
      }

      for (const [name, item] of Object.entries(cardObjects)) {
        const wanted =
          state.hud &&
          activeCards.includes(name) &&
          placed < maxCards;

        item.object.updateMatrixWorld();
        item.screen.copy(item.object.position).project(camera);

        const onScreen =
          item.screen.z > -1 &&
          item.screen.z < 1 &&
          Math.abs(item.screen.x) < 1.05 &&
          Math.abs(item.screen.y) < 1.05;

        let chosen = null;

        if (wanted && onScreen) {
          const x =
            (item.screen.x * 0.5 + 0.5) * state.width;

          const y =
            (-item.screen.y * 0.5 + 0.5) * state.height;

          const w = item.w;
          const h = item.h;

          const positions = [
            [x + 25, y - h * 0.5],
            [x - w - 25, y - h * 0.5],
            [x - w * 0.5, y - h - 28],
            [x - w * 0.5, y + 28],
            [state.width - w - 22, 85]
          ];

          for (const p of positions) {
            const r = {
              x: clamp(p[0], 12, state.width - w - 12),
              y: clamp(p[1], 78, state.height - h - 15),
              w,
              h
            };

            if (
              r.y < 0 ||
              r.y + h > state.height - 12 ||
              occupied.some(o => overlaps(r, o))
            ) {
              continue;
            }

            chosen = r;
            occupied.push(r);
            placed++;

            item.card.style.setProperty(
              "--card-x",
              (r.x - x) + "px"
            );

            item.card.style.setProperty(
              "--card-y",
              (r.y - y) + "px"
            );

            const endX = clamp(x, r.x, r.x + w);
            const endY = clamp(y, r.y, r.y + h);

            item.leader.setAttribute("x1", String(x));
            item.leader.setAttribute("y1", String(y));
            item.leader.setAttribute("x2", String(endX));
            item.leader.setAttribute("y2", String(endY));

            break;
          }
        }

        const visible = !!chosen;

        item.fade = mix(
          item.fade,
          visible ? 1 : 0,
          1 - Math.exp(-dt * 9)
        );

        item.object.visible =
          onScreen && item.fade > 0.005;

        item.element.style.opacity = String(item.fade);

        item.element.classList.toggle(
          "is-visible",
          item.fade > 0.01
        );

        if (
          !visible &&
          item.element.contains(document.activeElement)
        ) {
          $("hud-toggle").focus();
        }

        item.element.inert = !visible;

        item.element.setAttribute(
          "aria-hidden",
          String(!visible)
        );

        item.card.style.pointerEvents =
          visible ? "auto" : "none";

        item.leader.style.opacity =
          String(visible ? item.fade : 0);
      }

      for (const item of tags) {
        const dist =
          camera.position.distanceTo(item.object.position);

        item.object.visible = state.hud && (
          (
            item.kind === "board" &&
            dist < 65 &&
            (state.chapter === 4 || state.chapter === 5)
          ) ||
          (
            item.kind === "shelf" &&
            dist < 24
          ) ||
          (
            item.kind === "cavity" &&
            dist < 42 &&
            (state.chapter === 0 || state.chapter === 12)
          ) ||
          (
            item.kind === "pump" &&
            dist < 50 &&
            (state.chapter === 6 || state.chapter === 11)
          )
        );
      }

      labels.render(scene, camera);
    }

    const graph = $("dispersion-chart");
    const ctx = graph.getContext("2d");

    if (!ctx) {
      throw new Error(
        "The dispersion chart could not obtain a 2D context."
      );
    }

    function drawChart() {
      const rect = graph.getBoundingClientRect();
      const w = Math.max(160, rect.width);
      const h = w / 2;
      const ratio = Math.min(2, devicePixelRatio || 1);

      const pw = Math.round(w * ratio);
      const ph = Math.round(h * ratio);

      if (graph.width !== pw || graph.height !== ph) {
        graph.width = pw;
        graph.height = ph;
      }

      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const left = 27;
      const top = 9;
      const cw = w - 36;
      const ch = h - 32;

      const X = q => left + (q + 2) * cw / 4;
      const Y = e => top + (6.4 - e) * ch / 9.1;

      ctx.font = "8px monospace";
      ctx.lineWidth = 0.6;
      ctx.fillStyle = "#9eb0c6";
      ctx.strokeStyle = "#263b51";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";

      for (const e of [-2, 0, 2, 4, 6]) {
        const y = Y(e);

        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(w - 9, y);
        ctx.stroke();
        ctx.fillText(String(e), left - 6, y);
      }

      ctx.textAlign = "center";
      ctx.textBaseline = "top";

      for (const q of [-2, -1, 0, 1, 2]) {
        ctx.fillText(String(q), X(q), top + ch + 6);
      }

      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, cw, ch);
      ctx.clip();

      for (const [name, color, dash, width] of [
        ["ec", "#65b5ff", [4, 3], 1],
        ["ex", "#f18fdc", [1, 3], 1.2],
        ["up", "#f3ce87", [], 1.2],
        ["lp", "#66f5ed", [], 2]
      ]) {
        ctx.strokeStyle = color;
        ctx.setLineDash(dash);
        ctx.lineWidth = width;
        ctx.beginPath();

        for (let i = 0; i <= 140; i++) {
          const q = -2 + i / 35;
          const s = spectrum(q, state.detuning);
          const energy = name === "ex" ? 0 : s[name];

          if (i === 0) {
            ctx.moveTo(X(q), Y(energy));
          } else {
            ctx.lineTo(X(q), Y(energy));
          }
        }

        ctx.stroke();
      }

      const s = spectrum(state.q, state.detuning);

      ctx.setLineDash([2, 3]);
      ctx.strokeStyle = "#bed4e777";
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(X(state.q), top);
      ctx.lineTo(X(state.q), top + ch);
      ctx.stroke();
      ctx.setLineDash([]);

      for (const [energy, color] of [
        [s.lp, "#a0fff4"],
        [s.up, "#ffdea6"]
      ]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(X(state.q), Y(energy), 2.5, 0, TAU);
        ctx.fill();
      }

      ctx.restore();
    }

    const format = (value, digits = 3) => {
      if (!Number.isFinite(value)) return "—";

      if (Math.abs(value) < 1e-3 && value !== 0) {
        return value.toExponential(2);
      }

      return value.toFixed(digits);
    };

    function updateButtons() {
      const mode =
        state.mode === "auto" ? "AUTOMATIC DRONE" :
        state.mode === "returning" ? "RETURNING" :
        "MANUAL";

      $("flight-mode").textContent =
        state.paused ? mode + " / PAUSED" : mode;

      $("flight-mode").dataset.mode =
        state.paused ? "paused" :
        state.mode === "auto" ? "auto" :
        state.mode;

      $("pause-toggle").setAttribute(
        "aria-pressed",
        String(state.paused)
      );

      $("pause-label").textContent =
        state.paused ? "Play" : "Pause";

      $("hud-toggle").setAttribute(
        "aria-pressed",
        String(!state.hud)
      );

      $("hud-label").textContent =
        state.hud ? "Hide HUD" : "Show HUD";
    }

    function updateHUD() {
      const s = spectrum(state.q, state.detuning);
      const c0 = spectrum(0, state.detuning).photon;
      const n = pop.n;

      const values = {
        "photon-fraction-value":
          (s.photon * 100).toFixed(1) + "%",

        "exciton-fraction-value":
          (s.exciton * 100).toFixed(1) + "%",

        "photon-energy-value": format(s.ec),
        "exciton-energy-value": "0.000",
        "lp-energy-value": format(s.lp),
        "up-energy-value": format(s.up),
        "probe-detuning-value": format(s.ec),
        "rabi-value": "ΔR / E₀ = 1.00",

        "population-value": format(n),
        "reservoir-value": format(pop.r),
        "net-gain-value": format(pop.r - 1),
        "emission-value": format(c0 * n),

        "condensate-photon-value":
          (100 * c0).toFixed(1) + "%",

        "winding-value":
          state.fieldFade < 0.999
            ? "fading"
            : String(state.ell),

        "simulation-time-value": pop.time.toFixed(1),

        "pump-regime":
          state.pump > 1 ? "ABOVE THRESHOLD" :
          state.pump < 1 ? "BELOW THRESHOLD" :
          "AT THRESHOLD"
      };

      const phase =
        0.55 * 0.7 +
        0.08 * 0.2 +
        state.ell * Math.atan2(0.2, 0.7) -
        pop.time * 0.75;

      values["phase-value"] =
        n * profile(0.7, 0.2, state.ell) > 1e-9
          ? Math.atan2(
            Math.sin(phase),
            Math.cos(phase)
          ).toFixed(3)
          : "undefined";

      for (const [id, text] of Object.entries(values)) {
        $(id).textContent = text;
      }

      $("photon-fill").style.width = s.photon * 100 + "%";
      $("exciton-fill").style.width = s.exciton * 100 + "%";

      for (const [id, value] of [
        ["detuning", state.detuning],
        ["momentum", state.q],
        ["pump", state.pump]
      ]) {
        $(id + "-setting").value = value.toFixed(2);

        const control = $(id + "-control");

        if (document.activeElement !== control) {
          control.value = String(value);
        }

        control.setAttribute(
          "aria-valuetext",
          value.toFixed(2)
        );
      }

      const progress = 100 * state.tour / duration;
      $("flight-progress").style.width = progress + "%";

      $("journey-progress").setAttribute(
        "aria-valuenow",
        progress.toFixed(1)
      );

      const seconds = Math.floor(state.tour);

      $("tour-time").textContent =
        String(Math.floor(seconds / 60)).padStart(2, "0") +
        ":" +
        String(seconds % 60).padStart(2, "0");

      $("model-status").textContent =
        transition ? "Camera transition" :
        state.paused ? "Time paused" :
        "Reference model running";

      $("display-status").textContent =
        (hdr ? "HDR" : "WEBGL") +
        " · " +
        state.dpr.toFixed(1) +
        "×";

      drawChart();
    }

    function resize() {
      state.width = Math.max(1, host.clientWidth);
      state.height = Math.max(1, host.clientHeight);

      state.dpr = Math.min(
        devicePixelRatio || 1,
        1.5,
        Math.sqrt(
          2400000 / (state.width * state.height)
        )
      );

      renderer.setPixelRatio(state.dpr);
      renderer.setSize(state.width, state.height, false);

      composer.setPixelRatio(state.dpr);
      composer.setSize(state.width, state.height);

      bloom.setSize(
        Math.max(
          1,
          Math.round(state.width * state.dpr * 0.65)
        ),
        Math.max(
          1,
          Math.round(state.height * state.dpr * 0.65)
        )
      );

      fxaa.uniforms.resolution.value.set(
        1 / (state.width * state.dpr),
        1 / (state.height * state.dpr)
      );

      labels.setSize(state.width, state.height);

      for (const item of Object.values(cardObjects)) {
        const previous = item.element.style.display;
        item.element.style.display = "";

        item.w = item.card.offsetWidth || 278;
        item.h = item.card.offsetHeight || 240;

        item.element.style.display = previous;
      }

      leaderSVG.setAttribute(
        "viewBox",
        "0 0 " + state.width + " " + state.height
      );

      for (const material of pointMaterials) {
        material.uniforms.uPixelRatio.value = state.dpr;
      }

      for (const cam of [camera, controlCamera]) {
        cam.aspect = state.width / state.height;
        cam.updateProjectionMatrix();
      }
    }

    function setHUD(visible) {
      state.hud = visible;
      const active = document.activeElement;

      if (
        !visible &&
        (
          $("sidebar-ui").contains(active) ||
          labels.domElement.contains(active)
        )
      ) {
        $("hud-toggle").focus();
      }

      body.classList.toggle("hud-hidden", !visible);

      for (const el of document.querySelectorAll(".hud-region")) {
        el.inert = !visible;
      }

      labels.domElement.inert = !visible;
      updateButtons();

      announce(
        visible ? "Interface shown." : "Interface hidden."
      );
    }

    function setField(value) {
      state.field = value;
      body.dataset.field = value;
      $("field-select").value = value;

      $("legend-field-note").textContent =
        value === "phase" ? "PHASE + DENSITY" : "DENSITY";

      const paragraphs =
        $("reference-legend").querySelectorAll("p");

      paragraphs[0].textContent =
        value === "phase"
          ? "Hue → phase · brightness → density"
          : "Brightness → normalized density";
    }

    function pause() {
      state.paused = !state.paused;
      updateButtons();

      announce(
        state.paused
          ? "Model and tour paused. Manual camera controls remain available."
          : "Playback resumed."
      );
    }

    for (const event of [
      "pointerdown",
      "touchstart",
      "wheel"
    ]) {
      canvas.addEventListener(
        event,
        enterManual,
        { capture: true, passive: true }
      );
    }

    $("hud-toggle").addEventListener("click", () => {
      setHUD(!state.hud);
    });

    $("pause-toggle").addEventListener("click", pause);
    $("resume-flight").addEventListener("click", resume);

    for (const [id, keyName] of [
      ["detuning-control", "detuning"],
      ["momentum-control", "q"],
      ["pump-control", "pump"]
    ]) {
      $(id).addEventListener("input", event => {
        enterManual();
        state[keyName] = Number(event.target.value);
        updateHUD();
      });
    }

    $("field-select").addEventListener("change", event => {
      enterManual();
      setField(event.target.value);
    });

    $("vortex-select").addEventListener("change", event => {
      enterManual();
      state.wantedEll = Number(event.target.value);

      announce(
        "Changing the prescribed winding to " +
        state.wantedEll +
        " during a field fade."
      );
    });

    $("population-reset").addEventListener("click", () => {
      enterManual();
      pop.reset();
      updateHUD();

      announce(
        "Populations reset to the documented seed. Pump and pause settings were retained."
      );
    });

    document.querySelectorAll("[data-chapter]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.chapter);

          state.tour =
            starts[index] + chapters[index][0] * 0.15;

          enterChapter(index, true);

          if (index === 7) {
            pop.reset();

            announce(
              "Condensation demonstration prepared with the documented seed."
            );

            $("scene-model-note").textContent =
              "Preparation reset: n_c = 10⁻⁴, r = 0. Coherent spatial phase is prescribed.";
          }

          state.pump =
            index === 6 ? 0.75 :
            index === 7 ? 2.2 :
            1.6;

          sampleFlight(state.tour, flightPose);
          moveTo(flightPose, "manual");
        });
      });

    document.querySelectorAll("[data-inspect]")
      .forEach(button => {
        button.addEventListener("click", () => {
          const name = button.dataset.inspect;
          const target = inspectionPositions[name];

          state.inspection = name;

          for (const [keyName, item] of Object.entries(
            cardObjects
          )) {
            item.object.position.copy(
              keyName === name
                ? target
                : cardAnchors[keyName]
            );
          }

          const position = target.clone().add(V(5, 4.4, 8));

          scratchCamera.position.copy(position);
          scratchCamera.lookAt(target);

          moveTo({
            position,
            target,
            quaternion: scratchCamera.quaternion,
            fov: 40
          }, "manual");

          const card = cardObjects[name].card;

          setCaption(
            card.querySelector("h3").textContent,
            card.querySelector(
              "p:not(.card-kicker):not(.card-note)"
            ).textContent.trim(),
            "Reference schematic. Field glyphs use unit reference occupation; live population readouts still describe the main cavity.",
            "REFERENCE / " + name.toUpperCase()
          );

          document.querySelectorAll("[data-inspect]")
            .forEach(other => {
              other.setAttribute(
                "aria-pressed",
                String(other === button)
              );
            });

          announce("Inspecting " + name + ".");
        });
      });

    document.addEventListener("keydown", event => {
      if (
        !state.ready ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      if (
        event.target instanceof Element &&
        event.target.closest(
          "input,select,textarea,button,a,summary,[contenteditable='true']"
        )
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        pause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resume();
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        setHUD(!state.hud);
      }
    });

    let lastTime = 0;
    let hudClock = 0;
    let resizePending = true;
    let raf = 0;

    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
          resizePending = true;
        })
        : null;

    if (observer) {
      observer.observe(host);
    }

    window.addEventListener("resize", () => {
      resizePending = true;
    });

    document.addEventListener("visibilitychange", () => {
      lastTime = 0;
    });

    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();

      state.lost = true;
      state.ready = false;
      orbit.enabled = false;

      gate(false);
      $("render-notice").hidden = false;

      $("notice-title").textContent =
        "Graphics context interrupted";

      $("notice-message").textContent =
        "The model is paused while the browser restores graphics access.";

      $("notice-detail").textContent =
        "Your parameters and population state are retained. Reload if recovery does not complete.";

      $("notice-reload").hidden = false;

      $("model-status").textContent =
        "Waiting for graphics recovery";

      announce(
        "Graphics context lost. Waiting for restoration."
      );
    });

    canvas.addEventListener("webglcontextrestored", () => {
      try {
        state.lost = false;
        lastTime = 0;

        composer.reset();
        resizePending = true;

        $("notice-title").textContent =
          "Restoring the microcavity";

        $("notice-message").textContent =
          "Rebuilding graphics resources and checking the first frame.";
      } catch (error) {
        fail(error);
      }
    });

    function frame(timestamp) {
      raf = requestAnimationFrame(frame);

      if (state.failed) {
        cancelAnimationFrame(raf);
        return;
      }

      if (state.lost || document.hidden) {
        lastTime = 0;
        return;
      }

      try {
        const dt = lastTime
          ? Math.min(
            0.05,
            Math.max(0, (timestamp - lastTime) / 1000)
          )
          : 0;

        lastTime = timestamp;

        if (resizePending) {
          resize();
          resizePending = false;
        }

        if (
          state.ready &&
          !state.paused &&
          !transition
        ) {
          state.visualTime += dt;

          if (state.mode === "auto") {
            state.tour = (state.tour + dt) % duration;

            const index = locate(state.tour);

            if (index !== state.chapter) {
              enterChapter(index, true);
            }

            localProgress =
              (state.tour - starts[index]) /
              chapters[index][0];

            const desiredPump =
              index === 6 ? 0.75 :
              index === 7
                ? 0.75 + 1.45 * ease(localProgress * 1.5)
                : 1.6;

            state.pump = mix(
              state.pump,
              desiredPump,
              1 - Math.exp(-dt * 2)
            );

            const desiredQ =
              index === 5
                ? 1.7 * Math.sin(TAU * localProgress)
                : 0;

            state.q = mix(
              state.q,
              desiredQ,
              1 - Math.exp(-dt * 5)
            );
          }

          pop.advance(dt * 0.75, state.pump);
        }

        updateVisuals(dt);
        updateCamera(dt);
        scene.updateMatrixWorld();

        composer.render(dt);
        layoutLabels(dt);

        hudClock += dt;

        if (hudClock > 0.1 || !state.ready) {
          hudClock = 0;
          updateHUD();
        }

        if (!state.ready) {
          const programs = renderer.info.programs || [];

          if (programs.some(program =>
            program.diagnostics &&
            program.diagnostics.runnable === false
          )) {
            throw new Error(
              "A graphics shader failed to compile on this device."
            );
          }

          if (gl.isContextLost()) return;

          state.ready = true;
          body.classList.remove(
            "is-loading",
            "render-failed"
          );

          $("render-notice").hidden = true;
          gate(true);

          orbit.enabled = state.mode === "manual";
          updateButtons();

          announce(
            state.paused
              ? "Ready. Reduced motion is respected; press Play to begin."
              : "Polariton observatory ready."
          );
        }
      } catch (error) {
        fail(error);
      }
    }

    state.orbit = orbit;

    state.start = () => {
      resize();
      sampleFlight(0, flightPose);

      camera.position.copy(flightPose.position);
      camera.quaternion.copy(flightPose.quaternion);
      camera.fov = flightPose.fov;
      camera.updateProjectionMatrix();

      state.focusDistance =
        camera.position.distanceTo(flightPose.target);

      enterChapter(0, false);
      setField("phase");
      updateButtons();
      syncOrbit();
      updateVisuals(0);

      renderer.compile(scene, camera);
      raf = requestAnimationFrame(frame);
    };

    return state;
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      boot,
      { once: true }
    );
  } else {
    boot();
  }
})();