// On-device audio DSP, transcript cleanup, cache management & Web Worker bridge for Offline Whisper.
// Audio stays strictly in local browser memory — zero API keys or external audio uploads.

export const WHISPER_SAMPLE_RATE = 16000;
export const WHISPER_CACHE_NAME = 'transformers-cache';
export const WHISPER_RUNTIME_CACHE_NAME = 'companion-md-whisper-runtime';

export const WHISPER_MODELS = [
  {
    id: 'Xenova/whisper-tiny.en',
    shortLabel: 'Whisper Tiny · English',
    label: 'Whisper Tiny · English (~39 MB, Fast)',
    approxMb: 39,
  },
  {
    id: 'Xenova/whisper-base.en',
    shortLabel: 'Whisper Base · English',
    label: 'Whisper Base · English (~75 MB, Higher Accuracy)',
    approxMb: 75,
  },
  {
    id: 'Xenova/whisper-small.en',
    shortLabel: 'Whisper Small · English',
    label: 'Whisper Small · English (~150 MB, Best Clinical Accuracy)',
    approxMb: 150,
  },
];

/**
 * Averages one or more channel arrays into a single mono Float32Array.
 */
export function mixDownToMono(channels) {
  if (!channels) return new Float32Array(0);
  if (channels instanceof Float32Array) {
    return new Float32Array(channels);
  }
  const list = [...channels].filter((ch) => ch && ch.length > 0);
  if (list.length === 0) return new Float32Array(0);
  if (list.length === 1) return Float32Array.from(list[0]);

  const len = list[0].length;
  const out = new Float32Array(len);
  const count = list.length;
  for (let i = 0; i < len; i++) {
    let sum = 0;
    for (let c = 0; c < count; c++) {
      sum += i < list[c].length ? list[c][i] : 0;
    }
    out[i] = sum / count;
  }
  return out;
}

/**
 * Deterministic linear interpolation resampler targeting 16 kHz PCM for Whisper.
 */
export function resampleLinear(samples, fromRate, toRate = WHISPER_SAMPLE_RATE) {
  if (!samples || !samples.length) return new Float32Array(0);
  if (!Number.isFinite(fromRate) || fromRate <= 0 || !Number.isFinite(toRate) || toRate <= 0) {
    throw new Error('Invalid sample rate for resampling');
  }
  if (fromRate === toRate) {
    return Float32Array.from(samples);
  }

  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(outLen);
  const lastSrc = samples.length - 1;

  for (let i = 0; i < outLen; i++) {
    const pos = Math.min(i * ratio, lastSrc);
    const idx = Math.floor(pos);
    const frac = pos - idx;
    const s0 = samples[idx];
    const s1 = idx + 1 <= lastSrc ? samples[idx + 1] : s0;
    out[i] = s0 + (s1 - s0) * frac;
  }
  return out;
}

/**
 * Clamps/scales hot audio peaks safely to [-1, 1] and detects silent recordings.
 */
export function normalizeAudioPcm(samples) {
  if (!samples || !samples.length) {
    return { pcm: new Float32Array(0), peak: 0, rms: 0, isSilent: true };
  }

  const n = samples.length;
  let peak = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(samples[i]) ? samples[i] : 0;
    const abs = Math.abs(v);
    if (abs > peak) peak = abs;
    sumSq += v * v;
  }

  const rms = Math.sqrt(sumSq / n);
  const scale = peak > 1 ? 1 / peak : 1;
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = Number.isFinite(samples[i]) ? samples[i] * scale : 0;
    pcm[i] = Math.max(-1, Math.min(1, v));
  }

  return {
    pcm,
    peak: peak * scale,
    rms: rms * scale,
    isSilent: rms < 1e-4,
  };
}

/**
 * Strips non-speech Whisper artifacts ([BLANK_AUDIO], (silence), etc.) without altering clinical numbers.
 */
