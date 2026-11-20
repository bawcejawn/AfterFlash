// Host dashboard: share, moderate, guests, settings.
import {
  $, h, clear, toast, params, studioFrom, isEventId, isDriveId, store, setAccent, setTitle, fmtDate, fmtWhen, fmtBytes,
  link, qrSvg, copy, isoToLocalInput, localInputToIso, frameGuard, config, base64ToBytes, loadDriveImage, serial, pool, whenVisible,
} from './util.js';
import { api } from './api.js';
import { LOOKS } from './film.js';
import { voicePlayer } from './guestbook.js';
import { mediaBlob } from './crypto.js';
import { applyBrand, logoEl, logoBlob, logoImage, prepareLogo, FONTS } from './brand.js';
import { tableCardsPanel } from './table-cards.js';
import { ownStudio, blobToBase64, inStoreApp } from './util.js';
import { installButton, rememberPlace } from './install.js';
import { invitationsTab } from './host-invite.js';
import { shopStrip } from './host-shop.js';

frameGuard();
const root = $('#app');
const { q, f } = params();
let studio, eventId, key, eventKey = '', ev, items = [], version = '', filter = 'all', selected = new Set(), tab = 'share', pollT;

const keyName = () => `ps:hk:${studio}:${eventId}`;

function fail(msg) {
  clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, 'Can’t open this dashboard'), h('p', null, msg)));
}

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('Unknown studio in link.'); }
  eventId = q.get('e');
  if (!isEventId(eventId)) return fail('This host link is missing its event code.');
  key = f.get('k') || store.get(keyName(), sessionStorage) || store.get(keyName());
  // Opened from the studio admin page: use the signed-in admin key (never put in the URL).
  const adminKey = store.get(`ps:ak:${studio}`, sessionStorage);
  if (q.get('admin') === '1' && adminKey) key = 'admin:' + adminKey;
  if (f.get('k') && !key.startsWith('admin:')) {
    store.set(keyName(), key, sessionStorage);
    history.replaceState(null, '', location.pathname + location.search); // keep the key out of the address bar
  }
  if (!key) return fail('This link is missing its host key. Use the full host link you were given.');
  try {
    { const hg = await api(studio, 'hostGet', { e: eventId, k: key }); ev = hg.event; eventKey = hg.key || ''; }
  } catch (e) {
    if (e.code === 'unauthorized' && !key.startsWith('admin:')) { store.del(keyName(), sessionStorage); store.del(keyName()); }
    if (e.code === 'forbidden') return fail('Only the studio owner or the admin who created this event can open its dashboard.');
    return fail(e.code === 'unauthorized' ? (key.startsWith('admin:') ? 'Please sign in again on the studio admin page.' : 'This host link is no longer valid. Ask the studio for a new one.') : e.message);
  }
  applyBrand(ev);
  setTitle(ev.name + ' host');
  if (!key.startsWith('admin:')) rememberPlace('host', studio, eventId, ev.name);
  await loadItems();
  render();
  pollT = setInterval(() => { if (!document.hidden) loadItems(true); }, 15000);
}

/** hostList and hostUpdate don't repeat who you are (host or co-host); keep it from hostGet. */
function keepAccess(next) {
  return ev ? { ...next, role: next.role || ev.role, cohost: next.cohost != null ? next.cohost : ev.cohost, store: next.store != null ? next.store : ev.store, storage: next.storage !== undefined ? next.storage : ev.storage } : next;
}

async function loadItems(quiet) {
  try {
    const r = await api(studio, 'hostList', { e: eventId, k: key }, { retries: quiet ? 0 : 2 });
    ev = keepAccess(r.event);
    const changed = r.v !== version;
    version = r.v;
    items = r.items.filter((x) => isDriveId(x.i)).sort((a, b) => b.c - a.c);
    if (quiet && changed && (tab === 'photos' || tab === 'share')) renderTab();
    if (quiet) renderHeader();
  } catch (e) {
    if (!quiet) toast(e.message, 'error');
  }
}

const guestUrl = () => link('cam.html', { e: eventId, s: studio });
const wallUrl = () => link('tv.html', { e: eventId, s: studio, frag: { wk: ev.wallKey } });
const albumUrl = () => link('album.html', { e: eventId, s: studio });

let headerEl, tabsEl, bodyEl;
function render() {
  headerEl = h('div');
  tabsEl = h('div', { class: 'tabs', role: 'tablist' });
  bodyEl = h('div', { role: 'tabpanel' });
  clear(root).append(headerEl, tabsEl, bodyEl, printSign());
  renderHeader();
  renderTabs();
  renderTab();
}

function counts() {
  const c = { all: items.length, pending: 0, reported: 0, hidden: 0, video: 0, fav: 0, blurry: 0 };
  for (const it of items) {
    if (c[it.s] != null) c[it.s]++;
    if (it.k === 'v') c.video++;
    if (it.fv) c.fav++;
    if (/blurry/.test(it.f || '')) c.blurry++;
  }
  return c;
}

function renderHeader() {
  const c = counts();
  const bytes = items.reduce((a, b) => a + (Number(b.b) || 0), 0);
  clear(headerEl).append(h('div', { class: 'event-head' },
    h('div', null, logoEl(studio, eventId, ev), h('h1', null, ev.name), h('p', { class: 'muted' }, [fmtDate(ev.date), ev.paused ? 'Uploads paused' : ''].filter(Boolean).join(', '))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, String(c.all)), 'photos and videos'),
      h('div', { class: 'stat' }, h('b', null, String(c.pending + c.reported)), 'need a look'),
      h('div', { class: 'stat' }, h('b', null, fmtBytes(bytes)), 'in Drive'))));
}

const TABS = [['share', 'Share'], ['invite', 'Invitations'], ['photos', 'Photos'], ['highlights', 'Highlight video'], ['guestbook', 'Guestbook'], ['guests', 'Guests'], ['settings', 'Settings'], ['security', 'Access']];
function renderTabs() {
  const c = counts();
  clear(tabsEl).append(...TABS.map(([id, label]) => {
    const b = h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; renderTabs(); renderTab(); } }, label);
    if (id === 'photos' && c.pending + c.reported) b.append(h('span', { class: 'badge' }, String(c.pending + c.reported)));
    return b;
  }));
}

