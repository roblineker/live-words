// The design panel: dials and sliders that restyle everything live.
// Press D to open it. Settings save to this browser automatically.

import { SCENE_DEFAULTS } from './ascii-bg.js';

const STORE = 'liveWords.design';
const STORE_PRESETS = 'liveWords.presets';

export const DESIGN_DEFAULTS = {
  ...SCENE_DEFAULTS,
  paper: '#f1f1ee',
  accent: '#e5484d',
  cardBg: '#ffffff',
  cardInk: '#141414',
  stageFont: 'IBM Plex Mono',
  stageSize: 3.4,
  tracking: 0.03,
  uppercase: true,
  glow: true,
  cursor: true,
  boxPct: 9,
  serifPct: 6,
  invPct: 4,
  stageUtts: 4,
  stageWidth: 58,
  stageTop: 12,
  transcriptWidth: 28,
  transcriptSize: 1,
  hudOpacity: 1,
  frame: true,
  uiScale: 1,
  cardScale: 1,
  cardFont: 'Anton',
  cardHold: 8,
};

const FONTS = ['IBM Plex Mono', 'Space Mono', 'VT323', 'Major Mono Display', 'Anton', 'Archivo Black', 'Instrument Serif'];
const RAMPS = {
  'classic  .-=+*o%#@': ' .-=+*o%#@',
  'dense  .:-=+*#%@': ' .:-=+*#%@',
  'blocks  ░▒▓█': ' ░▒▓█',
  'binary  01': ' 01',
  'bubbles  .oO@': ' .oO@',
  'slashes  /\\|X': ' /\\|X',
  'dots  .:•●': ' .:•●',
};

const PRESETS = {
  Paper: {},
  Terminal: {
    paper: '#070b07', ink: '#3cff72', accent: '#3cff72', cardBg: '#070b07', cardInk: '#3cff72',
    stageFont: 'VT323', sceneFont: 'VT323', cardFont: 'VT323', stageSize: 4.4, ramp: ' .:-=+*#%@', glow: false,
  },
  Blueprint: {
    paper: '#123f8f', ink: '#e8f0ff', accent: '#ffd23f', cardBg: '#e8f0ff', cardInk: '#123f8f',
    ramp: ' .:-=+*#%@', inkAlpha: 0.5, glow: false,
  },
  Riso: {
    paper: '#f4eee2', ink: '#1d3fbb', accent: '#ff4f6d', cardBg: '#fff7ea', cardInk: '#1d3fbb',
    stageFont: 'Space Mono', ramp: ' .oO@', amount: 1.4,
  },
  Night: {
    paper: '#101010', ink: '#efefe9', accent: '#ff5a4f', cardBg: '#efefe9', cardInk: '#101010',
    inkAlpha: 0.55, glow: false,
  },
  Calm: {
    speed: 0.35, amount: 0.7, reactivity: 0.4, glyphRate: 0.03, crosses: 2, texture: 0.25, burstSize: 0.6,
  },
  Chaos: {
    speed: 2.4, amount: 1.9, blobScale: 1.8, reactivity: 2.5, glyphRate: 0.35, crosses: 14, burstSize: 1.8,
    boxPct: 20, serifPct: 12, invPct: 12,
  },
};

// [paper, ink, live dot, card, card ink]
const PALETTES = [
  ['#f1f1ee', '#141414', '#e5484d', '#ffffff', '#141414'],
  ['#070b07', '#3cff72', '#3cff72', '#070b07', '#3cff72'],
  ['#123f8f', '#e8f0ff', '#ffd23f', '#e8f0ff', '#123f8f'],
  ['#f4eee2', '#1d3fbb', '#ff4f6d', '#fff7ea', '#1d3fbb'],
  ['#101010', '#efefe9', '#ff5a4f', '#efefe9', '#101010'],
  ['#ffef5c', '#111111', '#ff2e63', '#111111', '#ffef5c'],
  ['#ff5b2e', '#1a0f0a', '#ffffff', '#1a0f0a', '#ff5b2e'],
  ['#e9e4ff', '#3b1fa3', '#ff3d7f', '#3b1fa3', '#e9e4ff'],
  ['#0d1b2a', '#ffb703', '#fb8500', '#ffb703', '#0d1b2a'],
  ['#f7f3ea', '#7a1f1f', '#c0392b', '#7a1f1f', '#f7f3ea'],
  ['#d8f3dc', '#081c15', '#2d6a4f', '#081c15', '#d8f3dc'],
  ['#1b1b1b', '#ff6ec7', '#00e5ff', '#ff6ec7', '#1b1b1b'],
  ['#fdf0d5', '#003049', '#c1121f', '#003049', '#fdf0d5'],
];
const MONO_FONTS = ['IBM Plex Mono', 'Space Mono', 'VT323', 'Major Mono Display'];