export function cleanWhisperTranscript(rawText) {
  let text = String(rawText || '').replace(/\r\n/g, '\n');
  text = text.replace(
    /\[(?:BLANK_AUDIO|NO_SPEECH|MUSIC|APPLAUSE|LAUGHTER|NOISE|SILENCE|INAUDIBLE|BELL|COUGH)\]/gi,
    ' '
  );
  text = text.replace(
    /\((?:blank\s+audio|silence|music|inaudible|background\s+noise|no\s+audio)\)/gi,
    ' '
  );
  text = text
    .split('\n')
    .map((line) => line.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text;
}

/**
 * Merges incoming dictated text into an existing transcript without duplicating trailing text.
 */
export function mergeTranscriptText(existingText, incomingText) {
  const existing = String(existingText || '').trim();
  const incoming = cleanWhisperTranscript(incomingText);
  if (!incoming) return existing;
  if (!existing) return incoming;

  const exLower = existing.toLowerCase();
  const inLower = incoming.toLowerCase();
  if (exLower === inLower || exLower.endsWith(inLower)) {
    return existing;
  }
  if (inLower.startsWith(exLower)) {
    return incoming;
  }

  const sep = existing.includes('\n') || incoming.includes('\n') ? '\n' : ' ';
  return `${existing}${sep}${incoming}`;
}

/**
 * Maps worker model download progress events to percentage + concise UI label.
 */
export function formatWhisperProgress(ev = {}) {
  const status = String(ev.status || '').toLowerCase();
  const rawFile = String(ev.file || '');
  const shortFile = rawFile ? rawFile.split('/').pop() : 'model files';

  let pct = 0;
  if (typeof ev.progress === 'number' && Number.isFinite(ev.progress)) {
    pct = Math.max(0, Math.min(100, Math.round(ev.progress)));
  } else if (
    typeof ev.loaded === 'number' &&
    typeof ev.total === 'number' &&
    ev.total > 0
  ) {
    pct = Math.max(0, Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
  }

  if (status === 'ready') {
    return { pct: 100, label: 'Offline Whisper model ready' };
  }
  if (status === 'done') {
    return { pct: 100, label: `Cached ${shortFile}` };
  }
  if (status === 'initiate' || status === 'download') {
    return { pct, label: `Fetching ${shortFile}...` };
  }
  if (status === 'progress') {
    const mbInfo =
      typeof ev.loaded === 'number' && typeof ev.total === 'number' && ev.total > 0
        ? ` (${(ev.loaded / 1048576).toFixed(1)} / ${(ev.total / 1048576).toFixed(1)} MB)`
        : '';
    return { pct, label: `Downloading ${shortFile}: ${pct}%${mbInfo}` };
  }
  return { pct, label: 'Initializing Offline Whisper engine...' };
}

/**
 * Decodes a recorded or uploaded audio Blob into 16 kHz mono Float32 PCM entirely on-device.
 */
export async function decodeAudioBlobToPcm16k(blob) {
  if (!blob) throw new Error('No audio recording available');
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) {
    throw new Error('Web Audio API is unavailable in this browser');
  }

  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioCtx();
  let decoded;
  try {
    decoded = await audioCtx.decodeAudioData(arrayBuffer);
  } finally {
    try {
      await audioCtx.close();
    } catch {}
  }

  const durationSec = decoded.duration || 0;
  let resampledMono;

  const OfflineCtx = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  if (OfflineCtx && decoded.sampleRate !== WHISPER_SAMPLE_RATE) {
    try {
      const targetLen = Math.max(1, Math.ceil(durationSec * WHISPER_SAMPLE_RATE));
      const offline = new OfflineCtx(1, targetLen, WHISPER_SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0);
      const rendered = await offline.startRendering();
      resampledMono = rendered.getChannelData(0);
    } catch {
      resampledMono = null;
    }
  }

  if (!resampledMono) {
    const channels = [];
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      channels.push(decoded.getChannelData(ch));
    }
    const mono = mixDownToMono(channels);
    resampledMono =
      decoded.sampleRate === WHISPER_SAMPLE_RATE
        ? mono
        : resampleLinear(mono, decoded.sampleRate, WHISPER_SAMPLE_RATE);
  }

  const norm = normalizeAudioPcm(resampledMono);
  return {
    pcm: norm.pcm,
    sampleRate: WHISPER_SAMPLE_RATE,
    durationSec,
    isSilent: norm.isSilent,
  };
}

