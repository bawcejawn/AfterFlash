// Host dashboard: share, moderate, guests, settings.
import {
  $, h, clear, toast, params, studioFrom, isEventId, isDriveId, store, setAccent, setTitle, fmtDate, fmtWhen, fmtBytes,
  link, qrSvg, copy, isoToLocalInput, localInputToIso, frameGuard, config, base64ToBytes, loadDriveImage, serial, pool, whenVisible,
} from './util.js';
import { api } from './api.js';
import { LOOKS } from './film.js';
import { voicePlayer } from './guestbook.js';
import { mediaBlob } from './crypto.js';

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
  setAccent(ev.accent);
  setTitle(ev.name + ' host');
  await loadItems();
  render();
  pollT = setInterval(() => { if (!document.hidden) loadItems(true); }, 15000);
}

async function loadItems(quiet) {
  try {
    const r = await api(studio, 'hostList', { e: eventId, k: key }, { retries: quiet ? 0 : 2 });
    ev = r.event;
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
    h('div', null, h('h1', null, ev.name), h('p', { class: 'muted' }, [fmtDate(ev.date), ev.paused ? 'Uploads paused' : ''].filter(Boolean).join(', '))),
    h('div', { class: 'stats' },
      h('div', { class: 'stat' }, h('b', null, String(c.all)), 'photos and videos'),
      h('div', { class: 'stat' }, h('b', null, String(c.pending + c.reported)), 'need a look'),
      h('div', { class: 'stat' }, h('b', null, fmtBytes(bytes)), 'in Drive'))));
}

const TABS = [['share', 'Share'], ['photos', 'Photos'], ['guestbook', 'Guestbook'], ['guests', 'Guests'], ['settings', 'Settings'], ['keepsakes', 'Keepsakes'], ['security', 'Access']];
function renderTabs() {
  const c = counts();
  clear(tabsEl).append(...TABS.map(([id, label]) => {
    const b = h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; renderTabs(); renderTab(); } }, label);
    if (id === 'photos' && c.pending + c.reported) b.append(h('span', { class: 'badge' }, String(c.pending + c.reported)));
    return b;
  }));
}

function renderTab() {
  const map = { share: shareTab, photos: photosTab, guestbook: guestbookTab, guests: guestsTab, settings: settingsTab, keepsakes: keepsakesTab, security: securityTab };
  clear(bodyEl);
  map[tab]();
}

// ------------------------------------------------------------------ share
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
        h('small', { class: 'muted' }, `Guests can also type this at ${link('index.html').replace(/index\.html$/, '')}`)),
      linkRow('Guest link', guestUrl(), 'This is what the QR code opens. Share it in texts or on the invitation.'),
      linkRow('TV wall', wallUrl(), 'Open on a laptop or smart TV browser, then press Start the show. Safe to display: it has no host access.'),
      linkRow('Album', albumUrl(), ev.guestGallery ? 'Guests can browse here once photos are revealed.' : 'Guest browsing is off, so only you see the photos.'),
      ev.encrypted ? h('p', { class: 'callout' }, 'Private storage is on: files in Drive are locked and only this app can open them. ',
        h('button', { class: 'btn small', onclick: downloadAll }, 'Download all (unlocked)')) : h('p', null, h('button', { class: 'btn small', onclick: downloadAll }, 'Download all photos and videos'), ' ', h('span', { class: 'small muted' }, 'Zipped in your browser; works for co-hosts too.')),
      h('p', null, h('a', { href: ev.folderUrl, target: '_blank', rel: 'noopener' }, 'Open the Google Drive folder'), ' to download every original at full resolution. (Only the Google account that runs PhotoShare can open it.)'),
      h('p', { class: 'callout warn' }, 'Never share the host link (this page’s address) with guests. Anyone who has it can change settings and delete photos. Share the guest link, QR code or event code instead.'))));
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
    h('h1', null, ev.name),
    h('p', null, 'Be our photographer! Scan to open the camera.'),
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
  bodyEl.append(h('div', { class: 'mod-toolbar stack' }, h('div', { class: 'row' }, ...chips), actions));
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
      h('div', { class: 'meta' }, h('span', null, h('button', { class: 'linkbtn', onclick: () => viewOne(it) }, 'Open'), ' ', h('button', { class: 'linkbtn', onclick: () => downloadOne(it) }, 'Download')), h('span', { class: 'muted' }, fmtWhen(it.c))));
  })));
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

