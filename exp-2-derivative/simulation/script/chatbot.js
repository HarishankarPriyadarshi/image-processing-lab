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
