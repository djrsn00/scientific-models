/* script.js
 * The terrain is an illustrative surface, not a solved spacetime metric.
 * String actions: https://www.damtp.cam.ac.uk/user/tong/string/string1.pdf
 * 11D three-form background: https://arxiv.org/abs/hep-th/9711055
 */

(() => {
  'use strict';

  const container = document.getElementById('canvas-container');
  const notice = document.getElementById('render-notice');

  const required = [
    'OrbitControls',
    'CSS2DRenderer',
    'CSS2DObject',
    'EffectComposer',
    'RenderPass',
    'ShaderPass',
    'UnrealBloomPass',
    'FXAAShader'
  ];

  if (!window.THREE || required.some(name => !THREE[name])) {
    notice.hidden = false;
    notice.textContent =
      'The graphics libraries could not load. Check your connection and reload.';
    return;
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    notice.hidden = false;
    notice.textContent = 'The WebGL scene could not start: ' + error.message;
  }

  function initialize() {
    const TAU = Math.PI * 2;
    const clamp = THREE.MathUtils.clamp;

    const smooth = (a, b, value) => {
      const x = clamp((value - a) / (b - a), 0, 1);
      return x * x * (3 - 2 * x);
    };

    const ease = x => x * x * x * (x * (x * 6 - 15) + 10);

    const ui = {
      panel: document.getElementById('info-panel'),
      toggle: document.getElementById('hud-toggle'),
      pause: document.getElementById('pause-toggle'),
      resume: document.getElementById('resume-flight'),
      mode: document.getElementById('flight-mode'),
      position: document.getElementById('position-value'),
      region: document.getElementById('region-value'),
      progress: document.getElementById('flight-progress')
    };

    let visualTime = 0;
    let flightTime = 0;
    let mode = 'AUTO';
    let paused = false;
    let hudVisible = true;
    let contextLost = false;
    let lastTimestamp = 0;
    let lastUI = -1;
    let resume = null;

    let pixelRatio = 1;
    let viewportWidth = 1;
    let viewportHeight = 1;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0018);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.08, 650);
    camera.up.set(0, 1, 0);

    const aimCamera = new THREE.PerspectiveCamera();
    aimCamera.up.copy(camera.up);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });

    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 1);

    renderer.domElement.setAttribute(
      'aria-label',
      'Animated compactification hypersurface'
    );

    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);

    const labels = new THREE.CSS2DRenderer();
    labels.domElement.id = 'spatial-labels';
    container.appendChild(labels.domElement);

    const halfFloat =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    const targetType = halfFloat
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    const gl = renderer.getContext();

    const maxPointSize = Math.min(
      64,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    const shared = {
      uTime: { value: 0 },
      uFog: { value: scene.fog.density },
      uPointScale: { value: 1 },
      uMaxPoint: { value: maxPointSize },
      uWells: { value: [] }
    };

    function routePoint(angle, out) {
      return out.set(
        65 * Math.cos(angle) + 12 * Math.sin(2 * angle),
        0,
        55 * Math.sin(angle) + 8 * Math.cos(3 * angle)
      );
    }

    const sites = [0, 1.05, 2.1, 3.15, 4.2, 5.25].map((angle, index) => {
      const p = routePoint(angle, new THREE.Vector3());

      return {
        x: p.x,
        z: p.z,
        radius: 10 + index % 2,
        index,
        group: null
      };
    });

    shared.uWells.value = sites.map(
      s => new THREE.Vector3(s.x, s.z, s.radius)
    );

    // Integer permutation keeps CPU and GPU simplex gradients consistent.
    const mod = (x, n) => x - Math.floor(x / n) * n;

    const permute = x => {
      x = mod(x, 289);
      return mod((34 * x + 1) * x, 289);
    };

    const gradients = [
      [0.70710678, 0.70710678],
      [0.70710678, -0.70710678],
      [-0.70710678, 0.70710678],
      [-0.70710678, -0.70710678],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1]
    ];

    function simplex(x, y) {
      const F = 0.3660254037844386;
      const G = 0.2113248654051871;

      const skew = (x + y) * F;
      const i = Math.floor(x + skew);
      const j = Math.floor(y + skew);

      const unskew = (i + j) * G;
      const x0 = x - i + unskew;
      const y0 = y - j + unskew;

      const i1 = x0 > y0 ? 1 : 0;
      const j1 = 1 - i1;

      function corner(ix, iy, dx, dy) {
        let attenuation = 0.5 - dx * dx - dy * dy;

        if (attenuation <= 0) return 0;

        const g = gradients[mod(permute(permute(ix) + iy), 8)];

        attenuation *= attenuation;

        return attenuation * attenuation * (g[0] * dx + g[1] * dy);
      }

      return 70 * (
        corner(i, j, x0, y0) +
        corner(
          i + i1,
          j + j1,
          x0 - i1 + G,
          y0 - j1 + G
        ) +
        corner(
          i + 1,
          j + 1,
          x0 - 1 + 2 * G,
          y0 - 1 + 2 * G
        )
      );
    }

    function heightAt(x, z, time) {
      let h = 3.8 * simplex(
        x * 0.021 + time * 0.013,
        z * 0.021 - time * 0.008
      );

      h += 1.25 * simplex(
        x * 0.055 - time * 0.009,
        z * 0.055 + time * 0.011
      );

      h += 0.35 * simplex(
        x * 0.125 + 9.2,
        z * 0.125 - time * 0.006
      );

      h +=
        1.8 *
        Math.sin(x * 0.035 + time * 0.12) *
        Math.cos(z * 0.025 - time * 0.09);

      for (const s of sites) {
        const dx = x - s.x;
        const dz = z - s.z;

        h -= 6.5 * Math.exp(
          -(dx * dx + dz * dz) / (2 * s.radius * s.radius)
        );
      }

      return h;
    }

    const fieldGLSL = `
      uniform float uTime;
      uniform float uFog;
      uniform vec3 uWells[6];

      float permute(float x) {
        x = mod(x, 289.0);
        return mod((34.0 * x + 1.0) * x, 289.0);
      }

      vec2 gradient2(vec2 cell) {
        float h = mod(permute(permute(cell.x) + cell.y), 8.0);

        if (h < 4.0) {
          return vec2(
            h < 2.0 ? 1.0 : -1.0,
            mod(h, 2.0) < 1.0 ? 1.0 : -1.0
          ) * 0.70710678;
        }

        if (h < 6.0) {
          return vec2(h < 5.0 ? 1.0 : -1.0, 0.0);
        }

        return vec2(0.0, h < 7.0 ? 1.0 : -1.0);
      }

      float contribution(vec2 cell, vec2 delta) {
        float a = max(0.5 - dot(delta, delta), 0.0);
        a *= a;

        return a * a * dot(gradient2(cell), delta);
      }

      float simplex(vec2 p) {
        const float F = 0.3660254037844386;
        const float G = 0.2113248654051871;

        vec2 cell = floor(p + (p.x + p.y) * F);
        vec2 a = p - cell + (cell.x + cell.y) * G;

        vec2 stepCell = a.x > a.y
          ? vec2(1.0, 0.0)
          : vec2(0.0, 1.0);

        vec2 b = a - stepCell + G;
        vec2 c = a - 1.0 + 2.0 * G;

        return 70.0 * (
          contribution(cell, a) +
          contribution(cell + stepCell, b) +
          contribution(cell + 1.0, c)
        );
      }

      float heightAt(vec2 p) {
        float h = 3.8 * simplex(
          p * 0.021 + vec2(uTime * 0.013, -uTime * 0.008)
        );

        h += 1.25 * simplex(
          p * 0.055 + vec2(-uTime * 0.009, uTime * 0.011)
        );

        h += 0.35 * simplex(
          p * 0.125 + vec2(9.2, -uTime * 0.006)
        );

        h += 1.8 *
          sin(p.x * 0.035 + uTime * 0.12) *
          cos(p.y * 0.025 - uTime * 0.09);

        for (int i = 0; i < 6; i++) {
          vec2 delta = p - uWells[i].xy;

          h -= 6.5 * exp(
            -dot(delta, delta) /
            (2.0 * uWells[i].z * uWells[i].z)
          );
        }

        return h;
      }

      float atmosphere(float depth) {
        return exp(-uFog * uFog * depth * depth);
      }
    `;

    const terrainMaterial = new THREE.ShaderMaterial({
      uniforms: shared,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: true,
      extensions: { derivatives: true },

      vertexShader: fieldGLSL + `
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vCoord;
        varying float vDepth;

        void main() {
          vec3 p = position;
          float e = 0.25;

          p.y = heightAt(p.xz);

          float left = heightAt(p.xz - vec2(e, 0.0));
          float right = heightAt(p.xz + vec2(e, 0.0));
          float back = heightAt(p.xz - vec2(0.0, e));
          float front = heightAt(p.xz + vec2(0.0, e));

          vNormal = normalize(
            vec3(left - right, 2.0 * e, back - front)
          );

          vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
          vCoord = p.xz;

          vec4 mv = viewMatrix * vec4(vWorld, 1.0);

          vDepth = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,

      fragmentShader: fieldGLSL + `
        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vCoord;
        varying float vDepth;

        float contour(float value) {
          float w = max(fwidth(value), 0.0001);
          float d = abs(fract(value - 0.5) - 0.5) / w;

          return 1.0 - smoothstep(0.35, 1.25, d);
        }

        void main() {
          float edge = 1.0 - smoothstep(
            150.0,
            178.0,
            max(abs(vCoord.x), abs(vCoord.y))
          );

          if (edge < 0.01) discard;

          vec3 viewDir = normalize(cameraPosition - vWorld);

          float fresnel = pow(
            1.0 - abs(dot(normalize(vNormal), viewDir)),
            3.0
          );

          float shift = 0.5 + 0.5 * sin(
            vCoord.x * 0.025 -
            vCoord.y * 0.018 +
            uTime * 0.12
          );

          vec3 neon = mix(
            vec3(0.015, 0.8, 1.0),
            vec3(0.75, 0.018, 1.0),
            shift
          );

          vec2 warped = vCoord * 0.38 +
            vec2(vWorld.y * 0.12, vWorld.y * 0.08);

          float wire = max(
            contour(warped.x),
            contour(warped.y)
          );

          float isoline = contour(
            vWorld.y * 0.52 + uTime * 0.025
          );

          float crest = smoothstep(-0.3, 3.0, vWorld.y);

          float pulse = 0.88 + 0.12 * sin(
            vCoord.x * 0.15 +
            vCoord.y * 0.1 -
            uTime * 0.45
          );

          vec3 color = neon * (
            0.022 +
            wire * 0.34 +
            isoline * 0.22
          );

          color += neon * (
            wire * crest * 2.7 * pulse +
            fresnel * crest * 1.4
          );

          color *= atmosphere(vDepth);

          gl_FragColor = vec4(color, edge);
        }
      `
    });

    const terrainGeometry = new THREE.PlaneGeometry(
      360,
      360,
      256,
      256
    );

    terrainGeometry.rotateX(-Math.PI / 2);

    const terrain = new THREE.Mesh(
      terrainGeometry,
      terrainMaterial
    );

    terrain.frustumCulled = false;
    terrain.renderOrder = -10;

    scene.add(terrain);

    const ringMaterial = new THREE.ShaderMaterial({
      uniforms: shared,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      extensions: { derivatives: true },

      vertexShader: `
        uniform float uTime;

        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vDepth;

        void main() {
          vec3 p = position + normal * (
            0.08 * sin(uv.x * 37.699 + uTime * 0.5)
          );

          vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
          vNormal = normalize(mat3(modelMatrix) * normal);
          vUv = uv;

          vec4 mv = viewMatrix * vec4(vWorld, 1.0);

          vDepth = length(mv.xyz);
          gl_Position = projectionMatrix * mv;
        }
      `,

      fragmentShader: `
        uniform float uTime;
        uniform float uFog;

        varying vec3 vWorld;
        varying vec3 vNormal;
        varying vec2 vUv;
        varying float vDepth;

        void main() {
          float facing = abs(dot(
            normalize(vNormal),
            normalize(cameraPosition - vWorld)
          ));

          float fresnel = pow(1.0 - facing, 2.2);

          float phase = 0.5 + 0.5 * sin(
            vUv.x * 12.566 -
            uTime * 0.22 +
            facing * 4.0
          );

          vec3 neon = mix(
            vec3(0.01, 0.9, 1.2),
            vec3(0.9, 0.015, 1.35),
            phase
          );

          vec2 grid = vUv * vec2(84.0, 12.0);

          vec2 d = abs(fract(grid - 0.5) - 0.5) /
            max(fwidth(grid), vec2(0.001));

          float line = 1.0 - smoothstep(
            0.3,
            1.2,
            min(d.x, d.y)
          );

          float ridge = pow(
            0.5 + 0.5 * sin(vUv.x * 50.265 - uTime),
            9.0
          );

          float fog = exp(-uFog * uFog * vDepth * vDepth);

          vec3 light = neon * (
            0.12 +
            line * 1.15 +
            fresnel * 1.5 +
            ridge * 1.1
          );

          gl_FragColor = vec4(
            light * fog,
            0.32 + fresnel * 0.3
          );
        }
      `
    });

    const knotGeometry = new THREE.TorusKnotGeometry(
      3.8,
      0.56,
      288,
      24,
      2,
      3
    );

    const stringVertex = `
      uniform float uTime;
      uniform float uPhase;
      uniform float uClosed;

      varying float vDepth;

      void main() {
        vec3 p = position;

        float a = atan(p.z, p.x);

        float envelope = uClosed > 0.5
          ? 1.0
          : sin(3.14159265 * uv.x);

        float coordinate = uClosed > 0.5 ? a : p.x;

        p.y += envelope * (
          0.24 * sin(coordinate * 3.0 + uTime * 4.0 + uPhase) +
          0.09 * sin(coordinate * 7.0 - uTime * 6.0)
        );

        vec4 mv = modelViewMatrix * vec4(p, 1.0);

        vDepth = length(mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `;

    const stringFragment = `
      uniform vec3 uColor;
      uniform float uFog;

      varying float vDepth;

      void main() {
        float fog = exp(-uFog * uFog * vDepth * vDepth);

        gl_FragColor = vec4(uColor * fog, 0.95);
      }
    `;

    function makeString(closed, phase) {
      const count = closed ? 160 : 128;
      const positions = new Float32Array(count * 3);
      const uvs = new Float32Array(count * 2);

      for (let i = 0; i < count; i++) {
        const u = i / (closed ? count : count - 1);
        const angle = u * TAU;

        positions[i * 3] = closed
          ? Math.cos(angle) * 2.3
          : (u - 0.5) * 7.6;

        positions[i * 3 + 1] = closed
          ? Math.sin(angle * 2) * 0.16
          : 0;

        positions[i * 3 + 2] = closed
          ? Math.sin(angle) * 2.3
          : 0;

        uvs[i * 2] = u;
      }

      const geometry = new THREE.BufferGeometry();

      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(positions, 3)
      );

      geometry.setAttribute(
        'uv',
        new THREE.BufferAttribute(uvs, 2)
      );

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: shared.uTime,
          uFog: shared.uFog,
          uPhase: { value: phase },
          uClosed: { value: closed ? 1 : 0 },
          uColor: {
            value: closed
              ? new THREE.Vector3(3.0, 1.7, 0.14)
              : new THREE.Vector3(2.4, 0.04, 1.3)
          }
        },

        vertexShader: stringVertex,
        fragmentShader: stringFragment,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      const line = closed
        ? new THREE.LineLoop(geometry, material)
        : new THREE.Line(geometry, material);

      line.frustumCulled = false;

      return line;
    }

    for (const s of sites) {
      const group = new THREE.Group();
      const twist = new THREE.Group();

      const knot = new THREE.Mesh(knotGeometry, ringMaterial);
      const inner = new THREE.Mesh(knotGeometry, ringMaterial);

      knot.rotation.x = 0.38;

      inner.scale.setScalar(0.69);
      inner.rotation.set(-0.55, 0.3, Math.PI / 3);

      twist.add(knot, inner);
      group.add(twist);

      const strings = new THREE.Group();

      for (let j = 0; j < 4; j++) {
        const closed = j < 2;
        const string = makeString(
          closed,
          j * 1.7 + s.index
        );

        string.position.y = 1.3 + j * 0.38;
        string.rotation.y = j * Math.PI / 3;
        string.rotation.x = closed ? j * 0.45 : 0;

        strings.add(string);
      }

      group.add(strings);

      s.group = group;
      s.twist = twist;
      s.strings = strings;

      group.position.set(
        s.x,
        heightAt(s.x, s.z, 0) + 2.8,
        s.z
      );

      scene.add(group);
    }

    let randomSeed = 84021;

    function random() {
      randomSeed = (
        Math.imul(1664525, randomSeed) + 1013904223
      ) >>> 0;

      return randomSeed / 4294967296;
    }

    const particleCount = 7500;

    const dustPositions = new Float32Array(particleCount * 3);
    const dustData = new Float32Array(particleCount * 2);

    for (let i = 0; i < particleCount; i++) {
      const angle = random() * TAU;
      const radius = Math.sqrt(random()) * 138;

      dustPositions[i * 3] = Math.cos(angle) * radius;

      dustPositions[i * 3 + 1] =
        1.4 + Math.pow(random(), 1.8) * 36;

      dustPositions[i * 3 + 2] = Math.sin(angle) * radius;

      dustData[i * 2] = random();
      dustData[i * 2 + 1] = 0.08 + random() * 0.12;
    }

    const dustGeometry = new THREE.BufferGeometry();

    dustGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(dustPositions, 3)
    );

    dustGeometry.setAttribute(
      'aData',
      new THREE.BufferAttribute(dustData, 2)
    );

    const dustMaterial = new THREE.ShaderMaterial({
      uniforms: shared,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,

      vertexShader: fieldGLSL + `
        uniform float uPointScale;
        uniform float uMaxPoint;

        attribute vec2 aData;

        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          vec3 p = position;

          p.y += heightAt(p.xz) +
            0.4 * sin(uTime * 0.25 + aData.x * 6.283);

          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float depth = length(mv.xyz);

          vColor = mix(
            vec3(0.02, 0.5, 0.16),
            vec3(0.015, 0.46, 0.6),
            aData.x
          );

          vAlpha = atmosphere(depth) *
            (1.0 - smoothstep(100.0, 230.0, depth));

          vAlpha *= smoothstep(0.8, 3.0, depth);

          gl_PointSize = clamp(
            aData.y * uPointScale / max(1.0, -mv.z),
            1.0,
            uMaxPoint
          );

          gl_Position = projectionMatrix * mv;
        }
      `,

      fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;

        void main() {
          float r = length(gl_PointCoord - 0.5) * 2.0;

          if (r >= 1.0) discard;

          float alpha =
            exp(-r * r * 4.5) *
            (1.0 - smoothstep(0.65, 1.0, r));

          gl_FragColor = vec4(
            vColor,
            alpha * vAlpha * 0.65
          );
        }
      `
    });

    const dust = new THREE.Points(dustGeometry, dustMaterial);
    dust.frustumCulled = false;

    scene.add(dust);

    const annotationData = [
      [
        '10D / COMPACTIFICATION',
        'CURLED SIX-DIMENSIONAL FIBER',
        '<math><msub><mi mathvariant="script">M</mi><mn>10</mn></msub><mo>≃</mo><msub><mi mathvariant="script">M</mi><mrow><mn>3</mn><mo>,</mo><mn>1</mn></mrow></msub><mo>×</mo><msub><mi>X</mi><mn>6</mn></msub></math>',
        'Calabi–Yau compactification schematic.',
        '#66eaff'
      ],
      [
        'NAMBU–GOTO ACTION',
        'BOSONIC WORLD-SHEET SECTOR',
        '<math><msub><mi>S</mi><mtext>NG</mtext></msub><mo>=</mo><mo>−</mo><msub><mi>T</mi><mi>F</mi></msub><mo>∫</mo><msup><mi>d</mi><mn>2</mn></msup><mi>σ</mi><msqrt><mrow><mo>−</mo><mi>det</mi><mi>γ</mi></mrow></msqrt></math>',
        'The induced world-sheet area.',
        '#d192ff'
      ],
      [
        'M2 / C3 COUPLING',
        '11D PARENT THEORY',
        '<math><msub><mi>S</mi><mtext>WZ</mtext></msub><mo>=</mo><msub><mi>q</mi><mtext>M2</mtext></msub><msub><mo>∫</mo><msub><mi>Σ</mi><mn>3</mn></msub></msub><mi>P</mi><mo>[</mo><msub><mi>C</mi><mn>3</mn></msub><mo>]</mo></math>',
        'P denotes pullback onto the membrane.',
        '#ffcc79'
      ],
      [
        'F4 / FLUX SCHEMATIC',
        '11D PARENT THEORY',
        '<math><msub><mi>F</mi><mn>4</mn></msub><mo>=</mo><mi>d</mi><msub><mi>C</mi><mn>3</mn></msub><mo>,</mo><mspace width="0.4em"/><mi>d</mi><msub><mi>F</mi><mn>4</mn></msub><mo>=</mo><mn>0</mn></math>',
        'Closed flux away from magnetic sources.',
        '#69ffd0'
      ],
      [
        'CLOSED / OPEN STRINGS',
        'ILLUSTRATIVE MASSLESS MODES',
        '<math><msub><mi>T</mi><mi>F</mi></msub><mo>=</mo><mfrac><mn>1</mn><mrow><mn>2</mn><mi>π</mi><msup><mi>α</mi><mo>′</mo></msup></mrow></mfrac></math>',
        'Gold: graviton sector. Magenta: open gauge modes.',
        '#ffcf70'
      ],
      [
        'POLYAKOV DESCRIPTION',
        'INDEPENDENT WORLD-SHEET METRIC',
        '<math><msub><mi>γ</mi><mrow><mi>a</mi><mi>b</mi></mrow></msub><mo>=</mo><msub><mi>G</mi><mrow><mi>μ</mi><mi>ν</mi></mrow></msub><msub><mo>∂</mo><mi>a</mi></msub><msup><mi>X</mi><mi>μ</mi></msup><msub><mo>∂</mo><mi>b</mi></msub><msup><mi>X</mi><mi>ν</mi></msup></math>',
        'The surface encodes a world-sheet analogy.',
        '#c2a0ff'
      ]
    ];

    const annotations = [];

    const markerGeometry = new THREE.SphereGeometry(
      0.11,
      12,
      8
    );

    annotationData.forEach((data, i) => {
      const element = document.createElement('article');

      element.className = 'world-card';
      element.style.setProperty('--accent', data[4]);

      element.innerHTML =
        '<span class="coordinate-tick"></span>' +
        '<p class="card-eyebrow">' + data[1] + '</p>' +
        '<h2>' + data[0] + '</h2>' +
        '<div class="card-equation">' + data[2] + '</div>' +
        '<p class="card-description">' + data[3] + '</p>';

      element.addEventListener('pointerdown', event => {
        event.stopPropagation();
        enterManual();
      });

      const object = new THREE.CSS2DObject(element);
      scene.add(object);

      const leaderGeometry = new THREE.BufferGeometry();

      leaderGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(9), 3)
      );

      const leaderMaterial = new THREE.LineBasicMaterial({
        color: new THREE.Color(data[4]).convertSRGBToLinear(),
        transparent: true,
        opacity: 0.65,
        depthWrite: false
      });

      const leader = new THREE.Line(
        leaderGeometry,
        leaderMaterial
      );

      leader.frustumCulled = false;

      const marker = new THREE.Mesh(
        markerGeometry,
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(data[4]).convertSRGBToLinear()
        })
      );

      scene.add(leader, marker);

      annotations.push({
        object,
        element,
        leader,
        marker,
        site: sites[i],
        anchor: new THREE.Vector3(),
        top: new THREE.Vector3(),
        opacity: 0
      });
    });

    const destination = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    const desiredQuaternion = new THREE.Quaternion();

    const forward = new THREE.Vector3();
    const projected = new THREE.Vector3();
    const occlusionPoint = new THREE.Vector3();

    function sampleFlight() {
      const angle = TAU * (flightTime / 260) + 0.36;

      routePoint(angle, destination);

      destination.y =
        heightAt(destination.x, destination.z, visualTime) +
        11 +
        0.6 * Math.sin(angle * 2);

      routePoint(angle + 0.14, lookTarget);

      lookTarget.y =
        heightAt(lookTarget.x, lookTarget.z, visualTime) + 7;

      aimCamera.position.copy(destination);
      aimCamera.lookAt(lookTarget);

      desiredQuaternion.copy(aimCamera.quaternion);
    }

    sampleFlight();

    camera.position.copy(destination);
    camera.quaternion.copy(desiredQuaternion);

    const controls = new THREE.OrbitControls(
      camera,
      renderer.domElement
    );

    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.45;
    controls.zoomSpeed = 0.7;
    controls.panSpeed = 0.55;
    controls.minDistance = 0.3;
    controls.maxDistance = 260;
    controls.minPolarAngle = 0.015;
    controls.maxPolarAngle = Math.PI - 0.015;
    controls.screenSpacePanning = true;

    function syncTarget() {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);

      controls.target
        .copy(camera.position)
        .addScaledVector(forward, 14);

      camera.updateMatrixWorld(true);
    }

    // OrbitControls updates during construction; reinstall the intended pose.
    camera.position.copy(destination);
    camera.quaternion.copy(desiredQuaternion);

    syncTarget();

    function enterManual() {
      if (mode === 'MANUAL' && !resume) return;

      mode = 'MANUAL';
      resume = null;

      syncTarget();
      lastUI = -1;
    }

    function clearControlMotion() {
      const position = camera.position.clone();
      const quaternion = camera.quaternion.clone();

      controls.enableDamping = false;

      controls.saveState();
      controls.reset();

      camera.position.copy(position);
      camera.quaternion.copy(quaternion);

      controls.enableDamping = true;

      syncTarget();
    }

    function resumeFlight() {
      clearControlMotion();
      sampleFlight();

      resume = {
        elapsed: 0,
        duration: clamp(
          camera.position.distanceTo(destination) / 18,
          1.8,
          5
        ),
        from: camera.position.clone(),
        rotation: camera.quaternion.clone(),
        to: destination.clone(),
        goalRotation: desiredQuaternion.clone()
      };

      mode = 'AUTO';
      paused = false;
      lastUI = -1;
    }

    controls.addEventListener('start', enterManual);

    renderer.domElement.addEventListener(
      'pointerdown',
      enterManual,
      true
    );

    renderer.domElement.addEventListener(
      'wheel',
      enterManual,
      { capture: true, passive: true }
    );

    function togglePause() {
      paused = !paused;
      lastUI = -1;
    }

    function toggleHUD() {
      hudVisible = !hudVisible;

      ui.panel.hidden = !hudVisible;
      ui.toggle.textContent = hudVisible ? 'Hide HUD' : 'Show HUD';

      ui.toggle.setAttribute(
        'aria-expanded',
        String(hudVisible)
      );
    }

    ui.pause.addEventListener('click', togglePause);
    ui.resume.addEventListener('click', resumeFlight);
    ui.toggle.addEventListener('click', toggleHUD);

    window.addEventListener('keydown', event => {
      if (
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return;
      }

      if (
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) ||
        event.target.isContentEditable
      ) {
        return;
      }

      if (
        event.code === 'Space' &&
        event.target.closest('button')
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePause();
      } else if (event.code === 'KeyR') {
        resumeFlight();
      } else if (event.code === 'KeyH') {
        toggleHUD();
      }
    });

    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: targetType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new THREE.EffectComposer(
      renderer,
      renderTarget
    );

    composer.addPass(new THREE.RenderPass(scene, camera));

    const bloom = new THREE.UnrealBloomPass(
      new THREE.Vector2(1, 1),
      0.72,
      0.42,
      halfFloat ? 1.05 : 0.82
    );

    bloom.renderTargetBright.texture.type = targetType;

    bloom.renderTargetsHorizontal.forEach(target => {
      target.texture.type = targetType;
    });

    bloom.renderTargetsVertical.forEach(target => {
      target.texture.type = targetType;
    });

    composer.addPass(bloom);

    const grade = new THREE.ShaderPass({
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

        vec3 displayRGB(vec3 x) {
          vec3 low = x * 12.92;

          vec3 high =
            1.055 *
            pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) -
            0.055;

          return mix(
            low,
            high,
            step(vec3(0.0031308), x)
          );
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;

          color *= 1.0 - 0.16 * smoothstep(
            0.25,
            0.72,
            length(vUv - 0.5)
          );

          gl_FragColor = vec4(
            displayRGB(aces(color * 1.05)),
            1.0
          );
        }
      `
    });

    composer.addPass(grade);

    const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
    composer.addPass(fxaa);

    function resize() {
      viewportWidth = Math.max(1, window.innerWidth);
      viewportHeight = Math.max(1, window.innerHeight);

      pixelRatio = Math.min(
        window.devicePixelRatio || 1,
        2
      );

      camera.aspect = viewportWidth / viewportHeight;
      camera.updateProjectionMatrix();

      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(viewportWidth, viewportHeight);

      composer.setPixelRatio(pixelRatio);
      composer.setSize(viewportWidth, viewportHeight);

      bloom.setSize(
        Math.ceil(viewportWidth * pixelRatio * 0.7),
        Math.ceil(viewportHeight * pixelRatio * 0.7)
      );

      fxaa.uniforms.resolution.value.set(
        1 / (viewportWidth * pixelRatio),
        1 / (viewportHeight * pixelRatio)
      );

      labels.setSize(viewportWidth, viewportHeight);

      shared.uPointScale.value =
        viewportHeight * pixelRatio /
        (
          2 *
          Math.tan(
            THREE.MathUtils.degToRad(camera.fov * 0.5)
          )
        );

      lastUI = -1;
    }

    window.addEventListener('resize', resize);
    resize();

    function terrainOccludes(anchor) {
      const distance = camera.position.distanceTo(anchor);

      if (distance < 2) return false;

      for (let j = 1; j < 15; j++) {
        occlusionPoint.lerpVectors(
          camera.position,
          anchor,
          j / 15
        );

        if (
          occlusionPoint.y <
          heightAt(
            occlusionPoint.x,
            occlusionPoint.z,
            visualTime
          ) + 0.12
        ) {
          return true;
        }
      }

      return false;
    }

    function updateAnnotations(dt) {
      const candidates = [];
      const accepted = [];

      const panelRect = hudVisible
        ? ui.panel.getBoundingClientRect()
        : null;

      const width = viewportWidth < 700 ? 205 : 245;

      for (const a of annotations) {
        const s = a.site;
        const y = heightAt(s.x, s.z, visualTime);

        a.anchor.set(s.x, y + 0.3, s.z);

        a.top.set(
          s.x + (s.index % 2 ? -6 : 6),
          y + 11.5,
          s.z
        );

        a.object.position.copy(a.top);
        a.marker.position.copy(a.anchor);

        const values =
          a.leader.geometry.attributes.position.array;

        a.anchor.toArray(values, 0);

        values[3] = a.anchor.x;
        values[4] = a.top.y - 1.8;
        values[5] = a.anchor.z;

        a.top.toArray(values, 6);

        a.leader.geometry.attributes.position.needsUpdate = true;

        const distance = camera.position.distanceTo(a.top);

        projected.copy(a.top).project(camera);

        const x =
          (projected.x * 0.5 + 0.5) * viewportWidth;

        const screenY =
          (-projected.y * 0.5 + 0.5) * viewportHeight;

        const rect = {
          left: x - width / 2,
          right: x + width / 2,
          top: screenY - 78,
          bottom: screenY + 78
        };

        let allowed =
          hudVisible &&
          distance > 7 &&
          distance < 105 &&
          projected.z > -1 &&
          projected.z < 1 &&
          rect.left > 12 &&
          rect.right < viewportWidth - 12 &&
          rect.top > 78 &&
          rect.bottom < viewportHeight - 24;

        if (
          allowed &&
          panelRect &&
          rect.left < panelRect.right + 14 &&
          rect.right > panelRect.left &&
          rect.top < panelRect.bottom + 14 &&
          rect.bottom > panelRect.top
        ) {
          allowed = false;
        }

        if (allowed && terrainOccludes(a.anchor)) {
          allowed = false;
        }

        candidates.push({
          a,
          distance,
          rect,
          allowed
        });
      }

      candidates.sort((a, b) => a.distance - b.distance);

      for (const c of candidates) {
        let allowed =
          c.allowed &&
          accepted.length < 3;

        for (const r of accepted) {
          if (
            c.rect.left < r.right + 10 &&
            c.rect.right > r.left - 10 &&
            c.rect.top < r.bottom + 10 &&
            c.rect.bottom > r.top - 10
          ) {
            allowed = false;
          }
        }

        if (allowed) accepted.push(c.rect);

        const target = allowed
          ? (
            1 - smooth(70, 105, c.distance)
          ) * smooth(7, 12, c.distance)
          : 0;

        c.a.opacity = THREE.MathUtils.lerp(
          c.a.opacity,
          target,
          1 - Math.exp(-dt * 9)
        );

        c.a.object.visible = c.a.opacity > 0.015;

        c.a.element.style.opacity = String(c.a.opacity);

        c.a.element.style.pointerEvents =
          c.a.opacity > 0.7 ? 'auto' : 'none';

        c.a.leader.visible = c.a.object.visible;
        c.a.marker.visible = c.a.object.visible;

        c.a.leader.material.opacity = c.a.opacity * 0.65;
      }
    }

    function updateUI(timestamp) {
      if (
        lastUI >= 0 &&
        timestamp - lastUI < 160
      ) {
        return;
      }

      lastUI = timestamp;

      ui.mode.textContent = paused
        ? 'PAUSED / ' + mode
        : resume
          ? 'RETURNING TO FLIGHT'
          : mode === 'AUTO'
            ? 'AUTOMATIC DRIFT'
            : 'MANUAL INSPECTION';

      ui.pause.textContent = paused ? 'Play' : 'Pause';

      ui.pause.setAttribute(
        'aria-pressed',
        String(paused)
      );

      ui.position.textContent = [
        camera.position.x,
        camera.position.y,
        camera.position.z
      ]
        .map(n => n.toFixed(1))
        .join(' / ');

      let nearest = Infinity;

      sites.forEach(s => {
        const distance = Math.hypot(
          camera.position.x - s.x,
          camera.position.z - s.z
        );

        nearest = Math.min(nearest, distance);
      });

      ui.region.textContent = nearest < 12
        ? 'COMPACTIFICATION VALLEY'
        : 'UNDULATING HYPERSURFACE';

      ui.progress.style.transform =
        'scaleX(' + ((flightTime % 260) / 260) + ')';
    }

    renderer.domElement.addEventListener(
      'webglcontextlost',
      event => {
        event.preventDefault();

        contextLost = true;
        notice.hidden = false;

        notice.textContent =
          'Graphics paused while the WebGL context recovers.';
      }
    );

    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        contextLost = false;
        lastTimestamp = 0;
        notice.hidden = true;

        resize();
      }
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        lastTimestamp = 0;
      }
    );

    function frame(timestamp) {
      requestAnimationFrame(frame);

      if (document.hidden || contextLost) {
        lastTimestamp = 0;
        return;
      }

      const dt = lastTimestamp
        ? Math.min((timestamp - lastTimestamp) / 1000, 0.05)
        : 0;

      lastTimestamp = timestamp;

      if (!paused && !resume) {
        visualTime += dt;

        if (mode === 'AUTO') {
          flightTime += dt;
        }
      }

      shared.uTime.value = visualTime;

      if (mode === 'AUTO') {
        if (resume) {
          if (!paused) {
            resume.elapsed += dt;
          }

          const amount = ease(
            clamp(
              resume.elapsed / resume.duration,
              0,
              1
            )
          );

          camera.position.lerpVectors(
            resume.from,
            resume.to,
            amount
          );

          camera.quaternion
            .copy(resume.rotation)
            .slerp(resume.goalRotation, amount);

          if (amount >= 1) {
            resume = null;
          }
        } else if (!paused) {
          sampleFlight();

          camera.position.lerp(
            destination,
            1 - Math.exp(-1.1 * dt)
          );

          camera.position.y = Math.max(
            camera.position.y,
            heightAt(
              camera.position.x,
              camera.position.z,
              visualTime
            ) + 7
          );

          aimCamera.position.copy(camera.position);
          aimCamera.lookAt(lookTarget);

          camera.quaternion.slerp(
            aimCamera.quaternion,
            1 - Math.exp(-1.8 * dt)
          );
        }

        // Automatic flight owns the pose; OrbitControls does not update here.
        syncTarget();
      } else {
        controls.update();
        camera.updateMatrixWorld(true);
      }

      for (const s of sites) {
        s.group.position.y =
          heightAt(s.x, s.z, visualTime) + 2.8;

        s.twist.rotation.y =
          visualTime * 0.045 + s.index * 0.6;

        s.strings.rotation.y = -visualTime * 0.025;

        s.strings.visible =
          camera.position.distanceTo(s.group.position) < 85;
      }

      if (
        Math.min(window.devicePixelRatio || 1, 2) !==
        pixelRatio
      ) {
        resize();
      }

      updateAnnotations(dt);
      updateUI(timestamp);

      composer.render();
      labels.render(scene, camera);
    }

    requestAnimationFrame(frame);
  }
})();