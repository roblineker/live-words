// The ASCII scene behind the words: a drifting density field, floating glyphs,
// crosshairs, and (optionally) the camera rendered as characters.
// Everything visual is driven by `params`, which the design panel changes live.

const GLYPHS = ['<o=>', '(@)', '=[]-o-[]=', '<|o|>', '\\o/', '(o)', '.oO', '}=>', '{', '}', '[', ']',
  '#', '%', '&', '$', '~', '^', '1', '0', 'x', '/', '|', '<', '>', '*'];
const SCRAMBLE = '#%&*+=-<>/\\|{}[]()@$o0x~^';

export const SCENE_DEFAULTS = {
  grid: 120,          // columns across the screen
  speed: 1,           // how fast the field drifts
  amount: 1.2,        // how much of the screen the blobs cover
  blobScale: 1,       // blob size (higher = smaller, busier blobs)
  reactivity: 1,      // how hard the voice pushes the field
  inkAlpha: 0.62,     // darkest character opacity
  texture: 0.5,       // the faint = + rows between blobs
  glyphRate: 0.09,    // floating glyphs per frame
  crosses: 6,         // crosshair count
  burstSize: 1,       // size of stamped words
  camMix: 1,          // camera strength when the camera is on
  camMode: 'blend',   // blend | camera only | edges | edges + fill
  camFit: 'full',     // full | left | right | centre
  camContrast: 1.2,
  camBrightness: 0,
  camInvert: false,   // off: dark parts of the picture get dense characters
  camMirror: true,
  camTrail: 0,        // motion trails, 0..0.95
  camLevels: 0,       // posterise steps, 0 = smooth
  fps: 30,            // frame rate cap
  ramp: ' .-=+*o%#@', // light to dark
  sceneFont: 'IBM Plex Mono',
  ink: '#141414',
};

