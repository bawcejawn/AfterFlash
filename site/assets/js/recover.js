// Public recovery + verification. Reads only from the Koinos blockchain — works even if
// the Google Drive folder or this site's backend no longer exists.
import { $, h, clear, toast, params, frameGuard, isEventId, base64ToBytes, fmtDate, fmtWhen, setTitle } from './util.js';
import { chainEnabled, isAddress, getEvent, getKeepsake } from './koinos.js';
import { bytesToHex, sha256, merkleRoot, keepsakeMimeOk } from './proof.js';
import { makeZip } from './zip.js';

frameGuard();
const root = $('#app');
const { q } = params();
let owner = q.get('o') || '';
let eventId = q.get('e') || '';
let rec = null, shown = 0, urls = [], manifest = null;
const PAGE = 24;

function form(msg) {
  const o = h('input', { type: 'text', value: owner, placeholder: 'Koinos address that owns the event', required: true, spellcheck: 'false' });
  const e = h('input', { type: 'text', value: eventId, placeholder: 'Event code', required: true, spellcheck: 'false' });
  const f = h('form', { class: 'panel stack' },
    h('h1', null, 'Recover and verify'),
    h('p', null, 'Load an album’s keepsakes and fingerprint straight from the Koinos blockchain.'),
    h('div', { class: 'grid-form' }, h('label', { class: 'field' }, h('span', null, 'Owner address'), o), h('label', { class: 'field' }, h('span', null, 'Event code'), e)),
    msg ? h('p', { class: 'callout warn', role: 'alert' }, msg) : null,
    h('button', { class: 'btn primary', type: 'submit' }, 'Load from Koinos'));
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    owner = o.value.trim(); eventId = e.value.trim();
    const u = new URL(location.href); u.searchParams.set('o', owner); u.searchParams.set('e', eventId); history.replaceState(null, '', u);
    load();
  });
  return f;
}

async function load() {
  if (!chainEnabled()) { clear(root).append(form('Koinos is not configured on this site.')); return; }
  if (!isAddress(owner) || !isEventId(eventId)) { clear(root).append(form(owner || eventId ? 'Check the address and event code.' : '')); return; }
  clear(root).append(h('p', { class: 'muted' }, 'Reading from Koinos…'));
  try { rec = await getEvent(owner, eventId); } catch (e) { clear(root).append(form('Couldn’t reach Koinos: ' + e.message)); return; }
  if (!rec) { clear(root).append(form('No event with that code is registered by that address.')); return; }
  let meta = {};
  try { meta = JSON.parse(rec.meta || '{}') || {}; } catch { meta = {}; }
  const name = typeof meta.name === 'string' ? meta.name.slice(0, 120) : eventId;
  setTitle(name + ' recovery');
  urls.forEach((u) => URL.revokeObjectURL(u)); urls = []; shown = 0;
  const grid = h('div', { class: 'masonry', id: 'grid' });
  clear(root).append(
    h('h1', null, name),
    h('p', { class: 'muted' }, [typeof meta.date === 'string' ? fmtDate(meta.date) : '', `registered ${fmtWhen(Number(rec.created_at))}`].filter(Boolean).join(', ')),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, String(rec.keepsake_count || 0)), 'keepsakes on chain'),
      h('div', { class: 'stat' }, h('b', null, String(rec.photo_count || 0)), 'originals fingerprinted'),
      h('div', { class: 'stat' }, h('b', null, String(rec.anchor_version || 0)), 'fingerprint version')),
    rec.album_root ? h('p', { class: 'small muted' }, 'Fingerprint (Merkle root): ', h('span', { class: 'keybox' }, rec.album_root)) : null,
    verifyPanel(),
    h('h2', { class: 'section' }, 'Keepsakes'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: downloadAll }, 'Download all keepsakes (zip)')),
    grid,
    h('div', { class: 'row section' }, h('button', { class: 'btn', id: 'more', onclick: more }, 'Load more')));
  more();
}

async function fetchKeepsake(i) {
  const k = await getKeepsake(owner, eventId, i);
  if (!k || k.removed || !k.data) return null;
  const bytes = base64ToBytes(k.data);
  if (!keepsakeMimeOk(k.mime, bytes)) return null; // never render anything that isn't a real image
  return { i, bytes, mime: k.mime, caption: typeof k.caption === 'string' ? k.caption : '', original: k.original_sha256 ? String(k.original_sha256).replace(/^0x/, '') : '' };
}

