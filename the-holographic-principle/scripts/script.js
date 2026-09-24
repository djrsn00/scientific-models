// script.js
(() => {
  "use strict";

  const notice = document.getElementById("render-notice");
  const THREE = window.THREE;

  const dependencies = [
    "OrbitControls",
    "EffectComposer",
    "RenderPass",
    "ShaderPass",
    "UnrealBloomPass",
    "FXAAShader"
  ];

  if (!THREE || dependencies.some((name) => !THREE[name])) {
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
      "The WebGL visualization could not initialize. Check that browser graphics acceleration is enabled.";
  }

  function initialize() {
    const container = document.getElementById("canvas-container");
    const panel = document.getElementById("info-panel");
    const modeReadout = document.getElementById("flight-mode");
    const cameraReadout = document.getElementById("camera-distance");
    const layerRows = Array.from(document.querySelectorAll("[data-layer]"));

    const TAU = Math.PI * 2;
    const HORIZON_RADIUS = 30;
    const CYCLE_SECONDS = 132;
    const RESUME_SECONDS = 1.8;
    const BOARD_WIDTH = 300;
    const BOARD_HEIGHT = 192;
    const BOARD_Z = 350;
    const FINAL_CAMERA_Z = 125;

    const clamp01 = (value) => Math.max(0, Math.min(1, value));

    function smoothstep(start, end, value) {
      const t = clamp01((value - start) / (end - start));
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

    const random = seededRandom(0x484f4c4f);

    function gaussian() {
      const u = Math.max(1e-7, random());
      const v = random();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.002);

    const annotationScene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      54,
      window.innerWidth / Math.max(window.innerHeight, 1),
      0.03,
      1600
    );

    camera.position.set(0, 0, 0);
    camera.up.set(0, 1, 0);
    camera.quaternion.identity();

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      precision: "highp",
      stencil: false,
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
      "Interactive black hole information visualization"
    );
    renderer.domElement.setAttribute("aria-describedby", "control-help");
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.45;
    controls.zoomSpeed = 0.65;
    controls.panSpeed = 0.6;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.08;
    controls.maxDistance = 900;
    controls.minPolarAngle = 0.015;
    controls.maxPolarAngle = Math.PI - 0.015;
    controls.autoRotate = false;
    controls.target.set(0, 0, -20);

    // The camera starts exactly at the origin, facing its local negative Z.
    camera.position.set(0, 0, 0);
    camera.quaternion.identity();
    camera.updateMatrixWorld(true);

    const gl = renderer.getContext();
    const pointSizeLimit = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    const hdrAvailable =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("EXT_color_buffer_float");

    const textureType = hdrAvailable
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    function linearColor(hex) {
      return new THREE.Color(hex).convertSRGBToLinear();
    }

    function makeCanvasTexture(canvas, srgb = false) {
      const texture = new THREE.CanvasTexture(canvas);
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;
      texture.encoding = srgb
        ? THREE.sRGBEncoding
        : THREE.LinearEncoding;
      return texture;
    }

    function makeParticleTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;

      const context = canvas.getContext("2d");
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);

      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.12, "rgba(255,255,255,0.98)");
      gradient.addColorStop(0.3, "rgba(255,255,255,0.45)");
      gradient.addColorStop(0.65, "rgba(255,255,255,0.075)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);
      return makeCanvasTexture(canvas);
    }

    const shared = {
      uTime: { value: 0 },
      uDepth: { value: 0 },
      uPointScale: { value: 1 },
      uMaxPointSize: { value: Math.min(96, pointSizeLimit) },
      uFog: { value: scene.fog.density },
      uSprite: { value: makeParticleTexture() },
      uViolet: { value: linearColor(0x4b0082) },
      uBlue: { value: linearColor(0x1268ff) },
      uOrange: { value: linearColor(0xff4500) },
      uGold: { value: linearColor(0xffb52e) },
      uCyan: { value: linearColor(0x48edff) }
    };

    const modelVisibility = { value: 1 };
    const diskReveal = { value: 0.14 };
    const horizonReveal = { value: 0 };
    const boundaryReveal = { value: 0 };
    const projectionVisibility = { value: 0 };
    const arcVisibility = { value: 0 };

    const pointVertexShader = `
      attribute vec4 aParam;
      attribute float aSize;
      attribute float aKind;

      uniform float uTime;
      uniform float uFamily;
      uniform float uPointScale;
      uniform float uMaxPointSize;

      varying float vSeed;
      varying float vKind;
      varying float vRadius;
      varying float vDistance;

      const float PI = 3.141592653589793;
      const float TAU = 6.283185307179586;

      void main() {
        vec3 p;
        float seed = aParam.w;

        if (uFamily < 0.5) {
          float radius = aParam.x;
          float arm = floor(seed * 5.0);
          float omega = 0.42 + 1.65 / (radius + 0.7);
          float angle = aParam.y + arm * TAU / 5.0 + uTime * omega;

          p = vec3(
            cos(angle) * radius,
            sin(angle) * radius,
            aParam.z + sin(angle * 1.4 + uTime * 0.9) * 0.32
          );
        } else if (uFamily < 1.5) {
          float radius = aParam.x;
          float omega = 0.17 + 0.65 * pow(42.0 / radius, 1.5);
          float angle = aParam.y + uTime * omega;
          float swell =
            sin(angle * 3.0 + radius * 0.16 - uTime * 0.8) * 0.24;

          p = vec3(
            cos(angle) * radius,
            aParam.z + swell,
            sin(angle) * radius
          );
        } else if (uFamily < 2.5) {
          float angle = aParam.y + uTime * 0.22;
          float radius = aParam.x + sin(angle * 4.0 + uTime) * 0.32;

          p = vec3(
            cos(angle) * radius,
            aParam.z + sin(angle * 2.0 + uTime * 0.6) * 1.3,
            sin(angle) * radius
          );
        } else {
          float angle = aParam.x * PI;
          p = vec3(
            -100.0 * sin(angle) + aParam.y,
            aParam.z + sin(uTime * 0.4 + seed * TAU) * 0.7,
            108.0 - 100.0 * cos(angle) + sin(seed * 51.0) * 2.0
          );
        }

        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        float worldScale = length(modelMatrix[0].xyz);

        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = clamp(
          aSize * worldScale * uPointScale / max(0.08, -mvPosition.z),
          1.0,
          uMaxPointSize
        );

        vSeed = seed;
        vKind = aKind;
        vRadius = aParam.x;
        vDistance = length(mvPosition.xyz);
      }
    `;

    const pointFragmentShader = `
      uniform sampler2D uSprite;
      uniform float uTime;
      uniform float uDepth;
      uniform float uFog;
      uniform float uFamily;
      uniform float uVisibility;
      uniform float uReveal;
      uniform float uHologram;

      uniform vec3 uViolet;
      uniform vec3 uBlue;
      uniform vec3 uOrange;
      uniform vec3 uGold;
      uniform vec3 uCyan;

      varying float vSeed;
      varying float vKind;
      varying float vRadius;
      varying float vDistance;

      void main() {
        vec2 centered = gl_PointCoord * 2.0 - 1.0;
        float radiusSquared = dot(centered, centered);
        if (radiusSquared > 1.0) discard;

        float sprite = texture2D(uSprite, gl_PointCoord).a;
        float hotCenter = exp(-radiusSquared * 42.0);
        float pulse = 0.83 + 0.17 * sin(uTime * 2.0 + vSeed * 43.0);

        vec3 color;

        if (uFamily < 0.5) {
          color = mix(uViolet, uBlue, 0.2 + 0.8 * vSeed) * 3.6;
          color += vec3(0.2, 0.38, 0.9) * hotCenter * 1.7;
          color = mix(
            color,
            color * vec3(1.05, 0.72, 0.78),
            smoothstep(0.1, 0.7, uDepth) * 0.35
          );
        } else if (uFamily < 1.5) {
          float heat = clamp(
            (88.0 - vRadius) / 46.0 + 0.25 * sin(vSeed * 28.0),
            0.0,
            1.0
          );
          color = mix(uOrange, uGold, heat) * 3.4;
          color += vec3(1.2, 0.65, 0.16) * hotCenter;
          color *= mix(
            vec3(1.0, 0.9, 0.92),
            vec3(1.12, 0.72, 0.48),
            uDepth
          );
        } else if (uFamily < 2.5) {
          color = mix(uBlue, uGold, vSeed) * 2.4;
          color += uCyan * hotCenter * 0.7;
        } else {
          color = mix(uCyan, vec3(0.84, 0.97, 1.0), vSeed) * 1.8;
        }

        vec3 projectedColor =
          mix(uCyan * 2.2, vec3(1.6, 1.8, 2.0), hotCenter);

        color = mix(color, projectedColor, uHologram * 0.78);

        float alpha = sprite * mix(0.84, 0.045, vKind);
        float fogTransmission =
          exp(-uFog * uFog * vDistance * vDistance);

        alpha *= uVisibility * uReveal * fogTransmission;
        if (alpha < 0.001) discard;

        gl_FragColor = vec4(color * pulse, alpha);
      }
    `;

    function createParticleField(count, family, reveal, visibility) {
      const positions = new Float32Array(count * 3);
      const parameters = new Float32Array(count * 4);
      const sizes = new Float32Array(count);
      const kinds = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const seed = random();
        let radius;
        let angle;
        let height;
        let size;
        let kind;
        let x;
        let y;
        let z;

        if (family === 0) {
          const theta = 0.25 + Math.pow(random(), 1.25) * 32;
          radius = 0.285 * theta;
          angle = theta;
          height = gaussian() * 1.1 + Math.sin(theta * 0.7) * 2.6;
          kind = random() < 0.065 ? 1 : 0;
          size = kind ? 0.45 + random() * 0.8 : 0.025 + random() * 0.13;

          const initialAngle = angle + Math.floor(seed * 5) * TAU / 5;
          x = Math.cos(initialAngle) * radius;
          y = Math.sin(initialAngle) * radius;
          z = height;
        } else if (family === 1) {
          radius = 42 + Math.pow(random(), 0.65) * 46;
          angle =
            Math.floor(seed * 6) * TAU / 6 +
            Math.log(radius / 42) * 6.5 +
            gaussian() * 0.16;

          kind = random() < 0.19 ? 1 : 0;
          height = gaussian() * (kind ? 2.2 : 0.55);
          size = kind ? 1.2 + random() * 3.8 : 0.08 + random() * 0.32;

          x = Math.cos(angle) * radius;
          y = height;
          z = Math.sin(angle) * radius;
        } else if (family === 2) {
          radius = 32.2 + random() * 8;
          angle = random() * TAU;
          height = Math.sin(angle * 3 + seed * 4) * (3 + random() * 7);
          kind = random() < 0.1 ? 1 : 0;
          size = kind ? 1 + random() * 1.4 : 0.05 + random() * 0.12;

          x = Math.cos(angle) * radius;
          y = height;
          z = Math.sin(angle) * radius;
        } else {
          radius = random();
          angle = gaussian() * 2.5;
          height = gaussian() * 9;
          kind = 0;
          size = 0.1 + random() * 0.3;

          x = -100 * Math.sin(radius * Math.PI) + angle;
          y = height;
          z = 108 - 100 * Math.cos(radius * Math.PI);
        }

        positions.set([x, y, z], i * 3);
        parameters.set([radius, angle, height, seed], i * 4);
        sizes[i] = size;
        kinds[i] = kind;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aParam", new THREE.BufferAttribute(parameters, 4));
      geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
      geometry.setAttribute("aKind", new THREE.BufferAttribute(kinds, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uFamily: { value: family },
          uVisibility: visibility,
          uReveal: reveal,
          uHologram: { value: 0 }
        },
        vertexShader: pointVertexShader,
        fragmentShader: pointFragmentShader,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false
      });

      const field = new THREE.Points(geometry, material);
      field.frustumCulled = false;
      return field;
    }

    const modelRoot = new THREE.Group();
    scene.add(modelRoot);

    const core = createParticleField(
      4800, 0, { value: 1 }, modelVisibility
    );
    core.name = "singularity-vortex";
    modelRoot.add(core);

    const disk = createParticleField(
      6800, 1, diskReveal, modelVisibility
    );
    disk.name = "exterior-accretion-flux";
    modelRoot.add(disk);

    const corona = createParticleField(
      1400, 2, diskReveal, modelVisibility
    );
    corona.name = "horizon-corona";
    modelRoot.add(corona);

    // An exterior opaque mask gives the black hole a black silhouette.
    // Its front faces are culled naturally while the virtual camera is inside.
    const horizonMask = new THREE.Mesh(
      new THREE.SphereGeometry(HORIZON_RADIUS - 0.04, 96, 64),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        side: THREE.FrontSide,
        depthWrite: true,
        fog: false
      })
    );

    horizonMask.name = "opaque-horizon-mask";
    modelRoot.add(horizonMask);

    const horizonMaterial = new THREE.ShaderMaterial({
      uniforms: {
        ...shared,
        uReveal: horizonReveal,
        uVisibility: modelVisibility,
        uHologram: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPosition;
        varying float vDistance;

        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewPosition = -mvPosition.xyz;
          vDistance = length(mvPosition.xyz);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uFog;
        uniform float uReveal;
        uniform float uVisibility;
        uniform float uHologram;
        uniform vec3 uGold;
        uniform vec3 uCyan;

        varying vec2 vUv;
        varying vec3 vNormalView;
        varying vec3 vViewPosition;
        varying float vDistance;

        void main() {
          // Distort the luminous coordinates, preserving the radius-30 sphere.
          vec2 warped = vUv;
          warped.x += 0.0018 *
            sin(vUv.y * 44.0 + uTime * 0.48) *
            sin(vUv.x * 31.0 - uTime * 0.22);
          warped.y += 0.0014 *
            cos(vUv.x * 38.0 - uTime * 0.36);

          vec2 coordinates = warped * vec2(80.0, 40.0);
          vec2 cellDistance =
            abs(fract(coordinates - 0.5) - 0.5);
          vec2 antialiasWidth = max(fwidth(coordinates), vec2(0.0001));
          vec2 lineCoverage =
            1.0 - smoothstep(
              vec2(0.2),
              vec2(1.2),
              cellDistance / antialiasWidth
            );

          float grid = max(lineCoverage.x, lineCoverage.y);
          float fresnel = pow(
            1.0 - abs(dot(
              normalize(vNormalView),
              normalize(vViewPosition)
            )),
            3.0
          );

          float wave = 0.65 + 0.35 *
            sin(vUv.x * 72.0 + vUv.y * 24.0 - uTime * 1.1);

          vec3 tint = mix(uGold, uCyan, uHologram);
          vec3 color = tint * (1.6 + wave + fresnel * 1.4);

          float alpha =
            (0.012 + grid * (0.27 + 0.2 * wave) + fresnel * 0.22) *
            uReveal * uVisibility;

          alpha *= exp(-uFog * uFog * vDistance * vDistance);
          if (alpha < 0.001) discard;

          gl_FragColor = vec4(color, alpha);
        }
      `,
      extensions: { derivatives: true },
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(HORIZON_RADIUS, 128, 96),
      horizonMaterial
    );
    horizon.name = "spherical-information-horizon";
    modelRoot.add(horizon);

    const presentationRoot = new THREE.Group();
    presentationRoot.position.set(0, 0, BOARD_Z);
    presentationRoot.rotation.y = Math.PI;
    scene.add(presentationRoot);

    const glyphs = "01ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789+-*/=<>[]{}():;";

    function createGlyphAtlas() {
      const canvas = document.createElement("canvas");
      canvas.width = 1024;
      canvas.height = 512;

      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#ffffff";
      context.font = '44px Menlo, Consolas, "Liberation Mono", monospace';
      context.textAlign = "center";
      context.textBaseline = "middle";

      for (let index = 0; index < 128; index++) {
        const column = index % 16;
        const row = Math.floor(index / 16);
        context.fillText(
          glyphs[index % glyphs.length],
          column * 64 + 32,
          row * 64 + 33
        );
      }

      return makeCanvasTexture(canvas);
    }

    const surfaceVertexShader = `
      varying vec2 vUv;
      varying float vDistance;

      void main() {
        vUv = uv;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vDistance = length(mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const matrixMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uFog: shared.uFog,
        uReveal: boundaryReveal,
        uAtlas: { value: createGlyphAtlas() },
        uGlyphCount: { value: glyphs.length }
      },
      vertexShader: surfaceVertexShader,
      fragmentShader: `
        uniform float uTime;
        uniform float uFog;
        uniform float uReveal;
        uniform float uGlyphCount;
        uniform sampler2D uAtlas;

        varying vec2 vUv;
        varying float vDistance;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        void main() {
          if (uReveal < 0.002) discard;

          vec2 grid = vec2(144.0, 88.0);
          vec2 coordinates = vUv * grid;
          vec2 cell = floor(coordinates);
          vec2 local = fract(coordinates);

          float columnSeed = hash(vec2(cell.x, 17.0));
          float tick = floor(uTime * (1.4 + columnSeed * 3.0));
          vec2 address = vec2(
            cell.x,
            mod(cell.y + tick, grid.y)
          );

          float selector = hash(address);
          float symbol;

          if (selector < 0.7) {
            symbol = floor(hash(address + 7.3) * 2.0);
          } else {
            symbol = 2.0 +
              floor(hash(address + 19.1) * (uGlyphCount - 2.0));
          }

          float column = mod(symbol, 16.0);
          float row = floor(symbol / 16.0);

          vec2 tileUv = local * 0.86 + 0.07;
          vec2 atlasUv =
            (vec2(column, 7.0 - row) + tileUv) / vec2(16.0, 8.0);

          float glyph = texture2D(uAtlas, atlasUv).a;
          float trailPosition =
            fract(vUv.y + uTime * (0.018 + columnSeed * 0.025) + columnSeed);
          float trail = exp(-trailPosition * 9.0);
          float twinkle = 0.85 + 0.15 *
            sin(uTime * 0.9 + hash(cell) * 40.0);

          float brightness = (0.12 + trail * 0.68) * twinkle;
          vec3 tint = mix(
            vec3(0.10, 0.69, 0.81),
            vec3(0.84, 0.93, 1.0),
            smoothstep(0.25, 0.85, trail)
          );

          vec2 edgeDistance = min(local, 1.0 - local);
          vec2 aa = max(fwidth(coordinates), vec2(0.0001));
          float fineGrid =
            1.0 - smoothstep(0.0, 0.8, min(
              edgeDistance.x / aa.x,
              edgeDistance.y / aa.y
            ));

          vec3 color = vec3(0.0008, 0.0024, 0.0035);
          color += vec3(0.004, 0.012, 0.018) * fineGrid;
          color += tint * glyph * brightness;

          color *= exp(-uFog * uFog * vDistance * vDistance);
          gl_FragColor = vec4(color, uReveal);
        }
      `,
      extensions: { derivatives: true },
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide
    });

    const matrixPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(BOARD_WIDTH, BOARD_HEIGHT),
      matrixMaterial
    );
    matrixPlane.renderOrder = -5;
    presentationRoot.add(matrixPlane);

    function fitText(context, text, maxWidth, initialSize) {
      let size = initialSize;
      do {
        context.font =
          `${size}px Menlo, Consolas, "Liberation Mono", monospace`;
        if (context.measureText(text).width <= maxWidth) break;
        size -= 1;
      } while (size > 12);
    }

    function makeTextCanvas(title, subtitle, color, width = 2048, height = 256) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d");
      context.fillStyle = "rgba(2, 8, 15, 0.91)";
      context.fillRect(0, 0, width, height);

      context.strokeStyle = "rgba(130, 209, 226, 0.33)";
      context.lineWidth = 2;
      context.strokeRect(1, 1, width - 2, height - 2);

      context.fillStyle = color;
      context.fillRect(0, 0, 5, height);

      context.textAlign = "left";
      context.textBaseline = "middle";
      fitText(context, title, width - 100, 62);
      context.fillStyle = color;
      context.fillText(title, 46, height * 0.37);

      fitText(context, subtitle, width - 100, 31);
      context.fillStyle = "#a9c2d0";
      context.fillText(subtitle, 46, height * 0.73);

      return canvas;
    }

    function addInscription(title, subtitle, y, speed, color = "#bdfaff") {
      const texture = makeCanvasTexture(
        makeTextCanvas(title, subtitle, color)
      );
      texture.wrapS = THREE.RepeatWrapping;

      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: texture },
          uTime: shared.uTime,
          uReveal: boundaryReveal,
          uSpeed: { value: speed }
        },
        vertexShader: surfaceVertexShader,
        fragmentShader: `
          uniform sampler2D uMap;
          uniform float uTime;
          uniform float uReveal;
          uniform float uSpeed;
          varying vec2 vUv;

          void main() {
            vec2 sampleUv = vec2(
              fract(vUv.x + uTime * uSpeed),
              vUv.y
            );
            vec4 ink = texture2D(uMap, sampleUv);
            if (ink.a * uReveal < 0.002) discard;
            gl_FragColor = vec4(ink.rgb * 0.78, ink.a * uReveal);
          }
        `,
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.FrontSide
      });

      const inscription = new THREE.Mesh(
        new THREE.PlaneGeometry(280, 19),
        material
      );
      inscription.position.set(0, y, 0.2);
      inscription.renderOrder = 2;
      presentationRoot.add(inscription);
    }

    addInscription(
      "BEKENSTEIN BOUNDARY / INFORMATION LIMIT",
      "AREA ENCODING  •  12,672 SAMPLED SYMBOLS  •  CONCEPTUAL BOUNDARY SURFACE",
      82,
      0,
      "#e5faff"
    );

    addInscription(
      "S_BH / k_B = A_H / (4 ℓ_P²)",
      "BEKENSTEIN–HAWKING ENTROPY  •  ℓ_P² = ℏG / c³",
      54,
      0.007,
      "#d5faff"
    );

    addInscription(
      "A_H = 4πr_s²     r_s = 2GM / c²",
      "SPHERICAL SCHWARZSCHILD REFERENCE  •  r_s = 30 km",
      -54,
      -0.005,
      "#ffe2a6"
    );

    addInscription(
      "N_bits = S_BH / (k_B ln 2)",
      "BOUNDARY INFORMATION  →  SCHEMATIC BULK RECONSTRUCTION",
      -82,
      0.006,
      "#c3faff"
    );

    const borderGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-150, -96, 0.35),
      new THREE.Vector3(150, -96, 0.35),
      new THREE.Vector3(150, 96, 0.35),
      new THREE.Vector3(-150, 96, 0.35)
    ]);

    const borderMaterial = new THREE.LineBasicMaterial({
      color: 0x69ecff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true
    });

    presentationRoot.add(
      new THREE.LineLoop(borderGeometry, borderMaterial)
    );

    // The projected model shares geometry, while each material has its own
    // visibility and hologram tint. Time and texture uniforms remain shared.
    const hologram = modelRoot.clone(true);
    hologram.name = "boundary-reconstruction";

    hologram.traverse((object) => {
      if (object.name === "opaque-horizon-mask") {
        object.visible = false;
        return;
      }

      if (!object.material) return;

      object.material = object.material.clone();

      if (object.material.uniforms) {
        const uniforms = object.material.uniforms;

        for (const key of Object.keys(shared)) {
          if (key in uniforms) {
            uniforms[key] = shared[key];
          }
        }

        uniforms.uVisibility = projectionVisibility;
        uniforms.uHologram = { value: 1 };

        if (uniforms.uReveal) {
          uniforms.uReveal = { value: 1 };
        }
      }
    });

    hologram.position.set(58, -2, 65);
    hologram.scale.setScalar(0.34);
    hologram.rotation.set(0.55, 0, -0.25);
    presentationRoot.add(hologram);

    const rayPositions = [];
    const raySeeds = [];

    for (let i = 0; i < 84; i++) {
      const sourceX = -135 + random() * 260;
      const sourceY = -41 + random() * 82;
      const targetX = 58 + gaussian() * 8;
      const targetY = -2 + gaussian() * 5;
      const targetZ = 65 + gaussian() * 5;

      rayPositions.push(
        sourceX, sourceY, 0.6,
        targetX, targetY, targetZ
      );

      const seed = random();
      raySeeds.push(seed, seed);
    }

    const rayGeometry = new THREE.BufferGeometry();
    rayGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(rayPositions, 3)
    );
    rayGeometry.setAttribute(
      "aSeed",
      new THREE.Float32BufferAttribute(raySeeds, 1)
    );

    const rayMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uReveal: projectionVisibility
      },
      vertexShader: `
        attribute float aSeed;
        varying float vSeed;
        varying float vDepth;

        void main() {
          vSeed = aSeed;
          vDepth = position.z / 80.0;
          gl_Position =
            projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uReveal;
        varying float vSeed;
        varying float vDepth;

        void main() {
          float pulse = 0.55 + 0.45 *
            sin(uTime * 0.7 + vSeed * 26.0 - vDepth * 5.0);
          gl_FragColor = vec4(
            vec3(0.13, 0.86, 1.0),
            (0.025 + pulse * 0.08) * uReveal
          );
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });

    presentationRoot.add(
      new THREE.LineSegments(rayGeometry, rayMaterial)
    );

    // This illuminated arc remains in view throughout the half-turn.
    const pivotArc = createParticleField(
      1500, 3, { value: 1 }, arcVisibility
    );
    scene.add(pivotArc);

    const labels = [];

    function createLabel(title, subtitle, color, position, kind) {
      const canvas = makeTextCanvas(
        title, subtitle, color, 1536, 320
      );

      const material = new THREE.SpriteMaterial({
        map: makeCanvasTexture(canvas, true),
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: false,
        fog: false,
        toneMapped: false
      });

      const sprite = new THREE.Sprite(material);
      sprite.position.copy(position);
      sprite.renderOrder = 1000;
      sprite.frustumCulled = false;
      annotationScene.add(sprite);

      const label = {
        sprite,
        kind,
        localAnchor: position.clone(),
        aspect: canvas.width / canvas.height
      };

      labels.push(label);
      return label;
    }

    createLabel(
      "Singularity Origin: Volume → 0",
      "SYMBOLIC CLASSICAL LIMIT  •  INTERIOR SCHEMATIC",
      "#c4b1ff",
      new THREE.Vector3(0, 1.8, -8),
      "core"
    );

    createLabel(
      "Event Horizon: A_H = 4πr_s²",
      "r_s = 30 km  •  SPHERICAL REFERENCE GEOMETRY",
      "#ffe1a0",
      new THREE.Vector3(0, 10, 0),
      "horizon"
    );

    createLabel(
      "Bekenstein Boundary: Information Limit",
      "S_BH / k_B = A_H / (4 ℓ_P²)",
      "#c7fbff",
      new THREE.Vector3(-66, 12, 20),
      "boundary"
    );

    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: textureType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    renderTarget.texture.encoding = THREE.LinearEncoding;
    renderTarget.texture.generateMipmaps = false;

    const composer = new THREE.EffectComposer(renderer, renderTarget);
    composer.addPass(new THREE.RenderPass(scene, camera));

    const bloom = new THREE.UnrealBloomPass(
      new THREE.Vector2(256, 256),
      0.88,
      0.65,
      hdrAvailable ? 1.1 : 0.86
    );

    const bloomTargets = [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ];

    for (const target of bloomTargets) {
      target.texture.type = textureType;
      target.texture.encoding = THREE.LinearEncoding;
    }

    composer.addPass(bloom);

    const grade = new THREE.ShaderPass({
      uniforms: {
        tDiffuse: { value: null },
        uExposure: { value: 0.92 },
        uFade: { value: 0 }
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position =
            projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uFade;
        varying vec2 vUv;

        vec3 filmic(vec3 color) {
          return clamp(
            (color * (2.51 * color + 0.03)) /
            (color * (2.43 * color + 0.59) + 0.14),
            0.0,
            1.0
          );
        }

        vec3 linearToDisplay(vec3 color) {
          vec3 low = color * 12.92;
          vec3 high =
            1.055 * pow(max(color, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055;
          return mix(low, high, step(vec3(0.0031308), color));
        }

        void main() {
          vec3 color = texture2D(tDiffuse, vUv).rgb * uExposure;
          color = linearToDisplay(filmic(color));

          vec2 centered = vUv * 2.0 - 1.0;
          float vignette =
            1.0 - 0.15 * smoothstep(0.25, 1.7, dot(centered, centered));

          gl_FragColor = vec4(
            color * vignette * (1.0 - uFade),
            1.0
          );
        }
      `
    });

    composer.addPass(grade);

    const fxaa = new THREE.ShaderPass(THREE.FXAAShader);
    composer.addPass(fxaa);

    /*
      Physics:
      [Bekenstein–Hawking entropy](https://www.scholarpedia.org/article/Bekenstein-Hawking_entropy)
      [The World as a Hologram](https://arxiv.org/abs/hep-th/9409089)
      [Black hole anatomy](https://science.nasa.gov/universe/black-holes/anatomy/)

      The reference radius is 30 km. Entropy is fixed by that radius.
      The screen and projection are explanatory geometry, not a physical
      surface asserted to exist around a Schwarzschild black hole.
    */
    const SPEED_OF_LIGHT = 299792458;
    const GRAVITATIONAL_CONSTANT = 6.67430e-11;
    const REDUCED_PLANCK_CONSTANT = 1.054571817e-34;
    const physicalRadius = HORIZON_RADIUS * 1000;

    const planckLengthSquared =
      REDUCED_PLANCK_CONSTANT * GRAVITATIONAL_CONSTANT /
      Math.pow(SPEED_OF_LIGHT, 3);

    const horizonArea = 4 * Math.PI * physicalRadius * physicalRadius;
    const dimensionlessEntropy = horizonArea / (4 * planckLengthSquared);
    const informationBits = dimensionlessEntropy / Math.log(2);

    function scientific(value) {
      const [mantissa, exponent] = value.toExponential(3).split("e");
      return `${mantissa} × 10<sup>${Number(exponent)}</sup>`;
    }

    document.getElementById("metric-area").innerHTML =
      `${scientific(horizonArea)} <span class="unit">m²</span>`;

    document.getElementById("metric-entropy").innerHTML =
      scientific(dimensionlessEntropy);

    document.getElementById("metric-bits").innerHTML =
      `${scientific(informationBits)} <span class="unit">bits</span>`;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let mode = "auto";
    let paused = reducedMotion;
    let uiHidden = false;
    let contextLost = false;
    let flightTime = 0;
    let visualTime = 0;
    let cycleNumber = 0;
    let resumeElapsed = RESUME_SECONDS;
    let lastFrameTime = null;
    let nextInterfaceUpdate = 0;
    let pixelRatio = 1;
    let resizePending = false;

    const desiredPosition = new THREE.Vector3();
    const desiredQuaternion = new THREE.Quaternion();
    const resumePosition = new THREE.Vector3();
    const resumeQuaternion = new THREE.Quaternion();
    const forward = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const projectedLabel = new THREE.Vector3();
    const drawingSize = new THREE.Vector2();

    function syncControlsTarget() {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      controls.target.copy(camera.position).addScaledVector(forward, 20);
    }

    /*
      Camera handoff follows the r128 interaction lifecycle:
      [OrbitControls r128](https://github.com/mrdoob/three.js/blob/r128/examples/js/controls/OrbitControls.js)

      reset() with damping disabled clears both residual motion and the
      private active-gesture state. Restore the visible pose immediately.
    */
    function clearControlMotion() {
      const savedPosition = camera.position.clone();
      const savedQuaternion = camera.quaternion.clone();
      const savedDamping = controls.enableDamping;

      controls.enableDamping = false;
      controls.saveState();
      controls.reset();

      camera.position.copy(savedPosition);
      camera.quaternion.copy(savedQuaternion);
      syncControlsTarget();

      controls.enableDamping = savedDamping;
      camera.updateMatrixWorld(true);
    }

    function sampleFlight(time) {
      let z;
      let pivot = 0;

      if (time < 24) {
        z = 12 * smootherstep(time / 24);
      } else if (time < 54) {
        z = 12 + 30 * smootherstep((time - 24) / 30);
      } else if (time < 72) {
        z = 42 + 48 * smootherstep((time - 54) / 18);
      } else {
        pivot = smootherstep((time - 72) / 18);
        z = 90 + 35 * pivot;
      }

      desiredPosition.set(0, 0, z);

      // Camera forward is -Z. A direct Y quaternion avoids Object3D's
      // opposite lookAt convention and finishes facing +Z toward the board.
      desiredQuaternion.setFromAxisAngle(yAxis, Math.PI * pivot);
      return pivot;
    }

    function announceMode() {
      if (mode === "manual") {
        modeReadout.textContent = paused
          ? "MANUAL VIEW · ANIMATION PAUSED"
          : "MANUAL VIEW · R RESUMES FLIGHT";
      } else {
        modeReadout.textContent = paused
          ? "FLIGHT PAUSED · SPACE OR R"
          : "AUTOMATED SCALE-OUT";
      }
    }

    function resumeFlight() {
      clearControlMotion();

      resumePosition.copy(camera.position);
      resumeQuaternion.copy(camera.quaternion);
      resumeElapsed = 0;
      mode = "auto";
      paused = false;
      lastFrameTime = null;
      announceMode();
    }

    function restartFlight() {
      clearControlMotion();

      flightTime = 0;
      visualTime = 0;
      cycleNumber = 0;
      resumeElapsed = RESUME_SECONDS;
      mode = "auto";
      paused = false;
      lastFrameTime = null;

      camera.position.set(0, 0, 0);
      camera.quaternion.identity();
      syncControlsTarget();
      camera.updateMatrixWorld(true);

      grade.uniforms.uFade.value = 0;
      announceMode();
    }

    controls.addEventListener("start", () => {
      if (mode === "auto") {
        syncControlsTarget();
      }

      mode = "manual";
      resumeElapsed = RESUME_SECONDS;
      announceMode();
    });

    renderer.domElement.addEventListener("pointerdown", () => {
      renderer.domElement.focus({ preventScroll: true });
    });

    window.addEventListener("keydown", (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
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
        resumeFlight();
      } else if (event.code === "Home") {
        event.preventDefault();
        restartFlight();
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

      // Bloom uses a smaller working resolution; the scene and text remain
      // at the full stabilized display resolution.
      bloom.setSize(
        Math.max(32, Math.floor(drawingSize.x * 0.7)),
        Math.max(32, Math.floor(drawingSize.y * 0.7))
      );

      const halfFovTangent = Math.tan(
        THREE.MathUtils.degToRad(camera.fov * 0.5)
      );

      shared.uPointScale.value =
        drawingSize.y / (2 * halfFovTangent);

      // Fit the explanatory surface on portrait and landscape displays.
      // This changes the presentation surface, not the horizon's radius.
      const availableHeight =
        2 * (BOARD_Z - FINAL_CAMERA_Z) * halfFovTangent;

      const boardScale = Math.min(
        1,
        availableHeight / (BOARD_HEIGHT * 1.1),
        availableHeight * camera.aspect / (BOARD_WIDTH * 1.1)
      );

      presentationRoot.scale.setScalar(boardScale);

      for (const label of labels) {
        const pixelWidth = Math.min(355, width * 0.82);
        const normalizedWidth =
          2 * halfFovTangent * pixelWidth / height;

        label.sprite.scale.set(
          normalizedWidth,
          normalizedWidth / label.aspect,
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
      notice.textContent = "Graphics context paused. Waiting for restoration.";
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

    function updateLabels(cameraRadius, pivot, fade) {
      presentationRoot.updateMatrixWorld(true);

      for (const label of labels) {
        let visibility;

        if (label.kind === "core") {
          visibility = 1 - smoothstep(8, 23, cameraRadius);
        } else if (label.kind === "horizon") {
          visibility =
            smoothstep(13, 26, cameraRadius) *
            (1 - smoothstep(94, 135, cameraRadius)) *
            (1 - smoothstep(0.1, 0.65, pivot));
        } else {
          label.sprite.position
            .copy(label.localAnchor)
            .applyMatrix4(presentationRoot.matrixWorld);
          visibility = smoothstep(0.78, 1, pivot);
        }

        const distance = label.sprite.position.distanceTo(camera.position);
        const nearFade = smoothstep(1.5, 4, distance);
        const farFade = 1 - smoothstep(430, 700, distance);

        projectedLabel.copy(label.sprite.position).project(camera);

        const inFront =
          projectedLabel.z > -1 &&
          projectedLabel.z < 1 &&
          Math.abs(projectedLabel.x) < 1.2 &&
          Math.abs(projectedLabel.y) < 1.2;

        label.sprite.material.opacity =
          uiHidden || !inFront
            ? 0
            : visibility * nearFade * farFade * (1 - fade);

        label.sprite.visible = label.sprite.material.opacity > 0.002;
      }
    }

    function updateInterface(now, cameraRadius, pivot) {
      if (now < nextInterfaceUpdate) return;
      nextInterfaceUpdate = now + 200;

      cameraReadout.innerHTML =
        `${(cameraRadius / HORIZON_RADIUS).toFixed(3)} r<sub>s</sub>`;

      let layer = 0;

      if (pivot > 0.05) {
        layer = 3;
      } else if (cameraRadius >= 22 && cameraRadius <= 42) {
        layer = 2;
      } else if (cameraRadius > 10) {
        layer = 1;
      }

      for (const row of layerRows) {
        const active = Number(row.dataset.layer) === layer;
        row.dataset.active = String(active);

        if (active) {
          row.setAttribute("aria-current", "step");
        } else {
          row.removeAttribute("aria-current");
        }
      }

      if (Math.min(window.devicePixelRatio || 1, 2) !== pixelRatio) {
        resize();
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

      if (!paused) {
        visualTime += delta;

        if (mode === "auto") {
          if (resumeElapsed < RESUME_SECONDS) {
            resumeElapsed = Math.min(
              RESUME_SECONDS,
              resumeElapsed + delta
            );
          } else {
            flightTime += delta;

            if (flightTime >= CYCLE_SECONDS) {
              flightTime -= CYCLE_SECONDS;
              cycleNumber += 1;
            }
          }
        }
      }

      const pivot = sampleFlight(flightTime);

      if (mode === "auto") {
        if (resumeElapsed < RESUME_SECONDS) {
          const blend = smootherstep(resumeElapsed / RESUME_SECONDS);
          camera.position.lerpVectors(
            resumePosition, desiredPosition, blend
          );
          camera.quaternion.slerpQuaternions(
            resumeQuaternion, desiredQuaternion, blend
          );
        } else {
          camera.position.copy(desiredPosition);
          camera.quaternion.copy(desiredQuaternion);
        }

        syncControlsTarget();

        // OrbitControls.update() intentionally does not run in this branch.
        // The automated rig is the sole writer of the camera pose.
      } else {
        controls.dampingFactor =
          1 - Math.exp(-4.8 * Math.max(delta, 1 / 240));
        controls.update();
      }

      camera.updateMatrixWorld(true);

      const cameraRadius = camera.position.length();

      shared.uTime.value = visualTime;
      shared.uDepth.value = clamp01(cameraRadius / FINAL_CAMERA_Z);

      diskReveal.value =
        0.14 + 0.86 * smoothstep(4, 18, cameraRadius);

      horizonReveal.value = smoothstep(13, 27, cameraRadius);

      boundaryReveal.value = smoothstep(0.18, 0.9, pivot);
      projectionVisibility.value = smoothstep(0.5, 1, pivot) * 0.92;
      arcVisibility.value = Math.sin(Math.PI * pivot) * 0.86;

      modelVisibility.value = mode === "manual"
        ? 1
        : 1 - smoothstep(0.28, 0.98, pivot);

      modelRoot.visible = modelVisibility.value > 0.002;
      presentationRoot.visible = boundaryReveal.value > 0.002;
      pivotArc.visible = arcVisibility.value > 0.002;

      borderMaterial.opacity = boundaryReveal.value * 0.68;
      hologram.rotation.y = visualTime * 0.065;

      let fade = 0;

      if (mode === "auto") {
        fade = smoothstep(118, CYCLE_SECONDS, flightTime);

        if (cycleNumber > 0) {
          fade = Math.max(
            fade,
            1 - smoothstep(0, 5, flightTime)
          );
        }
      }

      grade.uniforms.uFade.value = fade;
      panel.style.opacity = String(uiHidden ? 0 : 1 - fade);

      updateLabels(cameraRadius, pivot, fade);
      updateInterface(now, cameraRadius, pivot);

      renderer.setRenderTarget(null);
      composer.render(delta);

      // Draw annotation textures after bloom so their lettering stays sharp.
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(annotationScene, camera);
    }

    resize();
    announceMode();
    notice.hidden = true;
    requestAnimationFrame(frame);
  }
})();