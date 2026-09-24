(function () {
  "use strict";

  window.QuantumEngine = window.QuantumEngine || {};

  if (window.QuantumEngine.Telemetry) {
    return;
  }

  const DATA_INTERVAL = 0.1;
  const ANCHOR_INTERVAL = 1;
  const EDGE_PADDING = 12;
  const LABEL_GAP = 24;
  const TWO_PI = Math.PI * 2;

  let initialized = false;
  let scene = null;
  let camera = null;
  let uiLayer = null;
  let header = null;
  let mainPanel = null;
  let galleryPanel = null;
  let ribbon = null;
  let projected = null;
  let viewPosition = null;
  let focusPosition = null;
  let wavePosition = null;
  let dataCountdown = 0;
  let anchorCountdown = 0;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let overlayLeft = 0;
  let overlayTop = 0;
  let mainAnchors = [];
  let galleryAnchors = [];
  let readouts = {};

  const undo = [];

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function preserveAttribute(element, name) {
    const value = element.getAttribute(name);

    undo.push(function () {
      if (value === null) {
        element.removeAttribute(name);
      } else {
        element.setAttribute(name, value);
      }
    });
  }

  function rememberReadout(id) {
    const element = document.getElementById(id);

    if (element) {
      const text = element.textContent;

      preserveAttribute(element, "data-state");

      undo.push(function () {
        element.textContent = text;
      });
    }

    return element;
  }

  function setReadout(element, text, available) {
    if (!element) {
      return;
    }

    if (element.textContent !== text) {
      element.textContent = text;
    }

    const state = available === false ? "unavailable" : "live";

    if (element.dataset.state !== state) {
      element.dataset.state = state;
    }
  }

  function appendOwned(parent, element) {
    parent.appendChild(element);

    undo.push(function () {
      element.remove();
    });

    return element;
  }

  function addReadout(list, label) {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    const value = document.createElement("span");

    row.className = "telemetry-row";
    term.textContent = label;
    value.textContent = "Unavailable";
    value.dataset.state = "unavailable";

    description.appendChild(value);
    row.appendChild(term);
    row.appendChild(description);
    appendOwned(list, row);

    return value;
  }

  function createCard(panel, anchorContainerId) {
    const container = document.getElementById(anchorContainerId) || panel;
    const card = document.createElement("div");
    const equation = document.createElement("div");
    const note = document.createElement("p");

    card.className = "telemetry-math-card";
    card.style.paddingTop = "0.65rem";
    card.style.borderTop = "1px solid rgba(51, 255, 51, 0.25)";
    card.style.marginTop = "0.65rem";

    equation.className = "telemetry-equation";
    equation.style.overflowX = "auto";
    equation.style.overflowY = "hidden";

    note.className = "telemetry-model-note";
    note.style.marginTop = "0.5rem";
    note.style.fontSize = "0.72rem";
    note.style.lineHeight = "1.5";
    note.style.opacity = "0.8";

    card.appendChild(equation);
    card.appendChild(note);
    appendOwned(container, card);

    return {
      equation: equation,
      note: note,
      key: ""
    };
  }

  function renderMath(card, key, expression, fallback, note) {
    if (card.key === key) {
      return;
    }

    card.key = key;
    card.note.textContent = note;
    card.equation.textContent = fallback;

    if (window.katex && typeof window.katex.render === "function") {
      try {
window.katex.render(expression, card.equation, {
  displayMode: true,
  throwOnError: false,
  trust: false,
  output: "html"
});
      } catch (error) {
        card.equation.textContent = fallback;

        console.warn(
          "[QuantumEngine.Telemetry] Math rendering unavailable.",
          error
        );
      }
    }
  }

  function createPanel(element, anchorContainerId, width) {
    preserveAttribute(element, "style");
    preserveAttribute(element, "aria-hidden");
    preserveAttribute(element, "data-anchor");

    // These sections were grid items in the containment shell. Make their
    // containing block the full UI layer before assigning projected pixels.
    Object.assign(element.style, {
      position: "absolute",
      gridArea: "auto",
      inset: "auto",
      margin: "0",
      width: width + "px",
      maxWidth: "calc(100% - 24px)",
      maxHeight: "min(36vh, 360px)",
      boxSizing: "border-box",
      transform: "translate(-50%, -50%)",
      transition: "opacity 160ms ease",
      visibility: "hidden",
      opacity: "0",
      pointerEvents: "none",
      overflow: "auto",
      zIndex: "1"
    });

    element.setAttribute("aria-hidden", "true");

    let list = element.querySelector(".telemetry-readouts");

    if (!list) {
      list = document.createElement("dl");
      list.className = "telemetry-readouts";
      appendOwned(element, list);
    }

    return {
      element: element,
      list: list,
      card: createCard(element, anchorContainerId),
      anchor: null,
      visible: false,
      shouldShow: false,
      screen: {
        x: 0,
        y: 0,
        depth: 0
      },
      width: 0,
      height: 0,
      x: 0,
      y: 0
    };
  }

  function makeAnchor(name, label, kind) {
    return {
      name: name,
      label: label,
      kind: kind,
      object: null,
      world: new window.THREE.Vector3()
    };
  }

  function refreshObjects() {
    const collections = [mainAnchors, galleryAnchors];

    for (let group = 0; group < collections.length; group += 1) {
      const anchors = collections[group];

      for (let index = 0; index < anchors.length; index += 1) {
        anchors[index].object =
          scene.getObjectByName(anchors[index].name) || null;
      }
    }

    ribbon = scene.getObjectByName("quantum-wavefunction-ribbon") || null;
  }

  function objectIsVisible(object) {
    let current = object;

    while (current) {
      if (current.visible === false) {
        return false;
      }

      if (current === scene) {
        return true;
      }

      current = current.parent;
    }

    return false;
  }

  function selectAnchor(anchors, previous) {
    let best = null;
    let bestScore = Infinity;

    for (let index = 0; index < anchors.length; index += 1) {
      const anchor = anchors[index];

      if (!anchor.object || !objectIsVisible(anchor.object)) {
        continue;
      }

      anchor.object.getWorldPosition(anchor.world);

      let score = anchor.world.distanceToSquared(focusPosition);

      // Hysteresis keeps the labels from switching rapidly near a midpoint.
      if (anchor === previous) {
        score *= 0.85;
      }

      if (score < bestScore) {
        best = anchor;
        bestScore = score;
      }
    }

    return best;
  }

  function projectToScreen(worldPosition, result) {
    viewPosition.copy(worldPosition).applyMatrix4(camera.matrixWorldInverse);

    // The camera looks along its local negative Z axis. Test this as well
    // as clip depth, because perspective division alone can mirror points.
    if (!Number.isFinite(viewPosition.z) || viewPosition.z >= 0) {
      return false;
    }

    projected.copy(worldPosition).project(camera);

    if (
      !Number.isFinite(projected.x) ||
      !Number.isFinite(projected.y) ||
      !Number.isFinite(projected.z) ||
      projected.z < -1 ||
      projected.z > 1 ||
      Math.abs(projected.x) > 1 ||
      Math.abs(projected.y) > 1
    ) {
      return false;
    }

    // CSS pixels, not drawing-buffer pixels: do not multiply by DPR.
    result.x = (projected.x * 0.5 + 0.5) * viewportWidth;
    result.y = (-projected.y * 0.5 + 0.5) * viewportHeight;
    result.depth = projected.z;

    return true;
  }

  function setPanelVisible(panel, visible) {
    if (panel.visible === visible) {
      return;
    }

    panel.visible = visible;
    panel.element.style.visibility = visible ? "visible" : "hidden";
    panel.element.style.opacity = visible ? "1" : "0";
    panel.element.style.pointerEvents = visible ? "auto" : "none";
    panel.element.setAttribute("aria-hidden", visible ? "false" : "true");
  }

function preparePanel(panel, placeAbove, headerBottom) {
  panel.shouldShow = false;

  panel.width = panel.element.offsetWidth;
  panel.height = panel.element.offsetHeight;

  if (panel.width <= 0 || panel.height <= 0) {
    return;
  }

  const halfWidth = panel.width * 0.5;
  const halfHeight = panel.height * 0.5;

  const minimumX = EDGE_PADDING + halfWidth;
  const maximumX = viewportWidth - EDGE_PADDING - halfWidth;
  const minimumY =
    Math.max(EDGE_PADDING, headerBottom + 8) + halfHeight;
  const maximumY =
    viewportHeight - EDGE_PADDING - halfHeight;

  if (maximumX < minimumX || maximumY < minimumY) {
    return;
  }

  const anchorIsOnScreen =
    panel.anchor &&
    projectToScreen(panel.anchor.world, panel.screen);

  if (anchorIsOnScreen) {
    panel.x = clamp(
      panel.screen.x,
      minimumX,
      maximumX
    );

    const direction = placeAbove ? -1 : 1;

    panel.y = clamp(
      panel.screen.y + direction * (halfHeight + LABEL_GAP),
      minimumY,
      maximumY
    );

    panel.element.dataset.anchor = panel.anchor.name;
  } else {
    /*
     * Keep telemetry available while its tracked object is outside the
     * camera frustum. Main-track telemetry docks at the lower-left edge,
     * while gallery telemetry docks at the lower-right edge.
     */
    const isMainPanel = panel === mainPanel;

    panel.x = isMainPanel ? minimumX : maximumX;
    panel.y = maximumY;

    panel.element.dataset.anchor = panel.anchor
      ? panel.anchor.name + "-offscreen"
      : "unavailable";
  }

  panel.shouldShow = true;
}

  function separatePanels(headerBottom) {
    if (!mainPanel.shouldShow || !galleryPanel.shouldShow) {
      return;
    }

    const requiredX =
      (mainPanel.width + galleryPanel.width) * 0.5 + 12;
    const requiredY =
      (mainPanel.height + galleryPanel.height) * 0.5 + 12;

    if (
      Math.abs(mainPanel.x - galleryPanel.x) >= requiredX ||
      Math.abs(mainPanel.y - galleryPanel.y) >= requiredY
    ) {
      return;
    }

    const minimumY =
      Math.max(EDGE_PADDING, headerBottom + 8) +
      galleryPanel.height * 0.5;

    const maximumY =
      viewportHeight - EDGE_PADDING - galleryPanel.height * 0.5;

    const above = mainPanel.y - requiredY;
    const below = mainPanel.y + requiredY;

    if (above >= minimumY) {
      galleryPanel.y = above;
    } else if (below <= maximumY) {
      galleryPanel.y = below;
    } else {
      const minimumX = EDGE_PADDING + galleryPanel.width * 0.5;
      const maximumX =
        viewportWidth - EDGE_PADDING - galleryPanel.width * 0.5;

      const right = mainPanel.x + requiredX;
      const left = mainPanel.x - requiredX;

      if (right <= maximumX) {
        galleryPanel.x = right;
      } else if (left >= minimumX) {
        galleryPanel.x = left;
      } else {
        // On a small viewport, retain the card closest to the camera's focus.
        const mainDistance =
          mainPanel.anchor.world.distanceToSquared(focusPosition);

        const galleryDistance =
          galleryPanel.anchor.world.distanceToSquared(focusPosition);

        const secondary =
          mainDistance <= galleryDistance ? galleryPanel : mainPanel;

        secondary.shouldShow = false;
      }
    }
  }

  function positionPanel(panel) {
    setPanelVisible(panel, panel.shouldShow);

    if (panel.visible) {
      panel.element.style.left =
        (panel.x - overlayLeft).toFixed(2) + "px";

      panel.element.style.top =
        (panel.y - overlayTop).toFixed(2) + "px";
    }
  }

  function uniformValue(uniforms, name) {
    const uniform = uniforms && uniforms[name];

    return uniform && Number.isFinite(uniform.value)
      ? uniform.value
      : NaN;
  }

  function updateWaveReadouts() {
    const uniforms =
      ribbon && ribbon.material && ribbon.material.uniforms;

    const time = uniformValue(uniforms, "uTime");
    const length = uniformValue(uniforms, "uLength");
    const mode = uniformValue(uniforms, "uModeNumber");
    const weight = uniformValue(uniforms, "uHarmonicWeight");
    const frequency = uniformValue(uniforms, "uPhaseFrequency");

    if (
      !mainPanel.anchor ||
      !ribbon ||
      !Number.isFinite(time) ||
      !(length > 0) ||
      !Number.isFinite(mode) ||
      !Number.isFinite(weight) ||
      !Number.isFinite(frequency)
    ) {
      setReadout(readouts.time, "Unavailable", false);
      setReadout(readouts.sample, "Unavailable", false);
      setReadout(readouts.phase, "Unavailable", false);
      setReadout(readouts.density, "Unavailable", false);
      setReadout(readouts.thermal, "Unavailable", false);
      return;
    }

    wavePosition.copy(mainPanel.anchor.world);
    ribbon.worldToLocal(wavePosition);

    const x = wavePosition.x;
    const phase =
      ((frequency * time) % TWO_PI + TWO_PI) % TWO_PI;

    setReadout(readouts.time, time.toFixed(2) + " (scaled cycle)");
    setReadout(readouts.sample, x.toFixed(2) + " (wire units)");
    setReadout(readouts.phase, phase.toFixed(3) + " rad");

    if (x < -length * 0.5 || x > length * 0.5) {
      setReadout(readouts.density, "Outside wave domain", false);
      setReadout(readouts.thermal, "Unavailable", false);
      return;
    }

    // Exactly the two-mode expression used by the ribbon vertex shader.
    // Normalization cancels when dividing |psi|^2 by its amplitude bound.
    const spatialPhase =
      mode * Math.PI * (x + length * 0.5) / length;

    const fundamental = Math.sin(spatialPhase);
    const harmonic = weight * Math.sin(2 * spatialPhase);

    const real =
      fundamental * Math.cos(phase) +
      harmonic * Math.cos(4 * phase);

    const imaginary =
      -fundamental * Math.sin(phase) -
      harmonic * Math.sin(4 * phase);

    const bound = 1 + Math.abs(weight);

    const density = clamp(
      (real * real + imaginary * imaginary) / (bound * bound),
      0,
      1
    );

    const thermal = clamp(
      Math.pow(density, 0.65) * 1.32,
      0,
      1
    );

    let band = "Cobalt";

    if (thermal >= 0.95) {
      band = "White-hot";
    } else if (thermal >= 0.72) {
      band = "Crimson";
    } else if (thermal >= 0.38) {
      band = "Magenta";
    }

    setReadout(readouts.density, density.toFixed(4));

    setReadout(
      readouts.thermal,
      band + " / " + (thermal * 100).toFixed(1) + "%"
    );
  }

  function updateGalleryCard() {
    const anchor = galleryPanel.anchor;

    if (!anchor) {
      setReadout(readouts.exhibit, "No exhibit available", false);
      setReadout(readouts.exhibitState, "Unavailable", false);
      return;
    }

    setReadout(readouts.exhibit, anchor.label);

    if (anchor.kind === "electron") {
      setReadout(
        readouts.exhibitState,
        "Jittering probability illustration"
      );

      renderMath(
        galleryPanel.card,
        "electron",
        "P(\\Omega)=\\int_{\\Omega}|\\psi(\\mathbf{r})|^2\\,d^3\\mathbf{r}",
        "P(region) = integral of |psi(r)|^2 over the region",
        "The cloud illustrates probability density. Its Gaussian point distribution and jitter are visual effects."
      );
    } else if (anchor.kind === "photon") {
      setReadout(
        readouts.exhibitState,
        "Orthogonal, in-phase fields"
      );

      renderMath(
        galleryPanel.card,
        "photon",
        "\\mathbf{E}\\perp\\mathbf{B},\\qquad E,B\\propto\\sin(kx-\\omega t)",
        "E perpendicular to B; both oscillate as sin(kx - omega t)",
        "A classical transverse electromagnetic field illustration. Tube amplitudes use display units."
      );
    } else {
      setReadout(
        readouts.exhibitState,
        "Pulsing confinement analogy"
      );

      renderMath(
        galleryPanel.card,
        "gluon",
        "V(r)\\sim\\sigma r",
        "V(r) approximately proportional to string tension times separation",
        "A schematic confinement analogy with decorative coils, not a numerical QCD calculation."
      );
    }
  }

  function updateData() {
    const anchor = mainPanel.anchor;

    setReadout(
      readouts.region,
      anchor ? anchor.label + " (schematic)" : "No terrain available",
      Boolean(anchor)
    );

    setReadout(readouts.tunneling, "Not simulated");

    updateWaveReadouts();
    updateGalleryCard();

    const tour =
      camera.userData && camera.userData.cinematography;

    if (tour && Number.isFinite(tour.progress)) {
      const percent =
        (clamp(tour.progress, 0, 1) * 100).toFixed(1);

      setReadout(
        readouts.tour,
        percent + "% / " +
          (tour.complete ? "Final hold" : (tour.shot || "Tour"))
      );
    } else {
      setReadout(
        readouts.tour,
        "Manual / unavailable",
        false
      );
    }
  }

  function update(deltaTime) {
    const delta =
      Number.isFinite(deltaTime) && deltaTime > 0 ? deltaTime : 0;

    anchorCountdown -= delta;
    dataCountdown -= delta;

    if (anchorCountdown <= 0) {
      refreshObjects();
      anchorCountdown = ANCHOR_INTERVAL;
    }

    // Cinematography executes earlier in Core's callback list. Refresh the
    // matrices now, before Core renders, to avoid a one-frame projection lag.
    camera.updateWorldMatrix(true, false);

    const tour =
      camera.userData && camera.userData.cinematography;

    if (
      tour &&
      tour.target &&
      Number.isFinite(tour.target.x) &&
      Number.isFinite(tour.target.y) &&
      Number.isFinite(tour.target.z)
    ) {
      focusPosition.copy(tour.target);
    } else {
      camera.getWorldPosition(focusPosition);
    }

    const previousMain = mainPanel.anchor;
    const previousGallery = galleryPanel.anchor;

    mainPanel.anchor = selectAnchor(mainAnchors, previousMain);
    galleryPanel.anchor = selectAnchor(galleryAnchors, previousGallery);

    if (
      dataCountdown <= 0 ||
      previousMain !== mainPanel.anchor ||
      previousGallery !== galleryPanel.anchor
    ) {
      updateData();
      dataCountdown = DATA_INTERVAL;
    }

    viewportWidth = Math.max(1, window.innerWidth);
    viewportHeight = Math.max(1, window.innerHeight);

    const overlayBounds = uiLayer.getBoundingClientRect();

    overlayLeft = overlayBounds.left + uiLayer.clientLeft;
    overlayTop = overlayBounds.top + uiLayer.clientTop;

    const headerBottom =
      header && !header.hidden
        ? Math.max(0, header.getBoundingClientRect().bottom)
        : 0;

    preparePanel(mainPanel, false, headerBottom);
    preparePanel(galleryPanel, true, headerBottom);

    separatePanels(headerBottom);

    positionPanel(mainPanel);
    positionPanel(galleryPanel);
  }

  function init() {
    if (initialized) {
      return window.QuantumEngine.Telemetry;
    }

    const core = window.QuantumEngine.Core;
    const THREE = window.THREE;

    if (
      !THREE ||
      !core ||
      typeof core.registerUpdateCallback !== "function"
    ) {
      throw new Error(
        "QuantumEngine.Telemetry requires Three.js and QuantumEngine.Core."
      );
    }

    scene = core.getScene();
    camera = core.getCamera();
    uiLayer = document.getElementById("ui-layer");

    const mainElement =
      document.getElementById("telemetry-main");

    const galleryElement =
      document.getElementById("telemetry-gallery");

    if (
      !scene ||
      !camera ||
      !uiLayer ||
      !mainElement ||
      !galleryElement
    ) {
      throw new Error(
        "QuantumEngine.Telemetry requires an initialized scene, camera, and both telemetry panels."
      );
    }

    let unregister = null;

    try {
      header = document.getElementById("system-header");

      projected = new THREE.Vector3();
      viewPosition = new THREE.Vector3();
      focusPosition = new THREE.Vector3();
      wavePosition = new THREE.Vector3();

      mainAnchors = [
        makeAnchor(
          "finite-square-well",
          "Finite square well",
          "well"
        ),
        makeAnchor(
          "potential-barrier",
          "Potential barrier",
          "barrier"
        ),
        makeAnchor(
          "measurement-gate",
          "Measurement gate",
          "gate"
        )
      ];

      galleryAnchors = [
        makeAnchor(
          "electron-probability-cloud",
          "Electron probability cloud",
          "electron"
        ),
        makeAnchor(
          "photon-transverse-wave",
          "Photon transverse wave",
          "photon"
        ),
        makeAnchor(
          "gluon-flux-tube",
          "Gluon flux tube",
          "gluon"
        )
      ];

      mainPanel = createPanel(
        mainElement,
        "telemetry-main-anchors",
        340
      );

      galleryPanel = createPanel(
        galleryElement,
        "telemetry-gallery-anchors",
        320
      );

      readouts = {
        time: rememberReadout("main-simulation-time"),
        region: rememberReadout("main-potential-region"),
        tunneling: rememberReadout("main-tunneling-status"),
        exhibit: rememberReadout("gallery-active-exhibit"),
        exhibitState: rememberReadout("gallery-exhibit-state"),
        sample: addReadout(mainPanel.list, "Sample x"),
        phase: addReadout(mainPanel.list, "Carrier phase"),
        density: addReadout(mainPanel.list, "Relative density"),
        thermal: addReadout(mainPanel.list, "Thermal map"),
        tour: addReadout(mainPanel.list, "Camera tour")
      };

      renderMath(
        mainPanel.card,
        "wave",
        "\\rho_{\\mathrm{rel}}=\\frac{|\\psi(x,t)|^2}{A_{\\max}^2}",
        "Relative density = |psi(x,t)|^2 / maximum amplitude bound squared",
        "Thermal color encodes relative probability density, not temperature. Terrain is schematic; tunneling and measurement collapse are not simulated."
      );

      anchorCountdown = 0;
      dataCountdown = 0;

      update(0);

      unregister = core.registerUpdateCallback(update);
      initialized = true;

      return window.QuantumEngine.Telemetry;
    } catch (error) {
      if (typeof unregister === "function") {
        unregister();
      }

      while (undo.length > 0) {
        undo.pop()();
      }

      mainPanel = null;
      galleryPanel = null;
      ribbon = null;
      mainAnchors = [];
      galleryAnchors = [];
      readouts = {};
      initialized = false;

      throw error;
    }
  }

  window.QuantumEngine.Telemetry = {
    init: init
  };

  function start() {
    try {
      init();
    } catch (error) {
      console.error(
        "[QuantumEngine.Telemetry] Initialization failed.",
        error
      );
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener(
      "DOMContentLoaded",
      start,
      { once: true }
    );
  } else {
    start();
  }
}());