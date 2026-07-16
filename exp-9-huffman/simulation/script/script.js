let connectionsVerified = false;
let starterMoved = false;
let mcbOn = false;
const CONNECTION_VERIFIED_EVENT = "connections-verified";
const MCB_TURNED_OFF_EVENT = "mcb-turned-off";
const MCB_TURNED_ON_EVENT = "mcb-turned-on";
const STARTER_MOVED_EVENT = "starter-moved";
const WIRE_CURVINESS = 50;

const generatorRotor = document.querySelector(".generator-rotor");

let suppressAllAutoVoices = true;
let suppressGuideDuringAutoConnect = false;
let isAutoConnecting = false;

function resetSpeakButtonUI() {
  const speakBtn = document.querySelector(".speak-btn");
  if (!speakBtn) return;

  speakBtn.classList.remove("guiding");
  speakBtn.setAttribute("aria-pressed", "false");

  const label = speakBtn.querySelector(".speak-btn__label");
  if (label) {
    label.textContent = "AI Guide";
  }
}

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  window.speechSynthesis.cancel();
}
resetSpeakButtonUI();

function pickPreferredVoice() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices || !voices.length) return null;

  const englishVoices = voices.filter((voice) =>
    String(voice.lang || "").toLowerCase().startsWith("en")
  );

  const maleByGender = englishVoices.find(
    (voice) => String(voice.gender || "").toLowerCase() === "male"
  );
  if (maleByGender) return maleByGender;

  const maleNameHints = [
    /male/i,
    /ravi/i,
    /hemant/i,
    /david/i,
    /mark/i,
    /george/i,
    /daniel/i,
    /alex/i,
    /fred/i,
    /john/i,
    /james/i,
    /mike/i,
    /andrew/i,
    /tom/i,
    /steve/i,
    /roger/i
  ];
  const maleByName = englishVoices.find((voice) =>
    maleNameHints.some((hint) => hint.test(String(voice.name || "")))
  );
  if (maleByName) return maleByName;

  const enIndia = englishVoices.find((voice) =>
    String(voice.lang || "").toLowerCase().startsWith("en-in")
  );
  return enIndia || englishVoices[0] || voices[0];
}

window.labSpeech = window.labSpeech || {};
window.labSpeech.enabled = true;
// Set to false to avoid any legacy/browser TTS voice while you replace clips.
const LAB_ENABLE_TTS_FALLBACK = false;
const labSpeechState = {
  queue: [],
  currentItem: null,
  currentAudio: null,
  currentUtterance: null,
  voicePack: null,
  autoplayBlocked: false,
  retryArmed: false,
  retryHandler: null,
  pendingRetry: null
};

function supportsTtsEngine() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function"
  );
}

function canUseTtsFallback() {
  return LAB_ENABLE_TTS_FALLBACK === true;
}

function normalizeSpeechPayload(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return {
      key: typeof input.key === "string" ? input.key.trim() : "",
      text: input.text == null ? "" : String(input.text)
    };
  }
  if (input == null) return { key: "", text: "" };
  return { key: "", text: String(input) };
}

function resolveVoicePackSrc(key) {
  if (!key || !labSpeechState.voicePack) return "";
  const src = labSpeechState.voicePack[key];
  if (typeof src !== "string") return "";
  const normalized = src.trim();
  if (!normalized || normalized === "#") return "";
  return normalized;
}

function normalizeStaticAudioPath(ref) {
  const value = String(ref || "").trim();
  if (!value) return value;
  if (value.startsWith("./audio/")) {
    return `../audio/${value.slice("./audio/".length)}`;
  }
  if (value.startsWith("audio/")) {
    return `../${value}`;
  }
  return value;
}

function runSpeechOnEnd(item, invokeOnEnd = true) {
  if (!item) return;
  if (invokeOnEnd && typeof item.options?.onend === "function") {
    try {
      item.options.onend();
    } catch (error) {
      console.warn("labSpeech onend callback failed:", error);
    }
  }
  if (typeof item.resolve === "function") {
    item.resolve();
  }
}

function disarmSpeechRetry() {
  if (!labSpeechState.retryArmed || !labSpeechState.retryHandler) return;
  window.removeEventListener("pointerdown", labSpeechState.retryHandler, true);
  window.removeEventListener("keydown", labSpeechState.retryHandler, true);
  labSpeechState.retryArmed = false;
  labSpeechState.retryHandler = null;
}

function stopCurrentAudioPlayback() {
  const audio = labSpeechState.currentAudio;
  if (!audio) return;
  labSpeechState.currentAudio = null;
  audio.onended = null;
  audio.onerror = null;
  if (typeof audio.pause === "function") audio.pause();
  try {
    audio.currentTime = 0;
  } catch (error) {
    console.debug("labSpeech audio reset skipped:", error);
  }
}

function stopCurrentTtsPlayback() {
  labSpeechState.currentUtterance = null;
  if (supportsTtsEngine()) {
    window.speechSynthesis.cancel();
  }
}

function clearSpeechQueue(invokeOnEnd = false) {
  if (!labSpeechState.queue.length) return;
  const pending = labSpeechState.queue.splice(0, labSpeechState.queue.length);
  pending.forEach((item) => runSpeechOnEnd(item, invokeOnEnd));
}

function stopSpeechEngine({
  clearQueue = true,
  resolveCurrent = true,
  invokeCurrentOnEnd = false,
  clearRetry = true
} = {}) {
  stopCurrentAudioPlayback();
  stopCurrentTtsPlayback();

  if (clearRetry) {
    labSpeechState.autoplayBlocked = false;
    labSpeechState.pendingRetry = null;
    disarmSpeechRetry();
  }

  const current = labSpeechState.currentItem;
  labSpeechState.currentItem = null;
  if (resolveCurrent && current) {
    runSpeechOnEnd(current, invokeCurrentOnEnd);
  }

  if (clearQueue) {
    clearSpeechQueue(false);
  }
}

function finishCurrentSpeech(invokeOnEnd = true) {
  const current = labSpeechState.currentItem;
  labSpeechState.currentItem = null;
  runSpeechOnEnd(current, invokeOnEnd);
  flushSpeechQueue();
}

function isAutoplayBlockedError(error) {
  const name = String(error?.name || "");
  return name === "NotAllowedError";
}

function armAutoplayRetry(item, src) {
  labSpeechState.autoplayBlocked = true;
  labSpeechState.pendingRetry = { item, src };
  if (labSpeechState.retryArmed) return;

  labSpeechState.retryHandler = () => {
    const pending = labSpeechState.pendingRetry;
    labSpeechState.pendingRetry = null;
    labSpeechState.autoplayBlocked = false;
    disarmSpeechRetry();
    if (!pending) return;
    if (labSpeechState.currentItem !== pending.item) return;
    playRecordedSpeech(pending.item, pending.src, { fromRetry: true });
  };

  labSpeechState.retryArmed = true;
  window.addEventListener("pointerdown", labSpeechState.retryHandler, {
    once: true,
    capture: true
  });
  window.addEventListener("keydown", labSpeechState.retryHandler, {
    once: true,
    capture: true
  });
}

function playTtsSpeech(item) {
  if (!item || labSpeechState.currentItem !== item) return;
  if (!canUseTtsFallback()) {
    finishCurrentSpeech(true);
    return;
  }
  const text = item.payload?.text;
  if (!text || !supportsTtsEngine()) {
    finishCurrentSpeech(true);
    return;
  }

  stopCurrentAudioPlayback();

  const opts = item.options || {};
  const utterance = new SpeechSynthesisUtterance(String(text));
  const voice = pickPreferredVoice();
  if (voice) utterance.voice = voice;

  utterance.lang = (voice && voice.lang) || "en-US";
  utterance.rate = Number.isFinite(opts.rate) ? opts.rate : 0.85;
  utterance.pitch = Number.isFinite(opts.pitch) ? opts.pitch : 0.9;
  utterance.volume = Number.isFinite(opts.volume) ? opts.volume : 1;

  labSpeechState.currentUtterance = utterance;
  const settle = () => {
    if (labSpeechState.currentUtterance === utterance) {
      labSpeechState.currentUtterance = null;
    }
    if (labSpeechState.currentItem !== item) return;
    finishCurrentSpeech(true);
  };

  utterance.onend = settle;
  utterance.onerror = settle;

  try {
    window.speechSynthesis.speak(utterance);
  } catch (error) {
    console.warn("labSpeech TTS speak failed:", error);
    settle();
  }
}

function playRecordedSpeech(item, src, { fromRetry = false } = {}) {
  if (!item || labSpeechState.currentItem !== item) return;
  if (!src) {
    if (canUseTtsFallback()) {
      playTtsSpeech(item);
    } else {
      finishCurrentSpeech(true);
    }
    return;
  }

  stopCurrentAudioPlayback();
  stopCurrentTtsPlayback();

  const audio = new Audio(src);
  audio.preload = "auto";
  labSpeechState.currentAudio = audio;

  let settled = false;
  const teardown = () => {
    if (settled) return;
    settled = true;
    if (labSpeechState.currentAudio === audio) {
      labSpeechState.currentAudio = null;
    }
    audio.onended = null;
    audio.onerror = null;
    if (typeof audio.pause === "function") audio.pause();
    try {
      audio.currentTime = 0;
    } catch (error) {
      console.debug("labSpeech audio cleanup skipped:", error);
    }
  };

  const finish = () => {
    if (labSpeechState.currentItem !== item) {
      teardown();
      return;
    }
    teardown();
    finishCurrentSpeech(true);
  };

  const fallbackToTts = () => {
    if (labSpeechState.currentItem !== item) {
      teardown();
      return;
    }
    const key = String(item?.payload?.key || "");
    console.warn(`labSpeech: failed to play recorded clip${key ? ` for key "${key}"` : ""}: ${src}`);
    teardown();
    if (canUseTtsFallback()) {
      playTtsSpeech(item);
    } else {
      finishCurrentSpeech(true);
    }
  };

  audio.onended = finish;
  audio.onerror = fallbackToTts;

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch((error) => {
      if (settled) return;
      if (isAutoplayBlockedError(error) && !fromRetry) {
        teardown();
        armAutoplayRetry(item, src);
        return;
      }
      fallbackToTts();
    });
  }
}

function flushSpeechQueue() {
  if (labSpeechState.currentItem || !labSpeechState.queue.length) return;
  const item = labSpeechState.queue.shift();
  labSpeechState.currentItem = item;
  const clipSrc = resolveVoicePackSrc(item.payload?.key);
  if (clipSrc) {
    playRecordedSpeech(item, clipSrc);
    return;
  }
  const missingKey = String(item?.payload?.key || "");
  if (missingKey) {
    console.warn(`labSpeech: no audio mapped for key "${missingKey}".`);
  }
  if (canUseTtsFallback()) {
    playTtsSpeech(item);
  } else {
    finishCurrentSpeech(true);
  }
}

window.labSpeech.useRecordedVoice = function useRecordedVoice(voicePack, options = {}) {
  if (!voicePack || typeof voicePack !== "object") {
    labSpeechState.voicePack = null;
    return;
  }
  labSpeechState.voicePack = { ...voicePack };
  const shouldPreload = options && options.preload === true;
  if (!shouldPreload) return;

  Object.keys(labSpeechState.voicePack).forEach((key) => {
    const src = resolveVoicePackSrc(key);
    if (!src) return;
    try {
      const audio = new Audio(src);
      audio.preload = "auto";
      if (typeof audio.load === "function") audio.load();
    } catch (error) {
      console.warn("labSpeech preload failed:", error);
    }
  });
};

window.labSpeech.speak = function speak(input, options = {}) {
  if (!window.labSpeech.enabled) return Promise.resolve();

  const payload = normalizeSpeechPayload(input);
  if (!payload.key && !payload.text) return Promise.resolve();

  const opts = options || {};
  return new Promise((resolve) => {
    const item = {
      payload,
      options: opts,
      resolve
    };

    const shouldInterrupt = opts.interrupt !== false;
    if (shouldInterrupt) {
      stopSpeechEngine({
        clearQueue: true,
        resolveCurrent: true,
        invokeCurrentOnEnd: false,
        clearRetry: true
      });
    }

    labSpeechState.queue.push(item);
    flushSpeechQueue();
  });
};
window.labSpeech.stop = function stop() {
  stopSpeechEngine({
    clearQueue: true,
    resolveCurrent: true,
    invokeCurrentOnEnd: false,
    clearRetry: true
  });
};
window.labSpeech.cancel =
  window.labSpeech.cancel ||
  function cancel() {
    window.labSpeech.stop();
  };
