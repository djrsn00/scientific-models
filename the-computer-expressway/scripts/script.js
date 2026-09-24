// script.js
(() => {
  "use strict";

  const notice = document.getElementById("render-notice");
  const THREE = window.THREE;

  const required = [
    "OrbitControls",
    "EffectComposer",
    "RenderPass",
    "ShaderPass",
    "UnrealBloomPass",
    "FXAAShader"
  ];

  if (!THREE || required.some((name) => !THREE[name])) {
    notice.dataset.error = "true";
    notice.textContent =
      "The graphics libraries could not load. Check the connection and reload.";
    return;
  }

  try {
    initialize();
  } catch (error) {
    console.error(error);
    notice.hidden = false;
    notice.dataset.error = "true";
    notice.textContent =
      "The hardware visualization could not initialize. Check browser graphics acceleration.";
  }

  function initialize() {
    const container = document.getElementById("canvas-container");
    const panel = document.getElementById("info-panel");
    const caption = document.getElementById("transit-caption");

    const ui = {
      number: document.getElementById("stage-number"),
      title: document.getElementById("stage-title"),
      description: document.getElementById("stage-description"),
      mode: document.getElementById("flight-mode"),
      rateLabel: document.getElementById("rate-label"),
      rate: document.getElementById("metric-rate"),
      interface: document.getElementById("metric-interface"),
      clock: document.getElementById("metric-clock"),
      width: document.getElementById("metric-width"),
      temperature: document.getElementById("metric-temperature"),
      progress: document.getElementById("progress-text"),
      progressFill: document.getElementById("progress-fill"),
      caption: document.getElementById("caption-text"),
      rows: Array.from(document.querySelectorAll("[data-stage]"))
    };

    const TAU = Math.PI * 2;
    const clamp01 = (x) => Math.max(0, Math.min(1, x));

    function smoothstep(a, b, value) {
      const t = clamp01((value - a) / (b - a));
      return t * t * (3 - 2 * t);
    }

    function smootherstep(value) {
      const t = clamp01(value);
      return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function seededRandom(seed) {
      return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }

    const random = seededRandom(0x53494c49);
    const range = (a, b) => a + (b - a) * random();

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    const annotationScene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      56,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.04,
      1900
    );

    camera.up.set(0, 1, 0);
    camera.position.set(0, 8, -48);
    camera.lookAt(0, 8, -36);
    scene.add(camera);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      stencil: false,
      precision: "highp",
      powerPreference: "high-performance",
      preserveDrawingBuffer: false
    });

    renderer.setClearColor(0x000000, 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.autoClear = false;

    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute(
      "aria-label",
      "Interactive automated computer hardware fly-through"
    );
    renderer.domElement.setAttribute("aria-describedby", "control-help");
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 8, -28);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.45;
    controls.zoomSpeed = 0.65;
    controls.panSpeed = 0.65;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 1600;
    controls.minPolarAngle = 0.012;
    controls.maxPolarAngle = Math.PI - 0.012;
    controls.autoRotate = false;

    const gl = renderer.getContext();
    const maximumPointSize = Math.min(
      96,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    const hdrAvailable =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("EXT_color_buffer_float");

    const renderTextureType = hdrAvailable
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    const timeUniform = { value: 0 };
    const fogUniform = { value: scene.fog.density };
    const pointScaleUniform = { value: 1 };

    const animators = [];
    const labels = [];
    const stageMaterials = [];
    const dummy = new THREE.Object3D();
    const unitBox = new THREE.BoxGeometry(1, 1, 1);

    function linearColor(hex) {
      return new THREE.Color(hex).convertSRGBToLinear();
    }

    function canvasTexture(canvas, srgb = false) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.encoding = srgb
        ? THREE.sRGBEncoding
        : THREE.LinearEncoding;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      return texture;
    }

    function createEnvironment() {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;

      const context = canvas.getContext("2d");
      const gradient = context.createLinearGradient(0, 0, 0, 512);

      gradient.addColorStop(0, "#05070d");
      gradient.addColorStop(0.27, "#162238");
      gradient.addColorStop(0.43, "#7199b3");
      gradient.addColorStop(0.47, "#e6f3ff");
      gradient.addColorStop(0.51, "#14202c");
      gradient.addColorStop(0.66, "#23170d");
      gradient.addColorStop(1, "#010205");

      context.fillStyle = gradient;
      context.fillRect(0, 0, 1024, 512);

      for (let i = 0; i < 12; i++) {
        const x = i * 91;
        context.fillStyle = i % 3 === 0 ? "#c1d6e8" : "#3b526c";
        context.fillRect(x, 90, 12, 145);
      }

      const texture = canvasTexture(canvas, true);
      texture.mapping = THREE.EquirectangularReflectionMapping;

      const generator = new THREE.PMREMGenerator(renderer);
      generator.compileEquirectangularShader();
      const target = generator.fromEquirectangular(texture);

      scene.environment = target.texture;
      texture.dispose();
      generator.dispose();

      return target;
    }

    const environmentTarget = createEnvironment();

    scene.add(new THREE.HemisphereLight(0xb7d9ff, 0x142015, 0.75));

    const keyLight = new THREE.DirectionalLight(0xe8f0ff, 1.55);
    keyLight.position.set(-90, 180, 60);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x52699d, 0.55);
    fillLight.position.set(100, 30, 700);
    scene.add(fillLight);

    const cameraLight = new THREE.PointLight(0xc1ddff, 2.1, 125, 2);
    cameraLight.position.set(0, 3, 0);
    camera.add(cameraLight);

    function standardMaterial(color, options = {}) {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.42,
        metalness: 0.65,
        ...options
      });
    }

    const materials = {
      black: standardMaterial(0x080b11, { roughness: 0.42 }),
      graphite: standardMaterial(0x161d27, { roughness: 0.48 }),
      board: standardMaterial(0x071c15, {
        metalness: 0.28,
        roughness: 0.68
      }),
      silver: new THREE.MeshPhysicalMaterial({
        color: 0xd7e3ed,
        metalness: 1,
        roughness: 0.095,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        envMapIntensity: 1.65
      }),
      copper: standardMaterial(0xc88043, {
        metalness: 0.96,
        roughness: 0.24
      }),
      gold: standardMaterial(0xe1ad36, {
        metalness: 0.92,
        roughness: 0.24
      }),
      ceramic: standardMaterial(0x394048, {
        metalness: 0.12,
        roughness: 0.67
      }),
      rubber: standardMaterial(0x080a0c, {
        metalness: 0.05,
        roughness: 0.82
      }),
      yellow: standardMaterial(0xc4931b, {
        emissive: 0xffb000,
        emissiveIntensity: 0.28,
        metalness: 0.35
      }),
      cyan: standardMaterial(0x16465b, {
        emissive: 0x20ceff,
        emissiveIntensity: 0.8,
        metalness: 0.5
      }),
      purple: standardMaterial(0x381359, {
        emissive: 0xa82fff,
        emissiveIntensity: 0.9
      })
    };

    stageMaterials.push(
      { material: materials.yellow, z: 65, intensity: 0.28 },
      { material: materials.cyan, z: 700, intensity: 0.8 },
      { material: materials.purple, z: 910, intensity: 0.9 }
    );

    function box(parent, width, height, depth, x, y, z, material) {
      const mesh = new THREE.Mesh(unitBox, material);
      mesh.scale.set(width, height, depth);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function cylinder(
      parent, radius, height, x, y, z, material, segments = 48
    ) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(radius, radius, height, segments),
        material
      );
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    }

    function tube(parent, points, radius, material, segments = 96) {
      const curve = new THREE.CatmullRomCurve3(
        points.map((p) => new THREE.Vector3(...p)),
        false,
        "centripetal"
      );

      const mesh = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segments, radius, 8, false),
        material
      );
      parent.add(mesh);
      return mesh;
    }

    function instanceBoxes(parent, entries, material) {
      const mesh = new THREE.InstancedMesh(
        unitBox, material, entries.length
      );

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        dummy.position.set(entry[0], entry[1], entry[2]);
        dummy.scale.set(entry[3], entry[4], entry[5]);
        dummy.rotation.set(0, entry[6] || 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    }

    function addScrews(parent, locations, radius = 0.7) {
      const geometry = new THREE.CylinderGeometry(radius, radius, 0.4, 12);
      const mesh = new THREE.InstancedMesh(
        geometry, materials.silver, locations.length
      );

      for (let i = 0; i < locations.length; i++) {
        dummy.position.fromArray(locations[i]);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
    }

    function makeFan(parent, x, y, z, radius, orientation) {
      const root = new THREE.Group();
      root.position.set(x, y, z);

      if (orientation === "up") {
        root.rotation.x = -Math.PI / 2;
      } else {
        root.rotation.y = Math.PI;
      }

      parent.add(root);

      const rim = new THREE.Mesh(
        new THREE.TorusGeometry(radius, radius * 0.065, 10, 64),
        materials.graphite
      );
      root.add(rim);

      const innerRim = new THREE.Mesh(
        new THREE.TorusGeometry(radius * 0.9, 0.12, 6, 64),
        materials.cyan
      );
      root.add(innerRim);

      const rotor = new THREE.Group();
      root.add(rotor);

      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, 1.5, 32),
        materials.black
      );
      hub.rotation.x = Math.PI / 2;
      rotor.add(hub);

      for (let i = 0; i < 11; i++) {
        const angle = i * TAU / 11;
        const blade = new THREE.Mesh(unitBox, materials.graphite);
        blade.position.set(
          Math.cos(angle) * radius * 0.56,
          Math.sin(angle) * radius * 0.56,
          0
        );
        blade.scale.set(radius * 0.65, radius * 0.15, 0.65);
        blade.rotation.z = angle + 0.42;
        rotor.add(blade);
      }

      animators.push((time) => {
        rotor.rotation.z = -time * 4.8;
      });

      return root;
    }

    function makeParticleTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;

      const context = canvas.getContext("2d");
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.18, "rgba(255,255,255,0.9)");
      gradient.addColorStop(0.48, "rgba(255,255,255,0.2)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
      return canvasTexture(canvas);
    }

    const particleTexture = makeParticleTexture();

    const particleVertex = `
      attribute vec3 aEnd;
      attribute vec3 color;
      attribute vec4 aData;
      attribute float aSize;

      uniform float uTime;
      uniform float uMode;
      uniform float uPointScale;
      uniform float uMaxPointSize;
      uniform vec3 uCenter;

      varying vec3 vColor;
      varying float vSeed;
      varying float vDistance;
      varying vec3 vWorld;

      void main() {
        vec3 p = position;

        if (uMode > 0.5 && uMode < 1.5) {
          float progress = fract(aData.x + uTime * aData.y);
          p = mix(position, aEnd, progress);
        } else if (uMode > 1.5 && uMode < 2.5) {
          float progress = fract(aData.x + uTime * aData.y);
          p.x += sin(progress * 3.14159265) * 4.0;
          p.y += sin(progress * 3.14159265) * 2.0;
          p.z = 62.0 + progress * 50.0;
        } else if (uMode > 2.5) {
          vec3 local = position - uCenter;
          float angle = uTime * aData.y;
          float cs = cos(angle);
          float sn = sin(angle);
          p = uCenter + vec3(
            local.x * cs - local.z * sn,
            local.y,
            local.x * sn + local.z * cs
          );
        }

        vec4 world = modelMatrix * vec4(p, 1.0);
        vec4 mvPosition = viewMatrix * world;

        vWorld = world.xyz;
        vColor = color;
        vSeed = aData.w;
        vDistance = length(mvPosition.xyz);

        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(
          aSize * uPointScale / max(0.08, -mvPosition.z),
          1.0,
          uMaxPointSize
        );
      }
    `;

    const particleFragment = `
      uniform sampler2D uSprite;
      uniform float uTime;
      uniform float uFog;
      uniform float uGain;

      varying vec3 vColor;
      varying float vSeed;
      varying float vDistance;
      varying vec3 vWorld;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;
        float rr = dot(centered, centered);
        if (rr > 1.0) discard;

        float alpha = texture2D(uSprite, gl_PointCoord).a;
        float pulse = 0.38 + 0.62 *
          pow(0.5 + 0.5 * sin(uTime * 6.0 + vSeed * 71.0), 3.0);
        float proximity = exp(-distance(cameraPosition, vWorld) * 0.018);
        float core = exp(-rr * 34.0);

        vec3 color =
          vColor * (1.2 + 2.6 * pulse + proximity) * uGain +
          vec3(0.55, 0.67, 0.85) * core * pulse;

        alpha *= exp(-uFog * uFog * vDistance * vDistance);
        if (alpha < 0.002) discard;

        gl_FragColor = vec4(color, alpha * 0.85);
      }
    `;

    function particleField(parent, count, mode, builder, options = {}) {
      const positions = new Float32Array(count * 3);
      const ends = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const data = new Float32Array(count * 4);
      const sizes = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const item = builder(i);
        const color = linearColor(item.color);

        positions.set(item.position, i * 3);
        ends.set(item.end || item.position, i * 3);
        colors.set([color.r, color.g, color.b], i * 3);
        data.set([
          random(),
          item.speed || range(0.15, 0.5),
          0,
          random()
        ], i * 4);
        sizes[i] = item.size || range(0.12, 0.35);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aEnd", new THREE.BufferAttribute(ends, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("aData", new THREE.BufferAttribute(data, 4));
      geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: timeUniform,
          uFog: fogUniform,
          uPointScale: pointScaleUniform,
          uMaxPointSize: { value: maximumPointSize },
          uMode: { value: mode },
          uCenter: {
            value: new THREE.Vector3(...(options.center || [0, 0, 0]))
          },
          uGain: { value: options.gain || 1 },
          uSprite: { value: particleTexture }
        },
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false
      });

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      parent.add(points);
      return points;
    }

    function animatedLines(parent, segments, gain = 1) {
      const positions = [];
      const colors = [];
      const phases = [];
      const seeds = [];

      for (const segment of segments) {
        const color = linearColor(segment.color);
        const seed = random();

        positions.push(...segment.a, ...segment.b);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        phases.push(0, 1);
        seeds.push(seed, seed);
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position", new THREE.Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute(
        "color", new THREE.Float32BufferAttribute(colors, 3)
      );
      geometry.setAttribute(
        "aAlong", new THREE.Float32BufferAttribute(phases, 1)
      );
      geometry.setAttribute(
        "aSeed", new THREE.Float32BufferAttribute(seeds, 1)
      );

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTime: timeUniform,
          uFog: fogUniform,
          uGain: { value: gain }
        },
        vertexShader: `
          attribute vec3 color;
          attribute float aAlong;
          attribute float aSeed;

          varying vec3 vColor;
          varying vec3 vWorld;
          varying float vAlong;
          varying float vSeed;
          varying float vDistance;

          void main() {
            vec4 world = modelMatrix * vec4(position, 1.0);
            vec4 mvPosition = viewMatrix * world;
            vColor = color;
            vWorld = world.xyz;
            vAlong = aAlong;
            vSeed = aSeed;
            vDistance = length(mvPosition.xyz);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uFog;
          uniform float uGain;

          varying vec3 vColor;
          varying vec3 vWorld;
          varying float vAlong;
          varying float vSeed;
          varying float vDistance;

          void main() {
            float moving = fract(
              vAlong * 0.65 - uTime * (0.25 + vSeed * 0.3) + vSeed
            );
            float pulse = pow(
              max(0.0, 1.0 - abs(moving - 0.5) * 6.0),
              4.0
            );
            float proximity =
              exp(-distance(cameraPosition, vWorld) * 0.018);

            vec3 color = vColor *
              (0.25 + pulse * (2.2 + proximity * 2.0)) * uGain;

            float alpha =
              exp(-uFog * uFog * vDistance * vDistance);

            gl_FragColor = vec4(color, alpha * 0.9);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false
      });

      const lines = new THREE.LineSegments(geometry, material);
      lines.frustumCulled = false;
      parent.add(lines);
      return lines;
    }

    function cellMaterial(colorA, colorB, gain = 1) {
      return new THREE.ShaderMaterial({
        uniforms: {
          uTime: timeUniform,
          uFog: fogUniform,
          uColorA: { value: linearColor(colorA) },
          uColorB: { value: linearColor(colorB) },
          uGain: { value: gain }
        },
        vertexShader: `
          varying vec3 vLocal;
          varying vec3 vNormalWorld;
          varying vec3 vWorld;
          varying float vSeed;
          varying float vDistance;

          void main() {
            mat4 instanceTransform = mat4(1.0);
            #ifdef USE_INSTANCING
              instanceTransform = instanceMatrix;
            #endif

            vec4 world =
              modelMatrix * instanceTransform * vec4(position, 1.0);
            vec4 mvPosition = viewMatrix * world;

            vLocal = position;
            vWorld = world.xyz;
            vNormalWorld = normalize(
              mat3(modelMatrix) * mat3(instanceTransform) * normal
            );
            vSeed = fract(
              sin(dot(instanceTransform[3].xyz, vec3(12.9898,78.233,39.425))) *
              43758.5453
            );
            vDistance = length(mvPosition.xyz);

            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: `
          uniform float uTime;
          uniform float uFog;
          uniform vec3 uColorA;
          uniform vec3 uColorB;
          uniform float uGain;

          varying vec3 vLocal;
          varying vec3 vNormalWorld;
          varying vec3 vWorld;
          varying float vSeed;
          varying float vDistance;

          void main() {
            vec3 d = max(vec3(0.0), vec3(0.5) - abs(vLocal));
            float edgeDistance = min(
              max(d.x, d.y),
              min(max(d.x, d.z), max(d.y, d.z))
            );
            float width = max(fwidth(edgeDistance), 0.001);
            float edge = 1.0 - smoothstep(
              0.014,
              0.04 + width,
              edgeDistance
            );

            float activity = pow(
              0.5 + 0.5 * sin(uTime * (4.0 + vSeed * 4.0) + vSeed * 91.0),
              8.0
            );
            float proximity =
              exp(-distance(cameraPosition, vWorld) * 0.018);
            float diffuse = 0.35 + 0.65 * abs(dot(
              normalize(vNormalWorld),
              normalize(cameraPosition + vec3(0.0,10.0,0.0) - vWorld)
            ));

            vec3 tint = mix(uColorA, uColorB, vSeed);
            vec3 color = tint * (
              0.035 * diffuse +
              edge * (0.35 + activity * 2.6 + proximity * 0.55)
            ) * uGain;

            color += tint * activity * 0.085;
            color *= exp(-uFog * uFog * vDistance * vDistance);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
        extensions: { derivatives: true }
      });
    }

    const motherboard = new THREE.Group();
    scene.add(motherboard);

    box(motherboard, 320, 4, 1390, 0, -15, 625, materials.black);
    box(motherboard, 306, 0.7, 1370, 0, -12.6, 625, materials.board);

    const perimeterSegments = [
      { a: [-151,-12, -55], b: [-151,-12,1305], color: 0x376870 },
      { a: [151,-12, -55], b: [151,-12,1305], color: 0x376870 },
      { a: [-151,-12,-55], b: [151,-12,-55], color: 0x376870 },
      { a: [-151,-12,1305], b: [151,-12,1305], color: 0x376870 }
    ];
    animatedLines(motherboard, perimeterSegments, 0.65);

    const passiveComponents = [];
    for (let i = 0; i < 1200; i++) {
      const side = random() < 0.5 ? -1 : 1;
      passiveComponents.push([
        side * range(82, 145),
        -10.7,
        range(-20, 1230),
        range(1.2, 3.3),
        range(1, 2.3),
        range(2, 5),
        random() < 0.5 ? 0 : Math.PI / 2
      ]);
    }
    instanceBoxes(motherboard, passiveComponents, materials.ceramic);

    // Stage 1: case intake, PSU and an enlarged cable bundle.
    const power = new THREE.Group();
    scene.add(power);

    const glass = new THREE.Mesh(
      new THREE.PlaneGeometry(158, 92),
      new THREE.MeshPhysicalMaterial({
        color: 0x668da8,
        metalness: 0.05,
        roughness: 0.09,
        transparent: true,
        opacity: 0.075,
        clearcoat: 1,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    glass.position.set(0, 28, -14);
    power.add(glass);

    box(power, 164, 3, 4, 0, -19, -14, materials.graphite);
    box(power, 164, 3, 4, 0, 75, -14, materials.graphite);
    box(power, 3, 94, 4, -81, 28, -14, materials.graphite);
    box(power, 3, 94, 4, 81, 28, -14, materials.graphite);

    box(power, 84, 4, 65, 0, -9, 34, materials.black);
    box(power, 3, 38, 65, -42, 8, 34, materials.graphite);
    box(power, 3, 38, 65, 42, 8, 34, materials.graphite);
    box(power, 84, 3, 65, 0, 27, 34, materials.black);

    box(power, 25, 35, 3, -29, 8, 1, materials.graphite);
    box(power, 25, 35, 3, 29, 8, 1, materials.graphite);
    box(power, 30, 4, 3, 0, 25, 1, materials.graphite);

    makeFan(power, -27, 8, -1, 11, "front");

    for (const x of [-26, 26]) {
      for (const z of [22, 47]) {
        cylinder(power, 5.4, 18, x, 2, z, materials.black);
        cylinder(power, 5.2, 0.5, x, 11.2, z, materials.silver);
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(5.5, 0.12, 6, 48),
          materials.yellow
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(x, 5, z);
        power.add(ring);
      }
    }

    const psuVents = [];
    for (let i = 0; i < 22; i++) {
      psuVents.push([-43.7, 9, 4 + i * 2.7, 0.5, 20, 0.7]);
      psuVents.push([43.7, 9, 4 + i * 2.7, 0.5, 20, 0.7]);
    }
    instanceBoxes(power, psuVents, materials.black);

    for (let cable = 0; cable < 8; cable++) {
      const angle = cable * TAU / 8;
      const baseX = Math.cos(angle) * 11;
      const baseY = 4 + Math.sin(angle) * 11;
      const points = [];

      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        points.push([
          baseX + Math.sin(t * Math.PI) * 4,
          baseY + Math.sin(t * Math.PI) * 2,
          62 + t * 50
        ]);
      }

      tube(
        power,
        points,
        0.72,
        cable % 2 === 0 ? materials.yellow : materials.rubber,
        112
      );

      const braid = [];
      for (let i = 0; i <= 180; i++) {
        const t = i / 180;
        const phase = t * TAU * 20 + angle;
        braid.push([
          baseX + Math.sin(t * Math.PI) * 4 + Math.cos(phase) * 0.77,
          baseY + Math.sin(t * Math.PI) * 2 + Math.sin(phase) * 0.77,
          62 + t * 50
        ]);
      }
      tube(power, braid, 0.045, materials.gold, 220);
    }

    particleField(power, 1400, 2, (i) => {
      const angle = (i % 8) * TAU / 8;
      return {
        position: [
          Math.cos(angle) * 12.05,
          4 + Math.sin(angle) * 12.05,
          62
        ],
        color: i % 4 === 0 ? 0xfff0bd : 0xffc129,
        size: range(0.1, 0.26),
        speed: range(0.16, 0.36)
      };
    });

    // Stage 2: reflective HDD platters and optical-drive laser mechanics.
    const storage = new THREE.Group();
    scene.add(storage);

    box(storage, 94, 6, 88, -35, -8.5, 157, materials.graphite);
    box(storage, 88, 1, 82, -35, -5, 157, materials.black);

    const platterAssembly = new THREE.Group();
    platterAssembly.position.set(-35, 0, 156);
    storage.add(platterAssembly);

    for (let layer = 0; layer < 3; layer++) {
      const y = -5.8 + layer * 2.1;
      cylinder(
        platterAssembly, 29, 0.45, 0, y, 0, materials.silver, 128
      );

      for (let ringIndex = 0; ringIndex < 9; ringIndex++) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(6 + ringIndex * 2.4, 0.027, 4, 96),
          materials.graphite
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = y + 0.25;
        platterAssembly.add(ring);
      }
    }

    cylinder(platterAssembly, 3.3, 8.5, 0, -3, 0, materials.silver);
    animators.push((time) => {
      platterAssembly.rotation.y = time * 2.7;
    });

    const readArm = box(
      storage, 28, 0.75, 3.5, -12, 1.6, 165, materials.silver
    );
    readArm.rotation.y = -0.4;
    cylinder(storage, 4.5, 5, 0, -1, 173, materials.graphite);
    box(storage, 3.5, 1, 2.3, -25, 1.3, 158, materials.cyan);

    particleField(storage, 1400, 3, () => {
      const radius = range(8, 28);
      const angle = random() * TAU;
      return {
        position: [
          -35 + Math.cos(angle) * radius,
          range(-0.8, 1.4),
          156 + Math.sin(angle) * radius
        ],
        color: random() < 0.18 ? 0xd8fff1 : 0x31ff99,
        size: range(0.08, 0.22),
        speed: range(0.4, 1.4)
      };
    }, { center: [-35, 0, 156] });

    addScrews(storage, [
      [-77,-4.8,118], [7,-4.8,118],
      [-77,-4.8,196], [7,-4.8,196]
    ]);

    box(storage, 83, 5, 69, 30, -8, 226, materials.graphite);
    box(storage, 77, 1, 63, 30, -4.9, 226, materials.black);

    cylinder(storage, 25, 0.45, 30, -2.2, 224, materials.silver, 128);
    cylinder(storage, 3, 2.2, 30, -2.6, 224, materials.graphite);

    const opticalRingMaterial = new THREE.MeshBasicMaterial({
      color: 0x615bbd,
      transparent: true,
      opacity: 0.4,
      depthWrite: false
    });

    for (let i = 0; i < 13; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(5 + i * 1.45, 0.042, 4, 96),
        opticalRingMaterial
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(30, -1.91, 224);
      storage.add(ring);
    }

    box(storage, 3, 2, 56, 2, -1.2, 226, materials.silver);
    box(storage, 3, 2, 56, 58, -1.2, 226, materials.silver);

    const laserHead = box(
      storage, 6, 2.5, 5, 44, -0.7, 226, materials.graphite
    );

    const laserGeometry = new THREE.BufferGeometry();
    laserGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([44,0,226,30,-1.6,224], 3)
    );

    const laserMaterial = new THREE.LineBasicMaterial({
      color: 0xff162c,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    const laser = new THREE.Line(laserGeometry, laserMaterial);
    laser.frustumCulled = false;
    storage.add(laser);

    const laserBeam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 1, 10),
      new THREE.MeshBasicMaterial({ color: 0xff2030 })
    );
    storage.add(laserBeam);

    const beamStart = new THREE.Vector3();
    const beamEnd = new THREE.Vector3();
    const beamDirection = new THREE.Vector3();
    const localY = new THREE.Vector3(0, 1, 0);

    animators.push((time) => {
      const x = 40 + Math.sin(time * 0.6) * 11;
      laserHead.position.x = x;

      beamStart.set(x, 0.7, 226);
      beamEnd.set(30 + Math.sin(time * 0.6) * 6, -1.6, 224);
      beamDirection.subVectors(beamEnd, beamStart);

      laserBeam.position.copy(beamStart).add(beamEnd).multiplyScalar(0.5);
      laserBeam.scale.set(1, beamDirection.length(), 1);
      laserBeam.quaternion.setFromUnitVectors(
        localY, beamDirection.normalize()
      );

      const array = laserGeometry.attributes.position.array;
      beamStart.toArray(array, 0);
      beamEnd.toArray(array, 3);
      laserGeometry.attributes.position.needsUpdate = true;
    });

    // Stage 3: M.2 substrate and 8,640 instanced NAND cells.
    const nvme = new THREE.Group();
    scene.add(nvme);

    box(nvme, 64, 2.3, 144, 0, -7.7, 325, materials.black);
    box(nvme, 60, 0.5, 140, 0, -6.25, 325, materials.board);

    const nandCells = [];
    const nandFrames = [];

    for (const side of [-1, 1]) {
      for (let bank = 0; bank < 4; bank++) {
        const centerX = side * 19;
        const centerZ = 277 + bank * 32;

        nandFrames.push([centerX, -4.3, centerZ, 17, 2.4, 26]);
        nandFrames.push([centerX - 8.2, 0, centerZ, 0.4, 8, 26]);
        nandFrames.push([centerX + 8.2, 0, centerZ, 0.4, 8, 26]);

        for (let x = 0; x < 10; x++) {
          for (let y = 0; y < 6; y++) {
            for (let z = 0; z < 18; z++) {
              nandCells.push([
                centerX + (x - 4.5) * 1.08,
                -2.4 + y * 0.9,
                centerZ + (z - 8.5) * 1.12,
                0.54, 0.52, 0.62
              ]);
            }
          }
        }
      }
    }

    instanceBoxes(nvme, nandFrames, materials.graphite);
    instanceBoxes(
      nvme,
      nandCells,
      cellMaterial(0xff852e, 0xe6f3ff, 1.25)
    );

    const nvmeContacts = [];
    for (let i = 0; i < 44; i++) {
      nvmeContacts.push([
        -26 + i * 1.2, -5.8, 397,
        0.65, 0.3, 8
      ]);
    }
    instanceBoxes(nvme, nvmeContacts, materials.gold);

    particleField(nvme, 1300, 1, (i) => {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * range(7.5, 10);
      return {
        position: [x, range(0, 3.5), 263],
        end: [x, range(0, 3.5), 393],
        color: random() < 0.5 ? 0xffa85a : 0xe7fbff,
        size: range(0.08, 0.19),
        speed: range(0.18, 0.48)
      };
    });

    // Stage 4: right-angle copper traces and chipset routing.
    const pcb = new THREE.Group();
    scene.add(pcb);

    box(pcb, 292, 2, 207, 0, -4.5, 501, materials.board);

    const traceSegments = [];
    for (let i = 0; i < 2200; i++) {
      const x0 = Math.round(range(-138, 138) / 2) * 2;
      const z0 = Math.round(range(402, 594) / 2) * 2;
      const x1 = Math.max(-142, Math.min(142, x0 + range(-28, 28)));
      const z1 = Math.max(401, Math.min(600, z0 + range(-28, 28)));
      const middleZ = Math.round((z0 + z1) / 4) * 2;
      const color = i % 8 === 0 ? 0xffe5ae : 0xcb7b28;

      traceSegments.push(
        { a: [x0,-3.35,z0], b: [x0,-3.35,middleZ], color },
        { a: [x0,-3.35,middleZ], b: [x1,-3.35,middleZ], color },
        { a: [x1,-3.35,middleZ], b: [x1,-3.35,z1], color }
      );
    }
    animatedLines(pcb, traceSegments, 1.05);

    const chipsetChips = [];
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 14; z++) {
        chipsetChips.push([
          -63 + x * 8.4,
          -1.65,
          505 + z * 5.8,
          5.2, 1.7, 3.8
        ]);
      }
    }
    instanceBoxes(
      pcb, chipsetChips, cellMaterial(0xa6b6c7, 0x93eeff, 0.95)
    );

    particleField(pcb, 1800, 1, () => {
      const x = range(-120, 120);
      const z = range(405, 578);
      const axis = random() < 0.5;
      return {
        position: [x, -2.8, z],
        end: axis
          ? [x + range(-18, 18), -2.8, z]
          : [x, -2.8, z + range(7, 22)],
        color: random() < 0.15 ? 0xd3fbff : 0xffb955,
        size: range(0.08, 0.17),
        speed: range(0.6, 1.5)
      };
    });

    // Stage 5: four DIMMs form a vertical memory canyon.
    const ram = new THREE.Group();
    scene.add(ram);

    const ramCells = [];
    const ramContacts = [];

    for (const x of [-43, -18, 18, 43]) {
      box(ram, 2.4, 72, 166, x, 28, 704, materials.board);
      box(ram, 3.8, 2, 168, x, 64.5, 704, materials.graphite);
      box(ram, 4.4, 2, 168, x, -8, 704, materials.black);

      for (let i = 0; i < 90; i++) {
        ramContacts.push([
          x, -6.7, 625 + i * 1.78,
          3.1, 5.2, 0.68
        ]);
      }

      const faceX = x + (x < 0 ? 2.8 : -2.8);

      for (let row = 0; row < 24; row++) {
        for (let column = 0; column < 80; column++) {
          ramCells.push([
            faceX,
            -1 + row * 2.5,
            626 + column * 1.97,
            1.55, 1.45, 1.14
          ]);
        }
      }
    }

    instanceBoxes(ram, ramContacts, materials.gold);
    instanceBoxes(
      ram, ramCells, cellMaterial(0x05bfff, 0xa8f6ff, 1.3)
    );

    particleField(ram, 2300, 1, (i) => {
      const x = i % 2 === 0 ? -13.2 : 13.2;
      const y = range(0, 61);
      return {
        position: [x, y, 623],
        end: [x, y, 785],
        color: random() < 0.2 ? 0xe4ffff : 0x12d5ff,
        size: range(0.09, 0.23),
        speed: range(0.35, 0.85)
      };
    });

    // Stage 6: CPU package, heat-pipe canopy and logic-gate field.
    const cpu = new THREE.Group();
    scene.add(cpu);

    box(cpu, 151, 4, 190, 0, -7.3, 898, materials.graphite);
    box(cpu, 142, 1, 182, 0, -4.7, 898, materials.board);

    const socketPins = [];
    for (let i = 0; i < 110; i++) {
      const z = 812 + i * 1.56;
      socketPins.push([-72, -3.5, z, 4, 0.5, 0.55]);
      socketPins.push([72, -3.5, z, 4, 0.5, 0.55]);
    }
    instanceBoxes(cpu, socketPins, materials.gold);

    const dieMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uFog: fogUniform
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vDistance;

        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDistance = length(mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFog;
        varying vec2 vUv;
        varying float vDistance;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453);
        }

        void main() {
          // 2048 × 2048 procedural cells: 4,194,304 surface addresses.
          vec2 coordinates = vUv * 2048.0;
          vec2 cell = floor(coordinates);
          vec2 local = fract(coordinates);
          vec2 derivative = max(fwidth(coordinates), vec2(0.0001));
          vec2 edgeDistance = min(local, 1.0 - local);

          float edge = 1.0 - smoothstep(
            0.1,
            1.1,
            min(
              edgeDistance.x / derivative.x,
              edgeDistance.y / derivative.y
            )
          );

          float resolvable =
            1.0 - smoothstep(0.5, 1.8, max(derivative.x, derivative.y));

          float activity = step(
            0.78,
            hash(cell + floor(uTime * 3.0))
          );

          float bus =
            pow(0.5 + 0.5 * sin(vUv.y * 280.0 - uTime * 4.0), 18.0);

          vec3 tint = mix(
            vec3(0.015, 0.22, 1.0),
            vec3(0.62, 0.02, 1.0),
            hash(cell)
          );

          vec3 detailed =
            tint * (0.04 + edge * (0.7 + activity * 1.3));
          vec3 average = vec3(0.025, 0.045, 0.13);
          vec3 color = mix(average, detailed, resolvable);
          color += vec3(0.2, 0.06, 0.55) * bus * 0.35;

          color *= exp(-uFog * uFog * vDistance * vDistance);
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      extensions: { derivatives: true }
    });

    const dieSurface = new THREE.Mesh(
      new THREE.PlaneGeometry(134, 174),
      dieMaterial
    );
    dieSurface.rotation.x = -Math.PI / 2;
    dieSurface.position.set(0, -1.4, 898);
    cpu.add(dieSurface);

    const gates = [];
    for (let x = 0; x < 72; x++) {
      for (let z = 0; z < 80; z++) {
        gates.push([
          -61 + x * 1.72,
          -0.2 + random() * 0.45,
          817 + z * 2.03,
          range(0.55, 0.95),
          range(0.45, 1.2),
          range(0.65, 1.2)
        ]);
      }
    }
    instanceBoxes(
      cpu, gates, cellMaterial(0x258bff, 0xc338ff, 1.6)
    );

    const logicSegments = [];
    for (let i = 0; i < 10000; i++) {
      const a = [
        range(-64, 64),
        range(0.4, 3.2),
        range(814, 984)
      ];
      const b = a.slice();
      const axis = i % 3;
      b[axis] += range(0.4, axis === 1 ? 1.5 : 4.2);

      logicSegments.push({
        a,
        b,
        color: i % 3 === 0 ? 0xd451ff : 0x2f98ff
      });
    }
    animatedLines(cpu, logicSegments, 1.3);

    particleField(cpu, 4200, 0, () => ({
      position: [
        range(-63, 63),
        range(0.7, 3.4),
        range(815, 984)
      ],
      color: random() < 0.4 ? 0xe076ff : 0x4eacff,
      size: range(0.05, 0.15)
    }), { gain: 1.2 });

    // Open-sided IHS cutaway leaves the camera corridor unobstructed.
    box(cpu, 144, 2.2, 184, 0, 17.7, 898, materials.silver);
    box(cpu, 2.2, 18, 184, -72, 8.5, 898, materials.silver);
    box(cpu, 2.2, 18, 184, 72, 8.5, 898, materials.silver);

    for (let i = 0; i < 8; i++) {
      const x = -49 + i * 14;
      tube(cpu, [
        [x, 19, 840],
        [x, 23, 865],
        [x, 48, 883],
        [x, 56, 920],
        [x, 33, 965]
      ], 1.6, materials.copper, 80);
    }

    const heatFins = [];
    for (let i = 0; i < 56; i++) {
      heatFins.push([
        0, 50, 857 + i * 2,
        146, 40, 0.55
      ]);
    }
    instanceBoxes(cpu, heatFins, materials.copper);

    // Stage 7 completes the requested seven-zone route with PCIe/GPU output.
    const graphics = new THREE.Group();
    scene.add(graphics);

    box(graphics, 172, 3, 190, 0, -7, 1108, materials.black);
    box(graphics, 166, 0.6, 184, 0, -5.1, 1108, materials.board);
    box(graphics, 52, 2.3, 58, 0, -2.5, 1110, materials.graphite);

    const gpuCells = [];
    for (let x = 0; x < 30; x++) {
      for (let z = 0; z < 34; z++) {
        gpuCells.push([
          -24 + x * 1.65,
          -0.55,
          1084 + z * 1.65,
          0.95, 0.8, 0.95
        ]);
      }
    }
    instanceBoxes(
      graphics, gpuCells, cellMaterial(0x4fe9ff, 0xae90ff, 1.2)
    );

    makeFan(graphics, -51, 13, 1110, 23, "up");
    makeFan(graphics, 51, 13, 1110, 23, "up");

    const gpuFins = [];
    for (let i = 0; i < 36; i++) {
      gpuFins.push([-51, 2, 1068 + i * 2.35, 45, 14, 0.65]);
      gpuFins.push([51, 2, 1068 + i * 2.35, 45, 14, 0.65]);
    }
    instanceBoxes(graphics, gpuFins, materials.graphite);

    const pcieSegments = [];
    for (let lane = 0; lane < 16; lane++) {
      const x = -30 + lane * 4;
      pcieSegments.push({
        a: [x,-2.8,1005],
        b: [x,-2.8,1196],
        color: lane % 2 === 0 ? 0x70eaff : 0xe2edff
      });
    }
    animatedLines(graphics, pcieSegments, 1.05);

    particleField(graphics, 2100, 1, (i) => {
      const x = -30 + (i % 16) * 4;
      return {
        position: [x, -2.3, 1007],
        end: [x, -2.3, 1200],
        color: i % 3 === 0 ? 0xf4fbff : 0x49d9ff,
        size: range(0.08, 0.2),
        speed: range(0.35, 0.7)
      };
    });

    const outputMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uFog: fogUniform
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vDistance;

        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vDistance = length(mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFog;
        varying vec2 vUv;
        varying float vDistance;

        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          vec2 pixel = floor(vUv * vec2(180.0,108.0));
          vec2 local = fract(vUv * vec2(180.0,108.0));
          float pixelMask =
            smoothstep(0.02,0.12,local.x) *
            smoothstep(0.02,0.12,local.y);

          float wave =
            sin(p.x * 5.0 + uTime * 0.35) *
            cos(p.y * 4.0 - uTime * 0.26);

          float ring = exp(
            -abs(length(p * vec2(1.55,1.0)) -
            (0.52 + wave * 0.08)) * 18.0
          );

          float stripe = pow(
            0.5 + 0.5 * sin(pixel.x * 0.05 + pixel.y * 0.08 - uTime),
            8.0
          );

          vec3 color = mix(
            vec3(0.01,0.16,0.32),
            vec3(0.2,0.02,0.42),
            0.5 + 0.5 * wave
          );

          color += ring * vec3(0.16,0.8,1.1);
          color += stripe * vec3(0.06,0.14,0.21);
          color *= pixelMask;
          color *= exp(-uFog * uFog * vDistance * vDistance);

          gl_FragColor = vec4(color,1.0);
        }
      `
    });

    const display = new THREE.Mesh(
      new THREE.PlaneGeometry(94, 56),
      outputMaterial
    );
    display.rotation.y = Math.PI;
    display.position.set(0, 38, 1290);
    graphics.add(display);

    // Draw a crisp message directly onto the final display.
    const messageCanvas = document.createElement("canvas");
    messageCanvas.width = 1880;
    messageCanvas.height = 1120;

    const messageContext = messageCanvas.getContext("2d");

    // Leave the surrounding display animation visible.
    messageContext.clearRect(
      0,
      0,
      messageCanvas.width,
      messageCanvas.height
    );

    // Dark backing keeps the message readable over the animated screen.
    messageContext.fillStyle = "rgba(0, 0, 0, 0.88)";
    messageContext.fillRect(80, 330, 1720, 460);

    messageContext.strokeStyle = "rgba(140, 225, 255, 0.65)";
    messageContext.lineWidth = 3;
    messageContext.strokeRect(80, 330, 1720, 460);

    messageContext.font =
      'bold 132px Menlo, Consolas, "Liberation Mono", monospace';
    messageContext.textAlign = "center";
    messageContext.textBaseline = "middle";
    messageContext.fillStyle = "#ffffff";

    messageContext.fillText(
      "The princess is in",
      messageCanvas.width / 2,
      460
    );

    messageContext.fillText(
      "another castle.",
      messageCanvas.width / 2,
      640
    );

    const messageTexture = new THREE.CanvasTexture(messageCanvas);
    messageTexture.encoding = THREE.sRGBEncoding;
    messageTexture.minFilter = THREE.LinearFilter;
    messageTexture.magFilter = THREE.LinearFilter;
    messageTexture.generateMipmaps = false;

    const messageMaterial = new THREE.MeshBasicMaterial({
      map: messageTexture,
      color: 0xd9d9d9,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      side: THREE.FrontSide
    });

    const messagePanel = new THREE.Mesh(
      new THREE.PlaneGeometry(94, 56),
      messageMaterial
    );

    // Face the approaching camera and sit just ahead of the display.
    messagePanel.rotation.y = Math.PI;
    messagePanel.position.set(0, 38, 1289.7);
    messagePanel.renderOrder = 2;

    graphics.add(messagePanel);

    box(graphics, 100, 3, 4, 0, 8.5, 1292, materials.graphite);
    box(graphics, 100, 3, 4, 0, 67.5, 1292, materials.graphite);
    box(graphics, 3, 62, 4, -49, 38, 1292, materials.graphite);
    box(graphics, 3, 62, 4, 49, 38, 1292, materials.graphite);

    function fitText(context, text, width, initialSize) {
      let size = initialSize;
      do {
        context.font =
          `${size}px Menlo, Consolas, "Liberation Mono", monospace`;
        if (context.measureText(text).width <= width) break;
        size -= 1;
      } while (size > 12);
    }

    function addLabel(title, subtitle, color, position) {
      const canvas = document.createElement("canvas");
      canvas.width = 1536;
      canvas.height = 300;

      const context = canvas.getContext("2d");
      context.fillStyle = "rgba(3,8,17,0.91)";
      context.fillRect(0, 0, 1536, 300);
      context.strokeStyle = "rgba(160,195,224,0.32)";
      context.lineWidth = 2;
      context.strokeRect(1, 1, 1534, 298);
      context.fillStyle = color;
      context.fillRect(0, 0, 5, 300);
      context.textBaseline = "middle";

      fitText(context, title, 1430, 66);
      context.fillStyle = color;
      context.fillText(title, 48, 110);

      fitText(context, subtitle, 1430, 31);
      context.fillStyle = "#b1bed1";
      context.fillText(subtitle, 48, 217);

      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: canvasTexture(canvas, true),
          transparent: true,
          opacity: 0,
          sizeAttenuation: false,
          depthTest: false,
          depthWrite: false,
          fog: false,
          toneMapped: false
        })
      );

      sprite.position.set(...position);
      sprite.frustumCulled = false;
      sprite.renderOrder = 1000;
      annotationScene.add(sprite);
      labels.push(sprite);
    }

    addLabel(
      "12V Rail Stable",
      "ILLUSTRATIVE REFERENCE  •  POWER DELIVERY",
      "#ffe19b",
      [0, 17, 35]
    );

    addLabel(
      "SATA Link Active",
      "6 Gb/s INTERFACE  •  ILLUSTRATIVE TELEMETRY",
      "#a4ffd4",
      [-35, 13, 159]
    );

    addLabel(
      "Optical Read / Laser Pickup",
      "EXPANDED MECHANICAL CUTAWAY",
      "#ffadad",
      [30, 13, 230]
    );

    addLabel(
      "NVMe Read: 7000 MB/s",
      "PCIe 4.0 ×4  •  ILLUSTRATIVE SEQUENTIAL READ",
      "#ffe3bf",
      [0, 12, 333]
    );

    addLabel(
      "Chipset / I/O Routing Fabric",
      "SCHEMATIC ROUTE  •  CPU-DIRECT LINKS ALSO EXIST",
      "#d6ecff",
      [0, 13, 550]
    );

    addLabel(
      "RAM: DDR5 dual-channel XMP",
      "DDR5-6000 EXAMPLE  •  2 CHANNELS / 128-BIT DATA",
      "#b8f8ff",
      [0, 64, 712]
    );

    addLabel(
      "CPU Core 0: 5.2 GHz",
      "ILLUSTRATIVE REFERENCE  •  0.192 ns / CLOCK CYCLE",
      "#e4bdff",
      [0, 11, 930]
    );

    addLabel(
      "PCIe 5.0 ×16 / Graphics",
      "32 GT/s PER LANE  •  APPROX. 63 GB/s PER DIRECTION",
      "#c5efff",
      [0, 29, 1125]
    );

    addLabel(
      "Frame Buffer → Display",
      "HARDWARE TRANSIT COMPLETE",
      "#dbf5ff",
      [0, 71, 1290]
    );

    /*
      Reference specifications; all displayed operating telemetry is illustrative.

      SATA naming:
      https://sata-io.org/developers/sata-naming-guidelines

      Example 7000 MB/s PCIe Gen 4 NVMe drive:
      https://image-us.samsung.com/SamsungUS/samsungbusiness/pdfs/datasheet/2021_980_PRO_Data_Sheet_Final_Files.pdf

      PCIe 5.0 signaling:
      https://pcisig.com/what-bit-rates-does-pcie-50-specification-support-and-how-does-it-compare-prior-pcie-generations

      PCIe x16 one-way rate after 128b/130b encoding:
      32e9 × 16 × (128 / 130) / 8 ≈ 63.015 GB/s, before packet overhead.

      DDR5-6000 denotes 6000 MT/s, with a 3.00 GHz I/O clock.
      Four DIMMs do not imply four memory channels.
    */

    const stages = [
      {
        title: "Power & Intake",
        description: "Nominal 12 V delivery through an expanded PSU cutaway.",
        rateLabel: "Rail voltage",
        rate: "12.00 V DC",
        interface: "Power delivery",
        clock: "DC supply",
        width: "Power conductors",
        temperature: 38,
        accent: "#ffc65a",
        caption: "POWER DELIVERY / 12 V RAIL"
      },
      {
        title: "HDD & Optical",
        description: "Mechanical storage, reflective platters and laser pickup.",
        rateLabel: "Link signaling",
        rate: "6 Gb/s",
        interface: "SATA",
        clock: "7,200 RPM HDD",
        width: "Serial link",
        temperature: 35,
        accent: "#73ffc1",
        caption: "MECHANICAL STORAGE / SATA INTERFACE"
      },
      {
        title: "NVMe / NAND",
        description: "An expanded flash-cell lattice and an example Gen 4 drive.",
        rateLabel: "Example read rate",
        rate: "7,000 MB/s",
        interface: "PCIe 4.0 ×4 / NVMe",
        clock: "Controller-dependent",
        width: "4 PCIe lanes",
        temperature: 46,
        accent: "#ffb679",
        caption: "NONVOLATILE FLASH / NAND CELL ARRAY"
      },
      {
        title: "PCB & Chipset",
        description: "Copper traces and a schematic I/O routing fabric.",
        rateLabel: "Routing mode",
        rate: "Concurrent I/O",
        interface: "Chipset fabric",
        clock: "Platform-dependent",
        width: "Multiple links",
        temperature: 48,
        accent: "#ffd291",
        caption: "MOTHERBOARD TRACES / I/O ROUTING"
      },
      {
        title: "DDR5 Memory",
        description: "Four physical DIMMs in an illustrative dual-channel setup.",
        rateLabel: "Transfer rate",
        rate: "6,000 MT/s",
        interface: "DDR5 / XMP example",
        clock: "3.00 GHz I/O",
        width: "2 channels / 128-bit",
        temperature: 42,
        accent: "#75eaff",
        caption: "VOLATILE SYSTEM MEMORY / DDR5 CANYON"
      },
      {
        title: "CPU Logic",
        description: "10,000 animated interconnects across an enlarged die.",
        rateLabel: "Clock period",
        rate: "0.192 ns / cycle",
        interface: "On-die interconnect",
        clock: "5.20 GHz core",
        width: "64-bit ISA example",
        temperature: 64,
        accent: "#d38eff",
        caption: "CPU DIE / LOGIC AND ON-DIE INTERCONNECTS"
      },
      {
        title: "PCIe & Graphics",
        description: "A Gen 5 link, GPU cutaway and procedural display output.",
        rateLabel: "Lane signaling",
        rate: "32 GT/s / lane",
        interface: "PCIe 5.0 ×16",
        clock: "2.50 GHz GPU example",
        width: "16 PCIe lanes",
        temperature: 59,
        accent: "#a3deff",
        caption: "GRAPHICS TRANSIT / FRAME BUFFER OUTPUT"
      }
    ];

    const pathPoints = [
      [0,8,-48],
      [0,8,-20],
      [0,5,20],
      [0,5,60],
      [0,5,90],
      [-35,4,150],
      [-35,4,180],
      [30,5,215],
      [30,5,245],
      [0,3,275],
      [0,3,320],
      [0,3,360],
      [-25,3,415],
      [25,3,445],
      [-25,3,475],
      [20,4,520],
      [-8,5,570],
      [0,8,605],
      [0,45,625],
      [0,56,665],
      [0,45,730],
      [0,12,785],
      [0,4,825],
      [0,4,900],
      [0,4,975],
      [0,6,1030],
      [0,10,1110],
      [0,18,1180],
      [0,24,1215]
    ].map((p) => new THREE.Vector3(...p));

    const flightPath = new THREE.CatmullRomCurve3(
      pathPoints, false, "centripetal"
    );
    flightPath.arcLengthDivisions = 4096;
    flightPath.updateArcLengths();

    const pathLength = flightPath.getLength();
    const boundaries = [100, 250, 400, 600, 800, 1000];
    const stageSpeeds = [8, 10, 7, 18, 8, 6, 18];

    function speedAtZ(z) {
      let speed = stageSpeeds[0];
      for (let i = 0; i < boundaries.length; i++) {
        const transition = smoothstep(
          boundaries[i] - 15,
          boundaries[i] + 15,
          z
        );
        speed += (stageSpeeds[i + 1] - stageSpeeds[i]) * transition;
      }
      return speed;
    }

    // Integrate travel time over equal arc-length samples, preserving
    // continuous forward speed while slowing near dense components.
    const tableSize = 4096;
    const timeTable = new Float64Array(tableSize + 1);
    const samplePoint = new THREE.Vector3();

    flightPath.getPointAt(0, samplePoint);
    let previousSpeed = speedAtZ(samplePoint.z);

    for (let i = 1; i <= tableSize; i++) {
      flightPath.getPointAt(i / tableSize, samplePoint);
      const speed = speedAtZ(samplePoint.z);
      const distance = pathLength / tableSize;

      timeTable[i] =
        timeTable[i - 1] + distance * 2 / (previousSpeed + speed);

      previousSpeed = speed;
    }

    const travelDuration = timeTable[tableSize];
    const cycleDuration = travelDuration + 10;

    function parameterAtTime(time) {
      if (time <= 0) return 0;
      if (time >= travelDuration) return 1;

      let low = 0;
      let high = tableSize;

      while (low + 1 < high) {
        const middle = (low + high) >> 1;
        if (timeTable[middle] <= time) low = middle;
        else high = middle;
      }

      const blend =
        (time - timeTable[low]) / (timeTable[high] - timeTable[low]);

      return (low + blend) / tableSize;
    }

    const aimingCamera = new THREE.PerspectiveCamera();
    aimingCamera.up.set(0, 1, 0);

    const desiredPosition = new THREE.Vector3();
    const desiredQuaternion = new THREE.Quaternion();
    const lookTarget = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const forward = new THREE.Vector3();
    const resumePosition = new THREE.Vector3();
    const resumeQuaternion = new THREE.Quaternion();

    function sampleCamera(parameter) {
      flightPath.getPointAt(parameter, desiredPosition);

      if (parameter < 0.999) {
        flightPath.getPointAt(
          Math.min(1, parameter + 6 / pathLength),
          lookTarget
        );
      } else {
        flightPath.getTangentAt(1, tangent);
        lookTarget.copy(desiredPosition).addScaledVector(tangent, 6);
      }

      aimingCamera.position.copy(desiredPosition);
      aimingCamera.lookAt(lookTarget);
      desiredQuaternion.copy(aimingCamera.quaternion);
    }

    sampleCamera(0);
    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);
    camera.updateMatrixWorld(true);

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: renderTextureType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });
    target.texture.encoding = THREE.LinearEncoding;
    target.texture.generateMipmaps = false;

    const composer = new THREE.EffectComposer(renderer, target);
    composer.addPass(new THREE.RenderPass(scene, camera));

    const bloom = new THREE.UnrealBloomPass(
      new THREE.Vector2(256, 256),
      0.72,
      0.5,
      hdrAvailable ? 1.1 : 0.87
    );

    for (const renderTarget of [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ]) {
      renderTarget.texture.type = renderTextureType;
      renderTarget.texture.encoding = THREE.LinearEncoding;
    }

    composer.addPass(bloom);

    const grade = new THREE.ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 0.96 },
        uFade: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position =
            projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uFade;
        varying vec2 vUv;

        vec3 filmic(vec3 x) {
          return clamp(
            (x * (2.51 * x + 0.03)) /
            (x * (2.43 * x + 0.59) + 0.14),
            0.0,
            1.0
          );
        }

        vec3 toDisplay(vec3 x) {
          vec3 low = x * 12.92;
          vec3 high =
            1.055 * pow(max(x,vec3(0.0)),vec3(1.0/2.4)) - 0.055;
          return mix(low,high,step(vec3(0.0031308),x));
        }

        void main() {
          vec3 color = texture2D(tDiffuse,vUv).rgb * uExposure;
          color = toDisplay(filmic(color));

          vec2 p = vUv * 2.0 - 1.0;
          float vignette =
            1.0 - 0.12 * smoothstep(0.3,1.8,dot(p,p));

          gl_FragColor = vec4(
            color * vignette * (1.0-uFade),
            1.0
          );
        }
      `
    });
    composer.addPass(grade);

    const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
    composer.addPass(fxaa);

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let mode = "auto";
    let paused = reducedMotion;
    let uiHidden = false;
    let contextLost = false;
    let visualTime = 0;
    let flightTime = 0;
    let cycleNumber = 0;
    let resumeElapsed = 1.8;
    let lastFrameTime = null;
    let nextUiUpdate = 0;
    let activeStage = -1;
    let pixelRatio = 1;
    let resizePending = false;

    const drawingSize = new THREE.Vector2();
    const projected = new THREE.Vector3();

    function syncControlsTarget() {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      controls.target.copy(camera.position).addScaledVector(forward, 20);
    }

    syncControlsTarget();

    /*
      Camera ownership is exclusive:
      - Automated mode writes the pose and never calls controls.update().
      - Manual mode delegates the pose to OrbitControls.
      - A real PerspectiveCamera supplies lookAt orientation.

      r128 reset() also clears the active gesture state:
      https://github.com/mrdoob/three.js/blob/r128/examples/js/controls/OrbitControls.js
    */
    function clearControlMotion() {
      const position = camera.position.clone();
      const quaternion = camera.quaternion.clone();
      const damping = controls.enableDamping;

      controls.enableDamping = false;
      controls.saveState();
      controls.reset();

      camera.position.copy(position);
      camera.quaternion.copy(quaternion);
      syncControlsTarget();

      controls.enableDamping = damping;
      camera.updateMatrixWorld(true);
    }

    function announceMode() {
      ui.mode.textContent = mode === "manual"
        ? (paused ? "MANUAL / PAUSED" : "MANUAL / R TO RESUME")
        : (paused ? "TRANSIT PAUSED" : "AUTO TRANSIT");
    }

    function resumeTransit() {
      clearControlMotion();
      resumePosition.copy(camera.position);
      resumeQuaternion.copy(camera.quaternion);
      resumeElapsed = 0;
      mode = "auto";
      paused = false;
      lastFrameTime = null;
      announceMode();
    }

    function restartTransit() {
      clearControlMotion();

      flightTime = 0;
      visualTime = 0;
      cycleNumber = 0;
      resumeElapsed = 1.8;
      mode = "auto";
      paused = false;
      lastFrameTime = null;

      sampleCamera(0);
      camera.position.copy(desiredPosition);
      camera.quaternion.copy(desiredQuaternion);
      syncControlsTarget();
      camera.updateMatrixWorld(true);

      grade.uniforms.uFade.value = 0;
      announceMode();
    }

    controls.addEventListener("start", () => {
      if (mode === "auto") syncControlsTarget();
      mode = "manual";
      resumeElapsed = 1.8;
      announceMode();
    });

    renderer.domElement.addEventListener("pointerdown", () => {
      renderer.domElement.focus({ preventScroll: true });
    });

    window.addEventListener("keydown", (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

      const targetElement = event.target;
      if (
        targetElement instanceof HTMLElement &&
        (
          targetElement.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(targetElement.tagName)
        )
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        paused = !paused;
        lastFrameTime = null;
        announceMode();
      } else if (event.code === "KeyR") {
        event.preventDefault();
        resumeTransit();
      } else if (event.code === "Home") {
        event.preventDefault();
        restartTransit();
      } else if (event.code === "KeyH") {
        event.preventDefault();
        uiHidden = !uiHidden;
        panel.setAttribute("aria-hidden", String(uiHidden));
      }
    });

    function resize() {
      resizePending = false;

      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();

      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);

      renderer.getDrawingBufferSize(drawingSize);

      fxaa.material.uniforms.resolution.value.set(
        1 / drawingSize.x,
        1 / drawingSize.y
      );

      bloom.setSize(
        Math.max(32, Math.floor(drawingSize.x * 0.66)),
        Math.max(32, Math.floor(drawingSize.y * 0.66))
      );

      const tanHalfFov = Math.tan(
        THREE.MathUtils.degToRad(camera.fov * 0.5)
      );

      pointScaleUniform.value = drawingSize.y / (2 * tanHalfFov);

      const pixelWidth = Math.min(355, width * 0.82);
      const normalizedWidth = 2 * tanHalfFov * pixelWidth / height;

      for (const sprite of labels) {
        sprite.scale.set(
          normalizedWidth,
          normalizedWidth * 300 / 1536,
          1
        );
      }
    }

    window.addEventListener("resize", () => {
      if (!resizePending) {
        resizePending = true;
        requestAnimationFrame(resize);
      }
    });

    renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      contextLost = true;
      lastFrameTime = null;
      notice.hidden = false;
      notice.textContent =
        "Graphics context paused. Waiting for restoration.";
    });

    renderer.domElement.addEventListener("webglcontextrestored", () => {
      contextLost = false;
      lastFrameTime = null;
      resize();
      notice.hidden = true;
    });

    document.addEventListener("visibilitychange", () => {
      lastFrameTime = null;
    });

    function stageAtZ(z) {
      let index = 0;
      while (index < boundaries.length && z >= boundaries[index]) {
        index += 1;
      }
      return index;
    }

    function updateInterface(now, parameter) {
      if (now < nextUiUpdate) return;
      nextUiUpdate = now + 180;

      const index = stageAtZ(camera.position.z);
      const stage = stages[index];

      if (index !== activeStage) {
        activeStage = index;
        document.documentElement.style.setProperty("--accent", stage.accent);

        ui.number.textContent = `${String(index + 1).padStart(2, "0")} / 07`;
        ui.title.textContent = stage.title;
        ui.description.textContent = stage.description;
        ui.rateLabel.textContent = stage.rateLabel;
        ui.rate.textContent = stage.rate;
        ui.interface.textContent = stage.interface;
        ui.clock.textContent = stage.clock;
        ui.width.textContent = stage.width;
        ui.caption.textContent = stage.caption;

        for (const row of ui.rows) {
          const selected = Number(row.dataset.stage) === index;
          row.dataset.active = String(selected);

          if (selected) row.setAttribute("aria-current", "step");
          else row.removeAttribute("aria-current");
        }
      }

      const temperature =
        stage.temperature +
        Math.sin(visualTime * 0.28 + index) * 0.8 +
        Math.sin(visualTime * 0.1) * 0.35;

      ui.temperature.textContent = `${temperature.toFixed(1)} °C`;
      ui.progress.textContent = `${(parameter * 100).toFixed(1)}%`;
      ui.progressFill.style.transform = `scaleX(${parameter})`;

      if (Math.min(window.devicePixelRatio || 1, 2) !== pixelRatio) {
        resize();
      }
    }

    function updateLabels(fade) {
      for (const sprite of labels) {
        const distance = sprite.position.distanceTo(camera.position);
        const nearFade = smoothstep(8, 22, distance);
        const farFade = 1 - smoothstep(95, 160, distance);

        projected.copy(sprite.position).project(camera);

        const visible =
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 1.15 &&
          Math.abs(projected.y) < 1.15;

        sprite.material.opacity =
          uiHidden || !visible
            ? 0
            : nearFade * farFade * (1 - fade);

        sprite.visible = sprite.material.opacity > 0.002;
      }
    }

    function frame(now) {
      requestAnimationFrame(frame);

      if (contextLost || document.hidden) {
        lastFrameTime = null;
        return;
      }

      const delta = lastFrameTime === null
        ? 0
        : Math.min((now - lastFrameTime) / 1000, 0.05);

      lastFrameTime = now;
      let wrapped = false;

      if (!paused) {
        visualTime += delta;

        if (mode === "auto") {
          if (resumeElapsed < 1.8) {
            resumeElapsed = Math.min(1.8, resumeElapsed + delta);
          } else {
            flightTime += delta;

            if (flightTime >= cycleDuration) {
              flightTime -= cycleDuration;
              cycleNumber += 1;
              wrapped = true;
            }
          }
        }
      }

      const parameter = parameterAtTime(flightTime);
      sampleCamera(parameter);

      if (mode === "auto") {
        if (resumeElapsed < 1.8) {
          const blend = smootherstep(resumeElapsed / 1.8);

          camera.position.lerpVectors(
            resumePosition, desiredPosition, blend
          );
          camera.quaternion.slerpQuaternions(
            resumeQuaternion, desiredQuaternion, blend
          );
        } else {
          camera.position.copy(desiredPosition);

          if (wrapped || delta === 0) {
            camera.quaternion.copy(desiredQuaternion);
          } else if (!paused) {
            camera.quaternion.slerp(
              desiredQuaternion,
              1 - Math.exp(-9 * delta)
            );
          }
        }

        syncControlsTarget();

        // Never call controls.update() here: the flight rig owns the camera.
      } else {
        controls.dampingFactor =
          1 - Math.exp(-4.8 * Math.max(delta, 1 / 240));
        controls.update();
      }

      camera.updateMatrixWorld(true);
      timeUniform.value = visualTime;

      for (const animate of animators) animate(visualTime);

      for (const entry of stageMaterials) {
        const proximity = Math.exp(
          -Math.abs(camera.position.z - entry.z) / 120
        );
        entry.material.emissiveIntensity =
          entry.intensity * (0.55 + proximity * 1.1);
      }

      let fade = 0;

      if (mode === "auto") {
        fade = smoothstep(
          travelDuration + 5,
          cycleDuration,
          flightTime
        );

        if (cycleNumber > 0) {
          fade = Math.max(
            fade,
            1 - smoothstep(0, 3.5, flightTime)
          );
        }
      }

      grade.uniforms.uFade.value = fade;
      const uiOpacity = uiHidden ? 0 : 1 - fade;
      panel.style.opacity = String(uiOpacity);
      caption.style.opacity = String(uiOpacity);

      updateLabels(fade);
      updateInterface(now, parameter);

      renderer.setRenderTarget(null);
      composer.render(delta);

      // Annotation textures are composited after bloom for readable lettering.
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(annotationScene, camera);
    }

    // Retain the generated environment target for the lifetime of the scene.
    scene.userData.environmentTarget = environmentTarget;

    resize();
    announceMode();
    notice.hidden = true;
    requestAnimationFrame(frame);
  }
})();