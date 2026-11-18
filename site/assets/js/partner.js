// Joining a partner's team from an invite link (partner.html#invite=…). The invite token stays in
// the address bar's #fragment, so it's never sent to any server except in the API call itself.
import { $, h, clear, copy, store, frameGuard, config } from './util.js';
import { api } from './api.js';

frameGuard();
const root = $('#app');
const token = (/(?:^#|&)invite=([A-Za-z0-9_-]{20,80})/.exec(location.hash) || [])[1] || '';
const biz = (config.cloud && config.cloud.business) || config.appName || 'Afterflash';
const usd = (c) => '$' + (c / 100).toFixed(2);

function fail(msg) {
  clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, 'Invite link'), h('p', { class: 'callout warn' }, msg),
    h('p', { class: 'small' }, 'Already a partner? ', h('a', { href: 'admin.html' }, 'Sign in'), '.')));
}

/** The plain-English partner agreement (also in docs/PARTNERS.md). */
function agreement(i) {
  return h('ol', { class: 'agreement small' },
    h('li', null, `You’re an independent contractor, not an employee or agent of ${biz}. You pay your own taxes. Before your first payout we may ask for a W-9.`),
    h('li', null, `Your code gives buyers ${i.discount}% off. You earn ${i.commission}% of what each buyer actually pays with your code, including their later purchases with the same key.`),
    i.canRecruit ? h('li', null, `You can invite partners to your team. When someone on your team (up to 2 levels below you) makes a sale, a ${i.override}% team bonus is split evenly among the partners above the seller. Inviting people earns nothing by itself: money only comes from real customers’ purchases.`) : h('li', null, `When you make a sale, a ${i.override}% team bonus goes to the partners above you. It doesn’t come out of your share.`),
    h('li', null, 'Joining is free. You never have to buy anything, and purchases by partners (yours or your team’s) don’t earn anyone a commission.'),
    h('li', null, `Earnings can be paid once ${usd(i.minPayout)} is ready (sales more than 14 days old). Request a payout on your partner page; we pay by your chosen method. Sales reversed by a chargeback don’t earn.`),
    h('li', null, 'Say you earn a commission whenever you share your link or code (for example, “I get a small commission if you use my code”). This is a legal requirement (FTC Endorsement Guides).'),
    h('li', null, 'Don’t promise earnings or income to anyone you invite, and don’t make claims we don’t (for example, “free storage” or “lifetime access”). No spam, no fake reviews, no coupon sites, no ads that bid on our name.'),
    h('li', null, 'Either of us can end this at any time. We’ll pay what you’ve earned up to that day. We may change the rates with 30 days’ notice.'));
}

async function start() {
  if (!token) return fail('This page needs the invite link a partner sent you. Ask them for a new one.');
  clear(root).append(h('p', { class: 'narrow section muted' }, 'Checking your invite…'));
  let info;
  try { info = await api('main', 'partnerInviteInfo', { invite: token }, { retries: 1 }); }
  catch (e) { return fail(e.message); }
  const name = h('input', { type: 'text', maxlength: 60, required: true, autocomplete: 'name' });
  const email = h('input', { type: 'email', maxlength: 120, required: true, autocomplete: 'email' });
  const agree = h('input', { type: 'checkbox', required: true });
  const msg = h('p', { class: 'small', role: 'alert' });
  const btn = h('button', { class: 'btn flash', type: 'submit' }, 'Join as a partner');
  const form = h('form', { class: 'stack' },
    h('label', null, 'Your name', name), h('label', null, 'Your email (for payout questions)', email),
    h('h2', null, 'Partner agreement'), agreement(info),
    h('label', { class: 'check' }, agree, h('span', null, 'I’ve read and agree to the partner agreement')), btn, msg);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; msg.textContent = '';
    try {
      const r = await api('main', 'partnerJoin', { invite: token, name: name.value.trim(), email: email.value.trim(), agree: agree.checked });
      history.replaceState(null, '', location.pathname); // the invite is used up; drop it from the address bar
      store.set('ps:ak:main', r.adminKey, sessionStorage);
      done(r);
    } catch (err) { msg.textContent = err.message; btn.disabled = false; }
  });
  clear(root).append(h('div', { class: 'narrow section stack' },
    h('h1', null, `${info.inviter} invited you to be a ${biz} partner`),
    h('p', null, `Share your own code or link. Buyers get ${info.discount}% off, and you earn ${info.commission}% of every sale made with it. Joining is free.`),
    form));
}

function done(r) {
  const saved = h('input', { type: 'checkbox' });
  const go = h('a', { class: 'btn flash disabled', href: 'admin.html', 'aria-disabled': 'true' }, 'Open my partner page');
  go.addEventListener('click', (e) => { if (!saved.checked) e.preventDefault(); });
  saved.addEventListener('change', () => { go.classList.toggle('disabled', !saved.checked); go.setAttribute('aria-disabled', String(!saved.checked)); });
  clear(root).append(h('div', { class: 'narrow section stack' },
    h('h1', null, 'Welcome! Here’s your partner key'),
    h('p', null, 'This key is how you sign in to see your sales and request payouts. Save it in your password manager or notes now. It isn’t shown again.'),
    h('div', { class: 'keybox', id: 'admin-key' }, r.adminKey),
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => copy(r.adminKey) }, 'Copy key')),
    h('p', null, 'Your code: ', h('b', null, r.code), '. Your link:'),
    h('div', { class: 'row' }, h('span', { class: 'keybox partner-link' }, r.link), h('button', { class: 'btn small', onclick: () => copy(r.link) }, 'Copy link')),
    h('label', { class: 'check' }, saved, h('span', null, 'I saved my partner key')),
    h('div', { class: 'row' }, go)));
}

start();
