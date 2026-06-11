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