window.labSpeech.isActive = window.labSpeech.isActive || (() => false);
window.labSpeech.say =
  window.labSpeech.say ||
  function say(text) {
    if (!text) return Promise.resolve();
    return window.labSpeech.speak(text);
  };
window.labSpeech.sayLines =
  window.labSpeech.sayLines ||
  function sayLines(lines) {
    if (!Array.isArray(lines) || !lines.length) return Promise.resolve();
    const [first] = lines;
    if (!first) return Promise.resolve();
    return window.labSpeech.speak(first);
  };

function updateRotorSpin() {
  if (!generatorRotor) return;
  const shouldSpin = connectionsVerified && mcbOn && starterMoved;
  generatorRotor.classList.toggle("spinning", shouldSpin);
}

// Step-by-step helper popups removed
const stepGuide = {
  complete: () => {},
  reset: () => {},
  showCurrent: () => {},
  hide: () => {}
};

function setBodyModalState(isOpen) {
  const body = document.body;
  if (!body) return;
  if (isOpen) {
    body.classList.add("is-modal-open");
    return;
  }
  const componentsModal = document.getElementById("componentsModal");
  if (componentsModal && !componentsModal.classList.contains("is-hidden")) return;
  body.classList.remove("is-modal-open");
}

const COMPONENTS_EXIT_ALERT_MESSAGE =
  "Now that you are familiar with all the components used in this experiment, you may now start the simulation \n\nAn AI guide is available to assist you at every step.";
const COMPONENTS_EXIT_ALERT_AUDIO_SRC = "./audio/components_window_intro.wav";
const AUTO_CONNECT_COMPLETED_ALERT_MESSAGE =
  "Autoconnect completed. Click on the check button to verify the connections.";
const AUTO_CONNECT_COMPLETED_ALERT_AUDIO_SRC = "./audio/autoconnect_completed.wav";

// Editable voice catalog:
// - `key`: identifier used by buildVoicePayload / step speaking
// - `text`: TTS fallback text
// - `audio`: audio file name or path; keep "#" as temporary placeholder
const LAB_VOICE_CATALOG = [
  {
    key: "components_window_intro",
    text:
      "Now that you are familiar with all the components used in this experiment, you may now start the simulation. An AI guide is available to assist you at every step.",
    audio: "./audio/components_window_intro.wav"
  },
  { key: "autoconnect_completed", text: AUTO_CONNECT_COMPLETED_ALERT_MESSAGE, audio: "./audio/autoconnect_completed.wav" },
  {
    key: "mcb_turned_on",
    text: "The MCB has been turned ON. Now move the starter handle from left to right.",
    audio: "./audio/mcb_turned_on.wav"
  },
  {
    key: "mcb_turned_off_between",
    text: "You turned off the MCB. Turn it back on to continue the simulation.",
    audio: "./audio/mcb_turned_off_between.wav"
  },
  { key: "guide_intro", text: "Let's connect the components.", audio: "./audio/guide_intro.wav" },
  {
    key: "guide_checked",
    text: "Connections are already verified. Turn on the MCB to continue.",
    audio: "./audio/guide_checked.wav"
  },
  {
    key: "guide_mcb_on",
    text: "The MCB is already on. Move the starter handle from left to right.",
    audio: "./audio/guide_mcb_on.wav"
  },
  {
    key: "guide_starter_on",
    text: "Select the number of bulbs from the lamp load.",
    audio: "./audio/guide_starter_on.wav"
  },
  {
    key: "guide_all_complete",
    text: "All connections are complete. Click the Check button to verify the connections.",
    audio: "./audio/guide_all_complete.wav"
  },
  {
    key: "guide_turn_off_mcb",
    text: "You turned off the MCB. Turn it back on to continue the simulation.",
    audio: "./audio/mcb_turned_off_between.wav"
  },
  {
    key: "before_connection_check",
    text: "Please make all the connections first.",
    audio: "./audio/before_connection_check.wav"
  },
  {
    key: "before_connection_mcb_alert",
    text: "Make and check the connections before turning on the MCB.",
    audio: "./audio/before_connection_mcb_alert.wav"
  },
  {
    key: "connections_correct_turn_on_mcb",
    text: "Connections are correct, click on the MCB to turn it on.",
    audio: "./audio/connections_correct_turn_on_mcb.wav"
  },
  {
    key: "wrong_connection",
    text: "This connection is wrong.",
    audio: "./audio/wrong_connection.wav"
  },
  {
    key: "some_connection_wrong",
    text: "Some connections are wrong.",
    audio: "./audio/some_connection_wrong.wav"
  },
  {
    key: "turn_off_mcb_before_removing_conn",
    text: "Turn off the MCB before removing the connections.",
    audio: "./audio/turn_off_mcb_before_removing_conn.wav"
  },
  {
    key: "please_check_connections_first",
    text: "Please check the connections first.",
    audio: "./audio/please_check_connections_first.wav"
  },
  { key: "please_turn_on_mcb", text: "Please turn on the MCB before continuing.", audio: "./audio/please_turn_on_mcb.wav" },
  {
    key: "please_move_starter",
    text: "Please move the starter handle from left to right.",
    audio: "./audio/please_move_starter.wav"
  },
  {
    key: "before_add_table_select_bulbs",
    text: "Select the number of bulbs first.",
    audio: "./audio/before_add_table_select_bulbs.wav"
  },
  {
    key: "first_reading_selected",
    text: "Click on the add to table button to add the reading to the observation table.",
    audio: "./audio/first_reading_selected.wav"
  },
  {
    key: "duplicate_reading",
    text: "This reading is already added to the table. Please choose a different load.",
    audio: "./audio/duplicate_reading.wav"
  },
  {
    key: "after_first_reading_added",
    text: "Once again, change the bulb selection.",
    audio: "./audio/after_first_reading_added.wav"
  },
  { key: "second_reading", text: "Click add to table button again.", audio: "./audio/second_reading.wav" },
  {
    key: "graph_or_more_readings",
    text: "Now you can plot the graph by clicking on the graph button or add more readings to the table.",
    audio: "./audio/graph_or_more_readings.wav"
  },
  {
    key: "after_ten_readings_done",
    text: "All ten readings have been recorded. Now plot the graph and then click on the report button to generate your report.",
    audio: "./audio/after_ten_readings_done.wav"
  },
  {
    key: "max_readings",
    text: "You can add a maximum of 10 readings to the table. Now, click the Graph button.",
    audio: "./audio/max_readings.wav"
  },
  {
    key: "graph_complete",
    text: "The graph of terminal voltage versus load current has been plotted. Your experiment is now complete. You may view the report by clicking on the report button, then use print to print the page or reset to start again.",
    audio: "./audio/graph_complete.wav"
  },
  {
    key: "report_ready",
    text: "Simulation completed successfully. You can now access your simulation report—click OK to view it.\nNote: Your experiment progress report is also ready.",
    audio: "./audio/report_ready.wav"
  },
  { key: "reset", text: "The simulation has been reset. You can start again.", audio: "./audio/reset.wav" },
  { key: "print", text: "Opening the print dialog.", audio: "./audio/print.wav" },
  { key: "reading_added", text: "Reading added to the observation table.", audio: "#" },

  // Step prompts (normalized key uses sorted point ids from connectionKey)..
  { key: "step_pointC-pointR", text: "Connect point R to point C.", audio: "./audio/step_pointC-pointR.wav" },
  { key: "step_pointE-pointR", text: "Connect point R to point E.", audio: "./audio/step_pointE-pointR.wav" },
  { key: "step_pointB-pointG", text: "Connect point B to point G.", audio: "./audio/step_pointB-pointG.wav" },
  { key: "step_pointA2-pointB", text: "Connect point B to point A 2.", audio: "./audio/step_pointA2-pointB.wav" },
  { key: "step_pointA2-pointZ2", text: "Connect point A 2 to point Z 2.", audio: "./audio/step_pointA2-pointZ2.wav" },
  { key: "step_pointD-pointL", text: "Connect point L to point D.", audio: "./audio/step_pointD-pointL.wav" },
  { key: "step_pointA-pointA1", text: "Connect point A to point A 1.", audio: "./audio/step_pointA-pointA1.wav" },
  { key: "step_pointF-pointZ1", text: "Connect point F to point Z 1.", audio: "./audio/step_pointF-pointZ1.wav" },
  { key: "step_pointA4-pointL2", text: "Connect point L 2 to point A 4.", audio: "./audio/step_pointA4-pointL2.wav" },
  { key: "step_pointA4-pointZ4", text: "Connect point A 4 to point Z 4.", audio: "./audio/step_pointA4-pointZ4.wav" },
  { key: "step_pointK-pointZ4", text: "Connect point Z 4 to point K.", audio: "./audio/step_pointK-pointZ4.wav" },
  { key: "step_pointI-pointJ", text: "Connect point I to point J.", audio: "./audio/step_pointI-pointJ.wav" },
  { key: "step_pointJ-pointL1", text: "Connect point J to point L 1.", audio: "./audio/step_pointJ-pointL1.wav" },
  { key: "step_pointA3-pointH", text: "Connect point H to point A 3.", audio: "./audio/step_pointA3-pointH.wav" },
  { key: "step_pointH-pointZ3", text: "Connect point H to point Z 3.", audio: "./audio/step_pointH-pointZ3.wav" }
];

const LAB_VOICE_TEXTS = Object.create(null);
const LAB_VOICE_AUDIO_FILES = Object.create(null);
LAB_VOICE_CATALOG.forEach((entry) => {
  if (!entry || typeof entry !== "object") return;
  const key = String(entry.key || "").trim();
  if (!key) return;
  const text = entry.text == null ? "" : String(entry.text).trim();
  const audio = entry.audio == null ? "#" : String(entry.audio).trim() || "#";
  LAB_VOICE_TEXTS[key] = text;
  LAB_VOICE_AUDIO_FILES[key] = audio;
});

function getSpeechText(input) {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input.text == null ? "" : String(input.text).trim();
  }
  return input == null ? "" : String(input).trim();
}

function buildVoicePayload(key, fallbackText = "") {
  const mappedText = typeof LAB_VOICE_TEXTS[key] === "string" ? LAB_VOICE_TEXTS[key] : "";
  const text = getSpeechText(fallbackText) || mappedText;
  return { key: String(key || ""), text };
}

function getVoiceAudioRef(key) {
  const mappedAudio = LAB_VOICE_AUDIO_FILES[key];
  if (typeof mappedAudio !== "string") return "#";
  const normalized = mappedAudio.trim();
  return normalized || "#";
}

