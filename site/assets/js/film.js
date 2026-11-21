// Looks applied at capture time (baked into the JPEG, like a real camera), plus an optional
// "Beauty" touch-up that softens skin and blemishes while keeping eyes, hair and edges sharp.
// Pure pixel math on ImageData: works in every browser (no ctx.filter, which Safari lacks),
// and the same code drives the live viewfinder preview, so what you see is what you get.

/*
 * Look parameters (all optional):
 *  exp      exposure multiplier            con   contrast (1 = none)       lift  black level (0-255)
 *  roll     highlight roll-off (0-1)       gamma midtone gamma             sat   saturation (1 = none)
 *  vib      vibrance (boost muted colours) warm  warm/cool shift (+warm)   tint  green/magenta (+green)
 *  sh / hi  split-tone colour added to shadows / highlights [r,g,b] in levels
 *  mono     black & white                  glow  soft dreamy bloom (0-1)   beauty extra skin softening (0-1)
 *  grain    film grain amount              vig   vignette strength
 */
export const LOOKS = {
  none: { label: 'Original' },
  vivid: { label: 'Bright', exp: 1.06, con: 1.12, gamma: 0.96, sat: 1.12, vib: 0.22, warm: 0.01, sh: [-4, 0, 7], hi: [6, 3, -2], grain: 0, vig: 0.08 },
  classic: { label: 'Classic film', exp: 1.02, con: 1.06, lift: 16, roll: 0.2, gamma: 0.97, sat: 0.9, warm: 0.045, tint: 0.01, sh: [-3, 4, 4], hi: [8, 4, -6], grain: 10, vig: 0.26 },
  warm: { label: 'Golden hour', exp: 1.04, con: 1.04, lift: 8, roll: 0.15, sat: 1.06, vib: 0.1, warm: 0.09, hi: [12, 5, -8], glow: 0.08, grain: 5, vig: 0.22 },
  moody: { label: 'Moody', exp: 0.98, con: 1.1, lift: 18, gamma: 1.04, sat: 0.82, warm: 0.02, sh: [-6, 2, 10], hi: [10, 4, -6], grain: 8, vig: 0.32 },
  mono: { label: 'Black & white', mono: true, exp: 1.02, con: 1.24, lift: 8, gamma: 0.98, grain: 12, vig: 0.26 },
};

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

function toneLut(L) {
  const lut = new Float32Array(256);
  const exp = L.exp || 1, con = L.con || 1, lift = (L.lift || 0) / 255, roll = L.roll || 0, gamma = L.gamma || 1;
  for (let i = 0; i < 256; i++) {
    let x = Math.min(1, (i / 255) * exp);
    if (roll > 0 && x > 0.75) { const t = (x - 0.75) / 0.25; x = 0.75 + 0.25 * (t - roll * t * t * 0.5); } // soft highlight shoulder
    x = Math.pow(x, gamma);
    // contrast as a gentle S-curve (smoothstep blend) so skin tones don't clip
    const s = x * x * (3 - 2 * x);
    x = con >= 1 ? x + (s - x) * (con - 1) * 2 : 0.5 + (x - 0.5) * con;
    x = lift + Math.min(1, Math.max(0, x)) * (1 - lift);
    lut[i] = x * 255;
  }
  return lut;
}
const lutCache = new Map();
const lutFor = (name) => { if (!lutCache.has(name)) lutCache.set(name, toneLut(LOOKS[name])); return lutCache.get(name); };

/**
 * Render a look (and Beauty) on raw RGBA pixels in place.
 * opts.beauty: 0-1 base skin softening (the look may add more). opts.grain: scale for grain (0 in preview).
 */
