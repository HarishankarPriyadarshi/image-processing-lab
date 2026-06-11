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
  // {
  //   key: "guide_mcb_on",
  //   text: "The MCB is already on. Move the starter handle from left to right.",
  //   audio: "./audio/guide_mcb_on.wav"
  // },
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
  { key: "reading_added", text: "Reading added to the observation table.", audio: "./audio/reading_added.wav" },

  // Step prompts (normalized key uses sorted point ids from connectionKey).
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

