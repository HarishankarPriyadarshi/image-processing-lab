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
