// Host dashboard: share, moderate, guests, settings.
import {
  $, h, clear, toast, params, studioFrom, isEventId, isDriveId, store, setAccent, setTitle, fmtDate, fmtWhen, fmtBytes,
  thumbUrl, link, qrSvg, copy, isoToLocalInput, localInputToIso, frameGuard, config, base64ToBytes,
} from './util.js';
import { api } from './api.js';
import { LOOKS } from './film.js';

frameGuard();
const root = $('#app');
const { q, f } = params();
let studio, eventId, key, ev, items = [], version = '', filter = 'all', selected = new Set(), tab = 'share', pollT;

const keyName = () => `ps:hk:${studio}:${eventId}`;

function fail(msg) {
  clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, 'Can’t open this dashboard'), h('p', null, msg)));
}

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('Unknown studio in link.'); }
  eventId = q.get('e');
  if (!isEventId(eventId)) return fail('This host link is missing its event code.');
  key = f.get('k') || store.get(keyName(), sessionStorage) || store.get(keyName());
  if (f.get('k')) {
    store.set(keyName(), key, sessionStorage);
    history.replaceState(null, '', location.pathname + location.search); // keep the key out of the address bar
  }
  if (!key) return fail('This link is missing its host key. Use the full host link you were given.');
  try {
    ev = (await api(studio, 'hostGet', { e: eventId, k: key })).event;
  } catch (e) {
    if (e.code === 'unauthorized') { store.del(keyName(), sessionStorage); store.del(keyName()); }
    return fail(e.code === 'unauthorized' ? 'This host link is no longer valid. Ask the studio for a new one.' : e.message);
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
  const c = { all: items.length, pending: 0, reported: 0, hidden: 0, video: 0 };
  for (const it of items) { if (c[it.s] != null) c[it.s]++; if (it.k === 'v') c.video++; }
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

const TABS = [['share', 'Share'], ['photos', 'Photos'], ['guests', 'Guests'], ['settings', 'Settings'], ['keepsakes', 'Keepsakes'], ['security', 'Access']];
function renderTabs() {
  const c = counts();
  clear(tabsEl).append(...TABS.map(([id, label]) => {
    const b = h('button', { role: 'tab', 'aria-selected': String(tab === id), onclick: () => { tab = id; renderTabs(); renderTab(); } }, label);
    if (id === 'photos' && c.pending + c.reported) b.append(h('span', { class: 'badge' }, String(c.pending + c.reported)));
    return b;
  }));
}

function renderTab() {
  const map = { share: shareTab, photos: photosTab, guests: guestsTab, settings: settingsTab, keepsakes: keepsakesTab, security: securityTab };
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
      linkRow('Guest link', guestUrl(), 'This is what the QR code opens. Share it in texts or on the invitation.'),
      linkRow('TV wall', wallUrl(), 'Open on a laptop or smart TV browser, then press Start the show. Safe to display: it has no host access.'),
      linkRow('Album', albumUrl(), ev.guestGallery ? 'Guests can browse here once photos are revealed.' : 'Guest browsing is off, so only you see the photos.'),
      h('p', null, h('a', { href: ev.folderUrl, target: '_blank', rel: 'noopener' }, 'Open the Google Drive folder'), ' to download every original at full resolution.'))));
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
const FILTERS = [['all', 'All'], ['pending', 'Waiting for approval'], ['reported', 'Reported'], ['hidden', 'Hidden'], ['video', 'Videos']];
function visibleItems() {
  if (filter === 'all') return items;
  if (filter === 'video') return items.filter((x) => x.k === 'v');
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
    h('button', { class: 'btn small danger', disabled: !selected.size, onclick: () => moderate('delete') }, 'Delete'));
  bodyEl.append(h('div', { class: 'mod-toolbar stack' }, h('div', { class: 'row' }, ...chips), actions));
  if (!list.length) { bodyEl.append(h('p', { class: 'empty' }, filter === 'all' ? 'No photos yet. Share the QR code to get started.' : 'Nothing here.')); return; }
  bodyEl.append(h('div', { class: 'mod-grid' }, list.map((it) => {
    const sel = selected.has(it.i);
    const label = { visible: 'Showing', pending: 'Needs approval', reported: `Reported${it.r > 1 ? ' ×' + it.r : ''}`, hidden: 'Hidden' }[it.s] || it.s;
    return h('div', { class: 'mod-item' + (sel ? ' selected' : '') },
      h('button', { class: 'pick', 'aria-pressed': String(sel), 'aria-label': 'Select photo', onclick: () => { sel ? selected.delete(it.i) : selected.add(it.i); renderTab(); } },
        hostThumb(it)),
      h('div', { class: 'meta' }, h('span', { class: 'state ' + it.s }, label), h('span', { class: 'muted' }, it.k === 'v' ? 'Video' : it.g)),
      h('div', { class: 'meta' }, h('a', { href: `https://drive.google.com/file/d/${encodeURIComponent(it.i)}/view`, target: '_blank', rel: 'noopener' }, 'View'), h('span', { class: 'muted' }, fmtWhen(it.c))));
  })));
}

