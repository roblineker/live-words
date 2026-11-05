import { createAsciiBackground } from './ascii-bg.js';
import { createDesignPanel } from './design.js';
import { CUES, CUE_COOLDOWN_MS } from './cues.js';

const SAMPLE_RATE = 16000;
const FRAME_MS = 32;            // the capture worklet posts 512-sample frames
const PREROLL_FRAMES = 10;      // keep ~320 ms from before speech was detected
const END_SILENCE_MS = 650;     // this much quiet ends an utterance
const KEEP_TAIL_MS = 200;       // trailing silence kept on the final pass
const MAX_UTTERANCE_S = 10;     // force a cut on long run-on sentences
const INTERIM_EVERY_MS = 280;   // re-transcribe the growing utterance this often
const MIN_VOICED_MS = 250;      // shorter blips are noise
const KEEP_UTTS = 60;

const STOPWORDS = new Set(('a an the and or but of to in on at for with is are was were be been it its this that these ' +
  'those i im you we they he she my your our their as by from so if then than just like not no do does did have has ' +
  'had will would can could into about there here what when which who how all some very really also').split(' '));

const $ = (s) => document.querySelector(s);
const els = {
  stage: $('#stage'),
  transcript: $('#transcript-list'),
  card: $('#card'),
  cardTag: $('#card .card-tag'),
  cardTitle: $('#card .card-title'),
  cardSub: $('#card .card-sub'),
  revisions: $('#revisions'),
  meter: $('#meter'),
  status: $('#status'),
  progress: $('#progress'),
  start: $('#start'),
  modelLabel: $('#model-label'),
};

const cursor = document.createElement('span');
cursor.id = 'cursor';

const bg = createAsciiBackground($('#bg'));

// ---------- design (the D panel) ----------

const SCENE_KEYS = Object.keys(bg.params);

function applyDesign(d) {
  const scene = {};
  for (const k of SCENE_KEYS) scene[k] = d[k];
  bg.set(scene);

  const root = document.documentElement.style;
  root.setProperty('--paper', d.paper);
  root.setProperty('--ink', d.ink);
  root.setProperty('--live', d.accent);
  root.setProperty('--card', d.cardBg);
  root.setProperty('--card-ink', d.cardInk);
  root.setProperty('--stage-font', `"${d.stageFont}"`);
  root.setProperty('--card-font', `"${d.cardFont}"`);
  root.setProperty('--stage-size', d.stageSize);
  root.setProperty('--tracking', `${d.tracking}em`);
  root.setProperty('--stage-width', `${d.stageWidth}vw`);
  root.setProperty('--stage-top', `${d.stageTop}vh`);
  root.setProperty('--transcript-width', `${d.transcriptWidth}vw`);
  root.setProperty('--transcript-size', d.transcriptSize);
  root.setProperty('--hud-opacity', d.hudOpacity);
  root.setProperty('--card-scale', d.cardScale);

  const cls = document.body.classList;
  cls.toggle('lower', !d.uppercase);
  cls.toggle('no-glow', !d.glow);
  cls.toggle('no-cursor', !d.cursor);
  cls.toggle('no-frame', !d.frame);
  trim(d.stageUtts);
}

const SAMPLE = [
  'Everything you are seeing is happening in real time on this laptop.',
  'A free open model called Moonshine listens to my voice.',
  'Then creative code takes over and the words build the scene.',
];
let previewN = 0;
function previewWords() {
  const text = SAMPLE[previewN++ % SAMPLE.length];
  const id = `p${previewN}`;
  const words = text.split(' ');
  const startedAt = performance.now();
  if (!state.t0) state.t0 = startedAt;
  words.forEach((_, i) => setTimeout(() => {
    applyTranscript(id, words.slice(0, i + 1).join(' '), i === words.length - 1, startedAt);
  }, i * 140));
}

const state = {
  engine: 'moonshine-base',
  listening: false,
  t0: 0,
  latencies: [],
  words: 0,
  revisions: 0,
  camStream: null,
  camId: '',
  lastCamId: '',
  cameras: [],
  camVideo: null,
};

// ---------- helpers ----------

