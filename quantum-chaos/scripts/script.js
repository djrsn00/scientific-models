(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const UNIT = 8;

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ease = t => t * t * t * (10 + t * (-15 + 6 * t));

  /*
   * Quantum model:
   *   Stadium cap radius R = 1, straight-region half-length a = 1.
   *   epsilon = 2 m R² E / hbar²
   *   tau     = hbar t / (2 m R²)
   *
   * Boundary-conforming Rayleigh–Ritz basis:
   *   f_pq = b(x,y) P_p(x/2) P_q(y)
   *   b    = 1 - y² - max(|x| - 1, 0)²
   *
   * The 96 trial functions split into four reflection-parity sectors.
   * Twelve approximate modes per sector are retained for rendering.
   * Matrix arithmetic and basis evaluation use double precision.
   */

  function gauss(n, a, b) {
    const nodes = [];

    for (let i = 0; i < n; i++) {
      let z = Math.cos(Math.PI * (i + 0.75) / (n + 0.5));
      let d = 0;

      for (let iteration = 0; iteration < 30; iteration++) {
        let p = 1;
        let q = 0;

        for (let j = 1; j <= n; j++) {
          const r = q;
          q = p;
          p = ((2 * j - 1) * z * q - (j - 1) * r) / j;
        }

        d = n * (z * p - q) / (z * z - 1);

        const step = p / d;
        z -= step;

        if (Math.abs(step) < 2e-15) break;
      }

      nodes.push({
        x: (a + b + (b - a) * z) / 2,
        w: (b - a) / ((1 - z * z) * d * d)
      });
    }

    return nodes;
  }

  function legendre(x, n) {
    const p = new Float64Array(n);
    const d = new Float64Array(n);

    p[0] = 1;
    p[1] = x;
    d[1] = 1;

    for (let k = 2; k < n; k++) {
      p[k] = (
        (2 * k - 1) * x * p[k - 1] -
        (k - 1) * p[k - 2]
      ) / k;

      d[k] = (
        (2 * k - 1) * (p[k - 1] + x * d[k - 1]) -
        (k - 1) * d[k - 2]
      ) / k;
    }

    return { p, d };
  }

  function basisAt(x, y) {
    const px = legendre(x / 2, 12);
    const py = legendre(y, 8);

    const cap = Math.max(0, Math.abs(x) - 1);
    const b = Math.max(0, 1 - y * y - cap * cap);

    const bx = -2 * cap * Math.sign(x);
    const by = -2 * y;

    const f = new Float64Array(96);
    const dx = new Float64Array(96);
    const dy = new Float64Array(96);

    for (let p = 0; p < 12; p++) {
      for (let q = 0; q < 8; q++) {
        const k = p * 8 + q;

        f[k] = b * px.p[p] * py.p[q];

        dx[k] = (
          bx * px.p[p] + b * px.d[p] / 2
        ) * py.p[q];

        dy[k] = px.p[p] * (
          by * py.p[q] + b * py.d[q]
        );
      }
    }

    return { f, dx, dy };
  }

  function quadrature(order) {
    const unit = gauss(order, 0, 1);
    const angle = gauss(order, 0, Math.PI / 2);
    const points = [];

    for (const u of unit) {
      for (const v of unit) {
        points.push({
          x: u.x,
          y: v.x,
          w: u.w * v.w,
          ...basisAt(u.x, v.x)
        });
      }
    }

    for (const r of unit) {
      for (const theta of angle) {
        const x = 1 + r.x * Math.cos(theta.x);
        const y = r.x * Math.sin(theta.x);

        points.push({
          x,
          y,
          w: r.w * theta.w * r.x,
          ...basisAt(x, y)
        });
      }
    }

    return points;
  }

  function symmetricEigen(matrix, n) {
    const a = Float64Array.from(matrix);
    const v = new Float64Array(n * n);

    for (let i = 0; i < n; i++) {
      v[i * n + i] = 1;
    }

    for (let sweep = 0; sweep < 90; sweep++) {
      let largest = 0;
      let diagonal = 1;

      for (let i = 0; i < n; i++) {
        diagonal = Math.max(diagonal, Math.abs(a[i * n + i]));
      }

      for (let p = 0; p < n - 1; p++) {
        for (let q = p + 1; q < n; q++) {
          const pq = a[p * n + q];

          largest = Math.max(largest, Math.abs(pq));

          if (Math.abs(pq) < diagonal * 2e-14) continue;

          const angle = 0.5 * Math.atan2(
            2 * pq,
            a[q * n + q] - a[p * n + p]
          );

          const c = Math.cos(angle);
          const s = Math.sin(angle);

          const pp = a[p * n + p];
          const qq = a[q * n + q];

          for (let k = 0; k < n; k++) {
            if (k === p || k === q) continue;

            const kp = a[k * n + p];
            const kq = a[k * n + q];

            a[k * n + p] = a[p * n + k] = c * kp - s * kq;
            a[k * n + q] = a[q * n + k] = s * kp + c * kq;
          }

          a[p * n + p] = c * c * pp - 2 * s * c * pq + s * s * qq;
          a[q * n + q] = s * s * pp + 2 * s * c * pq + c * c * qq;
          a[p * n + q] = a[q * n + p] = 0;

          for (let k = 0; k < n; k++) {
            const vp = v[k * n + p];
            const vq = v[k * n + q];

            v[k * n + p] = c * vp - s * vq;
            v[k * n + q] = s * vp + c * vq;
          }
        }
      }

      if (largest < diagonal * 1e-12) break;

      if (sweep === 89) {
        throw new Error("The projected eigensolver did not converge.");
      }
    }

    return {
      values: Array.from({ length: n }, (_, i) => a[i * n + i]),
      vectors: v
    };
  }

  function solveSector(points, sx, sy) {
    const ids = [];

    for (let p = sx; p < 12; p += 2) {
      for (let q = sy; q < 8; q += 2) {
        ids.push(p * 8 + q);
      }
    }

    const n = ids.length;
    const M = new Float64Array(n * n);
    const K = new Float64Array(n * n);

    for (const point of points) {
      const w = 4 * point.w;

      for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
          const u = ids[i];
          const v = ids[j];
          const ij = i * n + j;

          M[ij] += w * point.f[u] * point.f[v];

          K[ij] += w * (
            point.dx[u] * point.dx[v] +
            point.dy[u] * point.dy[v]
          );
        }
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < i; j++) {
        M[j * n + i] = M[i * n + j];
        K[j * n + i] = K[i * n + j];
      }
    }

    const scale = Float64Array.from(
      ids,
      (_, i) => 1 / Math.sqrt(M[i * n + i])
    );

    const L = new Float64Array(n * n);
    const A = new Float64Array(n * n);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        A[i * n + j] = K[i * n + j] * scale[i] * scale[j];
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = M[i * n + j] * scale[i] * scale[j];

        for (let k = 0; k < j; k++) {
          sum -= L[i * n + k] * L[j * n + k];
        }

        if (i === j && sum <= 1e-13) {
          throw new Error(
            "The numerical mass matrix is not positive definite."
          );
        }

        L[i * n + j] = i === j
          ? Math.sqrt(sum)
          : sum / L[j * n + j];
      }
    }

    const inv = new Float64Array(n * n);

    for (let col = 0; col < n; col++) {
      for (let i = 0; i < n; i++) {
        let sum = i === col ? 1 : 0;

        for (let j = 0; j < i; j++) {
          sum -= L[i * n + j] * inv[j * n + col];
        }

        inv[i * n + col] = sum / L[i * n + i];
      }
    }

    const temp = new Float64Array(n * n);
    const B = new Float64Array(n * n);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        for (let k = 0; k < n; k++) {
          temp[i * n + j] += inv[i * n + k] * A[k * n + j];
        }
      }
    }

    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0;

        for (let k = 0; k < n; k++) {
          sum += temp[i * n + k] * inv[j * n + k];
        }

        B[i * n + j] = B[j * n + i] = sum;
      }
    }

    const eig = symmetricEigen(B, n);

    const order = eig.values
      .map((_, i) => i)
      .sort((a, b) => eig.values[a] - eig.values[b]);

    const normK = Math.hypot(...K);
    const normM = Math.hypot(...M);

    return order.slice(0, 12).map((col, index) => {
      const coeff = new Float64Array(96);
      const c = new Float64Array(n);

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          c[i] += inv[j * n + i] * eig.vectors[j * n + col];
        }

        c[i] *= scale[i];
      }

      let norm = 0;

      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          norm += c[i] * M[i * n + j] * c[j];
        }
      }

      for (let i = 0; i < n; i++) {
        c[i] /= Math.sqrt(norm);
        coeff[ids[i]] = c[i];
      }

      let residual = 0;

      for (let i = 0; i < n; i++) {
        let r = 0;

        for (let j = 0; j < n; j++) {
          r += (
            K[i * n + j] -
            eig.values[col] * M[i * n + j]
          ) * c[j];
        }

        residual += r * r;
      }

      residual = Math.sqrt(residual) / (
        (normK + eig.values[col] * normM) * Math.hypot(...c)
      );

      return {
        energy: eig.values[col],
        coeff,
        ids,
        sx,
        sy,
        index: index + 1,
        residual,
        eta: {}
      };
    });
  }

  const ORBITS = {
    horizontal: {
      name: "Long-axis orbit",
      type: "Unstable / two reflections",
      points: [
        [-2, 0],
        [2, 0],
        [-2, 0]
      ],
      description:
        "Two curved-cap reflections close this isolated, unstable orbit."
    },

    bowtie: {
      name: "Four-bounce bow-tie",
      type: "Unstable / four reflections",
      points: [
        [1.5, Math.sqrt(3) / 2],
        [-1.5, -Math.sqrt(3) / 2],
        [-1.5, Math.sqrt(3) / 2],
        [1.5, -Math.sqrt(3) / 2],
        [1.5, Math.sqrt(3) / 2]
      ],
      description:
        "Four specular cap collisions close a hyperbolic periodic orbit."
    },

    bouncing: {
      name: "Bouncing-ball family",
      type: "Marginal / straight-wall family",
      points: [
        [0, -1],
        [0, 1],
        [0, -1]
      ],
      description:
        "This vertical member belongs to a marginally stable family, not an unstable scar orbit."
    }
  };

  function segmentDistance(x, y, a, b) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];

    const t = clamp(
      ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy),
      0,
      1
    );

    return Math.hypot(
      x - a[0] - t * dx,
      y - a[1] - t * dy
    );
  }

  function evaluateMode(mode, f) {
    let value = 0;

    for (const k of mode.ids) {
      value += mode.coeff[k] * f[k];
    }

    return value;
  }

  function buildModel(order = 28) {
    const quad = quadrature(order);
    const sectors = [];

    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        sectors.push(solveSector(quad, x, y));
      }
    }

    const modes = sectors.flat();
    const momentsR = new Float64Array(96);
    const momentsI = new Float64Array(96);

    let seedNorm = 0;

    for (const point of quad) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const x = sx * point.x;
          const y = sy * point.y;
          const cap = Math.max(0, Math.abs(x) - 1);

          const amp = (1 - y * y - cap * cap) * Math.exp(
            -((x + 0.65) ** 2 + (y - 0.12) ** 2) /
            (4 * 0.43 ** 2)
          );

          const phase = 4 * x + 1.1 * y;

          seedNorm += point.w * amp * amp;

          for (let p = 0; p < 12; p++) {
            for (let q = 0; q < 8; q++) {
              const k = p * 8 + q;

              const sign =
                (p % 2 ? sx : 1) *
                (q % 2 ? sy : 1);

              const a = point.w * point.f[k] * sign * amp;

              momentsR[k] += a * Math.cos(phase);
              momentsI[k] += a * Math.sin(phase);
            }
          }
        }
      }
    }

    const packet = modes.map(mode => {
      let re = 0;
      let im = 0;

      for (const k of mode.ids) {
        re += mode.coeff[k] * momentsR[k];
        im += mode.coeff[k] * momentsI[k];
      }

      return {
        re: re / Math.sqrt(seedNorm),
        im: im / Math.sqrt(seedNorm)
      };
    });

    const retained = packet.reduce(
      (sum, c) => sum + c.re * c.re + c.im * c.im,
      0
    );

    for (const c of packet) {
      c.re /= Math.sqrt(retained);
      c.im /= Math.sqrt(retained);
    }

    const energy = packet.reduce(
      (sum, c, i) =>
        sum + (c.re * c.re + c.im * c.im) * modes[i].energy,
      0
    );

    /*
     * The discontinuous orbit-band mask uses a separate dense midpoint
     * quadrature. It is not inserted into the wavefunction or shader.
     */
    const samples = [];

    const bandArea = {
      horizontal: 0,
      bowtie: 0,
      bouncing: 0
    };

    const nx = 180;
    const ny = 90;
    const cell = (2 / nx) * (1 / ny);
    const area = 4 + Math.PI;

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        const x = (i + 0.5) * 2 / nx;
        const y = (j + 0.5) / ny;

        if (Math.max(0, x - 1) ** 2 + y * y >= 1) continue;

        const bands = [];

        for (const key of Object.keys(ORBITS)) {
          const points = ORBITS[key].points;
          let distance = Infinity;

          for (let k = 1; k < points.length; k++) {
            distance = Math.min(
              distance,
              segmentDistance(x, y, points[k - 1], points[k])
            );
          }

          if (distance < 0.16) {
            bands.push(key);
            bandArea[key] += 4 * cell;
          }
        }

        if (bands.length) {
          samples.push({
            f: basisAt(x, y).f,
            bands
          });
        }
      }
    }

    function enhancement(mode, key) {
      if (mode.eta[key] !== undefined) return mode.eta[key];

      let integral = 0;

      for (const point of samples) {
        if (point.bands.includes(key)) {
          integral += evaluateMode(mode, point.f) ** 2 * 4 * cell;
        }
      }

      mode.eta[key] = integral / (bandArea[key] / area);
      return mode.eta[key];
    }

    const scars = {};

    for (const key of ["horizontal", "bowtie"]) {
      scars[key] = sectors[0].slice(3, 10).reduce((best, mode) =>
        enhancement(mode, key) > enhancement(best, key)
          ? mode
          : best
      );
    }

    const probeBasis = basisAt(0.35, 0.2).f;

    return {
      modes,
      sectors,
      packet,
      retained,
      energy,
      enhancement,
      scars,
      probeBasis,
      area: quad.reduce((sum, point) => sum + 4 * point.w, 0),
      basisSize: 96
    };
  }

  /*
   * Analytic Bunimovich ray tracer.
   *
   * Straight walls:
   *   y = +/-1, |x| <= 1
   *
   * Curved caps:
   *   (x - 1)² + y² = 1, x >= 1
   *   (x + 1)² + y² = 1, x <= -1
   *
   * Specular reflection:
   *   v_out = v_in - 2 (v_in dot n) n
   */

  function collision(x, y, vx, vy) {
    let best = Infinity;
    let nx = 0;
    let ny = 0;

    const accept = (t, ax, ay) => {
      if (t > 1e-8 && t < best) {
        best = t;
        nx = ax;
        ny = ay;
      }
    };

    if (Math.abs(vy) > 1e-12) {
      for (const wall of [-1, 1]) {
        const t = (wall - y) / vy;
        const hitX = x + vx * t;

        if (Math.abs(hitX) <= 1 + 1e-10) {
          accept(t, 0, wall);
        }
      }
    }

    for (const cx of [-1, 1]) {
      const rx = x - cx;
      const b = rx * vx + y * vy;
      const c = rx * rx + y * y - 1;
      const discriminant = b * b - c;

      if (discriminant < 0) continue;

      const root = Math.sqrt(discriminant);

      for (const t of [-b - root, -b + root]) {
        const hx = x + t * vx;
        const hy = y + t * vy;

        if (
          (cx < 0 && hx <= -1 + 1e-10) ||
          (cx > 0 && hx >= 1 - 1e-10)
        ) {
          accept(t, hx - cx, hy);
        }
      }
    }

    if (!Number.isFinite(best)) {
      throw new Error("A classical ray missed the stadium boundary.");
    }

    return { distance: best, nx, ny };
  }

  function makeRay(angle, offset = 0) {
    const ray = {
      x: -0.73,
      y: 0.11 + offset,
      vx: Math.cos(angle),
      vy: Math.sin(angle),
      hits: 0
    };

    ray.next = collision(ray.x, ray.y, ray.vx, ray.vy);

    return ray;
  }

  function advanceRay(ray, distance, onHit) {
    let remaining = distance;
    let guard = 0;

    while (remaining >= ray.next.distance && guard++ < 32) {
      const t = ray.next.distance;

      ray.x += ray.vx * t;
      ray.y += ray.vy * t;
      remaining -= t;

      if (onHit) onHit(ray.x, ray.y);

      const dot = ray.vx * ray.next.nx + ray.vy * ray.next.ny;

      ray.vx -= 2 * dot * ray.next.nx;
      ray.vy -= 2 * dot * ray.next.ny;

      const speed = Math.hypot(ray.vx, ray.vy);

      ray.vx /= speed;
      ray.vy /= speed;
      ray.hits++;

      ray.next = collision(ray.x, ray.y, ray.vx, ray.vy);
    }

    ray.x += ray.vx * remaining;
    ray.y += ray.vy * remaining;
    ray.next.distance -= remaining;
  }

  let T;

  const $ = id => document.getElementById(id);

  const textAt = (id, value) => {
    const element = $(id);

    if (element && element.textContent !== String(value)) {
      element.textContent = value;
    }
  };

  const nextPaint = () =>
    new Promise(resolve => requestAnimationFrame(resolve));

  function fail(error) {
    console.error("Quantum Chaos:", error);

    document.body.dataset.engineState = "error";

    $("canvas-container").setAttribute("aria-busy", "false");

    document.querySelectorAll("[data-engine-control]").forEach(element => {
      element.disabled = true;
    });

    $("render-notice").hidden = false;
    $("render-notice").setAttribute("role", "alert");

    textAt("notice-title", "The instrument could not start");
    textAt("notice-message", error.message || String(error));

    textAt(
      "notice-detail",
      "Check WebGL and hardware acceleration, keep the three files together, " +
      "and allow the Three.js CDN libraries to load. Then reload."
    );

    $("notice-reload").hidden = false;
  }

  function lineObject(points, color, opacity = 1, closed = false) {
    const geometry = new T.BufferGeometry().setFromPoints(points);

    const material = new T.LineBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false
    });

    return closed
      ? new T.LineLoop(geometry, material)
      : new T.Line(geometry, material);
  }

  function contour(z = 0, scale = UNIT) {
    const points = [];

    for (let i = 0; i <= 80; i++) {
      const angle = -Math.PI / 2 + Math.PI * i / 80;

      points.push(new T.Vector3(
        (1 + Math.cos(angle)) * scale,
        Math.sin(angle) * scale,
        z
      ));
    }

    for (let i = 0; i <= 80; i++) {
      const angle = Math.PI / 2 + Math.PI * i / 80;

      points.push(new T.Vector3(
        (-1 + Math.cos(angle)) * scale,
        Math.sin(angle) * scale,
        z
      ));
    }

    return points;
  }

  /*
   * The scar view uses these same field shaders with an unmodified,
   * computed Ritz eigenfunction. No orbit-shaped brightness mask is used.
   */
  const fieldVertex = [
    "precision highp float;",
    "attribute vec2 aPsi;",
    "uniform float uEncoding;",
    "uniform float uHeight;",
    "uniform float uPixelScale;",
    "varying vec2 vPsi;",
    "varying float vDistance;",

    "void main() {",
    "  vPsi = aPsi;",
    "  float rho = dot(aPsi, aPsi);",
    "  vec3 p = position;",
    "  float height = 1.0 - exp(-2.0 * rho);",

    "  if (uEncoding > 1.5) {",
    "    height = 0.8 * aPsi.x / sqrt(1.0 + aPsi.x * aPsi.x);",
    "  }",

    "  p.z += uHeight * height;",
    "  vec4 mv = modelViewMatrix * vec4(p, 1.0);",
    "  vDistance = length(mv.xyz);",
    "  gl_Position = projectionMatrix * mv;",

    "  gl_PointSize = clamp(",
    "    uPixelScale * 0.018 / max(1.0, -mv.z),",
    "    1.0,",
    "    3.5",
    "  );",
    "}"
  ].join("\n");

  const fieldFragment = [
    "precision highp float;",
    "uniform float uEncoding;",
    "uniform float uOpacity;",
    "uniform float uPoints;",
    "uniform float uNodes;",
    "varying vec2 vPsi;",
    "varying float vDistance;",

    "void main() {",
    "  float rho = dot(vPsi, vPsi);",
    "  if (rho < 1.0e-14) discard;",

    "  float strength = 1.0 - exp(-2.0 * rho);",
    "  float phase = atan(vPsi.y, vPsi.x);",

    "  vec3 color = vec3(",
    "    0.65 - 0.30 * cos(phase),",
    "    0.58 + 0.34 * cos(phase) + 0.11 * sin(phase),",
    "    0.96 - 0.07 * cos(phase) - 0.10 * sin(phase)",
    "  );",

    "  if (uEncoding > 0.5 && uEncoding < 1.5) {",
    "    color = vec3(0.28, 0.77, 1.0);",
    "  }",

    "  if (uEncoding > 1.5) {",
    "    strength = 1.0 - exp(-1.8 * abs(vPsi.x));",
    "    color = vPsi.x >= 0.0",
    "      ? vec3(0.30, 0.92, 1.0)",
    "      : vec3(1.0, 0.28, 0.77);",
    "  }",

    "  float detail = mix(",
    "    0.12 + 0.88 * strength,",
    "    strength,",
    "    uNodes",
    "  );",

    "  float alpha = uOpacity * min(1.0, detail * 2.4);",
    "  float gain = 0.78;",

    "  if (uPoints > 0.5) {",
    "    float r = length(gl_PointCoord - vec2(0.5));",
    "    if (r > 0.5) discard;",
    "    alpha *= smoothstep(0.5, 0.04, r);",
    "    gain = 2.0;",
    "  }",

    "  if (alpha < 0.003) discard;",

    "  float fog = exp(-vDistance * vDistance * 0.000018);",
    "  gl_FragColor = vec4(",
    "    color * (0.10 + 1.55 * detail) * gain * fog,",
    "    alpha",
    "  );",
    "}"
  ].join("\n");

  function makeGrid(model, nx, ny) {
    const count = (nx + 1) * (ny + 1);

    const positions = new Float32Array(count * 3);
    const weights = new Float64Array(count);
    const fxy = new Float64Array(count * 2);

    const fields = model.modes.map(() => new Float32Array(count));
    const indices = [];

    for (let i = 0; i <= nx; i++) {
      const x = -2 + 4 * i / nx;

      const half = Math.sqrt(
        Math.max(0, 1 - Math.max(0, Math.abs(x) - 1) ** 2)
      );

      for (let j = 0; j <= ny; j++) {
        const k = i * (ny + 1) + j;
        const y = (-1 + 2 * j / ny) * half;

        positions[k * 3] = x * UNIT;
        positions[k * 3 + 1] = y * UNIT;

        fxy[k * 2] = x;
        fxy[k * 2 + 1] = y;

        weights[k] = 8 * half / (nx * ny) *
          (j === 0 || j === ny ? 0.5 : 1);

        const f = basisAt(x, y).f;

        for (let m = 0; m < model.modes.length; m++) {
          fields[m][k] = evaluateMode(model.modes[m], f);
        }

        if (i < nx && j < ny) {
          const a = k;
          const b = k + ny + 1;

          indices.push(
            a, b, a + 1,
            b, b + 1, a + 1
          );
        }
      }
    }

    const geometry = new T.BufferGeometry();

    geometry.setAttribute(
      "position",
      new T.BufferAttribute(positions, 3)
    );

    geometry.setAttribute(
      "aPsi",
      new T.BufferAttribute(
        new Float32Array(count * 2),
        2
      ).setUsage(T.DynamicDrawUsage)
    );

    geometry.setIndex(indices);

    return {
      geometry,
      count,
      fields,
      weights,
      fxy
    };
  }

  function makeField(grid, height = 3.4) {
    const uniforms = {
      uEncoding: { value: 0 },
      uHeight: { value: height },
      uPixelScale: { value: 1000 },
      uOpacity: { value: 1 },
      uNodes: { value: 1 }
    };

    function material(points) {
      return new T.ShaderMaterial({
        uniforms: {
          ...uniforms,
          uPoints: { value: points ? 1 : 0 }
        },
        vertexShader: fieldVertex,
        fragmentShader: fieldFragment,
        transparent: true,
        depthWrite: false,
        side: T.DoubleSide,
        blending: points ? T.AdditiveBlending : T.NormalBlending
      });
    }

    const group = new T.Group();
    const mesh = new T.Mesh(grid.geometry, material(false));
    const points = new T.Points(grid.geometry, material(true));

    mesh.frustumCulled = false;
    points.frustumCulled = false;

    group.add(mesh, points);

    return {
      group,
      uniforms,
      grid,
      data: grid.geometry.attributes.aPsi.array,
      real: new Float64Array(grid.count),
      imag: new Float64Array(grid.count),
      centroid: new T.Vector3(),
      norm: 0
    };
  }

  function fillField(field, model, mode, time) {
    const { grid, real, imag, data } = field;

    real.fill(0);
    imag.fill(0);

    if (mode) {
      real.set(grid.fields[model.modes.indexOf(mode)]);
    } else {
      for (let m = 0; m < model.modes.length; m++) {
        const angle = model.modes[m].energy * time;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        const a = model.packet[m];

        const re = a.re * c + a.im * s;
        const im = a.im * c - a.re * s;

        const values = grid.fields[m];

        for (let k = 0; k < grid.count; k++) {
          real[k] += re * values[k];
          imag[k] += im * values[k];
        }
      }
    }

    let norm = 0;
    let x = 0;
    let y = 0;

    for (let k = 0; k < grid.count; k++) {
      data[2 * k] = real[k];
      data[2 * k + 1] = imag[k];

      const w = (
        real[k] ** 2 + imag[k] ** 2
      ) * grid.weights[k];

      norm += w;
      x += grid.fxy[k * 2] * w;
      y += grid.fxy[k * 2 + 1] * w;
    }

    field.centroid.set(
      UNIT * x / Math.max(norm, 1e-10),
      UNIT * y / Math.max(norm, 1e-10),
      0
    );

    field.norm = norm;
    grid.geometry.attributes.aPsi.needsUpdate = true;
  }

  function createWorld(model) {
    const scene = new T.Scene();
    scene.background = new T.Color(0x02040a);

    const floorVertices = [];

    for (let x = -44; x <= 44; x += 4) {
      floorVertices.push(x, -32, -2.7, x, 36, -2.7);
    }

    for (let y = -32; y <= 36; y += 4) {
      floorVertices.push(-44, y, -2.7, 44, y, -2.7);
    }

    const floorGeometry = new T.BufferGeometry();

    floorGeometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(floorVertices, 3)
    );

    scene.add(new T.LineSegments(
      floorGeometry,
      new T.LineBasicMaterial({
        color: 0x24425e,
        transparent: true,
        opacity: 0.20,
        depthWrite: false
      })
    ));

    const shape = new T.Shape();

    shape.moveTo(-UNIT, -UNIT);
    shape.lineTo(UNIT, -UNIT);
    shape.absarc(UNIT, 0, UNIT, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(-UNIT, UNIT);
    shape.absarc(-UNIT, 0, UNIT, Math.PI / 2, Math.PI * 1.5, false);

    const base = new T.Mesh(
      new T.ShapeGeometry(shape, 64),
      new T.MeshBasicMaterial({
        color: 0x040b17,
        side: T.DoubleSide,
        transparent: true,
        opacity: 0.96
      })
    );

    base.position.z = -0.12;
    scene.add(base);

    scene.add(lineObject(contour(0), 0x62dfff, 0.85, true));
    scene.add(lineObject(contour(0.65), 0x9aa8ff, 0.48, true));
    scene.add(lineObject(contour(-1.8), 0x344d7e, 0.4, true));

    const posts = [];

    contour()
      .filter((_, i) => i % 8 === 0)
      .forEach(point => {
        posts.push(
          point.x, point.y, -1.8,
          point.x, point.y, 0.65
        );
      });

    const postGeometry = new T.BufferGeometry();

    postGeometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(posts, 3)
    );

    scene.add(new T.LineSegments(
      postGeometry,
      new T.LineBasicMaterial({
        color: 0x5082af,
        transparent: true,
        opacity: 0.23
      })
    ));

    const mainField = makeField(makeGrid(model, 112, 56));

    mainField.group.position.z = 0.025;
    scene.add(mainField.group);
    fillField(mainField, model, null, 0);

    const orbitLines = {};

    for (const [key, orbit] of Object.entries(ORBITS)) {
      const points = orbit.points.map(point =>
        new T.Vector3(
          point[0] * UNIT,
          point[1] * UNIT,
          0.85
        )
      );

      orbitLines[key] = lineObject(
        points,
        key === "bouncing" ? 0xaebbd1 : 0xffd591,
        0
      );

      scene.add(orbitLines[key]);
    }

    const rays = [];

    for (let i = 0; i < 2; i++) {
      const geometry = new T.BufferGeometry();

      geometry.setAttribute(
        "position",
        new T.BufferAttribute(
          new Float32Array(132 * 3),
          3
        ).setUsage(T.DynamicDrawUsage)
      );

      geometry.setDrawRange(0, 0);

      const material = new T.LineBasicMaterial({
        color: i ? 0xff986e : 0xffdb8c,
        transparent: true,
        opacity: 0.75,
        depthWrite: false
      });

      const trail = new T.Line(geometry, material);
      trail.frustumCulled = false;

      const head = new T.Mesh(
        new T.SphereGeometry(0.10, 10, 8),
        new T.MeshBasicMaterial({
          color: i ? 0xffad85 : 0xffe2a2
        })
      );

      scene.add(trail, head);

      rays.push({
        trail,
        head,
        history: [],
        ray: null
      });
    }

    function resetRays() {
      rays.forEach((entry, i) => {
        entry.ray = makeRay(
          0.617 + i * 0.0001,
          i * 0.00001
        );

        entry.history = [[entry.ray.x, entry.ray.y]];
      });
    }

    function updateRays(dt, opacity) {
      rays.forEach(entry => {
        if (dt > 0) {
          advanceRay(entry.ray, dt * 0.55, (x, y) => {
            entry.history.push([x, y]);

            if (entry.history.length > 130) {
              entry.history.shift();
            }
          });
        }

        const data = entry.trail.geometry.attributes.position.array;
        let k = 0;

        for (const point of entry.history) {
          data[k++] = point[0] * UNIT;
          data[k++] = point[1] * UNIT;
          data[k++] = 0.38;
        }

        data[k++] = entry.ray.x * UNIT;
        data[k++] = entry.ray.y * UNIT;
        data[k++] = 0.38;

        entry.trail.geometry.setDrawRange(0, k / 3);
        entry.trail.geometry.attributes.position.needsUpdate = true;

        entry.trail.material.opacity = opacity * 0.74;

        entry.trail.visible = opacity > 0.01;
        entry.head.visible = opacity > 0.01;

        entry.head.position.set(
          entry.ray.x * UNIT,
          entry.ray.y * UNIT,
          0.38
        );
      });
    }

    resetRays();
    updateRays(0, 1);

    const stationPositions = [
      -22.5, -13.5, -4.5, 4.5, 13.5, 22.5
    ].map(x => new T.Vector3(x, 19, 0));

    const miniGrid = makeGrid(model, 36, 20);
    const miniFields = [];

    function miniField(index, mode) {
      const grid = {
        ...miniGrid,
        geometry: miniGrid.geometry.clone()
      };

      const field = makeField(grid, 3.4);

      fillField(field, model, mode, 0);

      field.group.scale.setScalar(0.19);
      field.group.position.copy(stationPositions[index]);

      scene.add(field.group);
      miniFields.push(field);

      return field;
    }

    miniField(1, null);
    miniField(2, model.sectors[1][2]);
    miniField(3, model.scars.horizontal);

    stationPositions.forEach((position, i) => {
      const platform = lineObject(
        contour(-0.1, 1.55),
        i === 0 || i === 3 ? 0xc7a26b : 0x567db7,
        0.5,
        true
      );

      platform.position.copy(position);
      scene.add(platform);

      const stem = lineObject(
        [
          new T.Vector3(position.x, position.y, -2.7),
          new T.Vector3(position.x, position.y, -0.3)
        ],
        0x3f658b,
        0.4
      );

      scene.add(stem);
    });

    const sampleRay = makeRay(0.617);

    const rayPoints = [
      new T.Vector3(
        sampleRay.x * 1.5,
        sampleRay.y * 1.5,
        0.1
      )
    ];

    for (let i = 0; i < 9; i++) {
      advanceRay(
        sampleRay,
        sampleRay.next.distance + 1e-7,
        (x, y) => {
          rayPoints.push(new T.Vector3(x * 1.5, y * 1.5, 0.1));
        }
      );
    }

    const classicalMini = lineObject(rayPoints, 0xffd590, 0.75);

    classicalMini.position.copy(stationPositions[0]);
    scene.add(classicalMini);

    const scarPath = lineObject(
      ORBITS.horizontal.points.map(point =>
        new T.Vector3(
          point[0] * 1.52,
          point[1] * 1.52,
          0.24
        )
      ),
      0xffd590,
      0.8
    );

    scarPath.position.copy(stationPositions[3]);
    scene.add(scarPath);

    const rectangle = new T.Group();
    const aspect = (1 + Math.sqrt(5)) / 2;

    const positions = [];
    const colors = [];

    for (let i = 0; i <= 56; i++) {
      for (let j = 0; j <= 34; j++) {
        const u = i / 56;
        const v = j / 34;

        const psi = (
          2 *
          Math.sin(3 * Math.PI * u) *
          Math.sin(2 * Math.PI * v)
        ) / Math.sqrt(aspect);

        positions.push(
          (u - 0.5) * 5.3,
          (v - 0.5) * 5.3 / aspect,
          0.13 + 0.16 * psi * psi
        );

        const color = new T.Color(
          psi >= 0 ? 0x68ddff : 0xef8bd7
        ).multiplyScalar(0.15 + 0.6 * Math.abs(psi));

        colors.push(color.r, color.g, color.b);
      }
    }

    const rectangleGeometry = new T.BufferGeometry();

    rectangleGeometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(positions, 3)
    );

    rectangleGeometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(colors, 3)
    );

    rectangle.add(new T.Points(
      rectangleGeometry,
      new T.PointsMaterial({
        size: 0.065,
        vertexColors: true,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: T.AdditiveBlending
      })
    ));

    const rw = 2.65;
    const rh = rw / aspect;

    rectangle.add(lineObject(
      [
        [-rw, -rh],
        [rw, -rh],
        [rw, rh],
        [-rw, rh]
      ].map(point => new T.Vector3(point[0], point[1], 0)),
      0x77daff,
      0.85,
      true
    ));

    const rectangleRay = [];

    let rx = -0.6;
    let ry = 0.17;
    let vx = Math.cos(0.617);
    let vy = Math.sin(0.617);

    rectangleRay.push(new T.Vector3(rx, ry, 0.3));

    for (let i = 0; i < 28; i++) {
      const tx = ((vx > 0 ? rw : -rw) - rx) / vx;
      const ty = ((vy > 0 ? rh : -rh) - ry) / vy;
      const dt = Math.min(tx, ty);

      rx += vx * dt;
      ry += vy * dt;

      rectangleRay.push(new T.Vector3(rx, ry, 0.3));

      if (Math.abs(dt - tx) < 1e-9) vx = -vx;
      if (Math.abs(dt - ty) < 1e-9) vy = -vy;
    }

    rectangle.add(lineObject(rectangleRay, 0xe8c693, 0.28));

    rectangle.position.copy(stationPositions[4]);
    scene.add(rectangle);

    const spectrum = new T.Group();
    const levels = model.sectors[0];
    const spectrumLines = [];

    for (let i = 0; i < levels.length; i++) {
      const z = 0.7 + (
        10 * (levels[i].energy - levels[0].energy) /
        (levels[11].energy - levels[0].energy)
      );

      const line = lineObject(
        [
          new T.Vector3(-2, 0, z),
          new T.Vector3(2, 0, z)
        ],
        0xac9bff,
        0.65
      );

      spectrum.add(line);
      spectrumLines.push(line);
    }

    spectrum.add(lineObject(
      [
        new T.Vector3(-2.4, 0, 0.3),
        new T.Vector3(-2.4, 0, 11.3)
      ],
      0x526b98,
      0.55
    ));

    spectrum.position.set(27, 2, 0);
    scene.add(spectrum);

    const spectrumMini = spectrum.clone();

    spectrumMini.scale.setScalar(0.23);
    spectrumMini.position.copy(stationPositions[5]);
    scene.add(spectrumMini);

    return {
      scene,
      mainField,
      miniFields,
      rays,
      resetRays,
      updateRays,
      orbitLines,
      stationPositions,
      spectrum,
      spectrumLines
    };
  }

  function drawSpacingChart() {
    const canvas = $("spacing-chart");
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    const left = 51;
    const right = width - 24;
    const top = 25;
    const bottom = height - 45;

    const X = s => left + s / 3.5 * (right - left);
    const Y = p => bottom - p / 1.1 * (bottom - top);

    ctx.clearRect(0, 0, width, height);
    ctx.font = "17px monospace";
    ctx.lineWidth = 1;
    ctx.strokeStyle = "#24364f";
    ctx.fillStyle = "#a3b6ce";

    for (const s of [0, 1, 2, 3]) {
      ctx.beginPath();
      ctx.moveTo(X(s), top);
      ctx.lineTo(X(s), bottom);
      ctx.stroke();
      ctx.fillText(String(s), X(s) - 5, bottom + 25);
    }

    for (const p of [0, 0.5, 1]) {
      ctx.beginPath();
      ctx.moveTo(left, Y(p));
      ctx.lineTo(right, Y(p));
      ctx.stroke();
      ctx.fillText(String(p), 8, Y(p) + 5);
    }

    const curves = [
      ["#79e7ff", s => Math.exp(-s)],
      [
        "#f6a0dc",
        s => Math.PI * s / 2 * Math.exp(-Math.PI * s * s / 4)
      ]
    ];

    for (const [color, law] of curves) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();

      for (let i = 0; i <= 180; i++) {
        const s = i * 3.5 / 180;

        if (i === 0) {
          ctx.moveTo(X(s), Y(law(s)));
        } else {
          ctx.lineTo(X(s), Y(law(s)));
        }
      }

      ctx.stroke();
    }

    ctx.fillStyle = "#b9c9de";
    ctx.fillText("P(s)", 9, 16);
    ctx.fillText("s", right - 6, bottom + 25);
  }

  function createAnnotations(
    scene,
    renderer,
    model,
    world,
    enterInspection
  ) {
    const cards = [];
    const names = [];

    function card(
      template,
      position,
      key,
      priority = 0,
      station = false
    ) {
      const root = document.createElement("div");
      root.className = "world-anchor";

      const article = $(template).content.firstElementChild.cloneNode(true);

      root.appendChild(article);
      renderer.domElement.appendChild(root);

      const object = new T.CSS2DObject(root);
      object.position.copy(position);
      scene.add(object);

      const leader = lineObject(
        [position.clone(), position.clone()],
        0x7194b5,
        0
      );

      leader.frustumCulled = false;
      leader.material.depthTest = false;
      scene.add(leader);

      const item = {
        root,
        article,
        object,
        leader,
        key,
        priority,
        station,
        alpha: 0,
        target: 0,
        dx: 0,
        dy: 0
      };

      article.style.left = "0";
      article.style.top = "0";

      article.addEventListener(
        "pointerdown",
        () => enterInspection(true)
      );

      article.addEventListener(
        "wheel",
        () => enterInspection(true),
        { passive: true }
      );

      article.addEventListener(
        "focusin",
        () => enterInspection(true)
      );

      article.setAttribute("aria-hidden", "true");
      article.inert = true;

      cards.push(item);

      return item;
    }

    const main = {
      boundary: card(
        "boundary-card-template",
        new T.Vector3(14, 4, 1),
        "boundary",
        10
      ),

      classical: card(
        "classical-card-template",
        new T.Vector3(-8, -3, 1),
        "classical",
        12
      ),

      packet: card(
        "packet-card-template",
        new T.Vector3(-5, 1, 2),
        "packet",
        12
      ),

      eigenstate: card(
        "eigenstate-card-template",
        new T.Vector3(4, 2, 3),
        "eigenstate",
        12
      ),

      scar: card(
        "scar-card-template",
        new T.Vector3(0, 0, 2),
        "scar",
        15
      ),

      comparison: card(
        "comparison-card-template",
        world.stationPositions[4].clone().add(new T.Vector3(0, 0, 1)),
        "comparison",
        15
      ),

      spectrum: card(
        "spectrum-card-template",
        new T.Vector3(27, 2, 7),
        "spectrum",
        15
      ),

      orbit: card(
        "orbit-card-template",
        new T.Vector3(8, 0, 1),
        "orbit",
        11
      )
    };

    const templates = [
      "classical",
      "packet",
      "eigenstate",
      "scar",
      "comparison",
      "spectrum"
    ];

    const captions = [
      "CLASSICAL RAYS",
      "INITIAL PROJECTED PACKET",
      "RITZ MODE / + − / j = 3",
      "SCAR CANDIDATE / LONG AXIS",
      "RECTANGLE / p = 3, q = 2",
      "RITZ LEVELS / + +"
    ];

    templates.forEach((key, i) => {
      if (i !== 4) {
        card(
          key + "-card-template",
          world.stationPositions[i].clone().add(new T.Vector3(0, 0, 1)),
          key,
          2,
          true
        );
      }

      const root = document.createElement("div");
      root.className = "world-anchor";

      const child = document.createElement("span");

      child.className = "world-name" +
        (i === 0 ? " world-name--gold" : "");

      child.textContent = captions[i];
      root.appendChild(child);

      const object = new T.CSS2DObject(root);

      object.position
        .copy(world.stationPositions[i])
        .add(new T.Vector3(0, -2, 0));

      scene.add(object);
      names.push({ root, object });
    });

    const projected = new T.Vector3();
    const end = new T.Vector3();
    const anchorScreen = new T.Vector3();

    const intersects = (a, b) =>
      a.x < b.x + b.w &&
      a.x + a.w > b.x &&
      a.y < b.y + b.h &&
      a.y + a.h > b.y;

    let blockers = [];

    function reserved(hud) {
      if (!hud) return [];

      return [
        "sidebar-ui",
        "flight-controls",
        "scene-caption",
        "reference-legend"
      ].map(id => {
        const rect = $(id).getBoundingClientRect();

        return {
          x: rect.left - 7,
          y: rect.top - 7,
          w: rect.width + 14,
          h: rect.height + 14
        };
      }).filter(rect => rect.w > 15 && rect.h > 15);
    }

    function layout(camera, keys, hud, width, height) {
      blockers = reserved(hud);

      const used = blockers.slice();

      const sorted = cards
        .slice()
        .sort((a, b) => b.priority - a.priority);

      let count = 0;

      for (const entry of sorted) {
        entry.target = 0;

        if (!hud || count >= (width < 900 ? 1 : 2)) continue;

        const eligible = entry.station
          ? camera.position.distanceTo(entry.object.position) < 25
          : keys.includes(entry.key);

        if (!eligible) continue;

        projected.copy(entry.object.position).project(camera);

        if (
          projected.z < -1 ||
          projected.z > 1 ||
          Math.abs(projected.x) > 1 ||
          Math.abs(projected.y) > 1
        ) {
          continue;
        }

        entry.root.style.display = "";

        const w = entry.article.offsetWidth;
        const h = entry.article.offsetHeight;

        const px = (projected.x * 0.5 + 0.5) * width;
        const py = (-projected.y * 0.5 + 0.5) * height;

        const options = [
          [23, -h / 2],
          [-w - 23, -h / 2],
          [23, -h - 18],
          [-w - 23, 18],
          [-w / 2, 26]
        ];

        for (const [dx, dy] of options) {
          const rect = {
            x: px + dx,
            y: py + dy,
            w,
            h
          };

          if (
            rect.x < 10 ||
            rect.y < 78 ||
            rect.x + w > width - 10 ||
            rect.y + h > height - 12 ||
            used.some(other => intersects(rect, other))
          ) {
            continue;
          }

          entry.article.style.transform =
            "translate(" + dx + "px," + dy + "px)";

          entry.dx = dx > 0 ? dx : dx + w;
          entry.dy = dy + h / 2;
          entry.target = 1;

          used.push(rect);
          count++;
          break;
        }
      }

      for (const entry of names) {
        projected.copy(entry.object.position).project(camera);

        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;

        const rect = {
          x: x + 10,
          y: y - 12,
          w: 200,
          h: 25
        };

        entry.object.visible =
          hud &&
          projected.z > -1 &&
          projected.z < 1 &&
          rect.x > 8 &&
          rect.y > 75 &&
          rect.x + rect.w < width - 8 &&
          rect.y < height - 25 &&
          !used.some(other => intersects(rect, other));

        entry.root.style.opacity = entry.object.visible ? "0.86" : "0";

        entry.root.setAttribute(
          "aria-hidden",
          String(!entry.object.visible)
        );

        if (entry.object.visible) used.push(rect);
      }
    }

    function update(camera, dt, hud, width, height) {
      for (const entry of cards) {
        entry.alpha += (
          (hud ? entry.target : 0) - entry.alpha
        ) * (1 - Math.exp(-dt * 9));

        entry.object.visible = hud && entry.alpha > 0.01;
        entry.root.style.opacity = String(entry.alpha);

        const interactive =
          entry.object.visible &&
          entry.target === 1 &&
          entry.alpha > 0.5;

        if (
          !interactive &&
          entry.article.contains(document.activeElement)
        ) {
          $("hud-toggle").focus({ preventScroll: true });
        }

        entry.article.inert = !interactive;
        entry.article.tabIndex = interactive ? 0 : -1;
        entry.article.style.pointerEvents = interactive ? "auto" : "none";

        entry.article.setAttribute(
          "aria-hidden",
          String(!interactive)
        );

        entry.leader.visible = entry.object.visible;
        entry.leader.material.opacity = entry.alpha * 0.43;

        if (!entry.object.visible) continue;

        anchorScreen.copy(entry.object.position).project(camera);

        end.set(
          anchorScreen.x + 2 * entry.dx / width,
          anchorScreen.y - 2 * entry.dy / height,
          anchorScreen.z
        ).unproject(camera);

        const attribute = entry.leader.geometry.attributes.position;

        attribute.setXYZ(
          0,
          entry.object.position.x,
          entry.object.position.y,
          entry.object.position.z
        );

        attribute.setXYZ(1, end.x, end.y, end.z);
        attribute.needsUpdate = true;
      }
    }

    function slot(key, value, slotName = "readout") {
      const element = main[key].article.querySelector(
        '[data-slot="' + slotName + '"]'
      );

      if (element && element.textContent !== value) {
        element.textContent = value;
      }
    }

    return {
      main,
      cards,
      layout,
      update,
      slot
    };
  }

  const CHAPTERS = [
    [
      45,
      "Classical stadium",
      "A deterministic beginning.",
      "Specular reflections obey fixed rules. The stadium's geometry makes nearby classical trajectories sensitive to their initial conditions.",
      "Classical reference trajectories · no random kicks",
      "packet",
      ["boundary", "classical"]
    ],
    [
      55,
      "Trajectory divergence",
      "A small difference grows.",
      "The two rays start almost together. Their measured separation fluctuates and eventually becomes comparable with the cavity size.",
      "Spatial separation δ / R · no numerical Lyapunov exponent",
      "packet",
      ["classical"]
    ],
    [
      40,
      "Quantum transition",
      "Replace the path with a field.",
      "A quantum state assigns complex amplitudes across the cavity. Probability density is the squared magnitude of that field.",
      "Projected quantum wave packet · finite numerical model",
      "packet",
      ["packet"]
    ],
    [
      65,
      "Wave packet",
      "Spread. Reflect. Interfere.",
      "A packet prepared inside the hard wall evolves through relative mode phases. Its spatial extent changes while its total probability is conserved.",
      "Closed cavity · unitary evolution within 48 retained modes",
      "packet",
      ["packet"]
    ],
    [
      55,
      "Interference",
      "Amplitude can cancel.",
      "Bright regions and dark gaps emerge from superposition. Phase controls interference; phase is undefined at an exact node.",
      "Height and brightness encode density in the phase view",
      "packet",
      ["packet"]
    ],
    [
      50,
      "Eigenstate",
      "A stationary probability pattern.",
      "An approximate energy eigenstate has a fixed density. Its global phase is held fixed here so the spatial signs remain readable.",
      "Boundary-conforming Ritz mode · display transition into a stationary state",
      "eigen-low",
      ["eigenstate"]
    ],
    [
      60,
      "Higher modes",
      "The nodal map becomes finer.",
      "Compare several low-to-intermediate Ritz modes. Higher mode structure is more sensitive to the finite numerical basis.",
      "Approximate eigenfunctions · sector-local indices",
      "eigen-high",
      ["eigenstate"]
    ],
    [
      70,
      "Quantum scar candidate",
      "An orbit and a concentration.",
      "This unmodified numerical mode has enhanced density near the unstable long-axis orbit. Orbit overlap identifies a candidate, not proof of scarring.",
      "Gold is a classical reference · no added density along the path",
      "scar",
      ["scar", "orbit"]
    ],
    [
      60,
      "Integrable vs chaotic",
      "A contrast in geometry.",
      "The rectangle separates into independent standing waves. Curved stadium caps destroy that simple separability and produce different mode structures.",
      "Analytic rectangle modes beside approximate stadium modes",
      "eigen-mid",
      ["comparison"]
    ],
    [
      55,
      "Spectral statistics",
      "Read between the levels.",
      "The ladder contains computed Ritz energies in one parity sector. Poisson and GOE curves are theoretical references, not a measured histogram.",
      "Single-sector spectrum · mean-scaled gaps, not full unfolding",
      "eigen-mid",
      ["spectrum"]
    ],
    [
      55,
      "Periodic orbits",
      "Rare paths organize the comparison.",
      "The long-axis and bow-tie paths are unstable. The straight-wall bouncing-ball family is marginally stable and is shown separately.",
      "Specular classical orbits · comparison structures",
      "eigen-mid",
      ["orbit"]
    ],
    [
      50,
      "Full overview",
      "Classical instability. Quantum structure.",
      "Geometry, interference, eigenmodes, orbit enhancement, and spectral references describe different aspects of one carefully defined billiard.",
      "2D hard-wall system / 3D scientific visualization",
      "scar",
      ["boundary", "scar"]
    ]
  ];

  const CAMERA_POS = [
    [38, -36, 30],
    [3, -18, 13],
    [-30, -18, 18],
    [-18, 14, 16],
    [-8, 8, 12],
    [18, 9, 20],
    [23, -9, 21],
    [0, -24, 19],
    [17, 0, 24],
    [36, -12, 19],
    [30, 32, 24],
    [42, -47, 47]
  ];

  const CAMERA_AIM = [
    [0, 0, 1],
    [0, 0, 1],
    [-4, 0, 1],
    [0, 0, 1],
    [1, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [10, 15, 1],
    [27, 2, 5],
    [0, 10, 1],
    [0, 9, 1]
  ];

  function curve(points, index, t, out) {
    const n = points.length;

    const a = points[(index + n - 1) % n];
    const b = points[index % n];
    const c = points[(index + 1) % n];
    const d = points[(index + 2) % n];

    for (let k = 0; k < 3; k++) {
      out.setComponent(
        k,
        0.5 * (
          2 * b[k] +
          (-a[k] + c[k]) * t +
          (2 * a[k] - 5 * b[k] + 4 * c[k] - d[k]) * t * t +
          (-a[k] + 3 * b[k] - 3 * c[k] + d[k]) * t * t * t
        )
      );
    }

    return out;
  }

  async function boot() {
    T = window.THREE;

    const required = [
      "WebGLRenderer",
      "OrbitControls",
      "CSS2DRenderer",
      "CSS2DObject",
      "EffectComposer",
      "RenderPass",
      "ShaderPass",
      "UnrealBloomPass",
      "FXAAShader"
    ];

    if (!T || required.some(name => !T[name])) {
      throw new Error("A required Three.js library did not load.");
    }

    textAt(
      "notice-message",
      "Solving the boundary-conforming stadium modes."
    );

    await nextPaint();

    const model = buildModel();

    if (
      Math.abs(model.area - 4 - Math.PI) > 1e-9 ||
      model.modes.some(mode =>
        !Number.isFinite(mode.energy) ||
        mode.energy <= 0 ||
        mode.residual > 1e-8
      )
    ) {
      throw new Error(
        "The numerical model did not pass its initialization checks."
      );
    }

    textAt(
      "notice-message",
      "Preparing wave surfaces, trajectories, and annotations."
    );

    await nextPaint();

    const container = $("canvas-container");

    const renderer = new T.WebGLRenderer({
      antialias: false,
      alpha: false,
      powerPreference: "high-performance"
    });

    renderer.outputEncoding = T.LinearEncoding;
    renderer.toneMapping = T.NoToneMapping;
    renderer.setClearColor(0x02040a, 1);

    const canvas = renderer.domElement;

    canvas.tabIndex = 0;

    canvas.setAttribute(
      "aria-label",
      "Quantum stadium. Drag to orbit; scroll to zoom."
    );

    container.appendChild(canvas);

    const camera = new T.PerspectiveCamera(44, 1, 0.08, 230);
    camera.up.set(0, 0, 1);

    const controlCamera = camera.clone();

    const controls = new T.OrbitControls(controlCamera, canvas);

    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.65;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.65;
    controls.minDistance = 3;
    controls.maxDistance = 125;
    controls.minPolarAngle = 0.01;
    controls.maxPolarAngle = Math.PI * 0.49;
    controls.enabled = false;

    const world = createWorld(model);
    const scene = world.scene;

    const labelRenderer = new T.CSS2DRenderer();

    labelRenderer.domElement.id = "label-layer";
    container.appendChild(labelRenderer.domElement);

    const hdr =
      renderer.capabilities.isWebGL2 &&
      renderer.extensions.has("EXT_color_buffer_float");

    const targetType = hdr ? T.HalfFloatType : T.UnsignedByteType;

    const target = new T.WebGLRenderTarget(1, 1, {
      type: targetType,
      format: T.RGBAFormat,
      minFilter: T.LinearFilter,
      magFilter: T.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false
    });

    const composer = new T.EffectComposer(renderer, target);
    composer.addPass(new T.RenderPass(scene, camera));

    const bloom = new T.UnrealBloomPass(
      new T.Vector2(1, 1),
      0.58,
      0.44,
      hdr ? 0.83 : 0.62
    );

    [
      bloom.renderTargetBright,
      ...bloom.renderTargetsHorizontal,
      ...bloom.renderTargetsVertical
    ].forEach(renderTarget => {
      renderTarget.texture.type = targetType;
      renderTarget.texture.format = T.RGBAFormat;
    });

    composer.addPass(bloom);

    const tone = new T.ShaderPass({
      uniforms: {
        tDiffuse: { value: null }
      },

      vertexShader: [
        "varying vec2 vUv;",
        "void main() {",
        "  vUv = uv;",
        "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
        "}"
      ].join("\n"),

      fragmentShader: [
        "uniform sampler2D tDiffuse;",
        "varying vec2 vUv;",

        "void main() {",
        "  vec3 x = max(vec3(0.0), texture2D(tDiffuse, vUv).rgb * 1.08);",
        "  vec3 c = clamp(",
        "    (x * (2.51 * x + 0.03)) /",
        "    (x * (2.43 * x + 0.59) + 0.14),",
        "    0.0,",
        "    1.0",
        "  );",

        "  vec3 lo = c * 12.92;",
        "  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;",

        "  gl_FragColor = vec4(",
        "    mix(lo, hi, step(vec3(0.0031308), c)),",
        "    1.0",
        "  );",
        "}"
      ].join("\n")
    });

    composer.addPass(tone);

    const fxaa = new T.ShaderPass(T.FXAAShader);
    composer.addPass(fxaa);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");

    const state = {
      auto: true,
      paused: media.matches,
      hud: true,
      tour: 0,
      quantum: 0,
      chapter: -1,
      substage: -1,
      key: "packet",
      mode: null,
      orbit: "horizontal",
      encoding: "phase",
      nodes: true,
      rays: true,
      manualKeys: null,
      pending: null,
      fadingOut: false,
      fieldAlpha: 1,
      fieldTarget: 0,
      rayTarget: 1,
      orbitTarget: 0,
      fieldLayer: 0,
      rayLayer: 1,
      orbitLayer: 0
    };

    const starts = [];

    const total = CHAPTERS.reduce((sum, chapter) => {
      starts.push(sum);
      return sum + chapter[0];
    }, 0);

    const focus = new T.Vector3(0, 0, 1);
    const tracked = new T.Vector3();
    const poseCamera = camera.clone();

    const pose = {
      position: new T.Vector3(),
      aim: new T.Vector3(),
      quaternion: new T.Quaternion(),
      fov: 44
    };

    const probeValues = model.modes.map(mode =>
      evaluateMode(mode, model.probeBasis)
    );

    let width = 1;
    let height = 1;
    let dpr = 1;
    let viewOffset = 0;
    let motion = null;

    let annotations;
    let dead = false;
    let lost = false;
    let ready = false;
    let raf = 0;

    let last = 0;
    let fieldElapsed = 1;
    let labelElapsed = 1;
    let hudElapsed = 1;
    let dirty = true;

    function timeInfo(time) {
      let index = CHAPTERS.length - 1;

      for (let i = 0; i < CHAPTERS.length; i++) {
        if (time < starts[i] + CHAPTERS[i][0]) {
          index = i;
          break;
        }
      }

      return {
        index,
        fraction: clamp(
          (time - starts[index]) / CHAPTERS[index][0],
          0,
          1
        )
      };
    }

    function tourPose(time, out) {
      const info = timeInfo(time);
      const u = ease(info.fraction);

      curve(CAMERA_POS, info.index, u, out.position);
      curve(CAMERA_AIM, info.index, u, out.aim);

      if (info.index === 3 || info.index === 4) {
        out.aim.addScaledVector(
          tracked,
          0.35 * Math.sin(Math.PI * info.fraction)
        );
      }

      out.fov = 44 + 3 * Math.sin(
        (info.index + u) * Math.PI / 6
      );

      poseCamera.position.copy(out.position);
      poseCamera.lookAt(out.aim);
      out.quaternion.copy(poseCamera.quaternion);

      return out;
    }

    function syncControls() {
      controls.enabled = false;
      controls.enableDamping = false;
      controls.update();

      controlCamera.position.copy(camera.position);
      controlCamera.quaternion.copy(camera.quaternion);
      controlCamera.up.copy(camera.up);
      controlCamera.fov = camera.fov;
      controlCamera.aspect = camera.aspect;
      controlCamera.updateProjectionMatrix();

      const distance = Math.max(
        3,
        camera.position.distanceTo(focus)
      );

      const direction = new T.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion);

      controls.target
        .copy(camera.position)
        .addScaledVector(direction, distance);

      controls.update();
      controls.enableDamping = true;
      controls.enabled = true;
    }

    function flightUI() {
      let mode;

      if (motion) {
        mode = motion.resume
          ? "Returning to drone"
          : "Framing inspection";
      } else if (state.auto) {
        mode = state.paused
          ? "Automatic drone / paused"
          : "Automatic drone";
      } else {
        mode = state.paused
          ? "Manual / paused"
          : "Manual";
      }

      textAt("flight-mode", mode);
      textAt("pause-label", state.paused ? "Play" : "Pause");

      $("pause-toggle").setAttribute(
        "aria-pressed",
        String(state.paused)
      );

      $("rays-toggle").setAttribute(
        "aria-pressed",
        String(state.rays)
      );

      $("nodes-toggle").setAttribute(
        "aria-pressed",
        String(state.nodes)
      );
    }

    function enterManual(freeze = false) {
      if (state.auto || motion) {
        motion = null;
        state.auto = false;
        syncControls();
      }

      if (freeze) state.paused = true;

      flightUI();
    }

    function selectMode(key) {
      if (key === "eigen-low") return model.sectors[0][0];
      if (key === "eigen-mid") return model.sectors[0][2];
      if (key === "eigen-high") return model.sectors[2][4];

      if (key === "scar") {
        return model.scars[state.orbit] || model.scars.horizontal;
      }

      return null;
    }

    function requestField(key, reset = false, override = null) {
      const mode = override || selectMode(key);

      if (
        state.key === key &&
        state.mode === mode &&
        !reset
      ) {
        state.pending = null;
        state.fadingOut = false;
        return;
      }

      state.pending = { key, mode, reset };
      state.fadingOut = true;

      textAt(
        "display-status",
        "Display transition between prepared states; this fade is not quantum evolution."
      );

      if (media.matches || state.fieldLayer < 0.003) {
        commitField();
      }
    }

    function commitField() {
      if (!state.pending) return;

      const pending = state.pending;

      state.key = pending.key;
      state.mode = pending.mode;

      if (pending.reset) state.quantum = 0;

      state.pending = null;
      state.fadingOut = false;
      state.fieldAlpha = media.matches ? 1 : 0;

      $("state-select").value = state.key;
      dirty = true;

      if (state.key === "packet") {
        textAt(
          "display-status",
          "Projected packet: " +
          (100 * model.retained).toFixed(2) +
          "% of preparation retained before normalization."
        );
      } else if (state.key === "scar") {
        textAt(
          "display-status",
          "Orbit-enhanced Ritz mode. Enhancement alone does not prove scarring."
        );
      } else {
        textAt(
          "display-status",
          "Stationary Ritz mode. Density is fixed; global phase is held constant."
        );
      }

      textAt(
        "accessibility-status",
        state.key === "packet"
          ? "Projected wave packet selected."
          : "Numerical mode " + state.mode.index + " selected."
      );
    }

    function setOrbit(key, show = true) {
      state.orbit = key;
      $("orbit-select").value = key;

      if (show) state.orbitTarget = 1;

      textAt("orbit-description", ORBITS[key].description);

      if (annotations) {
        annotations.slot("orbit", ORBITS[key].name, "title");

        annotations.slot(
          "orbit",
          ORBITS[key].description,
          "description"
        );

        annotations.slot("orbit", ORBITS[key].type);

        annotations.slot(
          "orbit",
          key === "bouncing"
            ? "Marginally stable family. This is not an unstable-orbit scar example."
            : "An unstable classical reference orbit. Quantum probability is carried by the wavefunction.",
          "footnote"
        );
      }
    }

    function applyChapter(index, resetRays = true) {
      state.chapter = index;
      state.substage = -1;
      state.manualKeys = null;

      const chapter = CHAPTERS[index];

      textAt(
        "chapter-value",
        String(index + 1).padStart(2, "0") + " / " + chapter[1]
      );

      textAt("scene-title", chapter[2]);
      textAt("scene-description", chapter[3]);
      textAt("scene-model-note", chapter[4]);

      state.fieldTarget = index < 2 ? 0 : 1;
      state.rays = index < 2 || index === 11;
      state.rayTarget = state.rays ? 1 : 0;
      state.orbitTarget = [7, 10, 11].includes(index) ? 1 : 0;

      if ([7, 10, 11].includes(index)) {
        setOrbit("horizontal", true);
      }

      requestField(chapter[5], index === 2);

      if (index < 2 && resetRays) {
        world.resetRays();
      }

      $("journey-stages")
        .querySelectorAll("li")
        .forEach((item, i) => {
          item.classList.toggle("is-active", i === index);
          item.classList.toggle("is-complete", i < index);

          const button = item.querySelector("button");

          if (i === index) {
            button.setAttribute("aria-current", "step");
          } else {
            button.removeAttribute("aria-current");
          }
        });

      textAt(
        "stage-counter",
        String(index + 1).padStart(2, "0") + " / 12"
      );

      flightUI();
      labelElapsed = 1;
    }

    function beginMotion(resume) {
      tourPose(state.tour, pose);

      motion = {
        elapsed: 0,
        duration: media.matches ? 0.15 : 4.2,
        resume,
        startPosition: camera.position.clone(),
        startQuaternion: camera.quaternion.clone(),
        startFocus: focus.clone(),
        startFov: camera.fov,
        endPosition: pose.position.clone(),
        endQuaternion: pose.quaternion.clone(),
        endFocus: pose.aim.clone(),
        endFov: pose.fov
      };

      controls.enabled = false;
      flightUI();
    }

    function resumeFlight() {
      state.auto = false;
      state.paused = false;

      applyChapter(timeInfo(state.tour).index, false);
      beginMotion(true);
    }

    function togglePause() {
      if (motion) enterManual(false);

      state.paused = !state.paused;
      flightUI();
    }

    function setEncoding(value) {
      state.encoding = value;

      world.mainField.uniforms.uEncoding.value = {
        phase: 0,
        density: 1,
        real: 2
      }[value];

      $("field-select").value = value;

      const description = value === "phase"
        ? "Height and brightness encode probability density; hue encodes phase."
        : value === "density"
          ? "Height and brightness encode probability density. A single cyan palette is used."
          : "Signed height and brightness encode Re(ψ). Cyan is positive; magenta is negative.";

      textAt("encoding-description", description);

      textAt(
        "legend-field-note",
        value === "phase"
          ? "Hue: phase φ · Height / brightness: |ψ|²"
          : value === "density"
            ? "Cyan field · Height / brightness: |ψ|²"
            : "Cyan + / magenta − · Real-component zeros are not generally nodes of a complex packet."
      );

      document.querySelector(".phase-ramp").hidden = value !== "phase";
      document.querySelector(".phase-ticks").hidden = value !== "phase";
    }

    function manualField(key, reset = false) {
      enterManual(false);
      state.fieldTarget = 1;

      if (key === "scar") {
        if (state.orbit === "bouncing") {
          setOrbit("horizontal");
        }

        state.orbitTarget = 1;
      }

      requestField(key, reset);

      state.manualKeys = [
        key === "packet"
          ? "packet"
          : key === "scar"
            ? "scar"
            : "eigenstate"
      ];

      textAt("chapter-value", "Manual / Quantum inspection");

      textAt(
        "scene-title",
        key === "packet"
          ? "A prepared wave packet."
          : key === "scar"
            ? "Inspect an orbit-enhanced mode."
            : "Read a stationary mode."
      );

      textAt(
        "scene-description",
        key === "scar"
          ? "The field is unchanged by the gold orbit overlay. Its orbit-band score is a candidate diagnostic, not proof of scarring."
          : key === "packet"
            ? "Relative mode phases evolve while probability is conserved within the retained numerical basis."
            : "Dark nodal lines divide the real numerical eigenfunction into regions of opposite sign."
      );

      textAt(
        "scene-model-note",
        "Manual inspection · R returns smoothly to the guided tour"
      );

      labelElapsed = 1;
    }

    annotations = createAnnotations(
      scene,
      labelRenderer,
      model,
      world,
      enterManual
    );

    setOrbit("horizontal", false);

    annotations.cards
      .filter(entry => entry.station)
      .forEach(entry => {
        const readout = entry.article.querySelector(
          '[data-slot="readout"]'
        );

        if (!readout) return;

        const values = {
          classical: "Fixed path sample / specular reflections",
          packet: "Initial packet snapshot / τ = 0",

          eigenstate:
            "Parity + − / j = 3 / ε = " +
            model.sectors[1][2].energy.toFixed(4),

          scar:
            "Long-axis candidate / η ≈ " +
            model.enhancement(
              model.scars.horizontal,
              "horizontal"
            ).toFixed(2),

          spectrum: "12 computed levels / even-even parity"
        };

        readout.textContent = values[entry.key];
      });

    textAt("basis-size", "96 / four parity sectors");

    document.querySelector(
      ".probe-readout .micro-note"
    ).textContent = "Phase is hidden when |ψ| < 10⁻⁶ in this display.";

    drawSpacingChart();

    function resize() {
      width = Math.max(1, container.clientWidth);
      height = Math.max(1, container.clientHeight);

      dpr = Math.min(
        window.devicePixelRatio || 1,
        1.6,
        Math.sqrt(2600000 / (width * height))
      );

      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);

      composer.setPixelRatio(dpr);
      composer.setSize(width, height);

      bloom.setSize(
        Math.max(1, Math.round(width * dpr * 0.65)),
        Math.max(1, Math.round(height * dpr * 0.65))
      );

      fxaa.uniforms.resolution.value.set(
        1 / (width * dpr),
        1 / (height * dpr)
      );

      labelRenderer.setSize(width, height);

      camera.aspect = width / height;
      controlCamera.aspect = width / height;

      camera.updateProjectionMatrix();
      controlCamera.updateProjectionMatrix();

      labelElapsed = 1;
    }

    function toggleHUD() {
      state.hud = !state.hud;

      if (
        !state.hud &&
        $("sidebar-ui").contains(document.activeElement)
      ) {
        $("hud-toggle").focus({ preventScroll: true });
      }

      document.body.classList.toggle("hud-hidden", !state.hud);

      [
        "sidebar-ui",
        "scene-caption",
        "reference-legend"
      ].forEach(id => {
        $(id).inert = !state.hud;
        $(id).setAttribute("aria-hidden", String(!state.hud));
      });

      $("hud-toggle").setAttribute(
        "aria-expanded",
        String(state.hud)
      );

      textAt("hud-label", state.hud ? "Hide HUD" : "Show HUD");
      labelElapsed = 1;
    }

    function fatal(error) {
      if (dead) return;

      dead = true;
      cancelAnimationFrame(raf);
      fail(error);
    }

    $("hud-toggle").addEventListener("click", toggleHUD);
    $("pause-toggle").addEventListener("click", togglePause);
    $("resume-flight").addEventListener("click", resumeFlight);

    $("state-select").addEventListener("change", event => {
      manualField(event.target.value);
    });

    $("field-select").addEventListener("change", event => {
      enterManual(false);
      setEncoding(event.target.value);
    });

    $("packet-reset").addEventListener("click", () => {
      manualField("packet", true);
    });

    $("nodes-toggle").addEventListener("click", () => {
      enterManual(false);
      state.nodes = !state.nodes;

      world.mainField.uniforms.uNodes.value = state.nodes ? 1 : 0;

      flightUI();
    });

    $("rays-toggle").addEventListener("click", () => {
      enterManual(false);

      state.rays = !state.rays;
      state.rayTarget = state.rays ? 1 : 0;

      flightUI();
    });

    $("orbit-select").addEventListener("change", event => {
      enterManual(false);
      setOrbit(event.target.value);

      if (
        state.key === "scar" ||
        (state.pending && state.pending.key === "scar")
      ) {
        manualField(
          event.target.value === "bouncing"
            ? "eigen-mid"
            : "scar"
        );
      } else {
        state.manualKeys = ["orbit"];
        labelElapsed = 1;
      }
    });

    document.querySelectorAll("[data-chapter]").forEach(button => {
      button.addEventListener("click", () => {
        const chapter = Number(button.dataset.chapter);

        enterManual(true);
        state.tour = starts[chapter] + 0.001;

        applyChapter(chapter);
        beginMotion(false);
      });
    });

    document.querySelectorAll(".panel-disclosure").forEach(element => {
      element.addEventListener("toggle", () => {
        if (element.open) enterManual(true);
        labelElapsed = 1;
      });

      element.addEventListener("focusin", () => {
        enterManual(true);
      });
    });

    $("sidebar-content").addEventListener(
      "wheel",
      () => enterManual(true),
      { passive: true }
    );

    canvas.addEventListener(
      "pointerdown",
      () => {
        if (ready) enterManual(false);
      },
      true
    );

    canvas.addEventListener(
      "wheel",
      () => {
        if (ready) enterManual(false);
      },
      { passive: true, capture: true }
    );

    canvas.addEventListener(
      "touchstart",
      () => {
        if (ready) enterManual(false);
      },
      { passive: true, capture: true }
    );

    canvas.addEventListener("contextmenu", event => {
      event.preventDefault();
    });

    window.addEventListener("keydown", event => {
      if (
        !ready ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const targetElement = event.target instanceof Element
        ? event.target
        : null;

      if (
        targetElement &&
        targetElement.closest(
          "input,select,textarea,[contenteditable='true']"
        )
      ) {
        return;
      }

      if (event.code === "Space") {
        if (
          targetElement &&
          targetElement.closest("button,summary,a")
        ) {
          return;
        }

        event.preventDefault();
        togglePause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resumeFlight();
      } else if (event.key.toLowerCase() === "h") {
        event.preventDefault();
        toggleHUD();
      }
    });

    window.addEventListener("resize", () => {
      if (lost) return;

      try {
        resize();
      } catch (error) {
        fatal(error);
      }
    });

    document.addEventListener("visibilitychange", () => {
      last = 0;
    });

    if (media.addEventListener) {
      media.addEventListener("change", event => {
        if (event.matches) {
          state.paused = true;

          if (motion) enterManual(true);

          flightUI();
        }
      });
    }

    canvas.addEventListener("webglcontextlost", event => {
      event.preventDefault();

      lost = true;
      ready = false;
      last = 0;
      controls.enabled = false;

      document.body.dataset.engineState = "lost";
      container.setAttribute("aria-busy", "true");

      document.querySelectorAll("[data-engine-control]").forEach(element => {
        element.disabled = true;
      });

      $("render-notice").hidden = false;

      textAt("notice-title", "Graphics context interrupted");

      textAt(
        "notice-message",
        "The simulation is held while the browser restores its graphics context."
      );

      textAt(
        "notice-detail",
        "If restoration does not complete, reload the visualization."
      );

      $("notice-reload").hidden = false;
    });

    canvas.addEventListener("webglcontextrestored", () => {
      try {
        composer.reset();
        resize();

        lost = false;
        dirty = true;
        last = 0;

        document.body.dataset.engineState = "loading";

        textAt("notice-title", "Restoring the instrument");
        textAt("notice-message", "Rebuilding graphics resources.");
      } catch (error) {
        fatal(error);
      }
    });

    function updateReadouts() {
      const quantumVisible = state.fieldTarget > 0;
      const mode = state.mode;

      const parity = mode
        ? (mode.sx ? "−" : "+") + " / " + (mode.sy ? "−" : "+")
        : "Mixed";

      textAt(
        "regime-value",
        quantumVisible ? "Quantum" : "Classical"
      );

      textAt(
        "state-value",
        !quantumVisible
          ? "Classical reference trajectories"
          : state.pending
            ? "Display transition"
            : state.key === "packet"
              ? "Projected wave packet"
              : state.key === "scar"
                ? "Ritz mode / scar candidate"
                : "Stationary Ritz mode"
      );

      textAt(
        "mode-value",
        quantumVisible && mode ? mode.index : "—"
      );

      textAt(
        "parity-value",
        quantumVisible ? parity : "—"
      );

      textAt(
        "energy-value",
        quantumVisible
          ? (mode ? mode.energy : model.energy).toFixed(5)
          : "—"
      );

      textAt(
        "quantum-time-value",
        quantumVisible && !mode
          ? state.quantum.toFixed(3)
          : "—"
      );

      const probability = mode
        ? 1
        : model.packet.reduce(
          (sum, c) => sum + c.re * c.re + c.im * c.im,
          0
        );

      textAt(
        "norm-value",
        quantumVisible ? probability.toFixed(6) : "—"
      );

      $("norm-value").title =
        "Probability in the normalized numerical mode basis.";

      textAt(
        "residual-value",
        mode ? mode.residual.toExponential(2) : "—"
      );

      const a = world.rays[0].ray;
      const b = world.rays[1].ray;

      const separation = Math.hypot(
        a.x - b.x,
        a.y - b.y
      );

      textAt(
        "separation-value",
        state.rays ? separation.toExponential(3) : "—"
      );

      textAt(
        "orbit-value",
        state.orbitTarget
          ? ORBITS[state.orbit].name
          : "No periodic overlay"
      );

      const eta = mode && state.orbitTarget
        ? model.enhancement(mode, state.orbit)
        : null;

      textAt(
        "enhancement-value",
        eta === null ? "—" : eta.toFixed(2) + " ×"
      );

      let re = 0;
      let im = 0;

      if (mode) {
        re = evaluateMode(mode, model.probeBasis);
      } else {
        for (let m = 0; m < model.modes.length; m++) {
          const phase = model.modes[m].energy * state.quantum;
          const c = Math.cos(phase);
          const s = Math.sin(phase);
          const p = model.packet[m];

          re += probeValues[m] * (p.re * c + p.im * s);
          im += probeValues[m] * (p.im * c - p.re * s);
        }
      }

      const amplitude = Math.hypot(re, im);

      textAt(
        "amplitude-value",
        quantumVisible ? amplitude.toFixed(4) : "—"
      );

      textAt(
        "phase-value",
        !quantumVisible
          ? "—"
          : amplitude < 1e-6
            ? "Undefined"
            : (Math.atan2(im, re) / Math.PI).toFixed(2) + "π"
      );

      const levels = model.sectors[0];

      const index = clamp(
        mode && !mode.sx && !mode.sy
          ? mode.index - 1
          : 2,
        0,
        10
      );

      const meanGap = (
        levels[11].energy - levels[0].energy
      ) / 11;

      const spacing = (
        levels[index + 1].energy - levels[index].energy
      ) / meanGap;

      textAt("spectrum-sector", "+ / +");
      textAt("spacing-value", spacing.toFixed(3));

      world.spectrumLines.forEach((line, i) => {
        const highlighted = i === index || i === index + 1;

        line.material.color.setHex(
          highlighted ? 0xf5d394 : 0xac9bff
        );

        line.material.opacity = highlighted ? 0.94 : 0.46;
      });

      annotations.slot(
        "classical",
        "δ / R = " +
        separation.toExponential(3) +
        " / equal classical time"
      );

      annotations.slot(
        "packet",
        "τ = " +
        state.quantum.toFixed(3) +
        " / 48 retained modes / norm = " +
        probability.toFixed(6)
      );

      if (mode) {
        annotations.slot(
          "eigenstate",
          "j = " +
          mode.index +
          " / parity " +
          parity +
          " / ε = " +
          mode.energy.toFixed(5)
        );

        annotations.slot(
          "scar",
          "j = " +
          mode.index +
          " / η ≈ " +
          (eta === null ? "—" : eta.toFixed(2)) +
          " / band width 0.32 R"
        );
      }

      annotations.slot(
        "comparison",
        "p = 3, q = 2 / Lx : Ly = golden ratio"
      );

      annotations.slot(
        "spectrum",
        "Parity + + / levels " +
        (index + 1) +
        " → " +
        (index + 2) +
        " / s = " +
        spacing.toFixed(3)
      );

      const percent = 100 * state.tour / total;

      $("flight-progress").style.transform =
        "scaleX(" + percent / 100 + ")";

      $("journey-progress").setAttribute(
        "aria-valuenow",
        String(Math.round(percent))
      );

      const format = time =>
        String(Math.floor(time / 60)).padStart(2, "0") +
        ":" +
        String(Math.floor(time % 60)).padStart(2, "0");

      textAt(
        "tour-time",
        format(state.tour) + " / " + format(total)
      );
    }

    resize();
    applyChapter(0);
    setEncoding("phase");

    tourPose(0, pose);

    camera.position.copy(pose.position);
    camera.quaternion.copy(pose.quaternion);
    focus.copy(pose.aim);
    camera.fov = pose.fov;
    camera.updateProjectionMatrix();

    if (media.matches) {
      textAt(
        "display-status",
        "Reduced motion: the instrument starts paused. Play or Resume drone starts animation."
      );
    }

    function frame(stamp) {
      if (dead) return;

      raf = requestAnimationFrame(frame);

      if (lost || document.hidden) {
        last = 0;
        return;
      }

      const dt = last
        ? Math.min(0.05, (stamp - last) / 1000)
        : 0;

      last = stamp;

      try {
        const running = !state.paused && !motion;

        if (running && state.auto) {
          state.tour = (state.tour + dt) % total;

          const info = timeInfo(state.tour);

          if (info.index !== state.chapter) {
            applyChapter(info.index);
          }

          const sub = Math.min(
            2,
            Math.floor(info.fraction * 3)
          );

          if (sub !== state.substage) {
            state.substage = sub;

            if (info.index === 6) {
              requestField(
                "eigen-high",
                false,
                [
                  model.sectors[2][4],
                  model.sectors[1][3],
                  model.sectors[0][4]
                ][sub]
              );
            }

            if (info.index === 10) {
              setOrbit(
                ["horizontal", "bowtie", "bouncing"][sub]
              );
            }
          }
        }

        if (state.fadingOut) {
          state.fieldAlpha = Math.max(
            0,
            state.fieldAlpha - dt / 0.85
          );

          if (state.fieldAlpha === 0) commitField();
        } else {
          state.fieldAlpha = Math.min(
            1,
            state.fieldAlpha + dt / 1.05
          );
        }

        if (
          running &&
          state.key === "packet" &&
          state.fieldTarget > 0
        ) {
          state.quantum += dt * 0.028;
        }

        const blend = 1 - Math.exp(-dt * 5);

        state.fieldLayer += (
          state.fieldTarget - state.fieldLayer
        ) * blend;

        state.rayLayer += (
          state.rayTarget - state.rayLayer
        ) * blend;

        state.orbitLayer += (
          state.orbitTarget - state.orbitLayer
        ) * blend;

        fieldElapsed += dt;

        if (
          dirty ||
          (
            !state.mode &&
            running &&
            state.fieldTarget > 0 &&
            fieldElapsed >= 1 / 30
          )
        ) {
          fillField(
            world.mainField,
            model,
            state.mode,
            state.quantum
          );

          dirty = false;
          fieldElapsed = 0;
        }

        world.mainField.uniforms.uOpacity.value =
          state.fieldLayer * state.fieldAlpha;

        world.mainField.group.visible =
          world.mainField.uniforms.uOpacity.value > 0.002;

        world.updateRays(
          running && state.rays ? dt : 0,
          state.rayLayer
        );

        for (const [key, line] of Object.entries(world.orbitLines)) {
          line.material.opacity = key === state.orbit
            ? state.orbitLayer * 0.84
            : 0;

          line.visible = line.material.opacity > 0.002;
        }

        if (running) {
          tracked.lerp(
            world.mainField.centroid,
            1 - Math.exp(-dt * 2)
          );
        }

        if (motion) {
          motion.elapsed += dt;

          const u = ease(clamp(
            motion.elapsed / motion.duration,
            0,
            1
          ));

          camera.position.lerpVectors(
            motion.startPosition,
            motion.endPosition,
            u
          );

          camera.quaternion.slerpQuaternions(
            motion.startQuaternion,
            motion.endQuaternion,
            u
          );

          focus.lerpVectors(
            motion.startFocus,
            motion.endFocus,
            u
          );

          camera.fov = motion.startFov +
            (motion.endFov - motion.startFov) * u;

          if (
            u === 1 &&
            !state.pending &&
            state.fieldAlpha >= 1
          ) {
            const resume = motion.resume;

            motion = null;
            state.auto = resume;

            if (!resume) syncControls();

            flightUI();
          }
        } else if (state.auto) {
          tourPose(state.tour, pose);

          camera.position.copy(pose.position);
          camera.quaternion.copy(pose.quaternion);
          camera.fov = pose.fov;
          focus.copy(pose.aim);
        } else {
          controls.update();

          const a = 1 - Math.exp(-dt * 16);

          camera.position.lerp(controlCamera.position, a);
          camera.quaternion.slerp(controlCamera.quaternion, a);
          camera.fov = controlCamera.fov;
          focus.lerp(controls.target, a);
        }

        const offsetTarget = state.hud && width > 760
          ? $("sidebar-ui").getBoundingClientRect().width * 0.48
          : 0;

        viewOffset += (
          offsetTarget - viewOffset
        ) * (1 - Math.exp(-dt * 4));

        camera.setViewOffset(
          width,
          height,
          -viewOffset,
          0,
          width,
          height
        );

        controlCamera.setViewOffset(
          width,
          height,
          -viewOffset,
          0,
          width,
          height
        );

        camera.updateMatrixWorld(true);

        const pixelScale = height * dpr / (
          2 * Math.tan(T.MathUtils.degToRad(camera.fov) / 2)
        );

        world.mainField.uniforms.uPixelScale.value = pixelScale;

        world.miniFields.forEach(field => {
          field.uniforms.uPixelScale.value = pixelScale * 0.7;
        });

        annotations.main.packet.object.position.copy(
          world.mainField.centroid
        );

        annotations.main.packet.object.position.z += 2;

        annotations.main.classical.object.position.copy(
          world.rays[0].head.position
        );

        annotations.main.classical.object.position.z += 0.6;

        labelElapsed += dt;
        hudElapsed += dt;

        if (labelElapsed >= 0.16) {
          const keys = state.manualKeys ||
            CHAPTERS[state.chapter][6];

          const visibleKeys =
            state.pending || state.fieldAlpha < 0.9
              ? keys.filter(key =>
                key === "classical" ||
                key === "boundary" ||
                key === "orbit"
              )
              : keys;

          annotations.layout(
            camera,
            visibleKeys,
            state.hud,
            width,
            height
          );

          labelElapsed = 0;
        }

        annotations.update(
          camera,
          dt,
          state.hud,
          width,
          height
        );

        if (hudElapsed >= 0.2) {
          updateReadouts();
          hudElapsed = 0;
        }

        composer.render();
        labelRenderer.render(scene, camera);

        if (!ready) {
          if (
            renderer.info.programs.some(program =>
              program.diagnostics &&
              program.diagnostics.runnable === false
            )
          ) {
            throw new Error(
              "A graphics shader could not compile on this device."
            );
          }

          ready = true;
          controls.enabled = !state.auto && !motion;

          document.body.dataset.engineState = "ready";
          container.setAttribute("aria-busy", "false");
          $("render-notice").hidden = true;

          if (state.chapter < 2) {
            textAt(
              "display-status",
              state.paused
                ? "Model ready. Playback is paused; Play or Resume drone starts animation."
                : "Numerical model ready. The tour begins with classical references."
            );
          }

          document.querySelectorAll(
            "[data-engine-control]"
          ).forEach(element => {
            element.disabled = false;
          });

          textAt(
            "accessibility-status",
            "Quantum Chaos ready. " +
            (
              state.paused
                ? "Playback is paused."
                : "The guided tour has started."
            )
          );
        }
      } catch (error) {
        fatal(error);
      }
    }

    raf = requestAnimationFrame(frame);
  }

  boot().catch(fail);
})();