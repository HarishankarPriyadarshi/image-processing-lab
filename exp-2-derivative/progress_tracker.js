/* File: progress_tracker.js
   Include on every page:
   <script src="./progress_tracker.js"></script>
   <script>VLProgress.initPage();</script>
*/

(function () {
  const KEY = "vlab_exp2_progress_v1";
  const VERSION = 1;

  const nowISO = () => new Date().toISOString();

  const GENERAL_PROGRESS_KEYS = [
    "vlab_exp2_pretest_score",
    "vlab_exp2_pretest_total",
    "vlab_exp2_pretest_attempted_ids",
    "vlab_exp2_pretest_correct_ids",
    "vlab_exp2_pretest_updated_at",
    "vlab_exp2_posttest_score",
    "vlab_exp2_posttest_total",
    "vlab_exp2_posttest_attempted_ids",
    "vlab_exp2_posttest_correct_ids",
    "vlab_exp2_posttest_updated_at",
    "vlab_exp2_simulation_report_html",
    "vlab_exp2_simulation_report_updated_at"
  ];
  const USER_PROGRESS_SUFFIXES = GENERAL_PROGRESS_KEYS.map((key) => key.replace(/^vlab_exp2_/, ""));
  const RESET_LOCAL_STORAGE_KEYS = [
    "vlab_exp2_user_input_draft"
  ];
  const RESET_SESSION_STORAGE_KEYS = [
    "vlab_exp2_current_page",
    "vlab_exp2_page_enter_ms",
    "vlab_exp2_prompted_once"
  ];

  const WINDOW_NAME_PREFIX = "VLAB_EXP2::";

  function safeParse(json, fallback) {
    try {
      const v = JSON.parse(json);
      return v && typeof v === "object" ? v : fallback;
    } catch {
      return fallback;
    }
  }

  function loadWindowNameData() {
    try {
      if (typeof window.name === "string" && window.name.startsWith(WINDOW_NAME_PREFIX)) {
        return safeParse(window.name.slice(WINDOW_NAME_PREFIX.length), {});
      }
    } catch {}
    return {};
  }

  function saveWindowNameData(data) {
    try { window.name = WINDOW_NAME_PREFIX + JSON.stringify(data || {}); } catch {}
  }

  function setWindowNameValues(values) {
    try {
      const current = loadWindowNameData();
      const merged = { ...(current && typeof current === "object" ? current : {}), ...(values || {}) };
      saveWindowNameData(merged);
    } catch {}
  }

  function normalizeEmail(email) {
    if (!email || typeof email !== "string") return "";
    return email.trim().toLowerCase();
  }

  function computeUserHash(email) {
    const normalized = normalizeEmail(email);
    if (!normalized) return "";
    let hash = 0;
    for (let i = 0; i < normalized.length; i++) {
      hash = ((hash << 5) - hash) + normalized.charCodeAt(i);
      hash |= 0;
    }
    return `u${(hash >>> 0).toString(16).padStart(8, "0")}`;
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

  function ensureHistory(state) {
    if (!Array.isArray(state.userHistory)) state.userHistory = [];
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch {}
    const parsed = raw ? safeParse(raw, baseState()) : baseState();

    const merged = { ...baseState(), ...parsed };
    merged.flags = merged.flags || { reportDeclined: false };
    merged.timestamps = merged.timestamps || baseState().timestamps;
    merged.pages = merged.pages || {};
    merged.steps = Array.isArray(merged.steps) ? merged.steps : [];
    merged.userHistory = Array.isArray(merged.userHistory) ? merged.userHistory : [];

    // file:// fallback for user data
    try {
      if (!merged.user || !(merged.user.name && merged.user.email && merged.user.designation)) {
        const wn = loadWindowNameData();
        const name = (wn.vlab_exp2_user_name || "").toString().trim();
        const email = (wn.vlab_exp2_user_email || "").toString().trim();
        const designation = (wn.vlab_exp2_user_designation || "").toString().trim();
        if (name && email && designation) {
          merged.user = { name, email, designation, submittedAt: wn.vlab_exp2_user_submitted_at || nowISO() };
        }
      }
    } catch {}

    return merged;
  }

  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
  }

  function pageName() {
    const p = window.location.pathname.split("/").pop();
    return p || "index.html";
  }

  function ensureSessionStart(state) {
    if (!state.timestamps.sessionStart) state.timestamps.sessionStart = nowISO();
  }

  function formatMs(ms) {
    const totalSec = Math.max(0, Math.floor((ms || 0) / 1000));
    const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
    const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    if (totalSec < 3600) return `${mm} min ${ss} sec`;
    return `${hh} hr ${mm} min ${ss} sec`;
  }

  /* ------------------ PROGRESS REPORT ACCESS GUARD ------------------ */
  function hasSimulationReport() {
    try {
      const activeHash = localStorage.getItem("vlab_exp2_active_user_hash") || "";
      const keys = [];
      if (activeHash) keys.push(`vlab_exp2_user_${activeHash}_simulation_report_html`);
      keys.push("vlab_exp2_simulation_report_html");
      for (const k of keys) {
        const html = localStorage.getItem(k);
        if (html && String(html).trim()) return true;
      }
    } catch {}

    try {
      const PREFIX = "VLAB_EXP2::";
      if (typeof window.name === "string" && window.name.startsWith(PREFIX)) {
        const data = JSON.parse(window.name.slice(PREFIX.length)) || {};
        const html = (data["vlab_exp2_simulation_report_html"] || "").toString();
        if (html.trim()) return true;
      }
    } catch {}
    return false;
  }

  function canAccessProgressReport() {
    return hasUser() && hasSimulationReport();
  }

  const PROGRESS_REPORT_ACCESS_BOTH_MESSAGE =
    "To access the progress report, first fill out the user form and generate the simulation report by performing the experiment.";
  const PROGRESS_REPORT_ACCESS_USER_ONLY_MESSAGE =
    "Please fill out the user form to access the progress report.";
  const PROGRESS_REPORT_ACCESS_SIM_ONLY_MESSAGE =
    "Please generate the simulation report by performing the experiment.";
  const RESET_DATA_CONFIRM_MESSAGE =
    "Reset all saved user data, assessments, timings, and simulation report?";
  const RESET_DATA_REDIRECT_TARGET = "aim.html";

  function getReportBlockMessage(needsUser, needsSim) {
    if (needsUser && needsSim) return PROGRESS_REPORT_ACCESS_BOTH_MESSAGE;
    if (needsUser) return PROGRESS_REPORT_ACCESS_USER_ONLY_MESSAGE;
    if (needsSim) return PROGRESS_REPORT_ACCESS_SIM_ONLY_MESSAGE;
    return PROGRESS_REPORT_ACCESS_BOTH_MESSAGE;
  }

  function showReportBlockMessage(needsUser, needsSim) {
    const msg = getReportBlockMessage(needsUser, needsSim);
    if (typeof window.showAimAlert === "function") window.showAimAlert(msg, "Instructions");
    else window.alert(msg);
  }

  let reportGuardsRegistered = false;
  let resetNavRegistered = false;

  function setReportLinksDisabled(disabled) {
    const links = Array.from(document.querySelectorAll("[data-progress-report-link], a[href*=\"progressreport\"]"));
    const titleText = getReportBlockMessage(!hasUser(), !hasSimulationReport());
    links.forEach((link) => {
      if (disabled) {
        link.classList.add("opacity-70");
        link.setAttribute("title", titleText);
      } else {
        link.classList.remove("opacity-70");
        link.removeAttribute("title");
      }
    });
  }

  function ensureProgressReportState() {
    const disabled = !canAccessProgressReport();
    setReportLinksDisabled(disabled);
  }

  function registerProgressReportGuards() {
    if (reportGuardsRegistered) return;
    reportGuardsRegistered = true;

    const links = Array.from(document.querySelectorAll("[data-progress-report-link], a[href*=\"progressreport\"]"));
    // Force same-tab behaviour
    links.forEach((link) => {
      link.removeAttribute("target");
      link.setAttribute("target", "_self");
    });

    document.addEventListener("click", (event) => {
      const target = event.target.closest("a");
      if (!target) return;
      const href = (target.getAttribute("href") || "").toLowerCase();
      const isProgressLink =
        target.hasAttribute("data-progress-report-link") ||
        href.includes("progressreport") ||
        href === "#progressreport" ||
        href.endsWith("#progressreport");
      if (!isProgressLink) return;

      const needsUser = !hasUser();
      const needsSim = !hasSimulationReport();
      if (!needsUser && !needsSim) return;
      // Do not block navigation; the progressreport page shows its own lock state.
      // We only surface a gentle notice without preventing default.
      showReportBlockMessage(needsUser, needsSim);
    }, true);

    window.addEventListener("storage", ensureProgressReportState);
    window.addEventListener("message", (event) => {
      // Update state if simulation report is generated in another context
      const allowedOrigin = window.location.origin;
      const fromNullOrigin = event.origin === "null";
      if (allowedOrigin !== "null" && event.origin !== allowedOrigin && !fromNullOrigin) return;
      if (event.data && event.data.type === "vlab:simulation_report_generated") {
        ensureProgressReportState();
      }
    });

    // Initial state
    ensureProgressReportState();
  }

  function ensureResetNavStyles() {
    if (document.getElementById("vlab-reset-nav-style")) return;
    const style = document.createElement("style");
    style.id = "vlab-reset-nav-style";
    style.textContent = `
      .top-nav .nav-reset-link {
        appearance: none;
        -webkit-appearance: none;
        background: transparent !important;
        border: 0 !important;
        cursor: pointer;
        display: inline-block;
        font: inherit;
        text-decoration: none;
        white-space: nowrap;
        text-align: left;
      }
      .top-nav .nav-reset-link:hover,
      .top-nav .nav-reset-link:focus {
        color: unset;
      }
      .top-nav .nav-reset-link::after {
        display: block !important;
      }
      .top-nav .nav-reset-link:focus-visible {
        outline: 2px solid #94a3b8;
        outline-offset: 2px;
      }
      .sidebar-mobile-actions {
        display: none;
      }
      .sidebar-mobile-actions .sidebar-section-label {
        padding: 0.5rem 1rem;
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: #64748b;
      }
      .sidebar-mobile-actions .menu-item {
        width: 100%;
      }
      .sidebar-mobile-actions .menu-item svg {
        flex: none;
      }
      @media (max-width: 1023px) {
        .sidebar-mobile-actions {
          display: block;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function performResetDataFlow() {
    const confirmed = window.confirm(RESET_DATA_CONFIRM_MESSAGE);
    if (!confirmed) return;

    resetAll();

    try {
      window.location.href = RESET_DATA_REDIRECT_TARGET;
    } catch {
      window.location.reload();
    }
  }

  function ensureResetNavButton(root = document) {
    const navs = Array.from(root.querySelectorAll ? root.querySelectorAll(".top-nav") : []);
    navs.forEach((nav) => {
      if (nav.querySelector("[data-reset-data-link]")) return;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "nav-link nav-reset-link";
      button.textContent = "Reset Data";
      button.setAttribute("data-reset-data-link", "");
      button.addEventListener("click", performResetDataFlow);
      nav.appendChild(button);
    });
  }

  function createSidebarActionLink(href, label, iconPath) {
    const link = document.createElement("a");
    link.href = href;
    link.className = "menu-item flex items-center px-4 py-3 text-gray-700 rounded-lg group";
    link.innerHTML = `
      <svg class="w-5 h-5 mr-3 opacity-70 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path>
      </svg>
      <span>${label}</span>
    `;
    return link;
  }

  function createSidebarActionButton(label, iconPath) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item flex w-full items-center px-4 py-3 text-gray-700 rounded-lg group text-left";
    button.innerHTML = `
      <svg class="w-5 h-5 mr-3 opacity-70 group-hover:opacity-100" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${iconPath}"></path>
      </svg>
      <span>${label}</span>
    `;
    return button;
  }

  function ensureMobileSidebarActions(root = document) {
    const sideNavs = Array.from(root.querySelectorAll ? root.querySelectorAll("#sidebar nav") : []);
    if (!sideNavs.length) return;

    const topNav = document.querySelector(".top-nav");
    const homeHref =
      topNav?.querySelector("a[href]")?.getAttribute("href") ||
      "../../main.html";
    const userInputHref =
      topNav?.querySelector(".nav-user-link")?.getAttribute("href") ||
      `user_input.html?return=${pageName()}`;

    sideNavs.forEach((nav) => {
      if (nav.querySelector(".sidebar-mobile-actions")) return;

      const wrapper = document.createElement("div");
      wrapper.className = "sidebar-mobile-actions lg:hidden mb-4 pb-4 border-b border-gray-200 space-y-1";

      const label = document.createElement("div");
      label.className = "sidebar-section-label";
      label.textContent = "Quick Access";

      const homeLink = createSidebarActionLink(
        homeHref,
        "Home",
        "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
      );
      const userInputLink = createSidebarActionLink(
        userInputHref,
        "User Input",
        "M5.121 17.804A13.937 13.937 0 0112 16c2.506 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      );
      userInputLink.setAttribute("data-mobile-user-input-link", "");
      const resetButton = createSidebarActionButton(
        "Reset Data",
        "M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 015.03 15m14.389 0H15"
      );
      resetButton.setAttribute("data-mobile-reset-data-link", "");
      resetButton.addEventListener("click", performResetDataFlow);

      wrapper.appendChild(label);
      wrapper.appendChild(homeLink);
      wrapper.appendChild(userInputLink);
      wrapper.appendChild(resetButton);
      nav.insertBefore(wrapper, nav.firstChild);
    });
  }

  function registerResetNavButton() {
    if (resetNavRegistered) return;
    resetNavRegistered = true;

    ensureResetNavStyles();
    ensureResetNavButton(document);
    ensureMobileSidebarActions(document);

    if (typeof MutationObserver !== "function" || !document.body) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (!(node instanceof HTMLElement)) return;
          if (node.matches?.(".top-nav")) ensureResetNavButton(node.parentElement || document);
          else ensureResetNavButton(node);
          ensureMobileSidebarActions(node);
        });
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function initPage() {
    const state = load();
    ensureSessionStart(state);

    const p = pageName();
    const rec = state.pages[p] || { firstEnter: null, lastExit: null, timeMs: 0, visits: 0 };

    if (!rec.firstEnter) rec.firstEnter = nowISO();
    rec.visits += 1;
    state.pages[p] = rec;

    // auto stamps
    if (p === "index.html" && /\/simulation\//.test(window.location.pathname)) {
      if (!state.timestamps.simulationStart) state.timestamps.simulationStart = nowISO();
    }
    if (p === "contributors.html" && !state.timestamps.contributorsVisited) {
      state.timestamps.contributorsVisited = nowISO();
    }

    save(state);

    try {
      sessionStorage.setItem("vlab_exp2_current_page", p);
      sessionStorage.setItem("vlab_exp2_page_enter_ms", String(Date.now()));
    } catch {}
  }

  function recordPageExit() {
    const state = load();

    const p = (() => {
      try { return sessionStorage.getItem("vlab_exp2_current_page") || pageName(); }
      catch { return pageName(); }
    })();

    let enterMs = null;
    try {
      const s = sessionStorage.getItem("vlab_exp2_page_enter_ms");
      enterMs = s ? Number(s) : null;
    } catch {}

    const delta = (enterMs && Number.isFinite(enterMs)) ? (Date.now() - enterMs) : 0;

    const rec = state.pages[p] || { firstEnter: null, lastExit: null, timeMs: 0, visits: 0 };
    rec.timeMs = (rec.timeMs || 0) + Math.max(0, delta);
    rec.lastExit = nowISO();
    state.pages[p] = rec;

    save(state);
  }

  function logStep(name, meta = {}) {
    const state = load();
    ensureSessionStart(state);
    state.steps.push({ name: String(name || "").trim(), ts: nowISO(), meta: meta || {} });
    save(state);
  }

  function recordUserHistory(state, user) {
    const normalizedEmail = normalizeEmail(user?.email);
    if (!normalizedEmail) return false;
    ensureHistory(state);

    const now = nowISO();
    const existing = state.userHistory.find(e => e.email === normalizedEmail);
    if (existing) {
      existing.name = (user?.name || "").trim();
      existing.designation = (user?.designation || "").trim();
      existing.lastSeen = now;
      return false;
    }

    state.userHistory.push({
      email: normalizedEmail,
      name: (user?.name || "").trim(),
      designation: (user?.designation || "").trim(),
      firstSeen: now,
      lastSeen: now
    });

    return true;
  }

  function clearGeneralProgressKeys() {
    try {
      for (const key of GENERAL_PROGRESS_KEYS) localStorage.removeItem(key);
    } catch {}
  }

  function removeUserScopedProgress(userHash) {
    if (!userHash) return;
    const prefix = `vlab_exp2_user_${userHash}_`;
    try {
      for (const suffix of USER_PROGRESS_SUFFIXES) {
        localStorage.removeItem(prefix + suffix);
      }
    } catch {}
  }

  function hasUserScopedProgress(userHash) {
    if (!userHash) return false;
    const prefix = `vlab_exp2_user_${userHash}_`;
    try {
      return USER_PROGRESS_SUFFIXES.some((suffix) => {
        const value = localStorage.getItem(prefix + suffix);
        return !!(value && String(value).trim());
      });
    } catch {
      return false;
    }
  }

  function migrateGeneralProgressKeysToUser(userHash) {
    if (!userHash) return;
    try {
      let movedAny = false;
      const prefix = `vlab_exp2_user_${userHash}_`;

      for (let i = 0; i < GENERAL_PROGRESS_KEYS.length; i++) {
        const key = GENERAL_PROGRESS_KEYS[i];
        const suffix = USER_PROGRESS_SUFFIXES[i];

        const value = localStorage.getItem(key);
        if (!value || !String(value).trim()) continue;

        const destKey = prefix + suffix;

        const existing = localStorage.getItem(destKey);
        if (!existing || !String(existing).trim()) localStorage.setItem(destKey, value);

        movedAny = true;
      }

      if (movedAny) clearGeneralProgressKeys();
    } catch {}
  }

  function setUser(user) {
    const trimmedUser = {
      name: (user?.name || "").trim(),
      email: (user?.email || "").trim(),
      designation: (user?.designation || "").trim()
    };

    const normalizedEmail = normalizeEmail(trimmedUser.email);
    const newHash = normalizedEmail ? computeUserHash(normalizedEmail) : "";

    let prevHash = "";
    try { prevHash = localStorage.getItem("vlab_exp2_active_user_hash") || ""; } catch {}

    const state = load();
    const isNewUserByEmail = recordUserHistory(state, trimmedUser);

    state.user = { ...trimmedUser, submittedAt: nowISO() };
    state.flags.reportDeclined = false;

    try {
      if (newHash) localStorage.setItem("vlab_exp2_active_user_hash", newHash);
      else localStorage.removeItem("vlab_exp2_active_user_hash");
    } catch {}

    if (newHash) {
      const isSameEmail = prevHash && prevHash === newHash;
      const shouldClearStaleScopedProgress =
        !prevHash &&
        isNewUserByEmail &&
        hasUserScopedProgress(newHash);

      if (isSameEmail) {
        clearGeneralProgressKeys();
      }

      if (isSameEmail || shouldClearStaleScopedProgress) {
        removeUserScopedProgress(newHash);
      }

      if (!isSameEmail) {
        if (isNewUserByEmail && prevHash && prevHash !== newHash) clearGeneralProgressKeys();
        migrateGeneralProgressKeysToUser(newHash);
      }
    }

    setWindowNameValues({
      vlab_exp2_user_name: trimmedUser.name,
      vlab_exp2_user_email: trimmedUser.email,
      vlab_exp2_user_designation: trimmedUser.designation,
      vlab_exp2_user_submitted_at: state.user.submittedAt
    });

    save(state);
  }

  function hasUser() {
    const s = load();
    return !!(s.user && s.user.name && s.user.email && s.user.designation);
  }

  function declineReport() {
    const state = load();
    state.flags.reportDeclined = true;
    save(state);
  }

  function clearDecline() {
    const state = load();
    state.flags.reportDeclined = false;
    save(state);
  }

  function mark(key) {
    const state = load();
    state.timestamps = state.timestamps || baseState().timestamps;
    state.timestamps[key] = nowISO();
    save(state);
  }

  function markReportViewed() {
    const state = load();
    if (!state.timestamps.reportViewedAt) state.timestamps.reportViewedAt = nowISO();
    save(state);
  }

  function normalizeTimestamp(value) {
    if (value === undefined || value === null || value === "") return nowISO();
    const numeric = Number(value);
    const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(value);
    if (Number.isNaN(date.getTime())) return nowISO();
    return date.toISOString();
  }

  function markSimulationStart(value) {
    const state = load();
    state.timestamps = state.timestamps || baseState().timestamps;

    const iso = normalizeTimestamp(value);
    if (!state.timestamps.sessionStart) state.timestamps.sessionStart = iso;
    state.timestamps.simulationStart = iso;
    state.timestamps.simulationEnd = null;

    save(state);
  }

  function markSimulationEnd(value) {
    const state = load();
    state.timestamps = state.timestamps || baseState().timestamps;

    const iso = normalizeTimestamp(value);
    if (!state.timestamps.sessionStart) state.timestamps.sessionStart = iso;
    if (!state.timestamps.simulationStart) state.timestamps.simulationStart = iso;
    state.timestamps.simulationEnd = iso;

    save(state);
  }

  function resetAll() {
    let activeHash = "";
    try { activeHash = localStorage.getItem("vlab_exp2_active_user_hash") || ""; } catch {}

    // remove main state
    try { localStorage.removeItem(KEY); } catch {}

    // remove active hash
    try { localStorage.removeItem("vlab_exp2_active_user_hash"); } catch {}

    // remove general keys
    clearGeneralProgressKeys();

    // remove current user-scoped keys for assessments + simulation report
    removeUserScopedProgress(activeHash);

    try {
      for (const key of RESET_LOCAL_STORAGE_KEYS) localStorage.removeItem(key);
    } catch {}

    // session keys
    try {
      for (const key of RESET_SESSION_STORAGE_KEYS) sessionStorage.removeItem(key);
    } catch {}

    // window.name user data
    try {
      const wn = loadWindowNameData();
      delete wn.vlab_exp2_user_name;
      delete wn.vlab_exp2_user_email;
      delete wn.vlab_exp2_user_designation;
      delete wn.vlab_exp2_user_submitted_at;
      delete wn.vlab_exp2_simulation_report_html;
      delete wn.vlab_exp2_simulation_report_updated_at;
      saveWindowNameData(wn);
    } catch {}
  }

  // capture exit
  window.addEventListener("pagehide", recordPageExit);
  window.addEventListener("beforeunload", recordPageExit);

  // Register global progress-report guards once DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", registerProgressReportGuards, { once: true });
    document.addEventListener("DOMContentLoaded", registerResetNavButton, { once: true });
  } else {
    registerProgressReportGuards();
    registerResetNavButton();
  }

  window.VLProgress = {
    initPage,
    recordPageExit,
    logStep,
    setUser,
    hasUser,
    declineReport,
    clearDecline,
    mark,
    markSimulationStart,
    markSimulationEnd,
    markReportViewed,
    getState: load,
    saveState: save,
    formatMs,
    resetAll,
    performResetDataFlow,
    canAccessProgressReport,
    hasSimulationReport,
    getProgressReportBlockMessage: getReportBlockMessage,
    ensureProgressReportState: registerProgressReportGuards
  };
})();