const norm = (w) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
const isLocal = () => state.engine.startsWith('moonshine');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const SCRAMBLE = '#%&*+=-<>/\\|{}[]()@$o0x~^';
function scramble(el, text, dur = 320) {
  cancelAnimationFrame(el._scr);
  const start = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - start) / dur);
    const shown = Math.floor(p * text.length);
    let s = text.slice(0, shown);
    for (let i = shown; i < text.length; i++) {
      s += text[i] === ' ' ? ' ' : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0];
    }
    el.textContent = s;
    if (p < 1) el._scr = requestAnimationFrame(tick);
  };
  el._scr = requestAnimationFrame(tick);
}

function fmtTime(ms) {
  const s = Math.max(0, ms) / 1000;
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}

const chipTimers = {};
function pulseChip(name, ms = 180) {
  const el = document.querySelector(`[data-chip="${name}"]`);
  if (!el) return;
  el.classList.add('on');
  clearTimeout(chipTimers[name]);
  chipTimers[name] = setTimeout(() => el.classList.remove('on'), ms);
}
function holdChip(name, on) {
  const el = document.querySelector(`[data-chip="${name}"]`);
  if (!el) return;
  clearTimeout(chipTimers[name]);
  el.classList.toggle('on', on);
}

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

// ---------- cue cards ----------

const cueList = CUES.map((c, index) => {
  const alts = (c.say || []).filter(Boolean).map((p) => escapeRe(p.trim()).replace(/\s+/g, '\\s+'));
  return {
    ...c,
    index,
    re: alts.length ? new RegExp(`(^|[^\\p{L}\\p{N}])(${alts.join('|')})(?=$|[^\\p{L}\\p{N}])`, 'iu') : null,
    lastShown: -Infinity,
  };
});
const cueWords = new Set(CUES.flatMap((c) => (c.say || []).flatMap((p) => p.split(/\s+/).map(norm))).filter(Boolean));

let cardIndex = -1;
let cardTimer = 0;

function showCard(c, hold = c.hold ?? design.cardHold * 1000) {
  c.lastShown = performance.now();
  cardIndex = c.index;
  els.cardTag.textContent = c.tag || '';
  els.cardSub.textContent = c.sub || '';
  scramble(els.cardTitle, c.title || '', 450);
  els.card.classList.remove('show');
  void els.card.offsetWidth;
  els.card.classList.add('show');
  document.body.classList.add('card-on');
  clearTimeout(cardTimer);
  if (hold > 0) cardTimer = setTimeout(hideCard, hold);
  bg.burst(c.title);
}

function hideCard() {
  clearTimeout(cardTimer);
  els.card.classList.remove('show');
  document.body.classList.remove('card-on');
}

function stepCard(delta) {
  if (!cueList.length) return;
  const i = cardIndex < 0 && delta < 0 ? cueList.length - 1 : (cardIndex + delta + cueList.length) % cueList.length;
  showCard(cueList[i], 0);
}

function checkCues(text) {
  const now = performance.now();
  for (const c of cueList) {
    if (c.re && now - c.lastShown > CUE_COOLDOWN_MS && c.re.test(text)) {
      showCard(c);
      return;
    }
  }
}

// ---------- words on stage and in the transcript ----------

const utts = new Map();
let stageList = [];

function styleFor(word) {
  const n = norm(word);
  if (cueWords.has(n)) return 'box';
  if (n.length < 4 || STOPWORDS.has(n)) return '';
  const r = Math.random() * 100;
  if (r < design.boxPct) return 'box';
  if (r < design.boxPct + design.serifPct) return 'serif';
  if (r < design.boxPct + design.serifPct + design.invPct) return 'inv';
  return '';
}

function getUtt(id, startedAt) {
  let u = utts.get(id);
  if (u) return u;

  const stageEl = document.createElement('div');
  stageEl.className = 'utt';
  els.stage.appendChild(stageEl);

  const entry = document.createElement('div');
  entry.className = 'entry interim';
  const ts = document.createElement('span');
  ts.className = 'ts';
  ts.textContent = fmtTime(startedAt - state.t0);
  const body = document.createElement('span');
  entry.append(ts, body);
  els.transcript.appendChild(entry);

  u = { id, startedAt, words: [], stageEl, entry, body, final: false };
  utts.set(id, u);
  stageList.push(u);
  trim();
  return u;
}

