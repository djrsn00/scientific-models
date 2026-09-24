// script.js
(() => {
  "use strict";

  const THREE = window.THREE;
  const notice = document.getElementById("render-notice");

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
      "The cryogenic visualization could not initialize. Check browser graphics acceleration.";
  }

  function initialize() {
    const container = document.getElementById("canvas-container");
    const panel = document.getElementById("info-panel");
    const caption = document.getElementById("depth-caption");
    const endOverlay = document.getElementById("end-overlay");

    const ui = {
      number: document.getElementById("stage-number"),
      title: document.getElementById("stage-title"),
      description: document.getElementById("stage-description"),
      temperature: document.getElementById("temperature-value"),
      unit: document.getElementById("temperature-unit"),
      mode: document.getElementById("flight-mode"),
      progress: document.getElementById("progress-text"),
      progressFill: document.getElementById("progress-fill"),
      caption: document.getElementById("caption-text"),
      rows: Array.from(document.querySelectorAll("[data-stage]"))
    };

    const TAU = Math.PI * 2;
    const CHIP_Y = -49.6;
    const BLOCH_RADIUS = 0.65;
    const BLOCH_Y = CHIP_Y + 1.05;

    const clamp01 = (value) => Math.max(0, Math.min(1, value));

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

    const random = seededRandom(0x4352594f);
    const range = (a, b) => a + (b - a) * random();

    function linearColor(hex) {
      return new THREE.Color(hex).convertSRGBToLinear();
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.0015);

    const annotationScene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      54,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.018,
      650
    );

    /*
      The flight points predominantly down -Y. Using -Z as camera-up
      avoids the lookAt singularity of looking parallel to a Y-up vector.
      OrbitControls caches this up-axis, so it is set before construction
      and remains unchanged for the entire session.
    */
    camera.up.set(0, 0, -1);
    camera.position.set(16, 112, 26);
    camera.lookAt(8, 106, 12);
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
      "Interactive dilution refrigerator and superconducting qubit visualization"
    );
    renderer.domElement.setAttribute("aria-describedby", "control-help");
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.43;
    controls.zoomSpeed = 0.62;
    controls.panSpeed = 0.58;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.06;
    controls.maxDistance = 500;
    controls.minPolarAngle = 0.015;
    controls.maxPolarAngle = Math.PI - 0.015;
    controls.autoRotate = false;

    const gl = renderer.getContext();
    const maximumPointSize = Math.min(
      80,
      gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE)[1]
    );

    const hdrAvailable =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("EXT_color_buffer_float");

    const renderTextureType = hdrAvailable
      ? THREE.HalfFloatType
      : THREE.UnsignedByteType;

    const shared = {
      uTime: { value: 0 },
      uCold: { value: 0 },
      uFogDensity: { value: scene.fog.density },
      uFogColor: { value: scene.fog.color },
      uPointScale: { value: 1 },
      uMaxPointSize: { value: maximumPointSize }
    };

    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    const dummy = new THREE.Object3D();
    const labels = [];
    const plateMaterials = [];
    const animatedRings = [];

    function makeCanvasTexture(canvas, srgb = false) {
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

      gradient.addColorStop(0, "#03070d");
      gradient.addColorStop(0.2, "#2d394a");
      gradient.addColorStop(0.39, "#aebfce");
      gradient.addColorStop(0.44, "#fff1cf");
      gradient.addColorStop(0.5, "#322717");
      gradient.addColorStop(0.67, "#152b43");
      gradient.addColorStop(1, "#02040a");

      context.fillStyle = gradient;
      context.fillRect(0, 0, 1024, 512);

      for (let i = 0; i < 16; i++) {
        context.fillStyle = i % 3 === 0 ? "#fff2d5" : "#728b9f";
        context.fillRect(i * 67, 70, 8, 200);
      }

      const texture = makeCanvasTexture(canvas, true);
      texture.mapping = THREE.EquirectangularReflectionMapping;

      const generator = new THREE.PMREMGenerator(renderer);
      generator.compileEquirectangularShader();
      const target = generator.fromEquirectangular(texture);

      scene.environment = target.texture;
      texture.dispose();
      generator.dispose();

      return target;
    }

    scene.userData.environmentTarget = createEnvironment();

    scene.add(new THREE.HemisphereLight(0xb7d4ed, 0x192332, 0.62));

    const keyLight = new THREE.DirectionalLight(0xffe6bb, 1.6);
    keyLight.position.set(70, 140, 90);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7397cf, 0.85);
    rimLight.position.set(-80, -20, -80);
    scene.add(rimLight);

    const cameraLight = new THREE.PointLight(0xffe0b8, 1.75, 70, 2);
    cameraLight.position.set(0, 1, -1);
    camera.add(cameraLight);

    function standardMaterial(color, options = {}) {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 0.34,
        metalness: 0.88,
        ...options
      });
    }

    const materials = {
      steel: standardMaterial(0xc0ccd5, {
        roughness: 0.27,
        metalness: 1,
        envMapIntensity: 1.3
      }),
      gold: standardMaterial(0xdca849, {
        roughness: 0.26,
        metalness: 1,
        envMapIntensity: 1.4
      }),
      copper: standardMaterial(0xc27f4f, {
        roughness: 0.3,
        metalness: 0.96
      }),
      dark: standardMaterial(0x0b111b, {
        roughness: 0.42,
        metalness: 0.65
      }),
      ceramic: standardMaterial(0x171e2b, {
        roughness: 0.7,
        metalness: 0.08
      }),
      silicon: standardMaterial(0x101826, {
        roughness: 0.23,
        metalness: 0.55
      }),
      cyan: new THREE.MeshBasicMaterial({
        color: 0x46dcff,
        transparent: true,
        opacity: 0.88
      }),
      violet: new THREE.MeshBasicMaterial({
        color: 0xc253ff
      }),
      junction: new THREE.MeshBasicMaterial({
        color: 0xf2faff
      })
    };

    function box(parent, w, h, d, x, y, z, material) {
      const mesh = new THREE.Mesh(unitBox, material);
      mesh.scale.set(w, h, d);
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

    function instanceBoxes(parent, entries, material) {
      const mesh = new THREE.InstancedMesh(
        unitBox, material, entries.length
      );

      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        dummy.position.set(e[0], e[1], e[2]);
        dummy.scale.set(e[3], e[4], e[5]);
        dummy.rotation.set(0, e[6] || 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }

      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      parent.add(mesh);
      return mesh;
    }

    function instanceCylinders(parent, locations, radius, height, material) {
      const geometry = new THREE.CylinderGeometry(
        radius, radius, height, 10
      );
      const mesh = new THREE.InstancedMesh(
        geometry, material, locations.length
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
      return mesh;
    }

    function pipe(parent, points, radius, material, segments = 96) {
      const curve = new THREE.CatmullRomCurve3(
        points.map((point) => new THREE.Vector3(...point)),
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

    function annularPlate(radius, aperture, thickness, y, material) {
      const shape = new THREE.Shape();
      shape.absarc(0, 0, radius, 0, TAU, false);

      const hole = new THREE.Path();
      hole.absarc(0, 0, aperture, 0, TAU, true);
      shape.holes.push(hole);

      const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: thickness,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.08,
        bevelSegments: 1,
        curveSegments: 96,
        steps: 1
      });

      geometry.translate(0, 0, -thickness / 2);

      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = y;
      scene.add(mesh);
      return mesh;
    }

    function staticLines(parent, positions, color, opacity = 1) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3)
      );

      const lines = new THREE.LineSegments(
        geometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: opacity < 1,
          opacity,
          depthWrite: false,
          fog: true
        })
      );
      lines.frustumCulled = false;
      parent.add(lines);
      return lines;
    }

    const plateDefinitions = [
      { y: 94, radius: 60, aperture: 8, thickness: 1.7, steel: true },
      { y: 68, radius: 55, aperture: 7, thickness: 1.4 },
      { y: 49, radius: 50, aperture: 7, thickness: 1.35 },
      { y: 26, radius: 44, aperture: 6.6, thickness: 1.25 },
      { y: 6, radius: 38, aperture: 6.3, thickness: 1.2 },
      { y: -13, radius: 32, aperture: 6, thickness: 1.15 }
    ];

    const connectorLocations = [];
    const boltLocations = [];
    const machiningLines = [];

    for (const definition of plateDefinitions) {
      const material = (
        definition.steel ? materials.steel : materials.gold
      ).clone();

      material.emissive = new THREE.Color(0x000000);
      plateMaterials.push({ material, y: definition.y });

      annularPlate(
        definition.radius,
        definition.aperture,
        definition.thickness,
        definition.y,
        material
      );

      const top = definition.y + definition.thickness / 2 + 0.1;

      for (let ring = 0; ring < 8; ring++) {
        const radius =
          definition.aperture + 1.5 +
          ring * (definition.radius - definition.aperture - 3) / 8;

        for (let segment = 0; segment < 128; segment++) {
          const a = segment * TAU / 128;
          const b = (segment + 1) * TAU / 128;

          machiningLines.push(
            Math.cos(a) * radius, top, Math.sin(a) * radius,
            Math.cos(b) * radius, top, Math.sin(b) * radius
          );
        }
      }

      for (let i = 0; i < 144; i++) {
        const angle = i * TAU / 144;
        const radius =
          definition.aperture + 3 +
          (i % 3) * (definition.radius - definition.aperture - 6) / 3;

        connectorLocations.push([
          Math.cos(angle) * radius,
          top + 0.5,
          Math.sin(angle) * radius
        ]);
      }

      for (let i = 0; i < 36; i++) {
        const angle = i * TAU / 36;
        const radius = definition.radius - 1.5;
        boltLocations.push([
          Math.cos(angle) * radius,
          top + 0.15,
          Math.sin(angle) * radius
        ]);
      }
    }

    staticLines(scene, machiningLines, 0x947645, 0.48);
    instanceCylinders(scene, connectorLocations, 0.3, 1, materials.gold);
    instanceCylinders(scene, boltLocations, 0.42, 0.4, materials.steel);

    const supportY = [94, 68, 49, 26, 6, -13];
    const supportR = [57, 52, 47, 41, 35, 29];
    const rodDirection = new THREE.Vector3();
    const rodMidpoint = new THREE.Vector3();
    const worldY = new THREE.Vector3(0, 1, 0);

    for (let rod = 0; rod < 6; rod++) {
      const angle = rod * TAU / 6 + 0.25;

      for (let stage = 0; stage < supportY.length - 1; stage++) {
        const a = new THREE.Vector3(
          Math.cos(angle) * supportR[stage],
          supportY[stage] - 0.7,
          Math.sin(angle) * supportR[stage]
        );
        const b = new THREE.Vector3(
          Math.cos(angle) * supportR[stage + 1],
          supportY[stage + 1] + 0.7,
          Math.sin(angle) * supportR[stage + 1]
        );

        rodDirection.subVectors(b, a);
        rodMidpoint.copy(a).add(b).multiplyScalar(0.5);

        const mesh = cylinder(
          scene,
          0.42,
          rodDirection.length(),
          rodMidpoint.x,
          rodMidpoint.y,
          rodMidpoint.z,
          materials.steel,
          16
        );

        mesh.quaternion.setFromUnitVectors(
          worldY,
          rodDirection.normalize()
        );
      }
    }

    // Batched coaxial geometry: 2,048 separate swept cable paths.
    // Tight S-shaped deviations appear around the intermediate shields.
    const cableCount = 2048;
    const cableSegments = 48;
    const cableSides = 5;
    const cableData = [];

    function cablePoint(radius, angle, phase, t, result) {
      const y = 98 - 118 * t;
      const reliefEnvelope = Math.exp(-Math.pow((y - 57) / 17, 2));
      const relief = Math.sin((y - 49) * 0.24 + phase) * reliefEnvelope;
      const r = radius * (1 - 0.42 * smootherstep(t)) + relief * 0.65;
      const theta = angle + relief * 0.026;

      result[0] = Math.cos(theta) * r;
      result[1] = y;
      result[2] = Math.sin(theta) * r;
    }

    const cableVertexCount =
      cableCount * (cableSegments + 1) * (cableSides + 1);

    const cablePositions = new Float32Array(cableVertexCount * 3);
    const cableNormals = new Float32Array(cableVertexCount * 3);
    const cableIndices = new Uint32Array(
      cableCount * cableSegments * cableSides * 6
    );

    const center = [0, 0, 0];
    const previous = [0, 0, 0];
    const next = [0, 0, 0];

    let vertexOffset = 0;
    let indexOffset = 0;

    for (let cable = 0; cable < cableCount; cable++) {
      const radius = 10 + Math.sqrt(random()) * 44;
      const angle = (cable % 24) * TAU / 24 + range(-0.025, 0.025);
      const phase = random() * TAU;
      const thickness = range(0.045, 0.075);

      cableData.push([radius, angle, phase]);

      const baseVertex = vertexOffset;

      for (let segment = 0; segment <= cableSegments; segment++) {
        const t = segment / cableSegments;

        cablePoint(radius, angle, phase, t, center);
        cablePoint(
          radius, angle, phase,
          Math.max(0, t - 0.001), previous
        );
        cablePoint(
          radius, angle, phase,
          Math.min(1, t + 0.001), next
        );

        let tx = next[0] - previous[0];
        let ty = next[1] - previous[1];
        let tz = next[2] - previous[2];
        const tangentLength = Math.hypot(tx, ty, tz);

        tx /= tangentLength;
        ty /= tangentLength;
        tz /= tangentLength;

        const normalLength = Math.hypot(ty, tx);
        const nx = ty / normalLength;
        const ny = -tx / normalLength;
        const nz = 0;

        const bx = ty * nz - tz * ny;
        const by = tz * nx - tx * nz;
        const bz = tx * ny - ty * nx;

        for (let side = 0; side <= cableSides; side++) {
          const theta = side * TAU / cableSides;
          const cs = Math.cos(theta);
          const sn = Math.sin(theta);

          const rx = nx * cs + bx * sn;
          const ry = ny * cs + by * sn;
          const rz = nz * cs + bz * sn;

          const offset = vertexOffset * 3;
          cablePositions[offset] = center[0] + rx * thickness;
          cablePositions[offset + 1] = center[1] + ry * thickness;
          cablePositions[offset + 2] = center[2] + rz * thickness;

          cableNormals[offset] = rx;
          cableNormals[offset + 1] = ry;
          cableNormals[offset + 2] = rz;
          vertexOffset += 1;
        }
      }

      for (let segment = 0; segment < cableSegments; segment++) {
        for (let side = 0; side < cableSides; side++) {
          const a = baseVertex + segment * (cableSides + 1) + side;
          const b = a + cableSides + 1;

          cableIndices[indexOffset++] = a;
          cableIndices[indexOffset++] = b;
          cableIndices[indexOffset++] = a + 1;
          cableIndices[indexOffset++] = b;
          cableIndices[indexOffset++] = b + 1;
          cableIndices[indexOffset++] = a + 1;
        }
      }
    }

    const coaxGeometry = new THREE.BufferGeometry();
    coaxGeometry.setAttribute(
      "position", new THREE.BufferAttribute(cablePositions, 3)
    );
    coaxGeometry.setAttribute(
      "normal", new THREE.BufferAttribute(cableNormals, 3)
    );
    coaxGeometry.setIndex(new THREE.BufferAttribute(cableIndices, 1));
    coaxGeometry.computeBoundingSphere();

    const coaxialBundle = new THREE.Mesh(coaxGeometry, materials.steel);
    scene.add(coaxialBundle);

    function createParticleTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;

      const context = canvas.getContext("2d");
      const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);

      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.15, "rgba(255,255,255,0.94)");
      gradient.addColorStop(0.43, "rgba(255,255,255,0.22)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      context.fillStyle = gradient;
      context.fillRect(0, 0, 128, 128);

      return makeCanvasTexture(canvas);
    }

    const particleTexture = createParticleTexture();

    const particleVertex = `
      attribute vec3 color;
      attribute vec3 aEnd;
      attribute vec4 aPath;
      attribute float aSize;

      uniform float uTime;
      uniform float uFamily;
      uniform float uPointScale;
      uniform float uMaxPointSize;

      varying vec3 vColor;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vDistance;

      float ease(float t) {
        return t*t*t*(t*(t*6.0-15.0)+10.0);
      }

      void main() {
        vec3 p = position;
        float progress = fract(aPath.z + uTime * aPath.w);

        if (uFamily < 0.5) {
          float y = 98.0 - 118.0 * progress;
          float envelope = exp(-pow((y-57.0)/17.0,2.0));
          float phase = position.x;
          float relief = sin((y-49.0)*0.24+phase)*envelope;
          float r = aPath.x*(1.0-0.42*ease(progress))+relief*0.65+0.16;
          float angle = aPath.y + relief*0.026;

          p = vec3(cos(angle)*r,y,sin(angle)*r);
        } else if (uFamily < 1.5) {
          p = mix(position,aEnd,progress);
          p.y += sin(progress*3.14159265) *
            sin(uTime*5.0+aPath.x) * 0.07;
        } else if (uFamily < 2.5) {
          float angle = progress*12.56637061+aPath.y;
          p = vec3(
            cos(angle)*aPath.x,
            38.0-progress*25.0,
            sin(angle)*aPath.x
          );
        } else {
          p.y += sin(uTime+aPath.z*12.0)*0.025;
        }

        vec4 world = modelMatrix*vec4(p,1.0);
        vec4 mvPosition = viewMatrix*world;

        vColor = color;
        vWorld = world.xyz;
        vSeed = aPath.z;
        vDistance = length(mvPosition.xyz);

        gl_Position = projectionMatrix*mvPosition;
        gl_PointSize = clamp(
          aSize*uPointScale/max(0.03,-mvPosition.z),
          1.0,
          uMaxPointSize
        );
      }
    `;

    const particleFragment = `
      uniform sampler2D uSprite;
      uniform float uTime;
      uniform float uCold;
      uniform float uFogDensity;
      uniform vec3 uFogColor;
      uniform float uGain;

      varying vec3 vColor;
      varying vec3 vWorld;
      varying float vSeed;
      varying float vDistance;

      void main() {
        vec2 p = gl_PointCoord*2.0-1.0;
        float rr = dot(p,p);
        if(rr>1.0) discard;

        float alpha = texture2D(uSprite,gl_PointCoord).a;
        float pulse = 0.65+0.35*sin(uTime*4.0+vSeed*61.0);
        float proximity = exp(-distance(cameraPosition,vWorld)*0.07);
        float hot = exp(-rr*36.0);

        vec3 color = vColor*(1.7+pulse+proximity)*uGain;
        color += mix(
          vec3(0.65,0.5,0.32),
          vec3(0.32,0.65,0.9),
          uCold
        )*hot;

        float transmission = exp(
          -uFogDensity*uFogDensity*vDistance*vDistance
        );

        alpha *= transmission;
        if(alpha<0.002) discard;

        gl_FragColor = vec4(color,alpha*0.78);
      }
    `;

    function particleField(count, family, builder, gain = 1) {
      const positions = new Float32Array(count * 3);
      const ends = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const paths = new Float32Array(count * 4);
      const sizes = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const item = builder(i);
        const color = linearColor(item.color);

        positions.set(item.position, i * 3);
        ends.set(item.end || item.position, i * 3);
        colors.set([color.r, color.g, color.b], i * 3);
        paths.set(item.path, i * 4);
        sizes[i] = item.size;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geometry.setAttribute("aEnd", new THREE.BufferAttribute(ends, 3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      geometry.setAttribute("aPath", new THREE.BufferAttribute(paths, 4));
      geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uFamily: { value: family },
          uGain: { value: gain },
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
      scene.add(points);
      return points;
    }

    particleField(8192, 0, (i) => {
      const cable = cableData[i % cableCount];
      const warmward = i % 5 === 0;

      return {
        position: [cable[2], 0, 0],
        path: [
          cable[0],
          cable[1],
          random(),
          warmward ? -range(0.035, 0.07) : range(0.035, 0.08)
        ],
        color: warmward ? 0x95ecff : 0xf15cff,
        size: range(0.055, 0.15)
      };
    }, 0.9);

    // HEMT readout amplification resides at the 4 K stage.
    const amplifierBoxes = [];
    const amplifierConnectors = [];

    for (let i = 0; i < 48; i++) {
      const angle = i * TAU / 48;
      const radius = 12 + (i % 3) * 5.5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      amplifierBoxes.push([
        x, 50.8, z,
        1.5, 1.4, 2.6,
        -angle
      ]);
      amplifierConnectors.push([x, 51.7, z]);
    }

    instanceBoxes(scene, amplifierBoxes, materials.gold);
    instanceCylinders(
      scene, amplifierConnectors, 0.19, 0.55, materials.steel
    );

    // Separate radiation-shield skirts retain large cutaway windows.
    const shieldVertex = `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewPosition;
      varying float vDistance;

      void main() {
        vUv=uv;
        vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
        vNormalView=normalize(normalMatrix*normal);
        vViewPosition=-mvPosition.xyz;
        vDistance=length(mvPosition.xyz);
        gl_Position=projectionMatrix*mvPosition;
      }
    `;

    function shieldMaterial(color, opacity, grid, windows) {
      return new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uColor: { value: linearColor(color) },
          uOpacity: { value: opacity },
          uGrid: { value: grid },
          uWindows: { value: windows }
        },
        vertexShader: shieldVertex,
        fragmentShader: `
          uniform float uTime;
          uniform float uOpacity;
          uniform float uGrid;
          uniform float uWindows;
          uniform vec3 uColor;
          uniform float uFogDensity;
          uniform vec3 uFogColor;

          varying vec2 vUv;
          varying vec3 vNormalView;
          varying vec3 vViewPosition;
          varying float vDistance;

          void main() {
            if(uWindows>0.5 && fract(vUv.x*8.0)<0.48) discard;

            vec2 coordinates=vUv*vec2(96.0,28.0);
            vec2 nearest=abs(fract(coordinates-0.5)-0.5);
            vec2 derivative=max(fwidth(coordinates),vec2(0.0001));

            float line=1.0-smoothstep(
              0.1,1.1,
              min(nearest.x/derivative.x,nearest.y/derivative.y)
            );

            float rim=pow(
              1.0-abs(dot(
                normalize(vNormalView),
                normalize(vViewPosition)
              )),
              2.5
            );

            float scan=pow(
              0.5+0.5*sin(vUv.y*25.0-uTime*0.85),
              14.0
            );

            vec3 color=uColor*(0.8+line*uGrid*1.6+rim+scan*0.5);
            float alpha=uOpacity*
              (0.08+rim*0.22+line*uGrid*0.65+scan*0.08);

            alpha*=exp(
              -uFogDensity*uFogDensity*vDistance*vDistance
            );

            if(alpha<0.001) discard;
            gl_FragColor=vec4(color,alpha);
          }
        `,
        extensions: { derivatives: true },
        transparent: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
    }

    function openShield(radius, height, y, material) {
      const mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(
          radius, radius, height, 128, 1, true
        ),
        material
      );
      mesh.position.y = y;
      scene.add(mesh);
      return mesh;
    }

    openShield(
      54.5, 24, 80.5,
      shieldMaterial(0xf0c578, 0.2, 0.3, 1)
    );

    openShield(
      49.5, 16.5, 58.5,
      shieldMaterial(0xf4d28c, 0.19, 0.45, 1)
    );

    // Helium isotope plumbing: two translucent helical pipe paths.
    const fluidOuter = new THREE.MeshPhysicalMaterial({
      color: 0x178ebc,
      metalness: 0.04,
      roughness: 0.17,
      transparent: true,
      opacity: 0.16,
      clearcoat: 1,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const fluidInner = new THREE.MeshBasicMaterial({
      color: 0x178cc3,
      transparent: true,
      opacity: 0.15,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    for (let isotope = 0; isotope < 2; isotope++) {
      const radius = isotope === 0 ? 10.3 : 12.2;
      const offset = isotope * Math.PI;
      const points = [];

      for (let i = 0; i <= 128; i++) {
        const t = i / 128;
        const angle = t * TAU * 2 + offset;
        points.push([
          Math.cos(angle) * radius,
          38 - t * 25,
          Math.sin(angle) * radius
        ]);
      }

      pipe(scene, points, 0.39, fluidOuter, 192);
      pipe(scene, points, 0.17, fluidInner, 192);
    }

    particleField(1600, 2, (i) => {
      const isotope = i % 2;
      return {
        position: [0, 0, 0],
        path: [
          isotope === 0 ? 10.3 : 12.2,
          isotope * Math.PI,
          random(),
          isotope === 0 ? 0.075 : -0.058
        ],
        color: isotope === 0 ? 0x41d8ff : 0xa8eaff,
        size: range(0.07, 0.15)
      };
    }, 0.85);

    cylinder(scene, 2.5, 5.8, 11.5, 13.5, 0, fluidOuter, 64);
    cylinder(scene, 2.6, 0.6, 11.5, 16.6, 0, materials.gold);
    cylinder(scene, 2.6, 0.6, 11.5, 10.4, 0, materials.gold);

    // Millikelvin attenuator/filter banks and isolator packages.
    const attenuationBoxes = [];
    const coldConnectors = [];

    for (let i = 0; i < 360; i++) {
      const angle = (i % 60) * TAU / 60;
      const ring = Math.floor(i / 60);
      const radius = 8.2 + ring * 3.25;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      attenuationBoxes.push([
        x, -11.45, z,
        0.75, 1.25, 1.6,
        -angle
      ]);

      coldConnectors.push([x, -10.65, z]);
    }

    instanceBoxes(scene, attenuationBoxes, materials.gold);
    instanceCylinders(
      scene, coldConnectors, 0.14, 0.44, materials.steel
    );

    const filterTracePositions = [];
    for (let i = 0; i < 120; i++) {
      const angle = i * TAU / 120;
      const a = 7;
      const b = 28;

      filterTracePositions.push(
        Math.cos(angle) * a, -12.3, Math.sin(angle) * a,
        Math.cos(angle) * b, -12.3, Math.sin(angle) * b
      );
    }
    staticLines(scene, filterTracePositions, 0xffcb6c, 0.68);

    // Open-ended RF enclosure plus distinct magnetic-shield layers.
    annularPlate(21, 5.8, 0.9, -22, materials.gold);

    openShield(
      20, 26, -35,
      shieldMaterial(0xd5bd91, 0.34, 0.5, 1)
    );

    openShield(
      18.5, 26, -35,
      shieldMaterial(0xffc55b, 0.52, 1, 0)
    );

    openShield(
      17.2, 24.5, -35.5,
      shieldMaterial(0x9dcada, 0.2, 0.65, 1)
    );

    for (const y of [-22, -28, -35, -42, -48]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(19.7, 0.27, 8, 96),
        materials.gold
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = y;
      scene.add(ring);
    }

    for (let i = 0; i < 4; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(20.3, 0.035, 5, 128),
        new THREE.MeshBasicMaterial({
          color: 0xffca77,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      );

      ring.rotation.x = Math.PI / 2;
      ring.position.y = -25 - i * 6;
      scene.add(ring);
      animatedRings.push({ mesh: ring, phase: i * 0.23 });
    }

    // QPU carrier, enlarged chip and peripheral microwave bonds.
    box(scene, 28, 1.1, 28, 0, -50.55, 0, materials.gold);
    box(scene, 24, 0.65, 24, 0, -49.98, 0, materials.silicon);

    const chipBorder = [];
    const halfChip = 11.85;

    chipBorder.push(
      -halfChip, CHIP_Y, -halfChip, halfChip, CHIP_Y, -halfChip,
      halfChip, CHIP_Y, -halfChip, halfChip, CHIP_Y, halfChip,
      halfChip, CHIP_Y, halfChip, -halfChip, CHIP_Y, halfChip,
      -halfChip, CHIP_Y, halfChip, -halfChip, CHIP_Y, -halfChip
    );

    staticLines(scene, chipBorder, 0x5aa8d7, 0.6);

    const bondPads = [];

    for (let i = 0; i < 64; i++) {
      const angle = i * TAU / 64;
      const edge = 10.8 / Math.max(
        Math.abs(Math.cos(angle)),
        Math.abs(Math.sin(angle))
      );

      const x = Math.cos(angle) * edge;
      const z = Math.sin(angle) * edge;

      bondPads.push([x, CHIP_Y + 0.07, z, 0.4, 0.1, 0.55, -angle]);

      pipe(scene, [
        [Math.cos(angle) * 15.5, -23, Math.sin(angle) * 15.5],
        [Math.cos(angle) * 15, -36, Math.sin(angle) * 15],
        [Math.cos(angle) * 13.3, -46, Math.sin(angle) * 13.3],
        [x, CHIP_Y + 0.14, z]
      ], 0.035, materials.gold, 40);
    }

    instanceBoxes(scene, bondPads, materials.gold);

    const qubits = [];
    const circuitBoxes = [];
    const junctionBoxes = [];
    const resonatorLines = [];
    const blochLines = [];

    for (let row = 0; row < 7; row++) {
      for (let column = 0; column < 7; column++) {
        const x = (column - 3) * 2.7;
        const z = (row - 3) * 2.7;
        const y = CHIP_Y + 0.09;
        const halfLoop = 0.91;

        qubits.push({
          x,
          z,
          phase: random() * TAU,
          azimuth: random() * TAU
        });

        circuitBoxes.push(
          [x - halfLoop, y, z, 0.075, 0.075, 1.82],
          [x + halfLoop, y, z, 0.075, 0.075, 1.82],
          [x, y, z - halfLoop, 1.82, 0.075, 0.075],
          [x - 0.54, y, z + halfLoop, 0.74, 0.075, 0.075],
          [x + 0.54, y, z + halfLoop, 0.74, 0.075, 0.075]
        );

        junctionBoxes.push(
          [x - 0.105, y + 0.012, z + halfLoop, 0.13, 0.07, 0.15],
          [x + 0.105, y + 0.012, z + halfLoop, 0.13, 0.07, 0.15]
        );

        for (let tooth = 0; tooth < 5; tooth++) {
          const a = x - 0.7 + tooth * 0.28;
          const b = a + 0.14;
          const c = z - 1.14;
          const d = z - 0.98;

          resonatorLines.push(
            a, y, c, a, y, d,
            a, y, d, b, y, d,
            b, y, d, b, y, c
          );
        }

        for (let plane = 0; plane < 3; plane++) {
          for (let segment = 0; segment < 64; segment++) {
            const a = segment * TAU / 64;
            const b = (segment + 1) * TAU / 64;

            const point = (angle) => {
              const cs = Math.cos(angle) * BLOCH_RADIUS;
              const sn = Math.sin(angle) * BLOCH_RADIUS;

              if (plane === 0) return [x + cs, BLOCH_Y, z + sn];
              if (plane === 1) return [x + cs, BLOCH_Y + sn, z];
              return [x, BLOCH_Y + cs, z + sn];
            };

            blochLines.push(...point(a), ...point(b));
          }
        }
      }
    }

    instanceBoxes(scene, circuitBoxes, materials.cyan);
    instanceBoxes(scene, junctionBoxes, materials.junction);
    staticLines(scene, resonatorLines, 0x9c86ff, 0.78);
    staticLines(scene, blochLines, 0x62bded, 0.34);

    const blochShell = new THREE.InstancedMesh(
      new THREE.SphereGeometry(BLOCH_RADIUS, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0x258aca,
        transparent: true,
        opacity: 0.025,
        depthWrite: false
      }),
      qubits.length
    );

    for (let i = 0; i < qubits.length; i++) {
      dummy.position.set(qubits[i].x, BLOCH_Y, qubits[i].z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      blochShell.setMatrixAt(i, dummy.matrix);
    }

    blochShell.instanceMatrix.needsUpdate = true;
    blochShell.frustumCulled = false;
    scene.add(blochShell);

    const stateVertex = `
      attribute vec2 aPhase;
      attribute float aEndpoint;

      uniform float uTime;
      uniform float uPointScale;
      uniform float uMaxPointSize;

      varying float vDistance;
      varying float vPhase;

      void main() {
        float theta=uTime*0.72+aPhase.x;
        float phi=aPhase.y;

        vec3 direction=vec3(
          sin(theta)*cos(phi),
          cos(theta),
          sin(theta)*sin(phi)
        );

        vec3 p=position+direction*0.65*aEndpoint;
        vec4 mvPosition=modelViewMatrix*vec4(p,1.0);

        vDistance=length(mvPosition.xyz);
        vPhase=0.5+0.5*cos(theta);

        gl_Position=projectionMatrix*mvPosition;
        gl_PointSize=clamp(
          0.08*uPointScale/max(0.02,-mvPosition.z),
          2.0,
          uMaxPointSize
        );
      }
    `;

    const stateFragment = `
      uniform float uPointMode;
      uniform sampler2D uSprite;
      uniform float uFogDensity;

      varying float vDistance;
      varying float vPhase;

      void main() {
        float alpha=1.0;

        if(uPointMode>0.5) {
          vec2 p=gl_PointCoord*2.0-1.0;
          if(dot(p,p)>1.0) discard;
          alpha=texture2D(uSprite,gl_PointCoord).a;
        }

        vec3 color=mix(
          vec3(0.1,1.6,2.2),
          vec3(2.1,0.18,2.5),
          vPhase
        );

        alpha*=exp(
          -uFogDensity*uFogDensity*vDistance*vDistance
        );

        gl_FragColor=vec4(color,alpha);
      }
    `;

    function stateGeometry(pointsOnly) {
      const positions = [];
      const phases = [];
      const endpoints = [];

      for (const qubit of qubits) {
        const endpointValues = pointsOnly ? [1] : [0, 1];

        for (const endpoint of endpointValues) {
          positions.push(qubit.x, BLOCH_Y, qubit.z);
          phases.push(qubit.phase, qubit.azimuth);
          endpoints.push(endpoint);
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position", new THREE.Float32BufferAttribute(positions, 3)
      );
      geometry.setAttribute(
        "aPhase", new THREE.Float32BufferAttribute(phases, 2)
      );
      geometry.setAttribute(
        "aEndpoint", new THREE.Float32BufferAttribute(endpoints, 1)
      );
      return geometry;
    }

    function stateMaterial(pointsOnly) {
      return new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uPointMode: { value: pointsOnly ? 1 : 0 },
          uSprite: { value: particleTexture }
        },
        vertexShader: stateVertex,
        fragmentShader: stateFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      });
    }

    const stateVectors = new THREE.LineSegments(
      stateGeometry(false),
      stateMaterial(false)
    );
    stateVectors.frustumCulled = false;
    scene.add(stateVectors);

    const stateTips = new THREE.Points(
      stateGeometry(true),
      stateMaterial(true)
    );
    stateTips.frustumCulled = false;
    scene.add(stateTips);

    particleField(1960, 1, (i) => {
      const qubit = qubits[i % qubits.length];
      const direction = i % 3 === 0 ? -1 : 1;

      return {
        position: [
          qubit.x - direction * 1.2,
          CHIP_Y + 0.22,
          qubit.z - 1.13
        ],
        end: [
          qubit.x + direction * 1.2,
          CHIP_Y + 0.22,
          qubit.z - 1.13
        ],
        path: [
          random() * TAU,
          0,
          random(),
          range(0.25, 0.65)
        ],
        color: direction > 0 ? 0xf266ff : 0x79eaff,
        size: range(0.018, 0.045)
      };
    }, 0.7);

    particleField(1400, 3, () => ({
      position: [
        range(-10.4, 10.4),
        CHIP_Y + range(0.08, 0.28),
        range(-10.4, 10.4)
      ],
      path: [0, 0, random(), 0],
      color: random() < 0.25 ? 0xb672ff : 0x59d5ff,
      size: range(0.008, 0.022)
    }), 0.38);

    function fitText(context, text, maxWidth, initialSize) {
      let size = initialSize;
      do {
        context.font =
          `${size}px Menlo, Consolas, "Liberation Mono", monospace`;
        if (context.measureText(text).width <= maxWidth) break;
        size -= 1;
      } while (size > 12);
    }

    function addLabel(title, subtitle, color, position, near = 2.8, far = 31) {
      const canvas = document.createElement("canvas");
      canvas.width = 1536;
      canvas.height = 300;

      const context = canvas.getContext("2d");
      context.fillStyle = "rgba(3,8,18,0.91)";
      context.fillRect(0, 0, 1536, 300);
      context.strokeStyle = "rgba(145,189,220,0.32)";
      context.lineWidth = 2;
      context.strokeRect(1, 1, 1534, 298);

      context.fillStyle = color;
      context.fillRect(0, 0, 5, 300);
      context.textBaseline = "middle";

      fitText(context, title, 1430, 65);
      context.fillStyle = color;
      context.fillText(title, 48, 109);

      fitText(context, subtitle, 1430, 29);
      context.fillStyle = "#afc0d4";
      context.fillText(subtitle, 48, 215);

      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: makeCanvasTexture(canvas, true),
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
      labels.push({ sprite, near, far });
    }

    addLabel(
      "Thermal Stage 1: 300K",
      "ROOM-TEMPERATURE VACUUM FEEDTHROUGH",
      "#ffe2b7",
      [4, 95.5, -6],
      4,
      44
    );

    addLabel(
      "50 K / 4 K Radiation Shields",
      "THERMAL ANCHORING + COAXIAL STRAIN RELIEF",
      "#ffdfa3",
      [4, 63, -7],
      3,
      29
    );

    addLabel(
      "4 K Readout Amplification",
      "HEMT AMPLIFIERS ON THE WARMER OUTPUT STAGE",
      "#ffe8bd",
      [-5, 50.8, -7],
      3,
      25
    );

    addLabel(
      "Helium Isotope Loop: 1.4K",
      "ILLUSTRATIVE UPSTREAM SEGMENT / STILL ≈ 0.7 K",
      "#a8e8ff",
      [3, 34, -7],
      3,
      28
    );

    addLabel(
      "100 mK Cold Plate",
      "INTERMEDIATE THERMALIZATION",
      "#bdedff",
      [-3, 7, -6],
      3,
      25
    );

    addLabel(
      "Attenuation Plane: 10mK",
      "MIXING-CHAMBER INPUT FILTERING",
      "#d1efff",
      [3, -11, -6],
      3,
      26
    );

    addLabel(
      "QPU Shield Locked",
      "RF ENCLOSURE + SEPARATE MAGNETIC SHIELD",
      "#ffd99b",
      [-2.5, -25, -6],
      3,
      25
    );

    addLabel(
      "Superconducting Qubit Matrix",
      "ENLARGED CIRCUITS / IDEAL DRIVEN BLOCH STATES",
      "#bcf7ff",
      [0, -43.5, -5],
      4,
      21
    );

    /*
      Physical reference:
      [Bluefors system components](https://bluefors.com/stories/components-of-the-dilution-refrigerator-measurement-system/)
      [Oxford Practical Cryogenics](https://andor.oxinst.com/downloads/uploads/practical-cryogenics.pdf)
      [Integrated quantum measurement system](https://cdn.bluefors.com/wp-content/uploads/2023/09/22150556/Application-Note-Bluefors-Dilution-Refrigerator-as-an-Integrated-Quantum-Measurement-System.pdf)
      [4–8 GHz cryogenic HEMT](https://lownoisefactory.com/product/lnf-lnc4_8g/)
      [IBM Bloch-state representation](https://quantum.cloud.ibm.com/learning/en/courses/utility-scale-quantum-computing/bits-gates-and-circuits)

      Temperatures are nominal references, not measured telemetry.
      The 100 mK cold plate is distinct from the 10 mK mixing chamber.
      Conventional HEMTs are depicted at 4 K.
      RF and magnetic shielding are represented as separate layers.
      Bloch spheres visualize states; they are not physical rotating objects.
      T1 = 120 us and T2 = 90 us are illustrative and obey T2 <= 2*T1.
    */

    const stages = [
      {
        title: "Room-temperature flange",
        description: "Vacuum feedthroughs and silver coaxial control lines.",
        accent: "#ffe1ad",
        caption: "ROOM-TEMPERATURE MICROWAVE CONTROL"
      },
      {
        title: "Radiation shields",
        description: "Separate 50 K and 4 K stages with cable strain relief.",
        accent: "#ffd08a",
        caption: "THERMAL ANCHORING / 50 K → 4 K"
      },
      {
        title: "Still & isotope loop",
        description: "Helium-3 circulation and returning-mixture heat exchange.",
        accent: "#9ddeff",
        caption: "HELIUM ISOTOPE CIRCULATION / STILL ≈ 0.7 K"
      },
      {
        title: "Mixing-chamber approach",
        description: "100 mK thermalization followed by 10 mK input filtering.",
        accent: "#a4e9ff",
        caption: "COLD PLATE → MIXING CHAMBER / 100 mK → 10 mK"
      },
      {
        title: "QPU shielding",
        description: "RF enclosure and separate magnetic shielding layers.",
        accent: "#ffd6a2",
        caption: "RF ISOLATION / MAGNETIC SHIELDING"
      },
      {
        title: "Superconducting qubit array",
        description: "Microwave control, readout resonators and Bloch-state diagrams.",
        accent: "#b8b7ff",
        caption: "SUPERCONDUCTING CIRCUITS / ENLARGED STATE REPRESENTATION"
      }
    ];

    const waypoints = [
      [16, 112, 26],
      [8, 106, 12],
      [1.8, 100, 2],
      [0, 96, 0],
      [0.8, 85, 0.6],
      [-0.8, 68, 0.4],
      [0.6, 49, -0.8],
      [-0.8, 26, -0.5],
      [0.5, 6, 0.7],
      [-0.5, -13, 0.2],
      [0.25, -30, -0.3],
      [0, -40, 0.4],
      [1.3, -45.5, 2]
    ].map((point) => new THREE.Vector3(...point));

    const flightPath = new THREE.CatmullRomCurve3(
      waypoints,
      false,
      "centripetal"
    );

    flightPath.arcLengthDivisions = 4096;
    flightPath.updateArcLengths();

    const pathLength = flightPath.getLength();
    const speedBoundaries = [70, 40, 10, -20, -39];
    const speeds = [2.5, 1.8, 1.35, 1.0, 0.8, 0.35];

    function speedAtY(y) {
      let speed = speeds[0];

      for (let i = 0; i < speedBoundaries.length; i++) {
        const transition = 1 - smoothstep(
          speedBoundaries[i] - 4,
          speedBoundaries[i] + 4,
          y
        );
        speed += (speeds[i + 1] - speeds[i]) * transition;
      }

      return speed;
    }

    const tableSize = 4096;
    const timeTable = new Float64Array(tableSize + 1);
    const samplePoint = new THREE.Vector3();

    flightPath.getPointAt(0, samplePoint);
    let previousSpeed = speedAtY(samplePoint.y);

    for (let i = 1; i <= tableSize; i++) {
      flightPath.getPointAt(i / tableSize, samplePoint);
      const speed = speedAtY(samplePoint.y);
      const distance = pathLength / tableSize;

      timeTable[i] =
        timeTable[i - 1] + distance * 2 / (previousSpeed + speed);

      previousSpeed = speed;
    }

    const travelDuration = timeTable[tableSize];
    const endMessageStart = travelDuration + 2;
    const fadeStart = travelDuration + 13;
    const cycleDuration = travelDuration + 18;
    const resumeDuration = 1.8;

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
    aimingCamera.up.copy(camera.up);

    const desiredPosition = new THREE.Vector3();
    const desiredQuaternion = new THREE.Quaternion();
    const lookTarget = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const chipTarget = new THREE.Vector3(0, CHIP_Y, 0);
    const forward = new THREE.Vector3();

    const resumePosition = new THREE.Vector3();
    const resumeQuaternion = new THREE.Quaternion();

    function sampleCamera(parameter) {
      flightPath.getPointAt(parameter, desiredPosition);

      if (parameter < 0.998) {
        flightPath.getPointAt(
          Math.min(1, parameter + 1.3 / pathLength),
          lookTarget
        );
      } else {
        flightPath.getTangentAt(1, tangent);
        lookTarget.copy(desiredPosition).addScaledVector(tangent, 1.3);
      }

      const finalFocus = smoothstep(0.91, 1, parameter);
      lookTarget.lerp(chipTarget, finalFocus);

      aimingCamera.position.copy(desiredPosition);
      aimingCamera.lookAt(lookTarget);
      desiredQuaternion.copy(aimingCamera.quaternion);
    }

    sampleCamera(0);
    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);
    camera.updateMatrixWorld(true);

    const renderTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: renderTextureType,
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
      0.76,
      0.53,
      hdrAvailable ? 1.12 : 0.88
    );

    for (const target of [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ]) {
      target.texture.type = renderTextureType;
      target.texture.encoding = THREE.LinearEncoding;
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
          vUv=uv;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uFade;
        varying vec2 vUv;

        vec3 filmic(vec3 x) {
          return clamp(
            (x*(2.51*x+0.03)) /
            (x*(2.43*x+0.59)+0.14),
            0.0,
            1.0
          );
        }

        vec3 toDisplay(vec3 x) {
          vec3 low=x*12.92;
          vec3 high=1.055*pow(
            max(x,vec3(0.0)),
            vec3(1.0/2.4)
          )-0.055;

          return mix(low,high,step(vec3(0.0031308),x));
        }

        void main() {
          vec3 color=texture2D(tDiffuse,vUv).rgb*uExposure;
          color=toDisplay(filmic(color));

          vec2 p=vUv*2.0-1.0;
          float vignette=1.0-0.12*smoothstep(0.25,1.8,dot(p,p));

          gl_FragColor=vec4(
            color*vignette*(1.0-uFade),
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
    let resumeElapsed = resumeDuration;
    let lastFrameTime = null;
    let nextUiUpdate = 0;
    let activeStage = -1;
    let pixelRatio = 1;
    let resizePending = false;

    const drawingSize = new THREE.Vector2();
    const projected = new THREE.Vector3();

    const warmLight = linearColor(0xffdeb5);
    const coldLight = linearColor(0x83cfff);
    const warmEmission = linearColor(0xd89135);
    const coldEmission = linearColor(0x165f9e);

    function syncControlsTarget() {
      forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
      controls.target.copy(camera.position).addScaledVector(forward, 12);
    }

    syncControlsTarget();

    /*
      A real PerspectiveCamera provides the correct -Z-forward orientation.
      Automatic and manual modes never write the camera in the same frame.

      r128 reset() clears the active gesture state; disabling damping during
      reset also clears residual rotation and pan:
      https://github.com/mrdoob/three.js/blob/r128/examples/js/controls/OrbitControls.js
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

    function announceMode() {
      ui.mode.textContent = mode === "manual"
        ? (paused ? "MANUAL / PAUSED" : "MANUAL / R TO RESUME")
        : (paused ? "DESCENT PAUSED" : "AUTO DESCENT");
    }

    function resumeDescent() {
      clearControlMotion();

      resumePosition.copy(camera.position);
      resumeQuaternion.copy(camera.quaternion);
      resumeElapsed = 0;

      mode = "auto";
      paused = false;
      lastFrameTime = null;
      announceMode();
    }

    function restartDescent() {
      clearControlMotion();

      flightTime = 0;
      visualTime = 0;
      cycleNumber = 0;
      resumeElapsed = resumeDuration;
      mode = "auto";
      paused = false;
      lastFrameTime = null;

      sampleCamera(0);
      camera.position.copy(desiredPosition);
      camera.quaternion.copy(desiredQuaternion);
      syncControlsTarget();
      camera.updateMatrixWorld(true);

      grade.uniforms.uFade.value = 0;
      endOverlay.hidden = true;
      announceMode();
    }

    controls.addEventListener("start", () => {
      if (mode === "auto") syncControlsTarget();

      mode = "manual";
      resumeElapsed = resumeDuration;
      endOverlay.hidden = true;
      announceMode();
    });

    renderer.domElement.addEventListener("pointerdown", () => {
      renderer.domElement.focus({ preventScroll: true });
    });

    window.addEventListener("keydown", (event) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

      const element = event.target;

      if (
        element instanceof HTMLElement &&
        (
          element.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
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
        resumeDescent();
      } else if (event.code === "Home") {
        event.preventDefault();
        restartDescent();
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

      shared.uPointScale.value =
        drawingSize.y / (2 * tanHalfFov);

      const pixelWidth = Math.min(355, width * 0.82);
      const normalizedWidth =
        2 * tanHalfFov * pixelWidth / height;

      for (const label of labels) {
        label.sprite.scale.set(
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

    function stageAtY(y) {
      if (y > 70) return 0;
      if (y > 40) return 1;
      if (y > 10) return 2;
      if (y > -20) return 3;
      if (y > -39) return 4;
      return 5;
    }

    function thermalReference(index, y) {
      if (index === 0) return ["300", "K"];
      if (index === 1) return y > 54 ? ["50", "K"] : ["4", "K"];
      if (index === 2) return ["0.7", "K"];
      if (index === 3) return y > -3 ? ["100", "mK"] : ["10", "mK"];
      return ["10", "mK"];
    }

    function updateInterface(now, parameter) {
      if (now < nextUiUpdate) return;
      nextUiUpdate = now + 180;

      const index = stageAtY(camera.position.y);
      const stage = stages[index];
      const temperature = thermalReference(index, camera.position.y);

      if (index !== activeStage) {
        activeStage = index;

        document.documentElement.style.setProperty("--accent", stage.accent);
        ui.number.textContent = `${String(index + 1).padStart(2, "0")} / 06`;
        ui.title.textContent = stage.title;
        ui.description.textContent = stage.description;
        ui.caption.textContent = stage.caption;

        for (const row of ui.rows) {
          const active = Number(row.dataset.stage) === index;
          row.dataset.active = String(active);

          if (active) row.setAttribute("aria-current", "step");
          else row.removeAttribute("aria-current");
        }
      }

      ui.temperature.textContent = temperature[0];
      ui.unit.textContent = temperature[1];

      ui.progress.textContent = `${(parameter * 100).toFixed(1)}%`;
      ui.progressFill.style.transform = `scaleX(${parameter})`;

      if (Math.min(window.devicePixelRatio || 1, 2) !== pixelRatio) {
        resize();
      }
    }

    function updateLabels(fade, terminalVisible) {
      for (const label of labels) {
        const sprite = label.sprite;
        const distance = sprite.position.distanceTo(camera.position);

        const nearFade = smoothstep(
          label.near,
          label.near + 3,
          distance
        );

        const farFade = 1 - smoothstep(
          label.far * 0.7,
          label.far,
          distance
        );

        projected.copy(sprite.position).project(camera);

        const inView =
          projected.z > -1 &&
          projected.z < 1 &&
          Math.abs(projected.x) < 1.15 &&
          Math.abs(projected.y) < 1.15;

        sprite.material.opacity =
          uiHidden || terminalVisible || !inView
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
          if (resumeElapsed < resumeDuration) {
            resumeElapsed = Math.min(
              resumeDuration,
              resumeElapsed + delta
            );
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
        if (resumeElapsed < resumeDuration) {
          const blend = smootherstep(resumeElapsed / resumeDuration);

          camera.position.lerpVectors(
            resumePosition,
            desiredPosition,
            blend
          );

          camera.quaternion.slerpQuaternions(
            resumeQuaternion,
            desiredQuaternion,
            blend
          );
        } else {
          camera.position.copy(desiredPosition);

          if (wrapped || delta === 0) {
            camera.quaternion.copy(desiredQuaternion);
          } else if (!paused) {
            camera.quaternion.slerp(
              desiredQuaternion,
              1 - Math.exp(-8 * delta)
            );
          }
        }

        syncControlsTarget();

        // The automatic rig owns this frame; do not call controls.update().
      } else {
        controls.dampingFactor =
          1 - Math.exp(-4.8 * Math.max(delta, 1 / 240));
        controls.update();
      }

      camera.updateMatrixWorld(true);

      const cold = clamp01((100 - camera.position.y) / 150);
      shared.uTime.value = visualTime;
      shared.uCold.value = cold;

      cameraLight.color.lerpColors(warmLight, coldLight, cold);
      cameraLight.intensity = 1.65 + cold * 0.3;

      // Only the atmospheric tint changes; the background remains black.
      scene.fog.color.setRGB(
        0.0007 + cold * 0.0003,
        0.0006 + cold * 0.0011,
        0.0005 + cold * 0.003
      );

      for (const entry of plateMaterials) {
        const proximity = Math.exp(
          -Math.abs(camera.position.y - entry.y) / 16
        );

        entry.material.emissive.lerpColors(
          warmEmission,
          coldEmission,
          cold
        );

        entry.material.emissiveIntensity =
          0.025 + proximity * 0.07;
      }

      for (const ring of animatedRings) {
        const phase = (visualTime * 0.12 + ring.phase) % 1;
        const scale = 1 + phase * 0.11;

        ring.mesh.scale.set(scale, scale, scale);
        ring.mesh.material.opacity =
          Math.sin(phase * Math.PI) * 0.13;
      }

      let fade = 0;

      if (mode === "auto") {
        fade = smoothstep(fadeStart, cycleDuration, flightTime);

        if (cycleNumber > 0) {
          fade = Math.max(
            fade,
            1 - smoothstep(0, 3.5, flightTime)
          );
        }
      }

      const terminalVisible =
        mode === "auto" &&
        resumeElapsed >= resumeDuration &&
        flightTime >= endMessageStart &&
        !uiHidden;

      endOverlay.hidden = !terminalVisible;

      if (terminalVisible) {
        const appearance = smoothstep(
          endMessageStart,
          endMessageStart + 0.65,
          flightTime
        );

        endOverlay.style.opacity = String(appearance * (1 - fade));
      }

      grade.uniforms.uFade.value = fade;

      const interfaceOpacity =
        uiHidden ? 0 : (1 - fade) * (terminalVisible ? 0.12 : 1);

      panel.style.opacity = String(interfaceOpacity);
      caption.style.opacity = String(interfaceOpacity);

      updateLabels(fade, terminalVisible);
      updateInterface(now, parameter);

      renderer.setRenderTarget(null);
      composer.render(delta);

      // Keep annotation lettering outside the bloom pass.
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