export function renderPixels(d, w, h, name, opts = {}) {
  const L = LOOKS[name] || LOOKS.none;
  const beauty = Math.min(1, (opts.beauty || 0) + (L.beauty || 0) * (opts.beauty ? 0.6 : 1));
  if (beauty > 0.02) beautifyPixels(d, w, h, beauty);
  if (name === 'none' || !LOOKS[name]) return;
  const lut = lutFor(name);
  const sat = L.sat ?? 1, vib = L.vib || 0, warm = L.warm || 0, tint = L.tint || 0;
  const sh = L.sh || [0, 0, 0], hi = L.hi || [0, 0, 0];
  const grain = (L.grain || 0) * (opts.grain ?? 1), vig = L.vig || 0, mono = !!L.mono;
  const glow = L.glow ? glowLayer(d, w, h) : null, gAmt = L.glow || 0;
  const cx = w / 2, cy = h / 2, maxR2 = cx * cx + cy * cy;
  let seed = 0x9e3779b9 ^ (w * 73856093) ^ (h * 19349663);
  for (let y = 0, i = 0, p = 0; y < h; y++) {
    const dy2 = (y - cy) * (y - cy);
    for (let x = 0; x < w; x++, i += 4, p++) {
      let r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
      let l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (mono) {
        // panchromatic-style mix: slightly more red keeps skin luminous
        l = 0.36 * r + 0.54 * g + 0.10 * b; r = g = b = l;
      } else {
        r *= 1 + warm; b *= 1 - warm; g *= 1 + tint;
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const cs = mx > 0 ? (mx - mn) / mx : 0;
        const k = sat * (1 + vib * (1 - cs));
        l = 0.299 * r + 0.587 * g + 0.114 * b;
        r = l + (r - l) * k; g = l + (g - l) * k; b = l + (b - l) * k;
        const t = l / 255, ws = (1 - t) * (1 - t), wh = t * t;
        r += sh[0] * ws + hi[0] * wh; g += sh[1] * ws + hi[1] * wh; b += sh[2] * ws + hi[2] * wh;
      }
      if (glow) { // screen blend with a soft, blurred copy: dreamy highlights, softer skin
        const q = p * 3;
        r = 255 - (255 - r) * (255 - glow[q] * gAmt) / 255;
        g = 255 - (255 - g) * (255 - glow[q + 1] * gAmt) / 255;
        b = 255 - (255 - b) * (255 - glow[q + 2] * gAmt) / 255;
      }
      let n = 0;
      if (grain) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; n = ((seed & 255) / 255 - 0.5) * grain; }
      const dx = x - cx;
      const v = 1 - vig * ((dx * dx + dy2) / maxR2) * ((dx * dx + dy2) / maxR2 + 0.6);
      d[i] = clamp255((r + n) * v); d[i + 1] = clamp255((g + n) * v); d[i + 2] = clamp255((b + n) * v);
    }
  }
}

/** Apply a look in place to a 2D canvas. */
export function applyLook(canvas, name, opts = {}) {
  if ((!LOOKS[name] || name === 'none') && !(opts.beauty > 0.02)) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  renderPixels(img.data, canvas.width, canvas.height, name, opts);
  ctx.putImageData(img, 0, 0);
}

/** Blurred RGB copy (computed small, upsampled bilinearly) for the glow look. */
function glowLayer(d, w, h) {
  const f = Math.max(1, Math.round(Math.max(w, h) / 160));
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f);
  const small = [new Float32Array(sw * sh), new Float32Array(sw * sh), new Float32Array(sw * sh)];
  const cnt = new Float32Array(sw * sh);
  for (let y = 0, i = 0; y < h; y++) {
    const row = ((y / f) | 0) * sw;
    for (let x = 0; x < w; x++, i += 4) {
      const q = row + ((x / f) | 0);
      // emphasise highlights so the glow comes from light sources and skin, not shadows
      const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255, k = 0.35 + 0.65 * l * l;
      small[0][q] += d[i] * k; small[1][q] += d[i + 1] * k; small[2][q] += d[i + 2] * k; cnt[q]++;
    }
  }
  const rad = Math.max(1, Math.round(Math.min(sw, sh) / 40));
  for (let c = 0; c < 3; c++) {
    for (let q = 0; q < cnt.length; q++) small[c][q] /= cnt[q] || 1;
    small[c] = boxBlur(boxBlur(small[c], sw, sh, rad), sw, sh, rad);
  }
  const out = new Float32Array(w * h * 3);
  for (let y = 0, p = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++, p++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < 3; c++) {
        const s = small[c];
        out[p * 3 + c] = (s[y0 * sw + x0] * (1 - tx) + s[y0 * sw + x1] * tx) * (1 - ty) + (s[y1 * sw + x0] * (1 - tx) + s[y1 * sw + x1] * tx) * ty;
      }
    }
  }
  return out;
}

/**
 * Beauty: smooths skin and softens blemishes and redness, but only where the colour looks like
 * skin, and only in flat areas (an edge-preserving guided filter keeps eyes, lips, hair and
 * outlines crisp). Some fine texture is kept so faces never look plastic. strength 0-1.
 */
