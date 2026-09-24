/* ER = EPR · Holographic Entanglement Observatory
 * Three.js r128.
 *
 * BTZ geometry and RT geodesics are calculated static references.
 * The finite TFD laboratory is a separate eight-level teaching model.
 * Traversability is a scripted, GJW-inspired explanatory protocol.
 * It does not solve gravitational backreaction or integrate null geodesics.
 */
(() => {
  "use strict";

  const PI = Math.PI;
  const TAU = 2 * PI;
  const CUTOFF = 12;

  const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => {
    t = clamp(t);
    return t * t * t * (t * (6 * t - 15) + 10);
  };
  const segment = (t, a, b) => clamp((t - a) / (b - a));
  const $ = id => document.getElementById(id);

  const text = (id, value) => {
    const node = $(id);
    if (node && node.textContent !== value) node.textContent = value;
  };

  const clock = t =>
    String(Math.floor(t / 60)).padStart(2, "0") + ":" +
    String(Math.floor(t % 60)).padStart(2, "0");

  let app;

  function calculateBTZ(q, delta) {
    const rhoC = Math.acosh(CUTOFF / q);
    const a = q * delta / 2;
    const length = 2 * Math.asinh(CUTOFF / q * Math.sinh(a));
    const rhoStar = Math.atanh(Math.tanh(rhoC) / Math.cosh(a));

    const weights = Array.from(
      { length: 8 },
      (_, n) => Math.exp(-PI * n / q)
    );

    const partition = weights.reduce((sum, p) => sum + p, 0);
    const probabilities = weights.map(p => p / partition);

    return {
      q,
      delta,
      rhoC,
      a,
      length,
      beta: TAU / q,
      intervalEntropy: length / 6,
      leftEntropy: PI * q / 3,
      turning: Math.cosh(rhoStar),
      probabilities,
      toyEntropy: -probabilities.reduce(
        (sum, p) => sum + p * Math.log(p),
        0
      )
    };
  }

  function rtPoint(f, model) {
    // Hyperboloid interpolation gives equal fractions of BTZ proper length.
    const denominator = Math.sinh(model.length);
    const wa = Math.sinh((1 - f) * model.length) / denominator;
    const wb = Math.sinh(f * model.length) / denominator;
    const sum = wa + wb;

    return {
      rho: Math.asinh(Math.sinh(model.rhoC) * sum),
      phi: Math.atanh((wb - wa) * Math.tanh(model.a) / sum) / model.q
    };
  }

  function sampleProtocol(kind, time) {
    const t = clamp(time);
    const coupled = kind === "coupled";
    const trial = kind === "trial";
    const u = segment(t, 0.28, 0.42);

    // The pulse history is an analytic integral of the prescribed sin² pulse.
    // Completion is a narrative prerequisite, not a physical sufficiency test.
    const dose = coupled ? u - Math.sin(TAU * u) / TAU : 0;
    const pulse = coupled && t > 0.28 && t < 0.42
      ? Math.sin(PI * u) ** 2
      : 0;

    const applied = coupled && dose >= 1 - 1e-9;
    const launched =
      (coupled && t >= 0.10) ||
      (trial && t >= 0.08);

    const admitted = launched && applied && t >= 0.44;
    const open = admitted && t < 0.86;
    const received = admitted && t >= 0.80;
    const failed = trial && t >= 0.70;

    let progress = 0;
    let phase = "uncoupled";
    let step = "prepare";

    if (trial) {
      progress = segment(t, 0.08, 0.70);
      phase = failed ? "blocked" : "uncoupled";
      step = failed ? "close" : launched ? "inject" : "prepare";
    }

    if (coupled) {
      progress = t < 0.44
        ? 0.36 * segment(t, 0.10, 0.28)
        : 0.36 + 0.64 * segment(t, 0.44, 0.80);

      if (t >= 0.10) step = "inject";

      if (t >= 0.28) {
        phase = "coupling";
        step = "couple";
      }

      if (t >= 0.42) phase = "deformation";

      if (t >= 0.44) {
        phase = "window";
        step = "window";
      }

      if (t >= 0.80) {
        phase = "received";
        step = "receive";
      }

      if (t >= 0.86) {
        phase = "closed";
        step = "close";
      }
    }

    const negativeCue = coupled && t >= 0.34 && t < 0.60;

    const signalAlpha = launched
      ? trial
        ? 1 - ease(segment(t, 0.70, 0.79))
        : 1 - ease(segment(t, 0.82, 0.92))
      : 0;

    return {
      kind,
      time: t,
      coupled,
      trial,
      dose,
      pulse,
      applied,
      launched,
      admitted,
      open,
      received,
      failed,
      progress,
      phase,
      step,
      negativeCue,
      signalAlpha
    };
  }

  function gate(enabled) {
    document.querySelectorAll("[data-engine-control]").forEach(node => {
      node.disabled = !enabled;
    });
  }

  function notice(title, message, detail, reload = false) {
    text("notice-title", title);
    text("notice-message", message);
    text("notice-detail", detail);
    $("render-notice").hidden = false;
    $("notice-reload").hidden = !reload;
  }

  function fail(error) {
    if (app) {
      app.failed = true;
      app.ready = false;
      if (app.orbit) app.orbit.enabled = false;
    }

    gate(false);
    document.body.classList.remove("is-loading");
    document.body.classList.add("render-failed");

    notice(
      "The observatory could not render",
      "Check WebGL availability and the Three.js library connection, then reload.",
      String(error && error.message || error),
      true
    );

    text("model-status", "Renderer unavailable");
  }

  function boot() {
    $("notice-reload").addEventListener("click", () => location.reload());

    try {
      if (!window.THREE) {
        throw new Error("The Three.js core library did not load.");
      }

      [
        "OrbitControls",
        "CSS2DRenderer",
        "CSS2DObject",
        "EffectComposer",
        "RenderPass",
        "ShaderPass",
        "UnrealBloomPass",
        "CopyShader",
        "LuminosityHighPassShader",
        "FXAAShader"
      ].forEach(name => {
        if (!THREE[name]) {
          throw new Error("Missing Three.js dependency: " + name);
        }
      });

      app = createApp();
      app.start();
    } catch (error) {
      fail(error);
    }
  }

  function createApp() {
    const T = THREE;
    const vec = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
    const motion = matchMedia("(prefers-reduced-motion: reduce)");

    const state = {
      ready: false,
      failed: false,
      lost: false,
      paused: motion.matches,
      manual: false,
      manualContext: "",
      hidden: false,
      view: "combined",
      wedge: true,
      correlations: true,
      q: 1.5,
      delta: 1.3,
      modelDirty: true,
      tour: 0,
      chapter: -1,
      owner: "tour",
      episode: { kind: "idle", time: 0 },
      transition: null,
      width: 1,
      height: 1,
      dpr: 1,
      last: 0,
      uiClock: 0,
      modelClock: 0
    };

    let model = calculateBTZ(state.q, state.delta);
    let protocol = sampleProtocol("idle", 0);

    const container = $("canvas-container");
    const canvas = document.createElement("canvas");

    const options = {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: "high-performance"
    };

    const gl =
      canvas.getContext("webgl2", options) ||
      canvas.getContext("webgl", options);

    if (!gl) throw new Error("No WebGL context could be created.");

    const renderer = new T.WebGLRenderer({
      canvas,
      context: gl,
      ...options
    });

    renderer.setClearColor(0x02050b, 1);
    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.debug.checkShaderErrors = true;

    canvas.setAttribute("aria-hidden", "true");
    container.appendChild(canvas);

    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0x030711, 0.009);

    const camera = new T.PerspectiveCamera(48, 1, 0.08, 210);
    camera.position.set(35, 22, 39);
    camera.lookAt(0, 0, 0);

    const controlCamera = camera.clone();
    const poseCamera = camera.clone();
    const orbit = new T.OrbitControls(controlCamera, canvas);

    state.orbit = orbit;
    orbit.enabled = false;
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.075;
    orbit.rotateSpeed = 0.5;
    orbit.zoomSpeed = 0.7;
    orbit.panSpeed = 0.7;
    orbit.minDistance = 1.2;
    orbit.maxDistance = 110;
    orbit.maxPolarAngle = PI * 0.96;

    const hdr =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("EXT_color_buffer_float");

    const renderTarget = new T.WebGLRenderTarget(1, 1, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType,
      format: T.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(renderer, renderTarget);
    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      0.54,
      0.45,
      0.7
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
          gl_Position = projectionMatrix * modelViewMatrix *
            vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        varying vec2 vUv;

        vec3 aces(vec3 x) {
          return clamp(
            (x * (2.51 * x + 0.03)) /
            (x * (2.43 * x + 0.59) + 0.14),
            0.0,
            1.0
          );
        }

        vec3 srgb(vec3 x) {
          return mix(
            12.92 * x,
            1.055 * pow(x, vec3(1.0 / 2.4)) - 0.055,
            step(vec3(0.0031308), x)
          );
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;
          gl_FragColor = vec4(srgb(aces(color)), 1.0);
        }
      `
    });

    composer.addPass(output);

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    const labelRenderer = new T.CSS2DRenderer();
    labelRenderer.domElement.className = "label-layer";
    labelRenderer.domElement.style.pointerEvents = "none";
    $("observatory").appendChild(labelRenderer.domElement);

    const SVG = "http://www.w3.org/2000/svg";
    const leaders = document.createElementNS(SVG, "svg");
    leaders.classList.add("world-leaders");
    leaders.setAttribute("aria-hidden", "true");
    $("observatory").appendChild(leaders);

    const colors = {
      left: 0x58eddd,
      right: 0xaa86ff,
      blue: 0x5798f1,
      gold: 0xf1ce8a,
      pink: 0xef83cf
    };

    const focus = vec();
    const scratch = vec();
    const projected = vec();

    const bulk = new T.Group();
    const information = new T.Group();
    const causal = new T.Group();
    scene.add(bulk, information, causal);

    const X_SCALE = 4.8;
    const R_SCALE = 0.7;

    function coordinate(rho, phi, target = vec()) {
      const radius = R_SCALE * model.q * Math.cosh(rho);

      return target.set(
        X_SCALE * rho,
        radius * Math.cos(phi),
        radius * Math.sin(phi)
      );
    }

    function makeLine(color, opacity = 1, parent = bulk) {
      const object = new T.Line(
        new T.BufferGeometry(),
        new T.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: T.AdditiveBlending
        })
      );

      object.frustumCulled = false;
      parent.add(object);
      return object;
    }

    function setLine(object, points) {
      const values = object.geometry.attributes.position;

      if (values && values.count === points.length) {
        points.forEach((p, i) => values.setXYZ(i, p.x, p.y, p.z));
        values.needsUpdate = true;
      } else {
        object.geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(
            points.flatMap(p => [p.x, p.y, p.z]),
            3
          )
        );
      }

      object.geometry.computeBoundingSphere();
    }

    const NX = 96;
    const NP = 112;

    const shellGeometry = new T.BufferGeometry();
    const shellPositions = new Float32Array((NX + 1) * (NP + 1) * 3);
    const shellUV = new Float32Array((NX + 1) * (NP + 1) * 2);
    const shellIndices = [];

    for (let i = 0; i <= NX; i++) {
      for (let j = 0; j <= NP; j++) {
        const k = i * (NP + 1) + j;
        shellUV[2 * k] = i / NX;
        shellUV[2 * k + 1] = j / NP;

        if (i < NX && j < NP) {
          const b = k + NP + 1;
          shellIndices.push(k, b, k + 1, b, b + 1, k + 1);
        }
      }
    }

    shellGeometry.setAttribute(
      "position",
      new T.BufferAttribute(shellPositions, 3)
    );
    shellGeometry.setAttribute("uv", new T.BufferAttribute(shellUV, 2));
    shellGeometry.setIndex(shellIndices);

    const shellMaterial = new T.ShaderMaterial({
      uniforms: {
        rhoC: { value: model.rhoC },
        opacity: { value: 0.65 }
      },
      side: T.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix *
            vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float rhoC;
        uniform float opacity;
        varying vec2 vUv;

        void main() {
          float rho = (vUv.x * 2.0 - 1.0) * rhoC;

          float longitude = pow(
            0.5 + 0.5 * cos(vUv.y * 6.28318530718 * 40.0),
            58.0
          );

          float latitude = pow(
            0.5 + 0.5 * cos(rho * 6.28318530718 * 2.0),
            54.0
          );

          float grid = max(longitude, latitude);
          float middle = exp(-rho * rho * 1.4);

          vec3 tint = mix(
            vec3(0.07, 0.63, 0.69),
            vec3(0.45, 0.23, 0.84),
            vUv.x
          );

          tint = mix(
            tint,
            vec3(0.17, 0.34, 0.6),
            middle * 0.5
          );

          float rim = 0.7 +
            0.3 * pow(abs(vUv.x * 2.0 - 1.0), 3.0);

          gl_FragColor = vec4(
            tint * (0.35 + grid),
            opacity * rim * (0.024 + grid * 0.31)
          );
        }
      `
    });

    const shell = new T.Mesh(shellGeometry, shellMaterial);
    shell.frustumCulled = false;
    bulk.add(shell);

    const leftRim = makeLine(colors.left, 0.8, information);
    const rightRim = makeLine(colors.right, 0.8, information);
    const bifurcation = makeLine(colors.gold, 0.8);
    const regionArc = makeLine(colors.gold, 1);

    const rtMaterial = new T.MeshBasicMaterial({
      color: colors.gold,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });

    const rtMesh = new T.Mesh(new T.BufferGeometry(), rtMaterial);
    rtMesh.frustumCulled = false;
    bulk.add(rtMesh);

    const WN = 112;
    const WR = 18;

    const wedgeGeometry = new T.BufferGeometry();
    const wedgePositions = new Float32Array((WN + 1) * (WR + 1) * 3);
    const wedgeUV = new Float32Array((WN + 1) * (WR + 1) * 2);
    const wedgeIndices = [];

    for (let i = 0; i <= WN; i++) {
      for (let j = 0; j <= WR; j++) {
        const k = i * (WR + 1) + j;
        wedgeUV[k * 2] = i / WN;
        wedgeUV[k * 2 + 1] = j / WR;

        if (i < WN && j < WR) {
          const b = k + WR + 1;
          wedgeIndices.push(k, b, k + 1, b, b + 1, k + 1);
        }
      }
    }

    wedgeGeometry.setAttribute(
      "position",
      new T.BufferAttribute(wedgePositions, 3)
    );
    wedgeGeometry.setAttribute("uv", new T.BufferAttribute(wedgeUV, 2));
    wedgeGeometry.setIndex(wedgeIndices);

    const wedgeMaterial = new T.ShaderMaterial({
      uniforms: {
        strength: { value: 0.18 }
      },
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix *
            vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float strength;
        varying vec2 vUv;

        void main() {
          float lines = pow(
            0.5 + 0.5 * cos(vUv.y * 6.28318530718 * 12.0),
            28.0
          );

          float edge = pow(abs(vUv.y * 2.0 - 1.0), 12.0);

          gl_FragColor = vec4(
            vec3(0.92, 0.57, 0.2) * (0.65 + edge),
            strength * (0.25 + lines * 0.35 + edge * 0.4)
          );
        }
      `
    });

    const wedge = new T.Mesh(wedgeGeometry, wedgeMaterial);
    wedge.frustumCulled = false;
    bulk.add(wedge);

    const dotCanvas = document.createElement("canvas");
    dotCanvas.width = 64;
    dotCanvas.height = 64;

    const dotContext = dotCanvas.getContext("2d");
    if (!dotContext) throw new Error("Canvas drawing is unavailable.");

    const gradient = dotContext.createRadialGradient(
      32, 32, 0,
      32, 32, 32
    );

    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.16, "rgba(255,255,255,.8)");
    gradient.addColorStop(0.45, "rgba(255,255,255,.16)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    dotContext.fillStyle = gradient;
    dotContext.fillRect(0, 0, 64, 64);

    const glowTexture = new T.CanvasTexture(dotCanvas);
    const textures = [glowTexture];

    function boundaryNodes(color) {
      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        "position",
        new T.BufferAttribute(new Float32Array(192 * 3), 3)
      );

      const material = new T.PointsMaterial({
        color,
        size: 0.38,
        map: glowTexture,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const object = new T.Points(geometry, material);
      object.frustumCulled = false;
      information.add(object);
      return object;
    }

    const leftNodes = boundaryNodes(colors.left);
    const rightNodes = boundaryNodes(colors.right);
    const correlationLines = [];

    for (let i = 0; i < 12; i++) {
      correlationLines.push(
        makeLine(
          i % 2 ? colors.right : colors.left,
          0.13,
          information
        )
      );
    }

    // The external interaction channel is separate from static correlations.
    const couplingChannel = makeLine(colors.pink, 0, causal);
    const trajectory = makeLine(colors.gold, 0, causal);

    const packet = new T.Group();

    const packetCore = new T.Mesh(
      new T.SphereGeometry(0.075, 12, 8),
      new T.MeshBasicMaterial({
        color: 0xfff1d0,
        transparent: true
      })
    );

    const packetGlow = new T.Sprite(
      new T.SpriteMaterial({
        map: glowTexture,
        color: colors.gold,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      })
    );

    packetGlow.scale.setScalar(0.85);
    packet.add(packetCore, packetGlow);
    causal.add(packet);

    const arrival = new T.Sprite(
      new T.SpriteMaterial({
        map: glowTexture,
        color: colors.gold,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: T.AdditiveBlending
      })
    );

    arrival.scale.setScalar(2.2);
    causal.add(arrival);

    // This is a causal-shift illustration, not a computed metric deformation.
    const shiftMaterial = new T.ShaderMaterial({
      uniforms: {
        effect: { value: 0 },
        strength: { value: 0 }
      },
      side: T.DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending,
      vertexShader: `
        uniform float effect;
        varying vec2 vUv;

        void main() {
          vUv = uv;
          vec3 p = position;

          p.z += effect * 1.4 *
            exp(-0.22 * p.x * p.x) *
            sin(p.y * 0.55);

          gl_Position = projectionMatrix * modelViewMatrix *
            vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform float strength;
        varying vec2 vUv;

        void main() {
          float a = pow(
            0.5 + 0.5 * cos(
              (vUv.y - vUv.x * 0.35) * 6.28318530718 * 12.0
            ),
            30.0
          );

          float edge =
            sin(vUv.x * 3.14159265359) *
            sin(vUv.y * 3.14159265359);

          gl_FragColor = vec4(
            0.83,
            0.2,
            0.64,
            strength * edge * (0.035 + a * 0.42)
          );
        }
      `
    });

    const shiftSheet = new T.Mesh(
      new T.PlaneGeometry(9, 7, 40, 28),
      shiftMaterial
    );

    shiftSheet.position.z = 1.8;
    shiftSheet.frustumCulled = false;
    causal.add(shiftSheet);

    let successPath;
    let failedPath;

    const signalPoints = Array.from({ length: 100 }, () => vec());
    const matrices = [];

    [-1, 1].forEach(sign => {
      const source = document.createElement("canvas");
      source.width = 256;
      source.height = 256;

      const context = source.getContext("2d");

      if (!context) {
        throw new Error("The density-matrix display is unavailable.");
      }

      const texture = new T.CanvasTexture(source);
      texture.encoding = T.sRGBEncoding;
      texture.minFilter = T.LinearFilter;
      texture.generateMipmaps = false;
      textures.push(texture);

      const plane = new T.Mesh(
        new T.PlaneGeometry(4.6, 4.6),
        new T.MeshBasicMaterial({
          map: texture,
          side: T.DoubleSide
        })
      );

      plane.position.set(sign * 18.5, 3.6, 1);
      information.add(plane);
      matrices.push({ source, context, texture, plane, sign });
    });

    const stars = new Float32Array(360 * 3);
    let seed = 4717;

    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 360; i++) {
      const a = random() * TAU;
      const z = random() * 2 - 1;
      const r = 65 + 20 * random();

      stars[i * 3] = r * Math.sqrt(1 - z * z) * Math.cos(a);
      stars[i * 3 + 1] = r * z;
      stars[i * 3 + 2] = r * Math.sqrt(1 - z * z) * Math.sin(a);
    }

    const starGeometry = new T.BufferGeometry();
    starGeometry.setAttribute(
      "position",
      new T.BufferAttribute(stars, 3)
    );

    scene.add(
      new T.Points(
        starGeometry,
        new T.PointsMaterial({
          color: 0x426988,
          size: 0.07,
          transparent: true,
          opacity: 0.4,
          depthWrite: false
        })
      )
    );

    function updateGeometry() {
      model = calculateBTZ(state.q, state.delta);

      for (let i = 0; i <= NX; i++) {
        for (let j = 0; j <= NP; j++) {
          const k = (i * (NP + 1) + j) * 3;

          coordinate(
            lerp(-model.rhoC, model.rhoC, i / NX),
            j / NP * TAU,
            scratch
          );

          shellPositions[k] = scratch.x;
          shellPositions[k + 1] = scratch.y;
          shellPositions[k + 2] = scratch.z;
        }
      }

      shellGeometry.attributes.position.needsUpdate = true;
      shellMaterial.uniforms.rhoC.value = model.rhoC;

      const circle = rho => Array.from(
        { length: 145 },
        (_, i) => coordinate(rho, i / 144 * TAU)
      );

      setLine(leftRim, circle(-model.rhoC));
      setLine(rightRim, circle(model.rhoC));
      setLine(bifurcation, circle(0));

      setLine(
        regionArc,
        Array.from(
          { length: 97 },
          (_, i) => coordinate(
            model.rhoC,
            lerp(-model.delta / 2, model.delta / 2, i / 96)
          )
        )
      );

      const rt = [];

      for (let i = 0; i <= WN; i++) {
        const point = rtPoint(i / WN, model);
        rt.push(coordinate(point.rho, point.phi));

        for (let j = 0; j <= WR; j++) {
          coordinate(
            lerp(point.rho, model.rhoC, j / WR),
            point.phi,
            scratch
          );

          // A tiny drawing offset prevents coplanar flicker.
          scratch.multiplyScalar(1.001);

          const k = (i * (WR + 1) + j) * 3;
          wedgePositions[k] = scratch.x;
          wedgePositions[k + 1] = scratch.y;
          wedgePositions[k + 2] = scratch.z;
        }
      }

      wedgeGeometry.attributes.position.needsUpdate = true;

      rtMesh.geometry.dispose();
      rtMesh.geometry = new T.TubeGeometry(
        new T.CatmullRomCurve3(rt),
        160,
        0.037,
        6,
        false
      );

      [leftNodes, rightNodes].forEach((object, side) => {
        const sign = side ? 1 : -1;
        const positions = object.geometry.attributes.position;

        for (let i = 0; i < positions.count; i++) {
          const band = Math.floor(i / 48);
          const phi = i % 48 / 48 * TAU;

          coordinate(sign * model.rhoC, phi, scratch);

          positions.setXYZ(
            i,
            scratch.x + sign * (band - 1.5) * 0.19,
            scratch.y * (0.88 + band * 0.065),
            scratch.z * (0.88 + band * 0.065)
          );
        }

        positions.needsUpdate = true;
      });

      correlationLines.forEach((object, index) => {
        const phi = index / correlationLines.length * TAU;
        const left = coordinate(-model.rhoC, phi);
        const right = coordinate(model.rhoC, phi);

        const control = vec(
          0,
          Math.cos(phi) * 12.5,
          Math.sin(phi) * 12.5
        );

        setLine(
          object,
          new T.QuadraticBezierCurve3(left, control, right).getPoints(72)
        );
      });

      const left = coordinate(-model.rhoC, PI / 2);
      const right = coordinate(model.rhoC, PI / 2);

      successPath = new T.CatmullRomCurve3([
        left,
        vec(-7, 0.3, 3.5),
        vec(-2, 0.3, 0.9),
        vec(2, 0.3, 0.9),
        vec(7, 0.3, 3.5),
        right
      ]);

      failedPath = new T.CatmullRomCurve3([
        left,
        vec(-7, 0.4, 3.5),
        vec(-2.2, 1.4, 1.2),
        vec(-0.4, 3.8, 0.5)
      ]);

      const interactionPath = new T.CubicBezierCurve3(
        left.clone(),
        vec(-9, 13, 11),
        vec(9, 13, 11),
        right.clone()
      );

      setLine(couplingChannel, interactionPath.getPoints(96));
      arrival.position.copy(right);

      updateAnchors();
      drawSpectrum();
      state.modelDirty = false;
    }

    function updateVisuals() {
      const info = state.view !== "bulk";
      const geometric = state.view !== "information";

      bulk.visible = geometric;
      information.visible = info;
      wedge.visible = state.wedge;

      wedgeMaterial.uniforms.strength.value =
        state.chapter === 5 || state.chapter === 6 ? 0.44 : 0.16;

      correlationLines.forEach(object => {
        object.visible = state.correlations;
      });

      matrices.forEach(item => {
        item.plane.visible =
          state.view === "information" || state.chapter === 1;
      });

      shellMaterial.uniforms.opacity.value =
        state.chapter === 2 ? 0.85 : 0.65;

      couplingChannel.material.opacity =
        protocol.coupled ? protocol.pulse * 0.95 : 0;

      shiftMaterial.uniforms.effect.value =
        protocol.applied ? 1 : protocol.dose;

      shiftMaterial.uniforms.strength.value =
        geometric && protocol.negativeCue ? 0.65 : 0;

      packet.visible = protocol.signalAlpha > 0.002;
      packetCore.material.opacity = protocol.signalAlpha;
      packetGlow.material.opacity = protocol.signalAlpha;

      const path = protocol.trial ? failedPath : successPath;

      if (path && protocol.launched) {
        path.getPoint(protocol.progress, packet.position);

        for (let i = 0; i < signalPoints.length; i++) {
          path.getPoint(
            protocol.progress * i / (signalPoints.length - 1),
            signalPoints[i]
          );
        }

        setLine(trajectory, signalPoints);
      }

      trajectory.visible = protocol.launched;

      trajectory.material.opacity = protocol.trial
        ? protocol.failed ? 0.2 : 0.6
        : protocol.received ? 0.36 : 0.65;

      arrival.material.opacity = protocol.received
        ? 0.65 * (1 - ease(segment(protocol.time, 0.86, 1)))
        : 0;
    }

    const spectrum = $("spectrum-chart").getContext("2d");

    if (!spectrum) {
      throw new Error("The spectrum chart could not be initialized.");
    }

    function drawSpectrum() {
      const ctx = spectrum;
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;

      ctx.fillStyle = "#050c17";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "13px monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = "#c9deed";
      ctx.fillText("EIGHT-LEVEL TFD ANALOGUE", 18, 24);

      ctx.font = "11px monospace";
      ctx.fillStyle = "#93adc4";
      ctx.fillText(
        "Linear probability scale · not a CFT spectrum",
        18,
        44
      );

      const bottom = h - 32;
      const top = 62;
      const left = 40;
      const step = (w - 58) / 8;

      [0, 0.5, 1].forEach(p => {
        const y = lerp(bottom, top, p);

        ctx.strokeStyle = "#223349";
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(w - 14, y);
        ctx.stroke();

        ctx.fillStyle = "#90a7c0";
        ctx.textAlign = "right";
        ctx.fillText(String(p), left - 8, y + 4);
      });

      model.probabilities.forEach((p, n) => {
        ctx.fillStyle = "#64dcd5";

        ctx.fillRect(
          left + n * step + 8,
          bottom - p * (bottom - top),
          step - 16,
          Math.max(0.6, p * (bottom - top))
        );

        ctx.fillStyle = "#b0c5d9";
        ctx.textAlign = "center";
        ctx.fillText(
          String(n),
          left + (n + 0.5) * step,
          bottom + 18
        );
      });

      matrices.forEach(item => {
        const c = item.context;

        c.fillStyle = "#050c17";
        c.fillRect(0, 0, 256, 256);
        c.textAlign = "center";
        c.font = "13px monospace";
        c.fillStyle = item.sign < 0 ? "#69e6dc" : "#b59aff";

        c.fillText(
          item.sign < 0 ? "LEFT REDUCED STATE" : "RIGHT REDUCED STATE",
          128,
          22
        );

        c.font = "10px monospace";
        c.fillStyle = "#9db3c9";
        c.fillText("eight-level analogue · diagonal", 128, 39);

        for (let row = 0; row < 8; row++) {
          for (let column = 0; column < 8; column++) {
            const p = row === column ? model.probabilities[row] : 0;

            c.fillStyle = "#122233";
            c.fillRect(
              36 + column * 23,
              52 + row * 23,
              20,
              20
            );

            if (p > 0) {
              c.globalAlpha = Math.sqrt(p);
              c.fillStyle = item.sign < 0 ? "#6ffff0" : "#c6a5ff";
              c.fillRect(
                36 + column * 23,
                52 + row * 23,
                20,
                20
              );
              c.globalAlpha = 1;
            }
          }
        }

        c.fillStyle = "#9db3c9";
        c.fillText("brightness ∝ √probability", 128, 249);
        item.texture.needsUpdate = true;
      });

      text(
        "spectrum-summary",
        model.probabilities.map(
          (p, n) => "p" + n + " = " + p.toPrecision(4)
        ).join("; ") + ". Joint state pure."
      );
    }

    function svgElement(tag, attributes, content) {
      const node = document.createElementNS(SVG, tag);

      Object.entries(attributes || {}).forEach(([key, value]) => {
        node.setAttribute(key, String(value));
      });

      if (content) node.textContent = content;
      return node;
    }

    const dynamic = $("causal-dynamic");
    const orderChart = svgElement("g");
    dynamic.appendChild(orderChart);

    orderChart.appendChild(
      svgElement(
        "text",
        { x: 180, y: 23, "text-anchor": "middle" },
        "PROTOCOL CAUSAL ORDER"
      )
    );

    orderChart.appendChild(
      svgElement(
        "text",
        { x: 180, y: 39, "text-anchor": "middle" },
        "schematic · not conformal coordinates"
      )
    );

    [60, 180, 300].forEach((x, i) => {
      orderChart.appendChild(
        svgElement("path", {
          d: "M" + x + " 65V250",
          fill: "none",
          stroke: i === 1 ? "#667286" : i === 0 ? "#66cfc9" : "#a08bdd",
          "stroke-width": 1,
          "stroke-dasharray": i === 1 ? "3 5" : "none"
        })
      );
    });

    [
      ["LEFT", 60],
      ["BULK EFFECT", 180],
      ["RIGHT", 300]
    ].forEach(([label, x]) => {
      orderChart.appendChild(
        svgElement(
          "text",
          { x, y: 274, "text-anchor": "middle" },
          label
        )
      );
    });

    orderChart.appendChild(
      svgElement(
        "text",
        {
          x: 20,
          y: 151,
          transform: "rotate(-90 20 151)",
          "text-anchor": "middle"
        },
        "protocol order →"
      )
    );

    const operation = svgElement("path", {
      d: "M60 190H300",
      class: "diagram-coupling",
      opacity: 0.2
    });

    orderChart.appendChild(operation);

    orderChart.appendChild(
      svgElement(
        "text",
        { x: 180, y: 207, "text-anchor": "middle" },
        "prescribed boundary interaction"
      )
    );

    const orderWindow = svgElement("rect", {
      x: 150,
      y: 123,
      width: 60,
      height: 43,
      rx: 4,
      class: "diagram-window",
      opacity: 0.2
    });

    orderChart.appendChild(orderWindow);

    const channel = svgElement("path", {
      d: "M60 240L150 176L180 145L300 75",
      fill: "none",
      stroke: "#c5ab7950",
      "stroke-width": 1,
      "stroke-dasharray": "3 5"
    });

    orderChart.appendChild(channel);

    [
      ["send", 60, 255],
      ["conditional route", 234, 118],
      ["receive", 300, 61]
    ].forEach(([label, x, y]) => {
      orderChart.appendChild(
        svgElement(
          "text",
          { x, y, "text-anchor": "middle" },
          label
        )
      );
    });

    const orderNodes = [
      [60, 240],
      [180, 145],
      [300, 75]
    ].map(([cx, cy]) => {
      const node = svgElement("circle", {
        cx,
        cy,
        r: 4,
        fill: "#f1ce8a",
        opacity: 0.2
      });

      orderChart.appendChild(node);
      return node;
    });

    const routeNodes = [
      [60, 240],
      [150, 176],
      [180, 145],
      [300, 75]
    ];

    function orderPoint(progress) {
      const cuts = [0, 0.36, 0.55, 1];
      let index = 0;

      while (index < 2 && progress > cuts[index + 1]) index++;

      const f = segment(progress, cuts[index], cuts[index + 1]);

      return [
        lerp(routeNodes[index][0], routeNodes[index + 1][0], f),
        lerp(routeNodes[index][1], routeNodes[index + 1][1], f),
        index
      ];
    }

    function updateDiagram() {
      $("causal-reference").style.display = protocol.coupled ? "none" : "";
      orderChart.style.display = protocol.coupled ? "" : "none";

      text(
        "causal-diagram-mode",
        protocol.coupled ? "PROTOCOL ORDER" : "UNCOUPLED"
      );

      text(
        "causal-diagram-title",
        protocol.coupled
          ? "Schematic protocol causal order"
          : "Two-sided black-hole causal structure"
      );

      text(
        "causal-diagram-desc",
        protocol.coupled
          ? "A prescribed interaction precedes admission and right-boundary receipt. These are protocol-order coordinates, not a conformal diagram or a solved spacetime."
          : "Two exterior regions flank past and future interiors. Future horizons prevent an uncoupled signal from reaching the opposite boundary."
      );

      let d = "";
      let x = 70;
      let y = 190;

      if (protocol.coupled) {
        const point = orderPoint(protocol.progress);
        x = point[0];
        y = point[1];
        d = "M" + routeNodes[0].join(" ");

        for (let i = 1; i <= point[2]; i++) {
          d += "L" + routeNodes[i].join(" ");
        }

        d += "L" + x + " " + y;

        operation.setAttribute(
          "opacity",
          String(
            0.2 + 0.8 * Math.max(protocol.pulse, protocol.dose * 0.6)
          )
        );

        orderWindow.setAttribute("opacity", protocol.open ? "1" : "0.2");
        orderNodes[0].setAttribute("opacity", protocol.launched ? "1" : "0.2");
        orderNodes[1].setAttribute("opacity", protocol.admitted ? "1" : "0.2");
        orderNodes[2].setAttribute("opacity", protocol.received ? "1" : "0.2");

        text(
          "causal-diagram-summary",
          "Protocol causal order, not a conformal spacetime diagram. " +
          "The prescribed interaction precedes admission into the illustrated bulk channel. " +
          (
            protocol.received
              ? "The previously admitted signal was received."
              : protocol.open
                ? "The temporary window is open."
                : "No independent entanglement-only route is provided."
          )
        );
      } else {
        x = lerp(70, 220, protocol.progress);
        y = lerp(190, 40, protocol.progress);
        d = "M70 190L" + x + " " + y;

        text(
          "causal-diagram-summary",
          protocol.failed
            ? "The uncoupled ray terminates at the future interior boundary. It never reaches the right exterior."
            : "Ordinary BTZ causal structure. Future horizons prevent a ray from connecting the two exteriors."
        );
      }

      $("causal-signal-path").setAttribute("d", d);
      $("causal-signal-path").setAttribute(
        "opacity",
        protocol.launched ? "0.9" : "0"
      );

      $("causal-signal-dot").setAttribute("cx", x);
      $("causal-signal-dot").setAttribute("cy", y);
      $("causal-signal-dot").setAttribute(
        "opacity",
        String(protocol.signalAlpha)
      );
    }

    const cards = {};
    const tags = [];

    const names = [
      "tfd",
      "duality",
      "bridge",
      "entropy",
      "rt",
      "wedge",
      "conjecture",
      "coupling",
      "null-energy",
      "signal",
      "teleportation",
      "geometry"
    ];

    names.forEach(name => {
      const template = $(name + "-card-template");

      if (!template) {
        throw new Error("Missing annotation: " + name);
      }

      const element = template.content.firstElementChild.cloneNode(true);
      const card = element.querySelector(".world-card");
      const readout = document.createElement("p");
      readout.className = "card-note";
      card.appendChild(readout);

      const object = new T.CSS2DObject(element);
      const leader = svgElement("polyline", {});

      leaders.appendChild(leader);
      scene.add(object);
      labelRenderer.domElement.appendChild(element);

      cards[name] = {
        element,
        card,
        readout,
        object,
        leader,
        alpha: 0
      };
    });

    function makeTag(content, position, test) {
      const element = document.createElement("div");
      element.className = "world-tag";
      element.textContent = content;

      const object = new T.CSS2DObject(element);
      object.position.copy(position);
      scene.add(object);
      labelRenderer.domElement.appendChild(element);

      const item = { element, object, test, alpha: 0 };
      tags.push(item);
      return item;
    }

    const leftTag = makeTag(
      "LEFT CFT · schematic boundary",
      vec(),
      () => true
    );

    const rightTag = makeTag(
      "RIGHT CFT · schematic boundary",
      vec(),
      () => true
    );

    const throatTag = makeTag(
      "BIFURCATION CIRCLE · spatial slice",
      vec(),
      () => state.view !== "information" &&
        [3, 4, 10].includes(state.chapter)
    );

    const signalTag = makeTag(
      "INFORMATION SIGNAL · schematic",
      vec(),
      () => protocol.signalAlpha > 0.1
    );

    makeTag(
      "CAUSAL SHIFT CUE · not a solved metric",
      vec(0, 3.5, 2),
      () => protocol.negativeCue && state.view !== "information"
    );

    makeTag(
      "Eight-level analogue · not the CFT spectrum",
      vec(-18.5, 6.4, 1),
      () => state.view === "information" || state.chapter === 1
    );

    function updateAnchors() {
      const x = X_SCALE * model.rhoC;

      leftTag.object.position.set(-x, 9.4, 0);
      rightTag.object.position.set(x, 9.4, 0);

      throatTag.object.position.set(
        0,
        -R_SCALE * model.q - 0.6,
        0
      );

      cards.tfd.object.position.set(-x, 2, 6);
      cards.duality.object.position.set(0, 5, 0);
      cards.bridge.object.position.set(0, R_SCALE * model.q, 0);
      cards.entropy.object.position.copy(coordinate(model.rhoC, 0));

      const midpoint = rtPoint(0.5, model);

      cards.rt.object.position.copy(coordinate(midpoint.rho, 0));

      cards.wedge.object.position.copy(
        coordinate(lerp(midpoint.rho, model.rhoC, 0.6), 0)
      );

      cards.conjecture.object.position.set(0, 6.5, 0);
      cards.coupling.object.position.set(0, 9.75, 10.35);
      cards["null-energy"].object.position.set(0, 1, 2);
      cards.teleportation.object.position.set(x, 3, 5);
      cards.geometry.object.position.set(0, R_SCALE * model.q, 0);
    }

    function wantedCards() {
      if (state.manualContext === "geometry") {
        return ["geometry", "rt"];
      }

      if (state.owner === "independent") {
        if (protocol.trial) return ["bridge", "signal"];
        if (protocol.time < 0.42) return ["coupling"];
        if (protocol.time < 0.44) return ["null-energy"];
        return ["signal", "teleportation"];
      }

      if (state.manualContext === "protocol") {
        return ["bridge"];
      }

      return [
        ["tfd"],
        ["tfd", "entropy"],
        ["duality"],
        ["bridge"],
        ["bridge", "signal"],
        ["rt", "entropy"],
        ["wedge", "rt"],
        ["conjecture"],
        ["coupling"],
        ["null-energy"],
        ["signal"],
        ["signal"],
        ["teleportation"],
        ["geometry", "entropy"],
        ["duality"]
      ][Math.max(state.chapter, 0)];
    }

    let hudRects = [];
    let panelRight = 0;

    const overlaps = (a, b) =>
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;

    function measureLabels() {
      const items = [...Object.values(cards), ...tags];
      const previous = items.map(item => item.element.style.display);

      items.forEach(item => {
        item.element.style.display = "";
      });

      const metrics = items.map(item => {
        const node = item.card || item.element;
        return [node.offsetWidth, node.offsetHeight];
      });

      panelRight = $("sidebar-ui").getBoundingClientRect().right;

      const ids = state.hidden
        ? ["flight-controls"]
        : [
          "sidebar-ui",
          "flight-controls",
          "scene-caption",
          "reference-legend"
        ];

      hudRects = ids
        .map(id => $(id))
        .filter(node => {
          const style = getComputedStyle(node);

          return style.display !== "none" &&
            style.visibility !== "hidden";
        })
        .map(node => node.getBoundingClientRect())
        .filter(rect => rect.width && rect.height)
        .map(rect => ({
          left: rect.left - 10,
          right: rect.right + 10,
          top: rect.top - 10,
          bottom: rect.bottom + 10
        }));

      items.forEach((item, i) => {
        if (metrics[i][0] && metrics[i][1]) {
          item.width = metrics[i][0];
          item.height = metrics[i][1];
        }

        item.element.style.display = previous[i];
      });
    }

    function projectionOf(object) {
      projected.copy(object.position).project(camera);

      if (
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 1.05 ||
        Math.abs(projected.y) > 1.05
      ) {
        return null;
      }

      return {
        x: (projected.x + 1) * state.width / 2,
        y: (1 - projected.y) * state.height / 2
      };
    }

    function show(item, visible, dt) {
      item.alpha = lerp(
        item.alpha,
        visible ? 1 : 0,
        motion.matches ? 1 : 1 - Math.exp(-dt * 12)
      );

      if (item.alpha < 0.002) item.alpha = 0;

      // Each CSS2D object is explicitly gated for r128 compatibility.
      item.object.visible = item.alpha > 0;
      item.element.classList.toggle("is-visible", visible);
      item.element.style.opacity = String(item.alpha);
      item.element.setAttribute("aria-hidden", String(!visible));
      item.element.inert = !visible;

      if (item.leader) {
        item.leader.style.display = item.alpha > 0 ? "" : "none";
        item.leader.style.opacity = String(item.alpha);
      }
    }

    function layoutLabels(dt) {
      signalTag.object.position.copy(packet.position);
      signalTag.object.position.y += 0.6;

      cards.signal.object.position.copy(
        protocol.launched ? packet.position : cards.bridge.object.position
      );

      const occupied = hudRects.slice();
      const visible = new Set();

      for (const name of state.hidden ? [] : wantedCards()) {
        if (visible.size >= (state.width > 1050 ? 2 : 1)) break;

        if (
          state.view === "information" &&
          ["rt", "wedge", "bridge", "geometry"].includes(name)
        ) {
          continue;
        }

        const item = cards[name];
        const point = projectionOf(item.object);
        if (!point) continue;

        const w = item.width || 314;
        const h = item.height || 290;

        const candidates = [
          [point.x + 26, point.y - h / 2],
          [point.x - w - 26, point.y - h / 2],
          [point.x - w / 2, point.y - h - 24],
          [point.x - w / 2, point.y + 24],
          [state.width - w - 20, 82]
        ];

        const chosen = candidates
          .map(([left, top]) => ({
            left,
            top,
            right: left + w,
            bottom: top + h
          }))
          .find(box =>
            box.left > 12 &&
            box.top > 12 &&
            box.right < state.width - 12 &&
            box.bottom < state.height - 12 &&
            !occupied.some(rect => overlaps(box, rect))
          );

        if (!chosen) continue;

        // CSS2D owns the outer transform; only the inner card is offset.
        item.card.style.setProperty(
          "--card-x",
          chosen.left - point.x + "px"
        );
        item.card.style.setProperty(
          "--card-y",
          chosen.top - point.y + "px"
        );

        const x = clamp(point.x, chosen.left, chosen.right);
        const y = clamp(point.y, chosen.top, chosen.bottom);

        item.leader.setAttribute(
          "points",
          point.x + "," + point.y + " " +
          lerp(point.x, x, 0.5) + "," + point.y + " " +
          x + "," + y
        );

        occupied.push(chosen);
        visible.add(item);
      }

      Object.values(cards).forEach(item => {
        show(item, visible.has(item), dt);
      });

      tags.forEach(item => {
        let on = !state.hidden && item.test();
        const point = on ? projectionOf(item.object) : null;

        if (!point) on = false;

        if (on) {
          const w = item.width || 220;
          const h = item.height || 24;

          const box = {
            left: point.x - w / 2,
            right: point.x + w / 2,
            top: point.y - h / 2,
            bottom: point.y + h / 2
          };

          on =
            box.left > 8 &&
            box.right < state.width - 8 &&
            box.top > 8 &&
            box.bottom < state.height - 8 &&
            !occupied.some(rect => overlaps(box, rect));

          if (on) occupied.push(box);
        }

        show(item, on, dt);
      });
    }

    const chapters = [
      [
        "Entangled boundaries",
        "Two boundary systems, one shared state.",
        "Paired nodes indicate schematic correlations. Entanglement alone carries no usable message.",
        "ENTANGLED BOUNDARIES"
      ],
      [
        "Thermofield double",
        "Each side is thermal. The joint state is pure.",
        "The eight-level laboratory illustrates the construction; it is not a numerical CFT.",
        "ENTANGLED BOUNDARIES"
      ],
      [
        "Bulk emergence",
        "Boundary information and bulk geometry provide dual descriptions.",
        "The compact BTZ solution supplies a static reference within AdS₃ / CFT₂.",
        "BULK CONNECTED"
      ],
      [
        "Two-sided black hole",
        "Two exteriors meet on a connected spatial slice.",
        "The gold bifurcation circle is where the horizons meet on this slice. The causal inset shows the interiors.",
        "ER BRIDGE"
      ],
      [
        "Nontraversable bridge",
        "Spatial connectivity does not guarantee causal passage.",
        "The uncoupled ray terminates in the future interior. Its 3D track is an explanatory guide.",
        "NONTRAVERSABLE"
      ],
      [
        "Ryu–Takayanagi geodesic",
        "The selected boundary interval determines a bulk minimal curve.",
        "Length is calculated in the BTZ metric at the fixed cutoff. The display is not an isometric embedding.",
        "BULK CONNECTED"
      ],
      [
        "Entanglement wedge",
        "A boundary region is associated with a bulk reconstruction region.",
        "The translucent sheet is a spatial slice of the wedge; the full wedge is its domain of dependence.",
        "BULK CONNECTED"
      ],
      [
        "ER = EPR",
        "Entanglement and geometric connection: a quantum-gravity conjecture.",
        "A smooth classical bridge is not assigned to every arbitrary entangled pair.",
        "ER BRIDGE"
      ],
      [
        "Prescribed boundary coupling",
        "A temporary interaction supplies the required extra operation.",
        "The chosen pulse and operator sign represent a specific construction, not entanglement-only communication.",
        "COUPLING ACTIVE"
      ],
      [
        "Null-energy effect",
        "The protocol can change the effective causal structure.",
        "The magenta sheet illustrates a negative-null-energy effect. No stress tensor or backreaction is solved here.",
        "COUPLING ACTIVE"
      ],
      [
        "Traversable window",
        "A previously injected signal is admitted after the prescribed interaction.",
        "The causal-order inset tracks the protocol. The BTZ geometry and RT readouts remain static references.",
        "TRAVERSABLE WINDOW"
      ],
      [
        "Information exit",
        "The admitted signal reaches the right boundary.",
        "The interaction is essential. Transfer in this theoretical construction does not enable arbitrary faster-than-light messaging.",
        "INFORMATION TRANSFER"
      ],
      [
        "Teleportation connection",
        "Shared entanglement plus an operation can transfer information.",
        "Certain holographic protocols have a geometric dual description. Ordinary teleportation does not create a macroscopic tunnel.",
        "INFORMATION TRANSFER"
      ],
      [
        "Entanglement and geometry",
        "Explore a family of thermal states and static BTZ geometries.",
        "Horizon entropy and throat scale vary together in this family. This is not a universal dynamical law.",
        "BULK CONNECTED"
      ],
      [
        "Full system",
        "Boundary information, bulk geometry, and causal structure remain distinct.",
        "The protocol is reset to the ordinary nontraversable reference as the observatory returns to its opening view.",
        "ENTANGLED BOUNDARIES"
      ]
    ];

    const durations = [
      48, 55, 48, 50, 52,
      58, 52, 48, 55, 45,
      55, 48, 52, 58, 48
    ];

    const starts = [0];

    durations.forEach(duration => {
      starts.push(starts[starts.length - 1] + duration);
    });

    const totalTime = starts[starts.length - 1];

    const positions = [
      [35, 22, 39],
      [-29, 13, 28],
      [-10, 26, 38],
      [16, 14, 25],
      [-16, 6, 16],
      [19, 13, 16],
      [10, 6, 4],
      [6, 3, 1.3],
      [29, 22, 36],
      [1, 8, 17],
      [-8, 3, 10],
      [15, 6, 15],
      [26, 14, 27],
      [10, 22, 33],
      [30, 18, 35]
    ].map(point => vec(...point));

    const targets = [
      [0, 0, 0],
      [-11, 2, 0],
      [0, 1, 0],
      [0, 0, 0],
      [-2, 1, 1],
      [9, 3.5, 0],
      [9, 4, 0],
      [10, 4, 0],
      [0, 2, 2],
      [0, 1, 1],
      [0, 0, 1],
      [12, 0, 7],
      [2, 2, 0],
      [0, 1, 0],
      [0, 0, 0]
    ].map(point => vec(...point));

    const cameraPath = new T.CatmullRomCurve3(
      positions,
      true,
      "centripetal"
    );

    const targetPath = new T.CatmullRomCurve3(
      targets,
      true,
      "centripetal"
    );

    const fovs = [
      48, 45, 49, 48, 48,
      44, 48, 49, 48, 46,
      48, 46, 49, 48, 48
    ];

    const pose = {
      position: vec(),
      target: vec(),
      quaternion: new T.Quaternion(),
      fov: 48
    };

    const chapterButtons = Array.from(
      document.querySelectorAll("[data-chapter]")
    );

    const stepNodes = Array.from(
      document.querySelectorAll("[data-protocol-step]")
    );

    const steps = [
      "prepare",
      "inject",
      "couple",
      "window",
      "receive",
      "close"
    ];

    let announcedPhase = "";

    function locate(time) {
      const t = ((time % totalTime) + totalTime) % totalTime;
      let index = 0;

      while (
        index < durations.length - 1 &&
        t >= starts[index + 1]
      ) {
        index++;
      }

      return {
        index,
        fraction: (t - starts[index]) / durations[index]
      };
    }

    function samplePose(time, destination = pose) {
      const { index, fraction } = locate(time);
      const f = ease(fraction);
      const u = (index + f) / chapters.length;

      cameraPath.getPoint(u, destination.position);
      targetPath.getPoint(u, destination.target);

      destination.fov = lerp(
        fovs[index],
        fovs[(index + 1) % fovs.length],
        f
      );

      poseCamera.position.copy(destination.position);
      poseCamera.lookAt(destination.target);
      destination.quaternion.copy(poseCamera.quaternion);

      return destination;
    }

    function setChapter(index, force = false) {
      if (!force && state.chapter === index) return;

      state.chapter = index;
      const entry = chapters[index];

      text(
        "chapter-value",
        "CHAPTER " + String(index + 1).padStart(2, "0") + " / 15"
      );

      text("scene-title", entry[0]);
      text("scene-description", entry[1]);
      text("scene-model-note", entry[2]);

      chapterButtons.forEach((button, i) => {
        button.classList.toggle("is-active", i === index);

        if (i === index) {
          button.setAttribute("aria-current", "step");
        } else {
          button.removeAttribute("aria-current");
        }
      });
    }

    function sampleTour(force = false) {
      const { index, fraction: f } = locate(state.tour);
      setChapter(index, force);

      let q = 1.5;
      let delta = 1.3;
      let kind = "idle";
      let time = 0;

      if (index === 4) {
        kind = "trial";
        time = f;
      }

      if (index === 5) {
        delta += 0.7 * Math.sin(PI * f) ** 2;
      }

      if (index >= 8 && index <= 12) {
        kind = "coupled";

        const bounds = [
          [0, 0.38],
          [0.38, 0.44],
          [0.44, 0.76],
          [0.76, 0.92],
          [0.92, 1]
        ][index - 8];

        time = lerp(bounds[0], bounds[1], f);
      }

      if (index === 13) {
        q = f < 0.4
          ? lerp(1.5, 1.2, ease(f / 0.4))
          : f < 0.7
            ? lerp(1.2, 2.4, ease((f - 0.4) / 0.3))
            : lerp(2.4, 1.5, ease((f - 0.7) / 0.3));
      }

      if (
        Math.abs(state.q - q) > 1e-7 ||
        Math.abs(state.delta - delta) > 1e-7
      ) {
        state.modelDirty = true;
      }

      state.q = q;
      state.delta = delta;
      state.episode = { kind, time };
      protocol = sampleProtocol(kind, time);
    }

    function updateHUD() {
      const mode = state.transition
        ? "returning"
        : state.manual
          ? "manual"
          : state.paused
            ? "paused"
            : "tour";

      $("flight-mode").dataset.mode = mode;

      text(
        "flight-mode",
        state.transition
          ? "RETURNING TO FLIGHT"
          : state.manual
            ? "MANUAL INSPECTION"
            : state.paused
              ? "FLIGHT PAUSED"
              : "GUIDED DRONE"
      );

      text("pause-label", state.paused ? "Play" : "Pause");

      $("pause-toggle").setAttribute(
        "aria-pressed",
        String(state.paused)
      );

      $("pause-toggle").setAttribute(
        "aria-label",
        state.paused ? "Play animation" : "Pause animation"
      );

      document.body.classList.toggle("is-paused", state.paused);
      document.body.dataset.phase = protocol.phase;
      document.body.dataset.view = state.view;

      const narrative = protocol.received
        ? "INFORMATION TRANSFER"
        : protocol.open
          ? "TRAVERSABLE WINDOW"
          : protocol.pulse > 0
            ? "COUPLING ACTIVE"
            : protocol.trial
              ? "NONTRAVERSABLE"
              : protocol.coupled
                ? protocol.applied
                  ? "BULK CONNECTED"
                  : "ENTANGLED BOUNDARIES"
                : state.manualContext === "geometry"
                  ? "BULK CONNECTED"
                  : state.manualContext === "protocol"
                    ? "NONTRAVERSABLE"
                    : chapters[Math.max(0, state.chapter)][3];

      text("narrative-status", narrative);

      text(
        "causal-status",
        protocol.open
          ? "TEMPORARY WINDOW"
          : protocol.coupled && protocol.applied && protocol.time >= 0.86
            ? "WINDOW CLOSED"
            : "NONTRAVERSABLE"
      );

      text(
        "causal-description",
        protocol.open
          ? "A prescribed interaction has been applied. This scripted model illustrates a temporary causal channel."
          : protocol.received
            ? "The temporary window has closed. The earlier transfer remains recorded; no new signal is admitted."
            : "The ordinary bridge is spatially connected. Entanglement alone cannot carry a signal between exteriors."
      );

      const values = {
        "radius-setting": model.q.toFixed(2),
        "region-setting": model.delta.toFixed(2) + " rad",
        "beta-value": model.beta.toFixed(4),
        "throat-value": model.q.toFixed(3),
        "left-entropy-value": model.leftEntropy.toFixed(4),
        "surface-value": model.length.toFixed(4),
        "entropy-value": model.intervalEntropy.toFixed(4),
        "turning-value": model.turning.toFixed(4),
        "toy-entropy-value": model.toyEntropy.toFixed(5),
        "toy-purity-value": "1.00000"
      };

      Object.entries(values).forEach(([id, value]) => {
        text(id, value);
      });

      if (document.activeElement !== $("radius-control")) {
        $("radius-control").value = state.q.toFixed(2);
      }

      if (document.activeElement !== $("region-control")) {
        $("region-control").value = state.delta.toFixed(2);
      }

      text(
        "geometry-status",
        protocol.coupled
          ? "STATIC BTZ / RT REFERENCE · protocol backreaction is not solved"
          : "STATIC REFERENCE · r꜀ / L = 12 · ℏ = c_light = k_B = 1"
      );

      text("protocol-clock", "τ = " + protocol.time.toFixed(2));

      const phaseNames = {
        uncoupled: "UNCOUPLED",
        coupling: "PRESCRIBED PULSE",
        deformation: "CAUSAL EFFECT",
        window: "WINDOW OPEN",
        received: "SIGNAL RECEIVED",
        closed: "WINDOW CLOSED",
        blocked: "UNCOUPLED ATTEMPT FAILED"
      };

      text("protocol-state", phaseNames[protocol.phase]);
      text("coupling-value", protocol.pulse.toFixed(3));

      text(
        "coupling-history",
        protocol.applied
          ? "PRESCRIBED PULSE APPLIED"
          : protocol.dose > 0
            ? "PULSE IN PROGRESS"
            : "NO PULSE APPLIED"
      );

      text(
        "null-energy-value",
        protocol.negativeCue ? "NEGATIVE · SCHEMATIC" : "NONE DISPLAYED"
      );

      text(
        "signal-status",
        protocol.received
          ? "RECEIVED"
          : protocol.failed
            ? "BLOCKED"
            : protocol.admitted
              ? "ADMITTED"
              : protocol.launched
                ? protocol.coupled && protocol.time >= 0.28
                  ? protocol.applied
                    ? "AWAITING ADMISSION"
                    : "WAITING FOR PULSE"
                  : "IN FLIGHT"
                : "NOT INJECTED"
      );

      text(
        "signal-position",
        protocol.launched
          ? (100 * protocol.progress).toFixed(1) + "%"
          : "—"
      );

      const pct = (100 * protocol.time).toFixed(1);

      $("protocol-fill").style.width = pct + "%";
      $("protocol-progress").setAttribute("aria-valuenow", pct);

      $("protocol-progress").setAttribute(
        "aria-valuetext",
        phaseNames[protocol.phase] + ", τ " + protocol.time.toFixed(2)
      );

      const activeStep = steps.indexOf(protocol.step);

      stepNodes.forEach((node, i) => {
        const eligible = !protocol.trial || i <= 1 || i === 5;

        node.classList.toggle(
          "is-active",
          eligible && i === activeStep
        );

        node.classList.toggle(
          "is-complete",
          eligible && i < activeStep
        );

        if (eligible && i === activeStep) {
          node.setAttribute("aria-current", "step");
        } else {
          node.removeAttribute("aria-current");
        }
      });

      if (announcedPhase !== protocol.phase) {
        announcedPhase = protocol.phase;

        text(
          "accessibility-status",
          phaseNames[protocol.phase] + ". " +
          (
            protocol.received
              ? "Transfer required the prescribed interaction."
              : protocol.open
                ? "Illustrative channel open after the prescribed interaction."
                : "Entanglement alone does not transmit information."
          )
        );
      }

      const fraction = 100 * state.tour / totalTime;

      $("flight-progress").style.width = fraction + "%";
      $("journey-progress").setAttribute(
        "aria-valuenow",
        fraction.toFixed(1)
      );

      text(
        "stage-counter",
        String(state.chapter + 1).padStart(2, "0") + " / 15"
      );

      text(
        "tour-time",
        clock(state.tour) + " / " + clock(totalTime)
      );

      const viewName = {
        combined: "COMBINED VIEW",
        information: "QUANTUM INFORMATION",
        bulk: "BULK GEOMETRY"
      };

      text("legend-view-value", viewName[state.view]);

      text(
        "legend-note",
        protocol.coupled
          ? "Magenta: prescribed interaction / causal cue. Gold: RT reference and schematic signal. No metric backreaction is computed."
          : "Cyan / violet: boundaries. Gold: RT curve. The grid illustrates coordinates, not an isometric embedding."
      );

      text(
        "model-status",
        state.ready
          ? "BTZ / RT calculated · protocol schematic"
          : "Preparing first frame"
      );

      text(
        "display-status",
        (hdr ? "HDR" : "LDR") + " · " +
        Math.round(state.width * state.dpr) + " × " +
        Math.round(state.height * state.dpr)
      );

      cards.tfd.readout.textContent =
        "Teaching entropy: " + model.toyEntropy.toFixed(4) +
        " nats · joint purity 1";

      cards.entropy.readout.textContent =
        "S_A / c = " + model.intervalEntropy.toFixed(4) +
        " · S_L / c = " + model.leftEntropy.toFixed(4) +
        " · different subsystems";

      cards.rt.readout.textContent =
        "ℓγ / L = " + model.length.toFixed(4) +
        " · fixed cutoff r꜀ / L = 12";

      cards.wedge.readout.textContent =
        "Region A: " + model.delta.toFixed(2) +
        " rad · static wedge slice";

      cards.geometry.readout.textContent =
        "r_h / L = " + model.q.toFixed(3) +
        " · β / L = " + model.beta.toFixed(3);

      cards.coupling.readout.textContent =
        "g / g_ref = " + protocol.pulse.toFixed(3) +
        (
          protocol.applied
            ? " · prescribed pulse completed"
            : " · normalized illustrative pulse"
        );

      cards["null-energy"].readout.textContent =
        "Negative-null-energy cue: " +
        (protocol.negativeCue ? "displayed" : "not displayed") +
        " · no stress-tensor solver";

      cards.signal.readout.textContent = protocol.received
        ? "Received after the prescribed interaction."
        : protocol.failed
          ? "Uncoupled attempt: no right-boundary arrival."
          : "3D packet path: schematic, not an integrated null geodesic.";

      updateDiagram();
    }

    let raf = 0;
    let viewShift = 0;
    let resizePending = true;

    const hudRegions = Array.from(
      document.querySelectorAll(".hud-region")
    );

    function syncOrbit() {
      // Flush damping on the private control camera before copying the
      // displayed pose. The render camera has one owner in each frame.
      orbit.enableDamping = false;
      orbit.update();
      orbit.enableDamping = true;

      controlCamera.position.copy(camera.position);
      controlCamera.quaternion.copy(camera.quaternion);
      controlCamera.fov = camera.fov;

      const distance = clamp(
        camera.position.distanceTo(focus),
        1.2,
        100
      );

      camera.getWorldDirection(scratch);

      orbit.target
        .copy(camera.position)
        .addScaledVector(scratch, distance);

      orbit.update();
    }

    function enterManual() {
      const wasReturning = Boolean(state.transition);
      state.transition = null;

      if (!state.manual || wasReturning) syncOrbit();

      state.manual = true;
      orbit.enabled = state.ready;

      if (state.owner === "tour") state.owner = "frozen";
      state.uiClock = 1;
    }

    function startEpisode(kind) {
      if (!state.ready) return;

      enterManual();
      state.manualContext = "protocol";
      state.owner = kind === "idle" ? "frozen" : "independent";
      state.episode = { kind, time: 0 };
      protocol = sampleProtocol(kind, 0);

      if (kind !== "idle") state.paused = false;

      text("chapter-value", "INTERACTIVE CAUSAL EXPERIMENT");

      text(
        "scene-title",
        kind === "coupled"
          ? "Prescribed coupling protocol"
          : kind === "trial"
            ? "Uncoupled signal test"
            : "Ordinary nontraversable bridge"
      );

      text(
        "scene-description",
        kind === "coupled"
          ? "Prepare, inject, couple, admit, receive, close."
          : kind === "trial"
            ? "The signal enters the future interior and cannot reach the other boundary."
            : "The signal, pulse history, and temporary window have been reset."
      );

      text(
        "scene-model-note",
        "BTZ / RT remain static references. Signal tracks and protocol time are illustrative."
      );

      updateHUD();
      measureLabels();
    }

    function changeGeometry(key, input) {
      if (!state.ready) return;

      enterManual();
      state.owner = "frozen";
      state.manualContext = "geometry";
      state.episode = { kind: "idle", time: 0 };
      protocol = sampleProtocol("idle", 0);

      state[key] = clamp(
        Number(input.value),
        Number(input.min),
        Number(input.max)
      );

      state.modelDirty = true;
      state.modelClock = 1;

      text("chapter-value", "STATIC GEOMETRY LABORATORY");
      text("scene-title", "A controlled BTZ equilibrium family");

      text(
        "scene-description",
        "The horizon scale and selected boundary interval determine the reference geometry."
      );

      text(
        "scene-model-note",
        "Changing geometry resets the causal protocol. A larger throat does not itself make the bridge traversable."
      );

      state.uiClock = 1;
    }

    function requestFlight(time) {
      if (!state.ready) return;

      const destination = {
        position: vec(),
        target: vec(),
        quaternion: new T.Quaternion(),
        fov: 48
      };

      samplePose(time, destination);

      state.transition = {
        time: 0,
        duration: motion.matches ? 1.2 : 4.2,
        destination,
        tour: ((time % totalTime) + totalTime) % totalTime,
        fromPosition: camera.position.clone(),
        fromQuaternion: camera.quaternion.clone(),
        fromTarget: focus.clone(),
        fromFov: camera.fov
      };

      state.paused = false;
      orbit.enabled = false;
      state.uiClock = 1;
    }

    function commitFlight(transition) {
      state.tour = transition.tour;
      state.owner = "tour";
      state.manual = false;
      state.manualContext = "";
      state.transition = null;
      orbit.enabled = false;

      // Reconstruct the complete narrative snapshot only on camera arrival.
      sampleTour(true);
      state.modelDirty = true;
      state.modelClock = 1;
      state.uiClock = 1;

      text(
        "accessibility-status",
        "Guided flight resumed. Chapter " + (state.chapter + 1) +
        ". Protocol history reconstructed for this narrative snapshot."
      );
    }

    function togglePause() {
      if (!state.ready) return;

      state.paused = !state.paused;
      state.last = 0;
      state.uiClock = 1;
      updateHUD();
    }

    function toggleHUD() {
      if (!state.ready) return;

      state.hidden = !state.hidden;

      if (
        state.hidden &&
        hudRegions.some(node => node.contains(document.activeElement))
      ) {
        $("hud-toggle").focus();
      }

      document.body.classList.toggle("hud-hidden", state.hidden);

      hudRegions.forEach(node => {
        node.inert = state.hidden;
        node.setAttribute("aria-hidden", String(state.hidden));
      });

      $("hud-toggle").setAttribute(
        "aria-pressed",
        String(state.hidden)
      );

      $("hud-toggle").setAttribute(
        "aria-label",
        state.hidden ? "Show interface" : "Hide interface"
      );

      text("hud-label", state.hidden ? "Show HUD" : "Hide HUD");
      state.uiClock = 1;
      measureLabels();
    }

    function interruptPointer() {
      if (!state.ready || state.lost) return;
      enterManual();
    }

    // Capture listeners establish camera ownership before OrbitControls handles
    // the same gesture. r128 also uses touch events, so both paths are covered.
    canvas.addEventListener(
      "pointerdown",
      interruptPointer,
      { capture: true }
    );

    canvas.addEventListener(
      "touchstart",
      interruptPointer,
      { capture: true, passive: true }
    );

    canvas.addEventListener(
      "wheel",
      interruptPointer,
      { capture: true, passive: true }
    );

    canvas.addEventListener("contextmenu", event => {
      event.preventDefault();
    });

    $("radius-control").addEventListener("input", event => {
      changeGeometry("q", event.target);
    });

    $("region-control").addEventListener("input", event => {
      changeGeometry("delta", event.target);
    });

    $("view-select").addEventListener("change", event => {
      state.view = event.target.value;
      state.uiClock = 1;
    });

    [
      ["wedge-toggle", "wedge"],
      ["correlation-toggle", "correlations"]
    ].forEach(([id, key]) => {
      $(id).addEventListener("click", () => {
        state[key] = !state[key];
        $(id).setAttribute("aria-pressed", String(state[key]));
        state.uiClock = 1;
      });
    });

    $("protocol-run").addEventListener("click", () => {
      startEpisode("coupled");
    });

    $("signal-test").addEventListener("click", () => {
      startEpisode("trial");
    });

    $("protocol-reset").addEventListener("click", () => {
      startEpisode("idle");
    });

    $("pause-toggle").addEventListener("click", togglePause);
    $("hud-toggle").addEventListener("click", toggleHUD);

    $("resume-flight").addEventListener("click", () => {
      requestFlight(state.tour);
    });

    chapterButtons.forEach((button, index) => {
      button.addEventListener("click", () => {
        requestFlight(starts[index]);
      });
    });

    document.addEventListener("keydown", event => {
      const node = event.target;

      if (
        !state.ready ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        node.isContentEditable ||
        /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)
      ) {
        return;
      }

      if (event.code === "Space") {
        if (node.closest("button,a,summary")) return;
        event.preventDefault();
        togglePause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        requestFlight(state.tour);
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggleHUD();
      }
    });

    function projection(dt, immediate = false) {
      const desired = !state.hidden && state.width > 760
        ? Math.min(panelRight + 12, state.width * 0.42) / 2
        : 0;

      viewShift = immediate
        ? desired
        : lerp(viewShift, desired, 1 - Math.exp(-dt * 6));

      [camera, controlCamera].forEach(item => {
        item.aspect = state.width / state.height;

        item.setViewOffset(
          state.width,
          state.height,
          -viewShift,
          0,
          state.width,
          state.height
        );

        item.updateProjectionMatrix();
      });
    }

    function resize() {
      const bounds = container.getBoundingClientRect();

      state.width = Math.max(1, Math.round(bounds.width));
      state.height = Math.max(1, Math.round(bounds.height));

      state.dpr = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        Math.sqrt(2400000 / (state.width * state.height))
      );

      renderer.setPixelRatio(state.dpr);
      renderer.setSize(state.width, state.height, false);

      canvas.style.width = "100%";
      canvas.style.height = "100%";

      composer.setPixelRatio(state.dpr);
      composer.setSize(state.width, state.height);

      bloom.setSize(
        Math.max(1, Math.round(state.width * state.dpr * 0.65)),
        Math.max(1, Math.round(state.height * state.dpr * 0.65))
      );

      fxaa.uniforms.resolution.value.set(
        1 / Math.max(1, Math.floor(state.width * state.dpr)),
        1 / Math.max(1, Math.floor(state.height * state.dpr))
      );

      labelRenderer.setSize(state.width, state.height);

      leaders.setAttribute(
        "viewBox",
        "0 0 " + state.width + " " + state.height
      );

      measureLabels();
      projection(0, true);

      resizePending = false;
      state.uiClock = 1;
    }

    window.addEventListener("resize", () => {
      resizePending = true;
    });

    if (window.ResizeObserver) {
      const observer = new ResizeObserver(() => {
        resizePending = true;
      });

      observer.observe(container);
    }

    document.querySelectorAll("details").forEach(node => {
      node.addEventListener("toggle", () => {
        state.uiClock = 1;
      });
    });

    $("sidebar-content").addEventListener(
      "scroll",
      () => {
        state.uiClock = 1;
      },
      { passive: true }
    );

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => {
        state.uiClock = 1;
      });
    }

    document.addEventListener("visibilitychange", () => {
      state.last = 0;
    });

    function reducedMotionChanged() {
      if (motion.matches) {
        state.paused = true;
        state.last = 0;
        state.uiClock = 1;
      }
    }

    if (motion.addEventListener) {
      motion.addEventListener("change", reducedMotionChanged);
    } else {
      motion.addListener(reducedMotionChanged);
    }

    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      state.lost = true;
      state.ready = false;
      state.last = 0;
      orbit.enabled = false;
      gate(false);

      notice(
        "Graphics context interrupted",
        "The observatory is paused while the graphics context recovers.",
        "The current camera, geometry, and protocol history are preserved.",
        true
      );

      text("model-status", "Graphics context lost");
    });

    canvas.addEventListener("webglcontextrestored", () => {
      if (state.failed) return;

      try {
        composer.reset();

        textures.forEach(texture => {
          texture.needsUpdate = true;
        });

        state.lost = false;
        state.ready = false;
        state.last = 0;
        resizePending = true;
        state.modelDirty = true;
        state.modelClock = 1;

        notice(
          "Restoring the observatory",
          "Rebuilding GPU resources.",
          "Controls return after a successful frame."
        );
      } catch (error) {
        fail(error);
      }
    });

    function verifyFirstFrame() {
      if (gl.isContextLost()) return false;

      const bad = (renderer.info.programs || []).find(program =>
        program.diagnostics &&
        program.diagnostics.runnable === false
      );

      if (bad) {
        throw new Error("A graphics shader failed to compile or link.");
      }

      state.ready = true;
      orbit.enabled = state.manual && !state.transition;
      gate(true);

      $("render-notice").hidden = true;
      document.body.classList.remove("is-loading", "render-failed");
      state.uiClock = 1;

      return true;
    }

    function frame(now) {
      if (state.failed) return;

      raf = requestAnimationFrame(frame);

      if (state.lost || document.hidden) {
        state.last = 0;
        return;
      }

      const dt = state.last
        ? Math.min(0.05, (now - state.last) / 1000)
        : 0;

      state.last = now;

      const advance = state.ready && !state.paused ? dt : 0;

      try {
        if (resizePending) resize();

        if (state.transition) {
          const transition = state.transition;

          transition.time = Math.min(
            transition.duration,
            transition.time + advance
          );

          const f = ease(transition.time / transition.duration);

          camera.position.lerpVectors(
            transition.fromPosition,
            transition.destination.position,
            f
          );

          camera.quaternion.slerpQuaternions(
            transition.fromQuaternion,
            transition.destination.quaternion,
            f
          );

          camera.fov = lerp(
            transition.fromFov,
            transition.destination.fov,
            f
          );

          focus.lerpVectors(
            transition.fromTarget,
            transition.destination.target,
            f
          );

          if (transition.time >= transition.duration) {
            commitFlight(transition);
          }
        } else {
          if (state.owner === "tour") {
            state.tour = (state.tour + advance) % totalTime;
            sampleTour();
          } else if (state.owner === "independent") {
            state.episode.time = Math.min(
              1,
              state.episode.time + advance /
                (state.episode.kind === "trial" ? 18 : 28)
            );

            protocol = sampleProtocol(
              state.episode.kind,
              state.episode.time
            );
          }

          if (state.manual) {
            orbit.enabled = state.ready;
            orbit.update();

            const weight = motion.matches
              ? 1
              : 1 - Math.exp(-dt * 18);

            camera.position.lerp(controlCamera.position, weight);
            camera.quaternion.slerp(controlCamera.quaternion, weight);
            camera.fov = controlCamera.fov;
            focus.copy(orbit.target);
          } else {
            samplePose(state.tour);
            camera.position.copy(pose.position);
            camera.quaternion.copy(pose.quaternion);
            camera.fov = pose.fov;
            focus.copy(pose.target);
          }
        }

        state.modelClock += dt;

        if (
          state.modelDirty &&
          (state.modelClock >= 0.075 || !state.ready)
        ) {
          updateGeometry();
          state.modelClock = 0;
        }

        updateVisuals();

        state.uiClock += dt;

        if (state.uiClock >= 0.12 || !state.ready) {
          updateHUD();
          measureLabels();
          state.uiClock = 0;
        }

        projection(dt);
        camera.updateMatrixWorld();

        matrices.forEach(item => {
          item.plane.quaternion.copy(camera.quaternion);
        });

        scene.updateMatrixWorld();
        layoutLabels(dt);

        composer.render(dt);
        labelRenderer.render(scene, camera);

        if (!state.ready) verifyFirstFrame();
      } catch (error) {
        cancelAnimationFrame(raf);
        fail(error);
      }
    }

    state.start = () => {
      gate(false);
      state.manualContext = "";

      sampleTour(true);
      updateGeometry();
      samplePose(state.tour);

      camera.position.copy(pose.position);
      camera.quaternion.copy(pose.quaternion);
      camera.fov = pose.fov;
      focus.copy(pose.target);

      updateHUD();
      resize();

      notice(
        "Preparing the observatory",
        "Compiling the geometry and lighting.",
        "The first successful graphics frame will enable the controls."
      );

      raf = requestAnimationFrame(frame);
    };

    return state;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();