/**
 * Zero-dependency AI provider helpers for Kardex.
 * Supports native Google Gemini REST endpoints and OpenAI-compatible endpoints.
 */

export const GEMINI_DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: '2.5 Flash (Free)' },
  { id: 'gemini-2.5-pro', label: '2.5 Pro' },
];

export const AI_PRESETS = {
  gemini: {
    id: 'gemini',
    label: 'Google Gemini',
    endpoint: GEMINI_DEFAULT_ENDPOINT,
    model: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza... (paste Gemini API key)',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    keyPlaceholder: 'sk-... (paste OpenAI API key)',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    endpoint: '',
    model: '',
    keyPlaceholder: 'paste key',
  },
};

function trimTrailingSlashes(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function isGeminiEndpoint(endpoint) {
  const clean = trimTrailingSlashes(endpoint);
  if (!clean) return false;
  try {
    const parsed = new URL(clean);
    return parsed.protocol === 'https:' && parsed.hostname.toLowerCase() === 'generativelanguage.googleapis.com';
  } catch {
    return /^https:\/\/generativelanguage\.googleapis\.com(?:\/|$)/i.test(clean);
  }
}

export function detectAiPreset(endpoint) {
  const clean = trimTrailingSlashes(endpoint);
  if (isGeminiEndpoint(clean)) return 'gemini';
  if (clean.toLowerCase() === 'https://api.openai.com/v1') return 'openai';
  return 'custom';
}

export function normalizeGeminiEndpoint(endpoint) {
  let clean = trimTrailingSlashes(endpoint);
  if (!clean) return GEMINI_DEFAULT_ENDPOINT;
  clean = clean.replace(/\/openai$/i, '');
  if (/^https:\/\/generativelanguage\.googleapis\.com$/i.test(clean)) {
    return GEMINI_DEFAULT_ENDPOINT;
  }
  if (/\/v1$/i.test(clean)) {
    return clean;
  }
  if (/\/v1beta$/i.test(clean)) {
    return clean;
  }
  return GEMINI_DEFAULT_ENDPOINT;
}

export function normalizeGeminiModel(model) {
  return String(model || '')
    .trim()
    .replace(/^models\//i, '');
}

export function sanitizeAiErrorMessage(message, apiKey) {
  let out = String(message || 'Unknown error');
  const key = String(apiKey || '').trim();
  if (key.length >= 4) {
    out = out.split(key).join('[REDACTED]');
    const encodedKey = encodeURIComponent(key);
    if (encodedKey && encodedKey !== key) {
      out = out.split(encodedKey).join('[REDACTED]');
    }
  }
  return out.replace(/([?&]key=)[^&\s"']+/gi, '$1[REDACTED]');
}

export function buildAiChatRequest({ endpoint, model, apiKey, prompt, temperature }) {
  const cleanKey = String(apiKey || '').trim();
  const cleanPrompt = String(prompt || '');
  if (isGeminiEndpoint(endpoint)) {
    const base = normalizeGeminiEndpoint(endpoint);
    const cleanModel = normalizeGeminiModel(model) || AI_PRESETS.gemini.model;
    const body = {
      contents: [{ role: 'user', parts: [{ text: cleanPrompt }] }],
    };
    if (typeof temperature === 'number') {
      body.generationConfig = { temperature };
    }
    return {
      provider: 'gemini',
      url: `${base}/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(cleanKey)}`,
      options: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    };
  }

  const base = trimTrailingSlashes(endpoint);
  const body = {
    model: String(model || '').trim(),
    messages: [{ role: 'user', content: cleanPrompt }],
  };
  if (typeof temperature === 'number') {
    body.temperature = temperature;
  }
  return {
    provider: 'openai',
    url: `${base}/chat/completions`,
    options: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cleanKey}`,
      },
      body: JSON.stringify(body),
    },
  };
}

export function buildAiTestRequest({ endpoint, model, apiKey }) {
  const cleanKey = String(apiKey || '').trim();
  if (isGeminiEndpoint(endpoint)) {
    const base = normalizeGeminiEndpoint(endpoint);
    const cleanModel = normalizeGeminiModel(model);
    const path = cleanModel ? `/models/${encodeURIComponent(cleanModel)}` : '/models';
    return {
      provider: 'gemini',
      url: `${base}${path}?key=${encodeURIComponent(cleanKey)}`,
      options: { method: 'GET' },
    };
  }

  const base = trimTrailingSlashes(endpoint);
  return {
    provider: 'openai',
    url: `${base}/models`,
    options: {
      method: 'GET',
      headers: { Authorization: `Bearer ${cleanKey}` },
    },
  };
}

export function extractAiChatText(provider, data) {
  if (data?.error?.message) {
    throw new Error(data.error.message);
  }
  if (provider === 'gemini') {
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) {
      throw new Error(`Gemini blocked prompt (${blockReason})`);
    }
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    const text = Array.isArray(parts)
      ? parts
          .map((part) => (typeof part?.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('')
      : '';
    if (text) return text;
    const finishReason = candidate?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
      throw new Error(`Gemini response incomplete (${finishReason})`);
    }
    throw new Error('No response from Gemini model');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string' && content) return content;
  throw new Error('No response from model');
}

async function parseJsonSafe(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function callAiChat({ endpoint, model, apiKey, prompt, temperature, fetchImpl = fetch }) {
  const { provider, url, options } = buildAiChatRequest({ endpoint, model, apiKey, prompt, temperature });
  try {
    const res = await fetchImpl(url, options);
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      const apiMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(apiMsg);
    }
    return extractAiChatText(provider, data);
  } catch (err) {
    throw new Error(sanitizeAiErrorMessage(err?.message || err, apiKey));
  }
}

export async function testAiConnection({ endpoint, model, apiKey, fetchImpl = fetch }) {
  const { provider, url, options } = buildAiTestRequest({ endpoint, model, apiKey });
  const t0 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  try {
    const res = await fetchImpl(url, options);
    const data = await parseJsonSafe(res);
    if (!res.ok) {
      const apiMsg = data?.error?.message || `HTTP ${res.status}`;
      throw new Error(apiMsg);
    }
    const t1 = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    return {
      ok: true,
      provider,
      ms: Math.max(0, Math.round(t1 - t0)),
    };
  } catch (err) {
    throw new Error(sanitizeAiErrorMessage(err?.message || err, apiKey));
  }
}