export function beautifyPixels(d, w, h, strength = 0.5) {
  const N = w * h;
  // work on a copy no larger than ~900px on the long edge for the smooth layers (fast guided filter)
  const f = Math.max(1, Math.round(Math.max(w, h) / 900));
  const sw = Math.ceil(w / f), sh = Math.ceil(h / f), SN = sw * sh;
  const Y = new Uint8ClampedArray(N); // 1 byte/pixel: keeps 12 MP photos within phone memory
  const sY = new Float32Array(SN), sCr = new Float32Array(SN), sSkin = new Float32Array(SN), cnt = new Float32Array(SN);
  let skinTotal = 0;
  for (let y = 0, i = 0, p = 0; y < h; y++) {
    const row = ((y / f) | 0) * sw;
    for (let x = 0; x < w; x++, i += 4, p++) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const yy = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      Y[p] = yy;
      // soft skin likelihood in YCbCr (works across skin tones; brightness-independent)
      const s = ramp(cr, 132, 140) * ramp(cr, 176, 168) * ramp(cb, 76, 84) * ramp(cb, 130, 124) * ramp(yy, 30, 55) * ramp(yy, 250, 238);
      const q = row + ((x / f) | 0);
      sY[q] += yy; sCr[q] += cr; sSkin[q] += s; cnt[q]++;
      skinTotal += s;
    }
  }
  if (skinTotal < N * 0.004) return; // no faces or skin in the shot
  for (let q = 0; q < SN; q++) { const c = cnt[q] || 1; sY[q] /= c; sCr[q] /= c; sSkin[q] /= c; }
  const rad = Math.max(2, Math.round(Math.min(sw, sh) * 0.012));
  // feathered mask (and closes small gaps like freckles or a blemish inside skin)
  const mask = boxBlur(boxBlur(sSkin, sw, sh, rad), sw, sh, rad);
  for (let q = 0; q < SN; q++) mask[q] = Math.min(1, mask[q] * 1.35);
  // self-guided filter on luminance: flat skin → smoothed, real edges → kept
  const eps = 18 * 18;
  const mI = boxBlur(sY, sw, sh, rad);
  const II = new Float32Array(SN); for (let q = 0; q < SN; q++) II[q] = sY[q] * sY[q];
  const mII = boxBlur(II, sw, sh, rad);
  const A = new Float32Array(SN), B = new Float32Array(SN);
  for (let q = 0; q < SN; q++) { const v = mII[q] - mI[q] * mI[q]; A[q] = v / (v + eps); B[q] = mI[q] - A[q] * mI[q]; }
  const mA = boxBlur(A, sw, sh, rad), mB = boxBlur(B, sw, sh, rad);
  const crSmooth = boxBlur(sCr, sw, sh, rad);
  const crDelta = new Float32Array(SN), spot = new Float32Array(SN);
  for (let q = 0; q < SN; q++) {
    crDelta[q] = crSmooth[q] - sCr[q];
    // blemish: a small patch redder or darker than the skin around it
    spot[q] = Math.max(ramp(-crDelta[q], 1.5, 6), 0.6 * ramp(mI[q] - sY[q], 4, 14) * ramp(sY[q], 60, 90)) * Math.min(1, mask[q] * 1.5);
  }
  const spotB = boxBlur(spot, sw, sh, 1);
  const k = Math.min(1, strength) * 0.9;
  for (let y = 0, i = 0, p = 0; y < h; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = fy | 0, y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++, i += 4, p++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = fx | 0, x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = y0 * sw + x0, b2 = y0 * sw + x1, c2 = y1 * sw + x0, e = y1 * sw + x1;
      const w00 = (1 - tx) * (1 - ty), w01 = tx * (1 - ty), w10 = (1 - tx) * ty, w11 = tx * ty;
      const sp = Math.min(1, (spotB[a] * w00 + spotB[b2] * w01 + spotB[c2] * w10 + spotB[e] * w11) * 1.6) * Math.min(1, strength * 1.8);
      const m = Math.max((mask[a] * w00 + mask[b2] * w01 + mask[c2] * w10 + mask[e] * w11) * k, sp);
      if (m < 0.01) continue;
      const yv = Y[p];
      // 3×3 local mean (computed here instead of a full-size buffer): the finest texture is kept partly
      const up = y > 0 ? p - w : p, dn = y < h - 1 ? p + w : p, l = x > 0 ? -1 : 0, r = x < w - 1 ? 1 : 0;
      const fine = (Y[up + l] + Y[up] + Y[up + r] + Y[p + l] + yv + Y[p + r] + Y[dn + l] + Y[dn] + Y[dn + r]) / 9;
      const smooth = (mA[a] * w00 + mA[b2] * w01 + mA[c2] * w10 + mA[e] * w11) * yv + (mB[a] * w00 + mB[b2] * w01 + mB[c2] * w10 + mB[e] * w11);
      const target = smooth + (yv - fine) * 0.45 * (1 - sp) + 2.5; // keep pores, lift skin a touch
      const dy = (target - yv) * m;
      const dcr = (crDelta[a] * w00 + crDelta[b2] * w01 + crDelta[c2] * w10 + crDelta[e] * w11) * Math.min(1, m * 0.8 + sp * 0.4); // even out redness and spots
      // apply in YCbCr: luminance change + red-difference change
      d[i] = clamp255(d[i] + dy + 1.402 * dcr);
      d[i + 1] = clamp255(d[i + 1] + dy - 0.714136 * dcr);
      d[i + 2] = clamp255(d[i + 2] + dy);
    }
  }
}
function ramp(v, lo, hi) { // 0 at lo, 1 at hi (either direction)
  const t = (v - lo) / (hi - lo);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
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

/**
 * Wide colour: phones with P3 screens take P3 photos. Canvases in sRGB would squash those colours
 * (duller reds, greens and skin tones), so on such phones photos are drawn in Display P3 and the
 * saved JPEG carries the P3 colour profile.
 */
export const WIDE_COLOR = (() => {
  try {
    if (typeof matchMedia !== 'function' || !matchMedia('(color-gamut: p3)').matches) return false;
    const x = document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' });
    return !!(x && x.getContextAttributes && x.getContextAttributes().colorSpace === 'display-p3');
  } catch { return false; }
})();
export const ctx2d = (c, extra = {}) => c.getContext('2d', WIDE_COLOR ? { colorSpace: 'display-p3', ...extra } : extra);

/** Draw a source onto a canvas no larger than maxEdge on its long side (high-quality scaling). */
export function drawScaled(source, sw, sh, maxEdge) {
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * scale));
  c.height = Math.max(1, Math.round(sh * scale));
  const x = ctx2d(c);
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, 0, 0, c.width, c.height);
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

