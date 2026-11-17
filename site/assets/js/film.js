// Film looks applied at capture time (baked into the JPEG, like a real disposable camera).
// Pure pixel math on ImageData — works in every browser (no ctx.filter, which Safari lacks).

export const LOOKS = {
  none: { label: 'Natural' },
  classic: { label: 'Classic film', curve: [14, 0.92, 1.14], tint: [1.07, 1.01, 0.9], sat: 0.9, grain: 12, vignette: 0.32 },
  warm: { label: 'Golden hour', curve: [10, 0.93, 1.08], tint: [1.14, 1.03, 0.8], sat: 1.1, grain: 8, vignette: 0.26 },
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
 * "Enhance": automatic, natural touch-up applied to a copy (originals never change).
 * Adapts to each photo: dull/dark/flat shots get levels, brightness and a mild white-balance
 * fix; already-good shots change very little. Plus gentle local contrast and vibrance.
 * Tuned on sample photos (see docs/ARCHITECTURE.md). Runs on the viewer's device.
 */
export function enhance(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  enhancePixels(img.data, canvas.width, canvas.height);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function enhancePixels(d, w, h) {
  const N = w * h;
  const Y = new Float32Array(N);
  for (let i = 0, p = 0; p < N; i += 4, p++) Y[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  // --- tone: partial levels + midtone gamma (luminance only, hue preserved)
  const hist = new Uint32Array(256);
  for (let p = 0; p < N; p++) hist[Y[p] | 0]++;
  const pct = (q) => { let acc = 0; const t = N * q; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= t) return v; } return 255; };
  const lo0 = pct(0.005), hi0 = pct(0.995);
  const lo = Math.max(0, lo0 - 2), hi = Math.min(255, hi0 + 3);
  const gain = Math.min(1.8, 252 / Math.max(1, hi - lo));
  let mean = 0;
  for (let p = 0; p < N; p++) mean += Math.min(255, Math.max(0, (Y[p] - lo) * gain));
  mean /= N * 255;
  let gamma = Math.log(0.47) / Math.log(Math.min(0.95, Math.max(0.05, mean)));
  gamma = Math.min(1.35, Math.max(0.85, gamma));
  gamma = 1 + (gamma - 1) * 0.8;
  const tone = new Float32Array(256);
  for (let v = 0; v < 256; v++) tone[v] = 255 * Math.pow(Math.min(1, Math.max(0, ((v - lo) * gain) / 255)), 1 / gamma);
  // --- gentle white balance from midtones (35% toward neutral, capped ±6%)
  let sr = 0, sg = 0, sb = 0, sc = 0;
  for (let i = 0, p = 0; p < N; i += 4, p++) if (Y[p] > 40 && Y[p] < 220) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; sc++; }
  let wr = 1, wg = 1, wb = 1;
  if (sc > N * 0.05) {
    const avg = (sr + sg + sb) / 3;
    const k = (c) => Math.min(1.1, Math.max(0.9, 1 + ((avg / c) - 1) * 0.5));
    wr = k(sr); wg = k(sg); wb = k(sb);
  }
  // --- local contrast / sharpening: unsharp mask on luminance (box blur x2 ≈ gaussian r≈2)
  const blur = boxBlur(boxBlur(Y, w, h, 2), w, h, 2);
  for (let i = 0, p = 0; p < N; i += 4, p++) {
    const y = Y[p];
    const detail = y - blur[p];
    const yNew = Math.min(255, Math.max(0, tone[y | 0] + (Math.abs(detail) > 2 ? detail * 0.35 : 0)));
    const s = y > 1 ? yNew / y : 1;
    let r = d[i] * wr * s, g = d[i + 1] * wg * s, b = d[i + 2] * wb * s;
    // vibrance: lift muted colours more than already-saturated ones
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    const vib = 1 + 0.18 * (1 - sat) * sat * 4 * 0.5;
    const l = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = l + (r - l) * vib; d[i + 1] = l + (g - l) * vib; d[i + 2] = l + (b - l) * vib;
  }
}

function boxBlur(src, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let acc = 0; const row = y * w;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / n;
      acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / n;
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
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