const rand = (lo, hi, step = 0) => {
  const v = lo + Math.random() * (hi - lo);
  return step ? +(Math.round(v / step) * step).toFixed(decimals(step)) : v;
};
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

function hslHex(h, s, l) {
  s /= 100; l /= 100;
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// A made-up palette: near-black or near-white paper, a saturated ink far enough away to read.
function inventPalette() {
  const h = rand(0, 360);
  const dark = Math.random() < 0.5;
  const paper = hslHex(h, rand(8, 50), dark ? rand(5, 12) : rand(88, 96));
  const inkHue = (h + pick([0, 30, 150, 180, 210])) % 360;
  const ink = hslHex(inkHue, rand(55, 100), dark ? rand(60, 78) : rand(14, 32));
  const accent = hslHex((inkHue + rand(120, 220)) % 360, 90, 55);
  return Math.random() < 0.5 ? [paper, ink, accent, ink, paper] : [paper, ink, accent, paper, ink];
}

function shuffledDesign() {
  const [paper, ink, accent, cardBg, cardInk] = Math.random() < 0.6 ? pick(PALETTES) : inventPalette();
  const stageFont = pick(FONTS);
  return {
    paper, ink, accent, cardBg, cardInk,
    speed: rand(0.2, 2.5, 0.05),
    amount: rand(0.4, 2, 0.05),
    blobScale: rand(0.5, 2.2, 0.05),
    reactivity: rand(0.4, 2.4, 0.05),
    grid: Math.round(rand(80, 160)),
    inkAlpha: rand(0.4, 0.95, 0.01),
    texture: rand(0, 0.9, 0.01),
    glyphRate: rand(0, 0.3, 0.01),
    crosses: Math.round(rand(0, 14)),
    burstSize: rand(0.4, 2.2, 0.05),
    ramp: pick(Object.values(RAMPS)),
    sceneFont: pick(MONO_FONTS),
    stageFont,
    stageSize: rand(2.8, 5.2, 0.1) * (stageFont === 'VT323' ? 1.25 : 1),
    tracking: rand(-0.02, 0.12, 0.005),
    uppercase: Math.random() < 0.8,
    glow: Math.random() < 0.5,
    boxPct: Math.round(rand(0, 25)),
    serifPct: Math.round(rand(0, 15)),
    invPct: Math.round(rand(0, 15)),
    cardFont: pick(['Anton', 'Archivo Black', 'VT323', 'Instrument Serif', 'Major Mono Display', 'Space Mono']),
    camMode: pick(['blend', 'blend', 'camera only', 'edges', 'edges + fill']),
    camContrast: rand(0.8, 2, 0.05),
    camTrail: Math.random() < 0.4 ? rand(0.3, 0.8, 0.01) : 0,
    camLevels: pick([0, 0, 0, 3, 4, 6]),
    camInvert: Math.random() < 0.2,
  };
}

// type: dial | slider | color | select | toggle | text
const SECTIONS = [
  ['SCENE', [
    { key: 'speed', label: 'speed', type: 'dial', min: 0, max: 4, step: 0.05 },
    { key: 'amount', label: 'blobs', type: 'dial', min: 0, max: 2.4, step: 0.05 },
    { key: 'blobScale', label: 'busy', type: 'dial', min: 0.3, max: 3, step: 0.05 },
    { key: 'reactivity', label: 'voice', type: 'dial', min: 0, max: 3, step: 0.05 },
    { key: 'grid', label: 'grid columns', type: 'slider', min: 50, max: 240, step: 1 },
    { key: 'inkAlpha', label: 'ink strength', type: 'slider', min: 0.16, max: 1, step: 0.01 },
    { key: 'texture', label: 'texture', type: 'slider', min: 0, max: 1, step: 0.01 },
    { key: 'glyphRate', label: 'floating glyphs', type: 'slider', min: 0, max: 0.5, step: 0.01 },
    { key: 'crosses', label: 'crosshairs', type: 'slider', min: 0, max: 24, step: 1 },
    { key: 'burstSize', label: 'stamped words', type: 'slider', min: 0, max: 3, step: 0.05 },
    { key: 'fps', label: 'frame rate cap', type: 'slider', min: 10, max: 60, step: 1 },
    { key: 'ramp', label: 'characters', type: 'ramp' },
    { key: 'sceneFont', label: 'scene font', type: 'select', options: FONTS },
  ]],
  ['CAMERA', [
    { type: 'camera-button' },
    { key: 'camMix', label: 'strength', type: 'dial', min: 0, max: 1, step: 0.01 },
    { key: 'camContrast', label: 'contrast', type: 'dial', min: 0.3, max: 3, step: 0.05 },
    { key: 'camBrightness', label: 'bright', type: 'dial', min: -0.6, max: 0.6, step: 0.01 },
    { key: 'camTrail', label: 'trails', type: 'dial', min: 0, max: 0.95, step: 0.01 },
    { key: 'camMode', label: 'style', type: 'select', options: ['blend', 'camera only', 'edges', 'edges + fill'] },
    { key: 'camFit', label: 'position', type: 'select', options: ['full', 'left', 'right', 'centre'] },
    { key: 'camLevels', label: 'posterise (0 = smooth)', type: 'slider', min: 0, max: 8, step: 1 },
    { key: 'camInvert', label: 'invert (light parts get ink)', type: 'toggle' },
    { key: 'camMirror', label: 'mirror', type: 'toggle' },
  ]],
  ['COLOUR', [
    { key: 'paper', label: 'paper', type: 'color' },
    { key: 'ink', label: 'ink', type: 'color' },
    { key: 'accent', label: 'live dot', type: 'color' },
    { key: 'cardBg', label: 'card', type: 'color' },
    { key: 'cardInk', label: 'card ink', type: 'color' },
  ]],
  ['WORDS', [
    { key: 'stageSize', label: 'size', type: 'dial', min: 1.5, max: 9, step: 0.1 },
    { key: 'tracking', label: 'spacing', type: 'dial', min: -0.06, max: 0.3, step: 0.005 },
    { key: 'boxPct', label: 'boxed', type: 'dial', min: 0, max: 60, step: 1, unit: '%' },
    { key: 'serifPct', label: 'serif', type: 'dial', min: 0, max: 60, step: 1, unit: '%' },
    { key: 'invPct', label: 'inverted', type: 'dial', min: 0, max: 60, step: 1, unit: '%' },
    { key: 'stageFont', label: 'font', type: 'select', options: FONTS },
    { key: 'stageUtts', label: 'phrases on stage', type: 'slider', min: 1, max: 8, step: 1 },
    { key: 'stageWidth', label: 'stage width', type: 'slider', min: 30, max: 92, step: 1, unit: 'vw' },
    { key: 'stageTop', label: 'stage top', type: 'slider', min: 4, max: 40, step: 1, unit: 'vh' },
    { key: 'uppercase', label: 'uppercase', type: 'toggle' },
    { key: 'glow', label: 'paper glow behind words', type: 'toggle' },
    { key: 'cursor', label: 'block cursor', type: 'toggle' },
  ]],
  ['PANELS', [
    { key: 'uiScale', label: 'UI scale', type: 'dial', min: 0.5, max: 3, step: 0.05 },
    { key: 'cardScale', label: 'card size', type: 'dial', min: 0.5, max: 1.6, step: 0.02 },
    { key: 'cardHold', label: 'card secs', type: 'dial', min: 0, max: 30, step: 1, unit: 's' },
    { key: 'cardFont', label: 'card font', type: 'select', options: FONTS },
    { key: 'transcriptWidth', label: 'transcript width', type: 'slider', min: 15, max: 45, step: 1, unit: 'vw' },
    { key: 'transcriptSize', label: 'transcript text', type: 'slider', min: 0.6, max: 2, step: 0.05 },
    { key: 'hudOpacity', label: 'HUD opacity', type: 'slider', min: 0, max: 1, step: 0.01 },
    { key: 'frame', label: 'corner frame and labels', type: 'toggle' },
  ]],
];

const decimals = (step) => (String(step).split('.')[1] || '').length;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export function createDesignPanel({ onChange, onPreview, onCamera }) {
  const design = { ...DESIGN_DEFAULTS, ...loadJSON(STORE, {}) };
  const userPresets = loadJSON(STORE_PRESETS, {});
  const refreshers = [];
  let saveTimer = 0;

  const panel = el('aside', 'design-panel');
  panel.id = 'design';
  panel.hidden = true;
  document.body.appendChild(panel);

  function commit(save = true) {
    onChange(design);
    if (save) {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => localStorage.setItem(STORE, JSON.stringify(design)), 250);
    }
  }

  function setValue(key, value) {
    design[key] = value;
    commit();
  }

  function applyAll(values) {
    Object.assign(design, DESIGN_DEFAULTS, values);
    refreshers.forEach((r) => r());
    commit();
  }

  function dial(def) {
    const wrap = el('div', 'ctl-dial');
    const knob = el('div', 'dial');
    knob.tabIndex = 0;
    knob.title = 'Drag up/down, scroll, or arrow keys. Double-click resets.';
    const pointer = el('i');
    knob.appendChild(pointer);
    const readout = el('div', 'dial-val');
    wrap.append(knob, readout, el('div', 'dial-label', def.label));

    const range = def.max - def.min;
    const set = (v) => {
      v = clamp(Math.round(v / def.step) * def.step, def.min, def.max);
      v = +v.toFixed(decimals(def.step));
      setValue(def.key, v);
      paint();
    };
    const paint = () => {
      const p = (design[def.key] - def.min) / range;
      knob.style.setProperty('--a', `${p * 270}deg`);
      readout.textContent = `${design[def.key]}${def.unit || ''}`;
    };

    knob.addEventListener('pointerdown', (e) => {
      knob.setPointerCapture(e.pointerId);
      const y0 = e.clientY, v0 = design[def.key];
      const fine = e.shiftKey ? 0.25 : 1;
      const move = (ev) => set(v0 + (y0 - ev.clientY) / 160 * range * fine);
      const up = () => { knob.removeEventListener('pointermove', move); knob.removeEventListener('pointerup', up); };
      knob.addEventListener('pointermove', move);
      knob.addEventListener('pointerup', up);
    });
    knob.addEventListener('wheel', (e) => { e.preventDefault(); set(design[def.key] - Math.sign(e.deltaY) * def.step * (e.shiftKey ? 1 : 4)); }, { passive: false });
    knob.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(design[def.key] + def.step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(design[def.key] - def.step);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });
    knob.addEventListener('dblclick', () => set(DESIGN_DEFAULTS[def.key]));
    refreshers.push(paint);
    paint();
    return wrap;
  }

  function row(def, input, readout) {
    const r = el('label', 'ctl-row');
    const head = el('span', 'ctl-label', def.label);
    r.append(head, input);
    if (readout) r.appendChild(readout);
    return r;
  }

  function slider(def) {
    const input = el('input');
    input.type = 'range';
    input.min = def.min; input.max = def.max; input.step = def.step;
    const out = el('output');
    const paint = () => { input.value = design[def.key]; out.textContent = `${design[def.key]}${def.unit || ''}`; };
    input.addEventListener('input', () => { setValue(def.key, +input.value); out.textContent = `${input.value}${def.unit || ''}`; });
    input.addEventListener('dblclick', () => { setValue(def.key, DESIGN_DEFAULTS[def.key]); paint(); });
    refreshers.push(paint);
    paint();
    return row(def, input, out);
  }

  function color(def) {
    const input = el('input');
    input.type = 'color';
    const paint = () => { input.value = design[def.key]; };
    input.addEventListener('input', () => setValue(def.key, input.value));
    refreshers.push(paint);
    paint();
    return row(def, input);
  }

  function select(def) {
    const input = el('select');
    for (const o of def.options) input.appendChild(Object.assign(el('option', null, o), { value: o }));
    const paint = () => { input.value = design[def.key]; };
    input.addEventListener('change', () => setValue(def.key, input.value));
    refreshers.push(paint);
    paint();
    return row(def, input);
  }

  function toggle(def) {
    const input = el('input');
    input.type = 'checkbox';
    const paint = () => { input.checked = !!design[def.key]; };
    input.addEventListener('change', () => setValue(def.key, input.checked));
    refreshers.push(paint);
    paint();
    const r = row(def, input);
    r.classList.add('ctl-toggle');
    return r;
  }

  function ramp(def) {
    const wrap = el('div', 'ctl-ramp');
    const pick = el('select');
    pick.appendChild(Object.assign(el('option', null, 'custom'), { value: '' }));
    for (const [name, chars] of Object.entries(RAMPS)) pick.appendChild(Object.assign(el('option', null, name), { value: chars }));
    const text = el('input');
    text.type = 'text';
    text.spellcheck = false;
    text.title = 'Light to dark. The first character is the empty cell.';
    const paint = () => { text.value = design[def.key]; pick.value = Object.values(RAMPS).includes(design[def.key]) ? design[def.key] : ''; };
    pick.addEventListener('change', () => { if (pick.value) { setValue(def.key, pick.value); paint(); } });
    text.addEventListener('input', () => { if (text.value.length > 1) { setValue(def.key, text.value); pick.value = ''; } });
    refreshers.push(paint);
    paint();
    wrap.append(pick, text);
    return row(def, wrap);
  }

  let camSelect = null;
  function cameraPicker() {
    camSelect = el('select');
    camSelect.appendChild(Object.assign(el('option', null, 'Off'), { value: '' }));
    camSelect.addEventListener('change', () => onCamera?.(camSelect.value));
    const r = row({ label: 'camera (C toggles)' }, camSelect);
    r.classList.add('ctl-camera');
    return r;
  }

  const builders = { dial, slider, color, select, toggle, ramp, 'camera-button': cameraPicker };

  // Header: presets and actions
  const head = el('div', 'design-head');
  const title = el('div', 'panel-title', 'DESIGN');
  const close = el('button', 'design-x', 'D to close');
  close.addEventListener('click', () => toggle_());
  head.append(title, close);

  const presetRow = el('div', 'design-presets');
  const presetSel = el('select');
  const fillPresets = () => {
    presetSel.textContent = '';
    presetSel.appendChild(Object.assign(el('option', null, 'presets...'), { value: '' }));
    for (const name of Object.keys(PRESETS)) presetSel.appendChild(Object.assign(el('option', null, name), { value: `b:${name}` }));
    for (const name of Object.keys(userPresets)) presetSel.appendChild(Object.assign(el('option', null, `* ${name}`), { value: `u:${name}` }));
  };
  fillPresets();
  presetSel.addEventListener('change', () => {
    const v = presetSel.value;
    if (!v) return;
    const name = v.slice(2);
    const values = v.startsWith('b:') ? PRESETS[name] : userPresets[name];
    // Mood presets (Calm, Chaos) keep your colours; full looks replace everything.
    if (v.startsWith('b:') && !('paper' in values) && name !== 'Paper') {
      Object.assign(design, values);
      refreshers.forEach((r) => r());
      commit();
    } else {
      applyAll(values);
    }
    presetSel.value = '';
  });

  const btn = (label, fn) => { const b = el('button', null, label); b.addEventListener('click', fn); return b; };
  presetRow.append(
    presetSel,
    btn('save as...', () => {
      const name = prompt('Name this look');
      if (!name) return;
      userPresets[name] = { ...design };
      localStorage.setItem(STORE_PRESETS, JSON.stringify(userPresets));
      fillPresets();
    }),
    btn('reset', () => applyAll({})),
  );

  const actions = el('div', 'design-presets');
  actions.append(
    btn('preview words', () => onPreview()),
    btn('copy JSON', async () => {
      await navigator.clipboard.writeText(JSON.stringify(design, null, 2));
    }),
    btn('paste JSON', async () => {
      try { applyAll(JSON.parse(await navigator.clipboard.readText())); } catch { alert('The clipboard does not hold a design JSON.'); }
    }),
  );

  const history = [];
  function shuffle() {
    history.push({ ...design });
    if (history.length > 30) history.shift();
    Object.assign(design, shuffledDesign());
    design.stageSize = +design.stageSize.toFixed(1);
    refreshers.forEach((r) => r());
    commit();
  }
  function undo() {
    const prev = history.pop();
    if (!prev) return;
    Object.assign(design, prev);
    refreshers.forEach((r) => r());
    commit();
  }

  const shuffleRow = el('div', 'design-shuffle');
  const shuffleBtn = btn('SHUFFLE (S)', shuffle);
  shuffleBtn.className = 'shuffle-btn';
  shuffleRow.append(shuffleBtn, btn('undo (Z)', undo));

  panel.append(head, shuffleRow, presetRow, actions);

  for (const [name, defs] of SECTIONS) {
    const sec = el('section', 'design-sec');
    sec.appendChild(el('h4', null, name));
    const dials = el('div', 'dials');
    for (const def of defs) {
      const node = builders[def.type](def);
      if (def.type === 'dial') dials.appendChild(node);
      else sec.appendChild(node);
    }
    const pick = sec.querySelector('.ctl-camera');
    if (dials.children.length) sec.insertBefore(dials, pick ? pick.nextSibling : sec.children[1]);
    panel.appendChild(sec);
  }

  panel.appendChild(el('p', 'design-tip', 'Dials: drag up/down (Shift for fine), scroll, or arrow keys. Double-click any dial or slider to reset it.'));

  function toggle_() {
    panel.hidden = !panel.hidden;
    document.body.classList.toggle('design-open', !panel.hidden);
  }

  commit(false);
  // The app owns the device list and fills the picker with it.
  function set(key, value) {
    design[key] = value;
    refreshers.forEach((r) => r());
    commit();
  }

  return { design, toggle: toggle_, shuffle, undo, set, setCameraOptions: (fill) => camSelect && fill(camSelect) };
}