/**
 * JPEG at the best quality that fits the upload limit: starts at 0.92 and only steps down
 * (quality first, then size) for very detailed or very large photos.
 */
export async function encodeBest(canvas, maxBytes = 15.5 * 1024 * 1024) {
  for (const q of [0.95, 0.92, 0.88]) {
    const b = await canvasToBlob(canvas, 'image/jpeg', q);
    if (b.size <= maxBytes) return b;
  }
  const smaller = drawScaled(canvas, canvas.width, canvas.height, Math.round(Math.max(canvas.width, canvas.height) * 0.8));
  return canvasToBlob(smaller, 'image/jpeg', 0.86);
}

/** Album/TV preview: 2048 px, sharp on full-screen phones, tablets and TVs, small enough to load fast. */
export async function encodePreview(canvas) {
  const c = drawScaled(canvas, canvas.width, canvas.height, 2048);
  for (const q of [0.88, 0.82, 0.74]) {
    const b = await canvasToBlob(c, 'image/jpeg', q);
    if (b.size <= 660 * 1024) return b;
  }
  return canvasToBlob(drawScaled(c, c.width, c.height, 1600), 'image/jpeg', 0.78);
}

/** Re-encode a JPEG no larger than maxEdge and maxBytes (for servers with smaller limits). */
export async function shrinkJpeg(blob, maxEdge, maxBytes) {
  const bmp = await createImageBitmap(blob);
  try {
    let edge = maxEdge;
    for (let tries = 0; tries < 4; tries++) {
      const c = drawScaled(bmp, bmp.width, bmp.height, edge);
      for (const q of [0.9, 0.82, 0.74]) {
        const out = await canvasToBlob(c, 'image/jpeg', q);
        if (out.size <= maxBytes) return out;
      }
      edge = Math.round(edge * 0.75);
    }
    throw new Error('too big');
  } finally { bmp.close(); }
}
