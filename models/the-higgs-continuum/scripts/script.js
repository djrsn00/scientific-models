/* script.js — The Higgs Continuum
 * Field motion, spectral colors, and inter-chapter scales are schematic.
 * TON 618 adopted mass: 6.6e10 solar masses; Shemmer et al. (2004), Table 2.
 * https://arxiv.org/abs/astro-ph/0406559
 */
(() => {
  'use strict';

  const container = document.getElementById('canvas-container');
  const notice = document.getElementById('render-notice');

  function fail(message) {
    if (notice) {
      notice.hidden = false;
      notice.textContent = message;
    } else {
      console.error(message);
    }
  }

  const needed = [
    'OrbitControls', 'CSS2DRenderer', 'CSS2DObject',
    'EffectComposer', 'RenderPass', 'ShaderPass', 'UnrealBloomPass',
    'CopyShader', 'LuminosityHighPassShader', 'FXAAShader'
  ];

  if (!window.THREE || needed.some(key => !window.THREE[key])) {
    fail('Graphics libraries could not load. Check your connection and reload.');
    return;
  }

  if (!container) {
    fail('The canvas-container element is missing.');
    return;
  }

  try {
    start();
  } catch (error) {
    console.error(error);
    fail('Unable to initialize the scene: ' + error.message);
  }

  function start() {
    const T = THREE;
    const TAU = Math.PI * 2;
    const V = (x = 0, y = 0, z = 0) => new T.Vector3(x, y, z);
    const clamp = T.MathUtils.clamp;
    const mix = T.MathUtils.lerp;

    const smooth = (a, b, x) => {
      x = clamp((x - a) / (b - a), 0, 1);
      return x * x * (3 - 2 * x);
    };

    const ease = x => x * x * x * (x * (x * 6 - 15) + 10);
    const linear = hex => new T.Color(hex).convertSRGBToLinear();

    const $ = id => {
      const element = document.getElementById(id);
      if (!element) throw new Error('Missing element: ' + id);
      return element;
    };

    const ui = {
      panel: $('sidebar-ui'),
      content: $('sidebar-content'),
      mode: $('flight-mode'),
      phase: $('phase-value'),
      scale: $('scale-value'),
      pressure: $('pressure-value'),
      velocity: $('velocity-value'),
      vev: $('vev-value'),
      pause: $('pause-toggle'),
      pauseLabel: $('pause-label'),
      resume: $('resume-flight'),
      hud: $('hud-toggle'),
      hudLabel: $('hud-label'),
      controls: $('flight-controls'),
      caption: $('scene-caption'),
      chapter: $('chapter-value'),
      title: $('scene-title'),
      description: $('scene-description'),
      journey: $('journey-ui'),
      journeyValue: $('journey-value'),
      progress: $('journey-progress'),
      fill: $('flight-progress'),
      stages: [...$('journey-stages').children]
    };

    let seed = 731902;

    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    const between = (a, b) => mix(a, b, random());

    function direction() {
      const y = between(-1, 1);
      const a = random() * TAU;
      const r = Math.sqrt(1 - y * y);
      return V(r * Math.cos(a), y, r * Math.sin(a));
    }

    let time = 0;
    let flight = 0;
    let lastStamp = 0;
    let lastHUD = -Infinity;

    let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let manual = false;
    let hud = true;
    let returning = null;
    let contextLost = false;

    let width = 1;
    let height = 1;
    let dpr = 1;
    let framing = 0;
    let framingGoal = 0;

    let focusDistance = 60;
    let activeStage = 'subatomic';
    let atlasReturn = false;

    const period = 460;
    const tonPosition = V(28, 0, -625);
    const solarPosition = V(70, 16, -625);

    const scene = new T.Scene();
    scene.background = new T.Color(0);
    scene.fog = new T.FogExp2(0x000000, 0.0018);

    const camera = new T.PerspectiveCamera(55, 1, 0.003, 1900);
    camera.up.set(0, 1, 0);
    camera.position.set(4, 10, 40);
    camera.lookAt(0, 0, -20);

    const aim = new T.PerspectiveCamera();
    aim.up.copy(camera.up);

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
      'Higgs Continuum. Drag to inspect; scroll to zoom.'
    );

    container.appendChild(renderer.domElement);

    const labels = new T.CSS2DRenderer();
    labels.domElement.id = 'label-layer';
    container.appendChild(labels.domElement);

    const gl = renderer.getContext();

    const hdr =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has('EXT_color_buffer_float');

    const targetType = hdr ? T.HalfFloatType : T.UnsignedByteType;

    const maxPoint = Math.min(
      110,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    const U = {
      uTime: { value: 0 },
      uJourney: { value: 0 },
      uFog: { value: scene.fog.density },
      uPointScale: { value: 1 },
      uPointLimit: { value: maxPoint },
      uResolution: { value: new T.Vector2(1, 1) },
      uTon: { value: tonPosition }
    };

    const common = `
      uniform float uTime, uJourney, uFog;

      vec3 spectrum(float h) {
        vec3 c = clamp(
          abs(fract(h + vec3(0.0, 0.6666667, 0.3333333)) * 6.0 - 3.0) - 1.0,
          0.0,
          1.0
        );

        return pow(mix(vec3(0.16), c, 0.92), vec3(2.2));
      }

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.7, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        return mix(
          mix(
            mix(hash(i), hash(i + vec3(1, 0, 0)), f.x),
            mix(
              hash(i + vec3(0, 1, 0)),
              hash(i + vec3(1, 1, 0)),
              f.x
            ),
            f.y
          ),
          mix(
            mix(
              hash(i + vec3(0, 0, 1)),
              hash(i + vec3(1, 0, 1)),
              f.x
            ),
            mix(
              hash(i + vec3(0, 1, 1)),
              hash(i + vec3(1, 1, 1)),
              f.x
            ),
            f.y
          ),
          f.z
        );
      }

      float fbm(vec3 p) {
        float f = 0.0;
        float a = 0.5;

        for (int i = 0; i < 4; i++) {
          f += a * noise3(p);
          p = p * 2.03 + vec3(7.1, 2.3, 5.9);
          a *= 0.5;
        }

        return f;
      }

      float fogAmount(float d) {
        return exp(-uFog * uFog * d * d);
      }
    `;

    const pointVertex = common + `
      uniform float uMode, uGain, uSizeScale;
      uniform float uPointScale, uPointLimit;

      attribute float aSize, aSeed;
      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec3 p = position;
        vec3 c = aColor;
        float alpha = 1.0;
        float t = uTime;
        float s = aSeed;

        if (uMode < 0.5) {
          p += vec3(
            sin(p.z * 0.024 + t * 0.16 + s),
            cos(p.x * 0.033 - t * 0.13 + s),
            sin(p.y * 0.035 + t * 0.11)
          ) * 1.25;

          c = spectrum(s + p.z * 0.001 + t * 0.018) * 2.6;
          alpha = 0.42 + 0.18 * sin(t * 0.6 + s * 31.0);
        } else if (uMode < 1.5) {
          float a = t * (0.45 + s * 0.22);

          p.xz = mat2(
            cos(a), -sin(a),
            sin(a), cos(a)
          ) * p.xz;

          p.y += 0.24 * sin(t * 1.2 + s * 21.0 + p.x);
          p *= 1.0 + 0.09 * sin(t * 0.8 + s * 12.0);

          float couplingGlow =
            0.28 + 0.3 * sin(t * 0.35 + s) * sin(t * 0.35 + s);

          c = mix(
            spectrum(s + t * 0.03),
            vec3(1.0, 0.065, 0.004),
            couplingGlow
          ) * 2.8;

          alpha = 0.65;
        } else if (uMode < 2.5) {
          alpha = 0.65 + 0.3 * sin(t * 0.45 + s * 30.0);
        } else if (uMode < 3.5) {
          float r = length(p.xz);
          float a = t * 5.0 / pow(max(r, 1.0), 0.65);

          p.xz = mat2(
            cos(a), -sin(a),
            sin(a), cos(a)
          ) * p.xz;

          p.y += 0.04 * r * sin(t * 0.6 + r * 0.35 + s * 7.0);

          c = mix(
            vec3(1.0, 0.07, 0.006),
            vec3(1.0, 0.72, 0.2),
            s
          ) * 2.5;

          alpha = 0.75;
        } else if (uMode < 4.5) {
          float side = p.y < 0.0 ? -1.0 : 1.0;
          float age = fract(abs(p.y) / 130.0 + t * 0.27 + s * 0.03);

          p.y = side * (8.0 + age * 130.0);
          p.xz *= 0.3 + age * 1.7;

          c = mix(
            vec3(0.1, 0.35, 1.0),
            vec3(0.15, 1.0, 1.0),
            age
          ) * 3.0;

          alpha = sin(age * 3.14159265);
        } else {
          float age = fract(s + t * 0.04);

          p.x -= age * 26.0;
          p.y += sin(age * 5.0 + s * 9.0) * age;

          alpha = sin(age * 3.14159265) * 0.65;
        }

        vec4 mv = modelViewMatrix * vec4(p, 1.0);

        vColor = c * uGain;
        vAlpha = alpha * fogAmount(length(mv.xyz));

        gl_PointSize = clamp(
          aSize * uSizeScale * uPointScale / max(0.03, -mv.z),
          1.0,
          uPointLimit
        );

        gl_Position = projectionMatrix * mv;
      }
    `;

    const pointFragment = `
      varying vec3 vColor;
      varying float vAlpha;

      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot(p, p);

        if (r2 > 1.0 || vAlpha < 0.003) discard;

        float halo = exp(-r2 * 5.0);
        float core = exp(-r2 * 27.0);

        gl_FragColor = vec4(
          vColor * (0.8 + core * 1.5),
          (halo + core * 0.25) *
            vAlpha *
            (1.0 - smoothstep(0.65, 1.0, r2))
        );
      }
    `;

    function points(data, parent = scene, mode = 2, gain = 1) {
      const positions = [];
      const colors = [];
      const sizes = [];
      const seeds = [];

      for (const item of data) {
        positions.push(item.x, item.y, item.z);

        const col = linear(
          item.color === undefined ? 0xb2ddff : item.color
        );

        colors.push(col.r, col.g, col.b);
        sizes.push(item.size || 0.2);
        seeds.push(random());
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
        'aSeed',
        new T.Float32BufferAttribute(seeds, 1)
      );

      const material = new T.ShaderMaterial({
        uniforms: {
          ...U,
          uMode: { value: mode },
          uGain: { value: gain },
          uSizeScale: { value: 1 }
        },
        vertexShader: pointVertex,
        fragmentShader: pointFragment,
        transparent: true,
        depthWrite: false,
        blending: T.AdditiveBlending
      });

      const cloud = new T.Points(geometry, material);
      cloud.frustumCulled = false;
      parent.add(cloud);

      return cloud;
    }

    function cloudData(count, radius, tint, size) {
      const data = [];

      for (let i = 0; i < count; i++) {
        const p = direction().multiplyScalar(
          radius * Math.cbrt(random())
        );

        data.push({
          x: p.x,
          y: p.y,
          z: p.z,
          color: tint,
          size: size * between(0.65, 1.35)
        });
      }

      return data;
    }

    const lineVertex = common + `
      uniform float uDeform;
      uniform vec3 uTon;

      attribute vec3 aColor;

      varying vec3 vColor;
      varying float vDepth;

      void main() {
        vec3 p = position;

        if (uDeform > 0.5) {
          p.y +=
            2.2 *
            sin(p.z * 0.022 + uTime * 0.14) *
            cos(p.x * 0.034);

          float r = length(p.xz - uTon.xz);

          p.y -=
            13.0 *
            exp(-r * r / 2200.0) *
            exp(-p.y * p.y / 1100.0);
        }

        vec4 mv = modelViewMatrix * vec4(p, 1.0);

        vDepth = length(mv.xyz);
        vColor = aColor;

        gl_Position = projectionMatrix * mv;
      }
    `;

    const lineFragment = common + `
      uniform float uOpacity;
      uniform vec2 uResolution;

      varying vec3 vColor;
      varying float vDepth;

      void main() {
        vec2 screen = gl_FragCoord.xy / uResolution;

        float edge = smoothstep(
          0.23,
          0.66,
          length(screen - 0.5)
        );

        float zVisual =
          exp(uJourney * 0.8 + min(vDepth, 450.0) * 0.001) - 1.0;

        float shift =
          (1.0 - 1.0 / (1.0 + zVisual)) *
          edge *
          uJourney;

        vec3 light = mix(
          vColor,
          vec3(0.8, 0.016, 0.008),
          shift * 0.9
        );

        gl_FragColor = vec4(
          light * fogAmount(vDepth),
          uOpacity
        );
      }
    `;

    function lines(
      positions,
      colors,
      opacity = 0.3,
      deform = false,
      parent = scene
    ) {
      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        'position',
        new T.Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute(
        'aColor',
        new T.Float32BufferAttribute(colors, 3)
      );

      const object = new T.LineSegments(
        geometry,
        new T.ShaderMaterial({
          uniforms: {
            ...U,
            uOpacity: { value: opacity },
            uDeform: { value: deform ? 1 : 0 }
          },
          vertexShader: lineVertex,
          fragmentShader: lineFragment,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending
        })
      );

      object.frustumCulled = false;
      parent.add(object);

      return object;
    }

    function pushSegment(positions, colors, a, b, tint) {
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);

      const col = linear(tint);
      colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
    }

    const curveGeometry = new T.PlaneGeometry(1, 1, 192, 1);

    const curveVertex = common + `
      uniform float uKind, uRadius, uSeed, uWidth;

      varying float vT, vSide, vDepth;

      vec3 path(float t) {
        float a = t * 6.2831853;

        if (uKind < 0.5) {
          return vec3(
            cos(a),
            sin(a),
            0.12 * sin(a * 3.0 + uTime)
          ) * uRadius *
            (1.0 + 0.08 * sin(a * 5.0 + uTime * 2.2 + uSeed));
        }

        if (uKind < 1.5) {
          float x = (t - 0.5) * 25.0;

          return vec3(
            x,
            0.7 * sin(x * 3.3 - uTime * 12.0 + uSeed),
            0.0
          );
        }

        float x = (t - 0.5) * 12.0;

        return vec3(
          x,
          sin(a * 5.0 + uTime * 2.0 + uSeed) * 0.7,
          cos(a * 5.0 + uTime * 2.0 + uSeed) * 0.7
        );
      }

      void main() {
        float t = uv.x;

        vec4 center = modelViewMatrix * vec4(path(t), 1.0);
        vec4 next = modelViewMatrix * vec4(path(t + 0.001), 1.0);

        vec2 tangent = next.xy - center.xy;
        vec2 side = normalize(
          vec2(-tangent.y, tangent.x) + vec2(0.00001, 0.0)
        );

        center.xy += side * (uv.y - 0.5) * uWidth;

        vT = t;
        vSide = uv.y;
        vDepth = length(center.xyz);

        gl_Position = projectionMatrix * center;
      }
    `;

    const curveFragment = common + `
      uniform vec3 uColor;
      uniform float uKind, uSeed;

      varying float vT, vSide, vDepth;

      void main() {
        float edge = pow(
          max(0.0, 1.0 - abs(vSide * 2.0 - 1.0)),
          1.5
        );

        float flow = 0.7 + 0.5 * pow(
          0.5 + 0.5 * sin(vT * 50.0 - uTime * 4.0 + uSeed),
          6.0
        );

        vec3 c = uKind > 1.5
          ? spectrum(vT * 0.55 + uSeed * 0.1 + uTime * 0.04) * 2.8
          : uColor;

        float packet = uKind > 0.5 && uKind < 1.5
          ? exp(-pow((vT - fract(uTime * 0.25 + uSeed)) * 4.0, 2.0))
          : 1.0;

        gl_FragColor = vec4(
          c * flow * fogAmount(vDepth),
          edge * (0.25 + packet * 0.7)
        );
      }
    `;

    function ribbon(
      parent,
      kind,
      radius,
      tint,
      phase = 0,
      thickness = 0.12
    ) {
      const object = new T.Mesh(
        curveGeometry,
        new T.ShaderMaterial({
          uniforms: {
            ...U,
            uKind: { value: kind },
            uRadius: { value: radius },
            uSeed: { value: phase },
            uWidth: { value: thickness },
            uColor: { value: linear(tint).multiplyScalar(2.4) }
          },
          vertexShader: curveVertex,
          fragmentShader: curveFragment,
          side: T.DoubleSide,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending
        })
      );

      object.frustumCulled = false;
      parent.add(object);

      return object;
    }

    const markers = [];
    const cards = [];
    const animated = [];

    function group(position) {
      const g = new T.Group();
      g.position.copy(position);
      scene.add(g);
      return g;
    }

    function tag(text, position, distance = 75, parent = scene) {
      const el = document.createElement('span');
      el.className = 'node-label';
      el.textContent = text;

      const object = new T.CSS2DObject(el);
      object.position.copy(position);
      parent.add(object);

      markers.push({ object, el, distance });
      return object;
    }

    function card(template, anchor, stage, custom) {
      const root = document.createElement('div');

      Object.assign(root.style, {
        width: '0px',
        height: '0px',
        pointerEvents: 'none'
      });

      const element = $(template)
        .content.firstElementChild.cloneNode(true);

      if (custom) {
        for (const key of ['kicker', 'title', 'description', 'detail']) {
          const target = element.querySelector('[data-card-' + key + ']');

          if (target && custom[key]) {
            target.textContent = custom[key];
          }
        }
      }

      element.style.position = 'absolute';
      root.appendChild(element);
      labels.domElement.appendChild(root);

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
          color: 0x86c8df,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false
        })
      );

      leader.frustumCulled = false;
      leader.renderOrder = 100;
      scene.add(leader);

      element.addEventListener('pointerdown', event => {
        event.stopPropagation();
        enterManual();
      });

      element.addEventListener('focus', enterManual);

      cards.push({
        root,
        element,
        object,
        anchor,
        stage,
        leader,
        opacity: 0
      });

      return element;
    }

    const background = [];

    for (let i = 0; i < 10000; i++) {
      background.push({
        x: between(-155, 155),
        y: between(-100, 115),
        z: between(-940, 90),
        size: between(0.3, 0.7)
      });
    }

    points(background, scene, 0);

    const latticeP = [];
    const latticeC = [];

    for (let z = 45; z >= -915; z -= 30) {
      for (let x = -90; x <= 90; x += 30) {
        for (let y = -60; y <= 60; y += 30) {
          const a = V(x, y, z);

          if (x < 90) {
            pushSegment(
              latticeP, latticeC,
              a, V(x + 30, y, z), 0x5a6c88
            );
          }

          if (y < 60) {
            pushSegment(
              latticeP, latticeC,
              a, V(x, y + 30, z), 0x5a6c88
            );
          }

          if (z > -915) {
            pushSegment(
              latticeP, latticeC,
              a, V(x, y, z - 30), 0x59677d
            );
          }
        }
      }
    }

    lines(latticeP, latticeC, 0.18, true);

    const taxonomy = [
      ['W⁺', 'W⁻', 'Z⁰'],
      ['e⁻ / Electron', 'μ⁻ / Muon', 'τ⁻ / Tau'],
      ['νₑ', 'νμ', 'ντ'],
      ['t / Top', 'b / Bottom', 'c / Charm'],
      ['s / Strange', 'u / Up', 'd / Down']
    ];

    const depths = [-20, -53, -82, -112, -140];

    for (let row = 0; row < taxonomy.length; row++) {
      for (let col = 0; col < 3; col++) {
        const pos = V((col - 1) * 19, 0, depths[row]);
        const g = group(pos);
        const neutrino = row === 2;
        const quark = row > 2;

        const tint = neutrino
          ? 0x9af8ff
          : quark
            ? [0xff5577, 0x5fffae, 0x639cff][col]
            : 0xff8752;

        for (let k = 0; k < (neutrino ? 2 : 3); k++) {
          const loop = ribbon(
            g,
            0,
            neutrino ? 0.7 + k * 0.25 : 1.6 + k * 0.5,
            tint,
            k * 1.8,
            neutrino ? 0.045 : 0.11
          );

          loop.rotation.x = k * Math.PI / 3;
          loop.rotation.y = k * Math.PI / 4 + row * 0.3;
        }

        if (!neutrino) {
          points(
            cloudData(270, 4.2, tint, 0.12),
            g,
            1,
            0.75
          );
        } else {
          points(
            cloudData(70, 2.6, 0xbcecff, 0.065),
            g,
            2,
            0.6
          );
        }

        tag(
          taxonomy[row][col] + (neutrino ? ' / NEUTRINO' : ''),
          V(0, 4.8, 0),
          55,
          g
        );

        animated.push(t => {
          g.rotation.y = 0.12 * Math.sin(t * 0.3 + row + col);
        });
      }
    }

    card('yukawa-label-template', V(0, 0, -53), 'subatomic');

    tag('GAUGE BOSONS', V(0, 8, -20), 72);
    tag('CHARGED LEPTONS', V(0, 8, -53), 65);
    tag('NEUTRINO FLAVORS', V(0, 8, -82), 65);
    tag(
      'QUARK FLAVORS / COLOR IS A SEPARATE CHARGE',
      V(0, 8, -128),
      65
    );

    const photon = group(V(-34, 1, -102));

    ribbon(photon, 1, 1, 0xffd06b, 0, 0.11);

    const orthogonal = ribbon(
      photon, 1, 1, 0x86faff, 0, 0.075
    );
    orthogonal.rotation.x = Math.PI / 2;

    const photonP = [];
    const photonC = [];

    pushSegment(
      photonP, photonC,
      V(-17, 0, 0), V(17, 0, 0),
      0x44cddb
    );

    lines(photonP, photonC, 0.45, false, photon);

    photon.add(
      new T.ArrowHelper(
        V(1, 0, 0),
        V(13, 0, 0),
        4,
        0x69ecff,
        0.7,
        0.32
      )
    );

    card(
      'photon-label-template',
      photon.position.clone(),
      'subatomic'
    );

    const gluon = group(V(34, 0, -125));

    for (let i = 0; i < 8; i++) {
      const flux = ribbon(
        gluon, 2, 1, 0xffffff, i * TAU / 8, 0.07
      );

      flux.rotation.x = i * TAU / 8;
    }

    card(
      'gluon-label-template',
      gluon.position.clone(),
      'subatomic'
    );

    const surfaceVertex = common + `
      uniform float uKind, uSeed;

      varying vec3 vLocal, vWorld, vNormal;
      varying float vDepth;

      void main() {
        vec3 p = position;

        if (uKind < 0.5) {
          p *= 0.85 + 0.28 * fbm(p * 4.0 + uSeed);
        }

        if (uKind > 1.5) {
          p *= 1.0 +
            0.007 *
            sin(p.y * 18.0 + uTime) *
            cos(p.x * 15.0 - uTime * 0.7);
        }

        vLocal = p;
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;
        vNormal = normalize(mat3(modelMatrix) * normal);

        vec4 mv = viewMatrix * vec4(vWorld, 1.0);
        vDepth = length(mv.xyz);

        gl_Position = projectionMatrix * mv;
      }
    `;

    const surfaceFragment = common + `
      uniform float uKind, uSeed;
      uniform vec3 uColor;

      varying vec3 vLocal, vWorld, vNormal;
      varying float vDepth;

      void main() {
        vec3 q = normalize(vLocal);
        vec3 n = normalize(vNormal);
        vec3 eye = normalize(cameraPosition - vWorld);

        float rim = pow(
          1.0 - abs(dot(n, eye)),
          3.0
        );

        float light = 0.09 + 0.91 * max(
          0.0,
          dot(n, normalize(vec3(-0.5, 0.6, 0.8)))
        );

        float f = fbm(
          q * 7.0 + vec3(uSeed, uTime * 0.014, 0.0)
        );

        vec3 c = uColor;

        if (uKind < 0.5) {
          c *= 0.32 + f * 1.2;
          c *= light;
        } else if (uKind < 1.5) {
          float bands = 0.5 + 0.5 * sin(q.y * 64.0 + f * 13.0);

          float storm = exp(
            -length(
              vec2(atan(q.z, q.x) - 1.2, q.y + 0.2) *
              vec2(8.0, 18.0)
            )
          );

          c = mix(
            vec3(0.17, 0.075, 0.025),
            vec3(0.85, 0.63, 0.37),
            bands
          );

          c = mix(c, vec3(0.7, 0.11, 0.025), storm) * light;
          c += vec3(0.06, 0.14, 0.24) * rim;
        } else {
          c = vec3(0.2, 0.58, 1.0) * (1.5 + f * 1.8);
          c += vec3(0.45, 0.7, 1.0) * pow(f, 4.0) * 5.0;
        }

        gl_FragColor = vec4(
          c * fogAmount(vDepth),
          1.0
        );
      }
    `;

    const sphereGeometry = new T.SphereGeometry(1, 80, 56);
    const rockGeometry = new T.IcosahedronGeometry(1, 3);

    function surface(parent, radius, kind, tint) {
      const mesh = new T.Mesh(
        kind === 0 ? rockGeometry : sphereGeometry,
        new T.ShaderMaterial({
          uniforms: {
            ...U,
            uKind: { value: kind },
            uSeed: { value: random() * 40 },
            uColor: { value: linear(tint) }
          },
          vertexShader: surfaceVertex,
          fragmentShader: surfaceFragment
        })
      );

      mesh.scale.setScalar(radius);
      parent.add(mesh);

      return mesh;
    }

    function corona(parent, radius, tint, gain) {
      const mesh = new T.Mesh(
        sphereGeometry,
        new T.ShaderMaterial({
          uniforms: {
            ...U,
            uColor: { value: linear(tint).multiplyScalar(gain) }
          },

          vertexShader: `
            varying vec3 vWorld, vNormal;

            void main() {
              vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
              vNormal = normalize(mat3(modelMatrix) * normal);

              gl_Position =
                projectionMatrix *
                viewMatrix *
                vec4(vWorld, 1.0);
            }
          `,

          fragmentShader: common + `
            uniform vec3 uColor;
            varying vec3 vWorld, vNormal;

            void main() {
              float rim = pow(
                1.0 - abs(dot(
                  normalize(vNormal),
                  normalize(cameraPosition - vWorld)
                )),
                4.0
              );

              gl_FragColor = vec4(
                uColor * fogAmount(distance(cameraPosition, vWorld)),
                rim * 0.55
              );
            }
          `,

          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          blending: T.AdditiveBlending
        })
      );

      mesh.scale.setScalar(radius);
      parent.add(mesh);

      return mesh;
    }

    const asteroid = group(V(-12, 0, -185));

    for (let i = 0; i < 21; i++) {
      const rock = surface(
        asteroid,
        i === 0 ? 4 : between(0.4, 1.5),
        0,
        0xa6a29d
      );

      if (i > 0) {
        rock.position.copy(
          direction().multiplyScalar(between(6, 13))
        );
      }

      const phase = random() * TAU;

      animated.push(t => {
        rock.rotation.set(
          t * 0.12 + phase,
          t * 0.17 + phase,
          t * 0.04
        );
      });
    }

    card(
      'object-label-template',
      asteroid.position.clone(),
      'stellar',
      {
        kicker: 'B / ROCKY BODIES',
        title: 'ASTEROID AGGREGATE',
        description:
          'Irregular rock silhouettes and fractured surfaces form the first macroscopic comparison.',
        detail:
          'Local geometry is rescaled independently from the subatomic chapter.'
      }
    );

    const comet = group(V(18, 0, -220));

    surface(comet, 1.9, 0, 0xb9e9ff);
    points(
      cloudData(650, 2.5, 0x8bceff, 0.16),
      comet,
      5,
      1.2
    );
    corona(comet, 2.8, 0x91e7ff, 0.8);

    card(
      'object-label-template',
      comet.position.clone(),
      'stellar',
      {
        kicker: 'B / VOLATILE WORLD',
        title: 'COMET / NUCLEUS & TAIL',
        description:
          'An icy nucleus sheds a luminous gas-and-dust envelope.',
        detail:
          'The tail is a flowing schematic; its real direction depends on radiation and solar wind.'
      }
    );

    const giant = group(V(-16, 0, -265));
    const planet = surface(giant, 12, 1, 0xffd58b);

    animated.push(t => {
      planet.rotation.y = t * 0.065;
    });

    card(
      'object-label-template',
      giant.position.clone(),
      'stellar',
      {
        kicker: 'B / PLANETARY ATMOSPHERE',
        title: 'BANDED GAS GIANT',
        description:
          'Zonal bands and a procedural storm field wrap a rotating planetary atmosphere.',
        detail:
          'A gas-giant class model; colors and radius are illustrative.'
      }
    );

    const star = group(V(14, 0, -330));

    surface(star, 19, 2, 0x68b6ff);

    const starHalo = corona(star, 20.7, 0x65bdff, 2.7);

    animated.push(t => {
      starHalo.scale.setScalar(
        20.7 + 0.12 * Math.sin(t * 0.5)
      );
    });

    card(
      'object-label-template',
      star.position.clone(),
      'stellar',
      {
        kicker: 'B / MASSIVE STAR',
        title: 'BLUE HYPERGIANT',
        description:
          'A luminous stellar surface and extended blue atmosphere mark a dramatic change of scale.',
        detail:
          'A stellar class illustration, not a model of a particular observed star.'
      }
    );

    function blackHole(position, radius, count, jets) {
      const root = group(position);

      const darkness = new T.Mesh(
        sphereGeometry,
        new T.MeshBasicMaterial({ color: 0x000000 })
      );

      darkness.scale.setScalar(radius);
      root.add(darkness);

      corona(root, radius * 1.035, 0xffc179, 2.6);

      const data = [];

      for (let i = 0; i < count; i++) {
        const r = radius * (
          1.55 + Math.pow(random(), 0.65) * 2.2
        );

        const a = random() * TAU;

        data.push({
          x: Math.cos(a) * r,
          y: between(-1, 1) * r * 0.025,
          z: Math.sin(a) * r,
          size: between(0.025, 0.07) * radius,
          color: 0xffb45c
        });
      }

      points(data, root, 3, 1.15);

      if (jets) {
        const jet = [];

        for (let i = 0; i < 1500; i++) {
          const a = random() * TAU;
          const r = Math.sqrt(random()) * 2.4;

          jet.push({
            x: Math.cos(a) * r,
            y: (i % 2 ? -1 : 1) * between(8, 130),
            z: Math.sin(a) * r,
            size: between(0.2, 0.55),
            color: 0x53baff
          });
        }

        points(jet, root, 4, 1.3);
      }

      return root;
    }

    const smallBH = blackHole(
      V(-5, 0, -390),
      4.8,
      1900,
      false
    );

    const lensP = [];
    const lensC = [];

    for (let i = 0; i < 18; i++) {
      const r = 6 + i * 0.7;

      for (let j = 0; j < 96; j++) {
        const a = j / 96 * TAU;
        const b = (j + 1) / 96 * TAU;

        pushSegment(
          lensP,
          lensC,
          V(Math.cos(a) * r, -4 + 25 / r, Math.sin(a) * r),
          V(Math.cos(b) * r, -4 + 25 / r, Math.sin(b) * r),
          0x4d85bd
        );
      }
    }

    lines(lensP, lensC, 0.22, false, smallBH);

    card(
      'object-label-template',
      smallBH.position.clone(),
      'stellar',
      {
        kicker: 'B / COMPACT REMNANT',
        title: 'STELLAR-MASS BLACK HOLE',
        description:
          'A dark horizon interrupts an accretion flow and a curved coordinate schematic.',
        detail:
          'Curved lines illustrate geometry; this renderer does not trace relativistic light paths.'
      }
    );

    const voidCenter = V(0, 0, -505);
    const webNodes = [];

    for (let i = 0; i < 90; i++) {
      webNodes.push(
        direction()
          .multiplyScalar(between(28, 80))
          .add(voidCenter)
      );
    }

    const webP = [];
    const webC = [];

    for (let i = 0; i < webNodes.length; i++) {
      const neighbors = webNodes
        .map((p, j) => ({
          j,
          d: p.distanceToSquared(webNodes[i])
        }))
        .filter(n => n.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);

      for (const item of neighbors) {
        if (item.j < i) continue;

        const a = webNodes[i];
        const b = webNodes[item.j];

        const middle = a.clone()
          .lerp(b, 0.5)
          .add(direction().multiplyScalar(5));

        const curve = new T.QuadraticBezierCurve3(a, middle, b);

        const hue = new T.Color().setHSL(
          (i / webNodes.length + 0.55) % 1,
          0.9,
          0.58
        );

        const rgb = hue.getHex();

        for (let j = 0; j < 18; j++) {
          pushSegment(
            webP,
            webC,
            curve.getPoint(j / 18),
            curve.getPoint((j + 1) / 18),
            rgb
          );
        }
      }
    }

    lines(webP, webC, 0.55);

    const voidCloud = [];

    for (let i = 0; i < 1600; i++) {
      const p = direction()
        .multiplyScalar(Math.cbrt(random()) * 76)
        .add(voidCenter);

      voidCloud.push({
        x: p.x,
        y: p.y,
        z: p.z,
        size: between(0.18, 0.4)
      });
    }

    points(voidCloud, scene, 0, 0.7);

    card(
      'void-label-template',
      V(-18, 10, -490),
      'cosmic'
    );

    function galaxy(position, radius, tilt) {
      const g = group(position);
      g.rotation.x = tilt;
      g.rotation.z = 0.35;

      const data = [];

      for (let i = 0; i < 1250; i++) {
        const arm = i % 4;
        const theta = random() * 8.4;
        const r = radius * 0.034 * Math.exp(0.4 * theta);

        const a =
          theta +
          arm * TAU / 4 +
          between(-0.15, 0.15);

        data.push({
          x: Math.cos(a) * r,
          y: between(-0.45, 0.45) * (1 + r * 0.04),
          z: Math.sin(a) * r,
          color: i % 6 ? 0x81b6ff : 0xffd69c,
          size: between(0.09, 0.2)
        });
      }

      points(data, g, 2, 1.4);

      points(
        cloudData(230, radius * 0.17, 0xffdeb6, 0.13),
        g,
        2,
        1.2
      );

      animated.push(t => {
        g.rotation.y = t * 0.018;
      });
    }

    galaxy(V(-83, 24, -461), 13, 0.4);
    galaxy(V(85, -15, -527), 17, 0.8);
    galaxy(V(-77, 20, -573), 11, -0.3);

    blackHole(tonPosition, 18, 6500, true);

    const tonCard = card(
      'ton-label-template',
      tonPosition.clone(),
      'cosmic'
    );

    tonCard.querySelector('.card-footnote').textContent =
      'Adopted mass: 66 billion M☉ (Shemmer et al., 2004). ' +
      'Nonrotating radius ≈1,303 AU; disk and jet are schematic.';

    const solar = group(solarPosition);

    const solarMassParameter = 1.3271244e20;
    const lightSpeed = 299792458;
    const AU = 149597870700;

    const schwarzschildAU =
      2 * solarMassParameter * 6.6e10 /
      (lightSpeed * lightSpeed) / AU;

    const auUnits = 18 / schwarzschildAU;

    const orbitalAU = [
      0.387, 0.723, 1, 1.524,
      5.203, 9.537, 19.191, 30.1
    ];

    const planetNames = [
      'Mercury', 'Venus', 'Earth', 'Mars',
      'Jupiter', 'Saturn', 'Uranus', 'Neptune'
    ];

    const orbitP = [];
    const orbitC = [];
    const planetPoints = [];

    for (let i = 0; i < orbitalAU.length; i++) {
      const r = orbitalAU[i] * auUnits;

      for (let j = 0; j < 160; j++) {
        const a = j / 160 * TAU;
        const b = (j + 1) / 160 * TAU;

        pushSegment(
          orbitP,
          orbitC,
          V(Math.cos(a) * r, 0, Math.sin(a) * r),
          V(Math.cos(b) * r, 0, Math.sin(b) * r),
          i === 2 ? 0x91eaff : 0x86a5bf
        );
      }

      const a = i * 2.39996;

      planetPoints.push({
        x: Math.cos(a) * r,
        y: 0,
        z: Math.sin(a) * r,
        size: 0.006,
        color: i === 2 ? 0x5ddfff : 0xffe4af
      });

      tag(
        planetNames[i],
        V(Math.cos(a) * r, 0.035, Math.sin(a) * r),
        i < 4 ? 0.48 : 1.2,
        solar
      );
    }

    planetPoints.push({
      x: 0,
      y: 0,
      z: 0,
      size: 0.018,
      color: 0xffe9b1
    });

    lines(orbitP, orbitC, 0.8, false, solar);
    points(planetPoints, solar, 2, 2.0);

    const solarCard = card(
      'solar-label-template',
      solarPosition.clone(),
      'cosmic'
    );

    solarCard.querySelector('.card-footnote').textContent =
      'Horizon diameter / Neptune-orbit diameter ≈43.3. ' +
      'Orbit lengths share one scale; visible body markers are enlarged.';

    const sheetVertex = common + `
      uniform float uSeed;

      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vDepth;

      void main() {
        vec3 p = position;

        p.z +=
          12.0 *
          sin(p.x * 0.047 + uTime * 0.09 + uSeed) *
          cos(p.y * 0.045 - uTime * 0.07);

        p.z +=
          5.0 * sin(length(p.xy) * 0.06 - uTime * 0.13);

        vUv = uv;
        vWorld = (modelMatrix * vec4(p, 1.0)).xyz;

        vec4 mv = viewMatrix * vec4(vWorld, 1.0);
        vDepth = length(mv.xyz);

        gl_Position = projectionMatrix * mv;
      }
    `;

    const sheetFragment = common + `
      uniform float uSeed;

      varying vec3 vWorld;
      varying vec2 vUv;
      varying float vDepth;

      void main() {
        vec2 cell = vUv * vec2(65.0, 45.0);

        vec2 d =
          abs(fract(cell - 0.5) - 0.5) /
          max(fwidth(cell), vec2(0.001));

        float grid =
          1.0 - smoothstep(0.3, 1.2, min(d.x, d.y));

        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));

        float rim = pow(
          1.0 - abs(dot(n, normalize(cameraPosition - vWorld))),
          2.0
        );

        float edge =
          smoothstep(0.0, 0.12, vUv.x) *
          smoothstep(0.0, 0.12, vUv.y) *
          (1.0 - smoothstep(0.88, 1.0, vUv.x)) *
          (1.0 - smoothstep(0.88, 1.0, vUv.y));

        vec3 c = spectrum(
          vUv.x * 0.3 +
          vUv.y * 0.2 +
          uSeed * 0.1 +
          uTime * 0.009
        );

        gl_FragColor = vec4(
          c * (0.7 + rim * 2.0 + grid * 1.8) * fogAmount(vDepth),
          (0.025 + grid * 0.5 + rim * 0.08) * edge
        );
      }
    `;

    for (let i = 0; i < 4; i++) {
      const sheet = new T.Mesh(
        new T.PlaneGeometry(190, 135, 220, 170),
        new T.ShaderMaterial({
          uniforms: {
            ...U,
            uSeed: { value: i * 1.7 }
          },
          vertexShader: sheetVertex,
          fragmentShader: sheetFragment,
          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          blending: T.AdditiveBlending,
          extensions: { derivatives: true }
        })
      );

      sheet.position.set(
        (i % 2 ? 1 : -1) * 12,
        0,
        -754 - i * 35
      );

      sheet.rotation.z = (i - 1.5) * 0.13;
      sheet.frustumCulled = false;
      scene.add(sheet);
    }

    card(
      'horizon-label-template',
      V(15, 5, -792),
      'horizon'
    );

    const routeData = [
      [0, [4, 10, 40], [0, 0, -20]],
      [25, [-18, 11, -8], [-19, 0, -20]],
      [50, [14, 13, -42], [0, 0, -53]],
      [75, [-10, 11, -73], [0, 0, -82]],
      [100, [20, 12, -110], [0, 0, -128]],
      [123, [-6, 16, -155], [-12, 0, -185]],
      [145, [7, 14, -190], [18, 0, -220]],
      [170, [3, 22, -230], [-16, 0, -265]],
      [198, [-18, 30, -292], [14, 0, -330]],
      [218, [20, 27, -365], [-5, 0, -390]],
      [242, [0, 10, -435], [0, 0, -505]],
      [260, [10, 10, -520], [28, 0, -625]],
      [278, [50, 18, -550], [28, 0, -625]],
      [300, [90, 24, -595], [28, 0, -625]],
      [321, [110, 18, -625], [28, 0, -625]],
      [341, [70.8, 16.5, -623.8], [70, 16, -625]],
      [358, [96, 22, -675], [28, 0, -625]],
      [380, [40, 18, -754], [0, 0, -792]],
      [400, [3, 14, -835], [6, -4, -865]],
      [416, [-100, 110, -760], [28, 0, -625]],
      [436, [-100, 110, -340], [14, 0, -330]],
      [460, [4, 10, 40], [0, 0, -20]]
    ];

    const route = new T.CatmullRomCurve3(
      routeData.map(p => V(...p[1])),
      false,
      'centripetal'
    );

    const targetRoute = new T.CatmullRomCurve3(
      routeData.map(p => V(...p[2])),
      false,
      'centripetal'
    );

    const desiredPosition = V();
    const desiredTarget = V();
    const desiredQuaternion = new T.Quaternion();

    let desiredDistance = 60;
    let narrative = 0;

    function sampleRoute() {
      const clock = ((flight % period) + period) % period;
      let i = 0;

      while (
        i < routeData.length - 2 &&
        clock > routeData[i + 1][0]
      ) {
        i++;
      }

      const local = ease(
        clamp(
          (clock - routeData[i][0]) /
          (routeData[i + 1][0] - routeData[i][0]),
          0,
          1
        )
      );

      const parameter = (i + local) / (routeData.length - 1);

      route.getPoint(parameter, desiredPosition);
      targetRoute.getPoint(parameter, desiredTarget);

      aim.position.copy(desiredPosition);
      aim.lookAt(desiredTarget);

      desiredQuaternion.copy(aim.quaternion);
      desiredDistance = desiredPosition.distanceTo(desiredTarget);

      atlasReturn = clock > 400;

      narrative = atlasReturn
        ? 1 - smooth(400, 460, clock)
        : smooth(0, 400, clock);

      activeStage =
        clock < 114 ? 'subatomic' :
        clock < 232 ? 'stellar' :
        clock < 366 ? 'cosmic' :
        'horizon';
    }

    sampleRoute();

    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);

    const controlCamera = camera.clone();

    const controls = new T.OrbitControls(
      controlCamera,
      renderer.domElement
    );

    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.65;
    controls.panSpeed = 0.58;
    controls.minDistance = 0.025;
    controls.maxDistance = 900;
    controls.minPolarAngle = 0.003;
    controls.maxPolarAngle = Math.PI - 0.003;
    controls.screenSpacePanning = true;

    const forward = V();

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
          clamp(focusDistance, 0.04, 500)
        );
    }

    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);

    focusDistance = desiredDistance;
    syncControls();

    function enterManual() {
      if (manual && !returning) return;

      manual = true;
      returning = null;

      syncControls();
      lastHUD = -Infinity;
    }

    function resumeFlight() {
      controls.enableDamping = false;
      controls.update();
      controls.saveState();
      controls.reset();
      controls.enableDamping = true;

      syncControls();
      sampleRoute();

      const distance = camera.position.distanceTo(desiredPosition);

      returning = {
        elapsed: 0,
        duration: clamp(2.5 + distance / 70, 2.5, 9),
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        target: desiredPosition.clone(),
        rotation: desiredQuaternion.clone(),
        focus: focusDistance,
        distance: desiredDistance
      };

      manual = false;
      paused = false;
      lastHUD = -Infinity;
    }

    function togglePause() {
      paused = !paused;
      lastHUD = -Infinity;
    }

    function updateFramingGoal() {
      framingGoal = hud && width > 760
        ? Math.min(
            ui.panel.getBoundingClientRect().right + 12,
            width * 0.42
          ) * 0.43
        : 0;
    }

    function toggleHUD() {
      hud = !hud;

      document.body.classList.toggle('hud-hidden', !hud);

      ui.hudLabel.textContent = hud ? 'Hide HUD' : 'Show HUD';
      ui.hud.setAttribute('aria-expanded', String(hud));
      ui.panel.setAttribute('aria-hidden', String(!hud));

      updateFramingGoal();
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

    ui.content.addEventListener(
      'wheel',
      enterManual,
      { passive: true }
    );

    document.querySelectorAll('[data-inspection-ui]').forEach(el => {
      el.addEventListener('pointerdown', enterManual);
      el.addEventListener('focusin', enterManual);
    });

    ui.pause.addEventListener('click', togglePause);
    ui.resume.addEventListener('click', resumeFlight);
    ui.hud.addEventListener('click', toggleHUD);

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
        event.target.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)
      ) {
        return;
      }

      if (
        event.code === 'Space' &&
        event.target.closest('button,summary,a')
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
      0.95,
      0.48,
      hdr ? 1.0 : 0.8
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

          vec3 aces(vec3 c) {
            return clamp(
              (c * (2.51 * c + 0.03)) /
              (c * (2.43 * c + 0.59) + 0.14),
              0.0,
              1.0
            );
          }

          vec3 toDisplay(vec3 c) {
            return mix(
              c * 12.92,
              1.055 *
                pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) -
                0.055,
              step(vec3(0.0031308), c)
            );
          }

          void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;

            c *= 1.0 - 0.14 * smoothstep(
              0.22,
              0.72,
              length(vUv - 0.5)
            );

            gl_FragColor = vec4(
              toDisplay(aces(c * 0.95)),
              1.0
            );
          }
        `
      })
    );

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    function applyProjection() {
      for (const c of [camera, controlCamera]) {
        c.aspect = width / height;

        c.setViewOffset(
          width,
          height,
          -framing,
          0,
          width,
          height
        );

        c.updateProjectionMatrix();
      }
    }

    function resize() {
      width = Math.max(1, innerWidth);
      height = Math.max(1, innerHeight);
      dpr = Math.min(devicePixelRatio || 1, 2);

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

      U.uResolution.value.set(
        width * dpr,
        height * dpr
      );

      U.uPointScale.value =
        height * dpr /
        (
          2 *
          Math.tan(T.MathUtils.degToRad(camera.fov / 2))
        );

      labels.setSize(width, height);
      updateFramingGoal();

      framing = framingGoal;
      applyProjection();

      lastHUD = -Infinity;
    }

    addEventListener('resize', resize);
    resize();

    const projected = V();
    const unprojected = V();
    const markerWorld = V();

    function overlap(a, b) {
      return (
        a.left < b.right + 10 &&
        a.right > b.left - 10 &&
        a.top < b.bottom + 10 &&
        a.bottom > b.top - 10
      );
    }

    function updateLabels(dt) {
      const occupied = hud
        ? [
            ui.panel,
            ui.controls,
            ui.caption,
            ui.journey
          ]
            .map(el => el.getBoundingClientRect())
            .filter(r => r.width && r.height)
        : [];

      const ranked = cards
        .map(c => ({
          c,
          d: camera.position.distanceTo(c.anchor)
        }))
        .sort((a, b) => a.d - b.d);

      let shown = 0;

      for (const { c, d } of ranked) {
        projected.copy(c.anchor).project(camera);

        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;

        const w = c.element.offsetWidth || 294;
        const h = c.element.offsetHeight || 210;

        let chosen = null;

        if (
          hud &&
          (manual || c.stage === activeStage) &&
          !atlasReturn &&
          shown < 2 &&
          d > 0.05 &&
          d < 175 &&
          projected.z > -1 &&
          projected.z < 1 &&
          x > 0 &&
          x < width &&
          y > 0 &&
          y < height
        ) {
          const candidates = [
            { left: x + 24, top: y - h / 2 },
            { left: x - w - 24, top: y - h / 2 },
            { left: x - w / 2, top: y - h - 25 },
            { left: x - w / 2, top: y + 25 }
          ];

          for (const r of candidates) {
            r.right = r.left + w;
            r.bottom = r.top + h;

            if (
              r.left < 12 ||
              r.right > width - 12 ||
              r.top < 74 ||
              r.bottom > height - 12
            ) {
              continue;
            }

            if (occupied.some(other => overlap(r, other))) {
              continue;
            }

            chosen = r;
            occupied.push(r);
            shown++;
            break;
          }
        }

        if (chosen) {
          c.element.style.left = (chosen.left - x) + 'px';
          c.element.style.top = (chosen.top - y) + 'px';

          const ex = clamp(x, chosen.left, chosen.right);
          const ey = clamp(y, chosen.top, chosen.bottom);

          unprojected
            .set(
              ex / width * 2 - 1,
              1 - ey / height * 2,
              projected.z
            )
            .unproject(camera);

          const positions =
            c.leader.geometry.attributes.position.array;

          c.anchor.toArray(positions, 0);
          unprojected.toArray(positions, 3);

          c.leader.geometry.attributes.position.needsUpdate = true;
        }

        const target = chosen
          ? (1 - smooth(130, 175, d)) * smooth(0.05, 0.2, d)
          : 0;

        c.opacity = mix(
          c.opacity,
          target,
          1 - Math.exp(-dt * 9)
        );

        c.object.visible = c.opacity > 0.01;
        c.root.style.opacity = String(c.opacity);
        c.element.style.pointerEvents =
          c.opacity > 0.7 ? 'auto' : 'none';
        c.element.tabIndex = c.opacity > 0.7 ? 0 : -1;

        c.leader.visible = hud && c.object.visible;
        c.leader.material.opacity = c.opacity * 0.45;
      }

      const sortedMarkers = markers
        .map(m => {
          m.object.getWorldPosition(markerWorld);

          return {
            m,
            world: markerWorld.clone(),
            d: camera.position.distanceTo(markerWorld)
          };
        })
        .sort((a, b) => a.d - b.d);

      let count = 0;

      for (const { m, world, d } of sortedMarkers) {
        projected.copy(world).project(camera);

        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;

        const w = m.el.textContent.length * 5.6 + 14;

        const r = {
          left: x - w / 2,
          right: x + w / 2,
          top: y - 12,
          bottom: y + 12
        };

        const visible =
          hud &&
          count < 8 &&
          d < m.distance &&
          projected.z > -1 &&
          projected.z < 1 &&
          r.left > 8 &&
          r.right < width - 8 &&
          r.top > 65 &&
          r.bottom < height - 12 &&
          !occupied.some(other => overlap(r, other));

        m.object.visible = visible;

        if (visible) {
          occupied.push(r);
          count++;

          m.el.style.opacity = String(
            1 - smooth(m.distance * 0.7, m.distance, d)
          );
        }
      }
    }

    const stageText = {
      subatomic: [
        'A / SUBATOMIC FOUNDATION',
        'Coupling, without resistance.',
        'Follow the massive particle families and the massless photon and gluon field schematics.'
      ],
      stellar: [
        'B / PLANETARY & STELLAR SYSTEMS',
        'Matter gathers into worlds.',
        'A rescaled atlas of asteroids, comets, gas giants, luminous stars, and compact remnants.'
      ],
      cosmic: [
        'C / VOIDS, GALAXIES & QUASARS',
        'A sparse cosmos. Immense structures.',
        'Cross a conceptual Boötes field overlay, then compare TON 618 with planetary orbital distances.'
      ],
      horizon: [
        'D / THEORETICAL HORIZON',
        'The limit of observation.',
        'Redshift colors lead into speculative geometric sheets beyond the observable chapter.'
      ]
    };

    const velocity = V();
    const previousPosition = camera.position.clone();

    function updateHUD(stamp) {
      if (stamp - lastHUD < 120) return;
      lastHUD = stamp;

      const text = stageText[activeStage];
      const clock = flight % period;

      ui.mode.textContent = paused
        ? 'PAUSED / ' + (manual ? 'INSPECTION' : 'DRONE')
        : returning
          ? 'REJOINING FLIGHT'
          : manual
            ? 'MANUAL INSPECTION'
            : atlasReturn
              ? 'ATLAS RETURN'
              : 'AUTOMATIC DRONE';

      ui.pauseLabel.textContent = paused ? 'Play' : 'Pause';
      ui.pause.setAttribute('aria-pressed', String(paused));

      ui.phase.textContent = atlasReturn
        ? 'RETURN / FIELD ATLAS'
        : text[0];

      ui.scale.textContent =
        '10^' + (-18 + 45 * narrative).toFixed(1) + ' m / guide';

      ui.pressure.textContent = 'Not modeled';
      ui.vev.textContent = '246';

      ui.velocity.textContent =
        '(' +
        velocity.x.toFixed(2) + ', ' +
        velocity.y.toFixed(2) + ', ' +
        velocity.z.toFixed(2) +
        ')';

      const index = [
        'subatomic', 'stellar', 'cosmic', 'horizon'
      ].indexOf(activeStage);

      ui.journeyValue.textContent = atlasReturn
        ? 'RETURN'
        : String(index + 1).padStart(2, '0') + ' / 04';

      ui.fill.style.transform =
        'scaleX(' + clock / period + ')';

      ui.progress.setAttribute(
        'aria-valuenow',
        String(Math.round(clock / period * 100))
      );

      ui.stages.forEach(el => {
        const on = el.dataset.stage === activeStage;
        el.classList.toggle('is-active', on);

        if (on) {
          el.setAttribute('aria-current', 'step');
        } else {
          el.removeAttribute('aria-current');
        }
      });

      const inspectingSolar =
        !atlasReturn &&
        clock > 326 &&
        clock < 350;

      ui.chapter.textContent = atlasReturn
        ? 'RETURN / CONTINUOUS ATLAS'
        : text[0];

      ui.title.textContent = atlasReturn
        ? 'Back through the scale atlas.'
        : inspectingSolar
          ? 'One scale. An enormous contrast.'
          : text[1];

      ui.description.textContent = atlasReturn
        ? 'The drone returns above the models before beginning another uninterrupted cycle.'
        : inspectingSolar
          ? 'The modeled horizon spans about 43.3 Neptune-orbit diameters. Planet markers are enlarged; orbit distances are not.'
          : text[2];
    }

    let raf = 0;

    function frame(stamp) {
      raf = requestAnimationFrame(frame);

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
        const u = ease(
          clamp(r.elapsed / r.duration, 0, 1)
        );

        camera.position.lerpVectors(
          r.position,
          r.target,
          u
        );

        camera.quaternion
          .copy(r.quaternion)
          .slerp(r.rotation, u);

        focusDistance = mix(r.focus, r.distance, u);

        if (u >= 1) {
          returning = null;
        }

        syncControls();
      } else if (manual) {
        controls.update();
        controlCamera.updateMatrixWorld(true);

        const alpha = 1 - Math.exp(-dt * 15);

        camera.position.lerp(
          controlCamera.position,
          alpha
        );

        camera.quaternion.slerp(
          controlCamera.quaternion,
          alpha
        );

        focusDistance = controlCamera.position.distanceTo(
          controls.target
        );
      } else if (!paused) {
        sampleRoute();

        camera.position.copy(desiredPosition);

        camera.quaternion.slerp(
          desiredQuaternion,
          1 - Math.exp(-dt * 8)
        );

        focusDistance = desiredDistance;
        syncControls();
      }

      if (Math.min(devicePixelRatio || 1, 2) !== dpr) {
        resize();
      }

      const nextFraming = mix(
        framing,
        framingGoal,
        1 - Math.exp(-dt * 8)
      );

      if (Math.abs(nextFraming - framing) > 0.001) {
        framing = nextFraming;
        applyProjection();
      }

      camera.updateMatrixWorld(true);

      if (dt > 0) {
        velocity
          .copy(camera.position)
          .sub(previousPosition)
          .multiplyScalar(1 / dt);
      } else {
        velocity.set(0, 0, 0);
      }

      previousPosition.copy(camera.position);

      U.uTime.value = time;
      U.uJourney.value = narrative;

      for (const animate of animated) {
        animate(time);
      }

      scene.updateMatrixWorld(true);

      updateLabels(dt);
      updateHUD(stamp);

      composer.render();
      labels.render(scene, camera);
    }

    renderer.domElement.addEventListener(
      'webglcontextlost',
      event => {
        event.preventDefault();
        contextLost = true;

        fail(
          'Graphics context interrupted. Waiting for the browser to restore it.'
        );
      }
    );

    renderer.domElement.addEventListener(
      'webglcontextrestored',
      () => {
        contextLost = false;
        lastStamp = 0;

        if (notice) {
          notice.hidden = true;
        }

        resize();
      }
    );

    document.addEventListener('visibilitychange', () => {
      lastStamp = 0;
    });

    addEventListener('pagehide', () => {
      cancelAnimationFrame(raf);
      lastStamp = 0;
    });

    addEventListener('pageshow', event => {
      if (event.persisted) {
        lastStamp = 0;
        raf = requestAnimationFrame(frame);
      }
    });

    renderer.compile(scene, camera);
    raf = requestAnimationFrame(frame);
  }
})();