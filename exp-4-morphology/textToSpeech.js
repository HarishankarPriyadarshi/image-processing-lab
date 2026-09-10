/* ============================================================
   Virtual Labs - Text to Speech Reader
   Controls:
   - Previous sentence
   - Play / Pause / Resume
   - Next sentence

   Speech is generated one sentence at a time.
   ============================================================ */

(function () {
  "use strict";

  const THEORY_CONTAINER_SELECTOR = "[data-theory-content]";
  const READING_SELECTOR = "h2, h3, h4, p, li, figcaption";

  const IGNORE_SELECTOR =
    "[data-speech-ignore], script, style, noscript, [hidden], [aria-hidden='true']";

  let readingItems = [];
  let currentIndex = 0;
  let currentSentenceIndex = 0;

  let speechSessionId = 0;
  let activeElement = null;

  let isPaused = false;
  let isReading = false;

  function initializeSpeechReader() {
    const container = document.querySelector(
      THEORY_CONTAINER_SELECTOR
    );

    const controls = document.querySelector(".speech-controls");

    if (!container || !controls) {
      return;
    }

    const supported =
      "speechSynthesis" in window &&
      "SpeechSynthesisUtterance" in window;

    controls.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => {
        handleAction(button.dataset.speechAction);
      });

      if (!supported) {
        button.disabled = true;
      }
    });

    if (!supported) {
      setStatus(
        "Text-to-speech is not supported by this browser."
      );
      return;
    }

    window.addEventListener("beforeunload", () => {
      window.speechSynthesis.cancel();
    });

    updateSpeechControls();
  }

  /* ============================================================
     ACTION HANDLER
     ============================================================ */

  function handleAction(action) {
    switch (action) {
      case "toggle":
        togglePlayPause();
        break;

      case "previous":
        previousSentence();
        break;

      case "next":
        nextSentence();
        break;

      default:
        break;
    }
  }

  /* ============================================================
     EXTRACT THEORY CONTENT
     ============================================================ */

  function extractReadableContent() {
    const container = document.querySelector(
      THEORY_CONTAINER_SELECTOR
    );

    if (!container) {
      return [];
    }

    return Array.from(
      container.querySelectorAll(READING_SELECTOR)
    )
      .filter((element) => {
        if (element.closest(IGNORE_SELECTOR)) {
          return false;
        }

        if (element.offsetParent === null) {
          return false;
        }

        /*
         * Prevent nested list elements from being
         * read more than once.
         */
        const parentListItem =
          element.parentElement &&
          element.parentElement.closest("li");

        return !parentListItem;
      })
      .map((element) => ({
        element,
        text: element.textContent
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((item) => item.text.length > 0)
      .map((item) => ({
        ...item,
        sentences: splitIntoSentences(item.text),
      }))
      .filter(
        (item) => item.sentences.length > 0
      );
  }

  /* ============================================================
     PLAY / PAUSE / RESUME
     ============================================================ */

  function togglePlayPause() {
    if (!readingItems.length) {
      readingItems = extractReadableContent();
    }

    if (!readingItems.length) {
      setStatus(
        "There is no theory text available to read."
      );
      return;
    }

    /*
     * If currently paused, resume.
     */
    if (isPaused) {
      resumeReading();
      return;
    }

    /*
     * If currently speaking, pause.
     */
    if (
      window.speechSynthesis.speaking ||
      isReading
    ) {
      pauseReading();
      return;
    }

    /*
     * If reading was completed, start again
     * from the beginning.
     */
    if (
      currentIndex >= readingItems.length ||
      !readingItems[currentIndex]?.sentences[
        currentSentenceIndex
      ]
    ) {
      currentIndex = 0;
      currentSentenceIndex = 0;
    }

    startCurrentSentence();
  }

  /* ============================================================
     START CURRENT SENTENCE
     ============================================================ */

  function startCurrentSentence() {
    if (!readingItems.length) {
      return;
    }

    const item = readingItems[currentIndex];

    if (
      !item ||
      !item.sentences[currentSentenceIndex]
    ) {
      finishReading();
      return;
    }

    speechSessionId += 1;

    const sessionId = speechSessionId;

    /*
     * Cancel any currently running utterance.
     */
    window.speechSynthesis.cancel();

    isPaused = false;
    isReading = true;

    setActiveItem(item.element);

    setStatus(
      `Reading sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
    );

    updateSpeechControls();

    /*
     * IMPORTANT:
     * Only the CURRENT SENTENCE is passed
     * to SpeechSynthesisUtterance.
     */
    const utterance =
      new SpeechSynthesisUtterance(
        item.sentences[currentSentenceIndex]
      );

    utterance.onend = () => {
      if (
        sessionId !== speechSessionId ||
        isPaused
      ) {
        return;
      }

      moveToNextSentence();
    };

    utterance.onerror = (event) => {
      if (
        sessionId !== speechSessionId ||
        event.error === "canceled" ||
        event.error === "interrupted"
      ) {
        return;
      }

      isReading = false;
      isPaused = false;

      setStatus(
        "Reading was interrupted."
      );

      updateSpeechControls();
    };

    window.speechSynthesis.speak(utterance);
  }

  /* ============================================================
     PAUSE
     ============================================================ */

  function pauseReading() {
    if (
      !window.speechSynthesis.speaking ||
      isPaused
    ) {
      return;
    }

    window.speechSynthesis.pause();

    isPaused = true;
    isReading = true;

    setStatus("Reading paused.");

    updateSpeechControls();
  }

  /* ============================================================
     RESUME
     ============================================================ */

  function resumeReading() {
    if (!isPaused) {
      return;
    }

    window.speechSynthesis.resume();

    isPaused = false;
    isReading = true;

    setStatus(
      `Reading sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
    );

    updateSpeechControls();
  }

  /* ============================================================
     PREVIOUS SENTENCE
     ============================================================ */

  function previousSentence() {
    if (!readingItems.length) {
      readingItems = extractReadableContent();
    }

    if (!readingItems.length) {
      setStatus(
        "There is no theory text available to read."
      );
      return;
    }

    const wasPaused = isPaused;

    const wasReading =
      isReading ||
      window.speechSynthesis.speaking ||
      window.speechSynthesis.pending;

    const previousPosition =
      getPreviousPosition();

    if (!previousPosition) {
      setStatus(
        "Already at the first sentence."
      );
      return;
    }

    speechSessionId += 1;

    window.speechSynthesis.cancel();

    currentIndex =
      previousPosition.itemIndex;

    currentSentenceIndex =
      previousPosition.sentenceIndex;

    isPaused = wasPaused;
    isReading = wasReading;

    setActiveItem(
      readingItems[currentIndex].element
    );

    /*
     * If currently playing, immediately
     * start speaking the previous sentence.
     */
    if (wasReading && !wasPaused) {
      const sessionId = speechSessionId;

      setStatus(
        `Reading sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
      );

      window.setTimeout(() => {
        if (sessionId !== speechSessionId) {
          return;
        }

        startCurrentSentence();
      }, 50);
    } else {
      /*
       * If paused, only move the position.
       */
      setStatus(
        `Selected sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
      );

      updateSpeechControls();
    }
  }

  /* ============================================================
     NEXT SENTENCE
     ============================================================ */

  function nextSentence() {
    if (!readingItems.length) {
      readingItems = extractReadableContent();
    }

    if (!readingItems.length) {
      setStatus(
        "There is no theory text available to read."
      );
      return;
    }

    const nextPosition =
      getNextPosition();

    if (!nextPosition) {
      finishReading();
      return;
    }

    const wasPaused = isPaused;

    const wasReading =
      isReading ||
      window.speechSynthesis.speaking ||
      window.speechSynthesis.pending;

    speechSessionId += 1;

    window.speechSynthesis.cancel();

    currentIndex =
      nextPosition.itemIndex;

    currentSentenceIndex =
      nextPosition.sentenceIndex;

    isPaused = wasPaused;
    isReading = wasReading;

    setActiveItem(
      readingItems[currentIndex].element
    );

    /*
     * If currently playing, immediately
     * start speaking the next sentence.
     */
    if (wasReading && !wasPaused) {
      const sessionId = speechSessionId;

      setStatus(
        `Reading sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
      );

      window.setTimeout(() => {
        if (sessionId !== speechSessionId) {
          return;
        }

        startCurrentSentence();
      }, 50);
    } else {
      /*
       * If paused, only move the position.
       */
      setStatus(
        `Selected sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
      );

      updateSpeechControls();
    }
  }

  /* ============================================================
     AUTOMATICALLY MOVE TO NEXT SENTENCE
     ============================================================ */

  function moveToNextSentence() {
    const nextPosition =
      getNextPosition();

    if (!nextPosition) {
      finishReading();
      return;
    }

    currentIndex =
      nextPosition.itemIndex;

    currentSentenceIndex =
      nextPosition.sentenceIndex;

    startCurrentSentence();
  }

  /* ============================================================
     NEXT POSITION
     ============================================================ */

  function getNextPosition() {
    if (!readingItems.length) {
      return null;
    }

    let itemIndex = currentIndex;

    let sentenceIndex =
      currentSentenceIndex + 1;

    /*
     * Another sentence exists in the
     * current paragraph/element.
     */
    if (
      sentenceIndex <
      readingItems[itemIndex].sentences.length
    ) {
      return {
        itemIndex,
        sentenceIndex,
      };
    }

    /*
     * Move to the next readable element.
     */
    itemIndex += 1;

    while (
      itemIndex < readingItems.length
    ) {
      if (
        readingItems[itemIndex]
          .sentences.length > 0
      ) {
        return {
          itemIndex,
          sentenceIndex: 0,
        };
      }

      itemIndex += 1;
    }

    return null;
  }

  /* ============================================================
     PREVIOUS POSITION
     ============================================================ */

  function getPreviousPosition() {
    if (!readingItems.length) {
      return null;
    }

    let itemIndex = currentIndex;

    let sentenceIndex =
      currentSentenceIndex - 1;

    /*
     * Previous sentence exists in
     * current element.
     */
    if (sentenceIndex >= 0) {
      return {
        itemIndex,
        sentenceIndex,
      };
    }

    /*
     * Otherwise move to previous element.
     */
    itemIndex -= 1;

    while (itemIndex >= 0) {
      const sentenceCount =
        readingItems[itemIndex]
          .sentences.length;

      if (sentenceCount > 0) {
        return {
          itemIndex,
          sentenceIndex:
            sentenceCount - 1,
        };
      }

      itemIndex -= 1;
    }

    return null;
  }

  /* ============================================================
     SENTENCE COUNTERS
     ============================================================ */

  function getTotalSentenceCount() {
    return readingItems.reduce(
      (total, item) =>
        total + item.sentences.length,
      0
    );
  }

  function getCurrentSentenceNumber() {
    let number = 0;

    for (
      let i = 0;
      i < currentIndex;
      i += 1
    ) {
      number +=
        readingItems[i].sentences.length;
    }

    return (
      number +
      currentSentenceIndex +
      1
    );
  }

  /* ============================================================
     FINISH
     ============================================================ */

  function finishReading() {
    speechSessionId += 1;

    window.speechSynthesis.cancel();

    isPaused = false;
    isReading = false;

    currentIndex = 0;
    currentSentenceIndex = 0;

    clearActiveHighlight();

    setStatus(
      "Reading completed."
    );

    updateSpeechControls();
  }

  /* ============================================================
     ACTIVE THEORY ELEMENT
     ============================================================ */

  function setActiveItem(element) {
    clearActiveHighlight();

    activeElement = element;

    activeElement.classList.add(
      "speech-active"
    );

    const bounds =
      activeElement.getBoundingClientRect();

    const comfortablyVisible =
      bounds.top >= 110 &&
      bounds.bottom <=
        window.innerHeight - 70;

    if (!comfortablyVisible) {
      activeElement.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }

  function clearActiveHighlight() {
    if (activeElement) {
      activeElement.classList.remove(
        "speech-active"
      );
    }

    activeElement = null;
  }

  /* ============================================================
     UPDATE BUTTONS
     ============================================================ */

  function updateSpeechControls() {
    const playButton =
      document.querySelector(
        '[data-speech-action="toggle"]'
      );

    const previousButton =
      document.querySelector(
        '[data-speech-action="previous"]'
      );

    const nextButton =
      document.querySelector(
        '[data-speech-action="next"]'
      );

    /*
     * PLAY / PAUSE / RESUME
     */
    if (playButton) {
      if (isPaused) {
        playButton.textContent =
          "▶ Resume";

        playButton.setAttribute(
          "aria-label",
          "Resume theory reading"
        );

        playButton.setAttribute(
          "title",
          "Resume"
        );
      } else if (
        isReading ||
        window.speechSynthesis.speaking
      ) {
        playButton.textContent =
          "⏸ Pause";

        playButton.setAttribute(
          "aria-label",
          "Pause theory reading"
        );

        playButton.setAttribute(
          "title",
          "Pause"
        );
      } else {
        playButton.textContent =
          "▶ Play";

        playButton.setAttribute(
          "aria-label",
          "Play theory reading"
        );

        playButton.setAttribute(
          "title",
          "Play"
        );
      }
    }

    /*
     * PREVIOUS
     */
    if (previousButton) {
      previousButton.disabled =
        !readingItems.length ||
        !getPreviousPosition();
    }

    /*
     * NEXT
     */
    if (nextButton) {
      nextButton.disabled =
        !readingItems.length ||
        !getNextPosition();
    }
  }

  /* ============================================================
     SENTENCE SPLITTING
     *
     * Uses Intl.Segmenter when available because it
     * handles sentence boundaries better than a simple
     * regular expression.
     * ============================================================ */

  function splitIntoSentences(text) {
    if (
      "Intl" in window &&
      typeof Intl.Segmenter === "function"
    ) {
      return Array.from(
        new Intl.Segmenter(undefined, {
          granularity: "sentence",
        }).segment(text),
        (segment) =>
          segment.segment.trim()
      ).filter(Boolean);
    }

    /*
     * Fallback for browsers without Intl.Segmenter.
     */
    return (
      text
        .match(
          /[^.!?]+(?:[.!?]+|$)/g
        )
        ?.map((sentence) =>
          sentence.trim()
        )
        .filter(Boolean) || [text]
    );
  }

  /* ============================================================
     STATUS
     * ============================================================ */

  function setStatus(message) {
    const status =
      document.querySelector(
        "[data-speech-status]"
      );

    if (status) {
      status.textContent = message;
    }
  }

  /* ============================================================
     INITIALIZE
     * ============================================================ */

  if (
    document.readyState === "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      initializeSpeechReader,
      { once: true }
    );
  } else {
    initializeSpeechReader();
  }
})();