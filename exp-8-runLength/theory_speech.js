/* Reusable browser text-to-speech reader for Virtual Labs theory pages. */
(function () {
  'use strict';

  const THEORY_CONTAINER_SELECTOR = '[data-theory-content]';
  const READING_SELECTOR = 'h2, h3, h4, p, li, figcaption';
  const IGNORE_SELECTOR = '[data-speech-ignore], script, style, noscript, [hidden], [aria-hidden="true"]';

  let readingItems = [];
  let currentIndex = 0;
  let currentSentenceIndex = 0;
  let speechSessionId = 0;
  let activeElement = null;
  let isPaused = false;

  function initializeSpeechReader() {
    const container = document.querySelector(THEORY_CONTAINER_SELECTOR);
    const controls = document.querySelector('.speech-controls');
    if (!container || !controls) return;

    const supported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    controls.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => handleAction(button.dataset.speechAction));
      if (!supported) button.disabled = true;
    });

    if (!supported) {
      setStatus('Text-to-speech is not supported by this browser.');
      return;
    }

    window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());
    updateSpeechControls('idle');
  }

  function handleAction(action) {
    if (action === 'start') startReading();
    if (action === 'pause') pauseReading();
    if (action === 'resume') resumeReading();
    if (action === 'stop') stopReading();
    if (action === 'restart') restartReading();
  }

  function extractReadableContent() {
    const container = document.querySelector(THEORY_CONTAINER_SELECTOR);
    if (!container) return [];

    return Array.from(container.querySelectorAll(READING_SELECTOR)).filter((element) => {
      if (element.closest(IGNORE_SELECTOR)) return false;
      if (element.offsetParent === null) return false;

      // A parent list item represents nested paragraphs and lists as one logical item.
      // This prevents the same content from being read again through its descendants.
      const parentListItem = element.parentElement && element.parentElement.closest('li');
      return !parentListItem;
    }).map((element) => ({
      element,
      text: element.textContent.replace(/\s+/g, ' ').trim()
    })).filter((item) => item.text.length > 0).map((item) => ({
      ...item,
      sentences: splitIntoSentences(item.text)
    }));
  }

  function startReading() {
    if (window.speechSynthesis.speaking || isPaused) return;
    readingItems = extractReadableContent();
    currentIndex = 0;
    currentSentenceIndex = 0;

    if (!readingItems.length) {
      setStatus('There is no theory text available to read.');
      return;
    }

    speechSessionId += 1;
    setStatus('Reading started.');
    updateSpeechControls('speaking');
    speakCurrentItem(speechSessionId);
  }

  function speakCurrentItem(sessionId) {
    if (sessionId !== speechSessionId || currentIndex >= readingItems.length) {
      if (sessionId === speechSessionId) finishReading();
      return;
    }

    const item = readingItems[currentIndex];
    setActiveItem(item.element);
    const utterance = new SpeechSynthesisUtterance(item.sentences[currentSentenceIndex]);

    utterance.onend = () => {
      if (sessionId !== speechSessionId || isPaused) return;
      currentSentenceIndex += 1;
      if (currentSentenceIndex >= item.sentences.length) {
        currentIndex += 1;
        currentSentenceIndex = 0;
      }
      speakCurrentItem(sessionId);
    };
    utterance.onerror = (event) => {
      // Cancelled utterances belong to Stop/Restart and must not update the UI.
      if (sessionId !== speechSessionId || event.error === 'canceled' || event.error === 'interrupted') return;
      setStatus('Reading was interrupted.');
      stopReading();
    };

    window.speechSynthesis.speak(utterance);
  }

  function pauseReading() {
    if (!window.speechSynthesis.speaking) return;
    window.speechSynthesis.pause();
    isPaused = true;
    setStatus('Reading paused.');
    updateSpeechControls('paused');
  }

  function resumeReading() {
    if (!isPaused) return;
    window.speechSynthesis.resume();
    isPaused = false;
    setStatus('Reading resumed.');
    updateSpeechControls('speaking');
  }

  function stopReading() {
    speechSessionId += 1;
    isPaused = false;
    currentIndex = 0;
    currentSentenceIndex = 0;
    window.speechSynthesis.cancel();
    clearActiveHighlight();
    setStatus('Reading stopped.');
    updateSpeechControls('idle');
  }

  function restartReading() {
    speechSessionId += 1;
    isPaused = false;
    window.speechSynthesis.cancel();
    clearActiveHighlight();
    currentIndex = 0;
    currentSentenceIndex = 0;
    readingItems = extractReadableContent();

    if (!readingItems.length) {
      setStatus('There is no theory text available to read.');
      updateSpeechControls('idle');
      return;
    }

    const sessionId = ++speechSessionId;
    setStatus('Reading restarted.');
    updateSpeechControls('speaking');
    // Waiting briefly lets browsers fully process cancellation before a new utterance starts.
    window.setTimeout(() => speakCurrentItem(sessionId), 50);
  }

  function finishReading() {
    isPaused = false;
    currentIndex = 0;
    currentSentenceIndex = 0;
    clearActiveHighlight();
    setStatus('Reading completed.');
    updateSpeechControls('idle');
  }

  function setActiveItem(element) {
    clearActiveHighlight();
    activeElement = element;
    activeElement.classList.add('speech-active');

    const bounds = activeElement.getBoundingClientRect();
    const comfortablyVisible = bounds.top >= 110 && bounds.bottom <= window.innerHeight - 70;
    if (!comfortablyVisible) {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function clearActiveHighlight() {
    if (activeElement) activeElement.classList.remove('speech-active');
    activeElement = null;
  }

  function updateSpeechControls(state) {
    const visibility = {
      start: state === 'idle',
      pause: state === 'speaking',
      resume: state === 'paused',
      stop: state !== 'idle',
      restart: state !== 'idle'
    };
    Object.entries(visibility).forEach(([action, visible]) => {
      const button = document.querySelector(`[data-speech-action="${action}"]`);
      if (button) button.hidden = !visible;
    });
  }

  function splitIntoSentences(text) {
    if ('Intl' in window && typeof Intl.Segmenter === 'function') {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
        (segment) => segment.segment.trim()).filter(Boolean);
    }
    return text.match(/[^.!?]+(?:[.!?]+|$)/g)?.map((sentence) => sentence.trim()).filter(Boolean) || [text];
  }

  function setStatus(message) {
    const status = document.querySelector('[data-speech-status]');
    if (status) status.textContent = message;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeSpeechReader, { once: true });
  } else {
    initializeSpeechReader();
  }
})();
