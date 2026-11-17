// Studio admin: create events, hand out host links, delete events.
import { $, h, clear, toast, store, link, copy, fmtDate, fmtWhen, localInputToIso, frameGuard, config } from './util.js';
import { api, ping } from './api.js';

frameGuard();
const root = $('#app');
const studios = Object.keys(config.backends || {});
let studio = studios[0];
let adminKey = '';
const KEY = () => `ps:ak:${studio}`;

function login(msg) {
  const keyIn = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'ak' });
  const studioSel = studios.length > 1 ? h('select', { id: 'studio' }, studios.map((s) => h('option', { value: s, selected: s === studio }, s))) : null;
  const form = h('form', { class: 'narrow section stack' },
    h('h1', null, 'Studio sign-in'),
    h('p', null, 'Use the admin key printed when you ran setup() in Google Apps Script.'),
    studioSel ? h('label', { class: 'field' }, h('span', null, 'Studio'), studioSel) : null,
    h('label', { class: 'field' }, h('span', null, 'Admin key'), keyIn),
    msg ? h('p', { class: 'callout warn', role: 'alert' }, msg) : null,
    h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
    h('p', { class: 'small muted', id: 'health', 'aria-live': 'polite' }, 'Checking the backend connection…'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (studioSel) studio = studioSel.value;
    adminKey = keyIn.value.trim();
    try {
      await api(studio, 'adminCheck', { k: adminKey }, { retries: 0 });
      store.set(KEY(), adminKey, sessionStorage);
      dashboard();
    } catch (err) {
      login(err.code === 'unauthorized' ? 'That admin key isn’t right.' : err.message);
    }
  });
  clear(root).append(form);
  keyIn.focus();
  const check = async () => {
    const r = await ping(studio);
    const el = document.getElementById('health');
    if (el) el.textContent = r.ok ? `Backend connected (version ${r.version}).` : r.message;
  };
  check();
  if (studioSel) studioSel.addEventListener('change', () => { studio = studioSel.value; check(); });
}

async function dashboard(created) {
  clear(root).append(h('p', { class: 'muted' }, 'Loading events…'));
  let events = [];
  try { events = (await api(studio, 'adminList', { k: adminKey })).events; } catch (e) {
    if (e.code === 'unauthorized') { store.del(KEY(), sessionStorage); return login('Please sign in again.'); }
    toast(e.message, 'error');
  }
  clear(root).append(
    h('div', { class: 'row spread' }, h('h1', null, 'Events'), h('button', { class: 'btn small', onclick: signOut }, 'Sign out')),
    created ? createdPanel(created) : null,
    createForm(),
    h('h2', { class: 'section' }, `Your events (${events.length})`),
    events.length ? h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Event'), h('th', null, 'Date'), h('th', null, 'Created'), h('th', null, ''))),
      h('tbody', null, events.map((ev) => h('tr', null,
        h('td', null, h('b', null, ev.name), h('div', { class: 'small muted' }, ev.id)),
        h('td', null, fmtDate(ev.date)),
        h('td', null, fmtWhen(ev.createdAt)),
        h('td', null, h('div', { class: 'row' },
          h('a', { class: 'btn small', href: ev.folderUrl, target: '_blank', rel: 'noopener' }, 'Drive folder'),
          h('button', { class: 'btn small', onclick: () => newHostLink(ev) }, 'New host link'),
          h('button', { class: 'btn small danger', onclick: () => del(ev) }, 'Delete'))))))) : h('p', { class: 'empty' }, 'No events yet. Create your first one above.'));
}

function createdPanel({ id, hostKey, name }) {
  const hostUrl = link('host.html', { e: id, s: studio, frag: { k: hostKey } });
  const guestUrl = link('cam.html', { e: id, s: studio });
  return h('div', { class: 'panel stack' },
    h('h2', null, `${name} is ready`),
    h('p', null, 'Save the host link now. It’s the key to this event and won’t be shown again. Hand it to the couple or co-host if they’ll moderate.'),
    h('div', { class: 'keybox' }, hostUrl),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => copy(hostUrl) }, 'Copy host link'), h('a', { class: 'btn', href: hostUrl, target: '_blank', rel: 'noopener' }, 'Open dashboard')),
    h('p', { class: 'small muted' }, 'Guest link: ', guestUrl));
}

function createForm() {
  const form = h('form', { class: 'panel stack' },
    h('h2', null, 'New event'),
    h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'Event name'), h('input', { name: 'name', type: 'text', maxlength: 80, required: true, placeholder: 'Sam & Alex’s wedding' })),
      h('label', { class: 'field' }, h('span', null, 'Date'), h('input', { name: 'date', type: 'date' })),
      h('label', { class: 'field' }, h('span', null, 'Expected guests'), h('input', { name: 'maxGuests', type: 'number', min: 1, max: 5000, value: 150 })),
      h('label', { class: 'field' }, h('span', null, 'Shots per guest'), h('input', { name: 'shotsPerGuest', type: 'number', min: 1, max: 500, value: 25 })),
      h('label', { class: 'field' }, h('span', null, 'Photo reveal'), h('select', { name: 'reveal' }, h('option', { value: 'live' }, 'Live'), h('option', { value: 'after' }, 'Develop later'))),
      h('label', { class: 'field' }, h('span', null, 'Album closes'), h('input', { name: 'closesAt', type: 'datetime-local' }))),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Create event'), h('span', { class: 'small muted' }, 'You can change everything later from the host dashboard.')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating…';
    const settings = { name: fd.get('name'), date: fd.get('date'), maxGuests: Number(fd.get('maxGuests')), shotsPerGuest: Number(fd.get('shotsPerGuest')), reveal: fd.get('reveal'), closesAt: localInputToIso(fd.get('closesAt')) };
    try {
      const r = await api(studio, 'adminCreate', { k: adminKey, settings }, { retries: 0, timeout: 90000 });
      dashboard({ id: r.id, hostKey: r.hostKey, name: settings.name });
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false; btn.textContent = 'Create event';
    }
  });
  return form;
}

async function newHostLink(ev) {
  if (!confirm(`Make a new host link for “${ev.name}”? The old host link and TV wall link stop working.`)) return;
  try {
    const r = await api(studio, 'adminHostLink', { k: adminKey, e: ev.id });
    dashboard({ id: ev.id, hostKey: r.hostKey, name: ev.name });
  } catch (e) { toast(e.message, 'error'); }
}

async function del(ev) {
  const typed = prompt(`This moves “${ev.name}” and all its photos to your Drive trash (recoverable for 30 days). Type the event code ${ev.id} to confirm.`);
  if (typed == null) return;
  if (typed.trim() !== ev.id) { toast('The code didn’t match. Nothing was deleted.'); return; }
  try { await api(studio, 'adminDelete', { k: adminKey, e: ev.id, confirm: ev.id }); toast('Event deleted', 'ok'); dashboard(); } catch (e) { toast(e.message, 'error'); }
}

function signOut() { store.del(KEY(), sessionStorage); adminKey = ''; login(); }

adminKey = store.get(KEY(), sessionStorage) || '';
if (adminKey) dashboard(); else login();