function normalizePopupMessage(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizePopupAudioSrc(ref) {
  const value = String(ref || "").trim();
  if (!value) return "";
  if (typeof normalizeStaticAudioPath === "function") {
    return normalizeStaticAudioPath(value);
  }
  return value;
}

function resolvePopupAudioSrc(message) {
  const normalized = normalizePopupMessage(message);
  if (normalized === normalizePopupMessage(COMPONENTS_EXIT_ALERT_MESSAGE)) {
    return normalizePopupAudioSrc(COMPONENTS_EXIT_ALERT_AUDIO_SRC);
  }
  if (normalized === normalizePopupMessage(AUTO_CONNECT_COMPLETED_ALERT_MESSAGE)) {
    return normalizePopupAudioSrc(AUTO_CONNECT_COMPLETED_ALERT_AUDIO_SRC);
  }

  if (
    typeof LAB_VOICE_TEXTS !== "undefined" &&
    LAB_VOICE_TEXTS &&
    typeof LAB_VOICE_AUDIO_FILES !== "undefined" &&
    LAB_VOICE_AUDIO_FILES
  ) {
    const matchKey = Object.keys(LAB_VOICE_TEXTS).find((key) => (
      normalized === normalizePopupMessage(LAB_VOICE_TEXTS[key])
    ));
    if (matchKey) {
      return normalizePopupAudioSrc(LAB_VOICE_AUDIO_FILES[matchKey]);
    }
  }
  return "";
}

function showPopup(message, title = "Alert") {
  if (!message) return;
  const modal = document.getElementById("warningModal");
  if (!modal) {
    window.alert(message);
    return;
  }
  const box = modal.querySelector(".modal-box");
  const msg = modal.querySelector("#modalMessage");
  const ttl = modal.querySelector("#modalTitle");
  const sound = document.getElementById("alertSound");

  if (ttl) ttl.textContent = title;
  if (msg) {
    msg.textContent = message;
  }

  if (box) {
    box.classList.remove("closing");
    box.classList.add("danger");
  }
  modal.classList.add("show");
  setBodyModalState(true);

  if (sound && typeof sound.play === "function") {
    const audioSrc = resolvePopupAudioSrc(message);
    if (!audioSrc || audioSrc === "#") {
      if (typeof sound.pause === "function") sound.pause();
      sound.removeAttribute("src");
      return;
    }
    if (sound.getAttribute("src") !== audioSrc) {
      sound.setAttribute("src", audioSrc);
    }
    sound.currentTime = 0;
    const playPromise = sound.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }
}

function closeModal() {
  const modal = document.getElementById("warningModal");
  if (!modal) return;
  const box = modal.querySelector(".modal-box");
  const sound = document.getElementById("alertSound");

  if (box) {
    box.classList.add("closing");
  }

  setTimeout(() => {
    modal.classList.remove("show");
    if (box) {
      box.classList.remove("closing");
    }
    setBodyModalState(false);
  }, 500);

  if (sound && typeof sound.pause === "function") {
    sound.pause();
  }
}

function waitForWarningModalAcknowledgement() {
  return new Promise((resolve) => {
    const modal = document.getElementById("warningModal");
    if (!modal) {
      resolve();
      return;
    }

    const closeBtn = modal.querySelector("[data-modal-close]");
    let resolved = false;
    let observer = null;
    const cleanup = () => {
      if (resolved) return;
      resolved = true;
      closeBtn?.removeEventListener("click", onClose);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onEsc);
      observer?.disconnect();
      resolve();
    };

    const onClose = () => cleanup();
    const onBackdrop = (event) => {
      if (event.target === modal) cleanup();
    };
    const onEsc = (event) => {
      if (event.key === "Escape") cleanup();
    };

    closeBtn?.addEventListener("click", onClose, { once: true });
    modal.addEventListener("click", onBackdrop, { once: true });
    document.addEventListener("keydown", onEsc, { once: true });

    observer = new MutationObserver(() => {
      if (!modal.classList.contains("show")) {
        cleanup();
      }
    });
    observer.observe(modal, { attributes: true, attributeFilter: ["class"] });
  });
}

function isModalOpen() {
  const modal = document.getElementById("warningModal");
  return !!(modal && modal.classList.contains("show"));
}

window.closeModal = closeModal;
window.showPopup = showPopup;
if (typeof window !== "undefined") {
  window.addEventListener(CONNECTION_VERIFIED_EVENT, () => window.labTracking?.recordStep?.("Connections verified"));
  window.addEventListener(MCB_TURNED_ON_EVENT, () => window.labTracking?.recordStep?.("MCB turned on"));
  window.addEventListener(STARTER_MOVED_EVENT, () => window.labTracking?.recordStep?.("Starter engaged"));
}

(function initWarningModal() {
  const modal = document.getElementById("warningModal");
  if (!modal) return;
  const closeBtn = modal.querySelector("[data-modal-close]");

  closeBtn?.addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isModalOpen()) {
      closeModal();
    }
  });
})();

(function initComponentIntro() {
  const intro = document.getElementById("componentIntro");
  if (!intro) return;

  const skipBtn = intro.querySelector(".component-intro__skip");
  const closeTargets = intro.querySelectorAll("[data-component-intro-close]");

  function open() {
    intro.classList.remove("is-hidden");
    if (stepGuide && typeof stepGuide.hide === "function") {
      stepGuide.hide();
    }
    skipBtn?.focus?.();
  }

  function close() {
    intro.classList.add("is-hidden");
    if (stepGuide && typeof stepGuide.showCurrent === "function") {
      stepGuide.showCurrent();
    }
  }

  closeTargets.forEach((target) => target.addEventListener("click", close));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", open, { once: true });
  } else {
    open();
  }
})();

const sharedControls = {
  updateControlLocks: () => {},
  setMcbState: () => {},
  starterHandle: null
};

function findButtonByLabel(label) {
  if (!label) return null;
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const target = normalize(label);
  const buttons = document.querySelectorAll(".pill-btn, .graph-pill-btn");
  return (
    Array.from(buttons).find((btn) => {
      const text = normalize(btn.textContent);
      const aria = normalize(btn.getAttribute("aria-label"));
      return text === target || aria === target || text.includes(target) || aria.includes(target);
    }) || null
  );
}

// (function initInstructionsModal() {
//   const openBtn = document.querySelector(".instructions-btn");
//   const modal = document.getElementById("instructionModal");
//   if (!openBtn || !modal) return;

//   const closeBtn = modal.querySelector(".instruction-close");
//   const backdrop = modal.querySelector(".instruction-overlay__backdrop");
//   const hiddenClass = "is-hidden";

//   let lastFocusedEl = null;

//   function isOpen() {
//     return !modal.classList.contains(hiddenClass);
//   }

//   function open() {
//     if (isOpen()) return;
//     lastFocusedEl = document.activeElement;
//     modal.classList.remove(hiddenClass);
//     openBtn.setAttribute("aria-expanded", "true");
//     closeBtn?.focus?.();
//   }

//   function close() {
//     if (!isOpen()) return;
//     modal.classList.add(hiddenClass);
//     openBtn.setAttribute("aria-expanded", "false");
//     if (lastFocusedEl && typeof lastFocusedEl.focus === "function") {
//       lastFocusedEl.focus();
//     } else {
//       openBtn.focus();
//     }
//   }

//   openBtn.setAttribute("aria-controls", "instructionModal");
//   openBtn.setAttribute("aria-expanded", "false");

//   openBtn.addEventListener("click", open);
//   closeBtn?.addEventListener("click", close);
//   backdrop?.addEventListener("click", close);
//   document.addEventListener("keydown", (event) => {
//     if (event.key === "Escape") close();
//   });
// })();

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
          speakGuide(buildVoicePayload("-"));
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

const NEEDLE_TRANSFORM_TRANSLATE = "translate(-50%, -82.5%)";

// Calibrated for the 0-30 A ammeters and 0-410 V voltmeters used in this lab.
const AMMETER_MIN_ANGLE = -69;
const AMMETER_MID_ANGLE = 0;
const AMMETER_MAX_ANGLE = 91.4;

const VOLTMETER_MIN_ANGLE = -76;
const VOLTMETER_MID_ANGLE = 0;
const VOLTMETER_MAX_ANGLE = 86.6;

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

// Piecewise linear mapping: [minValue..midValue] -> [minAngle..midAngle], [midValue..maxValue] -> [midAngle..maxAngle]
function valueToMeterAngle(value, { minValue, midValue, maxValue, minAngle, midAngle, maxAngle }) {
  const v = clamp(Number(value) || 0, minValue, maxValue);

  if (v <= midValue) {
    const t = (v - minValue) / (midValue - minValue || 1);
    return minAngle + (midAngle - minAngle) * t;
  } else {
    const t = (v - midValue) / (maxValue - midValue || 1);
    return midAngle + (maxAngle - midAngle) * t;
  }
}

function currentToAngle(currentValue) {
  // Ammeter artwork: 0-30 A with 15 at top center
  return valueToMeterAngle(currentValue, {
    minValue: 0,
    midValue: 15,
    maxValue: 30,
    minAngle: AMMETER_MIN_ANGLE,
    midAngle: AMMETER_MID_ANGLE,
    maxAngle: AMMETER_MAX_ANGLE
  });
}

function voltageToAngle(voltageValue) {
  // Voltmeter artwork: 0-410 V with 180 at top center (compressed right span).
  return valueToMeterAngle(voltageValue, {
    minValue: 0,
    midValue: 180,
    maxValue: 410,
    minAngle: VOLTMETER_MIN_ANGLE,
    midAngle: VOLTMETER_MID_ANGLE,
    maxAngle: VOLTMETER_MAX_ANGLE
  });
}
 
