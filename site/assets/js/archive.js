// Host tool: register the event on Koinos, archive screen-quality keepsakes, anchor the fingerprint.
import { $, h, clear, toast, params, studioFrom, isEventId, store, setTitle, fmtDate, link, frameGuard, base64ToBytes } from './util.js';
import { api } from './api.js';
import { buildManifest, fingerprint, chainMeta, keepsakeMimeOk, estimateMana, KEEPSAKE_TARGET, KEEPSAKE_MAX } from './proof.js';
import { chainEnabled, kondorAccounts, kondorSigner, getEvent, manaOf, resourceLimits, sendBatch, explorerTx } from './koinos.js';

frameGuard();
const root = $('#app');
const { q, f } = params();
let studio, eventId, key, ev, manifestItems = [], owner = '', chainEv = null, limits = null, stop = false;
const keyName = () => `ps:hk:${studio}:${eventId}`;

function fail(msg) { clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, 'Can’t open the archive tool'), h('p', null, msg))); }

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('Unknown studio in link.'); }
  eventId = q.get('e');
  if (!isEventId(eventId)) return fail('Missing event code.');
  key = f.get('k') || store.get(keyName(), sessionStorage) || store.get(keyName());
  const adminKey = store.get(`ps:ak:${studio}`, sessionStorage);
  if (q.get('admin') === '1' && adminKey) key = 'admin:' + adminKey;
  if (f.get('k') && !key.startsWith('admin:')) { store.set(keyName(), key, sessionStorage); history.replaceState(null, '', location.pathname + location.search); }
  if (!key) return fail('Open this page from the Keepsakes tab of the host dashboard.');
  if (!chainEnabled()) return fail('Koinos is not configured. Add the contract address to config.js (see docs/KOINOS.md).');
  try {
    ev = (await api(studio, 'hostGet', { e: eventId, k: key })).event;
    await loadManifest();
    limits = await resourceLimits().catch(() => null);
  } catch (e) { return fail(e.message); }
  setTitle(ev.name + ' archive');
  render();
}

async function loadManifest() {
  const m = await api(studio, 'hostManifest', { e: eventId, k: key });
  manifestItems = m.items;
}

const perKeepsake = () => (limits ? estimateMana(limits, { diskBytes: 40000, netBytes: 40500, compute: 3_000_000 }) : 25);

function render(note) {
  const toArchive = manifestItems.filter((x) => x.archIndex == null && x.status === 'visible');
  const archived = manifestItems.filter((x) => x.archIndex != null).length;
  const back = link('host.html', { e: eventId, s: studio });
  clear(root).append(
    h('p', null, h('a', { href: back }, 'Back to the dashboard')),
    h('h1', null, `Keep “${ev.name}” on Koinos`),
    h('p', { class: 'muted' }, fmtDate(ev.date)),
    note ? h('p', { class: 'callout' }, note) : null,

    h('section', { class: 'panel stack' },
      h('h2', null, 'Connect your wallet'),
      h('p', null, 'The event is recorded under this Koinos address, which also pays the mana. Use the address that holds your KOIN.'),
      owner ? h('p', null, h('b', null, owner)) : h('button', { class: 'btn primary', onclick: connect }, 'Connect Kondor'),
      h('p', { class: 'small muted', id: 'mana' })),

    h('section', { class: 'panel stack' },
      h('h2', null, 'Register the event'),
      chainEv ? h('p', null, `Registered. ${chainEv.keepsake_count || 0} keepsakes and fingerprint version ${chainEv.anchor_version || 0} on chain.`)
        : h('p', null, 'Creates the event’s permanent record. Needed once, before anything else.'),
      !chainEv ? h('button', { class: 'btn primary', disabled: !owner, onclick: register }, 'Register on Koinos') : null),

    h('section', { class: 'panel stack' },
      h('h2', null, 'Archive the photos'),
      h('p', null, `${archived} archived, ${toArchive.length} still to go. Each keepsake is a screen-quality copy (about 40 KB). Estimated cost: about ${Math.ceil(perKeepsake())} mana per photo, about ${Math.ceil(perKeepsake() * toArchive.length).toLocaleString()} mana for the rest.`),
      h('p', { class: 'small muted' }, 'Hidden, reported and unapproved photos are skipped. Kondor asks you to approve each batch of up to 5 photos.'),
      h('div', { class: 'progress' }, h('i', { id: 'bar' })),
      h('p', { class: 'small', id: 'status', 'aria-live': 'polite' }),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary', disabled: !owner || !chainEv || !toArchive.length, onclick: () => archiveAll(toArchive) }, 'Start archiving'),
        h('button', { class: 'btn', onclick: () => { stop = true; } }, 'Stop after this batch'))),

    h('section', { class: 'panel stack' },
      h('h2', null, 'Anchor the fingerprint'),
      h('p', null, `Records one fingerprint covering all ${manifestItems.length} originals. Anyone can then prove a photo came from this album, unedited. Re-anchor after more photos arrive; earlier versions remain in history.`),
      h('button', { class: 'btn primary', disabled: !owner || !chainEv, onclick: anchor }, 'Anchor fingerprint')),

    owner && chainEv ? h('p', null, h('a', { href: link('recover.html', { extra: { o: owner, e: eventId } }) }, 'Open the public recovery page'), ' for this event. Save that link with your records.') : null);
}

function status(t) { const s = $('#status'); if (s) s.textContent = t; }

