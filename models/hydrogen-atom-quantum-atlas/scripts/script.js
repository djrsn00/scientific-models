/* Hydrogen Atom Quantum Atlas — Three.js r128.

   Analytic real m = 0 hydrogen eigenstates.
   +z is the quantization axis.

   Position is electron-proton separation, measured in a_mu.
   Clouds are probability samples, not moving electrons.
*/

(() => {
  "use strict";

  function boot() {
    const host = document.getElementById("canvas-container");
    const notice = document.getElementById("render-notice");

    const engineControls = Array.from(
      document.querySelectorAll("[data-engine-control]")
    );

    let failed = false;

    function fail(message, error) {
      failed = true;

      host?.setAttribute("aria-busy", "false");

      engineControls.forEach(control => {
        control.disabled = true;
      });

      if (notice) {
        notice.hidden = false;
        notice.setAttribute("role", "alert");
        notice.textContent = message;
      }

      if (error) {
        console.error("Hydrogen Quantum Atlas:", error);
      }
    }

    try {
      const T = window.THREE;

      if (!T || !host) {
        throw new Error(
          "Three.js or canvas-container is missing."
        );
      }

      [
        "OrbitControls",
        "CSS2DRenderer",
        "CSS2DObject",
        "EffectComposer",
        "RenderPass",
        "ShaderPass",
        "UnrealBloomPass",
        "FXAAShader"
      ].forEach(name => {
        if (!T[name]) {
          throw new Error(
            "Missing Three.js extension: " + name
          );
        }
      });

      const $ = id => document.getElementById(id);
      const ui = {};

      [
        "flight-mode",
        "hud-toggle",
        "pause-toggle",
        "resume-flight",
        "sidebar-ui",
        "scene-caption",
        "reference-legend",
        "flight-controls",
        "chapter-value",
        "scene-title",
        "scene-description",
        "journey-stages",
        "journey-progress",
        "flight-progress",
        "tour-time",
        "active-orbital",
        "transition-status",
        "color-mode",
        "nodes-toggle",
        "n-value",
        "l-value",
        "m-value",
        "energy-value",
        "normalization-value",
        "radial-nodes-value",
        "angular-nodes-value",
        "captured-value",
        "cutoff-value",
        "probe-status",
        "density-value",
        "phase-value",
        "probe-position-value",
        "radial-amplitude-path",
        "radial-probability-path",
        "radial-node-markers",
        "radial-axis-max",
        "radial-chart-desc",
        "node-description",
        "phase-legend",
        "density-legend"
      ].forEach(id => {
        ui[id] = $(id);
      });

      function text(id, value) {
        if (ui[id] && ui[id].textContent !== value) {
          ui[id].textContent = value;
        }
      }

      const TAU = Math.PI * 2;

      // Fixed across all central states:
      // one a_mu equals two scene units.
      const UNIT = 2;

      const TOTAL = 660;
      const MAIN_COUNT = 18000;
      const THUMB_COUNT = 2000;

      const clamp = T.MathUtils.clamp;
      const mix = T.MathUtils.lerp;

      const smooth = t =>
        t * t * t * (t * (6 * t - 15) + 10);

      const V = (x = 0, y = 0, z = 0) =>
        new T.Vector3(x, y, z);

      const up = V(0, 0, 1);

      const motionQuery = matchMedia(
        "(prefers-reduced-motion: reduce)"
      );

      const state = {
        mode: "auto",
        paused: motionQuery.matches,
        reduced: motionQuery.matches,
        hud: true,
        ready: false,
        lost: false,

        tour: 0,
        sceneTime: 0,
        stage: 0,
        enteredStage: -1,

        active: 0,
        requested: 0,
        fade: 1,

        focusTween: null,
        returnTween: null,

        width: 1,
        height: 1,
        dpr: 1,
        shift: 0
      };

      let seed = 0x61a3b7;

      function random() {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
      }

      const linear = hex =>
        new T.Color(hex).convertSRGBToLinear();

      const colors = {
        cyan: linear("#78e6ff"),
        blue: linear("#8fb8ff"),
        violet: linear("#bd9aff"),
        magenta: linear("#f39fdd"),
        gold: linear("#f2cf8e"),
        dim: linear("#486182")
      };

      /*
       * Each cutoff encloses 99.5% of the normalized
       * spatial probability distribution.
       *
       * All states have m = 0 relative to +z.
       */

      const states = [
        {
          key: "1s",
          name: "1s",
          n: 1,
          l: 0,
          cutoff: 4.636896044628,
          nodes: [],

          description:
            "Spherical ground state. No radial or angular nodes.",

          nodeText:
            "1s / no radial or angular nodes."
        },
        {
          key: "2s",
          name: "2s",
          n: 2,
          l: 0,
          cutoff: 13.717992500840,
          nodes: [2],

          description:
            "Two radial sign regions, separated by one spherical node.",

          nodeText:
            "2s / spherical node at r = 2aμ."
        },
        {
          key: "2p",
          name: "2p_z",
          n: 2,
          l: 1,
          cutoff: 12.594089785986,
          nodes: [],

          description:
            "Two opposite-sign lobes separated by the xy nodal plane.",

          nodeText:
            "2p_z / angular nodal plane z = 0."
        },
        {
          key: "3s",
          name: "3s",
          n: 3,
          l: 0,
          cutoff: 27.089933954330,

          nodes: [
            (9 - 3 * Math.sqrt(3)) / 2,
            (9 + 3 * Math.sqrt(3)) / 2
          ],

          description:
            "Three radial sign regions separated by two spherical nodes.",

          nodeText:
            "3s / radial nodes at r/aμ ≈ 1.902 and 7.098."
        },
        {
          key: "3p",
          name: "3p_z",
          n: 3,
          l: 1,
          cutoff: 26.038620777521,
          nodes: [6],

          description:
            "A radial node and an angular plane divide the probability cloud.",

          nodeText:
            "3p_z / radial node r = 6aμ and angular plane z = 0."
        },
        {
          key: "3d",
          name: "3d_z²",
          n: 3,
          l: 2,
          cutoff: 23.489512216946,
          nodes: [],

          description:
            "Axial lobes and an equatorial belt, separated by two nodal cones.",

          nodeText:
            "3d_z² / nodal cones at θ ≈ 54.736° and 125.264°."
        }
      ];

      /*
       * R_nl(r) = a_mu^(-3/2) F_nl(u)
       *
       * u = r / a_mu
       *
       * These radial functions satisfy:
       * integral_0^infinity u² F_nl(u)² du = 1.
       */

      function radial(index, u) {
        switch (index) {
          case 0:
            return 2 * Math.exp(-u);

          case 1:
            return (
              (2 - u) *
              Math.exp(-u / 2) /
              (2 * Math.sqrt(2))
            );

          case 2:
            return (
              u *
              Math.exp(-u / 2) /
              (2 * Math.sqrt(6))
            );

          case 3:
            return (
              2 *
              (27 - 18 * u + 2 * u * u) *
              Math.exp(-u / 3) /
              (81 * Math.sqrt(3))
            );

          case 4:
            return (
              4 *
              u *
              (6 - u) *
              Math.exp(-u / 3) /
              (81 * Math.sqrt(6))
            );

          default:
            return (
              4 *
              u *
              u *
              Math.exp(-u / 3) /
              (81 * Math.sqrt(30))
            );
        }
      }

      function angularPolynomial(l, c) {
        return l === 0
          ? 1
          : l === 1
            ? c
            : (3 * c * c - 1) / 2;
      }

      /*
       * Direct Cartesian wavefunctions avoid division by r
       * at the origin.
       *
       * Coordinates supplied here are in a_mu.
       * Returned density is rho * a_mu³.
       */

      function field(index, x, y, z, out) {
        const u = Math.hypot(x, y, z);

        let polynomial;
        let denominator;

        switch (index) {
          case 0:
            polynomial = 1;
            denominator = Math.sqrt(Math.PI);
            break;

          case 1:
            polynomial = 2 - u;
            denominator = 4 * Math.sqrt(2 * Math.PI);
            break;

          case 2:
            polynomial = z;
            denominator = 4 * Math.sqrt(2 * Math.PI);
            break;

          case 3:
            polynomial = 27 - 18 * u + 2 * u * u;
            denominator = 81 * Math.sqrt(3 * Math.PI);
            break;

          case 4:
            polynomial = 2 * z * (6 - u);
            denominator = 81 * Math.sqrt(2 * Math.PI);
            break;

          default:
            polynomial = 3 * z * z - u * u;
            denominator = 81 * Math.sqrt(6 * Math.PI);
        }

        const orbital = states[index];

        const amplitude =
          polynomial *
          Math.exp(-u / orbital.n) /
          denominator;

        let nearNode = orbital.nodes.some(node =>
          Math.abs(u - node) <
          1e-6 * Math.max(1, node)
        );

        if (orbital.l > 0) {
          if (u < 1e-8) {
            nearNode = true;
          } else if (orbital.l === 1) {
            nearNode ||= Math.abs(z / u) < 1e-6;
          } else {
            nearNode ||=
              Math.abs(
                3 * z * z / (u * u) - 1
              ) < 1e-6;
          }
        }

        out.r = u;
        out.density = amplitude * amplitude;
        out.sign = Math.sign(polynomial);
        out.exactNode = polynomial === 0;
        out.nearNode = nearNode;

        return out;
      }

      /*
       * Radius is sampled from the CDF of u² F².
       * Direction is sampled from |Y_l0|².
       *
       * Samples have equal visual weights.
       * Density is encoded by their concentration.
       */

      function prepareSamples(orbital, index) {
        const bins = 8192;
        const cdf = new Float64Array(bins + 1);

        const step = orbital.cutoff / bins;
        let previous = 0;

        for (let i = 1; i <= bins; i++) {
          const u = i * step;
          const f = radial(index, u);
          const p = u * u * f * f;

          cdf[i] =
            cdf[i - 1] +
            (previous + p) * step * 0.5;

          previous = p;
        }

        orbital.captured = cdf[bins];

        const positions = new Float32Array(
          MAIN_COUNT * 3
        );

        const signs = new Float32Array(
          MAIN_COUNT
        );

        for (let i = 0; i < MAIN_COUNT; i++) {
          const q = random() * orbital.captured;

          let lo = 0;
          let hi = bins;

          while (hi - lo > 1) {
            const mid = (lo + hi) >> 1;

            if (cdf[mid] < q) {
              lo = mid;
            } else {
              hi = mid;
            }
          }

          const fraction =
            (q - cdf[lo]) /
            Math.max(1e-30, cdf[hi] - cdf[lo]);

          const u = (lo + fraction) * step;

          let c;
          let p;

          do {
            c = random() * 2 - 1;
            p = angularPolynomial(orbital.l, c);
          } while (random() > p * p);

          const azimuth = TAU * random();

          const transverse =
            u * Math.sqrt(
              Math.max(0, 1 - c * c)
            );

          const k = 3 * i;

          positions[k] =
            UNIT * transverse * Math.cos(azimuth);

          positions[k + 1] =
            UNIT * transverse * Math.sin(azimuth);

          positions[k + 2] =
            UNIT * u * c;

          signs[i] =
            radial(index, u) * p >= 0 ? 1 : -1;
        }

        const geometry = new T.BufferGeometry();

        geometry.setAttribute(
          "position",
          new T.BufferAttribute(positions, 3)
        );

        geometry.setAttribute(
          "aSign",
          new T.BufferAttribute(signs, 1)
        );

        geometry.boundingSphere = new T.Sphere(
          V(),
          UNIT * orbital.cutoff
        );

        orbital.geometry = geometry;
        orbital.extent = UNIT * orbital.cutoff;
      }

      states.forEach(prepareSamples);

      const scene = new T.Scene();
      scene.background = new T.Color(0x000000);

      const main = new T.Group();
      scene.add(main);

      const camera = new T.PerspectiveCamera(
        44,
        1,
        0.025,
        900
      );

      camera.up.copy(up);
      camera.position.set(24, -30, 19);
      camera.lookAt(0, 0, 0);

      const renderer = new T.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "high-performance"
      });

      renderer.outputEncoding = T.LinearEncoding;
      renderer.toneMapping = T.NoToneMapping;
      renderer.setClearColor(0x000000, 1);

      renderer.domElement.tabIndex = 0;

      renderer.domElement.setAttribute(
        "aria-label",
        "Hydrogen probability clouds. Drag to orbit, " +
        "scroll to zoom, R to resume the tour."
      );

      host.appendChild(renderer.domElement);

      const labels = new T.CSS2DRenderer();
      labels.domElement.id = "label-layer";
      host.appendChild(labels.domElement);

      /*
       * Linear scene rendering → bloom → ACES + sRGB → FXAA.
       */

      const hdr =
        renderer.capabilities.isWebGL2 &&
        !!renderer.extensions.get(
          "EXT_color_buffer_float"
        );

      const renderTarget = new T.WebGLRenderTarget(
        1,
        1,
        {
          type: hdr
            ? T.HalfFloatType
            : T.UnsignedByteType,

          minFilter: T.LinearFilter,
          magFilter: T.LinearFilter,
          format: T.RGBAFormat,
          depthBuffer: true,
          stencilBuffer: false
        }
      );

      const composer = new T.EffectComposer(
        renderer,
        renderTarget
      );

      composer.addPass(
        new T.RenderPass(scene, camera)
      );

      const bloom = new T.UnrealBloomPass(
        new T.Vector2(1, 1),
        0.62,
        0.4,
        hdr ? 0.88 : 0.6
      );

      [bloom.renderTargetBright]
        .concat(
          bloom.renderTargetsHorizontal,
          bloom.renderTargetsVertical
        )
        .forEach(rt => {
          rt.texture.type = hdr
            ? T.HalfFloatType
            : T.UnsignedByteType;
        });

      composer.addPass(bloom);

      const outputPass = new T.ShaderPass({
        uniforms: {
          tDiffuse: { value: null }
        },

        vertexShader: [
          "varying vec2 vUv;",
          "void main(){",
          "  vUv=uv;",
          "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);",
          "}"
        ].join("\n"),

        fragmentShader: [
          "uniform sampler2D tDiffuse;",
          "varying vec2 vUv;",

          "vec3 aces(vec3 x){",
          "  return clamp(",
          "    (x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14),",
          "    0.0,1.0",
          "  );",
          "}",

          "vec3 srgb(vec3 x){",
          "  return mix(",
          "    12.92*x,",
          "    1.055*pow(max(x,vec3(0.0)),vec3(1.0/2.4))-0.055,",
          "    step(vec3(0.0031308),x)",
          "  );",
          "}",

          "void main(){",
          "  vec3 c=aces(texture2D(tDiffuse,vUv).rgb*1.08);",
          "  float v=1.0-0.14*smoothstep(",
          "    0.25,0.8,length(vUv-0.5)",
          "  );",
          "  gl_FragColor=vec4(srgb(c)*v,1.0);",
          "}"
        ].join("\n")
      });

      composer.addPass(outputPass);

      const fxaa = new T.ShaderPass(
        T.FXAAShader
      );

      composer.addPass(fxaa);

      const gl = renderer.getContext();

      const maxPoint = Math.min(
        30,
        gl.getParameter(
          gl.ALIASED_POINT_SIZE_RANGE
        )[1]
      );

      const pointMaterials = [];

      function cloudMaterial(size, opacity) {
        const material = new T.ShaderMaterial({
          uniforms: {
            uScale: { value: 1 },
            uSize: { value: size },
            uOpacity: { value: opacity },
            uPhase: { value: 1 },
            uPositive: { value: colors.cyan },
            uNegative: { value: colors.magenta },
            uDensity: { value: colors.blue }
          },

          vertexShader: [
            "attribute float aSign;",
            "varying float vSign;",
            "varying float vDepth;",

            "uniform float uSize;",
            "uniform float uScale;",

            "void main(){",
            "  vec4 p=modelViewMatrix*vec4(position,1.0);",
            "  vSign=aSign;",
            "  vDepth=-p.z;",

            "  gl_PointSize=clamp(",
            "    uSize*uScale/max(0.2,-p.z),",
            "    1.0," + maxPoint.toFixed(1),
            "  );",

            "  gl_Position=projectionMatrix*p;",
            "}"
          ].join("\n"),

          fragmentShader: [
            "varying float vSign;",
            "varying float vDepth;",

            "uniform float uOpacity;",
            "uniform float uPhase;",
            "uniform vec3 uPositive;",
            "uniform vec3 uNegative;",
            "uniform vec3 uDensity;",

            "void main(){",
            "  vec2 p=gl_PointCoord*2.0-1.0;",
            "  float q=dot(p,p);",
            "  if(q>1.0) discard;",

            "  vec3 c=mix(",
            "    uNegative,uPositive,step(0.0,vSign)",
            "  );",

            "  c=mix(uDensity,c,uPhase);",

            "  float a=exp(-4.2*q)*",
            "    (1.0-smoothstep(0.65,1.0,q));",

            "  float nearFade=smoothstep(0.08,0.7,vDepth);",
            "  gl_FragColor=vec4(c*1.6,a*uOpacity*nearFade);",
            "}"
          ].join("\n"),

          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending
        });

        pointMaterials.push(material);
        return material;
      }

      const mainMaterial = cloudMaterial(
        states[0].extent * 0.014,
        0.78
      );

      const cloud = new T.Points(
        states[0].geometry,
        mainMaterial
      );

      main.add(cloud);

      function lines(
        parent,
        positions,
        color,
        opacity = 0.4
      ) {
        const geometry = new T.BufferGeometry();

        geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(
            positions,
            3
          )
        );

        const material = new T.LineBasicMaterial({
          color,
          opacity,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending
        });

        const object = new T.LineSegments(
          geometry,
          material
        );

        parent.add(object);
        return object;
      }

      function circle(
        list,
        radius,
        z,
        count = 96
      ) {
        for (let i = 0; i < count; i++) {
          const a = TAU * i / count;
          const b = TAU * (i + 1) / count;

          list.push(
            radius * Math.cos(a),
            radius * Math.sin(a),
            z,

            radius * Math.cos(b),
            radius * Math.sin(b),
            z
          );
        }
      }

      function makeNodes(orbital) {
        const positions = [];

        orbital.nodes.forEach(node => {
          const radius = node * UNIT;

          [
            -Math.PI / 3,
            -Math.PI / 6,
            0,
            Math.PI / 6,
            Math.PI / 3
          ].forEach(a => {
            circle(
              positions,
              radius * Math.cos(a),
              radius * Math.sin(a)
            );
          });

          for (let j = 0; j < 8; j++) {
            const phi = j / 8 * TAU;

            for (let i = 0; i < 72; i++) {
              for (let end = 0; end < 2; end++) {
                const theta =
                  (i + end) / 72 * Math.PI;

                positions.push(
                  radius *
                    Math.sin(theta) *
                    Math.cos(phi),

                  radius *
                    Math.sin(theta) *
                    Math.sin(phi),

                  radius * Math.cos(theta)
                );
              }
            }
          }
        });

        if (orbital.l === 1) {
          const r = orbital.extent * 0.83;

          circle(positions, r, 0);

          for (let i = -5; i <= 5; i++) {
            const x = r * i / 6;
            const y = Math.sqrt(r * r - x * x);

            positions.push(
              x, -y, 0,
              x, y, 0,

              -y, x, 0,
              y, x, 0
            );
          }
        }

        if (orbital.l === 2) {
          const sine = Math.sqrt(2 / 3);
          const cosine = 1 / Math.sqrt(3);

          [-1, 1].forEach(sign => {
            [0.25, 0.5, 0.75, 1].forEach(f => {
              const r =
                orbital.extent * 0.83 * f;

              circle(
                positions,
                r * sine,
                sign * r * cosine
              );
            });

            for (let i = 0; i < 16; i++) {
              const a = i / 16 * TAU;
              const r = orbital.extent * 0.83;

              positions.push(
                0, 0, 0,

                r * sine * Math.cos(a),
                r * sine * Math.sin(a),
                sign * r * cosine
              );
            }
          });
        }

        const object = lines(
          main,
          positions,
          colors.gold,
          0.3
        );

        object.visible = false;
        return object;
      }

      states.forEach(orbital => {
        orbital.guide = makeNodes(orbital);
      });

      const nucleus = new T.Mesh(
        new T.IcosahedronGeometry(0.105, 1),

        new T.MeshBasicMaterial({
          color: colors.gold
            .clone()
            .multiplyScalar(1.9)
        })
      );

      main.add(nucleus);

      const axis = lines(
        main,
        new Float32Array(6),
        colors.violet,
        0.23
      );

      axis.frustumCulled = false;

      const scaleBar = lines(
        main,
        new Float32Array(18),
        colors.blue,
        0.55
      );

      scaleBar.frustumCulled = false;

      const probe = new T.Mesh(
        new T.OctahedronGeometry(0.085),

        new T.MeshBasicMaterial({
          color: colors.cyan
            .clone()
            .multiplyScalar(1.8),

          wireframe: true,
          transparent: true,
          opacity: 0.95,
          depthTest: false
        })
      );

      probe.renderOrder = 12;
      main.add(probe);

      /*
       * Comparison thumbnails share sample buffers.
       * Their independent display scales are disclosed
       * in the labels and cards.
       */

      const atlas = new T.Group();
      scene.add(atlas);

      states.forEach((orbital, index) => {
        const group = new T.Group();

        group.position.set(
          82 + (index % 3) * 25,
          0,
          index < 3 ? 14 : -14
        );

        atlas.add(group);

        const geometry = new T.BufferGeometry();

        geometry.setAttribute(
          "position",
          orbital.geometry.getAttribute("position")
        );

        geometry.setAttribute(
          "aSign",
          orbital.geometry.getAttribute("aSign")
        );

        geometry.setDrawRange(0, THUMB_COUNT);
        geometry.boundingSphere =
          orbital.geometry.boundingSphere;

        const material = cloudMaterial(
          0.20,
          0.9
        );

        const thumbnail = new T.Points(
          geometry,
          material
        );

        thumbnail.scale.setScalar(
          7.7 / orbital.extent
        );

        group.add(thumbnail);

        const frame = [];
        const s = 9.5;
        const e = 2;

        [-1, 1].forEach(a => {
          [-1, 1].forEach(b => {
            frame.push(
              a * s, 0, b * s,
              a * (s - e), 0, b * s,

              a * s, 0, b * s,
              a * s, 0, b * (s - e)
            );
          });
        });

        lines(
          group,
          frame,
          colors.dim,
          0.32
        );

        orbital.thumbnail = group;
      });

      /*
       * The energy ladder uses a linear energy axis.
       * The photon glyph is deliberately schematic.
       */

      const ladder = new T.Group();
      ladder.position.set(165, 0, 0);
      scene.add(ladder);

      const energyZ = n =>
        15 + 30 * (-13.6 / (n * n)) / 13.6;

      lines(
        ladder,
        [-7, 0, -15, -7, 0, 15],
        colors.dim,
        0.45
      );

      const levelLines = [];

      for (let n = 1; n <= 4; n++) {
        const z = energyZ(n);

        levelLines.push(
          lines(
            ladder,
            [-7, 0, z, 7, 0, z],
            colors.gold,
            0.45
          )
        );
      }

      const zeroLine = [];

      for (let x = -7; x < 7; x += 1.1) {
        zeroLine.push(
          x, 0, 15,
          x + 0.5, 0, 15
        );
      }

      lines(
        ladder,
        zeroLine,
        colors.blue,
        0.38
      );

      const transitionArrow = lines(
        ladder,
        [
          2.5, -0.2, energyZ(2),
          2.5, -0.2, energyZ(1),

          2.5, -0.2, energyZ(1),
          1.5, -0.2, energyZ(1) + 1.8,

          2.5, -0.2, energyZ(1),
          3.5, -0.2, energyZ(1) + 1.8
        ],
        colors.magenta,
        0.8
      );

      const photon = new T.Group();
      ladder.add(photon);

      const wavePositions = [];

      for (let i = 0; i < 150; i++) {
        for (let end = 0; end < 2; end++) {
          const x =
            -4 + (i + end) / 150 * 8;

          wavePositions.push(
            x,
            0,
            0.85 *
              Math.exp(-x * x / 5) *
              Math.sin(x * 4)
          );
        }
      }

      lines(
        photon,
        wavePositions,
        colors.magenta,
        0.9
      );

      const chapters = [
        [
          "ground",
          0,
          0,
          "GROUND STATE",
          "An orbital is a probability distribution.",
          "Begin with 1s: a spherical one-electron state. " +
          "Sample concentration follows |ψ|²; the small " +
          "proton marker is enlarged."
        ],
        [
          "radial",
          55,
          1,
          "RADIAL STRUCTURE",
          "A spherical node divides the 2s state.",
          "The gold guide sits at r = 2aμ. Crossing it " +
          "changes the sign of the radial wavefunction " +
          "while the density passes through zero."
        ],
        [
          "angular",
          125,
          2,
          "ANGULAR STRUCTURE",
          "A plane separates the p_z lobes.",
          "The xy plane is an angular node. This m = 0 " +
          "state has Lz = 0, while its total orbital " +
          "angular momentum is nonzero."
        ],
        [
          "phase",
          180,
          2,
          "WAVEFUNCTION PHASE",
          "Opposite signs. One electron charge.",
          "Cyan and magenta mark relative phases 0 and π " +
          "at a chosen reference. Their colors do not " +
          "represent different charges."
        ],
        [
          "three-s",
          235,
          3,
          "3s / RADIAL SHELLS",
          "Two radial nodes, three sign regions.",
          "The exact node radii are (9 ± 3√3)aμ/2. " +
          "The probe travels from the outer cloud " +
          "through both spherical nodal regions."
        ],
        [
          "three-p",
          305,
          4,
          "3p / COMBINED NODES",
          "Radial and angular structure meet.",
          "A sphere at r = 6aμ intersects the z = 0 " +
          "nodal plane. The full sign is the sign of R " +
          "times the sign of Y."
        ],
        [
          "three-d",
          365,
          5,
          "3d / CONICAL NODES",
          "A d state with two nodal cones.",
          "The 3d_z² eigenstate has m = 0. Its axial " +
          "lobes and equatorial belt are separated by " +
          "cones at approximately 54.736° and 125.264°."
        ],
        [
          "atlas",
          440,
          5,
          "ORBITAL COMPARISON",
          "Six alternatives for one electron.",
          "Each thumbnail is individually fitted. " +
          "Compare shapes and node counts here; the labels " +
          "report each physical cutoff radius."
        ],
        [
          "energy",
          510,
          5,
          "ENERGY LADDER",
          "The principal number sets the Coulomb energy.",
          "The ladder uses Eₙ ≈ −13.6/n² eV. States " +
          "sharing n are degenerate in this approximation; " +
          "smaller measured splittings are omitted."
        ],
        [
          "photon",
          565,
          2,
          "PHOTON TRANSITION",
          "An energy difference becomes photon energy.",
          "The allowed 2p, m = 0 → 1s, m = 0 example " +
          "releases approximately 10.2 eV. The photon glyph " +
          "is illustrative, not an electron track."
        ],
        [
          "overview",
          620,
          0,
          "FULL QUANTUM ATLAS",
          "One quantum system, many possible states.",
          "The comparison atlas gathers the six eigenstates " +
          "before the camera returns to 1s. Display fades " +
          "are presentation effects."
        ]
      ];

      /*
       * Eye and target positions use scene coordinates.
       * Probe positions use a_mu.
       *
       * Quintic easing gives zero endpoint velocity
       * and acceleration.
       */

      const keys = [
        [0, [24,-30,19], [0,0,0], 44, [1,0,0.5]],
        [28, [13,-20,12], [0,0,0], 44, [0.65,0,0.3]],
        [55, [8,-12,7], [0,0,0], 46, [1,0,0]],
        [80, [30,-44,26], [0,0,0], 45, [4,0,1]],
        [103, [5.4,-4,2], [0,0,0], 49, [2,0,0]],
        [125, [1.4,-1.2,0.8], [0,0,0], 51, [0.8,0,0]],
        [150, [9,-19,13], [0,0,5], 47, [0.8,0,3]],
        [180, [8,-13,-6], [0,0,-5], 47, [2,0,0]],
        [198, [-14,-16,7], [0,0,0], 45, [1,0,3]],
        [218, [-14,15,7], [0,0,0], 45, [1,0,-3]],
        [235, [13,16,10], [0,0,0], 45, [1,0,3]],
        [254, [28,-48,26], [0,0,0], 46, [12,0,0]],
        [278, [8,-12,6], [0,0,0], 49, [7.098076211353316,0,0]],
        [305, [1.8,-2.6,1.2], [0,0,0], 51, [1.901923788646684,0,0]],
        [324, [18,-30,20], [0,0,6], 47, [4,0,7]],
        [345, [5,-8,4], [0,0,0], 49, [6,0,0]],
        [365, [6,-10,-6], [0,0,0], 49, [3,0,-2]],
        [391, [11,-12,20], [0,0,0], 48, [2,0,7]],
        [416, [18,-10,10], [0,0,0], 47, [Math.sqrt(24),0,Math.sqrt(12)]],
        [440, [52,-67,34], [15,0,0], 44, [8,0,0]],
        [460, [97,-47,24], [97,0,7], 43, [3,0,6]],
        [482, [121,-45,4], [112,0,-1], 44, [3,0,6]],
        [510, [144,-48,14], [140,0,0], 44, [3,0,6]],
        [537, [161,-46,10], [165,0,1], 43, [3,0,6]],
        [565, [170,-44,8], [168,0,-1], 43, [1,0,3]],
        [592, [179,-44,9], [174,0,-2], 44, [1,0,3]],
        [620, [161,-95,60], [114,0,0], 44, [1,0,0.5]],
        [641, [75,-95,63], [45,0,0], 45, [1,0,0.5]],
        [660, [24,-30,19], [0,0,0], 44, [1,0,0.5]]
      ].map(k => ({
        t: k[0],
        eye: V().fromArray(k[1]),
        aim: V().fromArray(k[2]),
        fov: k[3],
        probe: V().fromArray(k[4])
      }));

      const desired = {
        eye: V(),
        aim: V(),
        probe: V(),
        q: new T.Quaternion(),
        fov: 44,
        focus: 40
      };

      const lookMatrix = new T.Matrix4();

      function evaluateTour() {
        let i = 0;

        while (
          i < keys.length - 2 &&
          state.tour >= keys[i + 1].t
        ) {
          i++;
        }

        const a = keys[i];
        const b = keys[i + 1];

        const t = smooth(
          clamp(
            (state.tour - a.t) / (b.t - a.t),
            0,
            1
          )
        );

        desired.eye.copy(a.eye).lerp(b.eye, t);
        desired.aim.copy(a.aim).lerp(b.aim, t);
        desired.probe.copy(a.probe).lerp(b.probe, t);

        desired.fov = mix(a.fov, b.fov, t);

        desired.focus = desired.eye.distanceTo(
          desired.aim
        );

        lookMatrix.lookAt(
          desired.eye,
          desired.aim,
          up
        );

        desired.q.setFromRotationMatrix(
          lookMatrix
        );

        let chapter = 0;

        while (
          chapter < chapters.length - 1 &&
          state.tour >= chapters[chapter + 1][1]
        ) {
          chapter++;
        }

        state.stage = chapter;
      }

      evaluateTour();

      camera.position.copy(desired.eye);
      camera.quaternion.copy(desired.q);

      let focusDistance = desired.focus;

      /*
       * OrbitControls drives a separate camera.
       * The rendered camera follows smoothly.
       */

      const controlCamera = camera.clone();

      const controls = new T.OrbitControls(
        controlCamera,
        renderer.domElement
      );

      controls.enabled = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.rotateSpeed = 0.58;
      controls.zoomSpeed = 0.75;
      controls.panSpeed = 0.7;

      controls.minDistance = 0.45;
      controls.maxDistance = 480;

      controls.minPolarAngle = 0.03;
      controls.maxPolarAngle = Math.PI - 0.03;

      controls.screenSpacePanning = true;

      const forward = V();
      const syncTarget = V();

      function syncControls(targetPoint = null) {
        controls.enableDamping = false;
        controls.update();

        controlCamera.position.copy(
          camera.position
        );

        controlCamera.quaternion.copy(
          camera.quaternion
        );

        controlCamera.up.copy(up);
        controlCamera.fov = camera.fov;
        controlCamera.aspect = camera.aspect;
        controlCamera.zoom = camera.zoom;

        if (camera.view?.enabled) {
          const v = camera.view;

          controlCamera.setViewOffset(
            v.fullWidth,
            v.fullHeight,
            v.offsetX,
            v.offsetY,
            v.width,
            v.height
          );
        }

        controlCamera.updateProjectionMatrix();

        camera.getWorldDirection(forward);

        syncTarget
          .copy(camera.position)
          .addScaledVector(
            forward,
            focusDistance
          );

        controls.target.copy(
          targetPoint || syncTarget
        );

        controls.update();
        controls.enableDamping = true;
      }

      function updateButtons() {
        previousHUDStage = -1;

        text(
          "flight-mode",
          state.mode === "manual"
            ? "MANUAL INSPECTION"
            : state.mode === "return"
              ? "RETURNING TO DRONE"
              : "AUTOMATIC DRONE"
        );

        if (ui["pause-toggle"]) {
          ui["pause-toggle"].textContent =
            state.paused ? "Play" : "Pause";

          ui["pause-toggle"].setAttribute(
            "aria-pressed",
            String(state.paused)
          );

          ui["pause-toggle"].setAttribute(
            "aria-label",
            state.paused
              ? "Play animation"
              : "Pause animation"
          );
        }

        if (ui["hud-toggle"]) {
          ui["hud-toggle"].textContent =
            state.hud ? "Hide HUD" : "Show HUD";

          ui["hud-toggle"].setAttribute(
            "aria-expanded",
            String(state.hud)
          );
        }
      }

      function enterManual(reading = false) {
        if (!state.ready || state.lost) {
          return;
        }

        if (
          state.mode !== "manual" ||
          state.focusTween
        ) {
          syncControls();
        }

        state.mode = "manual";
        state.returnTween = null;
        state.focusTween = null;

        controls.enabled = true;

        if (reading) {
          state.paused = true;
        }

        updateButtons();
      }

      function makeTween(
        eye,
        q,
        fov,
        focus,
        duration
      ) {
        return {
          elapsed: 0,
          duration,

          from: camera.position.clone(),
          to: eye.clone(),

          qFrom: camera.quaternion.clone(),
          qTo: q.clone(),

          fFrom: camera.fov,
          fTo: fov,

          dFrom: focusDistance,
          dTo: focus
        };
      }

      function requestOrbital(index) {
        state.requested = index;

        if (state.reduced) {
          state.fade = 1;

          if (state.active !== index) {
            commitState(index);
          }
        }
      }

      function selectOrbital(index) {
        if (!state.ready || state.lost) {
          return;
        }

        enterManual();
        state.paused = true;

        requestOrbital(index);

        const radius = states[index].extent;

        const eye = V(0.7, -1.05, 0.65)
          .normalize()
          .multiplyScalar(radius * 3.45);

        const aim = V();

        lookMatrix.lookAt(eye, aim, up);

        const q = new T.Quaternion()
          .setFromRotationMatrix(lookMatrix);

        state.focusTween = makeTween(
          eye,
          q,
          44,
          eye.length(),
          state.reduced ? 0 : 2.8
        );

        controls.enabled = false;
        updateButtons();
      }

      function resumeDrone() {
        if (!state.ready || state.lost) {
          return;
        }

        state.paused = false;

        if (state.mode === "auto") {
          updateButtons();
          return;
        }

        evaluateTour();

        requestOrbital(
          chapters[state.stage][2]
        );

        state.focusTween = null;

        state.returnTween = makeTween(
          desired.eye,
          desired.q,
          desired.fov,
          desired.focus,

          state.reduced
            ? 0
            : clamp(
                camera.position.distanceTo(
                  desired.eye
                ) / 16,
                3,
                8
              )
        );

        state.mode = "return";
        controls.enabled = false;

        updateButtons();
      }

      function applyTween(tween, dt) {
        tween.elapsed += dt;

        const t = tween.duration === 0
          ? 1
          : clamp(
              tween.elapsed / tween.duration,
              0,
              1
            );

        const s = smooth(t);

        camera.position
          .copy(tween.from)
          .lerp(tween.to, s);

        camera.position.z +=
          Math.min(
            6,
            tween.from.distanceTo(tween.to) * 0.04
          ) *
          Math.pow(
            Math.sin(Math.PI * s),
            2
          );

        camera.quaternion
          .copy(tween.qFrom)
          .slerp(tween.qTo, s);

        camera.fov = mix(
          tween.fFrom,
          tween.fTo,
          s
        );

        focusDistance = mix(
          tween.dFrom,
          tween.dTo,
          s
        );

        return t === 1;
      }

      function updateCamera(dt) {
        if (state.mode === "manual") {
          if (state.focusTween) {
            if (
              applyTween(
                state.focusTween,
                dt
              )
            ) {
              state.focusTween = null;
              syncControls(V());
              controls.enabled = true;
            }
          } else {
            controls.update();

            const blend = state.reduced
              ? 1
              : 1 - Math.exp(-12 * dt);

            camera.position.lerp(
              controlCamera.position,
              blend
            );

            camera.quaternion.slerp(
              controlCamera.quaternion,
              blend
            );

            focusDistance = mix(
              focusDistance,

              controlCamera.position.distanceTo(
                controls.target
              ),

              blend
            );
          }
        } else if (state.mode === "return") {
          const arrived = applyTween(
            state.returnTween,
            state.paused ? 0 : dt
          );

          if (
            arrived &&
            displayStable() &&
            !state.paused
          ) {
            state.mode = "auto";
            state.returnTween = null;
            updateButtons();
          }
        } else {
          const blend = state.reduced
            ? 1
            : 1 - Math.exp(-5 * dt);

          camera.position.lerp(
            desired.eye,
            blend
          );

          camera.quaternion.slerp(
            desired.q,
            blend
          );

          camera.fov = mix(
            camera.fov,
            desired.fov,
            blend
          );

          focusDistance = mix(
            focusDistance,
            desired.focus,
            blend
          );
        }

        const panel =
          state.hud &&
          state.width > 900 &&
          ui["sidebar-ui"]
            ? ui["sidebar-ui"]
                .getBoundingClientRect()
                .right
            : 0;

        state.shift = mix(
          state.shift,
          panel * 0.48,

          state.reduced
            ? 1
            : 1 - Math.exp(-5 * dt)
        );

        camera.setViewOffset(
          state.width,
          state.height,
          -state.shift,
          0,
          state.width,
          state.height
        );

        controlCamera.setViewOffset(
          state.width,
          state.height,
          -state.shift,
          0,
          state.width,
          state.height
        );

        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);
      }

      function buildRadialChart(index) {
        const orbital = states[index];
        const count = 240;

        const amplitudes = [];
        const probabilities = [];

        let maxR = 0;
        let maxP = 0;

        for (let i = 0; i <= count; i++) {
          const u =
            i / count * orbital.cutoff;

          const r = radial(index, u);
          const p = u * u * r * r;

          amplitudes.push(r);
          probabilities.push(p);

          maxR = Math.max(
            maxR,
            Math.abs(r)
          );

          maxP = Math.max(maxP, p);
        }

        let rPath = "";
        let pPath = "";

        for (let i = 0; i <= count; i++) {
          const x = 34 + i / count * 250;
          const command = i === 0 ? "M" : "L";

          rPath +=
            command +
            x.toFixed(2) +
            " " +
            (
              42 - 22 * amplitudes[i] / maxR
            ).toFixed(2);

          pPath +=
            command +
            x.toFixed(2) +
            " " +
            (
              134 - 50 * probabilities[i] / maxP
            ).toFixed(2);
        }

        ui["radial-amplitude-path"]?.setAttribute(
          "d",
          rPath
        );

        ui["radial-probability-path"]?.setAttribute(
          "d",
          pPath
        );

        const markers = ui["radial-node-markers"];

        if (markers) {
          markers.replaceChildren();

          orbital.nodes.forEach(node => {
            const x =
              34 + node / orbital.cutoff * 250;

            const line = document.createElementNS(
              "http://www.w3.org/2000/svg",
              "path"
            );

            line.setAttribute(
              "d",
              "M" + x + " 13V134"
            );

            markers.appendChild(line);
          });
        }

        text(
          "radial-axis-max",
          orbital.cutoff.toFixed(2)
        );

        text(
          "radial-chart-desc",
          orbital.name +
          ": signed radial factor above, radial probability below. " +
          orbital.nodeText +
          " The horizontal range ends at " +
          orbital.cutoff.toFixed(3) +
          " a mu."
        );
      }

      /*
       * A state is committed atomically while the main
       * cloud is invisible. Its geometry, node guides,
       * probe evaluator, and telemetry then agree.
       */

      function commitState(index) {
        state.active = index;

        const orbital = states[index];

        cloud.geometry = orbital.geometry;

        mainMaterial.uniforms.uSize.value =
          orbital.extent * 0.014;

        text("active-orbital", orbital.name);
        text("n-value", String(orbital.n));
        text("l-value", String(orbital.l));
        text("m-value", "0");

        text(
          "energy-value",
          (
            -13.6 / (orbital.n * orbital.n)
          ).toFixed(3)
        );

        text(
          "normalization-value",
          "1 · analytic"
        );

        text(
          "radial-nodes-value",
          String(orbital.nodes.length)
        );

        text(
          "angular-nodes-value",
          String(orbital.l)
        );

        text(
          "captured-value",
          (100 * orbital.captured).toFixed(2) + "%"
        );

        text(
          "cutoff-value",
          orbital.cutoff.toFixed(3)
        );

        text(
          "node-description",
          orbital.nodeText
        );

        document
          .querySelectorAll("[data-orbital]")
          .forEach(button => {
            button.setAttribute(
              "aria-pressed",
              String(
                button.dataset.orbital === orbital.key
              )
            );
          });

        buildRadialChart(index);

        const r = orbital.extent;

        const axisAttribute =
          axis.geometry.getAttribute("position");

        axisAttribute.setXYZ(
          0,
          0,
          0,
          -r * 1.04
        );

        axisAttribute.setXYZ(
          1,
          0,
          0,
          r * 1.15
        );

        axisAttribute.needsUpdate = true;

        const bar =
          scaleBar.geometry.getAttribute("position");

        const length =
          orbital.n * orbital.n * UNIT;

        const x = -length * 0.5;
        const y = -r * 0.1;
        const z = -r * 1.13;

        bar.setXYZ(0, x, y, z);
        bar.setXYZ(1, x + length, y, z);

        bar.setXYZ(
          2,
          x,
          y,
          z - r * 0.025
        );

        bar.setXYZ(
          3,
          x,
          y,
          z + r * 0.025
        );

        bar.setXYZ(
          4,
          x + length,
          y,
          z - r * 0.025
        );

        bar.setXYZ(
          5,
          x + length,
          y,
          z + r * 0.025
        );

        bar.needsUpdate = true;

        axisName.object.position.set(
          0,
          0,
          r * 1.17
        );

        scaleName.object.position.set(
          x,
          y,
          z - r * 0.08
        );

        scaleName.title.textContent =
          orbital.n * orbital.n +
          " aμ · physical ruler";

        mainCards[0].object.position.set(
          r * 0.28,
          -r * 0.12,
          r * 0.25
        );

        mainCards[1].object.position.set(
          -r * 0.26,
          0,
          r * 0.15
        );

        mainCards[2].object.position.set(
          (orbital.nodes.at(-1) || 1) * UNIT,
          0,
          0
        );

        mainCards[3].object.position.set(
          r * 0.42,
          0,
          0
        );

        mainCards[4].object.position.set(
          0,
          0,
          r * 0.43
        );

        mainCards[5].object.position.set(
          r * 0.35 * Math.sqrt(2 / 3),
          0,
          r * 0.35 / Math.sqrt(3)
        );

        const radialReadout =
          mainCards[2].card.querySelector(
            '[data-slot="radial-radii"]'
          );

        if (radialReadout) {
          radialReadout.textContent =
            orbital.name +
            " / " +
            (
              orbital.nodes.length
                ? "r/aμ = " +
                  orbital.nodes
                    .map(n => n.toFixed(3))
                    .join(", ")
                : "no radial nodes"
            );
        }

        previousHUDStage = -1;
        layoutClock = 1;
      }

      function displayStable() {
        return (
          state.active === state.requested &&
          state.fade > 0.999
        );
      }

      function updateDisplay(dt) {
        if (state.active !== state.requested) {
          state.fade = Math.max(
            0,
            state.fade - dt / 0.65
          );

          if (state.fade === 0) {
            commitState(state.requested);
          }
        } else {
          state.fade = Math.min(
            1,
            state.fade + dt / 0.85
          );
        }

        mainMaterial.uniforms.uOpacity.value =
          0.78 * state.fade;

        axis.material.opacity =
          0.23 * state.fade;

        scaleBar.material.opacity =
          0.55 * state.fade;

        states.forEach((orbital, index) => {
          orbital.guide.visible =
            index === state.active &&
            (ui["nodes-toggle"]?.checked ?? true) &&
            (
              orbital.nodes.length > 0 ||
              orbital.l > 0
            );

          orbital.guide.material.opacity =
            0.28 * state.fade;
        });

        if (ui["transition-status"]) {
          ui["transition-status"].hidden =
            displayStable();

          if (!displayStable()) {
            ui["transition-status"].textContent =
              "Displaying " +
              states[state.requested].name +
              " · visual fade, not quantum time evolution";
          }
        }
      }

      /*
       * Diagram connections associate states with energy.
       * They are not electron trajectories.
       */

      const links = [];

      states.forEach(orbital => {
        const p = orbital.thumbnail.position;

        links.push(
          p.x + 9, 3, p.z,
          150, 3, p.z,

          150, 3, p.z,
          158, 3, energyZ(orbital.n)
        );
      });

      const energyLinks = lines(
        scene,
        links,
        colors.blue,
        0.14
      );

      const names = [];

      function addName(
        parent,
        position,
        title,
        detail,
        kind,
        enabled
      ) {
        const element = document.createElement("div");
        element.className = "world-anchor";

        const span = document.createElement("span");

        span.className =
          "world-name world-name--" +
          (kind || "muted");

        span.style.transform =
          "translate(10px,-50%)";

        const heading = document.createElement("span");
        heading.textContent = title;

        span.appendChild(heading);

        if (detail) {
          const sub = document.createElement("span");

          sub.textContent = detail;
          sub.style.display = "block";
          sub.style.fontSize = "9px";
          sub.style.marginTop = "3px";

          span.appendChild(sub);
        }

        element.appendChild(span);

        const object = new T.CSS2DObject(element);

        object.position.copy(position);
        parent.add(object);

        const entry = {
          object,
          element,
          span,
          title: heading,
          enabled,

          world: V(),
          projected: V()
        };

        names.push(entry);
        return entry;
      }

      const mainVisible = () =>
        displayStable() &&
        (
          state.stage < 7 ||
          state.mode === "manual" ||
          state.stage === 10
        );

      const atlasVisible = () =>
        state.stage >= 7 ||
        state.mode === "manual";

      const ladderVisible = () =>
        state.stage === 8 ||
        state.stage === 9 ||
        (
          state.mode === "manual" &&
          camera.position.distanceTo(
            ladder.position
          ) < 100
        );

      const photonVisible = () =>
        state.stage === 9 ||
        (
          state.mode === "manual" &&
          camera.position.distanceTo(
            ladder.position
          ) < 65
        );

      const axisName = addName(
        main,
        V(),
        "+z / quantization axis",
        "",
        "muted",
        mainVisible
      );

      const scaleName = addName(
        main,
        V(),
        "",
        "",
        "muted",
        mainVisible
      );

      addName(
        main,
        V(0.15, -0.15, 0.15),
        "PROTON / NOT TO SCALE",
        "",
        "gold",

        () =>
          mainVisible() &&
          camera.position.length() < 22
      );

      addName(
        probe,
        V(0, 0, 0.24),
        "FIELD PROBE",
        "",
        "cyan",

        () =>
          probe.visible &&
          mainVisible()
      );

      states.forEach(orbital => {
        addName(
          orbital.thumbnail,
          V(-8.6, 0, -10.8),

          orbital.name +
          " / n " + orbital.n +
          " · ℓ " + orbital.l +
          " · m 0",

          orbital.nodes.length +
          " radial / " +
          orbital.l +
          " angular · rmax " +
          orbital.cutoff.toFixed(2) +
          " aμ",

          "muted",
          atlasVisible
        );
      });

      addName(
        atlas,
        V(78, 0, 29),
        "ALTERNATIVE ONE-ELECTRON STATES",
        "Individual display scales · compare shape",
        "cyan",
        atlasVisible
      );

      for (let n = 1; n <= 4; n++) {
        addName(
          ladder,
          V(7.4, 0, energyZ(n)),

          "n " + n +
          " / ≈ " +
          (-13.6 / (n * n)).toFixed(3) +
          " eV",

          "",
          "gold",
          ladderVisible
        );
      }

      addName(
        ladder,
        V(-7, 0, 18.2),
        "E = 0 / ionization limit",
        "",
        "muted",
        ladderVisible
      );

      addName(
        ladder,
        V(-7, 0, -18),
        "ENERGY AXIS / LINEAR SCALE",
        "Links associate states with energy",
        "muted",
        ladderVisible
      );

      addName(
        ladder,
        V(12, 0, -8),
        "PHOTON / SCHEMATIC",
        "≈ 121.6 nm · screen wavelength not to scale",
        "magenta",
        photonVisible
      );

      /*
       * World cards use DOM and MathML from index.html.
       * CSS2D owns a zero-size anchor; the card is offset
       * separately so its renderer transform is preserved.
       */

      const cards = [];
      const mainCards = [];

      function addCard(
        templateId,
        parent,
        position,
        color,
        enabled
      ) {
        const template = $(templateId);

        if (!template?.content?.firstElementChild) {
          throw new Error(
            "Missing template: " + templateId
          );
        }

        const element = document.createElement("div");
        element.className = "world-anchor";

        const card =
          template.content.firstElementChild.cloneNode(true);

        card.removeAttribute("id");
        card.tabIndex = -1;
        card.setAttribute("aria-hidden", "true");

        element.appendChild(card);

        const object = new T.CSS2DObject(element);

        object.position.copy(position);
        parent.add(object);

        const leader = lines(
          scene,
          new Float32Array(6),
          color,
          0
        );

        leader.material.depthTest = false;
        leader.frustumCulled = false;
        leader.renderOrder = 20;

        leader.geometry
          .getAttribute("position")
          .setUsage(T.DynamicDrawUsage);

        card.addEventListener(
          "pointerdown",
          () => enterManual(true)
        );

        card.addEventListener(
          "focusin",
          () => enterManual(true)
        );

        card.addEventListener(
          "wheel",
          () => enterManual(true),
          { passive: true }
        );

        const entry = {
          element,
          card,
          object,
          leader,
          enabled,

          world: V(),
          projected: V(),
          end: V(),

          target: 0,
          opacity: 0,

          x: 0,
          y: 0,
          endX: 0,
          endY: 0,

          width: 310,
          height: 260
        };

        cards.push(entry);
        return entry;
      }

      mainCards.push(
        addCard(
          "density-label-template",
          main,
          V(),
          colors.cyan,

          () =>
            mainVisible() &&
            state.active === 0
        ),

        addCard(
          "separation-label-template",
          main,
          V(),
          colors.blue,

          () =>
            mainVisible() &&
            (
              state.stage === 4 ||
              state.stage === 5 ||
              state.mode === "manual"
            )
        ),

        addCard(
          "radial-label-template",
          main,
          V(),
          colors.gold,

          () =>
            mainVisible() &&
            states[state.active].nodes.length > 0
        ),

        addCard(
          "angular-label-template",
          main,
          V(),
          colors.violet,

          () =>
            mainVisible() &&
            states[state.active].l === 1 &&
            state.stage !== 3
        ),

        addCard(
          "phase-label-template",
          main,
          V(),
          colors.magenta,

          () =>
            mainVisible() &&
            state.active !== 0 &&
            (
              state.stage === 3 ||
              state.mode === "manual"
            )
        ),

        addCard(
          "d-label-template",
          main,
          V(),
          colors.violet,

          () =>
            mainVisible() &&
            state.active === 5
        ),

        addCard(
          "nucleus-label-template",
          main,
          V(),
          colors.gold,

          () =>
            mainVisible() &&
            camera.position.length() < 10
        )
      );

      states.forEach(orbital => {
        const entry = addCard(
          "orbital-label-template",
          orbital.thumbnail,
          V(0, 0, 3),
          colors.blue,
          atlasVisible
        );

        function slot(name, value) {
          const element = entry.card.querySelector(
            '[data-slot="' + name + '"]'
          );

          if (element) {
            element.textContent = value;
          }
        }

        slot(
          "orbital-name",
          orbital.name
        );

        slot(
          "quantum-numbers",
          "n = " + orbital.n +
          " · ℓ = " + orbital.l +
          " · m = 0"
        );

        slot(
          "equation-n",
          String(orbital.n)
        );

        slot(
          "equation-l",
          String(orbital.l)
        );

        slot(
          "harmonic-l",
          String(orbital.l)
        );

        slot(
          "orbital-description",
          orbital.description
        );

        slot(
          "node-counts",
          "Radial " +
          orbital.nodes.length +
          " / angular " +
          orbital.l
        );

        slot(
          "display-scale",
          "Physical cutoff r/aμ = " +
          orbital.cutoff.toFixed(3) +
          "."
        );
      });

      addCard(
        "energy-label-template",
        ladder,
        V(0, 0, 6),
        colors.gold,
        ladderVisible
      );

      addCard(
        "photon-label-template",
        ladder,
        V(8, 0, -3),
        colors.magenta,
        photonVisible
      );

      let layoutClock = 1;
      let occupied = [];

      function overlaps(a, b) {
        return (
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y
        );
      }

      function rect(element, pad = 10) {
        if (
          !element ||
          !element.getClientRects().length ||
          getComputedStyle(element).display === "none"
        ) {
          return null;
        }

        const r = element.getBoundingClientRect();

        return {
          x: r.left - pad,
          y: r.top - pad,
          w: r.width + 2 * pad,
          h: r.height + 2 * pad
        };
      }

      function project(world, output) {
        output.copy(world).project(camera);

        return (
          output.z > -1 &&
          output.z < 1 &&
          Math.abs(output.x) < 1.06 &&
          Math.abs(output.y) < 1.06
        );
      }

      function layoutLabels() {
        occupied = [
          rect(ui["flight-controls"])
        ];

        if (state.hud) {
          occupied.push(
            rect(ui["sidebar-ui"]),
            rect(ui["scene-caption"]),
            rect(ui["reference-legend"])
          );
        }

        occupied = occupied.filter(Boolean);

        const protect = {
          x: state.width * 0.5 + state.shift - 82,
          y: state.height * 0.5 - 66,
          w: 164,
          h: 132
        };

        const candidates = [];

        cards.forEach((entry, index) => {
          entry.target = 0;

          entry.object.getWorldPosition(
            entry.world
          );

          if (
            !state.hud ||
            !entry.enabled() ||
            !project(entry.world, entry.projected)
          ) {
            return;
          }

          const distance =
            entry.world.distanceTo(camera.position);

          if (distance > 210) {
            return;
          }

          let priority = -distance;

          if (
            index === 2 &&
            [1, 4, 5].includes(state.stage)
          ) {
            priority += 45;
          }

          if (
            index === 3 &&
            state.stage === 2
          ) {
            priority += 45;
          }

          if (
            index === 4 &&
            state.stage === 3
          ) {
            priority += 60;
          }

          if (
            index === 5 &&
            state.stage === 6
          ) {
            priority += 60;
          }

          if (
            index === 13 &&
            state.stage === 8
          ) {
            priority += 100;
          }

          if (
            index === 14 &&
            state.stage === 9
          ) {
            priority += 110;
          }

          if (
            entry.card.contains(
              document.activeElement
            )
          ) {
            priority += 200;
          }

          candidates.push({
            entry,
            priority
          });
        });

        candidates.sort(
          (a, b) => b.priority - a.priority
        );

        let count = 0;

        for (const candidate of candidates) {
          if (
            count >= (
              state.width < 1200 ? 1 : 2
            )
          ) {
            break;
          }

          const e = candidate.entry;

          const sx =
            (e.projected.x * 0.5 + 0.5) *
            state.width;

          const sy =
            (0.5 - e.projected.y * 0.5) *
            state.height;

          const w =
            e.card.offsetWidth || 310;

          const h =
            e.card.offsetHeight || 260;

          const proposals = [
            [sx + 30, sy - h * 0.5],
            [sx - w - 30, sy - h * 0.5],
            [sx + 32, sy - h - 25],
            [sx - w - 32, sy - h - 25],
            [state.width - w - 20, sy - h * 0.5],
            [sx + 32, sy + 28],
            [sx - w - 32, sy + 28]
          ];

          let chosen = null;

          for (const p of proposals) {
            const b = {
              x: clamp(
                p[0],
                12,
                Math.max(
                  12,
                  state.width - w - 12
                )
              ),

              y: clamp(
                p[1],
                12,
                Math.max(
                  12,
                  state.height - h - 12
                )
              ),

              w,
              h
            };

            if (
              b.x + w > state.width - 10 ||
              b.y + h > state.height - 10
            ) {
              continue;
            }

            if (
              overlaps(b, protect) ||
              occupied.some(
                r => overlaps(b, r)
              )
            ) {
              continue;
            }

            chosen = b;
            break;
          }

          if (!chosen) {
            continue;
          }

          e.x = chosen.x - sx;
          e.y = chosen.y - sy;

          e.width = w;
          e.height = h;

          e.card.style.transform =
            "translate(" +
            e.x + "px," +
            e.y + "px)";

          e.endX =
            clamp(
              sx,
              chosen.x,
              chosen.x + w
            ) - sx;

          e.endY =
            clamp(
              sy,
              chosen.y,
              chosen.y + h
            ) - sy;

          e.target = 1;

          occupied.push({
            x: chosen.x - 9,
            y: chosen.y - 9,
            w: w + 18,
            h: h + 18
          });

          count++;
        }

        let nameCount = 0;

        names.forEach(entry => {
          entry.object.getWorldPosition(
            entry.world
          );

          let visible =
            state.hud &&
            entry.enabled() &&
            nameCount < 10 &&
            project(
              entry.world,
              entry.projected
            );

          if (visible) {
            const sx =
              (entry.projected.x * 0.5 + 0.5) *
              state.width;

            const sy =
              (0.5 - entry.projected.y * 0.5) *
              state.height;

            const h =
              entry.span.offsetHeight || 26;

            const b = {
              x: sx + 10,
              y: sy - h / 2,
              w: entry.span.offsetWidth || 190,
              h
            };

            visible =
              b.x > 8 &&
              b.x + b.w < state.width - 8 &&
              b.y > 8 &&
              b.y + b.h < state.height - 8 &&
              !occupied.some(
                r => overlaps(b, r)
              );

            if (visible) {
              occupied.push(b);
            }
          }

          entry.object.visible = visible;

          entry.element.style.opacity =
            visible ? "1" : "0";

          entry.element.setAttribute(
            "aria-hidden",
            String(!visible)
          );

          if (visible) {
            nameCount++;
          }
        });
      }

      function updateLabels(dt) {
        layoutClock += dt;

        if (layoutClock >= 0.15) {
          layoutClock = 0;
          layoutLabels();
        }

        const blend = state.reduced
          ? 1
          : 1 - Math.exp(-8 * dt);

        cards.forEach(entry => {
          entry.object.getWorldPosition(
            entry.world
          );

          const onScreen = project(
            entry.world,
            entry.projected
          );

          if (
            !entry.enabled() ||
            !state.hud ||
            !onScreen
          ) {
            entry.target = 0;
          }

          entry.opacity = mix(
            entry.opacity,
            entry.target,
            blend
          );

          const visible =
            state.hud &&
            onScreen &&
            entry.opacity > 0.015;

          entry.object.visible = visible;

          entry.element.style.opacity =
            String(entry.opacity);

          const interactive =
            visible &&
            entry.target === 1 &&
            entry.opacity > 0.45;

          entry.card.style.pointerEvents =
            interactive ? "auto" : "none";

          entry.card.tabIndex =
            interactive ? 0 : -1;

          entry.card.setAttribute(
            "aria-hidden",
            String(!interactive)
          );

          if (
            !interactive &&
            entry.card.contains(
              document.activeElement
            )
          ) {
            ui["hud-toggle"]?.focus();
          }

          entry.leader.visible = visible;

          if (!visible) {
            return;
          }

          entry.leader.material.opacity =
            0.45 * entry.opacity;

          const sx =
            (entry.projected.x * 0.5 + 0.5) *
            state.width;

          const sy =
            (0.5 - entry.projected.y * 0.5) *
            state.height;

          entry.end.set(
            (sx + entry.endX) /
              state.width * 2 - 1,

            1 -
              (sy + entry.endY) /
              state.height * 2,

            entry.projected.z
          ).unproject(camera);

          const attribute =
            entry.leader.geometry.getAttribute(
              "position"
            );

          attribute.setXYZ(
            0,
            entry.world.x,
            entry.world.y,
            entry.world.z
          );

          attribute.setXYZ(
            1,
            entry.end.x,
            entry.end.y,
            entry.end.z
          );

          attribute.needsUpdate = true;
        });
      }

      const probePoint = V();
      const probeResult = {};

      let hudClock = 1;
      let previousHUDStage = -1;

      const stageNodes = Array.from(
        ui["journey-stages"]?.querySelectorAll(
          "[data-stage]"
        ) || []
      );

      function updateProbe() {
        if (state.mode === "manual") {
          if (state.focusTween) {
            probePoint.set(0, 0, 0);
          } else {
            probePoint
              .copy(controls.target)
              .divideScalar(UNIT);
          }
        } else {
          probePoint.copy(desired.probe);
        }

        field(
          state.active,
          probePoint.x,
          probePoint.y,
          probePoint.z,
          probeResult
        );

        probe.position
          .copy(probePoint)
          .multiplyScalar(UNIT);

        probe.scale.setScalar(
          clamp(
            states[state.active].extent / 12,
            0.8,
            3.5
          )
        );

        probe.visible =
          displayStable() &&
          (
            state.mode === "manual" ||
            state.stage < 7 ||
            state.stage === 10
          );
      }

      function timeText(seconds) {
        const n = Math.floor(seconds);

        return (
          String(
            Math.floor(n / 60)
          ).padStart(2, "0") +
          ":" +
          String(n % 60).padStart(2, "0")
        );
      }

      function updateHUD(dt) {
        hudClock += dt;

        if (hudClock < 0.12) {
          return;
        }

        hudClock = 0;

        const changing = !displayStable();
        const orbital = states[state.active];

        let density =
          probeResult.density.toExponential(3);

        if (probeResult.density === 0) {
          density = probeResult.exactNode
            ? "0"
            : "< 1e−300";
        }

        text(
          "density-value",
          changing ? "—" : density
        );

        text(
          "phase-value",

          changing
            ? "CHANGING"
            : probeResult.exactNode
              ? "UNDEFINED"
              : probeResult.nearNode
                ? "≈ NODE"
                : probeResult.sign > 0
                  ? "0"
                  : "π"
        );

        let status = state.mode === "manual"
          ? "ORBIT TARGET"
          : "GUIDED PROBE";

        if (changing) {
          status += " / DISPLAY CHANGE";
        } else if (probeResult.nearNode) {
          status += " / NEAR NODE";
        } else if (
          probeResult.r > orbital.cutoff
        ) {
          status += " / OUTSIDE SHOWN CLOUD";
        } else {
          status += " / IN SHOWN CLOUD";
        }

        text("probe-status", status);

        text(
          "probe-position-value",
          "(" +
          probePoint.x.toFixed(2) + ", " +
          probePoint.y.toFixed(2) + ", " +
          probePoint.z.toFixed(2) +
          ") aμ"
        );

        const progress = state.tour / TOTAL;

        if (ui["flight-progress"]) {
          ui["flight-progress"].style.transform =
            "scaleX(" + progress + ")";
        }

        ui["journey-progress"]?.setAttribute(
          "aria-valuenow",
          (progress * 100).toFixed(1)
        );

        ui["journey-progress"]?.setAttribute(
          "aria-valuetext",
          timeText(state.tour) +
          " of " +
          timeText(TOTAL)
        );

        text(
          "tour-time",
          timeText(state.tour) +
          " / " +
          timeText(TOTAL)
        );

        if (previousHUDStage !== state.stage) {
          previousHUDStage = state.stage;

          const chapter = chapters[state.stage];
          const manual = state.mode === "manual";

          text(
            "chapter-value",

            manual
              ? "MANUAL / TOUR HELD AT " +
                String(
                  state.stage + 1
                ).padStart(2, "0")

              : String(
                  state.stage + 1
                ).padStart(2, "0") +
                " / " +
                chapter[3]
          );

          text(
            "scene-title",

            manual
              ? "Inspecting " + orbital.name
              : chapter[4]
          );

          text(
            "scene-description",

            manual
              ? orbital.description +
                " Pan to move the field probe. " +
                "Resume Drone returns to the held tour chapter."

              : chapter[5]
          );

          stageNodes.forEach(node => {
            const active =
              node.dataset.stage === chapter[0];

            node.classList.toggle(
              "is-active",
              active
            );

            if (active) {
              node.setAttribute(
                "aria-current",
                "step"
              );
            } else {
              node.removeAttribute(
                "aria-current"
              );
            }
          });

          layoutClock = 1;
        }
      }

      function toggleHUD() {
        state.hud = !state.hud;

        const regions = [
          ui["sidebar-ui"],
          ui["scene-caption"],
          ui["reference-legend"],
          labels.domElement
        ].filter(Boolean);

        if (
          !state.hud &&
          regions.some(
            el => el.contains(document.activeElement)
          )
        ) {
          ui["hud-toggle"]?.focus();
        }

        document.body.classList.toggle(
          "hud-hidden",
          !state.hud
        );

        regions.forEach(el => {
          el.inert = !state.hud;

          el.setAttribute(
            "aria-hidden",
            String(!state.hud)
          );
        });

        layoutClock = 1;
        updateButtons();
      }

      function setColorMode() {
        const phase =
          (ui["color-mode"]?.value || "phase") ===
          "phase";

        pointMaterials.forEach(material => {
          material.uniforms.uPhase.value =
            phase ? 1 : 0;
        });

        if (ui["phase-legend"]) {
          ui["phase-legend"].hidden = !phase;
        }

        if (ui["density-legend"]) {
          ui["density-legend"].hidden = phase;
        }
      }

      function togglePause() {
        state.paused = !state.paused;
        updateButtons();
      }

      /*
       * Capture listeners transfer ownership before
       * OrbitControls processes the same gesture.
       */

      renderer.domElement.addEventListener(
        "pointerdown",
        () => enterManual(),
        { capture: true }
      );

      renderer.domElement.addEventListener(
        "wheel",
        () => enterManual(),
        {
          capture: true,
          passive: true
        }
      );

      renderer.domElement.addEventListener(
        "touchstart",
        () => enterManual(),
        {
          capture: true,
          passive: true
        }
      );

      document
        .querySelectorAll("[data-orbital]")
        .forEach(button => {
          button.addEventListener(
            "click",
            () => {
              const index = states.findIndex(
                orbital =>
                  orbital.key ===
                  button.dataset.orbital
              );

              if (index >= 0) {
                selectOrbital(index);
              }
            }
          );
        });

      ui["hud-toggle"]?.addEventListener(
        "click",
        toggleHUD
      );

      ui["pause-toggle"]?.addEventListener(
        "click",
        togglePause
      );

      ui["resume-flight"]?.addEventListener(
        "click",
        resumeDrone
      );

      ui["color-mode"]?.addEventListener(
        "change",
        setColorMode
      );

      ui["nodes-toggle"]?.addEventListener(
        "change",
        () => {
          layoutClock = 1;
        }
      );

      document
        .querySelectorAll("[data-inspection-ui]")
        .forEach(element => {
          element.addEventListener(
            "pointerdown",
            () => enterManual(true)
          );

          element.addEventListener(
            "focusin",
            () => enterManual(true)
          );

          element.addEventListener(
            "wheel",
            () => enterManual(true),
            { passive: true }
          );
        });

      document.addEventListener(
        "keydown",
        event => {
          if (
            !state.ready ||
            state.lost ||
            event.repeat ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          ) {
            return;
          }

          const element = event.target;

          if (
            element instanceof Element &&
            element.closest(
              "input,textarea,select,[contenteditable='true']"
            )
          ) {
            return;
          }

          const key = event.key.toLowerCase();

          if (event.code === "Space") {
            if (
              element instanceof Element &&
              element.closest(
                "button,summary,a"
              )
            ) {
              return;
            }

            event.preventDefault();
            togglePause();
          } else if (key === "r") {
            event.preventDefault();
            resumeDrone();
          } else if (key === "h") {
            event.preventDefault();
            toggleHUD();
          }
        }
      );

      function onMotionPreference(event) {
        state.reduced = event.matches;

        if (event.matches) {
          state.paused = true;

          if (state.focusTween) {
            state.focusTween.duration = 0;
          }

          requestOrbital(state.requested);
          updateButtons();
        }
      }

      if (motionQuery.addEventListener) {
        motionQuery.addEventListener(
          "change",
          onMotionPreference
        );
      } else {
        motionQuery.addListener(
          onMotionPreference
        );
      }

      function resize() {
        state.width = Math.max(
          1,
          window.innerWidth
        );

        state.height = Math.max(
          1,
          window.innerHeight
        );

        state.dpr = Math.min(
          window.devicePixelRatio || 1,
          1.5,

          Math.sqrt(
            2600000 /
            (state.width * state.height)
          )
        );

        renderer.setPixelRatio(state.dpr);

        renderer.setSize(
          state.width,
          state.height
        );

        composer.setPixelRatio(state.dpr);

        composer.setSize(
          state.width,
          state.height
        );

        bloom.setSize(
          Math.max(
            1,
            Math.round(
              state.width *
              state.dpr *
              0.65
            )
          ),

          Math.max(
            1,
            Math.round(
              state.height *
              state.dpr *
              0.65
            )
          )
        );

        fxaa.uniforms.resolution.value.set(
          1 / (state.width * state.dpr),
          1 / (state.height * state.dpr)
        );

        labels.setSize(
          state.width,
          state.height
        );

        camera.aspect =
          state.width / state.height;

        controlCamera.aspect =
          state.width / state.height;

        camera.updateProjectionMatrix();
        controlCamera.updateProjectionMatrix();

        layoutClock = 1;
      }

      window.addEventListener(
        "resize",
        resize
      );

      window.visualViewport?.addEventListener(
        "resize",
        resize
      );

      resize();

      let previousStamp = null;

      document.addEventListener(
        "visibilitychange",
        () => {
          previousStamp = null;
        }
      );

      renderer.domElement.addEventListener(
        "webglcontextlost",
        event => {
          event.preventDefault();

          state.lost = true;
          previousStamp = null;
          controls.enabled = false;

          engineControls.forEach(control => {
            control.disabled = true;
          });

          if (notice) {
            notice.hidden = false;
            notice.setAttribute("role", "status");

            notice.textContent =
              "The graphics context was interrupted. " +
              "Waiting for the browser to restore it…";
          }
        }
      );

      renderer.domElement.addEventListener(
        "webglcontextrestored",
        () => {
          try {
            state.lost = false;
            state.ready = false;
            previousStamp = null;

            controls.enabled =
              state.mode === "manual" &&
              !state.focusTween;

            resize();
          } catch (error) {
            fail(
              "The graphics context could not be restored. " +
              "Reload this page to restart the atlas.",
              error
            );
          }
        }
      );

      commitState(0);
      setColorMode();
      updateButtons();

      function frame(stamp) {
        if (failed) {
          return;
        }

        requestAnimationFrame(frame);

        if (state.lost || document.hidden) {
          previousStamp = null;
          return;
        }

        const dt = previousStamp === null
          ? 1 / 60
          : Math.min(
              0.04,
              Math.max(
                0,
                (stamp - previousStamp) / 1000
              )
            );

        previousStamp = stamp;

        try {
          if (
            !state.paused &&
            state.mode !== "return"
          ) {
            state.sceneTime += dt;

            if (state.mode === "auto") {
              state.tour =
                (state.tour + dt) % TOTAL;
            }
          }

          evaluateTour();

          if (
            state.mode === "auto" &&
            state.enteredStage !== state.stage
          ) {
            state.enteredStage = state.stage;

            requestOrbital(
              chapters[state.stage][2]
            );

            layoutClock = 1;
          }

          /*
           * UI fades and explicitly requested framing
           * continue while the guided tour is paused.
           */

          updateDisplay(dt);
          updateCamera(dt);
          updateProbe();

          atlas.visible = atlasVisible();
          ladder.visible = ladderVisible();

          energyLinks.visible =
            atlas.visible &&
            ladder.visible &&
            state.stage !== 9;

          transitionArrow.visible =
            photonVisible();

          photon.visible =
            photonVisible();

          const cycle =
            (state.sceneTime % 7) / 7;

          photon.position.set(
            13 + cycle * 19,
            0,
            -3
          );

          photon.children[0].material.opacity =
            0.9 *
            Math.min(1, cycle * 8) *
            Math.min(1, (1 - cycle) * 8);

          levelLines.forEach((line, index) => {
            line.material.opacity =
              index + 1 === states[state.active].n
                ? 0.85
                : 0.38;
          });

          const pointScale =
            state.height *
            state.dpr /
            (
              2 * Math.tan(
                T.MathUtils.degToRad(
                  camera.fov / 2
                )
              )
            );

          pointMaterials.forEach(material => {
            material.uniforms.uScale.value =
              pointScale;
          });

          scene.updateMatrixWorld(true);

          updateHUD(dt);
          updateLabels(dt);

          composer.render();
          labels.render(scene, camera);

          if (!state.ready) {
            const shaderFailure =
              (renderer.info.programs || []).some(
                program =>
                  program.diagnostics?.runnable === false
              );

            if (shaderFailure) {
              throw new Error(
                "A WebGL shader could not compile on this device."
              );
            }

            state.ready = true;

            host.setAttribute(
              "aria-busy",
              "false"
            );

            if (notice) {
              notice.hidden = true;
            }

            engineControls.forEach(control => {
              control.disabled = false;
            });

            updateButtons();
          }
        } catch (error) {
          fail(
            "The atlas could not finish rendering. " +
            "Check that the Three.js CDN scripts loaded, " +
            "then reload the page.",
            error
          );
        }
      }

      requestAnimationFrame(frame);
    } catch (error) {
      fail(
        "The atlas could not start. Keep index.html, " +
        "styles.css, and script.js together and check " +
        "the Three.js CDN connection.",
        error
      );
    }
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