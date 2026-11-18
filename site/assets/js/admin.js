// Studio admin: create events, hand out host links, delete events.
import { $, h, clear, toast, store, link, copy, fmtDate, fmtWhen, localInputToIso, frameGuard, config, params, myStudios, studioOfDeployment, ownStudio } from './util.js';
import { api, ping, BACKEND_VERSION } from './api.js';
import { copyBackendCode } from './backend-code.js';
import { cloudLogin, cloudBanner, drivePanel, ownerPanel, cloudKeyScreen, planPanel, partnerPanel, partnersPanel, CLOUD } from './cloud-admin.js';

frameGuard();
const root = $('#app');
// Studios this device may sign in to: the site's own (config.js) and ones set up on this device.
// A studio named in a link is used only if it's already on that list, so a link can never steer
// you into typing your admin key into someone else's backend.
const studios = [...myStudios.list().map((x) => x.id), ...Object.keys(config.backends || {})];
const studioName = (id) => (myStudios.list().find((x) => x.id === id) || {}).name || (id === Object.keys(config.backends || {})[0] ? 'Main' : id);
let studio = studios[0];
let foreignLink = false;
{
  const { q } = params();
  const wanted = q.get('b') ? studioOfDeployment(q.get('b')) : q.get('s');
  if (wanted && studios.includes(wanted)) studio = wanted;
  else if (wanted) foreignLink = true;
}
let adminKey = '';
let me = { name: '', role: '' };
const KEY = () => `ps:ak:${studio}`;

function login(msg) {
  if (CLOUD) return cloudLogin({ root, msg, onKey: signedIn });
  const keyIn = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'ak' });
  const studioSel = studios.length > 1 ? h('select', { id: 'studio' }, studios.map((s) => h('option', { value: s, selected: s === studio }, studioName(s)))) : null;
  const form = h('form', { class: 'narrow section stack' },
    h('h1', null, 'Studio sign-in'),
    foreignLink ? h('p', { class: 'callout warn' }, 'That link points to an Afterflash that isn’t set up on this device, so it was ignored. Only sign in to an Afterflash you set up yourself.') : null,
    h('p', null, 'Use your admin key.'),
    studioSel ? h('label', { class: 'field' }, h('span', null, 'Studio'), studioSel) : null,
    h('label', { class: 'field' }, h('span', null, 'Admin key'), keyIn),
    msg ? h('p', { class: 'callout warn', role: 'alert' }, msg) : null,
    h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
    h('p', { class: 'small muted', id: 'health', 'aria-live': 'polite' }, 'Checking the backend connection…'),
    h('p', { class: 'small' }, 'Want to host events with your own Google Drive? ', h('a', { href: 'setup.html' }, 'Set up your own Afterflash'), '.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (studioSel) studio = studioSel.value;
    adminKey = keyIn.value.trim();
    try {
      { const c = await api(studio, 'adminCheck', { k: adminKey }, { retries: 0 }); me = { ...(c.me || me), version: c.version }; }
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
    if (el) el.textContent = r.ok ? `Backend connected (version ${r.version}).${r.ready ? '' : ' It isn’t set up yet: finish on the setup page.'}` : r.message;
  };
  check();
  if (studioSel) studioSel.addEventListener('change', () => { studio = studioSel.value; check(); });
}

/** Cloud: a key was just bought, recovered or typed in. */
async function signedIn(key, { show = false } = {}) {
  adminKey = key;
  store.set(KEY(), adminKey, sessionStorage);
  try { const c = await api(studio, 'adminCheck', { k: adminKey }, { retries: 0 }); me = { ...(c.me || me), version: c.version }; }
  catch (err) { store.del(KEY(), sessionStorage); return login(err.code === 'unauthorized' ? 'That admin key isn’t right.' : err.message); }
  if (show) return cloudKeyScreen({ root, key, onContinue: () => dashboard() });
  dashboard();
}

async function dashboard(created) {
  clear(root).append(h('p', { class: 'muted' }, 'Loading events…'));
  let events = [];
  try { events = (await api(studio, 'adminList', { k: adminKey })).events; } catch (e) {
    if (e.code === 'unauthorized') { store.del(KEY(), sessionStorage); return login('Please sign in again.'); }
    if (e.code !== 'plan_expired') toast(e.message, 'error');
  }
  if (!me.role || CLOUD) { try { const c = await api(studio, 'adminCheck', { k: adminKey }); me = { ...(c.me || me), version: c.version }; } catch { /* handled below */ } }
  const needsDrive = CLOUD && !me.drive;
  const ended = CLOUD && me.expired;
  clear(root).append(
    h('div', { class: 'row spread' }, h('h1', null, 'Events'),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, me.name ? `Signed in as ${me.name}` : ''), h('button', { class: 'btn small', onclick: signOut }, 'Sign out'))),
    CLOUD ? cloudBanner() : null,
    CLOUD ? planPanel({ studio, adminKey, me }) : null,
    CLOUD ? partnerPanel({ studio, adminKey, me }) : null,
    CLOUD && !ended ? drivePanel({ studio, adminKey, me }) : null,
    created ? createdPanel(created) : null,
    needsDrive || ended ? null : createForm(),
    h('h2', { class: 'section' }, `Your events (${events.length})`),
    events.length ? h('table', { class: 'list' },
      h('thead', null, h('tr', null, h('th', null, 'Event'), h('th', null, 'Date'), h('th', null, 'Created'), h('th', null, ''))),
      h('tbody', null, events.map((ev) => h('tr', null,
        h('td', null, h('b', null, ev.name), h('div', { class: 'small muted' }, ev.id)),
        h('td', null, fmtDate(ev.date)),
        h('td', null, fmtWhen(ev.createdAt), h('div', { class: 'small muted' }, ev.createdBy ? `by ${ev.createdBy}` : '')),
        h('td', null, h('div', { class: 'row' },
          ev.canManage !== false ? h('a', { class: 'btn small primary', href: link('host.html', { e: ev.id, s: studio, extra: { admin: '1' } }) }, 'Open dashboard') : null,
          me.role === 'owner' || CLOUD ? h('a', { class: 'btn small', href: ev.folderUrl, target: '_blank', rel: 'noopener' }, 'Drive folder') : null,
          ev.canManage !== false ? h('button', { class: 'btn small', onclick: () => newHostLink(ev) }, 'New host link') : null,
          ev.canManage !== false ? h('button', { class: 'btn small danger', onclick: () => del(ev) }, 'Delete') : null)))))) : h('p', { class: 'empty' }, 'No events yet. Create your first one above.'),
    !CLOUD && me.version && me.version !== BACKEND_VERSION && me.role === 'owner' ? updatePanel(me.version) : null,
    problemsPanel(),
    !CLOUD && me.role === 'owner' ? adminsPanel() : null,
    CLOUD && me.role === 'owner' ? ownerPanel({ studio, adminKey }) : null,
    CLOUD && me.role === 'owner' ? partnersPanel({ studio, adminKey }) : null,
    me.role === 'owner' || CLOUD ? keyBackupPanel() : null);
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
    h('label', { class: 'check' }, h('input', { name: 'encrypted', type: 'checkbox' }),
      h('span', null, h('strong', null, 'Private storage'), ' (locks the files in Google Drive so only this app can open them, even for people who can see the Drive folder. Can’t be changed later. Leave off for normal events.)')),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Create event'), h('span', { class: 'small muted' }, 'You can change everything later from the host dashboard.')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'Creating…';
    const settings = { name: fd.get('name'), date: fd.get('date'), maxGuests: Number(fd.get('maxGuests')), shotsPerGuest: Number(fd.get('shotsPerGuest')), reveal: fd.get('reveal'), closesAt: localInputToIso(fd.get('closesAt')), encrypted: fd.get('encrypted') === 'on' };
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

