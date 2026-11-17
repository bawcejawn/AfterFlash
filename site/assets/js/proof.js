// Album fingerprint: canonical manifest + Merkle root. Pure functions shared by the
// browser (archive/recover pages) and the Node scripts. Uses WebCrypto (Node 20+ and browsers).

const enc = new TextEncoder();

export function hexToBytes(hex) {
  const s = hex.replace(/^0x/, '');
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw new Error('bad hex');
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
export const bytesToHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

/**
 * Canonical manifest: fixed key order, items in upload order.
 * Only fields that describe the originals are included, so it never changes
 * when a host edits settings.
 */
export function buildManifest({ eventId, name, items }) {
  const list = items
    .filter((it) => /^[0-9a-f]{64}$/.test(it.sha256))
    .map((it) => ({ h: it.sha256, k: it.kind === 'video' ? 'v' : 'p', c: Number(it.createdAt) || 0 }));
  return { v: 1, app: 'photoshare', event: eventId, name: name || '', count: list.length, items: list };
}

export function manifestText(manifest) {
  return JSON.stringify(manifest);
}

/**
 * Merkle root with domain separation (leaf = H(0x00||h), node = H(0x01||l||r)),
 * odd nodes are promoted unchanged. Empty set → 32 zero bytes.
 */
export async function merkleRoot(hexHashes) {
  if (!hexHashes.length) return new Uint8Array(32);
  let level = await Promise.all(hexHashes.map((h) => sha256(concat([new Uint8Array([0]), hexToBytes(h)]))));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 === level.length) next.push(level[i]);
      else next.push(await sha256(concat([new Uint8Array([1]), level[i], level[i + 1]])));
    }
    level = next;
  }
  return level[0];
}

export async function fingerprint(manifest) {
  const text = manifestText(manifest);
  const manifestHash = await sha256(enc.encode(text));
  const root = await merkleRoot(manifest.items.map((x) => x.h));
  return { text, manifestHash: bytesToHex(manifestHash), root: bytesToHex(root) };
}

function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Event metadata stored on chain (≤ 512 bytes). */
export function chainMeta({ name, date }) {
  let n = String(name || '').slice(0, 80);
  let meta = JSON.stringify({ name: n, date: date || '', app: 'photoshare' });
  while (enc.encode(meta).length > 512 && n.length) { n = n.slice(0, -4); meta = JSON.stringify({ name: n, date: date || '', app: 'photoshare' }); }
  return meta;
}

export const KEEPSAKE_MAX = 49152;
export const KEEPSAKE_TARGET = 45000;

/** Bytes look like an allowed keepsake image (mirrors the contract's check). */
export function keepsakeMimeOk(mime, d) {
  if (!d || d.length < 12) return false;
  if (mime === 'image/jpeg') return d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;
  if (mime === 'image/webp') return d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50;
  if (mime === 'image/avif') return d[4] === 0x66 && d[5] === 0x74 && d[6] === 0x79 && d[7] === 0x70 && d[8] === 0x61 && d[9] === 0x76 && d[10] === 0x69 && d[11] === 0x66;
  return false;
}

/** Mana estimate from live resource prices (prices are per byte, in 1e-8 mana units). */
export function estimateMana(limits, { diskBytes = 0, netBytes = 0, compute = 2_000_000 }) {
  const rc = Number(limits.disk_storage_cost) * diskBytes + Number(limits.network_bandwidth_cost) * netBytes + Number(limits.compute_bandwidth_cost) * compute;
  return rc / 1e8;
}
