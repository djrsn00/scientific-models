/* script.js */
(async () => {
  "use strict";

  /*
   * Scientific references:
   * https://arxiv.org/pdf/1312.2007
   * https://arxiv.org/pdf/1410.0621
   * https://arxiv.org/pdf/0903.2110
   * https://link.springer.com/article/10.1007/BF01329800
   *
   * The jewel is an artistic geometric proxy, not a computed amplituhedron.
   * The lattice morph is an emergence metaphor, not a quantum-gravity solver.
   */

  const dom = {
    container: document.getElementById("canvas-container"),
    status: document.getElementById("render-status"),
    panel: document.getElementById("info-panel"),
    facets: document.getElementById("facet-count"),
    particles: document.getElementById("particle-count"),
    state: document.getElementById("emergence-state"),
    percent: document.getElementById("emergence-percent"),
    fill: document.getElementById("emergence-fill"),
    meter: document.getElementById("emergence-meter"),
    cameraState: document.getElementById("camera-state"),
    flightButton: document.getElementById("flight-button"),
    pauseButton: document.getElementById("pause-button"),
    resetButton: document.getElementById("reset-button"),
    panelButton: document.getElementById("panel-button")
  };

  let stopAnimation = () => {};

  function showStatus(message) {
    dom.status.hidden = false;
    dom.status.replaceChildren();

    const paragraph = document.createElement("p");
    paragraph.textContent = message;
    dom.status.appendChild(paragraph);
  }

  try {
    const modules = await Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/ShaderPass.js"),
      import("three/addons/shaders/FXAAShader.js"),
      import("three/addons/postprocessing/OutputPass.js"),
      import("three/addons/environments/RoomEnvironment.js")
    ]);

    const THREE = modules[0];
    const { OrbitControls } = modules[1];
    const { EffectComposer } = modules[2];
    const { RenderPass } = modules[3];
    const { UnrealBloomPass } = modules[4];
    const { ShaderPass } = modules[5];
    const { FXAAShader } = modules[6];
    const { OutputPass } = modules[7];
    const { RoomEnvironment } = modules[8];

    const CONFIG = Object.freeze({
      background: 0x020208,
      fogDensity: 0.0025,
      jewelRadius: 15.6,
      jewelDetail: 10,
      latticeHalfCount: 12,
      latticeInnerIndex: 9,
      latticeSpacing: 3.4,
      cycleDuration: 62,
      sourceInnerRadius: 22,
      sourceOuterRadius: 61,
      seed: 13122007
    });

    const scene = new THREE.Scene();
    const labelScene = new THREE.Scene();

    scene.background = new THREE.Color(CONFIG.background);
    scene.fog = new THREE.FogExp2(0x020208, 0.0025);

    const camera = new THREE.PerspectiveCamera(
      48,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.05,
      1400
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      precision: "highp",
      depth: true,
      stencil: false
    });

    if (!renderer.extensions.has("EXT_color_buffer_float")) {
      renderer.dispose();
      showStatus("This visualization requires WebGL2 with floating-point color-buffer support.");
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    renderer.domElement.tabIndex = 0;
    renderer.domElement.setAttribute("role", "img");
    renderer.domElement.setAttribute(
      "aria-label",
      "Cinematic amplituhedron illustration. Drag to orbit, scroll to zoom, Space to pause, R to resume cinematic orbit, and H to toggle the scientific panel."
    );

    dom.container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.065;
    controls.rotateSpeed = 0.42;
    controls.zoomSpeed = 0.72;
    controls.panSpeed = 0.6;
    controls.screenSpacePanning = true;
    controls.minDistance = 7;
    controls.maxDistance = 320;

    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };

    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    renderer.domElement.addEventListener("pointerdown", () => {
      renderer.domElement.focus({ preventScroll: true });
    });

    renderer.domElement.addEventListener("contextmenu", event => {
      event.preventDefault();
    });

    const timeUniform = { value: 0 };
    const cycleUniform = { value: 0 };
    const fogUniform = { value: CONFIG.fogDensity };
    const pointScaleUniform = { value: 1 };
    const subjectNDCUniform = { value: new THREE.Vector2() };
    const violetUniform = { value: new THREE.Color(0x4b0082) };
    const orangeUniform = { value: new THREE.Color(0xff4500) };

    const gl = renderer.getContext();
    const maximumPointSize = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1];
    const pointMaximumUniform = { value: Math.min(56, maximumPointSize) };

    let environmentTarget = null;

    function rebuildEnvironment() {
      const environment = new RoomEnvironment();
      const generator = new THREE.PMREMGenerator(renderer);
      const nextTarget = generator.fromScene(environment, 0.055);

      scene.environment = nextTarget.texture;

      if (environmentTarget) {
        environmentTarget.dispose();
      }

      environmentTarget = nextTarget;
      environment.dispose();
      generator.dispose();
    }

    rebuildEnvironment();

    scene.add(new THREE.AmbientLight(0x6f67b8, 0.3));

    const warmLight = new THREE.DirectionalLight(0xffcc9d, 3.8);
    warmLight.position.set(35, 45, 28);
    scene.add(warmLight);

    const violetLight = new THREE.DirectionalLight(0x9f72ff, 2.7);
    violetLight.position.set(-35, 18, -30);
    scene.add(violetLight);

    const coreLight = new THREE.PointLight(0xff8e4f, 220, 55, 2);
    scene.add(coreLight);

    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    target.texture.generateMipmaps = false;

    const composer = new EffectComposer(renderer, target);
    composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.82,
      0.64,
      0.78
    );

    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    const fxaa = new ShaderPass(FXAAShader);
    composer.addPass(fxaa);

    function seededRandom(seed) {
      let state = seed >>> 0;

      return () => {
        state += 0x6D2B79F5;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
      };
    }

    const random = seededRandom(CONFIG.seed);

    function randomDirection() {
      const y = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(1 - y * y);

      return new THREE.Vector3(
        Math.cos(angle) * radius,
        y,
        Math.sin(angle) * radius
      );
    }

    function smoother(value) {
      const t = THREE.MathUtils.clamp(value, 0, 1);
      return t * t * t * (t * (t * 6 - 15) + 10);
    }

    function formationWeight(phase, delay) {
      if (phase < 8) return 0;
      if (phase < 40) return smoother((phase - 8 - delay) / (32 - delay));
      if (phase < 50) return 1;
      return 1 - smoother((phase - 50) / 12);
    }

    const formationGLSL = `
      float smoother(float value) {
        float t = clamp(value, 0.0, 1.0);
        return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
      }

      float formationWeight(float phase, float delay) {
        if (phase < 8.0) return 0.0;
        if (phase < 40.0) {
          return smoother((phase - 8.0 - delay) / (32.0 - delay));
        }
        if (phase < 50.0) return 1.0;
        return 1.0 - smoother((phase - 50.0) / 12.0);
      }
    `;

    const jewelGroup = new THREE.Group();
    scene.add(jewelGroup);

    /*
     * Each triangle has its own centroid, normal, phase, and barycentric
     * coordinates. The glass and its luminous edges share the same motion.
     */
    let jewelGeometry = new THREE.IcosahedronGeometry(
      CONFIG.jewelRadius,
      CONFIG.jewelDetail
    );

    if (jewelGeometry.index) {
      const nonIndexed = jewelGeometry.toNonIndexed();
      jewelGeometry.dispose();
      jewelGeometry = nonIndexed;
    }

    const jewelPositions = jewelGeometry.attributes.position;
    const point = new THREE.Vector3();

    for (let index = 0; index < jewelPositions.count; index++) {
      point.fromBufferAttribute(jewelPositions, index);

      const angle = point.y * 0.012;
      const x = point.x * Math.cos(angle) - point.z * Math.sin(angle);
      const z = point.x * Math.sin(angle) + point.z * Math.cos(angle);

      jewelPositions.setXYZ(index, x * 1.02, point.y * 1.34, z * 0.9);
    }

    jewelPositions.needsUpdate = true;
    jewelGeometry.computeVertexNormals();

    const facetCount = jewelPositions.count / 3;
    const centers = new Float32Array(jewelPositions.count * 3);
    const faceNormals = new Float32Array(jewelPositions.count * 3);
    const facePhases = new Float32Array(jewelPositions.count);
    const barycentric = new Float32Array(jewelPositions.count * 3);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const center = new THREE.Vector3();
    const faceNormal = new THREE.Vector3();
    const sideOne = new THREE.Vector3();
    const sideTwo = new THREE.Vector3();

    for (let face = 0; face < facetCount; face++) {
      const first = face * 3;

      a.fromBufferAttribute(jewelPositions, first);
      b.fromBufferAttribute(jewelPositions, first + 1);
      c.fromBufferAttribute(jewelPositions, first + 2);

      center.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      sideOne.subVectors(b, a);
      sideTwo.subVectors(c, a);
      faceNormal.crossVectors(sideOne, sideTwo).normalize();

      const phase =
        center.x * 0.17 + center.y * 0.23 + center.z * 0.11;

      for (let corner = 0; corner < 3; corner++) {
        const vertex = first + corner;

        center.toArray(centers, vertex * 3);
        faceNormal.toArray(faceNormals, vertex * 3);
        facePhases[vertex] = phase;
        barycentric[vertex * 3 + corner] = 1;
      }
    }

    jewelGeometry.setAttribute(
      "aCenter",
      new THREE.BufferAttribute(centers, 3)
    );

    jewelGeometry.setAttribute(
      "aFaceNormal",
      new THREE.BufferAttribute(faceNormals, 3)
    );

    jewelGeometry.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(facePhases, 1)
    );

    jewelGeometry.setAttribute(
      "aBarycentric",
      new THREE.BufferAttribute(barycentric, 3)
    );

    jewelGeometry.computeBoundingSphere();
    jewelGeometry.boundingSphere.radius += 1.5;

    dom.facets.textContent = facetCount.toLocaleString("en-US");

    const facetGLSL = `
      uniform float uTime;

      attribute vec3 aCenter;
      attribute vec3 aFaceNormal;
      attribute float aPhase;

      vec3 facetPosition(vec3 inputPosition) {
        float wave = 0.5 + 0.5 * sin(uTime * 0.65 + aPhase);
        float separation = 0.10 + 0.65 * wave * wave;

        return aCenter
             + (inputPosition - aCenter) * 0.982
             + aFaceNormal * separation;
      }
    `;

    const jewelMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.18,
      metalness: 0.08,
      transmission: 0.67,
      thickness: 0.9,
      ior: 1.52,
      attenuationColor: 0xd8b1ff,
      attenuationDistance: 12,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
      iridescence: 0.82,
      iridescenceIOR: 1.33,
      iridescenceThicknessRange: [100, 620],
      emissive: 0x000000,
      envMapIntensity: 1.25,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      flatShading: true
    });

    jewelMaterial.onBeforeCompile = shader => {
      shader.uniforms.uTime = timeUniform;
      shader.uniforms.uViolet = violetUniform;
      shader.uniforms.uOrange = orangeUniform;

      shader.vertexShader = `
        ${facetGLSL}
        varying vec3 vFacetNormal;
        varying float vFacetPhase;
      ` + shader.vertexShader;

      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `
          vec3 transformed = facetPosition(position);
          vFacetNormal = normalize(normalMatrix * aFaceNormal);
          vFacetPhase = aPhase;
        `
      );

      shader.fragmentShader = `
        uniform float uTime;
        uniform vec3 uViolet;
        uniform vec3 uOrange;
        varying vec3 vFacetNormal;
        varying float vFacetPhase;
      ` + shader.fragmentShader;

      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        `
          #include <color_fragment>

          vec3 facetN = normalize(vFacetNormal);
          vec3 viewDirection = normalize(vViewPosition);

          float facing = abs(dot(facetN, viewDirection));
          float grazing = pow(1.0 - clamp(facing, 0.0, 1.0), 0.62);

          float angularShift = 0.5 + 0.5 * sin(
            atan(viewDirection.z, viewDirection.x) * 1.4
            + vFacetPhase * 0.45
            + uTime * 0.12
          );

          float spectrum = clamp(
            0.10 + grazing * 0.64 + angularShift * 0.26,
            0.0,
            1.0
          );

          vec3 jewelHue = mix(uViolet, uOrange, spectrum);

          diffuseColor.rgb *= jewelHue;
          totalEmissiveRadiance += jewelHue
            * (0.18 + 0.48 * grazing);
        `
      );
    };

    jewelMaterial.customProgramCacheKey = () => {
      return "amplituhedron-faceted-glass-r170";
    };

    const jewel = new THREE.Mesh(jewelGeometry, jewelMaterial);
    jewel.name = "Conceptual amplituhedron jewel";
    jewel.renderOrder = 2;
    jewelGroup.add(jewel);

    const facetEdges = new THREE.Mesh(
      jewelGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: timeUniform,
          uViolet: violetUniform,
          uOrange: orangeUniform,
          uFogDensity: fogUniform
        },

        vertexShader: `
          ${facetGLSL}

          attribute vec3 aBarycentric;

          varying vec3 vBarycentric;
          varying vec3 vNormal;
          varying vec3 vView;
          varying float vPhase;
          varying float vDepth;

          void main() {
            vec3 displaced = facetPosition(position);
            vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);

            vBarycentric = aBarycentric;
            vNormal = normalize(normalMatrix * aFaceNormal);
            vView = -viewPosition.xyz;
            vPhase = aPhase;
            vDepth = max(0.0, -viewPosition.z);

            gl_Position = projectionMatrix * viewPosition;
          }
        `,

        fragmentShader: `
          precision highp float;

          uniform float uTime;
          uniform vec3 uViolet;
          uniform vec3 uOrange;
          uniform float uFogDensity;

          varying vec3 vBarycentric;
          varying vec3 vNormal;
          varying vec3 vView;
          varying float vPhase;
          varying float vDepth;

          void main() {
            vec3 derivative = max(fwidth(vBarycentric), vec3(0.00001));
            vec3 inside = smoothstep(
              vec3(0.0),
              derivative * 0.95,
              vBarycentric
            );

            float edge = 1.0 - min(inside.x, min(inside.y, inside.z));

            float facing = abs(dot(normalize(vNormal), normalize(vView)));
            float grazing = pow(1.0 - clamp(facing, 0.0, 1.0), 0.62);

            float sweep = 0.5 + 0.5 * sin(
              atan(vView.z, vView.x) * 1.4
              + vPhase * 0.45
              + uTime * 0.12
            );

            vec3 hue = mix(
              uViolet,
              uOrange,
              clamp(0.10 + grazing * 0.64 + sweep * 0.26, 0.0, 1.0)
            );

            float fog = exp(-pow(uFogDensity * vDepth, 2.0));

            gl_FragColor = vec4(
              hue * 3.3 + vec3(0.045, 0.008, 0.08),
              edge * 0.62 * fog
            );
          }
        `,

        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false
      })
    );

    facetEdges.name = "Synchronized emissive facet boundaries";
    facetEdges.renderOrder = 3;
    jewelGroup.add(facetEdges);

    const softPointFragment = `
      precision highp float;

      uniform float uFogDensity;

      varying vec3 vColor;
      varying float vOpacity;
      varying float vDepth;

      void main() {
        float radius = length(gl_PointCoord - 0.5) * 2.0;
        float aa = max(fwidth(radius), 0.02);
        float rim = 1.0 - smoothstep(1.0 - aa, 1.0, radius);

        float halo = exp(-5.0 * radius * radius);
        float core = exp(-48.0 * radius * radius);
        float fog = exp(-pow(uFogDensity * vDepth, 2.0));

        float alpha = rim * (0.48 * halo + core) * vOpacity * fog;

        if (alpha < 0.002) discard;

        gl_FragColor = vec4(
          vColor * (0.9 + 1.45 * core),
          alpha
        );
      }
    `;

    /*
     * A branching interior graph and moving edge packets visualize
     * schematic tree channels. No numerical amplitudes are inferred.
     */
    const coreNodes = [new THREE.Vector3()];
    const coreEdges = [];

    function addCoreNode(position, parent) {
      const index = coreNodes.length;
      coreNodes.push(position);
      coreEdges.push([parent, index]);
      return index;
    }

    for (let branch = 0; branch < 12; branch++) {
      const y = 1 - 2 * (branch + 0.5) / 12;
      const angle = branch * Math.PI * (3 - Math.sqrt(5));
      const radial = Math.sqrt(1 - y * y);

      const direction = new THREE.Vector3(
        radial * Math.cos(angle),
        y,
        radial * Math.sin(angle)
      );

      const parent = addCoreNode(
        direction.clone().multiplyScalar(3.6),
        0
      );

      for (let fork = 0; fork < 4; fork++) {
        const childDirection = direction.clone()
          .addScaledVector(randomDirection(), 0.5)
          .normalize();

        const child = addCoreNode(
          childDirection.clone().multiplyScalar(7.1),
          parent
        );

        for (let leaf = 0; leaf < 3; leaf++) {
          const leafDirection = childDirection.clone()
            .addScaledVector(randomDirection(), 0.38)
            .normalize();

          addCoreNode(leafDirection.multiplyScalar(11.5), child);
        }
      }
    }

    const corePositions = new Float32Array(coreNodes.length * 3);
    const coreSeeds = new Float32Array(coreNodes.length);

    for (let index = 0; index < coreNodes.length; index++) {
      coreNodes[index].toArray(corePositions, index * 3);
      coreSeeds[index] = random();
    }

    const coreGeometry = new THREE.BufferGeometry();

    coreGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(corePositions, 3)
    );

    coreGeometry.setAttribute(
      "aSeed",
      new THREE.BufferAttribute(coreSeeds, 1)
    );

    const corePoints = new THREE.Points(
      coreGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: timeUniform,
          uPointScale: pointScaleUniform,
          uPointMaximum: pointMaximumUniform,
          uFogDensity: fogUniform
        },

        vertexShader: `
          uniform float uTime;
          uniform float uPointScale;
          uniform float uPointMaximum;

          attribute float aSeed;

          varying vec3 vColor;
          varying float vOpacity;
          varying float vDepth;

          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vDepth = max(0.01, -viewPosition.z);

            float pulse = 0.5 + 0.5 * sin(uTime * 2.1 - aSeed * 12.0);

            vColor = mix(
              vec3(0.30, 0.72, 1.0),
              vec3(1.0, 0.64, 0.22),
              aSeed
            ) * (1.6 + pulse);

            vOpacity = 0.7 + 0.3 * pulse;

            gl_PointSize = clamp(
              (0.23 + pulse * 0.16) * uPointScale / vDepth,
              1.0,
              uPointMaximum
            );

            gl_Position = projectionMatrix * viewPosition;
          }
        `,

        fragmentShader: softPointFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );

    corePoints.renderOrder = 4;
    jewelGroup.add(corePoints);

    const coreLinePositions = [];
    const coreLineColors = [];

    for (const edge of coreEdges) {
      coreLinePositions.push(
        coreNodes[edge[0]].x,
        coreNodes[edge[0]].y,
        coreNodes[edge[0]].z,
        coreNodes[edge[1]].x,
        coreNodes[edge[1]].y,
        coreNodes[edge[1]].z
      );

      const color = new THREE.Color().lerpColors(
        new THREE.Color(0x73bfff),
        new THREE.Color(0xffc777),
        random()
      ).multiplyScalar(1.3);

      color.toArray(coreLineColors, coreLineColors.length);
      color.toArray(coreLineColors, coreLineColors.length);
    }

    const coreLineGeometry = new THREE.BufferGeometry();

    coreLineGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(coreLinePositions, 3)
    );

    coreLineGeometry.setAttribute(
      "color",
      new THREE.Float32BufferAttribute(coreLineColors, 3)
    );

    jewelGroup.add(new THREE.LineSegments(
      coreLineGeometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        depthWrite: false,
        toneMapped: false
      })
    ));

    const packetCount = coreEdges.length * 4;
    const packetStarts = new Float32Array(packetCount * 3);
    const packetEnds = new Float32Array(packetCount * 3);
    const packetPhases = new Float32Array(packetCount);

    for (let edge = 0; edge < coreEdges.length; edge++) {
      for (let packet = 0; packet < 4; packet++) {
        const index = edge * 4 + packet;
        const pair = coreEdges[edge];

        coreNodes[pair[0]].toArray(packetStarts, index * 3);
        coreNodes[pair[1]].toArray(packetEnds, index * 3);
        packetPhases[index] = packet / 4 + edge * 0.017;
      }
    }

    const packetGeometry = new THREE.BufferGeometry();

    packetGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(packetStarts, 3)
    );

    packetGeometry.setAttribute(
      "aEnd",
      new THREE.BufferAttribute(packetEnds, 3)
    );

    packetGeometry.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(packetPhases, 1)
    );

    const packets = new THREE.Points(
      packetGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: timeUniform,
          uPointScale: pointScaleUniform,
          uPointMaximum: pointMaximumUniform,
          uFogDensity: fogUniform
        },

        vertexShader: `
          uniform float uTime;
          uniform float uPointScale;
          uniform float uPointMaximum;

          attribute vec3 aEnd;
          attribute float aPhase;

          varying vec3 vColor;
          varying float vOpacity;
          varying float vDepth;

          void main() {
            float t = fract(uTime * 0.16 + aPhase);
            vec3 point = mix(position, aEnd, t);
            vec4 viewPosition = modelViewMatrix * vec4(point, 1.0);

            vDepth = max(0.01, -viewPosition.z);
            vColor = vec3(1.0, 0.83, 0.50) * 2.2;
            vOpacity = sin(t * 3.14159265);

            gl_PointSize = clamp(
              0.17 * uPointScale / vDepth,
              1.0,
              uPointMaximum
            );

            gl_Position = projectionMatrix * viewPosition;
          }
        `,

        fragmentShader: softPointFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );

    packets.frustumCulled = false;
    packets.renderOrder = 5;
    jewelGroup.add(packets);

    /*
     * The shell contains 25³ - 17³ = 10,712 distinct lattice sites.
     * Its axis half-extent is 40.8 scene units; corners reach about 70.67.
     */
    const gridSize = CONFIG.latticeHalfCount * 2 + 1;
    const gridLookup = new Int32Array(gridSize * gridSize * gridSize);
    gridLookup.fill(-1);

    const targetList = [];
    const integerSites = [];

    function gridKey(x, y, z) {
      const half = CONFIG.latticeHalfCount;
      return (x + half) * gridSize * gridSize
        + (y + half) * gridSize
        + z + half;
    }

    function keepSite(x, y, z) {
      return Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
        >= CONFIG.latticeInnerIndex;
    }

    for (let x = -12; x <= 12; x++) {
      for (let y = -12; y <= 12; y++) {
        for (let z = -12; z <= 12; z++) {
          if (!keepSite(x, y, z)) continue;

          const index = integerSites.length;
          integerSites.push([x, y, z]);
          gridLookup[gridKey(x, y, z)] = index;

          targetList.push(
            x * CONFIG.latticeSpacing,
            y * CONFIG.latticeSpacing,
            z * CONFIG.latticeSpacing
          );
        }
      }
    }

    const cloudCount = integerSites.length;
    const targetPositions = new Float32Array(targetList);
    const sourcePositions = new Float32Array(cloudCount * 3);
    const cloudPositions = new Float32Array(cloudCount * 3);
    const cloudSeeds = new Float32Array(cloudCount);
    const cloudDelays = new Float32Array(cloudCount);
    const cloudOrder = new Float32Array(cloudCount);

    const innerCubed = CONFIG.sourceInnerRadius ** 3;
    const radialVolume =
      CONFIG.sourceOuterRadius ** 3 - innerCubed;

    for (let index = 0; index < cloudCount; index++) {
      const radius = Math.cbrt(innerCubed + random() * radialVolume);
      const direction = randomDirection().multiplyScalar(radius);

      direction.toArray(sourcePositions, index * 3);
      cloudSeeds[index] = random();
      cloudDelays[index] = random() * 8;
    }

    dom.particles.textContent = cloudCount.toLocaleString("en-US");

    const cloudGeometry = new THREE.BufferGeometry();

    cloudGeometry.setAttribute(
      "position",
      new THREE.BufferAttribute(cloudPositions, 3)
        .setUsage(THREE.DynamicDrawUsage)
    );

    cloudGeometry.setAttribute(
      "aOrder",
      new THREE.BufferAttribute(cloudOrder, 1)
        .setUsage(THREE.DynamicDrawUsage)
    );

    cloudGeometry.setAttribute(
      "aSeed",
      new THREE.BufferAttribute(cloudSeeds, 1)
    );

    const cloudMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: timeUniform,
        uPointScale: pointScaleUniform,
        uPointMaximum: pointMaximumUniform,
        uFogDensity: fogUniform,
        uSubjectNDC: subjectNDCUniform,
        uQuantumViolet: { value: new THREE.Color(0x985dff) },
        uQuantumOrange: { value: new THREE.Color(0xff8956) },
        uGridColor: { value: new THREE.Color(0x69e8ff) }
      },

      vertexShader: `
        uniform float uTime;
        uniform float uPointScale;
        uniform float uPointMaximum;
        uniform vec2 uSubjectNDC;
        uniform vec3 uQuantumViolet;
        uniform vec3 uQuantumOrange;
        uniform vec3 uGridColor;

        attribute float aOrder;
        attribute float aSeed;

        varying vec3 vColor;
        varying float vOpacity;
        varying float vDepth;

        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vec4 clip = projectionMatrix * viewPosition;

          vDepth = max(0.01, -viewPosition.z);

          vec2 screen = clip.xy / max(clip.w, 0.001);
          float peripheral = smoothstep(
            0.18,
            0.85,
            length(screen - uSubjectNDC)
          );

          vec3 quantum = mix(
            uQuantumViolet,
            uQuantumOrange,
            aSeed
          );

          vColor = mix(quantum, uGridColor, aOrder) * 1.45;

          float shimmer = 0.78 + 0.22 * sin(uTime * 0.75 + aSeed * 30.0);
          float gridVisibility = 0.17 + 0.83 * peripheral;

          vOpacity = mix(
            0.48 * shimmer,
            gridVisibility,
            aOrder
          );

          float size = mix(
            0.11 + 0.11 * aSeed,
            0.20,
            aOrder
          );

          gl_PointSize = clamp(
            size * uPointScale / vDepth,
            1.0,
            uPointMaximum
          );

          gl_Position = clip;
        }
      `,

      fragmentShader: softPointFragment,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false
    });

    const cloud = new THREE.Points(cloudGeometry, cloudMaterial);
    cloud.name = "10712 particles assembling into exact lattice sites";
    cloud.frustumCulled = false;
    cloud.renderOrder = 6;
    scene.add(cloud);

    const latticeEdges = [];
    const latticeDelays = [];

    function appendLatticeEdge(first, second) {
      const delay = Math.max(cloudDelays[first], cloudDelays[second]);

      for (const index of [first, second]) {
        latticeEdges.push(
          targetPositions[index * 3],
          targetPositions[index * 3 + 1],
          targetPositions[index * 3 + 2]
        );

        latticeDelays.push(delay);
      }
    }

    for (let index = 0; index < integerSites.length; index++) {
      const [x, y, z] = integerSites[index];

      if (x < 12) {
        const neighbor = gridLookup[gridKey(x + 1, y, z)];
        if (neighbor >= 0) appendLatticeEdge(index, neighbor);
      }

      if (y < 12) {
        const neighbor = gridLookup[gridKey(x, y + 1, z)];
        if (neighbor >= 0) appendLatticeEdge(index, neighbor);
      }

      if (z < 12) {
        const neighbor = gridLookup[gridKey(x, y, z + 1)];
        if (neighbor >= 0) appendLatticeEdge(index, neighbor);
      }
    }

    const latticeGeometry = new THREE.BufferGeometry();

    latticeGeometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(latticeEdges, 3)
    );

    latticeGeometry.setAttribute(
      "aDelay",
      new THREE.Float32BufferAttribute(latticeDelays, 1)
    );

    const lattice = new THREE.LineSegments(
      latticeGeometry,
      new THREE.ShaderMaterial({
        uniforms: {
          uCycle: cycleUniform,
          uFogDensity: fogUniform,
          uSubjectNDC: subjectNDCUniform,
          uColor: { value: new THREE.Color(0x56cfe8) }
        },

        vertexShader: `
          uniform float uCycle;
          uniform vec2 uSubjectNDC;

          attribute float aDelay;

          varying float vOpacity;
          varying float vDepth;

          ${formationGLSL}

          void main() {
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vec4 clip = projectionMatrix * viewPosition;

            vDepth = max(0.0, -viewPosition.z);

            float formation = formationWeight(uCycle, aDelay);
            vec2 screen = clip.xy / max(clip.w, 0.001);

            float peripheral = smoothstep(
              0.2,
              0.88,
              length(screen - uSubjectNDC)
            );

            vOpacity = smoothstep(0.94, 1.0, formation)
                     * (0.035 + 0.20 * peripheral);

            gl_Position = clip;
          }
        `,

        fragmentShader: `
          uniform float uFogDensity;
          uniform vec3 uColor;

          varying float vOpacity;
          varying float vDepth;

          void main() {
            float fog = exp(-pow(uFogDensity * vDepth, 2.0));
            gl_FragColor = vec4(uColor * 1.3, vOpacity * fog);
          }
        `,

        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false
      })
    );

    lattice.name = "29394 Cartesian neighbor connections";
    lattice.renderOrder = 1;
    scene.add(lattice);

    let formationAverage = 0;

    function updateCloud(elapsed) {
      const phase = elapsed % CONFIG.cycleDuration;
      cycleUniform.value = phase;

      const angle = elapsed * 0.024;
      const cosine = Math.cos(angle);
      const sine = Math.sin(angle);

      let total = 0;

      for (let index = 0; index < cloudCount; index++) {
        const offset = index * 3;
        const blend = formationWeight(phase, cloudDelays[index]);

        cloudOrder[index] = blend;
        total += blend;

        if (blend === 1) {
          cloudPositions[offset] = targetPositions[offset];
          cloudPositions[offset + 1] = targetPositions[offset + 1];
          cloudPositions[offset + 2] = targetPositions[offset + 2];
          continue;
        }

        const x = sourcePositions[offset];
        const y = sourcePositions[offset + 1];
        const z = sourcePositions[offset + 2];
        const seed = cloudSeeds[index] * Math.PI * 2;

        const driftingX =
          x * cosine - z * sine
          + 2.1 * Math.sin(elapsed * 0.17 + seed + y * 0.07);

        const driftingY =
          y + 1.8 * Math.cos(elapsed * 0.13 + seed + z * 0.06);

        const driftingZ =
          x * sine + z * cosine
          + 2.1 * Math.sin(elapsed * 0.11 - seed + x * 0.05);

        cloudPositions[offset] =
          driftingX + (targetPositions[offset] - driftingX) * blend;

        cloudPositions[offset + 1] =
          driftingY + (targetPositions[offset + 1] - driftingY) * blend;

        cloudPositions[offset + 2] =
          driftingZ + (targetPositions[offset + 2] - driftingZ) * blend;
      }

      formationAverage = total / cloudCount;
      cloudGeometry.attributes.position.needsUpdate = true;
      cloudGeometry.attributes.aOrder.needsUpdate = true;
    }

    /*
     * Mathematical panels are canvas-textured world-space sprites.
     * They render after bloom and tone mapping to preserve sharp notation.
     */
    const labels = [];

    function drawRuns(context, runs, x, baseline, size, maxWidth) {
      const prepared = runs.map(run => {
        return typeof run === "string" ? { text: run } : run;
      });

      let width = 0;

      for (const run of prepared) {
        const fontSize = run.up || run.down ? size * 0.59 : size;
        context.font = fontSize + 'px "Cambria Math", Georgia, serif';
        width += context.measureText(run.text).width;
      }

      const scale = Math.min(1, maxWidth / Math.max(1, width));

      context.save();
      context.translate(x, baseline);
      context.scale(scale, scale);

      let cursor = 0;

      for (const run of prepared) {
        const fontSize = run.up || run.down ? size * 0.59 : size;
        context.font = fontSize + 'px "Cambria Math", Georgia, serif';

        const offset = run.up ? -size * 0.48 : run.down ? size * 0.22 : 0;

        context.fillText(run.text, cursor, offset);
        cursor += context.measureText(run.text).width;
      }

      context.restore();
    }

    function drawFraction(context, numerator, denominator, x, y, width) {
      context.save();
      context.fillStyle = "#edf0ff";

      drawRuns(context, numerator, x + 10, y - 15, 48, width - 20);

      context.strokeStyle = "#b9bdd5";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + width, y);
      context.stroke();

      drawRuns(context, denominator, x + 10, y + 54, 45, width - 20);
      context.restore();
    }

    function makeMathPanel(title, color, width, anchor, paint) {
      const canvas = document.createElement("canvas");
      canvas.width = 1200;
      canvas.height = 390;

      const context = canvas.getContext("2d");

      if (!context) return;

      context.fillStyle = "rgba(4, 5, 16, 0.86)";
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.strokeStyle = "rgba(171, 183, 225, 0.32)";
      context.lineWidth = 2;
      context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

      context.fillStyle = color;
      context.fillRect(0, 0, 6, canvas.height);

      context.font = "500 29px Consolas, Menlo, monospace";
      context.fillText(title, 35, 53);

      context.strokeStyle = "rgba(171, 183, 225, 0.19)";
      context.beginPath();
      context.moveTo(35, 77);
      context.lineTo(1165, 77);
      context.stroke();

      context.fillStyle = "#edf0ff";
      paint(context);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.minFilter = THREE.LinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = false;

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        sizeAttenuation: true,
        toneMapped: false
      }));

      sprite.scale.set(width, width * canvas.height / canvas.width, 1);
      sprite.name = title;
      labelScene.add(sprite);

      labels.push({
        sprite,
        anchor: new THREE.Vector3(anchor[0], anchor[1], anchor[2])
      });
    }

    function caption(context, text, y) {
      context.font = "32px Consolas, Menlo, monospace";
      context.fillStyle = "#aebbd0";
      context.fillText(text, 36, y, 1125);
      context.fillStyle = "#edf0ff";
    }

    makeMathPanel(
      "GRASSMANNIAN / TREE CONTOUR",
      "#c493ff",
      29,
      [-28, 15, 8],
      context => {
        drawRuns(context, [
          "ℛ", { text: "n,k", down: true },
          " = ∮", { text: "Γ", down: true }
        ], 36, 164, 64, 280);

        drawFraction(context,
          ["d", { text: "k×n", up: true }, "D"],
          ["vol GL(k)"],
          340, 153, 260
        );

        drawFraction(context,
          ["δ", { text: "4k|4k", up: true }, "(D · 𝒵)"],
          ["∏", { text: "n", up: true }, { text: "a=1", down: true },
            " Δ", { text: "a", down: true }, "(D)"],
          655, 153, 480
        );

        caption(context, "Δₐ: cyclic k × k minors · tree contour Γ", 280);
        caption(context, "𝒵ᵢ = (λᵢ, μᵢ | χᵢ) · momentum supertwistors", 335);
      }
    );

    makeMathPanel(
      "TWISTOR / DUAL-TWISTOR VARIABLES",
      "#83dfff",
      25,
      [27, 12, -8],
      context => {
        drawRuns(context, [
          "Z", { text: "1", down: true }, " = (λ",
          { text: "1", down: true }, ", μ",
          { text: "1", down: true }, ")",
          "     Z", { text: "2", down: true }, " = (λ",
          { text: "2", down: true }, ", μ",
          { text: "2", down: true }, ")"
        ], 36, 150, 57, 1115);

        drawRuns(context, [
          "W", { text: "3", down: true }, " = (μ̃",
          { text: "3", down: true }, ", λ̃",
          { text: "3", down: true }, ")"
        ], 36, 233, 57, 1115);

        caption(context, "W₃ · Z₁     W₃ · Z₂", 325);
      }
    );

    makeMathPanel(
      "SPINOR-HELICITY / KINEMATIC RATIO",
      "#ffbb83",
      24,
      [8, -21, 23],
      context => {
        drawRuns(context, [
          "𝒦", { text: "ij;kl", down: true }, " ="
        ], 80, 185, 72, 350);

        drawFraction(
          context,
          ["[ i j ] [ k l ]"],
          ["⟨ 1 2 ⟩ ⟨ 3 4 ⟩"],
          465, 170, 560
        );

        caption(context, "Illustrative spinor-helicity ratio", 294);
        caption(context, "A full amplitude also specifies theory and helicities.", 345);
      }
    );

    makeMathPanel(
      "POSITIVE GEOMETRY / CANONICAL FORM",
      "#ddb4ff",
      24,
      [2, 29, -13],
      context => {
        drawRuns(context, [
          "Y = CZ,     C ∈ G",
          { text: "+", down: true },
          "(k,n)"
        ], 36, 158, 70, 1115);

        drawRuns(context, [
          "Ω : logarithmic boundary poles"
        ], 36, 243, 53, 1115);

        caption(context, "Z: positive bosonized external data", 335);
      }
    );

    const motionPreference = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    );

    let automatic = !motionPreference.matches;
    let paused = motionPreference.matches;
    let elapsed = motionPreference.matches ? 44 : 0;
    let running = false;
    let contextLost = false;
    let frameId = 0;
    let lastTimestamp = null;
    let lastPercent = -1;
    let lastPhaseName = "";
    let currentPixelRatio = 0;
    let resizeFrame = 0;

    const cameraDestination = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    const cameraRig = new THREE.PerspectiveCamera();
    cameraRig.up.copy(camera.up);
    const subjectProjection = new THREE.Vector3();
    const zero = new THREE.Vector3();

    function orbitalPosition(time, result) {
      const theta = 0.72 + time * 0.048;
      const lift = Math.pow(
        0.5 + 0.5 * Math.sin(time * 0.055 + 0.3),
        1.8
      );

      const elevation = 0.12 + lift * 1.31;
      const portraitScale = Math.max(1, 0.84 / camera.aspect);

      const radius =
        (53 + 42 * Math.pow(lift, 0.65)
          + 6 * Math.sin(time * 0.031))
        * portraitScale;

      return result.set(
        Math.cos(theta) * Math.cos(elevation) * radius,
        Math.sin(elevation) * radius,
        Math.sin(theta) * Math.cos(elevation) * radius
      );
    }

    function refreshButtons() {
      dom.flightButton.setAttribute("aria-pressed", String(automatic));
      dom.pauseButton.setAttribute("aria-pressed", String(paused));
      dom.pauseButton.textContent = paused ? "Play" : "Pause";

      dom.cameraState.textContent = paused
        ? "TIME PAUSED"
        : automatic
          ? "CINEMATIC ORBIT"
          : "MANUAL EXPLORATION";
    }

    function setAutomatic(value) {
      automatic = value;

      if (value) {
        controls.enableDamping = false;
        controls.update();
        controls.enableDamping = true;
        lookTarget.copy(controls.target);
      }

      refreshButtons();
    }

    function togglePause() {
      paused = !paused;
      refreshButtons();
    }

    function togglePanel() {
      const hidden = dom.panel.classList.toggle("is-hidden");
      dom.panelButton.setAttribute("aria-expanded", String(!hidden));
    }

    function resetScene() {
      elapsed = motionPreference.matches ? 44 : 0;
      paused = motionPreference.matches;
      automatic = !motionPreference.matches;

      controls.enableDamping = false;
      controls.update();
      controls.target.set(0, 0, 0);
      controls.enableDamping = true;

      orbitalPosition(elapsed, camera.position);
      camera.lookAt(zero);
      lookTarget.set(0, 0, 0);

      updateCloud(elapsed);
      refreshButtons();
    }

    controls.addEventListener("start", () => {
      automatic = false;
      refreshButtons();
    });

    dom.flightButton.addEventListener("click", () => {
      setAutomatic(!automatic);
    });

    dom.pauseButton.addEventListener("click", togglePause);
    dom.resetButton.addEventListener("click", resetScene);
    dom.panelButton.addEventListener("click", togglePanel);

    window.addEventListener("keydown", event => {
      if (
        event.target &&
        (event.target.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName))
      ) {
        return;
      }

      if (event.code === "Space") {
        event.preventDefault();
        if (!event.repeat) togglePause();
      }

      if (event.code === "KeyR" && !event.repeat) {
        paused = false;
        setAutomatic(true);
      }

      if (event.code === "KeyH" && !event.repeat) {
        togglePanel();
      }
    });

    motionPreference.addEventListener("change", event => {
      if (event.matches) {
        paused = true;
        automatic = false;
        refreshButtons();
      }
    });

    function updateCamera(delta) {
      if (!automatic) {
        controls.update();
        lookTarget.copy(controls.target);
        return;
      }

      if (paused) return;

      orbitalPosition(elapsed, cameraDestination);

      const alpha = 1 - Math.exp(-2.0 * delta);
      camera.position.lerp(cameraDestination, alpha);
      lookTarget.lerp(zero, alpha);

      cameraRig.position.copy(camera.position);
      cameraRig.lookAt(lookTarget);

      camera.quaternion.slerp(
        cameraRig.quaternion,
        1 - Math.exp(-2.8 * delta)
      );

      controls.target.copy(lookTarget);
    }

    function updateLabels() {
      jewelGroup.updateMatrixWorld(true);

      for (const label of labels) {
        label.sprite.position.copy(label.anchor)
          .applyMatrix4(jewelGroup.matrixWorld);

        const distance = camera.position.distanceTo(label.sprite.position);

        const nearFade = THREE.MathUtils.smoothstep(distance, 8, 19);
        const farFade = 1 - THREE.MathUtils.smoothstep(distance, 145, 235);

        label.sprite.material.opacity = nearFade * farFade;
        label.sprite.visible = label.sprite.material.opacity > 0.015;
      }
    }

    function updateReadout() {
      const phase = cycleUniform.value;
      const name = phase < 8
        ? "UNSTRUCTURED CLOUD"
        : phase < 40
          ? "COORDINATE ASSEMBLY"
          : phase < 50
            ? "EXACT LATTICE HOLD"
            : "LATTICE DISSOLUTION";

      if (name !== lastPhaseName) {
        dom.state.textContent = name;
        lastPhaseName = name;
      }

      const percent = Math.round(formationAverage * 100);

      if (percent !== lastPercent) {
        dom.percent.textContent = percent + "%";
        dom.meter.setAttribute("aria-valuenow", String(percent));
        lastPercent = percent;
      }

      dom.fill.style.transform = "scaleX(" + formationAverage + ")";
    }

    function resize() {
      resizeFrame = 0;

      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      camera.aspect = width / height;
      camera.clearViewOffset();

      if (width >= 850) {
        camera.setViewOffset(
          width,
          height,
          -Math.min(145, width * 0.105),
          0,
          width,
          height
        );
      }

      camera.updateProjectionMatrix();

      if (pixelRatio !== currentPixelRatio) {
        renderer.setPixelRatio(pixelRatio);
        composer.setPixelRatio(pixelRatio);
        currentPixelRatio = pixelRatio;
      }

      renderer.setSize(width, height);
      composer.setSize(width, height);

      bloom.setSize(
        Math.round(width * pixelRatio * 0.7),
        Math.round(height * pixelRatio * 0.7)
      );

      fxaa.material.uniforms.resolution.value.set(
        1 / (width * pixelRatio),
        1 / (height * pixelRatio)
      );

      pointScaleUniform.value =
        height * pixelRatio
        / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }

    function queueResize() {
      if (!resizeFrame) {
        resizeFrame = requestAnimationFrame(resize);
      }
    }

    window.addEventListener("resize", queueResize, { passive: true });

    function animate(timestamp) {
      if (!running) return;

      const delta = lastTimestamp === null
        ? 0
        : Math.min((timestamp - lastTimestamp) / 1000, 0.05);

      lastTimestamp = timestamp;

      if (!paused) {
        elapsed += delta;
        updateCloud(elapsed);
      }

      timeUniform.value = elapsed;
      jewelGroup.rotation.y = elapsed * 0.055;
      jewelGroup.rotation.z = Math.sin(elapsed * 0.11) * 0.065;
      coreLight.intensity = 220 + Math.sin(elapsed * 1.2) * 65;

      updateCamera(delta);

      camera.updateMatrixWorld();
      subjectProjection.set(0, 0, 0).project(camera);
      subjectNDCUniform.value.set(
        subjectProjection.x,
        subjectProjection.y
      );

      updateLabels();
      updateReadout();

      composer.render(delta);

      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(labelScene, camera);
      renderer.autoClear = true;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      if (pixelRatio !== currentPixelRatio) {
        queueResize();
      }

      frameId = requestAnimationFrame(animate);
    }

    stopAnimation = () => {
      running = false;
      lastTimestamp = null;
      cancelAnimationFrame(frameId);
    };

    function startAnimation() {
      if (running || contextLost || document.hidden) return;

      running = true;
      lastTimestamp = null;
      frameId = requestAnimationFrame(animate);
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopAnimation();
      } else {
        startAnimation();
      }
    });

    window.addEventListener("pagehide", stopAnimation);
    window.addEventListener("pageshow", startAnimation);

    renderer.domElement.addEventListener("webglcontextlost", event => {
      event.preventDefault();
      contextLost = true;
      stopAnimation();
      showStatus("The graphics context was interrupted. Waiting for the GPU to restore it.");
    });

    renderer.domElement.addEventListener("webglcontextrestored", () => {
      try {
        rebuildEnvironment();
        contextLost = false;
        resize();
        dom.status.hidden = true;
        startAnimation();
      } catch (error) {
        showStatus("The graphics context could not be restored: " + error.message);
      }
    });

    resize();
    resetScene();

    timeUniform.value = elapsed;
    updateLabels();
    updateReadout();

    await renderer.compileAsync(scene, camera);
    await renderer.compileAsync(labelScene, camera);

    dom.status.hidden = true;
    startAnimation();
  } catch (error) {
    stopAnimation();
    showStatus(
      "The visualization could not start. " +
      (error && error.message ? error.message : String(error))
    );
  }
})();