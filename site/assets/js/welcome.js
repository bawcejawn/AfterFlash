// After paying: swap the Stripe Checkout Session for an admin key, show it once, then go to the
// admin page to connect Google Drive and create the first event.
import { $, h, clear, copy, store, frameGuard, params } from './util.js';
import { api } from './api.js';

frameGuard();
const root = $('#app');
const { q } = params();
const sid = q.get('session_id') || '';

function fail(msg, retry) {
  clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, 'Almost there'), h('p', { class: 'callout warn' }, msg),
    retry ? h('button', { class: 'btn primary', onclick: claim }, 'Try again') : null,
    h('p', { class: 'small' }, 'Already set up? ', h('a', { href: 'admin.html' }, 'Sign in'), '.')));
}

async function claim() {
  clear(root).append(h('p', { class: 'narrow section muted' }, 'Setting up your account…'));
  try {
    const r = await api('main', 'claimPurchase', { session_id: sid }, { retries: 2 });
    history.replaceState(null, '', location.pathname); // keep the purchase id out of history
    if (r.renewed) return renewed(r);
    store.set('ps:ak:main', r.adminKey, sessionStorage);
    show(r);
  } catch (e) {
    if (e.code === 'not_paid') return fail(e.message, true);
    fail(e.message, e.code === 'network' || e.code === 'server_error');
  }
}

const until = (r) => (r.plan === 'lifetime' && !r.expires ? 'for life' : `${r.plan === 'event' ? 'for one event, ' : ''}until ${new Date(r.expires).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}`);

function renewed(r) {
  clear(root).append(h('div', { class: 'narrow section stack' },
    h('h1', null, 'Thank you! Your plan is extended'),
    h('p', null, `Your Afterflash now works ${until(r)}. Same admin key as before.`),
    r.email ? h('p', { class: 'muted' }, `Receipt sent to ${r.email}.`) : null,
    h('div', { class: 'row' }, h('a', { class: 'btn flash', href: 'admin.html' }, 'Back to my events'))));
}

function show(r) {
  const saved = h('input', { type: 'checkbox' });
  const go = h('a', { class: 'btn flash disabled', href: 'admin.html', 'aria-disabled': 'true' }, 'Continue: connect Google Drive');
  go.addEventListener('click', (e) => { if (!saved.checked) e.preventDefault(); });
  saved.addEventListener('change', () => { go.classList.toggle('disabled', !saved.checked); go.setAttribute('aria-disabled', String(!saved.checked)); });
  clear(root).append(h('div', { class: 'narrow section stack' },
    h('h1', null, 'Thank you! Here’s your admin key'),
    r.email ? h('p', { class: 'muted' }, `Receipt sent to ${r.email}.`) : null,
    r.plan ? h('p', null, h('b', null, `Your plan works ${until(r)}.`)) : null,
    h('p', null, 'This key is the password to your Afterflash. Save it in your password manager or notes now. It isn’t shown again (if you lose it, you can get a new one by signing in with Google).'),
    h('div', { class: 'keybox', id: 'admin-key' }, r.adminKey),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => copy(r.adminKey) }, 'Copy admin key')),
    h('label', { class: 'check' }, saved, h('span', null, 'I saved my admin key')),
    h('div', { class: 'row' }, go),
    h('h2', { class: 'section' }, 'What happens next'),
    h('ol', null,
      h('li', null, 'Connect your Google Drive (one click). That’s where every photo is saved.'),
      h('li', null, 'Create your event: name, date, how many shots each guest gets.'),
      h('li', null, 'Print the QR sign or put it on the TV. Guests scan and shoot.'))));
}

if (!/^cs_(test|live)_/.test(sid)) fail('This page needs the link from your checkout. If you’ve already paid, sign in with your admin key.', false);
else claim();
