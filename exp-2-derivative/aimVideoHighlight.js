(function () {
  function splitSentences(text) {
    if (typeof Intl.Segmenter === 'function') {
      return Array.from(
        new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(text),
        item => item.segment
      ).filter(sentence => sentence.trim());
    }

    return (text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text])
      .filter(sentence => sentence.trim());
  }

  function getActiveSentenceIndex(cue, time) {
    const sentences = splitSentences(cue.text);
    const weights = sentences.map(sentence => sentence.trim().split(/\s+/).length);
    const totalWeight = weights.reduce((total, weight) => total + weight, 0);
    const duration = Math.max(0, cue.end - cue.start);
    let elapsedWeight = 0;

    for (let index = 0; index < sentences.length; index += 1) {
      elapsedWeight += weights[index];
      const sentenceEnd = cue.start + duration * (elapsedWeight / totalWeight);
      if (time < sentenceEnd || index === sentences.length - 1) return index;
    }

    return 0;
  }

  function renderCue(container, cue) {
    const paragraph = document.createElement('p');
    paragraph.classList.add('intro-line');

    splitSentences(cue.text).forEach((sentence, index) => {
      if (index > 0) paragraph.appendChild(document.createTextNode(' '));
      const span = document.createElement('span');
      span.classList.add('intro-sentence');
      span.dataset.sentenceIndex = String(index);
      span.textContent = sentence.trim();
      paragraph.appendChild(span);
    });

    container.replaceChildren(paragraph);
  }

  function highlightSentence(container, cue, time) {
    const activeIndex = getActiveSentenceIndex(cue, time);
    container.querySelectorAll('.intro-sentence').forEach((sentence, index) => {
      sentence.classList.toggle('active', index === activeIndex);
    });
  }

  window.AimVideoHighlight = { renderCue, highlightSentence };
})();
