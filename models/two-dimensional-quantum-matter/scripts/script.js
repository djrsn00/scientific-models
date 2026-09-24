/* script.js — The Quantum Hologram
 *
 * All positions, scale transitions, and field maps are illustrative.
 * Graphene: https://arxiv.org/abs/0709.1163
 * QCD and Higgs conventions: https://www.damtp.cam.ac.uk/user/ho/SM.pdf
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
      'The graphics libraries did not load. Check your connection and reload.';
    return;
  }

  try {
    start();
  } catch (error) {
    console.error(error);
    notice.hidden = false;
    notice.textContent =
      'Unable to start the visualization: ' + error.message;
  }

  function start() {
    const T = THREE;
    const TAU = Math.PI * 2;
    const HEIGHT = 96;
    const PERIOD = 180;
    const MIN_ZOOM = 0.55;
    const MAX_ZOOM = 1800;

    const clamp = T.MathUtils.clamp;
    const mix = T.MathUtils.lerp;

    const smooth = (a, b, x) => {
      x = clamp((x - a) / (b - a), 0, 1);
      return x * x * (3 - 2 * x);
    };

    const ease = x => x * x * x * (x * (x * 6 - 15) + 10);

    const $ = id => {
      const element = document.getElementById(id);

      if (!element) {
        throw new Error('Missing HTML element: ' + id);
      }

      return element;
    };

    const ui = {
      panel: $('info-panel'),
      hud: $('hud-toggle'),
      pause: $('pause-toggle'),
      resume: $('resume-flight'),
      mode: $('flight-mode'),
      zoom: $('zoom-value'),
      scale: $('scale-value'),
      progress: $('zoom-progress'),
      fill: $('zoom-progress-fill'),
      field: $('active-field-value'),
      fermi: $('fermi-energy-value'),
      charge: $('fractional-charge-value'),
      flux: $('color-flux-value'),
      fluxFill: $('color-flux-fill'),
      chapter: $('chapter-value'),
      title: $('scene-title'),
      description: $('scene-description'),
      ruler: $('view-span-value'),
      caption: $('scene-caption'),
      controls: $('flight-controls'),
      layers: [...$('layer-list').children]
    };

    let width = 1;
    let height = 1;
    let dpr = 1;
    let pixelsPerUnit = 1;
    let lastStamp = 0;

    let time = 0;
    let flight = 0;
    let paused = false;
    let manual = false;
    let hud = true;
    let returning = null;
    let lost = false;

    let lastUI = -Infinity;
    let fluxIntensity = 0;
    let coast = 0;

    const velocity = new T.Vector3();
    const before = new T.Vector3();

    let seed = 194821;

    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const rgb = hex => new T.Color(hex).convertSRGBToLinear();

    const scene = new T.Scene();
    scene.background = new T.Color(0x000000);

    const camera = new T.OrthographicCamera(
      -48,
      48,
      48,
      -48,
      0.1,
      300
    );

    camera.position.set(0, 0, 100);
    camera.up.set(0, 1, 0);
    camera.quaternion.identity();

    const renderer = new T.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false
    });

    renderer.outputEncoding = T.sRGBEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setClearColor(0x000000, 1);

    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      'Quantum hologram. Drag to pan; scroll to zoom.'
    );

    container.appendChild(renderer.domElement);

    const labelRenderer = new T.CSS2DRenderer();
    labelRenderer.domElement.id = 'label-layer';
    container.appendChild(labelRenderer.domElement);

    const gl = renderer.getContext();

    const pointLimit = Math.min(
      128,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    const hdr =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    const targetType = hdr
      ? T.HalfFloatType
      : T.UnsignedByteType;

    const U = {
      uTime: { value: 0 },
      uZoom: { value: 1 },
      uPixelWorld: { value: 1 },
      uPixels: { value: 1 },
      uPointLimit: { value: pointLimit },
      uCenter: { value: new T.Vector2() },
      uSpan: { value: new T.Vector2(96, 96) },
      uResolution: { value: new T.Vector2(1, 1) },
      uFocus: { value: new T.Vector2() },
      uQCD: { value: 0 }
    };

    const macro = { value: 1 };
    const atomic = { value: 0 };
    const qcd = { value: 0 };
    const dustReveal = { value: 0.6 };

    function makeHoneycomb(radius, bond) {
      const vertices = [];
      const centers = [];
      const vertexMap = new Map();
      const edgeMap = new Map();

      for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
          if (
            Math.max(
              Math.abs(q),
              Math.abs(r),
              Math.abs(q + r)
            ) > radius
          ) {
            continue;
          }

          const x = 1.5 * bond * q;
          const y = Math.sqrt(3) * bond * (r + q / 2);
          const ids = [];

          centers.push({ x, y });

          for (let k = 0; k < 6; k++) {
            const angle = k * Math.PI / 3;
            const px = x + bond * Math.cos(angle);
            const py = y + bond * Math.sin(angle);

            const key =
              Math.round(px * 1e5) + ',' +
              Math.round(py * 1e5);

            if (!vertexMap.has(key)) {
              vertexMap.set(key, vertices.length);
              vertices.push({ x: px, y: py });
            }

            ids.push(vertexMap.get(key));
          }

          for (let k = 0; k < 6; k++) {
            const a = ids[k];
            const b = ids[(k + 1) % 6];
            const key = Math.min(a, b) + ':' + Math.max(a, b);

            if (edgeMap.has(key)) {
              edgeMap.get(key).count++;
            } else {
              edgeMap.set(key, { a, b, count: 1 });
            }
          }
        }
      }

      const edges = [...edgeMap.values()];
      const boundary = edges.filter(edge => edge.count === 1);
      const adjacency = new Map();

      for (const edge of boundary) {
        if (!adjacency.has(edge.a)) adjacency.set(edge.a, []);
        if (!adjacency.has(edge.b)) adjacency.set(edge.b, []);

        adjacency.get(edge.a).push(edge.b);
        adjacency.get(edge.b).push(edge.a);
      }

      for (const links of adjacency.values()) {
        if (links.length !== 2) {
          throw new Error('Invalid lattice boundary.');
        }
      }

      const first = boundary[0].a;
      const loop = [first];

      let previous = -1;
      let current = first;

      for (let k = 0; k <= boundary.length; k++) {
        const links = adjacency.get(current);

        const next = links[0] === previous
          ? links[1]
          : links[0];

        loop.push(next);
        previous = current;
        current = next;

        if (current === first) break;
      }

      if (loop.length !== boundary.length + 1) {
        throw new Error('Open lattice boundary.');
      }

      let area = 0;

      for (let i = 0; i < loop.length - 1; i++) {
        const a = vertices[loop[i]];
        const b = vertices[loop[i + 1]];
        area += a.x * b.y - b.x * a.y;
      }

      // Positive orientation gives a consistent counterclockwise edge current.
      if (area < 0) loop.reverse();

      return { vertices, centers, edges, loop };
    }

    const lattice = makeHoneycomb(5, 4.2);

    function nearest(x, y) {
      return lattice.vertices.reduce(
        (best, point) =>
          Math.hypot(point.x - x, point.y - y) <
          Math.hypot(best.x - x, best.y - y)
            ? point
            : best,
        lattice.vertices[0]
      );
    }

    const focus = nearest(4.2, 0);

    const defects = [
      nearest(-18, 14),
      nearest(21, -14),
      nearest(-21, -19)
    ];

    U.uFocus.value.set(focus.x, focus.y);

    const screenVertex = `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `;

    const noiseGLSL = `
      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);

        f = f * f * (3.0 - 2.0 * f);

        return mix(
          mix(
            hash21(i),
            hash21(i + vec2(1.0, 0.0)),
            f.x
          ),
          mix(
            hash21(i + vec2(0.0, 1.0)),
            hash21(i + 1.0),
            f.x
          ),
          f.y
        );
      }

      float fbm(vec2 p) {
        float value = 0.0;
        float weight = 0.5;

        mat2 rotate = mat2(
          0.8, -0.6,
          0.6, 0.8
        );

        for (int i = 0; i < 4; i++) {
          value += weight * noise2(p);
          p = rotate * p * 2.03 + vec2(7.1, 3.8);
          weight *= 0.5;
        }

        return value;
      }
    `;

    function screenMaterial(
      fragment,
      blending = T.NormalBlending
    ) {
      return new T.ShaderMaterial({
        uniforms: U,
        vertexShader: screenVertex,
        fragmentShader: fragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending,
        extensions: { derivatives: true }
      });
    }

    function screenPlane(material, order) {
      const mesh = new T.Mesh(
        new T.PlaneGeometry(2, 2),
        material
      );

      mesh.frustumCulled = false;
      mesh.renderOrder = order;

      scene.add(mesh);

      return mesh;
    }

    screenPlane(
      screenMaterial(noiseGLSL + `
        uniform float uTime;
        uniform float uQCD;

        uniform vec2 uCenter;
        uniform vec2 uSpan;
        uniform vec2 uFocus;

        varying vec2 vUv;

        void main() {
          vec2 world = uCenter + (vUv - 0.5) * uSpan;
          vec2 p = world * 0.046;

          float t = uTime * 0.055;

          vec2 flow = vec2(
            noise2(p + vec2(t, -t * 0.6)),
            noise2(p + vec2(5.3 - t * 0.4, t))
          );

          float fluid = fbm(
            p * 1.8 +
            flow * 2.6 +
            vec2(t * 0.1, -t * 0.18)
          );

          float ridge = pow(
            max(0.0, 1.0 - abs(fluid * 2.0 - 1.0)),
            10.0
          );

          float contour = 0.5 + 0.5 * sin(
            fluid * 36.0 + p.x * 1.7 - t
          );

          contour = pow(contour, 13.0);

          // Lower-band Berry-curvature pattern of a two-band toy model.
          // It is spatially mapped here as an illustrative overlay.
          vec2 k = p * 1.2 + vec2(t * 0.035, -t * 0.02);
          float mass = 0.7;

          vec3 d = vec3(
            sin(k.x),
            sin(k.y),
            mass + cos(k.x) + cos(k.y)
          );

          float omega = -0.5 * (
            cos(k.x) +
            cos(k.y) +
            mass * cos(k.x) * cos(k.y)
          ) / max(pow(length(d), 3.0), 0.025);

          vec3 berry = mix(
            vec3(0.001, 0.004, 0.033),
            vec3(0.026, 0.003, 0.061),
            smoothstep(-0.6, 0.6, omega)
          );

          float extent = 1.0 - smoothstep(
            52.0,
            90.0,
            length(world)
          );

          vec3 gold = vec3(0.8, 0.36, 0.035) * (
            0.012 +
            ridge * 0.055 +
            contour * 0.07
          );

          vec3 color = (berry + gold) *
            extent *
            (1.0 - uQCD * 0.94);

          vec2 core = (world - uFocus) / 0.033;
          float r = length(core);
          float a = atan(core.y, core.x);

          float nuclear = pow(
            0.5 + 0.5 * sin(
              r * 18.0 - a * 3.0 - uTime * 0.7
            ),
            9.0
          );

          float halo = exp(-r * r * 0.8);

          color += uQCD * halo * (
            vec3(0.017, 0.003, 0.033) +
            vec3(0.038, 0.008, 0.07) * nuclear
          );

          gl_FragColor = vec4(color, 1.0);
        }
      `),
      -100
    );

    const ribbonVertex = `
      uniform float uPixelWorld;

      attribute vec2 aStart;
      attribute vec2 aEnd;
      attribute float aDistance;
      attribute float aWidth;
      attribute vec3 aColor;

      varying float vSide;
      varying float vDistance;
      varying vec3 vColor;

      void main() {
        vec2 delta = aEnd - aStart;
        float len = max(length(delta), 0.0000001);

        vec2 normal = vec2(-delta.y, delta.x) / len;

        vec2 p = mix(aStart, aEnd, position.x) +
          normal *
          position.y *
          max(aWidth, uPixelWorld * 0.7);

        vSide = position.y;
        vDistance = aDistance + len * position.x;
        vColor = aColor;

        gl_Position =
          projectionMatrix *
          modelViewMatrix *
          vec4(p, 0.0, 1.0);
      }
    `;

    const ribbonFragment = `
      uniform float uTime;
      uniform float uReveal;
      uniform float uMode;

      varying float vSide;
      varying float vDistance;
      varying vec3 vColor;

      void main() {
        float core = exp(-vSide * vSide * 8.0);
        float glow = exp(-vSide * vSide * 2.1) * 0.24;
        float energy = 0.75;

        if (uMode > 0.5 && uMode < 1.5) {
          energy = 1.6 + 2.6 * pow(
            0.5 + 0.5 * cos(
              vDistance * 0.62 - uTime * 2.0
            ),
            16.0
          );
        }

        if (uMode > 1.5) {
          energy = 2.3 + 2.0 * pow(
            0.5 + 0.5 * sin(
              vDistance * 1150.0 - uTime * 10.0
            ),
            12.0
          );
        }

        float edge = 1.0 - smoothstep(
          0.72,
          1.0,
          abs(vSide)
        );

        gl_FragColor = vec4(
          vColor * energy * (0.42 + core),
          uReveal * (core + glow) * edge
        );
      }
    `;

    const quad = [
      0, -1,
      1, -1,
      0, 1,
      0, 1,
      1, -1,
      1, 1
    ];

    function ribbon(
      segments,
      halfWidth,
      color,
      reveal,
      kind = 0,
      order = 10
    ) {
      const count = segments.length * 6;

      const positions = new Float32Array(count * 3);
      const starts = new Float32Array(count * 2);
      const ends = new Float32Array(count * 2);
      const distances = new Float32Array(count);
      const widths = new Float32Array(count);
      const colors = new Float32Array(count * 3);

      const base = rgb(color);
      const geometry = new T.BufferGeometry();

      for (let s = 0; s < segments.length; s++) {
        for (let v = 0; v < 6; v++) {
          const n = s * 6 + v;
          const edge = segments[s];
          const c = edge.color || base;

          positions[n * 3] = quad[v * 2];
          positions[n * 3 + 1] = quad[v * 2 + 1];

          starts[n * 2] = edge.ax;
          starts[n * 2 + 1] = edge.ay;

          ends[n * 2] = edge.bx;
          ends[n * 2 + 1] = edge.by;

          distances[n] = edge.distance || 0;
          widths[n] = halfWidth;

          colors[n * 3] = c.r;
          colors[n * 3 + 1] = c.g;
          colors[n * 3 + 2] = c.b;
        }
      }

      geometry.setAttribute(
        'position',
        new T.BufferAttribute(positions, 3)
      );

      geometry.setAttribute(
        'aStart',
        new T.BufferAttribute(starts, 2)
          .setUsage(T.DynamicDrawUsage)
      );

      geometry.setAttribute(
        'aEnd',
        new T.BufferAttribute(ends, 2)
          .setUsage(T.DynamicDrawUsage)
      );

      geometry.setAttribute(
        'aDistance',
        new T.BufferAttribute(distances, 1)
          .setUsage(T.DynamicDrawUsage)
      );

      geometry.setAttribute(
        'aWidth',
        new T.BufferAttribute(widths, 1)
      );

      geometry.setAttribute(
        'aColor',
        new T.BufferAttribute(colors, 3)
      );

      const material = new T.ShaderMaterial({
        uniforms: {
          uTime: U.uTime,
          uPixelWorld: U.uPixelWorld,
          uReveal: reveal,
          uMode: { value: kind }
        },
        vertexShader: ribbonVertex,
        fragmentShader: ribbonFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const mesh = new T.Mesh(geometry, material);

      mesh.frustumCulled = false;
      mesh.renderOrder = order;

      scene.add(mesh);

      return mesh;
    }

    function segmentsFrom(points) {
      let distance = 0;

      return points.slice(1).map((point, i) => {
        const a = points[i];

        const edge = {
          ax: a.x,
          ay: a.y,
          bx: point.x,
          by: point.y,
          distance
        };

        distance += Math.hypot(
          point.x - a.x,
          point.y - a.y
        );

        return edge;
      });
    }

    const bonds = lattice.edges.map(edge => {
      const a = lattice.vertices[edge.a];
      const b = lattice.vertices[edge.b];

      return {
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y
      };
    });

    ribbon(bonds, 0.055, 0x36dfff, macro, 0, 10);

    const perimeter = lattice.loop.map(
      index => lattice.vertices[index]
    );

    const edgeSegments = segmentsFrom(perimeter);

    const perimeterLength = edgeSegments.reduce(
      (sum, edge) => sum + Math.hypot(
        edge.bx - edge.ax,
        edge.by - edge.ay
      ),
      0
    );

    ribbon(
      edgeSegments,
      0.105,
      0xff6b24,
      macro,
      1,
      24
    );

    const molecular = [];

    lattice.centers.forEach((center, index) => {
      if (index % 7 !== 0) return;

      const path = [];

      for (let k = 0; k <= 72; k++) {
        const angle = k / 72 * TAU;

        path.push({
          x: center.x + Math.cos(angle) * 1.32,
          y: center.y + Math.sin(angle) * 1.32
        });
      }

      molecular.push(...segmentsFrom(path));
    });

    ribbon(molecular, 0.026, 0x255e8c, macro, 0, 8);

    const pointVertex = `
      uniform float uPixels;
      uniform float uPointLimit;

      attribute float aSize;
      attribute float aPhase;
      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vPhase;

      void main() {
        vColor = aColor;
        vPhase = aPhase;

        gl_PointSize = clamp(
          aSize * uPixels,
          1.0,
          uPointLimit
        );

        gl_Position =
          projectionMatrix *
          modelViewMatrix *
          vec4(position, 1.0);
      }
    `;

    const pointFragment = `
      uniform float uTime;
      uniform float uReveal;
      uniform float uKind;

      varying vec3 vColor;
      varying float vPhase;

      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);

        if (r >= 1.0) discard;

        float core = exp(-r * r * 18.0);
        float halo = exp(-r * r * 4.0);

        float pulse = 0.88 + 0.12 * sin(
          uTime * 2.0 + vPhase
        );

        float rings = pow(
          0.5 + 0.5 * cos(r * 28.0 - uTime * 0.4),
          8.0
        ) * halo;

        vec3 color = vColor *
          (0.8 + core * 2.4) *
          pulse;

        if (uKind > 0.5) {
          color += vec3(1.0, 0.92, 0.8) * core * 1.8;
        }

        gl_FragColor = vec4(
          color,
          uReveal *
          (halo + core + 0.15 * rings) *
          (1.0 - smoothstep(0.7, 1.0, r))
        );
      }
    `;

    function points(
      entries,
      reveal,
      kind = 0,
      order = 30
    ) {
      const positions = [];
      const colors = [];
      const sizes = [];
      const phases = [];

      for (const item of entries) {
        const color = rgb(item.color);

        positions.push(item.x, item.y, 0);
        colors.push(color.r, color.g, color.b);
        sizes.push(item.size);
        phases.push(random() * TAU);
      }

      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        'position',
        new T.Float32BufferAttribute(positions, 3)
          .setUsage(T.DynamicDrawUsage)
      );

      geometry.setAttribute(
        'aColor',
        new T.Float32BufferAttribute(colors, 3)
      );

      geometry.setAttribute(
        'aSize',
        new T.Float32BufferAttribute(sizes, 1)
      );

      geometry.setAttribute(
        'aPhase',
        new T.Float32BufferAttribute(phases, 1)
      );

      const material = new T.ShaderMaterial({
        uniforms: {
          uTime: U.uTime,
          uPixels: U.uPixels,
          uPointLimit: U.uPointLimit,
          uReveal: reveal,
          uKind: { value: kind }
        },
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const object = new T.Points(geometry, material);

      object.frustumCulled = false;
      object.renderOrder = order;

      scene.add(object);

      return object;
    }

    points(
      lattice.vertices.map((point, i) => ({
        ...point,
        size: 0.62,
        color: i % 2 ? 0x69ecff : 0x95caff
      })),
      macro,
      0,
      20
    );

    const vacuum = [];

    for (let i = 0; i < 6200; i++) {
      const angle = random() * TAU;
      const radius = Math.sqrt(random()) * 70;

      vacuum.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        size: 0.04 + random() * 0.09,
        color: i % 3 ? 0x124158 : 0x28416b
      });
    }

    points(vacuum, dustReveal, 0, 2);

    const waveMaterial = new T.ShaderMaterial({
      uniforms: {
        uTime: U.uTime,
        uReveal: macro
      },

      vertexShader: `
        attribute vec2 aCenter;
        attribute float aRadius;
        attribute float aPhase;

        varying vec2 vLocal;
        varying float vPhase;

        void main() {
          vLocal = position.xy * 2.0;
          vPhase = aPhase;

          vec2 p = aCenter +
            position.xy * aRadius * 2.0;

          gl_Position =
            projectionMatrix *
            modelViewMatrix *
            vec4(p, 0.0, 1.0);
        }
      `,

      fragmentShader: `
        uniform float uTime;
        uniform float uReveal;

        varying vec2 vLocal;
        varying float vPhase;

        void main() {
          vec2 p = vLocal;
          float r = length(p);

          if (r > 1.0) discard;

          vec2 psi = vec2(0.0);

          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float a = fi * 2.094 + vPhase;

            vec2 axis = vec2(cos(a), sin(a));

            vec2 center = axis *
              0.26 *
              sin(uTime * 0.28 + fi);

            float envelope = exp(
              -dot(p - center, p - center) * 4.5
            );

            float phase =
              dot(p, axis) * (18.0 + fi * 4.0) -
              uTime * (1.1 + fi * 0.13) +
              vPhase;

            psi += envelope *
              vec2(cos(phase), sin(phase));
          }

          float probability = dot(psi, psi) / 9.0;
          float fringe = pow(probability, 0.7);

          vec3 color = mix(
            vec3(0.03, 0.34, 0.85),
            vec3(0.1, 1.2, 1.55),
            probability
          );

          color += vec3(0.6, 0.03, 0.85) *
            pow(probability, 3.0) *
            0.3;

          gl_FragColor = vec4(
            color,
            fringe *
            uReveal *
            0.62 *
            (1.0 - smoothstep(0.65, 1.0, r))
          );
        }
      `,

      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: T.AdditiveBlending
    });

    function waveClouds(entries, material, order) {
      const geometry = new T.InstancedBufferGeometry()
        .copy(new T.PlaneGeometry(1, 1));

      const centers = [];
      const radii = [];
      const phases = [];

      entries.forEach(entry => {
        centers.push(entry.x, entry.y);
        radii.push(entry.radius);
        phases.push(random() * TAU);
      });

      geometry.setAttribute(
        'aCenter',
        new T.InstancedBufferAttribute(
          new Float32Array(centers),
          2
        )
      );

      geometry.setAttribute(
        'aRadius',
        new T.InstancedBufferAttribute(
          new Float32Array(radii),
          1
        )
      );

      geometry.setAttribute(
        'aPhase',
        new T.InstancedBufferAttribute(
          new Float32Array(phases),
          1
        )
      );

      geometry.instanceCount = entries.length;

      const mesh = new T.Mesh(geometry, material);

      mesh.frustumCulled = false;
      mesh.renderOrder = order;

      scene.add(mesh);
    }

    waveClouds(
      lattice.vertices
        .filter((point, index) => index % 11 === 0)
        .map(point => ({
          ...point,
          radius: 2.25
        })),
      waveMaterial,
      16
    );

    const atomWave = waveMaterial.clone();

    atomWave.uniforms.uTime = U.uTime;
    atomWave.uniforms.uReveal = atomic;

    waveClouds(
      [{ ...focus, radius: 1.2 }],
      atomWave,
      40
    );

    const levelSegments = [];

    defects.forEach(center => {
      for (let n = 0; n < 4; n++) {
        const radius = 1.35 * Math.sqrt(2 * n + 1);
        const path = [];

        for (let i = 0; i <= 160; i++) {
          const angle = i / 160 * TAU;

          path.push({
            x: center.x + radius * (
              Math.cos(angle) +
              0.045 * Math.sin(3 * angle)
            ),
            y: center.y + radius * (
              Math.sin(angle) +
              0.045 * Math.sin(2 * angle)
            )
          });
        }

        levelSegments.push(...segmentsFrom(path));
      }
    });

    ribbon(
      levelSegments,
      0.035,
      0xae6cff,
      macro,
      0,
      32
    );

    function parameterStrip(count) {
      const positions = [];

      for (let i = 0; i < count; i++) {
        for (let k = 0; k < 6; k++) {
          positions.push(
            (i + quad[k * 2]) / count,
            quad[k * 2 + 1],
            0
          );
        }
      }

      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        'position',
        new T.Float32BufferAttribute(positions, 3)
      );

      return geometry;
    }

    const trailGeometry = parameterStrip(180);

    const braidVertex = `
      uniform float uTime;
      uniform float uPhase;
      uniform float uPixelWorld;

      uniform vec2 uDefect;

      varying float vAge;
      varying float vSide;

      vec2 orbit(float t) {
        float a = t * 0.5 + uPhase;

        return uDefect + vec2(
          cos(a) * (2.5 + 0.45 * cos(t * 0.23)),
          sin(a) * (2.05 + 0.32 * sin(t * 0.23))
        ) + vec2(
          0.34 * sin(a * 2.0),
          0.23 * cos(a * 3.0)
        );
      }

      void main() {
        float t = uTime - (1.0 - position.x) * 8.5;

        vec2 p = orbit(t);
        vec2 delta = orbit(t + 0.01) - orbit(t - 0.01);

        vec2 normal = normalize(
          vec2(-delta.y, delta.x)
        );

        p += normal *
          position.y *
          max(0.047, uPixelWorld * 0.75);

        vAge = position.x;
        vSide = position.y;

        gl_Position =
          projectionMatrix *
          modelViewMatrix *
          vec4(p, 0.0, 1.0);
      }
    `;

    defects.forEach((center, i) => {
      for (let pair = 0; pair < 2; pair++) {
        const material = new T.ShaderMaterial({
          uniforms: {
            uTime: U.uTime,
            uPixelWorld: U.uPixelWorld,
            uReveal: macro,
            uPhase: {
              value: pair * Math.PI + i * 0.8
            },
            uDefect: {
              value: new T.Vector2(center.x, center.y)
            },
            uColor: {
              value: pair
                ? new T.Vector3(1.3, 0.035, 1.6)
                : new T.Vector3(0.04, 1.2, 1.5)
            }
          },

          vertexShader: braidVertex,

          fragmentShader: `
            uniform float uReveal;
            uniform vec3 uColor;

            varying float vAge;
            varying float vSide;

            void main() {
              float profile = exp(-vSide * vSide * 7.0);
              float tail = pow(vAge, 1.7);

              gl_FragColor = vec4(
                uColor * (0.8 + tail * 1.3),
                profile *
                tail *
                uReveal *
                (1.0 - smoothstep(0.75, 1.0, abs(vSide)))
              );
            }
          `,

          transparent: true,
          depthTest: false,
          depthWrite: false,
          blending: T.AdditiveBlending
        });

        const mesh = new T.Mesh(
          trailGeometry,
          material
        );

        mesh.frustumCulled = false;
        mesh.renderOrder = 35;

        scene.add(mesh);
      }
    });

    const carrierEntries = Array.from(
      { length: 9 },
      () => ({
        x: 0,
        y: 0,
        size: 0.66,
        color: 0xffb34b
      })
    );

    const carriers = points(
      carrierEntries,
      macro,
      1,
      28
    );

    function edgePoint(distance, out) {
      distance = (
        (distance % perimeterLength) +
        perimeterLength
      ) % perimeterLength;

      for (const edge of edgeSegments) {
        const length = Math.hypot(
          edge.bx - edge.ax,
          edge.by - edge.ay
        );

        if (distance <= length) {
          const u = distance / length;

          out.set(
            mix(edge.ax, edge.bx, u),
            mix(edge.ay, edge.by, u),
            0
          );

          return;
        }

        distance -= length;
      }

      out.set(perimeter[0].x, perimeter[0].y, 0);
    }

    const coreGroup = new T.Group();
    coreGroup.position.set(focus.x, focus.y, 0);
    scene.add(coreGroup);

    const quarkColors = [
      0xff3655,
      0x39ff9b,
      0x5489ff
    ];

    const quarkData = quarkColors.map(color => ({
      x: 0,
      y: 0,
      size: 0.0064,
      color
    }));

    const quarks = points(
      quarkData,
      qcd,
      1,
      72
    );

    coreGroup.add(quarks);

    const quarkPositions = Array.from(
      { length: 3 },
      () => new T.Vector2()
    );

    const armColors = quarkColors.map(rgb);
    const junction = new T.Vector2();
    const fluxSegments = [];

    for (let arm = 0; arm < 3; arm++) {
      for (let k = 0; k < 72; k++) {
        fluxSegments.push({
          ax: 0,
          ay: 0,
          bx: 0,
          by: 0,
          distance: 0,
          color: armColors[arm]
        });
      }
    }

    const gluons = ribbon(
      fluxSegments,
      0.00062,
      0xffffff,
      qcd,
      2,
      66
    );

    coreGroup.add(gluons);

    const quarkLabels = [];

    ['u', 'u', 'd'].forEach((flavor, i) => {
      const element = document.createElement('span');

      element.className =
        'charge-tag charge-tag--' +
        ['red', 'green', 'blue'][i];

      element.textContent =
        flavor + ' · ' + ['r', 'g', 'b'][i];

      Object.assign(element.style, {
        width: 'auto',
        height: '23px',
        padding: '0 7px',
        fontSize: '11px',
        background: 'rgba(3,4,12,0.94)',
        pointerEvents: 'none'
      });

      const object = new T.CSS2DObject(element);

      scene.add(object);
      quarkLabels.push(object);
    });

    function updateCore() {
      const stretch = 1 + 0.2 * Math.pow(
        0.5 + 0.5 * Math.sin(time * 0.61),
        9
      );

      junction.set(
        0.0012 * Math.sin(time * 0.73),
        0.001 * Math.cos(time * 0.59)
      );

      let tension = 0;

      for (let i = 0; i < 3; i++) {
        const angle =
          TAU * i / 3 +
          0.22 * Math.sin(time * 0.31) +
          0.065 * Math.sin(time * 1.2 + i);

        const radius = (
          0.015 +
          0.0014 * Math.sin(time * 0.84 + i * 2)
        ) * stretch;

        quarkPositions[i].set(
          Math.cos(angle) * radius,
          Math.sin(angle) * radius
        );

        const p = quarkPositions[i];
        const q = quarks.geometry.attributes.position.array;

        q[i * 3] = p.x;
        q[i * 3 + 1] = p.y;

        const length = p.distanceTo(junction);
        tension += length;

        const bend = 0.002 * Math.sin(time * 1.7 + i * 2);
        const nx = -(p.y - junction.y) / length;
        const ny = (p.x - junction.x) / length;

        const control1 = {
          x: mix(junction.x, p.x, 0.33) + nx * bend,
          y: mix(junction.y, p.y, 0.33) + ny * bend
        };

        const control2 = {
          x: mix(junction.x, p.x, 0.7) - nx * bend * 0.65,
          y: mix(junction.y, p.y, 0.7) - ny * bend * 0.65
        };

        let ax = junction.x;
        let ay = junction.y;
        let distance = 0;

        for (let k = 0; k < 72; k++) {
          const u = (k + 1) / 72;
          const v = 1 - u;

          const bx =
            v * v * v * junction.x +
            3 * v * v * u * control1.x +
            3 * v * u * u * control2.x +
            u * u * u * p.x;

          const by =
            v * v * v * junction.y +
            3 * v * v * u * control1.y +
            3 * v * u * u * control2.y +
            u * u * u * p.y;

          const index = i * 72 + k;
          const attributes = gluons.geometry.attributes;

          for (let vertex = 0; vertex < 6; vertex++) {
            const n = index * 6 + vertex;

            attributes.aStart.array[n * 2] = ax;
            attributes.aStart.array[n * 2 + 1] = ay;

            attributes.aEnd.array[n * 2] = bx;
            attributes.aEnd.array[n * 2 + 1] = by;

            attributes.aDistance.array[n] = distance;
          }

          distance += Math.hypot(bx - ax, by - ay);
          ax = bx;
          ay = by;
        }

        quarkLabels[i].position.set(
          focus.x + p.x,
          focus.y + p.y + 0.0048,
          0
        );

        quarkLabels[i].visible =
          hud &&
          U.uQCD.value > 0.35 &&
          camera.zoom > 110;
      }

      quarks.geometry.attributes.position.needsUpdate = true;

      ['aStart', 'aEnd', 'aDistance'].forEach(name => {
        gluons.geometry.attributes[name].needsUpdate = true;
      });

      fluxIntensity =
        clamp((tension / 3 - 0.011) / 0.009, 0, 1) *
        U.uQCD.value;
    }

    screenPlane(
      screenMaterial(`
        uniform float uTime;
        uniform vec2 uResolution;

        varying vec2 vUv;

        void main() {
          float aspect = uResolution.x / uResolution.y;

          vec2 p = (vUv - 0.5) * vec2(aspect, 1.0);
          vec2 direction = normalize(vec2(1.0, 0.12));

          float x = dot(p, direction);

          float y = dot(
            p,
            vec2(-direction.y, direction.x)
          );

          float reach = aspect * 0.65 + 0.3;
          float light = 0.0;

          for (int i = 0; i < 4; i++) {
            float fi = float(i);

            float phase = fract(
              uTime * (0.32 + fi * 0.013) +
              fi * 0.239
            );

            float head = mix(-reach, reach, phase);
            float delta = x - head;
            float aa = max(fwidth(x), 0.0005);

            float front = exp(
              -pow(delta / (aa * 1.6), 2.0)
            );

            float tail = exp(-abs(delta) * 90.0) *
              pow(
                0.5 + 0.5 * cos(delta * 900.0),
                8.0
              );

            float lane = exp(
              -pow(
                (y - (-0.36 + fi * 0.24)) / 0.045,
                2.0
              )
            );

            float gate =
              smoothstep(0.0, 0.06, phase) *
              (1.0 - smoothstep(0.94, 1.0, phase));

            light +=
              (front * 0.7 + tail * 0.22) *
              lane *
              gate;
          }

          gl_FragColor = vec4(
            vec3(0.72, 0.87, 1.0) * light,
            0.6
          );
        }
      `, T.AdditiveBlending),
      90
    );

    const annotations = [];
    const projected = new T.Vector3();

    function addAnnotation(
      template,
      anchor,
      color,
      kind
    ) {
      const root = document.createElement('div');

      Object.assign(root.style, {
        width: '0px',
        height: '0px',
        pointerEvents: 'none'
      });

      const card = $(template)
        .content
        .firstElementChild
        .cloneNode(true);

      card.style.position = 'absolute';
      root.appendChild(card);

      labelRenderer.domElement.appendChild(root);

      const object = new T.CSS2DObject(root);
      scene.add(object);

      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        'position',
        new T.BufferAttribute(new Float32Array(6), 3)
      );

      const leader = new T.Line(
        geometry,
        new T.LineBasicMaterial({
          color: rgb(color),
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false
        })
      );

      leader.frustumCulled = false;
      leader.renderOrder = 85;

      scene.add(leader);

      card.addEventListener('pointerdown', event => {
        event.stopPropagation();
        enterManual();
      });

      card.addEventListener('focus', enterManual);

      const entry = {
        root,
        card,
        object,
        leader,
        anchor: new T.Vector3(anchor.x, anchor.y, 0),
        kind,
        opacity: 0
      };

      annotations.push(entry);

      return entry;
    }

    addAnnotation(
      'dirac-label-template',
      defects[0],
      0x59eaff,
      'dirac'
    );

    addAnnotation(
      'qcd-label-template',
      focus,
      0xf283ff,
      'qcd'
    );

    addAnnotation(
      'higgs-label-template',
      { x: -22, y: -24 },
      0xffd07a,
      'higgs'
    );

    /*
     * OrbitControls owns a proxy camera during manual inspection.
     * The rendering camera follows it smoothly, including wheel zoom.
     * Automatic flight never invokes controls.update().
     */
    const controlCamera = camera.clone();

    const controls = new T.OrbitControls(
      controlCamera,
      renderer.domElement
    );

    controls.enableRotate = false;
    controls.enablePan = true;
    controls.enableZoom = true;
    controls.screenSpacePanning = true;
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 0.7;
    controls.minZoom = MIN_ZOOM;
    controls.maxZoom = MAX_ZOOM;

    controls.mouseButtons.LEFT = T.MOUSE.PAN;
    controls.mouseButtons.MIDDLE = T.MOUSE.DOLLY;
    controls.mouseButtons.RIGHT = T.MOUSE.PAN;

    controls.touches.ONE = T.TOUCH.PAN;
    controls.touches.TWO = T.TOUCH.DOLLY_PAN;

    const desired = {
      x: 0,
      y: 0,
      zoom: 1
    };

    const edgeView = perimeter[
      Math.floor(perimeter.length * 0.22)
    ];

    const route = [
      [0, -2, 0, 0.92],
      [20, edgeView.x * 0.78, edgeView.y * 0.78, 1.5],
      [38, defects[0].x, defects[0].y, 2.7],
      [55, focus.x + 1.8, focus.y + 0.8, 7],
      [70, focus.x + 0.1, focus.y + 0.03, 42],
      [90, focus.x, focus.y, 720],
      [112, focus.x, focus.y, 900],
      [132, focus.x, focus.y, 240],
      [151, focus.x, focus.y, 9],
      [180, -2, 0, 0.92]
    ];

    function sampleRoute() {
      const t = (
        (flight % PERIOD) +
        PERIOD
      ) % PERIOD;

      let index = 0;

      while (
        index < route.length - 2 &&
        t > route[index + 1][0]
      ) {
        index++;
      }

      const a = route[index];
      const b = route[index + 1];

      const u = ease(
        clamp(
          (t - a[0]) / (b[0] - a[0]),
          0,
          1
        )
      );

      const zoom = Math.exp(
        mix(Math.log(a[3]), Math.log(b[3]), u)
      );

      const spanY = HEIGHT / zoom;
      const spanX = spanY * width / height;
      const oscillation = TAU * t / PERIOD;

      let offset = 0;

      if (hud && width > 700) {
        const panelRight = ui.panel.getBoundingClientRect().right;

        offset = Math.min(
          0.2,
          (panelRight + 20) / (2 * width)
        );
      }

      desired.x =
        mix(a[1], b[1], u) +
        spanY * 0.025 * Math.sin(oscillation) -
        spanX * offset;

      desired.y =
        mix(a[2], b[2], u) +
        spanY * 0.015 * Math.sin(oscillation * 2);

      desired.zoom = zoom;
    }

    function setControlPose() {
      controlCamera.position.copy(camera.position);
      controlCamera.quaternion.identity();
      controlCamera.zoom = camera.zoom;

      controlCamera.updateProjectionMatrix();
      controlCamera.updateMatrixWorld(true);

      controls.target.set(
        camera.position.x,
        camera.position.y,
        0
      );
    }

    function flushControls() {
      const position = camera.position.clone();
      const zoom = camera.zoom;

      controls.enableDamping = false;
      controls.saveState();
      controls.reset();

      camera.position.copy(position);
      camera.zoom = zoom;
      camera.quaternion.identity();
      camera.updateProjectionMatrix();

      setControlPose();

      controls.enableDamping = true;
    }

    function enterManual() {
      if (manual && !returning) return;

      manual = true;
      returning = null;
      coast = paused ? 0 : 1;

      setControlPose();
      lastUI = -Infinity;
    }

    function resumeDrift() {
      flushControls();
      sampleRoute();

      const from = {
        x: camera.position.x,
        y: camera.position.y,
        zoom: camera.zoom
      };

      const to = { ...desired };

      const distance = Math.hypot(
        from.x - to.x,
        from.y - to.y
      );

      const wide = clamp(
        Math.min(
          from.zoom,
          to.zoom,
          HEIGHT / (
            distance * 1.5 +
            HEIGHT / to.zoom
          )
        ),
        MIN_ZOOM,
        MAX_ZOOM
      );

      returning = {
        from,
        to,
        wide,
        elapsed: 0,

        duration: clamp(
          2.4 +
          Math.abs(Math.log(to.zoom / from.zoom)) * 0.36 +
          distance * 0.015,
          2.4,
          6.5
        ),

        staged:
          distance >
          HEIGHT / Math.max(from.zoom, to.zoom) * 0.7
      };

      paused = false;
      manual = false;
      coast = 0;
      lastUI = -Infinity;
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

    renderer.domElement.addEventListener(
      'touchstart',
      enterManual,
      { capture: true, passive: true }
    );

    function pauseToggle() {
      paused = !paused;

      if (paused) coast = 0;

      lastUI = -Infinity;
    }

    function hudToggle() {
      hud = !hud;

      document.body.classList.toggle('hud-hidden', !hud);

      ui.hud.textContent = hud ? 'Hide HUD' : 'Show HUD';
      ui.hud.setAttribute('aria-expanded', String(hud));
      ui.panel.setAttribute('aria-hidden', String(!hud));

      lastUI = -Infinity;
    }

    ui.pause.addEventListener('click', pauseToggle);
    ui.resume.addEventListener('click', resumeDrift);
    ui.hud.addEventListener('click', hudToggle);

    window.addEventListener('keydown', event => {
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
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
        pauseToggle();
      } else if (event.code === 'KeyR') {
        resumeDrift();
      } else if (event.code === 'KeyH') {
        hudToggle();
      }
    });

    const target = new T.WebGLRenderTarget(1, 1, {
      type: targetType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(
      renderer,
      target
    );

    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      1.02,
      0.52,
      hdr ? 0.95 : 0.78
    );

    bloom.renderTargetBright.texture.type = targetType;

    bloom.renderTargetsHorizontal.forEach(renderTarget => {
      renderTarget.texture.type = targetType;
    });

    bloom.renderTargetsVertical.forEach(renderTarget => {
      renderTarget.texture.type = targetType;
    });

    composer.addPass(bloom);

    const grade = new T.ShaderPass({
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

        vec3 srgb(vec3 x) {
          return mix(
            x * 12.92,
            1.055 *
              pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) -
              0.055,
            step(vec3(0.0031308), x)
          );
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb;

          color *= 1.0 - 0.17 * smoothstep(
            0.25,
            0.72,
            length(vUv - 0.5)
          );

          gl_FragColor = vec4(
            srgb(aces(color * 1.02)),
            1.0
          );
        }
      `
    });

    composer.addPass(grade);

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      const half = HEIGHT / 2;
      const aspect = width / height;

      for (const currentCamera of [camera, controlCamera]) {
        currentCamera.left = -half * aspect;
        currentCamera.right = half * aspect;
        currentCamera.top = half;
        currentCamera.bottom = -half;
        currentCamera.updateProjectionMatrix();
      }

      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);

      composer.setPixelRatio(dpr);
      composer.setSize(width, height);

      bloom.setSize(
        Math.ceil(width * dpr * 0.72),
        Math.ceil(height * dpr * 0.72)
      );

      fxaa.uniforms.resolution.value.set(
        1 / (width * dpr),
        1 / (height * dpr)
      );

      labelRenderer.setSize(width, height);
      U.uResolution.value.set(width * dpr, height * dpr);

      lastUI = -Infinity;
    }

    window.addEventListener('resize', resize);

    resize();
    sampleRoute();

    camera.position.set(desired.x, desired.y, 100);
    camera.zoom = desired.zoom;

    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);

    setControlPose();

    function overlaps(a, b, padding = 0) {
      return (
        a.left < b.right + padding &&
        a.right > b.left - padding &&
        a.top < b.bottom + padding &&
        a.bottom > b.top - padding
      );
    }

    function updateLabels(dt) {
      const occupied = [];

      if (hud) {
        occupied.push(
          ui.panel.getBoundingClientRect(),
          ui.controls.getBoundingClientRect(),
          ui.caption.getBoundingClientRect()
        );
      }

      const ordered = annotations.slice().sort(
        (a, b) =>
          (a.kind === 'qcd' ? -1 : 0) -
          (b.kind === 'qcd' ? -1 : 0)
      );

      for (const annotation of ordered) {
        const level = annotation.kind === 'qcd'
          ? U.uQCD.value
          : annotation.kind === 'dirac'
            ? macro.value
            : (
              1 - smooth(1.8, 5, camera.zoom)
            ) * 0.88;

        annotation.object.position.copy(annotation.anchor);

        projected
          .copy(annotation.anchor)
          .project(camera);

        const sx = (projected.x * 0.5 + 0.5) * width;
        const sy = (-projected.y * 0.5 + 0.5) * height;

        const cardWidth = annotation.card.offsetWidth || 300;
        const cardHeight = annotation.card.offsetHeight || 260;

        const choices = [
          {
            left: sx + 24,
            top: sy - cardHeight * 0.5
          },
          {
            left: sx - cardWidth - 24,
            top: sy - cardHeight * 0.5
          },
          {
            left: sx - cardWidth * 0.5,
            top: sy - cardHeight - 24
          },
          {
            left: sx - cardWidth * 0.5,
            top: sy + 24
          }
        ];

        let chosen = null;

        if (
          hud &&
          level > 0.08 &&
          projected.z > -1 &&
          projected.z < 1 &&
          sx > 0 &&
          sx < width &&
          sy > 0 &&
          sy < height
        ) {
          for (const choice of choices) {
            const rect = {
              ...choice,
              right: choice.left + cardWidth,
              bottom: choice.top + cardHeight
            };

            if (
              rect.left < 12 ||
              rect.right > width - 12 ||
              rect.top < 72 ||
              rect.bottom > height - 18
            ) {
              continue;
            }

            if (
              occupied.some(
                obstacle => overlaps(rect, obstacle, 12)
              )
            ) {
              continue;
            }

            chosen = rect;
            occupied.push(rect);
            break;
          }
        }

        if (chosen) {
          annotation.card.style.left =
            (chosen.left - sx) + 'px';

          annotation.card.style.top =
            (chosen.top - sy) + 'px';

          const ex = clamp(
            sx,
            chosen.left,
            chosen.right
          );

          const ey = clamp(
            sy,
            chosen.top,
            chosen.bottom
          );

          const positions =
            annotation.leader.geometry.attributes.position.array;

          positions[0] = annotation.anchor.x;
          positions[1] = annotation.anchor.y;
          positions[2] = 0;

          positions[3] =
            camera.position.x +
            (ex - width / 2) / pixelsPerUnit;

          positions[4] =
            camera.position.y -
            (ey - height / 2) / pixelsPerUnit;

          positions[5] = 0;

          annotation.leader.geometry
            .attributes.position.needsUpdate = true;
        }

        annotation.opacity = mix(
          annotation.opacity,
          chosen ? level : 0,
          1 - Math.exp(-dt * 10)
        );

        annotation.object.visible =
          annotation.opacity > 0.01;

        annotation.root.style.opacity =
          String(annotation.opacity);

        annotation.card.style.pointerEvents =
          annotation.opacity > 0.7 ? 'auto' : 'none';

        annotation.card.tabIndex =
          annotation.opacity > 0.7 ? 0 : -1;

        annotation.leader.visible =
          annotation.object.visible;

        annotation.leader.material.opacity =
          annotation.opacity * 0.42;
      }
    }

    function updateHUD(stamp) {
      if (stamp - lastUI < 140) return;

      lastUI = stamp;

      const zoom = camera.zoom;
      const deep = U.uQCD.value > 0.4;

      const progress = clamp(
        Math.log(Math.max(1, zoom)) / Math.log(900),
        0,
        1
      );

      ui.zoom.textContent =
        zoom.toFixed(zoom < 10 ? 2 : 1) + '×';

      ui.scale.textContent = zoom < 5
        ? 'MACROSCOPIC'
        : zoom < 45
          ? 'ATOMIC DETAIL'
          : zoom < 160
            ? 'NUCLEAR TRANSITION'
            : 'SUBATOMIC';

      ui.fill.style.transform =
        'scaleX(' + progress + ')';

      ui.progress.setAttribute(
        'aria-valuenow',
        String(Math.round(progress * 100))
      );

      ui.field.textContent = deep
        ? 'QCD / SU(3)'
        : zoom > 8
          ? 'QED / ATOMIC'
          : 'QED / GRAPHENE';

      ui.fermi.textContent = '+0.150 eV';
      ui.charge.textContent = '|q*| = e / 3';

      ui.flux.textContent =
        fluxIntensity.toFixed(3) + ' a.u.';

      ui.fluxFill.style.transform =
        'scaleX(' + fluxIntensity + ')';

      ui.mode.textContent = paused
        ? 'PAUSED / ' + (manual ? 'MANUAL' : 'AUTO')
        : returning
          ? 'RETURNING TO DRIFT'
          : manual
            ? 'MANUAL MAP INSPECTION'
            : 'AUTOMATIC DRIFT';

      ui.pause.textContent = paused ? 'Play' : 'Pause';

      ui.pause.setAttribute(
        'aria-pressed',
        String(paused)
      );

      const active = deep ? 'qcd' : 'condensed';

      ui.layers.forEach(item => {
        const enabled = item.dataset.layer === active;

        item.classList.toggle('is-active', enabled);

        if (enabled) {
          item.setAttribute('aria-current', 'step');
        } else {
          item.removeAttribute('aria-current');
        }
      });

      ui.chapter.textContent = deep
        ? '03 / CHROMODYNAMIC CORE'
        : zoom > 8
          ? '02 / ATOMIC TRANSITION'
          : '01 / CONDENSED MATTER';

      ui.title.textContent = deep
        ? 'Color confined. Flavor revealed.'
        : zoom > 8
          ? 'Through the probability cloud.'
          : 'A lattice of quantum possibilities.';

      ui.description.textContent = deep
        ? 'Inside one proton: three valence quarks and schematic Y-shaped color flux.'
        : zoom > 8
          ? 'A continuous visual transition into the selected nucleus.'
          : 'Cyan bonds, probability clouds, and chiral boundary currents.';

      const ruler = document.querySelector('.scale-bracket');

      const span = (
        ruler
          ? ruler.getBoundingClientRect().width
          : 110
      ) / pixelsPerUnit;

      const spanText = span >= 10
        ? span.toFixed(1)
        : span >= 1
          ? span.toFixed(2)
          : span.toPrecision(3);

      ui.ruler.textContent = spanText + ' scene units';
    }

    const scratch = new T.Vector3();

    function animate(stamp) {
      requestAnimationFrame(animate);

      if (document.hidden || lost) {
        lastStamp = 0;
        return;
      }

      const dt = lastStamp
        ? Math.min((stamp - lastStamp) / 1000, 0.05)
        : 0;

      lastStamp = stamp;

      before.set(
        camera.position.x,
        camera.position.y,
        Math.log(camera.zoom)
      );

      if (!paused && !returning) {
        time += dt;

        if (!manual) {
          flight += dt;
        }
      }

      if (returning) {
        if (!paused) {
          returning.elapsed += dt;
        }

        const state = returning;

        const u = clamp(
          state.elapsed / state.duration,
          0,
          1
        );

        let panAmount = ease(u);
        let logZoom;

        if (state.staged) {
          if (u < 0.28) {
            panAmount = 0;

            logZoom = mix(
              Math.log(state.from.zoom),
              Math.log(state.wide),
              ease(u / 0.28)
            );
          } else if (u < 0.72) {
            panAmount = ease((u - 0.28) / 0.44);
            logZoom = Math.log(state.wide);
          } else {
            panAmount = 1;

            logZoom = mix(
              Math.log(state.wide),
              Math.log(state.to.zoom),
              ease((u - 0.72) / 0.28)
            );
          }
        } else {
          logZoom = mix(
            Math.log(state.from.zoom),
            Math.log(state.to.zoom),
            panAmount
          );
        }

        camera.position.x = mix(
          state.from.x,
          state.to.x,
          panAmount
        );

        camera.position.y = mix(
          state.from.y,
          state.to.y,
          panAmount
        );

        camera.zoom = Math.exp(logZoom);

        if (u >= 1) {
          returning = null;
        }

        setControlPose();
      } else if (manual) {
        if (coast > 0.001 && !paused) {
          const scale = dt * coast;

          controlCamera.position.x += velocity.x * scale;
          controlCamera.position.y += velocity.y * scale;

          controls.target.x += velocity.x * scale;
          controls.target.y += velocity.y * scale;

          controlCamera.zoom = clamp(
            controlCamera.zoom * Math.exp(velocity.z * scale),
            MIN_ZOOM,
            MAX_ZOOM
          );

          controlCamera.updateProjectionMatrix();
          coast *= Math.exp(-dt * 13);
        }

        controls.update();

        const amount = 1 - Math.exp(-dt * 15);

        camera.position.x = mix(
          camera.position.x,
          controlCamera.position.x,
          amount
        );

        camera.position.y = mix(
          camera.position.y,
          controlCamera.position.y,
          amount
        );

        camera.zoom = Math.exp(
          mix(
            Math.log(camera.zoom),
            Math.log(controlCamera.zoom),
            amount
          )
        );
      } else if (!paused) {
        sampleRoute();

        const amount = 1 - Math.exp(-dt * 2.8);

        camera.position.x = mix(
          camera.position.x,
          desired.x,
          amount
        );

        camera.position.y = mix(
          camera.position.y,
          desired.y,
          amount
        );

        camera.zoom = Math.exp(
          mix(
            Math.log(camera.zoom),
            Math.log(desired.zoom),
            amount
          )
        );

        setControlPose();
      }

      // Enforce an orthographic XY map without rotation or depth drift.
      camera.position.z = 100;
      camera.quaternion.identity();
      camera.zoom = clamp(camera.zoom, MIN_ZOOM, MAX_ZOOM);

      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      if (!manual && dt > 0) {
        velocity.set(
          (camera.position.x - before.x) / dt,
          (camera.position.y - before.y) / dt,
          (Math.log(camera.zoom) - before.z) / dt
        );
      }

      if (
        Math.min(window.devicePixelRatio || 1, 2) !== dpr
      ) {
        resize();
      }

      pixelsPerUnit = height * camera.zoom / HEIGHT;

      U.uTime.value = time;
      U.uZoom.value = camera.zoom;
      U.uPixels.value = pixelsPerUnit * dpr;
      U.uPixelWorld.value = 1 / pixelsPerUnit;

      U.uCenter.value.set(
        camera.position.x,
        camera.position.y
      );

      U.uSpan.value.set(
        HEIGHT * width / (height * camera.zoom),
        HEIGHT / camera.zoom
      );

      macro.value = 1 - smooth(7, 85, camera.zoom);

      atomic.value =
        smooth(4, 15, camera.zoom) *
        (1 - smooth(70, 230, camera.zoom));

      qcd.value = smooth(45, 230, camera.zoom);

      const distance = Math.hypot(
        camera.position.x - focus.x,
        camera.position.y - focus.y
      );

      const local = 1 - smooth(
        HEIGHT / camera.zoom * 0.65 + 0.06,
        HEIGHT / camera.zoom * 1.2 + 0.15,
        distance
      );

      U.uQCD.value = qcd.value * local;
      dustReveal.value = macro.value * 0.42;

      updateCore();

      const carrierPositions =
        carriers.geometry.attributes.position.array;

      for (let i = 0; i < 9; i++) {
        edgePoint(
          time * 3.2 + i * perimeterLength / 9,
          scratch
        );

        scratch.toArray(carrierPositions, i * 3);
      }

      carriers.geometry.attributes.position.needsUpdate = true;

      updateLabels(dt);
      updateHUD(stamp);

      composer.render();
      labelRenderer.render(scene, camera);
    }

    renderer.domElement.addEventListener(
      'webglcontextlost',
      event => {
        event.preventDefault();

        lost = true;
        notice.hidden = false;
        notice.textContent = 'The graphics context is recovering.';
      }
    );

    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        lost = false;
        lastStamp = 0;
        notice.hidden = true;

        resize();
      }
    );

    document.addEventListener(
      'visibilitychange',
      () => {
        lastStamp = 0;
      }
    );

    updateCore();
    requestAnimationFrame(animate);
  }
})();