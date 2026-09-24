(() => {
  'use strict';

  const container = document.getElementById('canvas-container');
  const statusElement = document.getElementById('render-status');

  function showStatus(message) {
    statusElement.textContent = message;
    statusElement.hidden = !message;
  }

  if (!window.THREE || !window.THREE.OrbitControls) {
    showStatus(
      'The 3D libraries could not load. Check your connection and reload.'
    );
    return;
  }

  const THREE = window.THREE;

  const PARAMETERS = Object.freeze({
    hubbleRadius: 14.5,
    eventRadius: 16.7,
    particleRadius: 46.5,
    background: 0x020208,
    fogDensity: 0.0027,
    uniformParticleCount: 5000,
    anchorCount: 155,
    filamentParticlesPerEdge: 72,
    clusterParticlesPerAnchor: 36,
    seed: 260910
  });

  document.getElementById('observable-diameter').textContent =
    String(PARAMETERS.particleRadius * 2);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PARAMETERS.background);
  scene.fog = new THREE.FogExp2(
    PARAMETERS.background,
    PARAMETERS.fogDensity
  );

  const camera = new THREE.PerspectiveCamera(
    48,
    window.innerWidth / Math.max(window.innerHeight, 1),
    0.05,
    1200
  );

  let renderer;

  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      precision: 'highp'
    });
  } catch (error) {
    showStatus(
      'WebGL is unavailable. Enable hardware acceleration or use a WebGL-capable browser.'
    );
    console.error(error);
    return;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(PARAMETERS.background, 1);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute(
    'aria-label',
    'Interactive three-dimensional cosmic horizons. Drag to orbit, scroll to zoom, and right-drag to pan.'
  );

  container.appendChild(renderer.domElement);

  const controls = new THREE.OrbitControls(
    camera,
    renderer.domElement
  );

  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.055;
  controls.rotateSpeed = 0.45;
  controls.zoomSpeed = 0.8;
  controls.panSpeed = 0.7;
  controls.screenSpacePanning = true;

  controls.enableRotate = true;
  controls.enableZoom = true;
  controls.enablePan = true;

  controls.minDistance = 0.65;
  controls.maxDistance = 420;

  controls.mouseButtons = {
    LEFT: THREE.MOUSE.ROTATE,
    MIDDLE: THREE.MOUSE.DOLLY,
    RIGHT: THREE.MOUSE.PAN
  };

  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN
  };

  if (typeof controls.listenToKeyEvents === 'function') {
    controls.listenToKeyEvents(renderer.domElement);
  }

  renderer.domElement.addEventListener('pointerdown', () => {
    renderer.domElement.focus({ preventScroll: true });
  });

  renderer.domElement.addEventListener('contextmenu', event => {
    event.preventDefault();
  });

  let userHasInteracted = false;

  controls.addEventListener('start', () => {
    userHasInteracted = true;
  });

  const initialDirection = new THREE.Vector3(1.25, 0.72, 1.6).normalize();

  function fittingDistance() {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(
      Math.tan(verticalFov / 2) * camera.aspect
    );

    const limitingFov = Math.min(verticalFov, horizontalFov);

    return (
      PARAMETERS.particleRadius /
      Math.sin(limitingFov / 2)
    ) * 1.14;
  }

  function positionInitialCamera() {
    const distance = fittingDistance();

    camera.position.copy(initialDirection).multiplyScalar(distance);
    camera.lookAt(0, 0, 0);

    controls.maxDistance = Math.max(420, distance * 1.7);
    controls.update();
  }

  positionInitialCamera();

  const shellGroup = new THREE.Group();
  shellGroup.name = 'Cosmic horizon wireframes';
  scene.add(shellGroup);

  function createHorizon({
    radius,
    color,
    opacity,
    segments,
    rings,
    order,
    name
  }) {
    const surface = new THREE.SphereGeometry(
      radius,
      segments,
      rings
    );

    const geometry = new THREE.WireframeGeometry(surface);
    surface.dispose();

    const material = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      linewidth: 1,
      depthTest: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      toneMapped: false
    });

    const wireframe = new THREE.LineSegments(geometry, material);
    wireframe.name = name;
    wireframe.renderOrder = order;

    shellGroup.add(wireframe);
    return wireframe;
  }

  createHorizon({
    radius: PARAMETERS.hubbleRadius,
    color: 0xc3cad8,
    opacity: 0.18,
    segments: 40,
    rings: 24,
    order: 4,
    name: 'Hubble sphere · radius 14.5 Gly'
  });

  createHorizon({
    radius: PARAMETERS.eventRadius,
    color: 0xf3bd57,
    opacity: 0.44,
    segments: 48,
    rings: 28,
    order: 5,
    name: 'Event horizon · radius 16.7 Gly'
  });

  createHorizon({
    radius: PARAMETERS.particleRadius,
    color: 0x32d7ff,
    opacity: 0.23,
    segments: 64,
    rings: 36,
    order: 3,
    name: 'Particle horizon · radius 46.5 Gly'
  });

  function createGlowTexture() {
    const size = 128;
    const textureCanvas = document.createElement('canvas');

    textureCanvas.width = size;
    textureCanvas.height = size;

    const context = textureCanvas.getContext('2d');

    if (!context) {
      return null;
    }

    const half = size / 2;
    const gradient = context.createRadialGradient(
      half, half, 0,
      half, half, half
    );

    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.09, 'rgba(255,255,255,0.98)');
    gradient.addColorStop(0.23, 'rgba(255,255,255,0.48)');
    gradient.addColorStop(0.48, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;

    return texture;
  }

  const glowTexture = createGlowTexture();

  const observer = new THREE.Mesh(
    new THREE.SphereGeometry(0.25, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false,
      toneMapped: false
    })
  );

  observer.name = 'Us – one observer';
  observer.position.set(0, 0, 0);
  observer.renderOrder = 10;
  scene.add(observer);

  if (glowTexture) {
    const observerGlow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0x9bdfff,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        toneMapped: false
      })
    );

    observerGlow.scale.set(2.7, 2.7, 1);
    observerGlow.renderOrder = 9;
    scene.add(observerGlow);
  }

  function seededRandom(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;

      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);

      value ^= value + Math.imul(
        value ^ (value >>> 7),
        61 | value
      );

      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  const random = seededRandom(PARAMETERS.seed);

  function gaussian() {
    return (
      Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) *
      Math.cos(2 * Math.PI * random())
    );
  }

  function randomDirection() {
    const z = random() * 2 - 1;
    const angle = random() * Math.PI * 2;
    const radial = Math.sqrt(Math.max(0, 1 - z * z));

    return new THREE.Vector3(
      radial * Math.cos(angle),
      radial * Math.sin(angle),
      z
    );
  }

  function randomPointInSphere(radius) {
    // Cube-root sampling produces uniform volumetric density.
    return randomDirection().multiplyScalar(
      Math.cbrt(random()) * radius
    );
  }

  const colorStops = [
    { at: 0.00, color: new THREE.Color('#edf8ff').convertSRGBToLinear() },
    { at: 0.28, color: new THREE.Color('#b5dfff').convertSRGBToLinear() },
    { at: 0.57, color: new THREE.Color('#668fff').convertSRGBToLinear() },
    { at: 0.73, color: new THREE.Color('#9c7dd9').convertSRGBToLinear() },
    { at: 0.86, color: new THREE.Color('#f58d87').convertSRGBToLinear() },
    { at: 0.94, color: new THREE.Color('#ff9156').convertSRGBToLinear() },
    { at: 1.00, color: new THREE.Color('#d93547').convertSRGBToLinear() }
  ];

  function radialColor(radius, brightness = 1) {
    const fraction = THREE.MathUtils.clamp(
      radius / PARAMETERS.particleRadius,
      0,
      1
    );

    let lower = colorStops[0];
    let upper = colorStops[colorStops.length - 1];

    for (let i = 1; i < colorStops.length; i++) {
      if (fraction <= colorStops[i].at) {
        lower = colorStops[i - 1];
        upper = colorStops[i];
        break;
      }
    }

    const rawBlend = THREE.MathUtils.clamp(
      (fraction - lower.at) / (upper.at - lower.at),
      0,
      1
    );

    const blend = rawBlend * rawBlend * (3 - 2 * rawBlend);
    const attenuation = 1 - 0.4 * Math.pow(fraction, 4);

    return lower.color.clone()
      .lerp(upper.color, blend)
      .multiplyScalar(brightness * attenuation);
  }

  const positions = [];
  const colors = [];
  const brightPositions = [];
  const brightColors = [];

  const filamentPositions = [];
  const filamentColors = [];

  const limitSquared =
    PARAMETERS.particleRadius * PARAMETERS.particleRadius;

  function appendParticle(position, brightness, bright = false) {
    if (position.lengthSq() >= limitSquared) {
      return;
    }

    const color = radialColor(position.length(), brightness);

    positions.push(position.x, position.y, position.z);
    colors.push(color.r, color.g, color.b);

    if (bright) {
      brightPositions.push(position.x, position.y, position.z);
      brightColors.push(color.r, color.g, color.b);
    }
  }

  // This independent component alone exceeds the required 2,500 nodes.
  for (let i = 0; i < PARAMETERS.uniformParticleCount; i++) {
    const position = randomPointInSphere(
      PARAMETERS.particleRadius * 0.998
    );

    appendParticle(
      position,
      0.5 + random() * 0.65,
      i % 53 === 0
    );
  }

  const anchors = [];

  for (let i = 0; i < PARAMETERS.anchorCount; i++) {
    anchors.push(
      randomPointInSphere(PARAMETERS.particleRadius * 0.955)
    );
  }

  const processedEdges = new Set();

  anchors.forEach((start, startIndex) => {
    const neighbors = anchors
      .map((end, endIndex) => ({
        endIndex,
        distance: start.distanceTo(end)
      }))
      .filter(item =>
        item.endIndex !== startIndex &&
        item.distance < 22
      )
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3);

    neighbors.forEach(({ endIndex, distance }) => {
      const edgeKey =
        Math.min(startIndex, endIndex) + ':' +
        Math.max(startIndex, endIndex);

      if (processedEdges.has(edgeKey)) {
        return;
      }

      processedEdges.add(edgeKey);

      const end = anchors[endIndex];

      const control = start.clone()
        .add(end)
        .multiplyScalar(0.5)
        .add(
          randomDirection().multiplyScalar(distance * 0.12)
        );

      const maximumControlRadius =
        PARAMETERS.particleRadius * 0.975;

      if (control.length() > maximumControlRadius) {
        control.setLength(maximumControlRadius);
      }

      const curve = new THREE.QuadraticBezierCurve3(
        start.clone(),
        control,
        end.clone()
      );

      const samples = curve.getPoints(28);

      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1];
        const b = samples[i];

        const colorA = radialColor(a.length(), 0.6);
        const colorB = radialColor(b.length(), 0.6);

        filamentPositions.push(
          a.x, a.y, a.z,
          b.x, b.y, b.z
        );

        filamentColors.push(
          colorA.r, colorA.g, colorA.b,
          colorB.r, colorB.g, colorB.b
        );
      }

      for (
        let i = 0;
        i < PARAMETERS.filamentParticlesPerEdge;
        i++
      ) {
        const position = curve.getPoint(random());

        position.add(
          new THREE.Vector3(
            gaussian(),
            gaussian(),
            gaussian()
          ).multiplyScalar(0.12 + random() * 0.14)
        );

        appendParticle(
          position,
          0.65 + random() * 0.65,
          i % 47 === 0
        );
      }
    });

    const direction = start.clone().normalize();
    const radialFraction = start.length() / PARAMETERS.particleRadius;
    const stretch = 1 + 2.2 * radialFraction * radialFraction;

    for (
      let i = 0;
      i < PARAMETERS.clusterParticlesPerAnchor;
      i++
    ) {
      const offset = new THREE.Vector3(
        gaussian(),
        gaussian(),
        gaussian()
      ).multiplyScalar(0.3);

      const radialComponent = offset.dot(direction);

      offset.addScaledVector(
        direction,
        radialComponent * (stretch - 1)
      );

      const position = start.clone().add(offset);

      appendParticle(
        position,
        0.85 + random() * 0.65,
        i < 2
      );
    }
  });

  function buildPointCloud({
    positionArray,
    colorArray,
    size,
    opacity,
    name,
    order
  }) {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positionArray, 3)
    );

    geometry.setAttribute(
      'color',
      new THREE.Float32BufferAttribute(colorArray, 3)
    );

    geometry.computeBoundingSphere();

    const material = new THREE.PointsMaterial({
      size,
      sizeAttenuation: true,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity,
      alphaTest: glowTexture ? 0.005 : 0,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: true,
      toneMapped: false
    });

    const cloud = new THREE.Points(geometry, material);
    cloud.name = name;
    cloud.renderOrder = order;

    scene.add(cloud);
    return cloud;
  }

  buildPointCloud({
    positionArray: positions,
    colorArray: colors,
    size: 0.28,
    opacity: 0.9,
    name: 'Volumetric cosmic web',
    order: 1
  });

  buildPointCloud({
    positionArray: brightPositions,
    colorArray: brightColors,
    size: 0.85,
    opacity: 0.42,
    name: 'Supercluster glow',
    order: 2
  });

  const filamentGeometry = new THREE.BufferGeometry();

  filamentGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(filamentPositions, 3)
  );

  filamentGeometry.setAttribute(
    'color',
    new THREE.Float32BufferAttribute(filamentColors, 3)
  );

  filamentGeometry.computeBoundingSphere();

  const filaments = new THREE.LineSegments(
    filamentGeometry,
    new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.065,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      fog: true,
      toneMapped: false
    })
  );

  filaments.name = 'Interconnected galactic filaments';
  filaments.renderOrder = 0;
  scene.add(filaments);

  // Colors depend on radius. Pure rotation leaves every radius unchanged,
  // so the color buffers do not need to be recalculated each frame.
  const motionPreference = window.matchMedia(
    '(prefers-reduced-motion: reduce)'
  );

  let reducedMotion = motionPreference.matches;

  function updateMotionPreference(event) {
    reducedMotion = event.matches;
  }

  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener(
      'change',
      updateMotionPreference
    );
  } else if (typeof motionPreference.addListener === 'function') {
    motionPreference.addListener(updateMotionPreference);
  }

  let frameId = 0;
  let lastFrameTime = 0;
  let contextLost = false;

  function animate(timestamp) {
    if (contextLost || document.hidden) {
      frameId = 0;
      return;
    }

    frameId = requestAnimationFrame(animate);

    const delta = lastFrameTime
      ? Math.min((timestamp - lastFrameTime) / 1000, 0.05)
      : 0;

    lastFrameTime = timestamp;

    if (!reducedMotion) {
      shellGroup.rotation.y += delta * 0.005;
      shellGroup.rotation.z += delta * 0.0009;
    }

    controls.update();
    renderer.render(scene, camera);
  }

  function startAnimation() {
    if (frameId || contextLost || document.hidden) {
      return;
    }

    lastFrameTime = 0;
    frameId = requestAnimationFrame(animate);
  }

  function stopAnimation() {
    if (frameId) {
      cancelAnimationFrame(frameId);
    }

    frameId = 0;
    lastFrameTime = 0;
  }

  function handleResize() {
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, 2)
    );

    renderer.setSize(width, height);

    if (!userHasInteracted) {
      positionInitialCamera();
    }

    controls.maxDistance = Math.max(
      420,
      fittingDistance() * 1.7
    );
  }

  window.addEventListener('resize', handleResize, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopAnimation();
    } else {
      startAnimation();
    }
  });

  renderer.domElement.addEventListener(
    'webglcontextlost',
    event => {
      event.preventDefault();
      contextLost = true;
      stopAnimation();
      showStatus('The graphics context was interrupted. Waiting to restore it…');
    }
  );

  renderer.domElement.addEventListener(
    'webglcontextrestored',
    () => {
      contextLost = false;
      showStatus('');
      handleResize();
      startAnimation();
    }
  );

  startAnimation();
})();