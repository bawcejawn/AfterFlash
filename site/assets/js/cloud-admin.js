// Afterflash Cloud parts of the admin page: sign in with a bought admin key, "Lost your key?"
// via Google, connect Google Drive (where every photo is saved), storage meter, owner tools.
import { h, clear, toast, copy, fmtBytes, fmtWhen, fmtDate, config, params } from './util.js';
import { api } from './api.js';

export const CLOUD = !!config.cloud;
const STUDIO = 'main';

const DRIVE_MSG = {
  connected: ['ok', 'Google Drive connected. New photos will save there.'],
  noscope: ['warn', 'Google Drive wasn’t connected: on Google’s screen, tick the box that lets Afterflash save files to your Drive, then try again.'],
  cancelled: ['warn', 'Google Drive wasn’t connected. You can try again any time.'],
  error: ['warn', 'Google didn’t finish connecting. Please try again.'],
  expired: ['warn', 'That connection link expired. Please try again.'],
};
const RECOVER_MSG = {
  unknown: 'That Google account isn’t connected to an Afterflash account. Use the Google account you connected to Afterflash (it’s shown on your admin page).',
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
    h('p', null, 'Use the admin key you got after buying Afterflash.'),
    h('label', { class: 'field' }, h('span', null, 'Admin key'), keyIn),
    err ? h('p', { class: 'callout warn', role: 'alert' }, err) : null,
    h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
    h('p', { class: 'small' }, 'Lost your key? ', h('button', { class: 'linkbtn', type: 'button', onclick: recover }, 'Sign in with Google'),
      ' (the Google account you connected) to get a new one.'),
    h('p', { class: 'small muted' }, 'Don’t have a key yet? ', h('a', { href: 'index.html#pricing' }, 'Get Afterflash'), '.'));
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
    h('p', null, 'This is the password to your Afterflash. Save it in your password manager or notes now: it isn’t shown again.'),
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
      h('p', null, 'Every photo, video and voice message your guests take is saved straight into your own Google Drive, in a “Afterflash” folder. Google gives every account 15 GB free (about 3,000 photos).'),
      h('div', { class: 'row' }, h('button', { class: 'btn flash', onclick: (e) => connect(e.currentTarget) }, 'Connect Google Drive')),
      h('p', { class: 'small muted' }, 'Afterflash can only see the files it creates for you, never anything else in your Drive.'),
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
        h('li', null, 'Buy more space from Google (100 GB is a few dollars a month). Afterflash keeps working with no changes.'),
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
  const plan = h('select', { 'aria-label': 'Plan' }, h('option', { value: 'lifetime' }, 'Lifetime'), h('option', { value: 'year' }, '12 months'), h('option', { value: 'month' }, '1 month'), h('option', { value: 'event' }, '1 event'));
  const result = h('div');
  const make = h('form', { class: 'row' }, note, plan, h('button', { class: 'btn primary', type: 'submit' }, 'Create a free key'));
  make.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(studio, 'ownerCreateAccount', { k: adminKey, note: note.value.trim(), plan: plan.value });
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
      const revenue = accounts.reduce((sum, a) => sum + (Number(a.paid) || 0), 0) / 100;
      clear(list).append(
        h('p', null, `${accounts.length} accounts: ${paid} paid, ${accounts.length - paid} free. Sales so far: $${revenue.toFixed(2)} (before Stripe fees).`),
        accounts.length ? h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, 'Account'), h('th', null, 'Type'), h('th', null, 'Plan'), h('th', null, 'Drive'), h('th', null, 'Events'), h('th', null, 'Since'), h('th', null, ''))),
          h('tbody', null, accounts.map((a) => h('tr', null,
            h('td', null, h('b', null, a.email || a.note || a.id), h('div', { class: 'small muted' }, a.google_email || '')),
            h('td', null, a.kind + (a.ref ? ` (${a.ref})` : '')), h('td', null, a.plan === 'lifetime' && !a.expires ? 'Lifetime' : `${PLAN_NAMES[a.plan] || a.plan}, ${a.expires < Date.now() ? 'ended' : 'until'} ${day(a.expires)}`), h('td', null, a.drive ? 'Connected' : 'Not yet'), h('td', null, String(a.events)), h('td', null, fmtWhen(a.created)),
            h('td', null, h('div', { class: 'row' },
              a.expires && a.plan !== 'partner' ? h('button', { class: 'btn small', onclick: () => addDays(a) }, 'Add days') : null,
              h('button', { class: 'btn small' + (a.status === 'active' ? ' danger' : ''), onclick: () => setStatus(a) }, a.status === 'active' ? 'Turn off' : 'Turn on'))))))) : null);
    } catch (err) { clear(list).append(h('p', null, err.message)); }
  }
  async function addDays(a) {
    const d = prompt(`Add how many days to ${a.email || a.note || a.id}? (e.g. 7 to make up for a problem)`, '7');
    if (d == null) return;
    try { await api(studio, 'ownerAddDays', { k: adminKey, id: a.id, days: Number(d) }); toast('Days added.'); load(); } catch (err) { toast(err.message, 'error'); }
  }
  async function setStatus(a) {
    const off = a.status === 'active';
    if (off && !confirm(`Turn off ${a.email || a.note || a.id}? Their admin key stops working and guests can’t upload until you turn it back on.`)) return;
    try { await api(studio, 'ownerSetStatus', { k: adminKey, id: a.id, status: off ? 'disabled' : 'active' }); load(); } catch (err) { toast(err.message, 'error'); }
  }
  load();
  return h('section', { class: 'panel stack section' }, h('h2', null, 'Owner: accounts'), make, result, list);
}

