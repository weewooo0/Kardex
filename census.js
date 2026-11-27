// Census and Rounds (Digital Scutsheet) logic for Companion MD
// Follows CLINICAL-WORKFLOW-STE.md specifications

export const PLAN_MODES = {
  service: { id: 'service', label: 'Service Plans', heading: 'Service Plans:' },
  problem: { id: 'problem', label: 'Problem-Based A&P', heading: 'Problem-Based Plan:' },
  systems: { id: 'systems', label: 'Systems-Based ICU', heading: 'Systems-Based ICU Plan:' },
};

export const HANDOVER_FORMATS = {
  standard: { id: 'standard', label: 'Standard Shift Relay' },
  ipass: { id: 'ipass', label: 'I-PASS Sign-out' },
  sbar: { id: 'sbar', label: 'SBAR Handover' },
};

export const CODE_STATUS_OPTIONS = ['Full Code', 'DNR', 'DNI', 'DNR / DNI', 'Comfort Care', 'DNACPR'];

export const SEVERITY_LEVELS = ['Stable', 'Watcher', 'Unstable'];

export const ABX_FREQUENCIES = [
  { id: 'q8h', label: 'q8h (3×/day)', intervalHrs: 8, dosesPerDay: 3 },
  { id: 'q12h', label: 'q12h (2×/day)', intervalHrs: 12, dosesPerDay: 2 },
  { id: 'q24h', label: 'q24h / OD (1×/day)', intervalHrs: 24, dosesPerDay: 1 },
  { id: 'q6h', label: 'q6h (4×/day)', intervalHrs: 6, dosesPerDay: 4 },
  { id: 'q4h', label: 'q4h (6×/day)', intervalHrs: 4, dosesPerDay: 6 },
  { id: 'q48h', label: 'q48h (renal)', intervalHrs: 48, dosesPerDay: 0.5 },
];

export const FASTHUG_BID_ITEMS = [
  'Feeding: target nutrition / GI tolerance',
  'Analgesia: pain controlled',
  'Sedation: RASS target / daily sedation vacation',
  'Thromboembolism: DVT prophylaxis active',
  'Head of Bed: 30-45 deg elevation',
  'Ulcer: stress ulcer prophylaxis if indicated',
  'Glucose: glycemic target 140-180 mg/dL',
  'Bowel: bowel regimen / last BM tracked',
  'Indwelling Catheter: CVC & Foley need reviewed',
  'De-escalation: daily abx & culture review',
];

export const DEFAULT_MORNING_TEMPLATE = `Good day <% tp.frontmatter.AP %>

Update on your patient
<% tp.file.title %>
(Age)
(Room)

Problem list:


(Subjective Complaints)

BP 
HR 
RR 
Temp
O2

I- 
O- 
Fb

HGT:

Awake, NIRD
HEENT: Anicteric sclerae, pink palpebral conjunctivae
C/L: ECE, clear breath sounds
CVS: DHS, regular rate and rhythm
ABD: Soft, non-tender abdomen, 
EXT: Strong peripheral pulses, CRT <2 secs


Medications 


Plan:


Thank you, doctor
[Your Name]
[Service / Hospital]`;

export const DEFAULT_NORMAL_PE_TEXT = [
  'Awake, NIRD',
  'HEENT: Anicteric sclerae, pink palpebral conjunctivae',
  'C/L: ECE, clear breath sounds',
  'CVS: DHS, regular rate and rhythm',
  'ABD: Soft, non-tender abdomen',
  'EXT: Strong peripheral pulses, CRT <2 secs',
].join('\n');

export const DEFAULT_TEMPLATE_CONFIG = {
  configVersion: 2,
  header: 'Good day {{ap}}\n\nUpdate on your patient',
  showName: true,
  showAgeSex: true,
  showRoom: true,
  sections: [
    { id: 'labs', label: 'Laboratory updates', enabled: true },
    { id: 'subjective', label: 'Subjective', enabled: true },
    {
      id: 'objective',
      label: 'Objective',
      enabled: true,
      subItems: [
        { id: 'vitals', label: 'Vital signs', enabled: true },
        { id: 'io', label: 'Intake & Output (I&O)', enabled: true },
        { id: 'io24', label: '24h Fluid Balance (6am)', enabled: true },
        { id: 'vent', label: 'Ventilator Settings', enabled: false },
        { id: 'feeding', label: 'Diet / Feeding', enabled: true },
        { id: 'pe', label: 'Physical Exam', enabled: true },
      ],
    },
    { id: 'assessment', label: 'Assessment', enabled: true },
    { id: 'meds', label: 'Medications / Drips', enabled: false },
    { id: 'plan', label: 'Plan', enabled: true },
  ],
  footer: 'Thank you, doctor\n[Your Name]\n[Service / Hospital]',
};

export const MORNING_TEMPLATE_CONFIG = {
  configVersion: 2,
  header: 'Good day {{ap}}\n\nUpdate on your patient',
  showName: true,
  showAgeSex: true,
  showRoom: true,
  sections: [
    { id: 'assessment', label: 'Assessment', enabled: true },
    { id: 'subjective', label: 'Subjective', enabled: true },
    {
      id: 'objective',
      label: 'Objective',
      enabled: true,
      subItems: [
        { id: 'vitals', label: 'Vital signs', enabled: true },
        { id: 'io', label: 'Intake & Output (I&O)', enabled: true },
        { id: 'io24', label: '24h Fluid Balance (6am)', enabled: true },
        { id: 'vent', label: 'Ventilator Settings', enabled: false },
        { id: 'feeding', label: 'Diet / Feeding', enabled: true },
        { id: 'pe', label: 'Physical Exam', enabled: true },
      ],
    },
    { id: 'meds', label: 'Medications / Drips', enabled: true },
    { id: 'plan', label: 'Plan', enabled: true },
    { id: 'labs', label: 'Laboratory updates', enabled: false },
  ],
  footer: 'Thank you, doctor\n[Your Name]\n[Service / Hospital]',
};

export function compileTemplateConfig(config = DEFAULT_TEMPLATE_CONFIG) {
  const cfg = config || DEFAULT_TEMPLATE_CONFIG;
  const blocks = [];

  const header = String(cfg.header || '').trim();
  if (header) blocks.push(header);

  const ptLines = [];
  if (cfg.showName !== false) ptLines.push('{{name}}');
  if (cfg.showAgeSex !== false) ptLines.push('{{age_sex}}');
  if (cfg.showRoom !== false) ptLines.push('{{room}}');
  if (ptLines.length) blocks.push(ptLines.join('\n'));

  const sections = Array.isArray(cfg.sections) ? cfg.sections : DEFAULT_TEMPLATE_CONFIG.sections;
  for (const sec of sections) {
    if (!sec || !sec.enabled) continue;
    switch (sec.id) {
      case 'labs':
        blocks.push('Laboratory updates:');
        break;
      case 'subjective':
        blocks.push('Subjective:');
        break;
      case 'objective': {
        const subs = Array.isArray(sec.subItems) ? sec.subItems : [];
        const subBlocks = [];
        for (const sub of subs) {
          if (!sub || !sub.enabled) continue;
          if (sub.id === 'vitals') {
            subBlocks.push('BP \nHR \nRR \nTemp\nO2');
          } else if (sub.id === 'io') {
            subBlocks.push('I- \nO- \nFb');
          } else if (sub.id === 'io24') {
            subBlocks.push('24h Net:');
          } else if (sub.id === 'vent') {
            subBlocks.push('Vent: {{vent}}');
          } else if (sub.id === 'feeding') {
            subBlocks.push('Feeding: {{feeding}}');
          } else if (sub.id === 'pe') {
            subBlocks.push(DEFAULT_NORMAL_PE_TEXT);
          }
        }
        blocks.push(subBlocks.length ? subBlocks.join('\n\n') : 'Objective:');
        break;
      }
      case 'assessment':
        blocks.push('Assessment:\n{{assessment}}');
        break;
      case 'meds':
        blocks.push('Medications:\n{{drips}}');
        break;
      case 'plan':
        blocks.push('Plan:\n{{service_plans}}\n{{pending}}');
        break;
    }
  }

  const footer = String(cfg.footer || '').trim();
  if (footer) blocks.push(footer);

  return blocks.join('\n\n');
}

