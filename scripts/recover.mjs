// Recover an event's keepsakes and fingerprint straight from Koinos (no backend needed).
//   node recover.mjs --owner 1Abc... --event Ab12Cd34Ef [--out ./recovered] [--contract 1Xyz...]
import fs from 'node:fs';
import path from 'node:path';
import { Contract, abi, arg, provider, contractId, utils } from './lib.mjs';
import { keepsakeMimeOk } from '../site/assets/js/proof.js';

const owner = arg('owner');
const eventId = arg('event');
if (!owner || !eventId) { console.error('Usage: node recover.mjs --owner <address> --event <code> [--out dir]'); process.exit(2); }
const out = path.resolve(arg('out', `./recovered-${eventId}`));
const c = new Contract({ id: contractId(), abi, provider: provider() }).functions;

const ev = (await c.get_event({ owner, event_id: eventId })).result;
if (!ev || !ev.value || !ev.value.exists) { console.error('No such event on chain.'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'event.json'), JSON.stringify(ev.value, null, 2));
const total = Number(ev.value.keepsake_count || 0);
console.log(`Event found. ${total} keepsakes. Writing to ${out}`);
const ext = { 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/avif': 'avif' };
let saved = 0;
for (let i = 0; i < total; i++) {
  const k = (await c.get_keepsake({ owner, event_id: eventId, index: i })).result;
  const v = k && k.value;
  if (!v || !v.exists || v.removed || !v.data) continue;
  const bytes = utils.decodeBase64url(v.data);
  if (!ext[v.mime] || !keepsakeMimeOk(v.mime, bytes)) { console.warn(`#${i}: not a valid image, skipped`); continue; }
  const name = `${String(i + 1).padStart(5, '0')}${v.original_sha256 ? '-' + String(v.original_sha256).replace(/^0x/, '').slice(0, 12) : ''}.${ext[v.mime]}`;
  fs.writeFileSync(path.join(out, name), bytes);
  saved++;
  if (saved % 25 === 0) console.log(`  ${saved} saved…`);
}
console.log(`Done: ${saved} keepsakes saved.`);
