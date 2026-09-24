/* Optical Lattice / Bose–Hubbard System
 * Three.js r128; no build step or additional project files.
 * Homogeneous cubic, zero-temperature single-site Gutzwiller mean field.
 * The visible 7³ array is a bulk window, not a finite-boundary calculation.
 * References: arxiv.org/abs/cond-mat/9805329 and cond-mat/0011108.
 */
(() => {
  "use strict";

  const PI = Math.PI;
  const NMAX = 12;
  const DIM = NMAX + 1;
  const Z = 6;
  const SIDE = 7;
  const NS = SIDE ** 3;
  const SPACING = 2;
  const CRITICAL_DEPTH = 11.11960641659203;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const mix = (a, b, t) => a + (b - a) * t;
  const ease = t => t * t * t * (t * (6 * t - 15) + 10);
  const $ = id => document.getElementById(id);

  const setText = (id, value) => {
    const node = $(id);
    if (node && node.textContent !== value) node.textContent = value;
  };

  const sci = x => x === 0 ? "0" : x.toExponential(2);

  const clockText = t => {
    const seconds = Math.floor(t);
    return String(Math.floor(seconds / 60)).padStart(2, "0") + ":" +
      String(seconds % 60).padStart(2, "0");
  };

  let app = null;

  function notice(title, message, detail, reload = false) {
    setText("notice-title", title);
    setText("notice-message", message);
    setText("notice-detail", detail);
    $("render-notice").hidden = false;
    $("notice-reload").hidden = !reload;
  }

  function gate(enabled) {
    document.querySelectorAll("[data-engine-control]").forEach(el => {
      el.disabled = !enabled;
    });
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
      "The visualization could not start",
      "Reload after checking that WebGL is enabled and the Three.js libraries are reachable.",
      String(error && error.message || error),
      true
    );

    setText("solver-status", "Renderer unavailable");
  }

  function boundary(m) {
    const n = Math.floor(m) + 1;
    return {
      n,
      t: (n - m) * (m - n + 1) / (Z * (m + 1))
    };
  }

  function siteGround(t, m, trial) {
    const A = Array.from({ length: DIM }, (_, i) =>
      Array.from({ length: DIM }, (_, j) =>
        i === j
          ? i * (i - 1) / 2 - m * i
          : Math.abs(i - j) === 1
            ? -Z * t * trial * Math.sqrt(Math.max(i, j))
            : 0
      )
    );

    const eigenvectors = Array.from({ length: DIM }, (_, i) =>
      Array.from({ length: DIM }, (_, j) => Number(i === j))
    );

    // Cyclic Jacobi diagonalization of the real symmetric local Hamiltonian.
    for (let sweep = 0; sweep < 24; sweep++) {
      let largest = 0;

      for (let p = 0; p < DIM - 1; p++) {
        for (let q = p + 1; q < DIM; q++) {
          const apq = A[p][q];
          largest = Math.max(largest, Math.abs(apq));

          if (Math.abs(apq) < 1e-14) continue;

          const theta = (A[q][q] - A[p][p]) / (2 * apq);
          const tangent = (theta >= 0 ? 1 : -1) /
            (Math.abs(theta) + Math.hypot(theta, 1));
          const c = 1 / Math.hypot(1, tangent);
          const s = tangent * c;

          A[p][p] -= tangent * apq;
          A[q][q] += tangent * apq;
          A[p][q] = A[q][p] = 0;

          for (let k = 0; k < DIM; k++) {
            if (k !== p && k !== q) {
              const akp = A[k][p];
              const akq = A[k][q];

              A[k][p] = A[p][k] = c * akp - s * akq;
              A[k][q] = A[q][k] = s * akp + c * akq;
            }

            const vkp = eigenvectors[k][p];
            const vkq = eigenvectors[k][q];

            eigenvectors[k][p] = c * vkp - s * vkq;
            eigenvectors[k][q] = s * vkp + c * vkq;
          }
        }
      }

      if (largest < 1e-12) break;

      if (sweep === 23) {
        throw new Error("The local eigensolver did not converge.");
      }
    }

    let column = 0;

    for (let i = 1; i < DIM; i++) {
      if (A[i][i] < A[column][column]) column = i;
    }

    // The ground state has nonnegative coefficients for real positive trial ψ.
    const c = eigenvectors.map(row => Math.abs(row[column]));
    const norm = Math.hypot(...c);
    const probabilities = c.map(value => (value / norm) ** 2);

    let mean = 0;
    let second = 0;
    let psi = 0;

    for (let n = 0; n < DIM; n++) {
      mean += n * probabilities[n];
      second += n * n * probabilities[n];

      if (n < NMAX) {
        psi += Math.sqrt(n + 1) * c[n] * c[n + 1] / (norm * norm);
      }
    }

    return {
      probabilities,
      psi,
      mean,
      variance: Math.max(0, second - mean * mean),
      pairs: Math.max(0, (second - mean) / 2),
      tail: probabilities[NMAX],
      residual: Math.abs(psi - trial),
      energyOverU: A[column][column] + Z * t * trial * trial
    };
  }

  function solveState(s, m) {
    const J = 4 / Math.sqrt(PI) * s ** 0.75 *
      Math.exp(-2 * Math.sqrt(s));
    const U = Math.sqrt(8 / PI) * PI * 0.02 * s ** 0.75;
    const t = J / U;
    const critical = boundary(m);
    const isMott = t <= critical.t * (1 + 1e-12);

    let local;

    if (isMott) {
      const n = critical.n;
      const probabilities = Array(DIM).fill(0);
      probabilities[n] = 1;

      local = {
        probabilities,
        psi: 0,
        mean: n,
        variance: 0,
        pairs: n * (n - 1) / 2,
        tail: 0,
        residual: 0,
        energyOverU: n * (n - 1) / 2 - m * n
      };
    } else {
      // Bracket the positive root. Starting fixed-point iteration at zero
      // would incorrectly trap the calculation in an unstable number state.
      let lo = 0;
      let hi = Math.sqrt(NMAX);

      for (let iteration = 0; iteration < 45; iteration++) {
        const trial = (lo + hi) / 2;
        const candidate = siteGround(t, m, trial);

        if (candidate.psi > trial) lo = trial;
        else hi = trial;
      }

      local = siteGround(t, m, (lo + hi) / 2);
    }

    return {
      ...local,
      s,
      m,
      J,
      U,
      t,
      ratio: U / J,
      ell: 1 / (PI * s ** 0.25),
      isMott,
      mottFilling: isMott ? critical.n : null,
      criticalT: critical.t,
      coherent: local.mean > 0
        ? clamp(local.psi ** 2 / local.mean, 0, 1)
        : 0
    };
  }

  function dirichlet(q) {
    const d = Math.sin(q * 0.5);
    return Math.abs(d) < 1e-8
      ? SIDE
      : Math.sin(SIDE * q * 0.5) / d;
  }

  function momentum(qx, qy, state) {
    const dx = dirichlet(qx);
    const dy = dirichlet(qy);
    const structure = dx * dx * dy * dy * SIDE * SIDE / NS;

    return Math.exp(-(state.ell ** 2) * (qx * qx + qy * qy)) *
      (1 - state.coherent + state.coherent * structure);
  }

  function boot() {
    $("notice-reload").addEventListener("click", () => location.reload());

    try {
      if (!window.THREE) {
        throw new Error("The Three.js core library did not load.");
      }

      const required = [
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

      required.forEach(name => {
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
    const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

    const state = {
      ready: false,
      failed: false,
      lost: false,
      paused: false,
      manual: false,
      hidden: false,
      tour: 0,
      teaching: 0,
      chapter: -1,
      transition: null,
      depth: 6.5,
      chemical: 0.4,
      view: "coherence",
      site: "center",
      inspection: "",
      dirty: true,
      plotsDirty: true,
      hudClock: 0,
      solveClock: 0,
      last: 0,
      width: 1,
      height: 1,
      dpr: 1
    };

    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    state.paused = reducedMotion.matches;

    const container = $("canvas-container");
    const canvas = document.createElement("canvas");

    const contextOptions = {
      alpha: false,
      antialias: false,
      depth: true,
      stencil: false,
      powerPreference: "high-performance"
    };

    const gl = canvas.getContext("webgl2", contextOptions) ||
      canvas.getContext("webgl", contextOptions);

    if (!gl) {
      throw new Error("This browser could not create a WebGL context.");
    }

    const renderer = new T.WebGLRenderer({
      canvas,
      context: gl,
      ...contextOptions
    });

    renderer.setClearColor(0x02050b, 1);
    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.debug.checkShaderErrors = true;

    container.appendChild(canvas);
    canvas.setAttribute("aria-hidden", "true");

    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0x030711, 0.012);

    const camera = new T.PerspectiveCamera(48, 1, 0.08, 220);
    camera.position.set(31, 20, 36);
    camera.lookAt(0, 0, 0);

    // OrbitControls owns this clone. The render loop owns the visible camera.
    const controlCamera = camera.clone();
    const orbit = new T.OrbitControls(controlCamera, canvas);

    state.orbit = orbit;
    orbit.enabled = false;
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.075;
    orbit.rotateSpeed = 0.5;
    orbit.zoomSpeed = 0.7;
    orbit.panSpeed = 0.7;
    orbit.minDistance = 1.3;
    orbit.maxDistance = 115;
    orbit.maxPolarAngle = PI * 0.96;
    orbit.target.set(0, 0, 0);

    const hdr = renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("EXT_color_buffer_float");

    const target = new T.WebGLRenderTarget(1, 1, {
      type: hdr ? T.HalfFloatType : T.UnsignedByteType,
      format: T.RGBAFormat,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(renderer, target);
    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      0.5,
      0.45,
      0.72
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
          gl_FragColor = vec4(
            srgb(aces(texture2D(tDiffuse, vUv).rgb)),
            1.0
          );
        }
      `
    });

    composer.addPass(output);

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    const labels = new T.CSS2DRenderer();
    labels.domElement.className = "label-layer";
    labels.domElement.style.pointerEvents = "none";
    $("observatory").appendChild(labels.domElement);

    const svgNS = "http://www.w3.org/2000/svg";
    const leaders = document.createElementNS(svgNS, "svg");
    leaders.classList.add("world-leaders");
    leaders.setAttribute("aria-hidden", "true");
    $("observatory").appendChild(leaders);

    const cyan = 0x53eadc;
    const blue = 0x548fff;
    const violet = 0xaf76ff;
    const gold = 0xe4bd75;

    const dummy = new T.Object3D();
    const up = V(0, 1, 0);
    const scratch = V();
    const projected = V();
    const focus = V();

    let result = solveState(state.depth, state.chemical);

    const sfReference = solveState(6.5, 0.4);
    const mottReference = solveState(18, 0.4);
    const resources = [];

    let cachedHUDRects = [];

    function line(points, color, opacity = 1, segments = false) {
      const geometry = new T.BufferGeometry().setFromPoints(points);

      const material = new T.LineBasicMaterial({
        color,
        transparent: true,
        opacity,
        depthWrite: false
      });

      return segments
        ? new T.LineSegments(geometry, material)
        : new T.Line(geometry, material);
    }

    function ring(radius, color, opacity = 0.65) {
      const points = [];

      for (let i = 0; i <= 80; i++) {
        const a = i / 80 * PI * 2;
        points.push(V(
          Math.cos(a) * radius,
          0,
          Math.sin(a) * radius
        ));
      }

      return line(points, color, opacity);
    }

    function cloudMaterial(color = cyan) {
      return new T.ShaderMaterial({
        uniforms: {
          tint: { value: new T.Color(color) },
          strength: { value: 0.65 }
        },

        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,

        vertexShader: `
          varying vec2 vUv;

          void main() {
            vUv = uv;

            vec4 p = modelViewMatrix * instanceMatrix *
              vec4(0.0, 0.0, 0.0, 1.0);

            vec2 s = vec2(
              length(instanceMatrix[0].xyz),
              length(instanceMatrix[1].xyz)
            );

            p.xy += position.xy * s;
            gl_Position = projectionMatrix * p;
          }
        `,

        fragmentShader: `
          varying vec2 vUv;
          uniform vec3 tint;
          uniform float strength;

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = dot(p, p);
            float a = exp(-5.0 * r) *
              (1.0 - smoothstep(0.65, 1.0, r));

            if (a < 0.002) discard;

            gl_FragColor = vec4(
              tint * (0.7 + exp(-18.0 * r)),
              a * strength
            );
          }
        `
      });
    }

    const cloudGeometry = new T.PlaneGeometry(1, 1);

    function cloudArray(positions, material) {
      const mesh = new T.InstancedMesh(
        cloudGeometry,
        material,
        positions.length
      );

      mesh.frustumCulled = false;
      mesh.userData.positions = positions;
      mesh.instanceMatrix.setUsage(T.DynamicDrawUsage);
      scene.add(mesh);

      return mesh;
    }

    function sizeClouds(mesh, size) {
      mesh.userData.positions.forEach((p, i) => {
        dummy.position.copy(p);
        dummy.quaternion.identity();
        dummy.scale.setScalar(Array.isArray(size) ? size[i] : size);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });

      mesh.instanceMatrix.needsUpdate = true;
    }

    const sites = [];

    for (let x = -3; x <= 3; x++) {
      for (let y = -3; y <= 3; y++) {
        for (let z = -3; z <= 3; z++) {
          sites.push(V(x, y, z).multiplyScalar(SPACING));
        }
      }
    }

    const populationMaterial = cloudMaterial(cyan);
    const population = cloudArray(sites, populationMaterial);
    const edges = [];

    sites.forEach(p => {
      for (let axis = 0; axis < 3; axis++) {
        if (p.getComponent(axis) < 3 * SPACING) {
          const q = p.clone();
          q.setComponent(axis, q.getComponent(axis) + SPACING);
          edges.push([p, q]);
        }
      }
    });

    const bridgeMaterial = new T.MeshBasicMaterial({
      color: cyan,
      transparent: true,
      opacity: 0.2,
      blending: T.AdditiveBlending,
      depthWrite: false
    });

    const bridges = new T.InstancedMesh(
      new T.CylinderGeometry(1, 1, 1, 6, 1, true),
      bridgeMaterial,
      edges.length
    );

    bridges.frustumCulled = false;
    scene.add(bridges);

    function updateBridges() {
      const radius = 0.012 + 0.075 * result.coherent *
        Math.sqrt(result.J / sfReference.J);

      edges.forEach(([p, q], i) => {
        dummy.position.copy(p).add(q).multiplyScalar(0.5);
        scratch.subVectors(q, p);
        dummy.quaternion.setFromUnitVectors(
          up,
          scratch.clone().normalize()
        );
        dummy.scale.set(radius, SPACING, radius);
        dummy.updateMatrix();
        bridges.setMatrixAt(i, dummy.matrix);
      });

      bridges.instanceMatrix.needsUpdate = true;
      bridgeMaterial.opacity = 0.36 * result.coherent;
      bridges.visible = state.view === "coherence" &&
        result.coherent > 1e-7;
    }

    // Explanatory height plot of the static red-detuned potential.
    // Minima coincide with time-averaged cos² optical-intensity maxima.
    const potentialMaterial = new T.ShaderMaterial({
      uniforms: {
        depth: { value: result.s },
        alpha: { value: 0.43 }
      },

      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,

      vertexShader: `
        uniform float depth;
        varying vec2 q;
        varying float h;

        void main() {
          q = position.xy;
          vec2 s = sin(3.14159265359 * q / 2.0);
          h = dot(s, s);

          vec3 p = vec3(
            q.x,
            -6.5 + 0.065 * depth * h,
            q.y
          );

          gl_Position = projectionMatrix * modelViewMatrix *
            vec4(p, 1.0);
        }
      `,

      fragmentShader: `
        uniform float alpha;
        varying vec2 q;
        varying float h;

        void main() {
          float contours = pow(
            0.5 + 0.5 * cos(6.28318530718 * h * 5.0),
            16.0
          );

          float rim = 1.0 - smoothstep(
            6.2,
            7.0,
            max(abs(q.x), abs(q.y))
          );

          vec3 c = mix(
            vec3(0.025, 0.12, 0.3),
            vec3(0.28, 0.22, 0.7),
            h * 0.5
          );

          c += contours * vec3(0.12, 0.35, 0.6);

          gl_FragColor = vec4(
            c,
            alpha * rim * (0.32 + contours * 0.5)
          );
        }
      `
    });

    const potential = new T.Mesh(
      new T.PlaneGeometry(14, 14, 112, 112),
      potentialMaterial
    );

    potential.frustumCulled = false;
    scene.add(potential);

    const opticalWaves = [];

    for (let axis = 0; axis < 3; axis++) {
      for (let sign = -1; sign <= 1; sign += 2) {
        const geometry = new T.BufferGeometry();

        geometry.setAttribute(
          "position",
          new T.BufferAttribute(new Float32Array(193 * 3), 3)
        );

        const material = new T.LineBasicMaterial({
          color: axis === 0 ? blue : axis === 1 ? violet : cyan,
          transparent: true,
          opacity: 0.25,
          depthWrite: false,
          blending: T.AdditiveBlending
        });

        const wave = new T.Line(geometry, material);
        wave.frustumCulled = false;
        scene.add(wave);
        opticalWaves.push({ wave, axis, sign });
      }
    }

    function animateOptics(time) {
      opticalWaves.forEach(({ wave, axis, sign }) => {
        const attribute = wave.geometry.attributes.position;

        for (let i = 0; i < attribute.count; i++) {
          const q = -9 + 18 * i / (attribute.count - 1);
          const carrier = 0.3 *
            Math.cos(PI * q / SPACING - sign * time * 0.8);
          const offset = sign * 0.3;

          if (axis === 0) {
            attribute.setXYZ(
              i, q, -7.25 + carrier, -7.4 + offset
            );
          }

          if (axis === 1) {
            attribute.setXYZ(
              i, -7.4 + offset, q, -7.25 + carrier
            );
          }

          if (axis === 2) {
            attribute.setXYZ(
              i, -7.25 + carrier, -7.4 + offset, q
            );
          }
        }

        attribute.needsUpdate = true;
        wave.material.opacity =
          state.view === "potential" || state.chapter === 1
            ? 0.8
            : 0.25;
      });
    }

    const intensityMaterial = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,

      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix *
            vec4(position, 1.0);
        }
      `,

      fragmentShader: `
        varying vec2 vUv;

        void main() {
          float x = (vUv.x - 0.5) * 18.0;
          float c = cos(3.14159265359 * x / 2.0);
          float edge = pow(
            sin(3.14159265359 * vUv.y),
            2.0
          );

          gl_FragColor = vec4(
            0.08,
            0.35,
            0.9,
            0.6 * c * c * edge
          );
        }
      `
    });

    const intensity = new T.Mesh(
      new T.PlaneGeometry(18, 0.8),
      intensityMaterial
    );

    intensity.rotation.x = -PI / 2;
    intensity.position.set(0, -7.35, -6.2);
    scene.add(intensity);

    const selectedHalo = ring(0.55, gold);
    selectedHalo.position.set(0, -0.4, 0);
    scene.add(selectedHalo);

    const uncertaintyHalo = ring(0.65, violet, 0.38);
    scene.add(uncertaintyHalo);

    const siteCoordinates = {
      center: V(),
      neighbor: V(2, 0, 0),
      upper: V(0, 2, 0)
    };

    // Six independent reference objects outside the bulk lattice.
    const referencePositions = {
      site: V(16, -3, 4),
      wannier: V(22, -3, 4),
      tunneling: V(28, -3, 4),
      interaction: V(16, -3, -4),
      superfluid: V(22, -3, -4),
      mott: V(28, -3, -4)
    };

    Object.entries(referencePositions).forEach((entry, index) => {
      const position = entry[1];
      const base = ring(1.65, index > 2 ? gold : blue, 0.45);
      base.position.copy(position).y -= 0.45;
      scene.add(base);
    });

    const siteRef = cloudArray(
      [referencePositions.site],
      cloudMaterial(cyan)
    );

    const wannierRef = cloudArray(
      [referencePositions.wannier],
      cloudMaterial(violet)
    );

    const dimerPositions = [
      referencePositions.tunneling.clone().add(V(-0.9, 0, 0)),
      referencePositions.tunneling.clone().add(V(0.9, 0, 0))
    ];

    const dimerLeft = cloudArray(
      [dimerPositions[0]],
      cloudMaterial(cyan)
    );

    const dimerRight = cloudArray(
      [dimerPositions[1]],
      cloudMaterial(violet)
    );

    sizeClouds(dimerLeft, 2.2);
    sizeClouds(dimerRight, 2.2);

    const dimerLink = line(dimerPositions, blue, 0.45);
    scene.add(dimerLink);

    const interactionRef = cloudArray(
      [referencePositions.interaction],
      cloudMaterial(gold)
    );

    sizeClouds(interactionRef, 2.5);

    [0.65, 1.0, 1.35].forEach((r, i) => {
      const object = ring(r, gold, 0.7 - i * 0.15);
      object.position.copy(referencePositions.interaction).y += i * 0.3;
      scene.add(object);
    });

    function referenceStrip(name, sample) {
      const positions = [-1, 0, 1].map(x =>
        referencePositions[name].clone().add(V(x * 0.85, 0, 0))
      );

      const material = cloudMaterial(name === "mott" ? gold : cyan);
      const object = cloudArray(positions, material);

      sizeClouds(object, 7.5 * SPACING * sample.ell * 0.6);

      if (name === "superfluid") {
        scene.add(line(positions, cyan, 0.55));
      }

      return object;
    }

    referenceStrip("superfluid", sfReference);
    referenceStrip("mott", mottReference);

    // Faint deterministic instrument-space background, not simulated atoms.
    const stars = new Float32Array(480 * 3);
    let seed = 1907;

    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    for (let i = 0; i < 480; i++) {
      const a = random() * 2 * PI;
      const z = random() * 2 - 1;
      const r = 65 + random() * 30;
      const d = Math.sqrt(1 - z * z);

      stars[i * 3] = r * d * Math.cos(a);
      stars[i * 3 + 1] = r * z;
      stars[i * 3 + 2] = r * d * Math.sin(a);
    }

    const starGeometry = new T.BufferGeometry();

    starGeometry.setAttribute(
      "position",
      new T.BufferAttribute(stars, 3)
    );

    scene.add(new T.Points(
      starGeometry,
      new T.PointsMaterial({
        color: 0x528299,
        size: 0.07,
        transparent: true,
        opacity: 0.35,
        depthWrite: false
      })
    ));

    const plotContexts = {};

    [
      "occupation-chart",
      "momentum-chart",
      "phase-chart"
    ].forEach(id => {
      const context = $(id).getContext("2d");

      if (!context) {
        throw new Error("A diagnostic canvas could not be created.");
      }

      plotContexts[id] = context;
    });

    function chartBase(ctx, title, subtitle) {
      const w = ctx.canvas.width;
      const h = ctx.canvas.height;

      ctx.fillStyle = "#050c17";
      ctx.fillRect(0, 0, w, h);
      ctx.textAlign = "left";
      ctx.font = "bold 15px monospace";
      ctx.fillStyle = "#c8e5f4";
      ctx.fillText(title, 20, 26);
      ctx.font = "12px monospace";
      ctx.fillStyle = "#90a6c1";
      ctx.fillText(subtitle, 20, 47);
      ctx.lineWidth = 1;

      return { w, h };
    }

    function drawOccupation(ctx, sample) {
      const { w, h } = chartBase(
        ctx,
        "SITE OCCUPATION",
        "Probability in the local number basis"
      );

      const l = 42;
      const r = w - 15;
      const top = 65;
      const bottom = h - 32;

      ctx.font = "11px monospace";
      ctx.textAlign = "right";

      for (let j = 0; j <= 2; j++) {
        const p = j / 2;
        const y = mix(bottom, top, p);

        ctx.strokeStyle = "#1c2c41";
        ctx.beginPath();
        ctx.moveTo(l, y);
        ctx.lineTo(r, y);
        ctx.stroke();

        ctx.fillStyle = "#8da5bf";
        ctx.fillText(p.toFixed(1), l - 6, y + 4);
      }

      const step = (r - l) / DIM;

      for (let n = 0; n < DIM; n++) {
        const height = sample.probabilities[n] * (bottom - top);
        const x = l + n * step + 5;

        ctx.fillStyle = sample.isMott ? "#e4bd75" : "#55dacd";
        ctx.fillRect(
          x,
          bottom - height,
          step - 9,
          Math.max(height, 0.6)
        );

        ctx.fillStyle = "#9ab0c8";
        ctx.textAlign = "center";
        ctx.fillText(
          String(n),
          x + (step - 9) / 2,
          bottom + 18
        );
      }
    }

    const mapCanvas = document.createElement("canvas");
    mapCanvas.width = mapCanvas.height = 193;

    const mapContext = mapCanvas.getContext("2d");

    if (!mapContext) {
      throw new Error("Momentum-map drawing is unavailable.");
    }

    const mapImage = mapContext.createImageData(193, 193);

    function drawMomentum(ctx, sample, title = "LIVE MOMENTUM SLICE") {
      const { w, h } = chartBase(
        ctx,
        title,
        "kz = 0 · fixed logarithmic exposure · 7³ sites"
      );

      // Identical exposure for live, SF and Mott images.
      // No independent normalization that would erase their contrast.
      const logMaximum = Math.log1p(NS);

      for (let y = 0; y < 193; y++) {
        const qy = (1 - y / 192 * 2) * 3 * PI;

        for (let x = 0; x < 193; x++) {
          const qx = (x / 192 * 2 - 1) * 3 * PI;

          const brightness = clamp(
            Math.log1p(momentum(qx, qy, sample)) / logMaximum,
            0,
            1
          );

          const b = Math.pow(brightness, 0.67);
          const index = (y * 193 + x) * 4;

          mapImage.data[index] = Math.round(5 + 215 * b ** 2);
          mapImage.data[index + 1] = Math.round(10 + 235 * b);
          mapImage.data[index + 2] = Math.round(
            25 + 215 * Math.sqrt(b)
          );
          mapImage.data[index + 3] = 255;
        }
      }

      mapContext.putImageData(mapImage, 0, 0);

      const size = Math.min(w - 98, h - 103);
      const left = (w - size) / 2;
      const top = 62;

      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mapCanvas, left, top, size, size);
      ctx.strokeStyle = "#2c4460";
      ctx.strokeRect(left, top, size, size);

      ctx.fillStyle = "#a6bdd4";
      ctx.font = "11px monospace";
      ctx.textAlign = "center";

      [-3, 0, 3].forEach(tick => {
        const f = (tick + 3) / 6;

        ctx.fillText(
          String(tick),
          left + f * size,
          top + size + 17
        );

        ctx.fillText(
          String(-tick),
          left - 14,
          top + f * size + 4
        );
      });

      ctx.fillText("kx a / π", w / 2, h - 7);

      ctx.save();
      ctx.translate(left - 32, top + size / 2);
      ctx.rotate(-PI / 2);
      ctx.fillText("ky a / π", 0, 0);
      ctx.restore();
    }

    function drawPhase(ctx, sample) {
      const { w, h } = chartBase(
        ctx,
        "CUBIC MEAN-FIELD PHASE DIAGRAM",
        "Zero temperature · z = 6 · theoretical parameter space"
      );

      const l = 58;
      const right = w - 25;
      const top = 69;
      const bottom = h - 45;
      const maximum = Math.max(0.045, sample.t * 1.15);

      const xx = t => l + t / maximum * (right - l);
      const yy = m => bottom - m / 3 * (bottom - top);

      ctx.font = "12px monospace";

      for (let n = 1; n <= 3; n++) {
        ctx.beginPath();
        ctx.moveTo(xx(0), yy(n - 1));

        for (let i = 0; i <= 140; i++) {
          const m = n - 1 + i / 140;
          const t = (n - m) * (m - n + 1) / (Z * (m + 1));
          ctx.lineTo(xx(t), yy(m));
        }

        ctx.closePath();
        ctx.fillStyle = ["#173442", "#282b48", "#3b3035"][n - 1];
        ctx.fill();

        ctx.strokeStyle = ["#58dfd0", "#b699ed", "#dcb783"][n - 1];
        ctx.stroke();

        const m = Math.sqrt(n * (n + 1)) - 1;
        const tip = (Math.sqrt(n + 1) - Math.sqrt(n)) ** 2 / Z;

        ctx.fillStyle = "#d1dfed";
        ctx.textAlign = "left";
        ctx.fillText("n = " + n, xx(tip) + 7, yy(m) + 4);
      }

      ctx.strokeStyle = "#354861";
      ctx.beginPath();
      ctx.moveTo(l, top);
      ctx.lineTo(l, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();

      ctx.fillStyle = "#91adc6";

      for (let i = 0; i <= 4; i++) {
        const t = maximum * i / 4;
        ctx.textAlign = "center";
        ctx.fillText(t.toFixed(3), xx(t), bottom + 19);
      }

      for (let i = 0; i <= 3; i++) {
        ctx.textAlign = "right";
        ctx.fillText(String(i), l - 10, yy(i) + 4);
      }

      ctx.textAlign = "center";
      ctx.fillText("J / U", (l + right) / 2, h - 6);

      ctx.save();
      ctx.translate(16, (top + bottom) / 2);
      ctx.rotate(-PI / 2);
      ctx.fillText("μ / U", 0, 0);
      ctx.restore();

      ctx.fillStyle = "#7898ad";
      ctx.fillText(
        "SUPERFLUID",
        xx(maximum * 0.73),
        yy(2.6)
      );

      const x = xx(sample.t);
      const y = yy(sample.m);

      ctx.strokeStyle = "#e3f5ff";
      ctx.fillStyle = "#fcda95";

      ctx.beginPath();
      ctx.arc(x, y, 5, 0, 2 * PI);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 9, 0, 2 * PI);
      ctx.stroke();
    }

    const bandCanvas = document.createElement("canvas");
    bandCanvas.width = 560;
    bandCanvas.height = 280;

    const bandContext = bandCanvas.getContext("2d");

    function drawBand() {
      if (!bandContext) return;

      const ctx = bandContext;

      const { w, h } = chartBase(
        ctx,
        "LOWEST TIGHT-BINDING BAND",
        "kx cut: 4J · full cubic bandwidth: 12J"
      );

      const l = 54;
      const right = w - 25;
      const top = 66;
      const bottom = h - 40;

      ctx.strokeStyle = "#304963";
      ctx.beginPath();
      ctx.moveTo(l, top);
      ctx.lineTo(l, bottom);
      ctx.lineTo(right, bottom);
      ctx.stroke();

      ctx.strokeStyle = "#b297ff";
      ctx.lineWidth = 2;
      ctx.beginPath();

      for (let i = 0; i <= 160; i++) {
        const q = -PI + i / 160 * 2 * PI;
        const e = 2 * result.J * (1 - Math.cos(q));
        const x = mix(l, right, i / 160);
        const y = bottom - e / 0.28 * (bottom - top);

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }

      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = "#aec3d9";
      ctx.font = "12px monospace";
      ctx.textAlign = "center";

      ctx.fillText("−π/a", l, bottom + 19);
      ctx.fillText("Γ", (l + right) / 2, bottom + 19);
      ctx.fillText("X: π/a", right, bottom + 19);
      ctx.fillText(
        "quasi-momentum · first Brillouin zone",
        w / 2,
        h - 4
      );

      ctx.textAlign = "right";
      ctx.fillText("0", l - 8, bottom + 4);
      ctx.fillText("0.28", l - 8, top + 4);

      ctx.save();
      ctx.translate(14, (top + bottom) / 2);
      ctx.rotate(-PI / 2);
      ctx.textAlign = "center";
      ctx.fillText("energy above minimum / ER", 0, 0);
      ctx.restore();
    }

    function screen(source, width, position) {
      const texture = new T.CanvasTexture(source);

      texture.encoding = T.sRGBEncoding;
      texture.minFilter = T.LinearFilter;
      texture.generateMipmaps = false;

      const height = width * source.height / source.width;

      const mesh = new T.Mesh(
        new T.PlaneGeometry(width, height),
        new T.MeshBasicMaterial({
          map: texture,
          side: T.DoubleSide,
          toneMapped: false
        })
      );

      mesh.position.copy(position);
      scene.add(mesh);

      const border = line([
        V(-width / 2, -height / 2, 0.01),
        V(width / 2, -height / 2, 0.01),
        V(width / 2, height / 2, 0.01),
        V(-width / 2, height / 2, 0.01),
        V(-width / 2, -height / 2, 0.01)
      ], blue, 0.5);

      mesh.add(border);
      resources.push(texture);

      return { mesh, texture };
    }

    function momentumReference(sample, title, position) {
      const source = document.createElement("canvas");
      source.width = 560;
      source.height = 440;

      const ctx = source.getContext("2d");

      if (!ctx) {
        throw new Error("Reference-map drawing is unavailable.");
      }

      drawMomentum(ctx, sample, title);
      return screen(source, 7, position);
    }

    momentumReference(
      sfReference,
      "SUPERFLUID · s = 6.5 · μ/U = 0.4",
      V(-25, 2, -4)
    );

    momentumReference(
      mottReference,
      "MOTT · s = 18 · μ/U = 0.4",
      V(-17, 2, -4)
    );

    const bandScreen = screen(
      bandCanvas,
      10,
      V(-21, -4, -4)
    );

    const phaseScreen = screen(
      $("phase-chart"),
      11,
      V(21, 6, -14)
    );

    function drawPlots() {
      // Intrinsic canvas sizes remain valid when a <details> is collapsed.
      drawOccupation(plotContexts["occupation-chart"], result);
      drawMomentum(plotContexts["momentum-chart"], result);
      drawPhase(plotContexts["phase-chart"], result);
      drawBand();

      bandScreen.texture.needsUpdate = true;
      phaseScreen.texture.needsUpdate = true;

      const occupied = result.probabilities.map((p, n) =>
        p > 0.0005
          ? "P(" + n + ") " + (p * 100).toFixed(1) + "%"
          : ""
      ).filter(Boolean);

      setText(
        "occupation-summary",
        occupied.join("; ") +
        ". Mean " + result.mean.toFixed(3) +
        "; number uncertainty " +
        Math.sqrt(result.variance).toFixed(3) + "."
      );

      setText(
        "momentum-summary",
        "kz = 0 slice; both axes span −3π/a to 3π/a. " +
        "Shared logarithmic exposure. Mean-field coherent fraction " +
        (result.coherent * 100).toFixed(1) + "%."
      );

      setText(
        "phase-summary",
        "Horizontal J/U; vertical μ/U. Current point (" +
        result.t.toFixed(5) + ", " +
        result.m.toFixed(3) + "): " +
        (result.isMott
          ? "Mott lobe n = " + result.mottFilling
          : "superfluid") + "."
      );

      state.plotsDirty = false;
    }

    const cards = {};
    const tags = [];

    const cardNames = [
      "potential",
      "site",
      "wannier",
      "tunneling",
      "interaction",
      "superfluid",
      "mott",
      "band",
      "momentum",
      "hamiltonian",
      "phase"
    ];

    cardNames.forEach(name => {
      const template = $(name + "-card-template");

      if (!template) {
        throw new Error("Missing annotation template: " + name);
      }

      const element = template.content.firstElementChild.cloneNode(true);
      const card = element.querySelector(".world-card");
      const telemetry = document.createElement("p");

      telemetry.className = "card-note";
      card.appendChild(telemetry);

      const object = new T.CSS2DObject(element);
      const leader = document.createElementNS(svgNS, "polyline");

      leaders.appendChild(leader);
      scene.add(object);
      labels.domElement.appendChild(element);

      cards[name] = {
        element,
        card,
        telemetry,
        object,
        leader
      };
    });

    function tag(text, position, chapters) {
      const element = document.createElement("div");
      element.className = "world-tag";
      element.textContent = text;

      const object = new T.CSS2DObject(element);
      object.position.copy(position);

      scene.add(object);
      labels.domElement.appendChild(element);

      const item = { element, object, chapters };
      tags.push(item);

      return item;
    }

    const dimerTag = tag(
      "Independent two-site example",
      V(28, -1.6, 4),
      [4]
    );

    tag(
      "Optical carriers slowed · fixed intensity antinodes",
      V(0, -7.4, -7.4),
      [1]
    );

    tag(
      "Displayed envelopes are magnified",
      V(2, 2, 2),
      [2]
    );

    tag(
      "Independent n = 2 example · one interacting pair",
      V(16, -0.8, -4),
      [5, 10]
    );

    tag(
      "Fixed SF reference · s = 6.5, μ/U = 0.4",
      V(22, -1.7, -4),
      [10]
    );

    tag(
      "Fixed Mott reference · n = 1",
      V(28, -1.7, -4),
      [10]
    );

    function cardPositions() {
      cards.potential.object.position.set(0, -6.2, 0);
      cards.site.object.position.copy(siteCoordinates[state.site]);

      cards.wannier.object.position.copy(
        siteCoordinates[state.site]
      ).add(V(1, 0.2, 0));

      cards.superfluid.object.position.set(1, 2, 1);
      cards.mott.object.position.copy(siteCoordinates[state.site]);

      cards.tunneling.object.position.copy(
        referencePositions.tunneling
      );

      cards.interaction.object.position.copy(
        referencePositions.interaction
      );

      cards.band.object.position.set(-21, -4, -4);
      cards.momentum.object.position.set(-21, 2, -4);
      cards.hamiltonian.object.position.set(22, 0, 0);
      cards.phase.object.position.set(21, 6, -14);

      if (state.inspection) {
        cards[state.inspection].object.position.copy(
          referencePositions[state.inspection]
        );
      }
    }

    function showLabel(item, visible) {
      const amount = reducedMotion.matches ? 1 : 0.16;

      item.fade = mix(item.fade || 0, visible ? 1 : 0, amount);
      if (item.fade < 0.002) item.fade = 0;

      item.object.visible = item.fade > 0;
      item.element.classList.toggle("is-visible", visible);
      item.element.style.opacity = String(item.fade);
      item.element.setAttribute("aria-hidden", String(!visible));
      item.element.inert = !visible;

      if (item.leader) {
        item.leader.style.display = item.fade > 0 ? "" : "none";
        item.leader.style.opacity = String(item.fade);
      }
    }

    function visibleHUDRects() {
      const ids = state.hidden
        ? ["flight-controls"]
        : [
          "sidebar-ui",
          "flight-controls",
          "scene-caption",
          "reference-legend"
        ];

      return ids.map(id => $(id)).filter(node => {
        const style = getComputedStyle(node);

        return style.display !== "none" &&
          style.visibility !== "hidden";
      }).map(node =>
        node.getBoundingClientRect()
      ).filter(r =>
        r.width && r.height
      ).map(r => ({
        left: r.left - 10,
        top: r.top - 10,
        right: r.right + 10,
        bottom: r.bottom + 10
      }));
    }

    const intersects = (a, b) =>
      a.left < b.right &&
      a.right > b.left &&
      a.top < b.bottom &&
      a.bottom > b.top;

    function project(object) {
      projected.copy(object.position).project(camera);

      if (
        projected.z < -1 ||
        projected.z > 1 ||
        Math.abs(projected.x) > 1.04 ||
        Math.abs(projected.y) > 1.04
      ) {
        return null;
      }

      return {
        x: (projected.x + 1) * state.width / 2,
        y: (1 - projected.y) * state.height / 2
      };
    }

    function activeCardNames() {
      if (state.inspection) return [state.inspection];

      const phaseName = result.isMott ? "mott" : "superfluid";

      return [
        ["potential", phaseName],
        ["potential"],
        ["site", "wannier"],
        [phaseName],
        ["tunneling"],
        ["interaction"],
        ["potential"],
        [phaseName, "site"],
        [phaseName, "site"],
        ["momentum", "band"],
        ["hamiltonian", "interaction"],
        ["phase"],
        [phaseName, "potential"]
      ][Math.max(0, state.chapter)];
    }

    function measureLabels() {
      const items = [...Object.values(cards), ...tags];
      const previous = items.map(item => item.element.style.display);

      items.forEach(item => {
        item.element.style.display = "";
      });

      const sizes = items.map(item => {
        const node = item.card || item.element;
        return [node.offsetWidth, node.offsetHeight];
      });

      cachedHUDRects = visibleHUDRects();

      items.forEach((item, i) => {
        if (sizes[i][0] && sizes[i][1]) {
          item.width = sizes[i][0];
          item.height = sizes[i][1];
        }

        item.element.style.display = previous[i];
      });
    }

    function layoutLabels() {
      const reserved = cachedHUDRects.slice();
      const wanted = state.hidden ? [] : activeCardNames();
      const displayed = new Set();

      let count = 0;

      for (const name of wanted) {
        if (count >= (state.width > 1000 ? 2 : 1)) break;

        const item = cards[name];
        const anchor = project(item.object);

        if (!anchor) continue;

        const w = item.width || 310;
        const h = item.height || 280;

        if (!w || !h) continue;

        const candidates = [
          [anchor.x + 28, anchor.y - h / 2],
          [anchor.x - w - 28, anchor.y - h / 2],
          [anchor.x - w / 2, anchor.y - h - 26],
          [anchor.x - w / 2, anchor.y + 26],
          [state.width - w - 20, 82],
          [state.width - w - 20, state.height - h - 170]
        ];

        let chosen = null;

        for (const [left, top] of candidates) {
          const box = {
            left,
            top,
            right: left + w,
            bottom: top + h
          };

          if (
            left >= 12 &&
            top >= 12 &&
            box.right <= state.width - 12 &&
            box.bottom <= state.height - 12 &&
            !reserved.some(r => intersects(box, r))
          ) {
            chosen = box;
            break;
          }
        }

        if (!chosen) continue;

        item.card.style.setProperty(
          "--card-x",
          chosen.left - anchor.x + "px"
        );

        item.card.style.setProperty(
          "--card-y",
          chosen.top - anchor.y + "px"
        );

        const endX = clamp(anchor.x, chosen.left, chosen.right);
        const endY = clamp(anchor.y, chosen.top, chosen.bottom);

        item.leader.setAttribute(
          "points",
          anchor.x + "," + anchor.y + " " +
          mix(anchor.x, endX, 0.5) + "," + anchor.y + " " +
          endX + "," + endY
        );

        displayed.add(item);
        reserved.push(chosen);
        count++;
      }

      Object.values(cards).forEach(item => {
        showLabel(item, displayed.has(item));
      });

      tags.forEach(item => {
        let visible = !state.hidden &&
          !state.inspection &&
          item.chapters.includes(state.chapter);

        const anchor = visible ? project(item.object) : null;
        if (!anchor) visible = false;

        if (visible) {
          const w = item.width || 250;
          const h = item.height || 24;

          const box = {
            left: anchor.x - w / 2,
            right: anchor.x + w / 2,
            top: anchor.y - h / 2,
            bottom: anchor.y + h / 2
          };

          visible =
            box.left > 10 &&
            box.right < state.width - 10 &&
            box.top > 10 &&
            box.bottom < state.height - 10 &&
            !reserved.some(r => intersects(box, r));

          if (visible) reserved.push(box);
        }

        showLabel(item, visible);
      });
    }

    // Each entry: heading, title, explanation, scope, seconds,
    // camera position, look target, FOV, depth at chapter entry.
    const chapters = [
      [
        "OPTICAL LATTICE",
        "A landscape made of light.",
        "Interfering laser fields create a periodic potential. Bosonic matter occupies quantum states within its wells.",
        "The visible 7³ array is a window into a homogeneous cubic bulk model.",
        50, [31, 20, 36], [0, 0, 0], 48, 6.5
      ],
      [
        "POTENTIAL FORMATION",
        "Light writes the wells.",
        "Counter-propagating fields form a standing wave. For red detuning, atoms favor intensity antinodes; the shifted potential has sine-squared minima.",
        "Carrier motion is slowed for teaching. The time-averaged potential remains fixed.",
        45, [12, 6, 19], [0, -4, 0], 46, 6.5
      ],
      [
        "SITE INSPECTION",
        "One site. A distribution of possibilities.",
        "A site cloud represents density in a localized orbital. Its occupation is the calculated distribution P(n), rather than a collection of classical dots.",
        "All bulk sites share the same distribution. Gaussian orbital sizes are magnified.",
        45, [5, 3, 8], [0, 0, 0], 43, 6.5
      ],
      [
        "SUPERFLUID",
        "A phase shared across the lattice.",
        "Nonzero mean-field order connects neighboring sites. Local number fluctuates while the chosen order-parameter phase is uniform.",
        "Uniform phase gives no net current. Coherence links show correlations.",
        55, [-9, 4, 11], [0, 0, 0], 48, 6.5
      ],
      [
        "TUNNELING",
        "Probability moves through a coupling.",
        "This independent one-boson dimer transfers probability between its left and right wells. The total probability stays exactly one.",
        "A normalized teaching clock drives this isolated example; it is separate from the equilibrium bulk.",
        45, [31, 2, 13], [28, -3, 4], 43, 6.5
      ],
      [
        "ON-SITE INTERACTION",
        "Every pair has an energy cost.",
        "A separate n = 2 reference has one interacting pair and energy U. Three bosons would form three pairs and cost 3U.",
        "This reference occupation is not imposed on the live lattice.",
        45, [21, 3, 6], [16, -3, -4], 45, 6.5
      ],
      [
        "LATTICE RAMP",
        "Deeper wells reshape the balance.",
        "Increasing lattice depth narrows each orbital and rapidly reduces tunneling. U/J grows while the self-consistent number distribution changes.",
        "The ramp samples grand-canonical equilibrium states, not real-time loading dynamics.",
        60, [16, 12, 22], [0, 0, 0], 49, 6.5
      ],
      [
        "QUANTUM TRANSITION",
        "Coherence approaches its boundary.",
        "The order parameter and number uncertainty fall as the trajectory enters the mean-field Mott lobe. The coherent bridges disappear with the calculated order.",
        "INTERMEDIATE labels a near-boundary display band, not an additional thermodynamic phase.",
        70, [4, 3, 14], [0, 0, 0], 47, 10.5
      ],
      [
        "MOTT INSULATOR",
        "Number becomes localized.",
        "At this integer-filling reference, single-site mean field selects n = 1 and zero order parameter. J remains finite even though coherent links vanish.",
        "The full many-body Mott state has virtual particle–hole fluctuations omitted by this approximation.",
        55, [-8, 1, 10], [0, 0, 0], 46, 18
      ],
      [
        "MOMENTUM SPACE",
        "Coherence leaves a reciprocal-space signature.",
        "Two fixed reference slices compare coherent peaks with a broad Mott envelope at the same logarithmic exposure. The band below narrows as J decreases.",
        "These are diagnostic panels: kz = 0 slices and a lowest-band cut, not a simulated expansion.",
        65, [-21, 3, 17], [-21, 0, -4], 47, 18
      ],
      [
        "BOSE–HUBBARD MODEL",
        "Three terms describe the competition.",
        "Hopping couples sites; interaction penalizes pairs; chemical potential sets the equilibrium filling. The Hamiltonian connects these visible mechanisms.",
        "Reference objects illustrate separate states. Live energies are reported per bulk site.",
        60, [27, 10, 19], [22, -1, 0], 49, 18
      ],
      [
        "PHASE DIAGRAM",
        "Integer filling occupies lobes.",
        "The marker locates this state in J/U and μ/U. Inside a lobe, mean-field filling is integer; outside, the nonzero order parameter identifies the superfluid branch.",
        "A theoretical z = 6 mean-field diagram, with approximate phase boundaries.",
        65, [24, 10, 9], [21, 6, -14], 44, 18
      ],
      [
        "FULL SYSTEM",
        "One model. Two quantum regimes.",
        "The view returns to the full lattice while depth decreases. Coherent coupling and number fluctuations reappear continuously in the equilibrium scan.",
        "Use the controls to inspect the model; Resume drone returns smoothly to this guided path.",
        65, [35, 24, 39], [0, 0, 0], 50, 18
      ]
    ];

    const starts = [0];

    chapters.forEach(chapter => {
      starts.push(starts[starts.length - 1] + chapter[4]);
    });

    const duration = starts[starts.length - 1];

    const positionPath = new T.CatmullRomCurve3(
      chapters.map(c => V(...c[5])),
      true,
      "centripetal"
    );

    const focusPath = new T.CatmullRomCurve3(
      chapters.map(c => V(...c[6])),
      true,
      "centripetal"
    );

    const poseCamera = camera.clone();

    function tourPose(time) {
      const clock = ((time % duration) + duration) % duration;

      let chapter = 0;

      while (
        chapter < chapters.length - 1 &&
        clock >= starts[chapter + 1]
      ) {
        chapter++;
      }

      const local = (clock - starts[chapter]) / chapters[chapter][4];
      const eased = ease(local);
      const u = (chapter + eased) / chapters.length;
      const position = positionPath.getPoint(u);
      const target = focusPath.getPoint(u);
      const next = chapters[(chapter + 1) % chapters.length];

      poseCamera.position.copy(position);
      poseCamera.lookAt(target);

      return {
        position,
        target,
        quaternion: poseCamera.quaternion.clone(),
        fov: mix(chapters[chapter][7], next[7], eased),
        depth: mix(chapters[chapter][8], next[8], eased),
        chapter
      };
    }

    function setChapter(index) {
      if (state.chapter === index) return;

      state.chapter = index;
      const chapter = chapters[index];

      setText(
        "chapter-value",
        String(index + 1).padStart(2, "0") + " / " + chapter[0]
      );

      setText(
        "stage-counter",
        String(index + 1).padStart(2, "0") + " / 13"
      );

      setText("scene-title", chapter[1]);
      setText("scene-description", chapter[2]);
      setText("scene-model-note", chapter[3]);

      document.querySelectorAll("[data-chapter]").forEach(button => {
        const active = Number(button.dataset.chapter) === index;

        button.classList.toggle("is-active", active);

        if (active) button.setAttribute("aria-current", "step");
        else button.removeAttribute("aria-current");
      });

      cardPositions();
    }

    function syncOrbit() {
      // Flush old damping before synchronizing the control camera.
      orbit.enableDamping = false;
      orbit.update();
      orbit.enableDamping = true;

      controlCamera.copy(camera, false);
      camera.getWorldDirection(scratch);

      orbit.target.copy(camera.position).addScaledVector(
        scratch,
        clamp(
          camera.position.distanceTo(focus),
          orbit.minDistance,
          orbit.maxDistance
        )
      );

      orbit.update();
    }

    function enterManual() {
      if (!state.ready || state.lost) return;

      if (!state.manual || state.transition) syncOrbit();

      state.manual = true;
      state.transition = null;
      orbit.enabled = true;
      updatePlayback();
    }

    ["pointerdown", "touchstart", "wheel"].forEach(type => {
      canvas.addEventListener(type, enterManual, {
        capture: true,
        passive: true
      });
    });

    function startTransition(pose, automatic) {
      state.transition = {
        from: camera.position.clone(),
        rotation: camera.quaternion.clone(),
        focus: focus.clone(),
        fov: camera.fov,
        to: pose,
        elapsed: 0,
        length: reducedMotion.matches ? 1.2 : 4.2,
        depth: state.depth,
        chemical: state.chemical,
        automatic
      };

      state.manual = !automatic;
      state.paused = false;
      orbit.enabled = false;
      updatePlayback();
    }

    function resume(index) {
      if (!state.ready) return;

      if (Number.isInteger(index)) state.tour = starts[index];
      if (state.inspection) state.chapter = -1;

      state.inspection = "";

      document.querySelectorAll("[data-inspect]").forEach(button => {
        button.setAttribute("aria-pressed", "false");
      });

      const pose = tourPose(state.tour);

      setChapter(pose.chapter);
      cardPositions();
      startTransition(pose, true);
    }

    function inspect(name) {
      if (!state.ready) return;

      state.inspection = name;

      const target = referencePositions[name].clone();
      const position = target.clone().add(V(3.5, 3, 8));

      poseCamera.position.copy(position);
      poseCamera.lookAt(target);

      const pose = {
        position,
        target,
        quaternion: poseCamera.quaternion.clone(),
        fov: 43
      };

      cardPositions();
      startTransition(pose, false);

      document.querySelectorAll("[data-inspect]").forEach(button => {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.inspect === name)
        );
      });

      setText("scene-title", {
        site: "Read a site's occupation.",
        wannier: "A localized basis orbital.",
        tunneling: "Two sites. One boson.",
        interaction: "Count pairs, then their energy.",
        superfluid: "A coherent reference state.",
        mott: "An integer-filling reference state."
      }[name]);

      setText(
        "scene-description",
        "An independent reference object accompanies the live bulk calculation. " +
        "Its world-space card identifies the equation and the scope of this example."
      );

      setText(
        "scene-model-note",
        name === "superfluid"
          ? "Fixed reference: s = 6.5, μ/U = 0.4."
          : name === "mott"
            ? "Fixed reference: s = 18, μ/U = 0.4; mean-field n = 1."
            : "The live telemetry continues to describe the homogeneous bulk lattice."
      );

      setText(
        "accessibility-status",
        "Inspecting " + name + " reference."
      );
    }

    function updatePlayback() {
      setText(
        "flight-mode",
        state.transition
          ? "RETURNING / TRANSIT"
          : state.manual
            ? "MANUAL"
            : "AUTOMATIC DRONE"
      );

      setText("pause-label", state.paused ? "Play" : "Pause");

      $("pause-toggle").setAttribute(
        "aria-pressed",
        String(state.paused)
      );

      setText("hud-label", state.hidden ? "Show HUD" : "Hide HUD");

      $("hud-toggle").setAttribute(
        "aria-pressed",
        String(state.hidden)
      );
    }

    function togglePause() {
      if (!state.ready) return;

      state.paused = !state.paused;
      updatePlayback();
    }

    function toggleHUD() {
      if (!state.ready) return;

      state.hidden = !state.hidden;

      if (state.hidden) {
        $("hud-toggle").focus({ preventScroll: true });
      }

      document.body.classList.toggle("hud-hidden", state.hidden);

      [
        "sidebar-ui",
        "scene-caption",
        "reference-legend"
      ].forEach(id => {
        $(id).inert = state.hidden;
        $(id).setAttribute("aria-hidden", String(state.hidden));
      });

      updatePlayback();
      measureLabels();
      layoutLabels();
    }

    $("pause-toggle").addEventListener("click", togglePause);
    $("hud-toggle").addEventListener("click", toggleHUD);
    $("resume-flight").addEventListener("click", () => resume());

    document.querySelectorAll("[data-chapter]").forEach(button => {
      button.addEventListener("click", () => {
        resume(Number(button.dataset.chapter));
      });
    });

    document.querySelectorAll("[data-inspect]").forEach(button => {
      button.addEventListener("click", () => {
        inspect(button.dataset.inspect);
      });
    });

    function changeParameters(s, m) {
      state.depth = clamp(s, 6, 22);
      state.chemical = clamp(m, 0.05, 2.95);
      state.dirty = true;
    }

    $("depth-control").addEventListener("input", event => {
      enterManual();
      changeParameters(Number(event.target.value), state.chemical);
    });

    $("chemical-control").addEventListener("input", event => {
      enterManual();
      changeParameters(state.depth, Number(event.target.value));
    });

    document.querySelectorAll("[data-preset]").forEach(button => {
      button.addEventListener("click", () => {
        enterManual();

        const depths = {
          superfluid: 6.5,
          boundary: CRITICAL_DEPTH,
          mott: 18
        };

        changeParameters(depths[button.dataset.preset], 0.4);
      });
    });

    $("view-select").addEventListener("change", event => {
      enterManual();
      state.view = event.target.value;
      state.dirty = true;
    });

    $("site-select").addEventListener("change", event => {
      enterManual();

      state.site = event.target.value;
      state.inspection = "";
      state.chapter = -1;

      setChapter(2);

      document.querySelectorAll("[data-inspect]").forEach(button => {
        button.setAttribute("aria-pressed", "false");
      });

      cardPositions();

      const target = siteCoordinates[state.site].clone();
      const position = target.clone().add(V(4, 3, 7));

      poseCamera.position.copy(position);
      poseCamera.lookAt(target);

      startTransition({
        position,
        target,
        quaternion: poseCamera.quaternion.clone(),
        fov: 43
      }, false);

      state.dirty = true;
    });

    document.querySelectorAll("details").forEach(node => {
      node.addEventListener("toggle", () => {
        state.plotsDirty = true;
        measureLabels();
      });
    });

    document.addEventListener("keydown", event => {
      if (
        !state.ready ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      if (
        event.target.closest(
          "input,select,textarea,[contenteditable='true']"
        )
      ) {
        return;
      }

      if (
        event.code === "Space" &&
        event.target.closest("button,a,summary")
      ) {
        return;
      }

      if (event.repeat) return;

      if (event.code === "Space") {
        event.preventDefault();
        togglePause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resume();
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggleHUD();
      }
    });

    const motionChange = event => {
      if (event.matches) {
        state.paused = true;
        updatePlayback();
      }
    };

    if (reducedMotion.addEventListener) {
      reducedMotion.addEventListener("change", motionChange);
    } else {
      reducedMotion.addListener(motionChange);
    }

    let viewShift = 0;

    function projection(dt) {
      const panel = $("sidebar-ui").getBoundingClientRect();

      const desired = !state.hidden && state.width > 760
        ? (panel.right + 12) * 0.5
        : 0;

      viewShift = mix(
        viewShift,
        desired,
        1 - Math.exp(-dt * 5)
      );

      camera.aspect = state.width / state.height;

      camera.setViewOffset(
        state.width,
        state.height,
        -viewShift,
        0,
        state.width,
        state.height
      );

      camera.updateProjectionMatrix();

      controlCamera.aspect = camera.aspect;

      controlCamera.setViewOffset(
        state.width,
        state.height,
        -viewShift,
        0,
        state.width,
        state.height
      );

      controlCamera.updateProjectionMatrix();
    }

    function resize() {
      state.width = Math.max(1, container.clientWidth);
      state.height = Math.max(1, container.clientHeight);

      state.dpr = Math.min(
        window.devicePixelRatio || 1,
        1.5,
        Math.sqrt(2400000 / (state.width * state.height))
      );

      renderer.setPixelRatio(state.dpr);
      renderer.setSize(state.width, state.height, false);

      composer.setPixelRatio(state.dpr);
      composer.setSize(state.width, state.height);

      bloom.setSize(
        Math.ceil(state.width * state.dpr * 0.65),
        Math.ceil(state.height * state.dpr * 0.65)
      );

      fxaa.uniforms.resolution.value.set(
        1 / (state.width * state.dpr),
        1 / (state.height * state.dpr)
      );

      labels.setSize(state.width, state.height);

      leaders.setAttribute(
        "viewBox",
        "0 0 " + state.width + " " + state.height
      );

      projection(1);
      state.plotsDirty = true;
      measureLabels();
    }

    window.addEventListener("resize", resize);

    if (window.ResizeObserver) {
      new ResizeObserver(resize).observe(container);
    }

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => measureLabels());
    }

    document.addEventListener("visibilitychange", () => {
      state.last = 0;
    });

    function applySolution() {
      if (
        result.s !== state.depth ||
        result.m !== state.chemical
      ) {
        result = solveState(state.depth, state.chemical);
      }

      const width = 7.5 * SPACING * result.ell;

      sizeClouds(population, width);
      sizeClouds(siteRef, width);
      sizeClouds(wannierRef, width);

      populationMaterial.uniforms.tint.value.set(
        result.isMott ? gold : cyan
      );

      populationMaterial.uniforms.strength.value =
        0.5 + 0.2 * Math.min(result.mean, 3);

      siteRef.material.uniforms.strength.value =
        populationMaterial.uniforms.strength.value;

      siteRef.material.uniforms.tint.value.copy(
        populationMaterial.uniforms.tint.value
      );

      potentialMaterial.uniforms.depth.value = result.s;
      potentialMaterial.uniforms.alpha.value =
        state.view === "potential" ? 0.95 : 0.44;

      population.visible = state.view !== "potential";
      selectedHalo.visible = population.visible;
      uncertaintyHalo.visible = population.visible;

      selectedHalo.position.copy(siteCoordinates[state.site]).y -= 0.4;
      uncertaintyHalo.position.copy(siteCoordinates[state.site]).y += 0.05;

      uncertaintyHalo.scale.setScalar(
        1 + 0.65 * Math.sqrt(result.variance)
      );

      uncertaintyHalo.material.opacity =
        result.variance > 1e-8 ? 0.4 : 0;

      updateBridges();

      document.body.dataset.view = state.view;
      state.dirty = false;
      state.plotsDirty = true;
    }

    let lastRegime = "";

    function updateHUD() {
      const close = result.criticalT > 0 &&
        Math.abs(result.t / result.criticalT - 1) < 0.16;

      const regime = close
        ? "intermediate"
        : result.isMott
          ? "mott"
          : "superfluid";

      const branch = result.isMott
        ? "Mott n = " + result.mottFilling
        : "superfluid";

      document.body.dataset.regime = regime;

      setText(
        "regime-value",
        regime === "intermediate"
          ? "INTERMEDIATE"
          : result.isMott
            ? "MOTT INSULATOR"
            : "SUPERFLUID"
      );

      setText(
        "regime-note",
        close
          ? "Near-boundary display band · " + branch + " side."
          : result.isMott
            ? "Mean-field integer filling · n = " +
              result.mottFilling + " per site."
            : "Nonzero order parameter · uniform phase · no net current."
      );

      if (regime !== lastRegime) {
        setText(
          "accessibility-status",
          "Current equilibrium branch: " + branch + "."
        );

        lastRegime = regime;
      }

      setText(
        "coherence-value",
        (result.coherent * 100).toFixed(1) + "%"
      );

      $("coherence-fill").style.width =
        result.coherent * 100 + "%";

      setText("depth-setting", result.s.toFixed(2));
      setText("chemical-setting", result.m.toFixed(2));

      if (document.activeElement !== $("depth-control")) {
        $("depth-control").value = String(result.s);
      }

      if (document.activeElement !== $("chemical-control")) {
        $("chemical-control").value = String(result.m);
      }

      setText("hopping-value", result.J.toFixed(5));
      setText("interaction-value", result.U.toFixed(4));
      setText("ratio-value", result.ratio.toFixed(2));
      setText("chemical-value", result.m.toFixed(3));
      setText("occupation-value", result.mean.toFixed(3));

      setText(
        "fluctuation-value",
        Math.sqrt(result.variance).toFixed(3)
      );

      setText("order-value", result.psi.toFixed(4));
      setText("bandwidth-value", (12 * result.J).toFixed(4));
      setText("cutoff-weight-value", sci(result.tail));
      setText("solver-residual-value", sci(result.residual));

      setText(
        "selected-site-value",
        "(" +
        siteCoordinates[state.site].toArray()
          .map(v => v / SPACING).join(", ") +
        ")"
      );

      setText("legend-view-value", {
        coherence: "COHERENCE + DENSITY",
        density: "DENSITY ONLY",
        potential: "POTENTIAL SLICE"
      }[state.view]);

      setText(
        "legend-phase-note",
        result.isMott
          ? "Mott order-parameter phase is undefined. Gold marks density, not a random phase."
          : "Uniform order-parameter phase. Links encode coherent coupling, with zero net current."
      );

      setText("solver-status", "MEAN FIELD · n ≤ 12");

      setText(
        "display-status",
        (renderer.capabilities.isWebGL2 ? "GL2" : "GL1") +
        " · DPR " + state.dpr.toFixed(2)
      );

      setText(
        "tour-time",
        clockText(state.tour) + " / " + clockText(duration)
      );

      const percent = state.tour / duration * 100;

      $("flight-progress").style.width = percent + "%";

      $("journey-progress").setAttribute(
        "aria-valuenow",
        percent.toFixed(1)
      );

      $("journey-progress").setAttribute(
        "aria-valuetext",
        "Chapter " + (state.chapter + 1) + " of 13"
      );

      document.querySelectorAll("[data-preset]").forEach(button => {
        const target = {
          superfluid: 6.5,
          boundary: CRITICAL_DEPTH,
          mott: 18
        }[button.dataset.preset];

        button.setAttribute(
          "aria-pressed",
          String(
            Math.abs(result.s - target) < 0.002 &&
            Math.abs(result.m - 0.4) < 0.002
          )
        );
      });

      cards.site.telemetry.textContent =
        "Live: mean " + result.mean.toFixed(3) +
        " · Δn " + Math.sqrt(result.variance).toFixed(3);

      cards.wannier.telemetry.textContent =
        "Live orbital length ℓ/a = " + result.ell.toFixed(4) +
        " · magnified display";

      cards.potential.telemetry.textContent =
        "Live depth s = " + result.s.toFixed(3) +
        " · explanatory height scale";

      const sf = state.inspection === "superfluid"
        ? sfReference
        : result;

      cards.superfluid.telemetry.textContent =
        "ψ = " + sf.psi.toFixed(4) +
        " · coherent fraction " +
        (sf.coherent * 100).toFixed(1) + "%";

      const mi = state.inspection === "mott"
        ? mottReference
        : result;

      cards.mott.telemetry.textContent =
        "Mean-field filling " + mi.mean.toFixed(3) +
        " · ψ = " + mi.psi.toFixed(4);

      cards.interaction.telemetry.textContent =
        "At the live U: n = 2 costs " +
        result.U.toFixed(4) +
        " ER; n = 3 costs " +
        (3 * result.U).toFixed(4) + " ER.";

      cards.hamiltonian.telemetry.textContent =
        "Live energy / site in ER: hopping " +
        (-Z * result.J * result.psi ** 2).toFixed(4) +
        " · interaction " +
        (result.U * result.pairs).toFixed(4) +
        " · chemical " +
        (-result.m * result.U * result.mean).toFixed(4) + ".";

      cards.band.telemetry.textContent =
        "Live Γ→X width: " +
        (4 * result.J).toFixed(5) +
        " ER · full width: " +
        (12 * result.J).toFixed(5) + " ER.";

      cards.momentum.telemetry.textContent =
        "Fixed side-by-side references; the sidebar momentum map follows the live state.";

      cards.phase.telemetry.textContent =
        "Live J/U = " + result.t.toFixed(5) +
        " · μ/U = " + result.m.toFixed(3) +
        " · " + branch;
    }

    function updateCamera(dt) {
      if (state.transition) {
        const transition = state.transition;

        if (!state.paused) transition.elapsed += dt;

        const f = ease(clamp(
          transition.elapsed / transition.length,
          0,
          1
        ));

        camera.position.lerpVectors(
          transition.from,
          transition.to.position,
          f
        );

        camera.quaternion.slerpQuaternions(
          transition.rotation,
          transition.to.quaternion,
          f
        );

        camera.fov = mix(
          transition.fov,
          transition.to.fov,
          f
        );

        focus.lerpVectors(
          transition.focus,
          transition.to.target,
          f
        );

        if (transition.automatic) {
          changeParameters(
            mix(transition.depth, transition.to.depth, f),
            mix(transition.chemical, 0.4, f)
          );
        }

        if (f >= 1) {
          state.transition = null;

          if (!transition.automatic) {
            syncOrbit();
            orbit.enabled = true;
          }

          updatePlayback();
        }
      } else if (state.manual) {
        orbit.update();

        const a = 1 - Math.exp(-dt * 15);

        camera.position.lerp(controlCamera.position, a);
        camera.quaternion.slerp(controlCamera.quaternion, a);
        camera.fov = controlCamera.fov;
        focus.copy(orbit.target);
      } else {
        if (!state.paused && state.ready) {
          state.tour = (state.tour + dt) % duration;
        }

        const pose = tourPose(state.tour);

        camera.position.copy(pose.position);
        camera.quaternion.copy(pose.quaternion);
        camera.fov = pose.fov;
        focus.copy(pose.target);

        setChapter(pose.chapter);

        if (
          Math.abs(state.depth - pose.depth) > 0.0001 ||
          state.chemical !== 0.4
        ) {
          changeParameters(pose.depth, 0.4);
        }
      }

      projection(dt);
      camera.updateMatrixWorld();
    }

    function validatePrograms() {
      const bad = (renderer.info.programs || []).find(program =>
        program.diagnostics &&
        program.diagnostics.runnable === false
      );

      if (bad) {
        throw new Error("A WebGL shader failed to compile or link.");
      }
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
        "The calculation is preserved while the browser restores the graphics context.",
        "If restoration does not complete, reload the visualization.",
        true
      );
    });

    canvas.addEventListener("webglcontextrestored", () => {
      try {
        composer.reset();

        resources.forEach(texture => {
          texture.needsUpdate = true;
        });

        state.lost = false;
        state.last = 0;
        state.dirty = true;
        state.plotsDirty = true;

        resize();

        notice(
          "Restoring the optical lattice",
          "Rebuilding graphics resources.",
          ""
        );
      } catch (error) {
        fail(error);
      }
    });

    let frameHandle = 0;

    function frame(now) {
      if (state.failed) return;

      frameHandle = requestAnimationFrame(frame);

      if (state.lost || document.hidden) {
        state.last = 0;
        return;
      }

      const dt = state.last
        ? Math.min((now - state.last) / 1000, 0.05)
        : 0;

      state.last = now;

      try {
        updateCamera(dt);

        if (
          !state.paused &&
          !state.transition &&
          state.ready
        ) {
          state.teaching += dt;
        }

        state.solveClock += dt;

        if (
          state.dirty &&
          (!state.ready || state.solveClock >= 1 / 15)
        ) {
          applySolution();
          state.solveClock = 0;
        }

        animateOptics(state.teaching);

        // Isolated dimer clock τ, intentionally independent of lab time.
        const probability = Math.sin(state.teaching * 0.45) ** 2;

        dimerLeft.material.uniforms.strength.value =
          0.95 * (1 - probability);

        dimerRight.material.uniforms.strength.value =
          0.95 * probability;

        state.hudClock += dt;

        if (state.hudClock >= 0.15 || !state.ready) {
          updateHUD();

          cards.tunneling.telemetry.textContent =
            "P_L = " + (1 - probability).toFixed(3) +
            " · P_R = " + probability.toFixed(3) +
            " · normalized clock";

          dimerTag.element.textContent =
            "Independent dimer · left " +
            ((1 - probability) * 100).toFixed(0) +
            "% · right " +
            (probability * 100).toFixed(0) + "%";

          if (state.plotsDirty) drawPlots();

          measureLabels();
          state.hudClock = 0;
        }

        // CSS2D owns outer anchor transforms. Card offsets are applied
        // only to their children, with SVG leaders projected alongside.
        layoutLabels();

        composer.render(dt);
        labels.render(scene, camera);

        if (!state.ready) {
          if (gl.isContextLost()) return;

          validatePrograms();

          state.ready = true;
          gate(true);

          orbit.enabled = state.manual && !state.transition;

          document.body.classList.remove(
            "is-loading",
            "render-failed"
          );

          $("render-notice").hidden = true;
          updatePlayback();

          setText(
            "accessibility-status",
            "Optical lattice ready. " +
            (state.paused
              ? "Reduced-motion preference: tour starts paused."
              : "Guided tour running.")
          );
        }
      } catch (error) {
        cancelAnimationFrame(frameHandle);
        fail(error);
      }
    }

    state.start = () => {
      setChapter(0);
      cardPositions();
      applySolution();
      updateHUD();
      drawPlots();
      resize();
      updatePlayback();

      frameHandle = requestAnimationFrame(frame);
    };

    return state;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();