// Set up your own Afterflash: photos go to YOUR Google Drive, run by a copy of the backend in
// YOUR Google account. Nobody else (including whoever shared this site) can see them or pays for them.
import { $, h, clear, toast, frameGuard, copy, link, myStudios, studioOfDeployment, store } from './util.js';
import { api, ping, BACKEND_VERSION } from './api.js';
import { copyBackendCode, deploymentFromUrl } from './backend-code.js';

frameGuard();
const root = $('#app');

function step(title, ...body) {
  return h('li', { class: 'setup-step' }, h('h3', null, title), ...body);
}

function render(msg) {
  const urlIn = h('input', { type: 'url', id: 'exec-url', placeholder: 'https://script.google.com/macros/s/…/exec', autocomplete: 'off', spellcheck: 'false', required: true });
  const nameIn = h('input', { type: 'text', id: 'studio-name', maxlength: 40, placeholder: 'e.g. Jordan’s parties', value: 'My Afterflash' });
  const go = h('button', { class: 'btn primary', type: 'submit' }, 'Connect');
  const form = h('form', { class: 'stack' }, h('label', { class: 'field' }, h('span', null, 'Web app URL'), urlIn),
    h('label', { class: 'field' }, h('span', null, 'Name (only you see this)'), nameIn),
    msg ? h('p', { class: 'callout warn', role: 'alert' }, msg) : null, go);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = deploymentFromUrl(urlIn.value);
    if (d.error === 'workspace') return render('That’s a Google Workspace (work or school) address. Use a personal Gmail account instead: work accounts usually block “Anyone” access.');
    if (d.error) return render('That doesn’t look like the Web app URL. It starts with https://script.google.com/macros/s/ and ends with /exec.');
    if (d.dev) return render('That’s the test URL (ending in /dev). Use the Web app URL ending in /exec from the Deploy screen.');
    go.disabled = true; go.textContent = 'Connecting…';
    const studio = studioOfDeployment(d.id);
    const health = await ping(studio);
    if (!health.ok) return render(health.message + ' Check “Who has access” is set to “Anyone”, then try again.');
    try {
      const r = await api(studio, 'claim', {}, { retries: 0, timeout: 90000 });
      myStudios.add(studio, nameIn.value.trim() || 'My Afterflash');
      store.set(`ps:ak:${studio}`, r.adminKey, sessionStorage);
      done(studio, r.adminKey);
    } catch (err) {
      if (err.code === 'already_set_up') {
        myStudios.add(studio, nameIn.value.trim() || 'My Afterflash');
        location.href = link('admin.html', { s: studio });
        return;
      }
      render(err.code === 'unknown' || /Unknown action/.test(err.message) ? 'That backend is an older version. Paste the latest code (step 2), deploy a new version, and try again.' : err.message);
    }
  });

  clear(root).append(
    h('h1', null, 'Host your own events'),
    h('p', { class: 'lede' }, 'About 5 minutes, free. Photos go to your own Google Drive (15 GB free), and only you control them.'),
    h('ol', { class: 'setup-steps' },
      step('Sign in to Google',
        h('p', null, 'Use a personal Gmail account (not work or school). A separate account just for events is a good idea.')),
      step('Copy the Afterflash code',
        h('p', null, h('button', { class: 'btn', type: 'button', onclick: (e) => copyBackendCode(e.currentTarget) }, 'Copy the code'))),
      step('Paste it into a new Apps Script project',
        h('p', null, 'Open ', h('a', { href: 'https://script.google.com/create', target: '_blank', rel: 'noopener' }, 'script.google.com/create'), '. Select everything in the editor (Ctrl+A, or Cmd+A on a Mac), paste (Ctrl+V), then press Ctrl+S to save. Name the project “Afterflash” when asked.')),
      step('Publish it',
        h('p', null, 'Click the blue ', h('b', null, 'Deploy'), ' button → ', h('b', null, 'New deployment'), '. Click the gear icon next to “Select type” → ', h('b', null, 'Web app'), '.'),
        h('ul', null, h('li', null, h('b', null, 'Execute as: '), 'Me'), h('li', null, h('b', null, 'Who has access: '), 'Anyone')),
        h('p', null, 'Click ', h('b', null, 'Deploy'), ' → ', h('b', null, 'Authorize access'), ' → pick your account. Google shows “Google hasn’t verified this app”: that’s normal for your own script. Click ', h('b', null, 'Advanced'), ' → ', h('b', null, 'Go to Afterflash (unsafe)'), ' → ', h('b', null, 'Allow'), '.'),
        h('p', null, 'Copy the ', h('b', null, 'Web app URL'), ' it shows (ends in /exec).')),
      step('Connect it here', form)),
    h('p', { class: 'small muted' }, 'What the permissions are for: Afterflash creates a “Afterflash” folder and spreadsheets in your Drive to store each event. It runs as you, inside your account, and doesn’t send anything anywhere else.'));
}

function done(studio, adminKey) {
  clear(root).append(
    h('h1', null, 'You’re set up'),
    h('p', null, 'This is your admin key. It’s the password to your Afterflash. Save it in your password manager (or somewhere private) now. It won’t be shown again.'),
    h('div', { class: 'keybox' }, adminKey),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => copy(adminKey) }, 'Copy admin key'),
      h('a', { class: 'btn flash', href: link('admin.html', { s: studio }) }, 'Create your first event')),
    h('p', { class: 'small muted' }, `Backend version ${BACKEND_VERSION}. You’ll find your Afterflash under “Your Afterflash” on the home page of this device.`));
}

render();