export function metaOf(text) {
  const str = String(text || '');
  const clean = str.charCodeAt(0) === 0xFEFF ? str.slice(1) : str;
  const out = {};
  if (!clean.startsWith('---')) return out;
  const firstNl = clean.indexOf('\n');
  if (firstNl === -1) return out;
  if (!/^---[ \t]*\r?$/.test(clean.slice(0, firstNl))) return out;

  const fmStart = firstNl + 1;
  let frontBlock = null;
  if (clean.startsWith('---', fmStart)) {
    const lineEnd = clean.indexOf('\n', fmStart);
    const firstFmLine = clean.slice(fmStart, lineEnd === -1 ? clean.length : lineEnd);
    if (/^---[ \t]*\r?$/.test(firstFmLine)) {
      frontBlock = '';
    }
  }

  if (frontBlock === null) {
    let searchFrom = firstNl;
    while (true) {
      const idx = clean.indexOf('\n---', searchFrom);
      if (idx === -1) break;
      const lineStart = idx + 1;
      const lineEnd = clean.indexOf('\n', lineStart);
      const closeLine = clean.slice(lineStart, lineEnd === -1 ? clean.length : lineEnd);
      if (/^---[ \t]*\r?$/.test(closeLine)) {
        let blockEnd = idx;
        if (blockEnd > fmStart && clean.charCodeAt(blockEnd - 1) === 13) blockEnd--;
        frontBlock = clean.slice(fmStart, blockEnd);
        break;
      }
      searchFrom = idx + 4;
    }
  }

  if (frontBlock !== null && frontBlock.length > 0) {
    for (const line of frontBlock.split(/\r?\n/)) {
      const p = line.match(/^([^:]+):\s*(.*)$/);
      if (p) {
        out[p[1].trim().toLowerCase()] = p[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  }
  return out;
}

const ROOM_TITLE_KEYWORD_RE = /^(?:unassigned|room|rm\.?|bed|ward|icu|nccu|micu|sicu|ccu|picu|nicu|er|or|pacu|stepdown|tele|iso|private|suite|pav|floor|unit|bay|obs|cvicu|tcu|hd|hdu)\b/i;

function looksLikeRoomToken(s) {
  const clean = String(s || '').trim();
  if (!clean) return false;
  if (ROOM_TITLE_KEYWORD_RE.test(clean)) return true;
  return /\d/.test(clean) && clean.length <= 20;
}

export function parseRoomAndNameFromTitle(rawTitle) {
  const stem = String(rawTitle || '')
    .trim()
    .replace(/\.(?:md|markdown|txt)$/i, '')
    .trim();
  if (!stem) return { room: '', name: '' };
  if (/^(?:untitled|untitled note|unknown patient)$/i.test(stem)) {
    return { room: '', name: '' };
  }

  const parts = stem.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const left = parts[0];
    const right = parts.slice(1).join(' - ');
    if (looksLikeRoomToken(left)) {
      return { room: /^unassigned$/i.test(left) ? '' : left, name: right };
    }
    if (looksLikeRoomToken(right)) {
      return { room: /^unassigned$/i.test(right) ? '' : right, name: left };
    }
    return { room: left, name: right };
  }

  const tightMatch = stem.match(
    /^((?:(?:icu|nccu|micu|sicu|ccu|picu|nicu|ward|rm|room|bed|er)\s*-?\s*\d+[a-z]?|\d{2,4}[a-z]?))-(?=[A-Za-z])(.+)$/i
  );
  if (tightMatch) {
    return { room: tightMatch[1].trim(), name: tightMatch[2].trim() };
  }

  if (looksLikeRoomToken(stem) && !stem.includes(',') && stem.length <= 12 && /\d/.test(stem)) {
    return { room: stem, name: '' };
  }
  return { room: '', name: stem };
}

export function getTodayDateStrings(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const yyyy = date.getFullYear();
  return {
    mmddyyyy: `${mm}-${dd}-${yyyy}`,
    yyyymmdd: `${yyyy}-${mm}-${dd}`,
  };
}

export const DEFAULT_SHIFT_SCHEDULE = [
  { time: '06:00', label: '6am' },
  { time: '14:00', label: '2pm' },
  { time: '22:00', label: '10pm' },
];

export const SHIFT_SCHEDULE_PRESETS = {
  standard8h: {
    id: 'standard8h',
    name: '8h (6am / 2pm / 10pm)',
    shifts: [
      { time: '06:00', label: '6am' },
      { time: '14:00', label: '2pm' },
      { time: '22:00', label: '10pm' },
    ],
  },
  twoShift12h: {
    id: 'twoShift12h',
    name: '12h (7am / 7pm)',
    shifts: [
      { time: '07:00', label: '7am' },
      { time: '19:00', label: '7pm' },
    ],
  },
  icu6h: {
    id: 'icu6h',
    name: '6h ICU (6a / 12p / 6p / 12a)',
    shifts: [
      { time: '06:00', label: '6am' },
      { time: '12:00', label: '12pm' },
      { time: '18:00', label: '6pm' },
      { time: '00:00', label: '12am' },
    ],
  },
  ward8h7am: {
    id: 'ward8h7am',
    name: '8h (7am / 3pm / 11pm)',
    shifts: [
      { time: '07:00', label: '7am' },
      { time: '15:00', label: '3pm' },
      { time: '23:00', label: '11pm' },
    ],
  },
};

export function normalizeShiftTime(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return '';
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatTime24ToLabel(time24) {
  const norm = normalizeShiftTime(time24);
  if (!norm) return '';
  const [hh, mm] = norm.split(':').map((n) => parseInt(n, 10));
  const suffix = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm === 0 ? `${h12}${suffix}` : `${h12}:${String(mm).padStart(2, '0')}${suffix}`;
}

function time24ToMinutes(time24) {
  const [hh, mm] = time24.split(':').map((n) => parseInt(n, 10));
  return hh * 60 + mm;
}

export function normalizeShiftSchedule(list = []) {
  const items = Array.isArray(list) ? list : [];
  const byTime = new Map();
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue;
    const time = normalizeShiftTime(entry.time);
    if (!time || byTime.has(time)) continue;
    const rawLabel = String(entry.label || '')
      .replace(/[\r\n#]+/g, ' ')
      .trim()
      .slice(0, 20);
    byTime.set(time, {
      time,
      label: rawLabel || formatTime24ToLabel(time),
    });
  }
  const sorted = [...byTime.values()]
    .sort((a, b) => time24ToMinutes(a.time) - time24ToMinutes(b.time))
    .slice(0, 6);
  return sorted.length ? sorted : DEFAULT_SHIFT_SCHEDULE.map((s) => ({ ...s }));
}

export function isInterimShift(shift) {
  return /^interim\b/i.test(String(shift || '').trim());
}

export function formatInterimShiftLabel(now = new Date(), customTime24 = '') {
  const norm = normalizeShiftTime(customTime24);
  const timeStr = norm
    ? norm
    : `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return `Interim (${formatTime24ToLabel(timeStr)})`;
}

export function parseShiftTimeTo24h(shiftLabel) {
  const s = String(shiftLabel || '').trim();
  if (!s) return '';
  const m12 = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m12) {
    let h = parseInt(m12[1], 10);
    const min = m12[2] ? parseInt(m12[2], 10) : 0;
    const ap = m12[3].toLowerCase();
    if (h >= 1 && h <= 12 && min >= 0 && min <= 59) {
      if (ap === 'pm' && h !== 12) h += 12;
      if (ap === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    }
  }
  const m24 = s.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (m24) {
    return `${String(parseInt(m24[1], 10)).padStart(2, '0')}:${m24[2]}`;
  }
  const mMil = s.match(/\b([01]\d|2[0-3])([0-5]\d)\s*h\b/i);
  if (mMil) {
    return `${mMil[1]}:${mMil[2]}`;
  }
  return '';
}

export function getShiftForDate(now = new Date(), schedule = DEFAULT_SHIFT_SCHEDULE) {
  const normSchedule = normalizeShiftSchedule(schedule);
  const nowMins = now.getHours() * 60 + now.getMinutes();
  let chosen = null;
  for (const slot of normSchedule) {
    const mins = time24ToMinutes(slot.time);
    if (mins <= nowMins) chosen = { ...slot, minutes: mins };
  }
  if (!chosen) {
    const last = normSchedule[normSchedule.length - 1];
    chosen = { ...last, minutes: time24ToMinutes(last.time) };
  }
  return chosen;
}

export function getDutyDateStrings(now = new Date(), schedule = null) {
  const normSchedule = Array.isArray(schedule) ? normalizeShiftSchedule(schedule) : null;
  const activeShift = getShiftForDate(now, normSchedule || DEFAULT_SHIFT_SCHEDULE);
  const nowMins = now.getHours() * 60 + now.getMinutes();

  let isPostMidnightCarryover = false;
  if (!normSchedule) {
    isPostMidnightCarryover = now.getHours() < 5;
  } else {
    const morningCandidate = normSchedule.find((s) => time24ToMinutes(s.time) >= 4 * 60);
    const rolloverMins = morningCandidate ? time24ToMinutes(morningCandidate.time) : 5 * 60;
    isPostMidnightCarryover = nowMins < rolloverMins && activeShift.minutes >= 18 * 60;
  }

  const dutyDate = isPostMidnightCarryover
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
    : now;
  return {
    ...getTodayDateStrings(dutyDate),
    isPostMidnightCarryover,
    shiftLabel: activeShift.label,
  };
}

export function classifyDictationShiftByClock(now = new Date(), schedule = DEFAULT_SHIFT_SCHEDULE) {
  const norm = normalizeShiftSchedule(schedule);
  const isDefault8h =
    norm.length === 3 &&
    norm[0].time === '06:00' &&
    norm[1].time === '14:00' &&
    norm[2].time === '22:00';

  if (!isDefault8h) {
    return getDutyDateStrings(now, norm);
  }

  const h = now.getHours();
  if (h >= 4 && h < 12) {
    return {
      ...getTodayDateStrings(now),
      isPostMidnightCarryover: false,
      shiftLabel: norm[0].label,
    };
  }
  if (h >= 12 && h < 19) {
    return {
      ...getTodayDateStrings(now),
      isPostMidnightCarryover: false,
      shiftLabel: norm[1].label,
    };
  }
  if (h >= 19) {
    return {
      ...getTodayDateStrings(now),
      isPostMidnightCarryover: false,
      shiftLabel: norm[2].label,
    };
  }
  const prevDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return {
    ...getTodayDateStrings(prevDay),
    isPostMidnightCarryover: true,
    shiftLabel: norm[2].label,
  };
}

export function naturalBedCompare(a, b) {
  const cleanA = String(a || '').trim();
  const cleanB = String(b || '').trim();

  // Extract prefix and numeric components
  const extractParts = (s) => {
    const m = s.match(/^([A-Za-z\s_-]*?)(\d+)(.*)$/);
    if (m) {
      return {
        prefix: m[1].trim().toLowerCase(),
        num: parseInt(m[2], 10),
        suffix: m[3].trim().toLowerCase(),
      };
    }
    return { prefix: s.toLowerCase(), num: Infinity, suffix: '' };
  };

  const pA = extractParts(cleanA);
  const pB = extractParts(cleanB);

  // Group normal ward rooms ("room", "bed", or empty) before ICU / special units
  const isSpecialUnit = (p) => /icu|ccu|picu|nicu|er|or|pacu/i.test(p);
  const specialA = isSpecialUnit(pA.prefix);
  const specialB = isSpecialUnit(pB.prefix);

  if (specialA !== specialB) {
    return specialA ? 1 : -1; // Ward beds first, then ICU
  }

  if (pA.prefix !== pB.prefix) {
    const cmp = pA.prefix.localeCompare(pB.prefix);
    if (cmp !== 0) return cmp;
  }

  if (pA.num !== pB.num) {
    return pA.num - pB.num;
  }

  return cleanA.localeCompare(cleanB, undefined, { numeric: true, sensitivity: 'base' });
}

function parseDateParts(str) {
  const clean = String(str || '').trim();
  let m = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    return { month: parseInt(m[1], 10), day: parseInt(m[2], 10), year };
  }
  m = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    return { year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) };
  }
  return null;
}

function datesMatch(a, b) {
  const pA = parseDateParts(a);
  const pB = parseDateParts(b);
  if (pA && pB) {
    return pA.year === pB.year && pA.month === pB.month && pA.day === pB.day;
  }
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

export function dateStringToIso(str) {
  const p = parseDateParts(str);
  if (!p) return '';
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export function computeDayCount(startDateStr, refDateStr = null) {
  const start = parseDateParts(startDateStr);
  if (!start) return null;
  const ref = parseDateParts(refDateStr || getTodayDateStrings().mmddyyyy);
  if (!ref) return null;
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const refMs = Date.UTC(ref.year, ref.month - 1, ref.day);
  const diffDays = Math.floor((refMs - startMs) / 86400000);
  if (diffDays < 0) return null;
  return diffDays + 1;
}

function getLineReviewThresholdDays(name) {
  const clean = String(name || '').toLowerCase();
  if (/\b(?:foley|urinary|indwelling\s*catheter|ifc|uc)\b/.test(clean)) return 3;
  if (/\b(?:piv|peripheral|iv\s*line|heplock)\b/.test(clean)) return 4;
  if (/\b(?:art(?:erial)?\s*line|a-?line)\b/.test(clean)) return 5;
  if (/\b(?:cvc|central|ij|subclavian|femoral|picc|cordis|ett|trach|vent|intubat)\b/.test(clean)) return 7;
  return 7;
}

export function parseTrackedLines(raw, refDateStr = null) {
  const text = String(raw || '').trim();
  if (!text || /^(?:none|nil|n\/a|-)$/i.test(text)) return [];
  const entries = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const entry of entries) {
    const parts = entry.split('|').map((s) => s.trim());
    const name = parts[0] || '';
    if (!name) continue;
    const startDate = parts[1] || '';
    const dayCount = startDate ? computeDayCount(startDate, refDateStr) : null;
    const thresholdDays = getLineReviewThresholdDays(name);
    const overdue = Boolean(dayCount !== null && dayCount >= thresholdDays);
    out.push({
      name,
      startDate,
      dayCount,
      thresholdDays,
      overdue,
      label: dayCount !== null ? `${name} (Day ${dayCount})` : name,
    });
  }
  return out;
}

export function formatTrackedLines(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && String(it.name || '').trim())
    .map((it) => {
      const name = String(it.name).trim();
      const start = String(it.startDate || '').trim();
      return start ? `${name} | ${start}` : name;
    })
    .join('; ');
}

const ABX_FREQ_MAP = new Map(ABX_FREQUENCIES.map((f) => [f.id, f]));

function normalizeAbxFreq(rawFreq) {
  const s = String(rawFreq || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return '';
  if (s === 'od' || s === 'qd' || s === 'daily' || s === 'qday') return 'q24h';
  if (s === 'bid') return 'q12h';
  if (s === 'tid') return 'q8h';
  if (s === 'qid') return 'q6h';
  return ABX_FREQ_MAP.has(s) ? s : '';
}

function parseTimeParts(timeStr) {
  const m = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = parseInt(m[1], 10);
  const minute = parseInt(m[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function resolveRefTimestampMs(refNow) {
  if (refNow instanceof Date && !Number.isNaN(refNow.getTime())) {
    return {
      ms: refNow.getTime(),
      dateOnlyStr: getTodayDateStrings(refNow).mmddyyyy,
      hasTime: true,
    };
  }
  const str = String(refNow || '').trim();
  if (!str) {
    const now = new Date();
    return {
      ms: now.getTime(),
      dateOnlyStr: getTodayDateStrings(now).mmddyyyy,
      hasTime: true,
    };
  }
  const dtMatch = str.match(/^(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2})[T\s]+(\d{1,2}:\d{2})$/);
  if (dtMatch) {
    const dp = parseDateParts(dtMatch[1]);
    const tp = parseTimeParts(dtMatch[2]);
    if (dp && tp) {
      const ms = Date.UTC(dp.year, dp.month - 1, dp.day, tp.hour, tp.minute, 0);
      return {
        ms,
        dateOnlyStr: `${String(dp.month).padStart(2, '0')}-${String(dp.day).padStart(2, '0')}-${String(dp.year).padStart(4, '0')}`,
        hasTime: true,
      };
    }
  }
  const dp = parseDateParts(str);
  if (dp) {
    const ms = Date.UTC(dp.year, dp.month - 1, dp.day, 23, 59, 0);
    return {
      ms,
      dateOnlyStr: `${String(dp.month).padStart(2, '0')}-${String(dp.day).padStart(2, '0')}-${String(dp.year).padStart(4, '0')}`,
      hasTime: false,
    };
  }
  const now = new Date();
  return { ms: now.getTime(), dateOnlyStr: getTodayDateStrings(now).mmddyyyy, hasTime: true };
}

export function parseTrackedAntibiotics(raw, refNow = new Date()) {
  const text = String(raw || '').trim();
  if (!text || /^(?:none|nil|n\/a|-)$/i.test(text)) return [];
  const ref = resolveRefTimestampMs(refNow);
  const entries = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const out = [];

  for (const entry of entries) {
    const parts = entry.split('|').map((s) => s.trim());
    const drug = parts[0] || '';
    if (!drug) continue;

    const startDate = parts[1] || '';
    const plannedRaw = parts[2] || '';
    const plannedNum = parseInt(plannedRaw.replace(/[^\d]/g, ''), 10);
    const plannedDays = Number.isFinite(plannedNum) && plannedNum > 0 ? plannedNum : null;
    const freq = normalizeAbxFreq(parts[3] || '');
    const freqSpec = freq ? ABX_FREQ_MAP.get(freq) : null;
    const rawTime = parseTimeParts(parts[4] || '');
    const startTime = rawTime
      ? `${String(rawTime.hour).padStart(2, '0')}:${String(rawTime.minute).padStart(2, '0')}`
      : '';
    const parsedOffset = parseInt(parts[5] || '', 10);
    const doseOffset = Number.isFinite(parsedOffset) ? parsedOffset : 0;

    let scheduledDoses = null;
    let dosesGiven = null;
    let dayCount = null;
    let partialDoses = null;
    let nextDoseTime = '';

    const startDp = startDate ? parseDateParts(startDate) : null;
    if (startDp && freqSpec) {
      // Compare in floating UTC-style local calendar clock when refNow is Date (avoid TZ drift vs ref string)
      const tp = rawTime || { hour: 8, minute: 0 };
      const startClockMs = Date.UTC(startDp.year, startDp.month - 1, startDp.day, tp.hour, tp.minute, 0);
      let refClockMs = ref.ms;
      if (refNow instanceof Date && !Number.isNaN(refNow.getTime())) {
        refClockMs = Date.UTC(
          refNow.getFullYear(),
          refNow.getMonth(),
          refNow.getDate(),
          refNow.getHours(),
          refNow.getMinutes(),
          0
        );
      } else if (!ref.hasTime && ref.dateOnlyStr) {
        const refDp = parseDateParts(ref.dateOnlyStr);
        if (refDp) {
          refClockMs = Date.UTC(refDp.year, refDp.month - 1, refDp.day, tp.hour, tp.minute, 0);
        }
      }

      const elapsedHrs = (refClockMs - startClockMs) / 3600000;
      if (elapsedHrs < 0 && doseOffset <= 0) {
        scheduledDoses = 0;
        dosesGiven = 0;
        dayCount = 0;
        partialDoses = 0;
      } else {
        scheduledDoses = elapsedHrs < 0 ? 0 : 1 + Math.floor(elapsedHrs / freqSpec.intervalHrs);
        dosesGiven = Math.max(0, scheduledDoses + doseOffset);
        if (freqSpec.intervalHrs === 48) {
          const daysElapsedFloor = elapsedHrs < 0 ? 0 : Math.floor(elapsedHrs / 24);
          dayCount = dosesGiven <= 0 ? 0 : Math.min(dosesGiven * 2, Math.max(1, daysElapsedFloor + 1));
          partialDoses = 0;
        } else {
          dayCount = Math.floor(dosesGiven / freqSpec.dosesPerDay);
          partialDoses = dosesGiven % freqSpec.dosesPerDay;
        }
      }
      const nextStep = Math.max(1, (scheduledDoses || 0) + (elapsedHrs >= 0 ? 1 : 0));
      const nextMs = startClockMs + (elapsedHrs < 0 ? 0 : (nextStep - 1) * freqSpec.intervalHrs * 3600000);
      const nextDt = new Date(nextMs);
      nextDoseTime = `${String(nextDt.getUTCHours()).padStart(2, '0')}:${String(nextDt.getUTCMinutes()).padStart(2, '0')}`;
    } else if (startDp) {
      // Legacy date-only entry: calendar elapsed days starting at Day 0 on start date
      const rawDayOneBased = computeDayCount(startDate, ref.dateOnlyStr);
      dayCount = rawDayOneBased !== null ? Math.max(0, rawDayOneBased - 1) : null;
    }

    const dueSoon = Boolean(dayCount !== null && plannedDays && dayCount === plannedDays);
    const overdue = Boolean(
      dayCount !== null && ((plannedDays && dayCount > plannedDays) || (!plannedDays && dayCount >= 7))
    );

    let label = drug;
    if (dayCount !== null) {
      const plannedSuffix = plannedDays ? `/${plannedDays}` : '';
      const fracSuffix =
        dayCount === 0 && freqSpec && freqSpec.dosesPerDay > 1 && partialDoses !== null
          ? ` (${partialDoses}/${freqSpec.dosesPerDay})`
          : '';
      label = `${drug} D${dayCount}${plannedSuffix}${fracSuffix}`;
    } else if (plannedDays) {
      label = `${drug} (/${plannedDays}d)`;
    }

    out.push({
      drug,
      startDate,
      plannedDays,
      freq: freqSpec ? freqSpec.id : '',
      intervalHrs: freqSpec ? freqSpec.intervalHrs : null,
      dosesPerDay: freqSpec ? freqSpec.dosesPerDay : null,
      startTime,
      doseOffset,
      scheduledDoses,
      dosesGiven,
      partialDoses,
      nextDoseTime,
      dayCount,
      dueSoon,
      overdue,
      label,
    });
  }
  return out;
}

export function formatTrackedAntibiotics(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && String(it.drug || '').trim())
    .map((it) => {
      const drug = String(it.drug).trim();
      const start = String(it.startDate || '').trim();
      const planned = it.plannedDays ? String(it.plannedDays).trim() : '';
      const freq = normalizeAbxFreq(it.freq || '');
      const time = parseTimeParts(it.startTime || '') ? String(it.startTime).trim() : '';
      const offset = Number.isFinite(Number(it.doseOffset)) ? Math.trunc(Number(it.doseOffset)) : 0;

      const cols = [drug, start, planned, freq, time, offset !== 0 ? String(offset) : ''];
      while (cols.length > 1 && !cols[cols.length - 1]) cols.pop();
      return cols.join(' | ');
    })
    .join('; ');
}

export function parseCompletedAntibiotics(raw) {
  const text = String(raw || '').trim();
  if (!text || /^(?:none|nil|n\/a|-)$/i.test(text)) return [];
  const entries = text.split(/[;\n]/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const entry of entries) {
    const parts = entry.split('|').map((s) => s.trim());
    const drug = parts[0] || '';
    if (!drug) continue;
    const startDate = parts[1] || '';
    const completedDate = parts[2] || '';
    const daysNum = parseInt((parts[3] || '').replace(/[^\d]/g, ''), 10);
    const completedDays = Number.isFinite(daysNum) ? daysNum : null;
    const plannedNum = parseInt((parts[4] || '').replace(/[^\d]/g, ''), 10);
    const plannedDays = Number.isFinite(plannedNum) && plannedNum > 0 ? plannedNum : null;
    const freq = normalizeAbxFreq(parts[5] || '');
    const dayBadge =
      completedDays !== null
        ? ` D${completedDays}${plannedDays ? `/${plannedDays}` : ''}`
        : plannedDays
          ? ` (/${plannedDays}d)`
          : '';
    const dateSpan = [startDate, completedDate].filter(Boolean).join(' -> ');
    out.push({
      drug,
      startDate,
      completedDate,
      completedDays,
      plannedDays,
      freq,
      label: `${drug}${dayBadge}${dateSpan ? ` (${dateSpan})` : ''}`,
    });
  }
  return out;
}

export function formatCompletedAntibiotics(items = []) {
  return (Array.isArray(items) ? items : [])
    .filter((it) => it && String(it.drug || '').trim())
    .map((it) => {
      const cols = [
        String(it.drug).trim(),
        String(it.startDate || '').trim(),
        String(it.completedDate || '').trim(),
        it.completedDays !== null && it.completedDays !== undefined ? String(it.completedDays) : '',
        it.plannedDays ? String(it.plannedDays).trim() : '',
        normalizeAbxFreq(it.freq || ''),
      ];
      while (cols.length > 1 && !cols[cols.length - 1]) cols.pop();
      return cols.join(' | ');
    })
    .join('; ');
}

export function formatRoomLabel(room) {
  const clean = String(room || '').trim() || 'Unassigned';
  if (/^(?:room|rm\.?|bed|ward|icu|ccu|picu|nicu|er|or|pacu)\b/i.test(clean)) {
    return clean;
  }
  if (clean === 'Unassigned') return clean;
  return `Room ${clean}`;
}

export function getLatestShiftSegment(content) {
  const text = String(content || '');
  const dateHeadingRe = /^##\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4})/gim;
  const dateMatches = [...text.matchAll(dateHeadingRe)];

  let latestDate = '';
  let latestDateBlock = text;
  if (dateMatches.length > 0) {
    const lastMatch = dateMatches[dateMatches.length - 1];
    latestDate = lastMatch[1].trim().replace(/\//g, '-');
    latestDateBlock = text.slice(lastMatch.index);
  }

  const shiftHeadingRe =
    dateMatches.length > 0
      ? /^###\s*([^\n]+)$/gim
      : /^###\s*(6\s*am|2\s*pm|10\s*pm|morning|afternoon|night)\b/gim;
  const shiftMatches = [...latestDateBlock.matchAll(shiftHeadingRe)];
  let latestShift = '';
  let latestShiftBlock = latestDateBlock;
  if (shiftMatches.length > 0) {
    const lastShift = shiftMatches[shiftMatches.length - 1];
    latestShift = lastShift[1].trim();
    latestShiftBlock = latestDateBlock.slice(lastShift.index);
  }

  const hasShiftHeading = shiftMatches.length > 0 || (shiftHeadingRe.lastIndex = 0, shiftHeadingRe.test(text));

  return {
    latestDate,
    latestShift,
    latestDateBlock,
    latestShiftBlock,
    hasDateHeading: dateMatches.length > 0,
    hasShiftHeading,
  };
}

function splitShiftSections(blockText) {
  const shiftHeadingRe = /^###\s*(6\s*am|2\s*pm|10\s*pm|morning|afternoon|night)\b[^\n]*$/gim;
  const matches = [...String(blockText || '').matchAll(shiftHeadingRe)];
  if (!matches.length) return [];
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : blockText.length;
    out.push({
      shift: matches[i][1].replace(/\s+/g, '').toLowerCase(),
      rawShift: matches[i][1].trim(),
      block: blockText.slice(start, end),
    });
  }
  return out;
}

function isPendingStopLine(trimmed) {
  return (
    /^#{2,3}\s+/.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    /^(?:\*{0,2})(?:Service|Generic|General|Routine|[A-Za-z][A-Za-z\s/&+-]{1,25})\s+Plans?(?:\*{0,2})\s*:/i.test(trimmed) ||
    /^(?:\*{0,2})(?:Plans?|Meds?|Medications?|Feeding|Diet|Nutrition|Assessment|Impression|Problem\s+list|Subjective|Objective|If\s+ok|Vitals|VS|Vent|Shift\s+I&O|I&O|Drips?|Infusions?|Labs?|PE|Drains?|Greeting|Footer)\b[^:]*:/i.test(
      trimmed
    ) ||
    /^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i.test(trimmed)
  );
}

function extractPendingFromBlock(blockText) {
  const pending = [];
  const lines = String(blockText || '').split('\n');
  let inPendingSection = false;
  let sawPendingHeader = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^\s*\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?\s*$/i.test(trimmed)) {
      inPendingSection = true;
      sawPendingHeader = true;
      continue;
    }

    if (inPendingSection && isPendingStopLine(trimmed)) {
      inPendingSection = false;
    }

    const checkMatch = line.match(/^(\s*[-*]\s*\[([ xX])\]\s*)(.*)$/);
    if (checkMatch) {
      const taskText = checkMatch[3].trim();
      if (taskText) {
        pending.push({
          checked: checkMatch[2].toLowerCase() === 'x',
          text: taskText,
          lineIndex: i,
          rawLine: line,
        });
      }
      continue;
    }

    if (inPendingSection) {
      if (!trimmed) {
        inPendingSection = false;
        continue;
      }
      const itemMatch = line.match(/^\s*[-*]\s+([^#\n].*)$/);
      if (itemMatch) {
        const taskText = itemMatch[1].trim();
        if (taskText && !/^(?:none|nil|n\/a|-)$/i.test(taskText)) {
          pending.push({
            checked: false,
            text: taskText,
            lineIndex: i,
            rawLine: line,
          });
        }
      } else if (!/^[-*]\s*$/.test(trimmed) && !/^(?:none|nil|n\/a|-)$/i.test(trimmed)) {
        pending.push({
          checked: false,
          text: trimmed,
          lineIndex: i,
          rawLine: line,
        });
      }
    }
  }

  return { pending, sawPendingHeader };
}

function isAddendumOnlyBlock(blockText) {
  const s = String(blockText || '');
  const hasStructured =
    /^(?:[-*]\s*)?(?:Shift\s+I&O|I&O|Vitals|VS|Service\s+Plans?):/im.test(s) ||
    /^\s*\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?/im.test(s);
  return !hasStructured;
}

function parseFluidAmount(rawStr) {
  const s = String(rawStr || '').trim();
  if (!s) return null;
  const m = s.match(/^([+-]?\d{1,3}(?:,\d{3})*(?:\.\d+)?|[+-]?\d+(?:\.\d+)?)\s*(ml|cc|l)?(?:\b|$)/i);
  if (!m) return null;
  const rest = s.slice(m[0].length).trim();
  if (rest && /^(?:[+\/xX*-]|,\s*\d|(?:mg|mcg|g|kg|mEq|mmol|units?|%)\b)/i.test(rest)) {
    return null;
  }
  const value = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return { value, unit: m[2] || '' };
}

export function computeShiftFluidBalance(inRaw, outRaw) {
  const inAmt = parseFluidAmount(inRaw);
  const outAmt = parseFluidAmount(outRaw);
  if (!inAmt || !outAmt) return '';

  const uIn = inAmt.unit.toLowerCase();
  const uOut = outAmt.unit.toLowerCase();
  let inVal = inAmt.value;
  let outVal = outAmt.value;
  let unit = '';

  if (uIn === 'l' && uOut === 'l') {
    unit = inAmt.unit;
  } else if (uIn === 'l' && (uOut === 'ml' || uOut === 'cc')) {
    inVal *= 1000;
    unit = outAmt.unit;
  } else if (uOut === 'l' && (uIn === 'ml' || uIn === 'cc')) {
    outVal *= 1000;
    unit = inAmt.unit;
  } else if ((uIn === 'l' && !uOut) || (uOut === 'l' && !uIn)) {
    return '';
  } else {
    unit = inAmt.unit || outAmt.unit || '';
  }

  const roundSum = (sum) => {
    const rounded = Math.round(sum * 100) / 100;
    return Object.is(rounded, -0) ? 0 : rounded;
  };
  const cleanDiff = roundSum(inVal - outVal);
  return `${cleanDiff > 0 ? '+' : ''}${cleanDiff}${unit}`;
}

function sumFluidAmounts(amounts) {
  if (!Array.isArray(amounts) || !amounts.length) return null;
  let hasL = false;
  let hasMl = false;
  let hasUnitless = false;
  let preferredMlUnit = '';
  let preferredLUnit = '';

  for (const amt of amounts) {
    if (!amt || !Number.isFinite(amt.value)) return null;
    const u = String(amt.unit || '').toLowerCase();
    if (u === 'l') {
      hasL = true;
      if (!preferredLUnit) preferredLUnit = amt.unit;
    } else if (u === 'ml' || u === 'cc') {
      hasMl = true;
      if (!preferredMlUnit) preferredMlUnit = amt.unit;
    } else {
      hasUnitless = true;
    }
  }

  if (hasL && hasUnitless) return null;

  const convertL = hasL && hasMl;
  const outUnit = convertL ? preferredMlUnit : hasL ? preferredLUnit : preferredMlUnit;
  let total = 0;
  for (const amt of amounts) {
    const u = String(amt.unit || '').toLowerCase();
    total += convertL && u === 'l' ? amt.value * 1000 : amt.value;
  }
  const rounded = Math.round(total * 100) / 100;
  const cleanVal = Object.is(rounded, -0) ? 0 : rounded;
  return { value: cleanVal, unit: outUnit };
}

function formatSignedFluid(amt) {
  if (!amt || !Number.isFinite(amt.value)) return '';
  return `${amt.value > 0 ? '+' : ''}${amt.value}${amt.unit || ''}`;
}

function extractBalanceAmountFromIoText(ioText) {
  const s = String(ioText || '').trim();
  if (!s) return null;
  const m = s.match(
    /(?:^|[|/,;])\s*(?:FB|Net|Fluid\s+bal(?:ance)?|Balance)\s*(?:[:=]\s*|-\s+|\s+)([+-]?\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:ml|cc|l))?)(?=$|\s*[|/,;()])/i
  );
  if (!m) return null;
  return parseFluidAmount(m[1].replace(/\s+/g, ''));
}

const INLINE_24H_FB_RE = /\(\s*24\s*h(?:rs?|ours?)?\s*(?:Net|FB|Fluid\s+bal(?:ance)?|Balance)\s*[:=-]\s*([^)]+)\)/gi;

export function computeCumulativeFluidBalance(content, maxDays = 3) {
  const windowDays = Math.max(2, Number(maxDays) || 3);
  const body = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, '')
    .trim();
  if (!body) return null;

  const dateHeadingRe = /^##\s+([^\n]+)$/gm;
  const dateMatches = [...body.matchAll(dateHeadingRe)];
  if (!dateMatches.length) return null;

  const pad = (n) => String(n).padStart(2, '0');
  const daysMap = new Map();

  for (let i = 0; i < dateMatches.length; i++) {
    const rawDate = dateMatches[i][1].trim();
    if (/^admitting\s+history$/i.test(rawDate)) continue;
    const start = dateMatches[i].index + dateMatches[i][0].length;
    const end = i + 1 < dateMatches.length ? dateMatches[i + 1].index : body.length;
    const chunk = body.slice(start, end).trim();
    if (!chunk) continue;

    const parts = parseDateParts(rawDate);
    if (!parts) continue;
    const dayMs = Date.UTC(parts.year, parts.month - 1, parts.day);
    let dayEntry = daysMap.get(dayMs);
    if (!dayEntry) {
      dayEntry = {
        dayMs,
        canonicalDate: `${pad(parts.month)}-${pad(parts.day)}-${parts.year}`,
        shortDate: `${pad(parts.month)}-${pad(parts.day)}`,
        chunks: [],
      };
      daysMap.set(dayMs, dayEntry);
    }
    dayEntry.chunks.push(chunk);
  }

  if (daysMap.size < 2) return null;

  const latestMs = Math.max(...daysMap.keys());
  const recentDays = [...daysMap.values()]
    .filter((d) => {
      const diffDays = Math.round((latestMs - d.dayMs) / 86400000);
      return diffDays >= 0 && diffDays < windowDays;
    })
    .sort((a, b) => a.dayMs - b.dayMs);

  if (recentDays.length < 2) return null;

  const shiftHeadingRe = /^###\s*([^\n]+)$/gm;
  const dailyEntries = [];
  for (const day of recentDays) {
    let explicit24hAmt = null;
    const shiftAmounts = [];

    for (const chunk of day.chunks) {
      const shiftMatches = [...chunk.matchAll(shiftHeadingRe)];
      const shiftBodies = [];
      if (!shiftMatches.length) {
        shiftBodies.push(chunk);
      } else {
        const preShift = chunk.slice(0, shiftMatches[0].index).trim();
        if (preShift) shiftBodies.push(preShift);
        for (let i = 0; i < shiftMatches.length; i++) {
          const sStart = shiftMatches[i].index + shiftMatches[i][0].length;
          const sEnd = i + 1 < shiftMatches.length ? shiftMatches[i + 1].index : chunk.length;
          shiftBodies.push(chunk.slice(sStart, sEnd).trim());
        }
      }

      for (const shiftBody of shiftBodies) {
        const metrics = extractClinicalMetricsFromBlock(shiftBody);

        if (metrics.io24h) {
          const amt24 = extractBalanceAmountFromIoText(metrics.io24h);
          if (amt24) explicit24hAmt = amt24;
        }

        INLINE_24H_FB_RE.lastIndex = 0;
        let m24;
        while ((m24 = INLINE_24H_FB_RE.exec(shiftBody)) !== null) {
          const amt24 = parseFluidAmount(m24[1]);
          if (amt24) explicit24hAmt = amt24;
        }

        const shiftIoText =
          metrics.shiftIo || String(metrics.io || '').replace(/\s*·?\s*24\s*h:.*$/i, '').trim();
        if (shiftIoText) {
          const cleanedShiftIo = shiftIoText.replace(/\([^)]*\)/g, '').trim();
          const shiftBal = extractBalanceAmountFromIoText(cleanedShiftIo);
          if (shiftBal) shiftAmounts.push(shiftBal);
        }
      }
    }

    if (explicit24hAmt) {
      dailyEntries.push({
        date: day.canonicalDate,
        shortDate: day.shortDate,
        amount: explicit24hAmt,
        source: '24h',
      });
    } else if (shiftAmounts.length > 0) {
      const daySum = sumFluidAmounts(shiftAmounts);
      if (daySum) {
        dailyEntries.push({
          date: day.canonicalDate,
          shortDate: day.shortDate,
          amount: daySum,
          source: 'shifts',
        });
      }
    }
  }

  if (dailyEntries.length < 2) return null;

  const totalAmt = sumFluidAmounts(dailyEntries.map((d) => d.amount));
  if (!totalAmt) return null;

  const totalText = formatSignedFluid(totalAmt);
  const dailyBreakdown = dailyEntries.map((d) => ({
    date: d.date,
    shortDate: d.shortDate,
    text: formatSignedFluid(d.amount),
    source: d.source,
  }));
  const breakdownText = dailyBreakdown.map((b) => `${b.shortDate}: ${b.text}`).join(' · ');
  const label = `${dailyEntries.length}d Cum FB`;

  return {
    daysCount: dailyEntries.length,
    windowDays,
    totalText,
    label,
    summaryText: `${label}: ${totalText}`,
    dailyBreakdown,
    breakdownText,
    hasPartialDay: dailyEntries.some((d) => d.source === 'shifts'),
  };
}

function enrichInlineIO(rawVal) {
  const val = String(rawVal || '')
    .replace(/\s*\(\s*24h\s+(?:Net|FB|Fluid\s+Bal(?:ance)?)\s*:\s*\)/i, '')
    .trim();
  if (!val) return '';

  const withoutParens = val.replace(/\([^)]*\)/g, '');
  if (/(?:^|[|/,;])\s*(?:Net|FB|Fluid\s+bal(?:ance)?|Balance)\s*(?:[:=]\s*|-\s+|\s+)[+-]?\s*\d/i.test(withoutParens)) {
    return val;
  }

  const inMatch = val.match(/(?:^|[|/,;])\s*(?:Input|Intake|In|I)\s*(?:[:=]|-)\s*((?:\d{1,3},\d{3}|[^|/,;])+)/i);
  const outMatch = val.match(/(?:^|[|/,;])\s*(?:Output|Out|O)\s*(?:[:=]|-)\s*((?:\d{1,3},\d{3}|[^|/,;])+)/i);
  if (!inMatch || !outMatch) return val;

  const computed = computeShiftFluidBalance(inMatch[1], outMatch[1]);
  if (!computed) return val;

  const emptyBalRe = /(\|\s*)(?:Net|FB|Fluid\s+bal(?:ance)?|Balance)\s*[:=-]?\s*(?=$|\||\/|\()/i;
  if (emptyBalRe.test(val)) {
    return val
      .replace(emptyBalRe, `$1FB: ${computed} `)
      .replace(/\s{2,}(?=\||$)/g, ' ')
      .replace(/\s+\(/g, ' (')
      .trim();
  }

  return `${val} | FB: ${computed}`;
}

function createStackedIOAccumulator() {
  return { parts: [], inRaw: '', outRaw: '', inCount: 0, outCount: 0, hasBalance: false };
}

function finalizeStackedIO(acc) {
  if (!acc || !acc.parts.length) return '';
  const parts = [...acc.parts];
  if (!acc.hasBalance && acc.inCount === 1 && acc.outCount === 1) {
    const computedFb = computeShiftFluidBalance(acc.inRaw, acc.outRaw);
    if (computedFb) parts.push(`FB: ${computedFb}`);
  }
  return parts.join(' | ');
}

const isSectionBoundary = (trimmed, { inLabs = false } = {}) =>
  /^#{2,3}\s+/.test(trimmed) ||
  /^\*{0,2}(?:Subjective|Objective|Assessment|Impression|Problem\s+list|Plans?|Pending(?:\s+(?:labs?|items|list))?|(?:Service|Generic|General|Routine|[A-Za-z][A-Za-z\s/&+-]{1,25})\s+Plans?|If\s+ok|Medications?|Meds?|Current\s+Meds?|Active\s+Meds?|Therapeutics|Labs?|Laboratory(?:\s+updates?)?|Feeding|Diet|Nutrition|Thank\s+you)(?:\*{0,2})\s*:?\s*$/i.test(
    trimmed
  ) ||
  /^\*{0,2}(?:Subjective|Objective|Assessment|Impression|Problem\s+list|Plans?|Pending(?:\s+(?:labs?|items|list))?|Service\s+Plans?|Generic\s+Plans?|If\s+ok|Vitals|VS|Vent|Ventilator|Shift\s+I&O|I&O|Drips?|Infusions?|Medications?|Meds?|Current\s+Meds?|Active\s+Meds?|Therapeutics|Labs?|Laboratory(?:\s+updates?)?|HGTs?|CBGs?|Contingenc(?:y|ies)|If\s*\/\s*Then|Feeding|Diet|Nutrition|PE|Drains?|Greeting|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?)\b(?:\s*:|\*{0,2}:)/i.test(
    trimmed
  ) ||
  /^(?:BP|HR|PR|RR|Tmax|Temp|O2|O2sat|SpO2|Fb|HGTs?|CBGs?|Awake,|HEENT:|C\/L:|CVS:|ABD:|EXT:)\b/i.test(
    trimmed
  ) ||
  /^(?:I|O|In|Out|Input|Output|Intake)(?:\s*(?:[:=]|-(?=\s|$|\d))|\s+(?:~|approx\.?\s*)?\d)/i.test(trimmed) ||
  /^(?:Fluid\s+bal(?:ance)?|Net|Balance)\s*(?:[:=]|-(?=\s|$|\d))/i.test(trimmed) ||
  /^(?:On\s+)?(?:APVCMV|PCMV|AC\/?VC|AC\/?PC|VC-?CMV|PC-?CMV|PRVC|SIMV|SPONT|ASV|PSV|CPAP|BiPAP|NIV|HFNC)\b/i.test(
    trimmed
  ) ||
  /^(?:Ppeak|Pplat|VTE|VT|TV|MV|EMV|PEEP|FT|fTotal|I:E|PIP)\s*(?:[:=]\s*|\s+)\d/i.test(trimmed) ||
  (!inLabs && /^FiO2\s*(?:[:=]\s*|\s+)\d/i.test(trimmed)) ||
  /^(?:24\s*-?\s*h(?:r|rs|our|ours)?(?:\s+I&O)?|\d{1,2}\s*-\s*\d{1,2}\s*(?:am|pm|a|p)|\d{1,2}(?:am|pm|a|p)\s*-\s*\d{1,2}(?:am|pm|a|p)|8\s*hrs?)\s*:?$/i.test(
    trimmed
  );

const STANDALONE_LAB_LINE_RE =
  /^(?:[-*]\s*)?(?:Serum\s+)?(?:Na\+?|Sodium|K\+?|Potassium|Cl-?|Chloride|CO2|HCO3-?|Bicarb(?:onate)?|iCa|Ionized\s+Ca(?:lcium)?|Ca2?\+?|Calcium|Mg2?\+?|Magnesium|Phos(?:phorus|phate)?|PO4|BUN|Urea|Cr|Crea(?:tinine)?|SCr|eGFR|GFR|Alb(?:umin)?|AST|SGOT|ALT|SGPT|ALP|Alk\.?\s*Phos|TBili|TBil|TBDBIB|DBili|IBili|Bilirubin|LDH|Amylase|Lipase|WBC|Hgb|Hb|Hct|Plt|Platelets?|Neu(?:t(?:rophils?)?)?|Lym(?:ph(?:ocytes?)?)?|Mono?s?|Eo(?:s(?:inophils?)?)?|pH|PaCO2|pCO2|PaO2|pO2|SaO2|sO2|BE|Base\s+Excess|Lactate|Lac|Trop(?:onin)?(?:\s*-?\s*[IT])?|BNP|NT-?proBNP|CK-?MB|CPK|Procal(?:citonin)?|PCT|CRP|ESR|Ferritin|D-?dimer|INR|PT|Protime|aPTT|PTT|TSH|FT3|FT4|HbA1c|Chole(?:sterol)?|Trigly(?:cerides?)?|HDL|LDL|VLDL|Uric\s+Acid|BUA|Ammonia|NH3)(?![\p{L}\p{N}])(?:\s*[:=]\s*|\s+)-?\d/iu;

export function extractClinicalMetricsFromBlock(blockText) {
  const lines = String(blockText || '').split('\n');
  const consumedLineIndices = new Set();

  let vitals = '';
  let vent = '';
  let io = '';
  let io24h = '';
  let ioWindow = '';
  let drips = '';
  const labItems = [];
  const vitalParts = [];
  const ventParts = [];
  const dripParts = [];
  const hgtParts = [];

  const labHdrParts = [];
  let pendingLabPrefix = '';
  const pushLabItem = (txt) => {
    const clean = String(txt || '').trim();
    if (!clean || /^none$/i.test(clean)) return;
    if (pendingLabPrefix) {
      labItems.push(`${pendingLabPrefix}: ${clean}`);
      pendingLabPrefix = '';
    } else {
      labItems.push(clean);
    }
  };
  void labHdrParts;

  const shiftIo = createStackedIOAccumulator();
  const dayIo = createStackedIOAccumulator();
  let ioContext = null; // 'shift' | '24h' | null

  let inLabsSection = false;
  let inPendingSection = false;
  let inServicePlans = false;
  let inMedsSection = false;
  let inDripsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      inLabsSection = false;
      pendingLabPrefix = '';
      inPendingSection = false;
      inServicePlans = false;
      inMedsSection = false;
      inDripsSection = false;
      ioContext = null;
      continue;
    }

    if (/^\*{0,2}Pending(?:\s+(?:labs?|items|list))?(?:\*{0,2})(?:\s*:.*|\s*)$/i.test(trimmed)) {
      inLabsSection = false;
      pendingLabPrefix = '';
      inPendingSection = true;
      inServicePlans = false;
      inMedsSection = false;
      inDripsSection = false;
      ioContext = null;
      continue;
    }
    if (
      /^(?:\*{0,2})(?:(?:Service|Generic|General|Routine|[A-Za-z][A-Za-z\s/&+-]{1,25})\s+Plans?|Plans?)(?:\*{0,2})\s*:?\s*$/i.test(
        trimmed
      )
    ) {
      inLabsSection = false;
      pendingLabPrefix = '';
      inPendingSection = false;
      inServicePlans = true;
      inMedsSection = false;
      inDripsSection = false;
      ioContext = null;
      continue;
    }
    if (
      /^(?:#{2,6}\s+)?(?:\*{0,2})(?:(?:Current|Active)\s+)?(?:Medications?|Meds?)(?:\s*\/\s*Drips?)?(?:\*{0,2})(?:\s*:.*|\s*)$/i.test(
        trimmed
      ) ||
      /^(?:\*{0,2})Therapeutics(?:\*{0,2})\s*:/i.test(trimmed)
    ) {
      inLabsSection = false;
      pendingLabPrefix = '';
      inPendingSection = false;
      inServicePlans = false;
      inMedsSection = true;
      inDripsSection = false;
      ioContext = null;
      continue;
    }

    if (inDripsSection) {
      if (isSectionBoundary(trimmed) || /^---+$/.test(trimmed)) {
        inDripsSection = false;
      } else {
        const cleanDripLine = trimmed.replace(/^[-*•]\s+/, '').trim();
        if (cleanDripLine) dripParts.push(cleanDripLine);
        consumedLineIndices.add(i);
        continue;
      }
    }

    if (inPendingSection) {
      if (isPendingStopLine(trimmed) || isSectionBoundary(trimmed)) {
        inPendingSection = false;
      } else {
        continue;
      }
    }
    if (inServicePlans) {
      if (isPendingStopLine(trimmed) || isSectionBoundary(trimmed)) {
        inServicePlans = false;
      } else {
        continue;
      }
    }
    if (inMedsSection) {
      if (isSectionBoundary(trimmed)) {
        inMedsSection = false;
      } else {
        continue;
      }
    }
    if (/^[-*]\s*\[[ xX]\]/.test(trimmed)) {
      inLabsSection = false;
      pendingLabPrefix = '';
      continue;
    }

    // Labs header (inline and/or multi-line stacked, including "Relaying labs" / "**Relaying")
    const labHdrMatch =
      trimmed.match(
        /^(?:[-*]\s*)?(?:\*{0,2})(?:Labs?|Lab(?:oratory)?\s+updates?|Lab\s+results?|Relaying\s+labs?)(?:\*{0,2})(?:\s*:\s*(.*)|\s*)$/i
      ) || trimmed.match(/^(?:[-*]\s*)?(?:\*{2}Relaying\*{0,2}|Relaying:)\s*(.*)$/i);
    if (labHdrMatch) {
      consumedLineIndices.add(i);
      inLabsSection = true;
      pendingLabPrefix = '';
      ioContext = null;
      const inlineLabs = (labHdrMatch[1] || '').trim();
      if (inlineLabs) {
        for (const piece of inlineLabs.split('|')) {
          pushLabItem(piece);
        }
      }
      continue;
    }

    // Panel subheaders (e.g. "CBC", "ABG", "ABG w/ lactate", "iSTAT")
    const labSubHdrMatch = trimmed.match(
      /^(?:[-*]\s*)?\*{0,2}((?:CBC|Chem(?:istry)?|Electrolytes?|Elec\s+panel|BMP|CMP|ABG|VBG|iSTAT|Coags?|Coagulation|LFTs?|Lipids?|Urinalysis|UA)(?:\s+(?:w\/?\s*lactate|post[\s-]*HD|pre[\s-]*HD|repeat|\([^)]+\)))?)\*{0,2}(?:\s*:\s*(.*)|\s+((?=.*\d).*)|\s*)$/i
    );
    if (labSubHdrMatch) {
      consumedLineIndices.add(i);
      inLabsSection = true;
      pendingLabPrefix = '';
      ioContext = null;
      const panel = labSubHdrMatch[1].trim();
      const restColon = (labSubHdrMatch[2] || '').trim();
      const restNum = (labSubHdrMatch[3] || '').trim();
      if (restColon) {
        let first = true;
        for (const piece of restColon.split('|')) {
          const clean = piece.trim();
          if (!clean) continue;
          labItems.push(first ? `${panel}: ${clean}` : clean);
          first = false;
        }
      } else if (restNum) {
        labItems.push(`${panel} ${restNum}`);
      } else {
        pendingLabPrefix = panel;
      }
      continue;
    }

    // Imaging / Diagnostic / Culture subheaders (CXR, 12L ECG, Blood CS, FOBT)
    const cxrMatch = trimmed.match(
      /^(?:[-*]\s*)?\*{0,2}((?:Repeat\s+)?(?:CXR|Chest\s+X-?ray)(?:\s+(?:AP|PA|portable|post[\s-]*HD|pre[\s-]*HD|post[\s-]*intubation|\([^)]+\))){0,3})\*{0,2}(?:\s*[:–-]\s*(.*)|\s*)$/i
    );
    const ecgMatch = trimmed.match(
      /^(?:[-*]\s*)?\*{0,2}((?:Repeat\s+)?(?:12\s*-?\s*L(?:ead)?\s*ECG|12lecg|ECG|EKG)(?:\s*\([^)]+\))?)\*{0,2}\s*[:–-]\s*(.+)$/i
    );
    const cultureMatch = trimmed.match(
      /^(?:[-*]\s*)?\*{0,2}((?:Blood|Sputum|Urine)\s+C\/?S(?:\s+[^:\n-]{1,40})?|FOBT)\*{0,2}(?:\s*[:–-]\s*(.+)|\s+(Positive.*|Negative.*)|\s*)$/i
    );
    const diagMatch = cxrMatch || ecgMatch || cultureMatch;
    if (diagMatch) {
      consumedLineIndices.add(i);
      inLabsSection = true;
      pendingLabPrefix = '';
      ioContext = null;
      const label = diagMatch[1].trim();
      const inlineDiag = (diagMatch[2] || diagMatch[3] || '').trim();
      if (inlineDiag) {
        labItems.push(`${label}: ${inlineDiag}`);
      } else {
        pendingLabPrefix = label;
      }
      continue;
    }

    if (inLabsSection) {
      if (isSectionBoundary(trimmed, { inLabs: true })) {
        inLabsSection = false;
        pendingLabPrefix = '';
      } else {
        consumedLineIndices.add(i);
        const cleanLab = trimmed.replace(/^[-*]\s+/, '').trim();
        pushLabItem(cleanLab);
        continue;
      }
    }

    // Standalone lab analyte lines outside explicit Labs: blocks (e.g. "K: 3.6 (3.2)", "Serum K: 3.4", "Na 140")
    if (
      /\d/.test(trimmed) &&
      STANDALONE_LAB_LINE_RE.test(trimmed) &&
      !/^[-*\s]*pt\s+\d+\s*(?:yo|y\/o|yrs?|years?|room|bed|\/[mf]\b)/i.test(trimmed) &&
      !/^[-*\s]*pt\s+\d+\s*$/i.test(trimmed) &&
      !/^[-*\s]*CR\s+\d{2,3}\b/.test(trimmed)
    ) {
      consumedLineIndices.add(i);
      inLabsSection = true;
      ioContext = null;
      pushLabItem(trimmed.replace(/^[-*]\s+/, '').trim());
      continue;
    }

    // Inline Vitals
    if (/^(?:[-*]\s*)?(?:Vitals|VS):\s*/i.test(trimmed)) {
      consumedLineIndices.add(i);
      ioContext = null;
      if (!vitals) {
        const val = trimmed.replace(/^(?:[-*]\s*)?(?:Vitals|VS):\s*/i, '').trim();
        if (val && !/^BP\s*\|\s*HR\s*\|\s*RR\s*\|\s*T\s*\|\s*O2sat\s*%\s*on\s*RA$/i.test(val)) {
          vitals = val;
        }
      }
      continue;
    }

    // Stacked Vitals lines: BP, HR, PR, RR, Tmax, Temp, T, O2sat, SpO2, O2
    const vitalLineMatch = trimmed.match(
      /^(?:[-*]\s*)?(BP|HR|PR|RR|Tmax|Temp|T|O2sat|SpO2|O2)\b(?:\s*[:=]\s*|\s+|$)(.*)$/i
    );
    if (vitalLineMatch) {
      const rawKey = vitalLineMatch[1];
      const rawVal = vitalLineMatch[2].trim();
      const keyUpper = rawKey.toUpperCase();
      const hasValue = /\d/.test(rawVal);
      if (!rawVal || hasValue) {
        consumedLineIndices.add(i);
        ioContext = null;
        if (hasValue) {
          let label = keyUpper;
          if (keyUpper === 'TEMP') label = 'T';
          else if (keyUpper === 'TMAX') label = 'Tmax';
          else if (keyUpper === 'PR') label = 'HR';
          else if (keyUpper === 'O2SAT' || keyUpper === 'SPO2') label = 'O2';
          vitalParts.push(`${label} ${rawVal}`);
        }
        continue;
      }
    }

    // Inline Vent
    if (/^(?:[-*]\s*)?(?:Vent(?:ilator)?|Settings):\s*/i.test(trimmed)) {
      consumedLineIndices.add(i);
      ioContext = null;
      if (!vent) {
        const val = trimmed.replace(/^(?:[-*]\s*)?(?:Vent(?:ilator)?|Settings):\s*/i, '').trim();
        if (val) vent = val;
      }
      continue;
    }

    // Stacked Vent mode or parameters/returns without "Vent:" prefix
    const cleanVentCandidate = trimmed.replace(/^[-*]\s+/, '').trim();
    if (
      /^(?:On\s+)?(?:APVCMV|PCMV|AC\/?VC|AC\/?PC|VC-?CMV|PC-?CMV|PRVC|SIMV|SPONT|ASV|PSV|CPAP|BiPAP|NIV|HFNC)\b/i.test(
        cleanVentCandidate
      ) ||
      /^(?:Ppeak|Pplat|VTE|VT|TV|MV|EMV|PEEP|FiO2|FT|fTotal|I:E|PIP)\s*(?:[:=]\s*|\s+)\d/i.test(cleanVentCandidate)
    ) {
      consumedLineIndices.add(i);
      ioContext = null;
      ventParts.push(cleanVentCandidate);
      continue;
    }

    // Shift-window I&O header (e.g. "10-6am", "10-6a", "6am-2pm")
    const windowHdrMatch = trimmed.match(
      /^(?:[-*]\s*)?(\d{1,2}\s*-\s*\d{1,2}\s*(?:am|pm|a|p)|\d{1,2}(?:am|pm|a|p)\s*-\s*\d{1,2}(?:am|pm|a|p)|8\s*hrs?)\s*:?$/i
    );
    if (windowHdrMatch) {
      consumedLineIndices.add(i);
      ioContext = 'shift';
      if (!ioWindow) ioWindow = windowHdrMatch[1].trim();
      continue;
    }

    // 24h I&O header (e.g. "24hrs", "24h", "24hr I&O:")
    if (/^(?:[-*]\s*)?(?:24\s*-?\s*h(?:r|rs|our|ours)?(?:\s+I&O)?)\s*:?$/i.test(trimmed)) {
      consumedLineIndices.add(i);
      ioContext = '24h';
      continue;
    }

    // Inline Shift I&O
    if (/^(?:[-*]\s*)?(?:Shift\s+I&O|I&O):\s*/i.test(trimmed)) {
      consumedLineIndices.add(i);
      ioContext = null;
      if (!io) {
        const val = trimmed.replace(/^(?:[-*]\s*)?(?:Shift\s+I&O|I&O):\s*/i, '').trim();
        if (val && !/^In:\s*\|\s*Out:\s*\|\s*(?:Net|FB):\s*(?:\(24h\s+(?:Net|FB):\s*\))?$/i.test(val)) {
          io = enrichInlineIO(val);
        }
      }
      continue;
    }

    // Stacked I&O lines: I-/I:/I <num>, O-/O:/O <num>, Fb/Fluid balance:/Net:/Balance:
    let stackedType = '';
    let stackedVal = '';
    let netLabel = 'FB:';

    const inMatch = trimmed.match(
      /^(?:[-*]\s*)?(?:I|In|Input|Intake)(?:\s*(?:[:=]|-(?=\s|$|\d))\s*(.*)|\s+((?:~|approx\.?\s*)?\d[\d,]*(?:\.\d+)?.*))$/i
    );
    if (inMatch) {
      stackedType = 'in';
      stackedVal = (inMatch[1] ?? inMatch[2] ?? '').trim();
    } else {
      const outMatch = trimmed.match(
        /^(?:[-*]\s*)?(?:O|Out|Output)(?:\s*(?:[:=]|-(?=\s|$|\d))\s*(.*)|\s+((?:~|approx\.?\s*)?\d[\d,]*(?:\.\d+)?.*))$/i
      );
      if (outMatch) {
        stackedType = 'out';
        stackedVal = (outMatch[1] ?? outMatch[2] ?? '').trim();
      } else {
        const fbMatch = trimmed.match(
          /^(?:[-*]\s*)?(?:Fb|Fluid\s+bal(?:ance)?)(?:\s*[:=]\s*|-\s+|-$|\s+|$|(?=[+-]\d))(.*)$/i
        );
        if (fbMatch) {
          stackedType = 'bal';
          netLabel = 'FB:';
          stackedVal = fbMatch[1].trim();
        } else {
          const netMatch = trimmed.match(/^(?:[-*]\s*)?(Net|Balance)(?:\s*[:=]\s*|-\s+|-$)(.*)$/i);
          if (netMatch) {
            stackedType = 'bal';
            netLabel = /^net$/i.test(netMatch[1]) ? 'Net:' : 'FB:';
            stackedVal = netMatch[2].trim();
          }
        }
      }
    }

    if (stackedType) {
      const hasValue = /^(?:~|approx\.?\s*|\([+-]\)\s*|pos(?:itive)?\s*|neg(?:ative)?\s*)?[+-]?\s*\d/i.test(
        stackedVal
      );
      if (!stackedVal || hasValue) {
        consumedLineIndices.add(i);
        const activeAcc = ioContext === '24h' ? dayIo : shiftIo;
        if (!ioContext) ioContext = 'shift';
        if (hasValue) {
          if (stackedType === 'in') {
            activeAcc.inRaw = stackedVal;
            activeAcc.inCount += 1;
            activeAcc.parts.push(`In: ${stackedVal}`);
          } else if (stackedType === 'out') {
            activeAcc.outRaw = stackedVal;
            activeAcc.outCount += 1;
            activeAcc.parts.push(`Out: ${stackedVal}`);
          } else {
            activeAcc.hasBalance = true;
            activeAcc.parts.push(`${netLabel} ${stackedVal}`);
          }
        }
        continue;
      }
    }

    // Standalone signed fluid balance inside an active I&O block (e.g. "(+) 996", "(-) 200", "(+796)", "+796")
    if (ioContext === 'shift' || ioContext === '24h') {
      const activeAcc = ioContext === '24h' ? dayIo : shiftIo;
      if (activeAcc.inCount > 0 || activeAcc.outCount > 0) {
        const signedBalMatch = trimmed.match(
          /^(?:[-*]\s*)?(?:\(\s*([+-])\s*\)\s*(\d[\d,]*(?:\.\d+)?(?:\s*(?:ml|cc|l))?)|\(\s*([+-]\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:ml|cc|l))?)\s*\)|([+-])\s*(\d[\d,]*(?:\.\d+)?(?:\s*(?:ml|cc|l))?))(?:\s*\([^)]*\))?$/i
        );
        if (signedBalMatch) {
          const normalizedBal = signedBalMatch[3]
            ? signedBalMatch[3].replace(/\s+/g, '')
            : `${signedBalMatch[1] || signedBalMatch[4]}${signedBalMatch[2] || signedBalMatch[5]}`;
          consumedLineIndices.add(i);
          activeAcc.hasBalance = true;
          activeAcc.parts.push(`FB: ${normalizedBal}`);
          continue;
        }
      }
    }

    // Drips header (supports inline "Drips: a | b" and stacked multi-line "Drips:\nline1\nline2")
    const dripsHeaderMatch = trimmed.match(/^(?:[-*]\s*)?(?:\*{0,2})(?:Drips?|Infusions?)(?:\*{0,2})(?:\s*:\s*(.*)|\s*)$/i);
    if (dripsHeaderMatch) {
      consumedLineIndices.add(i);
      ioContext = null;
      inLabsSection = false;
      inPendingSection = false;
      inServicePlans = false;
      inMedsSection = false;
      inDripsSection = true;
      const val = String(dripsHeaderMatch[1] || '').trim();
      if (val) dripParts.push(val);
      continue;
    }

    // Standalone IVF / Infusion rate line (e.g. "PLR 40cc/hr", "PNSS 80ml/hr")
    const cleanDrip = trimmed.replace(/^[-*]\s+/, '').trim();
    if (
      /^(?:PLR|PNSS|Plain\s+NSS|NSS|D5NSS|D5LR|D5W|D5NM|D5IMB|D5\s*0\.3\s*NaCl|0\.9%\s*NaCl|LR|LRS|Sterofundin)\b.*(?:cc\/?hr|ml\/?hr|ml\/?h|cc\/?h|gtts\/?min|x\s*\d+\s*h(?:rs?)?|@\s*\d)/i.test(
        cleanDrip
      )
    ) {
      consumedLineIndices.add(i);
      dripParts.push(cleanDrip);
      continue;
    }

    // HGT / CBG lines
    const hgtMatch = trimmed.match(/^(?:[-*]\s*)?(?:HGTs?|CBGs?)\b(?:\s*[:=]\s*|\s+|$)(.*)$/i);
    if (hgtMatch) {
      const rawVal = hgtMatch[1].trim();
      if (!rawVal || /\d/.test(rawVal)) {
        consumedLineIndices.add(i);
        ioContext = null;
        if (rawVal) hgtParts.push(rawVal);
        continue;
      }
    }
  }

  if (!vitals && vitalParts.length > 0) {
    vitals = vitalParts.join(' | ');
  }
  if (!vent && ventParts.length > 0) {
    vent = ventParts.join(' | ');
  }
  if (!drips && dripParts.length > 0) {
    drips = dripParts.join(' | ');
  }

  io24h = finalizeStackedIO(dayIo);
  if (!io) {
    io = finalizeStackedIO(shiftIo);
  }
  const shiftIoOnly = io;
  if (io && io24h && !/24\s*h/i.test(io)) {
    io = `${io} · 24h: ${io24h}`;
  } else if (!io && io24h) {
    io = `24h: ${io24h}`;
  }

  return {
    vitals,
    vent,
    io,
    shiftIo: shiftIoOnly,
    io24h,
    ioWindow,
    drips,
    labs: labItems.join(' | '),
    hgt: hgtParts.join(' | '),
    consumedLineIndices,
  };
}

const CHART_HEADER_CACHE_MAX = 128;
const chartHeaderCache = new Map();

function cloneChartHeader(hdr) {
  return {
    ...hdr,
    meta: { ...hdr.meta },
    aliases: [...hdr.aliases],
    categories: [...hdr.categories],
  };
}

export function parseChartHeader(content, note = {}) {
  const text = String(content || '');
  const noteName = note?.name ? String(note.name) : '';
  const noteRoom = note?.room ? String(note.room) : '';
  const noteTitle = note?.sourceFileName || note?.title ? String(note.sourceFileName || note.title) : '';
  const noteAliases = Array.isArray(note?.aliases)
    ? note.aliases.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const cacheKey =
    noteName || noteRoom || noteTitle || noteAliases.length
      ? `${noteName}\u0001${noteRoom}\u0001${noteTitle}\u0001${noteAliases.join('\u0002')}\u0000${text}`
      : text;

  const cached = chartHeaderCache.get(cacheKey);
  if (cached) return cloneChartHeader(cached);

  const meta = metaOf(text);
  const fileDerived = parseRoomAndNameFromTitle(noteTitle);

  const name =
    String(note?.name || meta.name || meta.patient || fileDerived.name || '').trim() ||
    'Unknown Patient';
  const room =
    String(note?.room || meta.room || meta.bed || meta.rm || fileDerived.room || '').trim() ||
    'Unassigned';
  const age = meta.age || '';
  const sex = meta.sex || meta.gender || '';
  const weight = meta.weight || meta.wt || meta.weight_kg || meta['weight (kg)'] || '';
  const service = meta.service || meta.dept || meta.specialty || '';
  const ap = meta.ap || meta.attending || '';
  const assessment = meta.assessment || meta.impression || meta.dx || '';

  const rawMetaAliases = String(meta.aliases || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const aliases = [...new Set([...noteAliases, ...rawMetaAliases])];

  const rawCats = String(meta.categories || meta.tags || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seenCats = new Set();
  const categories = [];
  for (const c of rawCats) {
    const key = c.toLowerCase();
    if (!seenCats.has(key)) {
      seenCats.add(key);
      categories.push(c);
    }
  }
  const isCharity =
    /^true(?:\s+#.*)?$/i.test(String(meta.charity || '').trim()) ||
    categories.some((c) => c.toLowerCase() === 'charity');
  if (isCharity && !categories.some((c) => c.toLowerCase() === 'charity')) {
    categories.push('Charity');
  }
  const isCensus = /^true(?:\s+#.*)?$/i.test(String(meta.census || '').trim());

  const result = {
    meta,
    name,
    room,
    age,
    sex,
    weight,
    service,
    ap,
    aliases,
    assessment,
    categories,
    isCharity,
    isCensus,
  };
  if (chartHeaderCache.size >= CHART_HEADER_CACHE_MAX) {
    chartHeaderCache.delete(chartHeaderCache.keys().next().value);
  }
  chartHeaderCache.set(cacheKey, result);
  return cloneChartHeader(result);
}

export function parseChart(content, note = {}) {
  const text = String(content || '');
  const hdr = parseChartHeader(text, note);
  const {
    meta,
    name,
    room,
    age,
    sex,
    weight,
    service,
    ap,
    aliases,
    categories,
    isCharity,
    isCensus,
  } = hdr;
  const today = getTodayDateStrings();
  const segment = getLatestShiftSegment(text);

  const admitted = meta.admitted || meta['date admitted'] || '';
  const heightCm = meta.height_cm || meta.height || '';
  const icuAdmitted = meta.icu_admitted || meta['icu admitted'] || '';
  const codeStatus = meta.code_status || meta['code status'] || meta.code || '';
  const severity = meta.severity || meta.illness_severity || '';
  const allergies = meta.allergies || meta.allergy || '';
  const isolation = String(meta.isolation || meta.precautions || '')
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^(?:none|nil|n\/a|-)$/i.test(s));
  const rawContingencies = meta.contingencies || meta.contingency || meta.if_then || '';
  const hospitalDay = admitted ? computeDayCount(admitted, today.mmddyyyy) : null;
  const icuDay = icuAdmitted ? computeDayCount(icuAdmitted, today.mmddyyyy) : null;
  const trackedLines = parseTrackedLines(meta.lines || meta.lda || '', today.mmddyyyy);
  const trackedAntibiotics = parseTrackedAntibiotics(meta.antibiotics || meta.abx || '', new Date());
  const completedAntibiotics = parseCompletedAntibiotics(meta.antibiotics_completed || '');

  const { latestDate, latestShift, latestDateBlock, latestShiftBlock } = segment;

  // Check if updated today
  const isUpdatedToday = Boolean(latestDate && datesMatch(latestDate, today.mmddyyyy));

  // Extract Assessment / Impression
  let assessment = hdr.assessment || '';
  if (!assessment) {
    const lines = latestDateBlock.split('\n');
    for (const line of lines) {
      const match = line.match(/^(?:[-*]\s*)?(?:Assessment|Impression|Diagnosis|Dx|Problem(?:s)?|Status):\s*(.*)$/i);
      if (match && match[1].trim()) {
        assessment = match[1].trim();
        break;
      }
    }
  }

  // Extract Vitals / Vent / I&O / HGT / Drips / Labs from latest shift block, falling back newest-to-oldest in latestDateBlock
  const shiftBlocksDesc = splitAnyShiftBlocks(latestDateBlock).reverse();
  const searchBlocks = shiftBlocksDesc.length
    ? shiftBlocksDesc.map((s) => s.block)
    : [latestShiftBlock, latestDateBlock, text];

  let vitals = '';
  let vent = '';
  let io = '';
  let hgt = '';
  let drips = '';
  let labs = '';
  for (const blk of searchBlocks) {
    const m = extractClinicalMetricsFromBlock(blk);
    if (!vitals && m.vitals) vitals = m.vitals;
    if (!vent && m.vent) vent = m.vent;
    if (!io && m.io) io = m.io;
    if (!hgt && m.hgt) hgt = m.hgt;
    if (!drips && m.drips) drips = m.drips;
    if (!labs && m.labs) labs = m.labs;
    if (vitals && vent && io && hgt && drips && labs) break;
  }

  // Extract Service Plans & Pending items from latest shift block (prevents cross-shift duplication)
  let servicePlans = extractServicePlansFromBlock(latestShiftBlock);
  let servicePlanGroups = extractServicePlanGroupsFromBlock(latestShiftBlock);
  if (servicePlans.length === 0 && isAddendumOnlyBlock(latestShiftBlock)) {
    for (let i = 1; i < searchBlocks.length; i++) {
      const prevPlans = extractServicePlansFromBlock(searchBlocks[i]);
      if (prevPlans.length > 0) {
        servicePlans = prevPlans;
        break;
      }
    }
  }
  if (servicePlanGroups.length === 0 && isAddendumOnlyBlock(latestShiftBlock)) {
    for (let i = 1; i < searchBlocks.length; i++) {
      const prevGroups = extractServicePlanGroupsFromBlock(searchBlocks[i]);
      if (prevGroups.length > 0) {
        servicePlanGroups = prevGroups;
        break;
      }
    }
  }

  let pendingResult = extractPendingFromBlock(latestShiftBlock);
  if (!pendingResult.sawPendingHeader && pendingResult.pending.length === 0 && isAddendumOnlyBlock(latestShiftBlock)) {
    for (let i = 1; i < searchBlocks.length; i++) {
      const prevRes = extractPendingFromBlock(searchBlocks[i]);
      if (prevRes.sawPendingHeader || prevRes.pending.length > 0) {
        pendingResult = prevRes;
        break;
      }
    }
  }

  const { medications, medicationsDate } = extractLatestMedicationsFromChart(
    text,
    latestDateBlock,
    latestShiftBlock,
    latestDate,
    shiftBlocksDesc
  );

  let contingencies = rawContingencies;
  if (!contingencies) {
    for (const blk of searchBlocks) {
      const m = String(blk || '').match(/^(?:[-*]\s*)?(?:Contingenc(?:y|ies)|If\s*\/\s*Then):\s*(.+)$/im);
      if (m && m[1].trim() && !/^(?:none|nil|n\/a|-)$/i.test(m[1].trim())) {
        contingencies = m[1].trim();
        break;
      }
    }
  }

  return {
    name,
    room,
    age,
    sex,
    weight,
    heightCm,
    service,
    ap,
    admitted,
    icuAdmitted,
    hospitalDay,
    icuDay,
    codeStatus,
    severity,
    allergies,
    isolation,
    contingencies,
    trackedLines,
    trackedAntibiotics,
    completedAntibiotics,
    aliases,
    categories,
    isCharity,
    isCensus,
    latestDate,
    latestShift,
    isUpdatedToday,
    assessment,
    vitals,
    vent,
    io,
    cumulativeFb: computeCumulativeFluidBalance(text, 3),
    hgt,
    drips,
    labs,
    medications,
    medicationsDate,
    servicePlans,
    servicePlanGroups,
    pending: pendingResult.pending,
  };
}

function togglePendingInSlice(sliceText, targetText, newCheckedState) {
  const lines = String(sliceText || '').split('\n');
  let modified = false;

  const targetClean = targetText.trim();
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes(targetClean)) {
      const checkMatch = line.match(/^(\s*[-*]\s*\[)([ xX])(\]\s*)(.+)$/);
      if (checkMatch && checkMatch[4].trim() === targetClean) {
        lines[i] = `${checkMatch[1]}${newCheckedState ? 'x' : ' '}${checkMatch[3]}${checkMatch[4]}`;
        modified = true;
        break;
      }
      // If it's a plain list item without checkbox, convert it to checkbox
      const bulletMatch = line.match(/^(\s*[-*]\s+)(.+)$/);
      if (bulletMatch && bulletMatch[2].trim() === targetClean) {
        lines[i] = `${bulletMatch[1]}[${newCheckedState ? 'x' : ' '}] ${bulletMatch[2]}`;
        modified = true;
        break;
      }
    }
  }

  if (!modified) {
    let inPending = false;
    let lastPlainIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (/^\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?\s*$/i.test(trimmed)) {
        inPending = true;
        continue;
      }
      if (!trimmed || (inPending && isPendingStopLine(trimmed))) {
        inPending = false;
        continue;
      }
      if (inPending && trimmed === targetClean) {
        lastPlainIdx = i;
      }
    }
    if (lastPlainIdx !== -1) {
      const indent = (lines[lastPlainIdx].match(/^(\s*)/) || ['', ''])[1];
      lines[lastPlainIdx] = `${indent}- [${newCheckedState ? 'x' : ' '}] ${targetClean}`;
      modified = true;
    }
  }

  return { text: lines.join('\n'), modified };
}

function findDateSectionRange(text, targetDate, dateOccurrenceIndex = 0) {
  const dateHeadingRe = /^##\s+([^\n]+)$/gm;
  const dateMatches = [...text.matchAll(dateHeadingRe)];

  if (targetDate === 'Undated') {
    const fmMatch = text.match(/^---\s*\n[\s\S]*?\n---\s*/);
    const start = fmMatch ? fmMatch[0].length : 0;
    const end = dateMatches.length ? dateMatches[0].index : text.length;
    return { headingStart: start, sectionStart: start, sectionEnd: end, hasHeading: false };
  }

  let matchCount = 0;
  for (let i = 0; i < dateMatches.length; i++) {
    if (datesMatch(dateMatches[i][1], targetDate)) {
      if (matchCount === dateOccurrenceIndex) {
        return {
          headingStart: dateMatches[i].index,
          sectionStart: dateMatches[i].index + dateMatches[i][0].length,
          sectionEnd: i + 1 < dateMatches.length ? dateMatches[i + 1].index : text.length,
          hasHeading: true,
        };
      }
      matchCount += 1;
    }
  }
  return null;
}

function findShiftSliceRange(text, targetDate, shiftOccurrenceIndex, dateOccurrenceIndex = 0) {
  const dateRange = findDateSectionRange(text, targetDate, dateOccurrenceIndex);
  if (!dateRange) return null;

  const { headingStart, sectionStart, sectionEnd, hasHeading } = dateRange;
  const sectionText = text.slice(sectionStart, sectionEnd);
  const shiftHeadingRe = /^###\s*([^\n]+)$/gm;
  const shiftMatches = [...sectionText.matchAll(shiftHeadingRe)];

  if (shiftOccurrenceIndex === -1) {
    const preEnd = shiftMatches.length ? sectionStart + shiftMatches[0].index : sectionEnd;
    return {
      headingStart,
      sectionStart,
      sectionEnd,
      hasHeading,
      shiftMatches,
      fullStart: sectionStart,
      bodyStart: sectionStart,
      sliceEnd: preEnd,
    };
  }

  const targetMatch = shiftMatches[shiftOccurrenceIndex];
  if (!targetMatch) return null;

  const fullStart = sectionStart + targetMatch.index;
  let bodyStart = fullStart + targetMatch[0].length;
  if (text[bodyStart] === '\n') bodyStart += 1;
  const sliceEnd =
    shiftOccurrenceIndex + 1 < shiftMatches.length
      ? sectionStart + shiftMatches[shiftOccurrenceIndex + 1].index
      : sectionEnd;

  return {
    headingStart,
    sectionStart,
    sectionEnd,
    hasHeading,
    shiftMatches,
    fullStart,
    bodyStart,
    sliceEnd,
  };
}

export function togglePendingItem(content, targetText, newCheckedState, scope = null) {
  const text = String(content || '');
  if (scope && scope.date && Number.isInteger(scope.shiftIndex)) {
    const range = findShiftSliceRange(text, scope.date, scope.shiftIndex, scope.dateOccurrenceIndex || 0);
    if (!range) return { text, modified: false };
    const sliceRes = togglePendingInSlice(
      text.slice(range.bodyStart, range.sliceEnd),
      targetText,
      newCheckedState
    );
    if (!sliceRes.modified) return { text, modified: false };
    return {
      text: `${text.slice(0, range.bodyStart)}${sliceRes.text}${text.slice(range.sliceEnd)}`,
      modified: true,
    };
  }
  return togglePendingInSlice(text, targetText, newCheckedState);
}

function cleanActiveDrips(rawDripText) {
  const parts = String(rawDripText || '')
    .split(/\s*\|\s*|\n/)
    .map((p) => p.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
  const active = parts.filter((part) => {
    if (/^(?:none|off|nil|n\/a|-)$/i.test(part)) return false;
    if (/\b(?:discontinued|d\/c|stopped|completed|held)\b/i.test(part)) return false;
    return true;
  });
  return active.join(' | ');
}

function formatDripsMarkdownBlock(rawDrips) {
  const items = String(rawDrips || '')
    .split(/\n|\s*\|\s*/)
    .map((s) => s.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
  if (!items.length) return '';
  if (items.length === 1) return `Drips: ${items[0]}`;
  return `Drips:\n${items.join('\n')}`;
}

function extractServicePlansFromBlock(blockText) {
  const lines = String(blockText || '').split('\n');
  const plans = [];
  const seen = new Set();
  let inServicePlans = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(?:\*{0,2})(?:Generic|General|Routine)\s+Plans?(?:\*{0,2})\s*:/i.test(trimmed)) {
      inServicePlans = false;
      continue;
    }

    const planHeaderMatch = trimmed.match(
      /^(?:\*{0,2})(?:Service|Problem-?Based|Systems-?Based(?:\s+ICU)?|([A-Za-z][A-Za-z\s/&+-]{1,30}))\s+Plans?(?:\*{0,2})\s*:\s*(.*)$/i
    );
    if (planHeaderMatch && !/^#{2,3}\s+/.test(trimmed)) {
      const fullHdrLower = trimmed.toLowerCase();
      const prefix = fullHdrLower.startsWith('problem') || fullHdrLower.startsWith('systems')
        ? 'Service'
        : (planHeaderMatch[1] || 'Service').trim();
      if (!/^(?:generic|general|routine)$/i.test(prefix)) {
        inServicePlans = true;
        const inlineItem = (planHeaderMatch[2] || '').trim();
        if (inlineItem && !/^none$/i.test(inlineItem)) {
          const key = inlineItem.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            plans.push(inlineItem);
          }
        }
        continue;
      }
    }

    if (inServicePlans) {
      if (
        !trimmed ||
        /^#{2,3}\s+/.test(trimmed) ||
        /^(?:\*{0,2})(?:If\s+ok|Pending|Contingenc(?:y|ies)|If\s*\/\s*Then|Vitals|VS|Vent|Shift\s+I&O|I&O|Drips?|Infusions?|Labs?|PE|Drains?|Meds?|Footer)\b/i.test(
          trimmed
        )
      ) {
        inServicePlans = false;
        continue;
      }

      const bullet = trimmed.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
      if (bullet) {
        const planText = bullet[1].trim();
        if (planText && !/^none$/i.test(planText)) {
          const key = planText.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            plans.push(planText);
          }
        }
      } else {
        // Non-bullet header or paragraph terminates section
        inServicePlans = false;
      }
    }
  }

  return plans;
}

function normalizeServicePlanTag(rawPrefix) {
  const clean = String(rawPrefix || '').trim();
  if (!clean || /^service$/i.test(clean)) return 'SERVICE';
  if (/^ids?$/i.test(clean)) return 'ID';
  return clean.toUpperCase();
}

export function extractServicePlanGroupsFromBlock(blockText) {
  const lines = String(blockText || '').split('\n');
  const groups = [];
  let curTag = '';
  let curItems = [];
  let inPlanContainer = false;

  const flushGroup = () => {
    if (!curTag || !curItems.length) {
      curItems = [];
      return;
    }
    if (curTag === 'SERVICE') {
      for (const item of curItems) {
        const inlineTagged = item.match(/^((?:#\d+\s+[^:]{1,28}|Neuro|CV|Cardiovascular|Resp|Respiratory|Renal\/FEN|Renal|FEN|GI\/Nutrition|GI|ID|Heme|Prophylaxis|FASTHUG-?BID|[A-Za-z][A-Za-z/&+-]{1,18})):\s*(.+)$/i);
        if (inlineTagged) {
          groups.push({ tag: normalizeServicePlanTag(inlineTagged[1]), text: inlineTagged[2].trim() });
        } else {
          groups.push({ tag: 'SERVICE', text: item });
        }
      }
    } else {
      const existing = groups.find((g) => g.tag === curTag);
      const joined = curItems.join('; ');
      if (existing) existing.text = `${existing.text}; ${joined}`;
      else groups.push({ tag: curTag, text: joined });
    }
    curItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (/^(?:\*{0,2})(?:Generic|General|Routine)\s+Plans?(?:\*{0,2})\s*:/i.test(trimmed)) {
      flushGroup();
      curTag = '';
      inPlanContainer = false;
      continue;
    }

    const planHeaderMatch = trimmed.match(
      /^(?:\*{0,2})(?:Service|Problem-?Based|Systems-?Based(?:\s+ICU)?|([A-Za-z][A-Za-z\s/&+-]{1,30}))\s+Plans?(?:\*{0,2})(?:\s*:\s*(.*)|\s*)$/i
    );
    if (planHeaderMatch && !/^#{2,3}\s+/.test(trimmed)) {
      const fullHeader = trimmed.toLowerCase();
      const isContainerHeader = fullHeader.startsWith('problem') || fullHeader.startsWith('systems');
      const prefix = isContainerHeader ? 'Service' : (planHeaderMatch[1] || 'Service').trim();
      if (!/^(?:generic|general|routine)$/i.test(prefix)) {
        flushGroup();
        curTag = normalizeServicePlanTag(prefix);
        inPlanContainer = true;
        const inlineItem = (planHeaderMatch[2] || '').trim();
        if (inlineItem && !/^none$/i.test(inlineItem)) {
          curItems.push(inlineItem.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim());
        }
        continue;
      }
    }

    if (curTag) {
      if (
        !trimmed ||
        /^#{2,3}\s+/.test(trimmed) ||
        /^(?:\*{0,2})(?:If\s+ok|Pending|Contingenc(?:y|ies)|If\s*\/\s*Then|Vitals|VS|Vent|Shift\s+I&O|I&O|Drips?|Infusions?|Labs?|PE|Drains?|Meds?|Thank\s+you|Footer)\b/i.test(
          trimmed
        )
      ) {
        flushGroup();
        curTag = '';
        inPlanContainer = false;
        continue;
      }

      const item = trimmed.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim();
      if (item && !/^none$/i.test(item)) {
        curItems.push(item);
      }
    }
  }

  flushGroup();
  return groups;
}

function isMedPlaceholder(text) {
  const clean = String(text || '').trim();
  return !clean || /^(?:none|n\/a|na|nil|-+|\{\{(?:drips|meds)\}\})$/i.test(clean);
}

const isMedStopBoundary = (trimmed) =>
  /^#{2,3}\s+/.test(trimmed) ||
  /^---+$/.test(trimmed) ||
  /^(?:\*{0,2})(?:Service|Generic|General|Routine|[A-Za-z][A-Za-z\s/&+-]{1,25})\s+Plans?(?:\*{0,2})\s*:/i.test(
    trimmed
  ) ||
  /^(?:\*{0,2})(?:Subjective|Objective|Assessment|Impression|Problem\s+list|Plans?|Pending|If\s+ok|Vitals|VS|Vent|Ventilator|Shift\s+I&O|I&O|Drips?|Infusions?|Labs?|PE|Drains?|Feeding|Diet|Nutrition|Greeting|Footer)\b(?:\*{0,2})(?:\s*:|$)/i.test(
    trimmed
  ) ||
  /^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i.test(trimmed);

export function extractMedicationsFromBlock(blockText) {
  const lines = String(blockText || '').split('\n');
  const meds = [];
  const seen = new Set();
  let inMeds = false;
  let blankCount = 0;

  const pushMed = (raw) => {
    const clean = String(raw || '')
      .replace(/^[•\-*]\s*\[[ xX]\]\s*/, '')
      .replace(/^(?:[•\-*]|\d+[.)])\s+/, '')
      .trim();
    if (isMedPlaceholder(clean)) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      meds.push(clean);
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const hdrMatch =
      trimmed.match(
        /^(?:#{2,6}\s+)?(?:\*{0,2})(?:(?:Current|Active)\s+)?(?:Medications?|Meds?)(?:\s*\/\s*Drips?)?(?:\*{0,2})(?:\s*:\s*(.*)|\s*)$/i
      ) || trimmed.match(/^(?:\*{0,2})Therapeutics(?:\*{0,2})\s*:\s*(.*)$/i);

    if (hdrMatch && !/^#{2,3}\s+/.test(trimmed)) {
      inMeds = true;
      blankCount = 0;
      const inline = (hdrMatch[1] || '').trim();
      if (inline) {
        for (const piece of inline.split(/[|;]/)) {
          pushMed(piece);
        }
      }
      continue;
    }

    if (!inMeds) continue;

    if (!trimmed) {
      if (meds.length > 0) {
        inMeds = false;
      } else {
        blankCount++;
        if (blankCount >= 2) inMeds = false;
      }
      continue;
    }

    if (isMedStopBoundary(trimmed)) {
      inMeds = false;
      continue;
    }

    blankCount = 0;
    if (/[|;]/.test(trimmed) && !/^(?:[•\-*]|\d+[.)])\s+/.test(trimmed)) {
      for (const piece of trimmed.split(/[|;]/)) {
        pushMed(piece);
      }
    } else {
      pushMed(trimmed);
    }
  }

  return meds;
}

function splitAnyShiftBlocks(blockText) {
  const shiftHeadingRe = /^###\s*([^\n]+)$/gim;
  const matches = [...String(blockText || '').matchAll(shiftHeadingRe)];
  if (!matches.length) return [];
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : blockText.length;
    out.push({
      rawShift: matches[i][1].trim(),
      block: blockText.slice(start, end),
    });
  }
  return out;
}

function splitDateBlocks(content) {
  const dateHeadingRe =
    /^##\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4})[^\n]*$/gim;
  const text = String(content || '');
  const matches = [...text.matchAll(dateHeadingRe)];
  if (!matches.length) return [];
  const out = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
    out.push({
      date: matches[i][1].trim().replace(/\//g, '-'),
      block: text.slice(start, end),
    });
  }
  return out;
}

function extractLatestMedicationsFromChart(
  content,
  latestDateBlock,
  latestShiftBlock,
  latestDate,
  preSplitLatestShiftsDesc = null
) {
  const text = String(content || '');
  if (!/(?:meds?|medications?|therapeutics)/i.test(text)) {
    return { medications: [], medicationsDate: '' };
  }

  const fromLatestShift = extractMedicationsFromBlock(latestShiftBlock);
  if (fromLatestShift.length > 0) {
    return { medications: fromLatestShift, medicationsDate: latestDate || '' };
  }

  const latestShiftsDesc = Array.isArray(preSplitLatestShiftsDesc)
    ? preSplitLatestShiftsDesc
    : splitAnyShiftBlocks(latestDateBlock).reverse();
  for (const s of latestShiftsDesc) {
    if (s.block === latestShiftBlock) continue;
    const meds = extractMedicationsFromBlock(s.block);
    if (meds.length > 0) {
      return { medications: meds, medicationsDate: latestDate || '' };
    }
  }

  if (latestShiftsDesc.length > 0) {
    const firstShiftPos = String(latestDateBlock || '').indexOf(latestShiftsDesc[latestShiftsDesc.length - 1].block);
    if (firstShiftPos > 0) {
      const preShiftMeds = extractMedicationsFromBlock(String(latestDateBlock || '').slice(0, firstShiftPos));
      if (preShiftMeds.length > 0) {
        return { medications: preShiftMeds, medicationsDate: latestDate || '' };
      }
    }
  }

  const dateBlocksDesc = splitDateBlocks(text).reverse();
  if (dateBlocksDesc.length > 0) {
    for (let i = 1; i < dateBlocksDesc.length; i++) {
      const d = dateBlocksDesc[i];
      const shiftsDesc = splitAnyShiftBlocks(d.block).reverse();
      if (shiftsDesc.length > 0) {
        for (const s of shiftsDesc) {
          const meds = extractMedicationsFromBlock(s.block);
          if (meds.length > 0) {
            return { medications: meds, medicationsDate: d.date || '' };
          }
        }
        const firstShiftPos = d.block.indexOf(shiftsDesc[shiftsDesc.length - 1].block);
        if (firstShiftPos > 0) {
          const preMeds = extractMedicationsFromBlock(d.block.slice(0, firstShiftPos));
          if (preMeds.length > 0) {
            return { medications: preMeds, medicationsDate: d.date || '' };
          }
        }
      } else {
        const meds = extractMedicationsFromBlock(d.block);
        if (meds.length > 0) {
          return { medications: meds, medicationsDate: d.date || '' };
        }
      }
    }

    const firstDateBlock = dateBlocksDesc[dateBlocksDesc.length - 1].block;
    const firstDatePos = text.indexOf(firstDateBlock);
    if (firstDatePos > 0) {
      const preDateMeds = extractMedicationsFromBlock(text.slice(0, firstDatePos));
      return { medications: preDateMeds, medicationsDate: preDateMeds.length ? latestDate || '' : '' };
    }
    return { medications: [], medicationsDate: '' };
  }

  if (latestShiftsDesc.length > 0) {
    const firstShiftPos = text.indexOf(latestShiftsDesc[latestShiftsDesc.length - 1].block);
    if (firstShiftPos > 0) {
      const fallbackMeds = extractMedicationsFromBlock(text.slice(0, firstShiftPos));
      return { medications: fallbackMeds, medicationsDate: fallbackMeds.length ? latestDate || '' : '' };
    }
  }
  return { medications: [], medicationsDate: '' };
}

function extractLabeledListFromBlock(blockText, headerRegex) {
  const lines = String(blockText || '').split('\n');
  const items = [];
  let inSec = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const hdr = trimmed.match(headerRegex);
    if (hdr) {
      inSec = true;
      const inline = (hdr[1] || '').trim();
      if (inline) {
        for (const piece of inline.split(/[|;]/)) {
          const clean = piece.replace(/^(?:[•\-*]|\d+[.)])\s+/, '').trim();
          if (clean && !/^none$/i.test(clean)) items.push(clean);
        }
      }
      continue;
    }
    if (!inSec) continue;
    if (!trimmed) {
      if (items.length > 0) break;
      continue;
    }
    if (
      /^#{2,3}\s+/.test(trimmed) ||
      /^(?:\*{0,2})(?:Pending|Service|Generic|General|Routine|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?|Plans?|Meds?|Medications?|Drips?|Feeding|Diet|Nutrition|Vitals|VS|Vent|Labs?|Thank\s+you)/i.test(
        trimmed
      )
    ) {
      break;
    }
    const clean = trimmed.replace(/^(?:[•\-*]|\d+[.)])\s+/, '').trim();
    if (clean && !/^none$/i.test(clean)) items.push(clean);
  }
  return items;
}

const PE_SYSTEM_PREFIX_RE =
  /^(?:General(?:\s+Survey)?|Gen|GS|Skin|Integument(?:ary)?|HEENT|Eyes?|ENT|Neck|Chest(?:\/Lungs)?|C\/L|Lungs?|Resp(?:iratory)?|Pulm(?:onary)?|Heart|CVS|Cardio(?:vascular)?|Cardiac|Abdomen|ABD|GI|GU|Genitourinary|Extremities|EXT|MSK|Musculoskeletal|Neuro(?:logic)?|CNS|DRE)\s*:/i;

const PE_GENERAL_SURVEY_RE =
  /^(?:Awake\b|Alert\b|Arousable\b|Asleep\b|Unresponsive\b|Conscious\b|Drowsy\b|Lethargic\b|Stuporous\b|Obtunded\b|Comatose\b|Sedated\b|Intubated\b|GCS\b|RASS\b|In\s+(?:mild|moderate|severe)\s+(?:cardio)?respiratory\s+distress\b|Not\s+in\s+(?:cardio)?respiratory\s+distress\b|NIRD\b)/i;

const PE_STRONG_GENERAL_SURVEY_RE =
  /^(?:.*\b(?:NIRD|not\s+in\s+(?:cardio)?respiratory\s+distress|in\s+(?:mild|moderate|severe)\s+(?:cardio)?respiratory\s+distress)\b|Sedated,\s*intubated\b|Intubated\b|GCS\s*\d|RASS\s*[+-]?\d)/i;

const PE_FINDING_LINE_RE =
  /(?:\b(?:isocoric|anisocoric|pupils?|perrla?|ebrl|sclerae?|conjunctivae?|anicteric|icteric|pink(?:ish)?\s+(?:palpebral\s+)?conjunctiv|pale\s+(?:palpebral\s+)?conjunctiv|corneal\s+reflex|visual\s+threat|jvd|jvp|neck\s+veins?|trachea\s+midline|lymphadenopathy|clad|ece|cbs|clear\s+breath\s+sounds?|breath\s+sounds?|bibasal\s+(?:rales|crackles)|rales|crackles|rhonchi|wheez(?:es?|ing)|stridor|equal\s+chest\s+expansion|chest\s+expansion|retractions?|dhs|distinct\s+heart\s+sounds?|heart\s+sounds?|adynamic\s+precordium|regular\s+(?:rate\s+and\s+)?rhythm|irregular(?:ly)?\s+irregular|murmurs?|precordium|pmi|heaves?|thrills?|nabs|normoactive\s+bowel\s+sounds?|bowel\s+sounds?|flabby|globular|scaphoid|soft,?\s*(?:non-?tender|nt)|(?:soft|flabby)\s+abdomen|non-?tender\s+abdomen|abdomen\s+(?:soft|flabby|non-?tender|distended)|guarding|rebound|hepatomegaly|splenomegaly|ascites|crt\s*[<>≤≥]\s*\d|capillary\s+refill|spp|fpp|(?:strong|fair|weak|full)\s+(?:peripheral\s+|distal\s+)?pulses?|(?:bi)?pedal\s+edema|no\s+(?:bi)?(?:pedal\s+)?edema|(?:cool|warm)\s+(?:peripher(?:ies|al)|extremities)|cyanotic\s+digits|acrocyanosis|clubbing|avf\s+(?:[lr]|left|right|bruit|thrill)|plantar\s+reflex|babinski|cranial\s+nerves?|dtrs?|nuchal\s+rigidity|kernig|brudzinski|motor\s+strength|gcs\s*\d)\b|\([+-]\)\s*(?:bi)?(?:pedal\s+)?edema\b|\bap\s*,\s*dhs\b)/i;

const PE_SUBJECTIVE_LINE_RE =
  /^(?:(?:Subjective|S>|S:)\b|(?:[-*]\s*)?(?:no\s+subjective\s+complaints?|no\s+complaints?|no\s+acute\s+events?|no\s+untoward\s+events?|no\s+(?:new\s+)?(?:complaints?|symptoms?)|no\s+episodes?\s+of|no\s+fever|afebrile|no\s+chills|no\s+hypotension|no\s+chest\s+pain|no\s+dyspnea|no\s+shortness\s+of\s+breath|no\s+nausea|no\s+vomiting|no\s+bleeding|no\s+seizures?|hypoglycemic\s+episodes?|good\s+appetite|slept\s+well|tolerating\s+diet|seen\s+(?:patient|pt)\b|s\/p\s+hd\b|post\s+hd\b|downtitrating|uptitrating|titrated\s+up|answers?\s+(?:to\s+)?yes\s*(?:or|\/)\s*no|head\s+gesture|family\s+opted)\b)/i;

const PE_NON_SECTION_START_RE =
  /^(?:\*{0,2})(?:Subjective|S>|S:|Assessment|Impression|Working\s+Impression|Problem\s+list|Labs?|Laboratory(?:\s+updates?)?|Drips?|Infusions?|Meds?|Medications?|Current\s+Meds?|On\s+hold|Hold|Held|Pending|Service\s+Plans?|Plans?|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?|HGTs?|CBGs?|Diet|Feeding|Nutrition|CXR(?:\s+[^:]+)?|Chest\s+X-?ray(?:\s+[^:]+)?|12-?L(?:ead)?\s*ECG|ECG|EKG|2D\s*Echo(?:\s+[^:]+)?|CT(?:\s+[^:]+)?|MRI(?:\s+[^:]+)?|UTZ(?:\s+[^:]+)?|Ultrasound(?:\s+[^:]+)?)(?:\*{0,2})\s*:/i;

const PE_BARE_NON_SECTION_RE =
  /^(?:\*{0,2})(?:Medications?|Meds?|Pending|Plans?|Drips?|On\s+hold|HGTs?|CBGs?|Diet|Feeding|Labs?|ABG|CBC)(?:\*{0,2})\s*$/i;

const PE_SIGNATURE_RE = /^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i;

function hasExplicitPeStartFormat(trimmed) {
  return PE_SYSTEM_PREFIX_RE.test(trimmed) || PE_GENERAL_SURVEY_RE.test(trimmed);
}

function isObjectiveAnchorLine(trimmed) {
  return (
    /^(?:\*{0,2})Objective(?:\*{0,2})\s*:/i.test(trimmed) ||
    /^O>\s*/i.test(trimmed) ||
    /^O:\s*/i.test(trimmed) ||
    /^(?:[-*]\s*)?(?:Vitals?|VS)\s*:/i.test(trimmed) ||
    /^(?:BP|HR|PR|RR|Tmax|Temp|O2(?:\s*sat)?|SpO2)\b\s*[:=\d]/i.test(trimmed) ||
    /^(?:Shift\s+I&O|I&O|Drips?|Infusions?|HGTs?|CBGs?)\s*[:=]?/i.test(trimmed) ||
    /^(?:24\s*-?\s*h(?:r|rs|our|ours)?(?:\s+I&O)?|\d{1,2}\s*-\s*\d{1,2}\s*(?:am|pm|a|p)|\d{1,2}(?:am|pm|a|p)\s*-\s*\d{1,2}(?:am|pm|a|p)|8\s*hrs?)\s*:?$/i.test(
      trimmed
    ) ||
    /^(?:I|O)\s+\d/i.test(trimmed) ||
    /^[IO]\s*-\s*\d/i.test(trimmed) ||
    /^(?:On\s+)?(?:APVCMV|PCMV|AC\/?VC|AC\/?PC|VC-?CMV|PC-?CMV|PRVC|SIMV|SPONT|ASV|PSV|CPAP|BiPAP|NIV|HFNC)\b/i.test(
      trimmed
    ) ||
    /^(?:Ppeak|Pplat|VTE|EMV|FT)\s+\d/i.test(trimmed)
  );
}

function isPeStopLine(trimmed) {
  return (
    /^#{2,3}\s+/.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    /^(?:\*{0,2})(?:Drips?|Infusions?|Meds?|Medications?|Current\s+Meds?|On\s+hold|Hold|Held|Pending|Service\s+Plans?|Plans?|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?|Feeding|Diet|Nutrition|Assessment|Impression|Working\s+Impression|Problem\s+list|Subjective|Objective|Labs?|Laboratory(?:\s+updates?)?|Vitals?|VS|Vent(?:ilator)?(?:\s+Settings)?|HGTs?|CBGs?|Greeting|Footer)(?:\*{0,2})\s*:/i.test(
      trimmed
    ) ||
    PE_BARE_NON_SECTION_RE.test(trimmed) ||
    PE_SIGNATURE_RE.test(trimmed) ||
    /^(?:BP|HR|PR|RR|Tmax|Temp|O2(?:\s*sat)?|SpO2)\b\s*[:=\d]/i.test(trimmed) ||
    /^(?:Shift\s+I&O|I&O|FWF|HGTs?|CBGs?)\b/i.test(trimmed) ||
    /^(?:24\s*-?\s*h(?:r|rs|our|ours)?(?:\s+I&O)?|\d{1,2}\s*-\s*\d{1,2}\s*(?:am|pm|a|p)|\d{1,2}(?:am|pm|a|p)\s*-\s*\d{1,2}(?:am|pm|a|p)|8\s*hrs?)\b/i.test(
      trimmed
    ) ||
    /^(?:I|O)\s+\d/i.test(trimmed) ||
    /^[IO]\s*-\s*/i.test(trimmed) ||
    /^(?:On\s+)?(?:APVCMV|PCMV|AC\/?VC|AC\/?PC|VC-?CMV|PC-?CMV|PRVC|SIMV|SPONT|ASV|PSV|CPAP|BiPAP|NIV|HFNC)\b/i.test(
      trimmed
    ) ||
    /^(?:Ppeak|Pplat|VTE|EMV|FT)\s+\d/i.test(trimmed)
  );
}

function extractPeLinesFromBlock(blockText) {
  const lines = String(blockText || '').split('\n');
  const explicitCandidates = [];
  const implicitCandidates = [];
  let inNonPeSection = false;
  let seenObjectiveAnchor = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      inNonPeSection = false;
      continue;
    }

    const peHdr = trimmed.match(/^(?:\*{0,2})(?:PE|Physical\s+Exam(?:ination)?)(?:\*{0,2}):\s*(.*)$/i);
    if (peHdr) {
      inNonPeSection = false;
      seenObjectiveAnchor = true;
      const candLines = [];
      const inline = (peHdr[1] || '').trim();
      if (inline) candLines.push(inline);

      let j = i + 1;
      for (; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim();
        if (!nextTrimmed) {
          if (candLines.length > 0) break;
          continue;
        }
        if (isPeStopLine(nextTrimmed)) break;
        candLines.push(nextTrimmed);
      }
      i = j - 1;
      if (candLines.length > 0) {
        explicitCandidates.push({ lines: candLines });
      }
      continue;
    }

    if (/^(?:\*{0,2})(?:Feeding|Diet|Nutrition)(?:\*{0,2}):\s*\S/i.test(trimmed)) {
      continue;
    }

    const isObjAnchor = isObjectiveAnchorLine(trimmed);
    const isExplicitNonPe =
      PE_NON_SECTION_START_RE.test(trimmed) ||
      PE_BARE_NON_SECTION_RE.test(trimmed) ||
      PE_SIGNATURE_RE.test(trimmed) ||
      PE_SUBJECTIVE_LINE_RE.test(trimmed);

    if (isObjAnchor) {
      seenObjectiveAnchor = true;
      if (!isExplicitNonPe) inNonPeSection = false;
    }

    if (isExplicitNonPe) {
      inNonPeSection = true;
      continue;
    }

    if (isObjAnchor) continue;

    if (PE_SYSTEM_PREFIX_RE.test(trimmed)) {
      inNonPeSection = false;
    }

    if (inNonPeSection) continue;

    const startsCandidate =
      PE_SYSTEM_PREFIX_RE.test(trimmed) ||
      PE_FINDING_LINE_RE.test(trimmed) ||
      PE_GENERAL_SURVEY_RE.test(trimmed);

    if (!startsCandidate) continue;

    const afterObjective = seenObjectiveAnchor;
    const candLines = [trimmed];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const nextTrimmed = lines[j].trim();
      if (!nextTrimmed) break;
      if (isPeStopLine(nextTrimmed)) break;
      candLines.push(nextTrimmed);
    }
    i = j - 1;

    let systemLineCount = 0;
    let findingLineCount = 0;
    let subjectiveLineCount = 0;
    let hasStrongGeneralSurvey = false;

    for (const cl of candLines) {
      const isSys = PE_SYSTEM_PREFIX_RE.test(cl);
      const isFind = isSys || PE_FINDING_LINE_RE.test(cl);
      const isSubj = !isFind && PE_SUBJECTIVE_LINE_RE.test(cl);
      if (isSys) systemLineCount += 1;
      if (isFind) findingLineCount += 1;
      if (isSubj) subjectiveLineCount += 1;
      if (PE_STRONG_GENERAL_SURVEY_RE.test(cl)) hasStrongGeneralSurvey = true;
    }

    if (findingLineCount === 0 && subjectiveLineCount > 0) continue;
    if (findingLineCount === 0 && !afterObjective) continue;
    if (findingLineCount === 0 && !hasStrongGeneralSurvey) continue;
    if (!afterObjective && systemLineCount === 0 && subjectiveLineCount >= findingLineCount) continue;

    const valid =
      findingLineCount >= 2 ||
      systemLineCount >= 1 ||
      (afterObjective && findingLineCount >= 1) ||
      (afterObjective && hasStrongGeneralSurvey && subjectiveLineCount === 0);

    if (!valid) continue;

    const score =
      (afterObjective ? 100 : 0) +
      systemLineCount * 15 +
      findingLineCount * 10 -
      subjectiveLineCount * 20;

    implicitCandidates.push({ lines: candLines, score });
  }

  if (explicitCandidates.length > 0) {
    const chosen = explicitCandidates[0].lines;
    if (!hasExplicitPeStartFormat(chosen[0])) {
      return chosen.length === 1 ? `PE: ${chosen[0]}` : `PE:\n${chosen.join('\n')}`;
    }
    return chosen.join('\n');
  }

  if (implicitCandidates.length > 0) {
    let best = implicitCandidates[0];
    for (let k = 1; k < implicitCandidates.length; k++) {
      if (implicitCandidates[k].score >= best.score) {
        best = implicitCandidates[k];
      }
    }
    return best.lines.join('\n');
  }

  return '';
}

export function extractLatestPeFromChart(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  if (!text.trim()) return { pe: '', source: '' };

  const allShiftsDesc = splitAnyShiftBlocks(text)
    .map((s) => s.block)
    .reverse();

  for (const blk of allShiftsDesc) {
    const pe = extractPeLinesFromBlock(blk);
    if (pe) return { pe, source: 'shift' };
  }

  if (allShiftsDesc.length === 0) {
    let withoutMetaAndAdmit = text.replace(/^---\s*\n[\s\S]*?\n---[ \t]*(?:\n|$)/, '');
    const admitMatch = /^##\s*Admitting\s+History\s*$/im.exec(withoutMetaAndAdmit);
    if (admitMatch) {
      const afterStart = admitMatch.index + admitMatch[0].length;
      const rest = withoutMetaAndAdmit.slice(afterStart);
      const nextH2 = /^##\s+[^\n]+$/m.exec(rest);
      const end = nextH2 ? afterStart + nextH2.index : withoutMetaAndAdmit.length;
      const before = withoutMetaAndAdmit.slice(0, admitMatch.index).trimEnd();
      const after = withoutMetaAndAdmit.slice(end).trimStart();
      withoutMetaAndAdmit = [before, after].filter(Boolean).join('\n\n');
    }
    const fallbackPe = extractPeLinesFromBlock(withoutMetaAndAdmit);
    if (fallbackPe) return { pe: fallbackPe, source: 'shift' };
  }

  const admit = extractAdmittingHistory(text);
  if (admit?.hasData && admit.data?.pe && admit.data.pe.trim()) {
    return { pe: admit.data.pe.trim(), source: 'admitting' };
  }

  return { pe: '', source: '' };
}

const FEEDING_STOP_LINE_RE =
  /^(?:#{2,3}\s+|---+$|(?:\*{0,2})(?:HGTs?|CBGs?|Vitals?|VS|Vent(?:ilator)?(?:\s+Settings)?|Shift\s+I&O|I&O|Drips?|Infusions?|Meds?|Medications?|Current\s+Meds?|On\s+hold|Hold|Held|Pending|Service\s+Plans?|Plans?|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?|Labs?|Laboratory(?:\s+updates?)?|PE|Physical\s+Exam(?:ination)?|Subjective|Objective|Assessment|Impression|Working\s+Impression|Problem\s+list)(?:\*{0,2})\s*:|(?:\*{0,2})(?:HGTs?|CBGs?|Medications?|Meds?|Pending|Plans?|Drips?|On\s+hold)(?:\*{0,2})\s*$|Thank\s+you\b|BP\b|HR\b|PR\b|RR\b|Tmax\b|Temp\b|O2\b|24\s*-?\s*h(?:r|rs|our|ours)?\b|I\s+-|O\s+-|I\s+\d|O\s+\d)/i;

function extractFeedingFromBlock(blockText) {
  const lines = String(blockText || '').split('\n');
  const out = [];
  let inFeeding = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inFeeding) {
      const m = trimmed.match(/^(?:[-*]\s*)?(?:\*{0,2})(?:Feeding|Diet|Nutrition)(?:\*{0,2})\s*:\s*(.*)$/i);
      if (!m) continue;
      inFeeding = true;
      const inline = (m[1] || '').trim();
      if (inline && !/^(?:none|n\/a)$/i.test(inline)) {
        out.push(inline);
      }
      continue;
    }

    if (!trimmed) break;
    if (
      FEEDING_STOP_LINE_RE.test(trimmed) ||
      PE_SYSTEM_PREFIX_RE.test(trimmed) ||
      PE_GENERAL_SURVEY_RE.test(trimmed) ||
      PE_FINDING_LINE_RE.test(trimmed)
    ) {
      break;
    }
    const cleaned = trimmed.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim();
    if (cleaned && !/^(?:none|n\/a)$/i.test(cleaned)) {
      out.push(cleaned);
    }
  }

  return out.join('\n').trim();
}

export function extractStandingDictationContext(content) {
  const text = String(content || '');
  const allShiftsDesc = splitAnyShiftBlocks(text)
    .map((s) => s.block)
    .reverse();
  const blocks = allShiftsDesc.length ? allShiftsDesc : [text];

  let pe = extractLatestPeFromChart(text).pe;
  let meds = [];
  let onHold = [];
  let feeding = '';
  let drips = '';
  let vent = '';
  let pending = [];
  const subspecialtyPlans = [];
  const seenPlanHeaders = new Set();

  for (const blk of blocks) {
    if (!meds.length) meds = extractMedicationsFromBlock(blk);
    if (!onHold.length) {
      onHold = extractLabeledListFromBlock(blk, /^(?:\*{0,2})(?:On\s+hold|Hold|Held)(?:\*{0,2}):\s*(.*)$/i);
    }
    if (!feeding) {
      feeding = extractFeedingFromBlock(blk);
    }
    const metrics = extractClinicalMetricsFromBlock(blk);
    if (!drips && metrics.drips) drips = metrics.drips;
    if (!vent && metrics.vent) vent = metrics.vent;
    if (!pending.length) {
      const pendRes = extractPendingFromBlock(blk);
      if (pendRes.pending.length > 0) {
        pending = pendRes.pending.filter((p) => !p.checked).map((p) => p.text);
      }
    }

    // Collect named subspecialty plans (Pulmo plans:, Cardio plans:, etc.; exclude generic Plans:)
    const blkLines = blk.split('\n');
    let curHeading = '';
    let curItems = [];
    const flushSubPlan = () => {
      if (curHeading && curItems.length && !seenPlanHeaders.has(curHeading.toLowerCase())) {
        seenPlanHeaders.add(curHeading.toLowerCase());
        subspecialtyPlans.push({ heading: curHeading, items: [...curItems] });
      }
      curHeading = '';
      curItems = [];
    };
    for (const rawLine of blkLines) {
      const tr = rawLine.trim();
      const spHdr = tr.match(/^(?:\*{0,2})([A-Za-z][A-Za-z\s/&+-]{1,28})\s+Plans?(?:\*{0,2}):\s*(.*)$/i);
      if (spHdr && !/^#{2,3}\s+/.test(tr)) {
        flushSubPlan();
        const prefix = spHdr[1].trim();
        if (!/^(?:generic|general|routine)$/i.test(prefix)) {
          curHeading = `${prefix} plans:`;
          if (spHdr[2] && spHdr[2].trim()) {
            curItems.push(spHdr[2].trim().replace(/^(?:[•\-*]|\d+[.)])\s+/, ''));
          }
        }
        continue;
      }
      if (curHeading) {
        if (
          !tr ||
          /^#{2,3}\s+/.test(tr) ||
          /^(?:\*{0,2})(?:Plans?|Pending|Thank\s+you|Greeting|Footer)/i.test(tr)
        ) {
          flushSubPlan();
        } else {
          const item = tr.replace(/^(?:[•\-*]\s*\[[ xX]\]\s*|^(?:[•\-*]|\d+[.)])\s+)/, '').trim();
          if (item) curItems.push(item);
        }
      }
    }
    flushSubPlan();
  }

  return {
    pe,
    meds,
    onHold,
    feeding,
    drips,
    vent,
    pending,
    subspecialtyPlans,
  };
}

export function extractCarryForwardData(content) {
  const text = String(content || '');
  const segment = getLatestShiftSegment(text);
  const allShiftsDesc = splitShiftSections(text).reverse();
  const hasPriorBlock = segment.hasShiftHeading || segment.hasDateHeading;

  if (!hasPriorBlock && !text.trim()) {
    return {
      openPending: [],
      completedPendingCount: 0,
      servicePlans: [],
      vent: '',
      drips: '',
      feeding: '',
      pe: '',
      peSource: '',
      hasPriorBlock: false,
    };
  }

  const candidateBlocks = allShiftsDesc.length
    ? allShiftsDesc.map((s) => s.block)
    : [segment.latestShiftBlock];

  // Primary block is latest shift block; if it's an addendum-only dictation, look back for standing sections
  const primaryBlock = candidateBlocks[0] || '';
  const primaryAddendum = isAddendumOnlyBlock(primaryBlock);

  // Pending
  let pendingRes = extractPendingFromBlock(primaryBlock);
  if (!pendingRes.sawPendingHeader && pendingRes.pending.length === 0 && primaryAddendum) {
    for (let i = 1; i < candidateBlocks.length; i++) {
      const prev = extractPendingFromBlock(candidateBlocks[i]);
      if (prev.sawPendingHeader || prev.pending.length > 0) {
        pendingRes = prev;
        break;
      }
    }
  }
  const openPending = pendingRes.pending.filter((p) => !p.checked).map((p) => p.text);
  const completedPendingCount = pendingRes.pending.filter((p) => p.checked).length;

  // Service Plans
  let servicePlans = extractServicePlansFromBlock(primaryBlock);
  if (servicePlans.length === 0 && primaryAddendum) {
    for (let i = 1; i < candidateBlocks.length; i++) {
      const prevPlans = extractServicePlansFromBlock(candidateBlocks[i]);
      if (prevPlans.length > 0) {
        servicePlans = prevPlans;
        break;
      }
    }
  }

  // Standing lines: Vent, Drips & Feeding
  let vent = '';
  let drips = '';
  let feeding = '';
  let dripsEvaluated = false;

  for (let i = 0; i < candidateBlocks.length; i++) {
    const blk = candidateBlocks[i];
    if (!feeding) {
      feeding = extractFeedingFromBlock(blk);
    }
    if (!dripsEvaluated) {
      const blkMetrics = extractClinicalMetricsFromBlock(blk);
      if (blkMetrics.drips) {
        drips = cleanActiveDrips(blkMetrics.drips);
        dripsEvaluated = true;
      }
    }
    for (const line of blk.split('\n')) {
      const trimmed = line.trim();
      if (!vent && /^(?:[-*]\s*)?(?:Vent(?:ilator)?|Vent\s+Settings|Settings):\s*(.+)$/i.test(trimmed)) {
        const val = trimmed.replace(/^(?:[-*]\s*)?(?:Vent(?:ilator)?|Vent\s+Settings|Settings):\s*/i, '').trim();
        if (val && !/^(?:same\s+settings|none|off|extubated|discontinued|d\/c)$/i.test(val)) {
          vent = val;
        }
      }
    }
    if (vent && feeding && dripsEvaluated) break;
    // Do not reach across prior structured shifts for drips if primary block explicitly omitted drips, unless primary is addendum
    if (i === 0 && !primaryAddendum) {
      dripsEvaluated = true;
    }
  }

  const peInfo = extractLatestPeFromChart(text);
  const fmMeta = metaOf(text);
  let contingencies = fmMeta.contingencies || fmMeta.contingency || fmMeta.if_then || '';
  if (!contingencies) {
    for (const blk of candidateBlocks) {
      const m = String(blk || '').match(/^(?:[-*]\s*)?(?:Contingenc(?:y|ies)|If\s*\/\s*Then):\s*(.+)$/im);
      if (m && m[1].trim() && !/^(?:none|nil|n\/a|-)$/i.test(m[1].trim())) {
        contingencies = m[1].trim();
        break;
      }
    }
  }

  return {
    openPending,
    completedPendingCount,
    servicePlans,
    vent,
    drips,
    feeding,
    pe: peInfo.pe,
    peSource: peInfo.source,
    contingencies,
    hasPriorBlock: segment.hasShiftHeading,
  };
}

export function renderCustomShiftTemplate(template, content, shift = '6am', options = {}) {
  const tpl = String(template || '').replace(/\r\n/g, '\n');
  const parsed = parseChart(content, options.note || {});
  const meta = metaOf(content);
  const data = extractCarryForwardData(content);
  const cleanShift = String(shift || '6am').trim() || '6am';

  const ap = parsed.ap || '';
  const name = parsed.name !== 'Unknown Patient' ? parsed.name : '';
  const age = parsed.age || '';
  const sex = parsed.sex || '';
  const weight = parsed.weight || '';
  const ageSex = [age, sex].filter(Boolean).join('/');
  const room = parsed.room !== 'Unassigned' ? parsed.room : '';
  const assessment = parsed.assessment || '';
  const date = options.dateStr || getTodayDateStrings().mmddyyyy;

  const carryPending = options.carryPending !== false;
  const carryServicePlans = options.carryServicePlans !== false;
  const carryStanding = options.carryStanding !== false;
  const carryFeeding = options.carryFeeding !== undefined ? options.carryFeeding !== false : carryStanding;
  const carryPe = options.carryPe !== false;

  const hasExplicitAssessment = /\{\{\s*(?:assessment|problem[_\s]+list)\s*\}\}/i.test(tpl);
  const hasExplicitPlans = /\{\{\s*(?:pending|service[_\s]+plans)\s*\}\}/i.test(tpl);
  const hasExplicitVent = /\{\{\s*vent\s*\}\}/i.test(tpl);
  const hasExplicitDrips = /\{\{\s*drips\s*\}\}/i.test(tpl);
  const hasExplicitPe = /\{\{\s*(?:pe|physical[_\s]+exam)\s*\}\}/i.test(tpl);

  let rendered = tpl;

  // 1. Obsidian Templater frontmatter & title tags
  rendered = rendered.replace(/<%\s*tp\.frontmatter\.([A-Za-z0-9_\s-]+)\s*%>/gi, (_, rawKey) => {
    const k = rawKey.trim().toLowerCase();
    if (meta[k]) return meta[k];
    if (k === 'ap' || k === 'attending') return ap;
    if (k === 'room' || k === 'bed' || k === 'rm') return room;
    if (k === 'name' || k === 'patient') return name;
    if (k === 'age') return age;
    if (k === 'sex' || k === 'gender') return sex;
    if (k === 'weight' || k === 'wt' || k === 'weight_kg') return weight;
    if (k === 'assessment' || k === 'impression' || k === 'dx') return assessment;
    return '';
  });

  rendered = rendered.replace(/<%\s*tp\.file\.title\s*%>/gi, () => name);

  // 2. Double-brace placeholders (including friendly layman aliases)
  const ventVal = carryStanding ? data.vent : '';
  const dripsVal = carryStanding ? String(data.drips || '').split(/\s*\|\s*/).filter(Boolean).join('\n') : '';
  const feedingVal = carryFeeding ? data.feeding : '';
  const peVal = carryPe ? data.pe : '';
  const pendingVal = carryPending ? data.openPending.map((p) => `- [ ] ${p}`).join('\n') : '';
  const servicePlansVal = carryServicePlans ? data.servicePlans.map((p) => `- ${p}`).join('\n') : '';

  const braceValues = {
    ap,
    attending: ap,
    'attending physician': ap,
    name,
    'patient name': name,
    patient: name,
    age,
    sex,
    weight,
    'weight (kg)': weight,
    age_sex: ageSex,
    'age/sex': ageSex,
    room,
    'room/bed': room,
    'room/bed no.': room,
    'room/bed no': room,
    bed: room,
    assessment,
    problem_list: assessment,
    'problem list': assessment,
    shift: cleanShift,
    date,
    vent: ventVal,
    drips: dripsVal,
    feeding: feedingVal,
    diet: feedingVal,
    'diet/feeding': feedingVal,
    nutrition: feedingVal,
    pe: peVal,
    physical_exam: peVal,
    'physical exam': peVal,
    pending: pendingVal,
    service_plans: servicePlansVal,
    'service plans': servicePlansVal,
  };

  const optionalLineRe = /^(?:(?:Vent|Feeding|Diet):\s*)?\{\{\s*(drips|vent|feeding|diet|diet\/feeding|nutrition|pe|physical_exam|physical\s+exam|service_plans|service\s+plans|pending|assessment|problem_list|problem\s+list)\s*\}\}$/i;
  const outLines = [];
  for (const line of rendered.split('\n')) {
    const trimmed = line.trim();
    const optMatch = trimmed.match(optionalLineRe);
    if (optMatch) {
      const k = optMatch[1].trim().toLowerCase();
      if (!braceValues[k]) continue;
    }
    const replaced = line.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, rawKey) => {
      const k = rawKey.trim().toLowerCase();
      return Object.hasOwn(braceValues, k) ? braceValues[k] : full;
    });
    outLines.push(replaced);
  }
  rendered = outLines.join('\n');

  // 3. Parenthetical line placeholders
  rendered = rendered.replace(/^\(Age\)$/gim, () => ageSex || '(Age)');
  rendered = rendered.replace(/^\(Room\)$/gim, () => room || '(Room)');

  if (carryPe && data.pe && !hasExplicitPe) {
    const defaultMorningPeRe =
      /^Awake,\s*NIRD\nHEENT:\s*Anicteric sclerae, pink palpebral conjunctivae\nC\/L:\s*ECE, clear breath sounds\nCVS:\s*DHS, regular rate and rhythm\nABD:\s*Soft, non-tender abdomen,?[ \t]*\nEXT:\s*Strong peripheral pulses, CRT <2 secs$/m;
    if (rendered.includes(DEFAULT_NORMAL_PE_TEXT)) {
      rendered = rendered.replace(DEFAULT_NORMAL_PE_TEXT, () => data.pe);
    } else if (defaultMorningPeRe.test(rendered)) {
      rendered = rendered.replace(defaultMorningPeRe, () => data.pe);
    }
  }

  // 4. Smart carry-forward injection when explicit tags are absent
  if (!hasExplicitAssessment && assessment) {
    rendered = rendered.replace(/^([ \t]*Problem\s+list:)[ \t]*$/im, (_, hdr) => `${hdr}\n${assessment}`);
  }

  const carriedLines = [];
  if (!hasExplicitPlans) {
    if (carryServicePlans && data.servicePlans.length > 0) {
      for (const plan of data.servicePlans) carriedLines.push(`- ${plan}`);
    }
    if (carryPending && data.openPending.length > 0) {
      for (const item of data.openPending) carriedLines.push(`- [ ] ${item}`);
    }
  }
  const standingLines = [];
  if (carryStanding) {
    if (data.vent && !hasExplicitVent) standingLines.push(`Vent: ${data.vent}`);
    if (data.drips && !hasExplicitDrips) {
      const dripsBlk = formatDripsMarkdownBlock(data.drips);
      if (dripsBlk) standingLines.push(dripsBlk);
    }
  }

  if (!hasExplicitPlans && (carriedLines.length > 0 || standingLines.length > 0)) {
    const allPlanLines = [...carriedLines, ...standingLines];
    rendered = rendered.replace(
      /^([ \t]*Plan:)[ \t]*$/im,
      (_, hdr) => `${hdr}\n${allPlanLines.join('\n')}`
    );
  } else if (hasExplicitPlans && standingLines.length > 0) {
    const standingBlock = standingLines.join('\n');
    if (/^[ \t]*Plan:/im.test(rendered)) {
      rendered = rendered.replace(/^[ \t]*(?=Plan:)/im, `${standingBlock}\n\n`);
    } else {
      rendered = `${rendered.trimEnd()}\n\n${standingBlock}`;
    }
  }

  return `### ${cleanShift}\n${rendered.replace(/^\n+/, '').replace(/\s+$/, '')}\n`;
}

export function buildCarryForwardShiftBlock(content, shift = '6am', options = {}) {
  const cleanShift = String(shift || '6am').trim() || '6am';
  const interim = isInterimShift(cleanShift);

  if (!interim && options && typeof options.template === 'string' && options.template.trim()) {
    return renderCustomShiftTemplate(options.template, content, cleanShift, options);
  }

  const {
    carryPending = true,
    carryServicePlans = true,
    carryStanding = true,
    carryFeeding = carryStanding,
    carryPe = true,
    carryContingencies = true,
    planMode = 'service',
    isMorningShift = false,
  } = options || {};
  const data = extractCarryForwardData(content);
  const planHeading = (PLAN_MODES[planMode] || PLAN_MODES.service).heading;

  if (interim) {
    const lines = [
      `### ${cleanShift}`,
      'Event / Update: ',
      'Vitals: BP  | HR  | RR  | T  | O2sat % on RA',
    ];
    if (carryStanding && data.vent) lines.push(`Vent: ${data.vent}`);
    if (carryStanding && data.drips) {
      const dripsBlk = formatDripsMarkdownBlock(data.drips);
      if (dripsBlk) lines.push(dripsBlk);
    }
    if (carryContingencies && data.contingencies) lines.push(`Contingencies: ${data.contingencies}`);
    if (carryPending && data.openPending.length > 0) {
      lines.push('**Pending:');
      for (const item of data.openPending) {
        lines.push(`- [ ] ${item}`);
      }
    }
    if (carryServicePlans && data.servicePlans.length > 0) {
      lines.push(planHeading);
      for (const plan of data.servicePlans) {
        lines.push(`- ${plan}`);
      }
    }
    return lines.join('\n') + '\n';
  }

  const isMorning = Boolean(isMorningShift) || /^6\s*am$/i.test(cleanShift);
  const lines = [`### ${cleanShift}`, 'Vitals: BP  | HR  | RR  | T  | O2sat % on RA'];

  if (carryStanding && data.vent) {
    lines.push(`Vent: ${data.vent}`);
  }

  lines.push(isMorning ? 'Shift I&O: In:  | Out:  | Net:  (24h Net: )' : 'Shift I&O: In:  | Out:  | Net: ');

  if (carryFeeding && data.feeding) {
    lines.push(data.feeding.includes('\n') ? `Feeding:\n${data.feeding}` : `Feeding: ${data.feeding}`);
  }

  if (carryPe && data.pe) {
    lines.push(data.pe);
  }

  if (carryStanding && data.drips) {
    const dripsBlk = formatDripsMarkdownBlock(data.drips);
    if (dripsBlk) lines.push(dripsBlk);
  }

  if (carryContingencies && data.contingencies) {
    lines.push(`Contingencies: ${data.contingencies}`);
  }

  if (!data.hasPriorBlock) {
    lines.push('**Pending:');
    lines.push('- [ ] ');
  } else if (carryPending && data.openPending.length > 0) {
    lines.push('**Pending:');
    for (const item of data.openPending) {
      lines.push(`- [ ] ${item}`);
    }
  }

  if (!data.hasPriorBlock) {
    lines.push(planHeading);
    lines.push('- ');
  } else if (carryServicePlans && data.servicePlans.length > 0) {
    lines.push(planHeading);
    for (const plan of data.servicePlans) {
      lines.push(`- ${plan}`);
    }
  }

  return lines.join('\n') + '\n';
}

function normalizeStructuredLines(rawText, { checklist = false } = {}) {
  return String(rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      if (checklist) {
        const cb = line.match(/^[-*]?\s*\[([ xX])\]\s*(.+)$/);
        if (cb) return `- [${cb[1].toLowerCase() === 'x' ? 'x' : ' '}] ${cb[2].trim()}`;
        return `- [ ] ${line.replace(/^(?:[-*]|\d+[.)])\s+/, '').trim()}`;
      }
      return `- ${line.replace(/^[-*]\s*\[[ xX]\]\s*/, '').replace(/^(?:[-*]|\d+[.)])\s+/, '').trim()}`;
    });
}

function formatStructuredVitals(values = {}) {
  const sbp = String(values.sbp || '').trim();
  const dbp = String(values.dbp || '').trim();
  const bp = sbp && dbp ? `${sbp}/${dbp}` : sbp || (dbp ? `/${dbp}` : '');
  const hr = String(values.hr || '').trim();
  const rr = String(values.rr || '').trim();
  const temp = String(values.temp || '').trim();
  const o2 = String(values.o2 || '').trim();
  if (!bp && !hr && !rr && !temp && !o2) return '';
  const parts = [];
  if (bp) parts.push(`BP ${bp}`);
  if (hr) parts.push(`HR ${hr}`);
  if (rr) parts.push(`RR ${rr}`);
  if (temp) parts.push(`T ${temp}`);
  if (o2) parts.push(`O2sat ${o2}`);
  return `Vitals: ${parts.join(' | ')}`;
}

function formatStructuredIo(values = {}) {
  const unit = String(values.ioUnit || 'ml').trim() || 'ml';
  const fmtUnit = (raw) => {
    const clean = String(raw || '').trim();
    if (!clean) return '';
    return /[a-z]/i.test(clean) ? clean : `${clean}${unit}`;
  };
  const inVal = fmtUnit(values.ioIn);
  const outVal = fmtUnit(values.ioOut);
  if (!inVal && !outVal) return '';
  const fb = inVal && outVal ? computeShiftFluidBalance(inVal, outVal) : '';
  const parts = [];
  if (inVal) parts.push(`In: ${inVal}`);
  if (outVal) parts.push(`Out: ${outVal}`);
  if (fb) parts.push(`FB: ${fb}`);
  return `Shift I&O: ${parts.join(' | ')}`;
}

function resolveSimplePlaceholders(templateStr, parsed = {}, cleanShift = '6am', dateStr = '') {
  const ap = parsed.ap || '';
  const name = parsed.name && parsed.name !== 'Unknown Patient' ? parsed.name : '';
  const ageSex = [parsed.age, parsed.sex].filter(Boolean).join('/');
  const room = parsed.room && parsed.room !== 'Unassigned' ? parsed.room : '';
  const map = {
    ap,
    attending: ap,
    'attending physician': ap,
    name,
    'patient name': name,
    patient: name,
    age: parsed.age || '',
    sex: parsed.sex || '',
    weight: parsed.weight || '',
    age_sex: ageSex,
    'age/sex': ageSex,
    room,
    'room/bed': room,
    bed: room,
    shift: cleanShift,
    date: dateStr || getTodayDateStrings().mmddyyyy,
  };
  return String(templateStr || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (full, rawKey) => {
    const k = rawKey.trim().toLowerCase();
    return Object.hasOwn(map, k) ? map[k] : '';
  });
}

export function buildStructuredShiftUpdate({
  shift = '6am',
  config = DEFAULT_TEMPLATE_CONFIG,
  values = {},
  parsed = {},
  isInterim = false,
  dateStr = '',
  planMode = 'service',
} = {}) {
  const cleanShift = String(shift || '6am').trim() || '6am';
  const interimMode = Boolean(isInterim) || isInterimShift(cleanShift);
  const planHeading = (PLAN_MODES[planMode] || PLAN_MODES.service).heading;

  if (interimMode) {
    const blocks = [];
    const ev = String(values.interimEvent || '').trim();
    if (ev) blocks.push(`Event / Update: ${ev}`);
    const vsLine = formatStructuredVitals(values);
    if (vsLine) blocks.push(vsLine);
    const ventLine = String(values.vent || '').trim();
    if (ventLine) blocks.push(`Vent: ${ventLine}`);
    const dripsBlk = formatDripsMarkdownBlock(values.drips);
    if (dripsBlk) blocks.push(dripsBlk);
    const contLine = String(values.contingencies || '').trim();
    if (contLine) blocks.push(`Contingencies: ${contLine}`);
    const labsTxt = String(values.labs || '').trim();
    if (labsTxt) blocks.push(`Labs:\n${labsTxt}`);
    const medLines = normalizeStructuredLines(values.meds);
    if (medLines.length) blocks.push(`Medications:\n${medLines.join('\n')}`);
    const pendingLines = normalizeStructuredLines(values.pending, { checklist: true });
    if (pendingLines.length) blocks.push(`**Pending:\n${pendingLines.join('\n')}`);
    const planLines = normalizeStructuredLines(values.servicePlans);
    if (planLines.length) blocks.push(`${planHeading}\n${planLines.join('\n')}`);
    return `### ${cleanShift}\n${blocks.length ? blocks.join('\n\n') : 'Event / Update: '}\n`;
  }

  const cfg = config || DEFAULT_TEMPLATE_CONFIG;
  const blocks = [];

  const rawHeader = resolveSimplePlaceholders(cfg.header || '', parsed, cleanShift, dateStr)
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  if (rawHeader) blocks.push(rawHeader);

  const ptLines = [];
  if (cfg.showName !== false && parsed.name && parsed.name !== 'Unknown Patient') ptLines.push(parsed.name);
  if (cfg.showAgeSex !== false) {
    const ageSex = [parsed.age, parsed.sex].filter(Boolean).join('/');
    if (ageSex) ptLines.push(ageSex);
  }
  if (cfg.showRoom !== false && parsed.room && parsed.room !== 'Unassigned') ptLines.push(parsed.room);
  if (ptLines.length) blocks.push(ptLines.join('\n'));

  const sections = Array.isArray(cfg.sections) ? cfg.sections : DEFAULT_TEMPLATE_CONFIG.sections;
  for (const sec of sections) {
    if (!sec || !sec.enabled) continue;
    switch (sec.id) {
      case 'labs': {
        const labsTxt = String(values.labs || '').trim();
        if (labsTxt) blocks.push(`Laboratory updates:\n${labsTxt}`);
        break;
      }
      case 'subjective': {
        const subjTxt = String(values.subjective || '').trim();
        if (subjTxt) blocks.push(`Subjective:\n${subjTxt}`);
        break;
      }
      case 'objective': {
        const subs = Array.isArray(sec.subItems) ? sec.subItems : [];
        const objParts = [];
        const hasIoSub = subs.some((s) => s && s.enabled && s.id === 'io');
        const io24Val = String(values.io24 || '').trim();
        for (const sub of subs) {
          if (!sub || !sub.enabled) continue;
          if (sub.id === 'vitals') {
            const vsLine = formatStructuredVitals(values);
            if (vsLine) objParts.push(vsLine);
          } else if (sub.id === 'io') {
            let ioLine = formatStructuredIo(values);
            if (ioLine && io24Val && subs.some((s) => s && s.enabled && s.id === 'io24')) {
              ioLine = `${ioLine} (24h Net: ${io24Val})`;
            }
            if (ioLine) objParts.push(ioLine);
          } else if (sub.id === 'io24') {
            if (io24Val && (!hasIoSub || !formatStructuredIo(values))) {
              objParts.push(`24h Net: ${io24Val}`);
            }
          } else if (sub.id === 'vent') {
            const ventVal = String(values.vent || '').trim();
            if (ventVal) objParts.push(`Vent: ${ventVal}`);
          } else if (sub.id === 'feeding') {
            const feedingVal = String(values.feeding || '').trim();
            if (feedingVal) {
              objParts.push(
                feedingVal.includes('\n') ? `Feeding:\n${feedingVal}` : `Feeding: ${feedingVal}`
              );
            }
          } else if (sub.id === 'pe') {
            const peVal = String(values.pe || '').trim();
            if (peVal) objParts.push(peVal);
          }
        }
        if (objParts.length) blocks.push(objParts.join('\n\n'));
        break;
      }
      case 'assessment': {
        const assessTxt = String(values.assessment || '').trim();
        if (assessTxt) {
          blocks.push(
            assessTxt.includes('\n') ? `Assessment:\n${assessTxt}` : `Assessment: ${assessTxt}`
          );
        }
        break;
      }
      case 'meds': {
        const medBlocks = [];
        const dripsBlk = formatDripsMarkdownBlock(values.drips);
        if (dripsBlk) medBlocks.push(dripsBlk);
        const medLines = normalizeStructuredLines(values.meds);
        if (medLines.length) medBlocks.push(`Medications:\n${medLines.join('\n')}`);
        if (medBlocks.length) blocks.push(medBlocks.join('\n\n'));
        break;
      }
      case 'plan': {
        const planBlocks = [];
        const spLines = normalizeStructuredLines(values.servicePlans);
        if (spLines.length) planBlocks.push(`${planHeading}\n${spLines.join('\n')}`);
        const contTxt = String(values.contingencies || '').trim();
        if (contTxt) planBlocks.push(`Contingencies: ${contTxt}`);
        const pendLines = normalizeStructuredLines(values.pending, { checklist: true });
        if (pendLines.length) planBlocks.push(`**Pending:\n${pendLines.join('\n')}`);
        if (planBlocks.length) blocks.push(planBlocks.join('\n\n'));
        break;
      }
    }
  }

  const footerTxt = resolveSimplePlaceholders(cfg.footer || '', parsed, cleanShift, dateStr).trim();
  if (footerTxt) blocks.push(footerTxt);

  return `### ${cleanShift}\n${blocks.join('\n\n')}\n`;
}

function stripListItemPrefix(line) {
  return String(line || '')
    .replace(/^(?:[•\-*]|\d+[.)])\s+/, '')
    .trim();
}

function isShiftEditBoundary(trimmed) {
  if (!trimmed) return false;
  if (/^#{2,6}\s+/.test(trimmed) || /^---+$/.test(trimmed)) return true;
  if (/^\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}\s*:?\s*$/i.test(trimmed)) return true;
  if (/^[-*]\s*\[[ xX]\]/.test(trimmed)) return true;
  if (/^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i.test(trimmed)) return true;
  return /^(?:\*{0,2})(?:Subjective|S>|S|Objective|O>|O|Assessment|Impression|Working\s+Impression|Problem\s+list|PE|Physical\s+Exam(?:ination)?|Event\s*\/\s*Update|Interval|Labs?|Laboratory(?:\s+updates?)?|Vitals?|VS|Vent(?:ilator)?(?:\s+Settings)?|Settings|Shift\s+I&O|I&O|Drips?|Infusions?|Medications?|Meds?|Current\s+Meds?|Active\s+Medications?|Therapeutics|Service\s+Plans?|Problem-?Based\s+Plans?|Systems-?Based(?:\s+ICU)?\s+Plans?|Plans?|Generic\s+Plans?|General\s+Plans?|Routine\s+Plans?|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?|Feeding|Diet|Nutrition|Contingenc(?:y|ies)|If\s*\/\s*Then|HGTs?|CBGs?|Greeting|Footer)(?:\*{0,2})\s*:/i.test(
    trimmed
  ) || /^(?:\*{0,2})(?:Medications?|Meds?|Drips?|Pending|Plans?|Labs?)(?:\*{0,2})\s*$/i.test(trimmed);
}

export function parseShiftBlockForEdit(blockBody) {
  const text = String(blockBody || '').replace(/\r\n/g, '\n').trim();
  const empty = {
    subjective: '',
    sbp: '',
    dbp: '',
    hr: '',
    rr: '',
    temp: '',
    o2: '',
    vitalsExtra: '',
    ioIn: '',
    ioOut: '',
    ioUnit: 'ml',
    io24: '',
    vent: '',
    feeding: '',
    pe: '',
    labs: '',
    assessment: '',
    drips: '',
    meds: '',
    servicePlans: '',
    planHeading: '',
    contingencies: '',
    pending: [],
    prefixBoilerplate: '',
    suffixBoilerplate: '',
    otherNotes: '',
  };
  if (!text) return empty;

  const lines = text.split('\n');
  const metrics = extractClinicalMetricsFromBlock(text);
  const claimed = new Set(metrics.consumedLineIndices || []);

  // Split vitals string into split quick-inputs + extras
  let sbp = '';
  let dbp = '';
  let hr = '';
  let rr = '';
  let temp = '';
  let o2 = '';
  const vitalsExtraParts = [];
  if (metrics.vitals) {
    for (const part of metrics.vitals.split(/\s*\|\s*/)) {
      const p = part.trim();
      if (!p) continue;
      const bpMatch = p.match(/^(?:BP\s*[:=]?\s*)?(\d{2,3})\s*\/\s*(\d{2,3})(?:\s*\(([^)]+)\))?$/i);
      if (bpMatch && !sbp && !dbp) {
        sbp = bpMatch[1];
        dbp = bpMatch[2];
        if (bpMatch[3] && !/^MAP\b/i.test(bpMatch[3].trim())) {
          vitalsExtraParts.push(`BP (${bpMatch[3].trim()})`);
        }
        continue;
      }
      const hrMatch = p.match(/^(?:HR|PR)\s*[:=]?\s*(.+)$/i);
      if (hrMatch && !hr) {
        hr = hrMatch[1].trim();
        continue;
      }
      const rrMatch = p.match(/^RR\s*[:=]?\s*(.+)$/i);
      if (rrMatch && !rr) {
        rr = rrMatch[1].trim();
        continue;
      }
      const tMatch = p.match(/^(?:Tmax|Temp|T)\s*[:=]?\s*(.+)$/i);
      if (tMatch && !temp) {
        temp = tMatch[1].trim();
        continue;
      }
      const o2Match = p.match(/^(?:O2(?:\s*sat)?|SpO2)\s*[:=]?\s*(.+)$/i);
      if (o2Match && !o2) {
        const val = o2Match[1].trim();
        if (!/^%\s*on\s*RA$/i.test(val)) o2 = val;
        continue;
      }
      vitalsExtraParts.push(p);
    }
  }

  // Split I&O + 24h net into form inputs
  let ioIn = '';
  let ioOut = '';
  let ioUnit = 'ml';
  let io24 = metrics.io24h || '';
  if (metrics.io) {
    let shiftIoStr = metrics.io;
    const inline24Match = shiftIoStr.match(/\(24h\s+(?:Net|FB)\s*:\s*([^)]+)\)/i);
    if (inline24Match) {
      if (!io24) io24 = inline24Match[1].trim();
      shiftIoStr = shiftIoStr.replace(inline24Match[0], '').trim();
    }
    const split24Match = shiftIoStr.match(/\s*·\s*24h\s*:\s*(.+)$/i);
    if (split24Match) {
      if (!io24) io24 = split24Match[1].trim();
      shiftIoStr = shiftIoStr.slice(0, split24Match.index).trim();
    }
    const inM = shiftIoStr.match(/\bIn\s*:\s*([^|()]+)/i);
    const outM = shiftIoStr.match(/\bOut\s*:\s*([^|()]+)/i);
    const rawIn = inM ? inM[1].trim() : '';
    const rawOut = outM ? outM[1].trim() : '';
    const inIsL = /^\d+(?:\.\d+)?\s*l$/i.test(rawIn);
    const outIsL = /^\d+(?:\.\d+)?\s*l$/i.test(rawOut);
    const inIsMl = /^\d+(?:\.\d+)?\s*(?:ml|cc)?$/i.test(rawIn);
    const outIsMl = /^\d+(?:\.\d+)?\s*(?:ml|cc)?$/i.test(rawOut);
    if ((inIsL || !rawIn) && (outIsL || !rawOut) && (inIsL || outIsL)) {
      ioUnit = 'L';
      ioIn = rawIn.replace(/\s*l$/i, '').trim();
      ioOut = rawOut.replace(/\s*l$/i, '').trim();
    } else {
      ioUnit = 'ml';
      ioIn = inIsMl ? rawIn.replace(/\s*(?:ml|cc)$/i, '').trim() : rawIn;
      ioOut = outIsMl ? rawOut.replace(/\s*(?:ml|cc)$/i, '').trim() : rawOut;
    }
  }

  const drips = metrics.drips
    ? metrics.drips
        .split(/\s*\|\s*/)
        .map((d) => d.trim())
        .filter(Boolean)
        .join('\n')
    : '';

  // Detect leading greeting/patient-header boilerplate & trailing sign-off footer
  const prefixLines = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (prefixLines.length > 0) continue;
      break;
    }
    if (/^(?:Greeting:|Good\s+(?:day|morning|afternoon|evening)|Update\s+on\s+your\s+patient)/i.test(trimmed)) {
      prefixLines.push(trimmed);
      claimed.add(i);
      continue;
    }
    if (
      prefixLines.length > 0 &&
      !isShiftEditBoundary(trimmed) &&
      !claimed.has(i) &&
      trimmed.length <= 60 &&
      (/^Room\s+/i.test(trimmed) || /^\d{1,3}\s*\/\s*[MF]$/i.test(trimmed) || /^[A-Z][a-z]+(?:\s+[A-Z]\.?)?(?:\s+[A-Z][a-z]+)+$/.test(trimmed))
    ) {
      prefixLines.push(trimmed);
      claimed.add(i);
      continue;
    }
    break;
  }

  const suffixLines = [];
  let footerStartIdx = lines.length;
  for (let i = Math.max(0, lines.length - 6); i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (/^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i.test(trimmed)) {
      footerStartIdx = i;
      break;
    }
  }
  if (footerStartIdx < lines.length) {
    for (let i = footerStartIdx; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (!isShiftEditBoundary(trimmed) || /^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i.test(trimmed)) {
        suffixLines.push(trimmed);
        claimed.add(i);
      }
    }
  }

  const subjectiveLines = [];
  const peLines = [];
  const assessmentLines = [];
  const feedingLines = [];
  const contingencyLines = [];
  const medLines = [];
  const medSeen = new Set();
  const planLines = [];
  const planSeen = new Set();
  const rawLabLines = [];
  const pending = [];
  const pendingSeen = new Set();
  let planHeading = '';
  let section = '';
  let activeSpecialtyPlan = '';

  const pushMedLine = (raw) => {
    const clean = stripListItemPrefix(String(raw || '').replace(/^[-*]\s*\[[ xX]\]\s*/, ''));
    if (isMedPlaceholder(clean)) return;
    const key = clean.toLowerCase();
    if (!medSeen.has(key)) {
      medSeen.add(key);
      medLines.push(clean);
    }
  };

  const pushPlanLine = (raw, tagPrefix = '') => {
    const clean = stripListItemPrefix(raw);
    if (!clean || /^none$/i.test(clean)) return;
    const labeled = tagPrefix && !clean.toLowerCase().startsWith(`${tagPrefix.toLowerCase()}:`)
      ? `${tagPrefix}: ${clean}`
      : clean;
    const key = labeled.toLowerCase();
    if (!planSeen.has(key)) {
      planSeen.add(key);
      planLines.push(labeled);
    }
  };

  const pushPendingLine = (txt, checked) => {
    const clean = String(txt || '').trim();
    if (!clean || /^none$/i.test(clean)) return;
    const key = clean.toLowerCase();
    if (!pendingSeen.has(key)) {
      pendingSeen.add(key);
      pending.push({ text: clean, checked: Boolean(checked) });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (section && !['pending', 'meds', 'plans'].includes(section)) {
        section = '';
      }
      continue;
    }

    if (claimed.has(i) && !/^(?:\*{0,2})(?:Labs?|Laboratory(?:\s+updates?)?)(?:\*{0,2})\s*:/i.test(trimmed)) {
      if (section === 'labs') {
        if (isShiftEditBoundary(trimmed)) section = '';
        else rawLabLines.push(stripListItemPrefix(trimmed));
      } else if (section) {
        section = '';
      }
      continue;
    }

    // Explicit checkboxes anywhere
    const cbMatch = trimmed.match(/^[-*]?\s*\[([ xX])\]\s*(.*)$/);
    if (cbMatch) {
      claimed.add(i);
      pushPendingLine(cbMatch[2], cbMatch[1].toLowerCase() === 'x');
      continue;
    }

    // Pending header
    if (/^\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}\s*:?\s*$/i.test(trimmed)) {
      claimed.add(i);
      section = 'pending';
      continue;
    }

    // Subjective / Event heading
    const subjMatch = trimmed.match(/^(?:\*{0,2})(?:Subjective|S>|S|Event\s*\/\s*Update|Interval)(?:\*{0,2})\s*:\s*(.*)$/i);
    if (subjMatch) {
      claimed.add(i);
      section = 'subjective';
      const inline = subjMatch[1].trim();
      if (inline && !/^(?:none|n\/a|-)$/i.test(inline)) subjectiveLines.push(inline);
      continue;
    }

    // PE heading
    const peMatch = trimmed.match(/^(?:\*{0,2})(?:PE|Physical\s+Exam(?:ination)?)(?:\*{0,2})\s*:\s*(.*)$/i);
    if (peMatch) {
      claimed.add(i);
      section = 'pe';
      const inline = peMatch[1].trim();
      if (inline && !/^(?:none|n\/a|-)$/i.test(inline)) peLines.push(inline);
      continue;
    }

    // Labs heading
    const labsMatch = trimmed.match(/^(?:\*{0,2})(?:Labs?|Laboratory(?:\s+updates?)?)(?:\*{0,2})\s*:\s*(.*)$/i);
    if (labsMatch) {
      claimed.add(i);
      section = 'labs';
      const inline = labsMatch[1].trim();
      if (inline) rawLabLines.push(inline);
      continue;
    }

    // Assessment heading
    const assessMatch = trimmed.match(/^(?:\*{0,2})(?:Assessment|Impression|Working\s+Impression|Problem\s+list)(?:\*{0,2})\s*:\s*(.*)$/i);
    if (assessMatch) {
      claimed.add(i);
      section = 'assessment';
      const inline = assessMatch[1].trim();
      if (inline && !/^(?:none|n\/a|-)$/i.test(inline)) assessmentLines.push(inline);
      continue;
    }

    // Feeding heading
    const feedMatch = trimmed.match(/^(?:\*{0,2})(?:Feeding|Diet|Nutrition)(?:\*{0,2})\s*:\s*(.*)$/i);
    if (feedMatch) {
      claimed.add(i);
      section = 'feeding';
      const inline = feedMatch[1].trim();
      if (inline && !/^(?:none|n\/a|-)$/i.test(inline)) feedingLines.push(inline);
      continue;
    }

    // Contingencies heading
    const contMatch = trimmed.match(/^(?:\*{0,2})(?:Contingenc(?:y|ies)|If\s*\/\s*Then)(?:\*{0,2})\s*:\s*(.*)$/i);
    if (contMatch) {
      claimed.add(i);
      section = 'contingencies';
      const inline = contMatch[1].trim();
      if (inline && !/^(?:none|nil|n\/a|-)$/i.test(inline)) contingencyLines.push(inline);
      continue;
    }

    // Medications heading
    const medMatch =
      trimmed.match(/^(?:#{2,6}\s+)?(?:\*{0,2})(?:(?:Current|Active)\s+)?(?:Medications?|Meds?)(?:\s*\/\s*Drips?)?(?:\*{0,2})(?:\s*:\s*(.*)|\s*)$/i) ||
      trimmed.match(/^(?:\*{0,2})Therapeutics(?:\*{0,2})\s*:\s*(.*)$/i);
    if (medMatch) {
      claimed.add(i);
      section = 'meds';
      const inline = (medMatch[1] || '').trim();
      if (inline) {
        for (const piece of inline.split(/[|;]/)) pushMedLine(piece);
      }
      continue;
    }

    // Plans heading
    const planHdrMatch = trimmed.match(
      /^(?:\*{0,2})(Service|Problem-?Based|Systems-?Based(?:\s+ICU)?|Generic|General|Routine|[A-Za-z][A-Za-z\s/&+-]{1,25})?\s*Plans?(?:\*{0,2})\s*:\s*(.*)$/i
    );
    if (planHdrMatch) {
      const prefix = (planHdrMatch[1] || '').trim();
      if (/^(?:generic|general|routine)$/i.test(prefix)) {
        // Keep generic routine plans in otherNotes only if meaningful, or preserve cleanly as un-tagged plans
        section = '';
        continue;
      }
      claimed.add(i);
      section = 'plans';
      const normalizedHdr = `${prefix ? `${prefix} ` : ''}Plans:`.replace(/\s+/g, ' ');
      if (!planHeading) {
        planHeading = normalizedHdr;
        activeSpecialtyPlan = '';
      } else if (normalizedHdr.toLowerCase() !== planHeading.toLowerCase()) {
        activeSpecialtyPlan = prefix;
      } else {
        activeSpecialtyPlan = '';
      }
      const inline = (planHdrMatch[2] || '').trim();
      if (inline) pushPlanLine(inline, activeSpecialtyPlan);
      continue;
    }

    // Continuation inside an active section
    if (section) {
      if (isShiftEditBoundary(trimmed)) {
        section = '';
        // Re-evaluate this line below if not claimed
      } else {
        claimed.add(i);
        if (section === 'subjective') subjectiveLines.push(trimmed);
        else if (section === 'pe') peLines.push(trimmed);
        else if (section === 'labs') rawLabLines.push(stripListItemPrefix(trimmed));
        else if (section === 'assessment') assessmentLines.push(trimmed);
        else if (section === 'feeding') feedingLines.push(trimmed);
        else if (section === 'contingencies') contingencyLines.push(trimmed);
        else if (section === 'meds') {
          if (/[|;]/.test(trimmed) && !/^(?:[•\-*]|\d+[.)])\s+/.test(trimmed)) {
            for (const piece of trimmed.split(/[|;]/)) pushMedLine(piece);
          } else {
            pushMedLine(trimmed);
          }
        } else if (section === 'plans') {
          pushPlanLine(trimmed, activeSpecialtyPlan);
        } else if (section === 'pending') {
          const item = stripListItemPrefix(trimmed);
          if (item && !/^none$/i.test(item)) pushPendingLine(item, false);
        }
        continue;
      }
    }
  }

  // Catch implicit PE & implicit Subjective on remaining unclaimed lines
  const implicitPeSet = new Set(
    peLines.length === 0
      ? extractPeLinesFromBlock(text)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean)
      : []
  );

  const otherNotesLines = [];
  for (let i = 0; i < lines.length; i++) {
    if (claimed.has(i)) continue;
    const trimmed = lines[i].trim();
    if (!trimmed || /^[-*]\s*$/.test(trimmed)) continue;
    if (implicitPeSet.has(trimmed)) {
      peLines.push(trimmed);
      claimed.add(i);
      continue;
    }
    if (PE_SUBJECTIVE_LINE_RE.test(trimmed)) {
      subjectiveLines.push(trimmed);
      claimed.add(i);
      continue;
    }
    otherNotesLines.push(lines[i].trimEnd());
  }

  const labsText = rawLabLines.length > 0 ? rawLabLines.join('\n') : metrics.labs || '';

  return {
    subjective: subjectiveLines.join('\n'),
    sbp,
    dbp,
    hr,
    rr,
    temp,
    o2,
    vitalsExtra: vitalsExtraParts.join(' | '),
    ioIn,
    ioOut,
    ioUnit,
    io24,
    vent: metrics.vent || '',
    feeding: feedingLines.join('\n'),
    pe: peLines.join('\n'),
    labs: labsText,
    assessment: assessmentLines.join('\n'),
    drips,
    meds: medLines.join('\n'),
    servicePlans: planLines.join('\n'),
    planHeading,
    contingencies: contingencyLines.join('\n'),
    pending,
    prefixBoilerplate: prefixLines.join('\n'),
    suffixBoilerplate: suffixLines.join('\n'),
    otherNotes: otherNotesLines.join('\n'),
  };
}

