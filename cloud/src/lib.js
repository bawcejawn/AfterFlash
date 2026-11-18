// Small helpers shared by the PhotoShare Cloud worker. Web-platform APIs only (runs on
// Cloudflare Workers and, for tests, on Node).

export class ApiErr extends Error {
  constructor(code, message, status = 200) { super(message); this.code = code; this.status = status; }
}
export const err = (code, message) => new ApiErr(code, message);

const te = new TextEncoder();

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(s) {
  if (typeof s !== 'string' || !s.length) throw err('bad_request', 'Missing file data');
  s = s.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) throw err('bad_request', 'Invalid file data');
  try {
    const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { throw err('bad_request', 'Invalid file data'); }
}
const b64url = (bytes) => b64encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function randomBytes(n) { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; }
export const randomKey = (n = 32) => b64url(randomBytes(n));
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function randomId(len) {
  let s = '';
  while (s.length < len) for (const b of randomBytes(len * 2)) { if (b < 228 && s.length < len) s += ALPHA[b % ALPHA.length]; }
  return s;
}

export async function sha256Hex(input) {
  const data = typeof input === 'string' ? te.encode(input) : input;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}
export function safeEq(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---- secrets at rest (Google refresh tokens, private-event keys): AES-256-GCM with DATA_KEY
async function dataKey(env) {
  const raw = String(env.DATA_KEY || '');
  if (raw.length < 32) throw err('not_configured', 'The server is missing its DATA_KEY secret.');
  const k = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(raw)));
  return crypto.subtle.importKey('raw', k, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, text) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await dataKey(env), te.encode(text)));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12);
  return b64encode(out);
}
export async function unseal(env, sealed) {
  if (!sealed) return '';
  const d = b64decode(sealed);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.subarray(0, 12) }, await dataKey(env), d.subarray(12));
  return new TextDecoder().decode(pt);
}

// ---- content checks (never trust the declared type)
export function sniffMime(b) {
  if (b.length < 12) return '';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(isom|iso2|iso5|iso6|mp41|mp42|avc1|M4V |qt  |3gp4|3gp5|dash)$/.test(brand)) return 'video/mp4';
  }
  return '';
}
export function sniffAudio(b) {
  if (b.length < 12) return '';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return 'audio/mp4';
  if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg';
  return '';
}
export function sniffImage(b) {
  if (b.length < 12) return '';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}
export const ENC_OVERHEAD = 32;
export const isEnc = (b) => b.length > ENC_OVERHEAD && b[0] === 0x50 && b[1] === 0x53 && b[2] === 0x45 && b[3] === 0x31;

/** Remove APP1..APP15 and COM segments (EXIF, GPS, XMP, comments). Returns the input on parse errors. */
export function stripJpegMeta(bytes) {
  const parts = [bytes.subarray(0, 2)];
  let i = 2; const n = bytes.length;
  while (i + 4 <= n) {
    if (bytes[i] !== 0xff) return bytes;
    const marker = bytes[i + 1];
    if (marker === 0xd9) break;
    if (marker === 0xda) {
      parts.push(bytes.subarray(i));
      const total = parts.reduce((a, p) => a + p.length, 0);
      const out = new Uint8Array(total);
      let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
      return out;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { parts.push(bytes.subarray(i, i + 2)); i += 2; continue; }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    if (len < 2 || i + 2 + len > n) return bytes;
    const drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) parts.push(bytes.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return bytes;
}

export function cleanText(v, max) {
  if (v == null) return '';
  return String(v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().replace(/^[=+\-@\s]+/, '').slice(0, max);
}
export const str = (v, max) => (v == null ? '' : String(v).slice(0, max));
export function int(v, min, max, dflt) {
  const n = parseInt(v, 10);
  return isNaN(n) ? dflt : Math.min(max, Math.max(min, n));
}
export function parseJson(s) { try { return JSON.parse(s) || {}; } catch { return {}; } }
