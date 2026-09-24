/* 4D Hypersphere — Raw Code Visualizing Nature */

(() => {
  'use strict';

  const container = document.getElementById('canvas-container');
  let notice = document.getElementById('render-notice');

  function fail(error) {
    if (!notice) {
      notice = document.createElement('p');
      notice.id = 'render-notice';
      document.body.appendChild(notice);
    }

    notice.hidden = false;
    notice.setAttribute('role', 'alert');
    notice.textContent =
      'Unable to run the visualization: ' +
      (error.message || error) +
      ' Reload the page after checking the three files and your connection.';

    if (container) {
      container.setAttribute('aria-busy', 'false');
    }

    document.querySelectorAll('[data-engine-control]').forEach(button => {
      button.disabled = true;
    });
  }

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
    fail(new Error('The matching Three.js libraries did not load.'));
    return;
  }

  try {
    initialize();
  } catch (error) {
    fail(error);
  }

  function initialize() {
    const T = THREE;
    const TAU = Math.PI * 2;
    const R = 26;
    const PERIOD = 480;

    const clamp = T.MathUtils.clamp;
    const lerp = T.MathUtils.lerp;

    const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
    const C = hex => new T.Color(hex).convertSRGBToLinear();

    const ease = x =>
      x * x * x * (x * (x * 6 - 15) + 10);

    const smooth = (a, b, x) =>
      ease(clamp((x - a) / (b - a), 0, 1));

    const bell = (a, b, c, d, x) =>
      smooth(a, b, x) * (1 - smooth(c, d, x));

    const $ = id => {
      const element = document.getElementById(id);

      if (!element) {
        throw new Error('Missing HTML element: ' + id);
      }

      return element;
    };

    const ui = {};

    const ids = {
      panel: 'sidebar-ui',
      content: 'sidebar-content',
      hud: 'hud-toggle',
      pause: 'pause-toggle',
      resume: 'resume-flight',
      mode: 'flight-mode',
      w: 'w-value',
      radius: 'slice-radius-value',
      angle: 'rotation-angle-value',
      planes: 'rotation-plane-value',
      projection: 'projection-value',
      projectionDistance: 'projection-distance-value',
      geodesic: 'geodesic-value',
      distance: 'distance-value',
      progress: 'journey-progress',
      fill: 'flight-progress',
      stages: 'journey-stages',
      clock: 'tour-time',
      chapter: 'chapter-value',
      title: 'scene-title',
      description: 'scene-description',
      caption: 'scene-caption',
      controls: 'flight-controls',
      legend: 'reference-legend'
    };

    Object.keys(ids).forEach(key => {
      ui[key] = $(ids[key]);
    });

    const motionPreference = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    );

    let paused = motionPreference.matches;
    let manual = false;
    let hud = true;
    let returning = null;

    let contextLost = false;
    let stopped = false;
    let ready = false;

    let time = 0;
    let flight = 0;
    let lastStamp = 0;
    let lastUI = -Infinity;
    let lastLayout = -Infinity;

    let stage = 'exterior';
    let stageIndex = 0;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let viewShift = 0;
    let focusDistance = 90;

    let seed = 917263;

    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed + 0.5) / 4294967296;
    };

    const sphereDirection = () => {
      const z = 2 * random() - 1;
      const a = TAU * random();
      const r = Math.sqrt(1 - z * z);

      return V(r * Math.cos(a), z, r * Math.sin(a));
    };

    // Scene, cameras, and rendering surfaces.

    const scene = new T.Scene();
    scene.background = new T.Color(0x000000);
    scene.fog = new T.FogExp2(0x000000, 0.0025);

    const camera = new T.PerspectiveCamera(50, 1, 0.06, 650);
    const controlCamera = camera.clone();
    const aimCamera = camera.clone();

    const renderer = new T.WebGLRenderer({
      antialias: false,
      alpha: false,
      stencil: false
    });

    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setClearColor(0x000000, 1);

    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      'aria-label',
      'Projected hypersphere. Drag to orbit, scroll to zoom, and right-drag to pan.'
    );

    container.appendChild(renderer.domElement);

    const labelRenderer = new T.CSS2DRenderer();
    labelRenderer.domElement.id = 'label-layer';
    container.appendChild(labelRenderer.domElement);

    const gl = renderer.getContext();

    const maxPoint = Math.min(
      72,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    // The mathematical geometry uses unit-radius coordinates in R4.
    // R converts the resulting projection into display units.

    const rotation = new T.Matrix4();
    const planeMatrix = new T.Matrix4();

    const U = {
      uTime: { value: 0 },
      uRotation: { value: rotation },
      uDistance: { value: 2.6 },
      uRadius: { value: R },
      uSlice: { value: 0 },
      uPointScale: { value: 1 },
      uPointLimit: { value: maxPoint },
      uFog: { value: scene.fog.density }
    };

    const angles = [0, 0, 0, 0];

    function rotatePlane(i, j, angle) {
      planeMatrix.identity();

      const e = planeMatrix.elements;
      const c = Math.cos(angle);
      const s = Math.sin(angle);

      e[i * 4 + i] = c;
      e[j * 4 + j] = c;
      e[j * 4 + i] = -s;
      e[i * 4 + j] = s;

      rotation.premultiply(planeMatrix);
    }

    function hyper(chi, theta, phi) {
      const s = Math.sin(chi);

      return [
        s * Math.sin(theta) * Math.cos(phi),
        s * Math.sin(theta) * Math.sin(phi),
        s * Math.cos(theta),
        Math.cos(chi)
      ];
    }

    const qScratch = new T.Vector4();

    function project4(q, out, rotated = true) {
      qScratch.fromArray(q);

      if (rotated) {
        qScratch.applyMatrix4(rotation);
      }

      const scale =
        R * U.uDistance.value /
        (U.uDistance.value - qScratch.w);

      return out.set(
        qScratch.x * scale,
        qScratch.y * scale,
        qScratch.z * scale
      );
    }

    // The same projection is used by shaders and CPU annotation anchors.
    // d remains greater than 1, outside the mathematical unit S3.

    const projectionGLSL = `
      uniform mat4 uRotation;
      uniform float uDistance, uRadius, uTime, uSlice, uFog;

      vec3 projectPoint(vec4 q) {
        return uRadius * uDistance * q.xyz / (uDistance - q.w);
      }

      vec3 spectrum(float w) {
        float t = clamp(0.5 + 0.5 * w, 0.0, 1.0);

        vec3 a = vec3(0.16, 0.78, 1.0);
        vec3 b = vec3(0.27, 0.36, 1.0);
        vec3 c = vec3(0.85, 0.22, 0.70);

        return t < 0.5
          ? mix(a, b, t * 2.0)
          : mix(b, c, t * 2.0 - 1.0);
      }
    `;

    const projectedVertex = projectionGLSL + `
      uniform float uSliceMode, uPointScale, uPointLimit, uSize;

      attribute vec4 aQ;
      attribute float aU;

      varying vec3 vWorld, vColor;
      varying float vU, vDepth;

      void main() {
        vec4 q = aQ;

        if (uSliceMode > 0.5) {
          q = vec4(
            q.xyz * sqrt(max(0.0, 1.0 - uSlice * uSlice)),
            uSlice
          );
        } else {
          q = uRotation * q;
        }

        vec3 p = projectPoint(q);
        vec4 world = modelMatrix * vec4(p, 1.0);
        vec4 mv = viewMatrix * world;

        vWorld = world.xyz;
        vColor = spectrum(aQ.w);
        vU = aU;
        vDepth = length(mv.xyz);

        gl_PointSize = clamp(
          uSize * uPointScale / max(0.1, -mv.z),
          1.0,
          uPointLimit
        );

        gl_Position = projectionMatrix * mv;
      }
    `;

    const projectedFragment = `
      uniform float uTime, uFog, uOpacity, uEnergy;
      uniform float uSolid, uSurface, uPoints;
      uniform vec3 uTint;

      varying vec3 vWorld, vColor;
      varying float vU, vDepth;

      void main() {
        vec3 color = mix(vColor, uTint, uSolid);
        float alpha = uOpacity;
        float energy = uEnergy;

        if (uSurface > 0.5) {
          vec3 n = normalize(
            cross(dFdx(vWorld), dFdy(vWorld)) + vec3(1e-8)
          );

          float rim = pow(
            1.0 - abs(dot(
              n,
              normalize(cameraPosition - vWorld)
            )),
            2.6
          );

          alpha *= 0.12 + 0.88 * rim;
          energy *= 0.7 + rim;
        } else if (uPoints > 0.5) {
          float r = 2.0 * length(gl_PointCoord - 0.5);

          if (r > 1.0) discard;

          alpha *= exp(-r * r * 4.5) *
            (1.0 - smoothstep(0.7, 1.0, r));

          energy *= 1.0 + exp(-r * r * 28.0);
        } else {
          float trace = pow(
            0.5 + 0.5 * sin(vU * 75.4 - uTime * 0.8),
            18.0
          );

          energy *= 0.7 + trace * 1.5;
        }

        alpha *= exp(-uFog * uFog * vDepth * vDepth);

        gl_FragColor = vec4(color * energy, alpha);
      }
    `;

    function projectedMaterial(options = {}) {
      return new T.ShaderMaterial({
        uniforms: {
          ...U,
          uSliceMode: { value: options.slice ? 1 : 0 },
          uOpacity: { value: options.opacity ?? 0.45 },
          uEnergy: { value: options.energy ?? 1.5 },
          uSolid: { value: options.tint === undefined ? 0 : 1 },
          uTint: { value: C(options.tint ?? 0xffffff) },
          uSurface: { value: options.surface ? 1 : 0 },
          uPoints: { value: options.points ? 1 : 0 },
          uSize: { value: options.size ?? 0.11 }
        },

        vertexShader: projectedVertex,
        fragmentShader: projectedFragment,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,
        extensions: { derivatives: true }
      });
    }

    function geometry4(qs, us, indices) {
      const p = new Float32Array(qs.length / 4 * 3);

      for (let i = 0, j = 0; i < qs.length; i += 4, j += 3) {
        p[j] = qs[i];
        p[j + 1] = qs[i + 1];
        p[j + 2] = qs[i + 2];
      }

      const g = new T.BufferGeometry();

      g.setAttribute('position', new T.BufferAttribute(p, 3));
      g.setAttribute('aQ', new T.Float32BufferAttribute(qs, 4));
      g.setAttribute('aU', new T.Float32BufferAttribute(us, 1));

      if (indices) {
        g.setIndex(indices);
      }

      return g;
    }

    function curve4(qs, us, sample, count = 128) {
      let previous = sample(0);

      for (let i = 1; i <= count; i++) {
        const next = sample(i / count);

        qs.push(...previous, ...next);
        us.push((i - 1) / count, i / count);

        previous = next;
      }
    }

    function addProjected(g, material, type = 'lines') {
      const object = type === 'surface'
        ? new T.Mesh(g, material)
        : type === 'points'
          ? new T.Points(g, material)
          : new T.LineSegments(g, material);

      // CPU bounds do not include the shader's 4D projection.
      object.frustumCulled = false;

      scene.add(object);

      return object;
    }

    // Hyperspherical coordinate grid.

    const gridQ = [];
    const gridU = [];

    for (let i = 1; i < 12; i++) {
      const chi = i * Math.PI / 12;

      for (let j = 1; j < 8; j++) {
        curve4(
          gridQ,
          gridU,
          t => hyper(chi, j * Math.PI / 8, t * TAU)
        );
      }

      for (let j = 0; j < 10; j++) {
        curve4(
          gridQ,
          gridU,
          t => hyper(chi, t * Math.PI, j * TAU / 10),
          72
        );
      }
    }

    for (let j = 1; j < 6; j++) {
      for (let k = 0; k < 14; k++) {
        curve4(
          gridQ,
          gridU,
          t => hyper(
            t * Math.PI,
            j * Math.PI / 6,
            k * TAU / 14
          ),
          96
        );
      }
    }

    const gridMaterial = projectedMaterial({
      opacity: 0.33,
      energy: 1.6
    });

    addProjected(geometry4(gridQ, gridU), gridMaterial);

    // Additional exact circles on S3.
    // Each cosine/sine coefficient pair is orthonormal in R4.

    const fiberQ = [];
    const fiberU = [];

    for (let i = 1; i <= 4; i++) {
      const eta = i * Math.PI / 10;
      const a = Math.cos(eta);
      const b = Math.sin(eta);

      for (let j = 0; j < 10; j++) {
        const phase = j * TAU / 10;

        curve4(
          fiberQ,
          fiberU,
          t => [
            a * Math.cos(TAU * t + phase),
            a * Math.sin(TAU * t + phase),
            b * Math.cos(TAU * t),
            b * Math.sin(TAU * t)
          ],
          160
        );
      }
    }

    addProjected(
      geometry4(fiberQ, fiberU),
      projectedMaterial({ opacity: 0.5, energy: 1.8 })
    );

    // Selected two-dimensional coordinate surfaces lying on S3.

    function coordinateSurface(eta) {
      const qs = [];
      const us = [];
      const indices = [];

      const nu = 80;
      const nv = 56;

      const a = Math.cos(eta);
      const b = Math.sin(eta);

      for (let j = 0; j <= nv; j++) {
        for (let i = 0; i <= nu; i++) {
          const u = i / nu * TAU;
          const v = j / nv * TAU;

          qs.push(
            a * Math.cos(u),
            a * Math.sin(u),
            b * Math.cos(v),
            b * Math.sin(v)
          );

          us.push(i / nu);

          if (i < nu && j < nv) {
            const n = j * (nu + 1) + i;

            indices.push(
              n,
              n + 1,
              n + nu + 1,
              n + 1,
              n + nu + 2,
              n + nu + 1
            );
          }
        }
      }

      return geometry4(qs, us, indices);
    }

    [0.48, 1.03].forEach(eta => {
      addProjected(
        coordinateSurface(eta),
        projectedMaterial({
          surface: true,
          opacity: 0.14,
          energy: 1.2
        }),
        'surface'
      );
    });

    // Uniform reference-point sampling on the unit S3.
    // These points represent geometry, not physical particles.

    const pointQ = [];
    const pointU = [];

    for (let i = 0; i < 11000; i++) {
      const r = random();
      const a = Math.sqrt(r);
      const b = Math.sqrt(1 - r);
      const u = random() * TAU;
      const v = random() * TAU;

      pointQ.push(
        a * Math.cos(u),
        a * Math.sin(u),
        b * Math.cos(v),
        b * Math.sin(v)
      );

      pointU.push(random());
    }

    addProjected(
      geometry4(pointQ, pointU),
      projectedMaterial({
        points: true,
        opacity: 0.52,
        size: 0.11,
        energy: 1.5
      }),
      'points'
    );

    // Unrotated, fixed-w S2 reference section.
    // Its shader applies the same perspective map but bypasses SO(4).

    const sliceQ = [];
    const sliceU = [];

    for (let j = 1; j < 12; j++) {
      const theta = j * Math.PI / 12;

      curve4(
        sliceQ,
        sliceU,
        t => [
          Math.sin(theta) * Math.cos(t * TAU),
          Math.cos(theta),
          Math.sin(theta) * Math.sin(t * TAU),
          0
        ]
      );
    }

    for (let j = 0; j < 16; j++) {
      const phi = j * TAU / 16;

      curve4(
        sliceQ,
        sliceU,
        t => [
          Math.sin(t * Math.PI) * Math.cos(phi),
          Math.cos(t * Math.PI),
          Math.sin(t * Math.PI) * Math.sin(phi),
          0
        ],
        96
      );
    }

    const sliceMaterial = projectedMaterial({
      slice: true,
      tint: 0xf3ce87,
      opacity: 0.1,
      energy: 1.7
    });

    const sliceGrid = addProjected(
      geometry4(sliceQ, sliceU),
      sliceMaterial
    );

    // Luminous tubes around selected projected great circles.
    // Tube thickness is an illustrative display treatment.

    const tubeGeometry = new T.TubeGeometry(
      new T.LineCurve3(V(), V(1, 0, 0)),
      240,
      1,
      6,
      false
    );

    const circleVertex = projectionGLSL + `
      uniform vec4 uA, uB;
      uniform float uThickness;

      varying float vU, vDepth;

      vec3 path(float t) {
        return projectPoint(
          uRotation * (
            uA * cos(t * 6.2831853) +
            uB * sin(t * 6.2831853)
          )
        );
      }

      void main() {
        float t = uv.x;
        vec3 p = path(t);

        vec3 tangent = normalize(
          path(t + 0.0005) - path(t - 0.0005)
        );

        vec3 up = abs(tangent.y) > 0.9
          ? vec3(1.0, 0.0, 0.0)
          : vec3(0.0, 1.0, 0.0);

        vec3 n = normalize(cross(tangent, up));
        vec3 b = normalize(cross(tangent, n));

        float angle = uv.y * 6.2831853;

        p += uThickness * (
          n * cos(angle) + b * sin(angle)
        );

        vec4 mv = modelViewMatrix * vec4(p, 1.0);

        vDepth = length(mv.xyz);
        vU = t;

        gl_Position = projectionMatrix * mv;
      }
    `;

    const circleFragment = `
      uniform float uTime, uFog, uOpacity;
      uniform vec3 uTint;

      varying float vU, vDepth;

      void main() {
        float light = 1.4 + 2.2 * pow(
          0.5 + 0.5 * sin(vU * 50.2655 - uTime),
          12.0
        );

        float fog = exp(-uFog * uFog * vDepth * vDepth);

        gl_FragColor = vec4(uTint * light, uOpacity * fog);
      }
    `;

    const geodesicA = [1, 0, 0, 0];
    const geodesicB = [
      0,
      0.58,
      0,
      Math.sqrt(1 - 0.58 * 0.58)
    ];

    function greatCircle(a, b, tint, thickness) {
      const material = new T.ShaderMaterial({
        uniforms: {
          ...U,
          uA: { value: new T.Vector4(...a) },
          uB: { value: new T.Vector4(...b) },
          uThickness: { value: thickness },
          uTint: { value: C(tint) },
          uOpacity: { value: 0.85 }
        },

        vertexShader: circleVertex,
        fragmentShader: circleFragment,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const mesh = new T.Mesh(tubeGeometry, material);
      mesh.frustumCulled = false;

      scene.add(mesh);

      return mesh;
    }

    greatCircle(
      geodesicA,
      geodesicB,
      0x90baff,
      0.07
    );

    greatCircle(
      [0, 1, 0, 0],
      [0.6, 0, 0.8, 0],
      0xf29bdc,
      0.045
    );

    greatCircle(
      [0, 0, 1, 0],
      [0, 0.8, 0, 0.6],
      0x70e7ff,
      0.05
    );

    const geoQ = [0, 0, 0, 0];

    function geodesicPoint(tau, out) {
      for (let i = 0; i < 4; i++) {
        geoQ[i] =
          geodesicA[i] * Math.cos(tau) +
          geodesicB[i] * Math.sin(tau);
      }

      return project4(geoQ, out);
    }

    // Shared helpers for the separate reference exhibits.

    const beadGeometry = new T.SphereGeometry(1, 18, 12);

    function bead(parent, position, radius, tint, energy = 2) {
      const mesh = new T.Mesh(
        beadGeometry,
        new T.MeshBasicMaterial({
          color: C(tint).multiplyScalar(energy)
        })
      );

      mesh.position.copy(position);
      mesh.scale.setScalar(radius);

      parent.add(mesh);

      return mesh;
    }

    function line3(
      points,
      tint,
      opacity = 0.5,
      parent = scene
    ) {
      const geometry = new T.BufferGeometry().setFromPoints(points);

      const material = new T.LineBasicMaterial({
        color: C(tint).multiplyScalar(1.6),
        transparent: true,
        opacity,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const line = new T.Line(geometry, material);
      line.frustumCulled = false;

      parent.add(line);

      return line;
    }

    function ring(
      parent,
      radius,
      y,
      tint,
      opacity = 0.4
    ) {
      const points = [];

      for (let i = 0; i <= 128; i++) {
        const a = i / 128 * TAU;

        points.push(
          V(Math.cos(a) * radius, y, Math.sin(a) * radius)
        );
      }

      return line3(points, tint, opacity, parent);
    }

    const cloudVertex = `
      uniform float uTime, uPointScale, uPointLimit;
      uniform float uSize, uTwinkle;

      attribute float aSeed;

      varying float vDepth, vAlpha;

      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);

        vDepth = length(mv.xyz);

        vAlpha = 1.0 - uTwinkle * (
          0.5 + 0.5 * sin(uTime * 0.3 + aSeed * 50.0)
        );

        gl_PointSize = clamp(
          uSize * (0.75 + aSeed * 0.5) *
            uPointScale / max(0.1, -mv.z),
          1.0,
          uPointLimit
        );

        gl_Position = projectionMatrix * mv;
      }
    `;

    const cloudFragment = `
      uniform vec3 uTint;
      uniform float uOpacity, uFog;

      varying float vDepth, vAlpha;

      void main() {
        float r = length(gl_PointCoord - 0.5) * 2.0;

        if (r > 1.0) discard;

        float glow = exp(-r * r * 5.0) *
          (1.0 - smoothstep(0.75, 1.0, r));

        float fog = exp(-uFog * uFog * vDepth * vDepth);

        gl_FragColor = vec4(
          uTint * (1.5 + exp(-r * r * 30.0)),
          glow * uOpacity * vAlpha * fog
        );
      }
    `;

    function cloud(
      points,
      tint,
      size,
      opacity,
      parent = scene,
      twinkle = 0
    ) {
      const geometry = new T.BufferGeometry().setFromPoints(points);

      geometry.setAttribute(
        'aSeed',
        new T.Float32BufferAttribute(
          points.map(() => random()),
          1
        )
      );

      const material = new T.ShaderMaterial({
        uniforms: {
          ...U,
          uTint: { value: C(tint) },
          uSize: { value: size },
          uOpacity: { value: opacity },
          uTwinkle: { value: twinkle }
        },

        vertexShader: cloudVertex,
        fragmentShader: cloudFragment,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const object = new T.Points(geometry, material);
      parent.add(object);

      return object;
    }

    const stars = [];

    for (let i = 0; i < 1800; i++) {
      stars.push(
        sphereDirection().multiplyScalar(110 + 200 * random())
      );
    }

    cloud(stars, 0x85a5d7, 0.18, 0.4, scene, 0.3);

    const tracer = bead(scene, V(), 0.19, 0xd3edff, 4);

    const tracerTrail = line3(
      Array.from({ length: 64 }, () => V()),
      0x90baff,
      0.65
    );

    tracerTrail.geometry.attributes.position.setUsage(
      T.DynamicDrawUsage
    );

    // These spokes compare two projection maps of identical 4D points.

    const projectionVectors = new T.LineSegments(
      new T.BufferGeometry().setAttribute(
        'position',
        new T.BufferAttribute(
          new Float32Array(24 * 6),
          3
        ).setUsage(T.DynamicDrawUsage)
      ),
      new T.LineBasicMaterial({
        color: C(0xf3ce87),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: T.AdditiveBlending
      })
    );

    projectionVectors.frustumCulled = false;
    scene.add(projectionVectors);

    const vectorSamples = Array.from(
      { length: 24 },
      (_, i) => hyper(
        0.45 + (i % 4) * 0.68,
        0.8 + (i % 3) * 0.5,
        i * 2.39996
      )
    );

    const worldNames = [];

    function worldName(
      text,
      position,
      category = 'particles',
      gold = false
    ) {
      const element = document.createElement('span');

      element.className =
        'world-name' + (gold ? ' world-name--gold' : '');

      element.textContent = text;

      const object = new T.CSS2DObject(element);
      object.position.copy(position);
      object.visible = false;

      scene.add(object);

      worldNames.push({ object, element, category });
    }

    const stations = {};

    function station(key, title, position, tint) {
      const group = new T.Group();

      group.position.copy(position);
      scene.add(group);

      ring(group, 4.9, -3.9, tint, 0.45);
      ring(group, 5.15, -3.9, tint, 0.2);

      const ticks = [];

      for (let i = 0; i < 32; i++) {
        const a = i * TAU / 32;
        const r = i % 4 ? 4.72 : 4.45;

        ticks.push(
          V(Math.cos(a) * r, -3.9, Math.sin(a) * r),
          V(Math.cos(a) * 4.9, -3.9, Math.sin(a) * 4.9)
        );
      }

      group.add(
        new T.LineSegments(
          new T.BufferGeometry().setFromPoints(ticks),
          new T.LineBasicMaterial({
            color: C(tint),
            transparent: true,
            opacity: 0.42
          })
        )
      );

      worldName(
        title,
        position.clone().add(V(0, -4.7, 0))
      );

      stations[key] = group;

      return group;
    }

    const electron = station(
      'electron',
      'ELECTRON / HYDROGEN 1s',
      V(48, -12, 14),
      0x90baff
    );

    const photon = station(
      'photon',
      'PHOTON / TRANSVERSE MODE',
      V(65, -12, 14),
      0x70e7ff
    );

    const proton = station(
      'proton',
      'PROTON / uud',
      V(82, -12, 14),
      0xf29bdc
    );

    const neutrino = station(
      'neutrino',
      'NEUTRINO / FLAVOR MIXING',
      V(56, -12, -5),
      0xbc9aff
    );

    const higgs = station(
      'higgs',
      'HIGGS / SCALAR EXCITATION',
      V(75, -12, -5),
      0xf3ce87
    );

    worldName(
      'INDEPENDENT REFERENCE GALLERY / SCHEMATIC SCALE',
      V(65, -18, 6),
      'particles',
      true
    );

    // Stationary hydrogen 1s probability sampling.

    const electrons = [];
    const a0 = 0.78;

    for (let i = 0; i < 2200; i++) {
      // The radial probability is Gamma(shape=3, scale=a0/2).
      const r =
        -a0 * 0.5 *
        Math.log(random() * random() * random());

      electrons.push(sphereDirection().multiplyScalar(r));
    }

    cloud(electrons, 0x90baff, 0.065, 0.65, electron);
    bead(electron, V(), 0.07, 0xf3ce87, 2);

    // Transverse electric and magnetic field curves.
    // Field amplitudes and animation speed use illustrative display units.

    const waveLines = [];

    for (let i = 0; i < 2; i++) {
      const line = line3(
        Array.from({ length: 200 }, () => V()),
        i ? 0xbc9aff : 0x70e7ff,
        0.85,
        photon
      );

      line.geometry.attributes.position.setUsage(
        T.DynamicDrawUsage
      );

      waveLines.push(line);
    }

    line3(
      [V(-4.8, 0, 0), V(4.8, 0, 0)],
      0x70e7ff,
      0.25,
      photon
    );

    // Proton valence-content schematic.

    const protonCore = new T.Group();
    proton.add(protonCore);

    const quarkTints = [
      0xff6d8e,
      0x79e5ad,
      0x8eabff
    ];

    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3;

      const p = V(
        1.65 * Math.cos(a),
        1.4 * Math.sin(a),
        0.4 * Math.sin(2 * a)
      );

      bead(protonCore, p, 0.28, quarkTints[i], 2.5);

      for (let j = 0; j < 3; j++) {
        const points = [];

        for (let k = 0; k <= 80; k++) {
          const u = k / 80;
          const envelope = Math.sin(Math.PI * u);
          const q = p.clone().multiplyScalar(u);

          q.z +=
            0.18 * envelope *
            Math.sin(u * TAU * 3 + j * TAU / 3);

          q.y +=
            0.1 * envelope *
            Math.cos(u * TAU * 3 + j * TAU / 3);

          points.push(q);
        }

        line3(points, quarkTints[i], 0.6, protonCore);
      }
    }

    // Conceptual flavor-mixing traces, not calculated oscillation data.

    const neutrinoLines = [];

    for (let i = 0; i < 3; i++) {
      const line = line3(
        Array.from({ length: 140 }, () => V()),
        [0xbc9aff, 0x70e7ff, 0xf29bdc][i],
        0.7,
        neutrino
      );

      line.geometry.attributes.position.setUsage(
        T.DynamicDrawUsage
      );

      neutrinoLines.push(line);
    }

    line3(
      [V(-4.2, 0, 0), V(4.2, 0, 0)],
      0xbc9aff,
      0.2,
      neutrino
    );

    // Surface of revolution of a quadratic potential diagram.
    // Its azimuth is a display device, not another Higgs field component.

    const profile = [];

    for (let i = 0; i <= 36; i++) {
      const h = i / 36 * 3.4;

      profile.push(
        new T.Vector2(h, 0.28 * h * h - 1.4)
      );
    }

    const bowl = new T.Mesh(
      new T.LatheGeometry(profile, 72),
      new T.MeshBasicMaterial({
        color: C(0xf3ce87).multiplyScalar(1.5),
        transparent: true,
        opacity: 0.045,
        side: T.DoubleSide,
        depthWrite: false,
        blending: T.AdditiveBlending
      })
    );

    higgs.add(bowl);

    for (let i = 1; i <= 12; i++) {
      const h = i / 12 * 3.4;

      ring(
        higgs,
        h,
        0.28 * h * h - 1.4,
        0xf3ce87,
        0.45
      );
    }

    for (let i = 0; i < 12; i++) {
      const a = i * TAU / 12;

      line3(
        profile.map(p => V(
          p.x * Math.cos(a),
          p.y,
          p.x * Math.sin(a)
        )),
        0xf3ce87,
        0.36,
        higgs
      );
    }

    const higgsProbe = bead(
      higgs,
      V(),
      0.13,
      0xffedc1,
      3
    );

    const temp3 = V();

    function updateExhibits() {
      const tau = time * 0.085;

      geodesicPoint(tau, tracer.position);

      const trail = tracerTrail.geometry.attributes.position;

      for (let i = 0; i < trail.count; i++) {
        geodesicPoint(
          tau - 0.32 + 0.32 * i / (trail.count - 1),
          temp3
        );

        temp3.toArray(trail.array, i * 3);
      }

      trail.needsUpdate = true;

      for (let j = 0; j < waveLines.length; j++) {
        const attribute =
          waveLines[j].geometry.attributes.position;

        for (let i = 0; i < attribute.count; i++) {
          const x = -4.5 + 9 * i / (attribute.count - 1);
          const wave = Math.sin(x * 2.9 - time * 2.1) * 1.1;

          attribute.setXYZ(
            i,
            x,
            j ? 0 : wave,
            j ? wave : 0
          );
        }

        attribute.needsUpdate = true;
      }

      protonCore.rotation.y = time * 0.12;

      for (let j = 0; j < neutrinoLines.length; j++) {
        const attribute =
          neutrinoLines[j].geometry.attributes.position;

        for (let i = 0; i < attribute.count; i++) {
          const x = -4 + 8 * i / (attribute.count - 1);
          const phase =
            x * 1.5 - time * 0.7 + j * TAU / 3;

          attribute.setXYZ(
            i,
            x,
            Math.sin(phase) * 0.95,
            Math.cos(phase) * 0.65
          );
        }

        attribute.needsUpdate = true;
      }

      const h = 2.4 * Math.sin(time * 0.7);

      higgsProbe.position.set(
        h,
        0.28 * h * h - 1.4,
        0
      );

      const projectionWeight = bell(
        264,
        278,
        309,
        324,
        flight % PERIOD
      );

      projectionVectors.material.opacity =
        projectionWeight * 0.38;

      projectionVectors.visible =
        projectionWeight > 0.005;

      if (projectionVectors.visible) {
        const attribute =
          projectionVectors.geometry.attributes.position;

        vectorSamples.forEach((q, i) => {
          qScratch.fromArray(q).applyMatrix4(rotation);

          attribute.setXYZ(
            i * 2,
            qScratch.x * R,
            qScratch.y * R,
            qScratch.z * R
          );

          const scale =
            R * U.uDistance.value /
            (U.uDistance.value - qScratch.w);

          attribute.setXYZ(
            i * 2 + 1,
            qScratch.x * scale,
            qScratch.y * scale,
            qScratch.z * scale
          );
        });

        attribute.needsUpdate = true;
      }
    }

    // Restrained HDR bloom, display conversion, and antialiasing.

    const hdr =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    const targetType = hdr
      ? T.HalfFloatType
      : T.UnsignedByteType;

    const target = new T.WebGLRenderTarget(1, 1, {
      type: targetType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(renderer, target);

    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      0.72,
      0.42,
      hdr ? 0.92 : 0.68
    );

    [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ].forEach(t => {
      t.texture.type = targetType;
      t.texture.format = T.RGBAFormat;
    });

    composer.addPass(bloom);

    composer.addPass(
      new T.ShaderPass({
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
            return mix(
              x * 12.92,
              1.055 * pow(
                max(x, vec3(0.0)),
                vec3(1.0 / 2.4)
              ) - 0.055,
              step(vec3(0.0031308), x)
            );
          }

          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;

            float vignette =
              1.0 - 0.12 * smoothstep(
                0.25,
                0.78,
                length(vUv - 0.5)
              );

            gl_FragColor = vec4(
              displayRGB(aces(c * vignette)),
              1.0
            );
          }
        `
      })
    );

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    // Eight-minute cinematic itinerary.

    const chapters = [
      [
        0,
        'exterior',
        'EXTERIOR GEOMETRY',
        'A sphere beyond three coordinates.',
        'The marked grid samples S³ in four dimensions. Its changing projection reveals structure within the displayed volume.'
      ],
      [
        52,
        'slice',
        'FOURTH-COORDINATE SLICE',
        'Hold one coordinate. Watch a sphere emerge.',
        'The gold reference section grows and shrinks as w₀ changes. Its intrinsic radius is √(R² − w₀²).'
      ],
      [
        106,
        'coordinates',
        'HYPERSPHERICAL COORDINATES',
        'Three angles. Four coordinates.',
        'Travel among projected coordinate curves and selected two-dimensional surfaces of S³.'
      ],
      [
        158,
        'rotation',
        'ROTATION THROUGH w',
        'The sphere remains. Its markings move.',
        'XW, YW, and ZW rotations mix visible coordinates with w before the 3D projection is calculated.'
      ],
      [
        212,
        'geodesic',
        'GREAT-CIRCLE TRANSIT',
        'Follow an intrinsic great circle.',
        'The blue tracer marks a geodesic on S³. The drone follows an offset path through its 3D representation.'
      ],
      [
        266,
        'projection',
        'PROJECTION CHAMBER',
        'A different viewpoint in four dimensions.',
        'Faint gold spokes connect orthographic and perspective images of the same marked points as the projection distance changes.'
      ],
      [
        324,
        'particles',
        'PARTICLE & FIELD GALLERY',
        'Five exhibits. A separate scientific scale.',
        'Electron probability, electromagnetic modes, quark content, neutrino mixing, and scalar-field schematics are independent of the hypersphere.'
      ],
      [
        438,
        'return',
        'RETURN TO THE WHOLE',
        'Return to the projected 3-sphere.',
        'The guided flight closes its loop while the marked geometry continues rotating through four-dimensional coordinate planes.'
      ]
    ];

    const frames = [
      [0, [65, 39, 84], [-5, 0, 0], 50],
      [26, [-52, 24, 69], [-5, 0, 0], 49],
      [52, [-34, 13, 47], [0, 0, 0], 48],
      [78, [-14, 8, 31], [0, 0, 0], 54],
      [106, [8, 5, 13], [0, 0, -8], 64],
      [132, [14, 2, -8], [0, 1, -15], 66],
      [158, [34, 18, -41], [0, 0, 0], 55],
      [185, [-32, 29, -35], [0, 0, 0], 56],
      [212, [-36, 8, 14], [0, 0, 0], 56],
      [240, [-12, 4, 20], [0, 0, 0], 60],
      [266, [8, -4, 10], [0, 0, -12], 68],
      [294, [-7, 3, -15], [0, 0, 6], 70],
      [314, [27, 9, 14], [3, 0, 0], 60],
      [324, [46, 0, 36], [48, -12, 14], 46],
      [342, [48, -7, 26], [48, -12, 14], 42],
      [362, [65, -7, 27], [65, -12, 14], 43],
      [383, [82, -7, 28], [82, -12, 14], 45],
      [404, [56, -5, 8], [56, -12, -5], 46],
      [426, [75, -5, 9], [75, -12, -5], 48],
      [438, [70, 8, 40], [58, -10, 8], 55],
      [459, [89, 39, 80], [12, -3, 0], 54],
      [480, [65, 39, 84], [-5, 0, 0], 50]
    ].map(([at, p, target, fov]) => {
      const position = V(...p);
      const look = V(...target);

      aimCamera.position.copy(position);
      aimCamera.lookAt(look);

      return {
        at,
        position,
        quaternion: aimCamera.quaternion.clone(),
        distance: position.distanceTo(look),
        fov
      };
    });

    const desiredPosition = V();
    const desiredQuaternion = new T.Quaternion();

    const pathEye = V();
    const pathTarget = V();
    const forward = V();

    let desiredFov = 50;
    let desiredDistance = 90;

    function updateModel() {
      const t = flight % PERIOD;

      stageIndex = 0;

      for (let i = 1; i < chapters.length; i++) {
        if (t >= chapters[i][0]) {
          stageIndex = i;
        }
      }

      stage = chapters[stageIndex][1];

      U.uTime.value = time;

      U.uDistance.value =
        2.6 -
        0.85 * bell(266, 287, 300, 324, t) +
        0.13 * Math.sin(time * 0.06);

      U.uSlice.value = Math.sin(time * TAU / 52);

      angles[0] = 0.24 + time * 0.055;
      angles[1] = 0.55 + 0.46 * Math.sin(time * 0.023);
      angles[2] = -0.2 + time * 0.027;
      angles[3] = 0.12 + time * 0.011;

      rotation.identity();

      rotatePlane(0, 3, angles[0]);
      rotatePlane(1, 3, angles[1]);
      rotatePlane(2, 3, angles[2]);
      rotatePlane(0, 1, angles[3]);

      const sectionWeight = bell(45, 60, 98, 112, t);

      sliceMaterial.uniforms.uOpacity.value =
        0.045 + 0.42 * sectionWeight;

      sliceGrid.visible =
        Math.abs(U.uSlice.value) < 0.99999;

      gridMaterial.uniforms.uOpacity.value =
        0.33 - sectionWeight * 0.1;
    }

    function sampleFlight() {
      const t = flight % PERIOD;
      let i = 0;

      while (
        i < frames.length - 2 &&
        t > frames[i + 1].at
      ) {
        i++;
      }

      const a = frames[i];
      const b = frames[i + 1];

      const u = ease(
        clamp((t - a.at) / (b.at - a.at), 0, 1)
      );

      desiredPosition.lerpVectors(
        a.position,
        b.position,
        u
      );

      desiredQuaternion
        .copy(a.quaternion)
        .slerp(b.quaternion, u);

      desiredFov = lerp(a.fov, b.fov, u);
      desiredDistance = lerp(a.distance, b.distance, u);

      const ride = bell(212, 224, 252, 266, t);

      if (ride > 0) {
        geodesicPoint(time * 0.085, pathEye);

        pathEye.multiplyScalar(1.16);
        pathEye.y += 4;

        geodesicPoint(
          time * 0.085 + 0.23,
          pathTarget
        );

        aimCamera.position.copy(pathEye);
        aimCamera.lookAt(pathTarget);

        desiredPosition.lerp(pathEye, ride);
        desiredQuaternion.slerp(
          aimCamera.quaternion,
          ride
        );

        desiredDistance = lerp(
          desiredDistance,
          pathEye.distanceTo(pathTarget),
          ride
        );

        desiredFov = lerp(desiredFov, 66, ride);
      }
    }

    // OrbitControls drives a separate camera.
    // The rendered camera interpolates toward it during manual inspection.

    const controls = new T.OrbitControls(
      controlCamera,
      renderer.domElement
    );

    controls.enabled = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.43;
    controls.zoomSpeed = 0.65;
    controls.panSpeed = 0.65;
    controls.minDistance = 0.3;
    controls.maxDistance = 380;
    controls.minPolarAngle = 0.008;
    controls.maxPolarAngle = Math.PI - 0.008;
    controls.screenSpacePanning = true;

    function syncControls() {
      controlCamera.position.copy(camera.position);
      controlCamera.quaternion.copy(camera.quaternion);

      controlCamera.fov = camera.fov;
      controlCamera.zoom = camera.zoom;
      controlCamera.aspect = camera.aspect;

      controlCamera.updateProjectionMatrix();
      controlCamera.updateMatrixWorld(true);

      forward
        .set(0, 0, -1)
        .applyQuaternion(camera.quaternion);

      controls.target
        .copy(camera.position)
        .addScaledVector(
          forward,
          clamp(focusDistance, 0.3, 300)
        );
    }

    function clearMomentum() {
      controls.enableDamping = false;
      controls.update();

      syncControls();

      controls.enableDamping = true;
    }

    function enterManual(reading = false) {
      if (stopped || contextLost || !ready) {
        return;
      }

      if (!manual || returning) {
        returning = null;
        clearMomentum();
        manual = true;
      }

      controls.enabled = true;

      if (reading) {
        paused = true;
      }

      lastUI = lastLayout = -Infinity;
    }

    function resumeDrone() {
      if (stopped || contextLost) {
        return;
      }

      if (!manual && !returning) {
        paused = false;
        lastUI = -Infinity;
        return;
      }

      if (
        labelRenderer.domElement.contains(
          document.activeElement
        )
      ) {
        ui.resume.focus({ preventScroll: true });
      }

      clearMomentum();
      sampleFlight();

      const distance =
        camera.position.distanceTo(desiredPosition);

      returning = {
        elapsed: 0,
        duration: clamp(2.8 + distance / 22, 2.8, 8),
        from: camera.position.clone(),
        to: desiredPosition.clone(),
        rotation: camera.quaternion.clone(),
        goal: desiredQuaternion.clone(),
        fovFrom: camera.fov,
        fovTo: desiredFov,
        focusFrom: focusDistance,
        focusTo: desiredDistance,
        lift: Math.min(14, distance * 0.12)
      };

      manual = false;
      paused = false;
      controls.enabled = false;

      lastUI = lastLayout = -Infinity;
    }

    function togglePause() {
      paused = !paused;
      lastUI = -Infinity;
    }

    function toggleHUD() {
      hud = !hud;

      if (
        !hud &&
        (
          ui.panel.contains(document.activeElement) ||
          labelRenderer.domElement.contains(
            document.activeElement
          )
        )
      ) {
        ui.hud.focus({ preventScroll: true });
      }

      document.body.classList.toggle(
        'hud-hidden',
        !hud
      );

      ui.hud.textContent = hud ? 'Hide HUD' : 'Show HUD';
      ui.hud.setAttribute('aria-expanded', String(hud));

      [
        ui.panel,
        ui.caption,
        ui.legend,
        labelRenderer.domElement
      ].forEach(element => {
        element.inert = !hud;
        element.setAttribute(
          'aria-hidden',
          String(!hud)
        );
      });

      lastLayout = -Infinity;
    }

    // Capture input before OrbitControls consumes the event.

    renderer.domElement.addEventListener(
      'pointerdown',
      () => enterManual(),
      true
    );

    renderer.domElement.addEventListener(
      'touchstart',
      () => enterManual(),
      { capture: true, passive: true }
    );

    renderer.domElement.addEventListener(
      'wheel',
      () => enterManual(),
      { capture: true, passive: true }
    );

    controls.addEventListener(
      'start',
      () => enterManual()
    );

    // Reading mathematics freezes the animation and yields the flight.

    ui.content.addEventListener(
      'pointerdown',
      () => enterManual(true)
    );

    ui.content.addEventListener(
      'focusin',
      () => enterManual(true)
    );

    ui.content.addEventListener(
      'wheel',
      () => enterManual(true),
      { passive: true }
    );

    ui.hud.addEventListener('click', toggleHUD);
    ui.pause.addEventListener('click', togglePause);
    ui.resume.addEventListener('click', resumeDrone);

    window.addEventListener('keydown', event => {
      if (
        !ready ||
        stopped ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }

      const element = event.target;

      if (
        element.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
      ) {
        return;
      }

      if (
        event.code === 'Space' &&
        element.closest('button, summary, a')
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        togglePause();
      } else if (event.code === 'KeyR') {
        resumeDrone();
      } else if (event.code === 'KeyH') {
        toggleHUD();
      }
    });

    function motionChanged(event) {
      if (event.matches) {
        paused = true;
        lastUI = -Infinity;
      }
    }

    if (motionPreference.addEventListener) {
      motionPreference.addEventListener(
        'change',
        motionChanged
      );
    } else {
      motionPreference.addListener(motionChanged);
    }

    // Cap both device scale and total rendered pixel count.

    function pixelRatio() {
      return Math.min(
        window.devicePixelRatio || 1,
        1.6,
        Math.sqrt(2800000 / (width * height))
      );
    }

    function applyLens(dt = 0) {
      const shift = hud && width > 900
        ? ui.panel.getBoundingClientRect().right * 0.48
        : 0;

      viewShift = dt
        ? lerp(
            viewShift,
            shift,
            1 - Math.exp(-dt * 5)
          )
        : shift;

      camera.aspect = controlCamera.aspect =
        width / height;

      // Reserve visual space for the left HUD without changing geometry.

      camera.setViewOffset(
        width,
        height,
        -viewShift,
        0,
        width,
        height
      );

      controlCamera.setViewOffset(
        width,
        height,
        -viewShift,
        0,
        width,
        height
      );

      U.uPointScale.value =
        height * dpr /
        (
          2 *
          Math.tan(
            T.MathUtils.degToRad(camera.fov * 0.5)
          )
        );
    }

    function resize() {
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);
      dpr = pixelRatio();

      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);

      composer.setPixelRatio(dpr);
      composer.setSize(width, height);

      bloom.setSize(
        Math.ceil(width * dpr * 0.65),
        Math.ceil(height * dpr * 0.65)
      );

      fxaa.uniforms.resolution.value.set(
        1 / (width * dpr),
        1 / (height * dpr)
      );

      labelRenderer.setSize(width, height);

      applyLens();

      lastLayout = lastUI = -Infinity;
    }

    window.addEventListener('resize', resize);

    if (window.visualViewport) {
      window.visualViewport.addEventListener(
        'resize',
        resize
      );
    }

    // Template-based scientific annotations.

    const annotations = [];

    function annotation(
      template,
      category,
      tint,
      resolve
    ) {
      const root = document.createElement('div');
      root.className = 'world-anchor';

      const card = $(template)
        .content.firstElementChild.cloneNode(true);

      card.tabIndex = -1;
      card.setAttribute('aria-hidden', 'true');

      root.appendChild(card);

      const object = new T.CSS2DObject(root);
      object.visible = false;

      scene.add(object);

      const leader = new T.Line(
        new T.BufferGeometry().setAttribute(
          'position',
          new T.BufferAttribute(
            new Float32Array(6),
            3
          ).setUsage(T.DynamicDrawUsage)
        ),
        new T.LineBasicMaterial({
          color: C(tint),
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false
        })
      );

      leader.frustumCulled = false;
      leader.renderOrder = 20;
      leader.visible = false;

      scene.add(leader);

      card.addEventListener('pointerdown', event => {
        event.stopPropagation();
        enterManual(true);
      });

      card.addEventListener(
        'focusin',
        () => enterManual(true)
      );

      annotations.push({
        root,
        card,
        object,
        leader,
        resolve,
        category,
        anchor: V(),
        opacity: 0,
        target: 0,
        distance: 0
      });
    }

    const at4 = q => out => project4(q, out);

    annotation(
      'hypersphere-label-template',
      'exterior',
      0x70e7ff,
      at4(hyper(1.15, 1.05, 0.3))
    );

    const sectionAnchor = [0, 0, 0, 0];

    annotation(
      'slice-label-template',
      'slice',
      0xf3ce87,
      out => {
        const w = U.uSlice.value;

        sectionAnchor[0] =
          Math.sqrt(Math.max(0, 1 - w * w));

        sectionAnchor[3] = w;

        return project4(sectionAnchor, out, false);
      }
    );

    annotation(
      'coordinates-label-template',
      'coordinates',
      0xbc9aff,
      at4(hyper(1.55, 0.75, 2.3))
    );

    annotation(
      'rotation-label-template',
      'rotation',
      0xf29bdc,
      at4(hyper(0.9, 1.4, 4.1))
    );

    annotation(
      'geodesic-label-template',
      'geodesic',
      0x90baff,
      out => out.copy(tracer.position)
    );

    annotation(
      'projection-label-template',
      'projection',
      0x70e7ff,
      at4(hyper(0.8, 1.3, 0.8))
    );

    const tints = {
      electron: 0x90baff,
      photon: 0x70e7ff,
      proton: 0xf29bdc,
      neutrino: 0xbc9aff,
      higgs: 0xf3ce87
    };

    Object.keys(stations).forEach(key => {
      annotation(
        key + '-label-template',
        'particles',
        tints[key],
        out => out.copy(stations[key].position)
      );
    });

    const ranked = annotations.slice();

    const screenPoint = V();
    const endPoint = V();
    const centerPoint = V();

    function overlaps(a, b, gap = 12) {
      return (
        a.left < b.right + gap &&
        a.right > b.left - gap &&
        a.top < b.bottom + gap &&
        a.bottom > b.top - gap
      );
    }

    function projectScreen(position, out) {
      out.copy(position).project(camera);

      return (
        out.z > -1 &&
        out.z < 1 &&
        Math.abs(out.x) < 1.1 &&
        Math.abs(out.y) < 1.1
      );
    }

    function layoutLabels(stamp) {
      const occupied = [];

      function reserve(element) {
        if (
          !element.hidden &&
          element.getClientRects().length
        ) {
          occupied.push(
            element.getBoundingClientRect()
          );
        }
      }

      reserve(ui.controls);
      reserve(notice);

      if (hud) {
        reserve(ui.panel);
        reserve(ui.caption);
        reserve(ui.legend);
      }

      // Keep the central part of the main visualization unobstructed.

      if (
        stage !== 'particles' &&
        projectScreen(
          centerPoint.set(0, 0, 0),
          screenPoint
        )
      ) {
        const x =
          (screenPoint.x * 0.5 + 0.5) * width;

        const y =
          (0.5 - screenPoint.y * 0.5) * height;

        occupied.push({
          left: x - 70,
          right: x + 70,
          top: y - 65,
          bottom: y + 65
        });
      }

      ranked.forEach(a => {
        a.distance =
          camera.position.distanceTo(a.anchor);
      });

      ranked.sort((a, b) => {
        const aCurrent =
          a.category === stage ||
          (
            stage === 'return' &&
            a.category === 'exterior'
          );

        const bCurrent =
          b.category === stage ||
          (
            stage === 'return' &&
            b.category === 'exterior'
          );

        return (
          a.distance -
          (aCurrent ? 60 : 0) -
          b.distance +
          (bCurrent ? 60 : 0)
        );
      });

      let shown = 0;

      for (const a of ranked) {
        let chosen = null;

        const eligible =
          manual ||
          a.category === stage ||
          (
            stage === 'return' &&
            a.category === 'exterior'
          );

        const visible =
          projectScreen(a.anchor, screenPoint);

        const sx =
          (screenPoint.x * 0.5 + 0.5) * width;

        const sy =
          (0.5 - screenPoint.y * 0.5) * height;

        const w =
          a.card.offsetWidth ||
          (width <= 760 ? 280 : 310);

        const h = a.card.offsetHeight || 250;

        if (
          hud &&
          eligible &&
          visible &&
          a.distance > 2 &&
          a.distance < 160 &&
          shown < (width < 1000 ? 1 : 2)
        ) {
          const candidates = [
            [sx + 22, sy - h * 0.5],
            [sx - w - 22, sy - h * 0.5],
            [sx - w * 0.5, sy - h - 24],
            [sx - w * 0.5, sy + 24]
          ];

          for (const [left, top] of candidates) {
            const rect = {
              left,
              top,
              right: left + w,
              bottom: top + h
            };

            if (
              left < 12 ||
              top < 12 ||
              rect.right > width - 12 ||
              rect.bottom > height - 12
            ) {
              continue;
            }

            if (
              occupied.some(r => overlaps(rect, r))
            ) {
              continue;
            }

            chosen = rect;
            occupied.push(rect);
            shown++;

            break;
          }
        }

        a.target = chosen ? 1 : 0;

        if (chosen) {
          a.card.style.left =
            (chosen.left - sx) + 'px';

          a.card.style.top =
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

          // Relative offsets keep the connector attached while
          // the world anchor moves between layout updates.
          a.endOffset = [ex - sx, ey - sy];
        } else if (
          a.card.contains(document.activeElement)
        ) {
          ui.hud.focus({ preventScroll: true });
        }
      }

      let namesShown = 0;

      for (const label of worldNames) {
        const distance =
          camera.position.distanceTo(
            label.object.position
          );

        let show =
          hud &&
          (manual || label.category === stage) &&
          distance < 66 &&
          distance > 3 &&
          namesShown < 3;

        if (
          show &&
          projectScreen(
            label.object.position,
            screenPoint
          )
        ) {
          const sx =
            (screenPoint.x * 0.5 + 0.5) * width;

          const sy =
            (0.5 - screenPoint.y * 0.5) * height;

          const w = label.element.offsetWidth || 220;
          const h = label.element.offsetHeight || 28;

          const rect = {
            left: sx - w / 2,
            right: sx + w / 2,
            top: sy - h / 2,
            bottom: sy + h / 2
          };

          show =
            rect.left > 12 &&
            rect.right < width - 12 &&
            rect.top > 12 &&
            rect.bottom < height - 12 &&
            !occupied.some(
              r => overlaps(rect, r, 5)
            );

          if (show) {
            occupied.push(rect);
            namesShown++;
          }
        } else {
          show = false;
        }

        label.object.visible = show;

        label.element.setAttribute(
          'aria-hidden',
          String(!show)
        );
      }

      lastLayout = stamp;
    }

    function updateLabels(dt, stamp) {
      annotations.forEach(a => {
        a.resolve(a.anchor);
        a.object.position.copy(a.anchor);
      });

      if (stamp - lastLayout > 120) {
        layoutLabels(stamp);
      }

      for (const a of annotations) {
        a.opacity = lerp(
          a.opacity,
          hud ? a.target : 0,
          1 - Math.exp(-dt * 12)
        );

        a.object.visible =
          hud && a.opacity > 0.015;

        a.root.style.opacity =
          a.opacity.toFixed(3);

        const interactive =
          a.object.visible &&
          a.target > 0 &&
          a.opacity > 0.45;

        if (interactive !== a.interactive) {
          a.interactive = interactive;

          a.card.tabIndex = interactive ? 0 : -1;

          a.card.setAttribute(
            'aria-hidden',
            String(!interactive)
          );

          a.card.style.pointerEvents =
            interactive ? 'auto' : 'none';
        }

        a.leader.visible =
          a.object.visible && a.target > 0;

        a.leader.material.opacity =
          a.opacity * 0.5;

        if (
          a.leader.visible &&
          a.endOffset
        ) {
          screenPoint
            .copy(a.anchor)
            .project(camera);

          const ex =
            (screenPoint.x * 0.5 + 0.5) * width +
            a.endOffset[0];

          const ey =
            (0.5 - screenPoint.y * 0.5) * height +
            a.endOffset[1];

          endPoint
            .set(
              ex / width * 2 - 1,
              1 - ey / height * 2,
              screenPoint.z
            )
            .unproject(camera);

          a.anchor.toArray(
            a.leader.geometry.attributes.position.array,
            0
          );

          endPoint.toArray(
            a.leader.geometry.attributes.position.array,
            3
          );

          a.leader.geometry.attributes.position.needsUpdate =
            true;
        }
      }
    }

    // Throttled telemetry and chapter text.

    const clockText = seconds =>
      Math.floor(seconds / 60) +
      ':' +
      String(
        Math.floor(seconds % 60)
      ).padStart(2, '0');

    let previousChapter = -1;

    function updateHUD(stamp) {
      if (stamp - lastUI < 150) {
        return;
      }

      lastUI = stamp;

      const t = flight % PERIOD;
      const w = U.uSlice.value;

      ui.w.textContent =
        (w >= 0 ? '+' : '') + w.toFixed(3);

      ui.radius.textContent =
        Math.sqrt(
          Math.max(0, 1 - w * w)
        ).toFixed(3);

      ui.angle.textContent =
        (
          ((angles[0] % TAU) + TAU) %
          TAU * 180 / Math.PI
        ).toFixed(1) + '°';

      ui.planes.textContent =
        'XW · YW · ZW · XY';

      ui.projection.textContent =
        'PERSPECTIVE';

      ui.projectionDistance.textContent =
        U.uDistance.value.toFixed(3);

      ui.geodesic.textContent =
        ((time * 0.085 / TAU) % 1).toFixed(3);

      ui.distance.textContent =
        camera.position.length().toFixed(1) + ' u';

      ui.mode.textContent = paused
        ? 'PAUSED / ' + (manual ? 'MANUAL' : 'DRONE')
        : returning
          ? 'RETURNING TO DRONE'
          : manual
            ? 'MANUAL INSPECTION'
            : 'AUTOMATIC DRONE';

      ui.pause.textContent =
        paused ? 'Play' : 'Pause';

      ui.pause.setAttribute(
        'aria-pressed',
        String(paused)
      );

      ui.clock.textContent =
        clockText(t) + ' / 8:00';

      ui.fill.style.transform =
        'scaleX(' + t / PERIOD + ')';

      ui.progress.setAttribute(
        'aria-valuenow',
        String(Math.round(t / PERIOD * 100))
      );

      ui.progress.setAttribute(
        'aria-valuetext',
        clockText(t) + ' of 8 minutes'
      );

      if (stageIndex !== previousChapter) {
        previousChapter = stageIndex;

        const chapter = chapters[stageIndex];

        ui.chapter.textContent =
          String(stageIndex + 1).padStart(2, '0') +
          ' / ' +
          chapter[2];

        ui.title.textContent = chapter[3];
        ui.description.textContent = chapter[4];

        [...ui.stages.children].forEach(item => {
          const active =
            item.dataset.stage === stage;

          item.classList.toggle(
            'is-active',
            active
          );

          if (active) {
            item.setAttribute(
              'aria-current',
              'step'
            );
          } else {
            item.removeAttribute('aria-current');
          }
        });

        lastLayout = -Infinity;
      }
    }

    // Initialize the first pose before the first rendered frame.

    updateModel();
    sampleFlight();

    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);
    camera.fov = desiredFov;

    focusDistance = desiredDistance;

    resize();
    syncControls();

    function frame(stamp) {
      if (stopped) {
        return;
      }

      requestAnimationFrame(frame);

      if (document.hidden || contextLost) {
        lastStamp = 0;
        return;
      }

      try {
        const dt = lastStamp
          ? Math.min(
              (stamp - lastStamp) / 1000,
              0.05
            )
          : 0;

        lastStamp = stamp;

        // Scene time remains continuous when the eight-minute
        // camera itinerary loops. Manual mode freezes only the flight.

        if (!paused && !returning) {
          time += dt;

          if (!manual) {
            flight += dt;
          }
        }

        updateModel();

        if (returning) {
          if (!paused) {
            returning.elapsed += dt;
          }

          const r = returning;

          const u = ease(
            clamp(
              r.elapsed / r.duration,
              0,
              1
            )
          );

          camera.position.lerpVectors(
            r.from,
            r.to,
            u
          );

          camera.position.y +=
            r.lift * Math.sin(Math.PI * u) ** 2;

          camera.quaternion
            .copy(r.rotation)
            .slerp(r.goal, u);

          camera.fov = lerp(
            r.fovFrom,
            r.fovTo,
            u
          );

          focusDistance = lerp(
            r.focusFrom,
            r.focusTo,
            u
          );

          if (u >= 1) {
            returning = null;
          }
        } else if (manual) {
          controls.update();

          const a =
            1 - Math.exp(-dt * 14);

          camera.position.lerp(
            controlCamera.position,
            a
          );

          camera.quaternion.slerp(
            controlCamera.quaternion,
            a
          );

          camera.fov = controlCamera.fov;
          camera.zoom = controlCamera.zoom;

          focusDistance =
            controlCamera.position.distanceTo(
              controls.target
            );
        } else if (!paused) {
          sampleFlight();

          const a =
            1 - Math.exp(-dt * 4);

          camera.position.lerp(
            desiredPosition,
            a
          );

          camera.quaternion.slerp(
            desiredQuaternion,
            a
          );

          camera.fov = lerp(
            camera.fov,
            desiredFov,
            a
          );

          focusDistance = desiredDistance;
        }

        if (
          Math.abs(pixelRatio() - dpr) > 0.01
        ) {
          resize();
        }

        applyLens(dt);
        camera.updateMatrixWorld(true);

        if (!manual) {
          syncControls();
        }

        updateExhibits();
        updateLabels(dt, stamp);
        updateHUD(stamp);

        composer.render();
        labelRenderer.render(scene, camera);

        if (!ready) {
          ready = true;
          notice.hidden = true;

          container.setAttribute(
            'aria-busy',
            'false'
          );

          document.querySelectorAll(
            '[data-engine-control]'
          ).forEach(button => {
            button.disabled = false;
          });

          lastLayout = -Infinity;
        }
      } catch (error) {
        stopped = true;
        controls.enabled = false;
        fail(error);
      }
    }

    renderer.domElement.addEventListener(
      'webglcontextlost',
      event => {
        event.preventDefault();

        contextLost = true;
        controls.enabled = false;
        lastStamp = 0;

        notice.hidden = false;
        notice.setAttribute('role', 'status');

        notice.textContent =
          'The graphics context was interrupted. ' +
          'Waiting for the browser to restore it.';
      }
    );

    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        contextLost = false;
        controls.enabled = manual;
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

    requestAnimationFrame(frame);
  }
})();