export function serializeEditedShiftBlock(
  fields = {},
  { isInterim = false, planMode = 'service' } = {}
) {
  const blocks = [];

  const prefix = String(fields.prefixBoilerplate || '').trim();
  if (prefix) blocks.push(prefix);

  const subj = String(fields.subjective || '').trim();
  if (subj) {
    if (/^(?:\*{0,2})(?:Subjective|S>|S:|Event\s*\/\s*Update|Interval)\b/i.test(subj)) {
      blocks.push(subj);
    } else if (isInterim && !subj.includes('\n')) {
      blocks.push(`Event / Update: ${subj}`);
    } else {
      blocks.push(subj.includes('\n') ? `Subjective:\n${subj}` : `Subjective: ${subj}`);
    }
  }

  const vsCore = formatStructuredVitals(fields);
  const vsExtra = String(fields.vitalsExtra || '').trim();
  if (vsCore && vsExtra) blocks.push(`${vsCore} | ${vsExtra}`);
  else if (vsCore) blocks.push(vsCore);
  else if (vsExtra) blocks.push(`Vitals: ${vsExtra}`);

  const ventTxt = String(fields.vent || '').trim();
  if (ventTxt) blocks.push(`Vent: ${ventTxt}`);

  const io24Val = String(fields.io24 || '').trim();
  let ioLine = formatStructuredIo(fields);
  if (ioLine && io24Val) ioLine = `${ioLine} (24h Net: ${io24Val})`;
  if (ioLine) blocks.push(ioLine);
  else if (io24Val) blocks.push(`24h Net: ${io24Val}`);

  const feedingTxt = String(fields.feeding || '').trim();
  if (feedingTxt) {
    blocks.push(feedingTxt.includes('\n') ? `Feeding:\n${feedingTxt}` : `Feeding: ${feedingTxt}`);
  }

  const peTxt = String(fields.pe || '').trim();
  if (peTxt) {
    if (/^(?:\*{0,2})(?:PE|Physical\s+Exam(?:ination)?)(?:\*{0,2})\s*:/i.test(peTxt)) {
      blocks.push(peTxt);
    } else {
      blocks.push(peTxt.includes('\n') ? `PE:\n${peTxt}` : `PE: ${peTxt}`);
    }
  }

  const labsTxt = String(fields.labs || '').trim();
  if (labsTxt) {
    if (/^(?:\*{0,2})(?:Labs?|Laboratory(?:\s+updates?)?)(?:\*{0,2})\s*:/i.test(labsTxt)) {
      blocks.push(labsTxt);
    } else if (labsTxt.includes('\n') || /^(?:CXR|Chest\s+X-?ray|12\s*-?\s*L|ECG|EKG|Blood|Sputum|Urine|ABG|CBC|BMP|CMP)/i.test(labsTxt)) {
      blocks.push(`Labs:\n${labsTxt}`);
    } else {
      blocks.push(`Labs: ${labsTxt}`);
    }
  }

  const assessTxt = String(fields.assessment || '').trim();
  if (assessTxt) {
    blocks.push(assessTxt.includes('\n') ? `Assessment:\n${assessTxt}` : `Assessment: ${assessTxt}`);
  }

  const dripsBlk = formatDripsMarkdownBlock(fields.drips);
  if (dripsBlk) blocks.push(dripsBlk);

  const medLines = normalizeStructuredLines(fields.meds);
  if (medLines.length) blocks.push(`Medications:\n${medLines.join('\n')}`);

  const otherTxt = String(fields.otherNotes || '').trim();
  if (otherTxt) blocks.push(otherTxt);

  const defaultPlanHdr = (PLAN_MODES[planMode] || PLAN_MODES.service).heading;
  const planHdr = String(fields.planHeading || '').trim() || defaultPlanHdr;
  const planLines = normalizeStructuredLines(fields.servicePlans);
  if (planLines.length) blocks.push(`${planHdr}\n${planLines.join('\n')}`);

  const contTxt = String(fields.contingencies || '').trim();
  if (contTxt) blocks.push(`Contingencies: ${contTxt}`);

  const pendItems = Array.isArray(fields.pending)
    ? fields.pending
        .map((p) => ({
          text: String(p?.text || '').trim(),
          checked: Boolean(p?.checked),
        }))
        .filter((p) => p.text)
    : [];
  if (pendItems.length) {
    const pendLines = pendItems.map((p) => `- [${p.checked ? 'x' : ' '}] ${p.text}`);
    blocks.push(`**Pending:\n${pendLines.join('\n')}`);
  }

  const suffix = String(fields.suffixBoilerplate || '').trim();
  if (suffix) blocks.push(suffix);

  return blocks.join('\n\n');
}

