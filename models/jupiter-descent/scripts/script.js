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
      "The Jovian visualization could not initialize. Check browser graphics acceleration.";
  }

  function initialize() {
    const container = document.getElementById("canvas-container");
    const panel = document.getElementById("info-panel");
    const caption = document.getElementById("scene-caption");

    const ui = {
      number: document.getElementById("phase-number"),
      title: document.getElementById("phase-title"),
      description: document.getElementById("phase-description"),
      mode: document.getElementById("flight-mode"),
      altitude: document.getElementById("metric-altitude"),
      pressure: document.getElementById("metric-pressure"),
      temperature: document.getElementById("metric-temperature"),
      layer: document.getElementById("metric-layer"),
      timeline: document.getElementById("timeline-readout"),
      progress: document.getElementById("progress-fill"),
      caption: document.getElementById("caption-text"),
      rows: Array.from(document.querySelectorAll("[data-phase]")),
      hudButton: document.getElementById("hud-toggle"),
      pauseButton: document.getElementById("pause-toggle"),
      restartButton: document.getElementById("restart-button")
    };

    const TAU = Math.PI * 2;
    const PLANET_RADIUS = 80;
    const CYCLE_DURATION = 120;
    const PAYLOAD_TIME = 98;
    const RESUME_DURATION = 1.8;

    const clamp01 = (x) => Math.max(0, Math.min(1, x));

    function smoothstep(a, b, x) {
      const t = clamp01((x - a) / (b - a));
      return t * t * (3 - 2 * t);
    }

    function smootherstep(x) {
      const t = clamp01(x);
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

    const random = seededRandom(0x4a555049);
    const range = (a, b) => a + (b - a) * random();

    function gaussian() {
      const u = Math.max(1e-7, random());
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * random());
    }

    function linearColor(hex) {
      return new THREE.Color(hex).convertSRGBToLinear();
    }

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.00005);

    const annotationScene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      54,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.035,
      2600
    );

    // A fixed -Z up vector keeps the later vertical -Y descent stable.
    camera.up.set(0, 0, -1);
    camera.position.set(-170, 98, 210);
    camera.lookAt(0, -80, 0);
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
      "Interactive Jupiter atmospheric and interior fly-through"
    );
    renderer.domElement.setAttribute("aria-describedby", "control-help");
    container.appendChild(renderer.domElement);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.43;
    controls.zoomSpeed = 0.65;
    controls.panSpeed = 0.6;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.08;
    controls.maxDistance = 1800;
    controls.minPolarAngle = 0.015;
    controls.maxPolarAngle = Math.PI - 0.015;
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

    const shared = {
      uTime: { value: 0 },
      uFogDensity: { value: scene.fog.density },
      uFogColor: { value: scene.fog.color },
      uPointScale: { value: 1 },
      uMaxPointSize: { value: maximumPointSize }
    };

    const globeVisibility = { value: 1 };
    const stormVisibility = { value: 0 };
    const weatherVisibility = { value: 0 };
    const deepVisibility = { value: 0 };
    const labels = [];

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

    const noiseGLSL = `
      float hash31(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }

      float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);

        return mix(
          mix(
            mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
            mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x),
            f.y
          ),
          mix(
            mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
            mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x),
            f.y
          ),
          f.z
        );
      }

      float fbm(vec3 p) {
        float value = 0.0;
        float amplitude = 0.5;

        for (int i = 0; i < 4; i++) {
          value += amplitude * noise3(p);
          p = p * 2.03 + vec3(13.1, 7.7, 5.4);
          amplitude *= 0.5;
        }

        return value;
      }
    `;

    scene.add(new THREE.HemisphereLight(0xb5c9eb, 0x08050a, 0.42));

    const sunDirection = new THREE.Vector3(-0.8, 1.1, 0.65).normalize();
    const sunLight = new THREE.DirectionalLight(0xffe4bc, 1.25);
    sunLight.position.copy(sunDirection).multiplyScalar(800);
    scene.add(sunLight);

    // Jupiter's local GRS normal is at latitude -22 degrees.
    // It is aligned with the expanded atmospheric entry at world (0,0,0).
    const planetRoot = new THREE.Group();
    planetRoot.position.set(0, -PLANET_RADIUS, 0);
    scene.add(planetRoot);

    const grsLatitude = THREE.MathUtils.degToRad(-22);
    const grsNormal = new THREE.Vector3(
      Math.cos(grsLatitude),
      Math.sin(grsLatitude),
      0
    );

    const planetAlignment = new THREE.Quaternion().setFromUnitVectors(
      grsNormal,
      new THREE.Vector3(0, 1, 0)
    );

    const planetSpin = new THREE.Quaternion();

    const planetMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: shared.uTime,
        uOpacity: globeVisibility,
        uSun: { value: sunDirection }
      },
      vertexShader: `
        varying vec3 vLocal;
        varying vec3 vNormalWorld;
        varying vec3 vWorld;

        void main() {
          vLocal = normalize(position);
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          vNormalWorld = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uOpacity;
        uniform vec3 uSun;

        varying vec3 vLocal;
        varying vec3 vNormalWorld;
        varying vec3 vWorld;

        ${noiseGLSL}

        void main() {
          vec3 p = normalize(vLocal);
          float latitude = asin(clamp(p.y, -1.0, 1.0));
          float longitude = atan(p.z, p.x);

          float largeFlow = fbm(
            p * 6.0 + vec3(uTime * 0.009, 0.0, 0.0)
          );

          float fineFlow = fbm(
            p * 38.0 + vec3(largeFlow * 2.0, uTime * 0.008, 0.0)
          );

          float bands =
            sin(latitude * 46.0 + largeFlow * 5.0 + fineFlow * 1.4);
          float narrowBands =
            sin(latitude * 117.0 + largeFlow * 6.0);

          vec3 cream = vec3(0.82, 0.65, 0.43);
          vec3 copper = vec3(0.48, 0.22, 0.085);
          vec3 darkBelt = vec3(0.28, 0.085, 0.032);

          vec3 color = mix(
            copper,
            cream,
            smoothstep(-0.5, 0.6, bands)
          );

          color = mix(
            color,
            darkBelt,
            smoothstep(0.45, 0.95, narrowBands) * 0.22
          );

          color *= 0.72 + fineFlow * 0.55;

          float deltaLongitude = atan(sin(longitude), cos(longitude));
          vec2 stormCoordinate = vec2(
            deltaLongitude / 0.25,
            (latitude + 0.3839724) / 0.104
          );

          float stormRadius = length(stormCoordinate);
          float stormAngle =
            atan(stormCoordinate.y, stormCoordinate.x) +
            exp(-stormRadius * stormRadius) * 6.0 +
            uTime * 0.045;

          float stormNoise = fbm(vec3(
            cos(stormAngle) * stormRadius * 11.0,
            sin(stormAngle) * stormRadius * 11.0,
            uTime * 0.015
          ));

          float stormRings =
            0.5 + 0.5 * sin(stormRadius * 30.0 + stormNoise * 8.0);

          vec3 stormColor = mix(
            vec3(0.31, 0.035, 0.012),
            vec3(0.8, 0.24, 0.055),
            stormNoise * 0.7 + stormRings * 0.3
          );

          float stormMask =
            1.0 - smoothstep(0.82, 1.18, stormRadius);

          color = mix(color, stormColor, stormMask);

          vec3 N = normalize(vNormalWorld);
          vec3 V = normalize(cameraPosition - vWorld);
          float diffuse = max(dot(N, normalize(uSun)), 0.0);
          float terminator = smoothstep(-0.11, 0.13, dot(N, normalize(uSun)));
          float rim = pow(1.0 - max(dot(N,V),0.0), 4.0);

          color *= 0.022 + diffuse * 1.12;
          color += vec3(0.13, 0.075, 0.035) * rim * terminator;

          gl_FragColor = vec4(color, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false
    });

    const jupiter = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_RADIUS, 192, 128),
      planetMaterial
    );
    planetRoot.add(jupiter);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(PLANET_RADIUS * 1.026, 128, 80),
      new THREE.ShaderMaterial({
        uniforms: {
          uOpacity: globeVisibility,
          uSun: { value: sunDirection }
        },
        vertexShader: `
          varying vec3 vNormalWorld;
          varying vec3 vWorld;

          void main() {
            vec4 world = modelMatrix * vec4(position,1.0);
            vWorld = world.xyz;
            vNormalWorld = normalize(mat3(modelMatrix)*normal);
            gl_Position = projectionMatrix*viewMatrix*world;
          }
        `,
        fragmentShader: `
          uniform float uOpacity;
          uniform vec3 uSun;
          varying vec3 vNormalWorld;
          varying vec3 vWorld;

          void main() {
            vec3 N=normalize(vNormalWorld);
            vec3 V=normalize(cameraPosition-vWorld);
            float rim=pow(1.0-abs(dot(N,V)),3.3);
            float light=0.25+0.75*max(dot(N,normalize(uSun)),0.0);

            gl_FragColor=vec4(
              mix(vec3(0.14,0.28,0.48),vec3(0.82,0.53,0.23),light),
              rim*light*0.48*uOpacity
            );
          }
        `,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      })
    );
    planetRoot.add(halo);

    function createParticleTexture() {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;

      const context = canvas.getContext("2d");
      const gradient = context.createRadialGradient(64,64,0,64,64,64);

      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.16, "rgba(255,255,255,0.95)");
      gradient.addColorStop(0.42, "rgba(255,255,255,0.28)");
      gradient.addColorStop(0.75, "rgba(255,255,255,0.035)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");

      context.fillStyle = gradient;
      context.fillRect(0,0,128,128);
      return canvasTexture(canvas);
    }

    const particleTexture = createParticleTexture();

    const particleVertex = `
      attribute vec3 color;
      attribute vec4 aData;
      attribute float aSize;

      uniform float uTime;
      uniform float uFamily;
      uniform float uPointScale;
      uniform float uMaxPointSize;

      varying vec3 vColor;
      varying vec3 vWorld;
      varying float vDistance;
      varying float vSeed;
      varying float vGas;

      void main() {
        vec3 p=position;

        if(uFamily>0.5 && uFamily<1.5) {
          float radius=position.x;
          float omega=0.10+2.4/(radius+4.0);

          // Counterclockwise in the downward-looking, -Z-up view.
          float angle=position.y-uTime*omega;

          p=vec3(
            cos(angle)*radius*1.45,
            position.z+sin(angle*3.0+uTime*0.3)*0.75,
            sin(angle)*radius
          );

          p.x+=sin(angle*5.0+radius*0.3)*0.65;
          p.z+=cos(angle*4.0-radius*0.18)*0.55;
        } else if(uFamily>1.5 && uFamily<2.5) {
          p.x+=sin(uTime*0.13+position.z*0.06)*1.7;
          p.y+=sin(uTime*0.17+position.x*0.08)*0.7;
          p.z+=cos(uTime*0.11+position.x*0.055)*1.5;
        } else if(uFamily>2.5) {
          p+=vec3(
            sin(position.z*0.07+uTime*0.28)*1.5,
            sin(position.x*0.06+uTime*0.32)*2.0,
            cos(position.y*0.05-uTime*0.21)*1.2
          );
        }

        vec4 world=modelMatrix*vec4(p,1.0);
        vec4 mvPosition=viewMatrix*world;

        vColor=color;
        vWorld=world.xyz;
        vDistance=length(mvPosition.xyz);
        vSeed=aData.x;
        vGas=aData.w;

        gl_Position=projectionMatrix*mvPosition;
        gl_PointSize=clamp(
          aSize*uPointScale/max(0.035,-mvPosition.z),
          uFamily<0.5 ? 1.25 : 1.0,
          uMaxPointSize
        );
      }
    `;

    const particleFragment = `
      uniform sampler2D uSprite;
      uniform float uTime;
      uniform float uFamily;
      uniform float uReveal;
      uniform float uOpacity;
      uniform float uFogDensity;
      uniform vec3 uFogColor;

      varying vec3 vColor;
      varying vec3 vWorld;
      varying float vDistance;
      varying float vSeed;
      varying float vGas;

      void main() {
        vec2 p=gl_PointCoord*2.0-1.0;
        float rr=dot(p,p);
        if(rr>1.0) discard;

        float alpha=texture2D(uSprite,gl_PointCoord).a;
        float pulse=0.85+0.15*sin(uTime*0.8+vSeed*57.0);
        vec3 color=vColor;

        if(uFamily<0.5) {
          color*=1.3;
        } else if(uFamily<2.5) {
          float textureLight=0.65+0.35*exp(-rr*3.0);
          color*=textureLight*(0.8+0.35*pulse);
        } else {
          float proximity=exp(-distance(cameraPosition,vWorld)*0.018);
          color*=1.4+pulse+proximity;
          color+=vec3(0.15,0.38,0.55)*exp(-rr*35.0);
        }

        float transmission=exp(
          -uFogDensity*uFogDensity*vDistance*vDistance
        );

        color=mix(uFogColor,color,transmission);
        alpha*=uReveal*uOpacity*mix(1.0,0.32,vGas);
        alpha*=max(0.04,transmission);

        if(alpha<0.001) discard;
        gl_FragColor=vec4(color,alpha);
      }
    `;

    function particleField(parent, count, family, reveal, opacity, builder) {
      const positions = new Float32Array(count * 3);
      const colors = new Float32Array(count * 3);
      const data = new Float32Array(count * 4);
      const sizes = new Float32Array(count);

      for (let i = 0; i < count; i++) {
        const item = builder(i);
        const color = linearColor(item.color);

        positions.set(item.position, i * 3);
        colors.set([color.r,color.g,color.b], i * 3);
        data.set([random(),random(),random(),item.gas ? 1 : 0], i * 4);
        sizes[i] = item.size;
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions,3));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors,3));
      geometry.setAttribute("aData", new THREE.BufferAttribute(data,4));
      geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes,1));

      const material = new THREE.ShaderMaterial({
        uniforms: {
          ...shared,
          uSprite: { value: particleTexture },
          uFamily: { value: family },
          uReveal: reveal,
          uOpacity: { value: opacity }
        },
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        transparent: true,
        blending: family === 0 || family === 3
          ? THREE.AdditiveBlending
          : THREE.NormalBlending,
        depthTest: true,
        depthWrite: false
      });

      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      parent.add(points);
      return points;
    }

    particleField(scene, 2000, 0, { value: 1 }, 0.95, () => {
      const y = range(-1,1);
      const angle = random()*TAU;
      const radial = Math.sqrt(1-y*y);
      const distance = range(850,1700);

      return {
        position: [
          Math.cos(angle)*radial*distance,
          -80+y*distance,
          Math.sin(angle)*radial*distance
        ],
        color: random()<0.1 ? 0xd6e6ff : 0xffffff,
        size: range(0.7,1.7)
      };
    });

    const contextPlanets = new THREE.Group();
    scene.add(contextPlanets);

    const planetNodes = [
      { color:0x9c928a, radius:3, position:[-440,250,-520] },
      { color:0xe6bc7b, radius:5, position:[240,390,-480] },
      { color:0x448dc9, radius:5.2, position:[-260,480,110] },
      { color:0xbf5d39, radius:4, position:[360,240,170] },
      { color:0xc3a778, radius:8, position:[-360,360,420], ring:true },
      { color:0x8de3e7, radius:6, position:[120,570,-330] },
      { color:0x355ad1, radius:5.8, position:[430,460,-40] }
    ];

    for (const node of planetNodes) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(node.radius,48,32),
        new THREE.MeshStandardMaterial({
          color:node.color,
          roughness:0.86,
          metalness:0,
          emissive:node.color,
          emissiveIntensity:0.045
        })
      );
      mesh.position.set(...node.position);
      contextPlanets.add(mesh);

      if (node.ring) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(10.4,17.5,96),
          new THREE.MeshBasicMaterial({
            color:0xb9a181,
            transparent:true,
            opacity:0.58,
            side:THREE.DoubleSide,
            depthWrite:false
          })
        );
        ring.rotation.set(1.12,0.2,0.35);
        mesh.add(ring);
      }
    }

    const sun = new THREE.Mesh(
      new THREE.SphereGeometry(8,48,32),
      new THREE.MeshBasicMaterial({
        color:new THREE.Color().setRGB(5.0,3.4,1.8)
      })
    );
    sun.position.set(-480,390,380);
    contextPlanets.add(sun);

    const stormRoot = new THREE.Group();
    scene.add(stormRoot);

    particleField(stormRoot, 8000, 1, stormVisibility, 0.62, () => {
      const gas = random()<0.24;
      const radius = 3 + Math.pow(random(),0.65)*32;
      const angle = random()*TAU;
      const height = -7 + gaussian()*4.2;

      const palette = [0x771b11,0xa73518,0xc95522,0xe08a43,0x8f291b];

      return {
        position:[radius,angle,height],
        color:palette[Math.floor(random()*palette.length)],
        size:gas ? range(3.5,8.5) : range(0.3,1.2),
        gas
      };
    });

    particleField(stormRoot, 2400, 2, stormVisibility, 0.28, () => ({
      position:[range(-65,65),range(-1,5),range(-45,45)],
      color:random()<0.4 ? 0xd0a476 : 0xb07445,
      size:range(3.5,9),
      gas:true
    }));

    const weatherRoot = new THREE.Group();
    scene.add(weatherRoot);

    const cloudDecks = [
      { y:-28, color:0xcbb99f, secondary:0x86745f },
      { y:-65, color:0xb8874b, secondary:0x664029 },
      { y:-107, color:0x87929f, secondary:0x3a414d }
    ];

    for (const deck of cloudDecks) {
      particleField(weatherRoot, 2600, 2, weatherVisibility, 0.52, () => ({
        position:[
          range(-72,72),
          deck.y+gaussian()*4.6,
          range(-65,65)
        ],
        color:random()<0.45 ? deck.color : deck.secondary,
        size:range(3,11),
        gas:true
      }));
    }

    function makeLightning() {
      const positions = [];
      const ids = [];
      const distances = [];

      function segment(a,b,id,alongA,alongB) {
        positions.push(...a,...b);
        ids.push(id,id);
        distances.push(alongA,alongB);
      }

      for (const deck of cloudDecks) {
        for (let bolt=0;bolt<4;bolt++) {
          const side = bolt%2===0 ? -1 : 1;
          const x = side*range(17,36);
          const z = range(-19,19);
          let previous = [x,deck.y+12,z];

          for (let step=1;step<=22;step++) {
            const t=step/22;
            const next=[
              x+Math.sin(t*9+bolt)*3+range(-1.2,1.2),
              deck.y+12-t*28,
              z+Math.sin(t*6+bolt)*3+range(-1,1)
            ];

            segment(previous,next,bolt,(step-1)/22,t);

            if(step%5===0) {
              let branch=next.slice();

              for(let branchStep=1;branchStep<=5;branchStep++) {
                const end=[
                  branch[0]+side*range(1.0,2.4),
                  branch[1]-range(0.4,1.8),
                  branch[2]+range(-1.8,1.8)
                ];
                segment(branch,end,bolt,t,t+branchStep*0.015);
                branch=end;
              }
            }

            previous=next;
          }
        }
      }

      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",new THREE.Float32BufferAttribute(positions,3)
      );
      geometry.setAttribute(
        "aId",new THREE.Float32BufferAttribute(ids,1)
      );
      geometry.setAttribute(
        "aAlong",new THREE.Float32BufferAttribute(distances,1)
      );

      const material = new THREE.ShaderMaterial({
        uniforms:{
          ...shared,
          uReveal:weatherVisibility
        },
        vertexShader:`
          attribute float aId;
          attribute float aAlong;
          varying float vId;
          varying float vAlong;
          varying float vDistance;

          void main() {
            vec4 mvPosition=modelViewMatrix*vec4(position,1.0);
            vId=aId;
            vAlong=aAlong;
            vDistance=length(mvPosition.xyz);
            gl_Position=projectionMatrix*mvPosition;
          }
        `,
        fragmentShader:`
          uniform float uTime;
          uniform float uReveal;
          uniform float uFogDensity;

          varying float vId;
          varying float vAlong;
          varying float vDistance;

          void main() {
            float event=floor(uTime/3.1);
            float age=mod(uTime,3.1);
            float selected=1.0-step(0.25,abs(vId-mod(event,4.0)));

            float flash=
              exp(-pow((age-0.14)/0.07,2.0))+
              0.4*exp(-pow((age-0.43)/0.09,2.0));

            float transmission=exp(
              -uFogDensity*uFogDensity*vDistance*vDistance
            );

            float alpha=selected*flash*uReveal*transmission;
            if(alpha<0.002) discard;

            gl_FragColor=vec4(
              mix(vec3(1.1,1.7,3.0),vec3(2.7,2.8,3.2),vAlong),
              alpha
            );
          }
        `,
        transparent:true,
        blending:THREE.AdditiveBlending,
        depthWrite:false
      });

      const lightning = new THREE.LineSegments(geometry,material);
      lightning.frustumCulled=false;
      weatherRoot.add(lightning);
    }

    makeLightning();

    function reflectionTexture() {
      const canvas=document.createElement("canvas");
      canvas.width=1024;
      canvas.height=512;

      const context=canvas.getContext("2d");
      const gradient=context.createLinearGradient(0,0,0,512);

      gradient.addColorStop(0,"#01030a");
      gradient.addColorStop(0.21,"#0655a0");
      gradient.addColorStop(0.4,"#4feeff");
      gradient.addColorStop(0.47,"#c3f8ff");
      gradient.addColorStop(0.51,"#081525");
      gradient.addColorStop(0.66,"#c38023");
      gradient.addColorStop(0.79,"#fff0a3");
      gradient.addColorStop(1,"#050307");

      context.fillStyle=gradient;
      context.fillRect(0,0,1024,512);

      for(let i=0;i<20;i++) {
        context.fillStyle=i%2===0 ? "#a1edff" : "#ffc94f";
        context.fillRect(i*53,130,6,190);
      }

      const texture=canvasTexture(canvas);
      texture.wrapS=THREE.RepeatWrapping;
      return texture;
    }

    const reflectionMap=reflectionTexture();
    const deepRoot=new THREE.Group();
    scene.add(deepRoot);

    const fluidGeometry=new THREE.PlaneGeometry(190,190,180,180);

    function fluidSheet(y,metallic,phase) {
      const material=new THREE.ShaderMaterial({
        uniforms:{
          ...shared,
          uReveal:deepVisibility,
          uMetallic:{value:metallic},
          uPhase:{value:phase},
          uEnvironment:{value:reflectionMap}
        },
        vertexShader:`
          uniform float uTime;
          uniform float uPhase;

          varying vec2 vUv;
          varying vec3 vWorld;
          varying float vDistance;

          void main() {
            vUv=uv;
            vec3 p=position;

            p.z=
              sin(p.x*0.07+uTime*0.18+uPhase)*
              cos(p.y*0.085-uTime*0.12)*2.2+
              sin(p.y*0.21+p.x*0.1+uTime*0.25+uPhase)*0.65;

            vec4 world=modelMatrix*vec4(p,1.0);
            vec4 mvPosition=viewMatrix*world;

            vWorld=world.xyz;
            vDistance=length(mvPosition.xyz);
            gl_Position=projectionMatrix*mvPosition;
          }
        `,
        fragmentShader:`
          uniform float uTime;
          uniform float uReveal;
          uniform float uMetallic;
          uniform sampler2D uEnvironment;
          uniform float uFogDensity;
          uniform vec3 uFogColor;

          varying vec2 vUv;
          varying vec3 vWorld;
          varying float vDistance;

          ${noiseGLSL}

          void main() {
            vec3 N=normalize(cross(dFdx(vWorld),dFdy(vWorld)));
            if(!gl_FrontFacing) N=-N;

            vec3 V=normalize(cameraPosition-vWorld);
            vec3 R=reflect(-V,N);
            vec2 environmentUv=vec2(
              atan(R.z,R.x)/6.28318530718+0.5,
              asin(clamp(R.y,-1.0,1.0))/3.14159265359+0.5
            );

            vec3 reflection=pow(
              texture2D(uEnvironment,environmentUv).rgb,
              vec3(2.2)
            );

            float flow=fbm(vWorld*0.045+vec3(0,uTime*0.05,0));
            float fresnel=pow(1.0-abs(dot(N,V)),3.0);

            vec2 coordinates=vUv*90.0+
              vec2(sin(vUv.y*20.0+uTime*0.2),0.0)*0.12;
            vec2 nearest=abs(fract(coordinates-0.5)-0.5);
            vec2 derivative=max(fwidth(coordinates),vec2(0.0001));

            float grid=1.0-smoothstep(
              0.1,1.1,
              min(nearest.x/derivative.x,nearest.y/derivative.y)
            );

            vec3 molecular=mix(
              vec3(0.028,0.014,0.022),
              vec3(0.12,0.055,0.025),
              flow
            );

            vec3 metal=mix(
              vec3(0.015,0.22,0.55),
              vec3(0.75,0.39,0.035),
              smoothstep(0.38,0.7,flow)
            );

            metal+=reflection*(0.7+fresnel*1.6);
            metal+=grid*mix(
              vec3(0.05,0.95,1.5),
              vec3(1.6,0.72,0.08),
              flow
            )*0.7;

            vec3 color=mix(molecular,metal,uMetallic);
            float transmission=exp(
              -uFogDensity*uFogDensity*vDistance*vDistance
            );

            color=mix(uFogColor,color,transmission);

            float alpha=(
              mix(0.24,0.32,uMetallic)+fresnel*0.35
            )*uReveal;

            if(alpha<0.001) discard;
            gl_FragColor=vec4(color,alpha);
          }
        `,
        extensions:{derivatives:true},
        transparent:true,
        side:THREE.DoubleSide,
        depthWrite:false
      });

      const mesh=new THREE.Mesh(fluidGeometry,material);
      mesh.rotation.x=-Math.PI/2;
      mesh.position.y=y;
      mesh.frustumCulled=false;
      deepRoot.add(mesh);
    }

    fluidSheet(-169,0.03,0.0);
    fluidSheet(-204,0.3,1.5);
    fluidSheet(-241,0.9,2.7);
    fluidSheet(-287,1.0,4.1);
    fluidSheet(-338,1.0,5.2);
    fluidSheet(-390,1.0,6.4);

    const latticePositions=[];
    const latticeColors=[];
    const latticeSeeds=[];

    function latticeSegment(a,b,color) {
      const midpoint=new THREE.Vector3(
        (a[0]+b[0])*0.5,
        (a[1]+b[1])*0.5,
        (a[2]+b[2])*0.5
      );

      if(midpoint.distanceTo(new THREE.Vector3(0,-356,0))<8) return;

      const tint=linearColor(color);
      const seed=random();

      latticePositions.push(...a,...b);
      latticeColors.push(tint.r,tint.g,tint.b,tint.r,tint.g,tint.b);
      latticeSeeds.push(seed,seed);
    }

    for(let x=-60;x<=60;x+=12) {
      for(let z=-60;z<=60;z+=12) {
        for(let y=-272;y>=-440;y-=12) {
          const color=random()<0.3 ? 0xffca5d : 0x32cbff;

          if(x<60) latticeSegment([x,y,z],[x+12,y,z],color);
          if(z<60) latticeSegment([x,y,z],[x,y,z+12],color);
          if(y>-440) latticeSegment([x,y,z],[x,y-12,z],color);
        }
      }
    }

    const latticeGeometry=new THREE.BufferGeometry();
    latticeGeometry.setAttribute(
      "position",new THREE.Float32BufferAttribute(latticePositions,3)
    );
    latticeGeometry.setAttribute(
      "color",new THREE.Float32BufferAttribute(latticeColors,3)
    );
    latticeGeometry.setAttribute(
      "aSeed",new THREE.Float32BufferAttribute(latticeSeeds,1)
    );

    const lattice=new THREE.LineSegments(
      latticeGeometry,
      new THREE.ShaderMaterial({
        uniforms:{
          ...shared,
          uReveal:deepVisibility
        },
        vertexShader:`
          attribute vec3 color;
          attribute float aSeed;

          uniform float uTime;

          varying vec3 vColor;
          varying float vSeed;
          varying float vDistance;

          void main() {
            vec3 p=position;

            p+=vec3(
              sin(position.z*0.07+uTime*0.28)*1.5,
              sin(position.x*0.06+uTime*0.32)*2.0,
              cos(position.y*0.05-uTime*0.21)*1.2
            );

            vec4 mvPosition=modelViewMatrix*vec4(p,1.0);
            vColor=color;
            vSeed=aSeed;
            vDistance=length(mvPosition.xyz);
            gl_Position=projectionMatrix*mvPosition;
          }
        `,
        fragmentShader:`
          uniform float uTime;
          uniform float uReveal;
          uniform float uFogDensity;
          varying vec3 vColor;
          varying float vSeed;
          varying float vDistance;

          void main() {
            float pulse=0.65+0.35*sin(uTime*0.6+vSeed*41.0);
            float transmission=exp(
              -uFogDensity*uFogDensity*vDistance*vDistance
            );

            gl_FragColor=vec4(
              vColor*(0.45+pulse),
              transmission*uReveal*0.58
            );
          }
        `,
        transparent:true,
        blending:THREE.AdditiveBlending,
        depthWrite:false
      })
    );
    lattice.frustumCulled=false;
    deepRoot.add(lattice);

    particleField(deepRoot,6000,3,deepVisibility,0.65,()=>({
      position:[range(-66,66),range(-442,-220),range(-66,66)],
      color:random()<0.28 ? 0xffce64 : 0x51dfff,
      size:range(0.08,0.32)
    }));

    // Fictional core payload: a small extruded vector-art sock.
    const payloadRoot=new THREE.Group();
    payloadRoot.position.set(0,-356,0);
    scene.add(payloadRoot);

    const payloadFacing=new THREE.Group();
    payloadRoot.add(payloadFacing);

    const sockRotor=new THREE.Group();
    sockRotor.scale.setScalar(2.3);
    payloadFacing.add(sockRotor);

    const sockShape=new THREE.Shape();
    sockShape.moveTo(-0.62,1.5);
    sockShape.lineTo(0.58,1.5);
    sockShape.lineTo(0.58,-0.08);
    sockShape.quadraticCurveTo(0.94,-0.34,1.5,-0.6);
    sockShape.quadraticCurveTo(2.0,-0.73,1.85,-1.12);
    sockShape.quadraticCurveTo(1.67,-1.55,1.1,-1.43);
    sockShape.lineTo(-0.4,-0.73);
    sockShape.quadraticCurveTo(-0.68,-0.55,-0.68,-0.18);
    sockShape.lineTo(-0.62,1.5);

    const sockGeometry=new THREE.ExtrudeGeometry(sockShape,{
      depth:0.32,
      bevelEnabled:true,
      bevelThickness:0.045,
      bevelSize:0.04,
      bevelSegments:2,
      curveSegments:24,
      steps:1
    });
    sockGeometry.translate(-0.45,0,-0.16);

    sockRotor.add(new THREE.Mesh(
      sockGeometry,
      new THREE.MeshBasicMaterial({
        color:0xff2eb9,
        transparent:true,
        opacity:0.065,
        side:THREE.DoubleSide,
        depthWrite:false
      })
    ));

    const pinkMaterial=new THREE.LineBasicMaterial({
      color:new THREE.Color().setRGB(3.0,0.04,1.65),
      transparent:true,
      opacity:0.95,
      depthWrite:false
    });

    const limeMaterial=new THREE.LineBasicMaterial({
      color:new THREE.Color().setRGB(0.75,2.8,0.035),
      transparent:true,
      opacity:0.95,
      depthWrite:false
    });

    const outline=sockShape.getPoints(96);

    function sockOutline(depth,material) {
      const points=outline.map((point)=>new THREE.Vector3(
        point.x-0.45,point.y,depth
      ));

      const line=new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        material
      );
      sockRotor.add(line);
    }

    sockOutline(0.23,pinkMaterial);
    sockOutline(-0.23,limeMaterial);

    const sockDetails=[];

    for(let i=0;i<outline.length;i+=12) {
      const point=outline[i];
      sockDetails.push(
        point.x-0.45,point.y,-0.23,
        point.x-0.45,point.y,0.23
      );
    }

    for(const y of [1.11,1.29]) {
      sockDetails.push(-1.05,y,0.245,0.12,y,0.245);
    }

    sockDetails.push(
      -0.96,-0.28,0.245,-0.66,-0.32,0.245,
      -0.66,-0.32,0.245,-0.47,-0.6,0.245,
      -0.47,-0.6,0.245,-0.8,-0.79,0.245
    );

    const sockDetailGeometry=new THREE.BufferGeometry();
    sockDetailGeometry.setAttribute(
      "position",new THREE.Float32BufferAttribute(sockDetails,3)
    );
    sockRotor.add(new THREE.LineSegments(sockDetailGeometry,limeMaterial));

    const payloadHalo=new THREE.Mesh(
      new THREE.TorusGeometry(5.1,0.04,8,128),
      new THREE.MeshBasicMaterial({
        color:new THREE.Color().setRGB(0.38,1.5,0.8),
        transparent:true,
        opacity:0.6,
        depthWrite:false
      })
    );
    payloadHalo.rotation.x=-Math.PI/2;
    payloadHalo.position.y=-3.6;
    payloadRoot.add(payloadHalo);

    function fitText(context,text,maxWidth,initialSize) {
      let size=initialSize;

      do {
        context.font=
          `${size}px Menlo, Consolas, "Liberation Mono", monospace`;
        if(context.measureText(text).width<=maxWidth) break;
        size-=1;
      } while(size>12);
    }

    function addLabel(
      title,
      subtitle,
      color,
      position,
      near=5,
      far=70,
      payload=false
    ) {
      const canvas=document.createElement("canvas");
      canvas.width=2048;
      canvas.height=320;

      const context=canvas.getContext("2d");
      context.fillStyle="rgba(2,6,15,0.92)";
      context.fillRect(0,0,2048,320);
      context.strokeStyle="rgba(149,198,225,0.35)";
      context.lineWidth=2;
      context.strokeRect(1,1,2046,318);
      context.fillStyle=color;
      context.fillRect(0,0,6,320);

      context.textBaseline="middle";
      fitText(context,title,1940,payload ? 83 : 78);
      context.fillStyle=color;
      context.fillText(title,48,115);

      fitText(context,subtitle,1940,35);
      context.fillStyle="#b5c6da";
      context.fillText(subtitle,48,235);

      const sprite=new THREE.Sprite(
        new THREE.SpriteMaterial({
          map:canvasTexture(canvas,true),
          transparent:true,
          opacity:0,
          sizeAttenuation:false,
          depthTest:false,
          depthWrite:false,
          fog:false,
          toneMapped:false
        })
      );

      sprite.position.set(...position);
      sprite.frustumCulled=false;
      sprite.renderOrder=payload ? 2000 : 1000;
      annotationScene.add(sprite);

      const label={sprite,near,far,payload};
      labels.push(label);
      return label;
    }

    addLabel(
      "Tropopause: ≈0.1 bar",
      "UPPER-ATMOSPHERE REFERENCE / NOT A SOLID SURFACE",
      "#f1ddbd",
      [0,2,-10],
      5,65
    );

    addLabel(
      "Great Red Spot Vortex: Core Ingress",
      "EXPANDED ANTICYCLONIC STORM CUTAWAY",
      "#ffc1a0",
      [12,-3,0],
      5,60
    );

    addLabel(
      "Troposphere: Ammonia Condensation Zone",
      "SCHEMATIC CLOUD CHEMISTRY / ≈0.7 bar REFERENCE",
      "#f0e4ce",
      [-7,-26,0],
      6,62
    );

    addLabel(
      "Ammonium Hydrosulfide Clouds",
      "NH₄SH / ≈2 bar REFERENCE",
      "#ffcf8e",
      [4,-64,0],
      6,60
    );

    addLabel(
      "Water Clouds: Ice + Droplets",
      "DEEP CONVECTION / ≈5–10 bar REFERENCE",
      "#d7e7ff",
      [-3,-103,-4],
      6,62
    );

    addLabel(
      "Dense Hydrogen Fluid",
      "SCHEMATIC CONTINUOUS COMPRESSION / NO HARD SURFACE",
      "#b7dcff",
      [9,-178,0],
      7,80
    );

    addLabel(
      "Metallic Hydrogen: ≈2 Mbar",
      "ILLUSTRATIVE INTERIOR TRANSITION / 200 GPa",
      "#bdf5ff",
      [8,-244,0],
      7,82
    );

    const payloadLabel=addLabel(
      "FOUND OBJECT: STIMPY'S LEFT SOCK",
      "FICTIONAL CORE PAYLOAD / RECOVERY COMPLETE",
      "#d5ff7d",
      [0,-356,0],
      1,120,true
    );

    /*
      Scientific references:
      [Jupiter facts](https://science.nasa.gov/jupiter/jupiter-facts/)
      [Great Red Spot depth and altitude datum](https://www.jpl.nasa.gov/images/pia24819-a-deep-dive-into-jupiters-great-red-spot/)
      [Jovian tropopause](https://ntrs.nasa.gov/citations/20230014654)
      [GRS cloud spectroscopy](https://arxiv.org/abs/1808.01402)
      [Hydrogen metallization models](https://doi.org/10.3847/1538-4357/aaff65)

      This is an expanded narrative cutaway, not a hydrostatic interior solver.
      Pressure is interpolated logarithmically between illustrative anchors.
      The 1-bar level is the altitude datum.
      0.1 bar is near the tropopause, not the exosphere.
      Metallization is model-dependent rather than a sharp universal surface.
      The central payload is fictional; Jupiter has no physical singularity.
    */

    const phases=[
      {
        title:"Orbital cruise",
        description:"A rotating gas giant against a schematic solar-system backdrop.",
        accent:"#ffd3a0",
        caption:"JUPITER / SCHEMATIC SOLAR-SYSTEM CONTEXT"
      },
      {
        title:"Great Red Spot insertion",
        description:"A close passage through an expanded anticyclonic storm.",
        accent:"#ff9870",
        caption:"GREAT RED SPOT / ATMOSPHERIC INSERTION"
      },
      {
        title:"Ascent escape",
        description:"Clear the cloud deck, face space, then reorient for descent.",
        accent:"#d2e5ff",
        caption:"ASCENT / OUTWARD PIVOT / VERTICAL REORIENTATION"
      },
      {
        title:"Layered atmospheric plunge",
        description:"Bank through schematic cloud zones and electrical convection.",
        accent:"#dfb888",
        caption:"AMMONIA / AMMONIUM HYDROSULFIDE / WATER CLOUDS"
      },
      {
        title:"Hydrogen abyss",
        description:"Dense molecular fluid gives way to a metallic-hydrogen model.",
        accent:"#8feaff",
        caption:"DENSE HYDROGEN / METALLIZATION REFERENCE"
      },
      {
        title:"Core payload",
        description:"A fictional discovery inside the expanded central chamber.",
        accent:"#d8ff80",
        caption:"CORE TRANSCENDENCE / FICTIONAL PAYLOAD"
      }
    ];

    const profile=[
      {t:15,h:100,p:0.003,k:150,layer:"Upper stratosphere"},
      {t:18,h:50,p:0.1,k:110,layer:"Tropopause"},
      {t:22,h:10,p:0.7,k:150,layer:"Ammonia zone"},
      {t:26,h:-20,p:2,k:200,layer:"Storm cloud region"},
      {t:30,h:0,p:1,k:165,layer:"Cloud-level ascent"},
      {t:32,h:100,p:0.003,k:150,layer:"Upper stratosphere"},
      {t:35,h:100,p:0.003,k:150,layer:"Descent entry"},
      {t:40,h:10,p:0.7,k:150,layer:"Ammonia zone"},
      {t:43,h:0,p:1,k:165,layer:"1-bar reference"},
      {t:47,h:-20,p:2,k:200,layer:"NH₄SH zone"},
      {t:53,h:-50,p:5,k:270,layer:"Water cloud zone"},
      {t:57,h:-80,p:10,k:330,layer:"Deep cloud region"},
      {t:60,h:-250,p:100,k:650,layer:"Molecular hydrogen"},
      {t:66,h:-1000,p:5000,k:2000,layer:"Dense hydrogen fluid"},
      {t:72,h:-5000,p:200000,k:4000,layer:"Molecular interior"},
      {t:78,h:-15000,p:2000000,k:6500,layer:"Metallization reference"},
      {t:88,h:-25000,p:5000000,k:10000,layer:"Metallic envelope"},
      {t:98,h:-71492,p:40000000,k:20000,layer:"Central model / fiction"}
    ];

    function referenceAtTime(t) {
      if(t<15) {
        return {
          h:THREE.MathUtils.lerp(150000,100,smootherstep(t/15)),
          p:null,
          k:null,
          layer:"Orbital context"
        };
      }

      if(t>=98) return profile[profile.length-1];

      for(let i=0;i<profile.length-1;i++) {
        const a=profile[i];
        const b=profile[i+1];

        if(t>=a.t && t<b.t) {
          const f=smoothstep(a.t,b.t,t);

          return {
            h:THREE.MathUtils.lerp(a.h,b.h,f),
            p:Math.exp(THREE.MathUtils.lerp(Math.log(a.p),Math.log(b.p),f)),
            k:THREE.MathUtils.lerp(a.k,b.k,f),
            layer:f<0.5 ? a.layer : b.layer
          };
        }
      }

      return profile[profile.length-1];
    }

    function curve(points) {
      const path=new THREE.CatmullRomCurve3(
        points.map((point)=>new THREE.Vector3(...point)),
        false,
        "centripetal"
      );
      path.arcLengthDivisions=2048;
      path.updateArcLengths();
      return path;
    }

    const orbitPath=curve([
      [-170,98,210],
      [-145,90,160],
      [-105,64,105],
      [-46,40,65],
      [0,18,22]
    ]);

    const stormPath=curve([
      [0,18,22],
      [12,7,10],
      [20,0,-6],
      [10,-7,-14],
      [-12,-9,-4],
      [-8,-6,4]
    ]);

    const plungePath=curve([
      [0,26,0],
      [0,18,0],
      [14,-18,10],
      [-20,-42,-7],
      [17,-67,11],
      [-15,-95,-9],
      [10,-123,6],
      [0,-145,0]
    ]);

    const deepPath=curve([
      [0,-145,0],
      [-7,-170,-5],
      [11,-207,9],
      [-10,-250,-6],
      [5,-296,10],
      [8,-337,11]
    ]);

    const aimingCamera=new THREE.PerspectiveCamera();
    aimingCamera.up.copy(camera.up);

    const desiredPosition=new THREE.Vector3();
    const desiredQuaternion=new THREE.Quaternion();
    const lookTarget=new THREE.Vector3();
    const ahead=new THREE.Vector3();
    const tangent=new THREE.Vector3();
    const forward=new THREE.Vector3();
    const screenUp=new THREE.Vector3();
    const origin=new THREE.Vector3(0,0,0);
    const planetCenter=new THREE.Vector3(0,-PLANET_RADIUS,0);
    const escapePosition=new THREE.Vector3(0,26,0);
    const stormEnd=stormPath.getPointAt(1);

    const qDown=new THREE.Quaternion();
    const escapeRotation=new THREE.Quaternion();
    const bankRotation=new THREE.Quaternion();
    const worldZ=new THREE.Vector3(0,0,1);
    const localZ=new THREE.Vector3(0,0,1);

    aimingCamera.position.copy(escapePosition);
    aimingCamera.lookAt(0,25,0);
    qDown.copy(aimingCamera.quaternion);

    function aimAt(target) {
      aimingCamera.position.copy(desiredPosition);
      aimingCamera.lookAt(target);
      desiredQuaternion.copy(aimingCamera.quaternion);
    }

    function pathAhead(path,u,distance,result) {
      if(u<0.998) {
        path.getPointAt(
          Math.min(1,u+distance/path.getLength()),
          result
        );
      } else {
        path.getTangentAt(1,tangent);
        result.copy(desiredPosition).addScaledVector(tangent,distance);
      }
    }

    function sampleCamera(t) {
      if(t<15) {
        const u=smootherstep(t/15);
        orbitPath.getPointAt(u,desiredPosition);

        lookTarget.copy(planetCenter).lerp(
          origin,
          smoothstep(0.5,1,u)
        );

        aimAt(lookTarget);
        return;
      }

      if(t<30) {
        const u=smootherstep((t-15)/15);
        stormPath.getPointAt(u,desiredPosition);
        pathAhead(stormPath,u,5,ahead);

        lookTarget.copy(origin).lerp(
          ahead,
          smoothstep(0,0.18,u)
        );
        lookTarget.lerp(origin,smoothstep(0.8,1,u));

        aimAt(lookTarget);
        return;
      }

      if(t<32) {
        desiredPosition.lerpVectors(
          stormEnd,
          escapePosition,
          smootherstep((t-30)/2)
        );
        aimAt(origin);
        return;
      }

      if(t<35) {
        desiredPosition.copy(escapePosition);
        let angle;

        if(t<33.2) {
          angle=Math.PI*smootherstep((t-32)/1.2);
        } else if(t<33.55) {
          angle=Math.PI;
        } else {
          angle=Math.PI+
            Math.PI*smootherstep((t-33.55)/1.45);
        }

        escapeRotation.setFromAxisAngle(worldZ,angle);
        desiredQuaternion.copy(escapeRotation).multiply(qDown);
        return;
      }

      if(t<60) {
        const u=smootherstep((t-35)/25);
        plungePath.getPointAt(u,desiredPosition);
        pathAhead(plungePath,u,6,ahead);

        lookTarget.copy(desiredPosition).add(new THREE.Vector3(0,-10,0));
        lookTarget.lerp(ahead,smoothstep(35,36,t));

        const downWeight=smoothstep(0.9,1,u);
        ahead.copy(desiredPosition);
        ahead.y-=10;
        lookTarget.lerp(ahead,downWeight);

        aimAt(lookTarget);

        const bank=
          Math.sin(u*Math.PI*6)*0.16*Math.sin(u*Math.PI);

        bankRotation.setFromAxisAngle(localZ,bank);
        desiredQuaternion.multiply(bankRotation);
        return;
      }

      const u=smootherstep((Math.min(t,PAYLOAD_TIME)-60)/(PAYLOAD_TIME-60));
      deepPath.getPointAt(u,desiredPosition);
      pathAhead(deepPath,u,7,ahead);

      lookTarget.copy(desiredPosition);
      lookTarget.y-=10;
      lookTarget.lerp(ahead,smoothstep(0,0.12,u));
      lookTarget.lerp(payloadRoot.position,smoothstep(0.73,1,u));

      aimAt(lookTarget);
    }

    sampleCamera(0);
    camera.position.copy(desiredPosition);
    camera.quaternion.copy(desiredQuaternion);
    camera.updateMatrixWorld(true);

    const target=new THREE.WebGLRenderTarget(1,1,{
      type:renderTextureType,
      format:THREE.RGBAFormat,
      minFilter:THREE.LinearFilter,
      magFilter:THREE.LinearFilter,
      depthBuffer:true,
      stencilBuffer:false
    });

    target.texture.encoding=THREE.LinearEncoding;
    target.texture.generateMipmaps=false;

    const composer=new THREE.EffectComposer(renderer,target);
    composer.addPass(new THREE.RenderPass(scene,camera));

    const bloom=new THREE.UnrealBloomPass(
      new THREE.Vector2(256,256),
      0.72,
      0.55,
      hdrAvailable ? 1.12 : 0.88
    );

    for(const renderTarget of [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ]) {
      renderTarget.texture.type=renderTextureType;
      renderTarget.texture.encoding=THREE.LinearEncoding;
    }

    composer.addPass(bloom);

    const grade=new THREE.ShaderPass({
      uniforms:{
        tDiffuse:{value:null},
        uExposure:{value:1.0},
        uFade:{value:0}
      },
      vertexShader:`
        varying vec2 vUv;

        void main() {
          vUv=uv;
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);
        }
      `,
      fragmentShader:`
        uniform sampler2D tDiffuse;
        uniform float uExposure;
        uniform float uFade;
        varying vec2 vUv;

        vec3 filmic(vec3 x) {
          return clamp(
            (x*(2.51*x+0.03))/
            (x*(2.43*x+0.59)+0.14),
            0.0,
            1.0
          );
        }

        vec3 toDisplay(vec3 x) {
          vec3 low=x*12.92;
          vec3 high=1.055*pow(
            max(x,vec3(0.0)),vec3(1.0/2.4)
          )-0.055;

          return mix(low,high,step(vec3(0.0031308),x));
        }

        void main() {
          vec3 color=texture2D(tDiffuse,vUv).rgb*uExposure;
          color=toDisplay(filmic(color));

          vec2 p=vUv*2.0-1.0;
          float vignette=1.0-0.13*smoothstep(0.2,1.8,dot(p,p));

          gl_FragColor=vec4(
            color*vignette*(1.0-uFade),
            1.0
          );
        }
      `
    });
    composer.addPass(grade);

    const fxaa=new THREE.ShaderPass(THREE.FXAAShader);
    composer.addPass(fxaa);

    const reducedMotion=window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    let mode="auto";
    let paused=reducedMotion;
    let hudHidden=false;
    let contextLost=false;
    let flightTime=0;
    let visualTime=0;
    let cycleNumber=0;
    let resumeElapsed=RESUME_DURATION;
    let lastFrameTime=null;
    let nextUiUpdate=0;
    let activePhase=-1;
    let pixelRatio=1;
    let resizePending=false;

    const resumePosition=new THREE.Vector3();
    const resumeQuaternion=new THREE.Quaternion();
    const drawingSize=new THREE.Vector2();
    const projected=new THREE.Vector3();

    const fogBlack=new THREE.Color(0x000000);
    const fogRust=linearColor(0x1a0902);
    const fogDark=linearColor(0x020105);
    const fogBlue=linearColor(0x031324);
    const fogDeep=linearColor(0x010811);

    function syncControlsTarget() {
      forward.set(0,0,-1).applyQuaternion(camera.quaternion);

      const focusDistance=flightTime>=94
        ? Math.max(2,camera.position.distanceTo(payloadRoot.position))
        : 20;

      controls.target.copy(camera.position).addScaledVector(
        forward,focusDistance
      );
    }

    syncControlsTarget();

    /*
      Camera ownership:
      Auto mode copies only the cinematic camera pose.
      Manual mode calls OrbitControls.update().
      R clears residual motion and the active gesture state before blending.

      OrbitControls r128:
      https://github.com/mrdoob/three.js/blob/r128/examples/js/controls/OrbitControls.js
    */
    function clearControlMotion() {
      const savedPosition=camera.position.clone();
      const savedQuaternion=camera.quaternion.clone();
      const savedDamping=controls.enableDamping;

      controls.enableDamping=false;
      controls.saveState();
      controls.reset();

      camera.position.copy(savedPosition);
      camera.quaternion.copy(savedQuaternion);
      syncControlsTarget();

      controls.enableDamping=savedDamping;
      camera.updateMatrixWorld(true);
    }

    function announceMode() {
      ui.mode.textContent=mode==="manual"
        ? (paused ? "MANUAL / PAUSED" : "MANUAL / R TO RESUME")
        : (paused ? "FLIGHT PAUSED" : "AUTO FLIGHT");

      ui.pauseButton.textContent=mode==="manual"
        ? "Resume"
        : (paused ? "Play" : "Pause");

      ui.pauseButton.setAttribute("aria-pressed",String(paused));
    }

    function resumeFlight() {
      clearControlMotion();
      resumePosition.copy(camera.position);
      resumeQuaternion.copy(camera.quaternion);
      resumeElapsed=0;
      mode="auto";
      paused=false;
      lastFrameTime=null;
      announceMode();
    }

    function restartFlight() {
      clearControlMotion();

      flightTime=0;
      visualTime=0;
      cycleNumber=0;
      resumeElapsed=RESUME_DURATION;
      mode="auto";
      paused=false;
      lastFrameTime=null;

      sampleCamera(0);
      camera.position.copy(desiredPosition);
      camera.quaternion.copy(desiredQuaternion);
      syncControlsTarget();
      camera.updateMatrixWorld(true);

      grade.uniforms.uFade.value=0;
      announceMode();
    }

    function toggleHud() {
      hudHidden=!hudHidden;
      panel.setAttribute("aria-hidden",String(hudHidden));
      ui.hudButton.setAttribute("aria-expanded",String(!hudHidden));
      ui.hudButton.textContent=hudHidden ? "Show HUD" : "Hide HUD";
    }

    function togglePause() {
      if(mode==="manual") {
        resumeFlight();
        return;
      }

      paused=!paused;
      lastFrameTime=null;
      announceMode();
    }

    controls.addEventListener("start",()=>{
      if(mode==="auto") syncControlsTarget();
      mode="manual";
      resumeElapsed=RESUME_DURATION;
      announceMode();
    });

    renderer.domElement.addEventListener("pointerdown",()=>{
      renderer.domElement.focus({preventScroll:true});
    });

    ui.hudButton.addEventListener("click",toggleHud);
    ui.pauseButton.addEventListener("click",togglePause);
    ui.restartButton.addEventListener("click",restartFlight);

    window.addEventListener("keydown",(event)=>{
      if(event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;

      const element=event.target;

      if(
        element instanceof HTMLElement &&
        (
          element.isContentEditable ||
          /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName)
        )
      ) return;

      if(
        element instanceof HTMLButtonElement &&
        (event.code==="Space" || event.code==="Enter")
      ) return;

      if(event.code==="Space") {
        event.preventDefault();
        togglePause();
      } else if(event.code==="KeyR") {
        event.preventDefault();
        resumeFlight();
      } else if(event.code==="Home") {
        event.preventDefault();
        restartFlight();
      } else if(event.code==="KeyH") {
        event.preventDefault();
        toggleHud();
      }
    });

    function resize() {
      resizePending=false;

      const width=Math.max(1,window.innerWidth);
      const height=Math.max(1,window.innerHeight);
      pixelRatio=Math.min(window.devicePixelRatio||1,2);

      camera.aspect=width/height;
      camera.updateProjectionMatrix();

      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width,height);
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width,height);

      renderer.getDrawingBufferSize(drawingSize);

      fxaa.material.uniforms.resolution.value.set(
        1/drawingSize.x,
        1/drawingSize.y
      );

      bloom.setSize(
        Math.max(32,Math.floor(drawingSize.x*0.66)),
        Math.max(32,Math.floor(drawingSize.y*0.66))
      );

      const tangentHalfFov=Math.tan(
        THREE.MathUtils.degToRad(camera.fov*0.5)
      );

      shared.uPointScale.value=drawingSize.y/(2*tangentHalfFov);

      for(const label of labels) {
        const pixelWidth=label.payload
          ? Math.min(690,width*0.92)
          : Math.min(390,width*0.85);

        const normalizedWidth=
          2*tangentHalfFov*pixelWidth/height;

        label.sprite.scale.set(
          normalizedWidth,
          normalizedWidth*320/2048,
          1
        );
      }
    }

    window.addEventListener("resize",()=>{
      if(!resizePending) {
        resizePending=true;
        requestAnimationFrame(resize);
      }
    });

    renderer.domElement.addEventListener("webglcontextlost",(event)=>{
      event.preventDefault();
      contextLost=true;
      lastFrameTime=null;
      notice.hidden=false;
      notice.textContent=
        "Graphics context paused. Waiting for restoration.";
    });

    renderer.domElement.addEventListener("webglcontextrestored",()=>{
      contextLost=false;
      lastFrameTime=null;
      resize();
      notice.hidden=true;
    });

    document.addEventListener("visibilitychange",()=>{
      lastFrameTime=null;
    });

    function phaseAtTime(t) {
      if(t<15) return 0;
      if(t<30) return 1;
      if(t<35) return 2;
      if(t<60) return 3;
      if(t<PAYLOAD_TIME) return 4;
      return 5;
    }

    function formatTime(seconds) {
      const whole=Math.floor(seconds);
      return `${String(Math.floor(whole/60)).padStart(2,"0")}:`+
        String(whole%60).padStart(2,"0");
    }

    function formatPressure(value) {
      if(value===null) return "Vacuum";
      if(value<0.01) return `${value.toFixed(4)} bar`;
      if(value<1) return `${value.toFixed(3)} bar`;
      if(value<100) return `${value.toFixed(1)} bar`;

      return `${Math.round(value).toLocaleString("en-US")} bar`;
    }

    function updateInterface(now) {
      if(now<nextUiUpdate) return;
      nextUiUpdate=now+180;

      const phaseIndex=phaseAtTime(flightTime);
      const phase=phases[phaseIndex];
      const reference=referenceAtTime(flightTime);

      if(phaseIndex!==activePhase) {
        activePhase=phaseIndex;
        document.documentElement.style.setProperty("--accent",phase.accent);

        ui.number.textContent=
          `${String(phaseIndex+1).padStart(2,"0")} / 06`;
        ui.title.textContent=phase.title;
        ui.description.textContent=phase.description;
        ui.caption.textContent=phase.caption;

        for(const row of ui.rows) {
          const active=Number(row.dataset.phase)===phaseIndex;
          row.dataset.active=String(active);

          if(active) row.setAttribute("aria-current","step");
          else row.removeAttribute("aria-current");
        }
      }

      const roundedAltitude=Math.round(reference.h);
      ui.altitude.textContent=
        `${roundedAltitude>0 ? "+" : ""}`+
        `${roundedAltitude.toLocaleString("en-US")} km`;

      ui.pressure.textContent=formatPressure(reference.p);
      ui.temperature.textContent=reference.k===null
        ? "No ambient gas"
        : `${Math.round(reference.k).toLocaleString("en-US")} K`;

      ui.layer.textContent=reference.layer;
      ui.timeline.textContent=`${formatTime(flightTime)} / 02:00`;
      ui.progress.style.transform=
        `scaleX(${clamp01(flightTime/CYCLE_DURATION)})`;

      if(Math.min(window.devicePixelRatio||1,2)!==pixelRatio) resize();
    }

    function updateFog(t) {
      let density;

      if(t<15) {
        const f=smoothstep(11,15,t);
        density=THREE.MathUtils.lerp(0.00005,0.004,f);
        scene.fog.color.copy(fogBlack).lerp(fogRust,f);
      } else if(t<30) {
        const f=smoothstep(15,21,t);
        density=THREE.MathUtils.lerp(0.004,0.028,f);
        scene.fog.color.copy(fogRust);
      } else if(t<35) {
        const f=smoothstep(30,32,t);
        density=THREE.MathUtils.lerp(0.028,0.0003,f);
        scene.fog.color.copy(fogRust).lerp(fogBlack,f);
      } else if(t<60) {
        density=THREE.MathUtils.lerp(
          0.0003,0.052,smoothstep(35,44,t)
        );
        scene.fog.color.copy(fogRust).lerp(
          fogDark,smoothstep(44,59,t)
        );
      } else if(t<78) {
        density=THREE.MathUtils.lerp(
          0.052,0.014,smoothstep(60,78,t)
        );
        scene.fog.color.copy(fogDark).lerp(
          fogBlue,smoothstep(60,78,t)
        );
      } else {
        density=THREE.MathUtils.lerp(
          0.014,0.009,smoothstep(78,98,t)
        );
        scene.fog.color.copy(fogBlue).lerp(
          fogDeep,smoothstep(86,98,t)
        );
      }

      scene.fog.density=density;
      shared.uFogDensity.value=density;
    }

    function updateLabels(fade) {
      screenUp.set(0,1,0).applyQuaternion(camera.quaternion);

      payloadLabel.sprite.position
        .copy(payloadRoot.position)
        .addScaledVector(screenUp,-5.6);

      for(const label of labels) {
        const sprite=label.sprite;
        const distance=sprite.position.distanceTo(camera.position);

        projected.copy(sprite.position).project(camera);

        const visible=
          projected.z>-1 &&
          projected.z<1 &&
          Math.abs(projected.x)<1.15 &&
          Math.abs(projected.y)<1.15;

        let opacity;

        if(label.payload) {
          opacity=
            smoothstep(92,98,flightTime)*
            (0.9+0.1*Math.sin(visualTime*1.8));
        } else {
          opacity=hudHidden ? 0 :
            smoothstep(label.near,label.near+5,distance)*
            (1-smoothstep(label.far*0.7,label.far,distance));

          if(flightTime<13 || flightTime>97) opacity=0;
        }

        sprite.material.opacity=
          visible ? opacity*(1-fade) : 0;

        sprite.visible=sprite.material.opacity>0.002;
      }
    }

    function frame(now) {
      requestAnimationFrame(frame);

      if(contextLost || document.hidden) {
        lastFrameTime=null;
        return;
      }

      const delta=lastFrameTime===null
        ? 0
        : Math.min((now-lastFrameTime)/1000,0.05);

      lastFrameTime=now;

      if(!paused) {
        visualTime+=delta;

        if(mode==="auto") {
          if(resumeElapsed<RESUME_DURATION) {
            resumeElapsed=Math.min(
              RESUME_DURATION,resumeElapsed+delta
            );
          } else {
            flightTime+=delta;

            if(flightTime>=CYCLE_DURATION) {
              flightTime-=CYCLE_DURATION;
              cycleNumber+=1;
            }
          }
        }
      }

      sampleCamera(flightTime);

      if(mode==="auto") {
        if(resumeElapsed<RESUME_DURATION) {
          const blend=smootherstep(resumeElapsed/RESUME_DURATION);

          camera.position.lerpVectors(
            resumePosition,desiredPosition,blend
          );

          camera.quaternion.slerpQuaternions(
            resumeQuaternion,desiredQuaternion,blend
          );
        } else {
          camera.position.copy(desiredPosition);
          camera.quaternion.copy(desiredQuaternion);
        }

        syncControlsTarget();

        // The cinematic rig owns the camera in this branch.
        // OrbitControls.update() must not run afterward.
      } else {
        controls.dampingFactor=
          1-Math.exp(-4.8*Math.max(delta,1/240));
        controls.update();
      }

      camera.updateMatrixWorld(true);
      shared.uTime.value=visualTime;

      globeVisibility.value=1-smoothstep(14.8,19,flightTime);
      stormVisibility.value=
        smoothstep(10,16,flightTime)*
        (1-smoothstep(37,46,flightTime));

      weatherVisibility.value=
        smoothstep(33,38,flightTime)*
        (1-smoothstep(58,67,flightTime));

      deepVisibility.value=smoothstep(54,66,flightTime);

      planetRoot.visible=globeVisibility.value>0.001;
      stormRoot.visible=stormVisibility.value>0.001;
      weatherRoot.visible=weatherVisibility.value>0.001;
      deepRoot.visible=deepVisibility.value>0.001;
      payloadRoot.visible=flightTime>83;

      planetSpin.setFromAxisAngle(
        new THREE.Vector3(0,1,0),
        0.014*(Math.min(flightTime,15)-15)
      );
      planetRoot.quaternion.copy(planetAlignment).multiply(planetSpin);

      updateFog(flightTime);

      payloadFacing.quaternion.copy(camera.quaternion);
      sockRotor.rotation.y=visualTime*0.42;
      sockRotor.rotation.z=Math.sin(visualTime*0.34)*0.12;
      payloadHalo.rotation.z=visualTime*0.08;

      pinkMaterial.opacity=0.86+0.12*Math.sin(visualTime*1.7);
      limeMaterial.opacity=0.87+0.11*Math.sin(visualTime*1.5+1);

      let fade=0;

      if(mode==="auto") {
        fade=smoothstep(114,CYCLE_DURATION,flightTime);

        if(cycleNumber>0) {
          fade=Math.max(
            fade,
            1-smoothstep(0,3,flightTime)
          );
        }
      }

      grade.uniforms.uFade.value=fade;

      const interfaceOpacity=hudHidden ? 0 : 1-fade;
      panel.style.opacity=String(interfaceOpacity);
      caption.style.opacity=String(interfaceOpacity);

      updateLabels(fade);
      updateInterface(now);

      renderer.setRenderTarget(null);
      composer.render(delta);

      // Keep scene annotations and the discovery message crisp after bloom.
      renderer.setRenderTarget(null);
      renderer.clearDepth();
      renderer.render(annotationScene,camera);
    }

    resize();
    announceMode();
    notice.hidden=true;
    requestAnimationFrame(frame);
  }
})();