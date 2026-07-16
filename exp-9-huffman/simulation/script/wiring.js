let wiringInitialized = false;

function setupJsPlumb() {
  if (wiringInitialized) return true;
  if (!window.jsPlumb || typeof window.jsPlumb.ready !== "function") {
    return false;
  }
  wiringInitialized = true;
  jsPlumb.ready(function () {
  const ringSvg =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(`
      <svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">
        <circle cx="13" cy="13" r="12" fill="black"/>
        <circle cx="13" cy="13" r="9" fill="#C38055"/>
        <circle cx="13" cy="13" r="6" fill="black"/>
      </svg>
    `);
  // keep defaults aligned with the legacy curvy wires
  jsPlumb.importDefaults({
    Connector: ["Bezier", { curviness: WIRE_CURVINESS }]
  });
  // Base endpoint options (no connectorStyle here; we'll set per-endpoint dynamically)
  const baseEndpointOptions = {
    endpoint: ["Image", { url: ringSvg, width: 26, height: 26 }],
    isSource: true,
    isTarget: true,
    maxConnections: -1,
    connector: ["Bezier", { curviness: WIRE_CURVINESS }]
  };
  const container = document.querySelector(".top-row");
  if (container) {
    jsPlumb.setContainer(container);
  } else {
    console.warn('jsPlumb: container ".top-row" not found.');
  }
  const BOTTOM_ANCHOR = [0.5, 1, 0, 1];
  // anchors for each point (you can tweak these)
   const anchors = {
    pointR: BOTTOM_ANCHOR,
    pointB: BOTTOM_ANCHOR,

    pointL: BOTTOM_ANCHOR,
    pointA: BOTTOM_ANCHOR,
    pointF: BOTTOM_ANCHOR,
    pointC: BOTTOM_ANCHOR,
    pointD: BOTTOM_ANCHOR,
    pointE: BOTTOM_ANCHOR,
    pointG: BOTTOM_ANCHOR,
    pointH: [0, 0.5, -1, 0],
    pointI: [1, 0.5, 1, 0],
    pointJ: [0, 0.5, -1, 0],
    pointK: [1, 0.5, 1, 0],
    pointA1: [0, 0.5, -1, 0],
    pointZ1: [1, 0.5, 1, 0],
    pointA3: [0, 0.5, -1, 0],
    pointZ3: [1, 0.5, 1, 0],
    pointA2: [0, 0.5, -1, 0],
    pointZ2: [1, 0.5, 1, 0],
    pointA4: [BOTTOM_ANCHOR, [0, 0.5, -1, 0]], // prefer downward entry for the L2 → A4 U-turn
    pointZ4: [1, 0.5, 1, 0],
    pointL1: [0, 0.5, -1, 0],
    pointL2: BOTTOM_ANCHOR, // force L2 to drop straight down before curving toward A4
  };

  const WIRE_COLORS = {
    blue: "rgba(0, 0, 255)",
    red: "rgb(255, 0, 0)",
    green: "rgb(0, 255, 0)"
  };
  const redWirePoints = new Set(["pointR", "pointB"]);
  const greenWirePoints = new Set(["pointL1", "pointL2"]);

  function getWireColorForId(id) {
    if (redWirePoints.has(id)) return WIRE_COLORS.red;
    if (greenWirePoints.has(id)) return WIRE_COLORS.green;
    return WIRE_COLORS.blue;
  }

  function getWireColorForConnection(a, b) {
    if (redWirePoints.has(a) || redWirePoints.has(b)) return WIRE_COLORS.red;
    if (greenWirePoints.has(a) || greenWirePoints.has(b)) return WIRE_COLORS.green;
    return WIRE_COLORS.blue;
  }
  const endpointsById = new Map();
  const loopbackTargets = new Map();

  function mirrorAnchor(anchor) {
    if (!anchor || !Array.isArray(anchor)) return null;
    const mirrored = anchor.slice();
    if (mirrored.length > 2) mirrored[2] = -mirrored[2];
    if (mirrored.length > 3) mirrored[3] = -mirrored[3];
    return mirrored;
  }

  function getLoopbackEndpoint(id) {
    if (loopbackTargets.has(id)) return loopbackTargets.get(id);

    const el = document.getElementById(id);
    if (!el) {
      console.warn("jsPlumb: element not found for loopback:", id);
      return null;
    }

    const baseAnchor = anchors[id];
    const loopAnchor = mirrorAnchor(baseAnchor) || baseAnchor || [0.5, 0.5, 0, 0];

    const ep = jsPlumb.addEndpoint(el, {
      anchor: loopAnchor,
      uuid: `${id}-loopback`,
      endpoint: "Blank",
      isSource: false,
      isTarget: true,
      maxConnections: -1
    });

    loopbackTargets.set(id, ep);
    return ep;
  }
  // helper to safely add endpoint if element exists
  function addEndpointIfExists(id, anchor) {
    const el = document.getElementById(id);
    if (!el) {
      console.warn("jsPlumb: element not found:", id);
      return;
    }
    // raise z-index so endpoint image stays visible above other elements
    el.style.zIndex = 2000;
    const wireColor = getWireColorForId(id);
    // Create per-endpoint options with connectorStyle for drag preview
    const endpointOptions = { ...baseEndpointOptions };
    endpointOptions.connectorStyle = {
      stroke: wireColor,
      strokeWidth: 4
    };
    // Use a stable uuid so Auto Connect can reuse the same styled endpoint
    const ep = jsPlumb.addEndpoint(el, { anchor, uuid: id }, endpointOptions);
    endpointsById.set(id, ep);
    return ep;
  }
  // add endpoints for the points
  Object.keys(anchors).forEach(id => addEndpointIfExists(id, anchors[id]));

  function getOrCreateEndpoint(id) {
    let ep = endpointsById.get(id);
    if (!ep && typeof jsPlumb.getEndpoint === "function") {
      ep = jsPlumb.getEndpoint(id);
      if (ep) endpointsById.set(id, ep);
    }
    if (!ep && anchors[id]) {
      ep = addEndpointIfExists(id, anchors[id]);
    }
    return ep || null;
  }

  function connectionKey(a, b) {
    return [a, b].sort().join("-");
  }

  const WIRE_CURVE_OVERRIDES = new Map([
    [connectionKey("pointR", "pointC"), 110],
    [connectionKey("pointR", "pointE"), 150],
    [connectionKey("pointB", "pointG"), 130],
    [connectionKey("pointL", "pointD"), 90],
    [connectionKey("pointL1", "pointJ"), -150],
    [connectionKey("pointL2", "pointA4"), -120],
    [connectionKey("pointZ4", "pointK"), 60],
     

  ]);
  // const WIRE_CURVE_OVERRIDES = new Map([
  //   [connectionKey("pointR", "pointC"), 200],
  //   [connectionKey("pointR", "pointE"), 170],
  //   [connectionKey("pointB", "pointG"), 140],
  //   [connectionKey("pointL", "pointD"), 110]
  // ]);

  function getWireCurvinessForConnection(a, b) {
    const key = connectionKey(a, b);
    if (WIRE_CURVE_OVERRIDES.has(key)) {
      return WIRE_CURVE_OVERRIDES.get(key);
    }
    return WIRE_CURVINESS;
  }

  function getSeenConnectionKeys() {
    const seen = new Set();
    jsPlumb.getAllConnections().forEach(conn => {
      seen.add(connectionKey(conn.sourceId, conn.targetId));
    });
    return seen;
  }

  function connectRequiredPair(req, seenKeys, index = -1) {
    const [a, b] = req.split("-");
    if (!a || !b) return false;
    const isSelfConnection = a === b;

    const normalizedKey = connectionKey(a, b);
    if (seenKeys && seenKeys.has(normalizedKey)) return true;

    const aEl = document.getElementById(a);
    const bEl = document.getElementById(b);
    if (!aEl || !bEl) {
      console.warn("Auto Connect: missing element(s) for", req);
      return false;
    }

    const aAnchor = anchors[a];
    const bAnchor = anchors[b];
    const aIsLeft = aAnchor ? aAnchor[0] === 0 : false;
    const bIsLeft = bAnchor ? bAnchor[0] === 0 : false;

    let sourceId, targetId;
    if (isSelfConnection) {
      sourceId = a;
      targetId = a;
    } else if (aIsLeft !== bIsLeft) {
      // Mixed sides: alternate preference for balance (even index: prefer right source -> red; odd: left -> blue)
      const preferRight = (index % 2 === 0) || (index < 0);
      if (preferRight) {
        sourceId = aIsLeft ? b : a; // Choose right as source
      } else {
        sourceId = bIsLeft ? b : a; // Choose left as source
      }
      targetId = sourceId === a ? b : a;
    } else {
      // Same side: default to a as source
      sourceId = a;
      targetId = b;
    }

    const wireColor = getWireColorForConnection(sourceId, targetId);
    const curviness = getWireCurvinessForConnection(sourceId, targetId);

    const sourceEndpoint = getOrCreateEndpoint(sourceId);
    const targetEndpoint = isSelfConnection ? getLoopbackEndpoint(targetId) : getOrCreateEndpoint(targetId);
    if (!sourceEndpoint || !targetEndpoint) {
      console.warn("Auto Connect: missing endpoint(s) for", req);
      return false;
    }

    // Connect using existing endpoints to keep point design unchanged.
    const connectionParams = {
      sourceEndpoint,
      targetEndpoint,
      connector: ["Bezier", { curviness }],
      paintStyle: { stroke: wireColor, strokeWidth: 4 }
    };

    if (isSelfConnection) {
      const sourceAnchor = anchors[sourceId];
      const targetAnchor = mirrorAnchor(sourceAnchor) || sourceAnchor;
      if (sourceAnchor || targetAnchor) {
        connectionParams.anchors = [sourceAnchor || targetAnchor, targetAnchor];
      }
    }

    const conn = jsPlumb.connect(connectionParams);

    if (conn && seenKeys) {
      seenKeys.add(connectionKey(conn.sourceId, conn.targetId));
    }

    return !!conn;
  }

  // Dynamic wire color based on source anchor side (left: blue, right: red) - Now sets on connection for consistency
  jsPlumb.bind("connection", function(info) {
    const sourceId = info.sourceId;
    const wireColor = getWireColorForConnection(info.sourceId, info.targetId);
    const curviness = getWireCurvinessForConnection(info.sourceId, info.targetId);
    info.connection.setConnector(["Bezier", { curviness }]);
    info.connection.setPaintStyle({ stroke: wireColor, strokeWidth: 4 });
    console.log(`Wire from ${sourceId} set to ${wireColor}`); // Debug log (remove if not needed)
  });

  function normalizeRequiredPairs(pairs) {
    if (!Array.isArray(pairs)) return [];
    const seen = new Set();
    return pairs.filter((pair) => {
      if (!pair || seen.has(pair)) return false;
      seen.add(pair);
      const [a, b] = String(pair).split("-");
      if (!a || !b) return false;
      if (typeof document !== "undefined") {
        if (!document.getElementById(a) || !document.getElementById(b)) {
          console.warn("Required connection missing endpoint(s):", pair);
          return false;
        }
      }
      return true;
    });
  }

  // Required connections: unsorted list for iteration order in auto-connect, sorted Set for checking
  const rawRequiredPairs = [
    "pointR-pointC",
    "pointR-pointE",
    "pointB-pointG",
    "pointB-pointA2",
    "pointA2-pointZ2",
    "pointL-pointD",
    "pointA-pointA1",
    "pointF-pointZ1",
    "pointL2-pointA4",
    "pointA4-pointZ4",
    "pointZ4-pointK",
    "pointI-pointJ",
    "pointJ-pointL1",
    "pointH-pointA3",
    "pointH-pointZ3"
  ];
  const requiredPairs = normalizeRequiredPairs(rawRequiredPairs);
  const requiredConnections = new Set(requiredPairs.map(pair => {
    const [a, b] = pair.split("-");
    return [a, b].sort().join("-");
  }));
  const allowedConnections = new Set(requiredConnections);
  // Explicitly allow A ↔ A1 even if normalization skips it
  allowedConnections.add(connectionKey("pointA", "pointA1"));
  const requiredConnectionNumbers = new Map();
  requiredPairs.forEach((pair, index) => {
    const [a, b] = String(pair).split("-");
    if (!a || !b) return;
    requiredConnectionNumbers.set(connectionKey(a, b), index + 1);
  });

  // Replace "#" with your real recorded-voice folder path (example: "../audio/exp2").
  const RECORDED_VOICE_BASE_SRC = "#";

  function buildRecordedVoiceSrc(audioRef) {
    const ref = normalizeStaticAudioPath(String(audioRef || "").trim());
    if (!ref || ref === "#") return "#";

    // Allow direct path/URL per item without base path.
    if (/^(https?:)?\/\//i.test(ref) || ref.startsWith("/") || ref.startsWith("./") || ref.startsWith("../")) {
      return ref;
    }

    if (!RECORDED_VOICE_BASE_SRC || RECORDED_VOICE_BASE_SRC === "#") return "#";
    const base = RECORDED_VOICE_BASE_SRC.replace(/\/+$/, "");
    return `${base}/${ref}`;
  }

  const voicePack = {};
  Object.keys(LAB_VOICE_TEXTS).forEach((key) => {
    voicePack[key] = buildRecordedVoiceSrc(getVoiceAudioRef(key));
  });

  requiredPairs.forEach((pair) => {
    const [from, to] = String(pair).split("-");
    if (!from || !to) return;
    const stepKey = `step_${connectionKey(from, to)}`;
    if (voicePack[stepKey]) return;
    voicePack[stepKey] = buildRecordedVoiceSrc(`${stepKey}.mp3`);
  });

  if (window.labSpeech && typeof window.labSpeech.useRecordedVoice === "function") {
    window.labSpeech.useRecordedVoice(voicePack);
  }

  function formatPointLabel(id) {
    return String(id || "").replace(/^point/i, "").toUpperCase();
  }

  function formatPointSpeech(id) {
    const cleaned = String(id || "")
      .replace(/^point/i, "")
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase();
    if (!cleaned) return "";
    const parts = cleaned.match(/[A-Z]+|[0-9]+/g) || [cleaned];
    return parts.join(" ");
  }

  function getConnectionNumber(key) {
    const [a, b] = String(key || "").split("-");
    if (!a || !b) return null;
    return requiredConnectionNumbers.get(connectionKey(a, b)) || null;
  }

  function formatConnectionDisplay(key) {
    const [a, b] = String(key || "").split("-");
    const from = formatPointLabel(a);
    const to = formatPointLabel(b);
    if (!from || !to) return "";
    const number = getConnectionNumber(key);
    if (number) {
      return `Connection ${number}: ${from} - ${to}`;
    }
    return `${from} - ${to}`;
  }

  function formatConnectionPair(key) {
    const [a, b] = String(key || "").split("-");
    const from = formatPointLabel(a);
    const to = formatPointLabel(b);
    if (!from || !to) return "";
    return `${from} - ${to}`;
  }

  function formatConnectionSpeech(key) {
    const [a, b] = String(key || "").split("-");
    const from = formatPointSpeech(a);
    const to = formatPointSpeech(b);
    if (!from || !to) return "";
    const number = getConnectionNumber(key);
    if (number) {
      return `connection ${number}, point ${from} to point ${to}`;
    }
    return `point ${from} to point ${to}`;
  }

  const mcbImg = document.querySelector(".mcb-toggle");
  const starterHandle = document.querySelector(".starter-handle");

  let isDragging = false;
  let startX, startLeft, startTop;

  function startDrag(e) {
    if (e.button !== 0 || !connectionsVerified || !mcbOn) return;
    isDragging = true;
    startX = e.clientX;
    startLeft = parseFloat(starterHandle.style.left) || 16.67;
    startTop = parseFloat(starterHandle.style.top) || 37.04;
    document.addEventListener('mousemove', drag);
    document.addEventListener('mouseup', endDrag);
    starterHandle.style.cursor = 'grabbing';
    e.preventDefault();
  }

  function drag(e) {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    const parentRect = starterHandle.parentElement.getBoundingClientRect();
    const deltaPercent = (deltaX / parentRect.width) * 100;
    const progress = (startLeft + deltaPercent - 16.67) / (68 - 16.67);
    const t = Math.max(0, Math.min(1, progress));  // Clamp t 0-1

    // Linear left
    const newLeft = 16.67 + t * (68 - 16.67);

    // Curved top: sinusoidal dip (negative for "up" arc; adjust 15 for height)
    const curveHeight = 15;  // % rise in middle
    const newTop = 37.04 - curveHeight * Math.sin(t * Math.PI);

    starterHandle.style.left = newLeft + '%';
    starterHandle.style.top = newTop + '%';
  }

  function endDrag(e) {
    if (!isDragging) return;
    isDragging = false;
    document.removeEventListener('mousemove', drag);
    document.removeEventListener('mouseup', endDrag);

    // Get current t from left (approx)
    const currentLeft = parseFloat(starterHandle.style.left) || 16.67;
    const currentT = (currentLeft - 16.67) / (68 - 16.67);
    const threshold = 0.5;
    let targetT = currentT > threshold ? 1 : 0;

    // Snap to target
    const targetLeft = 16.67 + targetT * (68 - 16.67);
    const targetTop = 37.04 - 15 * Math.sin(targetT * Math.PI);
    starterHandle.style.left = targetLeft + '%';
    starterHandle.style.top = targetTop + '%';

    const wasMoved = starterMoved;
    starterMoved = targetT === 1;
    if (starterMoved) {
      stepGuide.complete("starter");
      if (!wasMoved) {
        window.dispatchEvent(new CustomEvent(STARTER_MOVED_EVENT));
        const guideIsActive =
          typeof window.isGuideActive === "function" && window.isGuideActive();
        if (!guideIsActive && window.labSpeech && typeof window.labSpeech.speak === "function") {
          window.labSpeech.speak(buildVoicePayload("guide_starter_on"), { interrupt: true });
        }
      }
    }
    starterHandle.style.cursor = (connectionsVerified && mcbOn && !starterMoved) ? 'grab' : 'default';
    updateControlLocks();
    updateRotorSpin();
    e.preventDefault();
  }

  function updateStarterUI() {
    if (!starterHandle) return;
    if (connectionsVerified && mcbOn && !starterMoved) {
      starterHandle.style.cursor = 'grab';
      starterHandle.onmousedown = startDrag;
      // Reset to start pos if needed
      starterHandle.style.left = '16.67%';
      starterHandle.style.top = '37.04%';
    } else {
      starterHandle.style.cursor = 'default';
      starterHandle.onmousedown = null;
      if (!starterMoved) {
        starterHandle.style.left = '16.67%';
        starterHandle.style.top = '37.04%';
      }
    }
    if (starterMoved) {
      starterHandle.classList.add('moved');
    } else {
      starterHandle.classList.remove('moved');
    }
  }

  function updateControlLocks() {
    const ready = connectionsVerified && mcbOn && starterMoved;
    const lampSelect = document.getElementById("number");
    const addBtn =
      findButtonByLabel("Add Table") ||
      findButtonByLabel("Add To Table") ||
      findButtonByLabel("Add");
    const autoBtn = findButtonByLabel("Auto Connect");
    const disableAutoOnCheckedSpeech = connectionsVerified && guideSpeechActive();
    const disableAutoAfterCheck = autoBtn?.dataset?.checkedLocked === "1";
    if (lampSelect) lampSelect.disabled = !ready;
    if (addBtn) addBtn.disabled = !ready;
    if (autoBtn) {
      if (disableAutoOnCheckedSpeech) {
        autoBtn.dataset.guideLocked = "1";
      } else {
        delete autoBtn.dataset.guideLocked;
      }
      autoBtn.disabled = isAutoConnecting || disableAutoOnCheckedSpeech || disableAutoAfterCheck;
    }
    updateStarterUI();
    updateRotorSpin();
  }

  function setMcbState(isOn, options = {}) {
    if (!mcbImg) return;
    const { silent = false } = options;
    const wasOn = mcbOn;
    mcbOn = !!isOn;
    mcbImg.src = isOn ? "../images/mcb-on.png" : "../images/mcb-off.png";
    mcbImg.classList.toggle("is-on", mcbOn);
    if (!wasOn && mcbOn) {
      window.dispatchEvent(new CustomEvent(MCB_TURNED_ON_EVENT));
      if (!silent) {
        showPopup(
          getSpeechText(buildVoicePayload("mcb_turned_on")),
          "MCB ON"
        );
      }
    }
    if (wasOn && !mcbOn) {
      starterMoved = false;
      if (starterHandle) {
        starterHandle.style.left = '16.67%';
        starterHandle.style.top = '37.04%';
        starterHandle.classList.remove('moved');
      }
      updateControlLocks();
      window.dispatchEvent(new CustomEvent(MCB_TURNED_OFF_EVENT));
      if (!silent) {
        showPopup(getSpeechText(buildVoicePayload("mcb_turned_off_between")));
      }
      return;
    }
    updateControlLocks();
    updateRotorSpin();
  }

  sharedControls.updateControlLocks = updateControlLocks;
  sharedControls.setMcbState = setMcbState;
  sharedControls.starterHandle = starterHandle;

  if (mcbImg) {
    const handleMcbClick = function () {
      if (!connectionsVerified) {
        showPopup(getSpeechText(buildVoicePayload("before_connection_mcb_alert")));
        return;
      }
      const nextState = !mcbOn;
      setMcbState(nextState);
      if (nextState) {
        stepGuide.complete("mcb");
      }
    };

    mcbImg.style.cursor = "pointer";
    mcbImg.addEventListener("click", handleMcbClick);
  }

  // Click on label buttons (e.g., .point-R) to remove connections from corresponding point
  document.querySelectorAll('[class^="point-"]').forEach(btn => {
    btn.style.cursor = "pointer"; // Ensure pointer cursor
    btn.addEventListener("click", function () {
      if (mcbOn) {
        speakOrAlertLocal(buildVoicePayload("turn_off_mcb_before_removing_conn"));
        return;
      }
      const className = this.className;
      const match = className.match(/point-([A-Za-z0-9]+)/);
      if (match) {
        const pointId = "point" + match[1];
        const pointEl = document.getElementById(pointId);
        if (pointEl) {
          // Remove all connections where this point is source or target
          jsPlumb.getConnections({ source: pointId }).concat(jsPlumb.getConnections({ target: pointId }))
            .forEach(c => jsPlumb.deleteConnection(c));
          jsPlumb.repaintEverything();
        }
      }
    });
  });

  // Existing: make clickable elements (endpoint divs) removable
  document.querySelectorAll(".point").forEach(p => {
    p.style.cursor = "pointer";
    p.addEventListener("click", function () {
      if (mcbOn) {
        speakOrAlertLocal(buildVoicePayload("turn_off_mcb_before_removing_conn"));
        return;
      }
      const id = this.id;
      jsPlumb.getConnections({ source: id }).concat(jsPlumb.getConnections({ target: id }))
        .forEach(c => jsPlumb.deleteConnection(c));
      jsPlumb.repaintEverything();
    });
  });

  function guideSpeechActive() {
    return (
      typeof window !== "undefined" &&
      window.labSpeech &&
      typeof window.labSpeech.isActive === "function" &&
      window.labSpeech.isActive()
    );
  }

  function speakLocal(input, options = {}) {
    const payload = input;
    const text = getSpeechText(payload);
    const hasKeyedPayload =
      payload && typeof payload === "object" && !Array.isArray(payload) && !!payload.key;
    if (!text && !hasKeyedPayload) return;
    const opts = options || {};
    if (window.labSpeech && typeof window.labSpeech.say === "function") {
      window.labSpeech.say(payload, { interruptFirst: opts.interruptFirst !== false });
      return;
    }
    if (window.labSpeech && typeof window.labSpeech.speak === "function") {
      window.labSpeech.speak(payload, { interrupt: opts.interruptFirst !== false });
    }
  }

  function speakOrAlertLocal(input) {
    const text = getSpeechText(input);
    if (!text) return;
    if (guideSpeechActive()) {
      speakLocal(input, { interruptFirst: true });
    } else {
      showPopup(text);
    }
  }

  // Check button - Robust selection by text content (no ID needed)
  const checkBtn = findButtonByLabel("Check") || findButtonByLabel("Check Connections");
  if (checkBtn) {
    console.log("Check button found and wired."); // Debug log
    checkBtn.addEventListener("click", function () {
      if (window.labSpeech && typeof window.labSpeech.cancel === "function") {
        window.labSpeech.cancel();
      }
      const connections = jsPlumb.getAllConnections();
      const seenKeys = new Set();
      const illegal = [];

      connections.forEach(conn => {
        const key = [conn.sourceId, conn.targetId].sort().join("-");
        seenKeys.add(key);
        if (!allowedConnections.has(key)) {
          // Keep the user-made direction for clearer spoken feedback.
          illegal.push(`${conn.sourceId}-${conn.targetId}`);
        }
      });

      const missing = [];
      requiredConnections.forEach(req => {
        if (!seenKeys.has(req)) missing.push(req);
      });

      if (!missing.length && !illegal.length) {
        // Connections are correct; user will manually turn on the MCB.
        connectionsVerified = true;
        starterMoved = false;
        const checkedAutoBtn = findButtonByLabel("Auto Connect");
        if (checkedAutoBtn) {
          checkedAutoBtn.dataset.checkedLocked = "1";
          checkedAutoBtn.disabled = true;
        }
        window.dispatchEvent(new CustomEvent(CONNECTION_VERIFIED_EVENT));
        speakOrAlertLocal(buildVoicePayload("connections_correct_turn_on_mcb"));
        return;
      }

      // Find the next missing connection in defined order
      let nextMissing = null;
      for (const pair of requiredPairs) {
        const [a, b] = pair.split("-");
        const key = connectionKey(a, b);
        if (!seenKeys.has(key)) {
          // Preserve the required instruction order (e.g., B to A2).
          nextMissing = pair;
          break;
        }
      }

      const firstIllegal = illegal[0] || null;
      const wrongConnectionLabels = illegal
        .map((key) => formatConnectionPair(key))
        .filter(Boolean);
      const missingConnectionLabels = requiredPairs
        .filter((pair) => {
          const [a, b] = String(pair).split("-");
          return a && b && !seenKeys.has(connectionKey(a, b));
        })
        .map((pair) => formatConnectionDisplay(pair))
        .filter(Boolean);
      const isInitialWiringState = seenKeys.size === 0;
      const hasWrongDetails = wrongConnectionLabels.length > 0;
      const hasMissingDetails = !isInitialWiringState && missingConnectionLabels.length > 0;
      let message = hasWrongDetails || hasMissingDetails
        ? ""
        : getSpeechText(buildVoicePayload("before_connection_check"));

      if (wrongConnectionLabels.length) {
        const preview = wrongConnectionLabels.slice(0, 3).join(", ");
        const extraCount = Math.max(0, wrongConnectionLabels.length - 3);
        const extraText = extraCount ? ` and ${extraCount} more` : "";
        if (message) message += "\n";
        message += `Wrong connection${wrongConnectionLabels.length > 1 ? "s" : ""}: ${preview}${extraText}.`;
      }
      if (!isInitialWiringState && missingConnectionLabels.length) {
        const preview = missingConnectionLabels.slice(0, 3).join(", ");
        const extraCount = Math.max(0, missingConnectionLabels.length - 3);
        const extraText = extraCount ? ` and ${extraCount} more` : "";
        if (message) message += "\n";
        message += `Missing connection${missingConnectionLabels.length > 1 ? "s" : ""}: ${preview}${extraText}.`;
      }

      let speechKey = "before_connection_check";
      if (illegal.length > 1) {
        speechKey = "some_connection_wrong";
      } else if (illegal.length === 1) {
        speechKey = "wrong_connection";
      }
      let speechMessage = getSpeechText(buildVoicePayload(speechKey));
      if (firstIllegal) {
        speechMessage += ` Remove wrong connection ${formatConnectionSpeech(firstIllegal)}.`;
      }
      if (nextMissing) {
        speechMessage += ` Next connection: ${formatConnectionSpeech(nextMissing)}.`;
      }

      // Always speak guidance. Show popup for wrong or missing connections.
      speakLocal(buildVoicePayload(speechKey, speechMessage), { interruptFirst: true });
      if (illegal.length || missing.length) {
        showPopup(message);
      }
      setMcbState(false, { silent: true });
      connectionsVerified = false;
      starterMoved = false;
      updateControlLocks();
      stepGuide.reset();
      const lampSel = document.getElementById("number");
      if (lampSel) lampSel.disabled = true;
      const addBtn =
        findButtonByLabel("Add Table") ||
        findButtonByLabel("Add To Table") ||
        findButtonByLabel("Add");
      if (addBtn) addBtn.disabled = true;
    });
  } else {
    console.error("Check button not found! Looking for a control labeled 'Check' or 'Check Connections'. Add it or check HTML.");
  }

  // Auto Connect button - creates all required connections automatically
  const autoConnectBtn = findButtonByLabel("Auto Connect");
  if (autoConnectBtn) {
    autoConnectBtn.addEventListener("click", function () {
      autoConnectBtn.disabled = true;
      isAutoConnecting = true;
      suppressAllAutoVoices = true;
      suppressGuideDuringAutoConnect = true;

      const guideWasActive =
        typeof window.isGuideActive === "function" && window.isGuideActive();

      if (window.labSpeech && typeof window.labSpeech.stop === "function") {
        window.labSpeech.stop();
      }

      if (!guideWasActive) {
        resetSpeakButtonUI();
      }

      const runBatch = typeof jsPlumb.batch === "function" ? jsPlumb.batch.bind(jsPlumb) : (fn => fn());

      runBatch(function () {
        // Clear existing connections so the final wiring is always correct
        if (typeof jsPlumb.deleteEveryConnection === "function") {
          jsPlumb.deleteEveryConnection();
        } else {
          jsPlumb.getAllConnections().forEach(c => jsPlumb.deleteConnection(c));
        }

        const seenKeys = new Set();
        requiredPairs.forEach((req, index) => connectRequiredPair(req, seenKeys, index));
      });

      // Ensure rendering completes; retry any missing connections once.
      requestAnimationFrame(() => {
        jsPlumb.repaintEverything();

        const seenKeys = getSeenConnectionKeys();
        const missing = [];
        requiredConnections.forEach(req => {
          const [a, b] = req.split("-");
          const key = a && b ? connectionKey(a, b) : req;
          if (!seenKeys.has(key)) missing.push(req);
        });

        if (missing.length) {
          console.warn("Auto Connect: retrying missing connection(s):", missing);
          runBatch(() => {
            const seenNow = getSeenConnectionKeys();
            missing.forEach(req => connectRequiredPair(req, seenNow));
          });
          requestAnimationFrame(() => jsPlumb.repaintEverything());
        }

        console.log(`Auto Connect: required=${requiredConnections.size}, missing after retry=${missing.length}`);
      });

      setTimeout(() => {
        suppressAllAutoVoices = false;
        suppressGuideDuringAutoConnect = false;
        isAutoConnecting = false;
        showPopup(AUTO_CONNECT_COMPLETED_ALERT_MESSAGE, "Instruction");
        if (guideWasActive && window.labSpeech && typeof window.labSpeech.speak === "function") {
          window.labSpeech.speak(buildVoicePayload("autoconnect_completed"));
        }
      }, 0);
    });
  } else {
    console.error("Auto Connect button not found! Looking for '.pill-btn' with text 'Auto Connect'.");
  }

  // Speaking button - guided voice prompts for wiring
  (function initSpeakingGuidance() {
    function waitForVoices(callback) {
      if (!("speechSynthesis" in window)) {
        callback();
        return;
      }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        callback();
      };
      const timeoutId = setTimeout(finish, 600);

      const handler = () => {
        if (typeof window.speechSynthesis.removeEventListener === "function") {
          window.speechSynthesis.removeEventListener("voiceschanged", handler);
        } else {
          window.speechSynthesis.onvoiceschanged = null;
        }
        clearTimeout(timeoutId);
        finish();
      };

      const voices = window.speechSynthesis.getVoices();
      if (voices.length) {
        clearTimeout(timeoutId);
        finish();
        return;
      }

      if (typeof window.speechSynthesis.addEventListener === "function") {
        window.speechSynthesis.addEventListener("voiceschanged", handler);
      } else {
        window.speechSynthesis.onvoiceschanged = handler;
      }
    }

    const speakBtn = document.querySelector(".speak-btn");
    if (!speakBtn || !window.labSpeech) return;

    let guideActive = false;
    window.isGuideActive = () => guideActive;

    let currentStep = 0;
    const SPEAK_HIGHLIGHT_CLASS = "speak-glow";
    const SPEAK_LINE_COLOR = "#f59e0b";
    const SPEAK_LINE_WIDTH = 7;
    const activeSpeakLabels = new Set();
    const activeSpeakConnections = new Map();

    function addSpeakGlow(el, bucket) {
      if (!el) return;
      el.classList.add(SPEAK_HIGHLIGHT_CLASS);
      bucket.add(el);
    }

    function clearSpeakGlow(bucket) {
      bucket.forEach((el) => el.classList.remove(SPEAK_HIGHLIGHT_CLASS));
      bucket.clear();
    }

    function getPointLabelEl(id) {
      const suffix = String(id || "").replace(/^point/i, "");
      if (!suffix) return null;
      return document.querySelector(`.point-${suffix}`);
    }

    function getDefaultConnectionStyle(conn) {
      if (!conn) return { stroke: SPEAK_LINE_COLOR, strokeWidth: 4 };
      return {
        stroke: getWireColorForConnection(conn.sourceId, conn.targetId),
        strokeWidth: 4
      };
    }

    function clearSpeakConnectionHighlights() {
      activeSpeakConnections.forEach((style, conn) => {
        if (conn && typeof conn.setPaintStyle === "function" && style) {
          conn.setPaintStyle(style);
        }
      });
      activeSpeakConnections.clear();
    }

    function clearSpeakHighlights() {
      clearSpeakGlow(activeSpeakLabels);
      clearSpeakConnectionHighlights();
    }

    function highlightStep(step) {
      clearSpeakHighlights();
      if (!step) return;

      [step.from, step.to].forEach((id) => {
        if (!id) return;
        addSpeakGlow(getPointLabelEl(id), activeSpeakLabels);
      });

      if (!window.jsPlumb || typeof jsPlumb.getAllConnections !== "function") return;

      const key = connectionKey(step.from, step.to);
      jsPlumb.getAllConnections().forEach((conn) => {
        if (connectionKey(conn.sourceId, conn.targetId) !== key) return;
        const baseStyle =
          typeof conn.getPaintStyle === "function" ? conn.getPaintStyle() : conn.paintStyle;
        const storedStyle = baseStyle ? { ...baseStyle } : getDefaultConnectionStyle(conn);
        activeSpeakConnections.set(conn, storedStyle);
        const baseWidth = Number(storedStyle.strokeWidth) || 4;
        if (typeof conn.setPaintStyle === "function") {
          conn.setPaintStyle({
            ...storedStyle,
            stroke: SPEAK_LINE_COLOR,
            strokeWidth: Math.max(SPEAK_LINE_WIDTH, baseWidth + 2)
          });
        }
      });
    }

    const steps = requiredPairs
      .map((pair) => pair.split("-"))
      .filter((pair) => pair.length === 2)
      .map(([from, to]) => {
        const fromLabel = formatPointSpeech(from);
        const toLabel = formatPointSpeech(to);
        return {
          from,
          to,
          fromLabel,
          toLabel
        };
      });
    const totalSteps = steps.length;

    function buildStepText(step, index) {
      if (!step) return "";
      return `Connect point ${step.fromLabel} to point ${step.toLabel}.`;
    }

    const SPEECH_THROTTLE_MS = 700;
    let lastSpokenStep = -1;
    let lastSpokenAt = 0;

    function speakCurrentStep({ force = false, queue = false } = {}) {
      if (!guideActive) return;
      const step = steps[currentStep];
      if (!step) return;
      const now = Date.now();
      if (!force && currentStep === lastSpokenStep && now - lastSpokenAt < SPEECH_THROTTLE_MS) {
        return;
      }
      lastSpokenStep = currentStep;
      lastSpokenAt = now;
      const text = buildStepText(step, currentStep);
      if (!text) return;
      highlightStep(step);
      const key = `step_${connectionKey(step.from, step.to)}`;
      window.labSpeech.speak({ key, text }, { interrupt: !queue });
    }

    function getFirstIncompleteStepIndex() {
      const currentConnections = jsPlumb.getAllConnections();
      const connectedSet = new Set(
        currentConnections.map((conn) => connectionKey(conn.sourceId, conn.targetId))
      );

      for (let i = 0; i < steps.length; i += 1) {
        const step = steps[i];
        const key = connectionKey(step.from, step.to);
        if (!connectedSet.has(key)) {
          return i;
        }
      }

      return steps.length;
    }

    function activateGuideUI() {
      guideActive = true;
      speakBtn.classList.add("guiding");
      speakBtn.setAttribute("aria-pressed", "true");
      const label = speakBtn.querySelector(".speak-btn__label");
      if (label) label.textContent = "Guiding...";
      updateControlLocks();
    }

    function speakGuide(input, options = {}) {
      clearSpeakHighlights();
      const interrupt = options.interrupt !== false;
      lastSpokenStep = -1;

      let payload = input;
      if (input && typeof input === "object" && !Array.isArray(input)) {
        const key = typeof input.key === "string" ? input.key.trim() : "";
        const text = input.text == null ? "" : String(input.text);
        payload = key ? { key, text } : text;
      }
      if (payload == null || payload === "") return;

      window.labSpeech.speak(payload, { interrupt });
    }

    function getLabStage() {
      if (starterMoved) return "starter_on";
      if (mcbOn) return "dc_on";
      if (connectionsVerified) return "checked";
      return "connections";
    }

    function startGuide() {
      if (suppressGuideDuringAutoConnect || isAutoConnecting) return;

      const stage = getLabStage();
      switch (stage) {
        case "checked":
          activateGuideUI();
          speakGuide(buildVoicePayload("guide_checked"));
          return;
        case "dc_on":
          activateGuideUI();
          speakGuide(buildVoicePayload("guide_mcb_on"));
          return;
        case "starter_on":
          activateGuideUI();
          speakGuide(buildVoicePayload("guide_starter_on"));
          return;
        default:
          break;
      }

      if (!steps.length) {
        activateGuideUI();
        speakGuide("I could not find any wiring points on the page.");
        return;
      }

      const firstIncomplete = getFirstIncompleteStepIndex();
      if (firstIncomplete >= steps.length) {
        activateGuideUI();
        speakGuide(buildVoicePayload("guide_all_complete"));
        return;
      }

      activateGuideUI();
      currentStep = firstIncomplete;

      waitForVoices(() => {
        if (!guideActive) return;
        window.labSpeech.speak(
          buildVoicePayload("guide_intro"),
          {
            interrupt: true,
            onend: () => {
              if (guideActive) speakCurrentStep({ force: true });
            }
          }
        );
      });
    }

    function stopGuide({ resetUI = false } = {}) {
      if (!guideActive && !resetUI) return;

      guideActive = false;
      currentStep = 0;
      lastSpokenStep = -1;
      lastSpokenAt = 0;
      clearSpeakHighlights();

      if (window.labSpeech && typeof window.labSpeech.stop === "function") {
        window.labSpeech.stop();
      }

      if (resetUI) {
        resetSpeakButtonUI();
      }
      updateControlLocks();
    }

    window.labSpeech.isActive = () => guideActive;
    window.labSpeech.say = (text, options = {}) => {
      if (!guideActive || !text) return Promise.resolve();
      const interrupt = options.interruptFirst !== false;
      return window.labSpeech.speak(text, { interrupt });
    };
    window.labSpeech.sayLines = (lines, options = {}) => {
      if (!guideActive || !Array.isArray(lines) || !lines.length) return Promise.resolve();
      const interrupt = options.interruptFirst !== false;
      return window.labSpeech.speak(lines[0], { interrupt });
    };
    window.labSpeech.cancel = () => {
      window.labSpeech.stop();
    };

    window.stopGuideSpeech = () => {
      stopGuide({ resetUI: true });
    };

    speakBtn.addEventListener("click", () => {
      if (guideActive) {
        stopGuide({ resetUI: true });
      } else {
        startGuide();
      }
    });

    jsPlumb.bind("connection", function (info) {
      
      if (!guideActive) return;
      if (suppressGuideDuringAutoConnect || isAutoConnecting) return;

      const made = connectionKey(info.sourceId, info.targetId);
      if (!requiredConnections.has(made) && !allowedConnections.has(made)) {
        const wrongA = formatPointSpeech(info.sourceId);
        const wrongB = formatPointSpeech(info.targetId);
        window.labSpeech.speak(
          buildVoicePayload(
            "wrong_connection",
            `That connection is wrong. You connected point ${wrongA} to point ${wrongB}.`
          )
        );
        speakCurrentStep({ force: true, queue: true });
        return;
      }

      currentStep = getFirstIncompleteStepIndex();
      if (currentStep >= steps.length) {
        speakGuide(
          buildVoicePayload(
            "guide_all_complete",
            "All connections are complete. Click the Check button to verify the connection."
          )
        );
        return;
      }

      speakCurrentStep({ force: true });
    });

    jsPlumb.bind("connectionDetached", function () {
      if (!guideActive) return;
      if (suppressGuideDuringAutoConnect || isAutoConnecting) return;
      currentStep = Math.max(0, getFirstIncompleteStepIndex());
      if (currentStep < steps.length) {
        speakCurrentStep({ force: true });
      }
    });

    window.addEventListener(CONNECTION_VERIFIED_EVENT, function () {
      if (!guideActive) return;
      speakGuide(
        buildVoicePayload(
          "guide_checked",
          "Connections verified. Turn on the MCB to continue."
        )
      );
    });

    window.addEventListener(MCB_TURNED_OFF_EVENT, function () {
      if (!guideActive) return;
      speakGuide(buildVoicePayload("guide_turn_off_mcb"));
    });

    window.addEventListener(STARTER_MOVED_EVENT, function () {
      if (!guideActive) return;
      speakGuide(
        buildVoicePayload("guide_starter_on", "Select the number of bulbs from the lamp load.")
      );
    });
  })();

  // Lock every point to its initial coordinates so resizing the window cannot drift them
  const pinnedSelectors = [
    ".point",
    ".point-R", ".point-B", ".point-L", ".point-A", ".point-F",
    ".point-C", ".point-D", ".point-E", ".point-G", ".point-H", ".point-I", ".point-J", ".point-K",
    ".point-A1", ".point-Z1", ".point-A2", ".point-Z2", ".point-A3", ".point-Z3", ".point-A4", ".point-Z4",
    ".point-L1", ".point-L2"
  ];
  const basePositions = new Map();
  function captureBasePositions() {
    basePositions.clear();
    document.querySelectorAll(pinnedSelectors.join(", ")).forEach(el => {
      const parent = el.offsetParent;
      if (!parent) return;
      basePositions.set(el, {
        left: el.offsetLeft,
        top: el.offsetTop
      });
    });
  }
  function lockPointsToBase() {
    if (!basePositions.size) {
      captureBasePositions();
    }
    basePositions.forEach((base, el) => {
      el.style.left = `${base.left}px`;
      el.style.top = `${base.top}px`;
    });
    if (window.jsPlumb) {
      jsPlumb.repaintEverything();
    }
  }
  const initPinnedPoints = () => {
    captureBasePositions();
    lockPointsToBase();
  };
  if (document.readyState === "complete") {
    initPinnedPoints();
  } else {
    window.addEventListener("load", initPinnedPoints);
  }
  window.addEventListener("resize", lockPointsToBase);
  });
  return true;
}

(function startJsPlumbWhenReady() {
  if (setupJsPlumb()) return;
  console.error("jsPlumb is not loaded yet. Retrying...");
  const retryInterval = setInterval(() => {
    if (setupJsPlumb()) clearInterval(retryInterval);
  }, 200);
  window.addEventListener(
    "load",
    () => {
      if (setupJsPlumb()) clearInterval(retryInterval);
    },
    { once: true }
  );
})();


// Disable the Check button once the MCB is turned on
window.addEventListener(MCB_TURNED_ON_EVENT, () => {
  const btn = findButtonByLabel("Check") || findButtonByLabel("Check Connections");
  if (btn) btn.disabled = true;
});