function removeUtt(u) {
  u.stageEl.remove();
  u.entry.remove();
  utts.delete(u.id);
  stageList = stageList.filter((x) => x !== u);
  placeCursor();
}

function trim(maxUtts = design.stageUtts) {
  while (stageList.length > maxUtts) {
    const old = stageList.shift();
    old.stageEl.classList.add('leaving');
    setTimeout(() => old.stageEl.remove(), 700);
  }
  stageList.forEach((u, i) => u.stageEl.classList.toggle('old', i < stageList.length - 1));
  while (utts.size > KEEP_UTTS) {
    const [id, u] = utts.entries().next().value;
    u.entry.remove();
    utts.delete(id);
  }
}

function placeCursor() {
  const last = stageList[stageList.length - 1];
  if (last) last.stageEl.appendChild(cursor);
}

function makeWord(u, text, now, before) {
  const style = styleFor(text);
  const s = document.createElement('span');
  s.className = `w enter ${style}`;
  scramble(s, text);

  const wrap = document.createElement('span');
  wrap.className = `tw${style === 'box' ? ' box' : ''}`;
  const t = document.createElement('span');
  t.className = 't';
  t.textContent = text;
  const lat = document.createElement('span');
  lat.className = 'lat';
  lat.textContent = `+${((now - u.startedAt) / 1000).toFixed(2)}s`;
  wrap.append(t, lat);

  if (before) {
    u.stageEl.insertBefore(s, before.stageEl);
    u.body.insertBefore(wrap, before.wrap);
  } else {
    u.stageEl.appendChild(s);
    u.body.appendChild(wrap);
  }
  bg.ping();
  return { text, stageEl: s, tEl: t, wrap };
}

function setText(w, text) {
  if (w.text === text) return;
  w.text = text;
  w.stageEl.textContent = text;
  w.tEl.textContent = text;
}

function reviseWord(w, text) {
  logRevision(w.text, text);
  w.text = text;
  scramble(w.stageEl, text, 260);
  w.stageEl.classList.remove('enter', 'revised');
  void w.stageEl.offsetWidth;
  w.stageEl.classList.add('revised');
  w.tEl.textContent = text;
  w.wrap.classList.add('revised');
}

function dropWord(w) {
  w.stageEl.classList.add('gone');
  setTimeout(() => w.stageEl.remove(), 300);
  w.wrap.remove();
}

// Diff the new hypothesis against what is on screen: keep the matching start and end,
// revise words that changed in place, then add or drop the rest.
function reconcile(u, words, now) {
  const old = u.words;
  let p = 0;
  while (p < old.length && p < words.length && norm(old[p].text) === norm(words[p])) p++;
  let s = 0;
  while (s < old.length - p && s < words.length - p
    && norm(old[old.length - 1 - s].text) === norm(words[words.length - 1 - s])) s++;

  for (let i = 0; i < p; i++) setText(old[i], words[i]);
  for (let i = 0; i < s; i++) setText(old[old.length - 1 - i], words[words.length - 1 - i]);

  const oldMid = old.slice(p, old.length - s);
  const newMid = words.slice(p, words.length - s);
  const n = Math.min(oldMid.length, newMid.length);
  for (let i = 0; i < n; i++) reviseWord(oldMid[i], newMid[i]);
  for (let i = n; i < oldMid.length; i++) dropWord(oldMid[i]);

  const tail = old.slice(old.length - s);
  const before = tail[0] || null;
  const added = [];
  for (let i = n; i < newMid.length; i++) added.push(makeWord(u, newMid[i], now, before));
  u.words = old.slice(0, p).concat(oldMid.slice(0, n), added, tail);
  return added.length;
}

function logRevision(from, to) {
  state.revisions++;
  $('#s-revised').textContent = state.revisions;
  const line = document.createElement('div');
  line.textContent = `revised "${from}" → "${to}"`;
  els.revisions.prepend(line);
  while (els.revisions.children.length > 6) els.revisions.lastChild.remove();
}

function cleanText(text) {
  // Small models sometimes loop on one word; cut runs of more than three.
  const out = [];
  for (const w of text.split(/\s+/).filter(Boolean)) {
    const n = out.length;
    if (n >= 3 && norm(out[n - 1]) === norm(w) && norm(out[n - 2]) === norm(w) && norm(out[n - 3]) === norm(w)) continue;
    out.push(w);
  }
  return out;
}

