(function () {
  "use strict";

  const AUDIO_PATHS = {
    "para.aim": "./audio/AimAudio/para.aim.wav",
    "para.procedure": "./audio/procedureAudio/para.procedure.wav",
    "para.intro": "./audio/theoryAudio/para.intro.wav",
    "para.edge-segmentation": "./audio/theoryAudio/para.edge-segmentation.wav",
    "para.gradient": "./audio/theoryAudio/para.gradient..wav",
    "para.steps-in-edge-detection": "./audio/theoryAudio/para.steps-in-edge-detection.wav",
    "para.edge-detectors": "./audio/theoryAudio/para.edge-detectors.wav",
    "para.first-order-derivative-operators": "./audio/theoryAudio/para.first-order-derivative-operators.wav",
    "para.second-order-derivative-operators": "./audio/theoryAudio/para.second-order-derivative-operators.wav",
    "para.comparison-of-edge-detectors": "./audio/theoryAudio/para.comparison-of-edge-detectors.wav",
  };
  const JSON_URL = "./textToSpeech.json";
  const TEXT = "[data-recorded-audio-text]";
  const ESTIMATE_NOTICE =
    "Using approximate word-based sentence timings; add measured offsets to textToSpeech.json for exact synchronization.";
  const SPLITTER = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "sentence" })
    : null;

  function sentences(text) {
    const value = text.replace(/\s+/g, " ").trim();
    return (SPLITTER
      ? Array.from(SPLITTER.segment(value), (part) => part.segment.trim())
      : value.match(/[^.!?]+(?:[.!?]+|$)/g) || [value]
    ).filter(Boolean);
  }

  function sentenceRanges(text) {
    let normalized = "";
    const sourceOffsets = [];
    for (let index = 0; index < text.length; index += 1) {
      if (/\s/.test(text[index])) {
        if (normalized && !normalized.endsWith(" ")) {
          normalized += " ";
          sourceOffsets.push(index);
        }
      } else {
        normalized += text[index];
        sourceOffsets.push(index);
      }
    }
    if (normalized.endsWith(" ")) {
      normalized = normalized.slice(0, -1);
      sourceOffsets.pop();
    }

    let searchFrom = 0;
    return sentences(normalized).map((text) => {
      const start = normalized.indexOf(text, searchFrom);
      if (start < 0) throw new Error("Could not map a sentence to its source text.");
      const end = start + text.length;
      searchFrom = end;
      return { text, start: sourceOffsets[start], end: sourceOffsets[end - 1] + 1 };
    });
  }

  function wrapTextRange(element, start, end) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    let textLength = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      textNodes.push({ node, start: textLength, end: textLength + node.length });
      textLength += node.length;
    }
    const startNode = textNodes.find((item) => start >= item.start && start < item.end);
    const endNode = textNodes.find((item) => end > item.start && end <= item.end);
    if (!startNode || !endNode) throw new Error("Could not wrap a sentence in the transcript.");

    const range = document.createRange();
    range.setStart(startNode.node, start - startNode.start);
    range.setEnd(endNode.node, end - endNode.start);
    const span = document.createElement("span");
    span.className = "speech-sentence-part";
    span.appendChild(range.extractContents());
    range.insertNode(span);
    return span;
  }

  function mediaPath(key) {
    const path = AUDIO_PATHS[key];
    if (!path) throw new Error(`No recording is configured for "${key}".`);
    return path;
  }

  function estimateTimings(chapter, duration) {
    if (
      !chapter ||
      !Number.isFinite(duration) ||
      duration <= 0
    ) return false;

    const timings = chapter.parts.map((part) => part.timing);
    let estimated = false;
    let index = 0;

    while (index < chapter.parts.length) {
      if (timings[index]) {
        index += 1;
        continue;
      }

      const first = index;
      while (index < chapter.parts.length && !timings[index]) index += 1;
      const last = index;
      const start = first > 0 ? timings[first - 1].end : 0;
      const end = last < chapter.parts.length ? timings[last].start : duration;
      const available = Math.max(0, end - start);
      const wordCounts = chapter.parts.slice(first, last).map((part) =>
        part.text.trim().split(/\s+/).filter(Boolean).length || 1
      );
      const totalWords = wordCounts.reduce((total, count) => total + count, 0);
      let cursor = start;

      wordCounts.forEach((wordCount, offset) => {
        const sentenceEnd = offset === wordCounts.length - 1
          ? end
          : cursor + (available * wordCount) / totalWords;
        const part = chapter.parts[first + offset];
        part.timing = { start: cursor, end: sentenceEnd };
        part.timingEstimated = true;
        timings[first + offset] = part.timing;
        cursor = sentenceEnd;
      });
      estimated = true;
    }

    return estimated;
  }

  function elementsFor(key) {
    const explicit = Array.from(document.querySelectorAll(TEXT))
      .filter((element) => element.dataset.recordedAudioKey === key);
    if (explicit.length) return explicit;

    const section = sectionFor(key);
    if (!section) return [];
    return Array.from(section.root.querySelectorAll(
      "p, li, figcaption, .formula-box, .comparison-table td"
    )).filter((element) => {
      return section.contains(element) &&
        !(element.matches("li") && element.querySelector("p, li")) &&
        (!element.closest(".comparison-table") || element.matches("td"));
    });
  }

  function sectionFor(key) {
    const root = document.querySelector("[data-theory-content]");
    const headings = Array.from(root?.querySelectorAll("h2[data-audio-section]") || []);
    const index = headings.findIndex((heading) => heading.dataset.audioSection === key);
    if (index < 0) return null;

    const heading = headings[index];
    const next = headings[index + 1];
    return {
      root,
      heading,
      contains(element) {
        const afterHeading = element === heading ||
          Boolean(heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
        const afterNext = next &&
          Boolean(next.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING);
        return afterHeading && !afterNext;
      },
    };
  }

  function highlightsFor(key, section, transcriptElements) {
    const root = section?.root || document.querySelector("[data-theory-content]");
    const extras = Array.from(document.querySelectorAll(
      `[data-recorded-audio-heading="${key}"]`
    ));
    if (section) {
      extras.push(section.heading);
      extras.push(...Array.from(section.root.querySelectorAll("center"))
        .filter((element) => section.contains(element) && element.querySelector("math")));
    }
    if (root && section) {
      extras.push(...Array.from(root.querySelectorAll("b")).filter((bold) =>
        section.contains(bold) &&
      !transcriptElements.some((element) => element.contains(bold))
      ));
    }
    return extras;
  }

  function init(controls) {
    const audio = new Audio();
    const status = controls.querySelector("[data-speech-status]");
    const playButton = controls.querySelector('[data-speech-action="toggle"]');
    const previous = controls.querySelector('[data-speech-action="previous"]');
    const next = controls.querySelector('[data-speech-action="next"]');
    const speed = controls.querySelector("[data-speech-speed]");
    const speedLabel = controls.querySelector("[data-speech-speed-value]");
    const sections = [];
    let parts = [];
    let active = 0;
    let loadedKey = "";
    let loadToken = 0;
    let pending = null;
    let pendingSeek = null;
    let playbackComplete = false;
    let initialized = false;
    let jsonTimingNote = "";
    let playbackRate = Number(speed?.value || 1);
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) playbackRate = 1;

    const say = (message) => {
      if (status) status.textContent = message;
    };
    const applyPlaybackRate = () => {
      audio.playbackRate = playbackRate;
      if (speedLabel) speedLabel.textContent = `${playbackRate}x`;
    };
    const current = () => parts[active];
    const highlight = (part) => {
      parts.forEach((item) => {
        item.element.classList.remove("speech-active");
        item.highlights.forEach((element) => element.classList.remove("speech-highlight-active"));
      });
      if (part?.timing) {
        part.element.classList.add("speech-active");
        part.highlights.forEach((element) => element.classList.add("speech-highlight-active"));
      }
    };
    const updateButtons = () => {
      if (playButton) {
        const playing = !audio.paused && !audio.ended;
        playButton.disabled = !initialized || audio.readyState < 1;
        playButton.textContent = playing ? "⏸ Pause" : "▶ Play";
        playButton.setAttribute("aria-label", playing ? "Pause audio" : "Play audio");
      }
      const canNavigateTo = (part) =>
        part && (part.key !== current()?.key || part.timing);
      if (previous) {
        previous.disabled = !initialized || active <= 0 ||
          !canNavigateTo(parts[active - 1]);
      }
      if (next) {
        next.disabled = !initialized || active >= parts.length - 1 ||
          !canNavigateTo(parts[active + 1]);
      }
    };

    function playPart(part) {
      if (!initialized || !part) return;
      active = part.index;
      playbackComplete = false;
      highlight(part);
      const seek = part.timing?.start ?? 0;
      applyPlaybackRate();
      if (part.key !== loadedKey) {
        loadedKey = part.key;
        pending = { token: ++loadToken, part };
        audio.src = mediaPath(part.key);
        audio.load();
        say(`Loading ${part.key}…`);
      } else if (audio.readyState < 1) {
        pending = { token: loadToken, part };
      } else {
        if (part.timing || audio.ended) {
          pendingSeek = part.timing ? part : null;
          audio.currentTime = seek;
        }
        audio.play().catch((error) => say(`Playback failed: ${error.message}`));
      }
      updateButtons();
    }

    function go(offset) {
      const destination = active + offset;
      if (destination < 0 || destination >= parts.length) return;
      playPart(parts[destination]);
    }

    controls.querySelectorAll("[data-speech-action]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.speechAction === "previous") return go(-1);
        if (button.dataset.speechAction === "next") return go(1);
        if (!initialized) return;
        if (audio.paused) {
          playPart(playbackComplete ? parts[0] : current());
        }
        else audio.pause();
      });
    });

    if (speed) {
      speed.addEventListener("input", () => {
        playbackRate = Number(speed.value);
        applyPlaybackRate();
      });
    }

    audio.addEventListener("loadedmetadata", () => {
      applyPlaybackRate();
      const chapter = sections.find((item) => item.key === loadedKey);
      estimateTimings(chapter, audio.duration);
      if (pending) {
        const request = pending;
        pending = null;
        if (request.token === loadToken) {
          active = request.part.index;
          pendingSeek = request.part.timing ? request.part : null;
          audio.currentTime = request.part.timing?.start ?? 0;
          audio.play().catch((error) => say(`Playback failed: ${error.message}`));
        }
      } else {
        say(chapter?.parts.some((part) => part.timingEstimated) || jsonTimingNote
          ? `Audio ready. ${ESTIMATE_NOTICE}`
          : "Audio ready.");
      }
      updateButtons();
    });
    audio.addEventListener("play", () => {
      const timingNote = current()?.timingEstimated || jsonTimingNote
        ? ` ${ESTIMATE_NOTICE}`
        : "";
      say(`Playing ${current()?.key || "recording"}.${timingNote}`);
      updateButtons();
    });
    audio.addEventListener("pause", () => {
      if (!audio.ended) say("Audio paused.");
      updateButtons();
    });
    function syncHighlight() {
      if (pendingSeek) {
        if (
          audio.seeking ||
          audio.currentTime < pendingSeek.timing.start
        ) {
          return;
        }
        pendingSeek = null;
      }

      const chapter = sections[current()?.section];
      const index = chapter?.parts.findIndex((part) =>
        part.timing &&
        audio.currentTime >= part.timing.start &&
        audio.currentTime < part.timing.end
      );
      if (index >= 0) {
        active = chapter.parts[index].index;
        highlight(chapter.parts[index]);
        updateButtons();
      } else if (current()?.timing) {
        highlight(null);
      }
      updateButtons();
    }
    audio.addEventListener("timeupdate", syncHighlight);
    audio.addEventListener("seeked", syncHighlight);
    audio.addEventListener("ended", () => {
      highlight(null);
      const currentKey = current()?.key;
      const followingPart = parts.slice(active + 1)
        .find((part) => part.key !== currentKey);
      if (followingPart) {
        active = followingPart.index;
        playPart(followingPart);
        return;
      }
      playbackComplete = true;
      say("Playback complete.");
      updateButtons();
    });
    audio.addEventListener("error", () => {
      say(`Could not load ${mediaPath(current()?.key || controls.dataset.audioKey)}. Check the recording file.`);
      updateButtons();
    });

    fetch(new URL(JSON_URL, document.baseURI))
      .then((response) => {
        if (!response.ok) throw new Error(`Timestamp file unavailable (${response.status}).`);
        return response.json();
      })
      .then((data) => {
        jsonTimingNote = typeof data._timingNote === "string" &&
          data._timingNote.startsWith("ESTIMATES:");
        const orderedKeys = Array.from(document.querySelectorAll(
          "[data-recorded-audio-key], h2[data-audio-section]"
        )).map((element) =>
          element.dataset.recordedAudioKey || element.dataset.audioSection
        ).filter((key, index, keys) => key && keys.indexOf(key) === index);

        orderedKeys.forEach((key, section) => {
          const ranges = data[key];
          if (!Array.isArray(ranges)) throw new Error(`No sentence ranges for "${key}".`);
          const theorySection = sectionFor(key);
          const chapter = { key, section, parts: [] };
          const transcriptElements = elementsFor(key);
          const extraHighlights = highlightsFor(key, theorySection, transcriptElements);
          transcriptElements.forEach((element) => {
            const pieces = sentenceRanges(element.textContent);
            const wrapped = new Array(pieces.length);
            pieces.forEach((piece, index) => {
              chapter.parts.push({
                key, section, text: piece.text, element: null, highlights: [],
                index: parts.length + chapter.parts.length,
                timing: null, timingEstimated: false,
              });
              wrapped[index] = piece;
            });
            for (let index = wrapped.length - 1; index >= 0; index -= 1) {
              const part = chapter.parts[chapter.parts.length - wrapped.length + index];
              part.element = wrapTextRange(element, wrapped[index].start, wrapped[index].end);
            }
          });
          if (chapter.parts.length !== ranges.length) {
            throw new Error(
              `"${key}": ${chapter.parts.length} sentences found; ${ranges.length} ranges supplied.`
            );
          }
          chapter.parts.forEach((part, index) => {
            const range = ranges[index];
            if (
              range.start !== null &&
              range.end !== null &&
              Number.isFinite(range.start) &&
              Number.isFinite(range.end) &&
              range.start >= 0 &&
              range.end > range.start
            ) {
              part.timing = range;
              part.timingEstimated = false;
            }
            part.highlights = extraHighlights.filter((element) => {
              if (
                element.dataset.recordedAudioHeading === key ||
                element === theorySection?.heading
              ) return index === 0;
              const beforePart = element.compareDocumentPosition(part.element) &
                Node.DOCUMENT_POSITION_FOLLOWING;
              if (element.matches("b")) {
                return beforePart && chapter.parts.find((candidate) =>
                  element.compareDocumentPosition(candidate.element) &
                  Node.DOCUMENT_POSITION_FOLLOWING
                ) === part;
              }
              const precedingParts = chapter.parts.filter((candidate) =>
                candidate.element.compareDocumentPosition(element) &
                Node.DOCUMENT_POSITION_FOLLOWING
              );
              const preceding = precedingParts[precedingParts.length - 1];
              const nearest = preceding || chapter.parts.find((candidate) =>
                element.compareDocumentPosition(candidate.element) &
                Node.DOCUMENT_POSITION_FOLLOWING
              );
              return nearest === part;
            });
            part.element.tabIndex = 0;
            part.element.setAttribute("role", "button");
            part.element.setAttribute("aria-label", `Play sentence ${part.index + 1}`);
            part.element.addEventListener("click", () => {
              playPart(part);
            });
            part.element.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                playPart(part);
              }
            });
          });
          sections.push(chapter);
          parts.push(...chapter.parts);
        });

        active = Math.max(0, parts.findIndex(
          (part) => part.key === controls.dataset.audioKey
        ));
        if (!parts.length) throw new Error("No recorded text is configured for this page.");
        mediaPath(current().key);
        initialized = true;
        loadedKey = current().key;
        audio.src = mediaPath(loadedKey);
        audio.load();
        say(`Loading ${loadedKey}…`);
        updateButtons();
      })
      .catch((error) => {
        say(`Audio setup error: ${error.message}`);
        updateButtons();
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      document.querySelectorAll(".speech-controls[data-audio-key]").forEach(init);
    }, { once: true });
  } else {
    document.querySelectorAll(".speech-controls[data-audio-key]").forEach(init);
  }
})();