function renderTab() {
  const map = { share: shareTab, invite: inviteTab, photos: photosTab, highlights: highlightsTab, guestbook: guestbookTab, guests: guestsTab, settings: settingsTab, security: securityTab };
  clear(bodyEl);
  map[tab]();
}

// ------------------------------------------------------------------ share
function inviteTab() {
  invitationsTab({ studio, eventId, key, body: bodyEl, getEv: () => ev, setEv: (x) => { ev = keepAccess(x); applyBrand(ev); }, rerender: () => { tab = 'invite'; renderTabs(); renderTab(); } });
}

function linkRow(label, url, help) {
  return h('div', { class: 'stack' },
    h('label', { class: 'field' }, h('span', null, label),
      h('div', { class: 'linkline' }, h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() }),
        h('button', { class: 'btn small', onclick: () => copy(url) }, 'Copy'),
        h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Open')),
      help ? h('small', null, help) : null));
}

function shareTab() {
  const qr = h('div', { class: 'qr-box' }, qrSvg(guestUrl()));
  bodyEl.append(h('div', { class: 'row', style: null },
    h('div', { class: 'stack' }, qr,
      h('div', { class: 'row' },
        h('button', { class: 'btn small', onclick: () => window.print() }, 'Print sign'),
        h('button', { class: 'btn small', onclick: downloadQr }, 'Download QR'))),
    h('div', { class: 'stack grow' },
      h('div', null, h('span', { class: 'small muted' }, 'Event code'), h('div', { class: 'row' }, h('span', { class: 'event-code' }, eventId), h('button', { class: 'btn small', onclick: () => copy(eventId) }, 'Copy')),
        ownStudio(studio) ? null : h('small', { class: 'muted' }, `Guests can also type this at ${link('index.html').replace(/index\.html$/, '')}`)),
      linkRow('Guest link', guestUrl(), 'This is what the QR code opens. Share it in texts or on the invitation.'),
      ev.settings.invite && ev.settings.invite.on ? linkRow('Invitation link', link('invite.html', { e: eventId, s: studio }), 'Guests RSVP here. See the Invitations tab for replies.') : null,
      linkRow('TV wall', wallUrl(), 'Open on a laptop or smart TV browser, then press Start the show. Safe to display: it has no host access.'),
      linkRow('Album', albumUrl(), ev.guestGallery ? 'Guests can browse here once photos are revealed.' : 'Guest browsing is off, so only you see the photos.'),
      ev.encrypted ? h('p', { class: 'callout' }, 'Private storage is on: files in Drive are locked and only this app can open them.') : null,
      downloadBox(),
      storageLine(),
      h('p', null, h('a', { href: ev.folderUrl, target: '_blank', rel: 'noopener' }, 'Open the Google Drive folder'), ' to download every original at full resolution. (Only the Google account that runs Rememberoll can open it.)'),
      h('p', { class: 'callout warn' }, 'Never share the host link (this page’s address) with guests. Anyone who has it can change settings and delete photos. Share the guest link, QR code or event code instead.'))),
    tableCardsPanel({ ev, eventId, guestUrl: guestUrl(), logo: () => logoImage(studio, eventId, ev) }));
}