async function more() {
  const total = Number(rec.keepsake_count || 0);
  const grid = $('#grid');
  const btn = $('#more');
  btn.disabled = true;
  const end = Math.min(total, shown + PAGE);
  for (let i = shown; i < end; i++) {
    try {
      const k = await fetchKeepsake(i);
      if (!k) continue;
      const url = URL.createObjectURL(new Blob([k.bytes], { type: k.mime }));
      urls.push(url);
      grid.append(h('figure', { class: 'tile' }, h('img', { src: url, alt: k.caption || `Keepsake ${i + 1}` }), k.caption ? h('figcaption', { class: 'small' }, k.caption) : null));
    } catch (e) { toast(`Keepsake ${i + 1}: ${e.message}`, 'error'); }
  }
  shown = end;
  btn.disabled = false;
  btn.hidden = shown >= total;
  if (!total) grid.append(h('p', { class: 'empty' }, 'No keepsakes archived yet.'));
}

async function downloadAll() {
  const total = Number(rec.keepsake_count || 0);
  const files = [];
  toast(`Downloading ${total} keepsakes from Koinos…`);
  for (let i = 0; i < total; i++) {
    try {
      const k = await fetchKeepsake(i);
      if (k) files.push({ name: `${eventId}-${String(i + 1).padStart(5, '0')}.${k.mime.split('/')[1]}`, bytes: k.bytes });
    } catch { /* skip */ }
  }
  const a = h('a', { href: URL.createObjectURL(makeZip(files)), download: `${eventId}-keepsakes.zip` });
  a.click();
}

function verifyPanel() {
  const out = h('div', { class: 'stack', 'aria-live': 'polite' });
  const manIn = h('input', { type: 'file', accept: 'application/json,.json', onchange: (e) => loadManifest(e.target.files[0], out) });
  const photoIn = h('input', { type: 'file', multiple: true, onchange: (e) => checkPhotos(e.target.files, out) });
  return h('section', { class: 'panel stack' },
    h('h2', null, 'Check that a photo is an original'),
    h('p', null, 'Step 1: choose the album’s manifest file (saved in the Drive folder when the fingerprint was anchored). Step 2: choose any photos or videos to check.'),
    h('label', { class: 'field' }, h('span', null, 'Manifest'), manIn),
    h('label', { class: 'field' }, h('span', null, 'Photos to check'), photoIn),
    out);
}

async function loadManifest(file, out) {
  manifest = null;
  if (!file) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('File too large to be a manifest');
    const hash = bytesToHex(await sha256(bytes));
    const onChain = String(rec.manifest_hash || '').replace(/^0x/, '');
    const m = JSON.parse(new TextDecoder().decode(bytes));
    if (!m || m.app !== 'photoshare' || !Array.isArray(m.items)) throw new Error('Not a PhotoShare manifest');
    const hashes = m.items.map((x) => String(x.h)).filter((x) => /^[0-9a-f]{64}$/.test(x));
    const root = bytesToHex(await merkleRoot(hashes));
    const rootOk = root === String(rec.album_root || '').replace(/^0x/, '');
    if (hash !== onChain || !rootOk) {
      out.append(h('p', { class: 'callout warn' }, hash !== onChain ? 'This manifest does not match the latest fingerprint on Koinos. It may be from an older version or edited.' : 'The manifest’s Merkle root doesn’t match the chain.'));
      return;
    }
    manifest = new Set(hashes);
    out.append(h('p', { class: 'callout' }, `Manifest verified against Koinos: ${hashes.length} originals.`));
  } catch (e) {
    out.append(h('p', { class: 'callout warn' }, 'Couldn’t read that manifest: ' + e.message));
  }
}

async function checkPhotos(files, out) {
  if (!manifest) { out.append(h('p', { class: 'callout warn' }, 'Choose and verify the manifest first.')); return; }
  for (const file of Array.from(files || [])) {
    const hash = bytesToHex(await sha256(new Uint8Array(await file.arrayBuffer())));
    const ok = manifest.has(hash);
    out.append(h('p', null, ok ? '✓ ' : '✗ ', h('b', null, file.name), ok ? ': original, unchanged, part of this album.' : ': not an original from this album (or it was edited or re-saved).'));
  }
}

if (owner && eventId) load(); else clear(root).append(form());