// ---------------------------------------------------------------- recent problems
function problemsPanel() {
  const panel = h('section', { class: 'panel stack section', hidden: true });
  (async () => {
    try {
      const { problems } = await api(studio, 'adminProblems', { k: adminKey });
      if (!problems.length) return;
      clear(panel).append(
        h('h2', null, 'Recent problems'),
        h('p', { class: 'muted' }, 'Things the backend noticed going wrong. Photos are kept safe; this helps find the cause.'),
        h('table', { class: 'list' }, h('tbody', null, problems.slice(0, 20).map((p) => h('tr', null,
          h('td', { class: 'small' }, fmtWhen(p.t)), h('td', { class: 'small muted' }, p.e || ''), h('td', null, p.m))))),
        me.role === 'owner' ? h('button', { class: 'btn small', onclick: async () => { await api(studio, 'adminClearProblems', { k: adminKey }); panel.hidden = true; } }, 'Clear list') : null);
      panel.hidden = false;
    } catch { /* older backend */ }
  })();
  return panel;
}

// ---------------------------------------------------------------- admins (owner only)
function keyBackupPanel() {
  return h('section', { class: 'panel stack section' }, h('h2', null, 'Private event keys'),
    h('p', null, CLOUD ? 'Private events are locked with a key that Afterflash keeps for you. Download a backup after creating a private event and keep it somewhere safe and offline. With it, you can always unlock those files, even without Afterflash.' : 'Private events are locked with a key kept by your backend. Download a backup after creating a private event and store it somewhere safe and offline (for example a USB stick). Without it, the locked files in Drive can’t be opened if the backend is ever deleted.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: async () => {
      try {
        const r = await api(studio, 'adminExportKeys', { k: adminKey });
        const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' });
        h('a', { href: URL.createObjectURL(blob), download: `photoshare-private-keys-${new Date().toISOString().slice(0, 10)}.json` }).click();
        toast('Key backup downloaded. Keep it private.', 'ok');
      } catch (e) { toast(e.message, 'error'); }
    } }, 'Download key backup'),
    CLOUD ? null : h('label', { class: 'btn' }, 'Restore from backup', h('input', { type: 'file', accept: 'application/json,.json', class: 'hidden', onchange: async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file || file.size > 1024 * 1024) return toast('Choose the key backup file you downloaded.', 'error');
      try {
        const data = JSON.parse(await file.text());
        const r = await api(studio, 'adminImportKeys', { k: adminKey, keys: data && data.keys });
        toast(r.restored ? `Restored ${r.restored} event key(s).` : 'Nothing to restore: every private event already has its key.', 'ok');
      } catch (err) { toast(err instanceof SyntaxError ? 'That file isn’t a key backup.' : err.message, 'error'); }
    } }))));
}