function downloadQr() {
  const svg = qrSvg(guestUrl());
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${eventId}-qr.svg` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function printSign() {
  return h('div', { class: 'print-sign', 'aria-hidden': 'true' },
    logoEl(studio, eventId, ev),
    h('h1', null, ev.name),
    h('p', { class: 'tagline' }, ev.tagline || 'Be our photographer! Scan to open the camera.'),
    h('div', { class: 'qr' }, qrSvg(guestUrl(), { dark: '#000' })),
    h('p', null, `${ev.shotsPerGuest} shots each. No app needed.`),
    h('p', null, guestUrl()));
}

// ------------------------------------------------------------------ photos
const FILTERS = [['all', 'All'], ['fav', '♥ Favorites'], ['pending', 'Waiting for approval'], ['reported', 'Reported'], ['blurry', 'Blurry'], ['hidden', 'Hidden'], ['video', 'Videos']];
function visibleItems() {
  if (filter === 'all') return items;
  if (filter === 'video') return items.filter((x) => x.k === 'v');
  if (filter === 'fav') return items.filter((x) => x.fv);
  if (filter === 'blurry') return items.filter((x) => /blurry/.test(x.f || ''));
  return items.filter((x) => x.s === filter);
}

function photosTab() {
  const c = counts();
  const list = visibleItems();
  const chips = FILTERS.map(([id, label]) => h('button', { class: 'btn small' + (filter === id ? ' primary' : ''), onclick: () => { filter = id; selected.clear(); renderTab(); } }, `${label} (${c[id]})`));
  const actions = h('div', { class: 'row' },
    h('span', { class: 'small muted' }, `${selected.size} selected`),
    h('button', { class: 'btn small', onclick: () => { list.forEach((x) => selected.add(x.i)); renderTab(); } }, 'Select all'),
    h('button', { class: 'btn small', onclick: () => { selected.clear(); renderTab(); } }, 'Clear'),
    h('button', { class: 'btn small primary', disabled: !selected.size, onclick: () => moderate('show') }, 'Show'),
    h('button', { class: 'btn small', disabled: !selected.size, onclick: () => moderate('hide') }, 'Hide'),
    h('button', { class: 'btn small danger', disabled: !selected.size, onclick: () => moderate('delete') }, 'Delete'),
    h('button', { class: 'btn small', disabled: !selected.size, onclick: () => setFav([...selected], true) }, '♥ Favorite'),
    h('button', { class: 'btn small', disabled: !selected.size, onclick: () => setFav([...selected], false) }, 'Unfavorite'),
    c.fav ? h('button', { class: 'btn small', onclick: downloadFavorites }, `Download favorites (${c.fav})`) : null,
    h('button', { class: 'btn small', onclick: recoverMissing, title: 'Adds photos that are in the Drive folder but missing from the album' }, 'Find missing photos'));
  if (ev.purged) bodyEl.append(h('p', { class: 'callout warn' }, 'This album’s photo list was cleared because the plan had ended over 12 months ago. Your photos are still in your Google Drive: click “Find missing photos” to bring them back. They’ll come back waiting for your approval.'));
  bodyEl.append(h('div', { class: 'mod-toolbar stack' }, h('div', { class: 'row' }, ...chips), actions));
  if (!ev.encrypted && config.cloud) bodyEl.append(shopStrip({ studio, eventId, key, items, selected }));
  if (!list.length) { bodyEl.append(h('p', { class: 'empty' }, filter === 'all' ? 'No photos yet. Share the QR code to get started.' : 'Nothing here.')); return; }
  bodyEl.append(h('div', { class: 'mod-grid' }, list.map((it) => {
    const sel = selected.has(it.i);
    const label = { visible: 'Showing', pending: 'Needs approval', reported: `Reported${it.r > 1 ? ' ×' + it.r : ''}`, hidden: 'Hidden' }[it.s] || it.s;
    return h('div', { class: 'mod-item' + (sel ? ' selected' : '') },
      h('button', { class: 'pick', 'aria-pressed': String(sel), 'aria-label': 'Select photo', onclick: () => { sel ? selected.delete(it.i) : selected.add(it.i); renderTab(); } },
        hostThumb(it)),
      h('div', { class: 'meta' }, h('span', { class: 'state ' + it.s }, label, /blurry/.test(it.f || '') ? ', blurry' : ''),
        h('button', { class: 'heart' + (it.fv ? ' on' : ''), 'aria-pressed': String(!!it.fv), 'aria-label': it.fv ? 'Remove from favorites' : 'Add to favorites', onclick: () => setFav([it.i], !it.fv) }, it.fv ? '♥' : '♡')),
      h('div', { class: 'meta' }, h('span', { class: 'muted' }, it.k === 'v' ? 'Video' : it.g)),
      it.ch ? h('div', { class: 'meta' }, h('span', { class: 'challenge-tag' }, it.ch)) : null,
      it.cap ? h('div', { class: 'meta mod-caption' }, h('span', null, `“${it.cap}”`), h('button', { class: 'linkbtn', onclick: () => clearCaption(it) }, 'Remove caption')) : null,
      h('div', { class: 'meta' }, h('span', null, h('button', { class: 'linkbtn', onclick: () => viewOne(it) }, 'Open'), ' ', h('button', { class: 'linkbtn', onclick: () => downloadOne(it) }, 'Download')), h('span', { class: 'muted' }, fmtWhen(it.c))));
  })));
}

async function clearCaption(it) {
  try { await api(studio, 'hostClearCaption', { e: eventId, k: key, id: it.i }); it.cap = ''; toast('Caption removed', 'ok'); renderTab(); }
  catch (e) { toast(e.message, 'error'); }
}

// Visible photos load from Google's image URLs; anything private (pending, hidden, reported),
// or anything those URLs refuse, is fetched through the authenticated API instead.
const privateThumbs = new Map();
const thumbQueue = pool(3);
function privateThumb(it) {
  if (privateThumbs.has(it.i)) return Promise.resolve(privateThumbs.get(it.i));
  return thumbQueue(async () => {
    const m = await api(studio, 'hostMedia', { e: eventId, k: key, id: it.i, which: 'thumb' }, { retries: 1 });
    if (!/^image\/jpeg$/.test(m.mime)) return '';
    const url = URL.createObjectURL(await mediaBlob(m, eventKey));
    privateThumbs.set(it.i, url);
    return url;
  });
}
function hostThumb(it) {
  const img = h('img', { alt: '', loading: 'lazy' });
  if (it.s === 'visible' && !ev.encrypted) return loadDriveImage(img, it.k === 'v' && it.t ? it.t : it.i, 400, { proxy: () => privateThumb(it) });
  whenVisible(img, () => privateThumb(it).then((url) => { if (url) img.src = url; }).catch(() => {}));
  return img;
}

async function recoverMissing() {
  try {
    toast('Checking the Drive folder…');
    const dry = await api(studio, 'hostRecover', { e: eventId, k: key, dryRun: true }, { timeout: 120000 });
    if (!dry.found) { toast(`Nothing missing. Every photo in the folder is in the album${dry.duplicates ? ` (${dry.duplicates} duplicate copies ignored)` : ''}.`, 'ok'); return; }
    if (!confirm(`Found ${dry.found} photo${dry.found > 1 ? 's' : ''} in the Drive folder that ${dry.found > 1 ? 'aren’t' : 'isn’t'} in the album${dry.duplicates ? ` (plus ${dry.duplicates} duplicate copies, which will be skipped)` : ''}. Add ${dry.found > 1 ? 'them' : 'it'}?`)) return;
    const r = await api(studio, 'hostRecover', { e: eventId, k: key }, { timeout: 300000, retries: 0 });
    toast(`Added ${r.added} photo${r.added === 1 ? '' : 's'} to the album`, 'ok');
    await loadItems();
    renderHeader(); renderTabs(); renderTab();
  } catch (e) { toast(e.message, 'error'); }
}

async function setFav(ids, fav) {
  try {
    await api(studio, 'hostFavorite', { e: eventId, k: key, ids: ids.slice(0, 200), fav });
    for (const it of items) if (ids.includes(it.i)) it.fv = fav;
    toast(fav ? 'Added to favorites' : 'Removed from favorites', 'ok');
    renderTab();
  } catch (e) { toast(e.message, 'error'); }
}

/** Original file through the app (works for co-hosts and admins who can't open the owner's Drive). */
async function origBlob(it) {
  const m = await api(studio, 'hostMedia', { e: eventId, k: key, id: it.i, which: 'orig' }, { retries: 2, timeout: 120000 });
  return mediaBlob(m, eventKey);
}
const EXT = { 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/webm': 'webm' };
function saveBlob(blob, name) {
  const href = URL.createObjectURL(blob);
  h('a', { href, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(href), 120000);
}
async function downloadOne(it) {
  try {
    const blob = await origBlob(it);
    saveBlob(blob, `${eventId}-${it.i.slice(0, 8)}.${EXT[blob.type] || 'bin'}`);
  } catch (e) { toast(e.message, 'error'); }
}
async function viewOne(it) {
  const w = window.open('', '_blank'); // opened now so pop-up blockers allow it
  try {
    const url = URL.createObjectURL(await origBlob(it));
    if (w) { w.opener = null; w.location.href = url; } else saveBlob(await origBlob(it), `${eventId}-${it.i.slice(0, 8)}`);
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  } catch (e) { if (w) w.close(); toast(e.message, 'error'); }
}

/** Folder and file name inside the zip: sorted by challenge or by guest, or flat. */
function zipName(it, n, ext, folders) {
  const clean = (x, max) => String(x || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max);
  const top = clean(ev.name, 40) || eventId;
  const file = `${String(n).padStart(4, '0')}${it.g ? '-' + clean(it.g, 20) : ''}.${ext}`;
  if (folders === 'challenge') {
    const list = (ev.settings.challenges && ev.settings.challenges.list) || [];
    const i = it.ch ? list.indexOf(it.ch) : -1;
    const dir = it.ch ? `${String(i >= 0 ? i + 1 : list.length + 1).padStart(2, '0')}-${clean(it.ch, 40)}` : 'No-challenge';
    return `${top}/${dir}/${file}`;
  }
  if (folders === 'guest') return `${top}/${clean(it.g, 30) || 'Guest'}/${file}`;
  return `${top}/${file}`;
}

/** Download every photo and video, zipped in the browser (in parts for big albums). Works for co-hosts and private storage. */
async function downloadAll(folders = 'challenge', bar = null) {
  const list = items.filter((x) => x.s !== 'deleted');
  if (!list.length) { toast('No photos yet.'); return; }
  const { makeZip } = await import('./zip.js');
  const PART = 150 * 1024 * 1024; // keeps memory use sane on laptops; more parts for big albums
  let files = [], size = 0, part = 1, done = 0, skipped = 0;
  if (bar) { bar.hidden = false; bar.max = list.length; bar.value = 0; }
  const flush = (last) => {
    if (!files.length) return;
    saveBlob(makeZip(files), part === 1 && last ? `${eventId}-album.zip` : `${eventId}-album-part${part}.zip`);
    part++; files = []; size = 0;
  };
  for (const it of list) {
    done++;
    if (bar) bar.value = done; else toast(`Getting ${done} of ${list.length}…`);
    try {
      const blob = await origBlob(it);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (size + bytes.length > PART) flush(false);
      files.push({ name: zipName(it, done, EXT[blob.type] || 'bin', folders), bytes });
      size += bytes.length;
    } catch (e) { skipped++; }
  }
  flush(true);
  if (bar) bar.hidden = true;
  toast(`Album downloaded (${done - skipped} items${skipped ? `, ${skipped} skipped` : ''})`, skipped ? 'error' : 'ok');
}

/** Where new photos save: Rememberoll storage (if the account has it) or the host's Google Drive. */
function storageLine() {
  if (!ev.storage || inStoreApp()) return null;
  if (!ev.storage.active) {
    return ev.role === 'cohost' ? null : h('p', { class: 'small' }, 'Worried about Google Drive space? ',
      h('a', { href: link('admin.html', { s: studio }) + '#storage' }, 'Add Rememberoll storage'), ' (paid once for 12 months).');
  }
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: ev.store === 'r2', onchange: async (e) => {
    try { const r = await api(studio, 'hostUseStorage', { e: eventId, k: key, on: e.target.checked }); ev.store = r.store; toast(r.store ? 'New photos save to Rememberoll storage.' : 'New photos save to your Google Drive.', 'ok'); }
    catch (x) { toast(x.message, 'error'); e.target.checked = !e.target.checked; }
  } }), h('span', null, 'Save new photos to Rememberoll storage', h('small', null, `Not your Google Drive. Paid through ${fmtDate(ev.storage.until)}.`)));
}

/** The Share tab's download box: choose folders, then one button. */
function downloadBox() {
  const hasCh = !!(ev.settings.challenges && ev.settings.challenges.on);
  const sel = h('select', { class: 'dl-select', 'aria-label': 'Folders in the zip' },
    h('option', { value: 'challenge' }, hasCh ? 'Folders by challenge' : 'Folders by challenge (none set)'),
    h('option', { value: 'guest' }, 'Folders by guest'),
    h('option', { value: 'flat' }, 'No folders'));
  if (!hasCh) sel.value = 'guest';
  const bar = h('progress', { class: 'dl-progress', hidden: true, 'aria-label': 'Download progress' });
  const btn = h('button', { class: 'btn small', onclick: async () => { btn.disabled = true; try { await downloadAll(sel.value, bar); } finally { btn.disabled = false; } } },
    ev.encrypted ? 'Download all (unlocked)' : 'Download all photos and videos');
  return h('div', { class: 'stack' }, h('div', { class: 'row' }, btn, sel), bar,
    h('span', { class: 'small muted' }, 'Zipped in your browser. Works for co-hosts too.'));
}

async function downloadFavorites() {
  const favs = items.filter((x) => x.fv).slice(0, 150);
  if (!favs.length) return;
  const { makeZip } = await import('./zip.js');
  const files = [];
  for (let i = 0; i < favs.length; i++) {
    toast(`Preparing favorites ${i + 1} of ${favs.length}…`);
    try {
      const m = await api(studio, 'hostMedia', { e: eventId, k: key, id: favs[i].i, which: 'orig' }, { retries: 2, timeout: 120000 });
      const blob = await mediaBlob(m, eventKey);
      const ext = { 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/webm': 'webm' }[blob.type] || 'bin';
      files.push({ name: `${eventId}-favorite-${String(i + 1).padStart(3, '0')}.${ext}`, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } catch (e) { toast(`Skipped one: ${e.message}`, 'error'); }
  }
  saveBlob(makeZip(files), `${eventId}-favorites.zip`);
  toast(`Downloaded ${files.length} favorites`, 'ok');
}

async function moderate(action) {
  const ids = [...selected];
  if (action === 'delete' && !confirm(`Delete ${ids.length} item(s)? They go to your Drive trash and leave the album.`)) return;
  try {
    for (let i = 0; i < ids.length; i += 100) {
      await api(studio, 'hostModerate', { e: eventId, k: key, action, ids: ids.slice(i, i + 100) });
    }
    toast(`${{ show: 'Shown', hide: 'Hidden', delete: 'Deleted' }[action]}: ${ids.length}`, 'ok');
    selected.clear();
    await loadItems();
    renderHeader(); renderTabs(); renderTab();
  } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ guestbook
async function guestbookTab() {
  bodyEl.append(h('p', { class: 'muted' }, 'Loading messages…'));
  let notes;
  try { notes = (await api(studio, 'hostGuestbook', { e: eventId, k: key })).notes; } catch (e) { clear(bodyEl).append(h('p', null, e.message)); return; }
  notes.sort((a, b) => b.c - a.c);
  const stateLabel = { visible: 'Showing', pending: 'Needs approval', hidden: 'Hidden' };
  clear(bodyEl).append(
    h('p', { class: 'muted' }, ev.settings.guestbook ? `${notes.length} messages. Guests sign it from the camera page.` : 'The guestbook is turned off in Settings.'),
    notes.length ? h('div', { class: 'notes' }, notes.map((n) => h('article', { class: 'note' },
      n.text ? h('p', null, n.text) : null,
      n.a && isDriveId(n.a) ? voicePlayer(n, (id) => api(studio, 'hostMedia', { e: eventId, k: key, id, which: 'note' }, { timeout: 60000 }), eventKey) : null,
      h('p', { class: 'small muted' }, `${n.g}, ${fmtWhen(n.c)} `, h('span', { class: 'state ' + n.s }, stateLabel[n.s] || n.s)),
      h('div', { class: 'row' },
        n.s !== 'visible' ? h('button', { class: 'btn small primary', onclick: () => modNote(n.id, 'show') }, 'Show') : h('button', { class: 'btn small', onclick: () => modNote(n.id, 'hide') }, 'Hide'),
        h('button', { class: 'btn small danger', onclick: () => modNote(n.id, 'delete') }, 'Delete'))))) : null);
}

async function modNote(id, action) {
  if (action === 'delete' && !confirm('Delete this message? A voice recording goes to your Drive trash.')) return;
  try { await api(studio, 'hostGuestbookModerate', { e: eventId, k: key, action, ids: [id] }); renderTab(); } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ guests
async function guestsTab() {
  bodyEl.append(h('p', { class: 'muted' }, 'Loading guests…'));
  let guests;
  try { guests = (await api(studio, 'hostGuests', { e: eventId, k: key })).guests; } catch (e) { clear(bodyEl).append(h('p', null, e.message)); return; }
  guests.sort((a, b) => b.uploads - a.uploads);
  clear(bodyEl).append(
    h('p', { class: 'muted' }, `${guests.filter((g) => g.uploads > 0).length} of ${guests.length} guests have taken photos.`),
    h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Guest'), h('th', null, 'Shots used'), h('th', null, 'Reports made'), h('th', null, 'Joined'), h('th', null, ''))),
      h('tbody', null, guests.map((g) => h('tr', null,
        h('td', null, g.label), h('td', null, `${g.shots} of ${ev.shotsPerGuest}`), h('td', null, String(g.reports)), h('td', null, fmtWhen(g.joined)),
        h('td', null, h('button', { class: 'btn small' + (g.blocked ? '' : ' danger'), onclick: () => block(g, !g.blocked) }, g.blocked ? 'Unblock' : 'Block')))))));
}

async function block(g, yes) {
  if (yes && !confirm(`Block ${g.label}? They won’t be able to upload any more. Their existing photos stay until you hide them.`)) return;
  try { await api(studio, 'hostBlockGuest', { e: eventId, k: key, guestId: g.id, block: yes }); renderTab(); } catch (e) { toast(e.message, 'error'); }
}

// ------------------------------------------------------------------ settings
const CHALLENGE_IDEAS = ['Selfie with the hosts', 'Someone mid-laugh', 'The best dance move', 'A toast in action', 'Two generations in one photo',
  'Your whole table together', 'The prettiest detail', 'Someone you just met', 'Shoes made for dancing', 'A candid hug',
  'Dessert before it disappears', 'Your best photobomb', 'The view from your seat', 'Something blue', 'The last dance'];

/** Captions and photo challenges: small extras that make guests take more (and better) photos. */
function funFieldset(s) {
  const ch = s.challenges || { on: false, list: [] };
  const list = h('textarea', { name: 'challengeList', rows: 6, maxlength: 1000, placeholder: 'One challenge per line' }, (ch.list || []).join('\n'));
  return h('fieldset', null, h('legend', null, 'Fun extras'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'captions', checked: s.captions !== false, disabled: ev.encrypted }),
      h('span', null, 'Let guests add a caption to a photo', h('small', null, ev.encrypted ? 'Not available for private-storage events.' : 'Shown under the photo in the album and on the TV. You can remove any caption.'))),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'challengesOn', checked: !!ch.on }),
      h('span', null, 'Photo challenges', h('small', null, 'The camera shows one prompt at a time, like “Selfie with the hosts”. The album groups the answers.'))),
    h('label', { class: 'field' }, h('span', null, 'Challenges (up to 15)'), list,
      h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => { list.value = CHALLENGE_IDEAS.join('\n'); } }, 'Use our ideas'),
        h('small', null, 'Edit them freely. Keep each one short.'))));
}

function settingsTab() {
  const s = ev.settings;
  const inp = (name, attrs = {}) => h('input', { name, ...attrs });
  const check = (name, label, help) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: name === 'beauty' ? s.beauty !== false : !!s[name] }), h('span', null, label, help ? h('small', null, help) : null));
  const lookSel = h('select', { name: 'look' }, Object.entries(LOOKS).map(([k, v]) => h('option', { value: k, selected: s.look === k }, v.label)));
  const revealSel = h('select', { name: 'reveal' }, h('option', { value: 'live', selected: s.reveal === 'live' }, 'Live, as photos are taken'), h('option', { value: 'after', selected: s.reveal === 'after' }, 'Develop later'));
  const form = h('form', { class: 'stack' },
    h('fieldset', null, h('legend', null, 'Event'), h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Name'), inp('name', { type: 'text', maxlength: 80, value: s.name, required: true })),
      h('label', { class: 'field' }, h('span', null, 'Date'), inp('date', { type: 'date', value: s.date })),
      ),
      h('label', { class: 'field' }, h('span', null, 'Welcome note'), h('textarea', { name: 'welcome', maxlength: 280 }, s.welcome), h('small', null, 'Shown to guests before they open the camera.'))),
    brandingFieldset(s, inp),
    h('fieldset', null, h('legend', null, 'The roll'), h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Shots per guest'), inp('shotsPerGuest', { type: 'number', min: 1, max: 500, value: s.shotsPerGuest })),
      h('label', { class: 'field' }, h('span', null, 'Guest limit'), inp('maxGuests', { type: 'number', min: 1, max: 5000, value: s.maxGuests }), h('small', null, 'Guests count once they upload a photo.')),
      h('label', { class: 'field' }, h('span', null, 'Video length (seconds)'), inp('maxVideoSec', { type: 'number', min: 3, max: 60, value: s.maxVideoSec })),
      h('label', { class: 'field' }, h('span', null, 'Film look'), lookSel)),
      check('allowVideo', 'Allow short videos', 'Each video uses one shot.'),
      check('guestLooks', 'Let guests pick a film look'),
      check('beauty', 'Beauty touch-up', 'Gently smooths skin and softens blemishes on faces. Guests can switch it off on their camera.'),
      check('dateStamp', 'Add a date stamp to photos'),
      check('allowLibrary', 'Allow uploads from the camera roll', 'Off keeps it a true disposable camera.')),
    funFieldset(s),
    h('fieldset', null, h('legend', null, 'Timing'), h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Photo reveal'), revealSel),
      h('label', { class: 'field' }, h('span', null, 'Reveal at'), inp('revealAt', { type: 'datetime-local', value: isoToLocalInput(s.revealAt) }), h('small', null, 'Only used for “develop later”. Blank means you reveal manually by switching to live.')),
      h('label', { class: 'field' }, h('span', null, 'Camera opens'), inp('opensAt', { type: 'datetime-local', value: isoToLocalInput(s.opensAt) })),
      h('label', { class: 'field' }, h('span', null, 'Album closes'), inp('closesAt', { type: 'datetime-local', value: isoToLocalInput(s.closesAt) }), h('small', null, 'No new photos after this. The TV wall shows a last call 45 minutes before.')),
      h('label', { class: 'field' }, h('span', null, 'Album disappears on'), inp('archiveAt', { type: 'datetime-local', value: isoToLocalInput(s.archiveAt) }), h('small', null, 'Optional. After this, guest links say “This album has been archived.” Your photos stay in your Google Drive and on this dashboard.'))),
      check('paused', 'Pause uploads now', 'Photos guests take are kept on their phones and upload when you resume.')),
    h('fieldset', null, h('legend', null, 'Safety and privacy'),
      h('p', { class: 'small' }, ev.encrypted ? 'Private storage: on. Files are locked in Drive; only this app can open them.' : 'Private storage: off. Photos are normal files in your Drive folder. (Private storage is chosen when an event is created.)'),
      check('approval', 'Approve photos before anyone sees them'),
      check('guestGallery', 'Let guests browse the album'),
      check('allowReports', 'Let guests report photos', 'A reported photo is hidden until you decide.'),
      check('enhance', 'Offer an Enhance button in the album', 'Guests can view and download a touched-up copy. Originals never change.'),
      check('guestbook', 'Guestbook', 'Guests can leave a note or a short voice message.'),
      h('div', { class: 'grid-form' }, h('label', { class: 'field' }, h('span', null, 'Event code'),
        inp('pin', { type: 'text', inputmode: 'numeric', maxlength: 8, placeholder: ev.needsPin ? 'Code is set (type to change)' : 'No code', autocomplete: 'off' }),
        h('small', null, '4–8 digits guests must enter. Not included in the QR code, so print it separately.'))),
      ev.needsPin ? h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'clearPin' }), h('span', null, 'Remove the event code')) : null),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save settings')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const settings = {
      name: fd.get('name'), date: fd.get('date'), accent: fd.get('accent'), welcome: fd.get('welcome'), font: fd.get('font'), tagline: fd.get('tagline'),
      shotsPerGuest: Number(fd.get('shotsPerGuest')), maxGuests: Number(fd.get('maxGuests')), maxVideoSec: Number(fd.get('maxVideoSec')),
      look: fd.get('look'), reveal: fd.get('reveal'),
      revealAt: localInputToIso(fd.get('revealAt')), opensAt: localInputToIso(fd.get('opensAt')), closesAt: localInputToIso(fd.get('closesAt')), archiveAt: localInputToIso(fd.get('archiveAt')),
    };
    for (const k of ['allowVideo', 'guestLooks', 'beauty', 'dateStamp', 'allowLibrary', 'paused', 'approval', 'guestGallery', 'allowReports', 'enhance', 'guestbook']) settings[k] = fd.get(k) === 'on';
    settings.captions = fd.get('captions') === 'on';
    const list = String(fd.get('challengeList') || '').split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15);
    settings.challenges = { on: fd.get('challengesOn') === 'on' && list.length > 0, list };
    if (fd.get('challengesOn') === 'on' && !list.length) { toast('Add at least one challenge, or turn challenges off.', 'error'); return; }
    const payload = { e: eventId, k: key, settings };
    const pin = String(fd.get('pin') || '').trim();
    if (fd.get('clearPin') === 'on') payload.pin = '';
    else if (pin) payload.pin = pin;
    try {
      ev = keepAccess((await api(studio, 'hostUpdate', payload)).event);
      applyBrand(ev);
      toast('Settings saved', 'ok');
      render();
      tab = 'settings'; renderTabs(); renderTab();
    } catch (err) { toast(err.message, 'error'); }
  });
  bodyEl.append(form);
}

function brandingFieldset(s, inp) {
  const preview = h('div', { class: 'logo-edit' });
  const showLogo = () => {
    clear(preview).append(
      ev.logoV ? logoEl(studio, eventId, ev) : h('span', { class: 'small muted' }, 'No logo yet.'),
      h('label', { class: 'btn small' }, ev.logoV ? 'Change logo' : 'Upload logo',
        h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden', onchange: (e) => setLogo(e.target.files[0], e.target) })),
      ev.logoV ? h('button', { class: 'btn small', type: 'button', onclick: () => setLogo(null) }, 'Remove') : null);
  };
  async function setLogo(file, input) {
    if (input) input.value = '';
    try {
      const data = file ? await blobToBase64(await prepareLogo(file)) : undefined;
      const r = await api(studio, 'hostSetLogo', { e: eventId, k: key, data }, { retries: 1, timeout: 60000 });
      ev.logoV = r.logoV;
      toast(file ? 'Logo saved. It shows on the camera, album, TV wall and printed sign.' : 'Logo removed', 'ok');
      showLogo();
      renderHeader();
    } catch (e) { toast(e.message, 'error'); }
  }
  showLogo();
  return h('fieldset', null, h('legend', null, 'Branding'),
    h('div', { class: 'field' }, h('span', null, 'Logo or monogram'), preview, h('small', null, 'PNG with a transparent background looks best. Shown on every guest page and the printed sign.')),
    h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Accent colour'), inp('accent', { type: 'color', value: s.accent })),
      h('label', { class: 'field' }, h('span', null, 'Heading style'),
        h('select', { name: 'font' }, Object.entries(FONTS).map(([k, v]) => h('option', { value: k, selected: (s.font || 'modern') === k }, v))))),
    h('label', { class: 'field' }, h('span', null, 'Tagline'), inp('tagline', { type: 'text', maxlength: 80, value: s.tagline || '', placeholder: 'e.g. Snap away, share the love' }),
      h('small', null, 'Shown under the event name and on the printed sign.')));
}

// ------------------------------------------------------------------ highlight video
let lastFilm = null;
async function highlightsTab() {
  const { pickPhotos, renderHighlight, highlightSupported } = await import('./highlight.js');
  if (!highlightSupported()) {
    bodyEl.append(h('p', { class: 'callout' }, 'This browser can’t make videos. Open this dashboard in Chrome, Edge or a recent Safari on a laptop.'));
    return;
  }
  const count = h('select', { name: 'count' }, [12, 24, 40, 60].map((n) => h('option', { value: n, selected: n === 24 }, `${n} photos`)));
  const speed = h('select', { name: 'speed' }, [[2, 'Quick (2 s each)'], [3, 'Relaxed (3 s each)'], [4, 'Slow (4 s each)']].map(([v, l]) => h('option', { value: v, selected: v === 3 }, l)));
  const format = h('select', { name: 'format' }, h('option', { value: 'wide' }, 'Wide (TV, laptop, YouTube)'), h('option', { value: 'tall' }, 'Tall (phones, Stories, group chats)'));
  const withNotes = h('input', { type: 'checkbox', checked: true });
  const withVoices = h('input', { type: 'checkbox', checked: true });
  const music = h('input', { type: 'file', accept: 'audio/*' });
  const closing = h('input', { type: 'text', maxlength: 80, value: 'Thank you for celebrating with us' });
  const est = h('p', { class: 'small muted' });
  const go = h('button', { class: 'btn primary' }, 'Make the video');
  const bar = h('progress', { max: 1, value: 0, hidden: true, class: 'film-progress' });
  const status = h('p', { class: 'small', 'aria-live': 'polite' });
  const out = h('div', { class: 'stack' });
  const update = () => {
    const n = pickPhotos(items, Number(count.value)).length;
    const favs = items.filter((x) => x.fv && x.s === 'visible' && x.k !== 'v').length;
    const secs = Math.round(7 + n * Number(speed.value) + (withNotes.checked ? Math.floor(n / 5) * 4 : 0));
    est.textContent = n ? `${n} photos (${Math.min(favs, n)} favorite${Math.min(favs, n) === 1 ? '' : 's'}, the rest picked across the night, blurry ones skipped). About ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')} long; it records in real time.` : 'No visible photos yet.';
    go.disabled = !n;
  };
  [count, speed, withNotes].forEach((el) => el.addEventListener('change', update));
  update();
  go.addEventListener('click', async () => {
    go.disabled = true; bar.hidden = false; clear(out);
    try {
      const picked = pickPhotos(items, Number(count.value));
      status.textContent = 'Fetching photos…';
      const fetchPool = pool(3);
      const photos = (await Promise.all(picked.map((it) => fetchPool(async () => {
        try { return await mediaBlob(await api(studio, 'hostMedia', { e: eventId, k: key, id: it.i, which: 'thumb' }, { retries: 2 }), eventKey); } catch { return null; }
      })))).filter(Boolean);
      let notes = [], voices = [];
      if ((withNotes.checked || withVoices.checked) && ev.settings.guestbook) {
        const all = (await api(studio, 'hostGuestbook', { e: eventId, k: key })).notes.filter((n) => n.s === 'visible').sort((a, b) => a.c - b.c);
        if (withNotes.checked) notes = all.filter((n) => n.text).map((n) => ({ text: n.text.slice(0, 160), g: n.g }));
        if (withVoices.checked) {
          for (const n of all.filter((x) => x.a && isDriveId(x.a)).slice(0, 8)) {
            try { voices.push(await mediaBlob(await api(studio, 'hostMedia', { e: eventId, k: key, id: n.a, which: 'note' }, { timeout: 60000 }), eventKey)); } catch { /* skip */ }
          }
        }
      }
      const logo = await logoBlob(studio, eventId, ev);
      const film = await renderHighlight({
        photos, notes, voices, music: music.files[0] || null, logo,
        title: ev.name, subtitle: [fmtDate(ev.date), ev.tagline].filter(Boolean).join(' · '), closing: closing.value.trim(),
        accent: ev.accent, font: ev.font, format: format.value, perPhoto: Number(speed.value),
        onProgress: (f, label) => { bar.value = f; status.textContent = label; },
      });
      if (lastFilm) URL.revokeObjectURL(lastFilm.url);
      const ext = film.type.includes('mp4') ? 'mp4' : 'webm';
      const name = `${ev.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || eventId}-highlights.${ext}`;
      lastFilm = { url: URL.createObjectURL(film), file: new File([film], name, { type: film.type }) };
      status.textContent = `Done: ${fmtBytes(film.size)}.`;
      status.dataset.bytes = String(film.size);
      const canShare = navigator.canShare && navigator.canShare({ files: [lastFilm.file] });
      clear(out).append(
        h('video', { controls: true, playsinline: true, src: lastFilm.url, class: 'film-preview' }),
        h('div', { class: 'row' },
          h('a', { class: 'btn primary', href: lastFilm.url, download: name }, 'Download video'),
          canShare ? h('button', { class: 'btn', onclick: () => navigator.share({ files: [lastFilm.file], title: ev.name }).catch(() => {}) }, 'Share…') : null),
        h('p', { class: 'small muted' }, ext === 'webm' ? 'Tip: WebM plays in browsers and on Android. For iPhones, make it in Safari to get an MP4.' : 'MP4 plays everywhere.'));
    } catch (e) {
      status.textContent = '';
      toast(e.message || 'Couldn’t make the video.', 'error');
    } finally { go.disabled = false; bar.hidden = true; }
  });
  bodyEl.append(h('div', { class: 'stack narrow' },
    h('h2', null, 'Highlight video'),
    h('p', null, 'A short film of the night to send the morning after: your favorites plus the best of the rest, guestbook messages and voice notes, with your logo and colours. Made on this computer; nothing is uploaded.'),
    h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Length'), count),
      h('label', { class: 'field' }, h('span', null, 'Pace'), speed),
      h('label', { class: 'field' }, h('span', null, 'Shape'), format)),
    h('label', { class: 'check' }, withNotes, h('span', null, 'Include guestbook messages')),
    h('label', { class: 'check' }, withVoices, h('span', null, 'Play voice messages over the photos')),
    h('label', { class: 'field' }, h('span', null, 'Music (optional)'), music, h('small', null, 'A song file from this computer. Use music you’re allowed to share.')),
    h('label', { class: 'field' }, h('span', null, 'Closing line'), closing),
    est, h('div', { class: 'row' }, go), bar, status, out));
}