export function formatUpdateText(content, note = {}) {
  const segment = getLatestShiftSegment(content);
  let block = String(segment.latestShiftBlock || '').replace(/\r\n/g, '\n');

  // Strip YAML frontmatter if present (e.g. a chart with no date/shift headings yet)
  block = block.replace(/^---\s*\n[\s\S]*?\n---\s*/, '');

  const rawLines = block.split('\n');
  const outLines = [];

  for (let line of rawLines) {
    if (/^#{2,3}\s+/.test(line.trim())) continue;

    line = line.replace(/^Greeting:\s*/i, '');
    line = line.replace(/^#{1,6}\s+/, '');
    line = line.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    line = line.replace(/__([^_\n]+)__/g, '$1');
    line = line.replace(/^\*\*Pending\b/i, 'Pending');
    line = line.replace(/`([^`\n]+)`/g, '$1');
    line = line.replace(/^(\s*)[-*]\s*\[ \]\s*/, '$1- ');
    line = line.replace(/^(\s*)[-*]\s*\[[xX]\]\s*/, '$1[Done] ');
    line = line.replace(/[ \t]+$/, '');

    outLines.push(line);
  }

  while (outLines.length > 0 && outLines[0] === '') outLines.shift();
  while (outLines.length > 0 && outLines[outLines.length - 1] === '') outLines.pop();

  return outLines.join('\n');
}

export function appendShiftBlock(
  content,
  shift = '6am',
  dateStr = null,
  customBody = null,
  carryOptions = null,
  mergeOptions = null
) {
  const today = getTodayDateStrings();
  const targetDate = dateStr || today.mmddyyyy;
  const dateHeading = `## ${targetDate}`;
  const cleanShift = String(shift || '6am').trim() || '6am';
  const shiftHeading = `### ${cleanShift}`;

  const text = String(content || '').trimEnd();
  const tightSeam = Boolean(mergeOptions?.tightSeam);
  const seamSep = tightSeam ? '\n' : '\n\n';

  // Match exact dateHeading or an equivalent last ## date heading for the same calendar date
  let dateIndex = -1;
  const dateHeadingRe = /^##\s+([^\n]+)$/gim;
  const allDateMatches = [...text.matchAll(dateHeadingRe)];
  for (let i = allDateMatches.length - 1; i >= 0; i--) {
    if (datesMatch(allDateMatches[i][1], targetDate)) {
      dateIndex = allDateMatches[i].index;
      break;
    }
  }

  let bodyContent;
  if (customBody !== null && customBody !== undefined && String(customBody).trim()) {
    const trimmedCustom = String(customBody).trim();
    const firstLine = trimmedCustom.split('\n')[0];
    bodyContent = /^###\s+/.test(firstLine)
      ? `${trimmedCustom}\n`
      : `${shiftHeading}\n${trimmedCustom}\n`;
  } else {
    bodyContent = buildCarryForwardShiftBlock(text, cleanShift, carryOptions || {});
  }

  if (dateIndex !== -1 && mergeOptions?.mergeExistingShift) {
    const nextDateMatch = allDateMatches.find((m) => m.index > dateIndex);
    const dateEnd = nextDateMatch ? nextDateMatch.index : text.length;
    const dateSlice = text.slice(dateIndex, dateEnd);
    const escapedShift = cleanShift.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const shiftRe = new RegExp(`^###\\s*${escapedShift}\\b[^\\n]*$`, 'im');
    const shiftMatch = shiftRe.exec(dateSlice);

    if (shiftMatch) {
      const afterHdrIdx = dateIndex + shiftMatch.index + shiftMatch[0].length;
      const restOfDate = text.slice(afterHdrIdx, dateEnd);
      const nextShiftMatch = /^###\s+[^\n]+$/m.exec(restOfDate);
      const shiftEnd = nextShiftMatch ? afterHdrIdx + nextShiftMatch.index : dateEnd;
      const bodyStripped = bodyContent.replace(/^###\s+[^\n]*\n?/, '').trim();
      if (bodyStripped) {
        const before = text.slice(0, shiftEnd).trimEnd();
        const after = text.slice(shiftEnd);
        return `${before}\n${bodyStripped}${after ? `\n\n${after.replace(/^\n+/, '')}` : '\n'}`;
      }
      return text;
    }
  }

  if (dateIndex !== -1) {
    // Date heading already exists, append under it
    return `${text}${seamSep}${bodyContent}`;
  } else {
    // Create new date block
    return text ? `${text}${seamSep}${dateHeading}\n\n${bodyContent}` : `${dateHeading}\n\n${bodyContent}`;
  }
}

const HF_GREETING_START_RE = /^(?:Greeting\s*:|Good\s+(?:day|morning|afternoon|evening)|Update\s+on\s+(?:your\s+)?patient|Hi\s+Dr\.?|Hello\s+Dr\.?|Dear\s+Dr\.?)/i;
const HF_FOOTER_START_RE = /^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i;
const HF_CLINICAL_LINE_RE = /^(?:BP|HR|PR|RR|T|Temp|Tmax|O2(?:\s*sat)?|SpO2|VS|Vent|I&O|Labs?|Laboratory|WBC|Hb|Hgb|Hct|Plt|Na|K|Cl|BUN|Cr|ABG|SGOT|SGPT)\b(?:\s*[:=]|\s+\d)/i;

export function hasExistingShiftInChart(content, shift = '6am', dateStr = null) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const targetDate = dateStr || getTodayDateStrings().mmddyyyy;
  const cleanShift = String(shift || '6am').trim() || '6am';
  if (!text.trim() || !targetDate) return false;

  const dateHeadingRe = /^##\s+([^\n]+)$/gim;
  const allDateMatches = [...text.matchAll(dateHeadingRe)];
  if (!allDateMatches.length) return false;

  const escapedShift = cleanShift.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shiftRe = new RegExp(`^###\\s*${escapedShift}\\b[^\\n]*$`, 'im');

  for (let i = allDateMatches.length - 1; i >= 0; i--) {
    if (!datesMatch(allDateMatches[i][1], targetDate)) continue;
    const dateStart = allDateMatches[i].index;
    const dateEnd = i + 1 < allDateMatches.length ? allDateMatches[i + 1].index : text.length;
    if (shiftRe.test(text.slice(dateStart, dateEnd))) return true;
  }
  return false;
}

function extractLeadingHeaderFromShiftBody(body, patientName = '') {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  let firstIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim()) {
      firstIdx = i;
      break;
    }
  }
  if (firstIdx === -1) return '';

  const firstTrimmed = lines[firstIdx].trim();
  const cleanName = String(patientName || '').trim();
  const nameTokens = cleanName && cleanName !== 'Unknown Patient'
    ? cleanName.split(/[\s,]+/).map((t) => t.trim()).filter((t) => t.length >= 2)
    : [];
  const startsWithGreeting = HF_GREETING_START_RE.test(firstTrimmed);
  const startsWithPatientName =
    nameTokens.length > 0 &&
    firstTrimmed.length <= 60 &&
    !isShiftEditBoundary(firstTrimmed) &&
    !HF_CLINICAL_LINE_RE.test(firstTrimmed) &&
    firstTrimmed.toLowerCase().includes(nameTokens[0].toLowerCase());

  if (!startsWithGreeting && !startsWithPatientName) return '';

  const collected = [];
  let nonEmptyCount = 0;
  let sawIdentityOrRoom = startsWithPatientName;

  for (let i = firstIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (collected.length > 0 && collected[collected.length - 1] !== '') {
        collected.push('');
      }
      continue;
    }

    const isGreetingLine = HF_GREETING_START_RE.test(trimmed);
    const matchesBoundary = isShiftEditBoundary(trimmed);
    if (
      (matchesBoundary && !(i === firstIdx && /^Greeting\s*:/i.test(trimmed))) ||
      /^[-*•]\s+/.test(trimmed) ||
      /^[-*]?\s*\[[ xX]\]/.test(trimmed) ||
      HF_CLINICAL_LINE_RE.test(trimmed) ||
      HF_FOOTER_START_RE.test(trimmed)
    ) {
      break;
    }

    if (i > firstIdx) {
      const looksLikeRoom = /^(?:Room\s+|ICU|NCCU|MICU|SICU|CCU|NICU|PICU|ER|OPD|Ward|Bed|\d{2,4}[A-Z]?\b)/i.test(trimmed);
      const looksLikeAgeSex = /^\d{1,3}\s*\/\s*[MF]$/i.test(trimmed);
      const looksLikeName =
        nameTokens.length > 0 && trimmed.toLowerCase().includes(nameTokens[0].toLowerCase());
      const looksLikePersonTitle =
        !sawIdentityOrRoom && trimmed.length <= 60 && /^(?:Dr\.?\s|Attending|Patient)/i.test(trimmed);
      const looksLikeContinuationGreeting = !sawIdentityOrRoom && isGreetingLine;

      if (trimmed.length > 80 && !looksLikeContinuationGreeting) break;
      if (
        sawIdentityOrRoom &&
        !looksLikeRoom &&
        !looksLikeAgeSex &&
        !looksLikeName &&
        trimmed.length > 35
      ) {
        break;
      }
      if (
        !looksLikeContinuationGreeting &&
        !looksLikeRoom &&
        !looksLikeAgeSex &&
        !looksLikeName &&
        !looksLikePersonTitle &&
        trimmed.length > 60
      ) {
        break;
      }
      if (looksLikeRoom || looksLikeAgeSex || looksLikeName) {
        sawIdentityOrRoom = true;
      }
    }

    const outLine = i === firstIdx ? trimmed.replace(/^Greeting\s*:\s*/i, '').trim() : trimmed;
    if (outLine) {
      collected.push(outLine);
      nonEmptyCount += 1;
      if (nonEmptyCount >= 8) break;
    }
  }

  while (collected.length > 0 && collected[collected.length - 1] === '') {
    collected.pop();
  }
  return collected.join('\n').trim();
}

