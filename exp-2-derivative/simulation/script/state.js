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

