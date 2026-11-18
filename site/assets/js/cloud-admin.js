// PhotoShare Cloud parts of the admin page: sign in with a bought admin key, "Lost your key?"
// via Google, connect Google Drive (where every photo is saved), storage meter, owner tools.
import { h, clear, toast, copy, fmtBytes, fmtWhen, config, params } from './util.js';
import { api } from './api.js';

export const CLOUD = !!config.cloud;
const STUDIO = 'main';

const DRIVE_MSG = {
  connected: ['ok', 'Google Drive connected. New photos will save there.'],
  noscope: ['warn', 'Google Drive wasn’t connected: on Google’s screen, tick the box that lets PhotoShare save files to your Drive, then try again.'],
  cancelled: ['warn', 'Google Drive wasn’t connected. You can try again any time.'],
  error: ['warn', 'Google didn’t finish connecting. Please try again.'],
  expired: ['warn', 'That connection link expired. Please try again.'],
};
const RECOVER_MSG = {
  unknown: 'That Google account isn’t connected to a PhotoShare account. Use the Google account you connected to PhotoShare (it’s shown on your admin page).',
  cancelled: 'Google sign-in was cancelled.',
  error: 'Google sign-in didn’t finish. Please try again.',
};

/** Messages from the Google round trip (?drive=… / ?recover=…), shown once. */
function takeFlash() {
  const { q } = params();
  const drive = q.get('drive'), recover = q.get('recover');
  if (drive || recover) history.replaceState(null, '', location.pathname);
  return { drive: DRIVE_MSG[drive] || null, recover: RECOVER_MSG[recover] || null };
}
const flash = takeFlash();

export function cloudLogin({ root, msg, onKey }) {
  const keyIn = h('input', { type: 'password', autocomplete: 'current-password', required: true, id: 'ak' });
  const err = msg || flash.recover;
  const form = h('form', { class: 'narrow section stack' },
    h('h1', null, 'Sign in'),
    h('p', null, 'Use the admin key you got after buying PhotoShare.'),
    h('label', { class: 'field' }, h('span', null, 'Admin key'), keyIn),
    err ? h('p', { class: 'callout warn', role: 'alert' }, err) : null,
    h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
    h('p', { class: 'small' }, 'Lost your key? ', h('button', { class: 'linkbtn', type: 'button', onclick: recover }, 'Sign in with Google'),
      ' (the Google account you connected) to get a new one.'),
    h('p', { class: 'small muted' }, 'Don’t have a key yet? ', h('a', { href: 'index.html#pricing' }, 'Get PhotoShare'), '.'));
  form.addEventListener('submit', (e) => { e.preventDefault(); onKey(keyIn.value.trim()); });
  clear(root).append(form);
  keyIn.focus();
}

async function recover() {
  try { location.href = safeGoogle((await api(STUDIO, 'recoverStart', {}, { retries: 0 })).url); }
  catch (e) { toast(e.message, 'error'); }
}
function safeGoogle(url) {
  if (!String(url).startsWith(location.origin + '/oauth/start?')) throw new Error('Unexpected sign-in address.');
  return url;
}

/** Shown once after a purchase or a key recovery. */
export function cloudKeyScreen({ root, key, onContinue }) {
  const saved = h('input', { type: 'checkbox' });
  const go = h('button', { class: 'btn flash', disabled: true, onclick: onContinue }, 'Continue');
  saved.addEventListener('change', () => { go.disabled = !saved.checked; });
  clear(root).append(h('div', { class: 'narrow section stack' },
    h('h1', null, 'Your admin key'),
    h('p', null, 'This is the password to your PhotoShare. Save it in your password manager or notes now: it isn’t shown again.'),
    h('div', { class: 'keybox' }, key),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => copy(key) }, 'Copy admin key')),
    h('label', { class: 'check' }, saved, h('span', null, 'I saved my admin key')),
    h('div', { class: 'row' }, go)));
}

export function cloudBanner() {
  if (!flash.drive) return null;
  const [kind, text] = flash.drive;
  flash.drive = null;
  return h('p', { class: 'callout' + (kind === 'warn' ? ' warn' : ''), role: 'status' }, text);
}

