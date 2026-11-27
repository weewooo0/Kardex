// Pure on-device Lab Trending & Chat Relay Parser ("Dump-to-Chart")
// Follows CLINICAL-WORKFLOW-STE.md §5 (File relay messages) and §7 (Lab results)

import { parseChart, parseChartHeader, parseChartTimeline } from './census.js';

export const LAB_SPECS = [
  // Chemistry
  { key: 'Na', panel: 'Chemistry', aliases: ['serum sodium', 'serum na+', 'serum na', 'na+', 'na', 'sodium'], low: 135, high: 145 },
  { key: 'K', panel: 'Chemistry', aliases: ['serum potassium', 'serum k+', 'serum k', 'k+', 'k', 'potassium'], low: 3.5, high: 5.0 },
  { key: 'Cl', panel: 'Chemistry', aliases: ['cl-', 'cl', 'chloride'], low: 98, high: 107 },
  { key: 'HCO3', panel: 'Chemistry', aliases: ['hco3-', 'hco3', 'bicarbonate', 'bicarb', 'co2'], low: 22, high: 26 },
  { key: 'BUN', panel: 'Chemistry', aliases: ['bun', 'urea'], low: 7, high: 20 },
  { key: 'Cr', panel: 'Chemistry', aliases: ['serum creatinine', 'creatinine', 'crea', 'scr', 'cr'], low: 0.6, high: 1.2 },
  { key: 'eGFR', panel: 'Chemistry', aliases: ['egfr', 'gfr'], low: 60 },
  { key: 'Glu', panel: 'Chemistry', aliases: ['glucose', 'glu', 'fbs', 'rbs', 'cbg', 'hgt'], low: 70, high: 140 },
  { key: 'iCa', panel: 'Chemistry', aliases: ['ionized calcium', 'ionized ca', 'ica'], low: 1.12, high: 1.32 },
  { key: 'Ca', panel: 'Chemistry', aliases: ['ca2+', 'calcium', 'ca'], low: 8.5, high: 10.5 },
  { key: 'Mg', panel: 'Chemistry', aliases: ['mg2+', 'magnesium', 'mg'], low: 1.7, high: 2.2 },
  { key: 'Phos', panel: 'Chemistry', aliases: ['phosphorus', 'phosphate', 'phos', 'po4'], low: 2.5, high: 4.5 },
  { key: 'Alb', panel: 'Chemistry', aliases: ['albumin', 'alb'], low: 3.5, high: 5.0 },
  { key: 'AST', panel: 'Chemistry', aliases: ['ast', 'sgot'], high: 40 },
  { key: 'ALT', panel: 'Chemistry', aliases: ['alt', 'sgpt'], high: 41 },
  { key: 'ALP', panel: 'Chemistry', aliases: ['alkaline phosphatase', 'alk phos', 'alp'], high: 130 },
  { key: 'TBili', panel: 'Chemistry', aliases: ['total bilirubin', 't. bili', 'tbili', 'tbil', 'bilirubin'], high: 1.2 },

  // CBC
  { key: 'WBC', panel: 'CBC', aliases: ['wbc', 'leukocytes'], low: 4.5, high: 11.0 },
  { key: 'Hb', panel: 'CBC', aliases: ['hemoglobin', 'hgb', 'hb'], low: 12.0, high: 17.0 },
  { key: 'Hct', panel: 'CBC', aliases: ['hematocrit', 'hct'], low: 36, high: 50, ratioLow: 0.36, ratioHigh: 0.50 },
  { key: 'Plt', panel: 'CBC', aliases: ['platelets', 'platelet', 'plt'], low: 150, high: 450 },
  { key: 'Neu', panel: 'CBC', aliases: ['neutrophils', 'neut', 'neu', 'segs', 'seg', 'pmn'], low: 40, high: 75 },
  { key: 'Lym', panel: 'CBC', aliases: ['lymphocytes', 'lymphs', 'lymph', 'lym'], low: 20, high: 45 },
  { key: 'Mono', panel: 'CBC', aliases: ['monocytes', 'mono', 'mon'], low: 2, high: 10 },
  { key: 'Eo', panel: 'CBC', aliases: ['eosinophils', 'eos', 'eo'], high: 5 },

  // ABG
  { key: 'pH', panel: 'ABG', aliases: ['ph'], low: 7.35, high: 7.45 },
  { key: 'pCO2', panel: 'ABG', aliases: ['paco2', 'pco2'], low: 35, high: 45 },
  { key: 'pO2', panel: 'ABG', aliases: ['pao2', 'po2'], low: 80, high: 100 },
  { key: 'sO2', panel: 'ABG', aliases: ['sao2', 'so2'], low: 95, high: 100 },
  { key: 'BE', panel: 'ABG', aliases: ['base excess', 'be'], low: -2, high: 2 },
  { key: 'Lactate', panel: 'ABG', aliases: ['lactate', 'lac'], high: 2.0 },

  // Cardiac / Coags / Inflammatory
  { key: 'Troponin-I', panel: 'Cardiac/Other', aliases: ['troponin-i', 'troponin i', 'trop-i', 'trop i', 'troponin'], high: 0.04 },
  { key: 'INR', panel: 'Cardiac/Other', aliases: ['inr'], low: 0.8, high: 1.2 },
  { key: 'PT', panel: 'Cardiac/Other', aliases: ['protime', 'pt'], low: 11, high: 14 },
  { key: 'aPTT', panel: 'Cardiac/Other', aliases: ['aptt', 'ptt'], low: 25, high: 35 },
  { key: 'CRP', panel: 'Cardiac/Other', aliases: ['crp'], high: 5.0 },
  { key: 'PCT', panel: 'Cardiac/Other', aliases: ['procalcitonin', 'procal', 'pct'], high: 0.5 },
  { key: 'TSH', panel: 'Cardiac/Other', aliases: ['tsh'], low: 0.4, high: 4.5 },
  { key: 'FT3', panel: 'Cardiac/Other', aliases: ['ft3'] },
  { key: 'FT4', panel: 'Cardiac/Other', aliases: ['ft4'] },
];

const SPEC_BY_KEY = new Map(LAB_SPECS.map((s) => [s.key, s]));
const SPEC_ORDER = new Map(LAB_SPECS.map((s, idx) => [s.key, idx]));

