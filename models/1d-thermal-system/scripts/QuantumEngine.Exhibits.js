(function () {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  if (window.QuantumEngine.Exhibits) {
    return;
  }

  const TWO_PI = Math.PI * 2;
  const TIME_PERIOD = TWO_PI * 20;
  const CYAN = 0x00dfff;
  const MAGENTA = 0xff168e;
  const EMERALD = 0x00ff91;
  const ELECTRON_COUNT = 12000;

  let initialized = false;
  let root = null;

  const ELECTRON_VERTEX_SHADER = `
    uniform float uTime;
    uniform float uViewportHeight;
    uniform float uMaxPointSize;

    attribute float aPhase;
    attribute float aSize;

    varying float vDensity;
    varying float vOpacity;

    void main() {
      float radius = length(position);

      vec3 jitter = vec3(
        sin(1.1 * uTime + aPhase),
        cos(1.3 * uTime + 1.7 * aPhase),
        sin(1.7 * uTime + 2.3 * aPhase)
      );

      vec3 displaced = position +
        jitter * (0.10 + 0.12 * radius / 7.2);

      vec4 viewPosition = modelViewMatrix * vec4(displaced, 1.0);

      vDensity = exp(-dot(position, position) / 18.0);
      vOpacity = 0.12 + 0.38 * vDensity;

      if (viewPosition.z >= -0.1) {
        vOpacity = 0.0;
        gl_PointSize = 1.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
      }

      float diameter = aSize * (0.16 + 0.20 * vDensity);
      float projectionScale = 0.5 * uViewportHeight *
        abs(projectionMatrix[1][1]) / (-viewPosition.z);

      gl_PointSize = clamp(
        diameter * projectionScale,
        1.0,
        uMaxPointSize
      );

      gl_Position = projectionMatrix * viewPosition;
    }
  `;

  const ELECTRON_FRAGMENT_SHADER = `
    varying float vDensity;
    varying float vOpacity;

    void main() {
      vec2 p = gl_PointCoord * 2.0 - 1.0;
      float r2 = dot(p, p);

      if (r2 >= 1.0 || vOpacity <= 0.0) {
        discard;
      }

      float profile = exp(-4.0 * r2) *
        (1.0 - smoothstep(0.65, 1.0, r2));

      vec3 violet = vec3(0.18, 0.008, 0.65);
      vec3 neonPurple = vec3(0.62, 0.055, 1.0);
      vec3 color = mix(violet, neonPurple, vDensity);

      gl_FragColor = vec4(
        color * (0.8 + 1.2 * vDensity),
        vOpacity * profile
      );

      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }
  `;

  const PHOTON_VERTEX_SHADER = `
    uniform float uTime;
    uniform float uPlane;

    varying float vEnvelope;

    void main() {
      float k = 6.283185307179586 / 9.0;
      float phase = k * position.x - 1.7 * uTime;
      float amplitude = 3.6;
      float displacement = amplitude * sin(phase);
      float derivative = amplitude * k * cos(phase);

      vec2 direction = vec2(1.0 - uPlane, uPlane);
      vec3 tangent = normalize(vec3(1.0, direction * derivative));
      vec3 normal = normalize(vec3(-tangent.y, tangent.x, 0.0));
      vec3 binormal = normalize(cross(tangent, normal));

      vec3 center = vec3(position.x, direction * displacement);
      vec3 displaced = center +
        normal * position.y +
        binormal * position.z;

      vEnvelope = 1.0 - smoothstep(8.0, 9.0, abs(position.x));

      gl_Position = projectionMatrix *
        modelViewMatrix * vec4(displaced, 1.0);
    }
  `;

  const PHOTON_FRAGMENT_SHADER = `
    uniform vec3 uColor;
    varying float vEnvelope;

    void main() {
      gl_FragColor = vec4(uColor * 1.6, 0.90 * vEnvelope);

      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }
  `;

  function seededRandom(seed) {
    let state = seed >>> 0;

    return function random() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return (state + 0.5) / 4294967296;
    };
  }

  function createContext(THREE, resources, uniforms) {
    function own(resource) {
      resources.add(resource);
      return resource;
    }

    function glow(color, opacity) {
      return own(new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide
      }));
    }

    function lineMaterial(color, opacity) {
      return own(new THREE.LineBasicMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      }));
    }

    function mesh(parent, geometry, material, x, y, z) {
      const object = new THREE.Mesh(own(geometry), material);
      object.position.set(x, y, z);
      parent.add(object);
      return object;
    }

    function box(parent, width, height, depth, x, y, z, material, edges) {
      const geometry = own(new THREE.BoxGeometry(width, height, depth));
      const object = mesh(parent, geometry, material, x, y, z);

      if (edges) {
        const outline = new THREE.LineSegments(
          own(new THREE.EdgesGeometry(geometry)),
          edges
        );

        object.add(outline);
      }

      return object;
    }

    function segments(parent, coordinates, material) {
      const geometry = own(new THREE.BufferGeometry());

      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(coordinates, 3)
      );

      const object = new THREE.LineSegments(geometry, material);
      parent.add(object);
      return object;
    }

    function group(parent, name, x, y, z) {
      const object = new THREE.Group();
      object.name = name;
      object.position.set(x, y, z);
      parent.add(object);
      return object;
    }

    return {
      THREE: THREE,
      uniforms: uniforms,
      own: own,
      glow: glow,
      lineMaterial: lineMaterial,
      mesh: mesh,
      box: box,
      segments: segments,
      group: group
    };
  }

  function buildTerrain(ctx, parent) {
    const THREE = ctx.THREE;
    const terrain = ctx.group(parent, "quantum-potential-terrain", 0, 0, 0);

    // These structures illustrate V(x). They do not modify the analytic
    // wavefunction, simulate tunneling, or perform a quantum measurement.
    terrain.userData.affectsWavefunction = false;

    const glass = ctx.glow(CYAN, 0.026);
    const wellGlass = ctx.glow(CYAN, 0.035);
    const rails = ctx.glow(CYAN, 0.45);
    const edges = ctx.lineMaterial(CYAN, 0.48);
    const gridMaterial = ctx.lineMaterial(CYAN, 0.13);

    ctx.box(terrain, 100, 0.08, 0.08, 0, -18, -19, rails);
    ctx.box(terrain, 100, 0.08, 0.08, 0, -18, 19, rails);

    const floorGrid = [];

    for (let x = -50; x <= 50; x += 5) {
      floorGrid.push(x, -18, -19, x, -18, 19);
    }

    ctx.segments(terrain, floorGrid, gridMaterial);

    const well = ctx.group(
      terrain,
      "finite-square-well",
      -26,
      0,
      0
    );

    well.userData.label = "Finite Square Well";
    well.userData.schematic = true;
    well.userData.interval = [-38, -14];

    ctx.box(well, 24, 0.3, 36, 0, -17.5, 0, wellGlass, edges);
    ctx.box(well, 0.55, 35, 36, -12, 0, 0, glass, edges);
    ctx.box(well, 0.55, 35, 36, 12, 0, 0, glass, edges);
    ctx.box(well, 24, 5, 0.22, 0, -15, -18, glass, edges);
    ctx.box(well, 24, 5, 0.22, 0, -15, 18, glass, edges);

    const wellMarkings = [];

    for (let x = -10; x <= 10; x += 2) {
      wellMarkings.push(x, -17.28, -16, x, -17.28, 16);
    }

    ctx.segments(well, wellMarkings, gridMaterial);

    const barrier = ctx.group(
      terrain,
      "potential-barrier",
      8,
      0,
      0
    );

    barrier.userData.label = "Potential Barrier";
    barrier.userData.schematic = true;
    barrier.userData.interval = [6.2, 9.8];

    const barrierGlass = ctx.glow(CYAN, 0.044);

    ctx.box(
      barrier,
      3.6,
      36,
      36,
      0,
      0,
      0,
      barrierGlass,
      edges
    );

    const barrierLines = [];

    for (let y = -16; y <= 16; y += 4) {
      barrierLines.push(-1.82, y, -18, -1.82, y, 18);
      barrierLines.push(1.82, y, -18, 1.82, y, 18);
    }

    ctx.segments(barrier, barrierLines, gridMaterial);

    const barrierScan = ctx.box(
      barrier,
      3.8,
      0.09,
      35.8,
      0,
      0,
      0,
      ctx.glow(CYAN, 0.24)
    );

    const gate = ctx.group(
      terrain,
      "measurement-gate",
      42,
      0,
      0
    );

    gate.rotation.y = Math.PI * 0.5;
    gate.userData.label = "Measurement Gate";
    gate.userData.schematic = true;

    const gateMaterial = ctx.glow(CYAN, 0.72);

    ctx.mesh(
      gate,
      new THREE.TorusGeometry(18.7, 0.14, 8, 128),
      gateMaterial,
      0,
      0,
      0
    );

    ctx.mesh(
      gate,
      new THREE.TorusGeometry(17.7, 0.055, 6, 128),
      rails,
      0,
      0,
      0
    );

    const housingMaterial = ctx.own(new THREE.MeshBasicMaterial({
      color: 0x03131c
    }));

    for (let index = 0; index < 4; index += 1) {
      const angle = index * Math.PI * 0.5;

      const housing = ctx.box(
        gate,
        2.1,
        1.2,
        1.8,
        Math.cos(angle) * 18.7,
        Math.sin(angle) * 18.7,
        0,
        housingMaterial,
        edges
      );

      housing.rotation.z = angle;
    }

    const ticks = [];

    for (let index = 0; index < 48; index += 1) {
      const angle = TWO_PI * index / 48;
      const inner = index % 4 === 0 ? 16.8 : 17.2;

      ticks.push(
        Math.cos(angle) * inner,
        Math.sin(angle) * inner,
        0.05,
        Math.cos(angle) * 17.6,
        Math.sin(angle) * 17.6,
        0.05
      );
    }

    ctx.segments(gate, ticks, edges);

    const scanner = ctx.group(
      gate,
      "measurement-scanner",
      0,
      0,
      0.4
    );

    ctx.box(
      scanner,
      34,
      0.07,
      0.07,
      0,
      0,
      0,
      ctx.glow(CYAN, 0.65)
    );

    ctx.box(
      scanner,
      34,
      0.32,
      0.06,
      0,
      0,
      0,
      ctx.glow(CYAN, 0.045)
    );

    ctx.mesh(
      scanner,
      new THREE.TorusGeometry(17.35, 0.065, 6, 48, Math.PI / 3),
      gateMaterial,
      0,
      0,
      0
    );

    return {
      wellGlass: wellGlass,
      barrierGlass: barrierGlass,
      barrierScan: barrierScan,
      gateMaterial: gateMaterial,
      scanner: scanner
    };
  }

  function buildPedestal(ctx, parent) {
    const THREE = ctx.THREE;
    const ringMaterial = ctx.glow(CYAN, 0.23);

    const ring = ctx.mesh(
      parent,
      new THREE.TorusGeometry(10, 0.065, 6, 96),
      ringMaterial,
      0,
      -10,
      0
    );

    ring.rotation.x = Math.PI * 0.5;

    const lowerRing = ctx.mesh(
      parent,
      new THREE.TorusGeometry(9.6, 0.035, 6, 96),
      ringMaterial,
      0,
      -10.6,
      0
    );

    lowerRing.rotation.x = Math.PI * 0.5;

    const markings = [];

    for (let index = 0; index < 32; index += 1) {
      const angle = TWO_PI * index / 32;

      markings.push(
        Math.cos(angle) * 9.4,
        -10,
        Math.sin(angle) * 9.4,
        Math.cos(angle) * 10,
        -10,
        Math.sin(angle) * 10
      );
    }

    ctx.segments(
      parent,
      markings,
      ctx.lineMaterial(CYAN, 0.28)
    );
  }

  function buildElectron(ctx, gallery) {
    const THREE = ctx.THREE;

    const bay = ctx.group(
      gallery,
      "electron-probability-cloud",
      -34,
      0,
      0
    );

    bay.userData.label = "Electron Probability Cloud";
    bay.userData.schematic = true;

    buildPedestal(ctx, bay);

    const motion = ctx.group(
      bay,
      "electron-cloud-motion",
      0,
      0,
      0
    );

    const random = seededRandom(0xe1ec710);
    const positions = new Float32Array(ELECTRON_COUNT * 3);
    const phases = new Float32Array(ELECTRON_COUNT);
    const sizes = new Float32Array(ELECTRON_COUNT);

    function gaussian() {
      return Math.sqrt(-2 * Math.log(random())) *
        Math.cos(TWO_PI * random());
    }

    // A truncated Gaussian cloud provides a dense spherical silhouette.
    // Its decorative jitter is not an electron trajectory.
    for (let index = 0; index < ELECTRON_COUNT; index += 1) {
      let x;
      let y;
      let z;

      do {
        x = gaussian() * 2.45;
        y = gaussian() * 2.45;
        z = gaussian() * 2.45;
      } while (x * x + y * y + z * z > 7.2 * 7.2);

      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;

      phases[index] = random() * TWO_PI;
      sizes[index] = 0.65 + random() * 0.85;
    }

    const geometry = ctx.own(new THREE.BufferGeometry());

    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
      "aPhase",
      new THREE.BufferAttribute(phases, 1)
    );

    geometry.setAttribute(
      "aSize",
      new THREE.BufferAttribute(sizes, 1)
    );

    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      8.4
    );

    const material = ctx.own(new THREE.ShaderMaterial({
      name: "ElectronProbabilityCloudMaterial",
      uniforms: ctx.uniforms,
      vertexShader: ELECTRON_VERTEX_SHADER,
      fragmentShader: ELECTRON_FRAGMENT_SHADER,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    }));

    const cloud = new THREE.Points(geometry, material);
    cloud.name = "electron-cloud-points";

    motion.add(cloud);

    return motion;
  }

  function buildPhoton(ctx, gallery) {
    const THREE = ctx.THREE;

    const bay = ctx.group(
      gallery,
      "photon-transverse-wave",
      0,
      0,
      0
    );

    bay.userData.label = "Photon Transverse Wave";
    bay.userData.schematic = true;

    buildPedestal(ctx, bay);

    const motion = ctx.group(
      bay,
      "photon-field-motion",
      0,
      0,
      0
    );

    const path = new THREE.LineCurve3(
      new THREE.Vector3(-9, 0, 0),
      new THREE.Vector3(9, 0, 0)
    );

    const geometry = ctx.own(
      new THREE.TubeGeometry(path, 384, 0.11, 6, false)
    );

    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(),
      11
    );

    // E and B are transverse, orthogonal, and in phase.
    // Their displayed amplitudes are normalized independently.
    const colors = [0xffdf20, 0xffb82e];

    const names = [
      "photon-electric-field",
      "photon-magnetic-field"
    ];

    for (let plane = 0; plane < 2; plane += 1) {
      const material = ctx.own(new THREE.ShaderMaterial({
        name: names[plane] + "-material",
        uniforms: {
          uTime: ctx.uniforms.uTime,
          uPlane: { value: plane },
          uColor: { value: new THREE.Color(colors[plane]) }
        },
        vertexShader: PHOTON_VERTEX_SHADER,
        fragmentShader: PHOTON_FRAGMENT_SHADER,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: true
      }));

      const field = new THREE.Mesh(geometry, material);
      field.name = names[plane];

      motion.add(field);
    }

    ctx.segments(
      motion,
      [-10, 0, 0, 10, 0, 0],
      ctx.lineMaterial(0xffcf40, 0.24)
    );

    return motion;
  }

  function buildGluon(ctx, gallery) {
    const THREE = ctx.THREE;

    const bay = ctx.group(
      gallery,
      "gluon-flux-tube",
      34,
      0,
      0
    );

    bay.userData.label = "Gluon Flux Tube";
    bay.userData.schematic = true;

    buildPedestal(ctx, bay);

    const motion = ctx.group(
      bay,
      "gluon-confinement-model",
      0,
      0,
      0
    );

    // Springs and colored spheres are a confinement analogy, not a QCD solver.
    class SpringCurve extends THREE.Curve {
      constructor(start, end, phase) {
        super();

        this.start = start.clone();
        this.end = end.clone();
        this.phase = phase;
        this.arcLengthDivisions = 480;

        const axis = new THREE.Vector3()
          .subVectors(end, start)
          .normalize();

        const reference = Math.abs(axis.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);

        this.normal = new THREE.Vector3()
          .crossVectors(axis, reference)
          .normalize();

        this.binormal = new THREE.Vector3()
          .crossVectors(axis, this.normal)
          .normalize();
      }

      getPoint(t, target) {
        const point = target || new THREE.Vector3();
        const angle = TWO_PI * 7 * t + this.phase;
        const radius = 0.55 * Math.sin(Math.PI * t);

        point.lerpVectors(this.start, this.end, t);
        point.addScaledVector(this.normal, Math.cos(angle) * radius);
        point.addScaledVector(this.binormal, Math.sin(angle) * radius);

        return point;
      }
    }

    const centers = [
      new THREE.Vector3(-5.2, -3.3, 0),
      new THREE.Vector3(5.2, -3.3, 0),
      new THREE.Vector3(0, 5.5, 0)
    ];

    const magentaMaterial = ctx.glow(MAGENTA, 0.76);
    const emeraldMaterial = ctx.glow(EMERALD, 0.66);

    for (let edge = 0; edge < 3; edge += 1) {
      const start = centers[edge];
      const end = centers[(edge + 1) % 3];

      const magentaPath = new SpringCurve(start, end, 0);
      const emeraldPath = new SpringCurve(start, end, Math.PI);

      ctx.mesh(
        motion,
        new THREE.TubeGeometry(magentaPath, 192, 0.095, 6, false),
        magentaMaterial,
        0,
        0,
        0
      );

      ctx.mesh(
        motion,
        new THREE.TubeGeometry(emeraldPath, 192, 0.07, 6, false),
        emeraldMaterial,
        0,
        0,
        0
      );
    }

    const sphereGeometry = ctx.own(
      new THREE.SphereGeometry(1.05, 24, 16)
    );

    const haloGeometry = ctx.own(
      new THREE.SphereGeometry(1.65, 20, 12)
    );

    const quarks = [];

    for (let index = 0; index < centers.length; index += 1) {
      const center = centers[index];
      const color = index === 1 ? EMERALD : MAGENTA;

      const quark = ctx.group(
        motion,
        "quark-" + (index + 1),
        center.x,
        center.y,
        center.z
      );

      const coreMaterial = ctx.glow(color, 0.92);
      const haloMaterial = ctx.glow(color, 0.095);

      ctx.mesh(
        quark,
        sphereGeometry,
        coreMaterial,
        0,
        0,
        0
      );

      ctx.mesh(
        quark,
        haloGeometry,
        haloMaterial,
        0,
        0,
        0
      );

      quarks.push({
        object: quark,
        halo: haloMaterial,
        phase: TWO_PI * index / 3
      });
    }

    return {
      motion: motion,
      quarks: quarks,
      magentaMaterial: magentaMaterial,
      emeraldMaterial: emeraldMaterial
    };
  }

  function init() {
    if (initialized) {
      return root;
    }

    const THREE = window.THREE;
    const core = window.QuantumEngine.Core;

    if (!THREE || !core) {
      throw new Error(
        "[QuantumEngine.Exhibits] Three.js and QuantumEngine.Core must load first."
      );
    }

    if (!core.getScene()) {
      core.init();
    }

    const scene = core.getScene();
    const renderer = core.getRenderer();

    if (!scene || !renderer) {
      throw new Error(
        "[QuantumEngine.Exhibits] The graphics core is not initialized."
      );
    }

    const resources = new Set();
    let unregisterUpdate = null;

    try {
      const drawingBufferSize = new THREE.Vector2();
      renderer.getDrawingBufferSize(drawingBufferSize);

      const gl = renderer.getContext();
      const pointRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);

      const uniforms = {
        uTime: { value: 0 },
        uViewportHeight: {
          value: Math.max(1, drawingBufferSize.y)
        },
        uMaxPointSize: {
          value: pointRange
            ? Math.max(1, Math.min(72, pointRange[1]))
            : 64
        }
      };

      const ctx = createContext(THREE, resources, uniforms);

      root = new THREE.Group();
      root.name = "quantum-exhibits";
      root.userData.schematic = true;

      const terrain = buildTerrain(ctx, root);

      const gallery = ctx.group(
        root,
        "quantum-side-gallery",
        0,
        28,
        -40
      );

      const electron = buildElectron(ctx, gallery);
      const photon = buildPhoton(ctx, gallery);
      const gluon = buildGluon(ctx, gallery);

      let elapsedTime = 0;

      function update(deltaTime) {
        if (Number.isFinite(deltaTime) && deltaTime > 0) {
          elapsedTime = (elapsedTime + deltaTime) % TIME_PERIOD;
        }

        uniforms.uTime.value = elapsedTime;

        renderer.getDrawingBufferSize(drawingBufferSize);

        uniforms.uViewportHeight.value = Math.max(
          1,
          drawingBufferSize.y
        );

        terrain.wellGlass.opacity = 0.032 +
          0.008 * Math.sin(elapsedTime * 0.5);

        terrain.barrierGlass.opacity = 0.044 +
          0.012 * Math.sin(elapsedTime * 0.7);

        terrain.barrierScan.position.y =
          16 * Math.sin(elapsedTime * 0.35);

        terrain.scanner.rotation.z = elapsedTime * 0.5;

        terrain.gateMaterial.opacity = 0.64 +
          0.12 * Math.sin(elapsedTime * 1.5);

        electron.rotation.y = elapsedTime * 0.15;
        electron.rotation.z = 0.12 * Math.sin(elapsedTime * 0.25);

        photon.rotation.y = 0.25 * Math.sin(elapsedTime * 0.2);
        photon.rotation.x = 0.18 * Math.sin(elapsedTime * 0.15);

        gluon.motion.rotation.y = elapsedTime * 0.2;
        gluon.motion.rotation.z = 0.08 * Math.sin(elapsedTime * 0.3);

        gluon.magentaMaterial.opacity = 0.63 +
          0.18 * Math.sin(elapsedTime * 2.0);

        gluon.emeraldMaterial.opacity = 0.59 +
          0.18 * Math.sin(elapsedTime * 2.0 + Math.PI);

        for (let index = 0; index < gluon.quarks.length; index += 1) {
          const quark = gluon.quarks[index];
          const pulse = Math.sin(elapsedTime * 2.3 + quark.phase);

          quark.object.scale.setScalar(1 + 0.12 * pulse);
          quark.halo.opacity = 0.095 + 0.035 * pulse;
        }
      }

      update(0);

      scene.add(root);
      unregisterUpdate = core.registerUpdateCallback(update);

      initialized = true;
      return root;
    } catch (error) {
      if (unregisterUpdate) {
        unregisterUpdate();
      }

      if (root && root.parent) {
        root.parent.remove(root);
      }

      resources.forEach(function dispose(resource) {
        resource.dispose();
      });

      root = null;
      initialized = false;

      throw error;
    }
  }

  function start() {
    try {
      init();
    } catch (error) {
      console.error(
        "[QuantumEngine.Exhibits] Initialization failed.",
        error
      );

      const status = document.getElementById("engine-status");

      if (status) {
        status.textContent = "Exhibit initialization failed";
      }
    }
  }

  window.QuantumEngine.Exhibits = { init };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}());