function extractTrailingFooterFromShiftBody(body) {
  const lines = String(body || '').replace(/\r\n/g, '\n').split('\n');
  let nonEmptySeen = 0;
  let footerIdx = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    nonEmptySeen += 1;
    if (HF_FOOTER_START_RE.test(trimmed)) {
      footerIdx = i;
      break;
    }
    if (
      isShiftEditBoundary(trimmed) ||
      /^[-*•]\s+/.test(trimmed) ||
      /^[-*]?\s*\[[ xX]\]/.test(trimmed)
    ) {
      return '';
    }
    if (nonEmptySeen >= 8) break;
  }

  if (footerIdx === -1) return '';

  const out = [];
  for (let i = footerIdx; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }
    out.push(trimmed);
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n').trim();
}

export function extractChartHeaderFooter(content, note = {}, options = {}) {
  const text = String(content || '');
  const parsed = parseChartHeader(text, note || {});
  const timeline = parseChartTimeline(text);

  let fileHeader = '';
  let fileFooter = '';
  let inspected = 0;

  for (let d = timeline.length - 1; d >= 0 && inspected < 8; d--) {
    const shifts = timeline[d]?.shifts || [];
    for (let s = shifts.length - 1; s >= 0 && inspected < 8; s--) {
      inspected += 1;
      const body = shifts[s]?.body || '';
      if (!fileHeader) {
        fileHeader = extractLeadingHeaderFromShiftBody(body, parsed.name);
      }
      if (!fileFooter) {
        fileFooter = extractTrailingFooterFromShiftBody(body);
      }
      if (fileHeader && fileFooter) break;
    }
    if (fileHeader && fileFooter) break;
  }

  const cfg = (options && options.config) || DEFAULT_TEMPLATE_CONFIG;
  const cleanShift = String(options?.shift || '6am').trim() || '6am';
  const dateStr = String(options?.dateStr || '').trim();

  let header = fileHeader;
  let headerSource = 'file';
  if (!header) {
    headerSource = 'template';
    const rawHeader = resolveSimplePlaceholders(cfg.header || '', parsed, cleanShift, dateStr)
      .split('\n')
      .map((l) => l.trimEnd())
      .join('\n')
      .trim();
    const ptLines = [];
    if (cfg.showName !== false && parsed.name && parsed.name !== 'Unknown Patient') {
      ptLines.push(parsed.name);
    }
    if (cfg.showAgeSex !== false) {
      const ageSex = [parsed.age, parsed.sex].filter(Boolean).join('/');
      if (ageSex) ptLines.push(ageSex);
    }
    if (cfg.showRoom !== false && parsed.room && parsed.room !== 'Unassigned') {
      ptLines.push(parsed.room);
    }
    const headerParts = [];
    if (rawHeader) headerParts.push(rawHeader);
    if (ptLines.length) headerParts.push(ptLines.join('\n'));
    header = headerParts.join('\n\n').trim();
  }

  let footer = fileFooter;
  let footerSource = 'file';
  if (!footer) {
    footerSource = 'template';
    footer = resolveSimplePlaceholders(cfg.footer || '', parsed, cleanShift, dateStr).trim();
  }

  return { header, footer, headerSource, footerSource };
}

