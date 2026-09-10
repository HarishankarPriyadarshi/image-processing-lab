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

  const NO_WALK_SELECTOR =
    "img, svg, script, style, noscript, [data-speech-ignore], [hidden], [aria-hidden='true']";

  const PREPARED_MARKER = "data-speech-prepared";

  let readingItems = [];
  let currentIndex = 0;
  let currentSentenceIndex = 0;

  let speechSessionId = 0;
  let activeElement = null;
  let currentSentenceSelector = null;

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
     DOM TEXT NODE MAPPING
     ============================================================ */

  function shouldSkipWalk(node) {
    if (node.nodeType !== 1) return false;
    if (node.matches && node.matches(NO_WALK_SELECTOR)) return true;
    return false;
  }

  function collectTextNodes(root) {
    const segments = [];
    let normalizedOffset = 0;

    function traverse(node) {
      if (node.nodeType === 3) {
        const rawText = node.nodeValue;
        const normalizedText = rawText.replace(/\s+/g, " ");
        if (normalizedText.length > 0) {
          segments.push({
            textNode: node,
            rawText: rawText,
            normalizedText: normalizedText,
            normalizedStart: normalizedOffset,
            normalizedEnd: normalizedOffset + normalizedText.length,
          });
          normalizedOffset += normalizedText.length;
        }
        return;
      }

      if (node.nodeType === 1) {
        if (node !== root && shouldSkipWalk(node)) {
          const skippedText = node.textContent || "";
          const skippedNorm = skippedText.replace(/\s+/g, " ");
          normalizedOffset += skippedNorm.length;
          return;
        }

        let child = node.firstChild;
        while (child) {
          traverse(child);
          child = child.nextSibling;
        }
      }
    }

    traverse(root);

    return {
      segments: segments,
      totalNormalizedLength: normalizedOffset,
    };
  }

  function buildTextNodeMap(root) {
    return collectTextNodes(root);
  }

  function normalizeText(text) {
    return text.replace(/\s+/g, " ");
  }

  function findSentenceRangesInSegments(
    textNodeMap,
    sentenceNormalizedStart,
    sentenceNormalizedEnd
  ) {
    const ranges = [];
    const segments = textNodeMap.segments;

    for (const seg of segments) {
      const overlapStart = Math.max(
        seg.normalizedStart,
        sentenceNormalizedStart
      );
      const overlapEnd = Math.min(
        seg.normalizedEnd,
        sentenceNormalizedEnd
      );

      if (overlapStart < overlapEnd) {
        const relStartNorm =
          overlapStart - seg.normalizedStart;
        const relEndNorm = overlapEnd - seg.normalizedStart;

        const rawRange =
          mapNormalizedRangeToRaw(
            seg.rawText,
            relStartNorm,
            relEndNorm
          );

        ranges.push({
          textNode: seg.textNode,
          rawStart: rawRange.rawStart,
          rawEnd: rawRange.rawEnd,
        });
      }
    }

    return ranges;
  }

  function mapNormalizedRangeToRaw(
    rawText,
    normStart,
    normEnd
  ) {
    let rawPos = 0;
    let normPos = 0;
    let rawStart = 0;
    let rawEnd = 0;
    let startFound = false;

    while (rawPos < rawText.length && normPos <= normEnd) {
      const ch = rawText[rawPos];
      const isWhitespace = /\s/.test(ch);

      if (isWhitespace) {
        if (normPos === normStart && !startFound) {
          rawStart = rawPos;
          startFound = true;
        }
        if (normPos === normEnd) {
          rawEnd = rawPos;
          return { rawStart, rawEnd };
        }
        let runStart = rawPos;
        while (
          rawPos < rawText.length &&
          /\s/.test(rawText[rawPos])
        ) {
          rawPos++;
        }
        normPos++;
        continue;
      }

      if (normPos === normStart && !startFound) {
        rawStart = rawPos;
        startFound = true;
      }
      if (normPos === normEnd) {
        rawEnd = rawPos;
        return { rawStart, rawEnd };
      }

      rawPos++;
      normPos++;
    }

    if (!startFound) {
      rawStart = rawPos;
    }
    rawEnd = rawPos;
    return { rawStart, rawEnd };
  }

  /* ============================================================
     PREPARE SENTENCE HIGHLIGHTING (IDEMPOTENT)
     ============================================================ */

  function prepareSentenceHighlighting(item, itemIndex) {
    const element = item.element;
    const sentences = item.sentences;

    if (element.hasAttribute(PREPARED_MARKER)) {
      return;
    }

    const textNodeMap = buildTextNodeMap(element);

    if (textNodeMap.segments.length === 0) {
      element.setAttribute(PREPARED_MARKER, "true");
      return;
    }

    const normalizedFullText = sentences.join(" ");
    const textContentNorm = normalizeText(
      element.textContent
    );

    const sentenceOffsets = [];
    let searchPos = 0;

    for (let s = 0; s < sentences.length; s++) {
      const sentenceNorm = sentences[s];
      const idx = textContentNorm.indexOf(
        sentenceNorm,
        searchPos
      );

      if (idx === -1) {
        sentenceOffsets.push(null);
        continue;
      }

      const start = idx;
      const end = idx + sentenceNorm.length;
      sentenceOffsets.push({ start, end });
      searchPos = end;
    }

    const wrapOps = [];

    for (let s = 0; s < sentenceOffsets.length; s++) {
      const offsets = sentenceOffsets[s];
      if (!offsets) continue;

      const ranges = findSentenceRangesInSegments(
        textNodeMap,
        offsets.start,
        offsets.end
      );

      for (const range of ranges) {
        wrapOps.push({
          textNode: range.textNode,
          rawStart: range.rawStart,
          rawEnd: range.rawEnd,
          sentenceId: itemIndex + "-" + s,
        });
      }
    }

    const byTextNode = new Map();
    for (const op of wrapOps) {
      if (!byTextNode.has(op.textNode)) {
        byTextNode.set(op.textNode, []);
      }
      byTextNode.get(op.textNode).push(op);
    }

    byTextNode.forEach((ops, textNode) => {
      ops.sort((a, b) => a.rawStart - b.rawStart);
      wrapTextNodeRanges(textNode, ops);
    });

    element.setAttribute(PREPARED_MARKER, "true");
  }

  function wrapTextNodeRanges(textNode, ops) {
    const parent = textNode.parentNode;
    if (!parent) return;

    const rawText = textNode.nodeValue;

    const validOps = ops.filter(
      (op) => op.rawStart < op.rawEnd && op.rawEnd <= rawText.length
    );

    if (validOps.length === 0) return;

    let currentPos = 0;
    const frag = document.createDocumentFragment();

    for (let i = 0; i < validOps.length; i++) {
      const op = validOps[i];

      if (op.rawStart > currentPos) {
        const beforeText = rawText.slice(
          currentPos,
          op.rawStart
        );
        frag.appendChild(
          document.createTextNode(beforeText)
        );
      }

      const wrappedText = rawText.slice(
        op.rawStart,
        op.rawEnd
      );
      const span = document.createElement("span");
      span.className = "speech-sentence-part";
      span.setAttribute(
        "data-speech-sentence",
        op.sentenceId
      );
      span.textContent = wrappedText;
      frag.appendChild(span);

      currentPos = op.rawEnd;
    }

    if (currentPos < rawText.length) {
      const afterText = rawText.slice(currentPos);
      frag.appendChild(document.createTextNode(afterText));
    }

    parent.replaceChild(frag, textNode);
  }

  /* ============================================================
     HIGHLIGHT CONTROL
     ============================================================ */

  function clearSentenceHighlights() {
    const container = document.querySelector(
      THEORY_CONTAINER_SELECTOR
    );
    if (!container) return;

    const parts = container.querySelectorAll(
      ".speech-sentence-part.speech-active"
    );
    parts.forEach((el) => {
      el.classList.remove("speech-active");
    });

    currentSentenceSelector = null;
  }

  function highlightCurrentSentence() {
    clearSentenceHighlights();

    if (!readingItems.length) return;
    const item = readingItems[currentIndex];
    if (!item) return;

    prepareSentenceHighlighting(item, currentIndex);

    const sentenceId =
      currentIndex + "-" + currentSentenceIndex;
    const selector =
      '[data-speech-sentence="' + sentenceId + '"]';
    currentSentenceSelector = selector;

    const container = document.querySelector(
      THEORY_CONTAINER_SELECTOR
    );
    if (!container) return;

    const parts = container.querySelectorAll(selector);
    parts.forEach((el) => {
      el.classList.add("speech-active");
    });

    scrollSentenceIntoView(parts);
  }

  function scrollSentenceIntoView(sentenceParts) {
    if (!sentenceParts || sentenceParts.length === 0) {
      return;
    }

    let firstEl = sentenceParts[0];
    if (sentenceParts.length > 1) {
      let minTop = Infinity;
      for (const el of sentenceParts) {
        const top = el.getBoundingClientRect().top;
        if (top < minTop) {
          minTop = top;
          firstEl = el;
        }
      }
    }

    const bounds = firstEl.getBoundingClientRect();
    const comfortablyVisible =
      bounds.top >= 110 &&
      bounds.bottom <= window.innerHeight - 70;

    if (!comfortablyVisible) {
      firstEl.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
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

    if (isPaused) {
      resumeReading();
      return;
    }

    if (
      window.speechSynthesis.speaking ||
      isReading
    ) {
      pauseReading();
      return;
    }

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

    window.speechSynthesis.cancel();

    isPaused = false;
    isReading = true;

    setActiveItem(item.element);

    setStatus(
      `Reading sentence ${getCurrentSentenceNumber()} of ${getTotalSentenceCount()}.`
    );

    updateSpeechControls();

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

    if (
      sentenceIndex <
      readingItems[itemIndex].sentences.length
    ) {
      return {
        itemIndex,
        sentenceIndex,
      };
    }

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

    if (sentenceIndex >= 0) {
      return {
        itemIndex,
        sentenceIndex,
      };
    }

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
     ACTIVE THEORY ELEMENT (SENTENCE-LEVEL HIGHLIGHT)
     ============================================================ */

  function setActiveItem(element) {
    activeElement = element;
    highlightCurrentSentence();
  }

  function clearActiveHighlight() {
    clearSentenceHighlights();
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

    if (previousButton) {
      previousButton.disabled =
        !readingItems.length ||
        !getPreviousPosition();
    }

    if (nextButton) {
      nextButton.disabled =
        !readingItems.length ||
        !getNextPosition();
    }
  }

  /* ============================================================
     SENTENCE SPLITTING
     ============================================================ */

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
     ============================================================ */

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
     ============================================================ */

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
