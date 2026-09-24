/* Quantum Vortex Lattice — Three.js r128, no build step.
   Coordinates: rotation about +y, transverse plane (x,z).
   Length: xi0. Time: tau0 = m*xi0^2/hbar. Velocity: hbar/(m*xi0).
   This is a prescribed density/phase ansatz, not a GP solver.
*/

(() => {
  "use strict";

  const start = () => {
    const notice = document.getElementById("render-notice");
    const host = document.getElementById("canvas-container");
    const engineButtons = Array.from(
      document.querySelectorAll("[data-engine-control]")
    );

    let failed = false;

    function fail(message, error) {
      failed = true;

      if (host) {
        host.setAttribute("aria-busy", "false");
      }

      engineButtons.forEach(button => {
        button.disabled = true;
      });

      if (notice) {
        notice.hidden = false;
        notice.setAttribute("role", "alert");
        notice.textContent = message;
      }

      if (error) {
        console.error("Quantum Vortex Lattice:", error);
      }
    }

    try {
      if (!host || !window.THREE) {
        throw new Error(
          "Three.js or the canvas container is missing."
        );
      }

      const T = window.THREE;

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
          throw new Error("Missing Three.js extension: " + name);
        }
      });

      const byId = id => document.getElementById(id);
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
        "density-value",
        "angular-value",
        "vortex-count-value",
        "healing-value",
        "spacing-value",
        "phase-value",
        "circulation-value",
        "potential-value",
        "probe-status",
        "probe-position-value",
        "selected-vortex-value"
      ].forEach(id => {
        ui[id] = byId(id);
      });

      function text(id, value) {
        if (ui[id] && ui[id].textContent !== value) {
          ui[id].textContent = value;
        }
      }

      const TAU = Math.PI * 2;

      const R = 22;
      const Z = 12;
      const SPACING = 6;

      const OMEGA =
        TAU / (Math.sqrt(3) * SPACING * SPACING);

      const WR2 = OMEGA * OMEGA + 1 / (R * R);
      const WY2 = 1 / (Z * Z);

      const TOUR_LENGTH = 600;
      const TIME_RATE = 0.55;

      const clamp = T.MathUtils.clamp;
      const mix = T.MathUtils.lerp;

      const ease = t =>
        t * t * t * (t * (6 * t - 15) + 10);

      const V = (x = 0, y = 0, z = 0) =>
        new T.Vector3(x, y, z);

      const motionQuery = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
      );

      const state = {
        mode: "auto",
        paused: motionQuery.matches,
        hud: true,
        tour: 0,
        time: 0,
        angle: 0,
        stage: 0,
        returning: null,
        lost: false,
        ready: false,
        width: 1,
        height: 1,
        dpr: 1,
        shift: 0
      };

      let seed = 0x54c8f1;

      function random() {
        seed = (1664525 * seed + 1013904223) >>> 0;
        return seed / 4294967296;
      }

      function linear(hex) {
        return new T.Color(hex).convertSRGBToLinear();
      }

      const colors = {
        cyan: linear("#70e7ff"),
        blue: linear("#90baff"),
        violet: linear("#bc9aff"),
        magenta: linear("#f29bdc"),
        gold: linear("#f3ce87"),
        dim: linear("#31516b")
      };

      const palette = [
        colors.cyan,
        colors.blue,
        colors.violet,
        colors.magenta
      ];

      function phaseColor(phase, out) {
        const p = ((phase / TAU) % 1 + 1) % 1 * 4;
        const k = Math.floor(p);

        return out
          .copy(palette[k])
          .lerp(palette[(k + 1) % 4], p - k);
      }

      /*
       * Hexagonal patch of a triangular lattice:
       *
       * x = a(i + j/2)
       * z = a sqrt(3) j/2
       *
       * max(|i|, |j|, |i+j|) <= 3 gives 37 vortices.
       */

      const cores = [];

      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          if (
            Math.max(
              Math.abs(i),
              Math.abs(j),
              Math.abs(i + j)
            ) > 3
          ) {
            continue;
          }

          const x = SPACING * (i + j / 2);
          const z = SPACING * Math.sqrt(3) * j / 2;

          cores.push({
            x,
            z,
            i,
            j,
            h: Z * Math.sqrt(
              1 - (x * x + z * z) / (R * R)
            )
          });
        }
      }

      const selectedIndex = cores.findIndex(
        c => c.i === 0 && c.j === 0
      );

      /*
       * Prescribed density:
       *
       * n/n0 = max(0, 1-rho^2/R^2-y^2/Z^2)
       *        product_j [s_j^2/(s_j^2+1)]
       *
       * The reference healing length is one scene unit.
       *
       * Positive circulation about +y uses:
       *
       * theta_j = atan2(-dz, dx)
       * grad(theta_j) = (dz, 0, -dx)/s_j^2
       */

      function field(x, y, z, out) {
        let n = Math.max(
          0,
          1 -
            (x * x + z * z) / (R * R) -
            y * y / (Z * Z)
        );

        let phase = 0;
        let nearest2 = Infinity;

        for (let k = 0; k < cores.length; k++) {
          const dx = x - cores[k].x;
          const dz = z - cores[k].z;
          const s2 = dx * dx + dz * dz;

          nearest2 = Math.min(nearest2, s2);
          n *= s2 / (s2 + 1);

          phase += Math.atan2(-dz, dx);
        }

        out.n = n;
        out.phase = ((phase % TAU) + TAU) % TAU;
        out.nearest2 = nearest2;

        out.potential =
          WR2 * (x * x + z * z) +
          WY2 * y * y;

        return out;
      }

      function velocity(x, z, out) {
        let vx = 0;
        let vz = 0;

        for (let k = 0; k < cores.length; k++) {
          const dx = x - cores[k].x;
          const dz = z - cores[k].z;
          const s2 = dx * dx + dz * dz;

          // Mask the singular region instead of softening the field.
          if (s2 < 0.36) {
            return false;
          }

          vx += dz / s2;
          vz -= dx / s2;
        }

        out.set(vx, 0, vz);
        return true;
      }

      const scene = new T.Scene();
      scene.background = new T.Color(0x000000);

      const body = new T.Group();
      scene.add(body);

      const camera = new T.PerspectiveCamera(
        43,
        1,
        0.035,
        450
      );

      camera.position.set(48, 32, 58);
      camera.lookAt(0, 0, 0);

      const renderer = new T.WebGLRenderer({
        antialias: false,
        alpha: false,
        powerPreference: "high-performance"
      });

      renderer.outputEncoding = T.LinearEncoding;
      renderer.toneMapping = T.NoToneMapping;
      renderer.setClearColor(0x000000, 1);

      renderer.domElement.setAttribute(
        "aria-label",
        "Interactive rotating condensate. Drag to orbit, " +
        "scroll to zoom, R to resume the drone."
      );

      renderer.domElement.tabIndex = 0;
      host.appendChild(renderer.domElement);

      const labels = new T.CSS2DRenderer();
      labels.domElement.id = "label-layer";
      host.appendChild(labels.domElement);

      /*
       * Linear scene rendering, bloom, ACES tone mapping,
       * sRGB conversion, then FXAA.
       */

      const hdr =
        renderer.capabilities.isWebGL2 &&
        !!renderer.extensions.get("EXT_color_buffer_float");

      const target = new T.WebGLRenderTarget(1, 1, {
        type: hdr ? T.HalfFloatType : T.UnsignedByteType,
        format: T.RGBAFormat,
        minFilter: T.LinearFilter,
        magFilter: T.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false
      });

      const composer = new T.EffectComposer(
        renderer,
        target
      );

      composer.addPass(
        new T.RenderPass(scene, camera)
      );

      const bloom = new T.UnrealBloomPass(
        new T.Vector2(1, 1),
        0.66,
        0.42,
        hdr ? 0.88 : 0.58
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

      const finish = new T.ShaderPass({
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
          "  vec3 c=aces(texture2D(tDiffuse,vUv).rgb*1.10);",
          "  float vignette=1.0-0.19*smoothstep(",
          "    0.25,0.78,length(vUv-0.5)",
          "  );",
          "  gl_FragColor=vec4(srgb(c)*vignette,1.0);",
          "}"
        ].join("\n")
      });

      composer.addPass(finish);

      const fxaa = new T.ShaderPass(T.FXAAShader);
      composer.addPass(fxaa);

      const lineMaterial = (color, opacity = 0.4) =>
        new T.LineBasicMaterial({
          color,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: T.AdditiveBlending
        });

      function lines(
        parent,
        positions,
        color,
        opacity = 0.4,
        vertexColors = null
      ) {
        const geometry = new T.BufferGeometry();

        geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(positions, 3)
        );

        const material = lineMaterial(color, opacity);

        if (vertexColors) {
          geometry.setAttribute(
            "color",
            new T.Float32BufferAttribute(vertexColors, 3)
          );

          material.vertexColors = true;
          material.color.setRGB(1, 1, 1);
        }

        const object = new T.LineSegments(
          geometry,
          material
        );

        parent.add(object);
        return object;
      }

      function ring(
        parent,
        radius,
        y,
        color,
        opacity = 0.4,
        cx = 0,
        cz = 0,
        count = 128
      ) {
        const p = [];

        for (let i = 0; i < count; i++) {
          const a = i / count * TAU;
          const b = (i + 1) / count * TAU;

          p.push(
            cx + radius * Math.cos(a),
            y,
            cz - radius * Math.sin(a),

            cx + radius * Math.cos(b),
            y,
            cz - radius * Math.sin(b)
          );
        }

        return lines(parent, p, color, opacity);
      }

      function arrow(
        list,
        x,
        y,
        z,
        dx,
        dz,
        length
      ) {
        const magnitude = Math.hypot(dx, dz);

        if (magnitude < 1e-6) {
          return;
        }

        dx /= magnitude;
        dz /= magnitude;

        const ex = x + dx * length;
        const ez = z + dz * length;
        const back = length * 0.32;
        const side = length * 0.19;

        list.push(
          x, y, z,
          ex, y, ez,

          ex, y, ez,
          ex - dx * back - dz * side,
          y,
          ez - dz * back + dx * side,

          ex, y, ez,
          ex - dx * back + dz * side,
          y,
          ez - dz * back - dx * side
        );
      }

      const pointMaterials = [];

      function points(
        parent,
        positions,
        tint,
        sizes,
        opacity = 1
      ) {
        const geometry = new T.BufferGeometry();

        geometry.setAttribute(
          "position",
          new T.Float32BufferAttribute(positions, 3)
        );

        geometry.setAttribute(
          "color",
          new T.Float32BufferAttribute(tint, 3)
        );

        geometry.setAttribute(
          "aSize",
          new T.Float32BufferAttribute(sizes, 1)
        );

        const material = new T.ShaderMaterial({
          uniforms: {
            uScale: { value: 1 },
            uOpacity: { value: opacity }
          },

          vertexShader: [
            "attribute float aSize;",
            "varying vec3 vColor;",
            "varying float vDepth;",
            "uniform float uScale;",

            "void main(){",
            "  vec4 p=modelViewMatrix*vec4(position,1.0);",
            "  vColor=color;",
            "  vDepth=-p.z;",
            "  gl_PointSize=clamp(",
            "    aSize*uScale/max(0.25,-p.z),1.0,34.0",
            "  );",
            "  gl_Position=projectionMatrix*p;",
            "}"
          ].join("\n"),

          fragmentShader: [
            "varying vec3 vColor;",
            "varying float vDepth;",
            "uniform float uOpacity;",

            "void main(){",
            "  vec2 p=gl_PointCoord*2.0-1.0;",
            "  float r2=dot(p,p);",
            "  if(r2>1.0) discard;",

            "  float glow=exp(-4.8*r2)*",
            "    (1.0-smoothstep(0.65,1.0,r2));",

            "  float nearFade=smoothstep(0.08,0.75,vDepth);",
            "  float farFade=exp(-0.0023*max(vDepth-30.0,0.0));",

            "  gl_FragColor=vec4(",
            "    vColor,",
            "    glow*uOpacity*nearFade*farFade",
            "  );",
            "}"
          ].join("\n"),

          vertexColors: true,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending
        });

        pointMaterials.push(material);

        const object = new T.Points(
          geometry,
          material
        );

        parent.add(object);
        return object;
      }

      const sample = {};
      const tint = new T.Color();

      const cloudP = [];
      const cloudC = [];
      const cloudS = [];

      /*
       * Rejection sampling makes sample concentration follow n.
       * These samples remain fixed in rotating coordinates.
       * Separate markers visualize the velocity field.
       */

      for (
        let attempts = 0;
        cloudS.length < 22000 && attempts < 650000;
        attempts++
      ) {
        const x = (random() * 2 - 1) * R;
        const y = (random() * 2 - 1) * Z;
        const z = (random() * 2 - 1) * R;

        if (
          (x * x + z * z) / (R * R) +
          y * y / (Z * Z) >= 1
        ) {
          continue;
        }

        field(x, y, z, sample);

        if (random() > sample.n) {
          continue;
        }

        phaseColor(sample.phase, tint)
          .multiplyScalar(1.2 + random() * 0.5);

        cloudP.push(x, y, z);
        cloudC.push(tint.r, tint.g, tint.b);
        cloudS.push(0.055 + random() * 0.07);
      }

      const cloud = points(
        body,
        cloudP,
        cloudC,
        cloudS,
        0.73
      );

      /*
       * Precompute the cross-section once.
       * No 37-core phase sum is needed per screen fragment.
       *
       * Increasing texture V maps toward decreasing world Z
       * after rotating PlaneGeometry by -pi/2 about X.
       */

      const TEX = 256;
      const pixels = new Uint8Array(TEX * TEX * 4);

      for (let j = 0; j < TEX; j++) {
        for (let i = 0; i < TEX; i++) {
          field(
            R * (2 * (i + 0.5) / TEX - 1),
            0,
            R * (1 - 2 * (j + 0.5) / TEX),
            sample
          );

          phaseColor(sample.phase, tint);

          const k = 4 * (j * TEX + i);

          pixels[k] = Math.round(tint.r * 255);
          pixels[k + 1] = Math.round(tint.g * 255);
          pixels[k + 2] = Math.round(tint.b * 255);
          pixels[k + 3] = Math.round(sample.n * 255);
        }
      }

      const densityMap = new T.DataTexture(
        pixels,
        TEX,
        TEX,
        T.RGBAFormat
      );

      densityMap.minFilter = T.LinearFilter;
      densityMap.magFilter = T.LinearFilter;
      densityMap.generateMipmaps = false;
      densityMap.flipY = false;
      densityMap.needsUpdate = true;

      const sliceMaterial = new T.ShaderMaterial({
        uniforms: {
          uMap: { value: densityMap },
          uOpacity: { value: 0.16 }
        },

        vertexShader: [
          "varying vec2 vUv;",
          "void main(){",
          "  vUv=uv;",
          "  gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);",
          "}"
        ].join("\n"),

        fragmentShader: [
          "uniform sampler2D uMap;",
          "uniform float uOpacity;",
          "varying vec2 vUv;",

          "void main(){",
          "  vec4 d=texture2D(uMap,vUv);",
          "  if(d.a<0.005) discard;",
          "  gl_FragColor=vec4(d.rgb*1.25,d.a*uOpacity);",
          "}"
        ].join("\n"),

        side: T.DoubleSide,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const slice = new T.Mesh(
        new T.PlaneGeometry(2 * R, 2 * R),
        sliceMaterial
      );

      slice.rotation.x = -Math.PI / 2;
      body.add(slice);

      /*
       * Sparse envelope guides.
       * The actual density approaches zero at this surface.
       */

      const shellP = [];

      for (
        let latitude = -3;
        latitude <= 3;
        latitude++
      ) {
        const a = latitude * Math.PI / 9;
        const y = Z * Math.sin(a);
        const rr = R * Math.cos(a);

        for (let k = 0; k < 144; k++) {
          const p = k / 144 * TAU;
          const q = (k + 1) / 144 * TAU;

          shellP.push(
            rr * Math.cos(p),
            y,
            -rr * Math.sin(p),

            rr * Math.cos(q),
            y,
            -rr * Math.sin(q)
          );
        }
      }

      for (
        let meridian = 0;
        meridian < 12;
        meridian++
      ) {
        const a = meridian / 12 * TAU;

        for (let k = 0; k < 96; k++) {
          const p = -Math.PI / 2 + k / 96 * Math.PI;
          const q = -Math.PI / 2 + (k + 1) / 96 * Math.PI;

          shellP.push(
            R * Math.cos(p) * Math.cos(a),
            Z * Math.sin(p),
            -R * Math.cos(p) * Math.sin(a),

            R * Math.cos(q) * Math.cos(a),
            Z * Math.sin(q),
            -R * Math.cos(q) * Math.sin(a)
          );
        }
      }

      lines(body, shellP, colors.cyan, 0.09);

      const axesP = [];
      const circulationP = [];
      const circulationC = [];
      const bondsP = [];

      cores.forEach((c, index) => {
        axesP.push(
          c.x, -c.h, c.z,
          c.x, c.h, c.z
        );

        [-0.58, 0, 0.58].forEach(level => {
          const y = c.h * level;
          const radius = 1.4;

          for (let k = 0; k < 80; k++) {
            for (let end = 0; end < 2; end++) {
              const a = (k + end) / 80 * TAU;

              const x =
                c.x + radius * Math.cos(a);

              const z =
                c.z - radius * Math.sin(a);

              field(x, y, z, sample);
              phaseColor(sample.phase, tint);

              circulationP.push(x, y, z);

              circulationC.push(
                tint.r,
                tint.g,
                tint.b
              );
            }
          }
        });

        for (
          let j = index + 1;
          j < cores.length;
          j++
        ) {
          const distance = Math.hypot(
            c.x - cores[j].x,
            c.z - cores[j].z
          );

          if (Math.abs(distance - SPACING) < 0.01) {
            bondsP.push(
              c.x, 0.015, c.z,
              cores[j].x, 0.015, cores[j].z
            );
          }
        }
      });

      lines(body, axesP, colors.blue, 0.34);

      lines(
        body,
        circulationP,
        colors.cyan,
        0.35,
        circulationC
      );

      const bonds = lines(
        body,
        bondsP,
        colors.blue,
        0.15
      );

      lines(
        body,
        [0, -Z, 0, 0, Z, 0],
        colors.gold,
        0.68
      );

      ring(
        body,
        2.3,
        0.10,
        colors.gold,
        0.9
      );

      const loopArrows = [];

      [0.3, 2.4, 4.5].forEach(a => {
        arrow(
          loopArrows,
          2.3 * Math.cos(a),
          0.11,
          -2.3 * Math.sin(a),
          -Math.sin(a),
          -Math.cos(a),
          0.42
        );
      });

      lines(
        body,
        loopArrows,
        colors.gold,
        0.85
      );

      const rulerP = [
        0, 0.14, 0,
        1, 0.14, 0,

        0, 0.14, -0.18,
        0, 0.14, 0.18,

        1, 0.14, -0.18,
        1, 0.14, 0.18
      ];

      lines(body, rulerP, colors.gold, 0.95);

      /*
       * This raised chart shows the individual factor f²(s).
       * It does not claim to show the complete density.
       */

      const coreChart = new T.Group();
      coreChart.position.set(2.9, -0.4, 2.2);
      body.add(coreChart);

      const curveP = [];

      for (let k = 0; k < 90; k++) {
        const a = -3 + 6 * k / 90;
        const b = -3 + 6 * (k + 1) / 90;

        curveP.push(
          a * 0.72,
          1.7 * a * a / (1 + a * a),
          0,

          b * 0.72,
          1.7 * b * b / (1 + b * b),
          0
        );
      }

      lines(
        coreChart,
        [
          -2.2, 0, 0,
          2.2, 0, 0,

          -2.2, 0, 0,
          -2.2, 1.8, 0
        ],
        colors.dim,
        0.8
      );

      lines(
        coreChart,
        curveP,
        colors.gold,
        0.8
      );

      const flowP = [];
      const flowV = V();

      for (let x = -18; x <= 18; x += 2.4) {
        for (let z = -18; z <= 18; z += 2.4) {
          field(x, 0, z, sample);

          if (
            sample.n < 0.06 ||
            sample.nearest2 < 1.15 ||
            !velocity(x, z, flowV)
          ) {
            continue;
          }

          arrow(
            flowP,
            x,
            0.3,
            z,
            flowV.x,
            flowV.z,
            0.7
          );
        }
      }

      const flowArrows = lines(
        body,
        flowP,
        colors.cyan,
        0.15
      );

      ring(
        scene,
        25,
        -13.6,
        colors.violet,
        0.22
      );

      const rotationP = [];

      [0, TAU / 3, 2 * TAU / 3].forEach(a => {
        arrow(
          rotationP,
          25 * Math.cos(a),
          -13.6,
          -25 * Math.sin(a),
          -Math.sin(a),
          -Math.cos(a),
          1.4
        );
      });

      lines(
        scene,
        rotationP,
        colors.violet,
        0.4
      );

      /*
       * Moving flow markers.
       *
       * In rotating coordinates q:
       *
       * dq/dtau = v(q) - Omega (y-hat cross q)
       *
       * Rotating the group then recovers the laboratory
       * velocity, without adding rigid rotation twice.
       */

      const tracerCount = 300;
      const trailLength = 7;

      const tracerPositions = new Float32Array(
        tracerCount * 3
      );

      const tracerColors = new Float32Array(
        tracerCount * 3
      );

      const tracerSizes = new Float32Array(
        tracerCount
      ).fill(0.13);

      const history = new Float32Array(
        tracerCount * trailLength * 3
      );

      const trailPositions = new Float32Array(
        tracerCount * (trailLength - 1) * 6
      );

      const trailColors = new Float32Array(
        trailPositions.length
      );

      const tracerPoints = points(
        body,
        tracerPositions,
        tracerColors,
        tracerSizes,
        1
      );

      const tracerPositionAttribute =
        tracerPoints.geometry.getAttribute("position");

      const tracerColorAttribute =
        tracerPoints.geometry.getAttribute("color");

      tracerPositionAttribute.setUsage(
        T.DynamicDrawUsage
      );

      tracerColorAttribute.setUsage(
        T.DynamicDrawUsage
      );

      tracerPoints.frustumCulled = false;

      const trails = lines(
        body,
        trailPositions,
        colors.cyan,
        0.43,
        trailColors
      );

      const trailPositionAttribute =
        trails.geometry.getAttribute("position");

      const trailColorAttribute =
        trails.geometry.getAttribute("color");

      trailPositionAttribute.setUsage(
        T.DynamicDrawUsage
      );

      trailColorAttribute.setUsage(
        T.DynamicDrawUsage
      );

      trails.frustumCulled = false;

      const v1 = V();
      const v2 = V();

      function seedTracer(index) {
        let x;
        let y;
        let z;

        do {
          x = (random() * 2 - 1) * 19;
          y = (random() * 2 - 1) * 7;
          z = (random() * 2 - 1) * 19;

          field(x, y, z, sample);
        } while (
          sample.n < 0.075 ||
          sample.nearest2 < 0.9
        );

        const k = index * 3;

        tracerPositions[k] = x;
        tracerPositions[k + 1] = y;
        tracerPositions[k + 2] = z;

        for (let h = 0; h < trailLength; h++) {
          const q = (index * trailLength + h) * 3;

          history[q] = x;
          history[q + 1] = y;
          history[q + 2] = z;
        }
      }

      for (let i = 0; i < tracerCount; i++) {
        seedTracer(i);
      }

      let historyClock = 0;

      function updateTracers(dt) {
        historyClock += dt;

        const saveHistory = historyClock >= 0.07;

        if (saveHistory) {
          historyClock %= 0.07;
        }

        for (let i = 0; i < tracerCount; i++) {
          const k = i * 3;
          const base = i * trailLength * 3;

          let x = tracerPositions[k];
          let y = tracerPositions[k + 1];
          let z = tracerPositions[k + 2];

          if (dt > 0) {
            let valid = velocity(x, z, v1);

            if (valid) {
              v1.x -= OMEGA * z;
              v1.z += OMEGA * x;

              const mx = x + v1.x * dt * 0.5;
              const mz = z + v1.z * dt * 0.5;

              valid = velocity(mx, mz, v2);

              if (valid) {
                v2.x -= OMEGA * mz;
                v2.z += OMEGA * mx;

                x += v2.x * dt;
                z += v2.z * dt;

                field(x, y, z, sample);

                valid =
                  sample.n > 0.045 &&
                  sample.nearest2 > 0.49;
              }
            }

            if (!valid) {
              seedTracer(i);

              x = tracerPositions[k];
              y = tracerPositions[k + 1];
              z = tracerPositions[k + 2];
            } else {
              tracerPositions[k] = x;
              tracerPositions[k + 2] = z;

              if (saveHistory) {
                for (
                  let h = trailLength - 1;
                  h > 0;
                  h--
                ) {
                  const q = base + h * 3;
                  const previous = q - 3;

                  history[q] = history[previous];
                  history[q + 1] = history[previous + 1];
                  history[q + 2] = history[previous + 2];
                }
              }

              history[base] = x;
              history[base + 1] = y;
              history[base + 2] = z;
            }
          }

          field(x, y, z, sample);

          phaseColor(sample.phase, tint)
            .multiplyScalar(1.8);

          tracerColors[k] = tint.r;
          tracerColors[k + 1] = tint.g;
          tracerColors[k + 2] = tint.b;

          for (
            let h = 0;
            h < trailLength - 1;
            h++
          ) {
            const q =
              (i * (trailLength - 1) + h) * 6;

            const a = base + h * 3;
            const b = a + 3;

            for (let c = 0; c < 3; c++) {
              trailPositions[q + c] =
                history[a + c];

              trailPositions[q + c + 3] =
                history[b + c];

              trailColors[q + c] =
                tracerColors[k + c] *
                (1 - h / trailLength);

              trailColors[q + c + 3] =
                tracerColors[k + c] *
                (1 - (h + 1) / trailLength);
            }
          }
        }

        tracerPositionAttribute.array.set(
          tracerPositions
        );

        tracerColorAttribute.array.set(
          tracerColors
        );

        trailPositionAttribute.array.set(
          trailPositions
        );

        trailColorAttribute.array.set(
          trailColors
        );

        tracerPositionAttribute.needsUpdate = true;
        tracerColorAttribute.needsUpdate = true;
        trailPositionAttribute.needsUpdate = true;
        trailColorAttribute.needsUpdate = true;
      }

      updateTracers(0);

      const names = [];

      function addName(
        parent,
        position,
        label,
        kind = "muted",
        stages = []
      ) {
        const element = document.createElement("div");
        element.className = "world-anchor";

        const child = document.createElement("span");

        child.className =
          "world-name world-name--" + kind;

        child.textContent = label;
        child.style.transform = "translate(10px,-50%)";

        element.appendChild(child);

        const object = new T.CSS2DObject(element);
        object.position.copy(position);
        parent.add(object);

        names.push({
          object,
          element,
          stages,
          world: V(),
          screen: V()
        });

        return object;
      }

      addName(
        body,
        V(0, 10.7, 0),
        "V" +
          String(selectedIndex + 1).padStart(2, "0") +
          " / depleted core axis",
        "gold",
        [2, 3, 4]
      );

      addName(
        body,
        V(0.5, 0.22, 0),
        "ξ₀",
        "gold",
        [3, 4]
      );

      addName(
        coreChart,
        V(0, 2, 0),
        "Single-core factor f²(s)",
        "gold",
        [3]
      );

      addName(
        body,
        V(2.3, 0.18, 0),
        "C / Γ = +κ",
        "gold",
        [4]
      );

      addName(
        body,
        V(8, 0.5, 5),
        "Flow direction / equal-length arrows",
        "cyan",
        [5]
      );

      addName(
        scene,
        V(-18, -13.6, 19),
        "+y rotation / Ωτ₀ = 0.1008",
        "muted",
        [0, 7, 9]
      );

      const probe = new T.Mesh(
        new T.OctahedronGeometry(0.17, 0),

        new T.MeshBasicMaterial({
          color: colors.cyan.clone().multiplyScalar(2),
          wireframe: true,
          depthTest: false,
          transparent: true,
          opacity: 0.95
        })
      );

      probe.renderOrder = 10;
      body.add(probe);

      addName(
        probe,
        V(0, 0.35, 0),
        "FIELD PROBE",
        "cyan"
      );

      /*
       * Five schematic reference exhibits.
       * These sit outside the condensate and are not
       * microscopic objects forming the vortex tubes.
       */

      const gallery = new T.Group();
      scene.add(gallery);

      const exhibits = [];

      const exhibitTitles = [
        "01 / Bosonic atom · schematic",
        "02 / Order parameter · complex plane",
        "03 / External potential · schematic",
        "04 / Contact interaction · schematic",
        "05 / Rotating coordinates · reference"
      ];

      const exhibitColors = [
        colors.blue,
        colors.violet,
        colors.cyan,
        colors.magenta,
        colors.gold
      ];

      for (let i = 0; i < 5; i++) {
        const group = new T.Group();

        group.position.set(
          37 + 7.5 * i,
          -1,
          -10 + 3 * i
        );

        gallery.add(group);

        ring(
          group,
          2.65,
          -2.25,
          exhibitColors[i],
          0.32
        );

        lines(
          group,
          [
            -2.65, -2.25, 0,
            2.65, -2.25, 0,

            0, -2.25, -2.65,
            0, -2.25, 2.65
          ],
          exhibitColors[i],
          0.12
        );

        addName(
          group,
          V(-2.1, -2.7, 0),
          exhibitTitles[i],
          "muted",
          [8]
        );

        exhibits.push(group);
      }

      const sharedSphere = new T.SphereGeometry(
        0.62,
        24,
        16
      );

      function sphere(
        parent,
        x,
        y,
        z,
        color,
        scale = 1
      ) {
        const mesh = new T.Mesh(
          sharedSphere,

          new T.MeshBasicMaterial({
            color: color.clone().multiplyScalar(0.55),
            transparent: true,
            opacity: 0.7,
            depthWrite: false
          })
        );

        mesh.position.set(x, y, z);
        mesh.scale.setScalar(scale);

        parent.add(mesh);
        return mesh;
      }

      sphere(
        exhibits[0],
        0,
        0,
        0,
        colors.blue,
        1.2
      );

      const atomShell = new T.Mesh(
        new T.IcosahedronGeometry(1.06, 1),

        new T.MeshBasicMaterial({
          color: colors.blue,
          wireframe: true,
          transparent: true,
          opacity: 0.32,
          depthWrite: false
        })
      );

      exhibits[0].add(atomShell);

      const atomGlowP = [];
      const atomGlowC = [];
      const atomGlowS = [];

      for (let i = 0; i < 130; i++) {
        const a = random() * TAU;
        const yy = random() * 2 - 1;
        const r = 0.95 * Math.sqrt(1 - yy * yy);

        atomGlowP.push(
          r * Math.cos(a),
          yy * 0.95,
          r * Math.sin(a)
        );

        atomGlowC.push(
          colors.blue.r,
          colors.blue.g,
          colors.blue.b
        );

        atomGlowS.push(0.06);
      }

      points(
        exhibits[0],
        atomGlowP,
        atomGlowC,
        atomGlowS,
        0.6
      );

      const complexP = [];

      for (let i = 0; i < 96; i++) {
        const a = i / 96 * TAU;
        const b = (i + 1) / 96 * TAU;

        complexP.push(
          1.7 * Math.cos(a),
          1.7 * Math.sin(a),
          0,

          1.7 * Math.cos(b),
          1.7 * Math.sin(b),
          0
        );
      }

      lines(
        exhibits[1],
        complexP,
        colors.violet,
        0.25
      );

      lines(
        exhibits[1],
        [
          -2, 0, 0,
          2, 0, 0,

          0, -2, 0,
          0, 2, 0
        ],
        colors.violet,
        0.55
      );

      const phasor = lines(
        exhibits[1],
        new Float32Array(6),
        colors.cyan,
        0.9
      );

      phasor.geometry
        .getAttribute("position")
        .setUsage(T.DynamicDrawUsage);

      phasor.frustumCulled = false;

      const phasorDot = sphere(
        exhibits[1],
        0,
        0,
        0,
        colors.cyan,
        0.16
      );

      addName(
        exhibits[1],
        V(2.05, 0, 0),
        "Re Ψ",
        "muted",
        [8]
      );

      addName(
        exhibits[1],
        V(0, 2.05, 0),
        "Im Ψ",
        "muted",
        [8]
      );

      const bowlP = [];

      for (
        let radius = 0.4;
        radius <= 2.41;
        radius += 0.4
      ) {
        for (let i = 0; i < 80; i++) {
          const a = i / 80 * TAU;
          const b = (i + 1) / 80 * TAU;
          const height = 0.36 * radius * radius - 1.4;

          bowlP.push(
            radius * Math.cos(a),
            height,
            radius * Math.sin(a),

            radius * Math.cos(b),
            height,
            radius * Math.sin(b)
          );
        }
      }

      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU;

        for (let j = 0; j < 30; j++) {
          const r1 = 2.4 * j / 30;
          const r2 = 2.4 * (j + 1) / 30;

          bowlP.push(
            r1 * Math.cos(a),
            0.36 * r1 * r1 - 1.4,
            r1 * Math.sin(a),

            r2 * Math.cos(a),
            0.36 * r2 * r2 - 1.4,
            r2 * Math.sin(a)
          );
        }
      }

      lines(
        exhibits[2],
        bowlP,
        colors.cyan,
        0.5
      );

      lines(
        exhibits[2],
        [
          -3, -1.4, 0,
          3, -1.4, 0,

          0, -1.4, -3,
          0, -1.4, 3
        ],
        colors.magenta,
        0.32
      );

      addName(
        exhibits[2],
        V(1.7, 1, 0),
        "Height ∝ Vext · guide surface",
        "cyan",
        [8]
      );

      sphere(
        exhibits[3],
        -1.1,
        0,
        0,
        colors.magenta,
        0.82
      );

      sphere(
        exhibits[3],
        1.1,
        0,
        0,
        colors.magenta,
        0.82
      );

      const contactP = [];

      for (let i = 0; i < 9; i++) {
        const x = -0.58 + i * 0.14;

        contactP.push(
          x, 0, 0,
          x + 0.06, 0, 0
        );
      }

      lines(
        exhibits[3],
        contactP,
        colors.magenta,
        0.7
      );

      lines(
        exhibits[3],
        [
          -1.1, 0.8, 0,
          -1.1, 1.1, 0,

          -1.1, 1.1, 0,
          1.1, 1.1, 0,

          1.1, 1.1, 0,
          1.1, 0.8, 0
        ],
        colors.magenta,
        0.6
      );

      addName(
        exhibits[3],
        V(-0.2, 1.45, 0),
        "g > 0 · repulsive reference",
        "muted",
        [8]
      );

      lines(
        exhibits[4],
        [
          -2.2, 0, 0,
          2.2, 0, 0,

          0, -1.8, 0,
          0, 2.2, 0,

          0, 0, -2.2,
          0, 0, 2.2
        ],
        colors.dim,
        0.7
      );

      const rotatingFrame = new T.Group();
      exhibits[4].add(rotatingFrame);

      lines(
        rotatingFrame,
        [
          0, 0, 0,
          2, 0, 0,

          0, 0, 0,
          0, 2, 0,

          0, 0, 0,
          0, 0, 2
        ],
        colors.gold,
        0.9
      );

      ring(
        exhibits[4],
        1.8,
        0,
        colors.gold,
        0.5
      );

      addName(
        exhibits[4],
        V(0, 2.35, 0),
        "+y / rotation axis",
        "gold",
        [8]
      );

      const referenceTrack = [];

      for (let i = 0; i < exhibits.length - 1; i++) {
        const a = exhibits[i].position;
        const b = exhibits[i + 1].position;

        referenceTrack.push(
          a.x, -4.3, a.z,
          b.x, -4.3, b.z
        );
      }

      lines(
        scene,
        referenceTrack,
        colors.dim,
        0.25
      );

      const chapters = [
        [
          "bulk",
          0,
          "BULK ROTATION",
          "Rotation, carried by quantized circulation.",
          "A prescribed rotating condensate: 37 singly " +
          "quantized vortices share one macroscopic order parameter."
        ],
        [
          "approach",
          55,
          "LATTICE APPROACH",
          "Order emerges across the transverse plane.",
          "A finite triangular patch makes the many-vortex " +
          "structure visible. Its connecting lines mark geometry, not bonds."
        ],
        [
          "descent",
          110,
          "VORTEX DESCENT",
          "Follow an axis through depleted density.",
          "The slender bright line is an axis guide. " +
          "The fluid density falls toward zero around it."
        ],
        [
          "core",
          165,
          "CORE DENSITY PROFILE",
          "One healing length sets the reference scale.",
          "The gold ruler spans ξ₀. At that radius the individual " +
          "core factor is one half; the complete density also includes " +
          "the envelope and neighboring cores."
        ],
        [
          "phase",
          220,
          "PHASE WINDING",
          "A closed path carries one quantum of circulation.",
          "The gold contour encloses one vortex. Phase winds by " +
          "2π and circulation is +h/m about the +y axis."
        ],
        [
          "flow",
          275,
          "SUPERFLUID FLOW",
          "Every vortex contributes to the local velocity.",
          "Moving markers follow the summed phase gradient in a " +
          "rescaled visual time. Equal-length arrows show direction; " +
          "markers are not tagged atoms."
        ],
        [
          "lattice",
          330,
          "MANY-VORTEX ORDER",
          "Individual circulation becomes collective structure.",
          "The triangular array is prescribed. This visualization " +
          "shows its geometry and flow, rather than simulating " +
          "how a lattice forms."
        ],
        [
          "rotation",
          385,
          "LATTICE SCALE & ROTATION",
          "Circulation density sets a bulk rotation scale.",
          "The lattice spacing and Ω obey the bulk Feynman relation. " +
          "The finite edge and boundary flow are not solved self-consistently."
        ],
        [
          "gallery",
          440,
          "FIELD INSPECTION",
          "Five references, outside the condensate.",
          "Separate schematic exhibits connect the visible field " +
          "with atoms, a complex order parameter, trapping, " +
          "interactions, and rotating coordinates."
        ],
        [
          "return",
          555,
          "FINAL OVERVIEW",
          "One field. Thirty-seven circulation centers.",
          "The tour returns to its opening viewpoint while the " +
          "rotating field continues. Drag at any time to inspect."
        ]
      ];

      /*
       * Presentation times are wall-clock seconds.
       * No experimental duration is implied.
       *
       * Key format:
       * time, eye, target, FOV, body-relative weight, probe
       *
       * All endpoint body weights are either zero or one.
       */

      const keys = [
        [0, [48, 32, 58], [0, 0, 0], 43, 0, [7, 2, 3]],
        [28, [35, 39, 47], [0, 0, 0], 43, 0, [7, 2, 3]],
        [55, [25, 29, 35], [2, 0, 0], 45, 0, [7, 1, 3]],
        [85, [13, 22, 19], [1, 0, 0], 47, 1, [3, 1, 1.5]],
        [110, [4, 15, 7], [0, 5, 0], 49, 1, [1.6, 7, 0.5]],
        [140, [3.7, 3.5, 5], [0, -2, 0], 50, 1, [1.6, 1, 0.5]],
        [165, [4, -3, 5], [0, 0, 0], 48, 1, [1, -1, 0]],
        [190, [4.7, 5, 5.5], [0.6, 0, 0], 46, 1, [1, 0, 0]],
        [220, [5.5, 5.5, 6], [0, 0, 0], 47, 1, [2.3, 0, 0]],
        [238, [-5.5, 5.5, 6], [0, 0, 0], 47, 1, [0, 0, -2.3]],
        [256, [-5.5, 5.5, -6], [0, 0, 0], 47, 1, [-2.3, 0, 0]],
        [275, [6.5, 6, -6], [2, 0, -1], 49, 1, [0, 0, 2.3]],
        [303, [10, 4, 4], [5, 0, 1], 51, 1, [7, 0, 2]],
        [330, [9, 10, 14], [3, 0, 0], 49, 1, [8, 2, 2]],
        [357, [17, 14, 13], [3, 0, 0], 47, 1, [10, 1, 3]],
        [385, [29, 23, 31], [0, 0, 0], 45, 1, [12, 2, 4]],
        [412, [40, 26, 32], [6, 0, 0], 45, 0, [14, 1, 4]],
        [440, [40, 5, 2], [37, -1, -10], 42, 0, [8, 0, 3]],
        [458, [38.5, 2, -1], [37, -1, -10], 40, 0, [8, 0, 3]],
        [463, [46, 3, 2], [44.5, -1, -7], 42, 0, [2.3, 0, 0]],
        [481, [46, 2, 1], [44.5, -1, -7], 40, 0, [1, 0, 0]],
        [486, [54, 4, 6], [52, -1, -4], 43, 0, [8, 1, 3]],
        [504, [54, 3, 5], [52, -1, -4], 41, 0, [8, 1, 3]],
        [509, [61, 3, 9], [59.5, -1, -1], 42, 0, [8, 1, 3]],
        [527, [61, 2, 8], [59.5, -1, -1], 40, 0, [8, 1, 3]],
        [532, [69, 4, 12], [67, -1, 2], 43, 0, [8, 1, 3]],
        [555, [73, 8, 18], [67, -1, 2], 44, 0, [8, 1, 3]],
        [578, [65, 31, 52], [10, 0, 0], 44, 0, [7, 2, 3]],
        [600, [48, 32, 58], [0, 0, 0], 43, 0, [7, 2, 3]]
      ].map(k => ({
        t: k[0],
        p: V().fromArray(k[1]),
        aim: V().fromArray(k[2]),
        fov: k[3],
        body: k[4],
        probe: V().fromArray(k[5])
      }));

      const desired = {
        position: V(),
        target: V(),
        quaternion: new T.Quaternion(),
        probe: V(),
        fov: 43,
        focus: 30
      };

      const lookMatrix = new T.Matrix4();
      const up = V(0, 1, 0);
      const forward = V();
      const focusTarget = V();
      const manualProbe = V();

      let focusDistance = 50;

      function rotateBody(vector, angle = state.angle) {
        const x = vector.x;
        const z = vector.z;
        const c = Math.cos(angle);
        const s = Math.sin(angle);

        vector.x = c * x + s * z;
        vector.z = -s * x + c * z;

        return vector;
      }

      function evaluateTour() {
        let index = 0;

        while (
          index < keys.length - 2 &&
          state.tour >= keys[index + 1].t
        ) {
          index++;
        }

        const a = keys[index];
        const b = keys[index + 1];

        const t = ease(
          clamp(
            (state.tour - a.t) / (b.t - a.t),
            0,
            1
          )
        );

        desired.position.copy(a.p).lerp(b.p, t);
        desired.target.copy(a.aim).lerp(b.aim, t);

        const weight = mix(a.body, b.body, t);

        /*
         * Choose a continuous angle branch for transitions
         * between world and rotating-body coordinates.
         *
         * Rotation preserves the camera's radius.
         * Blending rotated positions could contract it.
         */

        let yaw = state.angle;

        if (a.body !== b.body) {
          const midpointTime =
            state.time +
            TIME_RATE * (
              (a.t + b.t) * 0.5 - state.tour
            );

          yaw =
            OMEGA * state.time -
            TAU * Math.round(
              OMEGA * midpointTime / TAU
            );
        }

        rotateBody(
          desired.position,
          yaw * weight
        );

        rotateBody(
          desired.target,
          yaw * weight
        );

        desired.probe.copy(a.probe).lerp(b.probe, t);
        desired.fov = mix(a.fov, b.fov, t);

        desired.focus = desired.position.distanceTo(
          desired.target
        );

        lookMatrix.lookAt(
          desired.position,
          desired.target,
          up
        );

        desired.quaternion.setFromRotationMatrix(
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

      camera.position.copy(desired.position);
      camera.quaternion.copy(desired.quaternion);
      focusDistance = desired.focus;

      /*
       * OrbitControls drives a separate camera.
       * The rendered camera follows it smoothly.
       */

      const controlCamera = camera.clone();

      const controls = new T.OrbitControls(
        controlCamera,
        renderer.domElement
      );

      controls.enabled = false;
      controls.enableDamping = true;
      controls.dampingFactor = 0.075;
      controls.rotateSpeed = 0.6;
      controls.zoomSpeed = 0.7;
      controls.panSpeed = 0.7;
      controls.minDistance = 0.65;
      controls.maxDistance = 180;
      controls.maxPolarAngle = Math.PI - 0.035;
      controls.minPolarAngle = 0.035;
      controls.screenSpacePanning = true;

      function copyToControls() {
        // Flush old damping deltas on the separate camera.
        controls.enableDamping = false;
        controls.update();

        controlCamera.position.copy(camera.position);
        controlCamera.quaternion.copy(camera.quaternion);
        controlCamera.fov = camera.fov;
        controlCamera.aspect = camera.aspect;
        controlCamera.updateProjectionMatrix();

        camera.getWorldDirection(forward);

        focusTarget
          .copy(camera.position)
          .addScaledVector(forward, focusDistance);

        controls.target.copy(focusTarget);
        controls.update();
        controls.enableDamping = true;
      }

      function enterManual(reading = false) {
        if (!state.ready || state.lost) {
          return;
        }

        if (state.mode !== "manual") {
          copyToControls();
          state.mode = "manual";
          state.returning = null;
        }

        controls.enabled = true;

        if (reading) {
          state.paused = true;
        }

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
        controls.enabled = false;

        state.returning = {
          elapsed: 0,

          duration: clamp(
            camera.position.distanceTo(desired.position) / 8,
            3,
            8
          ),

          from: camera.position.clone(),
          to: desired.position.clone(),

          qFrom: camera.quaternion.clone(),
          qTo: desired.quaternion.clone(),

          fFrom: camera.fov,
          fTo: desired.fov,

          focusFrom: focusDistance,
          focusTo: desired.focus
        };

        state.mode = "return";
        updateButtons();
      }

      function updateButtons() {
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

      function togglePause() {
        state.paused = !state.paused;
        updateButtons();
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

        updateButtons();
        layoutClock = 1;
      }

      /*
       * Capture handlers enable manual mode before
       * OrbitControls handles the same gesture.
       */

      renderer.domElement.addEventListener(
        "pointerdown",
        () => enterManual(),
        { capture: true }
      );

      renderer.domElement.addEventListener(
        "wheel",
        () => enterManual(),
        { capture: true, passive: true }
      );

      renderer.domElement.addEventListener(
        "touchstart",
        () => enterManual(),
        { capture: true, passive: true }
      );

      ui["pause-toggle"]?.addEventListener(
        "click",
        togglePause
      );

      ui["resume-flight"]?.addEventListener(
        "click",
        resumeDrone
      );

      ui["hud-toggle"]?.addEventListener(
        "click",
        toggleHUD
      );

      document
        .querySelectorAll("[data-inspection-ui]")
        .forEach(el => {
          el.addEventListener(
            "pointerdown",
            () => enterManual(true)
          );

          el.addEventListener(
            "focusin",
            () => enterManual(true)
          );

          el.addEventListener(
            "wheel",
            () => enterManual(true),
            { passive: true }
          );
        });

      document.addEventListener("keydown", event => {
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

        const target = event.target;

        if (
          target instanceof Element &&
          target.closest(
            "input,textarea,select,[contenteditable='true']"
          )
        ) {
          return;
        }

        const key = event.key.toLowerCase();

        if (event.code === "Space") {
          if (
            target instanceof Element &&
            target.closest("button,summary,a")
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
      });

      const reducedMotionChange = event => {
        if (event.matches) {
          state.paused = true;
          updateButtons();
        }
      };

      if (motionQuery.addEventListener) {
        motionQuery.addEventListener(
          "change",
          reducedMotionChange
        );
      } else {
        motionQuery.addListener(reducedMotionChange);
      }

      function updateCamera(dt) {
        if (state.mode === "manual") {
          controls.update();

          const blend = 1 - Math.exp(-12 * dt);

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
        } else if (state.mode === "return") {
          const r = state.returning;

          if (!state.paused) {
            r.elapsed += dt;
          }

          const t = clamp(
            r.elapsed / r.duration,
            0,
            1
          );

          const s = ease(t);

          camera.position
            .copy(r.from)
            .lerp(r.to, s);

          const lift = Math.min(
            4,
            r.from.distanceTo(r.to) * 0.09
          );

          camera.position.y +=
            lift * Math.pow(
              Math.sin(Math.PI * s),
              2
            );

          camera.quaternion
            .copy(r.qFrom)
            .slerp(r.qTo, s);

          camera.fov = mix(
            r.fFrom,
            r.fTo,
            s
          );

          focusDistance = mix(
            r.focusFrom,
            r.focusTo,
            s
          );

          if (t === 1) {
            state.mode = "auto";
            state.returning = null;
            updateButtons();
          }
        } else {
          const blend = 1 - Math.exp(-5 * dt);

          camera.position.lerp(
            desired.position,
            blend
          );

          camera.quaternion.slerp(
            desired.quaternion,
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

        const panelRight =
          state.hud &&
          state.width > 900 &&
          ui["sidebar-ui"]
            ? ui["sidebar-ui"]
                .getBoundingClientRect()
                .right
            : 0;

        state.shift = mix(
          state.shift,
          panelRight * 0.48,
          1 - Math.exp(-5 * dt)
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

      /*
       * DOM / MathML world cards.
       *
       * CSS2DObject owns a zero-size anchor.
       * The card has its own screen offset, leaving the
       * renderer's anchor transform untouched.
       */

      const cards = [];

      function addCard(
        templateId,
        parent,
        position,
        stages,
        color
      ) {
        const template = byId(templateId);

        if (
          !template ||
          !template.content ||
          !template.content.firstElementChild
        ) {
          throw new Error(
            "Missing annotation template: " + templateId
          );
        }

        const element = document.createElement("div");
        element.className = "world-anchor";

        const card =
          template.content.firstElementChild.cloneNode(true);

        card.removeAttribute("id");
        card.style.opacity = "1";
        card.style.pointerEvents = "none";
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
        leader.renderOrder = 20;
        leader.frustumCulled = false;

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

        cards.push({
          object,
          element,
          card,
          leader,
          stages,

          world: V(),
          projected: V(),
          end: V(),

          x: 0,
          y: 0,
          width: 310,
          height: 250,
          distance: 0,

          target: 0,
          opacity: 0,
          endX: 0,
          endY: 0
        });
      }

      addCard(
        "bulk-label-template",
        body,
        V(12, 5, 8),
        [0, 1, 9],
        colors.cyan
      );

      addCard(
        "lattice-label-template",
        body,
        V(6, 0, 0),
        [1, 6],
        colors.blue
      );

      addCard(
        "core-label-template",
        body,
        V(0, 0, 0),
        [2, 3],
        colors.gold
      );

      addCard(
        "phase-label-template",
        body,
        V(2.3, 0.1, 0),
        [4],
        colors.magenta
      );

      addCard(
        "flow-label-template",
        body,
        V(7, 0.3, 2),
        [5],
        colors.cyan
      );

      addCard(
        "rotation-label-template",
        body,
        V(-12, 1, 12),
        [7, 9],
        colors.violet
      );

      [
        "atom",
        "order",
        "trap",
        "interaction",
        "frame"
      ].forEach((id, i) => {
        addCard(
          id + "-label-template",
          exhibits[i],
          V(0, 1.3, 0),
          [8],
          exhibitColors[i]
        );
      });

      const flowCard = cards[4].card.querySelector(
        ".card-footnote"
      );

      if (flowCard) {
        flowCard.textContent +=
          " Arrow lengths are normalized. Marker time is " +
          "rescaled; the prescribed density and flow are " +
          "not a self-consistent dynamical solution.";
      }

      let layoutClock = 1;
      let reserved = [];

      function rectangle(el, pad = 10) {
        if (
          !el ||
          !el.getClientRects().length ||
          getComputedStyle(el).display === "none"
        ) {
          return null;
        }

        const r = el.getBoundingClientRect();

        return {
          x: r.left - pad,
          y: r.top - pad,
          w: r.width + 2 * pad,
          h: r.height + 2 * pad
        };
      }

      function overlaps(a, b) {
        return (
          a.x < b.x + b.w &&
          a.x + a.w > b.x &&
          a.y < b.y + b.h &&
          a.y + a.h > b.y
        );
      }

      function project(world, out) {
        out.copy(world).project(camera);

        return (
          out.z > -1 &&
          out.z < 1 &&
          Math.abs(out.x) < 1.08 &&
          Math.abs(out.y) < 1.08
        );
      }

      function placeCards() {
        reserved = [
          rectangle(ui["flight-controls"])
        ];

        if (state.hud) {
          reserved.push(
            rectangle(ui["sidebar-ui"]),
            rectangle(ui["scene-caption"]),
            rectangle(ui["reference-legend"])
          );
        }

        reserved = reserved.filter(Boolean);

        const occupied = reserved.slice();

        const subjectX =
          state.width * 0.5 + state.shift;

        occupied.push({
          x: subjectX - 85,
          y: state.height * 0.5 - 65,
          w: 170,
          h: 130
        });

        const candidates = [];

        cards.forEach((entry, index) => {
          entry.target = 0;

          entry.object.getWorldPosition(entry.world);

          entry.distance = entry.world.distanceTo(
            camera.position
          );

          if (
            !state.hud ||
            !project(entry.world, entry.projected) ||
            entry.distance > 130
          ) {
            return;
          }

          const relevant = entry.stages.includes(
            state.stage
          );

          if (
            state.mode !== "manual" &&
            !relevant
          ) {
            return;
          }

          if (
            state.mode === "manual" &&
            entry.distance > 42 &&
            !relevant
          ) {
            return;
          }

          const sx =
            (entry.projected.x * 0.5 + 0.5) *
            state.width;

          const sy =
            (0.5 - entry.projected.y * 0.5) *
            state.height;

          entry.width =
            entry.card.offsetWidth || 310;

          entry.height =
            entry.card.offsetHeight || 250;

          let priority =
            (relevant ? 60 : 0) -
            entry.distance;

          if (state.stage === 8 && index >= 6) {
            const exhibit = Math.min(
              4,
              Math.floor((state.tour - 440) / 23)
            );

            if (index === 6 + exhibit) {
              priority += 90;
            }
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
            sx,
            sy,
            priority
          });
        });

        candidates.sort(
          (a, b) => b.priority - a.priority
        );

        let count = 0;

        const maxCards =
          state.width < 1200 ? 1 : 2;

        for (const candidate of candidates) {
          if (count >= maxCards) {
            break;
          }

          const { entry, sx, sy } = candidate;

          const w = entry.width;
          const h = entry.height;

          const placements = [
            [sx + 30, sy - h * 0.5],
            [sx - w - 30, sy - h * 0.5],
            [sx + 35, sy - h - 30],
            [sx - w - 35, sy - h - 30],
            [state.width - w - 22, sy - h * 0.5],
            [sx + 30, sy + 30],
            [sx - w - 30, sy + 30]
          ];

          let chosen = null;

          for (const p of placements) {
            const box = {
              x: clamp(
                p[0],
                12,
                Math.max(12, state.width - w - 12)
              ),

              y: clamp(
                p[1],
                12,
                Math.max(12, state.height - h - 12)
              ),

              w,
              h
            };

            if (
              box.x + w > state.width - 10 ||
              box.y + h > state.height - 10
            ) {
              continue;
            }

            if (
              occupied.some(
                r => overlaps(box, r)
              )
            ) {
              continue;
            }

            chosen = box;
            break;
          }

          if (!chosen) {
            continue;
          }

          entry.x = chosen.x - sx;
          entry.y = chosen.y - sy;

          entry.card.style.transform =
            "translate(" +
            entry.x + "px," +
            entry.y + "px)";

          entry.endX =
            clamp(
              sx,
              chosen.x,
              chosen.x + w
            ) - sx;

          entry.endY =
            clamp(
              sy,
              chosen.y,
              chosen.y + h
            ) - sy;

          entry.target = 1;

          occupied.push({
            x: chosen.x - 10,
            y: chosen.y - 10,
            w: w + 20,
            h: h + 20
          });

          count++;
        }

        /*
         * Small names have their own cap and avoid
         * major HUD regions and active cards.
         */

        let nameCount = 0;

        names.forEach(entry => {
          entry.object.getWorldPosition(entry.world);

          const relevant =
            entry.stages.length === 0 ||
            entry.stages.includes(state.stage) ||
            (
              state.mode === "manual" &&
              entry.world.distanceTo(camera.position) < 18
            );

          let visible =
            state.hud &&
            relevant &&
            nameCount < 7 &&
            project(entry.world, entry.screen);

          if (visible) {
            const sx =
              (entry.screen.x * 0.5 + 0.5) *
              state.width;

            const sy =
              (0.5 - entry.screen.y * 0.5) *
              state.height;

            const span =
              entry.element.firstElementChild;

            const box = {
              x: sx + 10,
              y: sy - 13,
              w: span.offsetWidth || 170,
              h: 26
            };

            visible =
              box.x >= 8 &&
              box.x + box.w < state.width - 8 &&
              box.y >= 8 &&
              box.y + 26 < state.height - 8 &&
              !reserved.some(
                r => overlaps(box, r)
              ) &&
              !cards.some(c => {
                if (!c.target) {
                  return false;
                }

                const ax =
                  (c.projected.x * 0.5 + 0.5) *
                  state.width;

                const ay =
                  (0.5 - c.projected.y * 0.5) *
                  state.height;

                return overlaps(box, {
                  x: ax + c.x,
                  y: ay + c.y,
                  w: c.width,
                  h: c.height
                });
              });
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

      function updateCards(dt) {
        layoutClock += dt;

        if (layoutClock >= 0.15) {
          layoutClock = 0;
          placeCards();
        }

        const blend = 1 - Math.exp(-8 * dt);

        cards.forEach(entry => {
          entry.object.getWorldPosition(entry.world);

          const onScreen = project(
            entry.world,
            entry.projected
          );

          if (!state.hud || !onScreen) {
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
            entry.card.contains(document.activeElement)
          ) {
            ui["hud-toggle"]?.focus();
          }

          entry.leader.visible = visible;

          if (!visible) {
            return;
          }

          entry.leader.material.opacity =
            entry.opacity * 0.45;

          const sx =
            (entry.projected.x * 0.5 + 0.5) *
            state.width;

          const sy =
            (0.5 - entry.projected.y * 0.5) *
            state.height;

          /*
           * Keep the leader endpoint relative to the
           * current projected anchor as the camera moves.
           */

          entry.end.set(
            (sx + entry.endX) / state.width * 2 - 1,
            1 - (sy + entry.endY) / state.height * 2,
            entry.projected.z
          ).unproject(camera);

          const attribute =
            entry.leader.geometry.getAttribute("position");

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

      let hudClock = 1;
      let previousStage = -1;

      const probeValue = {};

      const stageNodes = ui["journey-stages"]
        ? Array.from(
            ui["journey-stages"].querySelectorAll(
              "[data-stage]"
            )
          )
        : [];

      if (
        !stageNodes.length &&
        ui["journey-stages"]
      ) {
        stageNodes.push(
          ...Array.from(
            ui["journey-stages"].children
          )
        );
      }

      function timeText(seconds) {
        const s = Math.floor(seconds);

        return (
          String(Math.floor(s / 60)).padStart(2, "0") +
          ":" +
          String(s % 60).padStart(2, "0")
        );
      }

      function updateProbe() {
        if (state.mode === "manual") {
          manualProbe.copy(controls.target);

          const x = manualProbe.x;
          const z = manualProbe.z;

          const c = Math.cos(state.angle);
          const s = Math.sin(state.angle);

          // Convert the laboratory orbit target to body coordinates.
          manualProbe.x = c * x - s * z;
          manualProbe.z = s * x + c * z;

          probe.position.copy(manualProbe);
        } else {
          probe.position.copy(desired.probe);
        }

        field(
          probe.position.x,
          probe.position.y,
          probe.position.z,
          probeValue
        );

        const defined =
          probeValue.n > 1e-5 &&
          probeValue.nearest2 > 1e-8;

        const amplitude =
          1.7 * Math.sqrt(probeValue.n);

        const x =
          amplitude * Math.cos(probeValue.phase);

        const y =
          amplitude * Math.sin(probeValue.phase);

        const attribute =
          phasor.geometry.getAttribute("position");

        attribute.setXYZ(0, 0, 0, 0);
        attribute.setXYZ(1, x, y, 0);
        attribute.needsUpdate = true;

        phasorDot.position.set(x, y, 0);

        phasor.visible = defined;
        phasorDot.visible = defined;
      }

      function updateHUD(dt) {
        hudClock += dt;

        if (hudClock < 0.12) {
          return;
        }

        hudClock = 0;

        text(
          "density-value",
          probeValue.n.toFixed(4)
        );

        text(
          "angular-value",
          OMEGA.toFixed(4)
        );

        text(
          "vortex-count-value",
          String(cores.length)
        );

        text(
          "healing-value",
          (1 / R).toFixed(4)
        );

        text(
          "spacing-value",
          SPACING.toFixed(2)
        );

        text(
          "phase-value",
          probeValue.n <= 1e-5 ||
          probeValue.nearest2 <= 1e-8
            ? "UNDEFINED"
            : (probeValue.phase / Math.PI).toFixed(3) + "π"
        );

        text(
          "circulation-value",
          "+1"
        );

        text(
          "potential-value",
          probeValue.potential.toFixed(3)
        );

        const inside =
          (
            probe.position.x ** 2 +
            probe.position.z ** 2
          ) / (R * R) +
          probe.position.y ** 2 / (Z * Z) < 1;

        text(
          "probe-status",
          (
            state.mode === "manual"
              ? "ORBIT TARGET"
              : "GUIDED PROBE"
          ) +
          (
            inside
              ? " / IN FIELD"
              : " / OUTSIDE ENVELOPE"
          )
        );

        text(
          "probe-position-value",
          "(" +
          probe.position.x.toFixed(2) + ", " +
          probe.position.y.toFixed(2) + ", " +
          probe.position.z.toFixed(2) +
          ") ξ₀"
        );

        text(
          "selected-vortex-value",
          "V" +
          String(selectedIndex + 1).padStart(2, "0") +
          " / (0, 0)"
        );

        const percent =
          state.tour / TOUR_LENGTH * 100;

        if (ui["flight-progress"]) {
          ui["flight-progress"].style.transform =
            "scaleX(" + percent / 100 + ")";
        }

        if (ui["journey-progress"]) {
          ui["journey-progress"].setAttribute(
            "aria-valuenow",
            percent.toFixed(1)
          );

          ui["journey-progress"].setAttribute(
            "aria-valuetext",
            timeText(state.tour) +
            " of " +
            timeText(TOUR_LENGTH)
          );
        }

        text(
          "tour-time",
          timeText(state.tour) +
          " / " +
          timeText(TOUR_LENGTH)
        );

        if (previousStage !== state.stage) {
          previousStage = state.stage;

          const chapter = chapters[state.stage];

          text(
            "chapter-value",
            String(state.stage + 1).padStart(2, "0") +
            " / " +
            chapter[2]
          );

          text("scene-title", chapter[3]);
          text("scene-description", chapter[4]);

          stageNodes.forEach((node, index) => {
            const active = node.dataset.stage
              ? node.dataset.stage === chapter[0]
              : index === state.stage;

            node.classList.toggle(
              "is-active",
              active
            );

            node.classList.toggle(
              "active",
              active
            );

            if (active) {
              node.setAttribute(
                "aria-current",
                "step"
              );
            } else {
              node.removeAttribute("aria-current");
            }
          });

          layoutClock = 1;
        }
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
          1.6,
          Math.sqrt(
            2800000 / (
              state.width * state.height
            )
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
              state.width * state.dpr * 0.65
            )
          ),
          Math.max(
            1,
            Math.round(
              state.height * state.dpr * 0.65
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

      renderer.domElement.addEventListener(
        "webglcontextlost",
        event => {
          event.preventDefault();

          state.lost = true;
          previousStamp = null;
          controls.enabled = false;

          engineButtons.forEach(button => {
            button.disabled = true;
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
            previousStamp = null;

            densityMap.needsUpdate = true;
            resize();

            controls.enabled =
              state.mode === "manual";

            state.ready = false;
          } catch (error) {
            fail(
              "The graphics context could not be restored. " +
              "Reload this page to restart the model.",
              error
            );
          }
        }
      );

      document.addEventListener(
        "visibilitychange",
        () => {
          previousStamp = null;
        }
      );

      updateButtons();

      const gl = renderer.getContext();

      const maxPointSize = gl.getParameter(
        gl.ALIASED_POINT_SIZE_RANGE
      )[1];

      pointMaterials.forEach(material => {
        material.vertexShader =
          material.vertexShader.replace(
            "1.0,34.0",
            "1.0," +
              Math.min(34, maxPointSize).toFixed(1)
          );
      });

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
          /*
           * Returning to the drone freezes both scene time
           * and tour time, so the captured destination stays
           * fixed throughout the camera handoff.
           */

          const advancing =
            !state.paused &&
            state.mode !== "return";

          if (advancing) {
            state.time += dt * TIME_RATE;

            state.angle =
              (OMEGA * state.time) % TAU;

            if (state.mode === "auto") {
              state.tour =
                (state.tour + dt) % TOUR_LENGTH;
            }
          }

          evaluateTour();

          body.rotation.y = state.angle;
          rotatingFrame.rotation.y = state.angle;

          if (advancing) {
            updateTracers(dt * TIME_RATE);
          }

          updateCamera(dt);
          updateProbe();

          const close =
            state.stage >= 2 &&
            state.stage <= 5;

          const smoothing =
            1 - Math.exp(-3 * dt);

          cloud.material.uniforms.uOpacity.value = mix(
            cloud.material.uniforms.uOpacity.value,
            close ? 0.5 : 0.73,
            smoothing
          );

          sliceMaterial.uniforms.uOpacity.value = mix(
            sliceMaterial.uniforms.uOpacity.value,
            state.stage === 3 || state.stage === 4
              ? 0.68
              : 0.20,
            smoothing
          );

          bonds.material.opacity = mix(
            bonds.material.opacity,
            state.stage === 1 || state.stage === 6
              ? 0.5
              : 0.12,
            smoothing
          );

          flowArrows.material.opacity = mix(
            flowArrows.material.opacity,
            state.stage === 5 ? 0.66 : 0.12,
            smoothing
          );

          coreChart.visible =
            state.stage === 3 ||
            (
              state.mode === "manual" &&
              camera.position.length() < 20
            );

          const pointScale =
            state.height * state.dpr /
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
          updateCards(dt);

          composer.render();
          labels.render(scene, camera);

          if (!state.ready) {
            state.ready = true;

            host.setAttribute(
              "aria-busy",
              "false"
            );

            if (notice) {
              notice.hidden = true;
            }

            engineButtons.forEach(button => {
              button.disabled = false;
            });

            updateButtons();
          }
        } catch (error) {
          fail(
            "The visualization could not finish rendering. " +
            "Check that all Three.js CDN scripts loaded, " +
            "then reload the page.",
            error
          );
        }
      }

      requestAnimationFrame(frame);
    } catch (error) {
      fail(
        "The visualization could not start. " +
        "Keep the three files together and check that " +
        "the Three.js CDN is reachable.",
        error
      );
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
})();