export function createAsciiBackground(canvas) {
  const ctx = canvas.getContext('2d');
  const sampler = document.createElement('canvas');
  const sctx = sampler.getContext('2d', { willReadFrequently: true });
  const params = { ...SCENE_DEFAULTS };

  let W = 0, H = 0, dpr = 1;
  let cell = 14, cw = 8.4, cols = 0, rows = 0;
  let level = 0, target = 0;
  let video = null, camDark = null;
  let lastDraw = 0;
  const sprites = [];
  const crosses = [];
  const stats = { fps: 0, drawMs: 0, drawMsMax: 0, cells: 0 };
  let frames = 0, drawTotal = 0, statsAt = performance.now();

  function font(size, weight = 400) {
    return `${weight} ${size}px "${params.sceneFont}", ui-monospace, Consolas, monospace`;
  }

  function buildCrosses() {
    crosses.length = 0;
    for (let i = 0; i < params.crosses; i++) {
      crosses.push({ x: Math.random() * W, y: Math.random() * H, len: 30 + Math.random() * 90, phase: Math.random() * 6 });
    }
  }

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.font = font(100);
    const ratio = (ctx.measureText('M').width || 60) / 100;
    cell = Math.max(5, W / params.grid / ratio);
    cw = cell * ratio;
    cols = Math.ceil(W / cw);
    rows = Math.ceil(H / cell);
    stats.cells = cols * rows;
    buildCrosses();
  }

  // Smooth blobs from a few overlapping waves; returns 0..1 density.
  function fieldAt(c, r, t) {
    const k = params.blobScale;
    const x = c * cw / cell * k;
    const y = r * k;
    const a = Math.sin(x * 0.09 + t * 0.23)
      + Math.sin(y * 0.13 - t * 0.19)
      + Math.sin(x * 0.05 + y * 0.08 + t * 0.11)
      + 0.8 * Math.sin(Math.hypot(x - cols * 0.3 * k, y - rows * 0.35 * k) * 0.22 - t * 0.5);
    const v = (a - (2.4 - params.amount)) / 2.2;
    return v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
  }

  function textureAt(c, r, t, cut) {
    return c % 2 === 0 && Math.sin(c * 0.13 + r * 0.05 + t * 0.05) + Math.sin(r * 0.21 - t * 0.07) > cut;
  }

  // Where on the grid the camera lands, in cells.
  function camRegion() {
    const fit = params.camFit;
    if (fit === 'left') return { c0: 0, r0: 0, w: Math.ceil(cols / 2), h: rows };
    if (fit === 'right') return { c0: Math.floor(cols / 2), r0: 0, w: cols - Math.floor(cols / 2), h: rows };
    if (fit === 'centre') {
      const h = Math.round(rows * 0.7);
      const w = Math.round((h * cell * 0.85) / cw);
      return { c0: Math.round((cols - w) / 2), r0: Math.round((rows - h) / 2), w, h };
    }
    return { c0: 0, r0: 0, w: cols, h: rows };
  }

  let camLum = null, camPrev = null;

  // Fills camDark (one value per grid cell, -1 = outside the camera area) with 0..1 ink density.
  function sampleCamera() {
    if (!video || video.readyState < 2 || !video.videoWidth) { camDark = null; return; }
    const { c0, r0, w, h } = camRegion();
    if (sampler.width !== w || sampler.height !== h) { sampler.width = w; sampler.height = h; }
    const vw = video.videoWidth, vh = video.videoHeight;
    // Cells are taller than wide, so crop the video to the region's real aspect.
    const aspect = (w * cw) / (h * cell);
    let sw = vw, sh = vw / aspect;
    if (sh > vh) { sh = vh; sw = vh * aspect; }
    sctx.save();
    if (params.camMirror) { sctx.translate(w, 0); sctx.scale(-1, 1); }
    sctx.drawImage(video, (vw - sw) / 2, (vh - sh) / 2, sw, sh, 0, 0, w, h);
    sctx.restore();
    const d = sctx.getImageData(0, 0, w, h).data;
    const n = w * h;
    if (!camLum || camLum.length !== n) { camLum = new Float32Array(n); camPrev = null; }

    let lo = 1, hi = 0;
    for (let i = 0; i < n; i++) {
      const l = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
      camLum[i] = l;
      if (l < lo) lo = l;
      if (l > hi) hi = l;
    }
    const span = Math.max(0.15, hi - lo);
    const mode = params.camMode;
    const edges = mode === 'edges' || mode === 'edges + fill';
    const levels = params.camLevels;

    const total = cols * rows;
    if (!camDark || camDark.length !== total) { camDark = new Float32Array(total); camPrev = null; }
    camDark.fill(-1);
    if (!camPrev || camPrev.length !== n) camPrev = new Float32Array(n);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let v = 1 - (camLum[i] - lo) / span; // dark = dense
        if (edges) {
          const at = (xx, yy) => camLum[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
          const gx = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
          const gy = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
          const edge = Math.min(1, Math.hypot(gx, gy) / span * 1.6);
          v = mode === 'edges' ? edge : Math.max(edge, v * 0.45);
        }
        if (params.camInvert) v = 1 - v;
        v = (v - 0.5) * params.camContrast + 0.5 + params.camBrightness;
        if (levels > 1) v = Math.round(v * (levels - 1)) / (levels - 1);
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        if (params.camTrail > 0) v = Math.max(v, camPrev[i] * params.camTrail);
        camPrev[i] = v;
        const gr = r0 + y, gc = c0 + x;
        if (gr >= 0 && gr < rows && gc >= 0 && gc < cols) camDark[gr * cols + gc] = v;
      }
    }
  }

  function spawn(text, opts = {}) {
    sprites.push({
      text,
      x: opts.x ?? Math.random() * W * 0.95,
      y: opts.y ?? Math.random() * H,
      vx: (Math.random() - 0.5) * 10,
      vy: -3 - Math.random() * 8,
      age: 0,
      life: opts.life ?? 3 + Math.random() * 4,
      size: opts.size ?? cell * (1 + Math.random() * 0.7),
      weight: opts.weight ?? (Math.random() < 0.3 ? 700 : 400),
      reveal: opts.reveal ?? 0,
    });
    if (sprites.length > 90) sprites.shift();
  }

  function drawSprites(dt) {
    ctx.textBaseline = 'top';
    for (let i = sprites.length - 1; i >= 0; i--) {
      const s = sprites[i];
      s.age += dt;
      if (s.age >= s.life) { sprites.splice(i, 1); continue; }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let text = s.text;
      if (s.reveal > 0 && s.age < s.reveal) {
        const shown = Math.floor(text.length * s.age / s.reveal);
        text = text.slice(0, shown) + Array.from(text.slice(shown), (ch) =>
          ch === ' ' ? ' ' : SCRAMBLE[(Math.random() * SCRAMBLE.length) | 0]).join('');
      }
      ctx.globalAlpha = Math.sin(Math.PI * s.age / s.life) * 0.9;
      ctx.font = font(s.size, s.weight);
      ctx.fillText(text, s.x, s.y);
    }
  }

  function drawCrosses(t) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = params.ink;
    ctx.font = font(cell * 1.6, 700);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (const c of crosses) {
      const x = c.x + Math.sin(t * 0.2 + c.phase) * 20;
      const y = c.y + Math.cos(t * 0.15 + c.phase) * 14;
      const len = c.len * (0.7 + 0.3 * Math.sin(t * 0.6 + c.phase) + level * 0.8);
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.moveTo(x, y - len); ctx.lineTo(x, y + len);
      ctx.moveTo(x - len * 0.35, y); ctx.lineTo(x + len * 0.35, y);
      ctx.stroke();
      ctx.globalAlpha = 0.9;
      ctx.fillText('*', x, y);
    }
    ctx.textAlign = 'left';
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (now - lastDraw < 1000 / params.fps - 1) return;
    const dt = Math.min(0.1, (now - lastDraw) / 1000);
    lastDraw = now;
    const drawStart = performance.now();
    level += (target - level) * 0.3;
    target *= 0.88;
    const t = now / 1000 * params.speed;
    const ramp = params.ramp.length > 1 ? params.ramp : ' #';
    const steps = ramp.length - 1;
    const boost = 0.35 * params.reactivity;
    const texCut = 1.6 - params.texture * 2.2;
    const alphaSpan = Math.max(0, params.inkAlpha - 0.16);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = params.ink;
    ctx.textBaseline = 'top';
    ctx.font = font(cell);
    if (video) sampleCamera();

    const camOnly = camDark && params.camMode !== 'blend';
    for (let r = 0; r < rows; r++) {
      const y = r * cell;
      for (let c = 0; c < cols; c++) {
        const cam = camDark ? camDark[r * cols + c] : -1;
        let v = camOnly && cam >= 0 ? 0 : fieldAt(c, r, t);
        if (boost) v += level * boost * fieldAt(c + 40, r + 9, t * 1.7);
        if (cam >= 0) v = Math.max(v * (1 - 0.6 * params.camMix), (cam * 1.1 - 0.12) * params.camMix);
        if (v < 0.06) {
          if (params.texture > 0 && textureAt(c, r, t, texCut)) {
            ctx.globalAlpha = 0.13;
            ctx.fillText(r % 2 ? '+' : '=', c * cw, y);
          }
          continue;
        }
        if (v > 0.999) v = 0.999;
        ctx.globalAlpha = 0.16 + v * alphaSpan;
        ctx.fillText(ramp[1 + Math.floor(v * steps)] || ramp[steps], c * cw, y);
      }
    }

    if (Math.random() < params.glyphRate * (1 + level * 3 * params.reactivity)) spawn(GLYPHS[(Math.random() * GLYPHS.length) | 0]);
    drawCrosses(t);
    drawSprites(dt);
    ctx.globalAlpha = 1;

    const ms = performance.now() - drawStart;
    frames++;
    drawTotal += ms;
    if (ms > stats.drawMsMax) stats.drawMsMax = ms;
    if (now - statsAt >= 1000) {
      stats.fps = Math.round(frames * 1000 / (now - statsAt));
      stats.drawMs = +(drawTotal / Math.max(1, frames)).toFixed(1);
      frames = 0;
      drawTotal = 0;
      statsAt = now;
    }
  }

  window.addEventListener('resize', resize);
  resize();
  if (document.fonts) document.fonts.ready.then(resize);
  requestAnimationFrame(frame);

  return {
    params,
    stats,
    // Take new design values; rebuild the grid only when its shape changed.
    set(next) {
      const regrid = next.grid !== params.grid || next.sceneFont !== params.sceneFont;
      const recross = next.crosses !== params.crosses;
      Object.assign(params, next);
      if (regrid) {
        resize();
        if (document.fonts) document.fonts.load(font(16)).then(resize);
      } else if (recross) buildCrosses();
    },
    takeMaxDraw() { const m = stats.drawMsMax; stats.drawMsMax = 0; return +m.toFixed(1); },
    // Audio level, 0..1. Peaks are held and decay on their own.
    setLevel(v) { if (v > target) target = Math.min(1, v); },
    // A new word landed: a small kick.
    ping() { target = Math.min(1, target + 0.12 * params.reactivity); },
    // A finished phrase or a cue: stamp a word into the scene.
    burst(word) {
      if (!word || params.burstSize <= 0) return;
      const x = W * (0.05 + Math.random() * 0.6);
      const y = H * (0.1 + Math.random() * 0.75);
      spawn(word.toUpperCase(), { x, y, size: cell * (2.4 + Math.random() * 1.6) * params.burstSize, weight: 700, life: 5.5, reveal: 0.6 });
      for (let i = 0; i < 4; i++) {
        spawn(GLYPHS[(Math.random() * GLYPHS.length) | 0], { x: x + (Math.random() - 0.3) * 260, y: y + (Math.random() - 0.5) * 140 });
      }
      target = Math.min(1, target + 0.35 * params.reactivity);
    },
    setCamera(el) { video = el; if (!el) camDark = null; },
  };
}