// ------------------------------------------------------------------ access
function securityTab() {
  const remembered = !!store.get(keyName());
  bodyEl.append(h('div', { class: 'stack narrow' },
    h('h2', null, 'Who can manage this event'),
    h('p', null, 'Anyone with the host link can moderate, change settings and download originals. Never share it with guests.'),
    key.startsWith('admin:') ? h('p', { class: 'muted' }, 'You opened this dashboard from the studio admin page, using your admin key.') : h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: remembered, onchange: (e) => { if (e.target.checked) store.set(keyName(), key); else store.del(keyName()); toast(e.target.checked ? 'This device will stay signed in' : 'You’ll need the host link next time'); } }),
      h('span', null, 'Remember me on this device', h('small', null, 'Leave off on shared computers.'))),
    key.startsWith('admin:') ? null : h('div', { class: 'stack' }, h('h3', null, 'Open it from your phone’s home screen'),
      h('p', null, 'Tick “Remember me on this device” first, then add the icon. Only do this on your own phone.'), installButton('host')),
    h('hr', { class: 'divider' }),
    cohostSection(),
    ev.role === 'cohost' ? null : h('hr', { class: 'divider' }),
    ev.role === 'cohost' ? null : h('h3', null, 'Make a new host link'),
    ev.role === 'cohost' ? null : h('p', null, 'Turns off the old host link and the TV wall link immediately. Use it if a link was shared by mistake.'),
    ev.role === 'cohost' ? null : h('button', { class: 'btn danger', onclick: rotate }, 'Make a new host link')));
}

