// Film looks applied at capture time (baked into the JPEG, like a real disposable camera).
// Pure pixel math on ImageData — works in every browser (no ctx.filter, which Safari lacks).

export const LOOKS = {
  none: { label: 'Natural' },
  classic: { label: 'Classic film', curve: [12, 0.92, 1.12], tint: [1.04, 1.0, 0.94], sat: 0.92, grain: 10, vignette: 0.28 },
  warm: { label: 'Golden hour', curve: [8, 0.95, 1.08], tint: [1.1, 1.02, 0.86], sat: 1.05, grain: 8, vignette: 0.22 },
  mono: { label: 'Black & white', curve: [6, 0.9, 1.22], tint: [1, 1, 1], sat: 0, grain: 14, vignette: 0.32 },
  vivid: { label: 'Vivid', curve: [0, 1.0, 1.15], tint: [1.02, 1.0, 1.0], sat: 1.3, grain: 5, vignette: 0.15 },
  fade: { label: 'Faded', curve: [34, 0.86, 0.92], tint: [0.98, 1.0, 1.04], sat: 0.78, grain: 9, vignette: 0.18 },
};

// curve = [lift, gamma, contrast]
function buildLut([lift, gamma, contrast], tint) {
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let x = i / 255;
    x = Math.pow(x, gamma);
    x = (x - 0.5) * contrast + 0.5; // contrast around mid grey
    x = lift / 255 + x * (1 - lift / 255); // lifted blacks
    lut[i] = Math.round(x * 255 * tint);
  }
  return lut;
}

const cache = new Map();
function luts(name) {
  if (!cache.has(name)) {
    const L = LOOKS[name];
    cache.set(name, [0, 1, 2].map((c) => buildLut(L.curve, L.tint[c])));
  }
  return cache.get(name);
}

/** Apply a look in place to a 2D canvas. */
export function applyLook(canvas, name) {
  const L = LOOKS[name];
  if (!L || name === 'none') return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const [lr, lg, lb] = luts(name);
  const sat = L.sat;
  const grain = L.grain;
  const vig = L.vignette;
  const cx = w / 2, cy = h / 2, maxR2 = cx * cx + cy * cy;
  let seed = 0x9e3779b9 ^ (w * 73856093) ^ (h * 19349663);
  for (let y = 0; y < h; y++) {
    const dy2 = (y - cy) * (y - cy);
    let i = y * w * 4;
    for (let x = 0; x < w; x++, i += 4) {
      let r = lr[d[i]], g = lg[d[i + 1]], b = lb[d[i + 2]];
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      r = l + (r - l) * sat; g = l + (g - l) * sat; b = l + (b - l) * sat;
      // xorshift noise
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      const n = ((seed & 255) / 255 - 0.5) * grain;
      const dx = x - cx;
      const v = 1 - vig * ((dx * dx + dy2) / maxR2);
      d[i] = (r + n) * v; d[i + 1] = (g + n) * v; d[i + 2] = (b + n) * v;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Orange LED date stamp in the corner, like a 90s point-and-shoot. */
export function stampDate(canvas, date = new Date()) {
  const ctx = canvas.getContext('2d');
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, ' ');
  const dd = String(date.getDate()).padStart(2, '0');
  const text = `'${yy}  ${mm}  ${dd}`;
  const size = Math.round(Math.min(canvas.width, canvas.height) * 0.045);
  ctx.save();
  ctx.font = `700 ${size}px "Courier New", ui-monospace, monospace`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.shadowColor = 'rgba(255,140,40,0.9)';
  ctx.shadowBlur = size * 0.35;
  ctx.fillStyle = '#ff9a3c';
  ctx.fillText(text, canvas.width - size * 1.2, canvas.height - size * 0.9);
  ctx.restore();
}

/** Draw a source onto a canvas no larger than maxEdge on its long side. */
export function drawScaled(source, sw, sh, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  return c;
}

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.88) {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality));
}

/**
 * "Enhance": automatic, natural touch-up (non-destructive — applied to a copy).
 * Per-channel levels stretch from robust percentiles (fixes dull/cast photos), a gentle
 * S-curve and a small saturation lift. Pure pixel math, runs on the viewer's device.
 */
export function enhance(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const { width: w, height: h } = canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  const step = Math.max(1, Math.floor((w * h) / 250000)) * 4;
  let n = 0;
  for (let i = 0; i < d.length; i += step) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; n++; }
  const pct = (hst, p) => { let acc = 0; const target = n * p; for (let v = 0; v < 256; v++) { acc += hst[v]; if (acc >= target) return v; } return 255; };
  const luts = hist.map((hst) => {
    let lo = pct(hst, 0.005), hi = pct(hst, 0.995);
    if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - 20); hi = Math.min(255, mid + 20); }
    const scale = Math.min(1.6, 255 / Math.max(1, hi - lo));
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = ((v - lo) * scale) / 255;
      x = Math.min(1, Math.max(0, x));
      x = x + 0.08 * Math.sin(2 * Math.PI * (x - 0.5)) * (x * (1 - x) * 4) * 0.5; // gentle S-curve
      lut[v] = Math.round(x * 255);
    }
    return lut;
  });
  const sat = 1.1;
  for (let i = 0; i < d.length; i += 4) {
    let r = luts[0][d[i]], g = luts[1][d[i + 1]], b = luts[2][d[i + 2]];
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = l + (r - l) * sat; d[i + 1] = l + (g - l) * sat; d[i + 2] = l + (b - l) * sat;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * Sharpness score: variance of the Laplacian on a small greyscale copy.
 * Low values mean a badly blurred photo. Measured before film looks/grain are applied.
 */
export function blurScore(source, sw, sh) {
  const c = drawScaled(source, sw, sh, 512);
  const { width: w, height: h } = c;
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, p = 0; p < g.length; i += 4, p++) g[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  let sum = 0, sum2 = 0, cnt = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const lap = g[p - w] + g[p + w] + g[p - 1] + g[p + 1] - 4 * g[p];
      sum += lap; sum2 += lap * lap; cnt++;
    }
  }
  if (!cnt) return 0;
  const mean = sum / cnt;
  return Math.round(sum2 / cnt - mean * mean);
}