/**
 * Inspects local CacheStorage to see which Whisper models have cached ONNX weights (zero network).
 */
export async function getCachedWhisperModelIds(cachesApi = globalThis.caches) {
  if (!cachesApi) return [];
  try {
    const exists = await cachesApi.has(WHISPER_CACHE_NAME);
    if (!exists) return [];
    const cache = await cachesApi.open(WHISPER_CACHE_NAME);
    const reqs = await cache.keys();
    const urls = reqs.map((r) => r.url || '');
    return WHISPER_MODELS.filter((m) => {
      const modelUrls = urls.filter((u) => u.includes(m.id));
      const onnxUrls = modelUrls.filter((u) => /\.onnx/i.test(u));
      const hasEncoder = onnxUrls.some((u) => /encoder/i.test(u));
      const hasDecoder = onnxUrls.some((u) => /decoder/i.test(u));
      return (hasEncoder && hasDecoder) || onnxUrls.length >= 2;
    }).map((m) => m.id);
  } catch {
    return [];
  }
}

export async function clearWhisperModelCache(cachesApi = globalThis.caches) {
  if (!cachesApi) return false;
  try {
    const a = await cachesApi.delete(WHISPER_CACHE_NAME);
    const b = await cachesApi.delete(WHISPER_RUNTIME_CACHE_NAME);
    return Boolean(a || b);
  } catch {
    return false;
  }
}

export async function hasCachedWhisperRuntime(cachesApi = globalThis.caches) {
  if (!cachesApi) return false;
  try {
    const exists = await cachesApi.has(WHISPER_RUNTIME_CACHE_NAME);
    if (!exists) return false;
    const cache = await cachesApi.open(WHISPER_RUNTIME_CACHE_NAME);
    const reqs = await cache.keys();
    const urls = reqs.map((r) => r.url || '');
    return urls.some((u) => /@huggingface\/transformers/i.test(u));
  } catch {
    return false;
  }
}

export async function clearWhisperRuntimeCache(cachesApi = globalThis.caches) {
  if (!cachesApi) return false;
  try {
    return await cachesApi.delete(WHISPER_RUNTIME_CACHE_NAME);
  } catch {
    return false;
  }
}

/**
 * Lazy Web Worker controller for loading Whisper WASM weights and running local transcription.
 */
