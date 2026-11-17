// Unattended archiver: copies every approved photo of an event to Koinos as a ~40 KB keepsake,
// then (optionally) anchors the album fingerprint. Resumable: already-archived photos are skipped.
//
//   HOST_LINK='https://you.github.io/PhotoShare/host.html?e=...#k=...' \
//   OWNER_WIF=...  [PAYER_WIF=...]  node archive-album.mjs [--anchor] [--batch 5] [--dry-run]
//
// OWNER_WIF must be the key of the address that registered the event (or will register it).
import fs from 'node:fs';
import sharp from 'sharp';
import { Signer, Contract, abi, config, env, arg, provider, contractId, sendOps, backend } from './lib.mjs';
import { buildManifest, fingerprint, chainMeta, keepsakeMimeOk, KEEPSAKE_TARGET, estimateMana } from '../site/assets/js/proof.js';

const hostLink = new URL(env('HOST_LINK', { secret: true }));
const eventId = hostLink.searchParams.get('e');
const hostKey = new URLSearchParams(hostLink.hash.slice(1)).get('k');
const studio = hostLink.searchParams.get('s') || Object.keys(config.backends)[0];
const backendUrl = process.env.BACKEND_URL || config.backends[studio];
if (!eventId || !hostKey || !backendUrl) { console.error('HOST_LINK must be a full host link (with #k=...) and config.js must list its backend.'); process.exit(2); }

const prov = provider();
const ownerSigner = Signer.fromWif(env('OWNER_WIF', { secret: true }));
ownerSigner.provider = prov;
const payerSigner = process.env.PAYER_WIF ? Signer.fromWif(process.env.PAYER_WIF) : null;
const owner = ownerSigner.getAddress();
const read = new Contract({ id: contractId(), abi, provider: prov }).functions;
const batchSize = Math.max(1, Math.min(8, Number(arg('batch', 5))));
const dry = !!arg('dry-run');

const api = (a, p = {}) => backend(backendUrl, a, { e: eventId, k: hostKey, ...p });
const getEvent = async () => { const r = (await read.get_event({ owner, event_id: eventId })).result; return r && r.value && r.value.exists ? r.value : null; };

const { event: ev } = await api('hostGet');
console.log(`Event: ${ev.name} (${eventId})  owner: ${owner}`);
let chainEv = await getEvent();
if (!chainEv) {
  console.log('Registering event on Koinos…');
  if (!dry) await sendOps(prov, ownerSigner, payerSigner, [{ fn: 'register_event', args: { owner, event_id: eventId, meta: chainMeta(ev) } }]);
  chainEv = dry ? { keepsake_count: 0 } : await getEvent();
}

const { items } = await api('hostManifest');
const todo = items.filter((x) => x.archIndex == null && x.status === 'visible');
const limits = (await prov.call('chain.get_resource_limits', {})).resource_limit_data;
const est = estimateMana(limits, { diskBytes: 40000, netBytes: 40500, compute: 3_000_000 });
const mana = Number(await prov.getAccountRc((payerSigner || ownerSigner).getAddress())) / 1e8;
console.log(`${todo.length} photos to archive (≈${Math.ceil(est * todo.length)} mana). Payer has ${Math.floor(mana)} mana.`);

async function keepsake(item) {
  const m = await api('hostMedia', { id: item.id, which: 'thumb' });
  const input = Buffer.from(m.data, 'base64');
  for (const edge of [1024, 900, 800, 700, 600, 480]) {
    for (const quality of [72, 62, 52]) {
      const out = await sharp(input).rotate().resize(edge, edge, { fit: 'inside', withoutEnlargement: true }).webp({ quality }).toBuffer();
      if (out.length <= KEEPSAKE_TARGET && keepsakeMimeOk('image/webp', out)) return out;
    }
  }
  throw new Error('could not compress under the size limit');
}

let done = 0;
for (let i = 0; i < todo.length; i += batchSize) {
  const batch = todo.slice(i, i + batchSize);
  const prepared = [];
  for (const item of batch) {
    try { prepared.push({ item, bytes: await keepsake(item) }); } catch (e) { console.warn(`skip ${item.id}: ${e.message}`); }
  }
  if (!prepared.length) continue;
  if (dry) { done += prepared.length; console.log(`[dry-run] would archive ${prepared.length} (${prepared.map((p) => p.bytes.length).join(', ')} bytes)`); continue; }
  chainEv = await getEvent();
  const start = Number(chainEv.keepsake_count || 0);
  const r = await sendOps(prov, ownerSigner, payerSigner, prepared.map(({ item, bytes }) => ({
    fn: 'add_keepsake',
    args: { owner, event_id: eventId, mime: 'image/webp', data: bytes.toString('base64url'), caption: '', original_sha256: '0x' + item.sha256 },
  })));
  const after = await getEvent();
  if (Number(after.keepsake_count) !== start + prepared.length) throw new Error('Keepsake count mismatch — stop and inspect before re-running.');
  await api('hostMarkArchived', { items: prepared.map(({ item }, j) => ({ id: item.id, index: start + j, tx: r.id })) });
  done += prepared.length;
  console.log(`${done}/${todo.length} archived (tx ${r.id})`);
}

if (arg('anchor')) {
  const fresh = (await api('hostManifest')).items;
  const manifest = buildManifest({ eventId, name: ev.name, items: fresh });
  const fp = await fingerprint(manifest);
  const file = `${eventId}-manifest.json`;
  fs.writeFileSync(file, fp.text);
  console.log(`Fingerprint root ${fp.root} over ${manifest.count} originals. Manifest written to ${file}`);
  if (!dry) {
    const r = await sendOps(prov, ownerSigner, payerSigner, [{ fn: 'anchor_album', args: { owner, event_id: eventId, album_root: '0x' + fp.root, manifest_hash: '0x' + fp.manifestHash, photo_count: String(manifest.count) } }]);
    await api('hostSaveManifest', { manifest: fp.text });
    console.log(`Anchored in tx ${r.id}; manifest also saved to the event's Drive folder.`);
  }
}
console.log('Done.');
