// Dedicated ES-module Web Worker for on-device WASM Whisper inference via Transformers.js
// Never runs network requests until explicitly triggered by a 'load' or 'transcribe' message.

const TRANSFORMERS_CDN = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3';

let transformersPromise = null;
const pipelines = new Map();
const loadingPromises = new Map();

async function getTransformers() {
  if (!transformersPromise) {
    transformersPromise = import(TRANSFORMERS_CDN).then((mod) => {
      if (mod?.env) {
        mod.env.allowLocalModels = false;
        mod.env.useBrowserCache = true;
        if (mod.env.backends?.onnx?.wasm) {
          mod.env.backends.onnx.wasm.numThreads = 1;
          mod.env.backends.onnx.wasm.proxy = false;
        }
      }
      return mod;
    });
  }
  return transformersPromise;
}

async function getOrLoadTranscriber(modelId, requestId) {
  if (pipelines.has(modelId)) {
    return pipelines.get(modelId);
  }
  if (loadingPromises.has(modelId)) {
    return loadingPromises.get(modelId);
  }

  const p = (async () => {
    for (const [prevId, prevPipeline] of pipelines.entries()) {
      if (prevId !== modelId) {
        try {
          await prevPipeline?.dispose?.();
        } catch {}
        pipelines.delete(prevId);
      }
    }
    const { pipeline } = await getTransformers();
    const transcriber = await pipeline('automatic-speech-recognition', modelId, {
      device: 'wasm',
      dtype: 'q8',
      progress_callback: (ev) => {
        self.postMessage({
          type: 'progress',
          id: requestId,
          modelId,
          status: ev?.status || '',
          file: ev?.file || '',
          name: ev?.name || '',
          progress: typeof ev?.progress === 'number' ? ev.progress : null,
          loaded: typeof ev?.loaded === 'number' ? ev.loaded : null,
          total: typeof ev?.total === 'number' ? ev.total : null,
        });
      },
    });
    pipelines.set(modelId, transcriber);
    return transcriber;
  })();

  loadingPromises.set(modelId, p);
  try {
    return await p;
  } finally {
    loadingPromises.delete(modelId);
  }
}

self.onmessage = async (event) => {
  const msg = event.data || {};
  const { type, id, modelId } = msg;

  try {
    if (type === 'load') {
      await getOrLoadTranscriber(modelId, id);
      self.postMessage({ type: 'ready', id, modelId });
      return;
    }

    if (type === 'transcribe') {
      const transcriber = await getOrLoadTranscriber(modelId, id);
      const t0 = performance.now();
      const audio = msg.audio instanceof Float32Array ? msg.audio : new Float32Array(msg.audio || []);
      const output = await transcriber(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: false,
      });

      let text = '';
      if (typeof output === 'string') {
        text = output;
      } else if (Array.isArray(output)) {
        text = output.map((chunk) => chunk?.text || '').join(' ');
      } else if (output && typeof output.text === 'string') {
        text = output.text;
      }

      self.postMessage({
        type: 'result',
        id,
        modelId,
        text: text.trim(),
        elapsedMs: Math.round(performance.now() - t0),
      });
      return;
    }

    if (type === 'unload') {
      for (const instance of pipelines.values()) {
        try {
          await instance?.dispose?.();
        } catch {}
      }
      pipelines.clear();
      loadingPromises.clear();
      self.postMessage({ type: 'unloaded', id });
    }
  } catch (err) {
    const rawMsg = err?.message || String(err);
    const offlineHint =
      typeof navigator !== 'undefined' && navigator.onLine === false
        ? 'Device appears offline and the Whisper model weights are not cached yet. Connect briefly once and click Preload in Settings.'
        : rawMsg;
    self.postMessage({
      type: 'error',
      id,
      modelId,
      message: offlineHint,
    });
  }
};
