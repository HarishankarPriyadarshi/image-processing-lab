(function () {
  const KEY = "vlab_exp2_progress_v1";
  const VERSION = 1;

  function nowISO() {
    return new Date().toISOString();
  }

  function safeParse(json, fallback) {
    try {
      const value = JSON.parse(json);
      return value && typeof value === "object" ? value : fallback;
    } catch {
      return fallback;
    }
  }

  function baseState() {
    return {
      version: VERSION,
      user: null,
      flags: { reportDeclined: false },
      timestamps: {
        sessionStart: null,
        aimAfterIntro: null,
        simulationStart: null,
        simulationEnd: null,
        contributorsVisited: null,
        reportViewedAt: null
      },
      pages: {},
      steps: [],
      userHistory: []
    };
  }

  function loadState() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch {}

    const parsed = raw ? safeParse(raw, baseState()) : baseState();
    return { ...baseState(), ...parsed, timestamps: { ...baseState().timestamps, ...(parsed.timestamps || {}) } };
  }

  function saveState(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  }

  function normalizeTimestamp(value) {
    if (value === undefined || value === null || value === "") return nowISO();
    const numeric = Number(value);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
    if (Number.isNaN(date.getTime())) return nowISO();
    return date.toISOString();
  }

  function markSimulationStart(value) {
    const state = loadState();
    const iso = normalizeTimestamp(value);

    if (!state.timestamps.sessionStart) state.timestamps.sessionStart = iso;
    state.timestamps.simulationStart = iso;
    state.timestamps.simulationEnd = null;

    saveState(state);
  }

  function markSimulationEnd(value) {
    const state = loadState();
    const iso = normalizeTimestamp(value);

    if (!state.timestamps.sessionStart) state.timestamps.sessionStart = iso;
    if (!state.timestamps.simulationStart) state.timestamps.simulationStart = iso;
    state.timestamps.simulationEnd = iso;

    saveState(state);
  }

  function recordStep(name, meta = {}) {
    const trimmedName = String(name || "").trim();
    if (!trimmedName) return;

    const state = loadState();
    if (!Array.isArray(state.steps)) state.steps = [];
    state.steps.push({ name: trimmedName, ts: nowISO(), meta });
    saveState(state);
  }

  window.labTracking = {
    ...(window.labTracking || {}),
    markSimulationStart,
    markSimulationEnd,
    recordStep
  };
})();