export function buildClinicalDictationAiPrompt({
  redactedTranscript = '',
  standingContext = {},
  shift = '6am',
  dateStr = '',
  interimTimeLabel = '',
  greeting = '',
  signature = '',
  patientHeaderLines = [],
} = {}) {
  const st = standingContext || {};
  const standingParts = [];
  if (st.vent) standingParts.push(`Previous Vent Settings: ${st.vent}`);
  if (st.drips) standingParts.push(`Previous Drips: ${st.drips}`);
  if (st.feeding) standingParts.push(`Previous Feeding: ${st.feeding}`);
  if (st.pe) standingParts.push(`Previous PE:\n${st.pe}`);
  if (Array.isArray(st.meds) && st.meds.length) {
    standingParts.push(`Previous Meds:\n${st.meds.map((m) => `• ${m}`).join('\n')}`);
  }
  if (Array.isArray(st.onHold) && st.onHold.length) {
    standingParts.push(`Previous On Hold:\n${st.onHold.map((h) => `• ${h}`).join('\n')}`);
  }
  if (Array.isArray(st.pending) && st.pending.length) {
    standingParts.push(`Standing Open **Pending items:\n${st.pending.map((p) => `- [ ] ${p}`).join('\n')}`);
  }
  if (Array.isArray(st.subspecialtyPlans) && st.subspecialtyPlans.length) {
    for (const sp of st.subspecialtyPlans) {
      standingParts.push(`Previous ${sp.heading}\n${sp.items.map((x) => `- ${x}`).join('\n')}`);
    }
  }

  const headerPreview = (patientHeaderLines || []).filter(Boolean).join('\n');
  const shiftGuidance = interimTimeLabel
    ? `Selected Shift: ### ${shift} (If single-order / interval update, write ### ${shift}; interim time reference: ${interimTimeLabel})`
    : `Selected Shift: ### ${shift} (Date: ${dateStr || getTodayDateStrings().mmddyyyy})`;

  return `You are a clinical inpatient documentation assistant formatting a bedside resident dictation.

STRICT DICTATION & CHARTING RULES:
1. ASR CAUTION & AMBIGUITY: Only fix obvious single-reading ASR errors (e.g. PEEP vs BP only in vent context, FiO2, CRBSI, Clindamycin, Vancomycin, Pulmo, afebrile, mcg/kg/min). If any number/field looks garbled or ambiguous, DO NOT guess — omit/flag it under ===FLAGS=== and ask.
2. SELF-CORRECTIONS: "scratch that", "I mean", "correction" → output ONLY the corrected value, never both.
3. NO I&O ARITHMETIC RECONCILIATION: Output dictated In / Out / balance verbatim even if In - Out != balance; report arithmetic mismatch in ===FLAGS===.
4. VENT SETTINGS & RETURNS: If dictated "same vent settings", copy Previous Vent Settings verbatim right under O2 sat (no "same settings" prose). Vent returns go immediately below settings as bare numeric lines without a heading.
5. TEMPERATURE RULE: "afebrile" alone → omit Tmax line (mention "afebrile" only in subjective). "afebrile Tmax 36.6" → put "afebrile" in subjective AND "Tmax 36.6C" between RR and O2 sat.
6. INTERVAL EVENTS: One observation per line. "No acute events but noted X" → drop "No acute events", keep only X.
7. SINGLE ORDER RULE: If dictation is only a single standalone order/event with no shift data, start heading with ### Interim (${interimTimeLabel || 'time'}).
8. NEVER CARRY FORWARD MEASURED VALUES: NEVER invent or carry forward I&O rows, HGT values, vent returns, or temperatures from prior blocks. Only carry standing sections (Physical Exam, Meds, On hold, Feeding, open **Pending items not resolved in this shift, subspecialty plans) when omitted from dictation.
9. PHYSICAL EXAM CARRY-OVER (REQUIRED): If physical exam findings are NOT mentioned in the dictation AND "Previous PE" is provided in STANDING CONTEXT below, you MUST copy "Previous PE" verbatim into the <PE lines> section of a regular shift block (do NOT omit PE and do NOT replace it with generic normal PE). If the dictation mentions new or changed PE findings, chart the dictated PE (updating only changed findings). Omit standing PE only for single-order ### Interim blocks or if the dictation explicitly says to defer/omit PE. Never place subjective/interval statements (such as "No subjective complaints", "No acute events", or "Afebrile") in <PE lines>; keep those in the subjective/events section above Vitals.
10. ORDERING & SECTION RULES:
   - Omit empty sections completely (never output empty headers like empty **Pending:), EXCEPT carried-over standing sections (including Previous PE when provided and not dictated).
   - **Pending: goes AFTER Meds: and BEFORE all plan sections.
   - Named subspecialty plans go under their own headings (Pulmo plans:, Cardio plans:, etc.).
   - Generic Plans: go last before the signature.

EXACT SECTION ORDER FOR REGULAR SHIFT BLOCK:
### <shift>
${greeting ? `${greeting}\n` : '<greeting line if appropriate>'}
Update on your patient
${headerPreview || '[PATIENT_NAME]'}

<subjective line(s)>
<event lines>

<Lab update heading if labs dictated>
<labs flush with heading>

BP <range>/<range>
HR <range>
RR <range>
Tmax <n>C
O2 sat <n>%
<vent settings line flush under O2 sat>
<vent returns bare>

<shift row e.g. 6-2pm or 10-6a>
I <n>
O <n>
<balance>
<special lines e.g. 2 episodes BM>

Feeding: <line>
FWF <n>

<PE lines — dictated PE, or Previous PE verbatim if not mentioned>

Drips:
<drip line>

Meds:
• <drug>

**Pending:
<item>

<Subspecialty plans: e.g. Pulmo plans:>
<item>

Plans:
<item>${signature ? `\n${signature}` : ''}

${shiftGuidance}

STANDING CONTEXT FROM PRIOR BLOCK (carry ONLY standing sections when omitted; never measured values):
${standingParts.length ? standingParts.join('\n\n') : '(none available)'}

DE-IDENTIFIED DICTATION TRANSCRIPT:
"""
${String(redactedTranscript || '').trim()}
"""

OUTPUT FORMAT:
Return your response wrapped cleanly with these exact markers:
===NOTE===
<clean markdown note block starting with ### ...>
===FLAGS===
<bullet list of any I&O mismatches, omitted missing measured values, or garbled numbers to clarify — or "None" if everything is clear>`;
}

export function parseAiDictationResponse(rawReply, formattedPatientName = '') {
  let raw = String(rawReply || '').trim();
  raw = raw.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  let noteBlock = raw;
  let flagsText = '';

  const noteMatch = raw.match(/===NOTE===\s*([\s\S]*?)(?====FLAGS===|$)/i);
  const flagsMatch = raw.match(/===FLAGS===\s*([\s\S]*)$/i);

  if (noteMatch) {
    noteBlock = noteMatch[1].trim();
  }
  if (flagsMatch) {
    const cleanedFlags = flagsMatch[1].trim();
    if (cleanedFlags && !/^(?:none|no\s+flags|clear)\.?$/i.test(cleanedFlags)) {
      flagsText = cleanedFlags;
    }
  }

  noteBlock = noteBlock.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();

  if (formattedPatientName) {
    noteBlock = noteBlock.replace(/\[PATIENT_NAME\]/g, formattedPatientName);
  }

  return { noteBlock, flags: flagsText };
}

export function applyDictationPeCarryover(noteBlock, previousPe, transcript = '') {
  const cleanNote = String(noteBlock || '').replace(/\r\n/g, '\n').trim();
  const cleanPe = String(previousPe || '').replace(/\r\n/g, '\n').trim();
  if (!cleanNote || !cleanPe) {
    return { noteBlock: cleanNote, carriedPe: false };
  }

  const firstHeadingMatch = cleanNote.match(/^###\s+([^\n]+)/);
  if (firstHeadingMatch && isInterimShift(firstHeadingMatch[1])) {
    return { noteBlock: cleanNote, carriedPe: false };
  }

  if (
    transcript &&
    /\b(?:no\s+(?:pe|physical\s+exam(?:ination)?)|omit\s+(?:pe|physical\s+exam(?:ination)?)|skip\s+(?:pe|physical\s+exam(?:ination)?)|(?:pe|physical\s+exam(?:ination)?)\s+(?:deferred|not\s+done|omitted|skipped))\b/i.test(
      String(transcript)
    )
  ) {
    return { noteBlock: cleanNote, carriedPe: false };
  }

  if (extractPeLinesFromBlock(cleanNote)) {
    return { noteBlock: cleanNote, carriedPe: false };
  }

  const postPeSectionRe =
    /^(?:\*{0,2})(?:Drips?|Infusions?|On\s+hold|Hold|Held|Meds?|Medications?|Current\s+Meds?|Pending|Service\s+Plans?|[A-Za-z][A-Za-z\s/&+-]{1,25}\s+Plans?|Plans?)(?:\*{0,2})\s*:|^(?:\*{0,2})(?:Medications?|Meds?|Pending|Plans?|Drips?|On\s+hold)(?:\*{0,2})\s*$|^(?:Thank\s+you|Thanks|Regards|Best|Sincerely|Respectfully)\b/i;

  const lines = cleanNote.split('\n');
  let insertIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const tr = lines[i].trim();
    if (!tr || /^#{2,3}\s+/.test(tr)) continue;
    if (postPeSectionRe.test(tr)) {
      insertIdx = i;
      break;
    }
  }

  if (insertIdx > 0) {
    const before = lines.slice(0, insertIdx).join('\n').trimEnd();
    const after = lines.slice(insertIdx).join('\n').trimStart();
    return {
      noteBlock: `${before}\n\n${cleanPe}\n\n${after}`,
      carriedPe: true,
    };
  }
  if (insertIdx === 0) {
    return {
      noteBlock: `${cleanPe}\n\n${cleanNote}`,
      carriedPe: true,
    };
  }
  return {
    noteBlock: `${cleanNote}\n\n${cleanPe}`,
    carriedPe: true,
  };
}

export function verifyAppendedChart(content) {
  const text = String(content || '');
  const warnings = [];
  const lines = text.split('\n');
  const dateRe =
    /^##\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{4}[-/]\d{1,2}[-/]\d{1,2}|\w+\s+\d{1,2},?\s+\d{4})\b/;

  const dateValues = [];
  let headingCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Seam check: verify ## or ### heading didn't get glued onto signature/text mid-line
    if (/[^\s]\s*#{2,3}\s+/.test(line) && !/^\s*#{2,3}\s+/.test(line)) {
      warnings.push(`Line ${i + 1}: heading appears glued onto previous text ("${line.slice(0, 60)}")`);
    }
    if (/^#{2,3}\s+/.test(line)) headingCount++;
    const dm = line.match(dateRe);
    if (dm) {
      const dp = parseDateParts(dm[1]);
      const parsedTs = dp ? Date.UTC(dp.year, dp.month - 1, dp.day) : null;
      if (parsedTs !== null) {
        if (dateValues.length > 0 && parsedTs < dateValues[dateValues.length - 1].ts) {
          warnings.push(`Date heading "## ${dm[1]}" is out of chronological order`);
        }
        dateValues.push({ raw: dm[1], ts: parsedTs });
      }
    }
  }

  const timeline = parseChartTimeline(text);
  const lastDateEntry = timeline[timeline.length - 1] || null;
  const lastShiftEntry =
    lastDateEntry && lastDateEntry.shifts.length
      ? lastDateEntry.shifts[lastDateEntry.shifts.length - 1]
      : null;

  if (!lastDateEntry || !lastShiftEntry) {
    warnings.push('Final appended shift block could not be parsed in timeline');
  }

  return {
    ok: warnings.length === 0,
    warnings,
    headingCount,
    lastDate: lastDateEntry?.date || '',
    lastShift: lastShiftEntry?.rawShift || lastShiftEntry?.shift || '',
  };
}

export function extractTodayShiftBlocks(content, dateStr = null) {
  const text = String(content || '');
  const targetDate = dateStr || getTodayDateStrings().mmddyyyy;
  const dateHeadingRe = /^##\s+([^\n]+)$/gim;
  const dateMatches = [...text.matchAll(dateHeadingRe)];

  if (!dateMatches.length) return [];

  const todaySlices = [];
  for (let i = 0; i < dateMatches.length; i++) {
    const headingDate = dateMatches[i][1].trim();
    if (datesMatch(headingDate, targetDate)) {
      const start = dateMatches[i].index + dateMatches[i][0].length;
      const end = i + 1 < dateMatches.length ? dateMatches[i + 1].index : text.length;
      todaySlices.push(text.slice(start, end));
    }
  }

  if (!todaySlices.length) return [];

  const shiftHeadingRe = /^###\s*(6\s*am|2\s*pm|10\s*pm|morning|afternoon|night)\b[^\n]*$/gim;
  const shifts = [];

  for (const slice of todaySlices) {
    const matches = [...slice.matchAll(shiftHeadingRe)];
    if (!matches.length) {
      const clean = slice.trim();
      if (clean) shifts.push({ shift: 'General', body: clean });
      continue;
    }

    const preText = slice.slice(0, matches[0].index).trim();
    if (preText) {
      shifts.push({ shift: 'General', body: preText });
    }

    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index + matches[i][0].length;
      const end = i + 1 < matches.length ? matches[i + 1].index : slice.length;
      const shiftLabel = matches[i][1].replace(/\s+/g, '');
      shifts.push({
        shift: shiftLabel,
        body: slice.slice(start, end).trim(),
      });
    }
  }

  return shifts;
}

function isGreetingOrBoilerplateLine(trimmed) {
  return (
    /^Greeting:\s*/i.test(trimmed) ||
    /^(?:Good\s+(?:day|morning|afternoon|evening)|Hi\s+Dr\.?|Hello\s+Dr\.?)\b/i.test(trimmed) ||
    /^(?:Update\s+on\s+your\s+patient|Relaying\s+labs(?:\s+for)?|\*{0,2}Dictated\s+Update\*{0,2}:?)$/i.test(trimmed) ||
    /^\((?:Subjective\s+Complaints|Age|Room)\)$/i.test(trimmed) ||
    /^\d{1,3}\s*\/\s*[MF]$/i.test(trimmed) ||
    /^\*{0,2}(?:Subjective|Objective|Physical\s+Exam|PE|Drains?|Labs?|Lab(?:oratory)?\s+updates?|Lab\s+results?)\*{0,2}\s*:?\s*$/i.test(
      trimmed
    ) ||
    /^\*{2}[SOAP]:?\*{0,2}$/i.test(trimmed) ||
    /^---+$/.test(trimmed) ||
    /^[-*]\s*\[[ xX]\]\s*$/.test(trimmed) ||
    /^[-*]\s*$/.test(trimmed) ||
    /^(?:Vitals|VS):\s*BP\s*\|\s*HR\s*\|\s*RR\s*\|\s*T\s*\|\s*O2sat\s*%\s*on\s*RA$/i.test(trimmed) ||
    /^(?:Shift\s+I&O|I&O):\s*In:\s*\|\s*Out:\s*\|\s*(?:Net|FB):\s*(?:\(24h\s+(?:Net|FB):\s*\))?$/i.test(trimmed)
  );
}

function isPatientIdentityLine(trimmed, parsed) {
  const cleanLine = String(trimmed || '').trim();
  if (!cleanLine) return false;

  const stripRoomPrefix = (s) =>
    String(s || '')
      .trim()
      .replace(/^(?:room|rm\.?|bed)\s*#?\s*/i, '')
      .trim()
      .toLowerCase();

  const roomClean = stripRoomPrefix(parsed.room);
  const lineRoomClean = stripRoomPrefix(cleanLine);
  if (roomClean && roomClean !== 'unassigned' && lineRoomClean === roomClean) {
    return true;
  }

  const normalizeWords = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

  const nameTokens = normalizeWords(parsed.name);
  const lineTokens = normalizeWords(cleanLine);
  if (
    nameTokens.length >= 2 &&
    lineTokens.length >= 2 &&
    lineTokens.length <= nameTokens.length + 1 &&
    lineTokens.every((t) => nameTokens.includes(t))
  ) {
    return true;
  }

  return false;
}

function isFooterStartLine(trimmed) {
  return /^(?:Thank\s+you(?:\s*,\s*|\s+|$|!)|Thanks(?:\s*,\s*|\s+|$|!)(?!\s+to\b)|Regards(?:\s*,|\s*$)|Best\s+regards\b|Sincerely(?:\s*,|\s*$)|Respectfully(?:\s*,|\s*$))/i.test(
    String(trimmed || '').trim()
  );
}

function classifyExamLine(trimmed) {
  const s = String(trimmed || '').trim();
  if (!s) return null;

  if (
    /\b(?:GCS\b|pupils?\b|isocoric|anisocoric|pearla|eomi|oriented|obtunded|stupor|comatose|sedated|intact\s+cranial|cranial\s+nerves?|motor\s+\d\/\d|sensory\s+intact)/i.test(
      s
    )
  ) {
    return 'neuro';
  }

  if (
    /\(\+\)\s*(?:JP|CTT|NGT|Foley|drain|IFC|IJ|PICC|central|line)\b/i.test(s) ||
    /\b(?:JP\s+drain|serosanguinous|purulent|bloody|chest\s+tube|CTT)\b/i.test(s)
  ) {
    return 'pertinent';
  }

  const abnormalCueRe =
    /\b(?:irregular|murmurs?|crackles|rales|wheez\w*|rhonchi|stridor|decreased\s+breath|diminished|retractions|tachypn\w*|tender(?:ness)?|guarding|rigidity|rebound|distend\w*|ascites|edema|cyanosis|icteric|icterus|jaundice|pale|pallor|weak\s+pulses?|CRT\s*>\s*\d|hematoma|lesions?|ulcers?|rash|bleeding|oozing|discharge|erythema|warmth|swelling)\b/gi;
  for (const m of s.matchAll(abnormalCueRe)) {
    const prefix = s.slice(Math.max(0, m.index - 20), m.index);
    const negated = /(?:\(\s*-\s*\)|(?:^|[\s,;(/])(?:no|non|without|negative\s+for|absent|denies))\s*[-/]?\s*$/i.test(
      prefix
    );
    if (!negated) return 'pertinent';
  }

  if (
    /^(?:Awake\s*,?\s*NIRD|HEENT:|C\/L:|CVS:|ABD:|EXT:|(?:ECE|CBS|DHS|NABS|SPP)\b)/i.test(s) ||
    /\b(?:clear\s+breath\s+sounds|regular\s+rate(?:\s+and\s+rhythm)?|anicteric|pink\s+palpebral|CRT\s*<\s*2|nontender|non-tender)\b/i.test(
      s
    )
  ) {
    return 'normal_pe';
  }

  return null;
}

function joinClausesAsProse(items, sep = '; ') {
  const cleaned = (items || [])
    .map((s) => String(s || '').replace(/^[-*]\s+/, '').trim())
    .filter(Boolean);
  if (!cleaned.length) return '';
  return cleaned
    .map((item, idx) => (idx < cleaned.length - 1 ? item.replace(/[;.,]+$/, '') : item))
    .join(sep);
}

export function analyzePatientHandover(note, dateStr = null) {
  const parsed = parseChart(note.content, note);
  const shifts = extractTodayShiftBlocks(note.content, dateStr);

  const eventsByShift = [];
  const medChanges = [];
  const medChangeSeen = new Set();
  const activePlans = [];
  const planSeen = new Set();
  const neuroNotes = [];
  const neuroSeen = new Set();
  const pertinentExam = [];
  const examSeen = new Set();
  const feedingItems = [];
  const feedingSeen = new Set();
  const pendingMap = new Map();
  const gaps = [];
  const gapSeen = new Set();
  let assessmentSummary = '';

  const pushUnique = (arr, seen, val) => {
    const clean = String(val || '').replace(/^[-*]\s+/, '').trim();
    if (!clean || /^(?:none|nil|n\/a|-)$/i.test(clean)) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      arr.push(clean);
    }
  };

  const addGap = (msg) => pushUnique(gaps, gapSeen, msg);

  const medActionRe =
    /\b(start(?:ed|ing)?|stop(?:ped|ping)?|discontinu(?:ed|e)|d\/c|hold|held|resume(?:d)?|restart(?:ed)?|titrat(?:e|ed|ing)|increas(?:e|ed|ing)|decreas(?:e|ed|ing)|adjust(?:ed|ing)?|shift(?:ed)?\s+to|switch(?:ed)?\s+to|wean(?:ed|ing)?|bolus(?:ed)?|load(?:ed|ing)?|pulse|tapering|taper(?:ed)?)\b/i;
  const askGapRe =
    /\?|await(?:ing)?|follow\s*up|f\/u|confirm|reply|clearance|if\s+ok|not\s+available|\bask\b|pending\s+consult/i;

  const shiftSnapshots = [];

  for (const { shift, body } of shifts) {
    const metrics = extractClinicalMetricsFromBlock(body);
    shiftSnapshots.push(metrics);

    const { pending: blockPending } = extractPendingFromBlock(body);
    for (const p of blockPending) {
      pendingMap.set(p.text.toLowerCase(), { text: p.text, checked: p.checked });
    }

    const lines = body.split('\n');
    const eventLines = [];
    let section = 'main';

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        if (section !== 'main' && section !== 'footer') section = 'main';
        continue;
      }

      if (section === 'footer' || isFooterStartLine(trimmed)) {
        section = 'footer';
        continue;
      }

      if (/^\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?\s*$/i.test(trimmed)) {
        section = 'pending';
        continue;
      }

      const specPlanMatch = trimmed.match(
        /^(?:\*{0,2})(?:Service|[A-Za-z][A-Za-z\s/&+-]{1,30})\s+Plans?(?:\*{0,2})\s*:\s*(.*)$/i
      );
      if (specPlanMatch) {
        const isGeneric = /^(?:\*{0,2})(?:Generic|General|Routine)\s+Plans?/i.test(trimmed);
        section = isGeneric ? 'genericPlans' : 'servicePlans';
        const inlinePlan = (specPlanMatch[1] || '').trim();
        if (!isGeneric && inlinePlan) {
          pushUnique(activePlans, planSeen, inlinePlan);
          if (medActionRe.test(inlinePlan)) pushUnique(medChanges, medChangeSeen, inlinePlan);
          if (askGapRe.test(inlinePlan)) addGap(inlinePlan);
        }
        continue;
      }

      const barePlanMatch = trimmed.match(/^(?:\*{0,2})Plans?(?:\*{0,2})\s*:\s*(.*)$/i);
      if (barePlanMatch) {
        section = 'plans';
        const inlinePlan = (barePlanMatch[1] || '').trim();
        if (inlinePlan) {
          pushUnique(activePlans, planSeen, inlinePlan);
          if (medActionRe.test(inlinePlan)) pushUnique(medChanges, medChangeSeen, inlinePlan);
          if (askGapRe.test(inlinePlan)) addGap(inlinePlan);
        }
        continue;
      }

      const medsHdrMatch = trimmed.match(/^(?:\*{0,2})(?:Meds?|Medications?)(?:\*{0,2})\s*:\s*(.*)$/i);
      if (medsHdrMatch) {
        section = 'meds';
        const inlineMed = (medsHdrMatch[1] || '').trim();
        if (inlineMed && !/^(?:none|nil|n\/a|-)$/i.test(inlineMed)) {
          if (medActionRe.test(inlineMed)) pushUnique(medChanges, medChangeSeen, inlineMed);
          if (askGapRe.test(inlineMed)) addGap(inlineMed);
        }
        continue;
      }

      const feedHdrMatch = trimmed.match(/^(?:\*{0,2})(?:Feeding|Diet|Nutrition)(?:\*{0,2})\s*:\s*(.*)$/i);
      if (feedHdrMatch) {
        section = 'feeding';
        if (feedHdrMatch[1] && feedHdrMatch[1].trim()) {
          pushUnique(feedingItems, feedingSeen, feedHdrMatch[1].trim());
        }
        continue;
      }

      const probHdrMatch = trimmed.match(
        /^(?:\*{0,2})(?:Problem\s+list|Assessment|Impression|Diagnosis|Dx)(?:\*{0,2})\s*:\s*(.*)$/i
      );
      if (probHdrMatch) {
        section = 'problemList';
        if (!assessmentSummary && probHdrMatch[1] && probHdrMatch[1].trim()) {
          assessmentSummary = probHdrMatch[1].trim();
        }
        continue;
      }

      if (/^(?:\*{0,2})If\s+ok\b/i.test(trimmed)) {
        section = 'ifOk';
      } else if (
        /^(?:Vitals|VS|Vent|Ventilator|Shift\s+I&O|I&O|Drips?|Infusions?|Labs?|Lab\s+update|PE|Physical\s+Exam|Drains?|Greeting|\*{2}[SOAP]:?)\b/i.test(
          trimmed
        )
      ) {
        section = 'main';
      }

      const cleanLine = trimmed.replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim();
      const isCheckedDone = /^[-*]\s*\[[xX]\]/.test(trimmed);

      // 1. Track medication changes (starts / stops / holds / titrations / drip lines)
      if (medActionRe.test(cleanLine)) {
        pushUnique(medChanges, medChangeSeen, cleanLine);
      } else {
        const dripLine = cleanLine.match(/^(?:Drips?|Infusions?):\s*(.+)$/i);
        if (dripLine && dripLine[1].trim() && !/^(?:none|nil|n\/a|-)$/i.test(dripLine[1].trim())) {
          pushUnique(medChanges, medChangeSeen, cleanLine);
        }
      }

      // 2. Track unanswered asks / unconfirmed plans
      if ((section === 'ifOk' || askGapRe.test(cleanLine)) && !isCheckedDone) {
        addGap(cleanLine);
      }

      // 3. Route section items cleanly instead of dumping into Course events
      if (section === 'pending' || section === 'genericPlans' || section === 'meds') {
        continue;
      }
      if (section === 'feeding') {
        pushUnique(feedingItems, feedingSeen, cleanLine);
        continue;
      }
      if (section === 'problemList') {
        if (!assessmentSummary && cleanLine && !/^(?:none|nil|n\/a|-)$/i.test(cleanLine)) {
          assessmentSummary = cleanLine;
        }
        continue;
      }
      if (section === 'servicePlans' || section === 'plans') {
        if (!/^[-*]\s*\[[ xX]\]/.test(trimmed)) {
          pushUnique(activePlans, planSeen, cleanLine);
        }
        continue;
      }

      if (metrics.consumedLineIndices.has(i)) continue;
      if (isGreetingOrBoilerplateLine(trimmed)) continue;
      if (isPatientIdentityLine(trimmed, parsed)) continue;
      if (/^[-*]\s*\[[ xX]\]/.test(trimmed)) continue;

      const examKind = classifyExamLine(cleanLine);
      if (examKind === 'neuro') {
        pushUnique(neuroNotes, neuroSeen, cleanLine);
        continue;
      }
      if (examKind === 'pertinent') {
        pushUnique(pertinentExam, examSeen, cleanLine);
        continue;
      }
      if (examKind === 'normal_pe') {
        continue;
      }

      if (cleanLine) {
        eventLines.push(cleanLine);
      }
    }

    eventsByShift.push({ shift, lines: eventLines });
  }

  const openPending = [];
  const resolvedToday = [];
  for (const item of pendingMap.values()) {
    if (item.checked) resolvedToday.push(item.text);
    else openPending.push(item.text);
  }

  const latestMetrics = {
    vitals: '',
    vent: '',
    io: '',
    shiftIo: '',
    io24h: '',
    ioWindow: '',
    drips: '',
    labs: '',
    hgt: '',
  };
  for (let i = shiftSnapshots.length - 1; i >= 0; i--) {
    const m = shiftSnapshots[i];
    if (!latestMetrics.vitals && m.vitals) latestMetrics.vitals = m.vitals;
    if (!latestMetrics.vent && m.vent) latestMetrics.vent = m.vent;
    if (!latestMetrics.io && m.io) latestMetrics.io = m.io;
    if (!latestMetrics.shiftIo && m.shiftIo) latestMetrics.shiftIo = m.shiftIo;
    if (!latestMetrics.io24h && m.io24h) latestMetrics.io24h = m.io24h;
    if (!latestMetrics.ioWindow && m.ioWindow) latestMetrics.ioWindow = m.ioWindow;
    if (!latestMetrics.drips && m.drips) latestMetrics.drips = m.drips;
    if (!latestMetrics.labs && m.labs) latestMetrics.labs = m.labs;
    if (!latestMetrics.hgt && m.hgt) latestMetrics.hgt = m.hgt;
  }

  if (shifts.length === 0) {
    addGap(`No chart entry today (Last entry: ${parsed.latestDate || 'None'})`);
  } else {
    const newestSnapshot = shiftSnapshots[shiftSnapshots.length - 1];
    if (!newestSnapshot.vitals) {
      addGap('Missing or incomplete Vitals in latest shift block');
    }
    if (!newestSnapshot.io) {
      addGap('Missing or incomplete Shift I&O in latest shift block');
    }
  }

  return {
    parsed,
    shifts,
    eventsByShift,
    medChanges,
    activePlans,
    neuroNotes,
    pertinentExam,
    feedingItems,
    assessmentSummary,
    latestMetrics,
    openPending,
    resolvedToday,
    gaps,
  };
}

