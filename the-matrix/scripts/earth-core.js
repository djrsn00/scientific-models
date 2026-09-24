// scripts/earth-core.js

(function installEarthCore(global) {
  "use strict";

  const engine = (global.NetworkEngine = global.NetworkEngine || {});
  const MODULE_ID = "NetworkEngine.EarthCore";
  const TAU = Math.PI * 2;
  const DEG = Math.PI / 180;

  if (
    engine.EarthCore &&
    engine.EarthCore.moduleId === MODULE_ID &&
    !engine.EarthCore.disposed
  ) {
    engine.EarthCore.init();
    return;
  }

  let THREE = null;
  let radius = 100;
  let earthGroup = null;
  let oceanSphere = null;
  let continentMesh = null;
  let coordinateGrid = null;
  let atmosphere = null;
  let uniforms = null;
  let worldLight = null;
  let initialized = false;
  let initializing = false;
  let disposed = false;
  let unsubscribe = null;
  let registered = false;
  let bootstrapTimer = null;
  let bootstrapDelay = 50;
  let rotationEnabled = true;
  let rotationSpeed = 0.02;
  let lightDirection = [0.65, 0.35, 0.8];

  const ownedGeometries = new Set();
  const ownedMaterials = new Set();

  // Each landform is [longitude, latitude, east radius, north radius, rotation].
  // Radii and rotation are degrees. These analytic outlines are stylized geography.
  const landRegions = [
    {
      center: [-111, 50, 60],
      forms: [
        [-117, 54, 24, 17, -12],
        [-96, 42, 19, 13, 12],
        [-77, 54, 8, 13, -18],
        [-61, 55, 5, 8, -24],
        [-151, 64, 10, 7, -15],
        [-164, 58, 7, 2, 0],
        [-110, 29, 4.7, 11.5, 30],
        [-98, 22, 7, 5, -26],
        [-87, 15, 8, 2.7, -30],
        [-82, 10, 4.5, 1.8, -28],
        [-81, 27, 1.8, 4.5, 16],
        [-78, 21.5, 6.5, 1.15, 10],
        [-71, 19, 3, 1.1, 0]
      ],
      cuts: [
        [-85, 61, 5.2, 6.5, 15],
        [-90, 25, 6, 4, 0]
      ]
    },
    {
      center: [-43, 74, 26],
      forms: [
        [-43, 74, 8, 15, -10],
        [-19, 65, 2.5, 1.5, 0]
      ]
    },
    {
      center: [-60, -20, 49],
      forms: [
        [-64, 1, 13, 8, 0],
        [-52, -9, 15, 11, -15],
        [-63, -24, 13, 19, -12],
        [-71, -43, 3.2, 13, -6],
        [-78, -9, 2.8, 11, 12],
        [-67, -53, 3.5, 2.5, 0]
      ]
    },
    {
      center: [15, 55, 38],
      forms: [
        [-3, 41, 7, 4.5, 0],
        [9, 49, 13, 8, 0],
        [20, 55, 16, 9, 0],
        [18, 65, 4.8, 11, -22],
        [-3, 55, 2, 6, 8],
        [-8, 53, 1.6, 2.6, -8],
        [13, 42, 1.7, 5, 32],
        [24, 41, 5, 3.8, 5],
        [35, 39, 7.5, 3.5, 0],
        [13, 38, 1.4, 0.9, 0],
        [9, 41, 1, 2.5, 0]
      ],
      cuts: [[20, 59, 2, 3.5, -10]]
    },
    {
      center: [92, 49, 70],
      forms: [
        [59, 56, 21, 15, -6],
        [99, 61, 29, 14, 0],
        [136, 63, 14, 10, -10],
        [159, 64, 9, 5, 0],
        [70, 39, 17, 12, -10],
        [104, 39, 20, 14, 0],
        [127, 48, 10, 12, 12],
        [142, 49, 2.6, 8, 12],
        [162, 55, 2.7, 8, 25],
        [127, 37, 2, 5, -16]
      ]
    },
    {
      center: [62, 25, 37],
      forms: [
        [46, 24, 12, 7.5, -28],
        [59, 30, 9, 8, 10],
        [77, 24, 9, 11, 8],
        [78, 17, 4, 9, 10],
        [81, 7, 1.1, 1.8, 15]
      ],
      cuts: [[38, 22, 2, 10, 28]]
    },
    {
      center: [116, 9, 39],
      forms: [
        [99, 21, 7, 13, 14],
        [107, 16, 4.8, 8, -18],
        [102, 6, 1.7, 8, 12],
        [102, -1, 2.4, 9, 42],
        [113, -7.4, 8, 1.3, -4],
        [114, 0, 5.2, 4.2, 0],
        [121, -2, 2, 3.5, 15],
        [121, 15, 2, 4.5, -10],
        [125, 8, 2.6, 2, 20],
        [120, 23.7, 1.1, 2.8, -20],
        [137, -5, 9, 3.5, -7]
      ]
    },
    {
      center: [139, 37, 18],
      forms: [
        [138, 37, 2, 7, -38],
        [142, 43, 2.4, 2, 0],
        [131, 33, 1.8, 2.6, 18]
      ]
    },
    {
      center: [17, 0, 58],
      forms: [
        [2, 15, 20, 13, 0],
        [13, 27, 19, 9, -4],
        [25, 9, 14, 17, -5],
        [24, -14, 12, 17, 15],
        [25, -28, 7, 7, 12],
        [43, 6, 8, 3.4, 28],
        [47, -20, 2.5, 8, -18]
      ],
      cuts: [[38, 22, 2, 10, 28]]
    },
    {
      center: [135, -28, 34],
      forms: [
        [133, -25, 18, 12, -8],
        [144, -21, 5, 10, 14],
        [145, -37, 5, 3, 10],
        [146, -42, 1.7, 2.5, 10]
      ]
    },
    {
      center: [173, -41, 17],
      forms: [
        [175, -38, 1.8, 4.5, -34],
        [170, -44, 1.8, 5, -36]
      ]
    },
    {
      center: [-64, -68, 18],
      forms: [[-64, -66, 2.5, 7, 15]]
    }
  ];

  // Y-up: Greenwich is +X, the North Pole is +Y, and 90 degrees east is -Z.
  function unitPosition(lon, lat) {
    const lambda = lon * DEG;
    const phi = lat * DEG;
    const horizontal = Math.cos(phi);

    return [
      horizontal * Math.cos(lambda),
      Math.sin(phi),
      -horizontal * Math.sin(lambda)
    ];
  }

  function glslFloat(value) {
    return (Math.abs(value) < 0.0000005 ? 0 : value).toFixed(7);
  }

  function glslVector(values) {
    return "vec3(" + values.map(glslFloat).join(", ") + ")";
  }

  function landformExpression(form) {
    const [lon, lat, eastRadius, northRadius, angle] = form;
    const lambda = lon * DEG;
    const phi = lat * DEG;
    const theta = angle * DEG;

    const center = unitPosition(lon, lat);
    const east = [-Math.sin(lambda), 0, -Math.cos(lambda)];
    const north = [
      -Math.sin(phi) * Math.cos(lambda),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(lambda)
    ];

    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const u = [];
    const v = [];

    for (let i = 0; i < 3; i += 1) {
      u.push(
        (east[i] * c + north[i] * s) /
        Math.sin(eastRadius * DEG)
      );
      v.push(
        (north[i] * c - east[i] * s) /
        Math.sin(northRadius * DEG)
      );
    }

    const scale = Math.sin(
      Math.min(eastRadius, northRadius) * DEG
    );

    return (
      "landform(p, " +
      glslVector(center) + ", " +
      glslVector(u) + ", " +
      glslVector(v) + ", " +
      glslFloat(scale) + ")"
    );
  }

  function buildContinentalField() {
    const lines = [
      "float continentalField(vec3 p) {",
      "  float field = (-0.94 - p.y) * 1.6;"
    ];

    for (const region of landRegions) {
      const [lon, lat, extent] = region.center;

      lines.push(
        "  if (dot(p, " +
          glslVector(unitPosition(lon, lat)) + ") > " +
          glslFloat(Math.cos(extent * DEG)) + ") {",
        "    float regionField = -1.0;"
      );

      for (const form of region.forms) {
        lines.push(
          "    regionField = smoothUnion(regionField, " +
            landformExpression(form) + ", 0.004);"
        );
      }

      for (const cut of region.cuts || []) {
        lines.push(
          "    regionField = min(regionField, -" +
            landformExpression(cut) + ");"
        );
      }

      lines.push(
        "    field = max(field, regionField);",
        "  }"
      );
    }

    lines.push("  return field;", "}");
    return lines.join("\n");
  }

  const vertexShader = `
    varying vec3 vSpherePosition;
    varying vec3 vNormal;
    varying vec3 vViewPosition;

    void main() {
      vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);

      vSpherePosition = normalize(position);
      vNormal = normalize(normalMatrix * normal);
      vViewPosition = -viewPosition.xyz;

      gl_Position = projectionMatrix * viewPosition;
    }
  `;

  function buildSurfaceFragment(outputChunk) {
    return `
      uniform float time;
      uniform vec3 lightDirectionView;
      uniform vec3 landDark;
      uniform vec3 landLight;
      uniform vec3 coastGreen;
      uniform vec3 coastBright;

      varying vec3 vSpherePosition;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      float smoothUnion(float a, float b, float k) {
        float h = clamp(
          0.5 + 0.5 * (a - b) / k,
          0.0,
          1.0
        );

        return mix(b, a, h) + k * h * (1.0 - h);
      }

      float landform(
        vec3 p,
        vec3 center,
        vec3 eastAxis,
        vec3 northAxis,
        float scale
      ) {
        vec2 local = vec2(
          dot(p, eastAxis),
          dot(p, northAxis)
        );

        float ellipse = (1.0 - length(local)) * scale;

        return min(ellipse, dot(p, center));
      }

      ${buildContinentalField()}

      float coastlineNoise(vec3 p) {
        float broad =
          sin(dot(p, vec3(37.0, 17.0, 29.0))) *
          sin(dot(p, vec3(-13.0, 41.0, 23.0)));

        float medium =
          sin(dot(p, vec3(93.0, -53.0, 67.0)));

        float fine =
          sin(dot(p, vec3(-181.0, 131.0, 79.0)));

        return
          broad * 0.0035 +
          medium * 0.0015 +
          fine * 0.00065;
      }

      void main() {
        vec3 p = normalize(vSpherePosition);
        vec3 normal = normalize(vNormal);

        float field =
          continentalField(p) + coastlineNoise(p);

        float pixelWidth = 0.0012;

        #if defined(GL_OES_standard_derivatives) || (__VERSION__ >= 300)
          pixelWidth = clamp(
            fwidth(field),
            0.00065,
            0.012
          );
        #endif

        float edgeWidth = max(0.0015, pixelWidth);

        float landMask = smoothstep(
          -pixelWidth,
          pixelWidth,
          field
        );

        float coast = 1.0 - smoothstep(
          edgeWidth * 0.45,
          edgeWidth * 2.1,
          abs(field)
        );

        float halo = 1.0 - smoothstep(
          edgeWidth,
          edgeWidth * 5.0,
          abs(field)
        );

        if (field < -edgeWidth * 5.0) {
          discard;
        }

        float day = smoothstep(
          -0.45,
          0.70,
          dot(normal, normalize(lightDirectionView))
        );

        float grain = 0.5 + 0.5 *
          sin(dot(p, vec3(29.0, 13.0, -19.0))) *
          sin(dot(p, vec3(-17.0, 23.0, 31.0)));

        float scan =
          0.96 + 0.04 * sin(p.y * 740.0 + time * 0.8);

        float shimmer = 0.94 + 0.06 *
          sin(time * 0.55 + dot(p, vec3(11.0, 7.0, 13.0)));

        vec3 land = mix(
          landDark,
          landLight,
          grain * 0.72
        );

        land *= mix(0.24, 1.0, day) * scan * landMask;

        vec3 edgeColor = mix(
          coastGreen,
          coastBright,
          grain
        );

        vec3 edge = edgeColor *
          (coast * 0.72 + halo * 0.065);

        edge *= mix(0.42, 1.0, day) * shimmer;

        gl_FragColor = vec4(land + edge, 1.0);

        ${outputChunk}
      }
    `;
  }

  function buildAtmosphereFragment(outputChunk) {
    return `
      uniform float time;
      uniform vec3 cyan;
      uniform vec3 green;
      uniform vec3 lightDirectionView;

      varying vec3 vSpherePosition;
      varying vec3 vNormal;
      varying vec3 vViewPosition;

      void main() {
        vec3 normal = normalize(vNormal);
        vec3 viewDirection = normalize(vViewPosition);

        float facing = clamp(
          dot(normal, viewDirection),
          0.0,
          1.0
        );

        float fresnel = pow(1.0 - facing, 3.0);

        float silhouetteFade = smoothstep(
          0.0,
          0.12,
          facing
        );

        float day = smoothstep(
          -0.55,
          0.65,
          dot(normal, normalize(lightDirectionView))
        );

        float breath =
          0.93 + 0.07 * sin(time * 0.65);

        float hue = clamp(
          0.35 +
          0.25 * normalize(vSpherePosition).y +
          0.15 * day,
          0.0,
          1.0
        );

        vec3 rimColor = mix(cyan, green, hue);

        float alpha =
          fresnel *
          silhouetteFade *
          breath *
          mix(0.28, 0.46, day);

        gl_FragColor = vec4(rimColor, alpha);

        ${outputChunk}
      }
    `;
  }

  function ownGeometry(geometry) {
    ownedGeometries.add(geometry);
    return geometry;
  }

  function ownMaterial(material) {
    ownedMaterials.add(material);
    return material;
  }

  function makeGridLayer(name, positions, color, opacity) {
    const geometry = ownGeometry(new THREE.BufferGeometry());

    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3)
    );

    geometry.computeBoundingSphere();

    const material = ownMaterial(
      new THREE.LineBasicMaterial({
        color,
        opacity,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: true,
        depthWrite: false,
        toneMapped: false
      })
    );

    const lines = new THREE.LineSegments(geometry, material);
    lines.name = name;
    lines.renderOrder = 2;

    return lines;
  }

  function appendPoint(positions, lat, lon, gridRadius) {
    const point = unitPosition(lon, lat);

    positions.push(
      point[0] * gridRadius,
      point[1] * gridRadius,
      point[2] * gridRadius
    );
  }

  function appendParallel(positions, latitude, gridRadius) {
    const segments = 192;

    for (let i = 0; i < segments; i += 1) {
      appendPoint(
        positions,
        latitude,
        -180 + i * 360 / segments,
        gridRadius
      );

      appendPoint(
        positions,
        latitude,
        -180 + (i + 1) * 360 / segments,
        gridRadius
      );
    }
  }

  function appendMeridian(positions, longitude, gridRadius) {
    const segments = 128;

    for (let i = 0; i < segments; i += 1) {
      appendPoint(
        positions,
        -90 + i * 180 / segments,
        longitude,
        gridRadius
      );

      appendPoint(
        positions,
        -90 + (i + 1) * 180 / segments,
        longitude,
        gridRadius
      );
    }
  }

  function createCoordinateGrid() {
    const grid = new THREE.Group();
    const standard = [];
    const primary = [];
    const tropical = [];
    const gridRadius = radius * 1.002;

    grid.name = "coordinateGrid";

    for (let lat = -75; lat <= 75; lat += 15) {
      if (lat !== 0) {
        appendParallel(standard, lat, gridRadius);
      }
    }

    for (let lon = -180; lon < 180; lon += 15) {
      if (lon !== 0) {
        appendMeridian(standard, lon, gridRadius);
      }
    }

    appendParallel(primary, 0, gridRadius);
    appendMeridian(primary, 0, gridRadius);

    appendParallel(tropical, 23.4393, gridRadius);
    appendParallel(tropical, -23.4393, gridRadius);

    grid.add(
      makeGridLayer(
        "standardParallelsAndMeridians",
        standard,
        0x00ff66,
        0.08
      ),
      makeGridLayer(
        "equatorAndPrimeMeridian",
        primary,
        0x00ff66,
        0.15
      ),
      makeGridLayer(
        "tropics",
        tropical,
        0x00f0ff,
        0.11
      )
    );

    return grid;
  }

  function syncLight(renderer, scene, camera) {
    if (!uniforms || !worldLight) {
      return;
    }

    uniforms.lightDirectionView.value
      .copy(worldLight)
      .transformDirection(camera.matrixWorldInverse);
  }

  // The engine supplies seconds and owns the sole requestAnimationFrame loop.
  function animationHook(delta, elapsed) {
    if (!initialized || disposed) {
      return;
    }

    const dt = Number.isFinite(delta) && delta > 0
      ? Math.min(delta, 0.1)
      : 0;

    if (rotationEnabled) {
      earthGroup.rotation.y =
        (earthGroup.rotation.y + rotationSpeed * dt) % TAU;
    }

    uniforms.time.value =
      Number.isFinite(elapsed) && elapsed >= 0
        ? elapsed
        : uniforms.time.value + dt;
  }

  function stopBootstrap() {
    if (bootstrapTimer !== null) {
      global.clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }

    global.removeEventListener(
      "NetworkEngine:Ready",
      tryBootstrap
    );

    if (global.document) {
      global.document.removeEventListener(
        "DOMContentLoaded",
        tryBootstrap
      );
    }
  }

  function readRadius() {
    const constants =
      engine.DataContract && engine.DataContract.constants;

    const candidates = constants
      ? [constants.RADIUS_EARTH, constants.PLANET_RADIUS]
      : [];

    for (const candidate of candidates) {
      if (Number.isFinite(candidate) && candidate > 0) {
        return candidate;
      }
    }

    return 100;
  }

  function init() {
    if (initialized) {
      return true;
    }

    if (disposed || initializing) {
      return false;
    }

    const three = global.THREE;

    if (
      !three ||
      !engine.scene ||
      typeof engine.scene.add !== "function" ||
      typeof engine.registerHook !== "function"
    ) {
      return false;
    }

    initializing = true;
    THREE = three;
    radius = readRadius();

    try {
      const chunks = THREE.ShaderChunk || {};

      const outputChunk = chunks.colorspace_fragment
        ? "#include <colorspace_fragment>"
        : chunks.encodings_fragment
          ? "#include <encodings_fragment>"
          : "";

      worldLight = new THREE.Vector3(
        lightDirection[0],
        lightDirection[1],
        lightDirection[2]
      ).normalize();

      uniforms = {
        time: { value: 0 },
        lightDirectionView: { value: worldLight.clone() },
        landDark: { value: new THREE.Color(0x001a0a) },
        landLight: { value: new THREE.Color(0x003311) },
        coastGreen: { value: new THREE.Color(0x00ff66) },
        coastBright: { value: new THREE.Color(0x33ff88) }
      };

      const sphereGeometry = ownGeometry(
        new THREE.SphereGeometry(radius, 128, 96)
      );

      const oceanMaterial = ownMaterial(
        new THREE.ShaderMaterial({
          vertexShader,
          fragmentShader: `
            void main() {
              gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
            }
          `,
          depthTest: true,
          depthWrite: true,
          toneMapped: false
        })
      );

      const continentMaterial = ownMaterial(
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader,
          fragmentShader: buildSurfaceFragment(outputChunk),
          depthTest: true,
          depthWrite: true,
          toneMapped: false
        })
      );

      // Older WebGL 1 builds enable derivatives through this material flag.
      if (continentMaterial.extensions) {
        continentMaterial.extensions.derivatives = true;
      }

      const atmosphereMaterial = ownMaterial(
        new THREE.ShaderMaterial({
          uniforms: {
            time: uniforms.time,
            lightDirectionView: uniforms.lightDirectionView,
            cyan: { value: new THREE.Color(0x00f0ff) },
            green: { value: new THREE.Color(0x00ff66) }
          },
          vertexShader,
          fragmentShader: buildAtmosphereFragment(outputChunk),
          side: THREE.FrontSide,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthTest: true,
          depthWrite: false,
          toneMapped: false
        })
      );

      earthGroup = new THREE.Group();
      earthGroup.name = "earthGroup";
      earthGroup.userData.radius = radius;
      earthGroup.userData.coordinateSystem =
        "Y_UP_GREENWICH_POSITIVE_X_EAST_NEGATIVE_Z";

      oceanSphere = new THREE.Mesh(
        sphereGeometry,
        oceanMaterial
      );
      oceanSphere.name = "oceanSphere";

      continentMesh = new THREE.Mesh(
        sphereGeometry,
        continentMaterial
      );
      continentMesh.name = "continentMesh";
      continentMesh.scale.setScalar(1.0005);
      continentMesh.renderOrder = 1;
      continentMesh.onBeforeRender = syncLight;

      coordinateGrid = createCoordinateGrid();

      atmosphere = new THREE.Mesh(
        sphereGeometry,
        atmosphereMaterial
      );
      atmosphere.name = "atmosphere";
      atmosphere.scale.setScalar(1.025);
      atmosphere.renderOrder = 3;
      atmosphere.onBeforeRender = syncLight;

      earthGroup.add(
        oceanSphere,
        continentMesh,
        coordinateGrid,
        atmosphere
      );

      engine.scene.add(earthGroup);

      initialized = true;

      const registration = engine.registerHook(animationHook);
      registered = true;

      if (
        typeof registration === "function" &&
        registration !== animationHook
      ) {
        unsubscribe = registration;
      }

      stopBootstrap();
      return true;
    } catch (error) {
      dispose();
      throw error;
    } finally {
      initializing = false;
    }
  }

  function tryBootstrap() {
    if (bootstrapTimer !== null) {
      global.clearTimeout(bootstrapTimer);
      bootstrapTimer = null;
    }

    if (disposed || init()) {
      return;
    }

    bootstrapTimer = global.setTimeout(
      tryBootstrap,
      bootstrapDelay
    );

    bootstrapDelay = Math.min(bootstrapDelay * 2, 1000);
  }

  function setRotationEnabled(enabled) {
    rotationEnabled = Boolean(enabled);
  }

  function setRotationSpeed(radiansPerSecond) {
    if (!Number.isFinite(radiansPerSecond)) {
      throw new TypeError(
        "EarthCore rotation speed must be a finite number."
      );
    }

    rotationSpeed = radiansPerSecond;
  }

  function setLightDirection(x, y, z) {
    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y) ||
      !Number.isFinite(z)
    ) {
      throw new TypeError(
        "EarthCore light direction must be a finite, nonzero vector."
      );
    }

    const scale = Math.max(
      Math.abs(x),
      Math.abs(y),
      Math.abs(z)
    );

    if (scale === 0) {
      throw new TypeError(
        "EarthCore light direction must be a finite, nonzero vector."
      );
    }

    const nx = x / scale;
    const ny = y / scale;
    const nz = z / scale;
    const length = Math.hypot(nx, ny, nz);

    lightDirection = [
      nx / length,
      ny / length,
      nz / length
    ];

    if (worldLight) {
      worldLight.set(
        lightDirection[0],
        lightDirection[1],
        lightDirection[2]
      );
    }
  }

  function dispose() {
    if (disposed) {
      return;
    }

    disposed = true;
    initialized = false;
    stopBootstrap();

    try {
      if (unsubscribe) {
        unsubscribe();
      } else if (
        registered &&
        typeof engine.unregisterHook === "function"
      ) {
        engine.unregisterHook(animationHook);
      }
    } finally {
      unsubscribe = null;
      registered = false;

      if (earthGroup && earthGroup.parent) {
        earthGroup.parent.remove(earthGroup);
      }

      for (const geometry of ownedGeometries) {
        geometry.dispose();
      }

      for (const material of ownedMaterials) {
        material.dispose();
      }

      ownedGeometries.clear();
      ownedMaterials.clear();

      earthGroup = null;
      oceanSphere = null;
      continentMesh = null;
      coordinateGrid = null;
      atmosphere = null;
      uniforms = null;
      worldLight = null;
    }
  }

  // Add station and cable groups to earthGroup to share its geographic rotation.
  engine.EarthCore = Object.freeze({
    moduleId: MODULE_ID,
    init,
    dispose,
    setRotationEnabled,
    setRotationSpeed,
    setLightDirection,

    get initialized() {
      return initialized;
    },

    get disposed() {
      return disposed;
    },

    get radius() {
      return radius;
    },

    get earthGroup() {
      return earthGroup;
    },

    get oceanSphere() {
      return oceanSphere;
    },

    get continentMesh() {
      return continentMesh;
    },

    get coordinateGrid() {
      return coordinateGrid;
    },

    get atmosphere() {
      return atmosphere;
    },

    get uniforms() {
      return uniforms;
    },

    get rotationEnabled() {
      return rotationEnabled;
    },

    get rotationSpeed() {
      return rotationSpeed;
    }
  });

  global.addEventListener(
    "NetworkEngine:Ready",
    tryBootstrap
  );

  if (global.document) {
    global.document.addEventListener(
      "DOMContentLoaded",
      tryBootstrap,
      { once: true }
    );
  }

  tryBootstrap();
})(window);