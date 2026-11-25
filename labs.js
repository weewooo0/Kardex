// Pure on-device Lab Trending & Chat Relay Parser ("Dump-to-Chart")
// Follows CLINICAL-WORKFLOW-STE.md §5 (File relay messages) and §7 (Lab results)

import { parseChart } from './census.js';

export const LAB_SPECS = [
  // Chemistry
  { key: 'Na', panel: 'Chemistry', aliases: ['na+', 'na', 'sodium'], low: 135, high: 145 },
  { key: 'K', panel: 'Chemistry', aliases: ['k+', 'k', 'potassium'], low: 3.5, high: 5.0 },
  { key: 'Cl', panel: 'Chemistry', aliases: ['cl-', 'cl', 'chloride'], low: 98, high: 107 },
  { key: 'HCO3', panel: 'Chemistry', aliases: ['hco3-', 'hco3', 'bicarbonate', 'bicarb'], low: 22, high: 26 },
  { key: 'BUN', panel: 'Chemistry', aliases: ['bun', 'urea'], low: 7, high: 20 },
  { key: 'Cr', panel: 'Chemistry', aliases: ['serum creatinine', 'creatinine', 'crea', 'scr', 'cr'], low: 0.6, high: 1.2 },
  { key: 'eGFR', panel: 'Chemistry', aliases: ['egfr', 'gfr'], low: 60 },
  { key: 'Glu', panel: 'Chemistry', aliases: ['glucose', 'glu', 'fbs', 'rbs', 'cbg', 'hgt'], low: 70, high: 140 },
  { key: 'Ca', panel: 'Chemistry', aliases: ['ca2+', 'calcium', 'ca'], low: 8.5, high: 10.5 },
  { key: 'Mg', panel: 'Chemistry', aliases: ['mg2+', 'magnesium', 'mg'], low: 1.7, high: 2.2 },
  { key: 'Phos', panel: 'Chemistry', aliases: ['phosphorus', 'phosphate', 'phos', 'po4'], low: 2.5, high: 4.5 },
  { key: 'Alb', panel: 'Chemistry', aliases: ['albumin', 'alb'], low: 3.5, high: 5.0 },
  { key: 'AST', panel: 'Chemistry', aliases: ['ast', 'sgot'], high: 40 },
  { key: 'ALT', panel: 'Chemistry', aliases: ['alt', 'sgpt'], high: 41 },
  { key: 'TBili', panel: 'Chemistry', aliases: ['total bilirubin', 't. bili', 'tbili', 'tbil', 'bilirubin'], high: 1.2 },

  // CBC
  { key: 'WBC', panel: 'CBC', aliases: ['wbc', 'leukocytes'], low: 4.5, high: 11.0 },
  { key: 'Hb', panel: 'CBC', aliases: ['hemoglobin', 'hgb', 'hb'], low: 12.0, high: 17.0 },
  { key: 'Hct', panel: 'CBC', aliases: ['hematocrit', 'hct'], low: 36, high: 50, ratioLow: 0.36, ratioHigh: 0.50 },
  { key: 'Plt', panel: 'CBC', aliases: ['platelets', 'platelet', 'plt'], low: 150, high: 450 },
  { key: 'Neu', panel: 'CBC', aliases: ['neutrophils', 'neut', 'neu', 'segs', 'seg', 'pmn'], low: 40, high: 75 },
  { key: 'Lym', panel: 'CBC', aliases: ['lymphocytes', 'lymphs', 'lymph', 'lym'], low: 20, high: 45 },

  // ABG
  { key: 'pH', panel: 'ABG', aliases: ['ph'], low: 7.35, high: 7.45 },
  { key: 'pCO2', panel: 'ABG', aliases: ['paco2', 'pco2'], low: 35, high: 45 },
  { key: 'pO2', panel: 'ABG', aliases: ['pao2', 'po2'], low: 80, high: 100 },
  { key: 'BE', panel: 'ABG', aliases: ['base excess', 'be'], low: -2, high: 2 },
  { key: 'Lactate', panel: 'ABG', aliases: ['lactate', 'lac'], high: 2.0 },

  // Cardiac / Coags / Inflammatory
  { key: 'Troponin-I', panel: 'Cardiac/Other', aliases: ['troponin-i', 'troponin i', 'trop-i', 'trop i', 'troponin'], high: 0.04 },
  { key: 'INR', panel: 'Cardiac/Other', aliases: ['inr'], low: 0.8, high: 1.2 },
  { key: 'PT', panel: 'Cardiac/Other', aliases: ['protime', 'pt'], low: 11, high: 14 },
  { key: 'aPTT', panel: 'Cardiac/Other', aliases: ['aptt', 'ptt'], low: 25, high: 35 },
  { key: 'CRP', panel: 'Cardiac/Other', aliases: ['crp'], high: 5.0 },
  { key: 'PCT', panel: 'Cardiac/Other', aliases: ['procalcitonin', 'pct'], high: 0.5 },
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
    `(?:\\s*([HL])(?![\\p{L}\\p{N}]))?` +
    `(?:\\s*\\(\\s*(-?\\d+(?:\\.\\d+)?)\\s*(?:[HL])?\\s*\\))?`,
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
  if (/^(?:BP|HR|PR|RR|Temp|O2sat|SpO2|I-|O-|Fb)\b/i.test(trimmed)) {
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

export function resolvePatientFromRelay(rawText, notes = []) {
  const cleanText = stripChatPrefixes(rawText);
  if (!cleanText.trim() || !Array.isArray(notes) || !notes.length) {
    return {
      status: 'unresolved',
      match: null,
      candidates: [],
      reason: 'Paste a message or select a target patient.',
    };
  }

  // Strip attending physician mentions (e.g. "Dr. A. Santos") so AP surname never falsely matches a patient
  const nameText = cleanText.replace(
    /\b(?:dr|dra)\.?[ \t]+(?:[A-Z]\.?[ \t]+){0,2}[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+(?:[ \t]+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'-]+)?/g,
    ' '
  );

  const candidates = [];

  for (const note of notes) {
    const parsed = parseChart(note.content, note);
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
      } else {
        // Special units like ICU-2, CCU 4, ER-1
        const specialRe = new RegExp(
          `(?<![\\p{L}\\p{N}])${escapeRe(room).replace(/[\s_-]+/g, '[\\s_-]*')}(?![\\p{L}\\p{N}])`,
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