const PLAN_NAMES = { event: '1-event plan', month: '1-month plan', year: '12-month plan', lifetime: 'Lifetime', partner: 'Partner only' };
const day = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
const usd = (c) => '$' + (Number(c || 0) / 100).toFixed(2);

/** Plan status and renewals. Renewing adds time (or another event) to the same admin key. */
export function planPanel({ studio, adminKey, me }) {
  if (me.role === 'owner' || (me.plan === 'lifetime' && !me.expires)) {
    return me.role === 'owner' ? null : h('p', { class: 'small muted' }, 'Plan: Lifetime. Thank you!');
  }
  if (me.plan === 'partner') {
    const ps = ((config.cloud && config.cloud.plans) || []).filter((p) => p.on);
    return h('section', { class: 'panel stack plan-status' }, h('h2', null, 'Partner account'),
      h('p', null, 'This key shows your sales and payouts. To host your own events, buy a plan (partners pay full price, and their own purchases don’t earn commission).'),
      ps.length ? h('div', { class: 'row' }, ps.map((p) => h('button', { class: 'btn small', onclick: async (e) => {
        e.currentTarget.disabled = true;
        try { const { url } = await api(studio, 'checkoutStart', { plan: p.id, k: adminKey }, { retries: 1 }); if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Unexpected checkout address.'); location.href = url; }
        catch (err) { toast(err.message, 'error'); }
      } }, `${p.name} (${p.price})`))) : null);
  }
  const left = Math.ceil((me.expires - Date.now()) / 86400000);
  const unlimitedActive = me.plan !== 'event' && !me.expired;
  const plans = ((config.cloud && config.cloud.plans) || []).filter((p) => p.on && !(p.id === 'event' && unlimitedActive));
  const buy = async (plan, btn) => {
    btn.disabled = true;
    try {
      const { url } = await api(studio, 'checkoutStart', { plan, k: adminKey }, { retries: 1 });
      if (!/^https:\/\/checkout\.stripe\.com\//.test(url)) throw new Error('Unexpected checkout address.');
      location.href = url;
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  };
  const soon = me.expired || left <= 7;
  const used = me.plan === 'event' && me.maxEvents ? ` ${Math.min(me.eventsUsed, me.maxEvents)} of ${me.maxEvents} event${me.maxEvents === 1 ? '' : 's'} used.` : '';
  const hold = me.holdUntil ? ` Album links stay online until ${day(me.holdUntil)}; your photos stay in your Google Drive forever.` : '';
  return h('section', { class: 'panel stack plan-status' + (soon ? ' warn' : '') },
    h('h2', null, me.expired ? 'Your plan has ended' : `${PLAN_NAMES[me.plan] || 'Plan'}: ${left} day${left === 1 ? '' : 's'} left`),
    h('p', null, me.expired
      ? `It ended on ${day(me.expires)}. Renew to create events, open dashboards and take new photos again (guests’ waiting photos upload once you renew).${hold}`
      : `Active until ${day(me.expires)}.${used} Buying again adds to this same admin key.${hold}`),
    plans.length ? h('div', { class: 'row' }, plans.map((p) => h('button', { class: 'btn small' + (p.best ? ' flash' : ''), onclick: (e) => buy(p.id, e.currentTarget) },
      p.id === 'event' ? `Add 1 event (${p.price})` : `Add ${p.name} (${p.price})`))) : null);
}

/** A referral partner's own code, link, earnings, team, invite links and payout requests. */
export function partnerPanel({ studio, adminKey, me }) {
  if (!me.partner || !me.partner.codes || !me.partner.codes.length) return null;
  const box = h('section', { class: 'panel stack section' });
  const draw = (p) => {
    clear(box).append(h('h2', null, 'Your partner page'));
    for (const c of p.codes) box.append(codeBlock(p, c));
  };
  const reload = async () => {
    try { const r = await api(studio, 'adminCheck', { k: adminKey }); if (r.me && r.me.partner) draw(r.me.partner); } catch (err) { toast(err.message, 'error'); }
  };
  const codeBlock = (p, c) => {
    const pending = c.requests.find((r) => r.status === 'pending');
    const inviteOut = h('div');
    const invite = async (btn) => {
      btn.disabled = true;
      try {
        const r = await api(studio, 'partnerInvite', { k: adminKey, code: c.code });
        clear(inviteOut).append(h('div', { class: 'panel stack' },
          h('p', null, `Send this link to one person who wants to join your team. It works once, until ${day(r.expires)}.`),
          h('div', { class: 'keybox partner-link' }, r.link), h('button', { class: 'btn small', onclick: () => copy(r.link) }, 'Copy invite link')));
      } catch (err) { toast(err.message, 'error'); }
      btn.disabled = false;
    };
    const method = h('select', { 'aria-label': 'How to pay you' }, p.methods.map((m) => h('option', { value: m }, m)));
    const handle = h('input', { type: 'text', maxlength: 80, placeholder: 'Username, email or phone (address for a check)' });
    const reqForm = h('form', { class: 'row' }, method, handle, h('button', { class: 'btn primary', type: 'submit' }, `Request ${usd(c.ready)}`));
    reqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await api(studio, 'partnerRequestPayout', { k: adminKey, code: c.code, method: method.value, handle: handle.value.trim() }); toast('Payout requested.'); reload(); }
      catch (err) { toast(err.message, 'error'); }
    });
    return h('div', { class: 'stack' },
      h('p', null, h('b', null, c.code), ` (tier ${c.tier})`, c.active ? ` gives buyers ${c.discount}% off. You earn ${c.commission}% of every sale made with it, renewals included.` : ' is turned off right now.'),
      h('div', { class: 'row' }, h('span', { class: 'keybox partner-link' }, c.link), h('button', { class: 'btn small', onclick: () => copy(c.link) }, 'Copy link'), h('button', { class: 'btn small', onclick: () => copy(c.code) }, 'Copy code')),
      h('p', { class: 'small muted' }, 'When you share it, say you earn a commission (for example: “I get a small commission if you use my code”).'),
      h('div', { class: 'stats' },
        h('div', null, h('b', null, usd(c.earned)), h('span', null, 'earned')),
        h('div', null, h('b', null, usd(c.teamEarned)), h('span', null, 'of it from your team')),
        h('div', null, h('b', null, usd(c.paid)), h('span', null, 'paid to you')),
        h('div', null, h('b', null, usd(c.ready)), h('span', null, 'ready to pay'))),
      pending ? h('p', { class: 'callout' }, `Payout of ${usd(pending.amount)} by ${pending.method} requested on ${day(pending.created)}. You’ll be paid soon.`)
        : c.ready >= p.minPayout ? reqForm
          : h('p', { class: 'small muted' }, `You can request a payout once ${usd(p.minPayout)} is ready. Sales count after 14 days.`),
      c.canInvite ? h('div', { class: 'stack' }, h('h3', null, 'Grow your team'),
        h('p', { class: 'small muted' }, `Invite people who want to sell too. When your team sells, you share a ${c.override}% team bonus. Inviting earns nothing by itself, and never promise anyone earnings.`),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => invite(e.currentTarget) }, 'Make an invite link')), inviteOut) : null,
      c.team.length ? h('details', null, h('summary', null, `Your team (${c.team.length})`), h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Partner'), h('th', null, 'Tier'), h('th', null, 'Sales'))),
        h('tbody', null, c.team.map((m) => h('tr', null, h('td', null, m.name + (m.under ? ' (via ' + m.under + ')' : '') + (m.active ? '' : ' (off)')), h('td', null, String(m.tier)), h('td', null, String(m.sales))))))) : null,
      c.recent.length ? h('details', null, h('summary', null, 'Recent earnings'), h('table', { class: 'list' },
        h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'From'), h('th', null, 'Sale'), h('th', null, 'You earn'))),
        h('tbody', null, c.recent.map((r) => h('tr', null, h('td', null, day(r.created)), h('td', null, (r.kind === 'override' ? 'Team: ' : 'You: ') + (PLAN_NAMES[r.plan] || r.plan)),
          h('td', null, usd(r.paid)), h('td', null, r.status === 'void' ? 'Reversed' : usd(r.amount))))))) : null,
      c.requests.length ? h('details', null, h('summary', null, 'Payout history'), h('table', { class: 'list' },
        h('tbody', null, c.requests.map((r) => h('tr', null, h('td', null, day(r.created)), h('td', null, usd(r.amount)), h('td', null, r.method), h('td', null, r.status === 'paid' ? `Paid ${day(r.done)}` : r.status)))))) : null);
  };
  draw(me.partner);
  return box;
}