export function formatHandoverReport(notes, dateStr = null, options = {}) {
  const targetDate = dateStr || getTodayDateStrings().mmddyyyy;
  const scope = options?.scope || 'all';
  const format = String(options?.format || 'standard').toLowerCase();
  const includeResolvedPending = options?.includeResolvedPending !== false;
  const includeVitalsLabs = options?.includeVitalsLabs !== false;

  const headerList = (notes || []).map((n) => ({ note: n, header: parseChartHeader(n.content, n) }));

  const active = headerList
    .filter((item) => item.header.isCensus && !item.header.isCharity)
    .sort((a, b) => naturalBedCompare(a.header.room, b.header.room));

  const charityCount = headerList.filter((item) => item.header.isCharity).length;
  const analyses = active.map((item) => ({
    noteId: item.note.id,
    ...analyzePatientHandover(item.note, targetDate),
  }));

  const updatedCount = analyses.filter((a) => a.shifts.length > 0).length;
  const openPendingCount = analyses.reduce((sum, a) => sum + a.openPending.length, 0);
  const gapsCount = analyses.reduce((sum, a) => sum + a.gaps.length, 0);

  const fmtLabel = format === 'ipass' ? 'I-PASS Sign-out' : format === 'sbar' ? 'SBAR Handover' : 'Shift Endorsement / Handover';
  let out = `# ${fmtLabel} — ${targetDate}\n\n`;
  out += `**Active Census:** ${active.length} | **Updated Today:** ${updatedCount} | **Open Pending:** ${openPendingCount} | **Gaps:** ${gapsCount} | **Charity:** ${charityCount}\n\n`;

  const displayAnalyses =
    scope === 'gaps'
      ? analyses.filter((a) => a.gaps.length > 0 || a.openPending.length > 0)
      : analyses;

  if (displayAnalyses.length === 0) {
    out +=
      scope === 'gaps'
        ? `*No active census gaps or open pending items found.*\n\n`
        : `*No active census patients found.*\n\n`;
  }

  for (const a of displayAnalyses) {
    const pt = a.parsed;
    const roomLbl = formatRoomLabel(pt.room);
    const hdPart = pt.hospitalDay ? `HD #${pt.hospitalDay}` : '';
    const icuPart = pt.icuDay ? `ICU #${pt.icuDay}` : '';
    const demo = [pt.age ? `${pt.age}yo` : '', pt.sex, pt.service, hdPart, icuPart].filter(Boolean).join(' · ');

    out += `## ${roomLbl} — ${pt.name}${demo ? ` (${demo})` : ''}\n`;

    const dx = pt.assessment || a.assessmentSummary || '';
    const m = a.latestMetrics;
    const activeDrip = cleanActiveDrips(m.drips);

    const vsParts = [];
    if (m.vitals) vsParts.push(m.vitals);
    if (m.vent) vsParts.push(`Vent: ${m.vent}`);

    const fluidParts = [];
    const shiftIoVal = m.shiftIo || (!m.io24h ? m.io : '');
    if (shiftIoVal) {
      fluidParts.push(m.ioWindow ? `Shift (${m.ioWindow}): ${shiftIoVal}` : `Shift: ${shiftIoVal}`);
    }
    if (m.io24h) fluidParts.push(`24h: ${m.io24h}`);
    if (pt.cumulativeFb) fluidParts.push(`${pt.cumulativeFb.label}: ${pt.cumulativeFb.totalText}`);
    if (activeDrip) fluidParts.push(`IVF/Drips: ${activeDrip}`);
    if (m.hgt) fluidParts.push(`HGT: ${m.hgt}`);

    let courseText = '';
    if (a.shifts.length === 0) {
      courseText = `No chart entry today (Last entry: ${pt.latestDate || 'None'})`;
    } else {
      const targetEvents =
        scope === 'latest' && a.eventsByShift.length > 1
          ? [a.eventsByShift[a.eventsByShift.length - 1]]
          : a.eventsByShift;
      const shiftsWithEvents = targetEvents.filter((ev) => ev.lines.length > 0);
      if (shiftsWithEvents.length === 0) {
        const shiftList = (scope === 'latest' ? [a.shifts[a.shifts.length - 1]] : a.shifts)
          .map((s) => s.shift)
          .join(', ');
        courseText = `(${shiftList}) Routine shift update; no acute interval events.`;
      } else if (shiftsWithEvents.length === 1) {
        const ev = shiftsWithEvents[0];
        courseText = `(${ev.shift}) ${joinClausesAsProse(ev.lines)}`;
      } else {
        courseText = shiftsWithEvents.map((ev) => `${ev.shift}: ${joinClausesAsProse(ev.lines)}`).join(' · ');
      }
    }

    const combinedPlans = [];
    const combinedPlanSeen = new Set();
    for (const item of [...a.medChanges, ...a.activePlans]) {
      const k = item.toLowerCase();
      if (!combinedPlanSeen.has(k)) {
        combinedPlanSeen.add(k);
        combinedPlans.push(item);
      }
    }

    const safetyParts = [
      pt.severity || 'Stable',
      pt.codeStatus || 'Full Code',
      pt.allergies ? `Allergies: ${pt.allergies}` : 'Allergies: NKDA/Unrecorded',
      pt.isolation?.length ? `Isolation: ${pt.isolation.join(', ')}` : '',
    ].filter(Boolean);
    const devicesParts = [
      ...(pt.trackedLines || []).map((l) => l.label),
      ...(pt.trackedAntibiotics || []).map((ab) => ab.label),
    ];
    const completedAbxToday = (pt.completedAntibiotics || []).filter((ab) =>
      ab.completedDate ? datesMatch(ab.completedDate, targetDate) : false
    );
    const completedAbxText = completedAbxToday.map((ab) => ab.label).join(', ');

    if (format === 'ipass') {
      out += `**I — Illness Severity:** ${safetyParts.join(' · ')}\n`;
      const summaryClauses = [
        dx ? `Dx: ${dx}` : '',
        courseText ? `Course: ${courseText}` : '',
        devicesParts.length ? `Lines/Abx: ${devicesParts.join(', ')}` : '',
        completedAbxText ? `Completed Abx: ${completedAbxText}` : '',
      ].filter(Boolean);
      if (includeVitalsLabs) {
        if (vsParts.length) summaryClauses.push(`VS: ${vsParts.join(' · ')}`);
        if (fluidParts.length) summaryClauses.push(`Fluids: ${fluidParts.join(' · ')}`);
        if (m.labs) summaryClauses.push(`Labs: ${m.labs}`);
      }
      out += `**P — Patient Summary:** ${summaryClauses.join(' | ') || 'See chart'}\n`;

      const hasResolved = includeResolvedPending && a.resolvedToday.length > 0;
      if (a.openPending.length > 0 || hasResolved) {
        out += `**A — Action List:**\n`;
        for (const p of a.openPending) out += `- [ ] ${p}\n`;
        if (hasResolved) {
          for (const r of a.resolvedToday) out += `- [x] ${r} *(resolved)*\n`;
        }
      } else {
        out += `**A — Action List:** None open\n`;
      }

      const sitParts = [
        pt.contingencies ? `If/Then: ${pt.contingencies}` : '',
        activeDrip ? `Active Drips: ${activeDrip}` : '',
        combinedPlans.length ? `Plans: ${joinClausesAsProse(combinedPlans)}` : '',
      ].filter(Boolean);
      out += `**S — Situation Awareness & Contingencies:** ${sitParts.join(' · ') || 'Monitor routine clinical status'}\n`;
      out += `**S — Synthesis:** [ ] Receiver read-back confirmed\n\n---\n\n`;
      continue;
    }

    if (format === 'sbar') {
      out += `**S — Situation:** ${safetyParts.join(' · ')}${dx ? ` — ${dx}` : ''}\n`;
      const bgParts = [
        courseText ? `Interval: ${courseText}` : '',
        devicesParts.length ? `Lines/Abx: ${devicesParts.join(', ')}` : '',
        completedAbxText ? `Completed Abx: ${completedAbxText}` : '',
        a.feedingItems.length ? `Diet: ${joinClausesAsProse(a.feedingItems)}` : '',
      ].filter(Boolean);
      out += `**B — Background:** ${bgParts.join(' · ') || 'Active inpatient follow-up'}\n`;
      const assessParts = [];
      if (includeVitalsLabs) {
        if (vsParts.length) assessParts.push(`Vitals: ${vsParts.join(' · ')}`);
        if (fluidParts.length) assessParts.push(`I&O: ${fluidParts.join(' · ')}`);
        if (m.labs) assessParts.push(`Labs: ${m.labs}`);
      }
      const examItems = [...a.neuroNotes, ...a.pertinentExam];
      if (examItems.length) assessParts.push(`Exam: ${joinClausesAsProse(examItems)}`);
      out += `**A — Assessment:** ${assessParts.join(' | ') || (dx || 'Stable')}\n`;
      const recParts = [
        combinedPlans.length ? `Plan: ${joinClausesAsProse(combinedPlans)}` : '',
        pt.contingencies ? `Contingencies: ${pt.contingencies}` : '',
        a.openPending.length ? `Pending (${a.openPending.length}): ${a.openPending.join('; ')}` : '',
      ].filter(Boolean);
      out += `**R — Recommendation:** ${recParts.join(' · ') || 'Continue current care'}\n\n---\n\n`;
      continue;
    }

    if (dx) {
      out += `**Assessment:** ${dx}\n`;
    }

    if (a.shifts.length === 0) {
      out += `**Course:** No chart entry today (Last entry: ${pt.latestDate || 'None'})\n`;
    } else {
      const targetEvents =
        scope === 'latest' && a.eventsByShift.length > 1
          ? [a.eventsByShift[a.eventsByShift.length - 1]]
          : a.eventsByShift;
      const shiftsWithEvents = targetEvents.filter((ev) => ev.lines.length > 0);
      if (shiftsWithEvents.length === 0) {
        const shiftList = (scope === 'latest' ? [a.shifts[a.shifts.length - 1]] : a.shifts)
          .map((s) => s.shift)
          .join(', ');
        out += `**Course (${shiftList}):** Routine shift update; no acute interval events.\n`;
      } else if (shiftsWithEvents.length === 1) {
        const ev = shiftsWithEvents[0];
        out += `**Course (${ev.shift}):** ${joinClausesAsProse(ev.lines)}\n`;
      } else {
        const combined = shiftsWithEvents
          .map((ev) => `${ev.shift}: ${joinClausesAsProse(ev.lines)}`)
          .join(' · ');
        out += `**Course:** ${combined}\n`;
      }
    }

    if (includeVitalsLabs) {
      if (vsParts.length > 0) {
        out += `**${m.vent ? 'Vitals & Vent' : 'Vitals'}:** ${vsParts.join(' · ')}\n`;
      }
      if (fluidParts.length > 0) {
        out += `**I&O / Fluids:** ${fluidParts.join(' · ')}\n`;
      }
      if (m.labs) {
        out += `**Labs:** ${m.labs}\n`;
      }
    }

    const examItems = [...a.neuroNotes, ...a.pertinentExam];
    if (examItems.length > 0) {
      out += `**Neuro / Pertinent Exam:** ${joinClausesAsProse(examItems)}\n`;
    }

    if (a.feedingItems.length > 0) {
      out += `**Feeding:** ${joinClausesAsProse(a.feedingItems)}\n`;
    }

    if (combinedPlans.length > 0) {
      out += `**Med Changes & Plans:** ${joinClausesAsProse(combinedPlans)}\n`;
    }

    if (pt.contingencies) {
      out += `**Contingencies (If/Then):** ${pt.contingencies}\n`;
    }
    if (completedAbxText) {
      out += `**Completed Antibiotics:** ${completedAbxText}\n`;
    }

    const hasResolved = includeResolvedPending && a.resolvedToday.length > 0;
    if (a.openPending.length > 0 || hasResolved) {
      out += `**Pending:**\n`;
      for (const p of a.openPending) {
        out += `- [ ] ${p}\n`;
      }
      if (hasResolved) {
        for (const r of a.resolvedToday) {
          out += `- [x] ${r} *(resolved today)*\n`;
        }
      }
    } else {
      out += `**Pending:** None\n`;
    }

    out += `\n---\n\n`;
  }

  out += `## Gaps & Unanswered Asks\n`;
  const withGaps = analyses.filter((a) => a.gaps.length > 0);
  if (withGaps.length > 0) {
    for (const a of withGaps) {
      const roomLbl = formatRoomLabel(a.parsed.room);
      out += `- **${roomLbl} (${a.parsed.name}):** ${a.gaps.join('; ')}\n`;
    }
  } else {
    out += `- None — all active patients have current entries and no flagged gaps.\n`;
  }

  if (charityCount > 0) {
    out += `\n*Note: ${charityCount} charity patient(s) tracked separately.*\n`;
  }

  return {
    markdown: out,
    format,
    stats: {
      activeCount: active.length,
      updatedCount,
      openPendingCount,
      gapsCount,
      charityCount,
    },
    patientMeta: analyses.map((a) => ({
      id: a.noteId,
      name: a.parsed.name,
      room: formatRoomLabel(a.parsed.room),
      headerText: `${formatRoomLabel(a.parsed.room)} — ${a.parsed.name}`,
      gapHeaderText: `${formatRoomLabel(a.parsed.room)} (${a.parsed.name})`,
      gaps: a.gaps,
    })),
  };
}

export function buildPrintableScutsheetData(notes, options = {}) {
  const includeCharity = Boolean(options.includeCharity);
  const parsed = (notes || [])
    .filter((n) => {
      const h = parseChartHeader(n.content, n);
      return h.isCensus && (includeCharity || !h.isCharity);
    })
    .map((n) => ({ note: n, ...parseChart(n.content, n) }))
    .sort((a, b) => naturalBedCompare(a.room, b.room));

  return {
    generatedDate: getTodayDateStrings().mmddyyyy,
    patients: parsed.map((p) => ({
      id: p.note.id,
      room: formatRoomLabel(p.room),
      rawRoom: p.room || 'Unassigned',
      name: p.name,
      ageSex: [p.age ? `${p.age}${p.sex || ''}` : p.sex || '', p.weight ? `${p.weight}kg` : ''].filter(Boolean).join(' · '),
      service: p.service || '',
      ap: p.ap || '',
      hospitalDay: p.hospitalDay,
      icuDay: p.icuDay,
      codeStatus: p.codeStatus || 'Full Code',
      severity: p.severity || 'Stable',
      allergies: p.allergies || 'NKDA',
      isolation: p.isolation || [],
      assessment: p.assessment || '',
      vitals: p.vitals || '',
      vent: p.vent || '',
      io: p.io || '',
      labs: p.labs || '',
      drips: p.drips || '',
      trackedLines: p.trackedLines || [],
      trackedAntibiotics: p.trackedAntibiotics || [],
      contingencies: p.contingencies || '',
      servicePlans: p.servicePlans || [],
      openPending: (p.pending || []).filter((it) => !it.checked).map((it) => it.text),
    })),
  };
}

export function formatHandoverPlainText(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];

  for (let line of lines) {
    const trimmed = line.trim();
    if (/^---+$/.test(trimmed)) {
      if (out.length > 0 && out[out.length - 1] !== '') out.push('');
      continue;
    }

    line = line.replace(/^#\s+/, '');
    line = line.replace(/^##\s+/, '');
    line = line.replace(/^###\s+/, '');
    line = line.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    line = line.replace(/\*([^*\n]+)\*/g, '$1');
    line = line.replace(/`([^`\n]+)`/g, '$1');
    line = line.replace(/^(\s*)[-*]\s*\[[xX]\]\s*/, '$1[Done] ');
    line = line.replace(/[ \t]+$/, '');

    out.push(line);
  }

  while (out.length > 0 && out[0] === '') out.shift();
  while (out.length > 0 && out[out.length - 1] === '') out.pop();

  return out.join('\n').replace(/\n{3,}/g, '\n\n');
}

export function formatDailyCensusReport(notes) {
  const today = getTodayDateStrings();
  const headers = (notes || []).map((n) => ({ note: n, header: parseChartHeader(n.content, n) }));
  const charityCount = headers.filter((item) => item.header.isCharity).length;

  const active = headers
    .filter((item) => item.header.isCensus && !item.header.isCharity)
    .map((item) => ({ ...parseChart(item.note.content, item.note), id: item.note.id }))
    .sort((a, b) => naturalBedCompare(a.room, b.room));

  let out = `# Daily Census — ${today.mmddyyyy}\n\n`;
  out += `**Total Active Census:** ${active.length} | **Charity Patients:** ${charityCount}\n\n`;

  for (const pt of active) {
    const demo = [pt.age ? `${pt.age}yo` : '', pt.sex, pt.service].filter(Boolean).join(' · ');
    const flag = !pt.isUpdatedToday ? `⚠️ *No entry today (Last: ${pt.latestDate || 'None'})*` : '✓ Updated';

    out += `### ${formatRoomLabel(pt.room)} — ${pt.name} ${demo ? `(${demo})` : ''}\n`;
    out += `**Status:** ${flag}\n`;
    if (pt.ap) out += `**Attending:** ${pt.ap}\n`;
    if (pt.assessment) out += `**Assessment:** ${pt.assessment}\n`;
    if (pt.vitals) out += `**Vitals:** ${pt.vitals}\n`;
    if (pt.drips) out += `**Drips:** ${pt.drips}\n`;

    const openPending = pt.pending.filter((p) => !p.checked);
    if (openPending.length > 0) {
      out += `**Pending:**\n`;
      for (const p of openPending) {
        out += `- [ ] ${p.text}\n`;
      }
    } else {
      out += `**Pending:** None\n`;
    }
    out += `\n---\n\n`;
  }

  if (charityCount > 0) {
    out += `*Note: ${charityCount} charity patient(s) tracked separately.*\n`;
  }

  return out;
}

export function getSyntheticCensusData() {
  const today = getTodayDateStrings().mmddyyyy;
  const daysAgo = (n) => getTodayDateStrings(new Date(Date.now() - n * 86400000)).mmddyyyy;
  const d3Ago = daysAgo(3);
  const d4Ago = daysAgo(4);
  return [
    {
      id: 'syn-pt-1',
      title: 'Dela Cruz, Juan B. - 412',
      name: 'Juan B. Dela Cruz',
      room: 'Room 412',
      aliases: ['Juanito Cruz', 'JBC'],
      content: `---
name: Juan B. Dela Cruz
room: 412
age: 58
sex: M
weight: 72
height_cm: 172
service: Internal Medicine
admitted: ${today}
ap: Dr. A. Santos
code_status: Full Code
severity: Stable
allergies: NKDA
contingencies: If SpO2 < 92%, titrate O2 and recheck ABG
census: true
charity: false
assessment: Community-Acquired Pneumonia (Moderate Risk); Type 2 Diabetes Mellitus
---

## ${today}

### 6am
Greeting: Good morning team
Vitals: BP 120/80 | HR 78 | RR 18 | T 36.8C | O2sat 97% on 2L NC
Shift I&O: In: 800ml | Out: 650ml | Net: +150ml (24h Net: +400ml)
Labs: K 4.1 (3.7) | Na 136 (138) | Cr 1.1 (1.0) | WBC 11.2 (14.5)
Drips: Plain NSS at 80cc/hr

**Pending:
- [ ] Repeat CBC tomorrow AM
- [ ] Await Sputum Gram stain and C/S
- [ ] Chest Physiotherapy schedule

Service Plans:
- Continue Ceftriaxone 2g IV OD (Day 3) + Azithromycin 500mg PO OD
- Sliding scale insulin per protocol
- Incentive spirometry q2h while awake

Medications:
- Ceftriaxone 2g IV OD (Day 3)
- Azithromycin 500mg tab OD
- Sliding scale regular insulin per protocol
`,
      updated: Date.now() - 3600000,
    },
    {
      id: 'syn-pt-2',
      title: 'Santos, Maria Clara - 405',
      name: 'Maria Clara Santos',
      room: 'Room 405',
      aliases: ['Clarita Santos'],
      content: `---
name: Maria Clara Santos
room: 405
age: 64
sex: F
weight: 58
height_cm: 158
service: Cardiology
admitted: ${d3Ago}
ap: Dr. E. Gomez
code_status: Full Code
severity: Watcher
allergies: NKDA
contingencies: If recurrent chest pain or ST change, stat 12L ECG and call Cardiology
census: true
charity: false
assessment: NSTEMI s/p PCI to LAD; Hypertensive Heart Disease; CKD Stage 3a
---

## ${today}

### 6am
Vitals: BP 115/70 | HR 64 | RR 16 | T 36.6C | O2sat 99% on RA
Shift I&O: In: 600ml | Out: 900ml | Net: -300ml
Labs: Troponin-I trending down 0.82 (2.45 H) | Cr 1.4 (1.5) | eGFR 42
Drips: Heparin infusion discontinued 0400H

**Pending:
- [ ] Transthoracic 2D-Echo scheduled 10am
- [ ] Lipid panel fasting tomorrow
- [x] Post-PCI puncture site check (groin soft, no hematoma)

Service Plans:
- Dual Antiplatelet Therapy: Aspirin 80mg OD + Ticagrelor 90mg BID
- Atorvastatin 80mg tab QHS
- Low salt, low fat cardiac diet
- Ambulate with assistance today

Medications:
- Aspirin 80mg tab OD
- Ticagrelor 90mg tab BID
- Atorvastatin 80mg tab QHS
- Losartan 50mg tab OD
- Carvedilol 6.25mg tab BID
`,
      updated: Date.now() - 7200000,
    },
    {
      id: 'syn-pt-3',
      title: 'Dalisay, Roberto M. - ICU-2',
      name: 'Roberto M. Dalisay',
      room: 'ICU-2',
      aliases: ['Berto Dalisay'],
      content: `---
name: Roberto M. Dalisay
room: ICU-2
age: 71
sex: M
weight: 70
height_cm: 170
service: Pulmonology / Critical Care
admitted: ${d4Ago}
icu_admitted: ${d3Ago}
ap: Dr. L. Morales
code_status: Full Code
severity: Unstable
allergies: Sulfamethoxazole (rash)
isolation: Contact
contingencies: If MAP < 65, uptitrate Norepi by 0.02 mkm (max 0.3); if SpO2 < 90%, obtain stat ABG and CXR
lines: R-IJ CVC | ${d3Ago}; Foley catheter | ${d3Ago}
antibiotics: Meropenem 1g IV | ${d3Ago} | 7 | q12h | 08:00
census: true
charity: false
assessment: Septic Shock secondary to Severe Urosepsis; Acute Respiratory Distress Syndrome (ARDS); AKI on CKD
---

## ${today}

### 6am
Vitals: BP 100/60 (MAP 73) | HR 92 | RR 22 | T 38.2C | O2sat 94% on Vent
Vent: AC/VC Vt 420 | PEEP 10 | FiO2 50% | Ppeak 26
Shift I&O: In: 1400ml | Out: 700ml | Net: +700ml
Drips: Norepinephrine @ 0.08 mcg/kg/min | Fentanyl @ 50 mcg/hr
Labs: Na 132 | K 4.8 | Cl 96 | HCO3 19 | BUN 38 | Cr 2.4 H (1.8) | Glu 168 | Alb 2.8 | WBC 18.4 H | Hb 10.4 L | Hct 31.2 L | Plt 138 L | ABG pH 7.32 / pCO2 38 / pO2 78 / HCO3 19 / BE -5 | Lactate 2.8 H

**Pending:
- [ ] Repeat ABG 2h post PEEP titration
- [ ] Blood CS x 2 sites bottle incubation Day 1
- [ ] Foley catheter urine output hourly monitoring
- [ ] Nephrology co-management consult reply

Service Plans:
- Meropenem 1g IV q12h (adjusted for CrCl)
- Titrate Norepinephrine to maintain MAP > 65
- Protective lung ventilation strategy (6ml/kg PBW)

Medications:
- Meropenem 1g IV q12h (renal-adjusted)
- Norepinephrine 4mg/250mL @ 0.08 mcg/kg/min
- Fentanyl 500mcg/50mL @ 50 mcg/hr
- Pantoprazole 40mg IV OD
- Enoxaparin 40mg SC OD
`,
      updated: Date.now() - 1800000,
    },
    {
      id: 'syn-pt-4',
      title: 'Reyes, Teresa L. - 418',
      name: 'Teresa L. Reyes',
      room: 'Room 418',
      aliases: ['Tessie Reyes'],
      content: `---
name: Teresa L. Reyes
room: 418
age: 45
sex: F
service: Nephrology / Charity
ap: Dr. J. Tan
code_status: Full Code
severity: Stable
allergies: NKDA
census: true
charity: true
assessment: Systemic Lupus Erythematosus; Lupus Nephritis Class IV for pulse therapy
---

## 11-20-2026

### 6am
Vitals: BP 130/85 | HR 76 | RR 16 | T 36.5C | O2sat 98% on RA
Shift I&O: In: 1000ml | Out: 1100ml | Net: -100ml

**Pending:
- [ ] Repeat 24-hr urine protein
- [ ] Complement C3/C4 levels
- [ ] PhilHealth / Social Service clearance for Cyclophosphamide pulse
`,
      updated: Date.now() - 86400000,
    },
  ];
}

export function syncFrontmatter(content, fields = {}) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const orderedKeys = [
    'name',
    'room',
    'aliases',
    'age',
    'sex',
    'weight',
    'height_cm',
    'service',
    'admitted',
    'icu_admitted',
    'ap',
    'code_status',
    'severity',
    'allergies',
    'isolation',
    'contingencies',
    'lines',
    'antibiotics',
    'antibiotics_completed',
    'census',
    'charity',
    'categories',
    'assessment',
  ];
  const requiredKeys = new Set(['name', 'room', 'census', 'charity']);

  const updates = {};
  for (const k of orderedKeys) {
    if (fields[k] === undefined) continue;
    if (k === 'census' || k === 'charity') {
      updates[k] = fields[k] ? 'true' : 'false';
    } else if ((k === 'aliases' || k === 'categories' || k === 'isolation') && Array.isArray(fields[k])) {
      const cleaned = [];
      const seenVals = new Set();
      for (const item of fields[k]) {
        const val = String(item || '').trim();
        const key = val.toLowerCase();
        if (val && !seenVals.has(key)) {
          seenVals.add(key);
          cleaned.push(val);
        }
      }
      updates[k] = cleaned.join(', ');
    } else {
      updates[k] = String(fields[k]).trim();
    }
  }

  const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---(?:\n|$)/);
  if (fmMatch) {
    const existingLines = fmMatch[1].split('\n');
    const seen = new Set();
    const nextLines = [];
    for (const line of existingLines) {
      const p = line.match(/^([^:]+):(.*)$/);
      if (!p) {
        nextLines.push(line);
        continue;
      }
      const keyLower = p[1].trim().toLowerCase();
      if (Object.hasOwn(updates, keyLower)) {
        seen.add(keyLower);
        if (requiredKeys.has(keyLower) || updates[keyLower] !== '') {
          nextLines.push(`${p[1].trim()}: ${updates[keyLower]}`);
        }
      } else {
        nextLines.push(line);
      }
    }

    for (const k of orderedKeys) {
      if (!seen.has(k) && Object.hasOwn(updates, k)) {
        if (requiredKeys.has(k) || updates[k] !== '') {
          nextLines.push(`${k}: ${updates[k]}`);
        }
      }
    }

    const afterFm = text.slice(fmMatch[0].length);
    const hasTrailingNewline = fmMatch[0].endsWith('\n');
    return `---\n${nextLines.join('\n')}\n---${hasTrailingNewline || afterFm ? '\n' : ''}${afterFm}`;
  }

  const fmLines = [];
  for (const k of orderedKeys) {
    if (Object.hasOwn(updates, k) && (requiredKeys.has(k) || updates[k] !== '')) {
      fmLines.push(`${k}: ${updates[k]}`);
    }
  }
  if (!fmLines.length) return text;
  const trimmedBody = text.replace(/^\n+/, '');
  return trimmedBody ? `---\n${fmLines.join('\n')}\n---\n\n${trimmedBody}` : `---\n${fmLines.join('\n')}\n---\n`;
}

function extractShiftDetails(shift, rawShiftBody, shiftIndex) {
  const body = String(rawShiftBody || '').trim();
  const { pending } = extractPendingFromBlock(body);
  const servicePlans = extractServicePlansFromBlock(body);
  const { vitals, vent, io, drips, labs, consumedLineIndices } = extractClinicalMetricsFromBlock(body);
  const events = [];

  let section = 'main';
  const bodyLines = body.split('\n');
  for (let i = 0; i < bodyLines.length; i++) {
    const trimmed = bodyLines[i].trim();
    if (!trimmed) {
      if (section !== 'main') section = 'main';
      continue;
    }

    if (/^\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?\s*$/i.test(trimmed)) {
      section = 'pending';
      continue;
    }
    if (/^(?:\*{0,2})(?:Service|[A-Za-z][A-Za-z\s/&+-]{1,30})\s+Plans?(?:\*{0,2})\s*:/i.test(trimmed)) {
      section = /^(?:\*{0,2})(?:Generic|General|Routine)\s+Plans?/i.test(trimmed) ? 'genericPlans' : 'servicePlans';
      continue;
    }

    if (section === 'pending') {
      if (isPendingStopLine(trimmed)) {
        section = 'main';
      } else {
        continue;
      }
    }
    if (section === 'servicePlans') {
      if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) continue;
      section = 'main';
    }
    if (/^[-*]\s*\[[ xX]\]/.test(trimmed)) continue;
    if (consumedLineIndices.has(i)) continue;
    if (/^[-*]\s*$/.test(trimmed)) continue;
    events.push(trimmed);
  }

  return {
    shift,
    body,
    shiftIndex,
    vitals,
    vent,
    io,
    drips,
    labs,
    events,
    pending,
    servicePlans,
  };
}