export function createWhisperController({ onStatus, onProgress } = {}) {
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  let status = 'idle'; // 'idle' | 'loading' | 'ready' | 'transcribing' | 'error'
  let activeModelId = null;
  const loadedModels = new Set();

  function setStatus(nextStatus, detail = '') {
    status = nextStatus;
    onStatus?.(status, detail);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker('./whisper.worker.js', { type: 'module' });
    worker.onmessage = (event) => {
      const msg = event.data || {};
      if (msg.type === 'progress') {
        onProgress?.(formatWhisperProgress(msg), msg);
        return;
      }

      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);

      if (msg.type === 'error') {
        setStatus('error', msg.message || 'Offline Whisper error');
        entry.reject(new Error(msg.message || 'Offline Whisper error'));
        return;
      }

      if (msg.type === 'ready') {
        loadedModels.clear();
        loadedModels.add(msg.modelId);
        activeModelId = msg.modelId;
        setStatus('ready', `Ready (${msg.modelId})`);
        entry.resolve({ modelId: msg.modelId });
        return;
      }

      if (msg.type === 'result') {
        loadedModels.clear();
        loadedModels.add(msg.modelId);
        activeModelId = msg.modelId;
        setStatus('ready', `Transcribed in ${(msg.elapsedMs / 1000).toFixed(1)}s`);
        entry.resolve({
          text: cleanWhisperTranscript(msg.text),
          rawText: msg.text || '',
          elapsedMs: msg.elapsedMs || 0,
          modelId: msg.modelId,
        });
        return;
      }

      if (msg.type === 'unloaded') {
        loadedModels.clear();
        activeModelId = null;
        setStatus('idle', 'Unloaded');
        entry.resolve(true);
      }
    };

    worker.onerror = (err) => {
      const msg = err?.message || 'Whisper worker failed to initialize';
      setStatus('error', msg);
      for (const entry of pending.values()) {
        entry.reject(new Error(msg));
      }
      pending.clear();
    };

    return worker;
  }

  function callWorker(payload, transferables = []) {
    const w = ensureWorker();
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      w.postMessage({ ...payload, id }, transferables);
    });
  }

  async function loadModel(modelId = WHISPER_MODELS[0].id) {
    setStatus('loading', `Loading ${modelId}...`);
    return callWorker({ type: 'load', modelId });
  }

  async function transcribePcm(pcm, modelId = WHISPER_MODELS[0].id) {
    if (!pcm || !pcm.length) {
      return { text: '', rawText: '', elapsedMs: 0, modelId };
    }
    const copy = new Float32Array(pcm);
    setStatus('transcribing', 'Transcribing audio on-device...');
    return callWorker({ type: 'transcribe', modelId, audio: copy }, [copy.buffer]);
  }

  async function transcribeBlob(blob, modelId = WHISPER_MODELS[0].id) {
    setStatus('transcribing', 'Decoding recorded audio...');
    let decoded;
    try {
      decoded = await decodeAudioBlobToPcm16k(blob);
    } catch (err) {
      const msg = err?.message || 'Could not decode recorded audio';
      setStatus('error', msg);
      throw err;
    }
    if (decoded.isSilent) {
      setStatus(loadedModels.has(modelId) ? 'ready' : 'idle', 'Recording appears silent');
      return { text: '', rawText: '', elapsedMs: 0, modelId, isSilent: true };
    }
    return transcribePcm(decoded.pcm, modelId);
  }

  async function unload() {
    const busy = status === 'loading' || status === 'transcribing';
    if (worker) {
      if (!busy) {
        try {
          await callWorker({ type: 'unload' });
        } catch {}
      }
      for (const entry of pending.values()) {
        entry.reject(new Error('Cancelled'));
      }
      pending.clear();
      worker.terminate();
      worker = null;
    }
    loadedModels.clear();
    activeModelId = null;
    setStatus('idle', '');
  }

  function getState() {
    return {
      status,
      activeModelId,
      loadedModels: [...loadedModels],
    };
  }

  return {
    loadModel,
    transcribePcm,
    transcribeBlob,
    unload,
    getState,
  };
}

/**
 * Encodes Float32 PCM audio into a 16 kHz mono 16-bit signed RIFF/WAVE Blob.
 */