/** Owner: referral partners, their earnings and payouts, and cash sales. */
export function partnersPanel({ studio, adminKey }) {
  const body = h('div', null, h('p', { class: 'muted' }, 'Loading partners…'));
  const result = h('div');
  const f = {
    name: h('input', { type: 'text', maxlength: 60, placeholder: 'Partner’s name', required: true }),
    email: h('input', { type: 'email', maxlength: 120, placeholder: 'Email (optional)' }),
    code: h('input', { type: 'text', maxlength: 16, placeholder: 'Code (optional)', class: 'upper' }),
    discount: h('input', { type: 'number', min: 0, max: 50, value: 10, 'aria-label': 'Buyer discount %', class: 'narrow' }),
    commission: h('input', { type: 'number', min: 0, max: 50, value: 20, 'aria-label': 'Commission %', class: 'narrow' }),
    withKey: h('input', { type: 'checkbox', checked: true }),
  };
  const create = h('form', { class: 'stack' },
    h('div', { class: 'row' }, f.name, f.email, f.code),
    h('div', { class: 'row' }, h('label', null, f.discount, ' % off for buyers'), h('label', null, f.commission, ' % commission'),
      h('label', null, f.withKey, ' Free lifetime hosting key (otherwise a partner-only key: earnings and payouts, no hosting)')),
    h('button', { class: 'btn primary', type: 'submit' }, 'Add partner'));
  create.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(studio, 'ownerCodeCreate', { k: adminKey, name: f.name.value.trim(), email: f.email.value.trim(), code: f.code.value.trim(),
        discount: Number(f.discount.value), commission: Number(f.commission.value), withKey: f.withKey.checked });
      f.name.value = ''; f.email.value = ''; f.code.value = '';
      clear(result).append(h('div', { class: 'panel stack' }, h('h3', null, `Partner code ${r.code}`),
        h('p', null, 'Send these privately, with the partner agreement (docs/PARTNERS.md). The key is shown only once; with it they see their code, link, earnings and team, and request payouts.'),
        h('div', { class: 'keybox partner-link' }, r.link), h('button', { class: 'btn small', onclick: () => copy(r.link) }, 'Copy link'),
        h('div', { class: 'keybox' }, r.adminKey), h('button', { class: 'btn small', onclick: () => copy(r.adminKey) }, r.lifetime ? 'Copy lifetime key' : 'Copy partner key')));
      load();
    } catch (err) { toast(err.message, 'error'); }
  });

  const plans = ((config.cloud && config.cloud.plans) || []);
  const cash = {
    plan: h('select', { 'aria-label': 'Plan' }, plans.map((p) => h('option', { value: p.id }, `${p.name} (${p.price})`))),
    amount: h('input', { type: 'text', inputmode: 'decimal', placeholder: 'Amount paid, e.g. 10', required: true, class: 'mid' }),
    code: h('input', { type: 'text', maxlength: 16, placeholder: 'Partner code (optional)', class: 'upper' }),
    email: h('input', { type: 'email', maxlength: 120, placeholder: 'Buyer email (optional)' }),
  };
  const cashResult = h('div');
  const cashForm = h('form', { class: 'stack' }, h('div', { class: 'row' }, cash.plan, cash.amount, cash.code, cash.email),
    h('button', { class: 'btn', type: 'submit' }, 'Record cash sale and make a key'));
  cashForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api(studio, 'ownerCashSale', { k: adminKey, plan: cash.plan.value, amount: cash.amount.value.trim(), code: cash.code.value.trim(), email: cash.email.value.trim() });
      cash.amount.value = ''; cash.code.value = ''; cash.email.value = '';
      clear(cashResult).append(h('div', { class: 'panel stack' }, h('h3', null, 'Their admin key'),
        h('p', null, `${PLAN_NAMES[r.plan]} until ${day(r.expires)}. Shown once: send it privately or have them copy it now.`),
        h('div', { class: 'keybox' }, r.adminKey), h('button', { class: 'btn small', onclick: () => copy(r.adminKey) }, 'Copy key')));
      load();
    } catch (err) { toast(err.message, 'error'); }
  });

  const act = async (fn) => { try { await fn(); load(); } catch (err) { toast(err.message, 'error'); } };
  async function load() {
    try {
      const { codes, sales, payouts, requests, override } = await api(studio, 'ownerCodes', { k: adminKey });
      const owed = codes.reduce((t, c) => t + c.owed, 0), ready = codes.reduce((t, c) => t + c.ready, 0);
      clear(body).append(
        requests.length ? h('div', { class: 'panel stack callout' }, h('h3', null, `Payout requests (${requests.length})`),
          h('p', { class: 'small' }, 'Send the money with the app they chose, then click Paid. Payouts are recorded for their 1099.'),
          h('table', { class: 'list' }, h('tbody', null, requests.map((q) => h('tr', null,
            h('td', null, h('b', null, q.name || q.code), h('div', { class: 'small muted' }, q.code + (q.email ? ' · ' + q.email : ''))),
            h('td', null, h('b', null, usd(q.amount))), h('td', null, q.method, h('div', { class: 'small' }, q.handle)), h('td', null, day(q.created)),
            h('td', null, h('div', { class: 'row' },
              h('button', { class: 'btn small primary', onclick: () => { if (confirm(`Did you send ${usd(q.amount)} to ${q.handle} by ${q.method}?`)) act(() => api(studio, 'ownerPayRequest', { k: adminKey, id: q.id, paid: true })); } }, 'Paid'),
              h('button', { class: 'btn small', onclick: () => { const n = prompt('Reason (they’ll be able to request again):', ''); if (n != null) act(() => api(studio, 'ownerPayRequest', { k: adminKey, id: q.id, paid: false, note: n })); } }, 'Decline')))))))) : null,
        h('p', null, `${codes.length} partner${codes.length === 1 ? '' : 's'}. You owe ${usd(owed)} in total; ${usd(ready)} is past the 14-day window and ready to pay. Team bonus: ${override}% of each sale, split among the partners above the seller.`),
        codes.length ? h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, 'Partner'), h('th', null, 'Tier'), h('th', null, 'Deal'), h('th', null, 'Sales'), h('th', null, 'Earned'), h('th', null, 'Paid'), h('th', null, 'Ready to pay'), h('th', null, ''))),
          h('tbody', null, codes.map((c) => h('tr', null,
            h('td', null, h('b', null, c.code), h('div', { class: 'small muted' }, c.name + (c.email ? ' · ' + c.email : '') + (c.active ? '' : ' (off)'))),
            h('td', null, String(c.tier), c.parent ? h('div', { class: 'small muted' }, 'under ' + c.parent) : null),
            h('td', null, `${c.discount}% off, ${c.commission}%`),
            h('td', null, `${c.sales} (${usd(c.revenue)})`), h('td', null, usd(c.earned)), h('td', null, usd(c.paid), h('div', { class: 'small muted' }, `${usd(c.paidThisYear)} this year`)), h('td', null, usd(c.ready)),
            h('td', null, h('div', { class: 'row' },
              h('button', { class: 'btn small primary', disabled: c.owed <= 0, onclick: () => payout(c) }, 'Record payout'),
              h('button', { class: 'btn small', onclick: () => copy(c.link) }, 'Copy link'),
              h('button', { class: 'btn small' + (c.active ? ' danger' : ''), onclick: () => act(() => api(studio, 'ownerCodeUpdate', { k: adminKey, code: c.code, active: !c.active })) }, c.active ? 'Turn off' : 'Turn on'))))))) : null,
        sales.length ? h('details', null, h('summary', null, `Sales with codes (${sales.length})`), h('table', { class: 'list' },
          h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Earner'), h('th', null, 'Plan'), h('th', null, 'Paid'), h('th', null, 'Commission'), h('th', null, ''))),
          h('tbody', null, sales.map((x) => h('tr', null, h('td', null, day(x.created)), h('td', null, x.code, x.kind === 'override' ? h('div', { class: 'small muted' }, 'team bonus, sold by ' + x.seller) : null), h('td', null, (PLAN_NAMES[x.plan] || x.plan) + (x.method === 'cash' ? ' (cash)' : '')),
            h('td', null, usd(x.paid)), h('td', null, x.status === 'void' ? 'Voided' : usd(x.amount)),
            h('td', null, h('button', { class: 'btn small', title: 'Use after a chargeback or refund; also reverses the team bonuses', onclick: () => act(() => api(studio, 'ownerVoidSale', { k: adminKey, id: x.id, restore: x.status === 'void' })) }, x.status === 'void' ? 'Restore' : 'Void (chargeback)'))))))) : null,
        payouts.length ? h('details', null, h('summary', null, `Payouts (${payouts.length})`),
          h('button', { class: 'btn small', onclick: () => csv(payouts, codes) }, 'Download payouts for taxes (CSV)'),
          h('table', { class: 'list' }, h('tbody', null, payouts.map((x) => h('tr', null, h('td', null, day(x.created)), h('td', null, x.code), h('td', null, usd(x.amount)), h('td', null, x.method), h('td', null, x.note)))))) : null);
    } catch (err) { clear(body).append(h('p', null, err.message)); }
  }
  function payout(c) {
    const amt = prompt(`How much did you pay ${c.name}? (owed ${usd(c.owed)}, ready ${usd(c.ready)})`, (c.ready / 100).toFixed(2));
    if (amt == null) return;
    const method = prompt('How did you pay? (e.g. Venmo, PayPal, Zelle, cash)', 'Venmo');
    if (method == null) return;
    act(() => api(studio, 'ownerPayout', { k: adminKey, code: c.code, amount: amt.trim(), method: method.trim() }));
  }
  function csv(payouts, codes) {
    const who = Object.fromEntries(codes.map((c) => [c.code, c]));
    const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
    const rows = [['Date', 'Code', 'Partner', 'Email', 'Amount (USD)', 'Method', 'Note']].concat(payouts.map((x) => [new Date(x.created).toISOString().slice(0, 10), x.code, (who[x.code] || {}).name, (who[x.code] || {}).email, (x.amount / 100).toFixed(2), x.method, x.note]));
    const blob = new Blob([rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'photoshare-payouts.csv' });
    document.body.append(a); a.click(); a.remove();
  }
  load();
  return h('section', { class: 'panel stack section' }, h('h2', null, 'Owner: referral partners'),
    h('p', { class: 'small muted' }, 'Each partner gets a code and a link. Buyers get the discount; the seller earns the commission on every sale with their code, renewals included, and the partners above them (up to 2 tiers) split the team bonus. Partners in tiers 1 and 2 can invite people to their team. Partners request payouts at $25; you pay them and click Paid.'),
    create, result, h('h3', null, 'Cash sale'), h('p', { class: 'small muted' }, 'Sold a key in person? Record it here to make their admin key and credit the partner.'), cashForm, cashResult, body);
}