/** Private storage: Drive only holds locked files, so download everything through the app in zip parts. */
async function downloadAll() {
  const list = items.filter((x) => x.s !== 'deleted');
  if (!list.length) return;
  const { makeZip } = await import('./zip.js');
  const PART = 150 * 1024 * 1024; // keeps memory use sane on laptops; more parts for big albums
  let files = [], size = 0, part = 1, done = 0;
  const flush = () => {
    if (!files.length) return;
    saveBlob(makeZip(files), `${eventId}-album-part${part}.zip`);
    part++; files = []; size = 0;
  };
  for (const it of list) {
    toast(`Unlocking ${++done} of ${list.length}…`);
    try {
      const blob = await origBlob(it);
      const ext = EXT[blob.type] || 'bin';
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (size + bytes.length > PART) flush();
      files.push({ name: `${eventId}-${String(done).padStart(4, '0')}${it.g ? '-' + it.g.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 20) : ''}.${ext}`, bytes });
      size += bytes.length;
    } catch (e) { toast(`Skipped one: ${e.message}`, 'error'); }
  }
  flush();
  toast(`Album downloaded (${done} items)`, 'ok');
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
      h('label', { class: 'field' }, h('span', null, 'Accent colour'), inp('accent', { type: 'color', value: s.accent }))),
      h('label', { class: 'field' }, h('span', null, 'Welcome note'), h('textarea', { name: 'welcome', maxlength: 280 }, s.welcome), h('small', null, 'Shown to guests before they open the camera.'))),
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
    h('fieldset', null, h('legend', null, 'Timing'), h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Photo reveal'), revealSel),
      h('label', { class: 'field' }, h('span', null, 'Reveal at'), inp('revealAt', { type: 'datetime-local', value: isoToLocalInput(s.revealAt) }), h('small', null, 'Only used for “develop later”. Blank means you reveal manually by switching to live.')),
      h('label', { class: 'field' }, h('span', null, 'Camera opens'), inp('opensAt', { type: 'datetime-local', value: isoToLocalInput(s.opensAt) })),
      h('label', { class: 'field' }, h('span', null, 'Album closes'), inp('closesAt', { type: 'datetime-local', value: isoToLocalInput(s.closesAt) }), h('small', null, 'The TV wall shows a last call 45 minutes before.'))),
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
      name: fd.get('name'), date: fd.get('date'), accent: fd.get('accent'), welcome: fd.get('welcome'),
      shotsPerGuest: Number(fd.get('shotsPerGuest')), maxGuests: Number(fd.get('maxGuests')), maxVideoSec: Number(fd.get('maxVideoSec')),
      look: fd.get('look'), reveal: fd.get('reveal'),
      revealAt: localInputToIso(fd.get('revealAt')), opensAt: localInputToIso(fd.get('opensAt')), closesAt: localInputToIso(fd.get('closesAt')),
    };
    for (const k of ['allowVideo', 'guestLooks', 'beauty', 'dateStamp', 'allowLibrary', 'paused', 'approval', 'guestGallery', 'allowReports', 'enhance', 'guestbook']) settings[k] = fd.get(k) === 'on';
    const payload = { e: eventId, k: key, settings };
    const pin = String(fd.get('pin') || '').trim();
    if (fd.get('clearPin') === 'on') payload.pin = '';
    else if (pin) payload.pin = pin;
    try {
      ev = (await api(studio, 'hostUpdate', payload)).event;
      setAccent(ev.accent);
      toast('Settings saved', 'ok');
      render();
      tab = 'settings'; renderTabs(); renderTab();
    } catch (err) { toast(err.message, 'error'); }
  });
  bodyEl.append(form);
}

// ------------------------------------------------------------------ keepsakes (Koinos)
function keepsakesTab() {
  const enabled = !!(config.koinos && config.koinos.contract);
  bodyEl.append(h('div', { class: 'stack narrow' },
    h('h2', null, 'Keep this album on Koinos'),
    h('p', null, 'Save a screen-quality copy of every photo, plus a fingerprint of the originals, on the Koinos blockchain. It stays recoverable even if the Drive folder is lost, and anyone can check that a photo is an untouched original.'),
    h('p', null, 'Each photo costs about 25 mana. Mana comes back on its own, so there’s nothing to pay.'),
    enabled
      ? h('a', { class: 'btn primary', href: key.startsWith('admin:') ? link('archive.html', { e: eventId, s: studio, extra: { admin: '1' } }) : link('archive.html', { e: eventId, s: studio, frag: { k: key } }), rel: 'noopener' }, 'Open the archive tool')
      : h('p', { class: 'callout' }, 'Koinos isn’t configured for this site yet. Add the contract address to config.js (see docs/KOINOS.md).')));
}

// ------------------------------------------------------------------ access
function securityTab() {
  const remembered = !!store.get(keyName());
  bodyEl.append(h('div', { class: 'stack narrow' },
    h('h2', null, 'Who can manage this event'),
    h('p', null, 'Anyone with the host link can moderate, change settings and download originals. Share it only with people you trust, like your planner or a co-host.'),
    key.startsWith('admin:') ? h('p', { class: 'muted' }, 'You opened this dashboard from the studio admin page, using your admin key.') : h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: remembered, onchange: (e) => { if (e.target.checked) store.set(keyName(), key); else store.del(keyName()); toast(e.target.checked ? 'This device will stay signed in' : 'You’ll need the host link next time'); } }),
      h('span', null, 'Remember me on this device', h('small', null, 'Leave off on shared computers.'))),
    h('hr', { class: 'divider' }),
    h('h3', null, 'Make a new host link'),
    h('p', null, 'Turns off the old host link and the TV wall link immediately. Use it if a link was shared by mistake.'),
    h('button', { class: 'btn danger', onclick: rotate }, 'Make a new host link')));
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