function heroWord(words) {
  const cue = words.find((w) => cueWords.has(norm(w)));
  if (cue) return cue;
  return words.map(norm).filter((w) => !STOPWORDS.has(w)).sort((a, b) => b.length - a.length)[0];
}

function applyTranscript(id, text, final, startedAt) {
  const existing = utts.get(id);
  if (existing?.final) return;
  const words = cleanText(text);
  if (!words.length) {
    if (final && existing) removeUtt(existing);
    return;
  }

  const u = getUtt(id, startedAt);
  reconcile(u, words, performance.now());
  pulseChip('words');
  pulseChip('scene', 300);
  checkCues(words.join(' '));
  placeCursor();

  if (final) {
    u.final = true;
    u.entry.classList.remove('interim');
    state.words += words.length;
    $('#s-words').textContent = state.words;
    bg.burst(heroWord(words));
  }
}

function clearStage() {
  for (const u of stageList) u.stageEl.remove();
  stageList = [];
  hideCard();
}

// ---------- Moonshine (local) ----------

const asr = { worker: null, busy: false, queue: [], ready: false, device: '', lastMs: 0, rtf: 0 };

const asrIdle = () => asr.ready && !asr.busy && asr.queue.length === 0;

function submit(job) {
  if (!asr.ready) return;
  job.queuedAt = performance.now();
  if (job.final) {
    asr.queue = asr.queue.filter((j) => j.final);
    asr.queue.push(job);
  } else if (asrIdle()) {
    asr.queue.push(job);
  } else {
    return;
  }
  pump();
}

function pump() {
  if (asr.busy || !asr.queue.length) return;
  const job = asr.queue.shift();
  asr.busy = true;
  holdChip('model', true);
  asr.current = {
    final: job.final,
    audioS: job.audio.length / SAMPLE_RATE,
    waitMs: performance.now() - job.queuedAt,
    endedAt: job.endedAt,
  };
  const { uttId, final, startedAt, audio: pcm } = job;
  asr.worker.postMessage({ type: 'transcribe', uttId, final, startedAt, audio: pcm }, [pcm.buffer]);
}

function onResult(m) {
  asr.busy = false;
  holdChip('model', false);
  const job = asr.current || {};
  perf.recordJob({ ...job, ms: m.ms, text: m.text, error: m.error });
  if (!m.error && job.audioS) {
    asr.lastMs = m.ms;
    // Smoothed real-time factor: processing seconds per second of audio.
    const rtf = m.ms / 1000 / job.audioS;
    asr.rtf = asr.rtf ? asr.rtf * 0.6 + rtf * 0.4 : rtf;
    showSlowWarning(asr.rtf > 0.9);
  }
  if (m.error) {
    console.warn('transcribe failed', m.error);
    perf.event('asr-error', { message: m.error });
  } else {
    state.latencies.push(m.ms);
    if (state.latencies.length > 12) state.latencies.shift();
    const avg = state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length / 1000;
    $('#s-latency').textContent = `~${avg.toFixed(2)} s`;
    applyTranscript(m.uttId, m.text, m.final, m.startedAt);
  }
  pump();
}

function loadModel(name, device) {
  return new Promise((resolve, reject) => {
    const files = new Map();
    asr.worker = new Worker('./asr-worker.js', { type: 'module' });
    asr.worker.onerror = (e) => reject(new Error(e.message || 'The speech worker failed to start.'));
    asr.worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === 'progress') {
        if (m.status === 'progress' && m.file) {
          files.set(m.file, { loaded: m.loaded || 0, total: m.total || 0 });
          let loaded = 0, total = 0;
          for (const f of files.values()) { loaded += f.loaded; total += f.total; }
          if (total) {
            els.progress.style.width = `${(loaded / total) * 100}%`;
            setStatus(`Downloading model ${(loaded / 1e6).toFixed(0)} / ${(total / 1e6).toFixed(0)} MB`);
          }
        } else if (m.status === 'done' || m.status === 'ready') {
          setStatus('Loading the model into memory...');
        }
      } else if (m.type === 'ready') {
        asr.ready = true;
        asr.device = m.device;
        resolve(m);
      } else if (m.type === 'error') {
        reject(new Error(m.message));
      } else if (m.type === 'result') {
        onResult(m);
      } else if (m.type === 'log') {
        console.info(m.message);
      }
    };
    asr.worker.postMessage({ type: 'load', model: name, device });
  });
}

