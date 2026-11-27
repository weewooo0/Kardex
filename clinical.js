// On-device deterministic clinical calculators & guideline pre-pass audits
// Strictly follows CLINICAL-WORKFLOW-STE.md §8 and §11. Pure local computation — zero network calls.

import { parseChart, getTodayDateStrings, extractClinicalMetricsFromBlock } from './census.js';
import { parseRawLabs } from './labs.js';

export const DRIP_PRESETS = [
  {
    id: 'norepi_std',
    label: 'Norepinephrine 4mg / 250mL (16 mcg/mL)',
    drugName: 'Norepinephrine',
    totalDrugAmount: 4,
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 5,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
  {
    id: 'norepi_2x',
    label: 'Norepinephrine 8mg / 250mL (Double Conc, 32 mcg/mL)',
    drugName: 'Norepinephrine',
    totalDrugAmount: 8,
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 5,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
  {
    id: 'norepi_4x',
    label: 'Norepinephrine 16mg / 250mL (Quad Conc, 64 mcg/mL)',
    drugName: 'Norepinephrine',
    totalDrugAmount: 16,
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 2,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
  {
    id: 'dopamine',
    label: 'Dopamine 200mg / 250mL (800 mcg/mL)',
    drugName: 'Dopamine',
    totalDrugAmount: 200,
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 10,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
  {
    id: 'dobutamine',
    label: 'Dobutamine 250mg / 250mL (1000 mcg/mL)',
    drugName: 'Dobutamine',
    totalDrugAmount: 250,
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 10,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
  {
    id: 'epi',
    label: 'Epinephrine 4mg / 250mL (16 mcg/mL)',
    drugName: 'Epinephrine',
    totalDrugAmount: 4,
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 5,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
  {
    id: 'nicardipine',
    label: 'Nicardipine 20mg / 200mL (0.1 mg/mL)',
    drugName: 'Nicardipine',
    totalDrugAmount: 20,
    drugUnit: 'mg',
    bagVolumeMl: 200,
    defaultRateMlHr: 50,
    weightBased: false,
    defaultTargetUnit: 'mg/hr',
  },
  {
    id: 'fentanyl',
    label: 'Fentanyl 500mcg / 50mL (10 mcg/mL)',
    drugName: 'Fentanyl',
    totalDrugAmount: 500,
    drugUnit: 'mcg',
    bagVolumeMl: 50,
    defaultRateMlHr: 5,
    weightBased: false,
    defaultTargetUnit: 'mcg/hr',
  },
  {
    id: 'midazolam',
    label: 'Midazolam 50mg / 50mL (1 mg/mL)',
    drugName: 'Midazolam',
    totalDrugAmount: 50,
    drugUnit: 'mg',
    bagVolumeMl: 50,
    defaultRateMlHr: 2,
    weightBased: false,
    defaultTargetUnit: 'mg/hr',
  },
  {
    id: 'insulin',
    label: 'Regular Insulin 50u / 50mL (1 unit/mL)',
    drugName: 'Regular Insulin',
    totalDrugAmount: 50,
    drugUnit: 'units',
    bagVolumeMl: 50,
    defaultRateMlHr: 3,
    weightBased: false,
    defaultTargetUnit: 'units/hr',
  },
  {
    id: 'heparin',
    label: 'Heparin 25,000u / 250mL (100 units/mL)',
    drugName: 'Heparin',
    totalDrugAmount: 25000,
    drugUnit: 'units',
    bagVolumeMl: 250,
    defaultRateMlHr: 12,
    weightBased: false,
    defaultTargetUnit: 'units/hr',
  },
  {
    id: 'custom',
    label: 'Custom Infusion...',
    drugName: '',
    totalDrugAmount: '',
    drugUnit: 'mg',
    bagVolumeMl: 250,
    defaultRateMlHr: 10,
    weightBased: true,
    defaultTargetUnit: 'mcg/kg/min',
  },
];

function roundTo(val, decimals = 1) {
  const factor = 10 ** decimals;
  const rounded = Math.round(val * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseDateToUtcMs(str) {
  const clean = String(str || '').trim();
  if (!clean) return null;
  let m = clean.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + parseInt(m[3], 10) : parseInt(m[3], 10);
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return Date.UTC(year, month - 1, day);
    }
  }
  m = clean.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10);
    const day = parseInt(m[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return Date.UTC(year, month - 1, day);
    }
  }
  return null;
}

function daysBetweenDates(dateStr, refDateStr) {
  const targetMs = parseDateToUtcMs(dateStr);
  const refMs = parseDateToUtcMs(refDateStr);
  if (targetMs === null || refMs === null) return null;
  const diff = Math.round((refMs - targetMs) / 86400000);
  return diff < 0 ? 0 : diff;
}

function splitChartDateSections(content) {
  const body = String(content || '')
    .replace(/\r\n/g, '\n')
    .replace(/^---\s*\n[\s\S]*?\n---\s*/, '');
  const matches = [...body.matchAll(/^##\s+([^\n]+)$/gm)];
  if (!matches.length) {
    return body.trim() ? [{ date: '', text: body }] : [];
  }
  const sections = [];
  const pre = body.slice(0, matches[0].index).trim();
  if (pre) sections.push({ date: '', text: pre });
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : body.length;
    sections.push({
      date: matches[i][1].trim().replace(/\//g, '-'),
      text: body.slice(start, end),
    });
  }
  return sections;
}

function splitShiftChunks(sectionText) {
  const matches = [...String(sectionText || '').matchAll(/^###\s*([^\n]+)$/gm)];
  if (!matches.length) {
    return String(sectionText || '').trim() ? [sectionText] : [];
  }
  const out = [];
  const pre = sectionText.slice(0, matches[0].index).trim();
  if (pre) out.push(pre);
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : sectionText.length;
    out.push(sectionText.slice(start, end));
  }
  return out;
}

function normalizeSex(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (s === 'M' || s === 'MALE') return 'M';
  if (s === 'F' || s === 'FEMALE') return 'F';
  return '';
}

function parsePositiveNumber(raw, min = 0.0001, max = Infinity) {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

function isNonLabLineForClinical(trimmed) {
  return (
    /^(?:[-*]\s*)?(?:Vitals|VS|BP|HR|PR|RR|Temp|O2|O2sat|SpO2|Vent|Ventilator|Shift\s+I&O|I&O|I-|O-|HGTs?|CBGs?|PE|HEENT|C\/L|CVS|ABD|EXT)\b/i.test(
      trimmed
    ) ||
    /^(?:[-*]\s*)?\d{1,2}\s*-\s*\d{1,2}\s*(?:am|pm)\s*:?$/i.test(trimmed)
  );
}

const WT_RE =
  /(?:^|[\s|;,])(?:Actual\s+|Current\s+|Dosing\s+)?(?:Weight|Wt|ABW|BW)\s*(?:[:=]|is)\s*(\d+(?:\.\d+)?)\s*(kg|kgs|lbs?)?\b/i;
const CR_RE =
  /\b(Creatinine|Creat|Crea|SCr|Cr|CR)\b\s*(?:[:=]|\s+is\s+|\s+)\s*(\d+(?:\.\d+)?)\s*(H|L)?\s*(µmol\/?L|umol\/?L|mmol\/?L|mg\/dL|mg%|mg)?/gi;
const K_RE =
  /\b(Potassium|K)\b(?!\s*(?:Cl|mEq|tabs?|mg|IV|PO|PNGT))\s*(?:[:=]|\s+)\s*(\d+(?:\.\d+)?)(?:\s*(H|L))?\b/gi;
const PLT_RE = /\b(Platelets?|Plt)\b\s*(?:[:=]|\s+)\s*(\d+(?:\.\d+)?)\b/gi;
const EGFR_RE = /\beGFR\b\s*(?:[:=]|\s+is\s+|\s+)\s*(\d+(?:\.\d+)?)\b/i;
const CRCL_RE = /\bCrCl\b\s*(?:[:=]|\s+is\s+|\s+)\s*(\d+(?:\.\d+)?)\b/i;

const LAB_KEY_TO_FIELD = {
  Na: 'na', K: 'k', Cl: 'cl', HCO3: 'hco3', BUN: 'bun', Cr: 'cr',
  Glu: 'glu', Ca: 'ca', Alb: 'alb', TBili: 'tbili', INR: 'inr',
  pH: 'ph', pCO2: 'pco2', pO2: 'po2', Lactate: 'lactate',
};
const LAB_FIELD_COUNT = Object.keys(LAB_KEY_TO_FIELD).length;

const CLINICAL_BASE_CACHE_MAX = 16;
const clinicalBaseCache = new Map();

function extractClinicalBase(text, note, todayStr, maxCrAgeDays, maxWeightAgeDays, unitSystem) {
  const noteName = note?.name ? String(note.name) : '';
  const noteRoom = note?.room ? String(note.room) : '';
  const noteTitle = note?.sourceFileName || note?.title ? String(note.sourceFileName || note.title) : '';
  const noteAliases = Array.isArray(note?.aliases)
    ? note.aliases.map((s) => String(s || '').trim()).filter(Boolean).join('\u0002')
    : '';
  const cacheKey = `${todayStr}\u0001${maxCrAgeDays}\u0001${maxWeightAgeDays}\u0001${unitSystem}\u0001${noteName}\u0001${noteRoom}\u0001${noteTitle}\u0001${noteAliases}\u0000${text}`;

  const cached = clinicalBaseCache.get(cacheKey);
  if (cached) return cached;

  const parsed = parseChart(text, note);
  const age = parsePositiveNumber(parsed.age, 1, 120);
  const sex = normalizeSex(parsed.sex);

  // 1. Weight extraction: YAML frontmatter first, then dated chart blocks newest-to-oldest
  let weight = null;
  const fmWeightRaw = parsed.weight || '';
  if (String(fmWeightRaw).trim()) {
    const wtStr = String(fmWeightRaw).trim();
    const lbMatch = wtStr.match(/^(\d+(?:\.\d+)?)\s*lbs?$/i);
    if (lbMatch) {
      weight = {
        valueKg: null,
        invalidUnit: true,
        raw: wtStr,
        source: 'frontmatter',
        date: '',
        ageDays: 0,
        stale: false,
      };
    } else {
      const kgMatch = wtStr.match(/^(\d+(?:\.\d+)?)\s*(?:kg|kgs)?$/i);
      const val = kgMatch ? parsePositiveNumber(kgMatch[1], 1, 400) : null;
      if (val !== null) {
        weight = {
          valueKg: val,
          invalidUnit: false,
          raw: wtStr,
          source: 'frontmatter',
          date: '',
          ageDays: 0,
          stale: false,
        };
      }
    }
  }

  // Unified newest-to-oldest pass over date sections & shifts for weight, Cr/K/Plt/eGFR/CrCl, and latestLabsMap
  let creatinine = null;
  let potassium = null;
  let platelets = null;
  let chartedEgfr = null;
  let chartedCrCl = null;
  const latestLabsMap = {};
  let remainingLabFields = LAB_FIELD_COUNT;

  const applyLabItems = (items) => {
    for (const it of items) {
      const fld = LAB_KEY_TO_FIELD[it.key];
      if (fld && latestLabsMap[fld] === undefined && Number.isFinite(it.num)) {
        if (it.key === 'Cr' && creatinine?.invalidUnit) continue;
        latestLabsMap[fld] = it.num;
        remainingLabFields--;
      }
    }
  };

  const dateSectionsDesc = splitChartDateSections(text).reverse();

  for (const sec of dateSectionsDesc) {
    if (
      weight &&
      chartedEgfr &&
      chartedCrCl &&
      creatinine &&
      potassium &&
      platelets &&
      remainingLabFields === 0
    ) {
      break;
    }

    const ageDays = sec.date ? daysBetweenDates(sec.date, todayStr) : null;
    const shiftsDesc = splitShiftChunks(sec.text).reverse();

    for (const blk of shiftsDesc) {
      if (
        weight &&
        chartedEgfr &&
        chartedCrCl &&
        creatinine &&
        potassium &&
        platelets &&
        remainingLabFields === 0
      ) {
        break;
      }

      const hasDigits = /\d/.test(blk);
      if (!hasDigits) continue;

      if (!weight || !chartedEgfr || !chartedCrCl || !creatinine || !potassium || !platelets) {
        const linesDesc = blk.split('\n').reverse();
        for (const rawLine of linesDesc) {
          if (!/\d/.test(rawLine)) continue;

          if (!weight) {
            const m = rawLine.match(WT_RE);
            if (m) {
              const unit = (m[2] || '').toLowerCase();
              const wtStale = ageDays !== null && ageDays > maxWeightAgeDays;
              if (unit === 'lb' || unit === 'lbs') {
                weight = {
                  valueKg: null,
                  invalidUnit: true,
                  raw: m[0].trim(),
                  source: 'chart',
                  date: sec.date || 'Undated',
                  ageDays,
                  stale: wtStale,
                };
              } else {
                const val = parsePositiveNumber(m[1], 1, 400);
                if (val !== null) {
                  weight = {
                    valueKg: val,
                    invalidUnit: false,
                    raw: `${val} kg`,
                    source: 'chart',
                    date: sec.date || 'Undated',
                    ageDays,
                    stale: wtStale,
                  };
                }
              }
            }
          }

          if (!chartedEgfr || !chartedCrCl || !creatinine || !potassium || !platelets) {
            const trimmed = rawLine.trim();
            if (!trimmed || /^#{2,3}\s+/.test(trimmed)) continue;

            if (!chartedEgfr) {
              const egMatch = trimmed.match(EGFR_RE);
              if (egMatch) {
                const val = parsePositiveNumber(egMatch[1], 1, 250);
                if (val !== null) {
                  chartedEgfr = {
                    value: val,
                    date: sec.date || 'Undated',
                    ageDays,
                    label: 'CHARTED',
                  };
                }
              }
            }

            if (!chartedCrCl) {
              const ccMatch = trimmed.match(CRCL_RE);
              if (ccMatch) {
                const val = parsePositiveNumber(ccMatch[1], 1, 300);
                if (val !== null) {
                  chartedCrCl = {
                    value: val,
                    date: sec.date || 'Undated',
                    ageDays,
                    label: 'CHARTED',
                  };
                }
              }
            }

            if (!isNonLabLineForClinical(trimmed)) {
              if (!creatinine) {
                CR_RE.lastIndex = 0;
                let m;
                let lineCr = null;
                while ((m = CR_RE.exec(trimmed)) !== null) {
                  const rawAlias = m[1];
                  const num = parsePositiveNumber(m[2], 0.05, 2500);
                  if (num === null) continue;
                  const unit = (m[4] || '').trim();
                  // Guard: uppercase "CR 78" (cardiac rate) unless explicitly in a lab line
                  if (
                    rawAlias === 'CR' &&
                    num >= 25 &&
                    !/\b(?:labs?|BUN|Na|K|eGFR|CrCl|creatinine|renal|umol|µmol)\b/i.test(trimmed)
                  ) {
                    continue;
                  }
                  const umolOnLine =
                    /^(?:µmol|umol|mmol)/i.test(unit) ||
                    /(?:Creatinine|Creat|Crea|SCr|Cr)\b[^|;\n]{0,30}(?:µmol\/?L|umol\/?L)/i.test(trimmed);
                  const stale = ageDays !== null && ageDays > maxCrAgeDays;
                  if (umolOnLine && unitSystem === 'si') {
                    lineCr = {
                      value: roundTo(num / 88.4, 2),
                      unit: 'mg/dL',
                      invalidUnit: false,
                      rawSiValue: num,
                      rawSiUnit: unit || 'µmol/L',
                      date: sec.date || 'Undated',
                      ageDays,
                      stale,
                    };
                  } else {
                    lineCr = {
                      value: num,
                      unit: umolOnLine ? unit || 'umol/L' : unit || 'mg/dL',
                      invalidUnit: umolOnLine,
                      date: sec.date || 'Undated',
                      ageDays,
                      stale,
                    };
                  }
                }
                if (lineCr) creatinine = lineCr;
              }

              if (!potassium && !/\b(?:Vit(?:amin)?\s+K|KCl)\b/i.test(trimmed)) {
                K_RE.lastIndex = 0;
                let km;
                let lineK = null;
                while ((km = K_RE.exec(trimmed)) !== null) {
                  const kVal = parsePositiveNumber(km[2], 1.0, 12.0);
                  if (kVal !== null) {
                    lineK = {
                      value: kVal,
                      date: sec.date || 'Undated',
                      ageDays,
                      stale: ageDays !== null && ageDays > maxCrAgeDays,
                    };
                  }
                }
                if (lineK) potassium = lineK;
              }

              if (!platelets) {
                PLT_RE.lastIndex = 0;
                let pm;
                let linePlt = null;
                while ((pm = PLT_RE.exec(trimmed)) !== null) {
                  const pltVal = parsePositiveNumber(pm[2], 1, 2000);
                  if (pltVal !== null) {
                    linePlt = {
                      value: pltVal,
                      date: sec.date || 'Undated',
                      ageDays,
                      stale: ageDays !== null && ageDays > maxCrAgeDays,
                    };
                  }
                }
                if (linePlt) platelets = linePlt;
              }
            }
          }

          if (weight && chartedEgfr && chartedCrCl && creatinine && potassium && platelets) {
            break;
          }
        }
      }

      if (remainingLabFields > 0) {
        const metrics = extractClinicalMetricsFromBlock(blk);
        if (metrics.labs) {
          applyLabItems(parseRawLabs(metrics.labs));
        }
        if (remainingLabFields > 0 && (blk.includes('ABG') || /\bpH\b|\bpCO2\b|\bpO2\b/i.test(blk))) {
          applyLabItems(parseRawLabs(blk));
        }
      }
    }
  }

  // 3. Active meds / drips from latest date block
  const medLines = [];
  const medSeen = new Set();
  const latestBlk = parsed.latestDateBlock || text;
  let inMedsOrPlans = false;
  const stoppedRe = /\b(?:discontinued|d\/c|stopped|completed)\b|\bheld\b(?!\s*for\b)/i;
  for (const rawLine of String(latestBlk).split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      inMedsOrPlans = false;
      continue;
    }
    if (/^(?:\*{0,2})(?:Meds?|Medications?|Drips?|Infusions?|(?:Service|[A-Za-z\s/&+-]{1,25}\s+)?Plans?)(?:\*{0,2})\s*:/i.test(trimmed)) {
      inMedsOrPlans = true;
    } else if (/^#{2,3}\s+/.test(trimmed) || /^(?:\*{0,2})(?:Pending|Vitals|VS|Labs?|PE|Assessment|Subjective|Objective)\b/i.test(trimmed)) {
      inMedsOrPlans = false;
    }

    if (
      inMedsOrPlans ||
      /\b(?:IV|IVF|PNGT|PO|QHS|BID|TID|QID|OD|q\d+h|mcg\/kg|cc\/hr|ml\/hr)\b/i.test(trimmed)
    ) {
      const clean = trimmed.replace(/^[-*]\s*(?:\[[ xX]\]\s*)?/, '').trim();
      if (clean && !stoppedRe.test(clean)) {
        const key = clean.toLowerCase();
        if (!medSeen.has(key)) {
          medSeen.add(key);
          medLines.push(clean);
        }
      }
    }
  }

  const vitalRaw = String(parsed.vitals || '');
  const ventRaw = String(parsed.vent || '');
  const bpMatch = vitalRaw.match(/\b(?:BP|NIBP)?\s*(\d{2,3})\s*\/\s*(\d{2,3})\b/i);
  const hrMatch = vitalRaw.match(/\b(?:HR|PR|CR)\s*[:=]?\s*(\d{2,3})\b/i);
  const rrMatch = vitalRaw.match(/\bRR\s*[:=]?\s*(\d{1,2})\b/i);
  const tempMatch = vitalRaw.match(/\b(?:Tmax|Temp|T)\s*[:=]?\s*(\d{2}(?:\.\d+)?)\s*(?:°?\s*[CF])?/i);
  const spo2Match = vitalRaw.match(/\b(?:SpO2|O2sat|O2\s*sat|O2)\s*[:=]?\s*(\d{2,3})\s*%?/i);
  const fio2VentMatch = ventRaw.match(/\bFiO2\s*[:=]?\s*(\d{2,3})\s*%?/i);
  const fio2VitalMatch = vitalRaw.match(/\b(?:FiO2\s*(\d{2,3})\s*%|(\d{1,2})\s*L\s*(?:NC|FM|O2)|on\s+(?:Vent|MV|BiPAP|CPAP|HFNC))\b/i);

  let fio2Pct = null;
  if (fio2VentMatch) {
    fio2Pct = parsePositiveNumber(fio2VentMatch[1], 21, 100);
  } else if (fio2VitalMatch) {
    if (fio2VitalMatch[1]) fio2Pct = parsePositiveNumber(fio2VitalMatch[1], 21, 100);
    else if (fio2VitalMatch[2]) fio2Pct = Math.min(100, 20 + 4 * parseInt(fio2VitalMatch[2], 10));
  } else if (/\b(?:RA|Room\s*Air)\b/i.test(vitalRaw)) {
    fio2Pct = 21;
  }

  const vitalsExtracted = {
    sbp: bpMatch ? parsePositiveNumber(bpMatch[1], 30, 300) : null,
    dbp: bpMatch ? parsePositiveNumber(bpMatch[2], 15, 220) : null,
    hr: hrMatch ? parsePositiveNumber(hrMatch[1], 20, 260) : null,
    rr: rrMatch ? parsePositiveNumber(rrMatch[1], 4, 80) : null,
    tempC: tempMatch ? parsePositiveNumber(tempMatch[1], 28, 45) : null,
    spo2: spo2Match ? parsePositiveNumber(spo2Match[1], 40, 100) : null,
    onO2: Boolean((fio2Pct !== null && fio2Pct > 21) || /\b(?:Vent|MV|NC|FM|BiPAP|CPAP|HFNC|FiO2|O2\b)/i.test(`${vitalRaw} ${ventRaw}`) && !/\b(?:RA|Room\s*Air)\b/i.test(vitalRaw)),
    fio2Pct,
  };

  const base = {
    parsed,
    age,
    sex,
    weight,
    creatinine,
    potassium,
    platelets,
    chartedEgfr,
    chartedCrCl,
    medLines,
    latestLabsMap,
    vitals: vitalsExtracted,
  };

  if (clinicalBaseCache.size >= CLINICAL_BASE_CACHE_MAX) {
    clinicalBaseCache.delete(clinicalBaseCache.keys().next().value);
  }
  clinicalBaseCache.set(cacheKey, base);
  return base;
}

/**
 * Deterministic extractor for age, sex, weight, creatinine, K, Plt, charted eGFR/CrCl, and active meds.
 * Honors CLINICAL-WORKFLOW-STE.md §11 (never converts units or invents missing inputs).
 */
export function extractClinicalInputs(content, note = {}, options = {}) {
  const text = String(content || '');

  let todayStr;
  if (options.todayDate instanceof Date) {
    todayStr = getTodayDateStrings(options.todayDate).mmddyyyy;
  } else if (typeof options.todayDate === 'string' && options.todayDate.trim()) {
    todayStr = options.todayDate.trim();
  } else {
    todayStr = getTodayDateStrings().mmddyyyy;
  }

  const maxCrAgeDays = Number.isFinite(options.maxCrAgeDays) ? options.maxCrAgeDays : 3;
  const maxWeightAgeDays = Number.isFinite(options.maxWeightAgeDays) ? options.maxWeightAgeDays : 7;
  const unitSystem = options.unitSystem === 'si' ? 'si' : 'conventional';

  const base = extractClinicalBase(text, note, todayStr, maxCrAgeDays, maxWeightAgeDays, unitSystem);
  const { parsed } = base;

  const ov = options.overrides || {};
  const finalAge = parsePositiveNumber(ov.age, 1, 120) ?? base.age;
  const finalSex = normalizeSex(ov.sex) || base.sex;
  const heightCm = parsePositiveNumber(ov.heightCm ?? parsed.heightCm, 80, 250);

  const ovWeightKg = parsePositiveNumber(ov.weightKg, 1, 400);
  const finalWeight =
    ovWeightKg !== null
      ? {
          valueKg: ovWeightKg,
          invalidUnit: false,
          raw: `${ovWeightKg} kg`,
          source: 'override',
          date: 'Override',
          ageDays: 0,
          stale: false,
        }
      : base.weight;

  const ovCr = parsePositiveNumber(ov.scrMgDl, 0.05, 30);
  const finalCr =
    ovCr !== null
      ? {
          value: ovCr,
          unit: 'mg/dL',
          invalidUnit: false,
          date: 'Override',
          ageDays: 0,
          stale: false,
        }
      : base.creatinine;

  const latestLabsMap = { ...base.latestLabsMap };
  if (finalCr && !finalCr.invalidUnit && finalCr.value !== null) {
    latestLabsMap.cr = finalCr.value;
  }

  return {
    parsed,
    todayStr,
    age: finalAge,
    sex: finalSex,
    heightCm,
    weight: finalWeight,
    creatinine: finalCr,
    potassium: base.potassium,
    platelets: base.platelets,
    chartedEgfr: base.chartedEgfr,
    chartedCrCl: base.chartedCrCl,
    medLines: [...base.medLines],
    allergies: parsed.allergies || '',
    trackedLines: parsed.trackedLines || [],
    trackedAntibiotics: parsed.trackedAntibiotics || [],
    labs: latestLabsMap,
    vitals: { ...base.vitals },
  };
}

/**
 * Race-free 2021 CKD-EPI Creatinine Equation (mL/min/1.73m²).
 * Returns null if age, sex ('M'|'F'), or SCr (mg/dL) is invalid.
 */
export function calculateCKDEPI2021(age, sex, scrMgDl) {
  const a = parsePositiveNumber(age, 18, 120);
  const cr = parsePositiveNumber(scrMgDl, 0.05, 30);
  const s = normalizeSex(sex);
  if (a === null || cr === null || !s) return null;

  const kappa = s === 'F' ? 0.7 : 0.9;
  const alpha = s === 'F' ? -0.241 : -0.302;
  const sexFactor = s === 'F' ? 1.012 : 1.0;

  const ratio = cr / kappa;
  const egfr =
    142 *
    Math.pow(Math.min(ratio, 1), alpha) *
    Math.pow(Math.max(ratio, 1), -1.2) *
    Math.pow(0.9938, a) *
    sexFactor;

  return roundTo(egfr, 1);
}

/**
 * Cockcroft-Gault Creatinine Clearance (mL/min).
 * Requires age, sex ('M'|'F'), weight (kg), and SCr (mg/dL).
 */
export function calculateCockcroftGault(age, sex, weightKg, scrMgDl) {
  const a = parsePositiveNumber(age, 18, 120);
  const w = parsePositiveNumber(weightKg, 1, 400);
  const cr = parsePositiveNumber(scrMgDl, 0.05, 30);
  const s = normalizeSex(sex);
  if (a === null || w === null || cr === null || !s) return null;

  const sexFactor = s === 'F' ? 0.85 : 1.0;
  const crcl = (((140 - a) * w) / (72 * cr)) * sexFactor;
  return roundTo(crcl, 1);
}

/**
 * Evaluates eGFR & CrCl strictly per CLINICAL-WORKFLOW-STE.md §11.5–11.11.
 */
export function evaluateRenalFunction(inputs) {
  const age = parsePositiveNumber(inputs?.age, 18, 120);
  const sex = normalizeSex(inputs?.sex);
  const weightObj = inputs?.weight || null;
  const crObj = inputs?.creatinine || null;

  const missingEgfr = [];
  if (age === null) missingEgfr.push('Age (>=18)');
  if (!sex) missingEgfr.push('Sex (M/F)');
  if (!crObj) {
    missingEgfr.push('Creatinine (mg/dL)');
  } else if (crObj.invalidUnit) {
    missingEgfr.push(`Creatinine unit (${crObj.unit} — mg/dL required, no unit conversion per STE §11.7)`);
  } else if (crObj.stale) {
    missingEgfr.push(`Current Creatinine (${crObj.date} is ${crObj.ageDays}d old — stale)`);
  }

  let egfr;
  if (missingEgfr.length > 0) {
    egfr = {
      status: 'NOT_AVAILABLE',
      label: 'NOT AVAILABLE',
      value: null,
      unit: 'mL/min/1.73m²',
      message: `eGFR NOT available - ASK (${missingEgfr.join('; ')})`,
      missingInputs: missingEgfr,
    };
  } else {
    const val = calculateCKDEPI2021(age, sex, crObj.value);
    egfr = {
      status: 'OK',
      label: 'CALCULATED',
      value: val,
      unit: 'mL/min/1.73m²',
      inputsSummary: `Age ${age}yo, Sex ${sex}, SCr ${crObj.value} mg/dL${crObj.date ? ` (${crObj.date})` : ''}`,
      message: `${val} mL/min/1.73m²`,
      missingInputs: [],
    };
  }

  const missingCrCl = [];
  if (age === null) missingCrCl.push('Age (>=18)');
  if (!sex) missingCrCl.push('Sex (M/F)');
  if (!weightObj) {
    missingCrCl.push('Weight (kg)');
  } else if (weightObj.invalidUnit) {
    missingCrCl.push(`Weight unit (${weightObj.raw} — kg required, no unit conversion)`);
  } else if (weightObj.stale) {
    missingCrCl.push(`Current Weight (${weightObj.date} is ${weightObj.ageDays}d old — stale)`);
  } else if (!parsePositiveNumber(weightObj.valueKg, 1, 400)) {
    missingCrCl.push('Weight (kg)');
  }

  if (!crObj) {
    missingCrCl.push('Creatinine (mg/dL)');
  } else if (crObj.invalidUnit) {
    missingCrCl.push(`Creatinine unit (${crObj.unit} — mg/dL required, no unit conversion per STE §11.7)`);
  } else if (crObj.stale) {
    missingCrCl.push(`Current Creatinine (${crObj.date} is ${crObj.ageDays}d old — stale)`);
  }

  let crcl;
  if (missingCrCl.length > 0) {
    crcl = {
      status: 'NOT_AVAILABLE',
      label: 'NOT AVAILABLE',
      value: null,
      unit: 'mL/min',
      message: `CrCl NOT available - ASK (${missingCrCl.join('; ')})`,
      missingInputs: missingCrCl,
    };
  } else {
    const val = calculateCockcroftGault(age, sex, weightObj.valueKg, crObj.value);
    crcl = {
      status: 'OK',
      label: 'CALCULATED',
      value: val,
      unit: 'mL/min',
      inputsSummary: `Age ${age}yo, Sex ${sex}, Wt ${weightObj.valueKg} kg, SCr ${crObj.value} mg/dL${crObj.date ? ` (${crObj.date})` : ''}`,
      message: `${val} mL/min`,
      missingInputs: [],
    };
  }

  const chartedEgfr = inputs?.chartedEgfr || null;
  const chartedCrCl = inputs?.chartedCrCl || null;

  // Discordance check per STE §11.11 (>= 15 difference)
  let discordanceFlag = null;
  const cmpPairs = [];
  if (egfr.status === 'OK' && crcl.status === 'OK') {
    cmpPairs.push({
      labelA: `CALCULATED CrCl (${crcl.value})`,
      labelB: `CALCULATED eGFR (${egfr.value})`,
      diff: roundTo(Math.abs(crcl.value - egfr.value), 1),
    });
  }
  if (chartedEgfr && crcl.status === 'OK') {
    cmpPairs.push({
      labelA: `CALCULATED CrCl (${crcl.value})`,
      labelB: `CHARTED eGFR (${chartedEgfr.value})`,
      diff: roundTo(Math.abs(crcl.value - chartedEgfr.value), 1),
    });
  }
  if (chartedEgfr && egfr.status === 'OK') {
    cmpPairs.push({
      labelA: `CALCULATED eGFR (${egfr.value})`,
      labelB: `CHARTED eGFR (${chartedEgfr.value})`,
      diff: roundTo(Math.abs(egfr.value - chartedEgfr.value), 1),
    });
  }
  if (chartedCrCl && crcl.status === 'OK') {
    cmpPairs.push({
      labelA: `CALCULATED CrCl (${crcl.value})`,
      labelB: `CHARTED CrCl (${chartedCrCl.value})`,
      diff: roundTo(Math.abs(crcl.value - chartedCrCl.value), 1),
    });
  }

  const largest = cmpPairs.sort((a, b) => b.diff - a.diff)[0];
  if (largest && largest.diff >= 15) {
    discordanceFlag = {
      diff: largest.diff,
      question: `${largest.labelA} and ${largest.labelB} differ by ${largest.diff} (>= 15). Which renal estimate is the team using for drug dosing?`,
    };
  }

  return {
    egfr,
    crcl,
    chartedEgfr,
    chartedCrCl,
    discordanceFlag,
  };
}

const MED_CLASSES = [
  { key: 'amiodarone', label: 'Amiodarone', re: /\b(?:amiodarone|cordarone)\b/i },
  { key: 'digoxin', label: 'Digoxin', re: /\b(?:digoxin|lanoxin)\b/i },
  { key: 'warfarin', label: 'Warfarin', re: /\b(?:warfarin|coumadin)\b/i },
  {
    key: 'betablocker',
    label: 'Beta-blocker',
    re: /\b(?:carvedilol|metoprolol|bisoprolol|propranolol|atenolol|nebivolol|labetalol|esmolol)\b/i,
  },
  {
    key: 'qt_med',
    label: 'QT-prolonging antimicrobial/agent',
    re: /\b(?:azithromycin|clarithromycin|erythromycin|levofloxacin|moxifloxacin|ciprofloxacin|haloperidol|ondansetron|fluconazole)\b/i,
  },
  { key: 'clonidine', label: 'Clonidine', re: /\b(?:clonidine|catapres)\b/i },
  {
    key: 'acei_arb',
    label: 'ACEi/ARB',
    re: /\b(?:losartan|valsartan|telmisartan|irbesartan|candesartan|olmesartan|sacubitril|enalapril|lisinopril|ramipril|captopril|perindopril)\b/i,
  },
  {
    key: 'k_sparing',
    label: 'K-sparing/Potassium supplement',
    re: /\b(?:spironolactone|eplerenone|potassium\s+chloride|kcl|kalium)\b/i,
  },
  { key: 'loop', label: 'Loop diuretic', re: /\b(?:furosemide|furo|bumetanide|torsemide)\b/i },
  {
    key: 'nsaid',
    label: 'NSAID',
    re: /\b(?:ibuprofen|ketorolac|naproxen|diclofenac|celecoxib|etoricoxib|mefenamic|indomethacin|meloxicam)\b/i,
  },
  {
    key: 'anticoag',
    label: 'Anticoagulant',
    re: /\b(?:heparin|enoxaparin|fondaparinux|apixaban|rivaroxaban|dabigatran|warfarin|coumadin)\b/i,
  },
  {
    key: 'antiplatelet',
    label: 'Antiplatelet',
    re: /\b(?:aspirin|asa\b|clopidogrel|ticagrelor|prasugrel|cilostazol)\b/i,
  },
  { key: 'vancomycin', label: 'Vancomycin', re: /\b(?:vancomycin|vanco)\b/i },
  {
    key: 'pip_tazo',
    label: 'Piperacillin-Tazobactam',
    re: /\b(?:piperacillin|pip-?tazo|tazocin|zosyn)\b/i,
  },
  {
    key: 'aminoglycoside',
    label: 'Aminoglycoside',
    re: /\b(?:gentamicin|amikacin|tobramycin|streptomycin)\b/i,
  },
  { key: 'insulin', label: 'Insulin', re: /\binsulin\b/i },
  { key: 'allopurinol_febux', label: 'XO inhibitor', re: /\b(?:allopurinol|febuxostat)\b/i },
  {
    key: 'azathioprine_6mp',
    label: 'Thiopurine',
    re: /\b(?:azathioprine|mercaptopurine|6-?mp)\b/i,
  },
];

const INTERACTION_RULES = [
  {
    a: 'amiodarone',
    b: 'digoxin',
    effect: 'Increased digoxin levels and bradyarrhythmia/toxicity',
    action: 'Consider reducing digoxin dose and monitoring levels/HR',
  },
  {
    a: 'amiodarone',
    b: 'warfarin',
    effect: 'Potentiated anticoagulation and elevated INR',
    action: 'Monitor INR closely and adjust warfarin dose if needed',
  },
  {
    a: 'amiodarone',
    b: 'betablocker',
    effect: 'Additive sinus bradycardia and AV nodal block',
    action: 'Monitor HR/PR interval on telemetry and review hold parameters',
  },
  {
    a: 'amiodarone',
    b: 'qt_med',
    effect: 'Additive QTc prolongation and Torsades risk',
    action: 'Check baseline QTc, K, and Mg before co-administering',
  },
  {
    a: 'clonidine',
    b: 'betablocker',
    effect: 'Exaggerated bradycardia and rebound hypertension if clonidine stopped first',
    action: 'Monitor HR/BP closely and avoid abrupt clonidine interruption',
  },
  {
    a: 'acei_arb',
    b: 'k_sparing',
    effect: 'Additive hyperkalemia risk',
    action: 'Monitor serum K and SCr closely',
  },
  {
    a: 'nsaid',
    b: 'anticoag',
    effect: 'Increased GI and systemic bleeding risk',
    action: 'Avoid concurrent NSAID or review gastroprotection',
  },
  {
    a: 'nsaid',
    b: 'antiplatelet',
    effect: 'Increased GI bleeding and impaired antiplatelet protection',
    action: 'Verify clinical indication and PPI coverage',
  },
  {
    a: 'nsaid',
    b: 'acei_arb',
    effect: 'Afferent/efferent GFR drop and AKI risk',
    action: 'Monitor urine output and serum creatinine',
  },
  {
    a: 'vancomycin',
    b: 'pip_tazo',
    effect: 'Increased acute kidney injury incidence',
    action: 'Monitor daily SCr/UOP and consider alternative beta-lactam if high risk',
  },
  {
    a: 'anticoag',
    b: 'antiplatelet',
    effect: 'Combined hemostatic impairment and bleeding risk',
    action: 'Verify bleeding precautions, Hgb trend, and planned duration',
  },
  {
    a: 'insulin',
    b: 'betablocker',
    effect: 'Blunted adrenergic hypoglycemia warning signs (tachycardia/tremor)',
    action: 'Maintain regular HGT monitoring per protocol',
  },
  {
    a: 'loop',
    b: 'aminoglycoside',
    effect: 'Additive ototoxicity and nephrotoxicity',
    action: 'Monitor renal function, drug levels, and hearing status',
  },
  {
    a: 'allopurinol_febux',
    b: 'azathioprine_6mp',
    effect: 'Severe myelosuppression from impaired thiopurine clearance',
    action: 'Hold co-administration and consult team immediately',
  },
];

/**
 * Checks active medication lines (+ optional proposed drug) for clinically significant interactions.
 * Formats each finding per STE §8.7: `drug A + drug B -> effect -> action`.
 */
const ALLERGY_CONFLICT_RULES = [
  {
    allergyRe: /\b(?:penicillin|pcn|amoxicillin|ampicillin|piperacillin|beta-?lactam)\b/i,
    medRe: /\b(?:penicillin|amoxicillin|ampicillin|co-?amoxiclav|augmentin|piperacillin|pip-?tazo|tazocin|nafcillin|oxacillin|cef\w+|ceph\w+|meropenem|ertapenem|imipenem)\b/i,
    note: 'Beta-lactam cross-reactivity risk',
  },
  {
    allergyRe: /\b(?:sulfa|sulfonamide|sulfamethoxazole|bactrim|cotrimoxazole|tmp-?smx)\b/i,
    medRe: /\b(?:sulfamethoxazole|bactrim|cotrimoxazole|tmp-?smx|sulfasalazine|furosemide|hydrochlorothiazide|hctz|celecoxib|acetazolamide)\b/i,
    note: 'Sulfonamide hypersensitivity / structural overlap',
  },
  {
    allergyRe: /\b(?:nsaid|aspirin|asa|ibuprofen|ketorolac|naproxen|diclofenac|celecoxib)\b/i,
    medRe: /\b(?:aspirin|asa\b|ibuprofen|ketorolac|naproxen|diclofenac|celecoxib|indomethacin|meloxicam|mefenamic)\b/i,
    note: 'NSAID / ASA sensitivity',
  },
  {
    allergyRe: /\b(?:morphine|opioid|codeine|tramadol|fentanyl|oxycodone|hydromorphone)\b/i,
    medRe: /\b(?:morphine|codeine|tramadol|fentanyl|oxycodone|hydromorphone|meperidine)\b/i,
    note: 'Opioid class allergy documented',
  },
  {
    allergyRe: /\b(?:vancomycin|vanc)\b/i,
    medRe: /\b(?:vancomycin|vanc)\b/i,
    note: 'Direct vancomycin reaction history',
  },
  {
    allergyRe: /\b(?:acei|ace\s*inhibitor|enalapril|lisinopril|captopril|ramipril)\b/i,
    medRe: /\b(?:enalapril|lisinopril|captopril|ramipril|perindopril)\b/i,
    note: 'ACE inhibitor angioedema/cough risk',
  },
  {
    allergyRe: /\b(?:contrast|iodine|radiocontrast)\b/i,
    medRe: /\b(?:amiodarone|iodinated\s*contrast|ct\s*w\/\s*contrast|iv\s*contrast)\b/i,
    note: 'Iodine / contrast sensitivity documented',
  },
];

export function checkAllergyConflicts(allergiesText, medLines = [], extraDrug = '') {
  const cleanAllergy = String(allergiesText || '').trim();
  if (!cleanAllergy || /^(?:nkda|nka|none|nil|no\s+known\s+drug\s+allerg(?:y|ies)|-)$/i.test(cleanAllergy)) {
    return [];
  }
  const meds = [...(Array.isArray(medLines) ? medLines : [String(medLines || '')])];
  if (String(extraDrug || '').trim()) meds.push(String(extraDrug).trim());
  const medJoined = meds.join('\n');
  if (!medJoined.trim()) return [];

  const findings = [];
  const seen = new Set();

  for (const rule of ALLERGY_CONFLICT_RULES) {
    const aMatch = cleanAllergy.match(rule.allergyRe);
    const mMatch = medJoined.match(rule.medRe);
    if (aMatch && mMatch) {
      const key = `${aMatch[0].toLowerCase()}->${mMatch[0].toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          allergen: aMatch[0],
          medication: mMatch[0],
          note: rule.note,
          question: `Chart documents allergy "${cleanAllergy}" while ${mMatch[0]} is active/proposed (${rule.note}) — has allergy safety been verified?`,
        });
      }
    }
  }

  // Fallback custom direct token match for drugs not in preset table
  const allergyTokens = cleanAllergy
    .replace(/\([^)]*\)/g, ' ')
    .split(/[,;/]+/)
    .map((s) => s.trim())
    .filter((t) => t.length >= 4 && !/^(?:rash|hives|itch|anaphylaxis|reaction|allergy|mild|severe)$/i.test(t));
  for (const token of allergyTokens) {
    const re = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const hit = medJoined.match(re);
    if (hit) {
      const key = `direct->${hit[0].toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        findings.push({
          allergen: token,
          medication: hit[0],
          note: 'Direct allergen match',
          question: `Chart documents allergy "${cleanAllergy}" matching active/proposed ${hit[0]} — should this agent be held or clarified?`,
        });
      }
    }
  }

  return findings;
}

export function checkDrugInteractions(medLines = [], extraDrug = '') {
  const combined = [...(Array.isArray(medLines) ? medLines : [String(medLines || '')])];
  if (String(extraDrug || '').trim()) {
    combined.push(String(extraDrug).trim());
  }

  const matchedNames = new Map();
  for (const line of combined) {
    const clean = String(line || '').trim();
    if (!clean) continue;
    for (const cls of MED_CLASSES) {
      const m = clean.match(cls.re);
      if (m) {
        const displayName = m[0].trim();
        if (!matchedNames.has(cls.key)) {
          matchedNames.set(cls.key, displayName);
        }
      }
    }
  }

  const findings = [];
  for (const rule of INTERACTION_RULES) {
    if (matchedNames.has(rule.a) && matchedNames.has(rule.b)) {
      const drugA = matchedNames.get(rule.a);
      const drugB = matchedNames.get(rule.b);
      findings.push({
        drugA,
        drugB,
        effect: rule.effect,
        action: rule.action,
        line: `${drugA} + ${drugB} -> ${rule.effect} -> ${rule.action}`,
      });
    }
  }

  return findings;
}

const RENALLY_CLEARED_DRUG_RE =
  /\b(?:meropenem|cefepime|piperacillin|pip-?tazo|tazocin|vancomycin|ertapenem|levofloxacin|ciprofloxacin|gentamicin|amikacin|enoxaparin|fondaparinux|dabigatran|apixaban|rivaroxaban|metformin|allopurinol|gabapentin|pregabalin|digoxin|colchicine|famotidine)\b/i;

/**
 * Deterministic guideline pre-pass audit (STE §11).
 * Every flag is phrased as a QUESTION (never an order) and only triggers when evidence is present.
 */
export function runClinicalAudit(note, options = {}) {
  const inputs = extractClinicalInputs(note?.content || '', note, options);
  const renal = evaluateRenalFunction(inputs);
  const interactions = checkDrugInteractions(inputs.medLines, options.extraDrug || '');
  const flags = [];
  const medJoined = inputs.medLines.join('\n');

  const addFlag = ({ severity = 'warn', criterion, question, missingEvidence = '', source }) => {
    flags.push({ severity, criterion, question, missingEvidence, source });
  };

  if (renal.egfr.status === 'NOT_AVAILABLE') {
    addFlag({
      severity: 'ask',
      criterion: 'CKD-EPI eGFR Prerequisites',
      question: `${renal.egfr.message} — should we obtain ${renal.egfr.missingInputs.join(', ')}?`,
      missingEvidence: renal.egfr.missingInputs.join('; '),
      source: 'CLINICAL-WORKFLOW-STE.md §11.6, §11.9',
    });
  }

  if (renal.crcl.status === 'NOT_AVAILABLE') {
    addFlag({
      severity: 'ask',
      criterion: 'Cockcroft-Gault CrCl Prerequisites',
      question: `${renal.crcl.message} — what is the patient's ${renal.crcl.missingInputs.join(' and ')}?`,
      missingEvidence: renal.crcl.missingInputs.join('; '),
      source: 'CLINICAL-WORKFLOW-STE.md §11.6, §11.8',
    });
  }

  if (renal.discordanceFlag) {
    addFlag({
      severity: 'warn',
      criterion: 'Renal Estimate Discordance (>= 15)',
      question: renal.discordanceFlag.question,
      missingEvidence: `Difference of ${renal.discordanceFlag.diff} between estimates`,
      source: 'CLINICAL-WORKFLOW-STE.md §11.11',
    });
  }

  // Trigger: Renally cleared drug + impaired or unavailable renal function
  const renalDrugMatch = medJoined.match(RENALLY_CLEARED_DRUG_RE);
  if (renalDrugMatch) {
    const lowCrCl = renal.crcl.status === 'OK' && renal.crcl.value < 50;
    const lowEgfr = renal.egfr.status === 'OK' && renal.egfr.value < 50;
    const unverified = renal.crcl.status === 'NOT_AVAILABLE' && renal.egfr.status === 'NOT_AVAILABLE';
    if (lowCrCl || lowEgfr || unverified) {
      const renalDesc =
        lowCrCl
          ? `CALCULATED CrCl ${renal.crcl.value} mL/min`
          : lowEgfr
            ? `CALCULATED eGFR ${renal.egfr.value} mL/min/1.73m²`
            : 'renal function unverified';
      addFlag({
        severity: 'warn',
        criterion: 'Renal Dose Verification',
        question: `${renalDrugMatch[0]} is active with ${renalDesc} — does the current dose/interval match renal adjustment?`,
        missingEvidence: unverified ? 'Current Cr / Weight needed' : '',
        source: 'Renal Dosing Pre-Pass (STE §11)',
      });
    }
  }

  // Trigger: Weight-based vasopressor/inotrope drip without weight
  const pressorMatch = medJoined.match(/\b(Norepinephrine|Dopamine|Dobutamine|Epinephrine)\b/i);
  if (pressorMatch && (!inputs.weight || !inputs.weight.valueKg || inputs.weight.stale || inputs.weight.invalidUnit)) {
    addFlag({
      severity: 'ask',
      criterion: 'Weight-Based Drip Input Check',
      question: `${pressorMatch[1]} infusion is documented without a current weight in kg — what weight (kg) should be used for mcg/kg/min verification?`,
      missingEvidence: 'Current Weight (kg)',
      source: 'CLINICAL-WORKFLOW-STE.md §8.5',
    });
  }

  // Trigger: Potassium abnormality with relevant meds
  if (inputs.potassium && !inputs.potassium.stale) {
    const kVal = inputs.potassium.value;
    if (kVal >= 5.2 && /\b(?:spironolactone|eplerenone|kcl|potassium|losartan|valsartan|telmisartan|enalapril|lisinopril)\b/i.test(medJoined)) {
      addFlag({
        severity: 'warn',
        criterion: 'Hyperkalemia + K-Raising Agent',
        question: `Latest K is ${kVal} (${inputs.potassium.date}) while receiving a potassium-sparing/supplement agent — should potassium intake or ACEi/ARB/K-sparing agents be reviewed?`,
        missingEvidence: 'Verify repeat K / ECG',
        source: 'Electrolyte Safety Pre-Pass',
      });
    } else if (kVal <= 3.4 && /\b(?:furosemide|furo|digoxin|amiodarone|insulin)\b/i.test(medJoined)) {
      addFlag({
        severity: 'warn',
        criterion: 'Hypokalemia + Loop/Arrhythmogenic Agent',
        question: `Latest K is ${kVal} (${inputs.potassium.date}) alongside diuretic/arrhythmogenic/insulin therapy — has K repletion or repeat level been ordered?`,
        missingEvidence: 'Verify K repletion plan',
        source: 'Electrolyte Safety Pre-Pass',
      });
    }
  }

  // Trigger: Thrombocytopenia with anticoagulant/antiplatelet
  if (inputs.platelets && !inputs.platelets.stale && inputs.platelets.value < 100) {
    const bleedMed = medJoined.match(/\b(?:heparin|enoxaparin|warfarin|apixaban|rivaroxaban|aspirin|clopidogrel|ticagrelor|prasugrel)\b/i);
    if (bleedMed) {
      addFlag({
        severity: 'warn',
        criterion: 'Thrombocytopenia + Antithrombotic Therapy',
        question: `Latest Platelets ${inputs.platelets.value} (<100) while ${bleedMed[0]} is charted — should antithrombotic therapy risk vs benefit be reviewed?`,
        missingEvidence: 'Check bleeding signs / repeat CBC',
        source: 'Bleeding Safety Pre-Pass',
      });
    }
  }

  // Trigger: Allergy cross-check
  const allergyConflicts = checkAllergyConflicts(inputs.allergies, inputs.medLines, options.extraDrug || '');
  for (const ac of allergyConflicts) {
    addFlag({
      severity: 'warn',
      criterion: 'Allergy Cross-Check',
      question: ac.question,
      missingEvidence: `Documented allergy: ${inputs.allergies}`,
      source: 'Allergy Safety Pre-Pass',
    });
  }

  // Trigger: Overdue Lines / Drains / Airways
  for (const line of inputs.trackedLines || []) {
    if (line.overdue) {
      addFlag({
        severity: 'warn',
        criterion: 'Line / Device Duration Check',
        question: `${line.name} is on Day ${line.dayCount} (>= ${line.thresholdDays}d institutional threshold) — is it still clinically indicated or due for removal/exchange?`,
        missingEvidence: `Start date: ${line.startDate}`,
        source: 'CLABSI / CAUTI Stewardship Check',
      });
    }
  }

  // Trigger: Antibiotic Day Check (due or overdue)
  for (const ab of inputs.trackedAntibiotics || []) {
    if (ab.overdue) {
      addFlag({
        severity: 'warn',
        criterion: 'Antibiotic Duration Stewardship',
        question: `${ab.label} has exceeded planned/7-day review window — should therapy be stopped or de-escalated?`,
        missingEvidence: `Started: ${ab.startDate}`,
        source: 'Antimicrobial Stewardship Check',
      });
    } else if (ab.dueSoon) {
      addFlag({
        severity: 'ask',
        criterion: 'Antibiotic Completion Today',
        question: `${ab.label} reaches planned end day today — confirm stop vs extension?`,
        missingEvidence: `Started: ${ab.startDate}`,
        source: 'Antimicrobial Stewardship Check',
      });
    }
  }

  // Trigger: Drug interactions formatted as questions for team confirmation
  for (const ix of interactions) {
    addFlag({
      severity: 'info',
      criterion: 'Drug Interaction Check',
      question: `${ix.line} — should this monitoring/adjustment be confirmed?`,
      missingEvidence: '',
      source: 'CLINICAL-WORKFLOW-STE.md §8.6–8.7',
    });
  }

  return {
    inputs,
    renal,
    interactions,
    allergyConflicts,
    flags,
  };
}

function formatRunoutDuration(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return 'N/A';
  const totalMins = Math.round(hours * 60);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/**
 * Forward Drip Calculator: pump rate (mL/hr) + concentration -> dose/hr, dose/kg/min, bag runout & shortfall (STE §8.2–8.5).
 */
export function calculateDripRate({
  drugName = '',
  totalDrugAmount,
  drugUnit = 'mg',
  bagVolumeMl,
  rateMlPerHr,
  weightKg = null,
  plannedHours = 24,
} = {}) {
  const amt = parsePositiveNumber(totalDrugAmount, 0.0001, 1e9);
  const vol = parsePositiveNumber(bagVolumeMl, 0.1, 10000);
  const rate = parsePositiveNumber(rateMlPerHr, 0.01, 5000);
  const wt = parsePositiveNumber(weightKg, 1, 400);
  const planH = parsePositiveNumber(plannedHours, 0.1, 720);
  const unitClean = String(drugUnit || 'mg').toLowerCase();

  if (amt === null || vol === null || rate === null) {
    return { error: 'Enter positive numeric Total Drug Amount, Bag Volume (mL), and Pump Rate (mL/hr).' };
  }

  const concentrationPerMl = amt / vol;
  const dosePerHour = concentrationPerMl * rate;
  const dosePerMin = dosePerHour / 60;

  let mgPerHr = null;
  let mcgPerHr = null;
  let mcgPerMin = null;
  let mcgPerKgPerMin = null;
  let mcgPerKgPerHr = null;
  let mgPerKgPerHr = null;
  let unitsPerHr = null;
  let unitsPerMin = null;
  let unitsPerKgPerHr = null;

  if (unitClean === 'mg') {
    mgPerHr = roundTo(dosePerHour, 3);
    mcgPerHr = roundTo(dosePerHour * 1000, 1);
    mcgPerMin = roundTo((dosePerHour * 1000) / 60, 2);
    if (wt !== null) {
      mgPerKgPerHr = roundTo(dosePerHour / wt, 3);
      mcgPerKgPerHr = roundTo((dosePerHour * 1000) / wt, 2);
      mcgPerKgPerMin = roundTo((dosePerHour * 1000) / 60 / wt, 3);
    }
  } else if (unitClean === 'mcg') {
    mcgPerHr = roundTo(dosePerHour, 1);
    mgPerHr = roundTo(dosePerHour / 1000, 4);
    mcgPerMin = roundTo(dosePerMin, 2);
    if (wt !== null) {
      mcgPerKgPerHr = roundTo(dosePerHour / wt, 2);
      mcgPerKgPerMin = roundTo(dosePerMin / wt, 3);
    }
  } else {
    unitsPerHr = roundTo(dosePerHour, 2);
    unitsPerMin = roundTo(dosePerMin, 3);
    if (wt !== null) {
      unitsPerKgPerHr = roundTo(dosePerHour / wt, 3);
    }
  }

  const bagRunoutHours = roundTo(vol / rate, 2);
  const bagRunoutText = formatRunoutDuration(bagRunoutHours);
  const shortfall = planH !== null ? bagRunoutHours < planH : false;
  const bagsNeeded = planH !== null ? Math.ceil(planH / (vol / rate)) : null;
  const totalVolNeededMl = planH !== null ? roundTo(rate * planH, 0) : null;

  return {
    error: null,
    drugName: String(drugName || '').trim() || 'Infusion',
    drugUnit: unitClean,
    totalDrugAmount: amt,
    bagVolumeMl: vol,
    rateMlPerHr: roundTo(rate, 2),
    concentrationPerMl: roundTo(concentrationPerMl, 3),
    dosePerHour: roundTo(dosePerHour, 3),
    dosePerMin: roundTo(dosePerMin, 3),
    mgPerHr,
    mcgPerHr,
    mcgPerMin,
    mcgPerKgPerHr,
    mcgPerKgPerMin,
    mgPerKgPerHr,
    unitsPerHr,
    unitsPerMin,
    unitsPerKgPerHr,
    weightKg: wt,
    weightUsed: wt !== null ? `${wt} kg` : '',
    weightNotice: wt === null ? 'No weight (kg) provided — weight-based dose NOT calculated.' : '',
    bagRunoutHours,
    bagRunoutText,
    plannedHours: planH,
    shortfall,
    bagsNeeded,
    totalVolNeededMl,
    shortfallMessage: shortfall
      ? `Shortfall: 1 bag (${vol} mL) runs out in ${bagRunoutText} (< ${planH}h plan). Needs ${bagsNeeded} bag(s) (${totalVolNeededMl} mL total).`
      : planH !== null
        ? `Adequate: 1 bag lasts ${bagRunoutText} (>= ${planH}h planned duration).`
        : '',
  };
}

/**
 * Reverse Drip Calculator: target dose -> required pump rate (mL/hr) + full runout breakdown.
 */
export function calculatePumpRateFromTargetDose({
  drugName = '',
  totalDrugAmount,
  drugUnit = 'mg',
  bagVolumeMl,
  targetDose,
  targetUnit = 'mcg/kg/min',
  weightKg = null,
  plannedHours = 24,
} = {}) {
  const amt = parsePositiveNumber(totalDrugAmount, 0.0001, 1e9);
  const vol = parsePositiveNumber(bagVolumeMl, 0.1, 10000);
  const dose = parsePositiveNumber(targetDose, 0.0001, 1e9);
  const wt = parsePositiveNumber(weightKg, 1, 400);
  const bagUnit = String(drugUnit || 'mg').toLowerCase();
  const tUnit = String(targetUnit || '').toLowerCase().trim();

  if (amt === null || vol === null || dose === null) {
    return { error: 'Enter positive numeric Total Drug Amount, Bag Volume (mL), and Target Dose.' };
  }

  const isWeightBased = /\/kg\//.test(tUnit);
  if (isWeightBased && wt === null) {
    return { error: 'Weight (kg) required — cannot calculate a weight-based infusion rate without weight.' };
  }

  const bagIsUnits = bagUnit === 'units';
  const targetIsUnits = tUnit.startsWith('units');
  if (bagIsUnits !== targetIsUnits) {
    return { error: `Unit mismatch: bag is in ${bagUnit} while target dose is ${tUnit}.` };
  }

  // Convert target dose to dosePerHour in bagUnit
  let neededDosePerHrInBagUnit = null;
  if (bagUnit === 'mg' || bagUnit === 'mcg') {
    let targetMcgPerHr;
    if (tUnit === 'mcg/kg/min') targetMcgPerHr = dose * wt * 60;
    else if (tUnit === 'mcg/kg/hr') targetMcgPerHr = dose * wt;
    else if (tUnit === 'mcg/min') targetMcgPerHr = dose * 60;
    else if (tUnit === 'mcg/hr') targetMcgPerHr = dose;
    else if (tUnit === 'mg/hr') targetMcgPerHr = dose * 1000;
    else if (tUnit === 'mg/kg/hr') targetMcgPerHr = dose * wt * 1000;
    else return { error: `Unsupported target dose unit "${targetUnit}".` };

    neededDosePerHrInBagUnit = bagUnit === 'mg' ? targetMcgPerHr / 1000 : targetMcgPerHr;
  } else {
    if (tUnit === 'units/hr') neededDosePerHrInBagUnit = dose;
    else if (tUnit === 'units/kg/hr') neededDosePerHrInBagUnit = dose * wt;
    else return { error: `Unsupported target dose unit "${targetUnit}" for units bag.` };
  }

  const concPerMl = amt / vol;
  const requiredRate = neededDosePerHrInBagUnit / concPerMl;

  return {
    ...calculateDripRate({
      drugName,
      totalDrugAmount: amt,
      drugUnit: bagUnit,
      bagVolumeMl: vol,
      rateMlPerHr: requiredRate,
      weightKg: wt,
      plannedHours,
    }),
    targetDose: dose,
    targetUnit: tUnit,
  };
}

/**
 * Deterministic Bedside Physiology Calculators (Western ICU / Internal Medicine):
 * Anion Gap, Albumin-Corrected AG, Delta-Delta, Corrected Na, Corrected Ca,
 * P/F Ratio + Berlin ARDS Band, A-a Gradient, and Devine PBW / 6-8 mL/kg ARDS Vt.
 */
export function calculatePhysiology({
  na = null,
  cl = null,
  hco3 = null,
  alb = null,
  glu = null,
  ca = null,
  pao2 = null,
  paco2 = null,
  fio2Pct = null,
  heightCm = null,
  sex = '',
  age = null,
} = {}) {
  const nNa = parsePositiveNumber(na, 80, 200);
  const nCl = parsePositiveNumber(cl, 50, 160);
  const nHco3 = parsePositiveNumber(hco3, 2, 60);
  const nAlb = parsePositiveNumber(alb, 0.5, 8);
  const nGlu = parsePositiveNumber(glu, 10, 2000);
  const nCa = parsePositiveNumber(ca, 2, 20);
  const nPao2 = parsePositiveNumber(pao2, 10, 700);
  const nPaco2 = parsePositiveNumber(paco2, 5, 160);
  const nFio2 = parsePositiveNumber(fio2Pct, 21, 100);
  const nHt = parsePositiveNumber(heightCm, 100, 250);
  const normSex = normalizeSex(sex);
  const nAge = parsePositiveNumber(age, 1, 120);

  // 1. Anion Gap & Delta-Delta
  let anionGap = null;
  let correctedAg = null;
  let deltaDelta = null;
  let agStatus = 'NOT_AVAILABLE';
  let agNote = 'Requires Na, Cl, and HCO3';
  if (nNa !== null && nCl !== null && nHco3 !== null) {
    anionGap = roundTo(nNa - (nCl + nHco3), 1);
    agStatus = 'OK';
    if (nAlb !== null) {
      correctedAg = roundTo(anionGap + 2.5 * (4.0 - nAlb), 1);
    }
    const agUsed = correctedAg !== null ? correctedAg : anionGap;
    if (agUsed > 12 && nHco3 < 24) {
      const ratio = roundTo((agUsed - 12) / (24 - nHco3), 2);
      deltaDelta = ratio;
      if (ratio < 1) agNote = `HAGMA + concurrent non-AG acidosis (delta/delta ${ratio})`;
      else if (ratio <= 2) agNote = `Pure HAGMA likely (delta/delta ${ratio})`;
      else agNote = `HAGMA + concurrent metabolic alkalosis (delta/delta ${ratio})`;
    } else if (agUsed > 12) {
      agNote = 'Elevated anion gap (>= 12 mEq/L)';
    } else {
      agNote = 'Normal anion gap (< 12 mEq/L)';
    }
  }

  // 2. Corrected Sodium (Katz formula)
  let correctedNa = null;
  let correctedNaNote = 'Requires Na and Glucose (mg/dL)';
  if (nNa !== null && nGlu !== null) {
    correctedNa = roundTo(nNa + 0.016 * (nGlu - 100), 1);
    correctedNaNote = nGlu > 140 ? 'Adjusted for hyperglycemia (Katz +1.6/100)' : 'Glucose near normal';
  }

  // 3. Corrected Calcium
  let correctedCa = null;
  let correctedCaNote = 'Requires Calcium (mg/dL) and Albumin (g/dL)';
  if (nCa !== null && nAlb !== null) {
    correctedCa = roundTo(nCa + 0.8 * (4.0 - nAlb), 2);
    correctedCaNote = correctedCa < 8.5 ? 'Hypocalcemia (< 8.5)' : correctedCa > 10.5 ? 'Hypercalcemia (> 10.5)' : 'Normal corrected range (8.5-10.5)';
  }

  // 4. P/F Ratio & Berlin ARDS Severity
  let pfRatio = null;
  let pfBand = '';
  let pfNote = 'Requires PaO2 (mmHg) and FiO2 (%)';
  if (nPao2 !== null && nFio2 !== null) {
    pfRatio = Math.round(nPao2 / (nFio2 / 100));
    if (pfRatio >= 400) pfBand = 'Normal (>= 400)';
    else if (pfRatio > 300) pfBand = 'Mild hypoxemia (301-399)';
    else if (pfRatio > 200) pfBand = 'Mild ARDS range (201-300)';
    else if (pfRatio > 100) pfBand = 'Moderate ARDS range (101-200)';
    else pfBand = 'Severe ARDS range (<= 100)';
    pfNote = `${pfBand} · FiO2 ${nFio2}%`;
  }

  // 5. A-a Gradient
  let aaGradient = null;
  let expectedAa = null;
  let aaNote = 'Requires PaO2, PaCO2, and FiO2 (%)';
  if (nPao2 !== null && nPaco2 !== null && nFio2 !== null) {
    const pao2Alveolar = (nFio2 / 100) * 713 - nPaco2 / 0.8;
    aaGradient = roundTo(pao2Alveolar - nPao2, 1);
    expectedAa = nAge !== null ? roundTo(nAge / 4 + 4, 1) : null;
    aaNote = expectedAa !== null ? `Expected normal ~ ${expectedAa} mmHg (Age/4 + 4)` : 'Normal ~ 5-15 mmHg on RA';
  }

  // 6. Devine PBW & ARDS Tidal Volume Target (6-8 mL/kg)
  let pbwKg = null;
  let vt6Ml = null;
  let vt8Ml = null;
  let pbwNote = 'Requires Height (cm) and Sex (M/F)';
  if (nHt !== null && normSex) {
    const base = normSex === 'M' ? 50 : 45.5;
    pbwKg = roundTo(base + 0.91 * (nHt - 152.4), 1);
    vt6Ml = Math.round(pbwKg * 6);
    vt8Ml = Math.round(pbwKg * 8);
    pbwNote = `6-8 mL/kg PBW = ${vt6Ml}-${vt8Ml} mL`;
  }

  return {
    anionGap: { status: agStatus, value: anionGap, correctedAg, deltaDelta, note: agNote },
    correctedNa: { status: correctedNa !== null ? 'OK' : 'NOT_AVAILABLE', value: correctedNa, note: correctedNaNote },
    correctedCa: { status: correctedCa !== null ? 'OK' : 'NOT_AVAILABLE', value: correctedCa, note: correctedCaNote },
    pfRatio: { status: pfRatio !== null ? 'OK' : 'NOT_AVAILABLE', value: pfRatio, band: pfBand, note: pfNote },
    aaGradient: { status: aaGradient !== null ? 'OK' : 'NOT_AVAILABLE', value: aaGradient, expectedNormal: expectedAa, note: aaNote },
    pbwArds: { status: pbwKg !== null ? 'OK' : 'NOT_AVAILABLE', pbwKg, vt6Ml, vt8Ml, note: pbwNote },
  };
}

/**
 * RCP UK NEWS2 (National Early Warning Score 2)
 */
export function calculateNEWS2({
  rr = null,
  spo2 = null,
  onO2 = false,
  scale2 = false,
  sbp = null,
  hr = null,
  tempC = null,
  consciousness = 'A', // A | C | V | P | U
} = {}) {
  const nRr = parsePositiveNumber(rr, 1, 80);
  const nSpo2 = parsePositiveNumber(spo2, 30, 100);
  const nSbp = parsePositiveNumber(sbp, 20, 320);
  const nHr = parsePositiveNumber(hr, 10, 300);
  const nTemp = parsePositiveNumber(tempC, 25, 45);
  const avpu = String(consciousness || 'A').trim().toUpperCase();

  const missing = [];
  if (nRr === null) missing.push('RR');
  if (nSpo2 === null) missing.push('SpO2');
  if (nSbp === null) missing.push('SBP');
  if (nHr === null) missing.push('HR');
  if (nTemp === null) missing.push('Temp (°C)');

  const breakdown = [];
  let total = 0;
  let singleThree = false;
  const addPart = (label, pts) => {
    total += pts;
    if (pts === 3) singleThree = true;
    breakdown.push(`${label}: +${pts}`);
  };

  if (nRr !== null) {
    let pts = 0;
    if (nRr <= 8 || nRr >= 25) pts = 3;
    else if (nRr >= 21) pts = 2;
    else if (nRr <= 11) pts = 1;
    addPart(`RR ${nRr}`, pts);
  }

  if (nSpo2 !== null) {
    let pts = 0;
    if (scale2) {
      if (nSpo2 <= 83) pts = 3;
      else if (nSpo2 <= 85) pts = 2;
      else if (nSpo2 <= 87) pts = 1;
      else if (nSpo2 <= 92 || !onO2) pts = 0;
      else if (nSpo2 <= 94) pts = 1;
      else if (nSpo2 <= 96) pts = 2;
      else pts = 3;
    } else {
      if (nSpo2 <= 91) pts = 3;
      else if (nSpo2 <= 93) pts = 2;
      else if (nSpo2 <= 95) pts = 1;
      else pts = 0;
    }
    addPart(`SpO2 ${nSpo2}%`, pts);
  }

  addPart(onO2 ? 'Supp O2: Yes' : 'Room Air', onO2 ? 2 : 0);

  if (nTemp !== null) {
    let pts = 0;
    if (nTemp <= 35.0) pts = 3;
    else if (nTemp >= 39.1) pts = 2;
    else if (nTemp <= 36.0 || nTemp >= 38.1) pts = 1;
    addPart(`Temp ${nTemp}C`, pts);
  }

  if (nSbp !== null) {
    let pts = 0;
    if (nSbp <= 90 || nSbp >= 220) pts = 3;
    else if (nSbp <= 100) pts = 2;
    else if (nSbp <= 110) pts = 1;
    addPart(`SBP ${nSbp}`, pts);
  }

  if (nHr !== null) {
    let pts = 0;
    if (nHr <= 40 || nHr >= 131) pts = 3;
    else if (nHr >= 111) pts = 2;
    else if (nHr <= 50 || nHr >= 91) pts = 1;
    addPart(`HR ${nHr}`, pts);
  }

  addPart(`ACVPU: ${avpu}`, avpu === 'A' ? 0 : 3);

  let risk = 'Low (0-4)';
  let response = 'Ward monitoring q4-6h';
  if (total >= 7) {
    risk = 'High (>= 7)';
    response = 'Urgent critical care / senior team review + continuous monitoring';
  } else if (total >= 5 || singleThree) {
    risk = singleThree && total < 5 ? 'Low-Medium (single 3)' : 'Medium (5-6)';
    response = 'Urgent clinician review + hourly obs';
  }

  return {
    name: 'NEWS2',
    score: missing.length ? null : total,
    partialScore: total,
    missing,
    singleThree,
    risk: missing.length ? `Incomplete (${missing.join(', ')} needed)` : risk,
    summary: missing.length ? `Partial NEWS2 ${total} (missing ${missing.join(', ')})` : `NEWS2 ${total} (${risk}) — ${response}`,
    breakdown,
  };
}

export function calculateQSOFA({ rr = null, sbp = null, alteredMentalStatus = false } = {}) {
  const nRr = parsePositiveNumber(rr, 1, 80);
  const nSbp = parsePositiveNumber(sbp, 20, 320);
  const missing = [];
  if (nRr === null) missing.push('RR');
  if (nSbp === null) missing.push('SBP');

  const ptsRr = nRr !== null && nRr >= 22 ? 1 : 0;
  const ptsSbp = nSbp !== null && nSbp <= 100 ? 1 : 0;
  const ptsAms = alteredMentalStatus ? 1 : 0;
  const score = ptsRr + ptsSbp + ptsAms;
  const highRisk = score >= 2;
  const breakdown = [
    `RR >= 22 (${nRr ?? '—'}): +${ptsRr}`,
    `SBP <= 100 (${nSbp ?? '—'}): +${ptsSbp}`,
    `Altered mentation (GCS < 15): +${ptsAms}`,
  ];
  return {
    name: 'qSOFA',
    score: missing.length ? null : score,
    missing,
    risk: highRisk ? 'High risk (>= 2)' : 'Low risk (0-1)',
    summary: missing.length
      ? `qSOFA partial ${score}/3 (missing ${missing.join(', ')})`
      : `qSOFA ${score}/3 (${highRisk ? 'Sepsis high-risk >= 2' : 'Below >= 2 threshold'})`,
    breakdown,
  };
}

export function calculateCURB65({
  confusion = false,
  bunMgDl = null,
  rr = null,
  sbp = null,
  dbp = null,
  age = null,
} = {}) {
  const nBun = parsePositiveNumber(bunMgDl, 0.5, 300);
  const nRr = parsePositiveNumber(rr, 1, 80);
  const nSbp = parsePositiveNumber(sbp, 20, 320);
  const nDbp = parsePositiveNumber(dbp, 10, 220);
  const nAge = parsePositiveNumber(age, 1, 120);

  const missing = [];
  if (nBun === null) missing.push('BUN');
  if (nRr === null) missing.push('RR');
  if (nSbp === null && nDbp === null) missing.push('BP');
  if (nAge === null) missing.push('Age');

  const pC = confusion ? 1 : 0;
  const pU = nBun !== null && nBun > 19 ? 1 : 0; // BUN > 19 mg/dL (> 7 mmol/L)
  const pR = nRr !== null && nRr >= 30 ? 1 : 0;
  const pB = (nSbp !== null && nSbp < 90) || (nDbp !== null && nDbp <= 60) ? 1 : 0;
  const p65 = nAge !== null && nAge >= 65 ? 1 : 0;
  const score = pC + pU + pR + pB + p65;
  const risk = score >= 3 ? 'High (consider ICU)' : score === 2 ? 'Moderate (inpatient admission)' : 'Low (outpatient consideration)';
  return {
    name: 'CURB-65',
    score: missing.length ? null : score,
    missing,
    risk,
    summary: missing.length ? `CURB-65 partial ${score}/5 (missing ${missing.join(', ')})` : `CURB-65 ${score}/5 — ${risk}`,
    breakdown: [
      `Confusion: +${pC}`,
      `BUN > 19 mg/dL (${nBun ?? '—'}): +${pU}`,
      `RR >= 30 (${nRr ?? '—'}): +${pR}`,
      `BP < 90 or <= 60 (${nSbp ?? '—'}/${nDbp ?? '—'}): +${pB}`,
      `Age >= 65 (${nAge ?? '—'}): +${p65}`,
    ],
  };
}

export function calculateMELDNa({
  crMgDl = null,
  tbiliMgDl = null,
  inr = null,
  na = null,
  dialysis = false,
} = {}) {
  const rawCr = parsePositiveNumber(crMgDl, 0.1, 30);
  const rawBili = parsePositiveNumber(tbiliMgDl, 0.1, 80);
  const rawInr = parsePositiveNumber(inr, 0.5, 20);
  const rawNa = parsePositiveNumber(na, 100, 180);

  const missing = [];
  if (rawCr === null && !dialysis) missing.push('SCr');
  if (rawBili === null) missing.push('Total Bili');
  if (rawInr === null) missing.push('INR');
  if (rawNa === null) missing.push('Na');

  if (missing.length) {
    return {
      name: 'MELD-Na',
      score: null,
      missing,
      risk: `Missing ${missing.join(', ')}`,
      summary: `MELD-Na incomplete (missing ${missing.join(', ')})`,
      breakdown: [],
    };
  }

  let cr = dialysis ? 4.0 : Math.max(1.0, Math.min(4.0, rawCr));
  if (rawCr !== null && rawCr > 4.0) cr = 4.0;
  const bili = Math.max(1.0, rawBili);
  const inrVal = Math.max(1.0, rawInr);
  const naVal = Math.max(125, Math.min(137, rawNa));

  const meldRaw = 3.78 * Math.log(bili) + 11.2 * Math.log(inrVal) + 9.57 * Math.log(cr) + 6.43;
  const meld = Math.round(meldRaw);
  let meldNa = meld;
  if (meld > 11) {
    meldNa = Math.round(meld + 1.32 * (137 - naVal) - 0.033 * meld * (137 - naVal));
  }
  const finalScore = Math.max(6, Math.min(40, meldNa));
  const risk = finalScore >= 30 ? 'Critical (>= 30)' : finalScore >= 20 ? 'High (20-29)' : finalScore >= 10 ? 'Moderate (10-19)' : 'Low (< 10)';

  return {
    name: 'MELD-Na',
    score: finalScore,
    meldBase: Math.max(6, Math.min(40, meld)),
    missing: [],
    risk,
    summary: `MELD-Na ${finalScore} (MELD(i) ${Math.max(6, Math.min(40, meld))}) — ${risk}`,
    breakdown: [
      `Cr clamped: ${cr} mg/dL${dialysis ? ' (Dialysis 2x/wk = 4.0)' : ''}`,
      `Bili clamped: ${bili} mg/dL`,
      `INR clamped: ${inrVal}`,
      `Na clamped: ${naVal} mEq/L`,
    ],
  };
}

export function calculateCHA2DS2VASc({
  chf = false,
  htn = false,
  age = null,
  dm = false,
  strokeTia = false,
  vascular = false,
  female = false,
} = {}) {
  const nAge = parsePositiveNumber(age, 1, 120) || 0;
  const pAge = nAge >= 75 ? 2 : nAge >= 65 ? 1 : 0;
  const score =
    (chf ? 1 : 0) +
    (htn ? 1 : 0) +
    pAge +
    (dm ? 1 : 0) +
    (strokeTia ? 2 : 0) +
    (vascular ? 1 : 0) +
    (female ? 1 : 0);

  const nonSexPoints = score - (female ? 1 : 0);
  const risk =
    nonSexPoints >= 2
      ? 'Oral anticoagulation recommended'
      : nonSexPoints === 1
        ? 'Consider oral anticoagulation'
        : 'Low thromboembolic risk';
  return {
    name: 'CHA2DS2-VASc',
    score,
    missing: [],
    risk,
    summary: `CHA2DS2-VASc ${score}/9 — ${risk}`,
    breakdown: [
      `CHF: +${chf ? 1 : 0}`,
      `Hypertension: +${htn ? 1 : 0}`,
      `Age ${nAge || '—'}: +${pAge}`,
      `Diabetes: +${dm ? 1 : 0}`,
      `Stroke/TIA/TE: +${strokeTia ? 2 : 0}`,
      `Vascular disease: +${vascular ? 1 : 0}`,
      `Female sex category: +${female ? 1 : 0}`,
    ],
  };
}

export function calculateHASBLED({
  htnUncontrolled = false,
  abnormalRenal = false,
  abnormalLiver = false,
  stroke = false,
  bleeding = false,
  labileInr = false,
  ageOver65 = false,
  drugs = false,
  alcohol = false,
} = {}) {
  const score =
    (htnUncontrolled ? 1 : 0) +
    (abnormalRenal ? 1 : 0) +
    (abnormalLiver ? 1 : 0) +
    (stroke ? 1 : 0) +
    (bleeding ? 1 : 0) +
    (labileInr ? 1 : 0) +
    (ageOver65 ? 1 : 0) +
    (drugs ? 1 : 0) +
    (alcohol ? 1 : 0);
  const risk = score >= 3 ? 'High bleed risk (>= 3) — address modifiable factors' : 'Low-Moderate bleed risk (0-2)';
  return {
    name: 'HAS-BLED',
    score,
    missing: [],
    risk,
    summary: `HAS-BLED ${score}/9 — ${risk}`,
    breakdown: [
      `Uncontrolled HTN (SBP >160): +${htnUncontrolled ? 1 : 0}`,
      `Abnormal renal function: +${abnormalRenal ? 1 : 0}`,
      `Abnormal liver function: +${abnormalLiver ? 1 : 0}`,
      `Stroke history: +${stroke ? 1 : 0}`,
      `Prior major bleeding/predisposition: +${bleeding ? 1 : 0}`,
      `Labile INR: +${labileInr ? 1 : 0}`,
      `Age > 65: +${ageOver65 ? 1 : 0}`,
      `Antiplatelets / NSAIDs: +${drugs ? 1 : 0}`,
      `Alcohol use (>= 8 drinks/wk): +${alcohol ? 1 : 0}`,
    ],
  };
}

export function calculateWellsPE({
  dvtSigns = false,
  peMostLikely = false,
  hrOver100 = false,
  immobSurgery = false,
  prevDvtPe = false,
  hemoptysis = false,
  malignancy = false,
} = {}) {
  const score = roundTo(
    (dvtSigns ? 3 : 0) +
      (peMostLikely ? 3 : 0) +
      (hrOver100 ? 1.5 : 0) +
      (immobSurgery ? 1.5 : 0) +
      (prevDvtPe ? 1.5 : 0) +
      (hemoptysis ? 1 : 0) +
      (malignancy ? 1 : 0),
    1
  );
  const risk = score > 4 ? 'PE Likely (> 4.0) — CTPA recommended' : 'PE Unlikely (<= 4.0) — consider D-dimer / PERC';
  return {
    name: 'Wells PE',
    score,
    missing: [],
    risk,
    summary: `Wells PE ${score} — ${risk}`,
    breakdown: [
      `Clinical signs of DVT (+3): ${dvtSigns ? '3' : '0'}`,
      `PE is #1 / equally likely (+3): ${peMostLikely ? '3' : '0'}`,
      `HR > 100 bpm (+1.5): ${hrOver100 ? '1.5' : '0'}`,
      `Immobilization / surgery <=4w (+1.5): ${immobSurgery ? '1.5' : '0'}`,
      `Prior DVT/PE (+1.5): ${prevDvtPe ? '1.5' : '0'}`,
      `Hemoptysis (+1): ${hemoptysis ? '1' : '0'}`,
      `Active malignancy (+1): ${malignancy ? '1' : '0'}`,
    ],
  };
}

export function calculateWellsDVT({
  activeCancer = false,
  paralysisImmob = false,
  bedriddenSurgery = false,
  localizedTenderness = false,
  entireLegSwollen = false,
  calfSwelling3cm = false,
  pittingEdema = false,
  collateralVeins = false,
  prevDvt = false,
  altDxLikely = false,
} = {}) {
  const score =
    (activeCancer ? 1 : 0) +
    (paralysisImmob ? 1 : 0) +
    (bedriddenSurgery ? 1 : 0) +
    (localizedTenderness ? 1 : 0) +
    (entireLegSwollen ? 1 : 0) +
    (calfSwelling3cm ? 1 : 0) +
    (pittingEdema ? 1 : 0) +
    (collateralVeins ? 1 : 0) +
    (prevDvt ? 1 : 0) +
    (altDxLikely ? -2 : 0);
  const risk = score >= 2 ? 'DVT Likely (>= 2) — venous duplex ultrasound' : 'DVT Unlikely (< 2) — consider D-dimer';
  return {
    name: 'Wells DVT',
    score,
    missing: [],
    risk,
    summary: `Wells DVT ${score} — ${risk}`,
    breakdown: [
      `Active cancer (+1): ${activeCancer ? '1' : '0'}`,
      `Paralysis/paresis/immobilization (+1): ${paralysisImmob ? '1' : '0'}`,
      `Bedridden >3d / major surgery <=12w (+1): ${bedriddenSurgery ? '1' : '0'}`,
      `Deep venous tenderness (+1): ${localizedTenderness ? '1' : '0'}`,
      `Entire leg swollen (+1): ${entireLegSwollen ? '1' : '0'}`,
      `Calf swelling >3cm (+1): ${calfSwelling3cm ? '1' : '0'}`,
      `Pitting edema (+1): ${pittingEdema ? '1' : '0'}`,
      `Collateral superficial veins (+1): ${collateralVeins ? '1' : '0'}`,
      `Previous DVT (+1): ${prevDvt ? '1' : '0'}`,
      `Alternative dx at least as likely (-2): ${altDxLikely ? '-2' : '0'}`,
    ],
  };
}