// Photos that aren't public (pending, hidden, reported) can't load from Drive's public
// thumbnail URL, so fetch their preview through the authenticated API instead.
const privateThumbs = new Map();
let thumbQueue = Promise.resolve();
function hostThumb(it) {
  const img = h('img', { alt: '', loading: 'lazy' });
  if (it.s === 'visible') { img.src = thumbUrl(it.k === 'v' && it.t ? it.t : it.i, 400); return img; }
  if (privateThumbs.has(it.i)) { img.src = privateThumbs.get(it.i); return img; }
  thumbQueue = thumbQueue.then(async () => {
    try {
      const m = await api(studio, 'hostMedia', { e: eventId, k: key, id: it.i, which: 'thumb' }, { retries: 1 });
      if (!/^image\/(jpeg|png|webp)$/.test(m.mime)) return;
      const url = URL.createObjectURL(new Blob([base64ToBytes(m.data)], { type: m.mime }));
      privateThumbs.set(it.i, url);
      img.src = url;
    } catch { /* leave placeholder */ }
  });
  return img;
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
  const check = (name, label, help) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: !!s[name] }), h('span', null, label, help ? h('small', null, help) : null));
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
      check('dateStamp', 'Add a date stamp to photos'),
      check('allowLibrary', 'Allow uploads from the camera roll', 'Off keeps it a true disposable camera.')),
    h('fieldset', null, h('legend', null, 'Timing'), h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Photo reveal'), revealSel),
      h('label', { class: 'field' }, h('span', null, 'Reveal at'), inp('revealAt', { type: 'datetime-local', value: isoToLocalInput(s.revealAt) }), h('small', null, 'Only used for “develop later”. Blank means you reveal manually by switching to live.')),
      h('label', { class: 'field' }, h('span', null, 'Camera opens'), inp('opensAt', { type: 'datetime-local', value: isoToLocalInput(s.opensAt) })),
      h('label', { class: 'field' }, h('span', null, 'Album closes'), inp('closesAt', { type: 'datetime-local', value: isoToLocalInput(s.closesAt) }), h('small', null, 'The TV wall shows a last call 45 minutes before.'))),
      check('paused', 'Pause uploads now', 'Photos guests take are kept on their phones and upload when you resume.')),
    h('fieldset', null, h('legend', null, 'Safety and privacy'),
      check('approval', 'Approve photos before anyone sees them'),
      check('guestGallery', 'Let guests browse the album'),
      check('allowReports', 'Let guests report photos', 'A reported photo is hidden until you decide.'),
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
    for (const k of ['allowVideo', 'guestLooks', 'dateStamp', 'allowLibrary', 'paused', 'approval', 'guestGallery', 'allowReports']) settings[k] = fd.get(k) === 'on';
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
      ? h('a', { class: 'btn primary', href: link('archive.html', { e: eventId, s: studio, frag: { k: key } }), rel: 'noopener' }, 'Open the archive tool')
      : h('p', { class: 'callout' }, 'Koinos isn’t configured for this site yet. Add the contract address to config.js (see docs/KOINOS.md).')));
}

// ------------------------------------------------------------------ access
function securityTab() {
  const remembered = !!store.get(keyName());
  bodyEl.append(h('div', { class: 'stack narrow' },
    h('h2', null, 'Who can manage this event'),
    h('p', null, 'Anyone with the host link can moderate, change settings and download originals. Share it only with people you trust, like your planner or a co-host.'),
    h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: remembered, onchange: (e) => { if (e.target.checked) store.set(keyName(), key); else store.del(keyName()); toast(e.target.checked ? 'This device will stay signed in' : 'You’ll need the host link next time'); } }),
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
    ev = (await api(studio, 'hostGet', { e: eventId, k: key })).event;
    const url = link('host.html', { e: eventId, s: studio, frag: { k: key } });
    clear(bodyEl).append(h('div', { class: 'stack narrow' }, h('h2', null, 'New host link'), h('p', null, 'Save this somewhere safe. It won’t be shown again.'),
      h('div', { class: 'keybox' }, url), h('button', { class: 'btn', onclick: () => copy(url) }, 'Copy host link')));
  } catch (e) { toast(e.message, 'error'); }
}

boot();