// When the model is slow, space live passes out so it has time for the final one.
// Above ~0.9 s of work per second of audio, live passes stop and only finals run.
function interimGap() {
  return Math.max(INTERIM_EVERY_MS, asr.lastMs * 1.5);
}

let slowShown = false;
function showSlowWarning(on) {
  if (on === slowShown) return;
  slowShown = on;
  document.body.classList.toggle('model-slow', on);
  els.modelLabel.dataset.warn = on ? 'model is behind: close heavy apps, or use Tiny / browser speech' : '';
  perf.event('slow', { on, rtf: +asr.rtf.toFixed(2), device: asr.device });
}

// ---------- utterance detection (feeds Moonshine) ----------

const seg = {
  speaking: false, pre: [], chunks: [], run: 0,
  voicedMs: 0, silenceMs: 0, floor: 0.004,
  uttId: 0, startedAt: 0, lastInterim: 0,
};

function concat(chunks) {
  const out = new Float32Array(chunks.length * chunks[0].length);
  chunks.forEach((c, i) => out.set(c, i * c.length));
  return out;
}

function sendJob(final) {
  let chunks = seg.chunks;
  if (final) {
    const extra = Math.floor(Math.max(0, seg.silenceMs - KEEP_TAIL_MS) / FRAME_MS);
    if (extra > 0) chunks = chunks.slice(0, chunks.length - extra);
  }
  if (!chunks.length) return;
  submit({
    uttId: `m${seg.uttId}`,
    startedAt: seg.startedAt,
    endedAt: final ? performance.now() - seg.silenceMs : 0,
    final,
    audio: concat(chunks),
  });
}

function endUtterance() {
  if (!seg.speaking) return;
  seg.speaking = false;
  seg.run = 0;
  if (seg.voicedMs >= MIN_VOICED_MS) sendJob(true);
  else {
    const u = utts.get(`m${seg.uttId}`);
    if (u) removeUtt(u);
  }
  seg.chunks = [];
}

function onFrame(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  const rms = Math.sqrt(sum / frame.length);
  const level = Math.min(1, rms * 14);
  bg.setLevel(level);
  els.meter.style.width = `${level * 100}%`;

  if (!seg.speaking) {
    // Noise floor: falls quickly, rises slowly.
    seg.floor = rms < seg.floor ? seg.floor * 0.9 + rms * 0.1 : seg.floor * 0.995 + rms * 0.005;
    seg.floor = Math.min(0.05, Math.max(0.0015, seg.floor));
  }
  const voiced = rms > Math.max(0.01, seg.floor * 2.8);
  if (voiced && state.listening) pulseChip('mic');

  if (!state.listening || !isLocal()) return;

  if (!seg.speaking) {
    seg.pre.push(frame);
    if (seg.pre.length > PREROLL_FRAMES) seg.pre.shift();
    seg.run = voiced ? seg.run + 1 : 0;
    if (seg.run >= 2) {
      seg.speaking = true;
      seg.chunks = seg.pre;
      seg.pre = [];
      seg.voicedMs = seg.run * FRAME_MS;
      seg.silenceMs = 0;
      seg.uttId++;
      seg.startedAt = performance.now() - seg.chunks.length * FRAME_MS;
      seg.lastInterim = performance.now();
    }
    return;
  }

  seg.chunks.push(frame);
  if (voiced) { seg.voicedMs += FRAME_MS; seg.silenceMs = 0; } else seg.silenceMs += FRAME_MS;

  const now = performance.now();
  if (seg.silenceMs >= END_SILENCE_MS || seg.chunks.length * FRAME_MS / 1000 >= MAX_UTTERANCE_S) {
    endUtterance();
  } else if (seg.voicedMs >= MIN_VOICED_MS && now - seg.lastInterim >= interimGap()) {
    if (asrIdle() && asr.rtf < 0.9) {
      seg.lastInterim = now;
      sendJob(false);
    } else {
      perf.skippedInterim();
    }
  }
}

