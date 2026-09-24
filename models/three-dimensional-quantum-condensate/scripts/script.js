/* script.js
 * Three-Dimensional Quantum Condensate
 * Prescribed mean-field geometry and reference-scaled particle illustrations.
 * https://arxiv.org/abs/cond-mat/9806038
 * https://arxiv.org/abs/1004.4071
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
      'Graphics libraries could not load. Check your connection and reload.';
    return;
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    notice.hidden = false;
    notice.textContent = 'Unable to start the scene: ' + error.message;
  }

  function initialize() {
    const T = THREE;
    const TAU = Math.PI * 2;
    const PERIOD = 228;
    const XI = 1.25;

    const clamp = T.MathUtils.clamp;
    const lerp = T.MathUtils.lerp;

    const smooth = (a, b, x) => {
      x = clamp((x - a) / (b - a), 0, 1);
      return x * x * (3 - 2 * x);
    };

    const ease = x => x * x * x * (x * (x * 6 - 15) + 10);

    const $ = id => {
      const element = document.getElementById(id);
      if (!element) {
        throw new Error('Missing element: ' + id);
      }
      return element;
    };

    const ui = {
      panel: $('sidebar-ui'),
      content: $('sidebar-content'),
      hud: $('hud-toggle'),
      pause: $('pause-toggle'),
      resume: $('resume-flight'),
      mode: $('flight-mode'),
      density: $('density-value'),
      coherence: $('coherence-value'),
      healing: $('healing-value'),
      potential: $('potential-value'),
      progress: $('journey-progress'),
      fill: $('flight-progress'),
      stages: [...$('journey-stages').children],
      chapter: $('chapter-value'),
      title: $('scene-title'),
      description: $('scene-description'),
      caption: $('scene-caption'),
      controls: $('flight-controls')
    };

    let time = 0;
    let flight = 0;
    let lastStamp = 0;
    let lastUI = -Infinity;

    let manual = false;
    let paused = false;
    let hud = true;
    let returning = null;
    let contextLost = false;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let focusDistance = 55;
    let stage = 'bulk';

    let seed = 258731;

    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const color = hex => new T.Color(hex).convertSRGBToLinear();
    const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);

    const radii = V(24, 11, 20);

    const coreLocations = [
      V(-7, 0, 1),
      V(6, 0, -6),
      V(9, 0, 8)
    ];

    const probe = V(-3, 4, -2);

    const scene = new T.Scene();
    scene.background = new T.Color(0x000000);
    scene.fog = new T.FogExp2(0x000000, 0.0032);

    const camera = new T.PerspectiveCamera(54, 1, 0.045, 650);
    camera.up.set(0, 1, 0);
    camera.position.set(52, 30, 66);
    camera.lookAt(0, -2, 6);

    const aimCamera = new T.PerspectiveCamera();
    aimCamera.up.copy(camera.up);

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
      'Quantum condensate. Drag to orbit and scroll to zoom.'
    );
    container.appendChild(renderer.domElement);

    const labelRenderer = new T.CSS2DRenderer();
    labelRenderer.domElement.id = 'label-layer';
    container.appendChild(labelRenderer.domElement);

    const gl = renderer.getContext();
    const maxPoint = Math.min(
      96,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    const hdr =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    const targetType = hdr ? T.HalfFloatType : T.UnsignedByteType;

    const U = {
      uTime: { value: 0 },
      uXi: { value: XI },
      uBulk: { value: 1 },
      uFog: { value: scene.fog.density },
      uPointScale: { value: 1 },
      uPointLimit: { value: maxPoint },
      uRadii: { value: radii },
      uCores: { value: coreLocations }
    };

    function bulkDensity() {
      return 1 + 0.04 * Math.sin(time * 0.22);
    }

    function densityAt(p) {
      let n =
        Math.max(
          0,
          1 - (p.x / 24) ** 2 - (p.y / 11) ** 2 - (p.z / 20) ** 2
        ) * bulkDensity();

      n *= Math.tanh(p.y / (Math.SQRT2 * U.uXi.value)) ** 2;

      for (const c of coreLocations) {
        const d2 = (p.x - c.x) ** 2 + (p.z - c.z) ** 2;
        n *= d2 / (d2 + U.uXi.value ** 2);
      }

      return n;
    }

    function potentialAt(p) {
      return (
        0.5 * ((p.x / 24) ** 2 + (p.y / 11) ** 2 + (p.z / 20) ** 2) +
        0.16 *
          (
            Math.sin(Math.PI * p.x / 4) ** 2 +
            Math.sin(Math.PI * p.y / 4) ** 2 +
            Math.sin(Math.PI * p.z / 4) ** 2
          )
      );
    }

    const fieldGLSL = `
      uniform float uTime, uXi, uBulk, uFog;
      uniform vec3 uRadii, uCores[3];

      float tanhSafe(float x) {
        float e = exp(-2.0 * min(abs(x), 20.0));
        return sign(x) * (1.0 - e) / (1.0 + e);
      }

      float defects(vec3 p) {
        float s = tanhSafe(p.y / (1.41421356 * uXi));
        float n = s * s;

        for (int i = 0; i < 3; i++) {
          vec2 d = p.xz - uCores[i].xz;
          float r2 = dot(d, d);
          n *= r2 / (r2 + uXi * uXi);
        }

        return n;
      }

      float density(vec3 p) {
        vec3 q = p / uRadii;
        return max(0.0, 1.0 - dot(q, q)) * defects(p) * uBulk;
      }

      float phaseField(vec3 p) {
        float phase =
          0.6 * sin(p.x * 0.14 + uTime * 0.3) +
          0.3 * cos(p.z * 0.19 - uTime * 0.21);

        phase += p.y < 0.0 ? 3.14159265 : 0.0;

        for (int i = 0; i < 3; i++) {
          vec2 d = p.xz - uCores[i].xz;
          phase += atan(d.y, d.x);
        }

        return phase;
      }

      float fogFactor(float d) {
        return exp(-uFog * uFog * d * d);
      }
    `;

    const hullMaterial = new T.ShaderMaterial({
      uniforms: U,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending,
      extensions: { derivatives: true },

      vertexShader: fieldGLSL + `
        varying vec3 vWorld, vLocal;
        varying vec2 vUv;
        varying float vDepth;

        void main() {
          vec3 q = position;

          float ripple =
            0.026 *
            sin(q.x * 8.0 + uTime * 0.48) *
            cos(q.z * 7.0 - uTime * 0.31);

          ripple +=
            0.012 *
            sin(q.y * 15.0 + q.x * 5.0 - uTime * 0.72);

          vec3 p = q * uRadii * (1.0 + ripple);

          vLocal = p;
          vUv = uv;
          vWorld = (modelMatrix * vec4(p, 1.0)).xyz;

          vec4 mv = viewMatrix * vec4(vWorld, 1.0);
          vDepth = length(mv.xyz);

          gl_Position = projectionMatrix * mv;
        }
      `,

      fragmentShader: fieldGLSL + `
        varying vec3 vWorld, vLocal;
        varying vec2 vUv;
        varying float vDepth;

        void main() {
          float mask = defects(vLocal);

          if (mask < 0.003) discard;

          vec3 normal = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
          vec3 viewDirection = normalize(cameraPosition - vWorld);

          float rim = pow(
            1.0 - abs(dot(normal, viewDirection)),
            2.0
          );

          float phase = phaseField(vLocal);
          float shade = 0.5 + 0.5 * sin(phase + vLocal.y * 0.12);

          vec3 neon = mix(
            vec3(0.015, 0.63, 1.1),
            vec3(0.54, 0.025, 1.2),
            shade
          );

          vec2 grid =
            vUv * vec2(96.0, 48.0) +
            vec2(phase * 0.18, 0.0);

          vec2 lines =
            abs(fract(grid - 0.5) - 0.5) /
            max(fwidth(grid), vec2(0.001));

          float wire =
            1.0 - smoothstep(0.3, 1.2, min(lines.x, lines.y));

          float ripple = pow(
            0.5 + 0.5 *
              sin(phase * 4.0 - vLocal.y * 1.3 - uTime * 0.65),
            12.0
          );

          vec3 light = neon *
            (0.07 + wire * 0.6 + rim * 2.2 + ripple * 0.75);

          float alpha =
            (0.10 + rim * 0.30 + wire * 0.13) * mask;

          gl_FragColor = vec4(light * fogFactor(vDepth), alpha);
        }
      `
    });

    const hull = new T.Mesh(
      new T.SphereGeometry(1, 160, 96),
      hullMaterial
    );

    hull.frustumCulled = false;
    hull.renderOrder = 4;
    scene.add(hull);

    const pointVertex = fieldGLSL + `
      uniform float uPointScale, uPointLimit, uMode;

      attribute float aSize, aPhase;
      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        float alpha = 1.0;
        vec3 c = aColor;

        if (uMode < 0.5) {
          p += vec3(
            0.13 * sin(p.y * 0.4 + uTime * 0.6 + aPhase),
            0.11 * sin(p.z * 0.3 - uTime * 0.5),
            0.13 * cos(p.x * 0.3 + uTime * 0.4)
          );

          alpha = pow(density(p), 0.65) * 0.54;

          c = mix(
            vec3(0.02, 0.62, 1.0),
            vec3(0.46, 0.04, 1.0),
            0.5 + 0.5 * sin(phaseField(p))
          );
        } else if (uMode < 1.5) {
          float pulse = 1.0 + 0.045 * sin(uTime * 1.15 + aPhase);
          p *= pulse;

          alpha = 0.45 + 0.35 * pow(
            0.5 + 0.5 *
              sin(length(p) * 8.0 - uTime * 2.0 + aPhase),
            2.0
          );
        } else if (uMode > 2.5) {
          alpha = 0.28;

          for (int i = 0; i < 3; i++) {
            alpha *= smoothstep(
              uXi * 0.8,
              uXi * 1.9,
              length(p.xz - uCores[i].xz)
            );
          }
        }

        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float distanceToEye = length(mv.xyz);

        vAlpha = alpha * fogFactor(distanceToEye);
        vColor = c;

        gl_PointSize = clamp(
          aSize * uPointScale / max(0.1, -mv.z),
          1.0,
          uPointLimit
        );

        gl_Position = projectionMatrix * mv;
      }
    `;

    const pointFragment = `
      uniform float uTime;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        if (vAlpha < 0.005) discard;

        float r = length(gl_PointCoord - 0.5) * 2.0;
        if (r > 1.0) discard;

        float halo = exp(-r * r * 4.5);
        float core = exp(-r * r * 22.0);

        gl_FragColor = vec4(
          vColor * (0.8 + core * 1.8),
          (halo + core * 0.4) *
            vAlpha *
            (1.0 - smoothstep(0.75, 1.0, r))
        );
      }
    `;

    function pointCloud(entries, mode = 2, parent = scene) {
      const positions = [];
      const colors = [];
      const sizes = [];
      const phases = [];

      for (const p of entries) {
        const c = color(p.color || 0x77dfff);

        positions.push(p.x, p.y, p.z);
        colors.push(c.r, c.g, c.b);
        sizes.push(p.size || 0.16);
        phases.push(random() * TAU);
      }

      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        'position',
        new T.Float32BufferAttribute(positions, 3)
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
          ...U,
          uMode: { value: mode }
        },
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const points = new T.Points(geometry, material);
      points.frustumCulled = false;
      parent.add(points);

      return points;
    }

    function randomSphere() {
      const z = random() * 2 - 1;
      const a = random() * TAU;
      const r = Math.sqrt(1 - z * z);

      return V(r * Math.cos(a), z, r * Math.sin(a));
    }

    const fluid = [];

    for (let i = 0; i < 12500; i++) {
      const p = randomSphere().multiplyScalar(Math.cbrt(random()));

      fluid.push({
        x: p.x * 24,
        y: p.y * 11,
        z: p.z * 20,
        size: 0.11 + random() * 0.17
      });
    }

    pointCloud(fluid, 0).renderOrder = 2;

    const gridPositions = [];
    const gridNodes = [];

    function gridLine(a, b) {
      gridPositions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }

    for (let y = -12; y <= 12; y += 4) {
      for (let z = -20; z <= 20; z += 4) {
        gridLine(V(-24, y, z), V(24, y, z));
      }
    }

    for (let x = -24; x <= 24; x += 4) {
      for (let z = -20; z <= 20; z += 4) {
        gridLine(V(x, -12, z), V(x, 12, z));
      }
    }

    for (let x = -24; x <= 24; x += 4) {
      for (let y = -12; y <= 12; y += 4) {
        gridLine(V(x, y, -20), V(x, y, 20));
      }
    }

    for (let x = -24; x <= 24; x += 4) {
      for (let y = -12; y <= 12; y += 4) {
        for (let z = -20; z <= 20; z += 4) {
          gridNodes.push({
            x,
            y,
            z,
            size: 0.16,
            color: 0x60caff
          });
        }
      }
    }

    const gridGeometry = new T.BufferGeometry();

    gridGeometry.setAttribute(
      'position',
      new T.Float32BufferAttribute(gridPositions, 3)
    );

    const grid = new T.LineSegments(
      gridGeometry,
      new T.ShaderMaterial({
        uniforms: U,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending,

        vertexShader: fieldGLSL + `
          varying float vAlpha, vDepth;

          void main() {
            vec3 q = position / uRadii;
            vAlpha = 0.16 * exp(-dot(q, q) * 0.5);

            for (int i = 0; i < 3; i++) {
              vAlpha *= smoothstep(
                uXi * 0.8,
                uXi * 1.8,
                length(position.xz - uCores[i].xz)
              );
            }

            vec4 mv = modelViewMatrix * vec4(position, 1.0);

            vDepth = length(mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,

        fragmentShader: `
          uniform float uFog;
          varying float vAlpha, vDepth;

          void main() {
            gl_FragColor = vec4(
              vec3(0.12, 0.42, 0.72),
              vAlpha * exp(-uFog * uFog * vDepth * vDepth)
            );
          }
        `
      })
    );

    scene.add(grid);
    pointCloud(gridNodes, 3);

    const tubeGeometry = new T.TubeGeometry(
      new T.LineCurve3(V(0, 0, 0), V(1, 0, 0)),
      160,
      1,
      7,
      false
    );

    const tubeVertex = `
      uniform float uTime, uType, uRadius, uPhase, uThickness;
      uniform vec3 uEnd;

      varying vec3 vWorld, vNormal;
      varying vec2 vUv;
      varying float vDepth;

      vec3 path(float t) {
        if (uType < 0.5) {
          float y = (t - 0.5) * 28.0;
          float a = t * 37.6991118 + uTime * 0.65 + uPhase;

          float r =
            uRadius * (1.0 + 0.06 * sin(y * 0.45 - uTime * 0.4));

          return vec3(cos(a) * r, y, sin(a) * r);
        }

        if (uType < 2.5) {
          float x = (t - 0.5) * 8.0;
          float envelope = exp(-x * x * 0.15);
          float wave = sin(x * 5.0 - uTime * 5.0) * envelope;

          if (uType < 1.5) {
            return vec3(x, wave * 0.78, 0.0);
          }

          return vec3(x, 0.0, wave * 0.60);
        }

        if (uType < 3.5) {
          float envelope = sin(3.14159265 * t);
          vec3 tangent = normalize(uEnd);

          vec3 up = abs(tangent.y) > 0.9
            ? vec3(1.0, 0.0, 0.0)
            : vec3(0.0, 1.0, 0.0);

          vec3 right = normalize(cross(tangent, up));
          vec3 second = normalize(cross(tangent, right));

          float a = t * 18.8495559 + uTime * 1.7 + uPhase;

          return uEnd * t +
            envelope *
            (right * cos(a) + second * sin(a)) *
            (0.19 + 0.035 * sin(uTime * 2.1 + uPhase));
        }

        float a = t * 6.2831853;

        return uRadius * vec3(
          cos(a * 2.0 + uPhase + uTime * 0.06),
          sin(a * 3.0 + uPhase * 0.7 - uTime * 0.04) * 0.76,
          sin(a * 5.0 + uPhase + uTime * 0.05)
        );
      }

      void main() {
        float t = uv.x;
        vec3 p = path(t);

        vec3 tangent = normalize(
          path(t + 0.001) - path(t - 0.001)
        );

        vec3 up = abs(tangent.y) > 0.9
          ? vec3(1.0, 0.0, 0.0)
          : vec3(0.0, 1.0, 0.0);

        vec3 normal = normalize(cross(tangent, up));
        vec3 binormal = normalize(cross(tangent, normal));

        float a = uv.y * 6.2831853;
        vec3 radial = cos(a) * normal + sin(a) * binormal;

        p += radial * uThickness;

        vUv = uv;
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * radial);

        vec4 mv = viewMatrix * vec4(vWorld, 1.0);
        vDepth = length(mv.xyz);

        gl_Position = projectionMatrix * mv;
      }
    `;

    const tubeFragment = `
      uniform float uTime, uFog, uOpacity, uType, uPhase;
      uniform vec3 uColor;

      varying vec3 vWorld, vNormal;
      varying vec2 vUv;
      varying float vDepth;

      void main() {
        float rim = pow(
          1.0 - abs(dot(
            normalize(vNormal),
            normalize(cameraPosition - vWorld)
          )),
          2.0
        );

        float flow = pow(
          0.5 + 0.5 * sin(
            vUv.x * 65.0 -
            uTime * (uType < 0.5 ? 2.0 : 4.0) +
            uPhase
          ),
          10.0
        );

        float fog = exp(-uFog * uFog * vDepth * vDepth);

        vec3 light = uColor *
          (0.55 + rim * 0.75 + flow * 1.25);

        gl_FragColor = vec4(light * fog, uOpacity);
      }
    `;

    function tube(type, parent, options = {}) {
      const c = color(options.color || 0x70dbff)
        .multiplyScalar(options.energy || 1.7);

      const uniforms = {
        uTime: U.uTime,
        uFog: U.uFog,
        uType: { value: type },
        uRadius: { value: options.radius || XI },
        uPhase: { value: options.phase || 0 },
        uThickness: { value: options.thickness || 0.035 },
        uEnd: { value: options.end || V(1, 0, 0) },
        uColor: { value: c },
        uOpacity: {
          value: options.opacity === undefined ? 0.72 : options.opacity
        }
      };

      const mesh = new T.Mesh(
        tubeGeometry,
        new T.ShaderMaterial({
          uniforms,
          vertexShader: tubeVertex,
          fragmentShader: tubeFragment,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending
        })
      );

      mesh.frustumCulled = false;
      parent.add(mesh);

      return mesh;
    }

    const coreGroups = [];
    const torusCore = new T.TorusGeometry(XI, 0.027, 5, 96);

    torusCore.rotateX(Math.PI / 2);

    coreLocations.forEach((location, index) => {
      const group = new T.Group();
      group.position.copy(location);

      scene.add(group);
      coreGroups.push(group);

      for (let j = 0; j < 3; j++) {
        tube(0, group, {
          radius: XI * (1 + j * 0.18),
          phase: j * TAU / 3,
          color: index % 2 ? 0xbe82ff : 0x57dbff,
          thickness: 0.028,
          opacity: 0.6
        });
      }

      const rings = new T.InstancedMesh(
        torusCore,
        new T.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.4,
          depthWrite: false,
          blending: T.AdditiveBlending
        }),
        17
      );

      const matrix = new T.Matrix4();

      for (let j = 0; j < 17; j++) {
        matrix.makeTranslation(0, -12 + j * 1.5, 0);
        rings.setMatrixAt(j, matrix);

        rings.setColorAt(
          j,
          color(j % 3 ? 0x58d9ff : 0xcc82ff).multiplyScalar(1.4)
        );
      }

      rings.instanceMatrix.needsUpdate = true;
      rings.instanceColor.needsUpdate = true;
      rings.frustumCulled = false;

      group.add(rings);
    });

    const soliton = new T.Mesh(
      new T.PlaneGeometry(48, 40),
      new T.ShaderMaterial({
        uniforms: U,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,

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
          uniform float uTime;
          varying vec2 vUv;

          void main() {
            vec2 q = (vUv - 0.5) * 2.0;
            float r = length(q);

            if (r > 1.0) discard;

            float rim = exp(-pow((r - 0.92) * 45.0, 2.0));
            float notch = 1.0 - smoothstep(0.88, 1.0, r);

            vec3 c = vec3(0.16, 0.015, 0.32) * rim;

            gl_FragColor = vec4(
              c,
              notch * 0.28 + rim * 0.2
            );
          }
        `
      })
    );

    soliton.rotation.x = -Math.PI / 2;
    soliton.renderOrder = 3;
    scene.add(soliton);

    const tof = [];
    const tofGeometry = new T.TorusGeometry(1, 0.014, 6, 128);

    tofGeometry.rotateY(Math.PI / 2);

    for (let i = 0; i < 9; i++) {
      const material = new T.MeshBasicMaterial({
        color: color(i % 2 ? 0xa180ff : 0x66deff).multiplyScalar(1.7),
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const ring = new T.Mesh(tofGeometry, material);

      scene.add(ring);
      tof.push(ring);
    }

    const inspection = new T.Group();
    scene.add(inspection);

    const simpleLabels = [];

    function simpleLabel(
      text,
      position,
      tint = '#a9bdd6',
      limit = 50
    ) {
      const element = document.createElement('span');
      element.textContent = text;

      Object.assign(element.style, {
        fontFamily: 'Consolas, monospace',
        fontSize: '10px',
        color: tint,
        whiteSpace: 'nowrap',
        padding: '4px 7px',
        border: '1px solid rgba(105,135,175,.2)',
        borderRadius: '2px',
        background: 'rgba(3,5,16,.75)',
        pointerEvents: 'none'
      });

      const object = new T.CSS2DObject(element);
      object.position.copy(position);

      scene.add(object);
      simpleLabels.push({ object, element, limit });

      return object;
    }

    function groupAt(x, y, z) {
      const group = new T.Group();
      group.position.set(x, y, z);
      inspection.add(group);

      return group;
    }

    const molecule = groupAt(-27, -18, 34);
    const atom = groupAt(-16, -18, 34);
    const nucleus = groupAt(-5, -18, 34);
    const proton = groupAt(6, -18, 34);
    const electron = groupAt(-23, -28, 34);
    const photon = groupAt(-10, -28, 34);
    const weak = groupAt(7, -28, 34);
    const higgs = groupAt(23, -20, 34);

    const beadGeometry = new T.SphereGeometry(1, 24, 16);

    function bead(parent, position, radius, tint, energy = 1.4) {
      const mesh = new T.Mesh(
        beadGeometry,
        new T.MeshBasicMaterial({
          color: color(tint).multiplyScalar(energy)
        })
      );

      mesh.position.copy(position);
      mesh.scale.setScalar(radius);
      parent.add(mesh);

      return mesh;
    }

    function orbitalEntries(count, radius, tint) {
      const entries = [];

      for (let i = 0; i < count; i++) {
        const p = randomSphere();

        const r =
          -Math.log(Math.max(1e-8, random() * random() * random())) *
          radius / 3;

        p.multiplyScalar(Math.min(r, radius * 3));

        entries.push({
          x: p.x,
          y: p.y,
          z: p.z,
          size: radius * 0.055 + random() * radius * 0.035,
          color: tint
        });
      }

      return entries;
    }

    for (let side = -1; side <= 1; side += 2) {
      bead(
        molecule,
        V(side * 1.15, 0, 0),
        0.42,
        side < 0 ? 0x78baff : 0xff907b,
        1.15
      );

      const cloud = pointCloud(
        orbitalEntries(650, 0.9, 0x649cff),
        1,
        molecule
      );

      cloud.position.x = side * 1.15;
    }

    const bond = new T.Mesh(
      new T.CylinderGeometry(0.055, 0.055, 2.3, 12),
      new T.MeshBasicMaterial({
        color: color(0x85c4ef).multiplyScalar(1.4)
      })
    );

    bond.rotation.z = Math.PI / 2;
    molecule.add(bond);

    pointCloud(
      orbitalEntries(1500, 1.65, 0x79b8ff),
      1,
      atom
    );

    for (let i = 0; i < 9; i++) {
      const p = randomSphere()
        .multiplyScalar(Math.cbrt(random()) * 0.42);

      bead(
        atom,
        p,
        0.16,
        i % 2 ? 0xff7d8c : 0x76b8ff,
        1.25
      );
    }

    for (let i = 0; i < 26; i++) {
      const p = randomSphere()
        .multiplyScalar(Math.cbrt(random()) * 1.45);

      bead(
        nucleus,
        p,
        0.32,
        i % 2 ? 0xff7380 : 0x739eff,
        1.2
      );
    }

    pointCloud(
      orbitalEntries(2400, 1.65, 0x67bdff),
      1,
      electron
    );

    tube(1, photon, {
      color: 0xffc35a,
      energy: 2.3,
      thickness: 0.045,
      opacity: 0.95
    });

    tube(2, photon, {
      color: 0xffed97,
      energy: 1.7,
      thickness: 0.028,
      opacity: 0.6
    });

    const photonAxis = new T.BufferGeometry().setFromPoints([
      V(-4.4, 0, 0),
      V(4.4, 0, 0)
    ]);

    photon.add(
      new T.Line(
        photonAxis,
        new T.LineBasicMaterial({
          color: 0x6b5028,
          transparent: true,
          opacity: 0.7
        })
      )
    );

    const weakMeshes = [];
    const weakGeometry = new T.TorusGeometry(0.95, 0.058, 12, 160);

    for (let i = 0; i < 3; i++) {
      const mesh = new T.Mesh(
        weakGeometry,
        new T.MeshBasicMaterial({
          color: color(0xb267ff).multiplyScalar(2.4),
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          blending: T.AdditiveBlending
        })
      );

      mesh.position.x = (i - 1) * 2.7;

      weak.add(mesh);
      weakMeshes.push(mesh);

      simpleLabel(
        ['W⁺', 'W⁻', 'Z⁰'][i],
        V(weak.position.x + mesh.position.x, -29.7, 34),
        '#cda7ff',
        34
      );
    }

    const weakLinks = new T.BufferGeometry().setFromPoints([
      V(-2.7, 0, 0),
      V(0, 0, 0),
      V(2.7, 0, 0)
    ]);

    weak.add(
      new T.Line(
        weakLinks,
        new T.LineBasicMaterial({
          color: 0x894de4,
          transparent: true,
          opacity: 0.5
        })
      )
    );

    for (let i = 0; i < 11; i++) {
      tube(4, higgs, {
        color: i % 3 ? 0xffc84d : 0xffedaa,
        energy: 1.4,
        phase: i * 0.73,
        radius: 2.4 + i * 0.095,
        thickness: 0.018,
        opacity: 0.45
      });
    }

    bead(higgs, V(), 0.16, 0xffefab, 3.0);

    const quarkColors = [0xff405c, 0x46ff9a, 0x5795ff];
    const quarkMeshes = [];
    const gluonMeshes = [];
    const quarkLabels = [];

    for (let i = 0; i < 3; i++) {
      const a = i * TAU / 3;

      const p = V(
        Math.cos(a) * 1.35,
        Math.sin(a) * 1.1,
        Math.sin(a * 2) * 0.35
      );

      quarkMeshes.push(
        bead(proton, p, 0.34, quarkColors[i], 2.0)
      );

      gluonMeshes.push(
        tube(3, proton, {
          end: p.clone(),
          phase: i * 2.1,
          color: quarkColors[i],
          energy: 2.25,
          thickness: 0.046,
          opacity: 0.92
        })
      );

      const label = simpleLabel(
        ['u · r', 'u · g', 'd · b'][i],
        p.clone().add(proton.position),
        ['#ff9cac', '#a3ffd2', '#aacdff'][i],
        27
      );

      quarkLabels.push(label);
    }

    const catalog = ['u', 'd', 's', 'c', 'b', 't'];

    for (let i = 0; i < catalog.length; i++) {
      const x = -4 + i * 4.5;
      const y = -35.5;
      const z = 34;

      bead(
        inspection,
        V(x, y, z),
        0.28,
        0x9fbce6,
        1.3
      );

      const charge =
        ['u', 'c', 't'].includes(catalog[i]) ? '+⅔e' : '−⅓e';

      simpleLabel(
        catalog[i] + '  ' + charge,
        V(x, y - 0.9, z),
        '#b8cbe4',
        43
      );
    }

    const names = [
      ['MOLECULE', V(-27, -21, 34)],
      ['ATOM', V(-16, -21, 34)],
      ['NUCLEUS', V(-5, -21, 34)],
      ['NUCLEON / uud', V(6, -21, 34)],
      ['ELECTRON e⁻', V(-23, -31, 34)],
      ['PHOTON γ', V(-10, -31, 34)],
      ['WEAK BOSONS', V(7, -32, 34)],
      ['HIGGS SCALAR SECTOR', V(23, -24.5, 34)],
      ['SIX-FLAVOR CATALOG', V(7, -38, 34)]
    ];

    names.forEach(([text, p]) => {
      simpleLabel(text, p, '#a5bbd8', 55);
    });

    simpleLabel(
      'TIME OF FLIGHT / AUXILIARY VIEW',
      V(47, 18, -8),
      '#afbcff',
      120
    );

    simpleLabel('x', V(27, 0, 0), '#7ea9cc', 85);
    simpleLabel('y', V(0, 15, 0), '#7ea9cc', 85);
    simpleLabel('z', V(0, 0, 24), '#7ea9cc', 85);

    for (let i = 0; i < 3; i++) {
      const arrow = new T.ArrowHelper(
        V(1, 0, 0),
        V(-23 + i * 11, -18, 34),
        3.5,
        0x698bb4,
        0.45,
        0.24
      );

      inspection.add(arrow);
    }

    const neutrinos = [];

    for (let i = 0; i < 3; i++) {
      const material = new T.ShaderMaterial({
        uniforms: {
          uTime: U.uTime,
          uAge: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: T.AdditiveBlending,

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
          uniform float uTime, uAge;
          varying vec2 vUv;

          void main() {
            vec2 p = (vUv - 0.5) * 2.0;
            float r = length(p);

            if (r > 1.0) discard;

            float ring = pow(
              0.5 + 0.5 * cos(r * 55.0 - uTime * 15.0),
              14.0
            );

            float edge =
              (1.0 - smoothstep(0.55, 1.0, r)) *
              exp(-r * r * 1.5);

            float gate =
              smoothstep(0.0, 0.12, uAge) *
              (1.0 - smoothstep(0.88, 1.0, uAge));

            gl_FragColor = vec4(
              vec3(0.55, 0.77, 1.25),
              ring * edge * gate * 0.17
            );
          }
        `
      });

      const plane = new T.Mesh(
        new T.PlaneGeometry(12, 12),
        material
      );

      plane.rotation.y = Math.PI / 2;

      scene.add(plane);
      neutrinos.push(plane);
    }

    const annotations = [];
    const projected = V();
    const unprojected = V();

    function annotation(template, anchor, tint, category) {
      const root = document.createElement('div');

      Object.assign(root.style, {
        width: '0px',
        height: '0px',
        pointerEvents: 'none'
      });

      const card = $(template)
        .content.firstElementChild.cloneNode(true);

      card.style.position = 'absolute';
      root.appendChild(card);
      labelRenderer.domElement.appendChild(root);

      const object = new T.CSS2DObject(root);
      object.position.copy(anchor);
      scene.add(object);

      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        'position',
        new T.BufferAttribute(new Float32Array(6), 3)
      );

      const leader = new T.Line(
        geometry,
        new T.LineBasicMaterial({
          color: color(tint),
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false
        })
      );

      leader.frustumCulled = false;
      leader.renderOrder = 100;
      scene.add(leader);

      card.addEventListener('pointerdown', event => {
        event.stopPropagation();
        enterManual();
      });

      card.addEventListener('focus', enterManual);

      annotations.push({
        root,
        card,
        object,
        leader,
        anchor,
        category,
        opacity: 0
      });
    }

    annotation(
      'vortex-label-template',
      V(-7, 0, 1),
      0x64eaff,
      'vortex'
    );

    annotation(
      'soliton-label-template',
      V(-12, 0, 6),
      0xb79aff,
      'soliton'
    );

    annotation(
      'lattice-label-template',
      V(-20, 4, 12),
      0x64eaff,
      'bulk'
    );

    annotation(
      'gluon-label-template',
      proton.position.clone(),
      0xf291ff,
      'particles'
    );

    annotation(
      'higgs-label-template',
      higgs.position.clone(),
      0xffd080,
      'particles'
    );

    annotation(
      'photon-label-template',
      photon.position.clone(),
      0xffd080,
      'particles'
    );

    annotation(
      'electron-label-template',
      electron.position.clone(),
      0x88b7ff,
      'particles'
    );

    const frames = [
      [0, V(52, 30, 66), V(0, -2, 6)],
      [26, V(-35, 26, 39), V(-5, 0, 0)],
      [44, V(-7, 19, 1), V(-6.88, 15, 1)],
      [72, V(-7, -13, 1), V(-6.88, -17, 1)],
      [90, V(-28, -15, 29), V(-4, 0, 0)],
      [106, V(-27, -11, 51), V(-23, -18, 34)],
      [120, V(-13, -13, 48), V(-13, -18, 34)],
      [136, V(7, -14, 43), V(6, -18, 34)],
      [153, V(-15, -21, 47), V(-17, -28, 34)],
      [171, V(13, -21, 49), V(12, -28, 34)],
      [188, V(29, -14, 48), V(23, -20, 34)],
      [206, V(20, 12, 72), V(5, -10, 20)],
      [228, V(52, 30, 66), V(0, -2, 6)]
    ].map(([at, position, target]) => {
      aimCamera.position.copy(position);
      aimCamera.lookAt(target);

      return {
        at,
        position,
        target,
        quaternion: aimCamera.quaternion.clone(),
        distance: position.distanceTo(target)
      };
    });

    const desiredPosition = V();
    const desiredQuaternion = new T.Quaternion();
    const desiredTarget = V();

    let desiredDistance = 55;

    function sampleFlight() {
      const t = ((flight % PERIOD) + PERIOD) % PERIOD;
      let i = 0;

      while (i < frames.length - 2 && t > frames[i + 1].at) {
        i++;
      }

      const a = frames[i];
      const b = frames[i + 1];

      const u = ease(
        clamp((t - a.at) / (b.at - a.at), 0, 1)
      );

      desiredPosition.lerpVectors(a.position, b.position, u);
      desiredTarget.lerpVectors(a.target, b.target, u);
      desiredQuaternion.copy(a.quaternion).slerp(b.quaternion, u);
      desiredDistance = lerp(a.distance, b.distance, u);

      const drift =
        1 - smooth(36, 44, t) + smooth(72, 80, t);

      const phase = t / PERIOD * TAU;

      desiredPosition.x += Math.sin(phase) * 0.14 * drift;
      desiredPosition.y += Math.sin(phase * 2) * 0.12 * drift;
      desiredPosition.z += Math.cos(phase) * 0.14 * drift;

      stage =
        t < 34 ? 'bulk' :
        t < 78 ? 'vortex' :
        t < 99 ? 'soliton' :
        t < 199 ? 'particles' :
        'bulk';
    }

    sampleFlight();

    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);

    const controlCamera = camera.clone();
    const controls = new T.OrbitControls(
      controlCamera,
      renderer.domElement
    );

    controls.enableDamping = true;
    controls.dampingFactor = 0.10;
    controls.rotateSpeed = 0.45;
    controls.zoomSpeed = 0.66;
    controls.panSpeed = 0.65;
    controls.minDistance = 0.18;
    controls.maxDistance = 280;
    controls.minPolarAngle = 0.008;
    controls.maxPolarAngle = Math.PI - 0.008;
    controls.screenSpacePanning = true;

    const forward = V();
    const savedPosition = V();
    const savedQuaternion = new T.Quaternion();

    function syncControls() {
      controlCamera.position.copy(camera.position);
      controlCamera.quaternion.copy(camera.quaternion);
      controlCamera.zoom = camera.zoom;
      controlCamera.updateProjectionMatrix();
      controlCamera.updateMatrixWorld(true);

      forward
        .set(0, 0, -1)
        .applyQuaternion(camera.quaternion);

      controls.target
        .copy(camera.position)
        .addScaledVector(
          forward,
          clamp(focusDistance, 0.3, 120)
        );
    }

    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);

    focusDistance = desiredDistance;
    syncControls();

    function flushControls() {
      savedPosition.copy(camera.position);
      savedQuaternion.copy(camera.quaternion);

      const zoom = camera.zoom;

      controls.enableDamping = false;
      controls.saveState();
      controls.reset();

      camera.position.copy(savedPosition);
      camera.quaternion.copy(savedQuaternion);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();

      syncControls();
      controls.enableDamping = true;
    }

    function enterManual() {
      if (manual && !returning) return;

      manual = true;
      returning = null;

      syncControls();
      lastUI = -Infinity;
    }

    function resumeDrone() {
      flushControls();
      sampleFlight();

      const distance = camera.position.distanceTo(desiredPosition);

      returning = {
        elapsed: 0,
        duration: clamp(2.2 + distance / 28, 2.2, 6),
        from: camera.position.clone(),
        rotation: camera.quaternion.clone(),
        to: desiredPosition.clone(),
        goal: desiredQuaternion.clone(),
        focusFrom: focusDistance,
        focusTo: desiredDistance,
        lift: distance > 45 ? Math.min(22, distance * 0.14) : 0
      };

      manual = false;
      paused = false;
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

    document.querySelectorAll('[data-inspection-ui]').forEach(el => {
      el.addEventListener('pointerdown', enterManual);
    });

    ui.content.addEventListener(
      'wheel',
      enterManual,
      { passive: true }
    );

    function pauseToggle() {
      paused = !paused;
      lastUI = -Infinity;
    }

    function hudToggle() {
      hud = !hud;

      document.body.classList.toggle('hud-hidden', !hud);

      ui.hud.textContent = hud ? 'Hide HUD' : 'Show HUD';
      ui.hud.setAttribute('aria-expanded', String(hud));
      ui.panel.setAttribute('aria-hidden', String(!hud));
    }

    ui.pause.addEventListener('click', pauseToggle);
    ui.resume.addEventListener('click', resumeDrone);
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
        event.target.closest('button,summary')
      ) {
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        pauseToggle();
      } else if (event.code === 'KeyR') {
        resumeDrone();
      } else if (event.code === 'KeyH') {
        hudToggle();
      }
    });

    const renderTarget = new T.WebGLRenderTarget(1, 1, {
      type: targetType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(renderer, renderTarget);

    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      0.82,
      0.46,
      hdr ? 1.0 : 0.78
    );

    [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ].forEach(target => {
      target.texture.type = targetType;
      target.texture.format = T.RGBAFormat;
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
              1.055 *
                pow(max(x, vec3(0.0)), vec3(1.0 / 2.4)) -
                0.055,
              step(vec3(0.0031308), x)
            );
          }

          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;

            c *= 1.0 -
              0.15 * smoothstep(
                0.25,
                0.72,
                length(vUv - 0.5)
              );

            gl_FragColor = vec4(
              displayRGB(aces(c * 1.02)),
              1.0
            );
          }
        `
      })
    );

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    function resize() {
      width = Math.max(1, window.innerWidth);
      height = Math.max(1, window.innerHeight);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      for (const c of [camera, controlCamera]) {
        c.aspect = width / height;
        c.updateProjectionMatrix();
      }

      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height);

      composer.setPixelRatio(dpr);
      composer.setSize(width, height);

      bloom.setSize(
        Math.ceil(width * dpr * 0.7),
        Math.ceil(height * dpr * 0.7)
      );

      fxaa.uniforms.resolution.value.set(
        1 / (width * dpr),
        1 / (height * dpr)
      );

      labelRenderer.setSize(width, height);

      U.uPointScale.value =
        height * dpr /
        (
          2 *
          Math.tan(T.MathUtils.degToRad(camera.fov * 0.5))
        );

      lastUI = -Infinity;
    }

    window.addEventListener('resize', resize);
    resize();

    function overlaps(a, b) {
      return (
        a.left < b.right + 12 &&
        a.right > b.left - 12 &&
        a.top < b.bottom + 12 &&
        a.bottom > b.top - 12
      );
    }

    function updateLabels(dt) {
      const occupied = hud
        ? [
            ui.panel.getBoundingClientRect(),
            ui.controls.getBoundingClientRect(),
            ui.caption.getBoundingClientRect()
          ]
        : [];

      const ranked = annotations
        .map(a => ({
          a,
          d: camera.position.distanceTo(a.anchor)
        }))
        .sort((a, b) => {
          const scoreA =
            (a.a.category === stage ? -20 : 0) + a.d;
          const scoreB =
            (b.a.category === stage ? -20 : 0) + b.d;

          return scoreA - scoreB;
        });

      let shown = 0;

      for (const entry of ranked) {
        const a = entry.a;
        const d = entry.d;

        projected.copy(a.anchor).project(camera);

        const sx = (projected.x * 0.5 + 0.5) * width;
        const sy = (-projected.y * 0.5 + 0.5) * height;

        const w = a.card.offsetWidth || 300;
        const h = a.card.offsetHeight || 210;

        const choices = [
          { left: sx + 22, top: sy - h / 2 },
          { left: sx - w - 22, top: sy - h / 2 },
          { left: sx - w / 2, top: sy - h - 22 },
          { left: sx - w / 2, top: sy + 22 }
        ];

        let chosen = null;

        const eligible =
          manual ||
          a.category === stage ||
          (stage === 'bulk' && a.category === 'vortex');

        if (
          hud &&
          eligible &&
          shown < 2 &&
          d > 1.5 &&
          d < 100 &&
          projected.z > -1 &&
          projected.z < 1 &&
          sx > 8 &&
          sx < width - 8 &&
          sy > 8 &&
          sy < height - 8
        ) {
          for (const candidate of choices) {
            const r = {
              ...candidate,
              right: candidate.left + w,
              bottom: candidate.top + h
            };

            if (
              r.left < 12 ||
              r.right > width - 12 ||
              r.top < 74 ||
              r.bottom > height - 18
            ) {
              continue;
            }

            if (occupied.some(o => overlaps(r, o))) {
              continue;
            }

            chosen = r;
            occupied.push(r);
            shown++;
            break;
          }
        }

        if (chosen) {
          a.card.style.left = (chosen.left - sx) + 'px';
          a.card.style.top = (chosen.top - sy) + 'px';

          const ex = clamp(sx, chosen.left, chosen.right);
          const ey = clamp(sy, chosen.top, chosen.bottom);

          unprojected
            .set(
              ex / width * 2 - 1,
              1 - ey / height * 2,
              projected.z
            )
            .unproject(camera);

          const p = a.leader.geometry.attributes.position.array;

          a.anchor.toArray(p, 0);
          unprojected.toArray(p, 3);

          a.leader.geometry.attributes.position.needsUpdate = true;
        }

        const target = chosen
          ? (1 - smooth(65, 100, d)) * smooth(1.5, 4, d)
          : 0;

        a.opacity = lerp(
          a.opacity,
          target,
          1 - Math.exp(-dt * 10)
        );

        a.object.visible = a.opacity > 0.01;
        a.root.style.opacity = String(a.opacity);
        a.card.style.pointerEvents = a.opacity > 0.7 ? 'auto' : 'none';
        a.card.tabIndex = a.opacity > 0.7 ? 0 : -1;

        a.leader.visible = a.object.visible;
        a.leader.material.opacity = a.opacity * 0.42;
      }

      for (const label of simpleLabels) {
        const distance = camera.position.distanceTo(
          label.object.position
        );

        const opacity =
          (1 - smooth(
            label.limit * 0.65,
            label.limit,
            distance
          )) * smooth(0.7, 2, distance);

        label.object.visible = hud && opacity > 0.025;
        label.element.style.opacity = String(opacity);
      }
    }

    function updateHUD(stamp) {
      if (stamp - lastUI < 150) return;
      lastUI = stamp;

      if (manual) {
        probe.copy(controls.target);
      } else if (stage === 'vortex') {
        probe.set(-7, clamp(camera.position.y, -8, 8), 1);
      } else if (stage === 'soliton') {
        probe.set(-8, 0, 5);
      } else {
        probe.set(-3, 4, -2);
      }

      ui.density.textContent =
        densityAt(probe).toFixed(3) + ' n₀';

      ui.coherence.textContent = 'COHERENT';

      ui.healing.textContent =
        (U.uXi.value / XI).toFixed(3) + ' ξ₀';

      ui.potential.textContent =
        potentialAt(probe).toFixed(3) + ' μ₀';

      ui.mode.textContent = paused
        ? 'PAUSED / ' + (manual ? 'MANUAL' : 'AUTO')
        : returning
          ? 'RETURNING TO DRONE'
          : manual
            ? 'MANUAL INSPECTION'
            : 'AUTOMATIC DRONE';

      ui.pause.textContent = paused ? 'Play' : 'Pause';
      ui.pause.setAttribute('aria-pressed', String(paused));

      const progress = (flight % PERIOD) / PERIOD;

      ui.fill.style.transform = 'scaleX(' + progress + ')';

      ui.progress.setAttribute(
        'aria-valuenow',
        String(Math.round(progress * 100))
      );

      ui.stages.forEach(item => {
        const active = item.dataset.stage === stage;

        item.classList.toggle('is-active', active);

        if (active) {
          item.setAttribute('aria-current', 'step');
        } else {
          item.removeAttribute('aria-current');
        }
      });

      const captions = {
        bulk: [
          '01 / BULK CONDENSATE',
          'One coherent field. Many scales.',
          'Optical confinement, quantized circulation, and a shared phase landscape.'
        ],
        vortex: [
          '02 / VORTEX DESCENT',
          'Inside a quantized circulation core.',
          'The camera follows the density-depleted filament through the cloud.'
        ],
        soliton: [
          '03 / SOLITON INTERFACE',
          'A dark notch. A π phase change.',
          'The planar density depression separates two coherent phase domains.'
        ],
        particles: [
          '04 / PARTICLE INSPECTION',
          'From molecular bonds to gauge fields.',
          'A separate inspection array compares matter, radiation, and field schematics.'
        ]
      };

      const text = captions[stage];

      ui.chapter.textContent = text[0];
      ui.title.textContent = text[1];
      ui.description.textContent = text[2];
    }

    function updateScene() {
      U.uTime.value = time;
      U.uBulk.value = bulkDensity();
      U.uXi.value = XI / Math.sqrt(U.uBulk.value);

      const ratio = U.uXi.value / XI;

      coreGroups.forEach(group => {
        group.scale.set(ratio, 1, ratio);
      });

      for (let i = 0; i < tof.length; i++) {
        const age = (time * 0.055 + i / tof.length) % 1;
        const scale = 1.4 + age * 6.2;

        tof[i].position.set(32 + age * 39, 8, -8);
        tof[i].scale.set(1, scale * 0.72, scale);
        tof[i].material.opacity = Math.sin(Math.PI * age) * 0.40;
      }

      weakMeshes.forEach((mesh, i) => {
        mesh.rotation.x = 0.2 * Math.sin(time * 0.7 + i);
        mesh.rotation.y = time * 0.25 + i * 0.5;
        mesh.scale.setScalar(
          1 + 0.05 * Math.sin(time * 1.4 + i)
        );
      });

      higgs.rotation.y = time * 0.045;

      for (let i = 0; i < quarkMeshes.length; i++) {
        const a = i * TAU / 3 + time * 0.11;
        const r = 1.35 + 0.10 * Math.sin(time * 1.2 + i * 2);
        const p = quarkMeshes[i].position;

        p.set(
          Math.cos(a) * r,
          Math.sin(a) * 1.12,
          Math.sin(a * 2 + time * 0.25) * 0.42
        );

        gluonMeshes[i].material.uniforms.uEnd.value.copy(p);

        quarkLabels[i].position.copy(p).add(proton.position);
        quarkLabels[i].position.y += 0.55;
      }

      for (let i = 0; i < neutrinos.length; i++) {
        const age = (time * 0.28 + i * 0.333) % 1;

        neutrinos[i].position.set(
          -85 + age * 170,
          -7 + i * 10,
          -6 + i * 9
        );

        neutrinos[i].material.uniforms.uAge.value = age;
      }
    }

    function frame(stamp) {
      requestAnimationFrame(frame);

      if (document.hidden || contextLost) {
        lastStamp = 0;
        return;
      }

      const dt = lastStamp
        ? Math.min((stamp - lastStamp) / 1000, 0.05)
        : 0;

      lastStamp = stamp;

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

        const r = returning;
        const u = ease(clamp(r.elapsed / r.duration, 0, 1));

        camera.position.lerpVectors(r.from, r.to, u);
        camera.position.y += r.lift * Math.sin(Math.PI * u) ** 2;
        camera.quaternion.copy(r.rotation).slerp(r.goal, u);

        focusDistance = lerp(r.focusFrom, r.focusTo, u);

        if (u >= 1) {
          returning = null;
        }

        syncControls();
      } else if (manual) {
        controls.update();
        controlCamera.updateMatrixWorld(true);

        const a = 1 - Math.exp(-dt * 14);

        camera.position.lerp(controlCamera.position, a);
        camera.quaternion.slerp(controlCamera.quaternion, a);

        camera.zoom = Math.exp(
          lerp(
            Math.log(camera.zoom),
            Math.log(controlCamera.zoom),
            a
          )
        );

        focusDistance = controlCamera.position.distanceTo(
          controls.target
        );
      } else if (!paused) {
        sampleFlight();

        camera.position.lerp(
          desiredPosition,
          1 - Math.exp(-dt * 2.6)
        );

        camera.quaternion.slerp(
          desiredQuaternion,
          1 - Math.exp(-dt * 2.9)
        );

        focusDistance = desiredDistance;
        syncControls();
      }

      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);

      if (Math.min(window.devicePixelRatio || 1, 2) !== dpr) {
        resize();
      }

      updateScene();
      updateLabels(dt);
      updateHUD(stamp);

      composer.render();
      labelRenderer.render(scene, camera);
    }

    renderer.domElement.addEventListener(
      'webglcontextlost',
      event => {
        event.preventDefault();

        contextLost = true;
        notice.hidden = false;
        notice.textContent = 'The graphics context is recovering.';
      }
    );

    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        contextLost = false;
        lastStamp = 0;
        notice.hidden = true;

        resize();
      }
    );

    document.addEventListener('visibilitychange', () => {
      lastStamp = 0;
    });

    updateScene();
    requestAnimationFrame(frame);
  }
})();