const TIMELINE_CACHE_MAX = 64;
const chartTimelineCache = new Map();

function cloneTimeline(timeline) {
  return timeline.map((day) => ({
    ...day,
    shifts: day.shifts.map((s) => ({
      ...s,
      events: [...s.events],
      pending: [...s.pending],
      servicePlans: [...s.servicePlans],
    })),
  }));
}

export function parseChartTimeline(content) {
  const raw = String(content || '');
  const cached = chartTimelineCache.get(raw);
  if (cached) return cloneTimeline(cached);

  const body = raw
    .replace(/\r\n/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, '')
    .trim();

  if (!body) {
    if (chartTimelineCache.size >= TIMELINE_CACHE_MAX) {
      chartTimelineCache.delete(chartTimelineCache.keys().next().value);
    }
    chartTimelineCache.set(raw, []);
    return [];
  }

  const dateHeadingRe = /^##\s+([^\n]+)$/gm;
  const dateMatches = [...body.matchAll(dateHeadingRe)];
  const chunks = [];

  if (!dateMatches.length) {
    chunks.push({ date: 'Undated', chunk: body });
  } else {
    const pre = body.slice(0, dateMatches[0].index).trim();
    if (pre) chunks.push({ date: 'Undated', chunk: pre });
    for (let i = 0; i < dateMatches.length; i++) {
      const start = dateMatches[i].index + dateMatches[i][0].length;
      const end = i + 1 < dateMatches.length ? dateMatches[i + 1].index : body.length;
      chunks.push({ date: dateMatches[i][1].trim(), chunk: body.slice(start, end).trim() });
    }
  }

  const timeline = [];
  const shiftHeadingRe = /^###\s*([^\n]+)$/gm;
  const seenDates = [];

  for (const { date, chunk } of chunks) {
    if (!chunk) continue;
    if (/^admitting\s+history$/i.test(date)) continue;
    const shiftMatches = [...chunk.matchAll(shiftHeadingRe)];
    const shifts = [];

    if (!shiftMatches.length) {
      shifts.push(extractShiftDetails('Entry', chunk, -1));
    } else {
      const preShift = chunk.slice(0, shiftMatches[0].index).trim();
      if (preShift) {
        shifts.push(extractShiftDetails('Entry', preShift, -1));
      }
      for (let i = 0; i < shiftMatches.length; i++) {
        const start = shiftMatches[i].index + shiftMatches[i][0].length;
        const end = i + 1 < shiftMatches.length ? shiftMatches[i + 1].index : chunk.length;
        shifts.push(extractShiftDetails(shiftMatches[i][1].trim(), chunk.slice(start, end), i));
      }
    }

    if (shifts.length) {
      const dateOccurrenceIndex = seenDates.filter((d) =>
        date === 'Undated' || d === 'Undated' ? d === date : datesMatch(d, date)
      ).length;
      seenDates.push(date);
      timeline.push({ date, dateOccurrenceIndex, shifts });
    }
  }

  if (chartTimelineCache.size >= TIMELINE_CACHE_MAX) {
    chartTimelineCache.delete(chartTimelineCache.keys().next().value);
  }
  chartTimelineCache.set(raw, timeline);
  return cloneTimeline(timeline);
}

export function updateShiftBlockBody(content, targetDate, shiftOccurrenceIndex, newBody, dateOccurrenceIndex = 0) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const range = findShiftSliceRange(text, targetDate, shiftOccurrenceIndex, dateOccurrenceIndex);
  if (!range) return { text, modified: false };

  const cleanNew = String(newBody || '').trim();
  if (shiftOccurrenceIndex === -1) {
    const sepBefore = range.sectionStart > 0 ? '\n' : '';
    const sepAfter = range.sliceEnd < text.length ? '\n\n' : '\n';
    const updated = `${text.slice(0, range.sectionStart)}${sepBefore}${cleanNew}${sepAfter}${text.slice(range.sliceEnd)}`;
    return { text: updated, modified: true };
  }

  const suffix = range.sliceEnd < text.length ? '\n\n' : '\n';
  const updated = `${text.slice(0, range.bodyStart)}${cleanNew}${suffix}${text.slice(range.sliceEnd)}`;
  return { text: updated, modified: true };
}

function dateComparableValue(dateStr) {
  const p = parseDateParts(dateStr);
  return p ? p.year * 10000 + p.month * 100 + p.day : null;
}

export function shiftSortMinutes(shiftLabel) {
  const clean = String(shiftLabel || '').trim();
  if (!clean || /^entry$/i.test(clean)) return -1;
  const t24 = parseShiftTimeTo24h(clean);
  if (t24) {
    const [hh, mm] = t24.split(':').map(Number);
    const total = hh * 60 + mm;
    return total < 240 ? total + 1440 - 240 : total - 240;
  }
  if (/^(?:morning|am)\b/i.test(clean)) return 120;
  if (/^(?:afternoon|pm)\b/i.test(clean)) return 600;
  if (/^(?:night|evening|nod)\b/i.test(clean)) return 1080;
  return Number.MAX_SAFE_INTEGER;
}

export function sortTimelineShiftsChronologically(shifts) {
  if (!Array.isArray(shifts)) return [];
  return shifts
    .map((item, idx) => ({
      item,
      idx,
      sortMins: shiftSortMinutes(typeof item === 'string' ? item : item?.shift),
    }))
    .sort((a, b) => a.sortMins - b.sortMins || a.idx - b.idx)
    .map((entry) => entry.item);
}

function insertShiftChunkChronologically(sectionBody, newShiftLabel, newShiftChunk) {
  const body = String(sectionBody || '');
  const shiftHeadingRe = /^###\s*([^\n]+)$/gm;
  const matches = [...body.matchAll(shiftHeadingRe)];

  const preText = matches.length ? body.slice(0, matches[0].index).trim() : body.trim();
  const blocks = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    blocks.push({
      label: matches[i][1].trim(),
      sortMins: shiftSortMinutes(matches[i][1].trim()),
      blockText: body.slice(start, end).trim(),
    });
  }

  if (newShiftLabel === 'Entry') {
    const combinedPre = [preText, newShiftChunk].filter(Boolean).join('\n\n');
    const parts = [];
    if (combinedPre) parts.push(combinedPre);
    for (const b of blocks) parts.push(b.blockText);
    return parts.join('\n\n');
  }

  const newSortMins = shiftSortMinutes(newShiftLabel);
  let insertIdx = blocks.length;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i].sortMins > newSortMins) {
      insertIdx = i;
      break;
    }
  }
  blocks.splice(insertIdx, 0, {
    label: newShiftLabel,
    sortMins: newSortMins,
    blockText: newShiftChunk,
  });

  const parts = [];
  if (preText) parts.push(preText);
  for (const b of blocks) parts.push(b.blockText);
  return parts.join('\n\n');
}

export function updateShiftBlock(
  content,
  {
    targetDate,
    dateOccurrenceIndex = 0,
    shiftOccurrenceIndex,
    newBody,
    newDate = '',
    newShift = '',
  } = {}
) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const range = findShiftSliceRange(text, targetDate, shiftOccurrenceIndex, dateOccurrenceIndex);
  if (!range) return { text, modified: false, date: targetDate, shift: '', moved: false };

  const oldShift =
    shiftOccurrenceIndex >= 0 && range.shiftMatches[shiftOccurrenceIndex]
      ? range.shiftMatches[shiftOccurrenceIndex][1].trim()
      : 'Entry';
  const effectiveDate = String(newDate || '').trim() || targetDate;
  const effectiveShift = String(newShift || '').trim() || oldShift;

  const dateChanged =
    targetDate === 'Undated'
      ? Boolean(String(newDate || '').trim()) && String(newDate).trim() !== 'Undated'
      : Boolean(String(newDate || '').trim()) && !datesMatch(targetDate, effectiveDate);
  const shiftChanged = effectiveShift !== oldShift;

  if (!dateChanged && !shiftChanged) {
    const res = updateShiftBlockBody(text, targetDate, shiftOccurrenceIndex, newBody, dateOccurrenceIndex);
    return { ...res, date: targetDate, shift: oldShift, moved: false };
  }

  const cleanNew = String(newBody || '').trim();
  const entryBlock =
    effectiveShift === 'Entry'
      ? cleanNew
      : cleanNew
        ? `### ${effectiveShift}\n${cleanNew}`
        : `### ${effectiveShift}`;

  if (!dateChanged) {
    const withoutOld = text.slice(range.sectionStart, range.fullStart) + text.slice(range.sliceEnd, range.sectionEnd);
    const rebuiltSection = insertShiftChunkChronologically(withoutOld, effectiveShift, entryBlock);
    const prefix = text.slice(0, range.sectionStart).replace(/\n+$/, '');
    const suffix = text.slice(range.sectionEnd).replace(/^\n+/, '');
    const headPart = prefix ? `${prefix}\n\n${rebuiltSection}` : rebuiltSection;
    const updated = `${headPart}${suffix ? `\n\n${suffix}` : ''}`.replace(/\n*$/, '\n');
    return { text: updated, modified: true, date: targetDate, shift: effectiveShift, moved: true };
  }

  const delRes = deleteShiftBlock(text, targetDate, shiftOccurrenceIndex, dateOccurrenceIndex);
  if (!delRes.modified) {
    return { text, modified: false, date: targetDate, shift: oldShift, moved: false };
  }
  const prunedText = delRes.text;

  const dateHeadingRe = /^##\s+([^\n]+)$/gm;
  const headings = [...prunedText.matchAll(dateHeadingRe)];

  let targetMatchIdx = -1;
  for (let i = headings.length - 1; i >= 0; i--) {
    const hText = headings[i][1].trim();
    if (/^admitting\s+history$/i.test(hText)) continue;
    if (datesMatch(hText, effectiveDate)) {
      targetMatchIdx = i;
      break;
    }
  }

  if (targetMatchIdx !== -1) {
    const h = headings[targetMatchIdx];
    const secStart = h.index + h[0].length;
    const secEnd = targetMatchIdx + 1 < headings.length ? headings[targetMatchIdx + 1].index : prunedText.length;
    const rebuiltSection = insertShiftChunkChronologically(prunedText.slice(secStart, secEnd), effectiveShift, entryBlock);
    const before = prunedText.slice(0, secStart).replace(/\n+$/, '');
    const after = prunedText.slice(secEnd).replace(/^\n+/, '');
    const updated = `${before}\n\n${rebuiltSection}${after ? `\n\n${after}` : ''}`.replace(/\n*$/, '\n');
    return { text: updated, modified: true, date: effectiveDate, shift: effectiveShift, moved: true };
  }

  const newDateSection = `## ${effectiveDate}\n\n${entryBlock}`;
  const newComp = dateComparableValue(effectiveDate);
  let insertAt = -1;
  if (newComp !== null) {
    for (const h of headings) {
      const hText = h[1].trim();
      if (/^admitting\s+history$/i.test(hText)) continue;
      const comp = dateComparableValue(hText);
      if (comp !== null && comp > newComp) {
        insertAt = h.index;
        break;
      }
    }
  }

  let updated;
  if (insertAt !== -1) {
    const before = prunedText.slice(0, insertAt).replace(/\n+$/, '');
    const after = prunedText.slice(insertAt).replace(/^\n+/, '');
    updated = (before ? `${before}\n\n${newDateSection}\n\n${after}` : `${newDateSection}\n\n${after}`).replace(
      /\n*$/,
      '\n'
    );
  } else {
    const before = prunedText.replace(/\n+$/, '');
    updated = (before ? `${before}\n\n${newDateSection}` : newDateSection).replace(/\n*$/, '\n');
  }

  return { text: updated, modified: true, date: effectiveDate, shift: effectiveShift, moved: true };
}

export function deleteShiftBlock(content, targetDate, shiftOccurrenceIndex, dateOccurrenceIndex = 0) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const range = findShiftSliceRange(text, targetDate, shiftOccurrenceIndex, dateOccurrenceIndex);
  if (!range) return { text, modified: false };

  const remainingInDate =
    text.slice(range.sectionStart, range.fullStart) + text.slice(range.sliceEnd, range.sectionEnd);

  const spliceStart = range.hasHeading && !remainingInDate.trim() ? range.headingStart : range.fullStart;
  const spliceEnd = range.hasHeading && !remainingInDate.trim() ? range.sectionEnd : range.sliceEnd;

  const before = text.slice(0, spliceStart).replace(/\n+$/, '');
  const after = text.slice(spliceEnd).replace(/^\n+/, '');

  let updated;
  if (before && after) updated = `${before}\n\n${after}`;
  else if (before) updated = `${before}\n`;
  else updated = after ? `${after}\n` : '';

  return { text: updated, modified: true };
}

export function appendPendingLineToLatestBlock(content, taskText, defaultShift = '6am') {
  const cleanTask = String(taskText || '').trim();
  if (!cleanTask) return content;
  const text = String(content || '').replace(/\r\n/g, '\n');
  const lines = text.split('\n');

  let latestShiftIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^###\s+/.test(lines[i])) {
      latestShiftIdx = i;
      break;
    }
  }

  let pendingHdrIdx = -1;
  const scanLimit = latestShiftIdx !== -1 ? latestShiftIdx : 0;
  for (let i = lines.length - 1; i >= scanLimit; i--) {
    if (/^\s*\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?\s*$/i.test(lines[i])) {
      pendingHdrIdx = i;
      break;
    }
  }

  if (pendingHdrIdx !== -1) {
    let insertAt = pendingHdrIdx + 1;
    while (insertAt < lines.length) {
      const t = lines[insertAt].trim();
      if (
        !t ||
        /^#{2,3}\s+/.test(t) ||
        /^(?:\*{0,2})(?:Service|Generic|General|[A-Za-z][A-Za-z\s/&+-]{1,25})\s+Plans?/i.test(t)
      ) {
        break;
      }
      insertAt++;
    }
    lines.splice(insertAt, 0, `- [ ] ${cleanTask}`);
    return lines.join('\n');
  }

  const trimmed = text.trimEnd();
  if (latestShiftIdx !== -1) {
    return `${trimmed}\n\n**Pending:\n- [ ] ${cleanTask}\n`;
  }
  return appendShiftBlock(trimmed, defaultShift, null, `**Pending:\n- [ ] ${cleanTask}`);
}

export function hasShiftHeadingOnDate(content, shift, mmddyyyy) {
  const cleanShift = String(shift || '').trim().toLowerCase();
  const targetDate = String(mmddyyyy || '').trim();
  if (!cleanShift || !targetDate) return false;
  const timeline = parseChartTimeline(content);
  return timeline.some(
    (group) =>
      datesMatch(group.date, targetDate) &&
      (group.shifts || []).some((s) => String(s.shift || '').trim().toLowerCase() === cleanShift)
  );
}

export function removeCategoryFromChartContent(content, categoryName) {
  const targetLower = String(categoryName || '').trim().toLowerCase();
  const text = String(content || '');
  if (!targetLower) return { text, modified: false };

  const parsed = parseChart(text);
  const nextCategories = (parsed.categories || []).filter(
    (c) => String(c || '').trim().toLowerCase() !== targetLower
  );
  const hadMatch = nextCategories.length !== (parsed.categories || []).length;
  const clearingCharity = targetLower === 'charity' && parsed.isCharity;
  if (!hadMatch && !clearingCharity) {
    return { text, modified: false };
  }

  const nextCharity = nextCategories.some((c) => c.toLowerCase() === 'charity');
  const updated = syncFrontmatter(text, {
    categories: nextCategories,
    charity: nextCharity,
  });
  return { text: updated, modified: updated !== text };
}

export function createEmptyAdmittingHistory() {
  return {
    chiefComplaint: '',
    hpi: '',
    pmh: {
      htn: false,
      htnDuration: '',
      dm: false,
      dmDuration: '',
      ba: false,
      cad: false,
      prevHosp: false,
      prevHospReason: '',
      other: '',
    },
    familyHistory: '',
    psh: '',
    vitals: {
      sbp: '',
      dbp: '',
      hr: '',
      rr: '',
      temp: '',
      o2: '',
    },
    pe: '',
    admittingImpression: '',
    planOfCare: '',
  };
}

export function hasAdmittingHistoryContent(rawData) {
  if (!rawData || typeof rawData !== 'object') return false;
  const pmh = rawData.pmh || {};
  const v = rawData.vitals || {};
  return Boolean(
    String(rawData.chiefComplaint || '').trim() ||
      String(rawData.hpi || '').trim() ||
      pmh.htn ||
      pmh.dm ||
      pmh.ba ||
      pmh.cad ||
      pmh.prevHosp ||
      String(pmh.htnDuration || '').trim() ||
      String(pmh.dmDuration || '').trim() ||
      String(pmh.prevHospReason || '').trim() ||
      String(pmh.other || '').trim() ||
      String(rawData.familyHistory || '').trim() ||
      String(rawData.psh || '').trim() ||
      String(v.sbp || '').trim() ||
      String(v.dbp || '').trim() ||
      String(v.hr || '').trim() ||
      String(v.rr || '').trim() ||
      String(v.temp || '').trim() ||
      String(v.o2 || '').trim() ||
      String(rawData.pe || '').trim() ||
      String(rawData.admittingImpression || '').trim() ||
      String(rawData.planOfCare || '').trim()
  );
}

export function formatAdmittingHistoryMarkdown(rawData) {
  const data = {
    ...createEmptyAdmittingHistory(),
    ...(rawData || {}),
    pmh: { ...createEmptyAdmittingHistory().pmh, ...(rawData?.pmh || {}) },
    vitals: { ...createEmptyAdmittingHistory().vitals, ...(rawData?.vitals || {}) },
  };
  if (!hasAdmittingHistoryContent(data)) return '';

  const lines = ['## Admitting History'];
  const pushField = (title, val) => {
    const clean = String(val || '').trim();
    if (!clean) return;
    if (clean.includes('\n')) {
      lines.push(`**${title}:**`);
      lines.push(clean);
    } else {
      lines.push(`**${title}:** ${clean}`);
    }
  };

  pushField('Chief Complaint', data.chiefComplaint);
  pushField('History of Present Illness', data.hpi);

  const pmhItems = [];
  if (data.pmh.htn) {
    const dur = String(data.pmh.htnDuration || '').trim();
    pmhItems.push(`Hypertensive${dur ? ` (${dur})` : ''}`);
  }
  if (data.pmh.dm) {
    const dur = String(data.pmh.dmDuration || '').trim();
    pmhItems.push(`Diabetes Mellitus${dur ? ` (${dur})` : ''}`);
  }
  if (data.pmh.ba) pmhItems.push('Bronchial Asthma');
  if (data.pmh.cad) pmhItems.push('CAD');
  if (data.pmh.prevHosp) {
    const reason = String(data.pmh.prevHospReason || '').trim();
    pmhItems.push(`Previous Hospitalizations${reason ? `: ${reason}` : ''}`);
  }
  if (String(data.pmh.other || '').trim()) {
    pmhItems.push(`Other: ${String(data.pmh.other).trim()}`);
  }
  if (pmhItems.length) {
    lines.push('**Past Medical History:**');
    for (const item of pmhItems) {
      lines.push(`- [x] ${item}`);
    }
  }

  pushField('Family History', data.familyHistory);
  pushField('Personal and Social History', data.psh);

  const v = data.vitals;
  const bpStr =
    String(v.sbp || '').trim() && String(v.dbp || '').trim()
      ? `BP ${String(v.sbp).trim()}/${String(v.dbp).trim()}`
      : String(v.sbp || '').trim()
        ? `BP ${String(v.sbp).trim()}`
        : '';
  const vitalParts = [
    bpStr,
    String(v.hr || '').trim() ? `HR ${String(v.hr).trim()}` : '',
    String(v.rr || '').trim() ? `RR ${String(v.rr).trim()}` : '',
    String(v.temp || '').trim() ? `T ${String(v.temp).trim()}` : '',
    String(v.o2 || '').trim() ? `O2sat ${String(v.o2).trim()}` : '',
  ].filter(Boolean);
  if (vitalParts.length) {
    lines.push(`**Admission Vitals:** ${vitalParts.join(' | ')}`);
  }

  pushField('Physical Examination', data.pe);
  pushField('Admitting Impression', data.admittingImpression);
  pushField('Plan of Care', data.planOfCare);

  return lines.join('\n') + '\n';
}

function isKeywordNegated(text, index) {
  const before = text.slice(Math.max(0, index - 36), index);
  return /(?:non[- ]?|no\s+(?:known\s+|hx\s+of\s+|history\s+of\s+)?|negative\s+for\s+|denies\s+|without\s+|\(-\)\s*)$/i.test(
    before
  );
}

function extractBalancedParen(str) {
  const lead = /^\s*\(/.exec(str);
  if (!lead) return null;
  let depth = 0;
  const openIdx = lead[0].length - 1;
  for (let i = openIdx; i < str.length; i++) {
    if (str[i] === '(') depth++;
    else if (str[i] === ')') {
      depth--;
      if (depth === 0) {
        return {
          inner: str.slice(openIdx + 1, i).trim(),
          endIndex: i + 1,
        };
      }
    }
  }
  return null;
}

function stripBalancedParenAndTrail(str, patRe, trailRe) {
  let out = '';
  let pos = 0;
  const flags = patRe.flags.includes('g') ? patRe.flags : `${patRe.flags}g`;
  const globalRe = new RegExp(patRe.source, flags);
  let m;
  while ((m = globalRe.exec(str)) !== null) {
    out += str.slice(pos, m.index);
    let afterIdx = m.index + m[0].length;
    const paren = extractBalancedParen(str.slice(afterIdx));
    if (paren) {
      afterIdx += paren.endIndex;
    } else if (trailRe) {
      const tm = trailRe.exec(str.slice(afterIdx));
      if (tm) afterIdx += tm[0].length;
    }
    pos = afterIdx;
  }
  out += str.slice(pos);
  return out;
}

function extractAdmissionVitalsFromText(raw) {
  const out = { sbp: '', dbp: '', hr: '', rr: '', temp: '', o2: '' };
  const s = String(raw || '');
  if (!s.trim()) return out;

  const bpMatch =
    s.match(/\b(?:BP|Blood\s+Pressure)[:\s]+(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\b/i) ||
    s.match(/\b(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\s*(?:mmHg)?\b/i);
  if (bpMatch) {
    out.sbp = bpMatch[1];
    out.dbp = bpMatch[2];
  }
  const hrMatch = s.match(/\b(?:HR|Heart\s+Rate|PR|Pulse)[:\s]+(\d{2,3})\b/i);
  if (hrMatch) out.hr = hrMatch[1];
  const rrMatch = s.match(/\b(?:RR|Respiratory\s+Rate)[:\s]+(\d{1,2})\b/i);
  if (rrMatch) out.rr = rrMatch[1];
  const tempMatch = s.match(/\b(?:Temp|Temperature|T)[:\s]+(\d{2}(?:\.\d)?\s*°?[CF]?)\b/i);
  if (tempMatch) out.temp = tempMatch[1].replace(/\s+/g, '');
  const o2Match = s.match(/\b(?:O2\s*sat|SpO2|Sat|O2)[:\s]+(\d{2,3}\s*%[^|\n,;]*)/i);
  if (o2Match) out.o2 = o2Match[1].trim();
  return out;
}

function parsePmhSection(pmhRaw, pmhObj) {
  const lines = String(pmhRaw || '')
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim())
    .filter(Boolean);
  const fullText = lines.join('\n');

  const htnMatch = /\b(hypertens(?:ive|ion)|htn|hpn)\b/i.exec(fullText);
  if (htnMatch && !isKeywordNegated(fullText, htnMatch.index)) {
    pmhObj.htn = true;
    const afterHtn = fullText.slice(htnMatch.index + htnMatch[0].length);
    const paren = extractBalancedParen(afterHtn);
    if (paren) {
      pmhObj.htnDuration = paren.inner.replace(/^for\s+/i, '').trim();
    } else {
      const durMatch =
        afterHtn.match(/^\s*(?:for|x|duration[:\s]*)\s*([^,.;\n]+?(?:yr|yrs|year|years|mo|mos|month|months|wk|wks|day|days)\b[^,.;\n]*)/i) ||
        afterHtn.match(/^\s*[-:]\s*([^,.;\n]+)/);
      if (durMatch) pmhObj.htnDuration = durMatch[1].trim();
    }
  }

  const dmMatch = /\b(t[12]dm|dm\s*(?:type\s*[12]|1|2)?|diabetes\s+mellitus|diabet(?:es|ic))\b/i.exec(fullText);
  if (dmMatch && !isKeywordNegated(fullText, dmMatch.index)) {
    pmhObj.dm = true;
    const afterDm = fullText.slice(dmMatch.index + dmMatch[0].length);
    const paren = extractBalancedParen(afterDm);
    if (paren) {
      pmhObj.dmDuration = paren.inner.replace(/^for\s+/i, '').trim();
    } else {
      const durMatch = afterDm.match(
        /^\s*(?:for|x|duration[:\s]*)\s*([^,.;\n]+?(?:yr|yrs|year|years|mo|mos|month|months)\b[^,.;\n]*)/i
      );
      if (durMatch) pmhObj.dmDuration = durMatch[1].trim();
    }
  }

  const baMatch = /\b(bronchial\s+asthma|asthma(?:tic)?|ba)\b/i.exec(fullText);
  if (baMatch && !isKeywordNegated(fullText, baMatch.index)) {
    pmhObj.ba = true;
  }

  const cadMatch = /\b(cad|coronary\s+artery\s+disease|ischemic\s+heart\s+disease)\b/i.exec(fullText);
  if (cadMatch && !isKeywordNegated(fullText, cadMatch.index)) {
    pmhObj.cad = true;
  }

  const hospMatch = /\b(prev(?:ious)?\s+hosp(?:italization)?s?|prior\s+hosp(?:italization)?s?|past\s+hosp(?:italization)?s?|hospitalized)\b/i.exec(
    fullText
  );
  if (hospMatch && !isKeywordNegated(fullText, hospMatch.index)) {
    pmhObj.prevHosp = true;
    const afterHosp = fullText.slice(hospMatch.index + hospMatch[0].length);
    const paren = extractBalancedParen(afterHosp);
    if (paren) {
      pmhObj.prevHospReason = paren.inner;
    } else {
      const reasonMatch = afterHosp.match(/^\s*(?:for|due\s+to|secondary\s+to|:|-)\s*([^,.;\n]+)/i);
      if (reasonMatch) pmhObj.prevHospReason = reasonMatch[1].trim();
    }
  }

  const otherParts = [];
  for (const line of lines) {
    if (/^other\s*:\s*/i.test(line)) {
      const rest = line.replace(/^other\s*:\s*/i, '').trim();
      if (rest) otherParts.push(rest);
      continue;
    }
    let stripped = line;
    stripped = stripBalancedParenAndTrail(
      stripped,
      /\b(?:non[- ]?|no\s+(?:known\s+)?)?(?:hypertens(?:ive|ion)|htn|hpn)\b/i,
      /^\s*(?:for|x)\s*[^,.;\n]+/i
    );
    stripped = stripBalancedParenAndTrail(
      stripped,
      /\b(?:non[- ]?|no\s+(?:known\s+)?)?(?:t[12]dm|dm\s*(?:type\s*[12]|1|2)?|diabetes\s+mellitus|diabet(?:es|ic))\b/i,
      /^\s*(?:for|x)\s*[^,.;\n]+/i
    );
    stripped = stripped.replace(/\b(?:non[- ]?|no\s+(?:known\s+)?)?(?:bronchial\s+asthma|asthma(?:tic)?|ba)\b/gi, '');
    stripped = stripped.replace(/\b(?:no\s+(?:known\s+)?)(?:cad|coronary\s+artery\s+disease|ischemic\s+heart\s+disease)\b|\b(?:cad|coronary\s+artery\s+disease|ischemic\s+heart\s+disease)\b/gi, '');
    stripped = stripBalancedParenAndTrail(
      stripped,
      /\b(?:no\s+(?:prior\s+|previous\s+)?)?(?:prev(?:ious)?|prior|past)\s+hosp(?:italization)?s?\b/i,
      /^\s*(?:for|due\s+to|secondary\s+to|:|-)\s*[^,.;\n]+/i
    );
    stripped = stripped.replace(/^[\s,;./-]+|[\s,;./-]+$/g, '').trim();
    if (stripped && !/^(?:none|unremarkable|nil|n\/a)$/i.test(stripped)) {
      otherParts.push(stripped);
    }
  }
  pmhObj.other = otherParts.join('; ');
}

export function parseAdmittingHistoryText(rawText) {
  const out = createEmptyAdmittingHistory();
  const cleanText = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, '')
    .replace(/^##\s*Admitting\s+History\s*\n?/im, '')
    .trim();
  if (!cleanText) return out;

  const headings = [
    { key: 'chiefComplaint', re: /^(?:Chief\s+Complaint|CC|C\/C)$/i },
    { key: 'hpi', re: /^(?:History\s+of\s+Present\s+Illness|HPI|Present\s+Illness)$/i },
    { key: 'pmhRaw', re: /^(?:Past\s+Medical\s+History|PMHx?|Past\s+History)$/i },
    { key: 'familyHistory', re: /^(?:Family\s+(?:Medical\s+)?History|FHx?|FMHx?)$/i },
    { key: 'psh', re: /^(?:Personal\s*(?:&|and|\/)\s*Social\s+History|Social\s+History|PSHx?|SHx?)$/i },
    { key: 'vitalsRaw', re: /^(?:Admission\s+Vitals?|Vital\s+Signs(?:\s+on\s+Admission)?|Vitals|VS)$/i },
    { key: 'pe', re: /^(?:Physical\s+Exam(?:ination)?|Pertinent\s+PE|PE|P\.E\.)$/i },
    { key: 'admittingImpression', re: /^(?:Admitting\s+Impression|Admitting\s+Diagnosis|Working\s+Impression|Impression|Assessment|Diagnosis|Dx)$/i },
    { key: 'planOfCare', re: /^(?:Plan\s+of\s+Care|Admitting\s+Plan|Initial\s+Plan|Orders|Plan)$/i },
  ];

  const buckets = {
    chiefComplaint: [],
    hpi: [],
    pmhRaw: [],
    familyHistory: [],
    psh: [],
    vitalsRaw: [],
    pe: [],
    admittingImpression: [],
    planOfCare: [],
  };
  let currentKey = 'hpi';

  for (const rawLine of cleanText.split('\n')) {
    const trimmed = rawLine.trim();
    const cleanedLine = trimmed
      .replace(/^#{1,4}\s+/, '')
      .replace(/^\*\*([^*\n]+)\*\*\s*(:?)/, '$1$2');
    const hdrMatch = cleanedLine.match(/^([A-Za-z][A-Za-z\s/&.'-]{1,42})\s*:\s*(.*)$/);
    if (hdrMatch) {
      const label = hdrMatch[1].trim();
      const matched = headings.find((h) => h.re.test(label));
      if (matched) {
        currentKey = matched.key;
        const inlineVal = hdrMatch[2].trim();
        if (inlineVal) buckets[currentKey].push(inlineVal);
        continue;
      }
    }
    buckets[currentKey].push(rawLine.replace(/\s+$/, ''));
  }

  const joinBucket = (arr) => arr.join('\n').trim();
  out.chiefComplaint = joinBucket(buckets.chiefComplaint);
  out.hpi = joinBucket(buckets.hpi);
  out.familyHistory = joinBucket(buckets.familyHistory);
  out.psh = joinBucket(buckets.psh);
  out.admittingImpression = joinBucket(buckets.admittingImpression);
  out.planOfCare = joinBucket(buckets.planOfCare);

  let peText = joinBucket(buckets.pe);
  const vitalsSource = joinBucket(buckets.vitalsRaw) || peText;
  out.vitals = extractAdmissionVitalsFromText(vitalsSource);

  if (peText && !joinBucket(buckets.vitalsRaw)) {
    const peLines = peText.split('\n');
    if (peLines.length > 1 && /^(?:Vital\s+Signs|Vitals|VS|BP)[:\s]/i.test(peLines[0].trim())) {
      peLines.shift();
      peText = peLines.join('\n').trim();
    }
  }
  out.pe = peText;

  const pmhRaw = joinBucket(buckets.pmhRaw);
  if (pmhRaw) {
    parsePmhSection(pmhRaw, out.pmh);
  }

  return out;
}

export function extractAdmittingHistory(content) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const m = /^##\s*Admitting\s+History\s*$/im.exec(text);
  if (!m) {
    return { hasData: false, raw: '', data: createEmptyAdmittingHistory() };
  }
  const afterStart = m.index + m[0].length;
  const rest = text.slice(afterStart);
  const nextH2 = /^##\s+[^\n]+$/m.exec(rest);
  const end = nextH2 ? afterStart + nextH2.index : text.length;
  const raw = text.slice(m.index, end).trim();
  const data = parseAdmittingHistoryText(raw);
  return { hasData: hasAdmittingHistoryContent(data), raw, data };
}

export function upsertAdmittingHistory(content, data) {
  const text = String(content || '').replace(/\r\n/g, '\n');
  const sectionMd = formatAdmittingHistoryMarkdown(data).trim();

  const existingMatch = /^##\s*Admitting\s+History\s*$/im.exec(text);
  let stripped = text;
  if (existingMatch) {
    const afterStart = existingMatch.index + existingMatch[0].length;
    const rest = text.slice(afterStart);
    const nextH2 = /^##\s+[^\n]+$/m.exec(rest);
    const end = nextH2 ? afterStart + nextH2.index : text.length;
    const before = text.slice(0, existingMatch.index).trimEnd();
    const after = text.slice(end).trimStart();
    stripped = [before, after].filter(Boolean).join('\n\n');
  }

  if (!sectionMd) {
    return stripped ? `${stripped.trimEnd()}\n` : '';
  }

  const fmMatch = stripped.match(/^---\s*\n[\s\S]*?\n---[ \t]*(?:\n|$)/);
  if (fmMatch) {
    const fm = fmMatch[0].trimEnd();
    const bodyAfterFm = stripped.slice(fmMatch[0].length).trimStart();
    return bodyAfterFm ? `${fm}\n\n${sectionMd}\n\n${bodyAfterFm.trimEnd()}\n` : `${fm}\n\n${sectionMd}\n`;
  }

  const cleanStripped = stripped.trimStart();
  return cleanStripped ? `${sectionMd}\n\n${cleanStripped.trimEnd()}\n` : `${sectionMd}\n`;
}