// ---------- performance log ----------
// Every 5 s the page posts a summary to the local server, which appends it to
// logs/perf-<date>.jsonl so it can be read and tuned from outside the browser.

const perf = (() => {
  const LOG_EVERY_MS = 5000;
  let jobs = [];
  let skipped = 0;
  let longTasks = 0, longTaskMs = 0;
  let lastSkipAt = 0;

  const pct = (arr, p) => {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]);
  };

  // Only the local server (server.mjs) collects logs; hosted copies skip it.
  const canLog = ['127.0.0.1', 'localhost'].includes(location.hostname);

  function post(type, data) {
    if (!canLog) return;
    const body = JSON.stringify({ type, at: new Date().toISOString(), ...data });
    fetch('./log', { method: 'POST', body, keepalive: true }).catch(() => {});
  }

  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) { longTasks++; longTaskMs += e.duration; }
    }).observe({ type: 'longtask', buffered: false });
  } catch { /* not supported */ }

  window.addEventListener('error', (e) => post('error', { message: e.message, source: `${e.filename}:${e.lineno}` }));
  window.addEventListener('unhandledrejection', (e) => post('error', { message: String(e.reason?.message || e.reason) }));

  function summary() {
    const interim = jobs.filter((j) => !j.final);
    const finals = jobs.filter((j) => j.final);
    const rtf = jobs.filter((j) => j.audioS > 0).map((j) => j.ms / 1000 / j.audioS);
    const out = {
      running: document.body.classList.contains('running'),
      listening: state.listening,
      hidden: document.hidden,
      engine: state.engine,
      backend: asr.device || null,
      fps: bg.stats.fps,
      drawMs: bg.stats.drawMs,
      drawMsMax: bg.takeMaxDraw(),
      cells: bg.stats.cells,
      grid: design.grid,
      fpsCap: design.fps,
      camera: !!state.camStream,
      jobs: jobs.length,
      interimMs: { p50: pct(interim.map((j) => j.ms), 0.5), p95: pct(interim.map((j) => j.ms), 0.95) },
      finalMs: { p50: pct(finals.map((j) => j.ms), 0.5), p95: pct(finals.map((j) => j.ms), 0.95) },
      queueWaitMs: pct(jobs.map((j) => j.waitMs || 0), 0.95),
      audioS: { p50: pct(jobs.map((j) => j.audioS * 1000), 0.5) / 1000 || null },
      realtimeFactor: rtf.length ? +(rtf.reduce((a, b) => a + b, 0) / rtf.length).toFixed(3) : null,
      speechEndToFinalMs: pct(finals.filter((j) => j.endedAt).map((j) => j.doneAt - j.endedAt), 0.5),
      interimSkipped: skipped,
      emptyResults: jobs.filter((j) => !j.text && !j.error).length,
      errors: jobs.filter((j) => j.error).length,
      longTasks,
      longTaskMs: Math.round(longTaskMs),
      words: state.words,
      revisions: state.revisions,
      heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
    };
    jobs = [];
    skipped = 0;
    longTasks = 0;
    longTaskMs = 0;
    return out;
  }

  setInterval(() => {
    if (!document.body.classList.contains('running')) return;
    const s = summary();
    $('#s-fps').textContent = `${s.fps} fps · ${s.drawMs} ms`;
    post('perf', s);
  }, LOG_EVERY_MS);

  return {
    recordJob(j) { jobs.push({ ...j, doneAt: performance.now() }); },
    skippedInterim() {
      // Count once per interim slot, not once per audio frame.
      const now = performance.now();
      if (now - lastSkipAt >= INTERIM_EVERY_MS) { skipped++; lastSkipAt = now; }
    },
    event: post,
  };
})();

// ---------- audio in ----------

const audio = { ctx: null, stream: null, source: null };

