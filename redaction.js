// PHI redaction engine — pure, on-device, no network.
// Rule: strip patient NAME; keep ROOM. Nothing leaves the phone until the
// user confirms the preview and the guard reports zero leaks.

const NAME_FIELDS = /^(?:name|patient|patient_name|patientname|fullname|subject|client|pt)\s*:/i;
const NAME_FIELDS_MULTILINE = /^(?:name|patient|patient_name|patientname|fullname|subject|client|pt)\s*:/im;
const ROOM_KEYS = /^(?:room|rm|bed|ward|location)\s*:/i;
const ROOM_TOKEN = /\b(?:room|rm\.?|bed|ward)\s*#?\s*\d+[A-Za-z]?(?:\s*[-/]\s*\d+[A-Za-z]?)?/gi;
const SUFFIXES = /\b(?:jr\.?|sr\.?|ii|iii|iv|md|phd|esq\.?)\b/giu;

const LB = '(?<![\\p{L}\\p{N}])';
const RB = '(?![\\p{L}\\p{N}])';
const SEP = '[\\s,.\'-]*';
const TOKEN = '[\\p{L}\\p{N}]+';
const VARIANT_CACHE_MAX = 64;
const nameVariantsCache = new Map();

export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokensOf(value) {
  return String(value || '')
    .replace(SUFFIXES, ' ')
    .replace(/[^\p{L}\p{N}\s.'-]/gu, ' ')
    .trim()
    .split(/[\s.'-]+/u)
    .filter(Boolean);
}

function compileNameVariants(name, aliases = []) {
  const names = [name, ...(Array.isArray(aliases) ? aliases : [aliases])]
    .filter((v) => typeof v === 'string' && v.trim());
  if (!names.length) return [];

  const cacheKey = JSON.stringify(names);
  const cached = nameVariantsCache.get(cacheKey);
  if (cached) return cached;

  const out = [];
  const push = (label, re) => out.push({ label, re });

  for (const raw of names) {
    const t = tokensOf(raw);
    if (!t.length) continue;

    push(raw, new RegExp(`${LB}${t.map(escapeRe).join(SEP)}${RB}`, 'giu'));
    if (t.length > 1) {
      const rev = [...t].reverse().map(escapeRe).join(SEP);
      push(`${raw} (reversed)`, new RegExp(`${LB}${rev}${RB}`, 'giu'));
      const initials = t.map((x) => escapeRe(x[0])).join(SEP);
      if (t.length >= 2) push(`${raw} (initials)`, new RegExp(`${LB}${initials}${RB}`, 'giu'));
    }
    for (const tok of t) {
      if (tok.length >= 3) push(`${raw} (token)`, new RegExp(`${LB}${escapeRe(tok)}${RB}`, 'giu'));
    }
  }

  if (nameVariantsCache.size >= VARIANT_CACHE_MAX) {
    nameVariantsCache.delete(nameVariantsCache.keys().next().value);
  }
  nameVariantsCache.set(cacheKey, out);
  return out;
}

/** All case/spacing/punctuation variants we will look for. */
export function buildNameVariants(name, aliases = []) {
  return compileNameVariants(name, aliases).slice();
}

function frontmatterValueRanges(text) {
  if (!NAME_FIELDS_MULTILINE.test(text)) return [];
  const lines = text.split('\n');
  let inFront = false;
  let offset = 0;
  const ranges = [];
  for (const line of lines) {
    if (/^---\s*$/.test(line)) {
      inFront = !inFront;
      offset += line.length + 1;
      continue;
    }
    if (inFront && NAME_FIELDS.test(line) && !ROOM_KEYS.test(line)) {
      const m = line.match(/^(\s*[^:]+:\s*)(.+)$/);
      if (m) {
        const value = m[2].trim().replace(/^["']|["']$/g, '');
        if (value && !/^\[(?:PATIENT|REDACTED)/i.test(value)) {
          ranges.push({ start: offset + m[1].length, end: offset + line.length, label: 'frontmatter name field' });
        }
      }
    }
    offset += line.length + 1;
  }
  return ranges;
}

function scanRooms(text) {
  const ranges = [];
  const texts = [];
  ROOM_TOKEN.lastIndex = 0;
  let m;
  while ((m = ROOM_TOKEN.exec(text)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length });
    texts.push(m[0]);
  }
  return { ranges, texts };
}

const overlaps = (a, b, list) => list.some((r) => a < r.end && b > r.start);

function findLeaksWithVariants(text, variants) {
  const str = String(text ?? '');
  const leaks = [];
  for (const { label, re } of variants) {
    re.lastIndex = 0;
    const found = re.exec(str);
    if (found) leaks.push({ label, value: found[0] });
  }
  return leaks;
}

/**
 * Redact a markdown note. Returns the safe text plus an audit report.
 * Room tokens are protected from all replacements.
 */
export function redact(markdown, profile = {}, options = {}) {
  const text = String(markdown ?? '');
  const name = profile.name || '';
  const aliases = profile.aliases || [];
  const replacement = options.replacement || '[PATIENT]';
  const keepRooms = options.keepRooms !== false;
  const { ranges: rooms, texts: roomTexts } = scanRooms(text);
  const protectedRanges = keepRooms ? rooms : [];
  const variants = compileNameVariants(name, aliases);

  const candidates = [];
  for (const { label, re } of variants) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      candidates.push({ start: m.index, end: m.index + m[0].length, label, original: m[0] });
    }
  }
  for (const r of frontmatterValueRanges(text)) {
    candidates.push({ ...r, original: text.slice(r.start, r.end), label: 'frontmatter name field' });
  }

  candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

  const accepted = [];
  const taken = [];
  for (const c of candidates) {
    if (c.start === c.end) continue;
    if (overlaps(c.start, c.end, protectedRanges) || overlaps(c.start, c.end, taken)) continue;
    accepted.push(c);
    taken.push({ start: c.start, end: c.end });
  }

  let out = '';
  let cursor = 0;
  for (const c of accepted) {
    out += text.slice(cursor, c.start) + replacement;
    cursor = c.end;
  }
  out += text.slice(cursor);

  return {
    text: out,
    report: {
      replacements: accepted.map(({ label, original }) => ({ label, original })),
      rooms: roomTexts,
      leaks: findLeaksWithVariants(out, variants),
    },
  };
}

/** Patterns that must NOT be present in outgoing text. Empty = safe to send. */
export function findLeaks(text, profile = {}) {
  return findLeaksWithVariants(text, compileNameVariants(profile.name || '', profile.aliases || []));
}

/** A safe filename: patient name never appears, room is kept. */
export function redactFilename(filename, profile = {}) {
  const room = (String(filename).match(ROOM_TOKEN) || String(profile.room || '').match(ROOM_TOKEN) || [''])[0];
  const ext = (String(filename).match(/\.[A-Za-z0-9]+$/) || ['.md'])[0];
  return `patient-note${room ? `-${room.replace(/^rm\.?\s*/i, '').replace(/\s+/g, '-')}` : ''}${ext}`;
}

/** Build the final payload sent to the companion. Never call this with unredacted text. */
export function buildPayload(redactedMarkdown, question, profile = {}) {
  const safe = String(redactedMarkdown ?? '');
  const q = String(question ?? '').trim();
  const leaks = findLeaks(`${safe}\n${q}`, profile);
  if (leaks.length) throw new Error(`PHI guard blocked send: ${leaks.map((x) => x.value).join(', ')}`);
  return `You are a clinical companion. The patient's NAME has been removed; the ROOM is kept so the team can locate the chart. Do not infer identity from room numbers.\n\n--- PATIENT NOTE (de-identified) ---\n${safe}\n--- END NOTE ---\n\nQuestion: ${String(question ?? '').trim()}`;
}
