// On-device deterministic clinical calculators & guideline pre-pass audits
// Strictly follows CLINICAL-WORKFLOW-STE.md §8 and §11. Pure local computation — zero network calls.

import { parseChart, metaOf, getTodayDateStrings } from './census.js';

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

/**
 * Deterministic extractor for age, sex, weight, creatinine, K, Plt, charted eGFR/CrCl, and active meds.
 * Honors CLINICAL-WORKFLOW-STE.md §11 (never converts units or invents missing inputs).
 */
export function extractClinicalInputs(content, note = {}, options = {}) {
  const text = String(content || '');
  const meta = metaOf(text);
  const parsed = parseChart(text, note);

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

  const age = parsePositiveNumber(parsed.age || meta.age, 1, 120);
  const sex = normalizeSex(parsed.sex || meta.sex || meta.gender);

  // 1. Weight extraction: YAML frontmatter first, then dated chart blocks newest-to-oldest
  let weight = null;
  const fmWeightRaw =
    parsed.weight || meta.weight || meta.wt || meta.weight_kg || meta['weight (kg)'] || '';
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

  const dateSectionsDesc = splitChartDateSections(text).reverse();

  if (!weight) {
    const wtRe =
      /(?:^|[\s|;,])(?:Actual\s+|Current\s+|Dosing\s+)?(?:Weight|Wt|ABW|BW)\s*(?:[:=]|is)\s*(\d+(?:\.\d+)?)\s*(kg|kgs|lbs?)?\b/i;
    for (const sec of dateSectionsDesc) {
      const shiftsDesc = splitShiftChunks(sec.text).reverse();
      for (const blk of shiftsDesc) {
        const lines = blk.split('\n').reverse();
        for (const rawLine of lines) {
          const m = rawLine.match(wtRe);
          if (!m) continue;
          const unit = (m[2] || '').toLowerCase();
          const ageDays = sec.date ? daysBetweenDates(sec.date, todayStr) : null;
          const stale = ageDays !== null && ageDays > maxWeightAgeDays;
          if (unit === 'lb' || unit === 'lbs') {
            weight = {
              valueKg: null,
              invalidUnit: true,
              raw: m[0].trim(),
              source: 'chart',
              date: sec.date || 'Undated',
              ageDays,
              stale,
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
                stale,
              };
            }
          }
          if (weight) break;
        }
        if (weight) break;
      }
      if (weight) break;
    }
  }

  // 2. Creatinine, Potassium, Platelets & Charted eGFR/CrCl (newest shift -> oldest)
  let creatinine = null;
  let potassium = null;
  let platelets = null;
  let chartedEgfr = null;
  let chartedCrCl = null;

  const crRe =
    /\b(Creatinine|Creat|Crea|SCr|Cr|CR)\b\s*(?:[:=]|\s+is\s+|\s+)\s*(\d+(?:\.\d+)?)\s*(H|L)?\s*(µmol\/?L|umol\/?L|mmol\/?L|mg\/dL|mg%|mg)?/gi;
  const kRe =
    /\b(Potassium|K)\b(?!\s*(?:Cl|mEq|tabs?|mg|IV|PO|PNGT))\s*(?:[:=]|\s+)\s*(\d+(?:\.\d+)?)(?:\s*(H|L))?\b/gi;
  const pltRe = /\b(Platelets?|Plt)\b\s*(?:[:=]|\s+)\s*(\d+(?:\.\d+)?)\b/gi;
  const egfrRe = /\beGFR\b\s*(?:[:=]|\s+is\s+|\s+)\s*(\d+(?:\.\d+)?)\b/i;
  const crclRe = /\bCrCl\b\s*(?:[:=]|\s+is\s+|\s+)\s*(\d+(?:\.\d+)?)\b/i;

  for (const sec of dateSectionsDesc) {
    const ageDays = sec.date ? daysBetweenDates(sec.date, todayStr) : null;
    const shiftsDesc = splitShiftChunks(sec.text).reverse();

    for (const blk of shiftsDesc) {
      const linesDesc = blk.split('\n').reverse();
      for (const rawLine of linesDesc) {
        const trimmed = rawLine.trim();
        if (!trimmed || /^#{2,3}\s+/.test(trimmed)) continue;

        if (!chartedEgfr) {
          const egMatch = trimmed.match(egfrRe);
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
          const ccMatch = trimmed.match(crclRe);
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

        if (isNonLabLineForClinical(trimmed)) continue;

        if (!creatinine) {
          crRe.lastIndex = 0;
          let m;
          let lineCr = null;
          while ((m = crRe.exec(trimmed)) !== null) {
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
            lineCr = {
              value: num,
              unit: umolOnLine ? unit || 'umol/L' : unit || 'mg/dL',
              invalidUnit: umolOnLine,
              date: sec.date || 'Undated',
              ageDays,
              stale,
            };
          }
          if (lineCr) creatinine = lineCr;
        }

        if (!potassium && !/\b(?:Vit(?:amin)?\s+K|KCl)\b/i.test(trimmed)) {
          kRe.lastIndex = 0;
          let km;
          let lineK = null;
          while ((km = kRe.exec(trimmed)) !== null) {
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
          pltRe.lastIndex = 0;
          let pm;
          let linePlt = null;
          while ((pm = pltRe.exec(trimmed)) !== null) {
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
  }

  // 3. Active meds / drips from latest date block
  const medLines = [];
  const medSeen = new Set();
  const latestBlk = parsed.latestDateBlock || text;
  let inMedsOrPlans = false;
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

    const stoppedRe = /\b(?:discontinued|d\/c|stopped|completed)\b|\bheld\b(?!\s*for\b)/i;
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

  const ov = options.overrides || {};
  const finalAge = parsePositiveNumber(ov.age, 1, 120) ?? age;
  const finalSex = normalizeSex(ov.sex) || sex;

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
      : weight;

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
      : creatinine;

  return {
    parsed,
    todayStr,
    age: finalAge,
    sex: finalSex,
    weight: finalWeight,
    creatinine: finalCr,
    potassium,
    platelets,
    chartedEgfr,
    chartedCrCl,
    medLines,
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