/** Where photos are saved: connect Google Drive, see how full it is, get more space from Google. */
export function drivePanel({ studio, adminKey, me }) {
  const connect = async (btn) => {
    btn.disabled = true;
    try { location.href = safeGoogle((await api(studio, 'oauthStart', { k: adminKey }, { retries: 0 })).url); }
    catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
  if (!me.drive) {
    return h('section', { class: 'panel stack drive-panel' },
      h('h2', null, 'Step 1: Connect your Google Drive'),
      h('p', null, 'Every photo, video and voice message your guests take is saved straight into your own Google Drive, in a “PhotoShare” folder. Google gives every account 15 GB free (about 4,000 photos).'),
      h('div', { class: 'row' }, h('button', { class: 'btn flash', onclick: (e) => connect(e.currentTarget) }, 'Connect Google Drive')),
      h('p', { class: 'small muted' }, 'PhotoShare can only see the files it creates for you, never anything else in your Drive.'),
      h('details', null, h('summary', null, 'No Google account? Make one in 2 minutes'),
        h('ol', null,
          h('li', null, 'Open ', h('a', { href: 'https://accounts.google.com/signup', target: '_blank', rel: 'noopener' }, 'accounts.google.com/signup'), '.'),
          h('li', null, 'Choose “For my personal use”, enter your name and pick a new Gmail address and password.'),
          h('li', null, 'Come back here and click “Connect Google Drive”.')),
        h('p', { class: 'small muted' }, 'Tip: a separate Google account just for events keeps your personal Drive tidy.')));
  }
  const meter = h('div', { class: 'meter', role: 'img', 'aria-label': 'Google Drive storage used' }, h('span'));
  const line = h('p', { class: 'small muted' }, 'Checking your storage…');
  const panel = h('section', { class: 'panel stack drive-panel' },
    h('div', { class: 'row spread' }, h('h2', null, 'Saving to Google Drive'), h('span', { class: 'small' }, me.googleEmail || '')),
    meter, line,
    h('div', { class: 'row' },
      h('a', { class: 'btn small', href: 'https://one.google.com/storage', target: '_blank', rel: 'noopener' }, 'Get more Google storage'),
      h('button', { class: 'btn small', onclick: (e) => connect(e.currentTarget) }, 'Use a different Google account')),
    h('details', null, h('summary', null, 'Running low on space?'),
      h('ul', null,
        h('li', null, 'Buy more space from Google (100 GB is a few dollars a month). PhotoShare keeps working with no changes.'),
        h('li', null, 'Or use a fresh free Google account: click “Use a different Google account”. New events save there; old events stay where they are.'),
        h('li', null, 'Or after an event: download the album (host dashboard → Share → Download all), then delete the event to free the space.'))));
  api(studio, 'driveStatus', { k: adminKey }).then((d) => {
    if (!d.connected) { line.textContent = 'Google Drive is disconnected. Reconnect it to keep saving photos.'; return; }
    const pct = d.limit ? Math.min(100, Math.round((d.used / d.limit) * 100)) : 0;
    meter.firstChild.style.width = pct + '%';
    meter.classList.toggle('full', pct >= 90);
    line.textContent = d.limit ? `${fmtBytes(d.used)} of ${fmtBytes(d.limit)} used (${pct}%). Roughly ${Math.max(0, Math.floor((d.limit - d.used) / (3.5 * 1024 * 1024))).toLocaleString()} more photos fit.` : 'Unlimited storage.';
  }).catch(() => { line.textContent = 'Couldn’t check storage right now.'; });
  return panel;
}

/** Site owner: free keys for friends and testers, all accounts at a glance. */
export function ownerPanel({ studio, adminKey }) {
  const list = h('div', null, h('p', { class: 'muted' }, 'Loading accounts…'));
  const note = h('input', { type: 'text', maxlength: 60, placeholder: 'Who it’s for (only you see this)' });
  const result = h('div');
  const make = h('form', { class: 'row' }, note, h('button', { class: 'btn primary', type: 'submit' }, 'Create a free key'));
  make.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(studio, 'ownerCreateAccount', { k: adminKey, note: note.value.trim() });
      note.value = '';
      clear(result).append(h('div', { class: 'panel stack' }, h('h3', null, 'Free admin key'),
        h('p', null, 'Send it privately. It works like a bought key and is shown once.'),
        h('div', { class: 'keybox' }, r.adminKey), h('button', { class: 'btn', onclick: () => copy(r.adminKey) }, 'Copy key')));
      load();
    } catch (err) { toast(err.message, 'error'); }
  });
  async function load() {
    try {
      const { accounts } = await api(studio, 'ownerAccounts', { k: adminKey });
      const paid = accounts.filter((a) => a.kind === 'paid').length;
      clear(list).append(
        h('p', null, `${accounts.length} accounts: ${paid} paid, ${accounts.length - paid} free.`),
        accounts.length ? h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, 'Account'), h('th', null, 'Type'), h('th', null, 'Drive'), h('th', null, 'Events'), h('th', null, 'Since'), h('th', null, ''))),
          h('tbody', null, accounts.map((a) => h('tr', null,
            h('td', null, h('b', null, a.email || a.note || a.id), h('div', { class: 'small muted' }, a.google_email || '')),
            h('td', null, a.kind), h('td', null, a.drive ? 'Connected' : 'Not yet'), h('td', null, String(a.events)), h('td', null, fmtWhen(a.created)),
            h('td', null, h('button', { class: 'btn small' + (a.status === 'active' ? ' danger' : ''), onclick: () => setStatus(a) }, a.status === 'active' ? 'Turn off' : 'Turn on')))))) : null);
    } catch (err) { clear(list).append(h('p', null, err.message)); }
  }
  async function setStatus(a) {
    const off = a.status === 'active';
    if (off && !confirm(`Turn off ${a.email || a.note || a.id}? Their admin key stops working and guests can’t upload until you turn it back on.`)) return;
    try { await api(studio, 'ownerSetStatus', { k: adminKey, id: a.id, status: off ? 'disabled' : 'active' }); load(); } catch (err) { toast(err.message, 'error'); }
  }
  load();
  return h('section', { class: 'panel stack section' }, h('h2', null, 'Owner: accounts'), make, result, list);
}