/** Co-host (free): one extra host link for a partner or planner. It can do everything except change host links. */
function cohostSection() {
  const box = h('div', { class: 'stack' });
  const draw = (newKey) => {
    clear(box).append(h('h3', null, 'Co-host (free)'));
    if (ev.role === 'cohost') { box.append(h('p', null, 'You’re a co-host. You can do everything here except replace the host links. The main host can turn off your link.')); return; }
    box.append(h('p', null, 'Perfect for a partner or planner. One co-host per event. They can moderate, change settings, see RSVPs and download photos. Only you can replace host links or turn theirs off.'));
    if (newKey) {
      const url = link('host.html', { e: eventId, s: studio, frag: { k: newKey } });
      box.append(h('p', { class: 'callout' }, 'Send this link to your co-host. It won’t be shown again.'),
        h('div', { class: 'keybox' }, url), h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => copy(url) }, 'Copy co-host link')));
    }
    box.append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => make() }, ev.cohost ? 'Make a new co-host link' : 'Create co-host link'),
      ev.cohost ? h('button', { class: 'btn danger', onclick: revoke }, 'Turn off co-host link') : null,
      ev.cohost && !newKey ? h('span', { class: 'small muted' }, 'A co-host link is active.') : null));
  };
  async function make() {
    if (ev.cohost && !confirm('Make a new co-host link? The current one stops working right away.')) return;
    try { const r = await api(studio, 'hostCohost', { e: eventId, k: key, op: 'create' }); ev.cohost = true; draw(r.cohostKey); } catch (e) { toast(e.message, 'error'); }
  }
  async function revoke() {
    if (!confirm('Turn off the co-host link? It stops working right away.')) return;
    try { await api(studio, 'hostCohost', { e: eventId, k: key, op: 'revoke' }); ev.cohost = false; draw(); toast('Co-host link turned off.', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  draw();
  return box;
}

async function rotate() {
  if (!confirm('Make a new host link? The current host link and TV wall link stop working right away.')) return;
  try {
    const r = await api(studio, 'hostRotateKey', { e: eventId, k: key });
    key = r.hostKey;
    store.set(keyName(), key, sessionStorage);
    if (store.get(keyName())) store.set(keyName(), key);
    { const hg = await api(studio, 'hostGet', { e: eventId, k: key }); ev = hg.event; eventKey = hg.key || ''; }
    const url = link('host.html', { e: eventId, s: studio, frag: { k: key } });
    clear(bodyEl).append(h('div', { class: 'stack narrow' }, h('h2', null, 'New host link'), h('p', null, 'Save this somewhere safe. It won’t be shown again.'),
      h('div', { class: 'keybox' }, url), h('button', { class: 'btn', onclick: () => copy(url) }, 'Copy host link')));
  } catch (e) { toast(e.message, 'error'); }
}

boot();