async function connect() {
  try {
    const accounts = await kondorAccounts();
    owner = accounts.length > 1 ? (prompt(`Which address?\n${accounts.join('\n')}`, accounts[0]) || '').trim() : accounts[0];
    if (!accounts.includes(owner)) throw new Error('Pick one of the addresses shared from Kondor.');
    chainEv = await getEvent(owner, eventId);
    render();
    const mana = await manaOf(owner).catch(() => null);
    if (mana != null) $('#mana').textContent = `Available mana: ${Math.floor(mana).toLocaleString()}`;
  } catch (e) { toast(e.message, 'error'); }
}

async function register() {
  try {
    toast('Approve the transaction in Kondor');
    const r = await sendBatch(kondorSigner(owner), [{ fn: 'register_event', args: { owner, event_id: eventId, meta: chainMeta({ name: ev.name, date: ev.date }) } }]);
    chainEv = await getEvent(owner, eventId);
    render(`Registered in transaction ${r.id}.`);
  } catch (e) { toast(chainError(e), 'error'); }
}

function chainError(e) {
  const m = String((e && e.message) || e);
  if (/mana|rc limit|insufficient/i.test(m)) return 'Not enough mana right now. It refills over time; try a smaller batch later.';
  if (/reject|denied|cancel/i.test(m)) return 'Cancelled in Kondor.';
  return m.slice(0, 300);
}

/** Make a ≤45 KB keepsake from the stored preview image. */
async function makeKeepsake(item) {
  const m = await api(studio, 'hostMedia', { e: eventId, k: key, id: item.id, which: 'thumb' }, { retries: 2, timeout: 60000 });
  const blob = new Blob([base64ToBytes(m.data)], { type: m.mime });
  const bmp = await createImageBitmap(blob);
  for (const edge of [1024, 900, 800, 700, 600, 480, 360]) {
    const scale = Math.min(1, edge / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    for (const [type, qs] of [['image/webp', [0.72, 0.6, 0.5]], ['image/jpeg', [0.7, 0.6, 0.5]]]) {
      for (const qq of qs) {
        const out = await new Promise((r) => c.toBlob(r, type, qq));
        if (!out || out.type !== type) break; // browser can't encode this type
        if (out.size <= KEEPSAKE_TARGET) {
          const bytes = new Uint8Array(await out.arrayBuffer());
          if (keepsakeMimeOk(type, bytes) && bytes.length <= KEEPSAKE_MAX) { bmp.close && bmp.close(); return { mime: type, bytes }; }
        }
      }
    }
  }
  throw new Error('Could not make a small enough keepsake');
}

const b64url = (bytes) => { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

async function archiveAll(list) {
  stop = false;
  const total = list.length;
  let done = 0;
  const bar = $('#bar');
  const signer = kondorSigner(owner);
  while (list.length && !stop) {
    const batch = [];
    let bytes = 0;
    status('Preparing keepsakes…');
    while (list.length && batch.length < 5 && bytes < 180000) {
      const item = list.shift();
      try {
        const k = await makeKeepsake(item);
        batch.push({ item, k });
        bytes += k.bytes.length;
      } catch (e) {
        toast(`Skipped one photo: ${e.message}`, 'error');
      }
    }
    if (!batch.length) continue;
    try {
      chainEv = await getEvent(owner, eventId);
      const start = Number(chainEv.keepsake_count || 0);
      status(`Approve ${batch.length} keepsake${batch.length > 1 ? 's' : ''} in Kondor…`);
      const r = await sendBatch(signer, batch.map(({ item, k }) => ({
        fn: 'add_keepsake',
        args: { owner, event_id: eventId, mime: k.mime, data: b64url(k.bytes), caption: '', original_sha256: '0x' + item.sha256 },
      })));
      const after = await getEvent(owner, eventId);
      if (Number(after.keepsake_count) !== start + batch.length) throw new Error('Keepsake count on chain did not match. Reload and check before continuing.');
      await api(studio, 'hostMarkArchived', { e: eventId, k: key, items: batch.map(({ item }, i) => ({ id: item.id, index: start + i, tx: r.id })) });
      batch.forEach(({ item }, i) => { item.archIndex = start + i; });
      done += batch.length;
      bar.style.width = `${Math.round((done / total) * 100)}%`;
      status(`${done} of ${total} archived. Last transaction: ${r.id}`);
    } catch (e) {
      status('Paused: ' + chainError(e));
      list.unshift(...batch.map((b) => b.item));
      return;
    }
  }
  await loadManifest().catch(() => {});
  render(stop ? `Stopped. ${done} archived this session.` : `Done. ${done} keepsakes archived.`);
}

async function anchor() {
  try {
    await loadManifest();
    const manifest = buildManifest({ eventId, name: ev.name, items: manifestItems });
    const fp = await fingerprint(manifest);
    toast('Approve the transaction in Kondor');
    const r = await sendBatch(kondorSigner(owner), [{
      fn: 'anchor_album',
      args: { owner, event_id: eventId, album_root: '0x' + fp.root, manifest_hash: '0x' + fp.manifestHash, photo_count: String(manifest.count) },
    }]);
    await api(studio, 'hostSaveManifest', { e: eventId, k: key, manifest: fp.text });
    const blob = new Blob([fp.text], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `${eventId}-manifest.json` });
    a.click();
    chainEv = await getEvent(owner, eventId);
    render(`Fingerprint anchored (version ${chainEv.anchor_version}). The manifest was saved to your Drive folder and downloaded. Keep it: it’s what proves each original. Transaction: ${r.id}`);
    const t = $('.callout');
    if (t) t.append(' ', h('a', { href: explorerTx(r.id), target: '_blank', rel: 'noopener' }, 'View on explorer'));
  } catch (e) { toast(chainError(e), 'error'); }
}

boot();