export function encodeWav16kMono(samples, fromSampleRate = WHISPER_SAMPLE_RATE) {
  const mono = samples instanceof Float32Array ? samples : new Float32Array(samples || 0);
  const resampled =
    fromSampleRate === WHISPER_SAMPLE_RATE
      ? Float32Array.from(mono)
      : resampleLinear(mono, fromSampleRate, WHISPER_SAMPLE_RATE);
  const norm = normalizeAudioPcm(resampled);
  const pcm16k = norm.pcm;
  const numSamples = pcm16k.length;
  const dataBytes = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeStr = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // linear PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, WHISPER_SAMPLE_RATE, true);
  view.setUint32(28, WHISPER_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, pcm16k[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return {
    blob: new Blob([buffer], { type: 'audio/wav' }),
    pcm16k,
    durationSec: numSamples / WHISPER_SAMPLE_RATE,
    peak: norm.peak,
    rms: norm.rms,
    isSilent: norm.isSilent,
  };
}

/**
 * Creates a Web Audio PCM WAV recorder backed by ONE persistent AudioContext.
 * Call unlockAudioContext() synchronously inside a tap handler before any await.
 */
export function createPcmAudioRecorder({ onError } = {}) {
  let persistentCtx = null;
  let activeStream = null;
  let sourceNode = null;
  let analyserNode = null;
  let processorNode = null;
  let zeroGainNode = null;
  let pcmChunks = [];
  let recording = false;
  let sessionId = 0;

  function ensureAudioContext() {
    const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioCtx) throw new Error('Web Audio API is unavailable in this browser');
    if (!persistentCtx || persistentCtx.state === 'closed') {
      persistentCtx = new AudioCtx();
    }
    return persistentCtx;
  }

  function unlockAudioContext() {
    try {
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(() => {});
      }
      return ctx;
    } catch {
      return null;
    }
  }

  function teardownGraph() {
    if (processorNode) {
      try { processorNode.onaudioprocess = null; } catch {}
      try { processorNode.disconnect(); } catch {}
      processorNode = null;
    }
    if (zeroGainNode) {
      try { zeroGainNode.disconnect(); } catch {}
      zeroGainNode = null;
    }
    if (sourceNode) {
      try { sourceNode.disconnect(); } catch {}
      sourceNode = null;
    }
    if (analyserNode) {
      try { analyserNode.disconnect(); } catch {}
      analyserNode = null;
    }
    if (activeStream) {
      try {
        activeStream.getTracks().forEach((track) => {
          try { track.onended = null; } catch {}
          try { track.stop(); } catch {}
        });
      } catch {}
      activeStream = null;
    }
    if (persistentCtx && persistentCtx.state === 'running' && typeof persistentCtx.suspend === 'function') {
      try { persistentCtx.suspend().catch(() => {}); } catch {}
    }
  }

  async function requestMicStream() {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      if (err?.name === 'OverconstrainedError' || err?.name === 'ConstraintNotSatisfiedError') {
        return await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      throw err;
    }
  }

  async function start() {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      throw new Error('Microphone API unavailable in this browser');
    }
    const ctx = unlockAudioContext() || ensureAudioContext();
    teardownGraph();
    pcmChunks = [];
    recording = false;
    const mySession = ++sessionId;

    let stream = null;
    try {
      stream = await requestMicStream();
      if (mySession !== sessionId) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
        return null;
      }
      const tracks = stream.getAudioTracks();
      if (!tracks.length || tracks.every((t) => t.readyState === 'ended')) {
        throw new Error('Microphone stream returned no live audio tracks');
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        await ctx.resume();
      }
      if (mySession !== sessionId) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
        return null;
      }

      activeStream = stream;
      sourceNode = ctx.createMediaStreamSource(stream);
      analyserNode = ctx.createAnalyser();
      analyserNode.fftSize = 64;
      sourceNode.connect(analyserNode);

      const bufSize = 4096;
      processorNode = ctx.createScriptProcessor(bufSize, 1, 1);
      zeroGainNode = ctx.createGain();
      zeroGainNode.gain.value = 0;

      const capturedChunks = [];
      pcmChunks = capturedChunks;
      processorNode.onaudioprocess = (ev) => {
        if (!recording || mySession !== sessionId) return;
        const input = ev.inputBuffer?.getChannelData?.(0);
        if (input && input.length > 0) {
          capturedChunks.push(new Float32Array(input));
        }
      };

      sourceNode.connect(processorNode);
      processorNode.connect(zeroGainNode);
      zeroGainNode.connect(ctx.destination);

      tracks.forEach((track) => {
        track.onended = () => {
          if (mySession === sessionId && recording && typeof onError === 'function') {
            onError(new Error('Microphone track ended unexpectedly (screen lock or OS interrupt)'));
          }
        };
      });

      recording = true;
      return { sampleRate: ctx.sampleRate || WHISPER_SAMPLE_RATE, stream, analyser: analyserNode };
    } catch (err) {
      if (stream && activeStream !== stream) {
        stream.getTracks().forEach((t) => { try { t.stop(); } catch {} });
      }
      teardownGraph();
      throw err;
    }
  }

  function cancel() {
    sessionId++;
    recording = false;
    pcmChunks = [];
    teardownGraph();
  }

  function stop() {
    sessionId++;
    recording = false;
    const chunks = pcmChunks;
    const sampleRate = (persistentCtx && persistentCtx.sampleRate) || WHISPER_SAMPLE_RATE;
    pcmChunks = [];
    teardownGraph();

    let totalLen = 0;
    for (const c of chunks) totalLen += c.length;
    const merged = new Float32Array(totalLen);
    let pos = 0;
    for (const c of chunks) {
      merged.set(c, pos);
      pos += c.length;
    }
    return encodeWav16kMono(merged, sampleRate);
  }

  return {
    unlockAudioContext,
    start,
    cancel,
    stop,
    isRecording: () => recording,
    getAnalyser: () => analyserNode,
  };
}

