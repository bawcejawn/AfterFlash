// Private storage: files are encrypted on the guest's phone (AES-256-GCM) before upload, so
// Google Drive or any other storage only ever holds unreadable bytes. Format:
//   "PSE1" (4 bytes) | IV (12 bytes) | ciphertext + GCM tag (16 bytes)
// The per-event key is handed out by the backend only to people who may see the album.
import { base64ToBytes } from './util.js';

const MAGIC = [0x50, 0x53, 0x45, 0x31];
const keys = new Map();

function keyBytes(k) {
  const b = base64ToBytes(String(k));
  if (b.length !== 32) throw new Error('Bad event key');
  return b;
}

async function cryptoKey(k) {
  if (!keys.has(k)) keys.set(k, crypto.subtle.importKey('raw', keyBytes(k), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return keys.get(k);
}

export function isEnc(bytes) {
  return bytes && bytes.length > 32 && MAGIC.every((m, i) => bytes[i] === m);
}

export async function encryptBytes(k, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(k), plain));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16);
  return out;
}

export async function decryptBytes(k, data) {
  if (!isEnc(data)) throw new Error('Not an encrypted file');
  const iv = data.subarray(4, 16);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await cryptoKey(k), data.subarray(16)));
}

export async function encryptBlob(k, blob) {
  return new Blob([await encryptBytes(k, new Uint8Array(await blob.arrayBuffer()))], { type: 'application/octet-stream' });
}

/** Checks decrypted bytes really are the type we're about to show (never trust the label). */
function looksLike(mime, d) {
  if (d.length < 12) return false;
  if (mime === 'image/jpeg') return d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;
  if (mime === 'video/webm' || mime === 'audio/webm') return d[0] === 0x1a && d[1] === 0x45 && d[2] === 0xdf && d[3] === 0xa3;
  if (mime === 'video/mp4' || mime === 'audio/mp4') return d[4] === 0x66 && d[5] === 0x74 && d[6] === 0x79 && d[7] === 0x70;
  if (mime === 'audio/ogg') return d[0] === 0x4f && d[1] === 0x67 && d[2] === 0x67 && d[3] === 0x53;
  return false;
}

/**
 * Turn an API media answer {mime, data(base64), enc?} into a Blob, decrypting when needed.
 * Throws if the content isn't what it claims to be.
 */
export async function mediaBlob(answer, key) {
  let bytes = base64ToBytes(answer.data);
  const mime = String(answer.mime || '').split(';')[0];
  if (answer.enc || isEnc(bytes)) {
    if (!key) throw new Error('This private album needs its key. Reload the page.');
    bytes = await decryptBytes(key, bytes);
  }
  if (!looksLike(mime, bytes)) throw new Error('Unexpected file content');
  return new Blob([bytes], { type: mime });
}

export async function sha256HexOf(blob) {
  const d = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}
