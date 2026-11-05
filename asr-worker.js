// Runs Moonshine in a worker so the model never stalls the animation.
// The model files download once from Hugging Face and are cached by the browser.
// All transcription happens on this machine.

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

env.allowLocalModels = false;

const MODELS = {
  'moonshine-base': 'onnx-community/moonshine-base-ONNX',
  'moonshine-tiny': 'onnx-community/moonshine-tiny-ONNX',
};

let asr = null;

async function hasWebGPU() {
  try {
    return !!(navigator.gpu && await navigator.gpu.requestAdapter());
  } catch {
    return false;
  }
}

function cpuThreads() {
  // Threads only work when the page is cross-origin isolated (server.mjs sets the headers).
  if (!self.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2));
}

// device: 'auto' | 'webgpu' | 'wasm'
async function load(name, device = 'auto') {
  const id = MODELS[name];
  if (!id) throw new Error(`Unknown model ${name}`);
  const progress_callback = (p) => postMessage({ type: 'progress', ...p });
  let used = 'wasm';

  if (device !== 'wasm' && await hasWebGPU()) {
    try {
      asr = await pipeline('automatic-speech-recognition', id, {
        device: 'webgpu',
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
        progress_callback,
      });
      used = 'webgpu';
    } catch (err) {
      postMessage({ type: 'log', message: `WebGPU load failed, falling back to CPU: ${err?.message || err}` });
      asr = null;
    }
  }
  if (!asr) {
    const threads = cpuThreads();
    if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = threads;
    asr = await pipeline('automatic-speech-recognition', id, { device: 'wasm', dtype: 'q8', progress_callback });
    used = `wasm x${threads}`;
  }

  // Warm up so the first real phrase is not slow.
  await asr(new Float32Array(16000));
  postMessage({ type: 'ready', device: used, model: id });
}

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'load') {
    try {
      await load(m.model, m.device);
    } catch (err) {
      postMessage({ type: 'error', message: String(err?.message || err) });
    }
    return;
  }
  if (m.type === 'transcribe') {
    const started = performance.now();
    const reply = { type: 'result', uttId: m.uttId, final: m.final, startedAt: m.startedAt };
    try {
      const out = await asr(m.audio);
      postMessage({ ...reply, text: (out?.text || '').trim(), ms: performance.now() - started });
    } catch (err) {
      postMessage({ ...reply, text: '', ms: 0, error: String(err?.message || err) });
    }
  }
};