/**
 * Corrects common clinical Whisper ASR garbles only when surrounding clinical context forces one reading.
 * Contains strictly generic medical terminology (no patient/clinician names).
 */
export function applyClinicalAsrCorrections(text) {
  let out = String(text || '');
  if (!out.trim()) return out;

  // Antibiotic & microbiology garbles
  out = out.replace(/\b(?:Kundamycin|Condamising|Clindamising|Kundamising)\b/gi, 'Clindamycin');
  out = out.replace(/\b(?:Vancomising|Vankomising)\b/gi, 'Vancomycin');
  out = out.replace(/\b(?:Crib\s*C|cribsi)\b/gi, 'CRBSI');

  // Status & dosing unit garbles
  out = out.replace(/\b(?:a\s+fee\s+rel|a\s+febrile)\b/gi, 'afebrile');
  out = out.replace(/(\d(?:\.\d+)?\s*)\b(?:mkm|MKM)\b/g, '$1mcg/kg/min');

  // FiO2 garbles (avoid consuming trailing space when "2" is omitted)
  out = out.replace(/\b(?:phyoto|fyoto|fioto)\b/gi, 'FiO2');
  out = out.replace(/\b(?:FIO\s*2|FIO)(?=\s*(?:of\s*)?\d+\s*%)/gi, 'FiO2');

  // Pulmo specialty context (only when followed by plan/service/consult/co-management keywords or colon)
  out = out.replace(
    /\b(?:Tuma|Ulma)\b(?=\s*(?::|\bplans?\b|\bservice\b|\bconsult\b|\bnote\b|\bcleared\b|\bco-?manage))/gi,
    'Pulmo'
  );

  // Context-aware PEEP (replace BP / P -> PEEP ONLY on ventilator lines, never altering BP 120/80)
  out = out
    .split('\n')
    .map((line) => {
      const hasVentCtx =
        /\b(?:vent(?:ilator)?|FiO2|Vt|VTE|AC\/?VC|AC\/?PC|PCMV|PC-?CMV|VC-?CMV|PRVC|SIMV|PSV|Ppeak|Pplat|cmH2O)\b/i.test(
          line
        );
      if (!hasVentCtx) return line;
      return line.replace(/\b(?:BP|P)\b(?=\s*(?:[:=]|\bof\b)?\s*\d{1,2}\b(?!\s*\/\s*\d))/g, 'PEEP');
    })
    .join('\n');

  return out;
}