function adminsPanel() {
  const panel = h('section', { class: 'panel stack section' }, h('h2', null, 'Studio admins'),
    h('p', null, 'Give each person their own admin key so you can remove one without affecting anyone else. Admins can create events and manage the ones they created. Only you can add or remove admins.'));
  const listEl = h('div', null, h('p', { class: 'muted' }, 'Loading…'));
  const nameIn = h('input', { type: 'text', maxlength: 40, placeholder: 'Their name', required: true });
  const form = h('form', { class: 'row' }, nameIn, h('button', { class: 'btn primary', type: 'submit' }, 'Create admin key'));
  const result = h('div');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(studio, 'adminAddAdmin', { k: adminKey, name: nameIn.value.trim() });
      nameIn.value = '';
      clear(result).append(h('div', { class: 'panel stack' },
        h('h3', null, `Admin key for ${r.admin.name}`),
        h('p', null, 'Send this privately (a password manager share, or tell them in person). It’s shown once. They sign in on this page with it.'),
        h('div', { class: 'keybox' }, r.key),
        h('button', { class: 'btn', onclick: () => copy(r.key) }, 'Copy key')));
      loadAdmins();
    } catch (err) { toast(err.message, 'error'); }
  });
  async function loadAdmins() {
    try {
      const { admins } = await api(studio, 'adminListAdmins', { k: adminKey });
      clear(listEl).append(admins.length ? h('table', { class: 'list' },
        h('tbody', null, admins.map((a) => h('tr', null, h('td', null, h('b', null, a.name)), h('td', null, `added ${fmtWhen(a.createdAt)}`),
          h('td', null, h('button', { class: 'btn small danger', onclick: () => removeAdmin(a) }, 'Remove')))))) : h('p', { class: 'muted' }, 'No other admins yet.'));
    } catch (err) { clear(listEl).append(h('p', null, err.message)); }
  }
  async function removeAdmin(a) {
    if (!confirm(`Remove ${a.name}? Their key stops working immediately. Events they created stay.`)) return;
    try { await api(studio, 'adminRemoveAdmin', { k: adminKey, id: a.id }); toast('Admin removed', 'ok'); loadAdmins(); } catch (err) { toast(err.message, 'error'); }
  }
  loadAdmins();
  panel.append(listEl, form, result);
  return panel;
}

/** Shown when this studio's backend is older than the website. */
function updatePanel(have) {
  return h('section', { class: 'panel stack section callout' },
    h('h2', null, 'Update your Afterflash backend'),
    h('p', null, `Your backend is version ${have}; this website expects ${BACKEND_VERSION}. Takes a minute:`),
    h('ol', null,
      h('li', null, h('button', { class: 'btn small', onclick: (e) => copyBackendCode(e.currentTarget) }, 'Copy the new code')),
      h('li', null, 'Open ', h('a', { href: 'https://script.google.com/home', target: '_blank', rel: 'noopener' }, 'script.google.com'), ' → your Afterflash project → Code.gs. Select all, paste, save (Ctrl+S).'),
      h('li', null, 'Deploy → Manage deployments → pencil icon → Version: New version → Deploy.')),
    h('p', { class: 'small muted' }, 'Your web address, events and photos stay the same.'));
}

function signOut() { store.del(KEY(), sessionStorage); adminKey = ''; me = { name: '', role: '' }; login(); }

adminKey = store.get(KEY(), sessionStorage) || '';
if (CLOUD && location.hash.startsWith('#recover=')) {
  // Back from "Lost your key? Sign in with Google": swap the one-time ticket for a new key.
  const ticket = decodeURIComponent(location.hash.slice(9));
  history.replaceState(null, '', location.pathname);
  api(studio, 'recoverFinish', { ticket }, { retries: 0 }).then((r) => signedIn(r.adminKey, { show: true })).catch((e) => login(e.message));
} else if (adminKey) dashboard(); else login();