async function startAudio({ deviceId, file }) {
  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule('./capture-worklet.js');
  const node = new AudioWorkletNode(ctx, 'capture');
  node.port.onmessage = (e) => onFrame(e.data);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink).connect(ctx.destination);

  if (file) {
    const data = await (await fetch(file)).arrayBuffer();
    const buffer = await ctx.decodeAudioData(data);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(node);
    src.connect(ctx.destination);
    src.onended = () => setTimeout(endUtterance, END_SILENCE_MS);
    src.start(ctx.currentTime + 0.4);
    audio.source = src;
    $('#d-mic').textContent = file;
  } else {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    ctx.createMediaStreamSource(stream).connect(node);
    audio.stream = stream;
    $('#d-mic').textContent = stream.getAudioTracks()[0]?.label || 'default';
  }
  await ctx.resume();
  audio.ctx = ctx;
}

// ---------- browser speech (Chrome / Edge cloud recogniser) ----------

const ws = { rec: null, session: 0, seen: new Map() };

function startWebSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) throw new Error('This browser has no built-in speech recognition. Use Chrome or Edge, or pick a Moonshine engine.');
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = navigator.language || 'en-AU';
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const id = `w${ws.session}_${i}`;
      if (!ws.seen.has(id)) ws.seen.set(id, performance.now());
      holdChip('model', !r.isFinal);
      applyTranscript(id, r[0].transcript.trim(), r.isFinal, ws.seen.get(id));
    }
  };
  rec.onend = () => {
    if (state.listening && state.engine === 'browser') {
      ws.session++;
      try { rec.start(); } catch { /* already restarting */ }
    }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      setStatus('The browser blocked speech recognition.', true);
    }
  };
  ws.rec = rec;
  ws.session++;
  rec.start();
}

// ---------- camera ----------

// id: '' = off, 'default' = whichever camera the browser picks, otherwise a deviceId.
async function setCamera(id) {
  state.camStream?.getTracks().forEach((t) => t.stop());
  state.camStream = null;
  state.camId = id;
  syncCameraPickers();
  if (!id) {
    bg.setCamera(null);
    $('#d-cam').textContent = 'off';
    return;
  }
  state.lastCamId = id;
  try {
    const video = { width: 640, height: 480 };
    if (id !== 'default') video.deviceId = { exact: id };
    const stream = await navigator.mediaDevices.getUserMedia({ video });
    const el = state.camVideo || document.createElement('video');
    el.muted = true;
    el.playsInline = true;
    el.srcObject = stream;
    await el.play();
    state.camStream = stream;
    state.camVideo = el;
    bg.setCamera(el);
    $('#d-cam').textContent = `${stream.getVideoTracks()[0]?.label || 'camera'} (ascii)`;
    listDevices(); // labels appear once permission is granted
  } catch (err) {
    state.camId = '';
    syncCameraPickers();
    $('#d-cam').textContent = `blocked: ${err.message}`;
  }
}

function toggleCamera() {
  setCamera(state.camStream ? '' : (state.lastCamId || 'default'));
}

// Fills a <select> with Off / Default / each camera, keeping the current choice.
function fillCameraSelect(sel) {
  const keep = state.camId ?? sel.value;
  sel.textContent = '';
  const add = (value, label) => sel.appendChild(Object.assign(document.createElement('option'), { value, textContent: label }));
  add('', 'Off');
  add('default', 'Default camera');
  state.cameras.forEach((c, i) => add(c.deviceId, c.label || `Camera ${i + 1}`));
  sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
}

function syncCameraPickers() {
  fillCameraSelect($('#cam'));
  panel?.setCameraOptions(fillCameraSelect);
}

// ---------- start / pause ----------

function setListening(on) {
  state.listening = on;
  document.body.classList.toggle('paused', !on);
  if (!on) endUtterance();
  if (state.engine === 'browser' && ws.rec) {
    if (on) { ws.session++; try { ws.rec.start(); } catch { /* running */ } } else ws.rec.stop();
  }
}

function browserName() {
  const brands = navigator.userAgentData?.brands || [];
  const b = brands.find((x) => /Edge|Chrome|Opera|Brave/.test(x.brand)) || brands[0];
  return b ? `${b.brand} ${b.version}` : navigator.userAgent.split(' ').pop();
}