(function initObservations() {
  const sessionStartMs = Date.now();
  const sessionStart =
    typeof window.sessionStart === "number" ? window.sessionStart : sessionStartMs;
  if (typeof window.sessionStart !== "number") {
    window.sessionStart = sessionStart;
  }
  if (typeof window.labTracking?.markSimulationStart === "function") {
    window.labTracking.markSimulationStart(sessionStart);
  }
  const minGraphPoints = 6;
  const lampSelect = document.getElementById("number");
  const bulbs = Array.from(document.querySelectorAll(".lamp-bulb"));

  const observationBody = document.getElementById("observationBody");
  const graphBars = document.getElementById("graphBars");
  const graphPlot = document.getElementById("graphPlot");
  const graphSection = document.querySelector(".graph-section");
  const graphCanvas = document.querySelector(".graph-canvas");

  const addTableBtn =
    findButtonByLabel("Add Table") ||
    findButtonByLabel("Add To Table") ||
    findButtonByLabel("Add");
  const graphBtn = findButtonByLabel("Graph");
  const resetBtn = findButtonByLabel("Reset");
  const printBtn = findButtonByLabel("Print");
  const reportBtn = findButtonByLabel("Report");
[addTableBtn, graphBtn, resetBtn, printBtn, reportBtn].forEach((btn) => {
  if (btn) btn.setAttribute("type", "button");
});

// Stop Enter key from submitting while editing the observation table
document.addEventListener("keydown", (e) => {
  const inObservationTable = e.target && e.target.closest && e.target.closest("#observationTable");
  if (inObservationTable && e.key === "Enter") {
    e.preventDefault();
  }
});
  const needle1 = document.querySelector(".meter-needle1"); // Ammeter-1 (motor current)
  const needle2 = document.querySelector(".meter-needle2"); // Ammeter-2 (load current)
  const needle3 = document.querySelector(".meter-needle3"); // Voltmeter-1 (supply voltage)
  const needle4 = document.querySelector(".meter-needle4"); // Voltmeter-2 (terminal voltage)
  const needleMotionState = new WeakMap();
  const needleMotionConfig = {
    stiffness: 240,
    damping: 28,
    maxVelocity: 500,
    restDelta: 0.08,
    restVelocity: 0.08,
    maxFrameSeconds: 0.05
  };
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Reading sets pulled from the legacy implementation
  const ammeter1Readings = [3, 3.6, 5.4, 6.8, 8, 10, 11.5, 13, 14.2, 15.2];
  const voltmeter1Readings = [225, 225, 225, 225, 225, 225, 225, 225, 225, 225];
  const ammeter2Readings = [1.2, 2.8, 3.2, 3.6, 5.5, 7, 8.1, 10.2, 11, 12.7];
  const voltmeter2Readings = [220, 212, 208, 205, 200, 195, 189, 184, 179, 176];
  // Optional manual needle angles (degrees) per bulb index; edit as needed.
  const ammeter1ManualAngles = [-58.5, -55.4, -46.1, -41, -34.8, -26.2, -18.6, -11, -2.5, 2];
  const ammeter2ManualAngles = [-63.1, -58.9, -57, -54.9, -46.8, -38.7, -33.8, -24.0, -20, -13];
  // Override voltmeter-1 dial to land on ~225 V once starter is on.
  const voltmeter1ManualAngles = [5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5];
  const voltmeter2ManualAngles = [3, 1, -1, -3, -5, -7.8, -10, -13, -17, -20];
  const GRAPH_TITLE_TEXT = "Terminal Voltage (V) vs Load Current (A)";
  const GRAPH_X_AXIS_LABEL = "Load Current (A)";
  const GRAPH_Y_AXIS_LABEL = "Terminal Voltage (V)";
  const GRAPH_X_TICK_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];

  const readingsRecorded = [];
  let selectedIndex = -1;
  let readingArmed = false;
  let addReadingAlertShown = false;
  let graphReadyAnnounced = false;
  let graphPlotAlertShown = false;
  let graphPlotted = false;
  let allReadingsAlertShown = false;

  function speechIsActive() {
    return (
      typeof window !== "undefined" &&
      window.labSpeech &&
      typeof window.labSpeech.isActive === "function" &&
      window.labSpeech.isActive()
    );
  }

  function speak(input) {
    const payload = input;
    const text = getSpeechText(payload);
    const hasKeyedPayload =
      payload && typeof payload === "object" && !Array.isArray(payload) && !!payload.key;
    if ((!text && !hasKeyedPayload) || !speechIsActive()) return;
    if (window.labSpeech && typeof window.labSpeech.say === "function") {
      window.labSpeech.say(payload, { interruptFirst: true });
    }
  }

  function speakOrAlert(input) {
    const text = getSpeechText(input);
    if (!text) return;
    if (speechIsActive()) speak(input);
    else showPopup(text);
  }

  function updateGraphControls() {
    const enoughReadings = readingsRecorded.length >= minGraphPoints;
    if (graphBtn) graphBtn.disabled = !enoughReadings;
    if (reportBtn) reportBtn.disabled = !enoughReadings || !graphPlotted;
  }

  function enforceReady(action) {
    if (!connectionsVerified) {
      speakOrAlert(buildVoicePayload("please_check_connections_first"));
      if (action === "lampSelect" && lampSelect) {
        lampSelect.value = "";
        selectedIndex = -1;
        readingArmed = false;
        updateBulbs(0);
        updateNeedles(-1);
      }
      return false;
    }
    if (!mcbOn) {
      speakOrAlert(buildVoicePayload("please_turn_on_mcb"));
      return false;
    }
    if (!starterMoved) {
      speakOrAlert(buildVoicePayload("please_move_starter"));
      return false;
    }
    return true;
  }

  function applyNeedleRotation(el, angleDeg) {
    el.style.transform = `${NEEDLE_TRANSFORM_TRANSLATE} rotate(${angleDeg}deg)`;
  }

  function getNeedleState(el, initialAngle) {
    let state = needleMotionState.get(el);
    if (state) return state;

    state = {
      currentAngle: initialAngle,
      targetAngle: initialAngle,
      velocity: 0,
      lastTime: 0,
      rafId: null
    };
    needleMotionState.set(el, state);
    applyNeedleRotation(el, initialAngle);
    return state;
  }

  function startNeedleAnimation(el, state) {
    if (state.rafId !== null) return;

    const step = (timestamp) => {
      if (!state.lastTime) {
        state.lastTime = timestamp;
      }

      const dt = Math.min((timestamp - state.lastTime) / 1000, needleMotionConfig.maxFrameSeconds);
      state.lastTime = timestamp;

      const angleError = state.targetAngle - state.currentAngle;
      const acceleration =
        needleMotionConfig.stiffness * angleError - needleMotionConfig.damping * state.velocity;
      state.velocity = clamp(
        state.velocity + acceleration * dt,
        -needleMotionConfig.maxVelocity,
        needleMotionConfig.maxVelocity
      );
      state.currentAngle += state.velocity * dt;
      applyNeedleRotation(el, state.currentAngle);

      const isSettled =
        Math.abs(state.targetAngle - state.currentAngle) <= needleMotionConfig.restDelta &&
        Math.abs(state.velocity) <= needleMotionConfig.restVelocity;
      if (isSettled) {
        state.currentAngle = state.targetAngle;
        state.velocity = 0;
        state.lastTime = 0;
        state.rafId = null;
        applyNeedleRotation(el, state.currentAngle);
        return;
      }

      state.rafId = window.requestAnimationFrame(step);
    };

    state.rafId = window.requestAnimationFrame(step);
  }

  function setNeedleRotation(el, angleDeg) {
    if (!el) return;

    const targetAngle = Number.isFinite(angleDeg) ? angleDeg : 0;
    if (prefersReducedMotion || typeof window.requestAnimationFrame !== "function") {
      applyNeedleRotation(el, targetAngle);
      return;
    }

    const state = getNeedleState(el, targetAngle);
    state.targetAngle = targetAngle;
    startNeedleAnimation(el, state);
  }

  // Show supply voltage as soon as the starter handle is moved to ON.
  window.addEventListener(STARTER_MOVED_EVENT, () => {
    if (!needle3) return;
    // Use the same calibrated/manual angle used during readings.
    const starterAngle = resolveAngle(voltmeter1ManualAngles, 0, voltageToAngle(225));
    setNeedleRotation(needle3, starterAngle);
  });

  // Park voltmeter-1 when the MCB is turned off.
  window.addEventListener(MCB_TURNED_OFF_EVENT, () => {
    if (!needle3) return;
    setNeedleRotation(needle3, voltageToAngle(0));
  });

  function resolveAngle(manualAngles, idx, fallbackAngle) {
    const manual = manualAngles && Number.isFinite(manualAngles[idx]) ? manualAngles[idx] : null;
    return Number.isFinite(manual) ? manual : fallbackAngle;
  }

  function updateBulbs(count) {
    bulbs.forEach((bulb, idx) => {
      const isOn = idx < count;
      bulb.src = isOn ? "../images/on-bulb.png" : "../images/off-bulb.png";
      bulb.classList.toggle("on", isOn);
      bulb.classList.toggle("off", !isOn);
    });
  }

  /* ✅ REPLACED: calibrated updateNeedles() (uses global currentToAngle/voltageToAngle) */
  function updateNeedles(idx) {
    const safeIdx = Number.isFinite(idx) ? idx : -1;

    if (safeIdx < 0) {
      // park needles at 0
      setNeedleRotation(needle1, currentToAngle(0));
      setNeedleRotation(needle2, currentToAngle(0));
      setNeedleRotation(needle3, voltageToAngle(0));
      setNeedleRotation(needle4, voltageToAngle(0));
      return;
    }

    setNeedleRotation(
      needle1,
      resolveAngle(ammeter1ManualAngles, safeIdx, currentToAngle(ammeter1Readings[safeIdx]))
    );
    setNeedleRotation(
      needle2,
      resolveAngle(ammeter2ManualAngles, safeIdx, currentToAngle(ammeter2Readings[safeIdx]))
    );
    setNeedleRotation(
      needle3,
      resolveAngle(voltmeter1ManualAngles, safeIdx, voltageToAngle(voltmeter1Readings[safeIdx]))
    );
    setNeedleRotation(
      needle4,
      resolveAngle(voltmeter2ManualAngles, safeIdx, voltageToAngle(voltmeter2Readings[safeIdx]))
    );
  }

  /* ===== everything below remains SAME as your current code ===== */

  function renderGraph() {
    if (readingsRecorded.length < minGraphPoints) {
      speakOrAlert(`Please take at least ${minGraphPoints} readings in the table.`);
      return;
    }
    graphPlotted = false;

    const currents = readingsRecorded.map(r => r.current);
    const voltages = readingsRecorded.map(r => r.voltage);

    function ensurePlotly() {
      if (window.Plotly) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.plot.ly/plotly-3.0.1.min.js";
        script.onload = () => resolve();
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    ensurePlotly()
      .then(() => {
        if (!graphPlot) return;

        const trace = {
          x: currents,
          y: voltages,
          mode: "lines+markers",
          type: "scatter",
          name: GRAPH_TITLE_TEXT,
          marker: { color: "#1b6fb8", size: 8 },
          line: { color: "#1b6fb8", width: 3 }
        };
        const layout = {
          title: { text: `<b>${GRAPH_TITLE_TEXT}</b>` },
          margin: { l: 60, r: 20, t: 40, b: 50 },
          xaxis: {
            title: `<b>${GRAPH_X_AXIS_LABEL}</b>`,
            gridcolor: "rgba(0, 0, 0, 0.07)",
            tickmode: "array",
            tickvals: GRAPH_X_TICK_VALUES
          },
          yaxis: { title: `<b>${GRAPH_Y_AXIS_LABEL}</b>`, gridcolor: "rgba(0, 0, 0, 0.07)" },
          paper_bgcolor: "rgba(0,0,0,0)",
          plot_bgcolor: "rgba(0,0,0,0)"
        };

        if (graphBars) graphBars.style.display = "none";
        graphPlot.style.display = "block";
        if (graphCanvas) graphCanvas.classList.add("is-plotting");

        window.Plotly.newPlot(graphPlot, [trace], layout, { displaylogo: false, responsive: true });
        graphPlotted = true;
        window.labTracking?.recordStep?.("Graph plotted");
        stepGuide.complete("graph");
        updateGraphControls();
        if (!graphPlotAlertShown) {
          graphPlotAlertShown = true;
          showPopup("Graph plotted. You can now generate the report.", "Graph Ready");
        }
        speak(buildVoicePayload("graph_complete"));
      })
      .catch(() => {
        graphPlotted = false;
        showPopup("Unable to load graphing library. Please check your connection and try again.", "Graph Error");
      });
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function generateReport() {
    const tableEl = document.getElementById("observationTable");
    if (!tableEl) {
      speakOrAlert("Report table not found.");
      return;
    }
    if (!graphPlotted) {
      speakOrAlert("Please plot the graph before generating the report.");
      return;
    }

    const rows = Array.from(tableEl.rows || []);
    const observationRows = [];
    const currentValues = [];
    const voltageValues = [];

    rows.slice(1).forEach((row) => {
      const cells = Array.from(row.cells);
      if (cells.length >= 3) {
        const entry = {
          sNo: cells[0].textContent.trim() || (observationRows.length + 1),
          current: cells[1].textContent.trim(),
          voltage: cells[2].textContent.trim()
        };
        observationRows.push(entry);
        const cVal = parseFloat(entry.current);
        const vVal = parseFloat(entry.voltage);
        if (!Number.isNaN(cVal)) currentValues.push(cVal);
        if (!Number.isNaN(vVal)) voltageValues.push(vVal);
      }
    });

    const now = new Date();
    const reportDateText = now.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
    // Ensure all relative assets resolve correctly inside the new report window and in html2canvas.
    const baseHref =
      (() => {
        try {
          const link = document.createElement("a");
          link.href = window.location.href;
          // strip file name, keep trailing slash
          link.pathname = link.pathname.replace(/[^/]*$/, "");
          return link.href;
        } catch (e) {
          return document.baseURI || window.location.href;
        }
      })();
    const logoLeftSrc = new URL("../images/IIT Logo.png", baseHref).toString();
    const logoRightSrc = new URL("../images/image.png", baseHref).toString();
    const css = `
body {
  font-family: 'Inter', 'Segoe UI', sans-serif;
  background: linear-gradient(180deg, #eef4fb 0%, #f7f9fc 100%);
  color: #1f2d3d;
  margin: 0;
  padding: 30px 22px 44px;
  line-height: 1.65;
  overflow-wrap: break-word;
}
*,
*::before,
*::after {
  box-sizing: border-box;
}
.report-page {
  width: min(100%, 960px);
  margin: 0 auto 24px;
  padding: clamp(24px, 3vw, 34px);
  background-color: #ffffff;
  border-radius: 18px;
  border: 1px solid #d3ddea;
  box-shadow: 0 18px 38px rgba(23, 50, 77, 0.12);
  break-inside: auto;
  page-break-inside: auto;
  overflow: visible;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
  background-clip: padding-box;
}
.report-page:last-of-type { margin-bottom: 0; }
.report-page--results {
  break-before: auto;
  page-break-before: auto;
}
h1, h2, h3 { color: #1f2d3d; margin-top: 0; font-weight: 700; }
h1 {
  font-size: 32px;
  margin: 0;
  padding: 0;
  line-height: 1.15;
}
h2 { font-size: 23px; margin-bottom: 16px; color: #243b53; }
h3 { font-size: 17px; margin-bottom: 10px; color: #2d4b68; }
p { margin: 0 0 12px; }
li { margin-bottom: 6px; }
.section {
  background: linear-gradient(180deg, #f9fbfe 0%, #f4f7fb 100%);
  padding: clamp(18px, 2.5vw, 24px);
  margin-bottom: 20px;
  border-radius: 14px;
  border: none;
  box-shadow: none;
  break-inside: avoid-page;
  page-break-inside: avoid;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
  background-clip: padding-box;
}
.section:last-child { margin-bottom: 0; }
.section > h2:first-child {
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #e1e9f3;
}
.label { font-weight: 600; color: #1f2d3d; }
ul { padding-left: 20px; margin: 10px 0 0; }
.two-column-list {
  column-count: 2;
  column-gap: 32px;
  list-style-position: inside;
  margin-top: 10px;
}
.report-overview-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.report-stamp {
  margin: 0;
  padding: 8px 12px;
  border-radius: 999px;
  background: #ffffff;
  border: none;
  color: #50657c;
  font-size: 13px;
  font-weight: 600;
}
.report-experiment-label {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #60778f;
  font-weight: 700;
}
.report-experiment-title {
  margin: 0 0 18px;
  font-size: 25px;
  line-height: 1.3;
  font-weight: 700;
  color: #16324b;
}
.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
  margin-top: 12px;
}
.info-card {
  background: #fff;
  border: none;
  border-radius: 10px;
  padding: 12px 14px;
  box-shadow: none;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  gap: 4px;
}
.table-shell {
  display: block;
  width: 100%;
  align-self: stretch;
  overflow-x: auto;
  overflow-y: visible;
  border: none;
  border-radius: 12px;
  max-width: 100%;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
  background-clip: padding-box;
  background: #ffffff;
  box-shadow: none;
}
table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 0;
  box-shadow: none;
  background-color: white;
  table-layout: auto;
}
th, td {
  border: 1px solid #d9e2ec;
  padding: 12px;
  text-align: center;
  font-size: 15px;
  vertical-align: middle;
  overflow-wrap: anywhere;
  word-break: break-word;
}
th {
  background: linear-gradient(135deg, #2f7bfa 0%, #1f62d0 100%);
  border-color: #c6d7ec;
  border-bottom-color: #b4cae5;
  color: white;
  font-weight: 700;
  letter-spacing: 0.2px;
}
thead { display: table-header-group; }
tbody { display: table-row-group; }
tr {
  break-inside: avoid-page;
  page-break-inside: avoid;
}
tr:nth-child(even) { background-color: #f8fbff; }
.results-stack {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 18px;
  align-items: start;
}
.results-card {
  background: #ffffff;
  border: none;
  border-radius: 14px;
  padding: 18px;
  box-shadow: none;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow: visible;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
  background-clip: padding-box;
}
.results-card h3 {
  margin: 0;
  text-align: left;
  padding-bottom: 0;
  border-bottom: none;
}
.results-card--table {
  break-inside: auto;
  page-break-inside: auto;
}
.results-card--graph {
  break-inside: avoid-page;
  page-break-inside: avoid;
}
.compact-table {
  margin-top: 0;
}
.compact-table th,
.compact-table td {
  padding: 10px 12px;
  font-size: 14px;
}
.compact-table th:first-child,
.compact-table td:first-child {
  width: 18%;
}
.graph {
  text-align: center;
  margin-top: 0;
}
.report-graph-card {
  padding: 18px;
}
.report-graph-card #report-graph {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 100%;
  min-height: 0;
  aspect-ratio: 16 / 7;
  background: linear-gradient(180deg, #f8fbfe 0%, #eef5fb 100%);
  border: none;
  border-radius: 12px;
  overflow: hidden;
  -webkit-box-decoration-break: slice;
  box-decoration-break: slice;
  background-clip: padding-box;
  box-shadow: none;
}
.pdf-exporting .report-page {
  border-color: transparent !important;
  box-shadow: none !important;
}
.pdf-exporting .section,
.pdf-exporting .results-card,
.pdf-exporting .table-shell,
.pdf-exporting .report-graph-card #report-graph {
  -webkit-box-decoration-break: slice !important;
  box-decoration-break: slice !important;
}
.report-graph-card #report-graph > * {
  max-width: 100%;
}
.report-graph-card #report-graph img,
.report-graph-card #report-graph canvas,
.report-graph-card #report-graph svg {
  display: block;
  width: 100% !important;
  max-width: 100%;
  height: auto !important;
}
.report-graph-card #report-graph em {
  color: #5e738c;
  font-style: normal;
  font-weight: 600;
}
.header-row {
  display: grid;
  grid-template-columns: 108px minmax(0, 1fr) 108px;
  align-items: center;
  gap: 20px;
  margin-bottom: 24px;
  break-inside: avoid-page;
  page-break-inside: avoid;
}
.report-title-block {
  text-align: center;
  margin: 0;
  padding-bottom: 14px;
  border-bottom: 3px solid #2f7bfa;
  min-width: 0;
}
.report-kicker:empty,
.report-subtitle:empty {
  display: none;
}
.report-kicker {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #5d7794;
  font-weight: 700;
}
.report-subtitle {
  margin: 8px 0 0;
  font-size: 14px;
  color: #5c6f84;
}
.badge {
  margin: 0;
  padding: 8px 14px;
  border-radius: 20px;
  background: #e8f1ff;
  color: #1f62d0;
  font-weight: 600;
  font-size: 13px;
}
.vl-logo {
  height: auto;
  width: auto;
  max-width: 120px;
  max-height: 84px;
  object-fit: contain;
  flex-shrink: 0;
  justify-self: center;
}
.report-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  width: min(100%, 960px);
  margin: 28px auto 0;
}
.print-btn,
.download-btn {
  padding: 12px 24px;
  font-size: 15px;
  border: none;
  border-radius: 30px;
  color: white;
  cursor: pointer;
  transition: all 0.25s ease;
}
.print-btn {
  background: linear-gradient(to right, #2f7bfa, #1f62d0);
}
.download-btn {
  background: linear-gradient(to right, #28a745, #1f8d38);
}
.print-btn:hover,
.download-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 14px rgba(31,45,61,0.12);
}
@media (max-width: 768px) {
  body {
    padding: 20px 14px 30px;
  }
  .report-page {
    margin-bottom: 18px;
    padding: 20px 18px;
    border-radius: 16px;
  }
  .header-row {
    grid-template-columns: 1fr;
    gap: 14px;
    text-align: center;
  }
  .report-title-block {
    padding-bottom: 12px;
  }
  .vl-logo {
    max-height: 72px;
  }
  .two-column-list {
    column-count: 1;
    column-gap: 0;
  }
  .compact-table th,
  .compact-table td {
    padding: 9px 8px;
    font-size: 13px;
  }
  .report-actions {
    justify-content: center;
  }
  .report-graph-card #report-graph {
    aspect-ratio: 4 / 3;
  }
}
@media print {
  @page {
    size: A4;
    margin: 12mm;
  }
  .print-btn,
  .download-btn,
  .report-actions { display:none; }
  body { margin:0; padding:0; background:#ffffff; }
  .report-page {
    width: 100%;
    margin: 0 0 12px;
    padding: 20px 22px;
    border: none;
    box-shadow: none;
    border-radius: 0;
  }
  .header-row {
    grid-template-columns: 96px minmax(0, 1fr) 96px;
    gap: 16px;
  }
  .report-experiment-title {
    font-size: 22px;
  }
  .report-graph-card #report-graph {
    aspect-ratio: 16 / 8;
  }
  .section,
  .results-card,
  .table-shell,
  .report-graph-card #report-graph {
    overflow: visible;
  }
  .section,
  .header-row,
  .info-grid,
  .results-card--graph,
  .graph,
  thead,
  tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }
}
    `;

    const startTimeText = new Date(sessionStart).toLocaleTimeString();
    const endTime = Date.now();
    const endTimeText = new Date(endTime).toLocaleTimeString();
    const durationMs = Math.max(0, endTime - sessionStart);
    const durationTotalSeconds = Math.floor(durationMs / 1000);
    const durationMinutes = Math.floor(durationTotalSeconds / 60);
    const durationSeconds = durationTotalSeconds % 60;
    const durationText = `${durationMinutes} min ${String(durationSeconds).padStart(2, "0")} sec`;
    if (typeof window.labTracking?.markSimulationEnd === "function") {
      window.labTracking.markSimulationEnd(endTime);
    }
    window.labTracking?.recordStep?.("Simulation report generated");

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Simulation Report</title>
  <base href="${baseHref}">
  <style>${css}</style>
  <script src="https://cdn.plot.ly/plotly-3.0.1.min.js"></script>
</head>
<body id="report-root">
  <div class="report-page">
    <div class="header-row">
      <img src="${logoLeftSrc}" class="vl-logo" />
      <div class="report-title-block">
       
        <h2>Virtual Labs Simulation Report</h2>
      
      </div>
      <img src="${logoRightSrc}" class="vl-logo" />
    </div>

    <div class="section report-overview">
      <div class="report-overview-top">
        <p class="badge">Electrical Machines Lab</p>
        <p class="report-stamp">Generated on ${reportDateText}</p>
      </div>
      <p class="report-experiment-label">Experiment Title</p>
      <p class="report-experiment-title">To Study the Load Characteristics of a DC Shunt Generator</p>
      <div class="info-grid">
          <div class="info-card"><span class="label">Start Time:</span><br>${startTimeText}</div>
          <div class="info-card"><span class="label">End Time:</span><br>${endTimeText}</div>
          <div class="info-card"><span class="label">Total Time Spent:</span><br>${durationText}</div>
        </div>
      </div>

    <div class="section">
      <h2>Summary</h2>
      <h3>Aim</h3>
      <p style="text-align:justify;">To study the load characteristics of a DC shunt generator by varying the lamp load, measuring terminal voltage and load current, and plotting the V-I characteristic curve.</p>

      <h3>Simulation Summary</h3>
      <p style="text-align:justify;">The circuit connections were completed as per the procedure. The supply was switched on, the lamp load was varied step by step, the corresponding load current and terminal voltage readings were recorded, and the load characteristic graph was plotted.</p>

      <h3>Components and Key Parameters</h3>
      <ul class="two-column-list">
        <li>MCB</li>
        <li>3-Point Starter: 220 V DC, 7.5 HP</li>
        <li>DC Shunt Motor: 5 HP, 220 V DC, 19 A (max), 1500 RPM</li>
        <li>DC Shunt Generator: 3 kW, 220 V DC, 1500 RPM</li>
        <li>Load Type: Resistive Lamp Load</li>
        <li>Bulbs: 10 x 200 W each</li>
        <li>DC Voltmeter: 0-420 V</li>
        <li>DC Ammeter: 0-30 A</li>
        <li>Connecting Leads</li>
      </ul>
    </div>
  </div>

  <div class="report-page report-page--results">
    <div class="section results-section">
      <h2>Results</h2>
      <div class="results-stack">
        <div class="results-card results-card--table">
          <h3>Observation Table</h3>
          <div class="table-shell">
            <table class="compact-table">
              <colgroup>
                <col style="width:18%">
                <col style="width:41%">
                <col style="width:41%">
              </colgroup>
              <thead>
                <tr><th>S.No.</th><th>Load Current (A)</th><th>Terminal Voltage (V)</th></tr>
              </thead>
              <tbody>
                ${observationRows.length ? observationRows.map(function (r) {
                    return "<tr><td>" + r.sNo + "</td><td>" + r.current + "</td><td>" + r.voltage + "</td></tr>";
                }).join("") : "<tr><td colspan='3'>No readings recorded.</td></tr>"}
              </tbody>
            </table>
          </div>
        </div>

        <div class="graph report-graph-card results-card results-card--graph">
          <h3>Graph</h3>
          <div id="report-graph"></div>
        </div>
      </div>
    </div>
  </div>

  <div class="report-actions" data-html2canvas-ignore="true">
    <button class="print-btn" onclick="window.print()">PRINT</button>
    <button class="download-btn" onclick="downloadReport()">DOWNLOAD</button>
  </div>

  <script>
    (function() {
      var currents = ${JSON.stringify(currentValues)};
      var voltages = ${JSON.stringify(voltageValues)};
      var graphTitle = ${JSON.stringify(GRAPH_TITLE_TEXT)};
      var graphXAxisLabel = ${JSON.stringify(GRAPH_X_AXIS_LABEL)};
      var graphYAxisLabel = ${JSON.stringify(GRAPH_Y_AXIS_LABEL)};
      var graphXTickValues = ${JSON.stringify(GRAPH_X_TICK_VALUES)};
      var graphContainer = document.getElementById('report-graph');
      var graphReady = Promise.resolve();

      if (currents.length && voltages.length) {
         var trace = { x: currents, y: voltages, type: 'scatter', mode: 'lines+markers', name: graphTitle, line: { color: '#3498db' } };
        var layout = {
          autosize: true,
          title: { text: '<b>' + graphTitle + '</b>' },
          xaxis: {
            title: { text: '<b>' + graphXAxisLabel + '</b>', standoff: 12 },
            automargin: true,
            tickmode: 'array',
            tickvals: graphXTickValues
          },
          yaxis: { title: { text: '<b>' + graphYAxisLabel + '</b>', standoff: 12 }, automargin: true },
          margin: { t: 70, r: 30, l: 80, b: 70 }
        };
        graphReady = Plotly.newPlot('report-graph', [trace], layout, {displaylogo:false, responsive:true}).then(function(gd) {
          return Plotly.toImage(gd, {format:'png', width: gd.offsetWidth || 900, height: gd.offsetHeight || 360});
        }).then(function(imgData) {
          var img = new Image();
          img.src = imgData;
          img.alt = graphTitle;
          img.style.display = 'block';
          img.style.width = '100%';
          img.style.maxWidth = '100%';
          img.style.height = 'auto';
          img.style.borderRadius = '10px';
          graphContainer.innerHTML = '';
          graphContainer.appendChild(img);
        }).catch(function() {
          // keep the interactive graph if snapshot fails
        });
      } else {
        graphContainer.innerHTML = '<em>No readings available to plot.</em>';
      }

      window.reportGraphReady = graphReady;
    })();
    function ensureHtml2Pdf() {
      return new Promise(function(resolve, reject) {
        if (window.html2pdf) return resolve();
        var script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }
    function downloadReport() {
      var waitForGraph = window.reportGraphReady || Promise.resolve();
      waitForGraph.then(ensureHtml2Pdf).then(function() {
        var element = document.getElementById('report-root') || document.body;
        var opts = {
          margin: [0.3, 0.3, 0.3, 0.3],
          filename: 'simulation-report.pdf',
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: {
            scale: 2.2,
            useCORS: true,
            scrollX: 0,
            scrollY: 0,
            onclone: function(clonedDoc) {
              clonedDoc.body.classList.add('pdf-exporting');
            }
          },
          jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' },
          pagebreak: {
            mode: ['css', 'legacy'],
            avoid: ['.header-row', '.report-overview', '.info-grid', '.results-card--graph', 'thead', 'tr']
          }
        };
        return window.html2pdf().set(opts).from(element).save();
      }).catch(function() {
        alert('Unable to download the report automatically. Please use your browser\\'s Save as PDF option.');
      });
    }
</script>
</body>
</html>`;

    try {
      const stamp = String(Date.now());
      localStorage.setItem("vlab_exp2_simulation_report_html", html);
      localStorage.setItem("vlab_exp2_simulation_report_updated_at", stamp);
      const activeHash = localStorage.getItem("vlab_exp2_active_user_hash");
      if (activeHash) {
        localStorage.setItem(`vlab_exp2_user_${activeHash}_simulation_report_html`, html);
        localStorage.setItem(`vlab_exp2_user_${activeHash}_simulation_report_updated_at`, stamp);
      }
    } catch (e) {}

    const reportWindow = window.open("", "report");
    if (!reportWindow) {
      speakOrAlert("Please allow pop-ups to view the report.");
      return;
    }

    try {
      reportWindow.document.open("text/html", "replace");
      reportWindow.document.write(html);
      reportWindow.document.close();
      reportWindow.focus();
    } catch (err) {
      try {
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        reportWindow.location = url;
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 5000);
      } catch (err2) {
        console.error("Report generation failed:", err2);
        speakOrAlert("Unable to render the report. Please disable popup blockers and try again.");
      }
    }
  }

  function handleReportClick() {
    if (!graphPlotted) {
      speakOrAlert("Please plot the graph before generating the report.");
      return;
    }
    showPopup(
      getSpeechText(buildVoicePayload("report_ready")),
      "Report Ready"
    );
    if (speechIsActive()) {
      speak(buildVoicePayload("report_ready"));
    }
    waitForWarningModalAcknowledgement().then(() => {
      generateReport();
    });
  }

  function addRowToTable(idx) {
    if (!observationBody) return;
    const placeholder = observationBody.querySelector(".placeholder-row");
    if (placeholder) placeholder.remove();

    const row = document.createElement("tr");
    const serial = readingsRecorded.length; // already includes new entry
    const a2 = ammeter2Readings[idx];
    const v2 = voltmeter2Readings[idx];

    row.innerHTML = `<td>${serial}</td><td>${a2}</td><td>${v2}</td>`;
    observationBody.appendChild(row);
  }

  function handleAddReading() {
    if (!enforceReady("addReading")) return;
    if (selectedIndex < 0) {
      speakOrAlert(buildVoicePayload("before_add_table_select_bulbs"));
      return;
    }
    if (!readingArmed) {
      speakOrAlert(buildVoicePayload("duplicate_reading"));
      return;
    }
    if (readingsRecorded.length >= 10) {
      speakOrAlert(buildVoicePayload("max_readings"));
      return;
    }

    const load = selectedIndex + 1;
    if (readingsRecorded.some((reading) => reading.load === load)) {
      showPopup(
        getSpeechText(buildVoicePayload("duplicate_reading")),
        "Duplicate Reading"
      );
      if (speechIsActive()) {
        speak(buildVoicePayload("duplicate_reading"));
      }
      readingArmed = false;
      return;
    }

    readingsRecorded.push({
      load,
      current: ammeter2Readings[selectedIndex],
      voltage: voltmeter2Readings[selectedIndex]
    });
    window.labTracking?.recordStep?.(`Reading added (Load ${load})`);

    addRowToTable(selectedIndex);
    graphPlotted = false;
    if (!addReadingAlertShown) {
      addReadingAlertShown = true;
      showPopup("Reading added to the observation table.", "Observation");
      speak(buildVoicePayload("reading_added"));
    }
    if (!allReadingsAlertShown && readingsRecorded.length === 10) {
      allReadingsAlertShown = true;
      showPopup(
        "All 10 readings have been recorded. Now, plot the graph and then click on the report button to generate your report.",
        "All Readings Added"
      );
      speak(buildVoicePayload("after_ten_readings_done"));
    }
    readingArmed = false;
    stepGuide.complete("reading");

    updateGraphControls();

    if (readingsRecorded.length < minGraphPoints) {
      speak(buildVoicePayload("after_first_reading_added"));
    } else if (readingsRecorded.length >= minGraphPoints && readingsRecorded.length < 10) {
      speak(buildVoicePayload("graph_or_more_readings"));
    }

    if (!graphReadyAnnounced && readingsRecorded.length >= minGraphPoints) {
      graphReadyAnnounced = true;
      showPopup(
        "You have added 6 readings. Now you can plot the graph.",
        "Graph Ready"
      );
    }
  }

  function handleSelectionChange() {
    if (!enforceReady("lampSelect")) {
      lampSelect.value = "";
      selectedIndex = -1;
      readingArmed = false;
      updateBulbs(0);
      updateNeedles(-1);
      return;
    }

    const count = parseInt(lampSelect.value, 10);
    if (isNaN(count) || count < 1 || count > 10) {
      selectedIndex = -1;
      readingArmed = false;
      updateBulbs(0);
      updateNeedles(-1);
      return;
    }

    selectedIndex = count - 1;
    readingArmed = true;

    updateBulbs(count);
    updateNeedles(selectedIndex);

    if (readingsRecorded.length === 0) {
      speak(buildVoicePayload("first_reading_selected"));
    } else {
      speak(buildVoicePayload("second_reading"));
    }
  }

  function resetObservations() {
    const wasGuiding =
      typeof window.isGuideActive === "function" && window.isGuideActive();

    if (window.labSpeech && typeof window.labSpeech.stop === "function") {
      window.labSpeech.stop();
    }

    if (wasGuiding && window.labSpeech && typeof window.labSpeech.speak === "function") {
      window.labSpeech.speak(buildVoicePayload("reset"), {
        onend: () => {
          if (typeof window.stopGuideSpeech === "function") {
            window.stopGuideSpeech();
          } else {
            resetSpeakButtonUI();
          }
        }
      });
    } else {
      resetSpeakButtonUI();
      if (typeof window.stopGuideSpeech === "function") {
        window.stopGuideSpeech();
      }
    }

    if (window.jsPlumb) {
      if (typeof jsPlumb.deleteEveryConnection === "function") jsPlumb.deleteEveryConnection();
      else if (typeof jsPlumb.getAllConnections === "function") jsPlumb.getAllConnections().forEach(c => jsPlumb.deleteConnection(c));
      if (typeof jsPlumb.repaintEverything === "function") jsPlumb.repaintEverything();
    }

    readingsRecorded.length = 0;
    addReadingAlertShown = false;
    graphReadyAnnounced = false;
    graphPlotAlertShown = false;
    graphPlotted = false;
    allReadingsAlertShown = false;

    // Re-enable primary controls after reset
    const resetCheckBtn = findButtonByLabel("Check") || findButtonByLabel("Check Connections");
    if (resetCheckBtn) resetCheckBtn.disabled = false;
    const resetAutoBtn = findButtonByLabel("Auto Connect");
    if (resetAutoBtn) {
      resetAutoBtn.disabled = false;
      delete resetAutoBtn.dataset.checkedLocked;
      delete resetAutoBtn.dataset.guideLocked;
    }

    if (observationBody) {
      observationBody.innerHTML = "";
    }

    selectedIndex = -1;
    readingArmed = false;
    if (lampSelect) lampSelect.value = "";

    updateBulbs(0);
    updateNeedles(-1);

    if (graphBars) graphBars.style.display = "block";
    if (graphPlot) {
      graphPlot.innerHTML = "";
      graphPlot.style.display = "none";
    }
    if (graphCanvas) graphCanvas.classList.remove("is-plotting");

    connectionsVerified = false;
    starterMoved = false;
    mcbOn = false;

    sharedControls.setMcbState(false, { silent: true });

    const starter = sharedControls.starterHandle || document.querySelector(".starter-handle");
    if (starter) {
      starter.style.left = "16.67%";
      starter.style.top = "37.04%";
      starter.classList.remove("moved");
    }

    sharedControls.updateControlLocks();
    updateRotorSpin();
    stepGuide.reset();
    updateGraphControls();
    showPopup(getSpeechText(buildVoicePayload("reset")), "Reset");
  }

  if (lampSelect) {
    lampSelect.addEventListener("change", handleSelectionChange);
    lampSelect.disabled = true;
  }

  if (addTableBtn) {
    addTableBtn.addEventListener("click", handleAddReading);
    addTableBtn.disabled = true;
  }

  if (graphBtn) {
    graphBtn.disabled = true;
    graphBtn.addEventListener("click", function () {
      renderGraph();
      if (graphSection && typeof graphSection.scrollIntoView === "function") {
        graphSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  const SIM_PRINT_CONTAINER_ID = "simulation-print-container";
  const SIM_PRINT_ACTIVE_CLASS = "simulation-print-active";
  const SIM_PRINT_CLONE_SCALE = 0.78;
  let printLaunchInProgress = false;

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function waitForNextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function cleanupSimulationPrintContainer() {
    const existing = document.getElementById(SIM_PRINT_CONTAINER_ID);
    if (existing) {
      existing.remove();
    }
    if (document.body) {
      document.body.classList.remove(SIM_PRINT_ACTIVE_CLASS);
    }
  }

  async function waitForPrintAssets(targets) {
    const fontReady =
      document.fonts && typeof document.fonts.ready?.then === "function"
        ? document.fonts.ready.catch(() => {})
        : Promise.resolve();

    const pendingImages = [];
    targets.forEach((target) => {
      if (!target || !target.querySelectorAll) return;
      target.querySelectorAll("img").forEach((img) => {
        if (img.complete) return;
        pendingImages.push(
          new Promise((resolve) => {
            const done = () => resolve();
            img.addEventListener("load", done, { once: true });
            img.addEventListener("error", done, { once: true });
          })
        );
      });
    });

    await Promise.race([Promise.all([fontReady, Promise.all(pendingImages)]), wait(1400)]);
  }

  async function syncPlotlyGraphForPrint(sourceFooter, clonedFooter) {
    const sourcePlot = sourceFooter?.querySelector("#graphPlot");
    const clonedPlot = clonedFooter?.querySelector("#graphPlot");
    if (!sourcePlot || !clonedPlot) return;

    const hasPlotData = Array.isArray(sourcePlot.data) && sourcePlot.data.length > 0;
    if (!hasPlotData) return;
    if (!window.Plotly || typeof window.Plotly.toImage !== "function") return;

    try {
      const rect = sourcePlot.getBoundingClientRect();
      const width = Math.max(420, Math.round(rect.width || sourcePlot.clientWidth || 420));
      const height = Math.max(280, Math.round(rect.height || sourcePlot.clientHeight || 280));
      const dataUrl = await window.Plotly.toImage(sourcePlot, {
        format: "png",
        width,
        height,
        scale: 2
      });

      const plotImage = document.createElement("img");
      plotImage.src = dataUrl;
      plotImage.alt = "Output graph";
      plotImage.className = "print-plot-image";
      clonedPlot.replaceChildren(plotImage);
      clonedPlot.style.display = "block";

      const clonedBars = clonedFooter.querySelector("#graphBars");
      if (clonedBars) clonedBars.style.display = "none";
    } catch (error) {
      console.warn("Print graph export failed; using cloned Plotly DOM output.", error);
    }
  }

  function normalizePrintPanelClone(panelClone) {
    const graphActions = panelClone?.querySelector(".graph-actions");
    if (!graphActions) return;
    // Keep action buttons at their original UI position in the print clone.
    graphActions.classList.remove("print-actions-below-table");
  }

  function freezeMeterLabelPositionsForPrint(sourcePanel, panelClone) {
    const sourceMeters = sourcePanel?.querySelector(".meters");
    const cloneMeters = panelClone?.querySelector(".meters");
    if (!sourceMeters || !cloneMeters) return;

    const meterLabelIds = ["ammter1-label", "voltmeter1-label", "ammter2-label", "voltmeter2-label"];
    const PRINT_LABEL_X_OFFSET = -14;
    const PRINT_LABEL_Y_OFFSET = -6;
    const sourceMetersRect = sourceMeters.getBoundingClientRect();

    meterLabelIds.forEach((labelId) => {
      const sourceLabel = sourcePanel.querySelector(`#${labelId}`);
      const cloneLabel = panelClone.querySelector(`#${labelId}`);
      if (!sourceLabel || !cloneLabel) return;

      const labelRect = sourceLabel.getBoundingClientRect();
      const frozenLeft = Math.round(labelRect.left - sourceMetersRect.left + PRINT_LABEL_X_OFFSET);
      const frozenTop = Math.round(labelRect.top - sourceMetersRect.top + PRINT_LABEL_Y_OFFSET);

      cloneLabel.style.position = "absolute";
      cloneLabel.style.left = `${frozenLeft}px`;
      cloneLabel.style.top = `${frozenTop}px`;
      cloneLabel.style.margin = "0";
      cloneLabel.style.transform = "none";
      cloneLabel.style.gridColumn = "auto";
      cloneLabel.style.gridRow = "auto";
      cloneLabel.style.zIndex = "4";
    });

    cloneMeters.style.position = "relative";
  }

  // Simple print path: clone panel/footer, print clone only, then clean up.
  async function simplePrintSimulation() {
    if (printLaunchInProgress) return;
    printLaunchInProgress = true;

    const panel = document.querySelector(".panel");
    const panelFooter = document.querySelector(".panel-footer");
    if (!panel || !panelFooter || !document.body) {
      printLaunchInProgress = false;
      window.print();
      return;
    }

    if (speechIsActive()) {
      window.labSpeech.speak(buildVoicePayload("print"));
    }

    cleanupSimulationPrintContainer();

    if (window.jsPlumb && typeof window.jsPlumb.repaintEverything === "function") {
      try {
        window.jsPlumb.repaintEverything();
      } catch {}
    }

    await waitForNextFrame();
    await waitForPrintAssets([panel, panelFooter]);
    await wait(60);

    const panelRect = panel.getBoundingClientRect();
    const panelFooterRect = panelFooter.getBoundingClientRect();
    const frozenPrintWidth = Math.max(
      1,
      Math.ceil(panelRect.width || panel.offsetWidth || 0),
      Math.ceil(panelFooterRect.width || panelFooter.offsetWidth || 0)
    );

    const printContainer = document.createElement("div");
    printContainer.id = SIM_PRINT_CONTAINER_ID;
    printContainer.setAttribute("aria-hidden", "true");
    printContainer.style.setProperty("--simulation-print-scale", String(SIM_PRINT_CLONE_SCALE));
    printContainer.style.width = `${frozenPrintWidth}px`;
    printContainer.style.maxWidth = "none";
    printContainer.style.overflow = "visible";

    const panelClone = panel.cloneNode(true);
    const panelFooterClone = panelFooter.cloneNode(true);
    panelClone.classList.add("print-clone-panel");
    panelFooterClone.classList.add("print-clone-footer");
    normalizePrintPanelClone(panelClone);
    freezeMeterLabelPositionsForPrint(panel, panelClone);

    // Freeze the clone at desktop geometry so print media queries do not reflow point positions.
    panelClone.style.width = `${Math.ceil(panelRect.width || panel.offsetWidth || frozenPrintWidth)}px`;
    panelClone.style.maxWidth = "none";
    panelClone.style.maxHeight = "none";
    panelClone.style.overflow = "visible";
    panelClone.setAttribute("data-print-frozen", "true");

    panelFooterClone.style.width = `${Math.ceil(panelFooterRect.width || panelFooter.offsetWidth || frozenPrintWidth)}px`;
    panelFooterClone.style.maxWidth = "none";
    panelFooterClone.style.maxHeight = "none";
    panelFooterClone.style.overflow = "visible";
    panelFooterClone.setAttribute("data-print-frozen", "true");

    await syncPlotlyGraphForPrint(panelFooter, panelFooterClone);

    printContainer.append(panelClone, panelFooterClone);
    document.body.appendChild(printContainer);
    document.body.classList.add(SIM_PRINT_ACTIVE_CLASS);

    let cleanedUp = false;
    let fallbackTimerId = 0;

    const cleanupAfterPrint = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      window.clearTimeout(fallbackTimerId);
      cleanupSimulationPrintContainer();
      printLaunchInProgress = false;
    };

    window.addEventListener("afterprint", cleanupAfterPrint, { once: true });
    fallbackTimerId = window.setTimeout(cleanupAfterPrint, 120000);

    try {
      await waitForNextFrame();
      window.print();
    } catch (error) {
      console.warn("Unable to open print dialog.", error);
      cleanupAfterPrint();
    }
  }
  window.simplePrintSimulation = simplePrintSimulation;

  if (resetBtn) resetBtn.addEventListener("click", resetObservations);
  if (printBtn) {
    printBtn.addEventListener("click", simplePrintSimulation);
  }
  document.addEventListener("keydown", (event) => {
    const printShortcut = (event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "p";
    if (!printShortcut) return;
    event.preventDefault();
    simplePrintSimulation();
  });
  if (reportBtn) {
    reportBtn.addEventListener("click", handleReportClick);
    reportBtn.disabled = true;
  }

  window.addEventListener(MCB_TURNED_OFF_EVENT, function () {
    selectedIndex = -1;
    if (lampSelect) {
      lampSelect.value = "";
      lampSelect.disabled = true;
    }
    if (addTableBtn) addTableBtn.disabled = true;
    updateBulbs(0);
    updateNeedles(-1);
  });

  // initialize defaults
  updateBulbs(0);
  updateNeedles(-1);
  updateGraphControls();
  sharedControls.updateControlLocks();

  window.addEventListener(CONNECTION_VERIFIED_EVENT, function () {
    connectionsVerified = true;
    starterMoved = false;
    sharedControls.updateControlLocks();
    updateRotorSpin();
    stepGuide.complete("connect");
  });
})();

 

(function initHoverDefinitions() {
  function setup() {
    if (document.querySelector(".hover-tooltip")) return;
    if (!document.body) return;

    const tooltipLayer = document.createElement("div");
    tooltipLayer.className = "hover-tooltip";
    tooltipLayer.innerHTML =
      '<div class="hover-tooltip__body"><div class="hover-tooltip__accent"></div><div class="hover-tooltip__text"></div></div>';
      const tooltipText = tooltipLayer.querySelector(".hover-tooltip__text");
      document.body.appendChild(tooltipLayer);

      const tooltips = [
{
          id: "mcb",
          selector: ".mcb-toggle, .mcb-block img",
          text: "Purpose: To ensure the safety of equipment and users by tripping during electrical faults."
        },
        {
          id: "starter",
          selector: ".starter-body, .starter-handle",
        text: "Purpose: Limits the starting current of a DC motor by using external armature resistance, which is cut out as the motor speeds up, and provides overload and no-voltage protection. \n\n Ratings: Voltage - 220V DC, 7.5 HP"
      },
      {
        id: "lamp-load",
        selector: ".lamp-bulb",
        text: "Purpose: It helps in observing how the terminal voltage varies with the load current. \n\n Ratings: 2 kW (Each bulb has a rating of 200 W)."
      },
      {
        id: "ammeter-1",
        selector: ".meter-card:nth-of-type(1) > img",
        text: "Purpose: To measure the current drawn by the DC shunt motor during operation."
      },
      {
        id: "voltmeter-1",
        selector: ".meter-card:nth-of-type(2) > img",
        text: "Purpose:  To measure the voltage of the main supply."
      },
      {
        id: "ammeter-2",
        selector: ".meter-card:nth-of-type(3) > img",
        text: "Purpose:  To measure the load current (IL) delivered by the DC shunt generator."
      },
      {
        id: "voltmeter-2",
        selector: ".meter-card:nth-of-type(4) > img",
        text: "Purpose: It is connected in parallel across the generator terminals to measure the terminal voltage (V) of the DC shunt generator."
      },
       {
        id: "dc-motor",
        selector: ".motor-box > img",
        text: "Purpose: It acts as a prime mover, converting electrical energy into mechanical energy to drive the DC shunt generator. \n\n Ratings: 5HP, Voltage - 220 V DC, Max. Current - 19 A, Speed - 1500 RPM Winding Type - Shunt"
      },
      {
        id: "coupler",
        selector: ".coupler > img",
        text: "Purpose: The shaft is used to mechanically couple the DC shunt motor with the DC shunt generator."
      },
      {
        id: "dc-generator",
        selector: ".generator-body, .generator-rotor",
        text: "Purpose: It converts the mechanical energy received from the motor into electrical energy and supplies power to the load for studying the load characteristics of a DC shunt generator. \n\n Ratings:  3 kW, Voltage - 220 V DC, Max. Current - 13.6 A, Speed - 1500 RPM" 
      },
      // {
      //   id: "output-graph",
      //   selector: ".graph-section, #graphPlot, #graphBars",
      //   text: "Output Graph: Plots terminal voltage (V) versus load current (A) using the readings you add to the table."
      // },
      // {
      //   id: "instructions",
      //   selector: ".instructions-wrapper, .instructions-btn, .instructions-panel, #instructionModal",
      //   text: "Instructions: Shows the required wiring sequence and the steps to run the experiment."
      // },
      // {
      //   id: "controls",
      //   selector: "#pill-stack",
      //   text: "Controls: Use these buttons to run the simulation (Speaking, Check, Auto Connect, Add To Table, Reset)."
      // }
    ];

    tooltips.forEach(({ selector }) => {
      document.querySelectorAll(selector).forEach((el) => el.removeAttribute("title"));
    });

    let activeTarget = null;

    function findEntry(target) {
      if (!target || target.nodeType !== 1) return null;
      for (const entry of tooltips) {
        const match = target.closest(entry.selector);
        if (match) return { match, text: entry.text, id: entry.id };
      }
      return null;
    }

    function moveTip(event) {
      const padding = 16;
      const offsetX = 14;
      const offsetY = 14;

      const maxLeft = window.innerWidth - tooltipLayer.offsetWidth - padding;
      const maxTop = window.innerHeight - tooltipLayer.offsetHeight - padding;

      const desiredLeft = event.clientX + offsetX;
      const desiredTop = event.clientY + offsetY;

      tooltipLayer.style.left = Math.max(padding, Math.min(desiredLeft, maxLeft)) + "px";
      tooltipLayer.style.top = Math.max(padding, Math.min(desiredTop, maxTop)) + "px";
    }

    function showTip(text, event) {
      if (!tooltipText) return;
      tooltipText.textContent = text;
      moveTip(event);
      tooltipLayer.classList.add("show");
    }

    function hideTip() {
      tooltipLayer.classList.remove("show");
    }

      function attachLeaveHandler(target) {
        target.addEventListener(
          "mouseleave",
          () => {
            if (activeTarget === target) {
              activeTarget = null;
              hideTip();
            }
          },
          { once: true }
        );
      }

      // Ensure MCB definition shows when its image is clicked.
      const mcbImage = document.querySelector(".mcb-toggle");
      if (mcbImage) {
        mcbImage.addEventListener("click", function (event) {
          const entry = tooltips.find(t => t.id === "mcb");
          if (!entry) return;
          if (activeTarget === mcbImage) {
            activeTarget = null;
            hideTip();
            return;
          }
          activeTarget = mcbImage;
          showTip(entry.text, event);
          attachLeaveHandler(mcbImage);
        });
      }

      document.addEventListener("click", function (event) {
        const searchTarget = event.target.closest("img") || event.target;
        const found = findEntry(searchTarget);
        if (!found || !found.match) {
          if (activeTarget) {
            activeTarget = null;
            hideTip();
          }
          return;
        }
        // Ensure we attach to the actual image element for leave handling.
        if (found.id === "mcb" && found.match.tagName !== "IMG") {
          const mcbImgEl = document.querySelector(".mcb-toggle");
          if (mcbImgEl) found.match = mcbImgEl;
        }
        if (found.match.tagName !== "IMG") {
          if (activeTarget) {
            activeTarget = null;
            hideTip();
          }
          return;
        }
        if (activeTarget === found.match) {
          activeTarget = null;
          hideTip();
          return;
        }
        activeTarget = found.match;
        showTip(found.text, event);
        attachLeaveHandler(activeTarget);
      });

      document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          activeTarget = null;
          hideTip();
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }
})();

(function initChatbotWidget() {
  function setup() {
    const widget = document.querySelector(".chatbot-widget");
    if (!widget) return;

    const toggleBtn = widget.querySelector(".chatbot-launcher");
    const panel = widget.querySelector(".chatbot-panel");
    const closeBtn = widget.querySelector(".chatbot-panel-close");
    const iframe = panel?.querySelector("iframe");
    const placeholder = panel?.querySelector(".chatbot-panel-placeholder");
    const chatUrl = (panel?.dataset?.chatUrl || "").trim();
    const notifyAudio = document.getElementById("chatbot-notification-audio");

    if (!toggleBtn || !panel || !closeBtn || !iframe || !placeholder) return;

    let isLoaded = false;
    let notifiedOnce = false;

    function openPanel() {
      panel.classList.add("open");
      widget.classList.add("chatbot-open");
      toggleBtn.setAttribute("aria-expanded", "true");

      if (chatUrl && chatUrl !== "#") {
        if (!isLoaded) {
          placeholder.style.display = "flex";
          placeholder.textContent = "Loading assistant...";

          iframe.addEventListener(
            "load",
            () => {
              isLoaded = true;
              iframe.classList.add("chatbot-frame-visible");
              placeholder.style.display = "none";
            },
            { once: true }
          );

          iframe.src = chatUrl;
        }
      } else {
        placeholder.style.display = "flex";
        placeholder.innerHTML =
          'Set the <strong>data-chat-url</strong> on the chatbot panel to your chatbot link.';
      }

      if (!notifiedOnce && notifyAudio) {
        notifiedOnce = true;
        try {
          notifyAudio.currentTime = 0;
          const playResult = notifyAudio.play();
          if (playResult && typeof playResult.catch === "function") {
            playResult.catch(() => {});
          }
        } catch {
          // ignore playback errors (autoplay restrictions)
        }
      }
    }

    function closePanel() {
      panel.classList.remove("open");
      widget.classList.remove("chatbot-open");
      toggleBtn.setAttribute("aria-expanded", "false");
    }

    toggleBtn.addEventListener("click", () => {
      if (panel.classList.contains("open")) {
        closePanel();
      } else {
        openPanel();
      }
    });

    closeBtn.addEventListener("click", closePanel);

    document.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape" && panel.classList.contains("open")) {
        closePanel();
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setup, { once: true });
  } else {
    setup();
  }
})();
// Components popup (auto on load + open from icon)
  (function () {
    const modal = document.getElementById("componentsModal");
    if (!modal) return;

    const closeEls = modal.querySelectorAll("[data-components-close]");
    const skipBtn = modal.querySelector("[data-components-skip]");
    const audioBtn = modal.querySelector("[data-components-audio]");
    const audioLabel = modal.querySelector("[data-components-audio-label]");
    const componentsFrame = modal.querySelector("iframe");
    const openBtns = document.querySelectorAll("[data-open-components]");

  // Storage helpers
  const STORAGE_KEY = "vl_components_skipped"; // session only
  const STORAGE =
    (() => {
      try {
        return window.sessionStorage;
      } catch (e) {
        return null;
      }
    })();
  const PERSISTENT_STORAGE =
    (() => {
      try {
        return window.localStorage;
      } catch (e) {
        return STORAGE; // graceful fallback
      }
    })();
  const COMPONENTS_SEEN_KEY = "vl_components_seen";
  const COMPONENTS_ALERT_KEY = "vl_components_alert_shown";

  const hasSeenComponents = () => {
    if (!PERSISTENT_STORAGE) return false;
    try {
      return PERSISTENT_STORAGE.getItem(COMPONENTS_SEEN_KEY) === "1";
    } catch (e) {
      return false;
    }
  };
  const markComponentsSeen = () => {
    if (!PERSISTENT_STORAGE) return;
    try {
      PERSISTENT_STORAGE.setItem(COMPONENTS_SEEN_KEY, "1");
    } catch (e) {}
  };
  const hasShownComponentsAlert = () => {
    if (!PERSISTENT_STORAGE) return false;
    try {
      return PERSISTENT_STORAGE.getItem(COMPONENTS_ALERT_KEY) === "1";
    } catch (e) {
      return false;
    }
  };
  const markComponentsAlertShown = () => {
    if (!PERSISTENT_STORAGE) return;
    try {
      PERSISTENT_STORAGE.setItem(COMPONENTS_ALERT_KEY, "1");
    } catch (e) {}
  };

  const AUDIO_STORAGE_KEY = "vl_components_audio_played";
  const AUDIO_STORAGE =
    (() => {
      try {
        return window.sessionStorage;
      } catch (e) {
        try {
          return window.localStorage;
        } catch (err) {
          return null;
        }
      }
    })();

  function hasAutoPlayedAudio() {
    if (!AUDIO_STORAGE) return false;
    try {
      return AUDIO_STORAGE.getItem(AUDIO_STORAGE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function markAutoPlayedAudio() {
    if (!AUDIO_STORAGE) return;
    try {
      AUDIO_STORAGE.setItem(AUDIO_STORAGE_KEY, "1");
    } catch (e) {}
  }

  let frameReady = false;
  let autoPlayPending = !hasAutoPlayedAudio();
  let autoPlayRequested = false;
  let autoPlayRetryArmed = false;
  const COMPONENTS_EXIT_MESSAGE = COMPONENTS_EXIT_ALERT_MESSAGE;

  function showComponentsExitAlert() {
    if (hasShownComponentsAlert()) return;
    markComponentsAlertShown();

    const speakBtn = document.querySelector(".speak-btn");
    const ATTENTION_CLASS = "speak-attention";

    if (speakBtn) {
      speakBtn.classList.add(ATTENTION_CLASS);
      const clearAttention = () => {
        speakBtn.classList.remove(ATTENTION_CLASS);
      };
      speakBtn.addEventListener("click", clearAttention, { once: true });
    }

    showPopup(COMPONENTS_EXIT_MESSAGE, "Instruction");

    const modalCloseBtn = document.querySelector("#warningModal [data-modal-close]");
    if (modalCloseBtn && speakBtn) {
      modalCloseBtn.addEventListener(
        "click",
        () => {
          setTimeout(() => {
            try {
              speakBtn.focus({ preventScroll: true });
            } catch (e) {}
          }, 520);
        },
        { once: true }
      );
    }
  }

  function markAutoPlayComplete() {
    if (!autoPlayPending) return;
    markAutoPlayedAudio();
    autoPlayPending = false;
    autoPlayRequested = false;
  }

    function updateAudioControl(state = {}) {
      if (!audioBtn) return;
      const playing = !!state.playing;
      const disabled = !!state.disabled;
      const label = state.label || (playing ? "Pause Audio" : "Play Audio");
      audioBtn.setAttribute("aria-pressed", playing ? "true" : "false");
      audioBtn.disabled = disabled;
      if (audioLabel) audioLabel.textContent = label;
    }

    function postAudioMessage(type) {
      if (!componentsFrame || !componentsFrame.contentWindow) return;
      componentsFrame.contentWindow.postMessage({ type }, "*");
    }

    function maybeAutoPlayAudio() {
      if (!autoPlayPending || !frameReady || autoPlayRequested) return;
      postAudioMessage("component-audio-play");
      autoPlayRequested = true;
    }

    function armAutoPlayRetry() {
      if (autoPlayRetryArmed || !autoPlayPending) return;
      autoPlayRetryArmed = true;

      const resume = () => {
        autoPlayRetryArmed = false;
        if (!frameReady) return;
        postAudioMessage("component-audio-play");
        autoPlayRequested = true;
      };

      document.addEventListener("pointerdown", resume, { once: true });
      document.addEventListener("keydown", resume, { once: true });
    }

    function requestAudioState() {
      postAudioMessage("component-audio-request");
    }

    if (audioBtn) {
      audioBtn.addEventListener("click", () => {
        postAudioMessage("component-audio-toggle");
      });
    }

    if (componentsFrame) {
      componentsFrame.addEventListener("load", () => {
        frameReady = true;
        requestAudioState();
        if (!modal.classList.contains("is-hidden")) {
          maybeAutoPlayAudio();
        }
      });
    }

    window.addEventListener("message", (event) => {
      if (!componentsFrame || event.source !== componentsFrame.contentWindow) return;
      const data = event.data || {};
      if (data.type === "component-audio-state") {
        updateAudioControl(data.state || data);
        if (autoPlayPending && data.playing) {
          markAutoPlayComplete();
        }
        return;
      }
      if (data.type === "component-audio-blocked") {
        if (autoPlayPending) {
          autoPlayRequested = false;
          armAutoPlayRetry();
        }
        if (audioBtn) {
          updateAudioControl({
            playing: false,
            disabled: audioBtn.disabled,
            label: "Tap to enable audio"
          });
        }
        return;
      }
      if (data.type === "components-tour-complete") {
        closeComponentsModal({ skip: true, showAlert: true });
        return;
      }
    });

    function openComponentsModal({ force = false, auto = false } = {}) {
      if (!force) {
        if (auto && hasSeenComponents()) return;
        if (STORAGE) {
          try {
            if (STORAGE.getItem(STORAGE_KEY) === "1") return;
          } catch (e) {}
        }
      }
      modal.classList.remove("is-hidden");
      document.body.classList.add("is-modal-open");
      requestAudioState();
      maybeAutoPlayAudio();
      if (auto) markComponentsSeen();
    }

    function closeComponentsModal({ skip = false, showAlert = false } = {}) {
      modal.classList.add("is-hidden");
      document.body.classList.remove("is-modal-open");
      postAudioMessage("component-audio-stop");

      if (autoPlayPending) {
        autoPlayRequested = false;
      }

      if (skip && STORAGE) {
        try {
          STORAGE.setItem(STORAGE_KEY, "1");
        } catch (e) {}
      }

      if (showAlert) {
        showComponentsExitAlert();
      }
    }

  // Auto open when page loads
  window.addEventListener("load", () => {
    setTimeout(() => openComponentsModal({ auto: true }), 250);
  });

  // Open via icons/buttons
  openBtns.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      openComponentsModal({ force: true }); // even if skipped
    });
  });

  // Close buttons + backdrop
  closeEls.forEach((el) =>
    el.addEventListener("click", () => closeComponentsModal({ showAlert: true }))
  );
  if (skipBtn)
    skipBtn.addEventListener("click", () =>
      closeComponentsModal({ skip: true, showAlert: true })
    );

  // ESC key to close
  document.addEventListener("keydown", (e) => {
    if (modal.classList.contains("is-hidden")) return;
    if (e.key === "Escape") closeComponentsModal({ showAlert: true });
  });
})();

