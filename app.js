import { redact, findLeaks, redactFilename, buildPayload } from './redaction.js';
import {
  AI_PRESETS,
  isGeminiEndpoint,
  detectAiPreset,
  normalizeGeminiModel,
  isSupportedGeminiModelId,
  callAiChat,
  testAiConnection,
  listAiModels,
} from './ai.js';
import {
  THEME_PRESETS,
  ACCENT_PRESETS,
  ACCENT_VAR_NAMES,
  normalizeThemeId,
  normalizeHexColor,
  getThemePreset,
  computeAccentVars,
} from './theme.js';
import {
  stripChatPrefixes,
  buildTrendedLabs,
  resolvePatientFromRelay,
  buildLabRelayMessage,
} from './labs.js';
import {
  DRIP_PRESETS,
  extractClinicalInputs,
  checkDrugInteractions,
  runClinicalAudit,
  calculateDripRate,
  calculatePumpRateFromTargetDose,
} from './clinical.js';
import {
   WHISPER_MODELS,
  mergeTranscriptText,
  applyClinicalAsrCorrections,
  getCachedWhisperModelIds,
  hasCachedWhisperRuntime,
  clearWhisperModelCache,
  createWhisperController,
  createUniversalAudioRecorder,
} from './whisper.js';
import {
  DEFAULT_MORNING_TEMPLATE,
  DEFAULT_TEMPLATE_CONFIG,
  DEFAULT_NORMAL_PE_TEXT,
  MORNING_TEMPLATE_CONFIG,
  compileTemplateConfig,
  renderCustomShiftTemplate,
  buildStructuredShiftUpdate,
  syncFrontmatter,
  parseChartTimeline,
  updateShiftBlock,
  deleteShiftBlock,
  parseChart,
  naturalBedCompare,
  formatRoomLabel,
  computeShiftFluidBalance,
  computeCumulativeFluidBalance,
  togglePendingItem,
  appendShiftBlock,
  appendPendingLineToLatestBlock,
  hasShiftHeadingOnDate,
  removeCategoryFromChartContent,
  extractCarryForwardData,
  buildCarryForwardShiftBlock,
  formatDailyCensusReport,
  formatHandoverReport,
  formatHandoverPlainText,
  formatUpdateText,
  getSyntheticCensusData,
  getTodayDateStrings,
  getDutyDateStrings,
  DEFAULT_SHIFT_SCHEDULE,
  SHIFT_SCHEDULE_PRESETS,
  normalizeShiftTime,
  formatTime24ToLabel,
  normalizeShiftSchedule,
  isInterimShift,
  formatInterimShiftLabel,
  parseShiftTimeTo24h,
  dateStringToIso,
  getShiftForDate,
  createEmptyAdmittingHistory,
  hasAdmittingHistoryContent,
  formatAdmittingHistoryMarkdown,
  parseAdmittingHistoryText,
  extractAdmittingHistory,
  upsertAdmittingHistory,
  classifyDictationShiftByClock,
  extractStandingDictationContext,
  buildClinicalDictationAiPrompt,
  parseAiDictationResponse,
  applyDictationPeCarryover,
  verifyAppendedChart,
} from './census.js';

const DB = 'companion-md', STORE = 'notes';
const $ = (id) => document.getElementById(id);
function uiIcon(name, cls = 'ui-ico') {
  return `<svg class="${cls}" aria-hidden="true"><use href="#ico-${name}"></use></svg>`;
}
let db, currentId = null, notes = [], lastSafe = null;
let currentMode = 'rounds';
let lastRoundsScrollY = 0;
let lastEditedRoundsId = null;
let activeFilter = 'active';
let roundsSortMode = 'bed';
let searchQuery = '';
let editorViewMode = 'timeline';
let timelineDateFilter = 'all';
let timelineSearchQuery = '';
let editingTimelineKey = null;
let librarySearchQuery = '';
let libraryFilter = 'all';
let librarySortMode = 'recent';

const SCRATCH_KEY = 'cm.scratchNotes';
const INBOX_KEY = 'cm.captureInbox';
const BACKUP_AT_KEY = 'cm.lastBackupAt';
const PREFS_COMPACT_KEY = 'cm.roundsCompact';
const PENDING_DRAFT_KEY = 'cm.pendingDraft';
const CUSTOM_CATEGORIES_KEY = 'cm.customCategories';
const SETTINGS_TAB_KEY = 'cm.settingsTab';
const SHIFT_SCHEDULE_KEY = 'cm.shiftSchedule';
const THEME_KEY = 'cm.theme';
const LAST_DARK_THEME_KEY = 'cm.lastDarkTheme';
const ACCENT_KEY = 'cm.accent';
const VALID_SETTINGS_TABS = new Set(['appearance', 'shifts', 'template', 'ai', 'voice', 'storage']);

const RESERVED_CATEGORY_NAMES = new Set([
  'all',
  'active',
  'all active',
  'needs update',
  'open tasks',
  'all charts',
  'discharged',
]);

function normalizeCategoryName(raw) {
  const cleaned = String(raw || '')
    .replace(/[;,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);
  if (!cleaned || RESERVED_CATEGORY_NAMES.has(cleaned.toLowerCase())) return '';
  return cleaned;
}

function dedupeCategoryList(list = []) {
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const norm = normalizeCategoryName(item);
    const key = norm.toLowerCase();
    if (norm && !seen.has(key)) {
      seen.add(key);
      out.push(norm);
    }
  }
  return out;
}

function loadCustomCategories() {
  try {
    const raw = safeGetItem(CUSTOM_CATEGORIES_KEY, '[]');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? dedupeCategoryList(arr) : [];
  } catch {
    return [];
  }
}

let customCategories = loadCustomCategories();
let currentChartCategories = [];

function saveCustomCategories() {
  safeSetItem(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));
}

function syncCategoriesFromNotes(notesList = notes) {
  let changed = false;
  const seen = new Set(customCategories.map((c) => c.toLowerCase()));
  for (const n of notesList || []) {
    const p = parseChart(n.content, n);
    for (const cat of p.categories || []) {
      const norm = normalizeCategoryName(cat);
      const key = norm.toLowerCase();
      if (norm && !seen.has(key)) {
        seen.add(key);
        customCategories.push(norm);
        changed = true;
      }
    }
  }
  if (changed) saveCustomCategories();
}

let scratchNotes = [];
let scratchFilter = 'all';
let scratchSearch = '';
let editingScratchId = null;
let scratchInitialSnapshot = '';

let inboxItems = [];
let inboxSelectedQueueId = null;
let inboxPinnedNoteId = null;
let inboxUserSelectedTarget = false;
let inboxMode = 'labs';
let inboxShift = '6am';
let lastInboxTrended = null;

/* ---------- resilient storage helpers ---------- */
function safeGetItem(key, fallback = '') {
  try {
    const val = localStorage.getItem(key);
    return val === null ? fallback : val;
  } catch {
    return fallback;
  }
}

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    toast(`Device storage full or blocked (${err?.name || 'Error'}). Export a backup now.`);
    return false;
  }
}

function safeRemoveItem(key) {
  try {
    localStorage.removeItem(key);
  } catch {}
}

let roundsCompactMode = safeGetItem(PREFS_COMPACT_KEY, 'false') === 'true';
const expandedCompactIds = new Set();
const rawSavedSettingsTab = safeGetItem(SETTINGS_TAB_KEY, 'appearance');
let activeSettingsTab = VALID_SETTINGS_TABS.has(rawSavedSettingsTab) ? rawSavedSettingsTab : 'appearance';
let currentThemeId = normalizeThemeId(safeGetItem(THEME_KEY, 'midnight'));
let currentAccentHex = normalizeHexColor(safeGetItem(ACCENT_KEY, ''));

const SETTINGS_PANEL_IDS = {
  appearance: 'settingsPanelAppearance',
  shifts: 'settingsPanelShifts',
  template: 'settingsPanelTemplate',
  ai: 'settingsPanelAi',
  voice: 'settingsPanelVoice',
  storage: 'settingsPanelStorage',
};

function loadShiftSchedule() {
  try {
    const raw = safeGetItem(SHIFT_SCHEDULE_KEY, '');
    if (!raw) return DEFAULT_SHIFT_SCHEDULE.map((s) => ({ ...s }));
    return normalizeShiftSchedule(JSON.parse(raw));
  } catch {
    return DEFAULT_SHIFT_SCHEDULE.map((s) => ({ ...s }));
  }
}

let shiftSchedule = loadShiftSchedule();

function saveShiftSchedule(nextSchedule, { reRenderSettings = true } = {}) {
  shiftSchedule = normalizeShiftSchedule(nextSchedule);
  safeSetItem(SHIFT_SCHEDULE_KEY, JSON.stringify(shiftSchedule));
  renderAllShiftPillGroups();
  updateDutyClockUi();
  if (reRenderSettings) renderShiftScheduleSettings();
}

function nowHhMm(now = new Date()) {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function resolveModalShiftHeading(choice, timeInputId) {
  if (choice === 'interim') {
    const customTime = $(timeInputId)?.value || '';
    return formatInterimShiftLabel(new Date(), customTime);
  }
  return choice || defaultShiftForHour();
}

function syncModalInterimTimeUi(choice, wrapId, inputId) {
  const wrap = $(wrapId);
  const input = $(inputId);
  const isInterim = choice === 'interim';
  if (wrap) wrap.hidden = !isInterim;
  if (isInterim && input && !input.value) {
    input.value = nowHhMm();
  }
}

function renderShiftPillGroup(hostId, selectedChoice) {
  const host = $(hostId);
  if (!host) return;
  const slotsHtml = shiftSchedule
    .map((slot) => {
      const active = selectedChoice === slot.label;
      return `<button type="button" class="shift-pill ${active ? 'active' : ''}" data-shift="${esc(slot.label)}" aria-pressed="${active}">${esc(slot.label)}</button>`;
    })
    .join('');
  const interimActive = selectedChoice === 'interim';
  const interimBtn = `<button type="button" class="shift-pill ${interimActive ? 'active' : ''}" data-shift="interim" aria-pressed="${interimActive}" title="Between-shift update for acute events">Interim</button>`;
  host.innerHTML = slotsHtml + interimBtn;
}

function renderAllShiftPillGroups() {
  const fallback = defaultShiftForHour();
  const validLabels = new Set([...shiftSchedule.map((s) => s.label), 'interim']);
  if (!validLabels.has(shiftingChoice)) shiftingChoice = fallback;
  if (!validLabels.has(dictatingShift)) dictatingShift = fallback;
  if (!validLabels.has(inboxShift)) inboxShift = fallback;
  renderShiftPillGroup('shiftPills', shiftingChoice);
  renderShiftPillGroup('voiceShiftPills', dictatingShift);
  renderShiftPillGroup('inboxShiftPills', inboxShift);
}

function renderShiftScheduleSettings() {
  const presetHost = $('shiftPresetBtns');
  const listHost = $('shiftScheduleList');
  const pill = $('shiftSchedulePill');
  if (pill) {
    pill.textContent = `${shiftSchedule.length} shift${shiftSchedule.length === 1 ? '' : 's'}`;
  }
  if (presetHost) {
    const currentKey = JSON.stringify(shiftSchedule);
    presetHost.innerHTML = Object.values(SHIFT_SCHEDULE_PRESETS)
      .map((preset) => {
        const isMatch = JSON.stringify(normalizeShiftSchedule(preset.shifts)) === currentKey;
        return `<button type="button" class="btn sm-btn ${isMatch ? 'primary' : ''}" data-shift-preset="${esc(preset.id)}" aria-pressed="${isMatch}">${esc(preset.name)}</button>`;
      })
      .join('');
  }
  if (listHost) {
    listHost.innerHTML = shiftSchedule
      .map((slot, idx) => {
        const canDel = shiftSchedule.length > 1;
        return `
          <div class="shift-slot-row" data-slot-idx="${idx}">
            <input type="time" class="shift-time-input" value="${esc(slot.time)}" aria-label="Shift ${idx + 1} start time">
            <input type="text" class="shift-label-input" maxlength="20" value="${esc(slot.label)}" placeholder="Label (e.g. 7am)" aria-label="Shift ${idx + 1} label">
            <button type="button" class="btn sm-btn danger shift-slot-del-btn" data-del-idx="${idx}" aria-label="Remove shift ${esc(slot.label)}" ${canDel ? '' : 'disabled'}>${uiIcon('x')}</button>
          </div>`;
      })
      .join('');
  }
  if ($('addShiftSlotBtn')) {
    $('addShiftSlotBtn').disabled = shiftSchedule.length >= 6;
  }
}

function setSettingsTab(tabId, { persist = true, focus = false } = {}) {
  const next = VALID_SETTINGS_TABS.has(tabId) ? tabId : 'appearance';
  activeSettingsTab = next;
  if (persist) {
    safeSetItem(SETTINGS_TAB_KEY, next);
  }

  const subnav = $('settingsSubnav');
  if (subnav) {
    subnav.querySelectorAll('.settings-nav-btn[data-settings-tab]').forEach((btn) => {
      const selected = btn.dataset.settingsTab === next;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
      if (selected && focus) btn.focus();
    });
  }

  for (const [key, panelId] of Object.entries(SETTINGS_PANEL_IDS)) {
    const panel = $(panelId);
    if (panel) panel.hidden = key !== next;
  }

  if (next === 'shifts') {
    renderShiftScheduleSettings();
  } else if (next === 'template') {
    renderTemplateBuilder();
  } else if (next === 'ai') {
    updateApiKeyStatusPill();
  } else if (next === 'storage') {
    refreshStorageAndPwaStatus();
  }
}

function applyAppearance(themeId = currentThemeId, accentHex = currentAccentHex, { persist = true } = {}) {
  const preset = getThemePreset(themeId);
  currentThemeId = preset.id;
  currentAccentHex = normalizeHexColor(accentHex);

  const root = document.documentElement;
  root.dataset.theme = preset.id;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', preset.themeColor);

  const accentVars = currentAccentHex ? computeAccentVars(currentAccentHex, preset.mode) : null;
  if (accentVars) {
    for (const [varName, value] of Object.entries(accentVars)) {
      root.style.setProperty(varName, value);
    }
  } else {
    for (const varName of ACCENT_VAR_NAMES) {
      root.style.removeProperty(varName);
    }
  }

  if (persist) {
    safeSetItem(THEME_KEY, preset.id);
    if (preset.mode === 'dark') {
      safeSetItem(LAST_DARK_THEME_KEY, preset.id);
    }
    if (currentAccentHex) {
      safeSetItem(ACCENT_KEY, currentAccentHex);
    } else {
      safeRemoveItem(ACCENT_KEY);
    }
  }

  if ($('themeStatusPill')) {
    $('themeStatusPill').textContent = currentAccentHex ? `${preset.name} · Custom Accent` : preset.name;
  }

  const quickBtn = $('quickThemeToggleBtn');
  if (quickBtn) {
    const isLight = preset.mode === 'light';
    quickBtn.innerHTML = uiIcon(isLight ? 'moon' : 'sun');
    const nextLabel = isLight ? 'Switch to dark theme' : 'Switch to Daylight Ward theme';
    quickBtn.title = nextLabel;
    quickBtn.setAttribute('aria-label', nextLabel);
  }

  if ($('themePaletteGrid')) {
    $('themePaletteGrid').querySelectorAll('.theme-swatch-card').forEach((card) => {
      card.setAttribute('aria-checked', String(card.dataset.themeId === preset.id));
    });
  }

  if ($('accentPresetsRow')) {
    $('accentPresetsRow').querySelectorAll('.accent-dot').forEach((dot) => {
      dot.classList.toggle('active', Boolean(currentAccentHex) && dot.dataset.accent === currentAccentHex);
    });
  }

  if ($('customAccentInput')) {
    $('customAccentInput').value = currentAccentHex || preset.swatches[2];
  }
  if ($('resetAccentBtn')) {
    $('resetAccentBtn').disabled = !currentAccentHex;
  }
}

function renderAppearanceControls() {
  const grid = $('themePaletteGrid');
  if (grid) {
    grid.innerHTML = THEME_PRESETS.map((preset) => {
      const checked = preset.id === currentThemeId ? 'true' : 'false';
      const dots = preset.swatches
        .map((c) => `<span class="theme-swatch-dot" style="background:${c}"></span>`)
        .join('');
      return `
        <button type="button" class="theme-swatch-card" role="radio" aria-checked="${checked}" data-theme-id="${preset.id}">
          <span class="theme-swatch-dots" aria-hidden="true">${dots}</span>
          <span class="theme-swatch-meta">
            <span class="theme-swatch-name">${esc(preset.name)}</span>
            <span class="theme-swatch-mode">${preset.mode === 'light' ? 'Light · High Brightness' : 'Dark · Night Duty'}</span>
          </span>
        </button>`;
    }).join('');
  }

  const row = $('accentPresetsRow');
  if (row) {
    row.innerHTML = ACCENT_PRESETS.map((a) => `
      <button type="button" class="accent-dot" data-accent="${a.hex}" title="${esc(a.name)}" aria-label="Accent color ${esc(a.name)}" style="background:${a.hex}"></button>
    `).join('');
  }
}

function initAppearanceSettings() {
  renderAppearanceControls();
  applyAppearance(currentThemeId, currentAccentHex, { persist: false });

  if ($('themePaletteGrid')) {
    $('themePaletteGrid').addEventListener('click', (e) => {
      const card = e.target.closest('.theme-swatch-card[data-theme-id]');
      if (!card) return;
      applyAppearance(card.dataset.themeId, currentAccentHex, { persist: true });
    });
  }

  if ($('accentPresetsRow')) {
    $('accentPresetsRow').addEventListener('click', (e) => {
      const dot = e.target.closest('.accent-dot[data-accent]');
      if (!dot) return;
      applyAppearance(currentThemeId, dot.dataset.accent, { persist: true });
    });
  }

  if ($('customAccentInput')) {
    $('customAccentInput').addEventListener('input', (e) => {
      const val = normalizeHexColor(e.target.value);
      if (val) applyAppearance(currentThemeId, val, { persist: true });
    });
  }

  if ($('resetAccentBtn')) {
    $('resetAccentBtn').addEventListener('click', () => {
      applyAppearance(currentThemeId, '', { persist: true });
    });
  }

  if ($('quickThemeToggleBtn')) {
    $('quickThemeToggleBtn').addEventListener('click', () => {
      const cur = getThemePreset(currentThemeId);
      if (cur.mode === 'light') {
        const lastDark = normalizeThemeId(safeGetItem(LAST_DARK_THEME_KEY, 'midnight'));
        const targetDark = getThemePreset(lastDark).mode === 'dark' ? lastDark : 'midnight';
        applyAppearance(targetDark, currentAccentHex, { persist: true });
      } else {
        applyAppearance('daylight', currentAccentHex, { persist: true });
      }
    });
  }
}
let dirtyChart = false;
let chartAutosaveTimer = null;
const undoStacks = new Map();
let lastSavedChartContent = '';
let companionStale = false;
let activeModalEl = null;
let modalTriggerEl = null;
let swWaitingWorker = null;
let swRegistration = null;
let lastSwUpdateCheckAt = 0;
let storageRiskDismissed = false;
let pendingRestorePayload = null;
let recordedAudioUrl = null;
let stagedVoiceSoap = '';
let screenWakeLock = null;
let voiceRecordingInterrupted = false;
let voiceInterruptNote = '';
let calcUserTouchedDrip = false;
let calcChartHasDrip = false;
let shiftPreviewDirty = false;
let lastDutyKey = '';

/* ---------- local storage (IndexedDB) ---------- */
function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) {
        r.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    r.onsuccess = () => {
      const database = r.result;
      database.onversionchange = () => {
        database.close();
        toast('Another tab updated local storage — reload to stay in sync');
      };
      resolve(database);
    };
    r.onerror = () => reject(r.error);
  });
}

function put(note) {
  return new Promise((res, rej) => {
    if (!db) return rej(new Error('IndexedDB unavailable'));
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).put(note);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

function remove(id) {
  return new Promise((res, rej) => {
    if (!db) return rej(new Error('IndexedDB unavailable'));
    const t = db.transaction(STORE, 'readwrite');
    t.objectStore(STORE).delete(id);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

function all() {
  return new Promise((res, rej) => {
    if (!db) return res([]);
    const q = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    q.onsuccess = () => res(q.result.sort((a, b) => b.updated - a.updated));
    q.onerror = () => rej(q.error);
  });
}

/* ---------- helpers & date formatting ---------- */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function isoToMmDdYyyy(iso) {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}-${m[3]}-${m[1]}` : '';
}

function mmDdYyyyToIso(mmdd) {
  const m = String(mmdd || '').trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function getDefaultDutyIsoForShift(shiftChoice) {
  const duty = getDutyDateStrings(new Date(), shiftSchedule);
  const slot = shiftSchedule.find((s) => s.label === String(shiftChoice || '').trim());
  const hour = slot ? parseInt(slot.time.slice(0, 2), 10) : -1;
  if (duty.isPostMidnightCarryover && (hour >= 18 || (!slot && /^10\s*pm$/i.test(String(shiftChoice || ''))))) {
    return duty.yyyymmdd;
  }
  return getTodayDateStrings().yyyymmdd;
}

const profile = () => ({
  name: $('nameInput').value.trim(),
  aliases: $('aliasesInput').value.split(',').map((s) => s.trim()).filter(Boolean),
  room: $('roomInput').value.trim(),
});

function metaOf(text) {
  const m = String(text).match(/^---\s*\n([\s\S]*?)\n---/);
  const out = {};
  if (m) {
    for (const line of m[1].split('\n')) {
      const p = line.match(/^([^:]+):\s*(.*)$/);
      if (p) out[p[1].trim().toLowerCase()] = p[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return out;
}

function toast(msg, opts = {}) {
  const t = $('toast');
  if (!t) return;
  clearTimeout(toast._t);
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);

  if (typeof opts.onUndo === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'toast-undo-btn';
    btn.textContent = opts.undoLabel || 'Undo';
    btn.onclick = async () => {
      clearTimeout(toast._t);
      t.hidden = true;
      await opts.onUndo();
    };
    t.appendChild(btn);
  }

  t.hidden = false;
  const duration = opts.duration || (opts.onUndo ? 5200 : 2600);
  toast._t = setTimeout(() => {
    t.hidden = true;
  }, duration);
}

function download(name, text, type = 'text/markdown') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

async function shareOrDownload({
  filename,
  text,
  mimeType = 'text/markdown',
  title = '',
  allowTextShare = false,
}) {
  const isCoarse = Boolean(window.matchMedia?.('(pointer: coarse)').matches);
  if (isCoarse && typeof navigator.share === 'function') {
    try {
      if (typeof File === 'function' && typeof navigator.canShare === 'function') {
        const shareMime = mimeType === 'text/markdown' ? 'text/plain' : mimeType;
        const file = new File([text], filename, { type: shareMime });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ title: title || filename, files: [file] });
          return true;
        }
      }
      if (allowTextShare) {
        await navigator.share({ title: title || filename, text });
        return true;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return false;
    }
  }
  download(filename, text, mimeType);
  return true;
}

/* ---------- dirty state, undo stack, autosave & modal controller ---------- */
function updateSaveStatusPill(state = 'saved') {
  const pill = $('saveStatusPill');
  if (!pill) return;
  if (state === 'saving') {
    pill.innerHTML = `${uiIcon('refresh')} Saving…`;
    pill.className = 'pill';
  } else if (state === 'unsaved') {
    pill.textContent = 'Unsaved';
    pill.className = 'pill warn';
  } else {
    pill.innerHTML = `${uiIcon('check')} Saved`;
    pill.className = 'pill safe';
  }
}

function updateUndoButton() {
  const btn = $('undoChartBtn');
  if (!btn) return;
  const stack = currentId ? undoStacks.get(currentId) || [] : [];
  btn.disabled = stack.length === 0;
}

function pushUndoSnapshot(noteId, snapshot) {
  if (!noteId || typeof snapshot !== 'string') return;
  const stack = undoStacks.get(noteId) || [];
  if (stack.length && stack[stack.length - 1] === snapshot) return;
  stack.push(snapshot);
  if (stack.length > 25) stack.shift();
  undoStacks.set(noteId, stack);
  if (noteId === currentId) updateUndoButton();
}

function markChartDirty() {
  if (!currentId) return;
  const currentContent = $('noteText').value;
  if (currentContent !== lastSavedChartContent) {
    pushUndoSnapshot(currentId, lastSavedChartContent);
    lastSavedChartContent = currentContent;
  }
  dirtyChart = true;
  updateSaveStatusPill('unsaved');
  markCompanionStale();
  clearTimeout(chartAutosaveTimer);
  chartAutosaveTimer = setTimeout(() => {
    if (dirtyChart && currentId) {
      updateSaveStatusPill('saving');
      saveCurrent(null, { silent: true }).catch(() => updateSaveStatusPill('unsaved'));
    }
  }, 650);
}

async function flushPendingChartSave() {
  clearTimeout(chartAutosaveTimer);
  if (!currentId) return;
  const activeInlineTa = $('chartTimelineList')?.querySelector('.tl-edit-textarea');
  if (activeInlineTa && editingTimelineKey) {
    const saveEntryBtn = $('chartTimelineList')?.querySelector('.tl-save-entry-btn');
    if (saveEntryBtn) {
      const inlineCard = saveEntryBtn.closest('.timeline-inline-edit');
      const { nextDate, nextShift } = resolveTimelineEditMeta(
        inlineCard,
        saveEntryBtn.dataset.date,
        saveEntryBtn.dataset.origShift
      );
      const res = updateShiftBlock($('noteText').value, {
        targetDate: saveEntryBtn.dataset.date,
        dateOccurrenceIndex: Number(saveEntryBtn.dataset.dateIdx || 0),
        shiftOccurrenceIndex: Number(saveEntryBtn.dataset.shiftIdx),
        newBody: activeInlineTa.value,
        newDate: nextDate,
        newShift: nextShift,
      });
      if (res.modified) {
        $('noteText').value = res.text;
        dirtyChart = true;
      }
      editingTimelineKey = null;
    }
  }
  if (dirtyChart) {
    await saveCurrent(null, { silent: true });
  }
}

function markCompanionStale() {
  const gp = $('guardPill');
  if (!gp) return;
  if (!companionStale && gp.textContent !== 'CHECKING') {
    companionStale = true;
    gp.textContent = 'REBUILD NEEDED';
    gp.className = 'pill warn';
    $('copyBtn').disabled = true;
    $('sendBtn').disabled = true;
    lastSafe = null;
  }
}

function updateBackupReminderUi() {
  const pill = $('backupReminderPill');
  if (!pill) return;
  if (!notes.length) {
    pill.hidden = true;
    return;
  }
  const lastAt = Number(safeGetItem(BACKUP_AT_KEY, '0'));
  const hoursSince = lastAt ? (Date.now() - lastAt) / 3600000 : Infinity;
  pill.hidden = hoursSince < 24;
  pill.title = lastAt
    ? `Last backup was ${Math.round(hoursSince)}h ago — tap to back up`
    : 'No full workspace backup yet — tap to back up';
}

function persistRecoveryDraftSync() {
  try {
    const activeInlineTa = $('chartTimelineList')?.querySelector('.tl-edit-textarea');
    let chartDraft = null;
    if (currentId && dirtyChart) {
      chartDraft = {
        id: currentId,
        text: $('noteText')?.value || '',
        savedAt: Date.now(),
      };
    } else if (currentId && activeInlineTa && editingTimelineKey) {
      const saveEntryBtn = $('chartTimelineList')?.querySelector('.tl-save-entry-btn');
      if (saveEntryBtn) {
        const inlineCard = saveEntryBtn.closest('.timeline-inline-edit');
        const { nextDate, nextShift } = resolveTimelineEditMeta(
          inlineCard,
          saveEntryBtn.dataset.date,
          saveEntryBtn.dataset.origShift
        );
        const res = updateShiftBlock($('noteText').value, {
          targetDate: saveEntryBtn.dataset.date,
          dateOccurrenceIndex: Number(saveEntryBtn.dataset.dateIdx || 0),
          shiftOccurrenceIndex: Number(saveEntryBtn.dataset.shiftIdx),
          newBody: activeInlineTa.value,
          newDate: nextDate,
          newShift: nextShift,
        });
        if (res.modified) {
          chartDraft = { id: currentId, text: res.text, savedAt: Date.now() };
        }
      }
    }

    let scratchDraft = null;
    if (!$('scratchEditorCard')?.hidden && isScratchEditorDirty()) {
      scratchDraft = {
        id: editingScratchId,
        title: $('scratchTitleInput')?.value || '',
        category: $('scratchCategoryInput')?.value || 'Scratchpad',
        pinned: Boolean($('scratchPinnedInput')?.checked),
        body: $('scratchBodyInput')?.value || '',
        savedAt: Date.now(),
      };
    }

    if (chartDraft || scratchDraft) {
      localStorage.setItem(PENDING_DRAFT_KEY, JSON.stringify({ chartDraft, scratchDraft }));
    }
  } catch {}
}

function clearRecoveryDraft(kind = 'all') {
  if (kind === 'all') {
    safeRemoveItem(PENDING_DRAFT_KEY);
    return;
  }
  try {
    const raw = safeGetItem(PENDING_DRAFT_KEY, '');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return safeRemoveItem(PENDING_DRAFT_KEY);
    if (kind === 'chart') delete parsed.chartDraft;
    if (kind === 'scratch') delete parsed.scratchDraft;
    if (!parsed.chartDraft && !parsed.scratchDraft) safeRemoveItem(PENDING_DRAFT_KEY);
    else safeSetItem(PENDING_DRAFT_KEY, JSON.stringify(parsed));
  } catch {
    safeRemoveItem(PENDING_DRAFT_KEY);
  }
}

function restorePendingRecoveryDraftsIfNeeded() {
  try {
    const raw = safeGetItem(PENDING_DRAFT_KEY, '');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') {
      safeRemoveItem(PENDING_DRAFT_KEY);
      return;
    }

    const chartDraft = data.chartDraft;
    const chartTarget = chartDraft?.id ? notes.find((n) => n.id === chartDraft.id) : null;
    const hasChartDiff = Boolean(
      chartTarget && typeof chartDraft.text === 'string' && chartDraft.text !== (chartTarget.content || '')
    );

    const scratchDraft = data.scratchDraft;
    const hasScratchDraft = Boolean(
      scratchDraft && (String(scratchDraft.title || '').trim() || String(scratchDraft.body || '').trim())
    );

    if (!hasChartDiff && !hasScratchDraft) {
      safeRemoveItem(PENDING_DRAFT_KEY);
      return;
    }

    toast('Recovered unsaved draft from backgrounding', {
      undoLabel: 'Restore Draft',
      duration: 9500,
      onUndo: async () => {
        if (hasChartDiff && chartTarget) {
          await select(chartTarget.id, { skipFlush: true });
          $('noteText').value = chartDraft.text;
          markChartDirty();
          await setMode('editor');
          setEditorView('raw');
          toast('Restored unsaved chart draft — tap Save or review changes');
        } else if (hasScratchDraft) {
          await setMode('scratch');
          openScratchEditor(scratchDraft.id || null);
          $('scratchTitleInput').value = scratchDraft.title || '';
          $('scratchCategoryInput').value = scratchDraft.category || 'Scratchpad';
          $('scratchPinnedInput').checked = Boolean(scratchDraft.pinned);
          $('scratchBodyInput').value = scratchDraft.body || '';
          toast('Restored unsaved Quick Note draft');
        }
        safeRemoveItem(PENDING_DRAFT_KEY);
      },
    });
  } catch {
    safeRemoveItem(PENDING_DRAFT_KEY);
  }
}

function formatBytesCompact(bytes) {
  const n = Number(bytes || 0);
  if (!n || n < 1024) return `${Math.round(n)} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

async function refreshStorageAndPwaStatus({ requestPersist = false } = {}) {
  let persisted = null;
  try {
    if (navigator.storage?.persisted) {
      persisted = await navigator.storage.persisted();
    }
    if (!persisted && requestPersist && navigator.storage?.persist) {
      persisted = await navigator.storage.persist();
    }
  } catch {}

  let est = null;
  try {
    est = await navigator.storage?.estimate?.();
  } catch {}

  const isStandalone =
    Boolean(window.matchMedia?.('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
  const isCoarseMobile = Boolean(window.matchMedia?.('(pointer: coarse)').matches);

  const persistPill = $('storagePersistPill');
  if (persistPill) {
    if (persisted === true) {
      persistPill.textContent = 'PERSISTENT';
      persistPill.className = 'pill safe';
    } else if (persisted === false) {
      persistPill.textContent = 'BEST-EFFORT';
      persistPill.className = 'pill warn';
    } else {
      persistPill.textContent = 'LOCAL ONLY';
      persistPill.className = 'pill';
    }
  }

  if ($('storageQuotaText')) {
    $('storageQuotaText').textContent =
      est && typeof est.usage === 'number'
        ? `${formatBytesCompact(est.usage)} used${est.quota ? ` of ${formatBytesCompact(est.quota)}` : ''}`
        : 'Unavailable in this browser';
  }

  if ($('pwaInstallStatusText')) {
    $('pwaInstallStatusText').textContent = isStandalone
      ? 'Installed PWA (Standalone)'
      : 'Browser Tab (Add to Home Screen recommended)';
  }

  const swStatusEl = $('swUpdateStatusText');
  if (swStatusEl) {
    if (swWaitingWorker) {
      swStatusEl.textContent = 'Update downloaded — tap Reload Safely';
    } else if (navigator.serviceWorker?.controller) {
      swStatusEl.textContent = 'Active offline cache ready';
    } else {
      swStatusEl.textContent = 'Standard browser mode';
    }
  }

  const riskBanner = $('storageRiskBanner');
  if (riskBanner) {
    riskBanner.hidden =
      storageRiskDismissed ||
      !notes.length ||
      persisted === true ||
      isStandalone ||
      !isCoarseMobile;
  }
}

function updateNetworkStatusUi() {
  const pill = $('offlinePill');
  if (pill) pill.hidden = navigator.onLine !== false;
}

function updateDutyClockUi() {
  const el = $('roundsShiftClock');
  if (!el) return;
  const duty = getDutyDateStrings(new Date(), shiftSchedule);
  const today = getTodayDateStrings();
  const shift = duty.shiftLabel || defaultShiftForHour();
  const dutyKey = `${duty.mmddyyyy}:${shift}`;
  el.textContent = duty.isPostMidnightCarryover
    ? `Duty Date: ${duty.mmddyyyy} (${shift} post-midnight) · Calendar: ${today.mmddyyyy}`
    : `Duty Date: ${today.mmddyyyy} · Shift Window: ${shift}`;
  if (lastDutyKey && lastDutyKey !== dutyKey && currentMode === 'rounds') {
    renderRounds();
  }
  lastDutyKey = dutyKey;
}

function getFocusableInModal(modalEl) {
  if (!modalEl) return [];
  return [...modalEl.querySelectorAll(
    'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [href], [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null || el.getClientRects().length > 0);
}

function syncVisualViewportVars() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const offsetTop = vv ? vv.offsetTop : 0;
  const kbInset = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
  const root = document.documentElement;
  root.style.setProperty('--vvh', `${Math.round(height)}px`);
  root.style.setProperty('--vvt', `${Math.round(offsetTop)}px`);
  root.style.setProperty('--kb-inset', `${Math.round(kbInset)}px`);
  root.classList.toggle('kb-open', kbInset > 120);
}

function setBackgroundInert(isInert) {
  const hdr = document.querySelector('header');
  const mainEl = document.querySelector('main');
  if (hdr) hdr.inert = isInert;
  if (mainEl) mainEl.inert = isInert;
}

function openModalEl(modalEl, triggerEl = null, initialFocusEl = null) {
  if (!modalEl) return;
  modalTriggerEl = triggerEl || document.activeElement;
  activeModalEl = modalEl;
  modalEl.hidden = false;
  document.documentElement.classList.add('modal-open');
  syncVisualViewportVars();
  setBackgroundInert(true);
  requestAnimationFrame(() => {
    const isCoarse = window.matchMedia?.('(pointer: coarse)').matches;
    let target = initialFocusEl;
    if (isCoarse && target?.tagName === 'TEXTAREA') {
      const box = modalEl.querySelector('.modal-box');
      if (box) {
        if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
        target = box;
      }
    }
    target = target || getFocusableInModal(modalEl)[0];
    target?.focus?.();
  });
}

function closeModalEl(modalEl = activeModalEl) {
  if (!modalEl) return;
  modalEl.hidden = true;
  if (activeModalEl === modalEl) {
    activeModalEl = null;
    document.documentElement.classList.remove('modal-open');
    setBackgroundInert(false);
    modalTriggerEl?.focus?.();
    modalTriggerEl = null;
  }
}

async function copyTextWithFallback(
  text,
  successMsg = 'Copied to clipboard',
  fallbackTitle = 'Manual Copy'
) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      toast(successMsg);
      return true;
    }
  } catch {}

  try {
    const ta = document.createElement('textarea');
    ta.value = value;
    ta.readOnly = true;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.fontSize = '16px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, value.length);
    const copied = typeof document.execCommand === 'function' && document.execCommand('copy');
    document.body.removeChild(ta);
    if (copied) {
      toast(successMsg);
      return true;
    }
  } catch {}

  const modalEl = $('manualCopyModal');
  if (modalEl && $('manualCopyText')) {
    if ($('manualCopyHeading')) $('manualCopyHeading').innerHTML = `${uiIcon('clipboard-list')} ${esc(fallbackTitle)}`;
    $('manualCopyText').value = value;
    openModalEl(modalEl, document.activeElement, $('manualCopySelectBtn'));
    return false;
  }
  toast('Clipboard copy unavailable');
  return false;
}

/* ---------- view switcher ---------- */
async function setMode(mode) {
  if (currentMode === 'rounds' && mode !== 'rounds') {
    lastRoundsScrollY = window.scrollY;
  }
  if (currentMode === 'editor' && mode !== 'editor') {
    await flushPendingChartSave();
  }
  if (mode === 'editor' && currentId) {
    lastEditedRoundsId = currentId;
  }
  currentMode = mode;
  document.body.classList.toggle('mode-editor', mode === 'editor');
  $('roundsSection').hidden = mode !== 'rounds';
  $('editorSection').hidden = mode !== 'editor';
  $('librarySection').hidden = mode !== 'library';
  $('scratchSection').hidden = mode !== 'scratch';
  $('settingsSection').hidden = mode !== 'settings';

  const navMap = [
    ['navRoundsBtn', 'rounds'],
    ['navEditorBtn', 'editor'],
    ['navLibraryBtn', 'library'],
    ['navScratchBtn', 'scratch'],
    ['navSettingsBtn', 'settings'],
  ];
  for (const [id, key] of navMap) {
    const active = mode === key;
    $(id).classList.toggle('active', active);
    $(id).setAttribute('aria-pressed', String(active));
  }

  if (mode === 'rounds') {
    $('shieldStatus').textContent = 'LOCAL ONLY';
    $('shieldStatus').className = 'pill';
    renderRounds();
    requestAnimationFrame(() => {
      const card = lastEditedRoundsId
        ? document.querySelector(`.scut-card[data-id="${CSS.escape(lastEditedRoundsId)}"]`)
        : null;
      if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'auto', block: 'nearest' });
      } else {
        window.scrollTo(0, lastRoundsScrollY || 0);
      }
    });
  } else if (mode === 'editor') {
    updateEditorEmptyAndNav();
    updateCompanionConnHint();
  } else if (mode === 'library') {
    renderList();
  } else if (mode === 'scratch') {
    renderScratchNotes();
  } else if (mode === 'settings') {
    setSettingsTab(activeSettingsTab, { persist: false });
  }
}

/* ---------- rounds (scutsheet) UI ---------- */
function setActiveRoundsFilter(nextFilter) {
  activeFilter = nextFilter;
  renderRoundsFilterChips();
  document.querySelectorAll('.census-summary .stat-card').forEach((card) => {
    card.setAttribute('aria-pressed', String(card.dataset.statFilter === activeFilter));
  });
  renderRounds();
}

function renderRoundsFilterChips(parsedPatients = null) {
  const host = $('roundsFilterChips');
  if (!host) return;
  const parsed =
    parsedPatients ||
    notes.map((n) => ({
      ...parseChart(n.content, n),
      id: n.id,
      rawNote: n,
    }));

  const active = parsed.filter((p) => p.isCensus && !p.isCharity);
  const needsUpdateCount = active.filter((p) => !p.isUpdatedToday).length;
  const openTasksCardsCount = active.filter((p) => p.pending.some((t) => !t.checked)).length;

  const mkStaticChip = (filterKey, label, countId, countVal) => {
    const isAct = activeFilter === filterKey;
    return `<button type="button" class="chip ${isAct ? 'active' : ''}" data-filter="${esc(filterKey)}" aria-pressed="${isAct}">${label} <span class="chip-count" id="${countId}">${countVal}</span></button>`;
  };

  const customHtml = customCategories
    .map((cat) => {
      const catLower = cat.toLowerCase();
      const filterKey = `cat:${catLower}`;
      const isAct = activeFilter === filterKey;
      const count = parsed.filter((p) =>
        (p.categories || []).some((c) => c.toLowerCase() === catLower)
      ).length;
      return `
        <div class="chip-group ${isAct ? 'active' : ''}">
          <button type="button" class="chip ${isAct ? 'active' : ''}" data-filter="${esc(filterKey)}" aria-pressed="${isAct}">${esc(cat)} <span class="chip-count">${count}</span></button>
          <button type="button" class="chip-del-btn" data-del-cat="${esc(cat)}" aria-label="Remove ${esc(cat)} category" title="Remove ${esc(cat)}">${uiIcon('x')}</button>
        </div>`;
    })
    .join('');

  host.innerHTML = [
    mkStaticChip('active', 'All Active', 'chipCountActive', active.length),
    mkStaticChip('needs-update', `${uiIcon('alert')} Needs Update`, 'chipCountNeedsUpdate', needsUpdateCount),
    mkStaticChip('open-tasks', `${uiIcon('pin')} Open Tasks`, 'chipCountOpenTasks', openTasksCardsCount),
    customHtml,
    mkStaticChip('all', 'All Charts', 'chipCountAll', parsed.length),
    `<button type="button" id="addRoundsCategoryBtn" class="chip add-cat-chip" title="Create a custom patient category tab">${uiIcon('plus')} Tab</button>`,
  ].join('');

  host.querySelectorAll('.chip[data-filter]').forEach((chip) => {
    chip.onclick = () => setActiveRoundsFilter(chip.dataset.filter || 'active');
  });
  host.querySelectorAll('.chip-del-btn[data-del-cat]').forEach((btn) => {
    btn.onclick = () => removeCustomCategory(btn.dataset.delCat);
  });
  const addBtn = $('addRoundsCategoryBtn');
  if (addBtn) {
    addBtn.onclick = () => {
      const form = $('roundsAddCatForm');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) {
        $('roundsAddCatInput').value = '';
        $('roundsAddCatInput').focus();
      }
    };
  }
}

function getFilteredSortedRoundsPatients(parsedPatients = null) {
  const list =
    parsedPatients ||
    notes.map((n) => ({
      ...parseChart(n.content, n),
      id: n.id,
      rawNote: n,
    }));

  let filtered = list;
  if (activeFilter === 'active') {
    filtered = filtered.filter((p) => p.isCensus && !p.isCharity);
  } else if (activeFilter === 'needs-update') {
    filtered = filtered.filter((p) => p.isCensus && !p.isCharity && !p.isUpdatedToday);
  } else if (activeFilter === 'open-tasks') {
    filtered = filtered.filter((p) => p.isCensus && !p.isCharity && p.pending.some((t) => !t.checked));
  } else if (activeFilter === 'charity') {
    filtered = filtered.filter((p) => p.isCharity);
  } else if (activeFilter.startsWith('cat:')) {
    const targetLower = activeFilter.slice(4);
    filtered = filtered.filter((p) =>
      (p.categories || []).some((c) => c.toLowerCase() === targetLower)
    );
  }

  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase().trim();
    filtered = filtered.filter((p) => {
      const hay = [
        p.room,
        p.name,
        ...(p.aliases || []),
        p.assessment,
        p.service,
        p.ap,
        p.drips,
        p.labs,
        ...(p.medications || []),
        ...(p.pending || []).map((t) => t.text),
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  }

  filtered.sort((a, b) => {
    if (roundsSortMode === 'needs-update') {
      const staleDiff = Number(!a.isUpdatedToday) - Number(!b.isUpdatedToday);
      if (staleDiff !== 0) return -staleDiff;
    } else if (roundsSortMode === 'open-tasks') {
      const openA = a.pending.filter((t) => !t.checked).length;
      const openB = b.pending.filter((t) => !t.checked).length;
      if (openA !== openB) return openB - openA;
    } else if (roundsSortMode === 'ap') {
      const cmp = (a.ap || 'zzz').localeCompare(b.ap || 'zzz');
      if (cmp !== 0) return cmp;
    }
    return naturalBedCompare(a.room, b.room);
  });

  return filtered;
}

function renderRounds() {
  const container = $('roundsGrid');
  container.classList.toggle('compact-grid', roundsCompactMode);
  if ($('roundsSection')) $('roundsSection').classList.toggle('compact-mode', roundsCompactMode);
  updateDutyClockUi();
  if ($('roundsSortSelect')) $('roundsSortSelect').value = roundsSortMode;
  if ($('roundsCompactBtn')) {
    $('roundsCompactBtn').classList.toggle('active', roundsCompactMode);
    $('roundsCompactBtn').setAttribute('aria-pressed', String(roundsCompactMode));
  }
  const sampleBtn = $('loadSyntheticBtn');
  if (sampleBtn) sampleBtn.hidden = notes.length > 0;

  if (!notes.length) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px 20px; color: var(--mut);">
        <p style="font-size: 16px; margin-bottom: 8px;">No patient charts yet on this device.</p>
        <p style="font-size: 13px; margin-bottom: 16px;">Add a new patient or load the synthetic demo census to test rounds mode.</p>
        <button type="button" id="emptyLoadBtn" class="primary" style="margin-right: 8px;">Load Sample Census</button>
        <button type="button" id="emptyNewBtn" class="btn">+ Add Patient</button>
      </div>`;
    const emptyLoad = $('emptyLoadBtn'), emptyNew = $('emptyNewBtn');
    if (emptyLoad) emptyLoad.onclick = loadSampleCensus;
    if (emptyNew) emptyNew.onclick = newNoteAndEdit;
    updateCensusStats([]);
    return;
  }

  const parsedPatients = notes.map((n) => ({
    ...parseChart(n.content, n),
    id: n.id,
    rawNote: n,
  }));

  updateCensusStats(parsedPatients);

  const filtered = getFilteredSortedRoundsPatients(parsedPatients);

  if (!filtered.length) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 30px; color: var(--mut);">
        No patients match the current filter (${esc(activeFilter)}) or search.
      </div>`;
    return;
  }

  container.innerHTML = filtered
    .map((pt) => {
      const isStale = pt.isCensus && !pt.isCharity && !pt.isUpdatedToday;
      let statusTag = '';
      if (!pt.isCensus && !pt.isCharity) {
        statusTag = `<span class="status-tag discharged">Discharged</span>`;
      } else if (pt.isCharity) {
        statusTag = `<span class="status-tag charity">Charity</span>`;
      } else if (pt.isUpdatedToday) {
        statusTag = `<span class="status-tag fresh">${uiIcon('check')} ${esc(pt.latestShift || 'Today')}</span>`;
      } else {
        statusTag = `<span class="status-tag stale">${uiIcon('alert')} Needs Update (${esc(pt.latestDate || 'None')})</span>`;
      }

      const extraCatTags = (pt.categories || [])
        .filter((c) => !(pt.isCharity && c.toLowerCase() === 'charity'))
        .map((c) => `<span class="status-tag category">${esc(c)}</span>`)
        .join('');

      const metaParts = [
        pt.age ? `${esc(pt.age)}yo` : '',
        pt.sex ? esc(pt.sex) : '',
        pt.weight ? `${esc(String(pt.weight).replace(/\s*kg$/i, ''))} kg` : '',
        pt.service ? esc(pt.service) : '',
        pt.ap ? `AP: ${esc(pt.ap)}` : '',
      ].filter(Boolean);

      // Pending items
      const pendingHtml = pt.pending.length
        ? pt.pending
            .map(
              (item) => `
          <label class="pending-line ${item.checked ? 'done' : ''}">
            <input type="checkbox" class="pending-check" data-note-id="${pt.id}" data-task="${esc(item.text)}" ${item.checked ? 'checked' : ''}>
            <span>${esc(item.text)}</span>
          </label>`
            )
            .join('')
        : '<div class="no-pending">No pending orders/labs charted.</div>';

      const openPendingCount = pt.pending.filter((p) => !p.checked).length;
      const ageSuffix = !pt.isUpdatedToday && pt.latestDate ? ` <span class="metric-age">(${esc(pt.latestDate)})</span>` : '';

      // Metrics pills
      const metricPills = [];
      if (pt.vitals) metricPills.push(`<span class="metric-pill"><b>VS:</b> ${esc(pt.vitals)}${ageSuffix}</span>`);
      if (pt.vent) metricPills.push(`<span class="metric-pill"><b>Vent:</b> ${esc(pt.vent)}${ageSuffix}</span>`);
      if (pt.io) metricPills.push(`<span class="metric-pill"><b>I&amp;O:</b> ${esc(pt.io)}${ageSuffix}</span>`);
      if (pt.cumulativeFb) {
        metricPills.push(
          `<span class="metric-pill cum-fb" title="${esc(pt.cumulativeFb.breakdownText)}${
            pt.cumulativeFb.hasPartialDay ? ' (includes shift-summed day)' : ''
          }"><b>${esc(pt.cumulativeFb.label)}:</b> ${esc(pt.cumulativeFb.totalText)} <span class="cf-meta">(${esc(
            pt.cumulativeFb.breakdownText
          )})</span></span>`
        );
      }
      if (pt.hgt) metricPills.push(`<span class="metric-pill"><b>HGT:</b> ${esc(pt.hgt)}${ageSuffix}</span>`);
      if (pt.labs) metricPills.push(`<span class="metric-pill"><b>Labs:</b> ${esc(pt.labs)}${ageSuffix}</span>`);
      if (pt.drips) metricPills.push(`<span class="metric-pill drip"><b>Drips:</b> ${esc(pt.drips)}${ageSuffix}</span>`);

      const medsAgeSuffix =
        pt.medicationsDate && (!pt.isUpdatedToday || pt.medicationsDate !== pt.latestDate)
          ? ` <span class="metric-age">(${esc(pt.medicationsDate)})</span>`
          : '';
      const medsHtml =
        pt.medications && pt.medications.length
          ? `<details class="scut-meds-details">
              <summary>${uiIcon('pill')} Medications (${pt.medications.length})${medsAgeSuffix}</summary>
              <ul class="scut-meds-list">${pt.medications.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
            </details>`
          : '';

      const plansHtml =
        pt.servicePlans && pt.servicePlans.length
          ? `<details class="scut-plans-details">
              <summary>${uiIcon('clipboard-list')} Service Plans (${pt.servicePlans.length})</summary>
              <ul class="scut-plans-list">${pt.servicePlans.map((pl) => `<li>${esc(pl)}</li>`).join('')}</ul>
            </details>`
          : '';

      const compactParts = [];
      if (pt.vitals) compactParts.push(`VS: ${pt.vitals}`);
      if (pt.drips) compactParts.push(`Drips: ${pt.drips}`);
      if (pt.medications && pt.medications.length) compactParts.push(`${pt.medications.length} meds`);
      compactParts.push(`${openPendingCount} open`);

      const isExpanded = roundsCompactMode && expandedCompactIds.has(pt.id);

      return `
      <div class="scut-card ${isStale ? 'stale' : ''} ${roundsCompactMode ? 'compact' : ''} ${isExpanded ? 'expanded' : ''}" data-id="${pt.id}">
        <div class="scut-head${roundsCompactMode ? ' is-collapsible' : ''}"${
        roundsCompactMode
          ? ` role="button" tabindex="0" aria-expanded="${isExpanded}" title="${
              isExpanded ? 'Tap to collapse patient card' : 'Tap to expand patient card'
            }" data-toggle-compact-id="${pt.id}"`
          : ''
      }>
          <div>
            <span class="room-badge">${esc(pt.room || 'Unassigned')}</span>
            <div class="pt-title">${esc(pt.name)}</div>
            <div class="pt-meta">${metaParts.join(' · ')}</div>
          </div>
          <div class="scut-status-tags">${statusTag}${extraCatTags}${
        roundsCompactMode ? `<span class="compact-chevron" aria-hidden="true">${uiIcon('chevron-right')}</span>` : ''
      }</div>
        </div>

        <div class="scut-assessment">
          <strong>Working Impression</strong>
          ${esc(pt.assessment || 'No working impression entered yet.')}
        </div>

        <div class="scut-compact-line">${esc(compactParts.join(' · '))}</div>
        ${metricPills.length ? `<div class="scut-metrics">${metricPills.join('')}</div>` : ''}
        ${medsHtml}
        ${plansHtml}

        <div class="scut-pending">
          <div class="pending-hdr">
            <span>Pending items</span>
            <span class="pending-count">${openPendingCount} open</span>
          </div>
          <div class="pending-items">${pendingHtml}</div>
          <div class="pending-add-row">
            <input type="text" class="pending-add-input" enterkeyhint="done" autocapitalize="sentences" data-note-id="${pt.id}" placeholder="+ Quick add pending item..." aria-label="Add pending task for ${esc(pt.name)}">
            <button type="button" class="btn sm-btn pending-add-btn" data-note-id="${pt.id}" aria-label="Save pending item">+</button>
          </div>
        </div>

        <div class="scut-footer">
          <div class="scut-footer-primary">
            <button type="button" class="dictate-btn" data-id="${pt.id}" title="Dictate bedside SOAP" aria-label="Dictate">${uiIcon('mic')}<span class="scut-btn-label"> Dictate</span></button>
            <button type="button" class="open-chart-btn" data-id="${pt.id}" title="Open Chart" aria-label="Open Chart">${uiIcon('pencil')}<span class="scut-btn-label"> Open Chart</span></button>
          </div>
          <div class="scut-footer-secondary">
            <button type="button" class="shift-btn" data-id="${pt.id}" title="Add Update" aria-label="Add Update">${uiIcon('plus')}<span class="scut-btn-label"> Add Update</span></button>
            <button type="button" class="copy-update-btn" data-id="${pt.id}" title="Copy latest update as clean plain text" aria-label="Copy Update">${uiIcon('share')}<span class="scut-btn-label"> Copy Update</span></button>
            <button type="button" class="calc-btn" data-id="${pt.id}" title="Renal calculators, drip rates &amp; safety audit" aria-label="Calc">${uiIcon('calc')}<span class="scut-btn-label"> Calc</span></button>
            <button type="button" class="pitch-btn" data-id="${pt.id}" title="Generate 30s Bedside Presentation" aria-label="Pitch">${uiIcon('ai-brain')}<span class="scut-btn-label"> Pitch</span></button>
          </div>
        </div>
      </div>`;
    })
    .join('');

  // Wire card events
  if (roundsCompactMode) {
    container.querySelectorAll('.scut-head[data-toggle-compact-id]').forEach((headEl) => {
      const toggleCompactCard = () => {
        const id = headEl.dataset.toggleCompactId;
        if (!id) return;
        const card = headEl.closest('.scut-card');
        const nextExpanded = !expandedCompactIds.has(id);
        if (nextExpanded) expandedCompactIds.add(id);
        else expandedCompactIds.delete(id);
        if (card) card.classList.toggle('expanded', nextExpanded);
        headEl.setAttribute('aria-expanded', String(nextExpanded));
        headEl.setAttribute(
          'title',
          nextExpanded ? 'Tap to collapse patient card' : 'Tap to expand patient card'
        );
      };
      headEl.onclick = toggleCompactCard;
      headEl.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggleCompactCard();
        }
      };
    });
  }
  container.querySelectorAll('.dictate-btn').forEach((btn) => {
    btn.onclick = () => openDictateModal(btn.dataset.id, btn);
  });

  container.querySelectorAll('.open-chart-btn').forEach((btn) => {
    btn.onclick = async () => {
      await select(btn.dataset.id);
      await setMode('editor');
    };
  });

  container.querySelectorAll('.shift-btn').forEach((btn) => {
    btn.onclick = () => openShiftModal(btn.dataset.id, btn);
  });

  container.querySelectorAll('.copy-update-btn').forEach((btn) => {
    btn.onclick = () => {
      const note = notes.find((n) => n.id === btn.dataset.id);
      if (note) copyUpdateTextForContent(note.content, note);
    };
  });

  container.querySelectorAll('.calc-btn').forEach((btn) => {
    btn.onclick = () => openCalcModal(btn.dataset.id, 'audit', btn);
  });

  container.querySelectorAll('.pitch-btn').forEach((btn) => {
    btn.onclick = () => {
      openWithPrompt(
        btn.dataset.id,
        'Give a high-yield, 30-second bedside presentation for attending rounds (Assessment, Overnight events, Key Labs, Drips, and Today\'s Plan).'
      );
    };
  });

  container.querySelectorAll('.pending-check').forEach((chk) => {
    chk.onchange = async (e) => {
      await handleTogglePending(e.target.dataset.noteId, e.target.dataset.task, e.target.checked);
    };
  });

  container.querySelectorAll('.pending-add-btn').forEach((btn) => {
    btn.onclick = async () => {
      const id = btn.dataset.noteId;
      const inp = container.querySelector(`.pending-add-input[data-note-id="${CSS.escape(id)}"]`);
      if (!inp) return;
      const val = inp.value.trim();
      if (!val) return inp.focus();
      await handleQuickAddPending(id, val);
    };
  });

  container.querySelectorAll('.pending-add-input').forEach((inp) => {
    inp.onkeydown = async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = inp.value.trim();
        if (val) await handleQuickAddPending(inp.dataset.noteId, val);
      }
    };
  });
}

function updateCensusStats(parsed) {
  const active = parsed.filter((p) => p.isCensus && !p.isCharity);
  const updatedToday = active.filter((p) => p.isUpdatedToday).length;
  const needsUpdateCount = active.filter((p) => !p.isUpdatedToday).length;
  let totalPending = 0;
  for (const pt of active) {
    totalPending += pt.pending.filter((p) => !p.checked).length;
  }

  if ($('statActive')) $('statActive').textContent = active.length;
  if ($('statUpdated')) $('statUpdated').textContent = updatedToday;
  if ($('statNeedsUpdate')) $('statNeedsUpdate').textContent = needsUpdateCount;
  if ($('statPending')) $('statPending').textContent = totalPending;

  renderRoundsFilterChips(parsed);
}

async function handleTogglePending(noteId, taskText, isChecked) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  const result = togglePendingItem(note.content, taskText, isChecked);
  if (result.modified) {
    note.content = result.text;
    note.updated = Date.now();
    await put(note);
    toast(isChecked ? 'Task marked complete' : 'Task reopened');
    await refresh();
  }
}

async function handleQuickAddPending(noteId, taskText) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;
  note.content = appendPendingLineToLatestBlock(note.content, taskText, defaultShiftForHour());
  note.updated = Date.now();
  await put(note);
  if (currentId === note.id) {
    $('noteText').value = note.content;
    lastSavedChartContent = note.content;
    if (editorViewMode === 'timeline') renderChartTimeline();
  }
  await refresh();
  toast('Added pending item');
}

/* ---------- shift carry-forward modal (template-driven guided entry) ---------- */
let shiftingNoteId = null;
let shiftingChoice = '6am';
let shiftingSourceContent = '';
let shiftModalMode = 'form';
let shiftFormValues = {};
let shiftRawEdited = false;

function defaultShiftForHour(now = new Date()) {
  const refDate = typeof now === 'number' ? new Date(2026, 0, 1, now, 0, 0) : now;
  return getShiftForDate(refDate, shiftSchedule).label;
}

function formatSplitBp(sbpRaw, dbpRaw) {
  const sbp = String(sbpRaw || '').trim();
  const dbp = String(dbpRaw || '').trim();
  if (sbp && dbp) return `${sbp}/${dbp}`;
  return sbp || (dbp ? `/${dbp}` : '');
}

function formatIoWithUnit(rawVal, unit = 'ml') {
  const val = String(rawVal || '').trim();
  if (!val) return '';
  return /[a-z]/i.test(val) ? val : `${val}${unit}`;
}

function updateGuidedIoFbPreview() {
  const prevEl = $('sfIoFbPreview');
  if (!prevEl) return;
  const unit = shiftFormValues.ioUnit || 'ml';
  const inVal = formatIoWithUnit(shiftFormValues.ioIn, unit);
  const outVal = formatIoWithUnit(shiftFormValues.ioOut, unit);
  prevEl.value = inVal && outVal ? computeShiftFluidBalance(inVal, outVal) || 'check units' : '';
}

function syncShiftMergeCheckbox() {
  const el = $('shiftMergeExisting');
  if (!el) return;
  if (shiftingChoice === 'interim') {
    el.checked = false;
    return;
  }
  const isoDate = $('shiftDateInput')?.value || getDefaultDutyIsoForShift(shiftingChoice);
  const dateStr = isoToMmDdYyyy(isoDate) || getTodayDateStrings().mmddyyyy;
  el.checked = hasShiftHeadingOnDate(shiftingSourceContent, shiftingChoice, dateStr);
}

function getShiftingParsedNote() {
  const note = notes.find((n) => n.id === shiftingNoteId) || {};
  return parseChart(shiftingSourceContent, note);
}

function populateShiftFormDefaults() {
  const parsed = getShiftingParsedNote();
  const cfData = extractCarryForwardData(shiftingSourceContent);
  const carryPend = $('cfPending') ? $('cfPending').checked : true;
  const carryPlans = $('cfServicePlans') ? $('cfServicePlans').checked : true;
  const carryStanding = $('cfStanding') ? $('cfStanding').checked : true;
  const carryPe = $('cfPe') ? $('cfPe').checked : Boolean(cfData.pe);

  shiftFormValues = {
    interimEvent: '',
    labs: '',
    subjective: '',
    sbp: '',
    dbp: '',
    hr: '',
    rr: '',
    temp: '',
    o2: '',
    ioIn: '',
    ioOut: '',
    ioUnit: 'ml',
    io24: '',
    vent: carryStanding ? cfData.vent || '' : '',
    pe: carryPe && cfData.pe ? cfData.pe : DEFAULT_NORMAL_PE_TEXT,
    assessment: parsed.assessment || '',
    drips: carryStanding ? cfData.drips || '' : '',
    meds: carryStanding ? (parsed.medications || []).join('\n') : '',
    servicePlans: carryPlans ? (cfData.servicePlans || []).join('\n') : '',
    pending: carryPend ? (cfData.openPending || []).join('\n') : '',
  };
}

function syncShiftPreviewFromForm({ forceRawUpdate = false } = {}) {
  const ta = $('shiftPreviewText');
  if (!ta) return;
  if (shiftRawEdited && !forceRawUpdate) return;
  const isoDate = $('shiftDateInput')?.value || getDefaultDutyIsoForShift(shiftingChoice);
  const dateStr = isoToMmDdYyyy(isoDate) || getTodayDateStrings().mmddyyyy;
  const effectiveShift = resolveModalShiftHeading(shiftingChoice, 'shiftInterimTimeInput');
  const isInterim = shiftingChoice === 'interim';
  const parsed = getShiftingParsedNote();

  ta.value = buildStructuredShiftUpdate({
    shift: effectiveShift,
    config: templateConfig,
    values: shiftFormValues,
    parsed,
    isInterim,
    dateStr,
  });
  if (forceRawUpdate) shiftRawEdited = false;
}

function setShiftModalMode(mode = 'form') {
  const next = mode === 'raw' ? 'raw' : 'form';
  shiftModalMode = next;
  const formEl = $('shiftGuidedForm');
  const rawEl = $('shiftRawPane');
  if (formEl) formEl.hidden = next !== 'form';
  if (rawEl) rawEl.hidden = next !== 'raw';

  const formBtn = $('shiftModeFormBtn');
  const rawBtn = $('shiftModeRawBtn');
  if (formBtn) {
    formBtn.classList.toggle('active', next === 'form');
    formBtn.setAttribute('aria-pressed', String(next === 'form'));
    formBtn.setAttribute('aria-selected', String(next === 'form'));
  }
  if (rawBtn) {
    rawBtn.classList.toggle('active', next === 'raw');
    rawBtn.setAttribute('aria-pressed', String(next === 'raw'));
    rawBtn.setAttribute('aria-selected', String(next === 'raw'));
  }

  if (next === 'raw' && !shiftRawEdited) {
    syncShiftPreviewFromForm();
  }
}

function renderVitalsSubHtml() {
  return `
    <div>
      <span class="shift-sub-label">Vital Signs</span>
      <div class="quick-vs-grid">
        <div class="field">
          <label for="sfSbp">BP (SBP/DBP)</label>
          <div class="bp-split-inputs">
            <input id="sfSbp" data-sf-key="sbp" inputmode="numeric" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.sbp)}" placeholder="120" aria-label="Systolic BP">
            <span class="bp-slash" aria-hidden="true">/</span>
            <input id="sfDbp" data-sf-key="dbp" inputmode="numeric" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.dbp)}" placeholder="80" aria-label="Diastolic BP">
          </div>
        </div>
        <div class="field"><label for="sfHr">HR</label><input id="sfHr" data-sf-key="hr" inputmode="numeric" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.hr)}" placeholder="78"></div>
        <div class="field"><label for="sfRr">RR</label><input id="sfRr" data-sf-key="rr" inputmode="numeric" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.rr)}" placeholder="18"></div>
        <div class="field"><label for="sfTemp">Temp</label><input id="sfTemp" data-sf-key="temp" inputmode="decimal" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.temp)}" placeholder="36.8C"></div>
        <div class="field"><label for="sfO2">O2sat</label><input id="sfO2" data-sf-key="o2" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.o2)}" placeholder="98% RA"></div>
      </div>
    </div>`;
}

function renderShiftGuidedForm() {
  const container = $('shiftGuidedForm');
  if (!container) return;

  const isInterim = shiftingChoice === 'interim';
  const cards = [];

  if (isInterim) {
    cards.push(`
      <div class="shift-field-card" data-shift-section="interimEvent">
        <div class="shift-field-card-head"><span class="shift-field-card-title">Event / Interval Update</span></div>
        <textarea id="sfInterimEvent" data-sf-key="interimEvent" rows="2" placeholder="Significant clinical event, stat call, or bedside assessment...">${esc(shiftFormValues.interimEvent)}</textarea>
      </div>`);
    cards.push(`<div class="shift-field-card" data-shift-section="vitals">${renderVitalsSubHtml()}</div>`);
    cards.push(`
      <div class="shift-field-card" data-shift-section="labs">
        <div class="shift-field-card-head"><span class="shift-field-card-title">Labs / Diagnostics</span></div>
        <textarea id="sfLabs" data-sf-key="labs" rows="2" placeholder="e.g. Na 136 | K 4.1 | Trop-I 0.82">${esc(shiftFormValues.labs)}</textarea>
      </div>`);
    cards.push(`
      <div class="shift-field-card" data-shift-section="meds">
        <div class="shift-field-card-head"><span class="shift-field-card-title">Drips &amp; Medications</span></div>
        <div class="shift-field-subgrid">
          <div class="field">
            <label for="sfDrips">Active Drips / Infusions</label>
            <input id="sfDrips" data-sf-key="drips" value="${esc(shiftFormValues.drips)}" placeholder="e.g. Norepinephrine @ 0.08 mcg/kg/min">
          </div>
          <div class="field">
            <label for="sfMeds">Medications (one per line)</label>
            <textarea id="sfMeds" data-sf-key="meds" rows="3" placeholder="New or updated medications, one per line...">${esc(shiftFormValues.meds)}</textarea>
          </div>
        </div>
      </div>`);
    cards.push(`
      <div class="shift-field-card" data-shift-section="pending">
        <div class="shift-field-card-head"><span class="shift-field-card-title">Pending / Action Items</span></div>
        <textarea id="sfPending" data-sf-key="pending" rows="3" placeholder="Tasks or stat follow-ups, one per line...">${esc(shiftFormValues.pending)}</textarea>
      </div>`);
  } else {
    const sections = Array.isArray(templateConfig?.sections)
      ? templateConfig.sections
      : DEFAULT_TEMPLATE_CONFIG.sections;

    for (const sec of sections) {
      if (!sec || !sec.enabled) continue;
      if (sec.id === 'labs') {
        cards.push(`
          <div class="shift-field-card" data-shift-section="labs">
            <div class="shift-field-card-head"><span class="shift-field-card-title">Laboratory Updates</span></div>
            <textarea id="sfLabs" data-sf-key="labs" rows="2" placeholder="e.g. Na 138 (136) | K 4.0 (3.8) | Cr 1.1 (1.2)">${esc(shiftFormValues.labs)}</textarea>
          </div>`);
      } else if (sec.id === 'subjective') {
        cards.push(`
          <div class="shift-field-card" data-shift-section="subjective">
            <div class="shift-field-card-head"><span class="shift-field-card-title">Subjective</span></div>
            <textarea id="sfSubjective" data-sf-key="subjective" rows="2" placeholder="Patient complaints, overnight events, symptoms...">${esc(shiftFormValues.subjective)}</textarea>
          </div>`);
      } else if (sec.id === 'objective') {
        const subs = Array.isArray(sec.subItems) ? sec.subItems : [];
        const subParts = [];
        for (const sub of subs) {
          if (!sub || !sub.enabled) continue;
          if (sub.id === 'vitals') {
            subParts.push(renderVitalsSubHtml());
          } else if (sub.id === 'io') {
            const unit = shiftFormValues.ioUnit || 'ml';
            subParts.push(`
              <div>
                <span class="shift-sub-label">Intake &amp; Output (I&amp;O)</span>
                <div class="shift-io-grid">
                  <div class="field"><label for="sfIoIn">Shift In</label><input id="sfIoIn" data-sf-key="ioIn" inputmode="decimal" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.ioIn)}" placeholder="e.g. 800"></div>
                  <div class="field"><label for="sfIoOut">Shift Out</label><input id="sfIoOut" data-sf-key="ioOut" inputmode="decimal" enterkeyhint="next" autocomplete="off" value="${esc(shiftFormValues.ioOut)}" placeholder="e.g. 650"></div>
                  <div class="field">
                    <label for="sfIoUnit">Unit</label>
                    <select id="sfIoUnit" data-sf-key="ioUnit" aria-label="Shift I&amp;O unit">
                      <option value="ml"${unit === 'ml' ? ' selected' : ''}>mL</option>
                      <option value="L"${unit === 'L' ? ' selected' : ''}>L</option>
                    </select>
                  </div>
                  <div class="field"><label for="sfIoFbPreview">Calculated FB</label><input id="sfIoFbPreview" readonly placeholder="auto"></div>
                </div>
              </div>`);
          } else if (sub.id === 'io24') {
            subParts.push(`
              <div class="field">
                <label for="sfIo24">24h Net Fluid Balance</label>
                <input id="sfIo24" data-sf-key="io24" value="${esc(shiftFormValues.io24)}" placeholder="e.g. +400ml">
              </div>`);
          } else if (sub.id === 'vent') {
            subParts.push(`
              <div class="field">
                <label for="sfVent">Ventilator Settings</label>
                <input id="sfVent" data-sf-key="vent" value="${esc(shiftFormValues.vent)}" placeholder="e.g. AC/VC Vt 420 | PEEP 8 | FiO2 40%">
              </div>`);
          } else if (sub.id === 'pe') {
            const prevPe = extractCarryForwardData(shiftingSourceContent).pe;
            subParts.push(`
              <div class="field">
                <div class="shift-field-card-head">
                  <label for="sfPe">Physical Exam</label>
                  <div class="shift-pe-actions">
                    ${prevPe ? '<button type="button" class="btn sm-btn subtle" data-sf-pe-preset="prev" title="Copy Physical Exam from previous shift">Previous PE</button>' : ''}
                    <button type="button" class="btn sm-btn subtle" data-sf-pe-preset="normal">Normal PE</button>
                    <button type="button" class="btn sm-btn subtle" data-sf-pe-preset="clear">Clear</button>
                  </div>
                </div>
                <textarea id="sfPe" data-sf-key="pe" rows="4" placeholder="Focused physical exam findings...">${esc(shiftFormValues.pe)}</textarea>
              </div>`);
          }
        }
        cards.push(`
          <div class="shift-field-card" data-shift-section="objective">
            <div class="shift-field-card-head"><span class="shift-field-card-title">Objective</span></div>
            <div class="shift-field-subgrid">${subParts.length ? subParts.join('') : '<div class="cf-meta">No Objective sub-fields enabled in Update Template.</div>'}</div>
          </div>`);
      } else if (sec.id === 'assessment') {
        cards.push(`
          <div class="shift-field-card" data-shift-section="assessment">
            <div class="shift-field-card-head"><span class="shift-field-card-title">Assessment / Working Impression</span></div>
            <textarea id="sfAssessment" data-sf-key="assessment" rows="2" placeholder="Working diagnosis / problem list...">${esc(shiftFormValues.assessment)}</textarea>
          </div>`);
      } else if (sec.id === 'meds') {
        cards.push(`
          <div class="shift-field-card" data-shift-section="meds">
            <div class="shift-field-card-head"><span class="shift-field-card-title">Medications / Drips</span></div>
            <div class="shift-field-subgrid">
              <div class="field">
                <label for="sfDrips">Active Drips / Infusions</label>
                <input id="sfDrips" data-sf-key="drips" value="${esc(shiftFormValues.drips)}" placeholder="e.g. Norepinephrine @ 0.08 mcg/kg/min">
              </div>
              <div class="field">
                <label for="sfMeds">Medication List (one per line)</label>
                <textarea id="sfMeds" data-sf-key="meds" rows="3" placeholder="Active medications, one per line...">${esc(shiftFormValues.meds)}</textarea>
              </div>
            </div>
          </div>`);
      } else if (sec.id === 'plan') {
        cards.push(`
          <div class="shift-field-card" data-shift-section="plan">
            <div class="shift-field-card-head"><span class="shift-field-card-title">Plan &amp; Pending Items</span></div>
            <div class="shift-field-subgrid">
              <div class="field">
                <label for="sfServicePlans">Service Plans (one per line)</label>
                <textarea id="sfServicePlans" data-sf-key="servicePlans" rows="3" placeholder="Standing treatment plans, one per line...">${esc(shiftFormValues.servicePlans)}</textarea>
              </div>
              <div class="field">
                <label for="sfPending">Pending Items / Checklist (one per line)</label>
                <textarea id="sfPending" data-sf-key="pending" rows="3" placeholder="Labs to follow up, consults, orders...">${esc(shiftFormValues.pending)}</textarea>
              </div>
            </div>
          </div>`);
      }
    }
  }

  container.innerHTML = cards.join('');
  updateGuidedIoFbPreview();

  container.querySelectorAll('[data-sf-key]').forEach((el) => {
    const key = el.dataset.sfKey;
    const evtName = el.tagName === 'SELECT' ? 'change' : 'input';
    el.addEventListener(evtName, () => {
      shiftFormValues[key] = el.value;
      shiftPreviewDirty = true;
      shiftRawEdited = false;
      if (key === 'ioIn' || key === 'ioOut' || key === 'ioUnit') {
        updateGuidedIoFbPreview();
      }
      syncShiftPreviewFromForm();
    });
  });

  container.querySelectorAll('[data-sf-pe-preset]').forEach((btn) => {
    btn.onclick = () => {
      const preset = btn.dataset.sfPePreset;
      let nextPe = '';
      if (preset === 'prev') {
        nextPe = extractCarryForwardData(shiftingSourceContent).pe || '';
        if ($('cfPe') && !$('cfPe').disabled) $('cfPe').checked = Boolean(nextPe);
      } else if (preset === 'normal') {
        nextPe = DEFAULT_NORMAL_PE_TEXT;
        if ($('cfPe')) $('cfPe').checked = false;
      } else {
        if ($('cfPe')) $('cfPe').checked = false;
      }
      shiftFormValues.pe = nextPe;
      const peEl = $('sfPe');
      if (peEl) peEl.value = nextPe;
      shiftPreviewDirty = true;
      shiftRawEdited = false;
      syncShiftPreviewFromForm();
    };
  });
}

function applyCarryForwardToggleToShiftForm(changedId = null) {
  const cfData = extractCarryForwardData(shiftingSourceContent);
  const parsed = getShiftingParsedNote();
  const carryPend = $('cfPending')?.checked !== false;
  const carryPlans = $('cfServicePlans')?.checked !== false;
  const carryStanding = $('cfStanding')?.checked !== false;
  const carryPe = Boolean($('cfPe')?.checked);

  const domMap = {};
  if (!changedId || changedId === 'cfPending') {
    shiftFormValues.pending = carryPend ? (cfData.openPending || []).join('\n') : '';
    domMap.sfPending = shiftFormValues.pending;
  }
  if (!changedId || changedId === 'cfServicePlans') {
    shiftFormValues.servicePlans = carryPlans ? (cfData.servicePlans || []).join('\n') : '';
    domMap.sfServicePlans = shiftFormValues.servicePlans;
  }
  if (!changedId || changedId === 'cfStanding') {
    shiftFormValues.vent = carryStanding ? cfData.vent || '' : '';
    shiftFormValues.drips = carryStanding ? cfData.drips || '' : '';
    shiftFormValues.meds = carryStanding ? (parsed.medications || []).join('\n') : '';
    domMap.sfVent = shiftFormValues.vent;
    domMap.sfDrips = shiftFormValues.drips;
    domMap.sfMeds = shiftFormValues.meds;
  }
  if (!changedId || changedId === 'cfPe') {
    shiftFormValues.pe = carryPe && cfData.pe ? cfData.pe : '';
    domMap.sfPe = shiftFormValues.pe;
  }

  for (const [id, val] of Object.entries(domMap)) {
    if ($(id)) $(id).value = val;
  }

  if (shiftRawEdited) {
    if (!confirm('You edited the raw markdown manually. Replace it with updated carry-forward options?')) {
      return;
    }
    shiftRawEdited = false;
  }
  syncShiftPreviewFromForm({ forceRawUpdate: true });
}

function updateShiftPreview(forceRebuild = false) {
  if (!forceRebuild && shiftRawEdited) {
    if (!confirm('You edited the raw markdown manually. Replace with fresh guided template?')) {
      return;
    }
  }
  shiftRawEdited = false;
  syncShiftPreviewFromForm({ forceRawUpdate: true });
}

function openShiftModal(noteId, triggerEl = null) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  shiftingNoteId = noteId;
  shiftingSourceContent =
    currentMode === 'editor' && currentId === noteId ? $('noteText').value : note.content;

  const meta = metaOf(shiftingSourceContent);
  const room = note.room || meta.room || 'Unassigned';
  const name = note.name || meta.name || 'Unknown Patient';
  $('shiftModalSubtitle').textContent = `${room} · ${name}`;

  shiftingChoice = defaultShiftForHour();
  renderShiftPillGroup('shiftPills', shiftingChoice);
  if ($('shiftInterimTimeInput')) $('shiftInterimTimeInput').value = nowHhMm();
  syncModalInterimTimeUi(shiftingChoice, 'shiftInterimTimeWrap', 'shiftInterimTimeInput');

  if ($('shiftDateInput')) {
    $('shiftDateInput').value = getDefaultDutyIsoForShift(shiftingChoice);
  }
  syncShiftMergeCheckbox();

  const cfData = extractCarryForwardData(shiftingSourceContent);
  $('cfPending').checked = true;
  $('cfServicePlans').checked = true;
  $('cfStanding').checked = true;

  const hasPrevPe = Boolean(cfData.pe);
  if ($('cfPe')) {
    $('cfPe').checked = hasPrevPe;
    $('cfPe').disabled = !hasPrevPe;
  }

  $('cfPendingMeta').textContent = cfData.hasPriorBlock
    ? `(${cfData.openPending.length} open · ${cfData.completedPendingCount} done dropped)`
    : '(new chart starter)';
  $('cfServiceMeta').textContent = `(${cfData.servicePlans.length} plan${
    cfData.servicePlans.length === 1 ? '' : 's'
  })`;
  const standingParts = [cfData.vent ? 'Vent' : '', cfData.drips ? 'Drips' : '']
    .filter(Boolean)
    .join(' + ');
  $('cfStandingMeta').textContent = `(${standingParts || 'none'})`;
  if ($('cfPeMeta')) {
    const lineCount = cfData.pe ? cfData.pe.split('\n').filter((l) => l.trim()).length : 0;
    const srcLabel = cfData.peSource === 'admitting' ? 'from admitting PE' : 'from prior shift';
    $('cfPeMeta').textContent = hasPrevPe
      ? `(${srcLabel} · ${lineCount} line${lineCount === 1 ? '' : 's'})`
      : '(none in prior shifts)';
  }

  shiftPreviewDirty = false;
  shiftRawEdited = false;
  populateShiftFormDefaults();
  renderShiftGuidedForm();
  syncShiftPreviewFromForm({ forceRawUpdate: true });
  setShiftModalMode('form');

  const firstFocusTarget = $('sfSbp') || $('sfLabs') || $('sfSubjective') || $('sfAssessment') || $('shiftPreviewText');
  openModalEl($('shiftModal'), triggerEl, firstFocusTarget);
}

function closeShiftModal(force = false) {
  if (!force && (shiftPreviewDirty || shiftRawEdited)) {
    if (!confirm('Discard unsubmitted shift update?')) return false;
  }
  closeModalEl($('shiftModal'));
  shiftingNoteId = null;
  shiftingSourceContent = '';
  shiftPreviewDirty = false;
  shiftRawEdited = false;
  shiftFormValues = {};
  return true;
}

async function commitShiftBlock(openInEditor = false) {
  const note = notes.find((n) => n.id === shiftingNoteId);
  if (!note) return;

  if (shiftModalMode === 'form' && !shiftRawEdited) {
    syncShiftPreviewFromForm({ forceRawUpdate: true });
  }
  const blockText = $('shiftPreviewText').value;
  if (!blockText.trim()) return toast('Shift block cannot be empty');

  const dateStr = isoToMmDdYyyy($('shiftDateInput')?.value) || getTodayDateStrings().mmddyyyy;
  const effectiveShift = resolveModalShiftHeading(shiftingChoice, 'shiftInterimTimeInput');
  const mergeExistingShift = shiftingChoice !== 'interim' && Boolean($('shiftMergeExisting')?.checked);
  const baseContent =
    currentMode === 'editor' && currentId === shiftingNoteId ? $('noteText').value : note.content;
  note.content = appendShiftBlock(baseContent, effectiveShift, dateStr, blockText, null, {
    mergeExistingShift,
  });
  note.updated = Date.now();
  await put(note);
  await refresh();

  const savedId = shiftingNoteId;
  const savedShift = effectiveShift;
  closeShiftModal(true);

  if (openInEditor) {
    await select(savedId);
    await setMode('editor');
  } else if (currentMode === 'editor' && currentId === savedId) {
    await select(savedId);
  }
  toast(`${mergeExistingShift ? 'Updated' : 'Appended'} ### ${savedShift} (${dateStr})`);
}

/* ---------- end-of-shift handover modal ---------- */
let currentHandoverRaw = '';
let currentHandoverDate = '';
let currentHandoverPatientMeta = [];
let handoverViewingDeid = false;

function profileForNote(n) {
  const m = metaOf(n.content);
  const rawAliases = String(m.aliases || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const noteAliases = Array.isArray(n.aliases) ? n.aliases : [];
  return {
    name: n.name || m.name || m.patient || '',
    aliases: [...new Set([...noteAliases, ...rawAliases])],
    room: n.room || m.room || m.bed || '',
  };
}

function deidentifyHandoverText(rawText, notesList) {
  const profiles = (notesList || [])
    .map(profileForNote)
    .filter((p) => p.name || p.aliases.length);
  let safeText = String(rawText || '');
  for (const prof of profiles) {
    safeText = redact(safeText, prof).text;
  }
  const allLeaks = [];
  for (const prof of profiles) {
    const leaks = findLeaks(safeText, prof);
    if (leaks.length) allLeaks.push(...leaks);
  }
  return { text: safeText, leaks: allLeaks };
}

function fmtHandoverInline(text, highlightRedacted = false) {
  let html = esc(text);
  if (highlightRedacted) {
    html = html.replace(/\[PATIENT\]/g, '<mark>[PATIENT]</mark>');
  }
  return html;
}

function findHandoverNoteIdForTitle(title, isGap = false) {
  if (!title || !currentHandoverPatientMeta.length) return '';
  const hit = currentHandoverPatientMeta.find((pm) =>
    isGap ? title === pm.gapHeaderText || title.includes(pm.name) : title.startsWith(pm.headerText)
  );
  return hit ? hit.id : '';
}

function renderHandoverHtml(markdownText, highlightRedacted = false) {
  const lines = String(markdownText || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCard = false;

  const closeCard = () => {
    if (inCard) {
      html.push('</div>');
      inCard = false;
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (/^---+$/.test(trimmed)) {
      closeCard();
      continue;
    }

    if (trimmed.startsWith('# ')) {
      closeCard();
      html.push(`<div class="ho-doc-title">${fmtHandoverInline(trimmed.slice(2), highlightRedacted)}</div>`);
      continue;
    }

    if (trimmed.startsWith('## ')) {
      closeCard();
      const title = trimmed.slice(3).trim();
      const isGaps = /^Gaps\b/i.test(title);
      const ptId = !isGaps && !highlightRedacted ? findHandoverNoteIdForTitle(title, false) : '';
      html.push(`<div class="ho-card${isGaps ? ' ho-gaps' : ''}">`);
      html.push(
        `<div class="ho-header"><span>${fmtHandoverInline(title, highlightRedacted)}</span>${
          ptId
            ? `<button type="button" class="ho-jump-btn" data-note-id="${esc(ptId)}">↗ Chart</button>`
            : ''
        }</div>`
      );
      inCard = true;
      continue;
    }

    if (trimmed.startsWith('**Active Census:**')) {
      const plainStats = trimmed.replace(/\*\*([^*]+)\*\*/g, '$1');
      html.push(`<div class="ho-stats-bar">${fmtHandoverInline(plainStats, highlightRedacted)}</div>`);
      continue;
    }

    if (/^\*\*Pending:\*\*$/i.test(trimmed)) {
      html.push(`<div class="ho-pending-hdr">Pending</div>`);
      continue;
    }

    const chkMatch = trimmed.match(/^-\s*\[([ xX])\]\s*(.+)$/);
    if (chkMatch) {
      const done = chkMatch[1].toLowerCase() === 'x';
      const itemBody = chkMatch[2]
        .replace(/\s*\*\(resolved today\)\*\s*$/i, '')
        .trim();
      const suffix = /\*\(resolved today\)\*/i.test(chkMatch[2])
        ? ' <span class="ho-resolved">(resolved today)</span>'
        : '';
      html.push(
        `<div class="ho-pending-item${done ? ' done' : ''}"><span class="ho-box">${
          done ? '☑' : '☐'
        }</span><span>${fmtHandoverInline(itemBody, highlightRedacted)}${suffix}</span></div>`
      );
      continue;
    }

    const gapBulletMatch = trimmed.match(/^-\s*\*\*([^*]+):\*\*\s*(.+)$/);
    if (gapBulletMatch) {
      const gapNoteId = !highlightRedacted ? findHandoverNoteIdForTitle(gapBulletMatch[1], true) : '';
      html.push(
        `<div class="ho-line${gapNoteId ? ' ho-clickable' : ''}"${
          gapNoteId ? ` data-note-id="${esc(gapNoteId)}" role="button" tabindex="0"` : ''
        }><span class="ho-label">${fmtHandoverInline(
          gapBulletMatch[1],
          highlightRedacted
        )}:</span><span class="ho-val">${fmtHandoverInline(gapBulletMatch[2], highlightRedacted)}</span></div>`
      );
      continue;
    }

    const kvMatch = trimmed.match(/^\*\*([^*]+):\*\*\s*(.*)$/);
    if (kvMatch) {
      html.push(
        `<div class="ho-line"><span class="ho-label">${fmtHandoverInline(
          kvMatch[1],
          highlightRedacted
        )}:</span><span class="ho-val">${fmtHandoverInline(kvMatch[2], highlightRedacted)}</span></div>`
      );
      continue;
    }

    if (trimmed.startsWith('- ')) {
      html.push(`<div class="ho-empty">${fmtHandoverInline(trimmed.slice(2), highlightRedacted)}</div>`);
      continue;
    }

    if (/^\*[^*].*\*$/.test(trimmed)) {
      html.push(`<div class="ho-footnote">${fmtHandoverInline(trimmed.slice(1, -1), highlightRedacted)}</div>`);
      continue;
    }

    html.push(`<div class="ho-line">${fmtHandoverInline(trimmed, highlightRedacted)}</div>`);
  }

  closeCard();
  return html.join('');
}

function wireHandoverLinks() {
  const previewEl = $('handoverPreview');
  if (!previewEl) return;
  const openTarget = async (noteId) => {
    if (!noteId) return;
    closeHandoverModal();
    await select(noteId);
    await setMode('editor');
  };
  previewEl.querySelectorAll('[data-note-id]').forEach((el) => {
    el.onclick = () => openTarget(el.dataset.noteId);
    el.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openTarget(el.dataset.noteId);
      }
    };
  });
}

function renderHandoverPreview() {
  const previewEl = $('handoverPreview');
  const pill = $('handoverGuardPill');
  const modeLbl = $('handoverModeLabel');
  const toggleBtn = $('handoverToggleDeidBtn');
  const rawCopyBtn = $('copyHandoverBtn');
  const exportBtn = $('exportHandoverBtn');

  if (!handoverViewingDeid) {
    previewEl.innerHTML = renderHandoverHtml(currentHandoverRaw, false);
    modeLbl.innerHTML = `${uiIcon('alert')} Viewing: Raw PHI (Local Only)`;
    toggleBtn.innerHTML = `${uiIcon('shield')} Preview De-identified`;
    pill.textContent = 'LOCAL ONLY';
    pill.className = 'pill';
    if (rawCopyBtn) rawCopyBtn.disabled = false;
    $('copyHandoverDeidBtn').disabled = false;
    if (exportBtn) exportBtn.innerHTML = `${uiIcon('download')} Export Raw .md`;
    wireHandoverLinks();
    return;
  }

  const { text, leaks } = deidentifyHandoverText(currentHandoverRaw, notes);
  const bad = leaks.length > 0;
  previewEl.innerHTML = renderHandoverHtml(text, true);
  modeLbl.innerHTML = bad
    ? `${uiIcon('shield')} Viewing: De-identified (${leaks.length} leak(s) detected)`
    : `${uiIcon('shield')} Viewing: De-identified Summary (Rooms Retained · Raw Copy Locked)`;
  toggleBtn.innerHTML = `${uiIcon('clipboard-list')} Show Raw Local`;
  pill.textContent = bad ? `BLOCKED · ${leaks.length}` : 'PHI CLEARED';
  pill.className = 'pill ' + (bad ? 'block' : 'safe');
  if (rawCopyBtn) rawCopyBtn.disabled = true;
  $('copyHandoverDeidBtn').disabled = bad;
  if (exportBtn) exportBtn.innerHTML = `${uiIcon('shield')} Export De-id .md`;
}

function rebuildHandoverReport() {
  const dateIso = $('handoverDateInput')?.value || getDutyDateStrings().yyyymmdd;
  currentHandoverDate = isoToMmDdYyyy(dateIso) || getTodayDateStrings().mmddyyyy;
  const scope = $('handoverScopeSelect')?.value || 'all';
  const includeVitalsLabs = $('hoShowVitalsLabs') ? $('hoShowVitalsLabs').checked : true;
  const includeResolvedPending = $('hoShowResolved') ? $('hoShowResolved').checked : true;

  const { markdown, stats, patientMeta } = formatHandoverReport(notes, currentHandoverDate, {
    scope,
    includeVitalsLabs,
    includeResolvedPending,
  });
  currentHandoverRaw = markdown;
  currentHandoverPatientMeta = patientMeta || [];

  $('handoverModalSubtitle').textContent =
    `${currentHandoverDate} · ${stats.activeCount} active · ${stats.updatedCount} updated · ${stats.openPendingCount} open pending · ${stats.gapsCount} gaps`;

  renderHandoverPreview();
}

function openHandoverModal(triggerEl = null) {
  if ($('handoverDateInput')) $('handoverDateInput').value = getDutyDateStrings().yyyymmdd;
  if ($('handoverScopeSelect')) $('handoverScopeSelect').value = 'all';
  if ($('hoShowVitalsLabs')) $('hoShowVitalsLabs').checked = true;
  if ($('hoShowResolved')) $('hoShowResolved').checked = true;
  handoverViewingDeid = false;
  rebuildHandoverReport();
  openModalEl($('handoverModal'), triggerEl);
}

function closeHandoverModal() {
  closeModalEl($('handoverModal'));
}

/* ---------- default update template & copy update text ---------- */
const TEMPLATE_KEY = 'cm.updateTemplate';
const TEMPLATE_CONFIG_KEY = 'cm.templateConfig';
let templateDirtyFlag = false;

function setTemplateDirty(dirty) {
  templateDirtyFlag = Boolean(dirty);
  const pill = $('tplDirtyPill');
  if (pill) pill.hidden = !templateDirtyFlag;
}

function cloneConfig(cfg) {
  return JSON.parse(JSON.stringify(cfg));
}

function normalizeTemplateSections(cfg) {
  const out = cloneConfig(cfg || DEFAULT_TEMPLATE_CONFIG);
  const objSec = (out.sections || []).find((s) => s.id === 'objective');
  if (objSec) {
    if (!Array.isArray(objSec.subItems)) objSec.subItems = [];
    for (const reqSub of [
      { id: 'io24', label: '24h Fluid Balance (6am)', enabled: false },
      { id: 'vent', label: 'Ventilator Settings', enabled: false },
    ]) {
      if (!objSec.subItems.some((sub) => sub.id === reqSub.id)) {
        objSec.subItems.push({ ...reqSub });
      }
    }
  }
  return out;
}

function loadSavedTemplateState() {
  const savedCfgRaw = safeGetItem(TEMPLATE_CONFIG_KEY, '');
  if (savedCfgRaw) {
    try {
      const parsed = JSON.parse(savedCfgRaw);
      if (parsed && Array.isArray(parsed.sections)) {
        return { config: normalizeTemplateSections(parsed), dirty: false };
      }
    } catch {}
  }
  const savedRaw = safeGetItem(TEMPLATE_KEY, '');
  if (savedRaw.trim()) {
    return { config: normalizeTemplateSections(DEFAULT_TEMPLATE_CONFIG), dirty: true, rawText: savedRaw };
  }
  return { config: normalizeTemplateSections(DEFAULT_TEMPLATE_CONFIG), dirty: false };
}

const initialTplState = loadSavedTemplateState();
let templateConfig = initialTplState.config;
let rawTemplateDirty = initialTplState.dirty;
let initialRawOverride = initialTplState.rawText || '';

function getSavedUpdateTemplate() {
  return safeGetItem(TEMPLATE_KEY, '');
}

function extractFooterClinicianFields(footerText) {
  const lines = String(footerText || '').split('\n');
  return {
    name: (lines[1] || '').trim(),
    service: (lines[2] || '').trim(),
  };
}

function updateClinicianFooterFieldsInConfig() {
  const nameVal = $('tplClinicianName')?.value.trim() || '';
  const serviceVal = $('tplClinicianService')?.value.trim() || '';
  const lines = String(templateConfig.footer || 'Thank you, doctor').split('\n');
  const greetingLine = (lines[0] || 'Thank you, doctor').trim() || 'Thank you, doctor';
  const nextLines = [greetingLine];
  if (nameVal || serviceVal) {
    nextLines.push(nameVal || '[Your Name]');
    if (serviceVal) nextLines.push(serviceVal);
  }
  templateConfig.footer = nextLines.join('\n');
  if ($('tplFooterInput')) $('tplFooterInput').value = templateConfig.footer;
}

function confirmVisualOverwriteOfRawOverride() {
  if (!rawTemplateDirty) return true;
  if (confirm('You have a custom raw template override. Replace it with the visual builder settings?')) {
    rawTemplateDirty = false;
    return true;
  }
  return false;
}

function updateTemplateLivePreview() {
  const rawStr = rawTemplateDirty
    ? $('defaultTemplateInput').value
    : compileTemplateConfig(templateConfig);
  if (!rawTemplateDirty) {
    $('defaultTemplateInput').value = rawStr;
  }
  const sampleNote = getSyntheticCensusData()[0];
  const block = renderCustomShiftTemplate(rawStr, sampleNote.content, '6am', { note: sampleNote });
  $('tplLivePreview').textContent = formatUpdateText(block, sampleNote);
}

function renderTemplateBuilder() {
  $('tplHeaderInput').value = templateConfig.header || '';
  $('tplShowName').checked = templateConfig.showName !== false;
  $('tplShowAgeSex').checked = templateConfig.showAgeSex !== false;
  $('tplShowRoom').checked = templateConfig.showRoom !== false;
  $('tplFooterInput').value = templateConfig.footer || '';

  const clinician = extractFooterClinicianFields(templateConfig.footer);
  if ($('tplClinicianName')) $('tplClinicianName').value = clinician.name === '[Your Name]' ? '' : clinician.name;
  if ($('tplClinicianService')) {
    $('tplClinicianService').value = clinician.service === '[Service / Hospital]' ? '' : clinician.service;
  }

  if (rawTemplateDirty && initialRawOverride) {
    $('defaultTemplateInput').value = initialRawOverride;
    initialRawOverride = '';
  }

  const sections = templateConfig.sections || [];
  const listEl = $('tplSectionsList');
  listEl.innerHTML = sections
    .map((sec, idx) => {
      const hasSubs = Array.isArray(sec.subItems) && sec.subItems.length > 0;
      const subHtml = hasSubs
        ? `<div class="tpl-subitems ${sec.enabled ? '' : 'disabled'}">
            ${sec.subItems
              .map(
                (sub, sIdx) => `
              <label class="tpl-subitem-check">
                <input type="checkbox" class="tpl-sub-toggle" data-sec-idx="${idx}" data-sub-idx="${sIdx}" ${sub.enabled ? 'checked' : ''} ${sec.enabled ? '' : 'disabled'}>
                <span>${esc(sub.label)}</span>
              </label>`
              )
              .join('')}
          </div>`
        : '';

      return `
        <div class="tpl-section-item ${sec.enabled ? '' : 'disabled'}">
          <div class="tpl-section-row">
            <label class="tpl-section-check">
              <input type="checkbox" class="tpl-sec-toggle" data-idx="${idx}" ${sec.enabled ? 'checked' : ''}>
              <span>${esc(sec.label)}</span>
            </label>
            <div class="tpl-order-btns">
              <button type="button" class="tpl-order-btn tpl-up-btn" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move up" aria-label="Move ${esc(sec.label)} up">↑</button>
              <button type="button" class="tpl-order-btn tpl-down-btn" data-idx="${idx}" ${idx === sections.length - 1 ? 'disabled' : ''} title="Move down" aria-label="Move ${esc(sec.label)} down">↓</button>
            </div>
          </div>
          ${subHtml}
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.tpl-sec-toggle').forEach((chk) => {
    chk.onchange = () => {
      if (!confirmVisualOverwriteOfRawOverride()) {
        chk.checked = !chk.checked;
        return;
      }
      const idx = Number(chk.dataset.idx);
      templateConfig.sections[idx].enabled = chk.checked;
      setTemplateDirty(true);
      renderTemplateBuilder();
    };
  });

  listEl.querySelectorAll('.tpl-sub-toggle').forEach((chk) => {
    chk.onchange = () => {
      if (!confirmVisualOverwriteOfRawOverride()) {
        chk.checked = !chk.checked;
        return;
      }
      const secIdx = Number(chk.dataset.secIdx);
      const subIdx = Number(chk.dataset.subIdx);
      templateConfig.sections[secIdx].subItems[subIdx].enabled = chk.checked;
      setTemplateDirty(true);
      updateTemplateLivePreview();
    };
  });

  listEl.querySelectorAll('.tpl-up-btn').forEach((btn) => {
    btn.onclick = () => {
      if (!confirmVisualOverwriteOfRawOverride()) return;
      const idx = Number(btn.dataset.idx);
      if (idx <= 0) return;
      const arr = templateConfig.sections;
      [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      setTemplateDirty(true);
      renderTemplateBuilder();
    };
  });

  listEl.querySelectorAll('.tpl-down-btn').forEach((btn) => {
    btn.onclick = () => {
      if (!confirmVisualOverwriteOfRawOverride()) return;
      const idx = Number(btn.dataset.idx);
      const arr = templateConfig.sections;
      if (idx >= arr.length - 1) return;
      [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
      setTemplateDirty(true);
      renderTemplateBuilder();
    };
  });

  updateTemplateLivePreview();
}

function updateCompanionConnHint() {
  const el = $('companionConnHint');
  if (!el) return;
  const endpoint = $('endpoint').value.trim();
  const model = $('model').value.trim();
  const key = $('apiKey').value.trim();
  if (endpoint && model && key) {
    el.textContent = `Ready: ${model} · Key in memory`;
  } else if (endpoint && model) {
    el.textContent = 'API key not set — open Settings';
  } else if (endpoint || model) {
    el.textContent = 'Finish AI settings — open Settings';
  } else {
    el.textContent = 'AI connection not configured';
  }
}

async function copyUpdateTextForContent(content, note = {}) {
  const text = formatUpdateText(content, note);
  if (!text) return toast('No update text found in this chart');
  await copyTextWithFallback(text, 'Copied raw update text for attending', 'Copy Attending Update');
}

async function openWithPrompt(noteId, promptText) {
  await select(noteId);
  $('question').value = promptText;
  await setMode('editor');
  const detailsEl = $('companionDetails');
  if (detailsEl) detailsEl.open = true;
  buildPreview();
  requestAnimationFrame(() => {
    detailsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  toast('Prompt staged for Companion — review preview');
}

async function loadSampleCensus() {
  const samples = getSyntheticCensusData();
  const existingSamples = samples.filter((s) => notes.some((n) => n.id === s.id));
  let overwriteExisting = true;
  if (existingSamples.length > 0) {
    overwriteExisting = confirm(
      `${existingSamples.length} sample patient chart(s) already exist locally. Overwrite them with fresh synthetic defaults? (Cancel imports only missing sample charts.)`
    );
  }
  let count = 0;
  for (const s of samples) {
    if (!overwriteExisting && notes.some((n) => n.id === s.id)) continue;
    await put(s);
    count++;
  }
  await refresh();
  toast(count ? `${count} synthetic patient(s) loaded for practice rounds` : 'No existing sample charts overwritten');
}

async function newNoteAndEdit(triggerEl = null) {
  openAdmitModal({ mode: 'new', triggerEl: triggerEl || $('quickNewPtBtn') });
}

/* ---------- quick notes / scratchpad (localStorage only, separate from charts) ---------- */
function loadScratchNotes() {
  try {
    const raw = safeGetItem(SCRATCH_KEY, '');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScratchNotes() {
  safeSetItem(SCRATCH_KEY, JSON.stringify(scratchNotes));
}

function isScratchEditorDirty() {
  if ($('scratchEditorCard')?.hidden) return false;
  const cur = JSON.stringify({
    title: $('scratchTitleInput').value.trim(),
    category: $('scratchCategoryInput').value,
    pinned: $('scratchPinnedInput').checked,
    body: $('scratchBodyInput').value.trim(),
  });
  return cur !== scratchInitialSnapshot;
}

function openScratchEditor(noteId = null) {
  editingScratchId = noteId;
  const existing = noteId ? scratchNotes.find((n) => n.id === noteId) : null;
  $('scratchEditorHeading').textContent = existing ? 'Edit Quick Note' : 'New Quick Note';
  $('scratchTitleInput').value = existing ? existing.title || '' : '';
  $('scratchCategoryInput').value = existing
    ? existing.category || 'Drips'
    : scratchFilter !== 'all'
      ? scratchFilter
      : 'Drips';
  $('scratchPinnedInput').checked = existing ? Boolean(existing.pinned) : false;
  $('scratchBodyInput').value = existing ? existing.body || '' : '';

  scratchInitialSnapshot = JSON.stringify({
    title: $('scratchTitleInput').value.trim(),
    category: $('scratchCategoryInput').value,
    pinned: $('scratchPinnedInput').checked,
    body: $('scratchBodyInput').value.trim(),
  });

  $('scratchEditorCard').hidden = false;
  $('scratchEditorCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('scratchTitleInput').focus();
}

function closeScratchEditor(force = false) {
  if (!force && isScratchEditorDirty()) {
    if (!confirm('Discard unsaved edits to this quick note?')) return;
  }
  $('scratchEditorCard').hidden = true;
  editingScratchId = null;
}

function saveScratchNote() {
  const title = $('scratchTitleInput').value.trim();
  const category = $('scratchCategoryInput').value || 'Scratchpad';
  const pinned = $('scratchPinnedInput').checked;
  const body = $('scratchBodyInput').value.trim();

  if (!title && !body) {
    return toast('Enter a title or note text first');
  }

  const now = Date.now();
  if (editingScratchId) {
    const idx = scratchNotes.findIndex((n) => n.id === editingScratchId);
    if (idx !== -1) {
      scratchNotes[idx] = {
        ...scratchNotes[idx],
        title: title || 'Untitled Note',
        category,
        pinned,
        body,
        updated: now,
      };
    }
  } else {
    scratchNotes.unshift({
      id: uid(),
      title: title || 'Untitled Note',
      category,
      pinned,
      body,
      updated: now,
    });
  }

  saveScratchNotes();
  clearRecoveryDraft('scratch');
  closeScratchEditor(true);
  renderScratchNotes();
  toast('Quick note saved locally');
}

function loadSampleScratchNotes() {
  const now = Date.now();
  const defaults = [
    {
      id: 'sample-drip-norepi',
      title: 'Norepinephrine Drip Prep',
      category: 'Drips',
      pinned: true,
      body: [
        '4 mg (4 mL) in 250 mL D5W (16 mcg/mL) or 4 mg in 100 mL D5W (40 mcg/mL).',
        'Start: 0.05 mcg/kg/min; titrate to target MAP >= 65 mmHg.',
        'Use central line when available; inspect peripheral site q1h if running peripherally.',
      ].join('\n'),
      updated: now,
    },
    {
      id: 'sample-med-kcl',
      title: 'Potassium Repletion Quick Ref',
      category: 'Meds',
      pinned: false,
      body: [
        'Check serum Mg alongside K (correct hypomagnesemia if refractory).',
        'Peripheral IV max: 10 mEq/hr; Central line: up to 20 mEq/hr with telemetry.',
        'Recheck serum K 2–4h after IV repletion.',
      ].join('\n'),
      updated: now - 60000,
    },
  ];
  let added = 0;
  for (const s of defaults) {
    if (!scratchNotes.some((n) => n.id === s.id)) {
      scratchNotes.push(s);
      added++;
    }
  }
  saveScratchNotes();
  renderScratchNotes();
  toast(added ? `Added ${added} sample reference note(s)` : 'Sample references already present');
}

function updateScratchFilterChipCounts() {
  const chips = document.querySelectorAll('#scratchFilterChips .chip');
  chips.forEach((chip) => {
    const cat = chip.dataset.cat;
    const baseLabel = chip.dataset.baseLabel || chip.textContent.replace(/\s*\(\d+\)$/, '');
    chip.dataset.baseLabel = baseLabel;
    const count =
      cat === 'all' ? scratchNotes.length : scratchNotes.filter((n) => n.category === cat).length;
    chip.textContent = `${baseLabel} (${count})`;
    chip.setAttribute('aria-pressed', String(chip.classList.contains('active')));
  });
}

function renderScratchNotes() {
  const grid = $('scratchGrid');
  if (!grid) return;
  updateScratchFilterChipCounts();

  if (!scratchNotes.length) {
    grid.innerHTML = `
      <div class="timeline-empty" style="grid-column: 1/-1;">
        <p style="margin: 0 0 12px;">No quick notes yet. Jot down drip dilutions, infusion preps, or clinical reminders.</p>
        <div class="row" style="justify-content: center;">
          <button type="button" id="emptyNewScratchBtn" class="primary">${uiIcon('plus')} New Note</button>
          <button type="button" id="emptyLoadSampleScratchBtn" class="btn">${uiIcon('droplet')} Load Sample Drip Prep</button>
        </div>
      </div>`;
    const newBtn = $('emptyNewScratchBtn');
    const sampleBtn = $('emptyLoadSampleScratchBtn');
    if (newBtn) newBtn.onclick = () => openScratchEditor(null);
    if (sampleBtn) sampleBtn.onclick = loadSampleScratchNotes;
    return;
  }

  let filtered = [...scratchNotes];
  if (scratchFilter !== 'all') {
    filtered = filtered.filter((n) => n.category === scratchFilter);
  }
  if (scratchSearch.trim()) {
    const q = scratchSearch.trim().toLowerCase();
    filtered = filtered.filter(
      (n) =>
        (n.title || '').toLowerCase().includes(q) ||
        (n.category || '').toLowerCase().includes(q) ||
        (n.body || '').toLowerCase().includes(q)
    );
  }

  filtered.sort((a, b) => {
    const pinDiff = Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
    if (pinDiff !== 0) return pinDiff;
    return (b.updated || 0) - (a.updated || 0);
  });

  if (!filtered.length) {
    grid.innerHTML = `
      <div class="timeline-empty" style="grid-column: 1/-1;">
        No notes match the current filter (${esc(scratchFilter)}) or search.
      </div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((n) => {
      const updatedTxt = n.updated ? new Date(n.updated).toLocaleDateString() : '';
      const isLong = String(n.body || '').split('\n').length > 6 || String(n.body || '').length > 260;
      const targetChart = currentId ? notes.find((pt) => pt.id === currentId) : null;
      return `
      <div class="scratch-card ${n.pinned ? 'pinned' : ''}" data-id="${n.id}">
        <div class="scratch-head">
          <div>
            <h3 class="scratch-title">${n.pinned ? `${uiIcon('pin')} ` : ''}${esc(n.title || 'Untitled Note')}</h3>
            ${updatedTxt ? `<div class="cf-meta">Updated ${esc(updatedTxt)}</div>` : ''}
          </div>
          <span class="scratch-cat-badge">${esc(n.category || 'Scratchpad')}</span>
        </div>
        ${
          n.body
            ? `<div class="scratch-body" data-id="${n.id}">${esc(n.body)}</div>${
                isLong
                  ? `<button type="button" class="btn sm-btn subtle scratch-expand-btn" data-id="${n.id}">Expand</button>`
                  : ''
              }`
            : '<div class="cf-meta">No details added yet.</div>'
        }
        <div class="scratch-foot">
          <button type="button" class="btn subtle scratch-copy-btn" data-id="${n.id}">${uiIcon('copy')} Copy</button>
          <button type="button" class="btn subtle scratch-insert-btn" data-id="${n.id}" ${
            targetChart ? `title="Insert into ${esc(targetChart.room || targetChart.title)}"` : 'title="Select a chart first"'
          }>${uiIcon('plus')} Chart</button>
          <button type="button" class="btn subtle scratch-pin-btn" data-id="${n.id}">${n.pinned ? 'Unpin' : `${uiIcon('pin')} Pin`}</button>
          <button type="button" class="btn subtle scratch-edit-btn" data-id="${n.id}">${uiIcon('pencil')} Edit</button>
          <button type="button" class="btn danger scratch-del-btn" data-id="${n.id}" aria-label="Delete ${esc(n.title || 'note')}">${uiIcon('trash')}</button>
        </div>
      </div>`;
    })
    .join('');

  grid.querySelectorAll('.scratch-expand-btn').forEach((btn) => {
    btn.onclick = () => {
      const bodyEl = grid.querySelector(`.scratch-body[data-id="${CSS.escape(btn.dataset.id)}"]`);
      if (!bodyEl) return;
      const expanded = bodyEl.classList.toggle('expanded');
      btn.textContent = expanded ? 'Collapse' : 'Expand';
    };
  });

  grid.querySelectorAll('.scratch-copy-btn').forEach((btn) => {
    btn.onclick = async () => {
      const note = scratchNotes.find((n) => n.id === btn.dataset.id);
      if (!note) return;
      const text = [note.title, note.body].filter(Boolean).join('\n\n');
      await copyTextWithFallback(text, 'Note copied to clipboard', 'Copy Quick Note');
    };
  });

  grid.querySelectorAll('.scratch-insert-btn').forEach((btn) => {
    btn.onclick = async () => {
      const sNote = scratchNotes.find((n) => n.id === btn.dataset.id);
      const targetChart = currentId ? notes.find((pt) => pt.id === currentId) : null;
      if (!sNote) return;
      if (!targetChart) {
        return toast('Open a patient chart first to insert a quick note');
      }
      const leaks = findLeaks([sNote.title, sNote.body].join('\n'), profileForNote(targetChart));
      if (leaks.length > 0 && !confirm(`PHI reminder: this reference contains "${leaks[0].value}". Insert into ${targetChart.room || targetChart.title}?`)) {
        return;
      }
      const insertBlock = `${sNote.title ? `**${sNote.title}:**\n` : ''}${sNote.body || ''}`.trim();
      targetChart.content = appendShiftBlock(
        targetChart.content,
        defaultShiftForHour(),
        getDutyDateStrings().mmddyyyy,
        insertBlock,
        null,
        { mergeExistingShift: true }
      );
      targetChart.updated = Date.now();
      await put(targetChart);
      await refresh();
      if (currentId === targetChart.id) {
        $('noteText').value = targetChart.content;
        lastSavedChartContent = targetChart.content;
        if (editorViewMode === 'timeline') renderChartTimeline();
      }
      toast(`Inserted into ${targetChart.room || targetChart.title}`);
    };
  });

  grid.querySelectorAll('.scratch-pin-btn').forEach((btn) => {
    btn.onclick = () => {
      const note = scratchNotes.find((n) => n.id === btn.dataset.id);
      if (!note) return;
      note.pinned = !note.pinned;
      saveScratchNotes();
      renderScratchNotes();
    };
  });

  grid.querySelectorAll('.scratch-edit-btn').forEach((btn) => {
    btn.onclick = () => openScratchEditor(btn.dataset.id);
  });

  grid.querySelectorAll('.scratch-del-btn').forEach((btn) => {
    btn.onclick = () => {
      const deleted = scratchNotes.find((n) => n.id === btn.dataset.id);
      if (!deleted) return;
      const idx = scratchNotes.findIndex((n) => n.id === btn.dataset.id);
      scratchNotes = scratchNotes.filter((n) => n.id !== btn.dataset.id);
      if (editingScratchId === btn.dataset.id) closeScratchEditor(true);
      saveScratchNotes();
      renderScratchNotes();
      toast('Quick note deleted', {
        onUndo: () => {
          scratchNotes.splice(idx, 0, deleted);
          saveScratchNotes();
          renderScratchNotes();
          toast('Quick note restored');
        },
      });
    };
  });
}

/* ---------- dump-to-chart inbox & lab trending ---------- */
function loadInbox() {
  try {
    const raw = safeGetItem(INBOX_KEY, '');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInbox() {
  safeSetItem(INBOX_KEY, JSON.stringify(inboxItems));
}

function updateInboxBadge() {
  const badge = $('inboxBadge');
  if (!badge) return;
  const openCount = inboxItems.filter((x) => x.status !== 'filed').length;
  badge.textContent = String(openCount);
  badge.hidden = openCount === 0;
}

function buildGroupedPatientOptionsHtml(blankLabel = '') {
  const sorted = [...notes]
    .map((n) => ({ note: n, parsed: parseChart(n.content, n) }))
    .sort((a, b) => naturalBedCompare(a.parsed.room, b.parsed.room));

  const active = sorted.filter((s) => s.parsed.isCensus && !s.parsed.isCharity);
  const charity = sorted.filter((s) => s.parsed.isCharity);
  const discharged = sorted.filter((s) => !s.parsed.isCensus && !s.parsed.isCharity);

  const mkOpt = ({ note, parsed }) =>
    `<option value="${esc(note.id)}">${esc(parsed.room || 'Unassigned')} · ${esc(parsed.name)}</option>`;

  const parts = blankLabel ? [`<option value="">${esc(blankLabel)}</option>`] : [];
  if (active.length) parts.push(`<optgroup label="Active Census">${active.map(mkOpt).join('')}</optgroup>`);
  if (charity.length) parts.push(`<optgroup label="Charity">${charity.map(mkOpt).join('')}</optgroup>`);
  if (discharged.length) parts.push(`<optgroup label="Discharged">${discharged.map(mkOpt).join('')}</optgroup>`);
  return parts.join('');
}

function populateInboxTargets(selectedId = '') {
  const selectEl = $('inboxTargetSelect');
  if (!selectEl) return;
  selectEl.innerHTML = buildGroupedPatientOptionsHtml('— Select target patient —');
  selectEl.value = selectedId && notes.some((n) => n.id === selectedId) ? selectedId : '';
}

function renderInboxQueue() {
  const section = $('inboxQueueSection');
  const listEl = $('inboxQueueList');
  if (!section || !listEl) return;

  if (!inboxItems.length) {
    section.hidden = true;
    listEl.innerHTML = '';
    return;
  }

  section.hidden = false;
  listEl.innerHTML = inboxItems
    .map((item) => {
      const firstLine = stripChatPrefixes(item.rawText).split('\n').find((l) => l.trim()) || item.rawText;
      const statusLbl =
        item.status === 'filed'
          ? `${uiIcon('check')} Filed`
          : item.status === 'unresolved'
            ? `${uiIcon('alert')} Unresolved`
            : 'Pending';
      return `
        <div class="inbox-queue-item-wrap">
          <button type="button" class="inbox-queue-item ${item.id === inboxSelectedQueueId ? 'active' : ''}" data-id="${item.id}">
            <span class="inbox-queue-snippet">${esc(firstLine)}</span>
            <span class="inbox-status ${esc(item.status)}">${statusLbl}</span>
          </button>
          <button type="button" class="btn close-btn inbox-del-btn" data-id="${item.id}" title="Remove" aria-label="Remove queued item">${uiIcon('x')}</button>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.inbox-queue-item').forEach((row) => {
    row.onclick = () => {
      inboxSelectedQueueId = row.dataset.id;
      const item = inboxItems.find((x) => x.id === inboxSelectedQueueId);
      inboxUserSelectedTarget = false;
      if (item && item.resolvedNoteId && !inboxPinnedNoteId) {
        $('inboxTargetSelect').value = item.resolvedNoteId;
        inboxUserSelectedTarget = true;
      }
      renderInboxQueue();
      updateInboxDryRun();
    };
  });

  listEl.querySelectorAll('.inbox-del-btn').forEach((btn) => {
    btn.onclick = () => {
      const removedItem = inboxItems.find((x) => x.id === btn.dataset.id);
      const removedIdx = inboxItems.findIndex((x) => x.id === btn.dataset.id);
      inboxItems = inboxItems.filter((x) => x.id !== btn.dataset.id);
      if (inboxSelectedQueueId === btn.dataset.id) {
        inboxSelectedQueueId = inboxItems[0]?.id || null;
      }
      saveInbox();
      updateInboxBadge();
      renderInboxQueue();
      updateInboxDryRun();
      if (removedItem) {
        toast('Removed inbox item', {
          onUndo: () => {
            inboxItems.splice(removedIdx, 0, removedItem);
            saveInbox();
            updateInboxBadge();
            renderInboxQueue();
            updateInboxDryRun();
          },
        });
      }
    };
  });
}

function setBannerWithCandidates(banner, cls, msg, candidates = []) {
  banner.className = `resolve-banner ${cls}`.trim();
  banner.innerHTML = `<span>${esc(msg)}</span>`;
  if (candidates && candidates.length) {
    const row = document.createElement('div');
    row.className = 'inbox-candidate-row';
    for (const cand of candidates.slice(0, 4)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'inbox-candidate-chip';
      btn.innerHTML = `${uiIcon('check')} Confirm ${esc(cand.parsed?.room || cand.note.room || '')} · ${esc(cand.parsed?.name || cand.note.name || '')}`;
      btn.onclick = () => {
        inboxPinnedNoteId = null;
        $('inboxTargetSelect').value = cand.note.id;
        inboxUserSelectedTarget = true;
        updateInboxDryRun();
      };
      row.appendChild(btn);
    }
    banner.appendChild(row);
  }
}

function updateInboxDryRun() {
  const activeItem = inboxSelectedQueueId
    ? inboxItems.find((x) => x.id === inboxSelectedQueueId)
    : null;
  const rawText = activeItem ? activeItem.rawText : $('inboxPasteInput').value;
  const banner = $('inboxResolveBanner');
  const censusFlag = $('inboxCensusFlag');
  const selectEl = $('inboxTargetSelect');
  const fileBtn = $('inboxFileBtn');
  if (fileBtn) {
    fileBtn.innerHTML =
      activeItem?.status === 'filed'
        ? `${uiIcon('inbox')} File Again (Already Filed)`
        : `${uiIcon('inbox')} File to Chart`;
  }

  let targetNote = null;

  if (inboxPinnedNoteId) {
    targetNote = notes.find((n) => n.id === inboxPinnedNoteId) || null;
    if (targetNote) {
      selectEl.value = targetNote.id;
      const p = parseChart(targetNote.content, targetNote);
      setBannerWithCandidates(banner, 'matched', `✓ Target chart locked (${p.room} · ${p.name})`);
    }
  } else if (inboxUserSelectedTarget && selectEl.value) {
    targetNote = notes.find((n) => n.id === selectEl.value) || null;
    if (targetNote) {
      const p = parseChart(targetNote.content, targetNote);
      setBannerWithCandidates(banner, 'matched', `✓ Target patient confirmed (${p.room} · ${p.name})`);
    }
  } else if (rawText.trim()) {
    const res = resolvePatientFromRelay(rawText, notes);
    if (res.status === 'matched' && res.match) {
      targetNote = res.match;
      selectEl.value = targetNote.id;
      setBannerWithCandidates(banner, 'matched', `✓ ${res.reason}`);
    } else if (
      res.status === 'ambiguous-room-only' ||
      res.status === 'ambiguous-name-only' ||
      res.status === 'ambiguous-multiple'
    ) {
      selectEl.value = '';
      setBannerWithCandidates(banner, 'warn', `⚠️ ${res.reason}`, res.candidates || []);
    } else {
      selectEl.value = '';
      setBannerWithCandidates(banner, 'unresolved', `❓ ${res.reason}`);
    }
  } else {
    selectEl.value = '';
    setBannerWithCandidates(banner, '', 'Paste a message or select a target patient below.');
  }

  if (targetNote) {
    const p = parseChart(targetNote.content, targetNote);
    if (!p.isCensus) {
      censusFlag.textContent = 'DISCHARGED (census: false)';
      censusFlag.className = 'pill block';
    } else if (p.isCharity) {
      censusFlag.textContent = 'CHARITY';
      censusFlag.className = 'pill';
    } else {
      censusFlag.textContent = 'ACTIVE CENSUS';
      censusFlag.className = 'pill safe';
    }
  } else {
    censusFlag.textContent = 'NO PATIENT';
    censusFlag.className = 'pill';
  }

  const cleaned = stripChatPrefixes(rawText);
  const chipsEl = $('inboxLabChips');
  const previewEl = $('inboxDryRunPreview');
  const narrativeBar = $('inboxNarrativeBar');

  if (!rawText.trim()) {
    lastInboxTrended = null;
    chipsEl.innerHTML = '';
    previewEl.value = '';
    if (narrativeBar) narrativeBar.hidden = true;
    return;
  }

  if (inboxMode === 'labs') {
    const baseChart = targetNote
      ? currentMode === 'editor' && currentId === targetNote.id
        ? $('noteText').value
        : targetNote.content
      : '';
    const style = $('inboxLabStyleToggle').checked ? 'inline' : 'line';
    const trended = buildTrendedLabs(cleaned, baseChart, { style });
    lastInboxTrended = trended;

    const ignoredCount = trended.ignoredLines?.length || 0;
    if (narrativeBar) {
      narrativeBar.hidden = ignoredCount === 0;
      if ($('inboxNarrativeInfo')) {
        $('inboxNarrativeInfo').textContent = `${ignoredCount} non-lab narrative line(s) omitted in Labs mode.`;
      }
    }

    chipsEl.innerHTML = trended.entries.length
      ? trended.entries
          .map((e) => {
            const cls = e.flag === 'H' ? 'high' : e.flag === 'L' ? 'low' : 'norm';
            return `<span class="lab-chip ${cls}">${esc(e.token)}</span>`;
          })
          .join('')
      : '<span class="cf-meta">No standard lab values detected — switch to Raw Chat Relay if this is a text note.</span>';

    let finalPreview = trended.formattedBlock;
    if ($('inboxIncludeNarrative')?.checked && ignoredCount > 0) {
      finalPreview = [trended.formattedBlock.trim(), ...trended.ignoredLines].filter(Boolean).join('\n');
    }
    previewEl.value = finalPreview;
  } else {
    lastInboxTrended = null;
    if (narrativeBar) narrativeBar.hidden = true;
    chipsEl.innerHTML = '';
    previewEl.value = cleaned;
  }
}

function openInboxModal(preselectedNoteId = null, triggerEl = null) {
  inboxPinnedNoteId = preselectedNoteId || null;
  inboxSelectedQueueId = null;
  inboxUserSelectedTarget = Boolean(preselectedNoteId);
  inboxMode = 'labs';
  inboxShift = defaultShiftForHour();

  $('inboxModeLabs').classList.add('active');
  $('inboxModeLabs').setAttribute('aria-pressed', 'true');
  $('inboxModeRelay').classList.remove('active');
  $('inboxModeRelay').setAttribute('aria-pressed', 'false');

  renderShiftPillGroup('inboxShiftPills', inboxShift);
  if ($('inboxInterimTimeInput')) $('inboxInterimTimeInput').value = nowHhMm();
  syncModalInterimTimeUi(inboxShift, 'inboxInterimTimeWrap', 'inboxInterimTimeInput');

  if ($('inboxDateInput')) $('inboxDateInput').value = getDefaultDutyIsoForShift(inboxShift);
  if ($('inboxIncludeNarrative')) $('inboxIncludeNarrative').checked = false;

  if (!preselectedNoteId && !$('inboxPasteInput').value.trim()) {
    const firstPending = inboxItems.find((x) => x.status !== 'filed');
    if (firstPending) {
      inboxSelectedQueueId = firstPending.id;
    }
  }

  populateInboxTargets(preselectedNoteId || '');
  renderInboxQueue();
  updateInboxDryRun();
  openModalEl($('inboxModal'), triggerEl, $('inboxPasteInput'));
}

function closeInboxModal(force = false) {
  const hasDraftPaste = Boolean($('inboxPasteInput')?.value.trim());
  if (!force && hasDraftPaste) {
    if (!confirm('Discard pasted text not yet captured to Inbox?')) return false;
  }
  closeModalEl($('inboxModal'));
  inboxPinnedNoteId = null;
  return true;
}

function captureToInbox(rawText) {
  const clean = String(rawText || '').trim();
  if (!clean) return toast('Paste a lab dump or chat relay first');
  const res = resolvePatientFromRelay(clean, notes);
  const item = {
    id: uid(),
    rawText: clean,
    status: res.status === 'matched' ? 'pending' : 'unresolved',
    resolvedNoteId: res.status === 'matched' && res.match ? res.match.id : null,
    createdAt: Date.now(),
  };
  inboxItems.unshift(item);
  inboxSelectedQueueId = item.id;
  inboxUserSelectedTarget = false;
  $('inboxPasteInput').value = '';
  saveInbox();
  updateInboxBadge();
  renderInboxQueue();
  updateInboxDryRun();
  toast(res.status === 'matched' ? 'Captured & matched to patient' : 'Captured to inbox (needs patient match)');
}

/* ---------- clinical calculators & guideline audit modal (Milestone 4) ---------- */
let calcNoteId = '';
let calcActiveTab = 'audit';
let calcDripMode = 'rate2dose';
let lastAuditResult = null;
let lastDripResult = null;

function populateCalcPatientSelect(selectedId = '') {
  const selectEl = $('calcPatientSelect');
  if (!selectEl) return;
  selectEl.innerHTML = buildGroupedPatientOptionsHtml('— Standalone / No patient selected —');
  selectEl.value = selectedId && notes.some((n) => n.id === selectedId) ? selectedId : '';
}

function populateDripPresets() {
  const sel = $('dripPresetSelect');
  if (!sel) return;
  sel.innerHTML = DRIP_PRESETS.map((p) => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('');
}

function setCalcTab(tab) {
  calcActiveTab = tab === 'drip' ? 'drip' : 'audit';
  if (calcActiveTab === 'drip') calcUserTouchedDrip = true;
  $('calcAuditPane').hidden = calcActiveTab !== 'audit';
  $('calcDripPane').hidden = calcActiveTab !== 'drip';
  $('calcTabAudit').classList.toggle('active', calcActiveTab === 'audit');
  $('calcTabAudit').setAttribute('aria-pressed', String(calcActiveTab === 'audit'));
  $('calcTabDrip').classList.toggle('active', calcActiveTab === 'drip');
  $('calcTabDrip').setAttribute('aria-pressed', String(calcActiveTab === 'drip'));
}

function setDripMode(mode, rerender = true) {
  calcDripMode = mode === 'dose2rate' ? 'dose2rate' : 'rate2dose';
  $('dripModeRateBtn').classList.toggle('active', calcDripMode === 'rate2dose');
  $('dripModeRateBtn').setAttribute('aria-pressed', String(calcDripMode === 'rate2dose'));
  $('dripModeDoseBtn').classList.toggle('active', calcDripMode === 'dose2rate');
  $('dripModeDoseBtn').setAttribute('aria-pressed', String(calcDripMode === 'dose2rate'));
  $('dripRateField').hidden = calcDripMode !== 'rate2dose';
  $('dripTargetDoseField').hidden = calcDripMode !== 'dose2rate';
  $('dripTargetUnitField').hidden = calcDripMode !== 'dose2rate';
  if (rerender) renderDripCalculator();
}

function applyDripPreset(presetId, customRateOrDose = null) {
  const preset = DRIP_PRESETS.find((p) => p.id === presetId) || DRIP_PRESETS[0];
  $('dripPresetSelect').value = preset.id;
  $('dripDrugNameInput').value = preset.drugName;
  $('dripAmountInput').value = preset.totalDrugAmount !== '' ? String(preset.totalDrugAmount) : '';
  $('dripUnitSelect').value = preset.drugUnit;
  $('dripBagVolInput').value = String(preset.bagVolumeMl);
  $('dripRateInput').value = String(preset.defaultRateMlHr);
  $('dripTargetUnitSelect').value = preset.defaultTargetUnit || 'mcg/kg/min';
  if (customRateOrDose !== null && customRateOrDose !== undefined) {
    if (calcDripMode === 'dose2rate') {
      $('dripTargetDoseInput').value = String(customRateOrDose);
    } else {
      $('dripRateInput').value = String(customRateOrDose);
    }
  } else if (!$('dripTargetDoseInput').value) {
    $('dripTargetDoseInput').value = preset.weightBased ? '0.05' : String(preset.defaultRateMlHr);
  }
}

function syncDripFromChart(note) {
  const content = getActiveCalcNoteContent(note);
  const inputs = extractClinicalInputs(content, note || {});
  $('dripWeightInput').value = inputs.weight?.valueKg ? String(inputs.weight.valueKg) : '';

  const medJoined = inputs.medLines.join('\n');
  const matchedPreset = DRIP_PRESETS.find(
    (p) => p.id !== 'custom' && p.drugName && new RegExp(`\\b${p.drugName}\\b`, 'i').test(medJoined)
  );
  calcChartHasDrip = Boolean(matchedPreset);

  if (matchedPreset) {
    const wtDoseMatch = medJoined.match(
      new RegExp(`${matchedPreset.drugName}[^\\n]*?(?:@|at)\\s*(\\d+(?:\\.\\d+)?)\\s*(mcg\\/kg\\/min|mcg\\/kg\\/hr)`, 'i')
    );
    const pumpRateMatch = medJoined.match(
      new RegExp(`${matchedPreset.drugName}[^\\n]*?(?:@|at)\\s*(\\d+(?:\\.\\d+)?)\\s*(ml\\/hr|cc\\/hr|units\\/hr)`, 'i')
    );

    if (wtDoseMatch && inputs.weight?.valueKg) {
      setDripMode('dose2rate', false);
      applyDripPreset(matchedPreset.id, wtDoseMatch[1]);
      $('dripTargetUnitSelect').value = wtDoseMatch[2].toLowerCase();
    } else if (pumpRateMatch) {
      setDripMode('rate2dose', false);
      applyDripPreset(matchedPreset.id, pumpRateMatch[1]);
      if (/units\/hr/i.test(pumpRateMatch[2])) {
        setDripMode('dose2rate', false);
        $('dripTargetDoseInput').value = pumpRateMatch[1];
        $('dripTargetUnitSelect').value = 'units/hr';
      }
    } else {
      setDripMode('rate2dose', false);
      applyDripPreset(matchedPreset.id);
    }
  } else {
    setDripMode('rate2dose', false);
    applyDripPreset('norepi_std');
  }
}

function getActiveCalcNoteContent(note) {
  if (!note) return '';
  if (currentMode === 'editor' && currentId === note.id) {
    return $('noteText').value;
  }
  return note.content;
}

function readCalcOverrides() {
  return {
    age: $('calcOverrideAge').value.trim(),
    sex: $('calcOverrideSex').value.trim(),
    weightKg: $('calcOverrideWeight').value.trim(),
    scrMgDl: $('calcOverrideCr').value.trim(),
  };
}

function renderRenalCardHtml(title, res, charted) {
  const hasCalc = res && res.status === 'OK';
  const badgeCls = hasCalc ? 'calculated' : 'missing';
  const badgeTxt = hasCalc ? 'CALCULATED' : 'NOT AVAILABLE';
  const mainVal = hasCalc ? `${esc(res.value)} <span style="font-size:12px;font-weight:600;">${esc(res.unit)}</span>` : esc(res.message);
  const chartedNote = charted
    ? `<div class="calc-sub"><span class="calc-badge charted">CHARTED</span> ${esc(charted.value)} ${esc(res.unit)}${charted.date ? ` (${esc(charted.date)})` : ''}</div>`
    : '';
  const inputsNote = hasCalc ? `<div class="calc-sub">Inputs: ${esc(res.inputsSummary)}</div>` : '';

  return `
    <div class="calc-card${hasCalc ? '' : ' missing'}">
      <div class="calc-card-head">
        <span class="calc-card-title">${esc(title)}</span>
        <span class="calc-badge ${badgeCls}">${badgeTxt}</span>
      </div>
      <div class="calc-val${hasCalc ? '' : ' missing-txt'}">${mainVal}</div>
      ${inputsNote}
      ${chartedNote}
    </div>`;
}

function renderAuditPane() {
  const note = notes.find((n) => n.id === calcNoteId) || null;
  const content = getActiveCalcNoteContent(note);
  const overrides = readCalcOverrides();
  const extraDrug = $('calcNewDrugInput').value.trim();

  const effectiveNote = note ? { ...note, content } : { content: '' };
  const audit = runClinicalAudit(effectiveNote, { overrides, extraDrug });
  lastAuditResult = audit;

  const { inputs, renal, interactions, flags } = audit;

  if (note) {
    const p = inputs.parsed;
    const roomStr = p.room || 'Unassigned';
    const parts = [
      roomStr,
      inputs.age ? `${inputs.age}yo` : 'Age ?',
      inputs.sex || 'Sex ?',
      inputs.weight?.valueKg ? `${inputs.weight.valueKg} kg` : 'Wt ?',
      inputs.creatinine && !inputs.creatinine.invalidUnit
        ? `SCr ${inputs.creatinine.value} mg/dL${inputs.creatinine.stale ? ' (stale)' : ''}`
        : inputs.creatinine?.invalidUnit
          ? `SCr ${inputs.creatinine.value} ${inputs.creatinine.unit}`
          : 'SCr ?',
    ];
    $('calcPatientMeta').textContent = parts.join(' · ');
  } else {
    $('calcPatientMeta').textContent = 'Standalone check · Use What-If Overrides below';
  }

  const wtMissing =
    note &&
    (!inputs.weight || !inputs.weight.valueKg || inputs.weight.stale || inputs.weight.invalidUnit) &&
    !overrides.weightKg;
  $('calcMissingWeightBar').hidden = !wtMissing;

  $('calcRenalGrid').innerHTML = [
    renderRenalCardHtml('CKD-EPI eGFR (2021)', renal.egfr, renal.chartedEgfr),
    renderRenalCardHtml('Cockcroft-Gault CrCl', renal.crcl, renal.chartedCrCl),
  ].join('');

  const flagsEl = $('calcFlagsList');
  flagsEl.innerHTML = flags.length
    ? flags
        .map(
          (f) => `
        <div class="calc-flag-card ${esc(f.severity)}">
          <div class="calc-flag-title">${esc(f.criterion)}</div>
          <div>${esc(f.question)}</div>
          <div class="calc-flag-src">Source: ${esc(f.source)}</div>
        </div>`
        )
        .join('')
    : `<div class="calc-ok-note ico-inline">${uiIcon('check')} No triggered guideline flags, missing prerequisites, or estimate discordance detected.</div>`;

  const ixEl = $('calcInteractionsList');
  ixEl.innerHTML = interactions.length
    ? interactions.map((ix) => `<div class="calc-interaction-row ico-inline">${uiIcon('alert')} ${esc(ix.line)}</div>`).join('')
    : `<div class="cf-meta">${
        inputs.medLines.length || extraDrug
          ? 'No major curated interactions found across documented chart meds.'
          : 'No active meds parsed from chart yet — type a drug above to screen.'
      }</div>`;
}

function renderDripCalculator() {
  const note = notes.find((n) => n.id === calcNoteId) || null;
  const content = getActiveCalcNoteContent(note);
  const inputs = extractClinicalInputs(content, note || {});

  const drugName = $('dripDrugNameInput').value.trim();
  const totalDrugAmount = $('dripAmountInput').value;
  const drugUnit = $('dripUnitSelect').value;
  const bagVolumeMl = $('dripBagVolInput').value;
  const weightKg = $('dripWeightInput').value.trim();
  const plannedHours = $('dripPlanHoursInput').value.trim() || '24';

  const res =
    calcDripMode === 'dose2rate'
      ? calculatePumpRateFromTargetDose({
          drugName,
          totalDrugAmount,
          drugUnit,
          bagVolumeMl,
          targetDose: $('dripTargetDoseInput').value,
          targetUnit: $('dripTargetUnitSelect').value,
          weightKg: weightKg || null,
          plannedHours,
        })
      : calculateDripRate({
          drugName,
          totalDrugAmount,
          drugUnit,
          bagVolumeMl,
          rateMlPerHr: $('dripRateInput').value,
          weightKg: weightKg || null,
          plannedHours,
        });

  lastDripResult = res;
  const box = $('dripResultsBox');

  if (res.error) {
    box.innerHTML = `<div class="calc-val missing-txt">${esc(res.error)}</div>`;
  } else {
    const concStr = `${res.concentrationPerMl} ${res.drugUnit}/mL`;
    const hrDoseStr =
      res.drugUnit === 'units'
        ? `${res.unitsPerHr} units/hr`
        : `${res.dosePerHour} ${res.drugUnit}/hr (${res.mcgPerHr} mcg/hr)`;

    let wtMetricLbl = 'Weight-Based Dose';
    let wtMetricVal = 'No weight — NOT calculated';
    if (res.weightUsed) {
      wtMetricLbl = `Dose / kg (${res.weightUsed})`;
      if (res.mcgPerKgPerMin !== null) {
        wtMetricVal = `${res.mcgPerKgPerMin} mcg/kg/min`;
      } else if (res.unitsPerKgPerHr !== null) {
        wtMetricVal = `${res.unitsPerKgPerHr} units/kg/hr`;
      } else if (res.mcgPerKgPerHr !== null) {
        wtMetricVal = `${res.mcgPerKgPerHr} mcg/kg/hr`;
      }
    }

    const rateHeadline = `${res.rateMlPerHr} mL/hr`;

    box.innerHTML = `
      <div class="drip-result-grid">
        <div class="drip-metric">
          <div class="drip-metric-lbl">${calcDripMode === 'dose2rate' ? 'Required Pump Rate' : 'Pump Rate'}</div>
          <div class="drip-metric-val">${esc(rateHeadline)}</div>
        </div>
        <div class="drip-metric">
          <div class="drip-metric-lbl">Dose / Hour</div>
          <div class="drip-metric-val">${esc(hrDoseStr)}</div>
        </div>
        <div class="drip-metric">
          <div class="drip-metric-lbl">${esc(wtMetricLbl)}</div>
          <div class="drip-metric-val" style="${res.weightUsed ? '' : 'color:var(--warn);font-size:12.5px;'}">${esc(wtMetricVal)}</div>
        </div>
        <div class="drip-metric">
          <div class="drip-metric-lbl">Bag Concentration</div>
          <div class="drip-metric-val" style="font-size:13.5px;color:var(--txt);">${esc(concStr)}</div>
        </div>
        <div class="drip-metric">
          <div class="drip-metric-lbl">Bag Runout Time</div>
          <div class="drip-metric-val" style="color:${res.shortfall ? 'var(--danger)' : 'var(--accent)'};">${esc(res.bagRunoutText)}</div>
        </div>
        <div class="drip-metric">
          <div class="drip-metric-lbl">${res.plannedHours ? `Bags / ${res.plannedHours}h` : 'Weight Status'}</div>
          <div class="drip-metric-val" style="font-size:13.5px;color:var(--txt);">${
            res.bagsNeeded !== null ? `${res.bagsNeeded} bag(s) (${res.totalVolNeededMl} mL)` : esc(res.weightUsed || 'None')
          }</div>
        </div>
      </div>
      ${
        res.weightNotice
          ? `<div class="drip-shortfall warn ico-inline" style="background:var(--warn-bg);border-color:var(--warn-border);color:var(--warn-txt);">${uiIcon('alert')} ${esc(res.weightNotice)}</div>`
          : ''
      }
      ${
        res.shortfallMessage
          ? `<div class="drip-shortfall ${res.shortfall ? 'warn' : 'ok'} ico-inline">${res.shortfall ? uiIcon('alert') : uiIcon('check')} ${esc(res.shortfallMessage)}</div>`
          : ''
      }`;
  }

  // Screen active infusion against chart meds (STE §8.6-8.7)
  const dripIx = drugName ? checkDrugInteractions(inputs.medLines, drugName) : [];
  const ixBox = $('dripInteractionsBox');
  ixBox.innerHTML = dripIx.length
    ? `<div class="calc-section-hdr"><span class="ico-inline">${uiIcon('pill')} Interaction Screen (${esc(drugName)} vs Chart Meds)</span></div>` +
      dripIx.map((ix) => `<div class="calc-interaction-row ico-inline">${uiIcon('alert')} ${esc(ix.line)}</div>`).join('')
    : drugName && inputs.medLines.length
      ? `<div class="cf-meta">No major interaction flagged between ${esc(drugName)} and chart meds.</div>`
      : '';
}

function buildDeidCalcSummaryText() {
  const note = notes.find((n) => n.id === calcNoteId) || null;
  const audit = lastAuditResult;
  const drip = lastDripResult;
  const roomLbl = note ? audit?.inputs?.parsed?.room || note.room || 'Unassigned Bed' : 'Standalone Check';

  const lines = [`Clinical Calculation Summary (De-identified · ${roomLbl})`];
  if (audit) {
    const { inputs, renal, flags } = audit;
    const wtTxt = inputs.weight?.valueKg ? `${inputs.weight.valueKg} kg` : 'Wt missing';
    const crTxt =
      inputs.creatinine && !inputs.creatinine.invalidUnit
        ? `SCr ${inputs.creatinine.value} mg/dL${inputs.creatinine.stale ? ' (stale)' : ''}`
        : inputs.creatinine?.invalidUnit
          ? `SCr ${inputs.creatinine.value} ${inputs.creatinine.unit}`
          : 'SCr missing';
    lines.push(`Inputs: ${inputs.age ? `${inputs.age}yo` : 'Age ?'} ${inputs.sex || ''} | ${wtTxt} | ${crTxt}`.trim());
    lines.push(`CKD-EPI eGFR (${renal.egfr.label}): ${renal.egfr.message}`);
    if (renal.chartedEgfr) lines.push(`eGFR (CHARTED): ${renal.chartedEgfr.value} mL/min/1.73m² (${renal.chartedEgfr.date})`);
    lines.push(`Cockcroft-Gault CrCl (${renal.crcl.label}): ${renal.crcl.message}`);
    if (flags.length) {
      lines.push('', 'Audit Questions:');
      for (const f of flags) lines.push(`- ${f.question}`);
    }
  }

  // Only emit drip block when Drip tab was actually used OR the patient has a charted drip (never leak default Norepi into Renal Audit copy)
  if ((calcActiveTab === 'drip' || calcUserTouchedDrip || calcChartHasDrip) && drip && !drip.error) {
    lines.push('', `Drip: ${drip.drugName} (${drip.totalDrugAmount}${drip.drugUnit} / ${drip.bagVolumeMl}mL)`);
    lines.push(`Rate: ${drip.rateMlPerHr} mL/hr -> ${drip.dosePerHour} ${drip.drugUnit}/hr`);
    if (drip.mcgPerKgPerMin !== null) lines.push(`Weight-Based (${drip.weightUsed}): ${drip.mcgPerKgPerMin} mcg/kg/min`);
    else if (drip.unitsPerKgPerHr !== null) lines.push(`Weight-Based (${drip.weightUsed}): ${drip.unitsPerKgPerHr} units/kg/hr`);
    else lines.push(drip.weightNotice);
    lines.push(`Bag Runout: ${drip.bagRunoutText}${drip.shortfallMessage ? ` (${drip.shortfallMessage})` : ''}`);
  }

  return lines.join('\n');
}

function openCalcModal(noteId = null, initialTab = 'audit', triggerEl = null) {
  populateDripPresets();
  calcNoteId = noteId || currentId || '';
  populateCalcPatientSelect(calcNoteId);

  $('calcOverrideAge').value = '';
  $('calcOverrideSex').value = '';
  $('calcOverrideWeight').value = '';
  $('calcOverrideCr').value = '';
  $('calcNewDrugInput').value = '';
  $('calcQuickWeightInput').value = '';
  if ($('calcIoIn')) $('calcIoIn').value = '';
  if ($('calcIoOut')) $('calcIoOut').value = '';
  if ($('calcIoUnit')) $('calcIoUnit').value = 'ml';
  if ($('calcIoResult')) $('calcIoResult').value = '';

  calcUserTouchedDrip = initialTab === 'drip';
  const note = notes.find((n) => n.id === calcNoteId) || null;
  syncDripFromChart(note);

  renderAuditPane();
  renderDripCalculator();
  setCalcTab(initialTab);
  openModalEl($('calcModal'), triggerEl);
}

function closeCalcModal() {
  closeModalEl($('calcModal'));
}

/* ---------- voice dictation / SOAP modal (Telegram-style on-device) ---------- */
let dictatingNoteId = null;
let dictatingShift = '6am';
let recordedAudioBlob = null;
let recordedAudioPcm16k = null;
let recordedAudioToken = 0;
let lastTranscribedAudioKey = '';
let speechTranscriptBuffer = '';
let recordTimerInterval = null;
let recordStartTime = 0;
let animFrameId = null;
let visAudioCtx = null;
let visSourceNode = null;
let visAnalyser = null;
let isStartingRecording = false;
let isStoppingRecording = false;

const voiceRecorder = createUniversalAudioRecorder({
  onError: (err) => {
    handleMicInterruption(err?.message || 'Microphone stopped by screen lock or app switch — audio saved for review');
  },
});

const WHISPER_MODEL_KEY = 'cm.whisperModel';
const WHISPER_AUTO_KEY = 'cm.whisperAuto';
let selectedWhisperModel = safeGetItem(WHISPER_MODEL_KEY, '') || WHISPER_MODELS[0].id;
let whisperAutoTranscribe = safeGetItem(WHISPER_AUTO_KEY, 'false') === 'true';
let cachedWhisperModels = new Set();
let cachedWhisperRuntimeReady = false;

const whisperCtrl = createWhisperController({
  onStatus: (status, detail) => updateWhisperUiStatus(status, detail),
  onProgress: (info) => updateWhisperProgressUi(info.pct, info.label, info.pct < 100),
});

function revokeRecordedAudioUrl() {
  if (recordedAudioUrl) {
    try {
      URL.revokeObjectURL(recordedAudioUrl);
    } catch {}
    recordedAudioUrl = null;
  }
  const player = $('voiceAudioPlayer');
  if (player && player.src) {
    player.removeAttribute('src');
    try { player.load(); } catch {}
  }
}

function setRecordedAudioSource(blob) {
  revokeRecordedAudioUrl();
  if (!blob) return;
  recordedAudioUrl = URL.createObjectURL(blob);
  const player = $('voiceAudioPlayer');
  if (player) {
    player.src = recordedAudioUrl;
    player.load();
  }
}

function updateWhisperProgressUi(pct, label, visible = true) {
  [
    ['whisperSettingsProgressWrap', 'whisperSettingsProgressBar', 'whisperSettingsProgressText'],
    ['whisperModalProgressWrap', 'whisperModalProgressBar', 'whisperModalProgressText'],
  ].forEach(([wrapId, barId, txtId]) => {
    const wrap = $(wrapId);
    const bar = $(barId);
    const txt = $(txtId);
    if (!wrap) return;
    wrap.hidden = !visible;
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
    if (txt) txt.textContent = label || '';
  });
}

function updateWhisperSelectOptionLabels() {
  const sel = $('whisperModelSelect');
  if (!sel) return;
  for (const m of WHISPER_MODELS) {
    const opt = sel.querySelector(`option[value="${CSS.escape(m.id)}"]`);
    if (opt) {
      const base = opt.dataset.baseLabel || opt.textContent.replace(/^✓\s*Cached\s*·\s*/, '');
      opt.dataset.baseLabel = base;
      opt.textContent = cachedWhisperModels.has(m.id) ? `✓ Cached · ${base}` : base;
    }
  }
}

function updateWhisperUiStatus(statusOverride = null, detail = '') {
  const st = whisperCtrl.getState();
  const status = statusOverride || st.status;
  const isLoaded = st.loadedModels.includes(selectedWhisperModel);
  const isCached = cachedWhisperModels.has(selectedWhisperModel);

  let pillText = 'NOT DOWNLOADED';
  let pillCls = 'pill';
  if (status === 'loading') {
    pillText = 'DOWNLOADING...';
    pillCls = 'pill';
  } else if (status === 'transcribing') {
    pillText = 'TRANSCRIBING...';
    pillCls = 'pill safe';
  } else if (status === 'error') {
    pillText = 'ERROR';
    pillCls = 'pill block';
  } else if (isLoaded) {
    pillText = 'READY (IN MEMORY)';
    pillCls = 'pill safe';
  } else if (isCached && cachedWhisperRuntimeReady) {
    pillText = 'CACHED OFFLINE';
    pillCls = 'pill safe';
  } else if (isCached) {
    pillText = 'WEIGHTS CACHED (WARM ONCE)';
    pillCls = 'pill warn';
  }

  const settingsBadge = $('whisperSettingsBadge');
  if (settingsBadge) {
    settingsBadge.textContent = pillText;
    settingsBadge.className = pillCls;
  }

  const modalStatus = $('whisperModalStatus');
  if (modalStatus) {
    const modelShort = selectedWhisperModel.includes('base') ? 'Base' : 'Tiny';
    modalStatus.textContent =
      detail && status === 'transcribing'
        ? `TRANSCRIBING (${modelShort})...`
        : `${pillText} · ${modelShort}`;
    modalStatus.className = pillCls;
  }

  const loadBtn = $('whisperModalLoadBtn');
  if (loadBtn) {
    loadBtn.hidden = isLoaded;
    loadBtn.disabled = status === 'loading' || status === 'transcribing';
    loadBtn.innerHTML = `${uiIcon('bolt')} ${isCached ? 'Warm Model' : 'Load Offline Model'}`;
  }

  const retryBtn = $('whisperRetryBtn');
  if (retryBtn) retryBtn.hidden = status !== 'error';

  const cancelBtn = $('whisperCancelBtn');
  if (cancelBtn) {
    cancelBtn.hidden =
      st.loadedModels.length === 0 && status !== 'loading' && status !== 'transcribing';
    cancelBtn.innerHTML =
      status === 'loading' || status === 'transcribing'
        ? `${uiIcon('x')} Cancel`
        : `${uiIcon('rotate-ccw')} Unload RAM`;
  }

  const preloadBtn = $('whisperPreloadBtn');
  if (preloadBtn) {
    preloadBtn.disabled = status === 'loading' || status === 'transcribing';
    preloadBtn.innerHTML = isLoaded
      ? `${uiIcon('check')} Model Loaded in Memory`
      : isCached
        ? `${uiIcon('bolt')} Re-warm Cached Model`
        : `${uiIcon('download')} Preload Offline Model`;
  }

  const transcribeBtn = $('whisperTranscribeBtn');
  if (transcribeBtn) {
    transcribeBtn.disabled = status === 'loading' || status === 'transcribing';
    transcribeBtn.innerHTML =
      status === 'transcribing'
        ? `${uiIcon('refresh')} Transcribing Offline...`
        : `${uiIcon('ai-brain')} Transcribe Offline (WASM)`;
  }

  const engineHint = $('voiceEngineHint');
  if (engineHint) {
    engineHint.textContent = isLoaded || (isCached && whisperAutoTranscribe)
      ? '100% on-device audio + WASM Whisper (zero browser SpeechRecognition uploads)'
      : '100% local audio capture · Tap Transcribe Offline after stopping (or warm Whisper above)';
  }

  updateWhisperSelectOptionLabels();
}

async function refreshWhisperCacheStatus() {
  const [ids, rtReady] = await Promise.all([getCachedWhisperModelIds(), hasCachedWhisperRuntime()]);
  cachedWhisperModels = new Set(ids);
  cachedWhisperRuntimeReady = rtReady;
  updateWhisperUiStatus();
  refreshStorageAndPwaStatus();
}

async function preloadSelectedWhisperModel() {
  try {
    updateWhisperProgressUi(2, `Loading ${selectedWhisperModel}...`, true);
    await whisperCtrl.loadModel(selectedWhisperModel);
    await refreshWhisperCacheStatus();
    updateWhisperProgressUi(100, 'Offline Whisper model ready', false);
    if ($('voiceAiStatus')) $('voiceAiStatus').hidden = true;
    toast('Offline Whisper model loaded (enable Auto-transcribe in Settings if desired)');
  } catch (err) {
    updateWhisperProgressUi(0, '', false);
    const aiStatus = $('voiceAiStatus');
    if (aiStatus) {
      aiStatus.hidden = false;
      aiStatus.className = 'voice-ai-status error';
      aiStatus.textContent = `Whisper load failed: ${err.message}`;
    }
    toast(`Whisper load failed: ${err.message}`);
  }
}

async function runOfflineWhisperTranscription(audioBlob, { pcm16k = null, audioToken = recordedAudioToken } = {}) {
  if (!audioBlob && !pcm16k) return toast('Record or upload audio first');
  const cacheKey = `${audioToken}::${selectedWhisperModel}`;
  if (audioToken && lastTranscribedAudioKey === cacheKey) {
    return toast(`Already transcribed this audio with ${selectedWhisperModel} — switch model or re-record`);
  }
  const aiStatus = $('voiceAiStatus');
  await acquireScreenWakeLock();
  try {
    if (aiStatus) {
      aiStatus.hidden = true;
      aiStatus.className = 'voice-ai-status';
    }
    updateWhisperProgressUi(5, 'Preparing local audio for Whisper...', true);
    const res = pcm16k
      ? await whisperCtrl.transcribePcm(pcm16k, selectedWhisperModel)
      : await whisperCtrl.transcribeBlob(audioBlob, selectedWhisperModel);
    await refreshWhisperCacheStatus();
    updateWhisperProgressUi(100, '', false);

    if (res.isSilent || !res.text) {
      if (aiStatus) {
        aiStatus.hidden = false;
        aiStatus.className = 'voice-ai-status warn';
        aiStatus.textContent =
          'No speech detected — tap Re-record closer to mic, or type directly below.';
      }
      toast('No speech detected in audio');
      return;
    }

    lastTranscribedAudioKey = cacheKey;
    const corrected = applyClinicalAsrCorrections(res.text);

    let curVal = $('voiceTranscript').value;
    const cleanBuf = speechTranscriptBuffer.trim();
    if (cleanBuf && curVal.trim() === cleanBuf) {
      curVal = '';
    }
    speechTranscriptBuffer = '';

    $('voiceTranscript').value = mergeTranscriptText(curVal, corrected);
    const badge = $('transcribeBadge');
    if (badge) {
      badge.textContent = `✓ Whisper Offline (${(res.elapsedMs / 1000).toFixed(1)}s)`;
      badge.hidden = false;
    }
    toast(`Transcribed offline in ${(res.elapsedMs / 1000).toFixed(1)}s`);
  } catch (err) {
    updateWhisperProgressUi(0, '', false);
    if (aiStatus) {
      aiStatus.hidden = false;
      aiStatus.className = 'voice-ai-status error';
      aiStatus.textContent = `Offline transcription error: ${err.message}`;
    }
    toast(`Offline transcription failed: ${err.message}`);
  } finally {
    await releaseScreenWakeLock();
  }
}

async function acquireScreenWakeLock() {
  try {
    if (!screenWakeLock && navigator.wakeLock?.request) {
      screenWakeLock = await navigator.wakeLock.request('screen');
      screenWakeLock?.addEventListener?.('release', () => {
        screenWakeLock = null;
      });
    }
  } catch {}
}

async function releaseScreenWakeLock() {
  if (!screenWakeLock) return;
  try {
    await screenWakeLock.release();
  } catch {}
  screenWakeLock = null;
}

function startAudioVisualizer(stream) {
  stopAudioVisualizer();
  try {
    const canvas = $('audioCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 44;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const barColor = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#38bdf8';

    // Never attach AudioContext.createMediaStreamSource on Firefox or Android — avoids sample-rate NotSupportedError & Cubeb lockup
    const skipWebAudioVis = /Firefox|FxiOS|Android/i.test(navigator.userAgent || '');
    const AudioContextClass = skipWebAudioVis ? null : window.AudioContext || window.webkitAudioContext;

    if (AudioContextClass && stream) {
      try {
        visAudioCtx = new AudioContextClass();
        if (visAudioCtx.state === 'suspended') {
          visAudioCtx.resume().catch(() => {});
        }
        visSourceNode = visAudioCtx.createMediaStreamSource(stream);
        visAnalyser = visAudioCtx.createAnalyser();
        visAnalyser.fftSize = 64;
        visSourceNode.connect(visAnalyser);

        const bufferLength = visAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        const drawLive = () => {
          animFrameId = requestAnimationFrame(drawLive);
          if (!visAnalyser) return;
          visAnalyser.getByteFrequencyData(dataArray);
          ctx.clearRect(0, 0, cssW, cssH);
          const barWidth = (cssW / bufferLength) * 1.6;
          let x = 4;
          for (let i = 0; i < bufferLength; i++) {
            const val = dataArray[i];
            const barHeight = Math.max(3, (val / 255) * cssH * 0.85);
            ctx.fillStyle = barColor;
            ctx.fillRect(x, (cssH - barHeight) / 2, barWidth - 2, barHeight);
            x += barWidth;
          }
        };
        drawLive();
        return;
      } catch {
        stopAudioVisualizer();
      }
    }

    // Smooth fallback pulse visualizer (Firefox Android & fallback safe)
    const bars = 28;
    const step = (cssW - 8) / bars;
    const drawPulse = (ts) => {
      animFrameId = requestAnimationFrame(drawPulse);
      ctx.clearRect(0, 0, cssW, cssH);
      const t = (ts || performance.now()) * 0.004;
      for (let i = 0; i < bars; i++) {
        const amp = 0.25 + 0.55 * Math.abs(Math.sin(t + i * 0.42) * Math.cos(t * 0.6 + i * 0.17));
        const barH = Math.max(4, amp * cssH * 0.78);
        ctx.fillStyle = barColor;
        ctx.fillRect(4 + i * step, (cssH - barH) / 2, Math.max(2, step - 3), barH);
      }
    };
    drawPulse(performance.now());
  } catch (err) {
    console.warn('Visualizer init error:', err);
  }
}

function stopAudioVisualizer() {
  if (animFrameId) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
  if (visSourceNode) {
    try { visSourceNode.disconnect(); } catch {}
    visSourceNode = null;
  }
  if (visAnalyser) {
    try { visAnalyser.disconnect(); } catch {}
    visAnalyser = null;
  }
  if (visAudioCtx) {
    const ctx = visAudioCtx;
    visAudioCtx = null;
    try { ctx.close().catch(() => {}); } catch {}
  }
}

function updateTimer() {
  const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
  const mins = Math.floor(elapsed / 60);
  const secs = String(elapsed % 60).padStart(2, '0');
  const timerEl = $('recTimer');
  if (timerEl) timerEl.textContent = `${mins}:${secs}`;
}

function handleMicInterruption(reason = 'Recording stopped by OS/screen lock — audio saved for review') {
  if (!voiceRecorder.isRecording()) return;
  voiceRecordingInterrupted = true;
  voiceInterruptNote = reason;
  stopRecordingTelegram();
}

async function startRecordingTelegram() {
  if (isStartingRecording || isStoppingRecording) return;
  isStartingRecording = true;
  const startBtn = $('startRecBtn');
  if (startBtn) startBtn.disabled = true;

  try {
    speechTranscriptBuffer = '';
    voiceRecordingInterrupted = false;
    voiceInterruptNote = '';
    recordedAudioBlob = null;
    recordedAudioPcm16k = null;
    if ($('voiceAiStatus')) $('voiceAiStatus').hidden = true;

    const info = await voiceRecorder.start();
    if (!info || !voiceRecorder.isRecording()) return;

    recordStartTime = Date.now();
    clearInterval(recordTimerInterval);
    recordTimerInterval = setInterval(updateTimer, 250);
    await acquireScreenWakeLock();
    if (!voiceRecorder.isRecording()) return;

    $('recIdleState').hidden = true;
    $('recActiveState').hidden = false;
    $('voiceAudioContainer').hidden = true;
    $('recTimer').textContent = '0:00';

    startAudioVisualizer(info.stream);
  } catch (err) {
    console.warn('Audio capture failed:', err);
    voiceRecorder.cancel();
    clearInterval(recordTimerInterval);
    recordTimerInterval = null;
    stopAudioVisualizer();
    releaseScreenWakeLock();
    $('recIdleState').hidden = false;
    $('recActiveState').hidden = true;
    const detail = `${err?.name ? `${err.name}: ` : ''}${err?.message || 'Microphone access blocked'}`;
    const aiStatus = $('voiceAiStatus');
    if (aiStatus) {
      aiStatus.hidden = false;
      aiStatus.className = 'voice-ai-status error';
      aiStatus.textContent = `Mic error — ${detail}. You can also tap the text box below to use your phone keyboard mic.`;
    }
    toast(`Mic error: ${detail}`);
  } finally {
    isStartingRecording = false;
    if (startBtn) startBtn.disabled = false;
  }
}

async function stopRecordingTelegram() {
  if (isStoppingRecording) return;
  clearInterval(recordTimerInterval);
  recordTimerInterval = null;
  stopAudioVisualizer();
  releaseScreenWakeLock();

  if (!voiceRecorder.isRecording()) return;

  isStoppingRecording = true;
  const stopBtn = $('stopRecBtn');
  if (stopBtn) stopBtn.disabled = true;
  try {
    const res = await voiceRecorder.stop();
    recordedAudioBlob = res.blob;
    recordedAudioPcm16k = res.pcm16k || null;
    recordedAudioToken++;
    lastTranscribedAudioKey = '';
    setRecordedAudioSource(recordedAudioBlob);
    $('voiceAudioContainer').hidden = false;
    $('recActiveState').hidden = true;
    $('recIdleState').hidden = true;

    if (!recordedAudioBlob || res.isEmpty) {
      const aiStatus = $('voiceAiStatus');
      if (aiStatus) {
        aiStatus.hidden = false;
        aiStatus.className = 'voice-ai-status warn';
        aiStatus.textContent = 'No sound detected in recording — check mic access and tap Re-record.';
      }
      toast('No sound captured — check mic permission or tap Re-record');
      return;
    }

    if (voiceRecordingInterrupted && voiceInterruptNote) {
      const aiStatus = $('voiceAiStatus');
      if (aiStatus) {
        aiStatus.hidden = false;
        aiStatus.className = 'voice-ai-status warn';
        aiStatus.textContent = voiceInterruptNote;
      }
      voiceRecordingInterrupted = false;
      voiceInterruptNote = '';
    }

    const whisperReadyLocally =
      whisperCtrl.getState().loadedModels.includes(selectedWhisperModel) ||
      cachedWhisperModels.has(selectedWhisperModel);

    if (whisperAutoTranscribe && recordedAudioBlob && whisperReadyLocally) {
      runOfflineWhisperTranscription(recordedAudioBlob, {
        pcm16k: recordedAudioPcm16k,
        audioToken: recordedAudioToken,
      });
    }
  } finally {
    isStoppingRecording = false;
    if (stopBtn) stopBtn.disabled = false;
  }
}

function cancelRecordingTelegram(requireConfirm = false) {
  const elapsedMs = recordStartTime ? Date.now() - recordStartTime : 0;
  const isRec = voiceRecorder.isRecording();
  const hasAudio = Boolean(recordedAudioBlob);
  if (requireConfirm && ((isRec && elapsedMs > 3000) || (!isRec && hasAudio))) {
    if (!confirm('Discard captured voice recording?')) return false;
  }

  clearInterval(recordTimerInterval);
  recordTimerInterval = null;
  stopAudioVisualizer();
  releaseScreenWakeLock();
  voiceRecordingInterrupted = false;
  voiceInterruptNote = '';
  voiceRecorder.cancel();

  recordedAudioBlob = null;
  recordedAudioPcm16k = null;
  lastTranscribedAudioKey = '';
  speechTranscriptBuffer = '';
  recordStartTime = 0;
  revokeRecordedAudioUrl();

  $('recIdleState').hidden = false;
  $('recActiveState').hidden = true;
  $('voiceAudioContainer').hidden = true;
  return true;
}

function rerecordTelegram() {
  const hasUntranscribedAudio = Boolean(
    recordedAudioBlob && $('transcribeBadge')?.hidden !== false
  );
  if (!cancelRecordingTelegram(hasUntranscribedAudio)) return;
  const badge = $('transcribeBadge');
  if (badge) badge.hidden = true;
  const aiStatus = $('voiceAiStatus');
  if (aiStatus) {
    aiStatus.hidden = true;
    aiStatus.className = 'voice-ai-status';
  }
}

function openDictateModal(noteId, triggerEl = null) {
  const note = notes.find((n) => n.id === noteId);
  if (!note) return;

  dictatingNoteId = noteId;
  const meta = metaOf(note.content);
  const room = note.room || meta.room || 'No Room';
  const name = note.name || meta.name || 'Unknown Patient';

  $('voiceModalSubtitle').textContent = `${room} · ${name}`;
  const clockInfo = classifyDictationShiftByClock(new Date(), shiftSchedule);
  dictatingShift = clockInfo.shiftLabel;

  renderShiftPillGroup('voiceShiftPills', dictatingShift);
  if ($('voiceInterimTimeInput')) $('voiceInterimTimeInput').value = nowHhMm();
  syncModalInterimTimeUi(dictatingShift, 'voiceInterimTimeWrap', 'voiceInterimTimeInput');

  if ($('voiceDateInput')) {
    $('voiceDateInput').value = clockInfo.yyyymmdd || getDefaultDutyIsoForShift(dictatingShift);
  }

  cancelRecordingTelegram();
  stagedVoiceSoap = '';
  $('voiceTranscript').value = '';
  if ($('voiceSoapReviewBox')) $('voiceSoapReviewBox').hidden = true;
  if ($('voiceSoapPreviewText')) $('voiceSoapPreviewText').value = '';
  if ($('voiceAiStatus')) {
    $('voiceAiStatus').hidden = true;
    $('voiceAiStatus').className = 'voice-ai-status';
  }
  const badge = $('transcribeBadge');
  if (badge) badge.hidden = true;
  updateWhisperUiStatus();

  openModalEl($('voiceModal'), triggerEl, $('startRecBtn'));
}

function closeDictateModal(force = false) {
  const hasUnsaved =
    voiceRecorder.isRecording() ||
    Boolean($('voiceTranscript')?.value.trim()) ||
    Boolean(recordedAudioBlob) ||
    Boolean(stagedVoiceSoap);
  if (!force && hasUnsaved) {
    if (!confirm('Discard current recording/dictation in this dialog?')) return;
  }
  cancelRecordingTelegram();
  stagedVoiceSoap = '';
  closeModalEl($('voiceModal'));
  dictatingNoteId = null;
}

/* ---------- editor notes list, navigation & selection ---------- */
function getSortedNotesByBed() {
  return [...notes].sort((a, b) => naturalBedCompare(a.room || metaOf(a.content).room, b.room || metaOf(b.content).room));
}

function getEditorNavNotes() {
  const roundsNotes = getFilteredSortedRoundsPatients().map((p) => p.rawNote);
  if (roundsNotes.length && (!currentId || roundsNotes.some((n) => n.id === currentId))) {
    return roundsNotes;
  }
  return getSortedNotesByBed();
}

function populateEditorPatientSelect() {
  const sel = $('editorPatientSelect');
  if (!sel) return;
  const navNotes = getEditorNavNotes();
  sel.innerHTML = notes.length
    ? buildGroupedPatientOptionsHtml('')
    : '<option value="">No charts</option>';
  if (currentId && notes.some((n) => n.id === currentId)) {
    sel.value = currentId;
  }

  const idx = navNotes.findIndex((n) => n.id === currentId);
  if ($('prevPatientBtn')) $('prevPatientBtn').disabled = idx <= 0;
  if ($('nextPatientBtn')) $('nextPatientBtn').disabled = idx === -1 || idx >= navNotes.length - 1;
}

function updateEditorEmptyAndNav() {
  const emptyEl = $('editorEmptyState');
  const workspaceEl = $('workspace');
  const hasSelection = Boolean(currentId && notes.some((n) => n.id === currentId));
  if (emptyEl) emptyEl.hidden = hasSelection;
  if (workspaceEl) workspaceEl.hidden = !hasSelection;
  populateEditorPatientSelect();
}

function renderLibraryFilterChips() {
  const host = $('libraryFilterChips');
  if (!host) return;
  const mkChip = (key, label) => {
    const isAct = libraryFilter === key;
    return `<button type="button" class="chip ${isAct ? 'active' : ''}" data-lib-filter="${esc(key)}" aria-pressed="${isAct}">${label}</button>`;
  };
  const customHtml = customCategories
    .map((cat) => {
      const catLower = cat.toLowerCase();
      const key = `cat:${catLower}`;
      const isAct = libraryFilter === key;
      return `
        <div class="chip-group ${isAct ? 'active' : ''}">
          <button type="button" class="chip ${isAct ? 'active' : ''}" data-lib-filter="${esc(key)}" aria-pressed="${isAct}">${esc(cat)}</button>
          <button type="button" class="chip-del-btn" data-del-cat="${esc(cat)}" aria-label="Remove ${esc(cat)} category" title="Remove ${esc(cat)}">${uiIcon('x')}</button>
        </div>`;
    })
    .join('');
  host.innerHTML = [
    mkChip('all', 'All'),
    mkChip('active', 'Active'),
    customHtml,
    mkChip('discharged', 'Discharged'),
  ].join('');

  host.querySelectorAll('.chip[data-lib-filter]').forEach((chip) => {
    chip.onclick = () => {
      libraryFilter = chip.dataset.libFilter || 'all';
      renderLibraryFilterChips();
      renderList();
    };
  });
  host.querySelectorAll('.chip-del-btn[data-del-cat]').forEach((btn) => {
    btn.onclick = () => removeCustomCategory(btn.dataset.delCat);
  });
}

function renderList() {
  renderLibraryFilterChips();
  const q = librarySearchQuery.trim().toLowerCase();
  const enriched = notes.map((n) => ({ note: n, parsed: parseChart(n.content, n) }));

  let visible = enriched.filter(({ parsed }) => {
    if (libraryFilter === 'active') return parsed.isCensus && !parsed.isCharity;
    if (libraryFilter === 'charity') return parsed.isCharity;
    if (libraryFilter === 'discharged') return !parsed.isCensus && !parsed.isCharity;
    if (libraryFilter.startsWith('cat:')) {
      const targetLower = libraryFilter.slice(4);
      return (parsed.categories || []).some((c) => c.toLowerCase() === targetLower);
    }
    return true;
  });

  if (q) {
    visible = visible.filter(({ note, parsed }) =>
      `${note.title || ''}\n${parsed.name}\n${parsed.room}\n${parsed.assessment}\n${note.content || ''}`
        .toLowerCase()
        .includes(q)
    );
  }

  visible.sort((a, b) => {
    if (librarySortMode === 'bed') {
      return naturalBedCompare(a.parsed.room, b.parsed.room);
    }
    if (librarySortMode === 'name') {
      return (a.parsed.name || '').localeCompare(b.parsed.name || '');
    }
    return (b.note.updated || 0) - (a.note.updated || 0);
  });

  const listEl = $('noteList');
  if (!listEl) return;

  if (!notes.length) {
    listEl.innerHTML = `
      <div class="timeline-empty">
        <p style="margin: 0 0 10px;">No patient charts yet on this device.</p>
        <div class="row" style="justify-content: center;">
          <button type="button" id="libEmptyNewBtn" class="primary">${uiIcon('plus')} New Patient</button>
          <button type="button" id="libEmptySampleBtn" class="btn">${uiIcon('sparkles')} Load Sample Census</button>
        </div>
      </div>`;
    if ($('libEmptyNewBtn')) $('libEmptyNewBtn').onclick = () => openAdmitModal({ mode: 'new', triggerEl: $('libEmptyNewBtn') });
    if ($('libEmptySampleBtn')) $('libEmptySampleBtn').onclick = loadSampleCensus;
    return;
  }

  if (!visible.length) {
    listEl.innerHTML = `<div class="timeline-empty">No charts match the selected filter (${esc(libraryFilter)}) or search.</div>`;
    return;
  }

  listEl.innerHTML = visible
    .map(({ note: n, parsed }) => {
      const openTasks = parsed.pending.filter((t) => !t.checked).length;
      const badge = !parsed.isCensus && !parsed.isCharity
        ? '<span class="status-tag discharged">Discharged</span>'
        : parsed.isCharity
          ? '<span class="status-tag charity">Charity</span>'
          : '<span class="status-tag fresh">Active</span>';
      const extraBadges = (parsed.categories || [])
        .filter((c) => !(parsed.isCharity && c.toLowerCase() === 'charity'))
        .map((c) => `<span class="status-tag category">${esc(c)}</span>`)
        .join('');
      const dxPreview = parsed.assessment ? ` · ${esc(parsed.assessment.slice(0, 64))}${parsed.assessment.length > 64 ? '…' : ''}` : '';
      return `
        <div class="item ${n.id === currentId ? 'active' : ''}">
          <button type="button" class="item-main-btn" data-id="${n.id}">
            <b>${esc(n.title || 'Untitled')}</b>
            <small>${esc(formatRoomLabel(parsed.room))} · ${openTasks} open task(s)${dxPreview} · ${new Date(n.updated).toLocaleDateString()}</small>
          </button>
          <div class="item-row-actions">
            ${badge}
            ${extraBadges}
            <button type="button" class="btn sm-btn subtle lib-toggle-census-btn" data-id="${n.id}" title="${parsed.isCensus ? 'Mark Discharged' : 'Readmit to Census'}">${parsed.isCensus ? 'Discharge' : 'Readmit'}</button>
          </div>
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.item-main-btn').forEach((btn) => {
    btn.onclick = async () => {
      await select(btn.dataset.id);
      await setMode('editor');
    };
  });

  listEl.querySelectorAll('.lib-toggle-census-btn').forEach((btn) => {
    btn.onclick = async () => {
      const note = notes.find((x) => x.id === btn.dataset.id);
      if (!note) return;
      const p = parseChart(note.content, note);
      note.content = syncFrontmatter(note.content, { census: !p.isCensus });
      note.updated = Date.now();
      await put(note);
      if (currentId === note.id) {
        $('noteText').value = note.content;
        populateProfileInputs(note, note.content, true);
        lastSavedChartContent = note.content;
      }
      await refresh();
      toast(!p.isCensus ? 'Patient readmitted to active census' : 'Patient marked Discharged (retained locally)');
    };
  });
}

async function refresh() {
  notes = await all();
  syncCategoriesFromNotes(notes);
  renderList();
  updateEditorEmptyAndNav();
  updateBackupReminderUi();
  if (currentMode === 'rounds') {
    renderRounds();
  }
}

function renderProfileCategoryFlags() {
  const host = $('profileCustomCategories');
  if (!host) return;
  const allCats = dedupeCategoryList([...customCategories, ...currentChartCategories]);
  host.innerHTML = allCats
    .map((cat) => {
      const checked = currentChartCategories.some((c) => c.toLowerCase() === cat.toLowerCase());
      return `
        <span class="cat-flag-pill">
          <label class="tpl-id-chip">
            <input type="checkbox" class="profile-cat-check" data-cat="${esc(cat)}" ${checked ? 'checked' : ''}>
            <span>${esc(cat)}</span>
          </label>
          <button type="button" class="cat-flag-del" data-del-cat="${esc(cat)}" aria-label="Remove ${esc(cat)} category" title="Remove ${esc(cat)}">${uiIcon('x')}</button>
        </span>`;
    })
    .join('');

  host.querySelectorAll('.profile-cat-check').forEach((chk) => {
    chk.onchange = () => {
      const cat = chk.dataset.cat;
      const lower = cat.toLowerCase();
      if (chk.checked) {
        if (!currentChartCategories.some((c) => c.toLowerCase() === lower)) {
          currentChartCategories.push(cat);
        }
      } else {
        currentChartCategories = currentChartCategories.filter((c) => c.toLowerCase() !== lower);
      }
      syncProfileInputsToMarkdown();
      markChartDirty();
    };
  });

  host.querySelectorAll('.cat-flag-del').forEach((btn) => {
    btn.onclick = () => removeCustomCategory(btn.dataset.delCat);
  });
}

function addCustomCategory(rawName, { assignToCurrentChart = false } = {}) {
  const name = normalizeCategoryName(rawName);
  if (!name) {
    toast('Enter a valid custom category name (avoid built-in tab names)');
    return null;
  }
  const existing = customCategories.find((c) => c.toLowerCase() === name.toLowerCase());
  const canonical = existing || name;
  if (!existing) {
    customCategories.push(canonical);
    saveCustomCategories();
  }
  if (assignToCurrentChart && currentId) {
    if (!currentChartCategories.some((c) => c.toLowerCase() === canonical.toLowerCase())) {
      currentChartCategories.push(canonical);
    }
    syncProfileInputsToMarkdown();
    markChartDirty();
  }
  renderProfileCategoryFlags();
  renderRoundsFilterChips();
  renderLibraryFilterChips();
  if (currentMode === 'rounds') renderRounds();
  if (currentMode === 'library') renderList();
  toast(existing ? `Category "${canonical}" ready` : `Added custom category "${canonical}"`);
  return canonical;
}

async function removeCustomCategory(catName) {
  const targetLower = String(catName || '').trim().toLowerCase();
  if (!targetLower) return;
  const canonical =
    customCategories.find((c) => c.toLowerCase() === targetLower) || String(catName || '').trim();

  const affectedNotes = notes.filter((n) => {
    const p = parseChart(n.content, n);
    return (p.categories || []).some((c) => c.toLowerCase() === targetLower);
  });
  const msg = affectedNotes.length
    ? `Remove custom category "${canonical}"? This will also untag ${affectedNotes.length} patient chart(s).`
    : `Remove custom category "${canonical}"?`;
  if (!confirm(msg)) return;

  customCategories = customCategories.filter((c) => c.toLowerCase() !== targetLower);
  saveCustomCategories();
  currentChartCategories = currentChartCategories.filter((c) => c.toLowerCase() !== targetLower);

  for (const n of affectedNotes) {
    const sourceContent =
      currentId === n.id && currentMode === 'editor' ? $('noteText').value : n.content;
    const res = removeCategoryFromChartContent(sourceContent, canonical);
    if (res.modified) {
      n.content = res.text;
      n.updated = Date.now();
      await put(n);
      if (currentId === n.id) {
        $('noteText').value = n.content;
        lastSavedChartContent = n.content;
        dirtyChart = false;
        updateSaveStatusPill('saved');
        populateProfileInputs(n, n.content, true);
      }
    }
  }
  if (currentId && !affectedNotes.some((a) => a.id === currentId)) {
    syncProfileInputsToMarkdown();
  }

  if (
    activeFilter === `cat:${targetLower}` ||
    (targetLower === 'charity' && activeFilter === 'charity')
  ) {
    activeFilter = 'active';
  }
  if (
    libraryFilter === `cat:${targetLower}` ||
    (targetLower === 'charity' && libraryFilter === 'charity')
  ) {
    libraryFilter = 'all';
  }

  await refresh();
  renderProfileCategoryFlags();
  renderRoundsFilterChips();
  renderLibraryFilterChips();
  if (currentMode === 'rounds') renderRounds();
  toast(`Removed category "${canonical}"`);
}

function updateProfileSummary() {
  const el = $('profileSummaryText');
  if (!el) return;
  const room = $('roomInput').value.trim();
  const age = $('ageInput').value.trim();
  const sex = $('sexInput').value.trim();
  const weight = $('weightInput').value.trim();
  const service = $('serviceInput').value.trim();
  const ap = $('apInput').value.trim();
  const name = $('nameInput').value.trim();

  const roomLbl = room ? formatRoomLabel(room) : '';
  const ageSex = [age ? `${age}yo` : '', sex].filter(Boolean).join(' ');
  const weightLbl = weight ? `${weight.replace(/\s*kg$/i, '')} kg` : '';
  const parts = [roomLbl, ageSex, weightLbl, service, ap ? `AP: ${ap}` : ''].filter(Boolean);
  if (parts.length) {
    el.innerHTML = `${uiIcon('user')} ${esc(parts.join(' · '))}`;
  } else if (name) {
    el.innerHTML = `${uiIcon('user')} ${esc(name)}`;
  } else {
    el.innerHTML = `${uiIcon('user')} Patient Details (tap to set up)`;
  }
}

function renderAdmittingHistoryCard(content) {
  const bodyEl = $('admittingHistoryBody');
  const sumEl = $('admittingHistorySummaryText');
  if (!bodyEl) return;
  const { hasData, data } = extractAdmittingHistory(content || '');
  if (sumEl) {
    sumEl.innerHTML = hasData
      ? `${uiIcon('file-lines')} Admitting History ${data.admittingImpression ? `· ${esc(data.admittingImpression.slice(0, 42))}${data.admittingImpression.length > 42 ? '…' : ''}` : ''}`
      : `${uiIcon('file-lines')} Admitting History (none recorded)`;
  }
  if (!hasData) {
    bodyEl.innerHTML = '<div class="cf-meta">No admitting history recorded yet. Tap below to fill out, paste, or dictate admission HPI, PMH, PE &amp; plan.</div>';
    return;
  }

  const pmhList = [];
  if (data.pmh.htn) pmhList.push(`Hypertensive${data.pmh.htnDuration ? ` (${data.pmh.htnDuration})` : ''}`);
  if (data.pmh.dm) pmhList.push(`Diabetes Mellitus${data.pmh.dmDuration ? ` (${data.pmh.dmDuration})` : ''}`);
  if (data.pmh.ba) pmhList.push('Bronchial Asthma');
  if (data.pmh.cad) pmhList.push('CAD');
  if (data.pmh.prevHosp) pmhList.push(`Previous Hospitalizations${data.pmh.prevHospReason ? `: ${data.pmh.prevHospReason}` : ''}`);
  if (data.pmh.other) pmhList.push(`Other: ${data.pmh.other}`);

  const v = data.vitals || {};
  const vitalStr = [
    v.sbp && v.dbp ? `BP ${v.sbp}/${v.dbp}` : v.sbp ? `BP ${v.sbp}` : '',
    v.hr ? `HR ${v.hr}` : '',
    v.rr ? `RR ${v.rr}` : '',
    v.temp ? `T ${v.temp}` : '',
    v.o2 ? `O2sat ${v.o2}` : '',
  ]
    .filter(Boolean)
    .join(' | ');

  const rows = [
    ['Chief Complaint', data.chiefComplaint],
    ['HPI', data.hpi],
    ['Past Medical History', pmhList.join(' · ')],
    ['Family History', data.familyHistory],
    ['Personal & Social History', data.psh],
    ['Admission Vitals', vitalStr],
    ['Physical Examination', data.pe],
    ['Admitting Impression', data.admittingImpression],
    ['Plan of Care', data.planOfCare],
  ].filter(([, val]) => Boolean(String(val || '').trim()));

  bodyEl.innerHTML = `<div class="admit-history-grid">${rows
    .map(
      ([lbl, val]) =>
        `<div class="admit-history-row"><span class="admit-history-lbl">${esc(lbl)}</span><span class="admit-history-val">${esc(val)}</span></div>`
    )
    .join('')}</div>`;
}

function populateProfileInputs(note = {}, content = '', preserveAliases = false) {
  const m = metaOf(content);
  $('nameInput').value = m.name || m.patient || note.name || '';
  if (!preserveAliases) {
    const parsedAliases = String(m.aliases || '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const mergedAliases = [...new Set([...(note.aliases || []), ...parsedAliases])];
    $('aliasesInput').value = mergedAliases.join(', ');
  }
  $('roomInput').value = m.room || m.bed || note.room || '';
  $('ageInput').value = m.age || '';
  $('sexInput').value = (m.sex || m.gender || '').toUpperCase();
  const rawWt = m.weight || m.wt || m.weight_kg || m['weight (kg)'] || '';
  $('weightInput').value = String(rawWt).replace(/\s*kg$/i, '').trim();
  $('serviceInput').value = m.service || m.dept || m.specialty || '';
  $('apInput').value = m.ap || m.attending || '';
  $('admittedInput').value = m.admitted || m['date admitted'] || '';
  $('assessmentInput').value = m.assessment || m.impression || m.dx || '';
  $('censusToggle').checked =
    m.census !== undefined ? String(m.census).toLowerCase() === 'true' : true;
  currentChartCategories = [...(parseChart(content, note).categories || [])];
  renderProfileCategoryFlags();
  updateProfileSummary();
}

function computeNoteTitle(name, room, fallback = 'Untitled note') {
  const cleanName = String(name || '').trim();
  const cleanRoom = String(room || '').trim().replace(/^Room\s+/i, '');
  if (!cleanName) return fallback;
  return cleanRoom ? `${cleanName} - ${cleanRoom}` : cleanName;
}

function syncProfileInputsToMarkdown() {
  const fields = {
    name: $('nameInput').value.trim(),
    room: $('roomInput').value.trim(),
    aliases: $('aliasesInput')
      .value.split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    age: $('ageInput').value.trim(),
    sex: $('sexInput').value.trim(),
    weight: $('weightInput').value.trim(),
    service: $('serviceInput').value.trim(),
    ap: $('apInput').value.trim(),
    admitted: $('admittedInput').value.trim(),
    assessment: $('assessmentInput').value.trim(),
    census: $('censusToggle').checked,
    categories: dedupeCategoryList(currentChartCategories),
    charity: currentChartCategories.some((c) => c.toLowerCase() === 'charity'),
  };
  $('noteText').value = syncFrontmatter($('noteText').value, fields);

  const n = notes.find((x) => x.id === currentId);
  const autoOld = n ? computeNoteTitle(n.name, n.room) : 'Untitled note';
  if (!n || !n.title || n.title === 'Untitled note' || n.title === autoOld) {
    $('noteTitle').textContent = computeNoteTitle(fields.name, fields.room);
  }
  updateProfileSummary();
}

function setEditorView(mode) {
  editorViewMode = mode;
  $('chartTimelinePane').hidden = mode !== 'timeline';
  $('chartRawPane').hidden = mode !== 'raw';
  $('editorTimelineTab').classList.toggle('active', mode === 'timeline');
  $('editorTimelineTab').setAttribute('aria-pressed', String(mode === 'timeline'));
  $('editorRawTab').classList.toggle('active', mode === 'raw');
  $('editorRawTab').setAttribute('aria-pressed', String(mode === 'raw'));

  if (mode === 'timeline') {
    const note = notes.find((n) => n.id === currentId) || {};
    populateProfileInputs(note, $('noteText').value, true);
    renderChartTimeline();
  }
}

function formatTimelineEventHtml(line) {
  const raw = String(line || '').trim();
  const soapMatch = raw.match(/^\*\*(S|O|A|P|Dictated Update|Subjective|Objective|Assessment|Plan):\*\*\s*(.*)$/i);
  if (soapMatch) {
    return `<span class="tl-soap-tag">${esc(soapMatch[1])}:</span>${esc(soapMatch[2])}`;
  }
  return esc(raw).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function isTimelineBoilerplateLine(line) {
  return /^(?:Greeting:|Good\s+(?:day|morning|afternoon|evening)|Update\s+on\s+your\s+patient|Thank\s+you|Regards|\[Your Name\]|\[Service)/i.test(
    String(line || '').trim()
  );
}

function resolveTimelineEditMeta(card, origDate, origShift) {
  if (!card) return { nextDate: origDate, nextShift: origShift };
  const dateVal = card.querySelector('.tl-edit-date')?.value || '';
  const nextDate = isoToMmDdYyyy(dateVal) || origDate;
  const selVal = card.querySelector('.tl-edit-shift-select')?.value || '';
  const timeVal = card.querySelector('.tl-edit-time')?.value || '';
  let nextShift = origShift;
  if (selVal === '__interim__') {
    nextShift = formatInterimShiftLabel(new Date(), timeVal);
  } else if (selVal === '__custom_time__') {
    nextShift = formatTime24ToLabel(normalizeShiftTime(timeVal) || nowHhMm());
  } else if (selVal) {
    nextShift = selVal;
  }
  return { nextDate, nextShift };
}

function renderChartTimeline() {
  const timeline = parseChartTimeline($('noteText').value);
  const dateGroupsDesc = [...timeline].reverse();

  if (
    timelineDateFilter !== 'all' &&
    !dateGroupsDesc.some((g) => g.date === timelineDateFilter)
  ) {
    timelineDateFilter = 'all';
  }

  const chipsEl = $('timelineDateChips');
  const allChip = `<button type="button" class="chip ${timelineDateFilter === 'all' ? 'active' : ''}" data-date="all" aria-pressed="${timelineDateFilter === 'all'}">All Dates (${dateGroupsDesc.length})</button>`;
  const seenDates = new Set();
  const dateChips = dateGroupsDesc
    .filter((g) => {
      if (seenDates.has(g.date)) return false;
      seenDates.add(g.date);
      return true;
    })
    .map(
      (g) =>
        `<button type="button" class="chip ${timelineDateFilter === g.date ? 'active' : ''}" data-date="${esc(
          g.date
        )}" aria-pressed="${timelineDateFilter === g.date}">${esc(g.date)}</button>`
    )
    .join('');
  chipsEl.innerHTML = allChip + dateChips;

  chipsEl.querySelectorAll('.chip').forEach((chip) => {
    chip.onclick = () => {
      timelineDateFilter = chip.dataset.date;
      renderChartTimeline();
    };
  });

  const listEl = $('chartTimelineList');
  if (!dateGroupsDesc.length) {
    listEl.innerHTML = `
      <div class="timeline-empty">
        <p style="margin: 0 0 10px;">No shift updates recorded for this patient yet.</p>
        <button type="button" id="tlAddFirstShiftBtn" class="primary">+ Add First Shift Update</button>
      </div>`;
    const firstBtn = $('tlAddFirstShiftBtn');
    if (firstBtn) {
      firstBtn.onclick = () => {
        if (!currentId) return toast('Save or select a patient first');
        syncProfileInputsToMarkdown();
        openShiftModal(currentId, firstBtn);
      };
    }
    return;
  }

  const q = timelineSearchQuery.trim().toLowerCase();
  const visibleGroups = [];

  for (const g of dateGroupsDesc) {
    if (timelineDateFilter !== 'all' && g.date !== timelineDateFilter) continue;
    const shiftsDesc = [...g.shifts].reverse();
    const matchedShifts = shiftsDesc.filter((s) => {
      if (!q) return true;
      const haystack = [
        g.date,
        s.shift,
        s.vitals,
        s.vent,
        s.io,
        s.drips,
        s.labs,
        ...s.events,
        ...s.pending.map((p) => p.text),
        ...s.servicePlans,
      ]
        .join('\n')
        .toLowerCase();
      return haystack.includes(q);
    });
    if (matchedShifts.length) {
      visibleGroups.push({ date: g.date, dateOccurrenceIndex: g.dateOccurrenceIndex || 0, shifts: matchedShifts });
    }
  }

  if (!visibleGroups.length) {
    listEl.innerHTML = `<div class="timeline-empty">No chart entries match "${esc(timelineSearchQuery)}".</div>`;
    return;
  }

  const cumFb = computeCumulativeFluidBalance($('noteText').value, 3);
  const cumFbBannerHtml = cumFb
    ? `<div class="timeline-cumfb-bar">
        <div class="timeline-cumfb-main ico-inline">${uiIcon('droplet')} <b>${cumFb.daysCount}-Day Cumulative Fluid Balance:</b> <span class="timeline-cumfb-total">${esc(
          cumFb.totalText
        )}</span></div>
        <div class="timeline-cumfb-days">${cumFb.dailyBreakdown
          .map(
            (d) =>
              `<span class="timeline-cumfb-chip">${esc(d.shortDate)}: <b>${esc(d.text)}</b>${
                d.source === 'shifts' ? ' <small>(shift sum)</small>' : ''
              }</span>`
          )
          .join('')}</div>
      </div>`
    : '';

  const shiftLookup = new Map();

  listEl.innerHTML = cumFbBannerHtml + visibleGroups
    .map((g) => {
      const dateOcc = g.dateOccurrenceIndex || 0;
      const cardsHtml = g.shifts
        .map((s) => {
          const entryKey = `${g.date}::${dateOcc}::${s.shiftIndex}`;
          shiftLookup.set(entryKey, s);
          const isEditing = editingTimelineKey === entryKey;

          if (isEditing) {
            const initialIsoDate = dateStringToIso(g.date);
            const curShiftClean = String(s.shift || '').trim();
            const isCurInterim = isInterimShift(curShiftClean);
            const initialTime24 = parseShiftTimeTo24h(curShiftClean) || nowHhMm();
            let matchedScheduleSlot = false;
            const slotOpts = shiftSchedule
              .map((slot) => {
                const selected = !isCurInterim && slot.label.toLowerCase() === curShiftClean.toLowerCase();
                if (selected) matchedScheduleSlot = true;
                return `<option value="${esc(slot.label)}"${selected ? ' selected' : ''}>${esc(slot.label)}</option>`;
              })
              .join('');
            const legacyOpt =
              !isCurInterim && !matchedScheduleSlot && curShiftClean
                ? `<option value="${esc(curShiftClean)}" selected>${esc(curShiftClean)}</option>`
                : '';
            const shiftOptionsHtml =
              legacyOpt +
              slotOpts +
              `<option value="__interim__"${isCurInterim ? ' selected' : ''}>Interim (time)</option>` +
              `<option value="__custom_time__">Other time…</option>`;

            return `
              <div class="timeline-shift-card">
                <div class="timeline-shift-head">
                  <span class="timeline-shift-badge">${esc(s.shift)}</span>
                  <span class="cf-meta">Quick Edit · ${esc(g.date)}</span>
                </div>
                <div class="timeline-inline-edit">
                  <div class="tl-meta-edit-row">
                    <div class="field">
                      <label>Date</label>
                      <input type="date" class="compact-date-input tl-edit-date" value="${esc(initialIsoDate)}" aria-label="Shift entry date">
                    </div>
                    <div class="field">
                      <label>Shift / Time</label>
                      <select class="tl-edit-shift-select" aria-label="Shift or time slot">${shiftOptionsHtml}</select>
                    </div>
                    <div class="field tl-edit-time-wrap"${isCurInterim ? '' : ' hidden'}>
                      <label>Time</label>
                      <input type="time" class="compact-time-input tl-edit-time" value="${esc(initialTime24)}" aria-label="Shift clock time">
                    </div>
                  </div>
                  <div class="tl-quick-edit">
                    <div class="quick-vs-grid">
                      <div class="field">
                        <label>BP</label>
                        <div class="bp-split-inputs">
                          <input class="tl-q-sbp" inputmode="numeric" enterkeyhint="next" autocomplete="off" placeholder="120" aria-label="Systolic BP">
                          <span class="bp-slash" aria-hidden="true">/</span>
                          <input class="tl-q-dbp" inputmode="numeric" enterkeyhint="next" autocomplete="off" placeholder="80" aria-label="Diastolic BP">
                        </div>
                      </div>
                      <div class="field"><label>HR</label><input class="tl-q-hr" inputmode="numeric" enterkeyhint="next" autocomplete="off" placeholder="78"></div>
                      <div class="field"><label>RR</label><input class="tl-q-rr" inputmode="numeric" enterkeyhint="next" autocomplete="off" placeholder="18"></div>
                      <div class="field"><label>Temp</label><input class="tl-q-temp" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="36.8C"></div>
                      <div class="field"><label>O2sat</label><input class="tl-q-o2" enterkeyhint="next" autocomplete="off" placeholder="98% RA"></div>
                    </div>
                    <div class="quick-io-grid">
                      <div class="field"><label>In</label><input class="tl-q-in" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="e.g. 800"></div>
                      <div class="field"><label>Out</label><input class="tl-q-out" inputmode="decimal" enterkeyhint="next" autocomplete="off" placeholder="e.g. 650"></div>
                      <div class="field"><label>Unit</label><select class="tl-q-io-unit" aria-label="Timeline I&amp;O unit"><option value="ml" selected>mL</option><option value="L">L</option></select></div>
                      <div class="field"><label>+ Pending Task</label><input class="tl-q-task" enterkeyhint="done" autocapitalize="sentences" placeholder="Add checklist item"></div>
                      <div class="field align-end"><button type="button" class="btn subtle tl-apply-quick-btn" data-key="${esc(entryKey)}">${uiIcon('bolt')} Insert Fields</button></div>
                    </div>
                  </div>
                  <label class="lbl">Block Markdown</label>
                  <textarea class="tl-edit-textarea" data-key="${esc(entryKey)}" spellcheck="false">${esc(
              s.body
            )}</textarea>
                  <div class="row">
                    <button type="button" class="primary tl-save-entry-btn" data-date="${esc(
                      g.date
                    )}" data-date-idx="${dateOcc}" data-shift-idx="${s.shiftIndex}" data-orig-shift="${esc(
              s.shift
            )}" data-key="${esc(entryKey)}">${uiIcon('save')} Save Entry</button>
                    <button type="button" class="btn tl-cancel-entry-btn">Cancel</button>
                    <button type="button" class="btn danger tl-delete-entry-btn" data-date="${esc(
                      g.date
                    )}" data-date-idx="${dateOcc}" data-shift-idx="${s.shiftIndex}">${uiIcon('trash')} Delete Block</button>
                  </div>
                </div>
              </div>`;
          }

          const pills = [];
          if (s.vitals) pills.push(`<span class="metric-pill"><b>VS:</b> ${esc(s.vitals)}</span>`);
          if (s.vent) pills.push(`<span class="metric-pill"><b>Vent:</b> ${esc(s.vent)}</span>`);
          if (s.io) pills.push(`<span class="metric-pill"><b>I&amp;O:</b> ${esc(s.io)}</span>`);
          if (s.labs) pills.push(`<span class="metric-pill"><b>Labs:</b> ${esc(s.labs)}</span>`);
          if (s.drips) pills.push(`<span class="metric-pill drip"><b>Drips:</b> ${esc(s.drips)}</span>`);

          const clinicalEvents = s.events.filter((l) => !isTimelineBoilerplateLine(l));
          const boilerplateEvents = s.events.filter((l) => isTimelineBoilerplateLine(l));

          const eventsHtml = clinicalEvents.length
            ? `<div class="timeline-events">${clinicalEvents
                .map((line) => `<div class="timeline-event-line">${formatTimelineEventHtml(line)}</div>`)
                .join('')}</div>`
            : '';

          const boilerplateHtml = boilerplateEvents.length
            ? `<details class="tl-boilerplate-details"><summary>Greeting / Footer (${boilerplateEvents.length} lines)</summary><div class="cf-meta">${boilerplateEvents.map(esc).join('<br>')}</div></details>`
            : '';

          const pendingHtml = s.pending.length
            ? `<div class="timeline-subsection">
                <span class="timeline-sub-lbl">Pending</span>
                ${s.pending
                  .map(
                    (p) => `
                  <label class="pending-line ${p.checked ? 'done' : ''}">
                    <input type="checkbox" class="tl-pending-check" data-date="${esc(g.date)}" data-date-idx="${dateOcc}" data-shift-idx="${s.shiftIndex}" data-task="${esc(p.text)}" ${
                      p.checked ? 'checked' : ''
                    }>
                    <span>${esc(p.text)}</span>
                  </label>`
                  )
                  .join('')}
              </div>`
            : '';

          const plansHtml = s.servicePlans.length
            ? `<div class="timeline-subsection">
                <span class="timeline-sub-lbl">Service Plans</span>
                ${s.servicePlans.map((pl) => `<div class="timeline-event-line">• ${esc(pl)}</div>`).join('')}
              </div>`
            : '';

          const emptyDetails =
            !pills.length && !eventsHtml && !pendingHtml && !plansHtml
              ? `<div class="cf-meta">No clinical entries in this shift block yet — tap Edit to add details.</div>`
              : '';

          return `
            <div class="timeline-shift-card">
              <div class="timeline-shift-head">
                <span class="timeline-shift-badge">${esc(s.shift)}</span>
                <div class="row tight">
                  <button type="button" class="btn subtle tl-edit-btn" data-key="${esc(entryKey)}">${uiIcon('pencil')} Edit</button>
                  <button type="button" class="btn subtle tl-copy-btn" data-key="${esc(entryKey)}">${uiIcon('share')} Copy Update</button>
                </div>
              </div>
              ${pills.length ? `<div class="timeline-badges">${pills.join('')}</div>` : ''}
              ${eventsHtml}
              ${boilerplateHtml}
              ${pendingHtml}
              ${plansHtml}
              ${emptyDetails}
            </div>`;
        })
        .join('');

      return `
        <div class="timeline-date-group">
          <div class="timeline-date-hdr">${esc(g.date)}</div>
          ${cardsHtml}
        </div>`;
    })
    .join('');

  listEl.querySelectorAll('.tl-edit-btn').forEach((btn) => {
    btn.onclick = () => {
      editingTimelineKey = btn.dataset.key;
      renderChartTimeline();
    };
  });

  listEl.querySelectorAll('.tl-edit-date, .tl-edit-shift-select, .tl-edit-time').forEach((el) => {
    const syncMetaHeader = () => {
      const shiftCard = el.closest('.timeline-shift-card');
      const inlineCard = shiftCard?.querySelector('.timeline-inline-edit');
      const saveBtn = inlineCard?.querySelector('.tl-save-entry-btn');
      if (!shiftCard || !inlineCard || !saveBtn) return;

      const selVal = inlineCard.querySelector('.tl-edit-shift-select')?.value || '';
      const timeWrap = inlineCard.querySelector('.tl-edit-time-wrap');
      const timeInp = inlineCard.querySelector('.tl-edit-time');
      const needsTime = selVal === '__interim__' || selVal === '__custom_time__';
      if (timeWrap) timeWrap.hidden = !needsTime;
      if (needsTime && timeInp && !timeInp.value) timeInp.value = nowHhMm();

      const { nextDate, nextShift } = resolveTimelineEditMeta(
        inlineCard,
        saveBtn.dataset.date,
        saveBtn.dataset.origShift
      );
      const badge = shiftCard.querySelector('.timeline-shift-badge');
      const meta = shiftCard.querySelector('.timeline-shift-head .cf-meta');
      if (badge) badge.textContent = nextShift;
      if (meta) meta.textContent = `Quick Edit · ${nextDate}`;
      markChartDirty();
    };
    el.addEventListener('change', syncMetaHeader);
    if (el.tagName !== 'SELECT') {
      el.addEventListener('input', syncMetaHeader);
    }
  });

  listEl.querySelectorAll('.tl-cancel-entry-btn').forEach((btn) => {
    btn.onclick = () => {
      const ta = listEl.querySelector('.tl-edit-textarea');
      const inlineCard = btn.closest('.timeline-inline-edit');
      const saveBtn = inlineCard?.querySelector('.tl-save-entry-btn');
      const s = editingTimelineKey ? shiftLookup.get(editingTimelineKey) : null;
      const bodyChanged = Boolean(ta && s && ta.value.trim() !== String(s.body || '').trim());
      let metaChanged = false;
      if (inlineCard && saveBtn) {
        const { nextDate, nextShift } = resolveTimelineEditMeta(
          inlineCard,
          saveBtn.dataset.date,
          saveBtn.dataset.origShift
        );
        const origIso = dateStringToIso(saveBtn.dataset.date);
        const nextIso = dateStringToIso(nextDate);
        const dateDiff = origIso && nextIso ? origIso !== nextIso : nextDate !== saveBtn.dataset.date;
        metaChanged = dateDiff || nextShift !== saveBtn.dataset.origShift;
      }
      if (bodyChanged || metaChanged) {
        if (!confirm('Discard unsaved edits to this shift block?')) return;
      }
      editingTimelineKey = null;
      renderChartTimeline();
    };
  });

function applyTimelineQuickInputsToCard(card, ta) {
  if (!card || !ta) return false;
  const bp = formatSplitBp(card.querySelector('.tl-q-sbp')?.value, card.querySelector('.tl-q-dbp')?.value);
  const hr = card.querySelector('.tl-q-hr')?.value.trim();
  const rr = card.querySelector('.tl-q-rr')?.value.trim();
  const temp = card.querySelector('.tl-q-temp')?.value.trim();
  const o2 = card.querySelector('.tl-q-o2')?.value.trim();
  const ioUnit = card.querySelector('.tl-q-io-unit')?.value || 'ml';
  const ioIn = formatIoWithUnit(card.querySelector('.tl-q-in')?.value, ioUnit);
  const ioOut = formatIoWithUnit(card.querySelector('.tl-q-out')?.value, ioUnit);
  const newTask = card.querySelector('.tl-q-task')?.value.trim();

  if (!bp && !hr && !rr && !temp && !o2 && !ioIn && !ioOut && !newTask) {
    return false;
  }

  let txt = ta.value;
  if (bp || hr || rr || temp || o2) {
    const vsLine = `Vitals: BP ${bp} | HR ${hr} | RR ${rr} | T ${temp} | O2sat ${o2}`.replace(/\s+\|/g, ' |');
    if (/^(?:Vitals|VS):.*$/im.test(txt)) txt = txt.replace(/^(?:Vitals|VS):.*$/im, vsLine);
    else txt = `${vsLine}\n${txt}`;
  }

  if (ioIn || ioOut) {
    const fb = ioIn && ioOut ? computeShiftFluidBalance(ioIn, ioOut) : '';
    const ioLine = `Shift I&O: In: ${ioIn} | Out: ${ioOut} | FB: ${fb}`.trim();
    if (/^Shift\s+I&O:.*$/im.test(txt)) txt = txt.replace(/^Shift\s+I&O:.*$/im, ioLine);
    else txt = `${txt.trimEnd()}\n${ioLine}`;
  }

  if (newTask) {
    if (/^\s*\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?\s*$/im.test(txt)) {
      txt = appendPendingLineToLatestBlock(txt, newTask, defaultShiftForHour());
    } else {
      txt = `${txt.trimEnd()}\n\n**Pending:\n- [ ] ${newTask}`;
    }
  }

  ['.tl-q-sbp', '.tl-q-dbp', '.tl-q-hr', '.tl-q-rr', '.tl-q-temp', '.tl-q-o2', '.tl-q-in', '.tl-q-out', '.tl-q-task'].forEach(
    (sel) => {
      const inp = card.querySelector(sel);
      if (inp) inp.value = '';
    }
  );
  ta.value = txt.trim();
  markChartDirty();
  return true;
}

  listEl.querySelectorAll('.tl-apply-quick-btn').forEach((btn) => {
    btn.onclick = () => {
      const card = btn.closest('.timeline-inline-edit');
      const ta = card?.querySelector('.tl-edit-textarea');
      if (applyTimelineQuickInputsToCard(card, ta)) {
        toast('Inserted quick fields into block');
      }
    };
  });

  listEl.querySelectorAll('.tl-save-entry-btn').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.key;
      const ta = listEl.querySelector(`.tl-edit-textarea[data-key="${CSS.escape(key)}"]`);
      if (!ta) return;
      const card = btn.closest('.timeline-inline-edit');
      applyTimelineQuickInputsToCard(card, ta);
      const { nextDate, nextShift } = resolveTimelineEditMeta(
        card,
        btn.dataset.date,
        btn.dataset.origShift
      );
      const prevContent = $('noteText').value;
      const res = updateShiftBlock(prevContent, {
        targetDate: btn.dataset.date,
        dateOccurrenceIndex: Number(btn.dataset.dateIdx || 0),
        shiftOccurrenceIndex: Number(btn.dataset.shiftIdx),
        newBody: ta.value,
        newDate: nextDate,
        newShift: nextShift,
      });
      if (res.modified) {
        pushUndoSnapshot(currentId, prevContent);
        $('noteText').value = res.text;
        lastSavedChartContent = res.text;
        editingTimelineKey = null;
        if (timelineDateFilter !== 'all' && res.date) {
          const curFilterIso = dateStringToIso(timelineDateFilter) || timelineDateFilter;
          const nextIso = dateStringToIso(res.date) || res.date;
          if (curFilterIso !== nextIso) timelineDateFilter = res.date;
        }
        await saveCurrent(res.moved ? `Updated (${res.date} · ${res.shift})` : 'Entry updated');
        renderChartTimeline();
      } else {
        editingTimelineKey = null;
        renderChartTimeline();
      }
    };
  });

  listEl.querySelectorAll('.tl-delete-entry-btn').forEach((btn) => {
    btn.onclick = async () => {
      if (!confirm('Delete this shift block from the chart?')) return;
      const prevContent = $('noteText').value;
      const res = deleteShiftBlock(
        prevContent,
        btn.dataset.date,
        Number(btn.dataset.shiftIdx),
        Number(btn.dataset.dateIdx || 0)
      );
      if (res.modified) {
        pushUndoSnapshot(currentId, prevContent);
        $('noteText').value = res.text;
        lastSavedChartContent = res.text;
        editingTimelineKey = null;
        await saveCurrent(null, { silent: true });
        renderChartTimeline();
        toast('Shift block deleted', {
          onUndo: async () => {
            $('noteText').value = prevContent;
            lastSavedChartContent = prevContent;
            await saveCurrent('Shift block restored');
            renderChartTimeline();
          },
        });
      }
    };
  });

  listEl.querySelectorAll('.tl-copy-btn').forEach((btn) => {
    btn.onclick = () => {
      const s = shiftLookup.get(btn.dataset.key);
      if (!s) return;
      const note = notes.find((n) => n.id === currentId) || {};
      const snippet = s.shift === 'Entry' ? s.body : `### ${s.shift}\n${s.body}`;
      copyUpdateTextForContent(snippet, note);
    };
  });

  listEl.querySelectorAll('.tl-pending-check').forEach((chk) => {
    chk.onchange = async () => {
      const prevContent = $('noteText').value;
      const res = togglePendingItem(prevContent, chk.dataset.task, chk.checked, {
        date: chk.dataset.date,
        dateOccurrenceIndex: Number(chk.dataset.dateIdx || 0),
        shiftIndex: Number(chk.dataset.shiftIdx),
      });
      if (res.modified) {
        pushUndoSnapshot(currentId, prevContent);
        $('noteText').value = res.text;
        lastSavedChartContent = res.text;
        await saveCurrent(chk.checked ? 'Task marked complete' : 'Task reopened');
        renderChartTimeline();
      }
    };
  });
}

async function select(id, opts = {}) {
  if (!opts.skipFlush && currentId && currentId !== id && dirtyChart) {
    await flushPendingChartSave();
  }
  const n = notes.find((x) => x.id === id);
  if (!n) return;
  currentId = id;
  if (currentMode === 'editor') lastEditedRoundsId = id;
  clearTimeout(chartAutosaveTimer);
  dirtyChart = false;
  lastSavedChartContent = n.content || '';
  updateSaveStatusPill('saved');
  updateUndoButton();

  $('noteTitle').textContent = n.title || 'Untitled note';
  $('noteText').value = n.content;
  populateProfileInputs(n, n.content, false);
  renderAdmittingHistoryCard(n.content);
  timelineDateFilter = 'all';
  timelineSearchQuery = '';
  editingTimelineKey = null;
  if ($('timelineSearchInput')) $('timelineSearchInput').value = '';
  $('reply').hidden = true;
  $('preview').textContent = 'Press "Build redacted preview".';
  $('guardPill').textContent = 'CHECKING';
  $('guardPill').className = 'pill';
  $('shieldStatus').textContent = 'LOCAL ONLY';
  $('shieldStatus').className = 'pill';
  companionStale = false;
  $('copyBtn').disabled = $('sendBtn').disabled = true;
  const detailsEl = $('profileDetails');
  if (detailsEl) detailsEl.open = !$('nameInput').value.trim();
  setEditorView('timeline');
  updateEditorEmptyAndNav();
  renderList();
}

async function undoChartEdit() {
  if (!currentId) return;
  const stack = undoStacks.get(currentId);
  if (!stack || !stack.length) return;
  const prev = stack.pop();
  updateUndoButton();
  $('noteText').value = prev;
  lastSavedChartContent = prev;
  const n = notes.find((x) => x.id === currentId) || {};
  populateProfileInputs(n, prev, false);
  renderAdmittingHistoryCard(prev);
  if (editorViewMode === 'timeline') renderChartTimeline();
  await saveCurrent('Reverted last chart edit', { skipUndoPush: true });
}

async function newNote() {
  await flushPendingChartSave();
  const today = getTodayDateStrings().mmddyyyy;
  const n = {
    id: uid(),
    title: 'Untitled note',
    content: syncFrontmatter('', {
      name: '',
      room: '',
      admitted: today,
      census: true,
      charity: false,
    }),
    name: '',
    aliases: [],
    room: '',
    updated: Date.now(),
  };
  await put(n);
  await refresh();
  await select(n.id, { skipFlush: true });
  await setMode('editor');
  const detailsEl = $('profileDetails');
  if (detailsEl) detailsEl.open = true;
  $('nameInput').focus();
}

async function saveCurrent(toastMsg = 'Saved on this device', opts = {}) {
  if (!currentId) return newNote();
  clearTimeout(chartAutosaveTimer);
  const n = notes.find((x) => x.id === currentId) || {};
  if (editorViewMode === 'timeline') {
    syncProfileInputsToMarkdown();
  } else {
    populateProfileInputs(n, $('noteText').value, true);
  }
  const text = $('noteText').value;
  renderAdmittingHistoryCard(text);
  if (!opts.skipUndoPush && n.content && n.content !== text) {
    pushUndoSnapshot(currentId, n.content);
  }
  const m = metaOf(text);
  const nameVal = $('nameInput').value.trim();
  const roomVal = $('roomInput').value.trim() || m.room || '';
  const prevAutoTitle = computeNoteTitle(n.name, n.room);
  const nextTitle =
    !n.title || n.title === 'Untitled note' || n.title === prevAutoTitle
      ? computeNoteTitle(nameVal, roomVal)
      : n.title;
  $('noteTitle').textContent = nextTitle;
  const updatedNote = {
    ...n,
    content: text,
    name: nameVal,
    aliases: $('aliasesInput').value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    room: roomVal,
    title: nextTitle,
    updated: Date.now(),
  };
  await put(updatedNote);
  dirtyChart = false;
  lastSavedChartContent = text;
  clearRecoveryDraft('chart');
  updateSaveStatusPill('saved');
  await refresh();
  if (!opts.silent && toastMsg) toast(toastMsg);
}

async function importFiles(files) {
  const importedIds = [];
  for (const f of files) {
    const text = await f.text();
    const m = metaOf(text);
    const parsedAliases = String(m.aliases || '')
      .split(/[;,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const id = uid();
    await put({
      id,
      title: f.name.replace(/\.(md|markdown|txt)$/i, ''),
      content: text,
      name: m.name || m.patient || '',
      aliases: parsedAliases,
      room: m.room || m.bed || '',
      updated: Date.now(),
    });
    importedIds.push(id);
  }
  await refresh();
  toast(`${files.length} note(s) imported locally`);
  if (importedIds.length === 1) {
    await select(importedIds[0]);
    await setMode('editor');
  }
}

/* ---------- redaction / companion ---------- */
function buildPreview() {
  const r = redact($('noteText').value, profile());
  lastSafe = r.text;
  $('preview').innerHTML = esc(r.text).replace(/\[PATIENT\]/g, '<mark>[PATIENT]</mark>');
  const qLeaks = findLeaks($('question').value, profile());
  const leaks = [...r.report.leaks, ...qLeaks];
  const bad = leaks.length > 0;
  companionStale = false;
  $('guardPill').textContent = bad ? `BLOCKED · ${leaks.length}` : 'PHI CLEARED';
  $('guardPill').className = 'pill ' + (bad ? 'block' : 'safe');
  $('shieldStatus').textContent = bad ? 'SEND BLOCKED' : 'LOCAL ONLY';
  $('shieldStatus').className = 'pill ' + (bad ? 'block' : 'safe');
  $('copyBtn').disabled = $('sendBtn').disabled = bad;
  const redacted = r.report.replacements.map((x) => esc(x.original)).join(', ') || 'none';
  $('report').innerHTML = `Redacted: <b>${redacted}</b><br>Room kept: <b>${esc(
    r.report.rooms.join(', ') || 'none found'
  )}</b>${
    bad
      ? `<br><span class="bad">Leaks: ${esc(
          leaks.map((x) => x.value).join(', ')
        )} — edit the note or profile and rebuild.</span>`
      : ''
  }`;
  $('reply').hidden = true;
  return !bad;
}

function makePayload() {
  if (!buildPreview()) return null;
  try {
    return buildPayload(lastSafe, $('question').value, profile());
  } catch (e) {
    toast(e.message);
    return null;
  }
}

async function send() {
  if (navigator.onLine === false) {
    return toast('Device is offline — copy safe prompt locally or wait for connection');
  }
  const payload = makePayload();
  if (!payload) return;
  const endpoint = $('endpoint').value.trim().replace(/\/$/, '');
  const model = $('model').value.trim(),
    key = $('apiKey').value.trim();
  if (!endpoint || !model || !key)
    return toast('Set endpoint, model and API key in Settings first (or use Copy safe prompt)');
  const reply = $('reply');
  reply.hidden = false;
  reply.textContent = 'Thinking…';
  try {
    const text = await callAiChat({ endpoint, model, apiKey: key, prompt: payload });
    reply.textContent = text;
  } catch (e) {
    reply.textContent = 'Request failed: ' + e.message;
  }
}

/* ---------- workspace backup & restore preview ---------- */
async function runFullWorkspaceBackup() {
  const charts = [...notes];
  const bundle = {
    version: 2,
    app: 'Kardex',
    exportedAt: new Date().toISOString(),
    charts,
    scratchNotes,
    captureInbox: inboxItems,
    customCategories,
    shiftSchedule,
    appearance: { theme: currentThemeId, accent: currentAccentHex },
    templateConfig,
    rawUpdateTemplate: getSavedUpdateTemplate(),
  };
  const shared = await shareOrDownload({
    filename: `kardex-workspace-${new Date().toISOString().slice(0, 10)}.json`,
    text: JSON.stringify(bundle, null, 2),
    mimeType: 'application/json',
    title: 'Kardex Workspace Backup',
  });
  if (shared) {
    safeSetItem(BACKUP_AT_KEY, String(Date.now()));
    updateBackupReminderUi();
    toast(`Backed up ${charts.length} chart(s), ${scratchNotes.length} quick note(s) & preferences`);
  }
}

async function exportAllChartsMarkdown() {
  const charts = getSortedNotesByBed();
  if (!charts.length) return toast('No patient charts to export');
  const combined = charts
    .map((n) => `# ${n.title || n.name || 'Chart'}\n\n${String(n.content || '').trim()}`)
    .join('\n\n---\n\n');
  const shared = await shareOrDownload({
    filename: `kardex-all-charts-${new Date().toISOString().slice(0, 10)}.md`,
    text: combined,
    mimeType: 'text/markdown',
    title: 'Kardex All Charts',
  });
  if (shared) toast(`Exported ${charts.length} chart(s) as Markdown`);
}

function parseBackupPayload(rawJson) {
  if (Array.isArray(rawJson)) {
    const charts = rawJson.filter((n) => n && typeof n === 'object' && typeof n.content === 'string' && n.id);
    return { version: 1, charts, scratchNotes: [], captureInbox: [], customCategories: [], shiftSchedule: null, appearance: null, templateConfig: null, rawUpdateTemplate: '' };
  }
  if (rawJson && typeof rawJson === 'object' && Array.isArray(rawJson.charts)) {
    return {
      version: rawJson.version || 2,
      charts: rawJson.charts.filter((n) => n && typeof n === 'object' && typeof n.content === 'string' && n.id),
      scratchNotes: Array.isArray(rawJson.scratchNotes) ? rawJson.scratchNotes : [],
      captureInbox: Array.isArray(rawJson.captureInbox) ? rawJson.captureInbox : [],
      customCategories: Array.isArray(rawJson.customCategories) ? dedupeCategoryList(rawJson.customCategories) : [],
      shiftSchedule: Array.isArray(rawJson.shiftSchedule) ? normalizeShiftSchedule(rawJson.shiftSchedule) : null,
      appearance:
        rawJson.appearance && typeof rawJson.appearance === 'object'
          ? {
              theme: normalizeThemeId(rawJson.appearance.theme),
              accent: normalizeHexColor(rawJson.appearance.accent),
            }
          : null,
      templateConfig: rawJson.templateConfig || null,
      rawUpdateTemplate: typeof rawJson.rawUpdateTemplate === 'string' ? rawJson.rawUpdateTemplate : '',
    };
  }
  throw new Error('Unrecognized backup JSON format');
}

function openRestoreModal(payload, triggerEl = null) {
  pendingRestorePayload = payload;
  const conflicts = payload.charts.filter((c) => notes.some((local) => local.id === c.id)).length;
  $('restoreSummary').textContent =
    `Found ${payload.charts.length} chart(s) (${conflicts} matching existing IDs), ${payload.scratchNotes.length} quick note(s), ${payload.captureInbox.length} inbox item(s)${
      payload.templateConfig || payload.rawUpdateTemplate ? ', + shift template' : ''
    }.`;

  $('restorePreviewList').innerHTML = payload.charts
    .slice(0, 30)
    .map((c) => {
      const localMatch = notes.find((l) => l.id === c.id);
      const localNewer = localMatch && (localMatch.updated || 0) > (c.updated || 0);
      const badge = !localMatch
        ? '<span class="pill safe">New</span>'
        : localNewer
          ? '<span class="pill warn">Local Newer</span>'
          : '<span class="pill">Match</span>';
      return `<div class="restore-preview-row"><span>${esc(c.title || c.name || c.id)} (${esc(c.room || 'Unassigned')})</span>${badge}</div>`;
    })
    .join('');

  if ($('restoreModeSelect')) $('restoreModeSelect').value = 'keep-newer';
  openModalEl($('restoreModal'), triggerEl);
}

async function applyRestorePayload() {
  if (!pendingRestorePayload) return;
  const mode = $('restoreModeSelect')?.value || 'keep-newer';
  let importedCharts = 0;

  for (const incoming of pendingRestorePayload.charts) {
    const existing = notes.find((l) => l.id === incoming.id);
    if (mode === 'import-copy' && existing) {
      await put({ ...incoming, id: uid(), title: `${incoming.title || 'Chart'} (Restored Copy)` });
      importedCharts++;
    } else if (mode === 'keep-newer' && existing && (existing.updated || 0) > (incoming.updated || 0)) {
      continue;
    } else {
      await put(incoming);
      importedCharts++;
    }
  }

  for (const sn of pendingRestorePayload.scratchNotes) {
    if (sn && sn.id && !scratchNotes.some((local) => local.id === sn.id)) {
      scratchNotes.push(sn);
    }
  }
  saveScratchNotes();

  for (const inb of pendingRestorePayload.captureInbox) {
    if (inb && inb.id && !inboxItems.some((local) => local.id === inb.id)) {
      inboxItems.push(inb);
    }
  }
  saveInbox();
  updateInboxBadge();

  if (Array.isArray(pendingRestorePayload.customCategories) && pendingRestorePayload.customCategories.length) {
    customCategories = dedupeCategoryList([...customCategories, ...pendingRestorePayload.customCategories]);
    saveCustomCategories();
  }
  if (Array.isArray(pendingRestorePayload.shiftSchedule) && pendingRestorePayload.shiftSchedule.length) {
    saveShiftSchedule(pendingRestorePayload.shiftSchedule);
  }
  if (pendingRestorePayload.appearance) {
    applyAppearance(pendingRestorePayload.appearance.theme, pendingRestorePayload.appearance.accent, { persist: true });
  }

  if (pendingRestorePayload.templateConfig && Array.isArray(pendingRestorePayload.templateConfig.sections)) {
    templateConfig = normalizeTemplateSections(pendingRestorePayload.templateConfig);
    safeSetItem(TEMPLATE_CONFIG_KEY, JSON.stringify(templateConfig));
  }
  if (pendingRestorePayload.rawUpdateTemplate) {
    safeSetItem(TEMPLATE_KEY, pendingRestorePayload.rawUpdateTemplate);
  }

  pendingRestorePayload = null;
  closeModalEl($('restoreModal'));
  await refresh();
  if (currentId) await select(currentId, { skipFlush: true });
  toast(`Restore complete: ${importedCharts} chart(s) applied`);
}

function updateApiKeyStatusPill() {
  const pill = $('apiKeyStatusPill');
  if (!pill) return;
  const hasKey = Boolean($('apiKey')?.value.trim());
  pill.textContent = hasKey ? 'LOADED IN RAM' : 'NO KEY IN RAM';
  pill.className = 'pill ' + (hasKey ? 'safe' : '');
}

function extractRelayFooterText() {
  const raw = getSavedUpdateTemplate();
  if (!raw.trim()) return 'Thank you, doctor';
  const lines = raw.trim().split('\n');
  const idx = lines.findIndex((l) => /^(?:Thank\s+you|Thanks|Regards|Best|Sincerely)/i.test(l.trim()));
  if (idx !== -1) return lines.slice(idx).join('\n').trim();
  return 'Thank you, doctor';
}

/* ---------- wire up ---------- */
// Header status & PWA banners
if ($('backupReminderPill')) {
  $('backupReminderPill').onclick = runFullWorkspaceBackup;
  $('backupReminderPill').onkeydown = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      runFullWorkspaceBackup();
    }
  };
}
if ($('swDismissBtn')) {
  $('swDismissBtn').onclick = () => {
    $('swUpdateBanner').hidden = true;
  };
}
if ($('swReloadBtn')) {
  $('swReloadBtn').onclick = async () => {
    await flushPendingChartSave();
    persistRecoveryDraftSync();
    const isRec = voiceRecorder.isRecording() || admitRecorder.isRecording();
    const hasKey = Boolean($('apiKey')?.value.trim());
    const hasScratch = Boolean(!$('scratchEditorCard')?.hidden && isScratchEditorDirty());
    const reasons = [];
    if (dirtyChart) reasons.push('unsaved chart edits');
    if (hasScratch) reasons.push('unsaved Quick Note edits');
    if (isRec) reasons.push('an active voice recording');
    if (hasKey) reasons.push('your RAM-only API key (will need re-pasting)');
    if (reasons.length && !confirm(`Reloading now will clear/interrupt ${reasons.join(', ')}. Continue?`)) {
      return;
    }
    if (swWaitingWorker) {
      swWaitingWorker.postMessage({ type: 'SKIP_WAITING' });
    } else {
      window.location.reload();
    }
  };
}
if ($('storageRiskBackupBtn')) $('storageRiskBackupBtn').onclick = runFullWorkspaceBackup;
if ($('storageRiskDismissBtn')) {
  $('storageRiskDismissBtn').onclick = () => {
    storageRiskDismissed = true;
    if ($('storageRiskBanner')) $('storageRiskBanner').hidden = true;
  };
}
if ($('settingsBackupBtn')) $('settingsBackupBtn').onclick = runFullWorkspaceBackup;
if ($('checkSwUpdateBtn')) {
  $('checkSwUpdateBtn').onclick = async () => {
    if (!swRegistration) return toast('Service worker inactive in this browser session');
    const statusEl = $('swUpdateStatusText');
    if (statusEl) statusEl.textContent = 'Checking for updates...';
    try {
      await swRegistration.update();
      lastSwUpdateCheckAt = Date.now();
      if (swRegistration.waiting) {
        swWaitingWorker = swRegistration.waiting;
        if ($('swUpdateBanner')) $('swUpdateBanner').hidden = false;
        if (statusEl) statusEl.textContent = 'Update downloaded — tap Reload Safely';
        toast('Update ready — tap Reload Safely');
      } else if (swRegistration.installing) {
        if (statusEl) statusEl.textContent = 'Downloading update in background...';
      } else {
        if (statusEl) statusEl.textContent = 'Up to date offline';
        toast('Kardex is already up to date');
      }
    } catch {
      if (statusEl) statusEl.textContent = 'Offline — using local cached app';
      toast('Could not check updates while offline');
    }
  };
}

if ($('shiftPresetBtns')) {
  $('shiftPresetBtns').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-shift-preset]');
    if (!btn) return;
    const preset = SHIFT_SCHEDULE_PRESETS[btn.dataset.shiftPreset];
    if (!preset) return;
    saveShiftSchedule(preset.shifts);
    toast(`Shift schedule set to ${preset.name}`);
  });
}

if ($('shiftScheduleList')) {
  $('shiftScheduleList').addEventListener('click', (e) => {
    const delBtn = e.target.closest('.shift-slot-del-btn[data-del-idx]');
    if (!delBtn) return;
    const idx = parseInt(delBtn.dataset.delIdx, 10);
    if (Number.isNaN(idx) || shiftSchedule.length <= 1) return;
    const next = shiftSchedule.filter((_, i) => i !== idx);
    saveShiftSchedule(next);
  });

  $('shiftScheduleList').addEventListener('change', (e) => {
    const row = e.target.closest('.shift-slot-row[data-slot-idx]');
    if (!row) return;
    const idx = parseInt(row.dataset.slotIdx, 10);
    if (Number.isNaN(idx) || !shiftSchedule[idx]) return;
    const timeVal = normalizeShiftTime(row.querySelector('.shift-time-input')?.value);
    const labelInput = row.querySelector('.shift-label-input');
    const prevSlot = shiftSchedule[idx];
    const autoPrevLabel = formatTime24ToLabel(prevSlot.time);
    let labelVal = (labelInput?.value || '').trim();
    if (e.target.classList.contains('shift-time-input') && timeVal) {
      if (!labelVal || labelVal === autoPrevLabel) {
        labelVal = formatTime24ToLabel(timeVal);
      }
      const next = shiftSchedule.map((s, i) => (i === idx ? { time: timeVal, label: labelVal } : s));
      saveShiftSchedule(next);
      return;
    }
    if (e.target.classList.contains('shift-label-input')) {
      const next = shiftSchedule.map((s, i) =>
        i === idx ? { ...s, label: labelVal || formatTime24ToLabel(s.time) } : s
      );
      saveShiftSchedule(next);
    }
  });
}

if ($('addShiftSlotBtn')) {
  $('addShiftSlotBtn').onclick = () => {
    if (shiftSchedule.length >= 6) return toast('Maximum of 6 shifts allowed');
    const takenTimes = new Set(shiftSchedule.map((s) => s.time));
    const candidates = ['12:00', '18:00', '00:00', '08:00', '16:00', '20:00', '04:00'];
    let picked = candidates.find((t) => !takenTimes.has(t));
    if (!picked) {
      for (let h = 0; h < 24; h++) {
        const hh = `${String(h).padStart(2, '0')}:00`;
        if (!takenTimes.has(hh)) {
          picked = hh;
          break;
        }
      }
    }
    if (!picked) return;
    saveShiftSchedule([...shiftSchedule, { time: picked, label: formatTime24ToLabel(picked) }]);
  };
}

if ($('resetShiftScheduleBtn')) {
  $('resetShiftScheduleBtn').onclick = () => {
    saveShiftSchedule(DEFAULT_SHIFT_SCHEDULE);
    toast('Shift schedule reset to 8h default (6am / 2pm / 10pm)');
  };
}

// Navigation modes
$('navRoundsBtn').onclick = () => setMode('rounds');
$('navEditorBtn').onclick = () => setMode('editor');
$('navLibraryBtn').onclick = () => setMode('library');
$('navScratchBtn').onclick = () => setMode('scratch');
$('navSettingsBtn').onclick = () => setMode('settings');
$('backToRoundsBtn').onclick = () => setMode('rounds');
$('backToRoundsFromLibraryBtn').onclick = () => setMode('rounds');
$('backToRoundsFromScratchBtn').onclick = () => setMode('rounds');
$('backToRoundsFromSettingsBtn').onclick = () => setMode('rounds');
$('openSettingsFromEditorBtn').onclick = () => {
  setMode('settings');
  setSettingsTab('ai');
};

if ($('settingsSubnav')) {
  $('settingsSubnav').addEventListener('click', (e) => {
    const btn = e.target.closest('.settings-nav-btn[data-settings-tab]');
    if (!btn) return;
    setSettingsTab(btn.dataset.settingsTab);
  });
  $('settingsSubnav').addEventListener('keydown', (e) => {
    const tabs = [...$('settingsSubnav').querySelectorAll('.settings-nav-btn[data-settings-tab]')];
    const idx = tabs.indexOf(e.target.closest('.settings-nav-btn[data-settings-tab]'));
    if (idx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = tabs.length - 1;
    if (nextIdx !== -1) {
      e.preventDefault();
      setSettingsTab(tabs[nextIdx].dataset.settingsTab, { focus: true });
    }
  });
}

if ($('emptyNewPatientBtn')) $('emptyNewPatientBtn').onclick = () => openAdmitModal({ mode: 'new', triggerEl: $('emptyNewPatientBtn') });
if ($('emptyBrowseRoundsBtn')) $('emptyBrowseRoundsBtn').onclick = () => setMode('rounds');
if ($('emptyBrowseChartsBtn')) $('emptyBrowseChartsBtn').onclick = () => setMode('library');

// Chart Explorer filters & sort
if ($('librarySortSelect')) {
  $('librarySortSelect').onchange = () => {
    librarySortMode = $('librarySortSelect').value || 'recent';
    renderList();
  };
}
$('librarySearchInput').oninput = (e) => {
  librarySearchQuery = e.target.value;
  renderList();
};
if ($('librarySampleBtn')) $('librarySampleBtn').onclick = loadSampleCensus;
if ($('exportAllMdBtn')) $('exportAllMdBtn').onclick = exportAllChartsMarkdown;

// Quick Notes / Scratchpad actions
scratchNotes = loadScratchNotes();
document.querySelectorAll('#scratchFilterChips .chip').forEach((chip) => {
  chip.onclick = () => {
    document.querySelectorAll('#scratchFilterChips .chip').forEach((c) => {
      c.classList.remove('active');
      c.setAttribute('aria-pressed', 'false');
    });
    chip.classList.add('active');
    chip.setAttribute('aria-pressed', 'true');
    scratchFilter = chip.dataset.cat;
    renderScratchNotes();
  };
});
$('scratchSearchInput').oninput = (e) => {
  scratchSearch = e.target.value;
  renderScratchNotes();
};
$('newScratchBtn').onclick = () => openScratchEditor(null);
if ($('loadSampleScratchBtn')) $('loadSampleScratchBtn').onclick = loadSampleScratchNotes;
if ($('exportScratchBtn')) {
  $('exportScratchBtn').onclick = () => {
    if (!scratchNotes.length) return toast('No quick notes to export');
    const md = scratchNotes
      .map((n) => `## ${n.title || 'Untitled'} (${n.category || 'Scratchpad'})\n\n${n.body || ''}`)
      .join('\n\n---\n\n');
    download(`kardex-quick-notes-${new Date().toISOString().slice(0, 10)}.md`, md);
    toast('Quick notes exported locally');
  };
}
$('saveScratchBtn').onclick = saveScratchNote;
$('cancelScratchBtn').onclick = () => closeScratchEditor(false);
$('cancelScratchFootBtn').onclick = () => closeScratchEditor(false);

// Rounds toolbar, KPI stat filters & custom category add forms
document.querySelectorAll('.census-summary .stat-card').forEach((card) => {
  card.onclick = () => setActiveRoundsFilter(card.dataset.statFilter || 'active');
});
if ($('roundsAddCatForm')) {
  $('roundsAddCatForm').onsubmit = (e) => {
    e.preventDefault();
    const val = $('roundsAddCatInput')?.value || '';
    const created = addCustomCategory(val, { assignToCurrentChart: false });
    if (created) {
      $('roundsAddCatInput').value = '';
      $('roundsAddCatForm').hidden = true;
    }
  };
}
if ($('roundsAddCatCancelBtn')) {
  $('roundsAddCatCancelBtn').onclick = () => {
    if ($('roundsAddCatForm')) $('roundsAddCatForm').hidden = true;
  };
}
if ($('roundsAddCatInput')) {
  $('roundsAddCatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('roundsAddCatForm')) {
      e.stopPropagation();
      $('roundsAddCatForm').hidden = true;
    }
  });
}
if ($('addProfileCategoryBtn')) {
  $('addProfileCategoryBtn').onclick = () => {
    const form = $('profileAddCatForm');
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) {
      $('profileAddCatInput').value = '';
      $('profileAddCatInput').focus();
    }
  };
}
if ($('profileAddCatForm')) {
  $('profileAddCatForm').onsubmit = (e) => {
    e.preventDefault();
    const val = $('profileAddCatInput')?.value || '';
    const created = addCustomCategory(val, { assignToCurrentChart: true });
    if (created) {
      $('profileAddCatInput').value = '';
      $('profileAddCatForm').hidden = true;
    }
  };
}
if ($('profileAddCatCancelBtn')) {
  $('profileAddCatCancelBtn').onclick = () => {
    if ($('profileAddCatForm')) $('profileAddCatForm').hidden = true;
  };
}
if ($('profileAddCatInput')) {
  $('profileAddCatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('profileAddCatForm')) {
      e.stopPropagation();
      $('profileAddCatForm').hidden = true;
    }
  });
}
if ($('roundsSortSelect')) {
  $('roundsSortSelect').onchange = () => {
    roundsSortMode = $('roundsSortSelect').value || 'bed';
    renderRounds();
  };
}
if ($('roundsCompactBtn')) {
  $('roundsCompactBtn').onclick = () => {
    roundsCompactMode = !roundsCompactMode;
    expandedCompactIds.clear();
    safeSetItem(PREFS_COMPACT_KEY, String(roundsCompactMode));
    renderRounds();
  };
}

$('bedSearchInput').oninput = (e) => {
  searchQuery = e.target.value;
  renderRounds();
};

$('copyCensusBtn').onclick = async () => {
  const report = formatDailyCensusReport(notes);
  await copyTextWithFallback(report, 'Daily census copied to clipboard', 'Copy Daily Census');
};

$('handoverBtn').onclick = () => openHandoverModal($('handoverBtn'));
$('inboxBtn').onclick = () => openInboxModal(null, $('inboxBtn'));

$('quickNewPtBtn').onclick = newNoteAndEdit;
$('loadSyntheticBtn').onclick = loadSampleCensus;

// Editor actions & Patient Switcher
if ($('editorPatientSelect')) {
  $('editorPatientSelect').onchange = async () => {
    const nextId = $('editorPatientSelect').value;
    if (nextId && nextId !== currentId) {
      await select(nextId);
    }
  };
}
if ($('prevPatientBtn')) {
  $('prevPatientBtn').onclick = async () => {
    const navNotes = getEditorNavNotes();
    const idx = navNotes.findIndex((n) => n.id === currentId);
    if (idx > 0) await select(navNotes[idx - 1].id);
  };
}
if ($('nextPatientBtn')) {
  $('nextPatientBtn').onclick = async () => {
    const navNotes = getEditorNavNotes();
    const idx = navNotes.findIndex((n) => n.id === currentId);
    if (idx !== -1 && idx < navNotes.length - 1) await select(navNotes[idx + 1].id);
  };
}
if ($('undoChartBtn')) $('undoChartBtn').onclick = undoChartEdit;
if ($('editorDictateBtn')) {
  $('editorDictateBtn').onclick = () => {
    if (!currentId) return toast('Select or create a patient chart first');
    openDictateModal(currentId, $('editorDictateBtn'));
  };
}

$('newBtn').onclick = () => openAdmitModal({ mode: 'new', triggerEl: $('newBtn') });
$('saveBtn').onclick = () => saveCurrent();
$('editorTimelineTab').onclick = () => setEditorView('timeline');
$('editorRawTab').onclick = () => setEditorView('raw');
$('timelineSearchInput').oninput = (e) => {
  timelineSearchQuery = e.target.value;
  renderChartTimeline();
};
[
  'nameInput',
  'aliasesInput',
  'roomInput',
  'ageInput',
  'sexInput',
  'weightInput',
  'serviceInput',
  'apInput',
  'admittedInput',
  'assessmentInput',
].forEach((id) => {
  $(id).oninput = () => {
    syncProfileInputsToMarkdown();
    markChartDirty();
  };
  $(id).onchange = () => {
    syncProfileInputsToMarkdown();
    markChartDirty();
  };
});
if ($('censusToggle')) {
  $('censusToggle').onchange = () => {
    syncProfileInputsToMarkdown();
    markChartDirty();
  };
}
$('noteText').oninput = () => {
  const n = notes.find((x) => x.id === currentId) || {};
  populateProfileInputs(n, $('noteText').value, true);
  markChartDirty();
};
if ($('question')) $('question').oninput = markCompanionStale;

$('appendShiftBtn').onclick = () => {
  if (!currentId) return toast('Select or create a note first');
  syncProfileInputsToMarkdown();
  openShiftModal(currentId, $('appendShiftBtn'));
};
$('chartLabsBtn').onclick = () => {
  if (!currentId) return toast('Select or create a note first');
  openInboxModal(currentId, $('chartLabsBtn'));
};
$('chartCalcBtn').onclick = () => openCalcModal(currentId, 'audit', $('chartCalcBtn'));
$('copyUpdateBtn').onclick = () => {
  const note = notes.find((n) => n.id === currentId);
  const content = $('noteText').value;
  if (!content.trim()) return toast('Select or create a note first');
  copyUpdateTextForContent(content, note || profile());
};

$('deleteBtn').onclick = async () => {
  if (!currentId) return;
  const deletedNote = notes.find((n) => n.id === currentId);
  if (!deletedNote || !confirm('Delete this patient chart from this device?')) return;
  if ($('editorMoreMenu')) $('editorMoreMenu').open = false;
  clearTimeout(chartAutosaveTimer);
  dirtyChart = false;
  await remove(currentId);
  currentId = null;
  await refresh();
  $('noteText').value = '';
  $('noteTitle').textContent = 'Untitled note';
  await setMode('rounds');
  toast(`Deleted ${deletedNote.room || deletedNote.title || 'chart'}`, {
    onUndo: async () => {
      await put(deletedNote);
      await refresh();
      await select(deletedNote.id, { skipFlush: true });
      await setMode('editor');
      toast('Patient chart restored');
    },
  });
};

$('importInput').onchange = (e) => {
  importFiles([...e.target.files]);
  e.target.value = '';
};

$('exportBtn').onclick = async () => {
  const n = notes.find((x) => x.id === currentId);
  if (!n) return toast('Save a note first');
  if ($('editorMoreMenu')) $('editorMoreMenu').open = false;
  syncProfileInputsToMarkdown();
  const liveContent = $('noteText').value;
  const title = $('noteTitle').textContent || n.title || 'note';
  await shareOrDownload({
    filename: title.replace(/[/\\]/g, '_') + '.md',
    text: liveContent,
    mimeType: 'text/markdown',
    title: `${title} (Raw PHI)`,
  });
};

$('exportDeidBtn').onclick = async () => {
  const n = notes.find((x) => x.id === currentId);
  if (!n) return toast('Save a note first');
  if ($('editorMoreMenu')) $('editorMoreMenu').open = false;
  syncProfileInputsToMarkdown();
  const r = redact($('noteText').value, profile());
  const outName = redactFilename(($('noteTitle').textContent || n.title) + '.md', profile());
  const shared = await shareOrDownload({
    filename: outName,
    text: r.text,
    mimeType: 'text/markdown',
    title: 'Kardex De-identified Note',
    allowTextShare: true,
  });
  await saveCurrent(null, { silent: true });
  if (shared) toast('De-identified file exported — name stripped, room kept');
};

$('backupBtn').onclick = runFullWorkspaceBackup;

$('restoreInput').onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const raw = JSON.parse(await f.text());
    const parsedPayload = parseBackupPayload(raw);
    openRestoreModal(parsedPayload, $('restoreInput').closest('label'));
  } catch (err) {
    toast('Restore failed: ' + err.message);
  }
};
if ($('restoreModalClose')) $('restoreModalClose').onclick = () => closeModalEl($('restoreModal'));
if ($('restoreCancelBtn')) $('restoreCancelBtn').onclick = () => closeModalEl($('restoreModal'));
if ($('restoreConfirmBtn')) $('restoreConfirmBtn').onclick = applyRestorePayload;

$('previewBtn').onclick = () => {
  if (buildPreview()) toast('PHI cleared — review before sending');
  else toast('Send blocked: name still present');
};

$('copyBtn').onclick = async () => {
  const payload = makePayload();
  if (!payload) return;
  await copyTextWithFallback(
    payload,
    'Safe prompt copied — paste into your companion',
    'Copy Safe Prompt'
  );
};

$('sendBtn').onclick = send;

// Settings: API & Connection verification
function syncAiPresetUi() {
  const endpointVal = $('endpoint')?.value.trim() || '';
  const modelVal = $('model')?.value.trim() || '';
  const activePreset = detectAiPreset(endpointVal);
  const presetCfg = AI_PRESETS[activePreset] || AI_PRESETS.custom;

  document.querySelectorAll('[data-ai-preset]').forEach((btn) => {
    const isMatch = btn.dataset.aiPreset === activePreset;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
  });

  const hintEl = $('geminiPresetHint');
  const isGemini = isGeminiEndpoint(endpointVal);
  if (hintEl) hintEl.hidden = !isGemini;

  const normalizedModel = normalizeGeminiModel(modelVal);
  document.querySelectorAll('[data-gemini-model]').forEach((btn) => {
    const isMatch = isGemini && btn.dataset.geminiModel === normalizedModel;
    btn.classList.toggle('active', isMatch);
    btn.setAttribute('aria-pressed', String(isMatch));
  });

  if ($('apiKey') && presetCfg.keyPlaceholder) {
    $('apiKey').placeholder = presetCfg.keyPlaceholder;
  }
}

document.querySelectorAll('[data-ai-preset]').forEach((btn) => {
  btn.onclick = () => {
    const presetId = btn.dataset.aiPreset;
    const preset = AI_PRESETS[presetId];
    if (!preset) return;
    if (presetId === 'gemini') {
      $('endpoint').value = preset.endpoint;
      const curModel = normalizeGeminiModel($('model').value);
      $('model').value = isSupportedGeminiModelId(curModel) ? curModel : preset.model;
      toast('Google Gemini preset applied — paste your Gemini API key');
      $('apiKey')?.focus();
    } else if (presetId === 'openai') {
      $('endpoint').value = preset.endpoint;
      $('model').value = preset.model;
      toast('OpenAI preset applied — paste your OpenAI API key');
      $('apiKey')?.focus();
    } else {
      const curEndpoint = $('endpoint').value.trim().replace(/\/+$/, '');
      const curModel = $('model').value.trim();
      if (isGeminiEndpoint(curEndpoint) || curEndpoint.toLowerCase() === AI_PRESETS.openai.endpoint) {
        $('endpoint').value = '';
      }
      if (curModel === AI_PRESETS.gemini.model || curModel === AI_PRESETS.openai.model || /^gemini-/i.test(curModel)) {
        $('model').value = '';
      }
      $('endpoint')?.focus();
    }
    safeSetItem('cm.endpoint', $('endpoint').value.trim());
    safeSetItem('cm.model', $('model').value.trim());
    if ($('aiConnResult')) $('aiConnResult').textContent = '';
    if ($('aiLiveModelSelect')) {
      $('aiLiveModelSelect').innerHTML = '';
      $('aiLiveModelSelect').hidden = true;
    }
    syncAiPresetUi();
    updateCompanionConnHint();
  };
});

document.querySelectorAll('[data-gemini-model]').forEach((btn) => {
  btn.onclick = () => {
    const modelId = btn.dataset.geminiModel;
    if (!modelId) return;
    $('model').value = modelId;
    safeSetItem('cm.model', modelId);
    if ($('aiConnResult')) $('aiConnResult').textContent = '';
    if ($('aiLiveModelSelect') && !$('aiLiveModelSelect').hidden) {
      const hasOpt = Array.from($('aiLiveModelSelect').options).some((opt) => opt.value === modelId);
      if (hasOpt) $('aiLiveModelSelect').value = modelId;
    }
    syncAiPresetUi();
    updateCompanionConnHint();
    toast(`Model set to ${modelId}`);
  };
});

if ($('fetchAiModelsBtn')) {
  $('fetchAiModelsBtn').onclick = async () => {
    const resEl = $('aiConnResult');
    if (navigator.onLine === false) {
      if (resEl) resEl.textContent = 'Offline — connect to load models.';
      return toast('Offline — connect to load models');
    }
    const endpoint = $('endpoint').value.trim().replace(/\/$/, '');
    const key = $('apiKey').value.trim();
    if (!endpoint || !key) {
      if (resEl) resEl.textContent = 'Enter endpoint URL and paste API key first.';
      return toast('Enter endpoint URL and paste API key first');
    }
    $('fetchAiModelsBtn').disabled = true;
    if (resEl) resEl.textContent = 'Loading models…';
    try {
      const { models } = await listAiModels({ endpoint, apiKey: key });
      const sel = $('aiLiveModelSelect');
      if (sel) {
        sel.innerHTML = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = models.length
          ? `Select from ${models.length} available model(s)…`
          : 'No text generation models returned';
        sel.appendChild(placeholder);
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m.id;
          opt.textContent =
            m.displayName && m.displayName !== m.id ? `${m.displayName} (${m.id})` : m.id;
          sel.appendChild(opt);
        }
        const curModel = normalizeGeminiModel($('model').value);
        if (models.some((m) => m.id === curModel)) {
          sel.value = curModel;
        }
        sel.hidden = models.length === 0;
      }
      if (resEl) resEl.textContent = `✓ Loaded ${models.length} model(s)`;
      toast(`Loaded ${models.length} model(s)`);
    } catch (err) {
      if (resEl) resEl.textContent = `✕ Failed: ${err.message}`;
      toast(`Failed to load models: ${err.message}`);
    } finally {
      $('fetchAiModelsBtn').disabled = false;
    }
  };
}

if ($('aiLiveModelSelect')) {
  $('aiLiveModelSelect').onchange = () => {
    const picked = $('aiLiveModelSelect').value.trim();
    if (!picked) return;
    $('model').value = picked;
    safeSetItem('cm.model', picked);
    if ($('aiConnResult')) $('aiConnResult').textContent = '';
    syncAiPresetUi();
    updateCompanionConnHint();
    toast(`Model set to ${picked}`);
  };
}

['endpoint', 'model'].forEach((id) => {
  $(id).value = safeGetItem('cm.' + id, '');
  $(id).onchange = () => {
    safeSetItem('cm.' + id, $(id).value.trim());
    syncAiPresetUi();
    updateCompanionConnHint();
  };
  $(id).oninput = () => {
    syncAiPresetUi();
    updateCompanionConnHint();
  };
});
syncAiPresetUi();
$('apiKey').oninput = () => {
  updateCompanionConnHint();
  updateApiKeyStatusPill();
};
if ($('toggleApiKeyBtn')) {
  $('toggleApiKeyBtn').onclick = () => {
    const inp = $('apiKey');
    const showing = inp.type === 'text';
    inp.type = showing ? 'password' : 'text';
    $('toggleApiKeyBtn').setAttribute('aria-pressed', String(!showing));
    $('toggleApiKeyBtn').innerHTML = uiIcon(showing ? 'eye' : 'eye-off');
  };
}
if ($('testAiConnBtn')) {
  $('testAiConnBtn').onclick = async () => {
    const resEl = $('aiConnResult');
    if (navigator.onLine === false) {
      if (resEl) resEl.textContent = 'Offline — connect to test AI endpoint.';
      return;
    }
    const endpoint = $('endpoint').value.trim().replace(/\/$/, '');
    const model = $('model').value.trim();
    const key = $('apiKey').value.trim();
    if (!endpoint || !key) {
      if (resEl) resEl.textContent = 'Enter endpoint URL and paste API key first.';
      return;
    }
    $('testAiConnBtn').disabled = true;
    if (resEl) resEl.textContent = 'Testing…';
    try {
      const { provider, ms } = await testAiConnection({ endpoint, model, apiKey: key });
      const label = provider === 'gemini' ? 'Gemini connected' : 'Connected';
      if (resEl) resEl.textContent = `✓ ${label} (${ms}ms)`;
      toast('Kardex AI endpoint reachable');
    } catch (err) {
      if (resEl) resEl.textContent = `✕ Failed: ${err.message}`;
      toast(`Connection failed: ${err.message}`);
    } finally {
      $('testAiConnBtn').disabled = false;
    }
  };
}

// Voice Dictation modal actions
if ($('voiceShiftPills')) {
  $('voiceShiftPills').addEventListener('click', (e) => {
    const pill = e.target.closest('.shift-pill[data-shift]');
    if (!pill) return;
    dictatingShift = pill.dataset.shift;
    $('voiceShiftPills').querySelectorAll('.shift-pill').forEach((p) => {
      const active = p === pill;
      p.classList.toggle('active', active);
      p.setAttribute('aria-pressed', String(active));
    });
    syncModalInterimTimeUi(dictatingShift, 'voiceInterimTimeWrap', 'voiceInterimTimeInput');
  });
}

$('startRecBtn').onclick = startRecordingTelegram;
$('stopRecBtn').onclick = stopRecordingTelegram;
$('cancelRecBtn').onclick = () => cancelRecordingTelegram(true);
$('rerecordBtn').onclick = rerecordTelegram;
$('voiceModalClose').onclick = () => closeDictateModal(false);
$('whisperModalLoadBtn').onclick = preloadSelectedWhisperModel;
if ($('whisperRetryBtn')) {
  $('whisperRetryBtn').onclick = () => {
    if (recordedAudioBlob) runOfflineWhisperTranscription(recordedAudioBlob);
    else preloadSelectedWhisperModel();
  };
}
if ($('whisperCancelBtn')) {
  $('whisperCancelBtn').onclick = async () => {
    await whisperCtrl.unload();
    updateWhisperUiStatus();
    toast('Whisper engine unloaded from memory');
  };
}
$('whisperTranscribeBtn').onclick = () =>
  runOfflineWhisperTranscription(recordedAudioBlob, {
    pcm16k: recordedAudioPcm16k,
    audioToken: recordedAudioToken,
  });
$('voiceUploadInput').onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  recordedAudioBlob = file;
  recordedAudioPcm16k = null;
  recordedAudioToken++;
  lastTranscribedAudioKey = '';
  setRecordedAudioSource(file);
  $('recIdleState').hidden = true;
  $('recActiveState').hidden = true;
  $('voiceAudioContainer').hidden = false;
  await runOfflineWhisperTranscription(file, { pcm16k: null, audioToken: recordedAudioToken });
};

// Settings: Offline Whisper WASM controls
if ($('whisperModelSelect')) {
  $('whisperModelSelect').value = selectedWhisperModel;
  $('whisperModelSelect').onchange = () => {
    selectedWhisperModel = $('whisperModelSelect').value || WHISPER_MODELS[0].id;
    safeSetItem(WHISPER_MODEL_KEY, selectedWhisperModel);
    updateWhisperUiStatus();
  };
}
if ($('whisperAutoToggle')) {
  $('whisperAutoToggle').checked = whisperAutoTranscribe;
  $('whisperAutoToggle').onchange = () => {
    whisperAutoTranscribe = $('whisperAutoToggle').checked;
    safeSetItem(WHISPER_AUTO_KEY, String(whisperAutoTranscribe));
  };
}
if ($('whisperPreloadBtn')) {
  $('whisperPreloadBtn').onclick = preloadSelectedWhisperModel;
}
if ($('whisperClearCacheBtn')) {
  $('whisperClearCacheBtn').onclick = async () => {
    if (!confirm('Clear downloaded Whisper weights and runtime cache (39–75 MB) from this device?')) return;
    await whisperCtrl.unload();
    const removed = await clearWhisperModelCache();
    await refreshWhisperCacheStatus();
    toast(removed ? 'Cleared cached Whisper models from this device' : 'No cached Whisper models found');
  };
}

function formatPatientLastFirst(rawName) {
  const clean = String(rawName || '').trim();
  if (!clean || clean === 'Unknown Patient') return '';
  if (clean.includes(',')) {
    const parts = clean.split(',');
    const last = parts[0].trim().toUpperCase();
    const rest = parts.slice(1).join(',').trim();
    return rest ? `${last}, ${rest}` : last;
  }
  const tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return clean.toUpperCase();
  const prev = tokens[tokens.length - 2].toLowerCase();
  if (tokens.length >= 3 && /^(?:dela|del|de|los|las|san|sta|santa|santo)$/i.test(prev)) {
    const last = `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}`.toUpperCase();
    const rest = tokens.slice(0, -2).join(' ');
    return rest ? `${last}, ${rest}` : last;
  }
  const last = tokens[tokens.length - 1].toUpperCase();
  const rest = tokens.slice(0, -1).join(' ');
  return `${last}, ${rest}`;
}

function redactStandingContext(standing, profile) {
  const safeStr = (val) => (val ? redact(String(val), profile).text : '');
  return {
    pe: safeStr(standing.pe),
    feeding: safeStr(standing.feeding),
    drips: safeStr(standing.drips),
    vent: safeStr(standing.vent),
    meds: (standing.meds || []).map(safeStr),
    onHold: (standing.onHold || []).map(safeStr),
    pending: (standing.pending || []).map(safeStr),
    subspecialtyPlans: (standing.subspecialtyPlans || []).map((sp) => ({
      heading: sp.heading,
      items: (sp.items || []).map(safeStr),
    })),
  };
}

async function fileVoiceBlockToChart(rawMarkdownBody, statusVerb) {
  const note = notes.find((n) => n.id === dictatingNoteId);
  if (!note) return;
  const dateStr = isoToMmDdYyyy($('voiceDateInput')?.value) || getTodayDateStrings().mmddyyyy;
  const effectiveShift = resolveModalShiftHeading(dictatingShift, 'voiceInterimTimeInput');
  const baseContent =
    currentMode === 'editor' && currentId === note.id ? $('noteText').value : note.content;
  note.content = appendShiftBlock(baseContent, effectiveShift, dateStr, rawMarkdownBody, null, {
    tightSeam: true,
  });
  note.updated = Date.now();
  await put(note);
  await refresh();

  if (currentId === note.id) {
    $('noteText').value = note.content;
    lastSavedChartContent = note.content;
    dirtyChart = false;
    updateSaveStatusPill('saved');
    if (editorViewMode === 'timeline') renderChartTimeline();
  }

  const check = verifyAppendedChart(note.content);
  if (!check.ok) {
    toast(`${statusVerb} — check seam warning: ${check.warnings[0]}`);
  } else {
    toast(`${statusVerb} to ${note.room || 'chart'} (${dateStr})`);
  }
  closeDictateModal(true);
}

$('voiceAppendRawBtn').onclick = async () => {
  const transcript = applyClinicalAsrCorrections($('voiceTranscript').value.trim());
  if (!transcript) return toast('Please speak or type some dictation first');
  await fileVoiceBlockToChart(`**Dictated Update:**\n${transcript}\n`, 'Appended raw dictation');
};

$('voiceFormatSoapBtn').onclick = async () => {
  const rawInput = $('voiceTranscript').value.trim();
  if (!rawInput) return toast('Please speak or type some dictation first');

  const note = notes.find((n) => n.id === dictatingNoteId);
  if (!note) return;

  const transcript = applyClinicalAsrCorrections(rawInput);
  if (transcript !== rawInput) {
    $('voiceTranscript').value = transcript;
  }

  if (navigator.onLine === false) {
    return toast('Offline — use Append Raw Note (AI formatting requires internet)');
  }

  const endpoint = $('endpoint').value.trim().replace(/\/$/, '') || safeGetItem('cm.endpoint', '');
  const model = $('model').value.trim() || safeGetItem('cm.model', '');
  const key = $('apiKey').value.trim();

  if (!endpoint || !model || !key) {
    return toast('Set endpoint, model and API key in Settings first (or use Append Raw)');
  }

  const sourceContent =
    currentMode === 'editor' && currentId === note.id ? $('noteText').value : note.content;
  const ptProfile = profileForNote(note);
  const parsedNote = parseChart(sourceContent, note);
  const redactedResult = redact(transcript, ptProfile);
  const standingRaw = extractStandingDictationContext(sourceContent);
  const standingRedacted = redactStandingContext(standingRaw, ptProfile);

  const leaks = [
    ...findLeaks(redactedResult.text, ptProfile),
    ...findLeaks(
      [
        standingRedacted.pe,
        standingRedacted.feeding,
        standingRedacted.drips,
        standingRedacted.vent,
        ...standingRedacted.meds,
        ...standingRedacted.onHold,
        ...standingRedacted.pending,
        ...standingRedacted.subspecialtyPlans.flatMap((sp) => sp.items),
      ].join('\n'),
      ptProfile
    ),
  ];
  const aiStatus = $('voiceAiStatus');

  if (leaks.length > 0) {
    if (aiStatus) {
      aiStatus.hidden = false;
      aiStatus.className = 'voice-ai-status error';
      aiStatus.textContent = `PHI Guard Blocked: "${leaks.map((l) => l.value).join(', ')}" detected in dictation — edit text before sending to AI.`;
    }
    return toast(`PHI Guard Blocked: ${leaks[0].value}`);
  }

  $('voiceFormatSoapBtn').disabled = true;
  $('voiceAppendRawBtn').disabled = true;
  if (aiStatus) {
    aiStatus.hidden = false;
    aiStatus.className = 'voice-ai-status';
    aiStatus.innerHTML = `<span>⏳ De-identifying &amp; formatting update with ${esc(model)}...</span>`;
  }

  stopRecordingTelegram();

  const dateStr = isoToMmDdYyyy($('voiceDateInput')?.value) || getTodayDateStrings().mmddyyyy;
  const effectiveShift = resolveModalShiftHeading(dictatingShift, 'voiceInterimTimeInput');
  const interimTimeLabel = formatInterimShiftLabel(
    new Date(),
    $('voiceInterimTimeInput')?.value || ''
  ).replace(/^Interim\s*\(|\)$/g, '');
  const headerFirstLine = String(templateConfig?.header || 'Good day team')
    .split('\n')[0]
    .replace(/\{\{\s*ap\s*\}\}/gi, parsedNote.ap || 'team')
    .trim();
  const signature = String(templateConfig?.footer || '').trim();
  const ageSex = [parsedNote.age, parsedNote.sex].filter(Boolean).join('/');
  const headerName = templateConfig?.showName !== false ? '[PATIENT_NAME]' : '';
  const idLine = [headerName, templateConfig?.showAgeSex !== false ? ageSex : '']
    .filter(Boolean)
    .join(' ');
  const patientHeaderLines = [];
  if (idLine) patientHeaderLines.push(idLine);
  if (templateConfig?.showRoom !== false && parsedNote.room && parsedNote.room !== 'Unassigned') {
    patientHeaderLines.push(parsedNote.room);
  }

  const promptContent = buildClinicalDictationAiPrompt({
    redactedTranscript: redactedResult.text,
    standingContext: standingRedacted,
    shift: effectiveShift,
    dateStr,
    interimTimeLabel,
    greeting: headerFirstLine,
    signature,
    patientHeaderLines,
  });

  try {
    const reply = await callAiChat({
      endpoint,
      model,
      apiKey: key,
      prompt: promptContent,
      temperature: 0.2,
    });

    const formattedLocalName = formatPatientLastFirst(parsedNote.name);
    const parsedAi = parseAiDictationResponse(reply, formattedLocalName);
    const peCarryResult =
      dictatingShift === 'interim'
        ? { noteBlock: parsedAi.noteBlock, carriedPe: false }
        : applyDictationPeCarryover(parsedAi.noteBlock, standingRaw.pe, transcript);
    const noteBlock = peCarryResult.noteBlock;
    const flags = parsedAi.flags;
    stagedVoiceSoap = noteBlock;
    if ($('voiceSoapPreviewText')) $('voiceSoapPreviewText').value = noteBlock;
    if ($('voiceSoapReviewBox')) $('voiceSoapReviewBox').hidden = false;
    if (aiStatus) {
      aiStatus.className = flags ? 'voice-ai-status warn' : 'voice-ai-status';
      aiStatus.textContent = flags
        ? `Verify flags before filing: ${flags}`
        : peCarryResult.carriedPe
          ? '✓ Staged clinical update below (PE carried over from prior shift) — verify numbers and tap File Update to Chart.'
          : '✓ Staged clinical update below — verify numbers and tap File Update to Chart.';
    }
  } catch (err) {
    if (aiStatus) {
      aiStatus.className = 'voice-ai-status error';
      aiStatus.textContent = `AI format error: ${err.message}`;
    }
    toast('AI format failed: ' + err.message);
  } finally {
    $('voiceFormatSoapBtn').disabled = false;
    $('voiceAppendRawBtn').disabled = false;
  }
};

if ($('voiceSoapRestoreBtn')) {
  $('voiceSoapRestoreBtn').onclick = () => {
    stagedVoiceSoap = '';
    if ($('voiceSoapReviewBox')) $('voiceSoapReviewBox').hidden = true;
    if ($('voiceSoapPreviewText')) $('voiceSoapPreviewText').value = '';
    if ($('voiceAiStatus')) $('voiceAiStatus').hidden = true;
    toast('Restored raw dictation view');
  };
}

if ($('voiceSoapConfirmBtn')) {
  $('voiceSoapConfirmBtn').onclick = async () => {
    const soapBody = ($('voiceSoapPreviewText')?.value || stagedVoiceSoap).trim();
    if (!soapBody) return toast('No SOAP text to file');
    await fileVoiceBlockToChart(soapBody, 'Formatted SOAP filed');
  };
}

// Shift Carry-Forward modal actions (Guided Entry + Raw Markdown)
if ($('shiftModeFormBtn')) $('shiftModeFormBtn').onclick = () => setShiftModalMode('form');
if ($('shiftModeRawBtn')) $('shiftModeRawBtn').onclick = () => setShiftModalMode('raw');
if ($('shiftEditTemplateLink')) {
  $('shiftEditTemplateLink').onclick = async () => {
    if (!closeShiftModal(false)) return;
    await setMode('settings');
    setSettingsTab('template');
  };
}

if ($('shiftPills')) {
  $('shiftPills').addEventListener('click', (e) => {
    const pill = e.target.closest('.shift-pill[data-shift]');
    if (!pill) return;
    const prevWasInterim = shiftingChoice === 'interim';
    shiftingChoice = pill.dataset.shift;
    const nowInterim = shiftingChoice === 'interim';

    $('shiftPills').querySelectorAll('.shift-pill').forEach((p) => {
      const active = p === pill;
      p.classList.toggle('active', active);
      p.setAttribute('aria-pressed', String(active));
    });
    syncModalInterimTimeUi(shiftingChoice, 'shiftInterimTimeWrap', 'shiftInterimTimeInput');
    syncShiftMergeCheckbox();
    const headingChoice = resolveModalShiftHeading(shiftingChoice, 'shiftInterimTimeInput');

    if (prevWasInterim !== nowInterim) {
      renderShiftGuidedForm();
    }

    if (shiftRawEdited) {
      const ta = $('shiftPreviewText');
      if (/^###\s+[^\n]+/.test(ta.value)) {
        ta.value = ta.value.replace(/^###\s+[^\n]+/, `### ${headingChoice}`);
      }
      toast(`Updated heading to ### ${headingChoice} (kept raw edits)`);
    } else {
      syncShiftPreviewFromForm({ forceRawUpdate: true });
    }
  });
}

if ($('shiftInterimTimeInput')) {
  $('shiftInterimTimeInput').addEventListener('input', () => {
    if (shiftingChoice !== 'interim') return;
    const headingChoice = resolveModalShiftHeading('interim', 'shiftInterimTimeInput');
    if (shiftRawEdited) {
      const ta = $('shiftPreviewText');
      if (/^###\s+[^\n]+/.test(ta.value)) {
        ta.value = ta.value.replace(/^###\s+[^\n]+/, `### ${headingChoice}`);
      }
    } else {
      syncShiftPreviewFromForm({ forceRawUpdate: true });
    }
  });
}

if ($('shiftPreviewText')) {
  $('shiftPreviewText').oninput = () => {
    shiftPreviewDirty = true;
    shiftRawEdited = true;
  };
}
if ($('shiftDateYesterdayBtn')) {
  $('shiftDateYesterdayBtn').onclick = () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    $('shiftDateInput').value = getTodayDateStrings(y).yyyymmdd;
    syncShiftMergeCheckbox();
    if (!shiftRawEdited) syncShiftPreviewFromForm({ forceRawUpdate: true });
  };
}
if ($('shiftDateInput')) {
  $('shiftDateInput').onchange = () => {
    syncShiftMergeCheckbox();
    if (!shiftRawEdited) syncShiftPreviewFromForm({ forceRawUpdate: true });
  };
}
['cfPending', 'cfServicePlans', 'cfStanding', 'cfPe'].forEach((id) => {
  if ($(id)) $(id).onchange = () => applyCarryForwardToggleToShiftForm(id);
});

$('shiftModalClose').onclick = () => closeShiftModal(false);
$('shiftAppendStayBtn').onclick = () => commitShiftBlock(false);
$('shiftAppendEditBtn').onclick = () => commitShiftBlock(true);

// End-of-Shift Handover modal actions
$('handoverModalClose').onclick = closeHandoverModal;
if ($('handoverDateInput')) $('handoverDateInput').onchange = rebuildHandoverReport;
if ($('handoverYesterdayBtn')) {
  $('handoverYesterdayBtn').onclick = () => {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    $('handoverDateInput').value = getTodayDateStrings(y).yyyymmdd;
    rebuildHandoverReport();
  };
}
if ($('handoverScopeSelect')) $('handoverScopeSelect').onchange = rebuildHandoverReport;
if ($('hoShowVitalsLabs')) $('hoShowVitalsLabs').onchange = rebuildHandoverReport;
if ($('hoShowResolved')) $('hoShowResolved').onchange = rebuildHandoverReport;

$('handoverToggleDeidBtn').onclick = () => {
  handoverViewingDeid = !handoverViewingDeid;
  renderHandoverPreview();
};

$('copyHandoverBtn').onclick = async () => {
  if (handoverViewingDeid) return toast('Switch back to Raw view to copy unredacted handover');
  await copyTextWithFallback(
    formatHandoverPlainText(currentHandoverRaw),
    '⚠️ Raw handover copied to clipboard',
    'Copy Raw Handover'
  );
};

$('copyHandoverDeidBtn').onclick = async () => {
  handoverViewingDeid = true;
  renderHandoverPreview();
  const plain = formatHandoverPlainText(currentHandoverRaw);
  const { text, leaks } = deidentifyHandoverText(plain, notes);
  if (leaks.length > 0) {
    return toast(`PHI Guard Blocked: ${leaks.map((l) => l.value).join(', ')}`);
  }
  await copyTextWithFallback(
    text,
    '🛡️ De-identified handover copied (PHI cleared, rooms retained)',
    'Copy De-identified Handover'
  );
};

$('exportHandoverBtn').onclick = async () => {
  const dateTag = currentHandoverDate || getTodayDateStrings().mmddyyyy;
  if (handoverViewingDeid) {
    const { text, leaks } = deidentifyHandoverText(currentHandoverRaw, notes);
    if (leaks.length > 0) {
      return toast(`Export blocked: PHI leak (${leaks[0].value})`);
    }
    const filename = `handover-deidentified-${dateTag}.md`;
    const shared = await shareOrDownload({
      filename,
      text,
      mimeType: 'text/markdown',
      title: `Handover (De-identified) ${dateTag}`,
      allowTextShare: true,
    });
    if (shared) toast(`Exported de-identified ${filename}`);
    return;
  }
  const filename = `handover-${dateTag}.md`;
  const shared = await shareOrDownload({
    filename,
    text: currentHandoverRaw,
    mimeType: 'text/markdown',
    title: `Handover (Raw PHI) ${dateTag}`,
  });
  if (shared) toast(`Exported raw ${filename}`);
};

// Settings page: Visual Default Update Template Builder actions
$('tplHeaderInput').oninput = () => {
  if (!confirmVisualOverwriteOfRawOverride()) {
    $('tplHeaderInput').value = templateConfig.header || '';
    return;
  }
  templateConfig.header = $('tplHeaderInput').value;
  setTemplateDirty(true);
  updateTemplateLivePreview();
};
$('tplFooterInput').oninput = () => {
  if (!confirmVisualOverwriteOfRawOverride()) {
    $('tplFooterInput').value = templateConfig.footer || '';
    return;
  }
  templateConfig.footer = $('tplFooterInput').value;
  const clin = extractFooterClinicianFields(templateConfig.footer);
  if ($('tplClinicianName')) $('tplClinicianName').value = clin.name === '[Your Name]' ? '' : clin.name;
  if ($('tplClinicianService')) $('tplClinicianService').value = clin.service === '[Service / Hospital]' ? '' : clin.service;
  setTemplateDirty(true);
  updateTemplateLivePreview();
};
['tplClinicianName', 'tplClinicianService'].forEach((id) => {
  if ($(id)) {
    $(id).oninput = () => {
      if (!confirmVisualOverwriteOfRawOverride()) return;
      updateClinicianFooterFieldsInConfig();
      setTemplateDirty(true);
      updateTemplateLivePreview();
    };
  }
});
$('tplShowName').onchange = () => {
  if (!confirmVisualOverwriteOfRawOverride()) {
    $('tplShowName').checked = templateConfig.showName !== false;
    return;
  }
  templateConfig.showName = $('tplShowName').checked;
  setTemplateDirty(true);
  updateTemplateLivePreview();
};
$('tplShowAgeSex').onchange = () => {
  if (!confirmVisualOverwriteOfRawOverride()) {
    $('tplShowAgeSex').checked = templateConfig.showAgeSex !== false;
    return;
  }
  templateConfig.showAgeSex = $('tplShowAgeSex').checked;
  setTemplateDirty(true);
  updateTemplateLivePreview();
};
$('tplShowRoom').onchange = () => {
  if (!confirmVisualOverwriteOfRawOverride()) {
    $('tplShowRoom').checked = templateConfig.showRoom !== false;
    return;
  }
  templateConfig.showRoom = $('tplShowRoom').checked;
  setTemplateDirty(true);
  updateTemplateLivePreview();
};
$('defaultTemplateInput').oninput = () => {
  rawTemplateDirty = true;
  setTemplateDirty(true);
  updateTemplateLivePreview();
};

$('loadMorningTemplateBtn').onclick = () => {
  if (!confirmVisualOverwriteOfRawOverride()) return;
  templateConfig = normalizeTemplateSections(MORNING_TEMPLATE_CONFIG);
  setTemplateDirty(true);
  renderTemplateBuilder();
  toast('Loaded Morning Update preset — tap Save Template to apply');
};

$('resetTemplateBtn').onclick = () => {
  if (!confirm('Reset the default update template back to Standard?')) return;
  const prevRaw = getSavedUpdateTemplate();
  const prevCfg = safeGetItem(TEMPLATE_CONFIG_KEY, '');
  const prevState = cloneConfig(templateConfig);
  const prevRawDirty = rawTemplateDirty;

  safeRemoveItem(TEMPLATE_KEY);
  safeRemoveItem(TEMPLATE_CONFIG_KEY);
  templateConfig = normalizeTemplateSections(DEFAULT_TEMPLATE_CONFIG);
  rawTemplateDirty = false;
  setTemplateDirty(false);
  renderTemplateBuilder();
  toast('Reset to standard shift block', {
    onUndo: () => {
      if (prevCfg) safeSetItem(TEMPLATE_CONFIG_KEY, prevCfg);
      if (prevRaw) safeSetItem(TEMPLATE_KEY, prevRaw);
      templateConfig = prevState;
      rawTemplateDirty = prevRawDirty;
      renderTemplateBuilder();
      toast('Template restored');
    },
  });
};

$('saveTemplateBtn').onclick = () => {
  const val = rawTemplateDirty
    ? $('defaultTemplateInput').value
    : compileTemplateConfig(templateConfig);
  if (!rawTemplateDirty) {
    safeSetItem(TEMPLATE_CONFIG_KEY, JSON.stringify(templateConfig));
  } else {
    safeRemoveItem(TEMPLATE_CONFIG_KEY);
  }
  if (val.trim()) {
    safeSetItem(TEMPLATE_KEY, val);
  } else {
    safeRemoveItem(TEMPLATE_KEY);
  }
  setTemplateDirty(false);
  toast('Default update template saved locally');
};

// Dump-to-Chart Inbox modal actions
inboxItems = loadInbox();
$('inboxModalClose').onclick = () => closeInboxModal(false);
$('inboxPasteInput').oninput = () => {
  if ($('inboxPasteInput').value.trim()) {
    inboxSelectedQueueId = null;
    if (!inboxPinnedNoteId) inboxUserSelectedTarget = false;
    renderInboxQueue();
  }
  updateInboxDryRun();
};
$('inboxCaptureBtn').onclick = () => captureToInbox($('inboxPasteInput').value);
$('inboxSampleBtn').onclick = () => {
  const sampleText =
    '[11/23/2026, 09:15] RN Ana: Good day doc, relaying stat labs for Room 412 Juan B. Dela Cruz:\nNa 132\nK 5.3\nCr 1.6\nWBC 14.8';
  captureToInbox(sampleText);
};
$('inboxClearFiledBtn').onclick = () => {
  inboxItems = inboxItems.filter((x) => x.status !== 'filed');
  if (inboxSelectedQueueId && !inboxItems.some((x) => x.id === inboxSelectedQueueId)) {
    inboxSelectedQueueId = null;
  }
  saveInbox();
  updateInboxBadge();
  renderInboxQueue();
  updateInboxDryRun();
  toast('Cleared filed inbox items');
};
$('inboxTargetSelect').onchange = () => {
  inboxUserSelectedTarget = Boolean($('inboxTargetSelect').value);
  inboxPinnedNoteId = null;
  updateInboxDryRun();
};
$('inboxModeLabs').onclick = () => {
  inboxMode = 'labs';
  $('inboxModeLabs').classList.add('active');
  $('inboxModeLabs').setAttribute('aria-pressed', 'true');
  $('inboxModeRelay').classList.remove('active');
  $('inboxModeRelay').setAttribute('aria-pressed', 'false');
  updateInboxDryRun();
};
$('inboxModeRelay').onclick = () => {
  inboxMode = 'relay';
  $('inboxModeRelay').classList.add('active');
  $('inboxModeRelay').setAttribute('aria-pressed', 'true');
  $('inboxModeLabs').classList.remove('active');
  $('inboxModeLabs').setAttribute('aria-pressed', 'false');
  updateInboxDryRun();
};
if ($('inboxShiftPills')) {
  $('inboxShiftPills').addEventListener('click', (e) => {
    const pill = e.target.closest('.shift-pill[data-shift]');
    if (!pill) return;
    inboxShift = pill.dataset.shift;
    $('inboxShiftPills').querySelectorAll('.shift-pill').forEach((p) => {
      const active = p === pill;
      p.classList.toggle('active', active);
      p.setAttribute('aria-pressed', String(active));
    });
    syncModalInterimTimeUi(inboxShift, 'inboxInterimTimeWrap', 'inboxInterimTimeInput');
  });
}
$('inboxLabStyleToggle').onchange = updateInboxDryRun;
if ($('inboxIncludeNarrative')) $('inboxIncludeNarrative').onchange = updateInboxDryRun;

$('inboxCopyRelayBtn').onclick = async () => {
  const targetNote = notes.find((n) => n.id === $('inboxTargetSelect').value);
  if (!targetNote) return toast('Select a target patient first');
  const trended =
    lastInboxTrended ||
    buildTrendedLabs(stripChatPrefixes($('inboxDryRunPreview').value), targetNote.content);
  const footerText = extractRelayFooterText();
  const relayMsg = trended.entries.length
    ? buildLabRelayMessage(trended, targetNote, footerText)
    : $('inboxDryRunPreview').value.trim();
  if (!relayMsg) return toast('Nothing to copy');
  await copyTextWithFallback(relayMsg, 'Lab relay copied to clipboard', 'Copy Lab Relay');
};

$('inboxFileBtn').onclick = async () => {
  const targetId = $('inboxTargetSelect').value;
  const targetNote = notes.find((n) => n.id === targetId);
  if (!targetNote) {
    return toast('Confirm or select a target patient chart first');
  }
  const dryRunBody = $('inboxDryRunPreview').value.trim();
  if (!dryRunBody) {
    return toast('Nothing to file — paste labs or switch to Raw Chat Relay');
  }

  const baseContent =
    currentMode === 'editor' && currentId === targetNote.id
      ? $('noteText').value
      : targetNote.content;

  const dateStr = isoToMmDdYyyy($('inboxDateInput')?.value) || getTodayDateStrings().mmddyyyy;
  const effectiveShift = resolveModalShiftHeading(inboxShift, 'inboxInterimTimeInput');
  const mergeExistingShift = inboxShift !== 'interim' && ($('inboxMergeExisting') ? $('inboxMergeExisting').checked : true);

  targetNote.content = appendShiftBlock(baseContent, effectiveShift, dateStr, dryRunBody, null, {
    mergeExistingShift,
  });
  targetNote.updated = Date.now();
  await put(targetNote);

  if (inboxSelectedQueueId) {
    const item = inboxItems.find((x) => x.id === inboxSelectedQueueId);
    if (item) {
      item.status = 'filed';
      item.resolvedNoteId = targetNote.id;
    }
    // Auto-advance selection to the next unfiled queue item
    const nextUnfiled = inboxItems.find((x) => x.id !== inboxSelectedQueueId && x.status !== 'filed');
    inboxSelectedQueueId = nextUnfiled ? nextUnfiled.id : null;
    inboxUserSelectedTarget = false;
  } else if ($('inboxPasteInput').value.trim()) {
    inboxItems.unshift({
      id: uid(),
      rawText: $('inboxPasteInput').value.trim(),
      status: 'filed',
      resolvedNoteId: targetNote.id,
      createdAt: Date.now(),
    });
    $('inboxPasteInput').value = '';
  }

  saveInbox();
  updateInboxBadge();
  await refresh();

  if (currentId === targetNote.id) {
    $('noteText').value = targetNote.content;
    lastSavedChartContent = targetNote.content;
    dirtyChart = false;
    updateSaveStatusPill('saved');
    if (editorViewMode === 'timeline') renderChartTimeline();
  }

  renderInboxQueue();
  updateInboxDryRun();
  toast(`Filed to ${targetNote.room || targetNote.title} (${dateStr})`);
};

// Clinical Calculators & Safety Audit modal actions
$('calcModalClose').onclick = closeCalcModal;
$('calcTabAudit').onclick = () => setCalcTab('audit');
$('calcTabDrip').onclick = () => setCalcTab('drip');

$('calcPatientSelect').onchange = () => {
  calcNoteId = $('calcPatientSelect').value;
  $('calcOverrideAge').value = '';
  $('calcOverrideSex').value = '';
  $('calcOverrideWeight').value = '';
  $('calcOverrideCr').value = '';
  $('calcQuickWeightInput').value = '';
  const note = notes.find((n) => n.id === calcNoteId) || null;
  syncDripFromChart(note);
  renderAuditPane();
  renderDripCalculator();
};

$('calcQuickWeightSaveBtn').onclick = async () => {
  const note = notes.find((n) => n.id === calcNoteId);
  if (!note) return toast('Select a patient chart first');
  const wtVal = $('calcQuickWeightInput').value.trim();
  const numWt = parseFloat(wtVal);
  if (!Number.isFinite(numWt) || numWt < 1 || numWt > 400) {
    return toast('Enter a valid weight in kg (1–400)');
  }
  const baseContent = getActiveCalcNoteContent(note);
  note.content = syncFrontmatter(baseContent, { weight: String(numWt) });
  note.updated = Date.now();
  await put(note);
  await refresh();

  if (currentId === note.id) {
    $('noteText').value = note.content;
    lastSavedChartContent = note.content;
    populateProfileInputs(note, note.content, true);
    if (editorViewMode === 'timeline') renderChartTimeline();
  }
  $('dripWeightInput').value = String(numWt);
  $('calcQuickWeightInput').value = '';
  renderAuditPane();
  renderDripCalculator();
  toast(`Saved ${numWt} kg to chart`);
};

$('calcQuickWeightInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('calcQuickWeightSaveBtn').click();
  }
});

if ($('calcSaveProfileOverridesBtn')) {
  $('calcSaveProfileOverridesBtn').onclick = async () => {
    const note = notes.find((n) => n.id === calcNoteId);
    if (!note) return toast('Select a patient chart first');
    const age = $('calcOverrideAge').value.trim();
    const sex = $('calcOverrideSex').value.trim();
    const weight = $('calcOverrideWeight').value.trim();
    const updates = {};
    if (age) updates.age = age;
    if (sex) updates.sex = sex;
    if (weight) updates.weight = weight;
    if (!Object.keys(updates).length) {
      return toast('Enter Age, Sex, or Weight in the inputs above first');
    }
    const baseContent = getActiveCalcNoteContent(note);
    note.content = syncFrontmatter(baseContent, updates);
    note.updated = Date.now();
    await put(note);
    await refresh();
    if (currentId === note.id) {
      $('noteText').value = note.content;
      lastSavedChartContent = note.content;
      populateProfileInputs(note, note.content, true);
      if (editorViewMode === 'timeline') renderChartTimeline();
    }
    if (weight) $('dripWeightInput').value = weight;
    $('calcOverrideAge').value = '';
    $('calcOverrideSex').value = '';
    $('calcOverrideWeight').value = '';
    renderAuditPane();
    renderDripCalculator();
    toast('Saved profile inputs to patient chart');
  };
}

['calcOverrideAge', 'calcOverrideSex', 'calcOverrideWeight', 'calcOverrideCr', 'calcNewDrugInput'].forEach((id) => {
  $(id).oninput = () => {
    if (id === 'calcOverrideWeight' && $('calcOverrideWeight').value.trim()) {
      $('dripWeightInput').value = $('calcOverrideWeight').value.trim();
      renderDripCalculator();
    }
    renderAuditPane();
  };
  $(id).onchange = renderAuditPane;
});

function updateCalcIoResult() {
  const unit = $('calcIoUnit')?.value || 'ml';
  const inVal = formatIoWithUnit($('calcIoIn')?.value, unit);
  const outVal = formatIoWithUnit($('calcIoOut')?.value, unit);
  const fb = inVal && outVal ? computeShiftFluidBalance(inVal, outVal) : '';
  if ($('calcIoResult')) $('calcIoResult').value = fb || (inVal || outVal ? 'Check inputs/units' : '');
}

['calcIoIn', 'calcIoOut'].forEach((id) => {
  if ($(id)) $(id).oninput = updateCalcIoResult;
});
if ($('calcIoUnit')) $('calcIoUnit').onchange = updateCalcIoResult;

$('calcResetOverridesBtn').onclick = () => {
  $('calcOverrideAge').value = '';
  $('calcOverrideSex').value = '';
  $('calcOverrideWeight').value = '';
  $('calcOverrideCr').value = '';
  const note = notes.find((n) => n.id === calcNoteId) || null;
  const inputs = extractClinicalInputs(getActiveCalcNoteContent(note), note || {});
  $('dripWeightInput').value = inputs.weight?.valueKg ? String(inputs.weight.valueKg) : '';
  renderAuditPane();
  renderDripCalculator();
};

$('dripPresetSelect').onchange = () => {
  calcUserTouchedDrip = true;
  applyDripPreset($('dripPresetSelect').value);
  renderDripCalculator();
};
$('dripModeRateBtn').onclick = () => {
  calcUserTouchedDrip = true;
  setDripMode('rate2dose');
};
$('dripModeDoseBtn').onclick = () => {
  calcUserTouchedDrip = true;
  setDripMode('dose2rate');
};

[
  'dripDrugNameInput',
  'dripAmountInput',
  'dripUnitSelect',
  'dripBagVolInput',
  'dripRateInput',
  'dripTargetDoseInput',
  'dripTargetUnitSelect',
  'dripWeightInput',
  'dripPlanHoursInput',
].forEach((id) => {
  $(id).oninput = () => {
    calcUserTouchedDrip = true;
    renderDripCalculator();
  };
  $(id).onchange = () => {
    calcUserTouchedDrip = true;
    renderDripCalculator();
  };
});

$('calcCopySummaryBtn').onclick = async () => {
  const txt = buildDeidCalcSummaryText();
  await copyTextWithFallback(
    txt,
    'De-identified calculation summary copied',
    'Copy Calculation Summary'
  );
};

if ($('calcInsertChartBtn')) {
  $('calcInsertChartBtn').onclick = async () => {
    const note = notes.find((n) => n.id === calcNoteId);
    if (!note) return toast('Select a target patient chart first');

    const lines = [];
    if (calcActiveTab === 'drip') {
      const drip = lastDripResult;
      if (!drip || drip.error) return toast('Configure a valid drip calculation first');
      const doseTxt =
        drip.mcgPerKgPerMin !== null
          ? `${drip.mcgPerKgPerMin} mcg/kg/min`
          : drip.unitsPerKgPerHr !== null
            ? `${drip.unitsPerKgPerHr} units/kg/hr`
            : `${drip.dosePerHour} ${drip.drugUnit}/hr`;
      lines.push(`Drips: ${drip.drugName} @ ${doseTxt} (${drip.rateMlPerHr} mL/hr · ${drip.totalDrugAmount}${drip.drugUnit}/${drip.bagVolumeMl}mL)`);
      if (drip.shortfallMessage) lines.push(`Drip Bag Check: ${drip.shortfallMessage}`);
    } else {
      const audit = lastAuditResult;
      if (!audit) return toast('No audit results available');
      const { renal } = audit;
      const calcLines = [];
      if (renal.egfr?.status === 'OK') {
        calcLines.push(`CKD-EPI eGFR (CALCULATED): ${renal.egfr.value} ${renal.egfr.unit} [${renal.egfr.inputsSummary}]`);
      }
      if (renal.crcl?.status === 'OK') {
        calcLines.push(`Cockcroft-Gault CrCl (CALCULATED): ${renal.crcl.value} ${renal.crcl.unit} [${renal.crcl.inputsSummary}]`);
      }
      if (!calcLines.length) {
        return toast('Cannot insert missing renal estimates — enter Age, Sex, Weight, or SCr first');
      }
      lines.push(...calcLines);
    }

    const baseContent = getActiveCalcNoteContent(note);
    const parsedChart = parseChart(baseContent, note);
    const shift =
      parsedChart.isUpdatedToday && parsedChart.latestShift
        ? parsedChart.latestShift
        : defaultShiftForHour();
    const targetDate = parsedChart.isUpdatedToday
      ? parsedChart.latestDate
      : getDutyDateStrings().mmddyyyy;
    note.content = appendShiftBlock(baseContent, shift, targetDate, lines.join('\n'), null, {
      mergeExistingShift: true,
    });
    note.updated = Date.now();
    await put(note);
    await refresh();
    if (currentId === note.id) {
      $('noteText').value = note.content;
      lastSavedChartContent = note.content;
      if (editorViewMode === 'timeline') renderChartTimeline();
    }
    toast(`Inserted into ${note.room || note.title} (${shift})`);
  };
}

$('calcSaveNoteBtn').onclick = () => {
  const drip = lastDripResult;
  if (!drip || drip.error) {
    return toast('Configure a valid drip calculation first');
  }
  const body = [
    `Mix: ${drip.totalDrugAmount} ${drip.drugUnit} in ${drip.bagVolumeMl} mL (${drip.concentrationPerMl} ${drip.drugUnit}/mL)`,
    `Rate: ${drip.rateMlPerHr} mL/hr -> ${drip.dosePerHour} ${drip.drugUnit}/hr`,
    drip.mcgPerKgPerMin !== null
      ? `Dose (${drip.weightUsed}): ${drip.mcgPerKgPerMin} mcg/kg/min`
      : drip.unitsPerKgPerHr !== null
        ? `Dose (${drip.weightUsed}): ${drip.unitsPerKgPerHr} units/kg/hr`
        : drip.weightNotice,
    `Runout: ${drip.bagRunoutText}${drip.shortfallMessage ? ` | ${drip.shortfallMessage}` : ''}`,
  ].join('\n');

  scratchNotes.unshift({
    id: uid(),
    title: `Drip Calc: ${drip.drugName}`,
    category: 'Drips',
    pinned: false,
    body,
    updated: Date.now(),
  });
  saveScratchNotes();
  if (currentMode === 'scratch') renderScratchNotes();
  toast('De-identified drip calculation saved to Notes');
};

if ($('manualCopyCloseBtn')) $('manualCopyCloseBtn').onclick = () => closeModalEl($('manualCopyModal'));
if ($('manualCopyDoneBtn')) $('manualCopyDoneBtn').onclick = () => closeModalEl($('manualCopyModal'));
if ($('manualCopySelectBtn')) {
  $('manualCopySelectBtn').onclick = () => {
    const ta = $('manualCopyText');
    if (!ta) return;
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
  };
}

/* ---------- admit / edit admitting history modal ---------- */
let admitModalMode = 'new';
let admitEditingNoteId = null;
let admitActiveTab = 'manual';
let admitSelectedCategories = [];
let admitRecBlob = null;
let admitRecPcm16k = null;
let admitAudioToken = 0;
let lastAdmitTranscribedKey = '';
let admitRecAudioUrl = null;
let admitIsStartingRec = false;

const admitRecorder = createUniversalAudioRecorder({
  onError: () => {
    stopAdmitAudioRecording();
    updateAdmitWhisperStatus();
  },
});

const SAMPLE_ADMITTING_NOTE = `Chief Complaint: Progressive shortness of breath and bipedal edema x 3 days
History of Present Illness: 64-year-old female with progressive dyspnea on exertion, orthopnea (3 pillows), and PND over 3 days. Associated with productive cough with whitish sputum. No chest pain, fever, or hemoptysis.
Past Medical History: Hypertensive for 10 years (on Losartan 50mg OD), Diabetes Mellitus (for 6 years, on Metformin), previous hospitalization for community-acquired pneumonia in 2023. Non-asthmatic, no known CAD. NKDA.
Family History: (+) HTN mother, (+) T2DM sister
Personal and Social History: Non-smoker, non-alcoholic beverage drinker, retired teacher
Physical Examination:
BP 150/90 HR 98 RR 24 Temp 36.8C O2sat 92% on RA
Awake, alert, in mild tachypnea; JVP elevated at 8 cmH2O; bibasal fine crackles on auscultation; S1/S2 distinct, no murmurs; soft abdomen; Grade 2 pitting bipedal edema
Admitting Impression: Acute Decompensated Heart Failure (ADHF); Hypertensive Cardiovascular Disease; Type 2 Diabetes Mellitus
Plan of Care:
- Admit to medicine ward, head of bed 45 degrees, O2 via nasal cannula 2 LPM to keep SpO2 >= 94%
- IV Furosemide 40 mg IV now then q12h; strict I&O monitoring qShift
- Request 12-lead ECG, CXR PA, CBC, Na/K/Cr, HbA1c, Pro-BNP, and 2D-Echo
- Continue Losartan 50 mg PO OD; hold Metformin temporarily while assessing renal function`;

function setAdmitTab(tab = 'manual') {
  admitActiveTab = tab;
  const map = [
    ['manual', 'admitTabManual', 'admitManualPane'],
    ['paste', 'admitTabPaste', 'admitPastePane'],
    ['dictate', 'admitTabDictate', 'admitDictatePane'],
  ];
  for (const [key, tabId, paneId] of map) {
    const active = key === tab;
    if ($(tabId)) {
      $(tabId).classList.toggle('active', active);
      $(tabId).setAttribute('aria-pressed', String(active));
    }
    if ($(paneId)) $(paneId).hidden = !active;
  }
}

function updateAdmitWhisperStatus(customText = null) {
  const pill = $('admitWhisperStatus');
  if (!pill) return;
  if (customText) {
    pill.textContent = customText;
    pill.className = 'pill';
    return;
  }
  const st = whisperCtrl.getState();
  const isLoaded = st.loadedModels.includes(selectedWhisperModel);
  const isCached = cachedWhisperModels.has(selectedWhisperModel);
  if (admitRecorder.isRecording()) {
    pill.textContent = 'RECORDING';
    pill.className = 'pill block';
  } else if (st.status === 'transcribing') {
    pill.textContent = 'TRANSCRIBING...';
    pill.className = 'pill safe';
  } else if (isLoaded) {
    pill.textContent = 'WHISPER READY';
    pill.className = 'pill safe';
  } else if (isCached && cachedWhisperRuntimeReady) {
    pill.textContent = 'WHISPER CACHED';
    pill.className = 'pill safe';
  } else {
    pill.textContent = 'MIC / KEYBOARD READY';
    pill.className = 'pill';
  }
}

function renderAdmitCategoryPills() {
  const host = $('admitCategoryPills');
  const wrap = $('admitCategoryWrap');
  if (!host || !wrap) return;
  const allCats = dedupeCategoryList([...customCategories, ...admitSelectedCategories]);
  wrap.hidden = allCats.length === 0;
  host.innerHTML = allCats
    .map((cat) => {
      const checked = admitSelectedCategories.some((c) => c.toLowerCase() === cat.toLowerCase());
      return `<label class="tpl-id-chip"><input type="checkbox" class="admit-cat-check" data-cat="${esc(cat)}" ${
        checked ? 'checked' : ''
      }><span>${esc(cat)}</span></label>`;
    })
    .join('');
  host.querySelectorAll('.admit-cat-check').forEach((chk) => {
    chk.onchange = () => {
      const cat = chk.dataset.cat;
      const lower = cat.toLowerCase();
      if (chk.checked) {
        if (!admitSelectedCategories.some((c) => c.toLowerCase() === lower)) {
          admitSelectedCategories.push(cat);
        }
      } else {
        admitSelectedCategories = admitSelectedCategories.filter((c) => c.toLowerCase() !== lower);
      }
    };
  });
}

function syncAdmitPmhInputs() {
  if ($('admitPmhHtnDur')) $('admitPmhHtnDur').disabled = !Boolean($('admitPmhHtn')?.checked);
  if ($('admitPmhDmDur')) $('admitPmhDmDur').disabled = !Boolean($('admitPmhDm')?.checked);
  if ($('admitPmhPrevHospReason')) {
    $('admitPmhPrevHospReason').disabled = !Boolean($('admitPmhPrevHosp')?.checked);
  }
}

function populateAdmitForm(rawData) {
  const d = {
    ...createEmptyAdmittingHistory(),
    ...(rawData || {}),
    pmh: { ...createEmptyAdmittingHistory().pmh, ...(rawData?.pmh || {}) },
    vitals: { ...createEmptyAdmittingHistory().vitals, ...(rawData?.vitals || {}) },
  };
  $('admitCc').value = d.chiefComplaint || '';
  $('admitHpi').value = d.hpi || '';
  $('admitPmhHtn').checked = Boolean(d.pmh.htn);
  $('admitPmhHtnDur').value = d.pmh.htnDuration || '';
  $('admitPmhDm').checked = Boolean(d.pmh.dm);
  $('admitPmhDmDur').value = d.pmh.dmDuration || '';
  $('admitPmhBa').checked = Boolean(d.pmh.ba);
  $('admitPmhCad').checked = Boolean(d.pmh.cad);
  $('admitPmhPrevHosp').checked = Boolean(d.pmh.prevHosp);
  $('admitPmhPrevHospReason').value = d.pmh.prevHospReason || '';
  $('admitPmhOther').value = d.pmh.other || '';
  $('admitFh').value = d.familyHistory || '';
  $('admitPsh').value = d.psh || '';
  $('admitVsSbp').value = d.vitals.sbp || '';
  $('admitVsDbp').value = d.vitals.dbp || '';
  $('admitVsHr').value = d.vitals.hr || '';
  $('admitVsRr').value = d.vitals.rr || '';
  $('admitVsTemp').value = d.vitals.temp || '';
  $('admitVsO2').value = d.vitals.o2 || '';
  $('admitPe').value = d.pe || '';
  $('admitImpression').value = d.admittingImpression || '';
  $('admitPlan').value = d.planOfCare || '';
  syncAdmitPmhInputs();
}

function readAdmitForm() {
  return {
    chiefComplaint: $('admitCc').value.trim(),
    hpi: $('admitHpi').value.trim(),
    pmh: {
      htn: Boolean($('admitPmhHtn').checked),
      htnDuration: $('admitPmhHtnDur').value.trim(),
      dm: Boolean($('admitPmhDm').checked),
      dmDuration: $('admitPmhDmDur').value.trim(),
      ba: Boolean($('admitPmhBa').checked),
      cad: Boolean($('admitPmhCad').checked),
      prevHosp: Boolean($('admitPmhPrevHosp').checked),
      prevHospReason: $('admitPmhPrevHospReason').value.trim(),
      other: $('admitPmhOther').value.trim(),
    },
    familyHistory: $('admitFh').value.trim(),
    psh: $('admitPsh').value.trim(),
    vitals: {
      sbp: $('admitVsSbp').value.trim(),
      dbp: $('admitVsDbp').value.trim(),
      hr: $('admitVsHr').value.trim(),
      rr: $('admitVsRr').value.trim(),
      temp: $('admitVsTemp').value.trim(),
      o2: $('admitVsO2').value.trim(),
    },
    pe: $('admitPe').value.trim(),
    admittingImpression: $('admitImpression').value.trim(),
    planOfCare: $('admitPlan').value.trim(),
  };
}

async function stopAdmitAudioRecording() {
  if ($('admitStartRecBtn')) $('admitStartRecBtn').hidden = false;
  if ($('admitStopRecBtn')) $('admitStopRecBtn').hidden = true;
  if (!admitRecorder.isRecording()) return;

  const res = await admitRecorder.stop();
  if (!res.blob || res.isEmpty) {
    toast('No sound captured — check mic permission and tap Record Audio again');
    updateAdmitWhisperStatus();
    return;
  }
  admitRecBlob = res.blob;
  admitRecPcm16k = res.pcm16k || null;
  admitAudioToken++;
  lastAdmitTranscribedKey = '';
  if (admitRecAudioUrl) {
    try { URL.revokeObjectURL(admitRecAudioUrl); } catch {}
  }
  admitRecAudioUrl = URL.createObjectURL(admitRecBlob);
  if ($('admitAudioPlayer')) {
    $('admitAudioPlayer').src = admitRecAudioUrl;
    try { $('admitAudioPlayer').load(); } catch {}
  }
  if ($('admitAudioWrap')) $('admitAudioWrap').hidden = false;
  if ($('admitWhisperTranscribeBtn')) $('admitWhisperTranscribeBtn').hidden = false;
  updateAdmitWhisperStatus();

  const isCachedOrLoaded =
    whisperCtrl.getState().loadedModels.includes(selectedWhisperModel) ||
    (cachedWhisperModels.has(selectedWhisperModel) && cachedWhisperRuntimeReady);
  if (whisperAutoTranscribe && isCachedOrLoaded) {
    $('admitWhisperTranscribeBtn')?.click();
  }
}

function clearAdmitAudioRecording() {
  admitRecorder.cancel();
  admitRecBlob = null;
  admitRecPcm16k = null;
  lastAdmitTranscribedKey = '';
  if (admitRecAudioUrl) {
    try { URL.revokeObjectURL(admitRecAudioUrl); } catch {}
    admitRecAudioUrl = null;
  }
  if ($('admitAudioPlayer')) {
    $('admitAudioPlayer').removeAttribute('src');
    try { $('admitAudioPlayer').load(); } catch {}
  }
  if ($('admitAudioWrap')) $('admitAudioWrap').hidden = true;
  if ($('admitWhisperTranscribeBtn')) $('admitWhisperTranscribeBtn').hidden = true;
  if ($('admitStartRecBtn')) $('admitStartRecBtn').hidden = false;
  if ($('admitStopRecBtn')) $('admitStopRecBtn').hidden = true;
}

function openAdmitModal({ mode = 'new', noteId = null, triggerEl = null } = {}) {
  admitModalMode = mode === 'edit' ? 'edit' : 'new';
  admitEditingNoteId = admitModalMode === 'edit' ? noteId : null;
  clearAdmitAudioRecording();
  if ($('admitPasteInput')) $('admitPasteInput').value = '';
  if ($('admitDictateTranscript')) $('admitDictateTranscript').value = '';

  const today = getTodayDateStrings().mmddyyyy;

  if (admitModalMode === 'edit') {
    const note = notes.find((n) => n.id === noteId);
    if (!note) return;
    const rawContent = currentId === noteId && currentMode === 'editor' ? $('noteText').value : note.content;
    const parsed = parseChart(rawContent, note);
    const { data } = extractAdmittingHistory(rawContent);
    $('admitModalHeading').innerHTML = `${uiIcon('pencil')} Edit Admitting History`;
    $('admitModalSubtitle').textContent = `${parsed.room || 'Unassigned'} · ${parsed.name || 'Patient'}`;
    $('admitSaveBtn').innerHTML = `${uiIcon('check')} Save Admitting History`;
    if ($('admitBlankChartBtn')) $('admitBlankChartBtn').hidden = true;
    if ($('admitInitialShiftWrap')) $('admitInitialShiftWrap').hidden = true;

    $('admitName').value = parsed.name === 'Unknown Patient' ? '' : parsed.name;
    $('admitRoom').value = parsed.room === 'Unassigned' ? '' : parsed.room;
    $('admitAge').value = parsed.age || '';
    $('admitSex').value = (parsed.sex || '').toUpperCase();
    $('admitWeight').value = String(parsed.weight || '').replace(/\s*kg$/i, '').trim();
    $('admitService').value = parsed.service || '';
    $('admitAp').value = parsed.ap || '';
    $('admitDate').value = parsed.admitted || today;
    admitSelectedCategories = [...(parsed.categories || [])];
    if (!data.admittingImpression && parsed.assessment) {
      data.admittingImpression = parsed.assessment;
    }
    populateAdmitForm(data);
  } else {
    $('admitModalHeading').innerHTML = `${uiIcon('plus')} Admit / Add Patient`;
    $('admitModalSubtitle').textContent = 'Manual form, pasted admitting history, or on-device dictation';
    $('admitSaveBtn').innerHTML = `${uiIcon('check')} Save &amp; Admit Patient`;
    if ($('admitBlankChartBtn')) $('admitBlankChartBtn').hidden = false;
    if ($('admitInitialShiftWrap')) $('admitInitialShiftWrap').hidden = false;
    if ($('admitCreateInitialShift')) $('admitCreateInitialShift').checked = true;

    $('admitName').value = '';
    $('admitRoom').value = '';
    $('admitAge').value = '';
    $('admitSex').value = '';
    $('admitWeight').value = '';
    $('admitService').value = '';
    $('admitAp').value = '';
    $('admitDate').value = today;
    admitSelectedCategories = [];
    populateAdmitForm(createEmptyAdmittingHistory());
  }

  renderAdmitCategoryPills();
  setAdmitTab('manual');
  updateAdmitWhisperStatus();
  openModalEl($('admitModal'), triggerEl, $('admitName'));
}

function closeAdmitModal() {
  clearAdmitAudioRecording();
  closeModalEl($('admitModal'));
}

function applyParsedAdmittingHistory(rawText) {
  const clean = String(rawText || '').trim();
  if (!clean) return toast('Paste or dictate admitting history text first');
  const parsed = parseAdmittingHistoryText(clean);
  if (!hasAdmittingHistoryContent(parsed)) {
    return toast('Could not detect admitting sections — check labels like Chief Complaint:, HPI:, PMH:');
  }
  populateAdmitForm(parsed);
  setAdmitTab('manual');
  toast('Auto-parsed into form — review checkboxes & vitals, then save');
}

async function structureAdmittingHistoryWithAi(rawText) {
  const clean = String(rawText || '').trim();
  if (!clean) return toast('Paste or dictate admitting history text first');
  if (navigator.onLine === false) return toast('Device is offline — use Auto-Parse into Form locally');

  const endpoint = $('endpoint')?.value.trim().replace(/\/$/, '');
  const model = $('model')?.value.trim();
  const key = $('apiKey')?.value.trim();
  if (!endpoint || !model || !key) {
    return toast('Configure Kardex AI endpoint, model & API key in Settings first (or use local Auto-Parse)');
  }

  const admitProf = {
    name: $('admitName').value.trim(),
    aliases: [],
    room: $('admitRoom').value.trim(),
  };
  const redacted = redact(clean, admitProf);
  const leaks = [...redacted.report.leaks, ...findLeaks(redacted.text, admitProf)];
  if (leaks.length > 0) {
    return toast(`Blocked: possible PHI leaks (${leaks.map((l) => l.value).join(', ')}) — remove patient identifiers or use local Auto-Parse`);
  }

  toast('Structuring de-identified admitting history via Kardex AI...');
  try {
    const prompt = `Organize the following de-identified clinical admitting note strictly into these exact labeled headings without inventing any clinical values or vitals:\nChief Complaint:\nHistory of Present Illness:\nPast Medical History:\nFamily History:\nPersonal and Social History:\nAdmission Vitals:\nPhysical Examination:\nAdmitting Impression:\nPlan of Care:\n\nInput:\n${redacted.text}`;
    const replyText = await callAiChat({ endpoint, model, apiKey: key, prompt });
    applyParsedAdmittingHistory(replyText);
  } catch (err) {
    toast(`Kardex AI structuring failed: ${err.message} — try local Auto-Parse`);
  }
}

async function commitAdmitModal() {
  const nameVal = $('admitName').value.trim();
  const roomVal = $('admitRoom').value.trim();
  const ageVal = $('admitAge').value.trim();
  const sexVal = $('admitSex').value.trim();
  const weightVal = $('admitWeight').value.trim();
  const serviceVal = $('admitService').value.trim();
  const apVal = $('admitAp').value.trim();
  const admittedVal = $('admitDate').value.trim() || getTodayDateStrings().mmddyyyy;
  const formData = readAdmitForm();

  if (!nameVal && !roomVal && !hasAdmittingHistoryContent(formData)) {
    return toast('Enter patient name, room, or admitting history first (or tap Quick Blank Chart)');
  }

  let note;
  let content;
  if (admitModalMode === 'edit' && admitEditingNoteId) {
    const existing = notes.find((n) => n.id === admitEditingNoteId);
    if (!existing) return;
    const baseContent =
      currentId === existing.id && currentMode === 'editor' ? $('noteText').value : existing.content;
    content = syncFrontmatter(baseContent, {
      name: nameVal,
      room: roomVal,
      age: ageVal,
      sex: sexVal,
      weight: weightVal,
      service: serviceVal,
      ap: apVal,
      admitted: admittedVal,
      assessment: formData.admittingImpression,
      categories: admitSelectedCategories,
      charity: admitSelectedCategories.some((c) => c.toLowerCase() === 'charity'),
    });
    content = upsertAdmittingHistory(content, formData);
    note = {
      ...existing,
      content,
      name: nameVal,
      room: roomVal,
      title: computeNoteTitle(nameVal, roomVal, existing.title || 'Untitled note'),
      updated: Date.now(),
    };
  } else {
    content = syncFrontmatter('', {
      name: nameVal,
      room: roomVal,
      age: ageVal,
      sex: sexVal,
      weight: weightVal,
      service: serviceVal,
      ap: apVal,
      admitted: admittedVal,
      assessment: formData.admittingImpression,
      categories: admitSelectedCategories,
      census: true,
      charity: admitSelectedCategories.some((c) => c.toLowerCase() === 'charity'),
    });
    content = upsertAdmittingHistory(content, formData);

    const shouldCreateShift = Boolean($('admitCreateInitialShift')?.checked);
    const v = formData.vitals || {};
    const bpStr = v.sbp && v.dbp ? `${v.sbp}/${v.dbp}` : v.sbp || '';
    const hasVs = Boolean(bpStr || v.hr || v.rr || v.temp || v.o2);
    if (shouldCreateShift && (hasVs || formData.admittingImpression || formData.planOfCare)) {
      const initialLines = [];
      if (hasVs) {
        initialLines.push(
          `Vitals: BP ${bpStr} | HR ${v.hr} | RR ${v.rr} | T ${v.temp} | O2sat ${v.o2}`.replace(/\s+\|/g, ' |')
        );
      }
      if (formData.admittingImpression) {
        initialLines.push(`Impression: ${formData.admittingImpression}`);
      }
      if (formData.planOfCare) {
        const planItems = formData.planOfCare
          .split('\n')
          .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
          .filter(Boolean);
        if (planItems.length) {
          initialLines.push('Service Plans:');
          for (const item of planItems) initialLines.push(`- ${item}`);
        }
      }
      content = appendShiftBlock(
        content,
        defaultShiftForHour(),
        getTodayDateStrings().mmddyyyy,
        initialLines.join('\n')
      );
    }

    note = {
      id: uid(),
      title: computeNoteTitle(nameVal, roomVal, 'Untitled note'),
      content,
      name: nameVal,
      aliases: [],
      room: roomVal,
      updated: Date.now(),
    };
  }

  await put(note);
  await refresh();
  await select(note.id, { skipFlush: true });
  closeAdmitModal();
  await setMode('editor');
  if ($('admittingHistoryDetails')) $('admittingHistoryDetails').open = true;
  toast(admitModalMode === 'edit' ? 'Admitting history updated' : 'Patient admitted cleanly');
}

if ($('editAdmittingHistoryBtn')) {
  $('editAdmittingHistoryBtn').onclick = () => {
    if (!currentId) return toast('Select or create a patient chart first');
    openAdmitModal({ mode: 'edit', noteId: currentId, triggerEl: $('editAdmittingHistoryBtn') });
  };
}
if ($('admitModalClose')) $('admitModalClose').onclick = closeAdmitModal;
if ($('admitCancelBtn')) $('admitCancelBtn').onclick = closeAdmitModal;
if ($('admitBlankChartBtn')) {
  $('admitBlankChartBtn').onclick = async () => {
    closeAdmitModal();
    await newNote();
  };
}
if ($('admitSaveBtn')) $('admitSaveBtn').onclick = commitAdmitModal;
if ($('admitTabManual')) $('admitTabManual').onclick = () => setAdmitTab('manual');
if ($('admitTabPaste')) $('admitTabPaste').onclick = () => setAdmitTab('paste');
if ($('admitTabDictate')) $('admitTabDictate').onclick = () => setAdmitTab('dictate');

if ($('admitPmhHtn')) $('admitPmhHtn').onchange = syncAdmitPmhInputs;
if ($('admitPmhDm')) $('admitPmhDm').onchange = syncAdmitPmhInputs;
if ($('admitPmhPrevHosp')) $('admitPmhPrevHosp').onchange = syncAdmitPmhInputs;

if ($('admitSamplePasteBtn')) {
  $('admitSamplePasteBtn').onclick = () => {
    if ($('admitPasteInput')) $('admitPasteInput').value = SAMPLE_ADMITTING_NOTE;
  };
}
if ($('admitParsePasteBtn')) {
  $('admitParsePasteBtn').onclick = () => applyParsedAdmittingHistory($('admitPasteInput')?.value || '');
}
if ($('admitParseDictateBtn')) {
  $('admitParseDictateBtn').onclick = () => applyParsedAdmittingHistory($('admitDictateTranscript')?.value || '');
}
if ($('admitAiStructurePasteBtn')) {
  $('admitAiStructurePasteBtn').onclick = () => structureAdmittingHistoryWithAi($('admitPasteInput')?.value || '');
}
if ($('admitAiStructureDictateBtn')) {
  $('admitAiStructureDictateBtn').onclick = () => structureAdmittingHistoryWithAi($('admitDictateTranscript')?.value || '');
}

if ($('admitStartRecBtn')) {
  $('admitStartRecBtn').onclick = async () => {
    if (admitIsStartingRec) return;
    admitIsStartingRec = true;
    $('admitStartRecBtn').disabled = true;
    clearAdmitAudioRecording();

    try {
      const info = await admitRecorder.start();
      if (!info || !admitRecorder.isRecording()) return;
      $('admitStartRecBtn').hidden = true;
      $('admitStopRecBtn').hidden = false;
      updateAdmitWhisperStatus();
    } catch (err) {
      admitRecorder.cancel();
      if ($('admitStartRecBtn')) $('admitStartRecBtn').hidden = false;
      if ($('admitStopRecBtn')) $('admitStopRecBtn').hidden = true;
      updateAdmitWhisperStatus();
      const detail = `${err?.name ? `${err.name}: ` : ''}${err?.message || err}`;
      toast(`Mic error: ${detail} — you can still use your phone keyboard mic below`);
    } finally {
      admitIsStartingRec = false;
      if ($('admitStartRecBtn')) $('admitStartRecBtn').disabled = false;
    }
  };
}
if ($('admitStopRecBtn')) {
  $('admitStopRecBtn').onclick = async () => {
    await stopAdmitAudioRecording();
    updateAdmitWhisperStatus();
  };
}
if ($('admitWhisperTranscribeBtn')) {
  $('admitWhisperTranscribeBtn').onclick = async () => {
    if (!admitRecBlob && !admitRecPcm16k) return toast('Record audio first');
    const cacheKey = `${admitAudioToken}::${selectedWhisperModel}`;
    if (admitAudioToken && lastAdmitTranscribedKey === cacheKey) {
      return toast(`Already transcribed with ${selectedWhisperModel} — switch model or re-record`);
    }
    const isCachedOrLoaded =
      whisperCtrl.getState().loadedModels.includes(selectedWhisperModel) ||
      (cachedWhisperModels.has(selectedWhisperModel) && cachedWhisperRuntimeReady);
    if (!isCachedOrLoaded) {
      return toast('Offline Whisper model not cached yet — preload in Settings → Offline Voice, or use your phone keyboard mic');
    }
    try {
      updateAdmitWhisperStatus('TRANSCRIBING...');
      $('admitWhisperTranscribeBtn').disabled = true;
      const res = admitRecPcm16k
        ? await whisperCtrl.transcribePcm(admitRecPcm16k, selectedWhisperModel)
        : await whisperCtrl.transcribeBlob(admitRecBlob, selectedWhisperModel);
      if (res?.text && $('admitDictateTranscript')) {
        lastAdmitTranscribedKey = cacheKey;
        const corrected = applyClinicalAsrCorrections(res.text);
        $('admitDictateTranscript').value = mergeTranscriptText($('admitDictateTranscript').value, corrected);
        toast(`Transcribed offline in ${(res.elapsedMs / 1000).toFixed(1)}s`);
      } else {
        toast('No speech detected in audio');
      }
    } catch (err) {
      toast(`Offline transcription failed: ${err.message}`);
    } finally {
      if ($('admitWhisperTranscribeBtn')) $('admitWhisperTranscribeBtn').disabled = false;
      updateAdmitWhisperStatus();
    }
  };
}

// Modal backdrop clicks & global keyboard shortcuts
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (overlay.id === 'voiceModal') closeDictateModal(false);
    else if (overlay.id === 'shiftModal') closeShiftModal(false);
    else if (overlay.id === 'admitModal') closeAdmitModal();
    else if (overlay.id === 'handoverModal') closeHandoverModal();
    else if (overlay.id === 'inboxModal') closeInboxModal(false);
    else if (overlay.id === 'calcModal') closeCalcModal();
    else if (overlay.id === 'restoreModal' || overlay.id === 'manualCopyModal') closeModalEl(overlay);
  });
});

document.addEventListener('keydown', (e) => {
  if (activeModalEl && !activeModalEl.hidden) {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (activeModalEl.id === 'voiceModal') closeDictateModal(false);
      else if (activeModalEl.id === 'shiftModal') closeShiftModal(false);
      else if (activeModalEl.id === 'admitModal') closeAdmitModal();
      else if (activeModalEl.id === 'handoverModal') closeHandoverModal();
      else if (activeModalEl.id === 'inboxModal') closeInboxModal(false);
      else if (activeModalEl.id === 'calcModal') closeCalcModal();
      else closeModalEl(activeModalEl);
      return;
    }
    if (e.key === 'Tab') {
      const focusables = getFocusableInModal(activeModalEl);
      if (focusables.length) {
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
      return;
    }
  }

  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (currentMode === 'editor') {
      const inlineSave = $('chartTimelineList')?.querySelector('.tl-save-entry-btn');
      if (inlineSave) inlineSave.click();
      else saveCurrent();
    } else if (currentMode === 'scratch' && !$('scratchEditorCard')?.hidden) {
      saveScratchNote();
    } else if (currentMode === 'settings' && activeSettingsTab === 'template') {
      $('saveTemplateBtn')?.click();
    }
    return;
  }

  if (mod && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (currentMode === 'rounds') $('bedSearchInput')?.focus();
    else if (currentMode === 'editor') $('timelineSearchInput')?.focus();
    else if (currentMode === 'library') $('librarySearchInput')?.focus();
    else if (currentMode === 'scratch') $('scratchSearchInput')?.focus();
    return;
  }

  if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
    e.preventDefault();
    if (currentMode === 'rounds') $('bedSearchInput')?.focus();
    else if (currentMode === 'editor') $('timelineSearchInput')?.focus();
    else if (currentMode === 'library') $('librarySearchInput')?.focus();
    else if (currentMode === 'scratch') $('scratchSearchInput')?.focus();
    return;
  }

  if (mod && e.key === 'Enter') {
    if (activeModalEl && !activeModalEl.hidden) {
      if (activeModalEl.id === 'shiftModal') $('shiftAppendStayBtn')?.click();
      else if (activeModalEl.id === 'inboxModal') $('inboxFileBtn')?.click();
      else if (activeModalEl.id === 'voiceModal') {
        if (!$('voiceSoapReviewBox')?.hidden) $('voiceSoapConfirmBtn')?.click();
        else $('voiceAppendRawBtn')?.click();
      }
    } else if (currentMode === 'editor' && document.activeElement === $('question')) {
      $('previewBtn')?.click();
    }
    return;
  }

  if (e.altKey && !mod && ['1', '2', '3', '4', '5'].includes(e.key)) {
    e.preventDefault();
    const modes = ['rounds', 'editor', 'library', 'scratch', 'settings'];
    setMode(modes[Number(e.key) - 1]);
  }
});

window.addEventListener('beforeunload', (e) => {
  const isRec = voiceRecorder.isRecording() || admitRecorder.isRecording();
  if (dirtyChart || isRec || templateDirtyFlag) {
    e.preventDefault();
    e.returnValue = '';
  }
});

['bedSearchInput', 'timelineSearchInput', 'librarySearchInput', 'scratchSearchInput', 'calcNewDrugInput'].forEach((id) => {
  $(id)?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.blur();
    }
  });
});

document.addEventListener('click', (e) => {
  const menu = $('editorMoreMenu');
  if (menu?.open && !menu.contains(e.target)) {
    menu.open = false;
  }
});

window.visualViewport?.addEventListener('resize', syncVisualViewportVars);
window.visualViewport?.addEventListener('scroll', syncVisualViewportVars);
window.addEventListener('resize', syncVisualViewportVars);
window.addEventListener('online', updateNetworkStatusUi);
window.addEventListener('offline', updateNetworkStatusUi);

function handleBackgroundLifecycleSave() {
  persistRecoveryDraftSync();
  flushPendingChartSave();
  if (voiceRecorder.isRecording()) {
    handleMicInterruption('Recording stopped by screen lock / app switch — audio saved for review');
  }
  if (admitRecorder.isRecording()) {
    stopAdmitAudioRecording();
  }
  releaseScreenWakeLock();
}

window.addEventListener('pagehide', handleBackgroundLifecycleSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    handleBackgroundLifecycleSave();
    const st = whisperCtrl.getState();
    if (st.loadedModels.length > 0 && st.status !== 'loading' && st.status !== 'transcribing') {
      whisperCtrl.unload().then(() => updateWhisperUiStatus()).catch(() => {});
    }
    return;
  }
  updateDutyClockUi();
  if (swRegistration && navigator.onLine !== false && Date.now() - lastSwUpdateCheckAt > 900000) {
    lastSwUpdateCheckAt = Date.now();
    swRegistration.update().catch(() => {});
  }
});
setInterval(updateDutyClockUi, 60000);

// Initialization
(async () => {
  syncVisualViewportVars();
  initAppearanceSettings();
  renderAllShiftPillGroups();
  renderShiftScheduleSettings();
  setSettingsTab(activeSettingsTab, { persist: false });
  updateNetworkStatusUi();
  try {
    db = await openDB();
  } catch (err) {
    toast(`Local database error: ${err?.message || 'Blocked'} — check browser storage settings`, { duration: 6000 });
    return;
  }

  await refresh();
  await refreshStorageAndPwaStatus({ requestPersist: true });
  if (notes.length) {
    await select(notes[0].id, { skipFlush: true });
  }
  restorePendingRecoveryDraftsIfNeeded();
  updateInboxBadge();
  updateCompanionConnHint();
  updateApiKeyStatusPill();
  refreshWhisperCacheStatus();
  setMode('rounds');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        swRegistration = reg;
        lastSwUpdateCheckAt = Date.now();
        if (reg.waiting) {
          swWaitingWorker = reg.waiting;
          if ($('swUpdateBanner')) $('swUpdateBanner').hidden = false;
        }
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              swWaitingWorker = nw;
              if ($('swUpdateBanner')) $('swUpdateBanner').hidden = false;
              refreshStorageAndPwaStatus();
            }
          });
        });
        refreshStorageAndPwaStatus();
      })
      .catch(() => {});

    let reloadingForSw = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadingForSw) return;
      reloadingForSw = true;
      window.location.reload();
    });
  }
})();