const ALIAS_ENTRIES = [];
for (const spec of LAB_SPECS) {
  for (const alias of spec.aliases) {
    ALIAS_ENTRIES.push({ alias, spec });
  }
}
ALIAS_ENTRIES.sort((a, b) => b.alias.length - a.alias.length);

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ALIAS_ALTERNATION = ALIAS_ENTRIES.map((e) => escapeRe(e.alias)).join('|');
const ALIAS_MAP = new Map(ALIAS_ENTRIES.map((e) => [e.alias.toLowerCase(), e.spec]));

const UNIT_PART =
  '(?:mg\\/dL|mmol\\/L|mEq\\/L|g\\/dL|g\\/L|U\\/L|IU\\/L|ng\\/mL|pg\\/mL|mcg\\/L|mmHg|kPa|%|x10\\^\\d+\\/[uµ]?L|K\\/[uµ]?L|secs?|s\\b)?';

const LAB_PAIR_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${ALIAS_ALTERNATION})(?![\\p{L}\\p{N}])` +
    `(?:\\s*(?:is|was|trending\\s+(?:up|down)|[:=])\\s*|\\s+)` +
    `(-?\\d+(?:\\.\\d+)?)` +
    `(?:\\s*${UNIT_PART})?` +
    `\\*{0,2}` +
    `(?:\\s*([HL])(?![\\p{L}\\p{N}]))?` +
    `\\*{0,2}` +
    `(?:\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?)\\s*(?:[HL])?\\*{0,2}\\s*\\))?`,
  'giu'
);

export function stripChatPrefixes(rawText) {
  const normalized = String(rawText || '').replace(/\r\n/g, '\n');
  const out = [];

  for (const rawLine of normalized.split('\n')) {
    let line = rawLine;
    const trimmed = line.trim();

    if (/^>?\s*Forwarded(?:\s+from\b.*|\s+message:?)$/i.test(trimmed)) continue;
    if (/^[^,\n]{2,40},\s*\[\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?,?\s+\d{1,2}:\d{2}(?:\s*[AP]M)?\]$/i.test(trimmed)) {
      continue;
    }

    // [11/23/2026, 08:15] RN Ana: ...  or  [08:15 AM] Nurse Joy: ...
    line = line.replace(
      /^\s*\[(?:\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?,?\s*)?\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AP]M)?\]\s*(?:[^:\n]{1,35}:\s*)?/i,
      ''
    );
    // 11/23/26, 08:15 AM - Nurse Joy: ...  or  08:15 - RN Ana: ...
    line = line.replace(
      /^\s*(?:\d{1,4}[/-]\d{1,2}(?:[/-]\d{1,4})?,?\s*)?\d{1,2}:\d{2}(?:\s*[AP]M)?\s*[-–]\s*(?:[^:\n]{1,35}:\s*)?/i,
      ''
    );

    out.push(line.replace(/[ \t]+$/, ''));
  }

  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

function isNonLabVitalLine(trimmed) {
  if (/^(?:Vitals|VS|Shift\s+I&O|I&O|Drips?|Infusions?|Vent(?:ilator)?|Greeting|Service\s+Plans?|Generic\s+Plans?):/i.test(trimmed)) {
    return true;
  }
  if (/^\*{0,2}Pending(?:\s+items|\s+list)?\*{0,2}:?/i.test(trimmed)) {
    return true;
  }
  if (/^(?:BP|HR|PR|RR|Tmax|Temp|O2sat|SpO2|O2|I-|O-|Fb)\b/i.test(trimmed)) {
    return true;
  }
  if (/^(?:I|O)\s+(?:~|approx\.?\s*)?\d/i.test(trimmed)) {
    return true;
  }
  return false;
}

export function parseRawLabs(rawText) {
  const text = stripChatPrefixes(rawText);
  const foundMap = new Map();

  for (const rawLine of text.split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (isNonLabVitalLine(trimmed)) continue;

    // Strip parenthesized ref ranges like (ref 0.6-1.2) or Ref: 135-145 so bounds aren't parsed as previous values
    const lineForScan = trimmed
      .replace(/\b(?:ref(?:erence)?|normal|range)\s*[:=]?\s*-?\d+(?:\.\d+)?\s*[-–to]+\s*-?\d+(?:\.\d+)?/gi, '')
      .replace(/\(\s*-?\d+(?:\.\d+)?\s*[-–]\s*-?\d+(?:\.\d+)?\s*\)/g, '');

    const hasLabContext = /\b(?:labs?|lab\s+update|chemistry|cbc|abg|na|k|bun|cr|creatinine|wbc|hb|hct|plt|ph|pco2|po2|hco3|troponin)\b/i.test(
      lineForScan
    );

    LAB_PAIR_RE.lastIndex = 0;
    let m;
    while ((m = LAB_PAIR_RE.exec(lineForScan)) !== null) {
      const rawAlias = m[1];
      const aliasLower = rawAlias.toLowerCase();
      const spec = ALIAS_MAP.get(aliasLower);
      if (!spec) continue;

      const valueStr = m[2];
      const num = parseFloat(valueStr);
      if (Number.isNaN(num)) continue;

      const explicitFlag = m[3] ? m[3].toUpperCase() : '';
      const dictatedPrevious = m[4] || '';

      const beforeText = lineForScan.slice(0, m.index);
      const afterText = lineForScan.slice(m.index + m[0].length);

      // Guard: avoid "Vit K 10mg" or "Vitamin K 10"
      if (aliasLower === 'k' && /\bvit(?:amin)?\s+$/i.test(beforeText)) {
        continue;
      }

      // Guard: English "be" vs ABG "BE"
      if (aliasLower === 'be' && rawAlias !== 'BE' && !hasLabContext) {
        continue;
      }
      if (aliasLower === 'be' && !hasLabContext && !/^[:=\s+-]/.test(lineForScan.slice(m.index + rawAlias.length))) {
        continue;
      }

      // Guard: "pt 58yo" (patient) vs "PT 12.5" (Protime)
      if (aliasLower === 'pt') {
        if (/^(?:yo|y\/o|yrs?|years?|room|bed)\b/i.test(afterText.trim())) continue;
        if (rawAlias !== 'PT' && !/\b(?:inr|aptt|ptt|coag|protime)\b/i.test(lineForScan)) continue;
      }

      // Guard: uppercase "CR 78" (Cardiac Rate) vs "Cr 1.1" (Creatinine)
      if (aliasLower === 'cr' && rawAlias === 'CR' && num >= 25 && !/\b(?:labs?|bun|na|k|egfr|creatinine|renal)\b/i.test(lineForScan)) {
        continue;
      }

      // Latest mention wins (STE §6.9 self-correction rule)
      foundMap.set(spec.key, {
        key: spec.key,
        panel: spec.panel,
        value: valueStr,
        num,
        explicitFlag,
        dictatedPrevious,
      });
    }
  }

  return [...foundMap.values()].sort(
    (a, b) => (SPEC_ORDER.get(a.key) ?? 999) - (SPEC_ORDER.get(b.key) ?? 999)
  );
}

export function extractPriorLabs(chartContent, maxLines = 250) {
  const withoutFm = String(chartContent || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, '');

  const lines = withoutFm.split('\n');
  const tailLines = lines.slice(-maxLines);
  const priorMap = new Map();

  for (const line of tailLines) {
    const trimmed = line.trim();
    if (!trimmed || /^#{2,3}\s+/.test(trimmed)) continue;
    if (isNonLabVitalLine(trimmed)) continue;

    // parseRawLabs returns only the current/latest value from any `value (previous)` pair (STE §7.4)
    const entries = parseRawLabs(trimmed);
    for (const e of entries) {
      priorMap.set(e.key, { value: e.value, num: e.num });
    }
  }

  return priorMap;
}

export function computeLabFlag(key, num, explicitFlag = '') {
  const spec = SPEC_BY_KEY.get(key);
  if (!spec || Number.isNaN(num)) return explicitFlag || '';

  let low = spec.low;
  let high = spec.high;
  if (key === 'Hct' && num <= 1 && spec.ratioLow !== undefined) {
    low = spec.ratioLow;
    high = spec.ratioHigh;
  }

  if (high !== undefined && num > high) return 'H';
  if (low !== undefined && num < low) return 'L';
  return explicitFlag || '';
}

export function buildTrendedLabs(rawText, chartContent = '', options = {}) {
  const parsedEntries = parseRawLabs(rawText);
  const priorMap = extractPriorLabs(chartContent);

  const entries = parsedEntries.map((e) => {
    const prior = priorMap.get(e.key);
    const previous = e.dictatedPrevious || (prior ? prior.value : '');
    const flag = computeLabFlag(e.key, e.num, e.explicitFlag);
    const flagPart = flag ? ` ${flag}` : '';
    const prevPart = previous ? ` (${previous})` : '';
    const token = `${e.key}: ${e.value}${flagPart}${prevPart}`;
    return {
      key: e.key,
      panel: e.panel,
      value: e.value,
      num: e.num,
      flag,
      previous,
      token,
    };
  });

  const inlineText = entries.map((e) => e.token).join(' | ');
  const lineByLineText = entries.map((e) => e.token).join('\n');
  const style = options.style === 'inline' ? 'inline' : 'line';
  const body = style === 'inline' ? inlineText : lineByLineText;
  const formattedBlock = entries.length ? `Lab update:\n${body}` : '';

  return {
    entries,
    inlineText,
    lineByLineText,
    formattedBlock,
  };
}

function matchesToken(haystack, token) {
  const clean = String(token || '').trim();
  if (!clean) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(clean)}(?![\\p{L}\\p{N}])`, 'iu');
  return re.test(haystack);
}