async function start() {
  els.start.disabled = true;
  const engine = $('#engine').value;
  const file = $('#source').value === 'file' ? 'demo.wav' : null;
  state.engine = engine;
  try {
    if (file && !isLocal()) throw new Error('The demo recording only works with a Moonshine engine. Browser speech listens to the mic directly.');
    const loadStart = performance.now();
    if (isLocal()) {
      setStatus('Starting the speech model...');
      const info = await loadModel(engine, $('#device').value);
      state.loadMs = Math.round(performance.now() - loadStart);
      els.progress.style.width = '100%';
      $('#d-backend').textContent = info.device;
      els.modelLabel.textContent = `speech model · ${engine.replace('-', ' ')} · on this laptop`;
    } else {
      $('#d-backend').textContent = 'browser cloud service';
      els.modelLabel.textContent = 'speech model · browser speech service';
    }
    $('#d-engine').textContent = engine;
    $('#d-browser').textContent = browserName();

    state.t0 = performance.now();
    await startAudio({ deviceId: $('#mic').value, file });
    if (!isLocal()) startWebSpeech();
    if ($('#cam').value) setCamera($('#cam').value);
    listDevices();

    document.body.classList.add('running');
    setListening(true);
    setInterval(() => { $('#s-clock').textContent = fmtTime(performance.now() - state.t0).slice(0, 5); }, 500);

    let gpu = null;
    try {
      const a = await navigator.gpu?.requestAdapter();
      if (a) gpu = { vendor: a.info?.vendor, architecture: a.info?.architecture, description: a.info?.description };
    } catch { /* no WebGPU */ }
    perf.event('session', {
      engine, backend: asr.device || 'browser', modelLoadMs: state.loadMs ?? null, source: file || 'mic',
      isolated: crossOriginIsolated,
      mic: $('#d-mic').textContent, gpu, browser: browserName(), cores: navigator.hardwareConcurrency,
      screen: `${innerWidth}x${innerHeight}@${devicePixelRatio}`,
    });
  } catch (err) {
    console.error(err);
    perf.event('error', { message: err.message || String(err), during: 'start' });
    setStatus(err.message || String(err), true);
    els.start.disabled = false;
  }
}

async function listDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    // Without permission the browser hides IDs and labels; keep the defaults until then.
    state.cameras = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
    const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.label);
    const sel = $('#mic');
    const keep = sel.value;
    sel.textContent = '';
    sel.appendChild(Object.assign(document.createElement('option'), { value: '', textContent: 'Default microphone' }));
    for (const d of mics) sel.appendChild(Object.assign(document.createElement('option'), { value: d.deviceId, textContent: d.label }));
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
    syncCameraPickers();
  } catch { /* the defaults still work */ }
}

// Created last: applying the saved design touches the stage state declared above.
const panel = createDesignPanel({ onChange: applyDesign, onPreview: previewWords, onCamera: (id) => setCamera(id) });
const design = panel.design;

// ---------- keys ----------

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('select, input, textarea')) return;
  if (e.key === 'd' || e.key === 'D') { panel.toggle(); e.preventDefault(); return; }
  if (!document.body.classList.contains('running')) return;
  switch (e.key) {
    case ' ': setListening(!state.listening); break;
    case 'ArrowRight': case 'PageDown': stepCard(1); break;
    case 'ArrowLeft': case 'PageUp': stepCard(-1); break;
    case 'Escape': case '.': case 'b': case 'B': hideCard(); break;
    case 'h': case 'H': document.body.classList.toggle('hud-off'); break;
    case 't': case 'T': document.body.classList.toggle('transcript-off'); break;
    case 'c': case 'C': toggleCamera(); break;
    case 'x': case 'X': clearStage(); break;
    case 'f': case 'F':
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen();
      break;
    default: return;
  }
  e.preventDefault();
});

els.start.addEventListener('click', start);
const params = new URLSearchParams(location.search);
if (params.get('engine')) $('#engine').value = params.get('engine');
if (params.get('source')) $('#source').value = params.get('source');
if (params.get('device')) $('#device').value = params.get('device');
listDevices();
navigator.mediaDevices?.addEventListener('devicechange', listDevices);
$('#cam').addEventListener('change', () => {
  // Before START this only records the choice; after START it switches straight away.
  if (document.body.classList.contains('running')) setCamera($('#cam').value);
  else state.camId = $('#cam').value;
});

// For automated checks.
window.liveWords = { state, asr, seg, bg, design, applyTranscript, showCard: (i) => showCard(cueList[i], 0) };