const NON_ROOM_CLINICAL_ABBREV_RE =
  /^(?:hr|rr|bp|pr|vs|o2|pe|iv|po|od|im|sc|sq|fb|io|cr|na|cl|mg|ca|hb|abg|cbc|cxr|ecg|ekg|bmp|cmp|hgt|cbg|pt|dx|rx|tx|hx|pmh|hpi)$/i;

export function resolvePatientFromRelay(rawText, notes = [], options = {}) {
  const cleanText = stripChatPrefixes(rawText);
  if (!cleanText.trim() || !Array.isArray(notes) || !notes.length) {
    return {
      status: 'unresolved',
      match: null,
      candidates: [],
      reason: 'Paste a message or select a target patient.',
    };
  }

  const getHeaderFn = typeof options.getHeader === 'function' ? options.getHeader : parseChartHeader;
  const activeOnly = Boolean(options.activeOnly);

  // Strip attending physician mentions (e.g. "Dr. A. Santos") so AP surname never falsely matches a patient
  const nameText = cleanText.replace(
    /\b(?:dr|dra)\.?[ \t]+(?:[A-Z]\.?[ \t]+){0,2}[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+(?:[ \t]+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+)?/g,
    ' '
  );

  const candidates = [];

  for (const note of notes) {
    const parsed = getHeaderFn(note.content, note);
    if (activeOnly && !parsed.isCensus) continue;
    const room = String(parsed.room || '').trim();
    let roomMatched = false;

    if (room && !/^unassigned$/i.test(room)) {
      const unitNumMatch = room.match(/^(?:room|rm\.?|bed|ward)?\s*#?\s*(\d+[A-Za-z]?)$/i);
      if (unitNumMatch) {
        const core = unitNumMatch[1];
        const strongRoomRe = new RegExp(
          `(?:\\b(?:room|rm\\.?|bed|ward)\\s*#?\\s*${escapeRe(core)}\\b|#\\s*${escapeRe(core)}\\b)`,
          'i'
        );
        const bareRoomRe = new RegExp(`(?:^|[\\s,(:-])${escapeRe(core)}(?=$|[\\s),.:-])`);
        if (strongRoomRe.test(cleanText)) {
          roomMatched = true;
        } else if (bareRoomRe.test(cleanText)) {
          // Ensure bare number isn't preceded by a lab label like "Plt 412"
          const labPrecededRe = new RegExp(
            `(?:${ALIAS_ALTERNATION})\\s*[:=]?\\s*${escapeRe(core)}\\b`,
            'iu'
          );
          if (!labPrecededRe.test(cleanText)) {
            roomMatched = true;
          }
        }
      } else if (!NON_ROOM_CLINICAL_ABBREV_RE.test(room)) {
        // Special units like ICU-2, CCU 4, NCCU10 (allow optional separators across boundaries)
        const flexibleRoom = escapeRe(room)
          .replace(/[\s_-]+/g, '[\\s_-]*')
          .replace(/([A-Za-z])(\d)/g, '$1[\\s_-]*$2')
          .replace(/(\d)([A-Za-z])/g, '$1[\\s_-]*$2');
        const specialRe = new RegExp(
          `(?<![\\p{L}\\p{N}])${flexibleRoom}(?![\\p{L}\\p{N}])`,
          'iu'
        );
        if (specialRe.test(cleanText)) {
          roomMatched = true;
        }
      }
    }

    const nameCandidates = [
      parsed.name && parsed.name !== 'Unknown Patient' ? parsed.name : '',
      ...(Array.isArray(note.aliases) ? note.aliases : []),
    ].filter(Boolean);

    let nameScore = 0;
    for (const cand of nameCandidates) {
      const tokens = cand
        .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter((t) => t.length >= 2);
      if (!tokens.length) continue;

      if (matchesToken(nameText, cand)) {
        nameScore = Math.max(nameScore, 3);
        continue;
      }
      if (tokens.length >= 2) {
        const firstLast = `${tokens[0]} ${tokens[tokens.length - 1]}`;
        const reversed = `${tokens[tokens.length - 1]}, ${tokens[0]}`;
        if (matchesToken(nameText, firstLast) || matchesToken(nameText, reversed)) {
          nameScore = Math.max(nameScore, 3);
          continue;
        }
        const tokenHits = tokens.filter((t) => t.length >= 3 && matchesToken(nameText, t));
        if (tokenHits.length >= 2) {
          nameScore = Math.max(nameScore, 2);
        } else if (tokenHits.length === 1) {
          nameScore = Math.max(nameScore, 1);
        }
      } else if (tokens[0].length >= 3 && matchesToken(nameText, tokens[0])) {
        nameScore = Math.max(nameScore, 2);
      }
    }

    const nameMatched = nameScore > 0;
    if (roomMatched || nameMatched) {
      candidates.push({ note, parsed, roomMatched, nameMatched, nameScore });
    }
  }

  candidates.sort((a, b) => {
    const scoreA = (a.roomMatched ? 10 : 0) + a.nameScore * 3;
    const scoreB = (b.roomMatched ? 10 : 0) + b.nameScore * 3;
    return scoreB - scoreA;
  });

  const both = candidates.filter((c) => c.roomMatched && c.nameMatched);
  if (both.length === 1) {
    return {
      status: 'matched',
      match: both[0].note,
      candidates,
      reason: `Matched by Room + Name (${both[0].parsed.room} · ${both[0].parsed.name})`,
    };
  }
  if (both.length > 1) {
    // Disambiguate if one has a clear full-name match (score 3) while others only matched a shared token
    const topScore = both[0].nameScore;
    const tiedTop = both.filter((c) => c.nameScore === topScore);
    if (tiedTop.length === 1 && topScore >= 3) {
      return {
        status: 'matched',
        match: tiedTop[0].note,
        candidates,
        reason: `Matched by Room + Name (${tiedTop[0].parsed.room} · ${tiedTop[0].parsed.name})`,
      };
    }
    return {
      status: 'ambiguous-multiple',
      match: null,
      candidates,
      reason: `Multiple charts matched (${both.length}) — select the target patient.`,
    };
  }

  const roomOnly = candidates.filter((c) => c.roomMatched && !c.nameMatched);
  if (roomOnly.length >= 1) {
    return {
      status: 'ambiguous-room-only',
      match: roomOnly.length === 1 ? roomOnly[0].note : null,
      candidates,
      reason: 'Room matched only — confirm patient name before filing (STE §5.2).',
    };
  }

  const nameOnly = candidates.filter((c) => !c.roomMatched && c.nameMatched);
  if (nameOnly.length === 1) {
    return {
      status: 'ambiguous-name-only',
      match: nameOnly[0].note,
      candidates,
      reason: `Name matched (${nameOnly[0].parsed.name}), no room in text — confirm target patient.`,
    };
  }
  if (nameOnly.length > 1) {
    const topScore = nameOnly[0].nameScore;
    const tiedTop = nameOnly.filter((c) => c.nameScore === topScore);
    if (tiedTop.length === 1 && topScore >= 3) {
      return {
        status: 'ambiguous-name-only',
        match: tiedTop[0].note,
        candidates,
        reason: `Name matched (${tiedTop[0].parsed.name}), no room in text — confirm target patient.`,
      };
    }
    return {
      status: 'ambiguous-multiple',
      match: null,
      candidates,
      reason: `Multiple charts matched name (${nameOnly.length}) — select target patient.`,
    };
  }

  return {
    status: 'unresolved',
    match: null,
    candidates: [],
    reason: 'No matching patient found — select target patient manually.',
  };
}

export function buildLabRelayMessage(trended, targetNote, footer = 'Thank you, doctor') {
  const parsed = parseChart(targetNote?.content || '', targetNote || {});
  const ap = parsed.ap ? ` ${parsed.ap}` : '';
  const room = parsed.room && parsed.room !== 'Unassigned' ? ` (${parsed.room})` : '';
  const labsText = trended?.lineByLineText || trended?.inlineText || '';

  const lines = [
    `Good day${ap}`,
    '',
    `Relaying labs for ${parsed.name}${room}`,
    '',
    labsText,
  ];
  if (footer && String(footer).trim()) {
    lines.push('', String(footer).trim());
  }
  return lines.join('\n').trim();
}

const CHART_LAB_PANELS = ['Chemistry', 'CBC', 'ABG', 'Cardiac/Other'];

const LAB_UNITS_BY_KEY = {
  Na: 'mmol/L',
  K: 'mmol/L',
  Cl: 'mmol/L',
  HCO3: 'mmol/L',
  BUN: 'mg/dL',
  Cr: 'mg/dL',
  eGFR: 'mL/min/1.73m²',
  Glu: 'mg/dL',
  iCa: 'mmol/L',
  Ca: 'mg/dL',
  Mg: 'mg/dL',
  Phos: 'mg/dL',
  Alb: 'g/dL',
  AST: 'U/L',
  ALT: 'U/L',
  ALP: 'U/L',
  TBili: 'mg/dL',
  WBC: '×10⁹/L',
  Hb: 'g/L',
  Hct: '',
  Plt: '×10⁹/L',
  Neu: '%',
  Lym: '%',
  Mono: '%',
  Eo: '%',
  pH: '',
  pCO2: 'mmHg',
  pO2: 'mmHg',
  sO2: '%',
  BE: 'mmol/L',
  Lactate: 'mmol/L',
  'Troponin-I': 'ng/L',
  INR: '',
  PT: 'sec',
  aPTT: 'sec',
  CRP: 'mg/L',
  PCT: 'ng/mL',
  TSH: 'mIU/L',
  FT3: 'pmol/L',
  FT4: 'pmol/L',
};

export const LAB_UNIT_SYSTEMS = {
  conventional: { id: 'conventional', label: 'Conventional (US)' },
  si: { id: 'si', label: 'SI (International)' },
};

const SI_CONVERSIONS = {
  Cr: { unit: 'µmol/L', factor: 88.4, decimals: 0, alreadySiMin: 30 },
  BUN: { unit: 'mmol/L', factor: 0.357, decimals: 1 },
  Glu: { unit: 'mmol/L', factor: 0.0555, decimals: 1 },
  Ca: { unit: 'mmol/L', factor: 0.25, decimals: 2 },
  Mg: { unit: 'mmol/L', factor: 0.4114, decimals: 2 },
  Phos: { unit: 'mmol/L', factor: 0.3229, decimals: 2 },
  Alb: { unit: 'g/L', factor: 10, decimals: 0, alreadySiMin: 15 },
  TBili: { unit: 'µmol/L', factor: 17.1, decimals: 0 },
  Hb: { unit: 'g/L', factor: 10, decimals: 0, alreadySiMin: 30 },
  pCO2: { unit: 'kPa', factor: 0.1333, decimals: 1 },
  pO2: { unit: 'kPa', factor: 0.1333, decimals: 1 },
};

function roundDecimal(num, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(num * factor) / factor;
}

export function getLabUnitMeta(key, unitSystem = 'conventional') {
  const sys = unitSystem === 'si' ? 'si' : 'conventional';
  if (sys === 'si' && Object.hasOwn(SI_CONVERSIONS, key)) {
    return SI_CONVERSIONS[key];
  }
  return { unit: LAB_UNITS_BY_KEY[key] ?? '', factor: 1, decimals: null };
}

export function convertLabValue(key, num, unitSystem = 'conventional') {
  if (!Number.isFinite(num)) return null;
  const sys = unitSystem === 'si' ? 'si' : 'conventional';
  if (sys !== 'si' || !Object.hasOwn(SI_CONVERSIONS, key)) {
    return num;
  }
  const conv = SI_CONVERSIONS[key];
  if (Number.isFinite(conv.alreadySiMin) && num >= conv.alreadySiMin) {
    return roundDecimal(num, conv.decimals);
  }
  return roundDecimal(num * conv.factor, conv.decimals);
}

function formatConvertedNum(num, convMeta) {
  if (!Number.isFinite(num)) return '';
  if (convMeta && Number.isInteger(convMeta.decimals)) {
    return num.toFixed(convMeta.decimals);
  }
  return String(num);
}

const PANEL_PREFIX_RE = /^(?:ABG\/VBG|VBG|ABG|CBC|Chemistry|Chem|BMP|CMP|Electrolytes?|Lytes|Renal|LFTs?|Liver|Coags?|Coagulation|Cardiac|Inflammatory|Thyroid|iSTAT|Labs?)(?:\s+(?:w\/?\s*lactate|post[\s-]*HD|pre[\s-]*HD|repeat|\([^)]+\)))?\s*[:=-]\s*/i;

const DIAGNOSTIC_PREFIX_RE = /^(?:CXR(?:\s+[^:=-]{1,40})?|Chest\s*X-?ray(?:\s+[^:=-]{1,40})?|12-?L(?:ead)?\s*ECG|ECG|EKG|2D\s*Echo(?:\s+w\/\s*Doppler)?|T?TE|CT(?:\s+[^:=-]{1,40})?|MRI(?:\s+[^:=-]{1,40})?|UTZ|Ultrasound(?:\s+[^:=-]{1,40})?|KUB|Abdominal\s*X-?ray|Blood\s*C\/?S(?:\s*x\s*\d+)?|Urine\s*C\/?S|Sputum\s*C\/?S|Wound\s*C\/?S|Endotracheal\s*Aspirate|ETA\s*C\/?S|C\/?S|GS\/?CS|Culture(?:\s+[^:=-]{1,30})?|FOBT|Urinalysis|UA|Stool\s*Exam|RPR|HBsAg|Anti-?HCV|HIV|COVID(?:-19)?|Swab|Biopsy)\b/i;

function parseLabDateMs(dateStr) {
  const m = String(dateStr || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const dt = new Date(year, month - 1, day);
  if (Number.isNaN(dt.getTime()) || dt.getMonth() !== month - 1 || dt.getDate() !== day) {
    return null;
  }
  return dt.getTime();
}

function parseLabShiftRank(shiftStr, fallbackIdx = 0) {
  const s = String(shiftStr || '').trim().toLowerCase();
  if (!s || s === 'entry') return -1;
  if (s === 'am' || s === 'morning') return 600;
  if (s === 'pm' || s === 'afternoon') return 1400;
  if (s === 'nod' || s === 'night') return 2200;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (m) {
    let h = Number(m[1]);
    const min = m[2] ? Number(m[2]) : 0;
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h < 6 && !ap) h += 24;
    return h * 100 + min;
  }
  return 1200 + fallbackIdx;
}

function formatLabShortDate(dateStr) {
  const m = String(dateStr || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[1]}/${m[2]}`;
  return String(dateStr || 'Undated').trim();
}

function formatRefRange(spec, unitSystem = 'conventional') {
  if (!spec) return '';
  const conv = unitSystem === 'si' && Object.hasOwn(SI_CONVERSIONS, spec.key) ? SI_CONVERSIONS[spec.key] : null;
  const fmtBound = (val) => {
    if (!conv) return val;
    const converted = roundDecimal(val * conv.factor, conv.decimals);
    return conv.decimals === 0 ? Math.round(converted) : converted;
  };
  const hasLow = Number.isFinite(spec.low);
  const hasHigh = Number.isFinite(spec.high);
  if (hasLow && hasHigh) return `${fmtBound(spec.low)}-${fmtBound(spec.high)}`;
  if (hasLow) return `>=${fmtBound(spec.low)}`;
  if (hasHigh) return `<=${fmtBound(spec.high)}`;
  return '';
}

function formatDeltaText(delta) {
  if (!Number.isFinite(delta) || delta === 0) return '';
  const abs = Math.abs(delta);
  const rounded = abs >= 10 ? Math.round(delta * 10) / 10 : Math.round(delta * 1000) / 1000;
  if (rounded === 0) return '';
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function parseShiftLabEntries(labLines) {
  const entries = Array.isArray(labLines)
    ? labLines
    : labLines != null && String(labLines).trim()
      ? [String(labLines)]
      : [];
  const numericByKey = new Map();
  const diagnostics = [];
  let lastDiag = null;

  for (const rawEntry of entries) {
    const subLines = String(rawEntry || '')
      .replace(/\r\n/g, '\n')
      .split('\n');

    for (const rawLine of subLines) {
      const parts = rawLine.split('|');
      for (const rawPart of parts) {
        const part = rawPart.trim();
        if (!part) continue;

        const hasPanelPrefix = PANEL_PREFIX_RE.test(part);
        const cleanedForLabs = part.replace(PANEL_PREFIX_RE, '').trim();

        if (
          !cleanedForLabs ||
          /^FIO2\b(?:\s*[:=]|\s+\d)/i.test(part) ||
          /^FIO2\b(?:\s*[:=]|\s+\d)/i.test(cleanedForLabs)
        ) {
          lastDiag = null;
          continue;
        }

        const diagAfterPanel = hasPanelPrefix && DIAGNOSTIC_PREFIX_RE.test(cleanedForLabs);
        const isDiagPrefix = DIAGNOSTIC_PREFIX_RE.test(part) || diagAfterPanel;
        const sourceForDiag = diagAfterPanel ? cleanedForLabs : part;
        const parsedLabs = !isDiagPrefix ? parseRawLabs(cleanedForLabs) : [];

        if (parsedLabs.length > 0) {
          lastDiag = null;
          for (const item of parsedLabs) {
            numericByKey.set(item.key, item);
          }
          continue;
        }

        if (isDiagPrefix) {
          const diagHeaderMatch = sourceForDiag.match(
            /^([A-Za-z0-9][A-Za-z0-9\s/().+-]{1,42}?)\s*(?:[:=]\s*|\s+[–—-]\s+)(.+)$/
          );
          const title = diagHeaderMatch ? diagHeaderMatch[1].trim() : sourceForDiag;
          const body = diagHeaderMatch ? diagHeaderMatch[2].trim() : '';
          const diag = { title, text: body || sourceForDiag };
          diagnostics.push(diag);
          lastDiag = diag;
          continue;
        }

        const colonHeaderMatch = sourceForDiag.match(
          /^([A-Za-z0-9][A-Za-z0-9\s/().+-]{1,42}?)\s*[:=]\s*(.+)$/
        );
        if (colonHeaderMatch) {
          const title = colonHeaderMatch[1].trim();
          const body = colonHeaderMatch[2].trim();
          if (body && !/^\(?prev/i.test(title)) {
            const diag = { title, text: body };
            diagnostics.push(diag);
            lastDiag = diag;
          }
          continue;
        }

        // Continuation line after an imaging/diagnostic header (e.g. CXR line 2 or Non-specific ST-T changes)
        if (lastDiag && !/^[-–•\s]*$/.test(part)) {
          const cleanedCont = part.replace(/^[-–•]\s*/, '').trim();
          if (cleanedCont) {
            lastDiag.text = lastDiag.text && lastDiag.text !== lastDiag.title
              ? `${lastDiag.text}; ${cleanedCont}`
              : cleanedCont;
          }
        }
      }
    }
  }

  return {
    items: [...numericByKey.values()],
    diagnostics,
  };
}

function csvCell(val) {
  const s = String(val ?? '');
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Extract structured panel-grouped lab results, chronological trend matrix,
 * and imaging/diagnostics list from a patient chart markdown document.
 */
export function extractChartLabSummary(content, note = {}, options = {}) {
  const unitSystem = options?.unitSystem === 'si' ? 'si' : 'conventional';
  const parsed = parseChart(content || '', note || {});
  const timeline = parseChartTimeline(content || '');

  const rawEntries = [];
  let seq = 0;
  for (let dIdx = 0; dIdx < timeline.length; dIdx++) {
    const day = timeline[dIdx];
    const dateMs = parseLabDateMs(day.date);
    for (let sIdx = 0; sIdx < (day.shifts || []).length; sIdx++) {
      const shift = day.shifts[sIdx];
      if (!shift?.labs || !shift.labs.length) continue;
      const parsedEntry = parseShiftLabEntries(shift.labs);
      if (!parsedEntry.items.length && !parsedEntry.diagnostics.length) continue;

      const shiftLabel = shift.shift && shift.shift !== 'Entry' ? shift.shift : '';
      const fullLabel = shiftLabel ? `${day.date} ${shiftLabel}` : day.date;
      const shortLabel = shiftLabel ? `${formatLabShortDate(day.date)} ${shiftLabel}` : formatLabShortDate(day.date);

      rawEntries.push({
        seq: seq++,
        date: day.date,
        shift: shift.shift || 'Entry',
        fullLabel,
        shortLabel,
        dateMs,
        dIdx,
        shiftRank: parseLabShiftRank(shift.shift, sIdx),
        items: parsedEntry.items,
        diagnostics: parsedEntry.diagnostics,
      });
    }
  }

  // Sort oldest -> newest so chronological deltas flow forward accurately
  const hasAnyDated = rawEntries.some((e) => e.dateMs !== null);
  rawEntries.sort((a, b) => {
    if (hasAnyDated) {
      if (a.dateMs !== null && b.dateMs !== null && a.dateMs !== b.dateMs) {
        return a.dateMs - b.dateMs;
      }
      if (a.dateMs !== b.dateMs) {
        return a.dateMs === null ? -1 : 1;
      }
    }
    if (a.dIdx !== b.dIdx) return a.dIdx - b.dIdx;
    if (a.shiftRank !== b.shiftRank) return a.shiftRank - b.shiftRank;
    return a.seq - b.seq;
  });

  const numericColumnsChrono = [];
  const rowMap = new Map();
  const diagnosticsChrono = [];

  for (const entry of rawEntries) {
    const colKey = `${entry.date}__${entry.shift}__${entry.seq}`;

    if (entry.items.length) {
      numericColumnsChrono.push({
        key: colKey,
        date: entry.date,
        shift: entry.shift,
        label: entry.fullLabel,
        shortLabel: entry.shortLabel,
      });

      for (const item of entry.items) {
        const spec = SPEC_BY_KEY.get(item.key);
        const convMeta = unitSystem === 'si' && Object.hasOwn(SI_CONVERSIONS, item.key) ? SI_CONVERSIONS[item.key] : null;
        let row = rowMap.get(item.key);
        if (!row) {
          row = {
            key: item.key,
            panel: item.panel || spec?.panel || 'Cardiac/Other',
            unit: convMeta ? convMeta.unit : (LAB_UNITS_BY_KEY[item.key] ?? ''),
            refRange: formatRefRange(spec, unitSystem),
            valuesByCol: {},
            latest: null,
            prevNum: null,
          };
          rowMap.set(item.key, row);
        }

        const flag = computeLabFlag(item.key, item.num, item.explicitFlag || '');
        const displayNum = convMeta ? convertLabValue(item.key, item.num, 'si') : item.num;
        const displayValue = convMeta && Number.isFinite(displayNum)
          ? formatConvertedNum(displayNum, convMeta)
          : item.value;
        const delta = row.prevNum !== null && Number.isFinite(displayNum)
          ? displayNum - row.prevNum
          : null;
        const cell = {
          colKey,
          date: entry.date,
          shift: entry.shift,
          label: entry.fullLabel,
          value: displayValue,
          num: displayNum,
          flag,
          delta,
          deltaText: formatDeltaText(delta),
        };
        row.valuesByCol[colKey] = cell;
        row.latest = cell;
        if (Number.isFinite(displayNum)) {
          row.prevNum = displayNum;
        }
      }
    }

    for (let i = 0; i < entry.diagnostics.length; i++) {
      const diag = entry.diagnostics[i];
      diagnosticsChrono.push({
        id: `${colKey}__diag_${i}`,
        date: entry.date,
        shift: entry.shift,
        label: entry.fullLabel,
        title: diag.title,
        text: diag.text,
      });
    }
  }

  // Present newest-first columns and diagnostics for clinician readability
  const columns = [...numericColumnsChrono].reverse();
  const diagnostics = [...diagnosticsChrono].reverse();
  const rows = [...rowMap.values()]
    .map(({ prevNum: _prevNum, ...rest }) => rest)
    .sort((a, b) => (SPEC_ORDER.get(a.key) ?? 999) - (SPEC_ORDER.get(b.key) ?? 999));

  const latestByPanel = {};
  const byPanelCounts = {};
  const panels = [];
  for (const panel of CHART_LAB_PANELS) {
    const panelRows = rows.filter((r) => r.panel === panel);
    if (panelRows.length) {
      panels.push(panel);
      latestByPanel[panel] = panelRows;
      byPanelCounts[panel] = panelRows.length;
    }
  }

  const abnormalRows = rows.filter((r) => Boolean(r.latest?.flag)).length;

  return {
    patient: {
      name: parsed.name || 'Unknown Patient',
      room: parsed.room || 'Unassigned',
      age: parsed.age || '',
      sex: parsed.sex || '',
      weight: parsed.weight || '',
      service: parsed.service || '',
      ap: parsed.ap || '',
    },
    hasLabs: rows.length > 0 || diagnostics.length > 0,
    hasNumericLabs: rows.length > 0,
    hasDiagnostics: diagnostics.length > 0,
    panels,
    counts: {
      totalRows: rows.length,
      abnormalRows,
      byPanel: byPanelCounts,
      diagnostics: diagnostics.length,
      columns: columns.length,
    },
    columns,
    rows,
    latestByPanel,
    diagnostics,
    unitSystem,
  };
}

export function buildFishboneData(summary) {
  const byKey = new Map((summary?.rows || []).map((r) => [r.key, r]));
  const slotOf = (key, label = key) => {
    const row = byKey.get(key);
    if (!row || !row.latest) return null;
    return {
      key,
      label,
      value: String(row.latest.value ?? ''),
      flag: row.latest.flag || '',
      unit: row.unit || '',
      when: row.latest.shortLabel || row.latest.label || '',
    };
  };

  const cbcSlots = {
    wbc: slotOf('WBC', 'WBC'),
    hb: slotOf('Hb', 'Hb'),
    hct: slotOf('Hct', 'Hct'),
    plt: slotOf('Plt', 'Plt'),
  };
  const cbcCount = Object.values(cbcSlots).filter(Boolean).length;

  const bmpSlots = {
    na: slotOf('Na', 'Na'),
    k: slotOf('K', 'K'),
    cl: slotOf('Cl', 'Cl'),
    hco3: slotOf('HCO3', 'CO2'),
    bun: slotOf('BUN', 'BUN'),
    cr: slotOf('Cr', 'Cr'),
    glu: slotOf('Glu', 'Glu'),
  };
  const bmpCount = Object.values(bmpSlots).filter(Boolean).length;

  return {
    unitSystem: summary?.unitSystem === 'si' ? 'si' : 'conventional',
    cbc: {
      present: cbcCount >= 2,
      count: cbcCount,
      slots: cbcSlots,
    },
    bmp: {
      present: bmpCount >= 3,
      count: bmpCount,
      slots: bmpSlots,
    },
  };
}

export function filterLabSummary(summary, panelFilter = 'all') {
  const filter = String(panelFilter || 'all');
  const allRows = summary?.rows || [];
  const allColumns = summary?.columns || [];
  const allDiagnostics = summary?.diagnostics || [];

  let rows = [];
  let diagnostics = [];

  if (filter === 'all') {
    rows = allRows;
    diagnostics = allDiagnostics;
  } else if (filter === 'abnormal') {
    rows = allRows.filter((r) => Boolean(r.latest?.flag));
    diagnostics = [];
  } else if (filter === 'diagnostics') {
    rows = [];
    diagnostics = allDiagnostics;
  } else {
    rows = allRows.filter((r) => r.panel === filter);
    diagnostics = [];
  }

  // Keep only columns that have at least one value in the filtered rows
  const columns = rows.length
    ? allColumns.filter((col) => rows.some((row) => Boolean(row.valuesByCol?.[col.key])))
    : [];

  const latestByPanel = {};
  const panels = [];
  for (const panel of CHART_LAB_PANELS) {
    const panelRows = rows.filter((r) => r.panel === panel);
    if (panelRows.length) {
      panels.push(panel);
      latestByPanel[panel] = panelRows;
    }
  }

  return {
    rows,
    columns,
    panels,
    latestByPanel,
    diagnostics,
    unitSystem: summary?.unitSystem === 'si' ? 'si' : 'conventional',
  };
}

function formatPatientHeaderParts(patient = {}) {
  const title = patient.room && patient.room !== 'Unassigned'
    ? `${patient.room} - ${patient.name || 'Patient'}`
    : (patient.name || 'Patient');
  const metaParts = [];
  if (patient.age || patient.sex) {
    metaParts.push([patient.age ? `${patient.age}yo` : '', patient.sex || ''].filter(Boolean).join(' '));
  }
  if (patient.service) metaParts.push(patient.service);
  if (patient.ap) metaParts.push(`AP: ${patient.ap}`);
  return { title, meta: metaParts.join(' | ') };
}

export function formatChartLabSummaryText(summary, { panelFilter = 'all' } = {}) {
  if (!summary || !summary.hasLabs) {
    const { title } = formatPatientHeaderParts(summary?.patient);
    return `LAB SUMMARY: ${title}\n\nNo laboratory or diagnostic results recorded.`;
  }

  const filtered = filterLabSummary(summary, panelFilter);
  const { title, meta } = formatPatientHeaderParts(summary.patient);
  const lines = [`LAB SUMMARY: ${title}`];
  if (meta) lines.push(meta);

  if (!filtered.rows.length && !filtered.diagnostics.length) {
    lines.push('', 'No matching laboratory or diagnostic results for current filter.');
    return lines.join('\n');
  }

  for (const panel of filtered.panels) {
    lines.push('', `${panel.toUpperCase()}:`);
    for (const row of filtered.latestByPanel[panel]) {
      const latest = row.latest;
      if (!latest) continue;
      const unit = row.unit ? ` ${row.unit}` : '';
      const flag = latest.flag ? ` [${latest.flag}]` : '';
      const delta = latest.deltaText ? ` (${latest.deltaText})` : '';
      const when = latest.label ? ` - ${latest.label}` : '';
      lines.push(`- ${row.key}: ${latest.value}${unit}${flag}${delta}${when}`);
    }
  }

  if (filtered.diagnostics.length) {
    lines.push('', 'IMAGING & DIAGNOSTICS:');
    for (const diag of filtered.diagnostics) {
      const when = diag.label ? `[${diag.label}] ` : '';
      const text = diag.text && diag.text !== diag.title
        ? `${diag.title}: ${diag.text}`
        : diag.title;
      lines.push(`- ${when}${text}`);
    }
  }

  return lines.join('\n').trim();
}

export function formatChartLabSummaryMarkdown(summary, { panelFilter = 'all' } = {}) {
  const { title, meta } = formatPatientHeaderParts(summary?.patient);
  const lines = [`# Lab Summary — ${title}`];
  if (meta) lines.push('', meta);

  if (!summary || !summary.hasLabs) {
    lines.push('', '_No laboratory or diagnostic results recorded._');
    return lines.join('\n');
  }

  const filtered = filterLabSummary(summary, panelFilter);
  if (!filtered.rows.length && !filtered.diagnostics.length) {
    lines.push('', '_No matching laboratory or diagnostic results for current filter._');
    return lines.join('\n');
  }

  if (filtered.rows.length) {
    lines.push('', '## Latest Results');
    for (const panel of filtered.panels) {
      const items = filtered.latestByPanel[panel].map((row) => {
        const latest = row.latest;
        const unit = row.unit ? ` ${row.unit}` : '';
        const flag = latest.flag ? ` **[${latest.flag}]**` : '';
        const delta = latest.deltaText ? ` (${latest.deltaText})` : '';
        return `${row.key}: ${latest.value}${unit}${flag}${delta}`;
      });
      lines.push(`- **${panel}**: ${items.join(' | ')}`);
    }

    lines.push('', '## Lab Flowsheet');
    const headerCells = ['Panel', 'Lab', 'Unit', 'Ref', ...filtered.columns.map((c) => c.shortLabel || c.label)];
    const escMd = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    lines.push(`| ${headerCells.map(escMd).join(' | ')} |`);
    lines.push(`| ${headerCells.map(() => '---').join(' | ')} |`);

    for (const row of filtered.rows) {
      const vals = filtered.columns.map((col) => {
        const cell = row.valuesByCol[col.key];
        if (!cell) return '—';
        const flag = cell.flag ? ` [${cell.flag}]` : '';
        return `${cell.value}${flag}`;
      });
      const mdRow = [row.panel, row.key, row.unit || '', row.refRange || '', ...vals];
      lines.push(`| ${mdRow.map(escMd).join(' | ')} |`);
    }
  }

  if (filtered.diagnostics.length) {
    lines.push('', '## Imaging, ECG & Diagnostics');
    for (const diag of filtered.diagnostics) {
      const text = diag.text && diag.text !== diag.title
        ? `**${diag.title}**: ${diag.text}`
        : `**${diag.title}**`;
      lines.push(`- (${diag.label}) ${text}`);
    }
  }

  return lines.join('\n').trim();
}

export function formatChartLabSummaryCsv(summary, { panelFilter = 'all' } = {}) {
  const filtered = filterLabSummary(summary || {}, panelFilter);
  const headers = [
    'Panel',
    'Lab',
    'Unit',
    'RefRange',
    'Latest',
    'LatestFlag',
    'Delta',
    ...filtered.columns.map((c) => c.label),
  ];
  const lines = [headers.map(csvCell).join(',')];

  for (const row of filtered.rows) {
    const latest = row.latest;
    const cols = filtered.columns.map((col) => {
      const cell = row.valuesByCol[col.key];
      if (!cell) return '';
      return cell.flag ? `${cell.value} [${cell.flag}]` : cell.value;
    });
    lines.push(
      [
        row.panel,
        row.key,
        row.unit || '',
        row.refRange || '',
        latest ? latest.value : '',
        latest ? latest.flag : '',
        latest ? latest.deltaText : '',
        ...cols,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  for (const diag of filtered.diagnostics) {
    const emptyTrend = filtered.columns.map(() => '');
    lines.push(
      [
        'Diagnostics',
        diag.title,
        diag.label,
        '',
        diag.text,
        '',
        '',
        ...emptyTrend,
      ]
        .map(csvCell)
        .join(',')
    );
  }

  return lines.join('\n');
}
