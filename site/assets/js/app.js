// The app home: what the home-screen icon opens. Four big choices, one tap each:
// Scan a code, My events, Host, Partner. A "Continue" card on top reopens the last thing used.
import { $, h, clear, frameGuard, isEventId, link, fmtWhen, config, copy, qrSvg, store, inStoreApp } from './util.js';
import { isStandalone, showInstall, myEvents, myInvites, myPlaces, placeUrl } from './install.js';

frameGuard();
const root = $('#app');
const app = config.appName || 'Rememberoll';
const cloud = !!config.cloud;
const appUrl = new URL('app.html', location.href).href;
let stopScan = null;

// ------------------------------------------------------------------ icons (drawn, no files)
const NS = 'http://www.w3.org/2000/svg';
function icon(name) {
  const paths = {
    scan: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M8 9h3v3H8zM13 13h3v3h-3zM13 9h3M8 15h2',
    photos: 'M4 7h3l2-2h6l2 2h3v12H4zM12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
    host: 'M4 20V9l8-5 8 5v11h-5v-6H9v6zM12 4v0',
    partner: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M2 20c0-3 3-5 6-5s6 2 6 5M14 15c3 0 8 1 8 5',
    back: 'M15 5l-7 7 7 7',
    share: 'M12 15V4M8 8l4-4 4 4M5 13v6h14v-6',
    help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14M12 18h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18',
    arrow: 'M9 5l7 7-7 7',
  };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'ico');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', paths[name]); p.setAttribute('fill', 'none'); p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2'); p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

// ------------------------------------------------------------------ screens
function screen(title, ...body) {
  return h('div', { class: 'app-screen' },
    h('header', { class: 'app-bar' },
      h('a', { class: 'app-back', href: '#', 'aria-label': 'Back to home' }, icon('back'), h('span', null, 'Home')),
      h('h1', null, title)),
    ...body);
}

function home() {
  const cont = continueCard();
  const tiles = [
    tile('#scan', 'scan', 'Scan a code', 'Join an event or open an invitation'),
    tile('#mine', 'photos', 'My events', 'Cameras, albums and invitations'),
    tile('#host', 'host', 'Host', 'Run your event and see RSVPs'),
    cloud ? tile('#partner', 'partner', 'Partner', 'Your sales, team and payouts') : null,
  ].filter(Boolean);
  return h('div', { class: 'app-screen app-home' },
    h('header', { class: 'app-top' },
      h('span', { class: 'brand' }, h('span', { class: 'brand-mark' }), h('span', null, app)),
      h('a', { class: 'app-help', href: 'help.html', 'aria-label': 'Help' }, icon('help'), h('span', null, 'Help'))),
    isStandalone() ? null : h('button', { class: 'app-install', type: 'button', onclick: () => showInstall('app', { dark: false }) },
      h('b', null, 'Get the app'), h('span', null, 'Add it to your home screen in 2 taps')),
    cont,
    h('nav', { class: 'app-tiles' + (tiles.length === 3 ? ' three' : ''), 'aria-label': 'Main' }, tiles),
    h('button', { class: 'app-share', type: 'button', onclick: shareApp }, icon('share'), h('span', null, `Share ${app} with someone`)));
}

function tile(href, ic, title, sub) {
  return h('a', { class: 'app-tile', href }, h('span', { class: 'app-tile-ico' }, icon(ic)), h('b', null, title), h('span', null, sub));
}

/** The one thing you most likely want right now. */
function continueCard() {
  const ev = myEvents()[0];
  const place = myPlaces()[0];
  const camFresh = ev && Date.now() - ev.lastUsed < 3 * 864e5;
  let pick = null;
  if (camFresh && (!place || ev.lastUsed >= place.t)) pick = { href: link('cam.html', { e: ev.id, s: ev.studio }), title: ev.name, sub: 'Back to the camera' };
  else if (place) pick = { href: placeUrl(place), title: place.n || (place.p === 'host' ? 'Your event' : 'Studio admin'), sub: place.p === 'host' ? 'Open the host dashboard' : 'Open your studio' };
  if (!pick) return null;
  return h('a', { class: 'app-continue', href: pick.href }, h('span', null, h('small', null, pick.sub), h('b', null, pick.title)), icon('arrow'));
}

// ---- scan
function scan() {
  const video = h('video', { playsinline: true, muted: true, autoplay: true });
  const status = h('p', { class: 'app-scan-status', role: 'status' }, 'Starting the camera…');
  const msg = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const code = h('input', { type: 'text', inputmode: 'text', autocapitalize: 'off', spellcheck: false, autocomplete: 'off', maxlength: 200, placeholder: 'Event code', 'aria-label': 'Event code' });
  const typed = h('form', { class: 'app-type' }, h('label', { for: 'typed' }, 'Or type the code from the sign'),
    h('div', { class: 'linkline' }, code, h('button', { class: 'btn primary', type: 'submit' }, 'Go')));
  code.id = 'typed';
  typed.addEventListener('submit', (e) => { e.preventDefault(); open(code.value); });
  function open(text) {
    const to = safeTarget(text);
    if (!to) { msg.textContent = `That isn’t a ${app} code. For your safety, the scanner only opens ${app} events and invitations.`; msg.hidden = false; return false; }
    if (stopScan) stopScan();
    location.href = to;
    return true;
  }
  startScanner(video, status, open);
  return screen('Scan a code',
    h('div', { class: 'app-scan' }, video, h('div', { class: 'app-scan-frame', 'aria-hidden': 'true' })),
    status, msg,
    h('p', { class: 'small muted' }, 'Point your camera at the QR code on the table sign, the TV or the invitation.'),
    typed);
}

/**
 * Only codes for this app are opened: a bare event code, or a link to one of our own pages on
 * this same site. Anything else (another website, a payment link) is refused, so a fake sticker
 * over a real QR code can't send guests somewhere else.
 */
export function safeTarget(text) {
  const raw = String(text || '').trim();
  if (isEventId(raw)) return 'cam.html?e=' + encodeURIComponent(raw);
  let u;
  try { u = new URL(raw, location.href); } catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.origin !== location.origin || raw.indexOf(':') < 0) return null;
  const page = u.pathname.split('/').pop();
  if (!['cam.html', 'invite.html', 'album.html', 'partner.html', 'host.html', 'index.html', 'app.html', 'help.html'].includes(page)) return null;
  return u.pathname + u.search + u.hash;
}

async function startScanner(video, status, onCode) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch {
    status.textContent = 'Camera not available. Allow camera access in your browser settings, or type the code below.';
    return;
  }
  let stopped = false;
  stopScan = () => { stopped = true; stream.getTracks().forEach((t) => t.stop()); stopScan = null; };
  video.srcObject = stream;
  await video.play().catch(() => {});
  status.textContent = 'Looking for a QR code…';
  let detect;
  if ('BarcodeDetector' in window) {
    try {
      const bd = new window.BarcodeDetector({ formats: ['qr_code'] });
      detect = async () => { const r = await bd.detect(video); return r[0] && r[0].rawValue; };
    } catch { detect = null; }
  }
  if (!detect) {
    await loadJsQr();
    const c = document.createElement('canvas');
    const x = c.getContext('2d', { willReadFrequently: true });
    detect = async () => {
      const w = video.videoWidth, hgt = video.videoHeight;
      if (!w || !hgt) return null;
      const s = Math.min(1, 640 / Math.max(w, hgt));
      c.width = Math.round(w * s); c.height = Math.round(hgt * s);
      x.drawImage(video, 0, 0, c.width, c.height);
      const r = window.jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      return r && r.data;
    };
  }
  let lastBad = '';
  const tick = async () => {
    if (stopped || !document.body.contains(video)) { if (!stopped && stopScan) stopScan(); return; }
    try {
      const v = await detect();
      if (v && v !== lastBad) {
        if (navigator.vibrate) navigator.vibrate(30);
        if (!onCode(v)) lastBad = v;
      }
    } catch { /* keep looking */ }
    setTimeout(tick, 180);
  };
  tick();
}

let jsQrLoading = null;
function loadJsQr() {
  if (window.jsQR) return Promise.resolve();
  jsQrLoading = jsQrLoading || new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'assets/vendor/jsQR.js'; s.onload = res; s.onerror = rej;
    document.head.append(s);
  });
  return jsQrLoading;
}

// ---- my events
function mine() {
  const events = myEvents(), invites = myInvites();
  const rows = [];
  const inviteFor = new Set(invites.map((i) => i.studio + ':' + i.id));
  for (const ev of events) {
    rows.push(h('li', { class: 'app-row' },
      h('div', null, h('b', null, ev.name), ev.lastUsed ? h('small', null, `Last used ${fmtWhen(ev.lastUsed)}`) : null),
      h('div', { class: 'app-row-actions' },
        h('a', { class: 'btn flash', href: link('cam.html', { e: ev.id, s: ev.studio }) }, 'Camera'),
        h('a', { class: 'btn', href: link('album.html', { e: ev.id, s: ev.studio }) }, 'Album'),
        inviteFor.has(ev.studio + ':' + ev.id) ? h('a', { class: 'btn', href: link('invite.html', { e: ev.id, s: ev.studio }) }, 'Invitation') : null)));
  }
  const evIds = new Set(events.map((e) => e.studio + ':' + e.id));
  const STATUS = { yes: 'You’re going', maybe: 'You said maybe', no: 'You can’t make it' };
  for (const inv of invites.filter((i) => !evIds.has(i.studio + ':' + i.id))) {
    rows.push(h('li', { class: 'app-row' },
      h('div', null, h('b', null, inv.name), h('small', null, STATUS[inv.status] || 'Invitation')),
      h('div', { class: 'app-row-actions' }, h('a', { class: 'btn primary', href: link('invite.html', { e: inv.id, s: inv.studio }) }, 'Open invitation'))));
  }
  return screen('My events',
    rows.length ? h('ul', { class: 'app-list' }, rows)
      : h('div', { class: 'app-empty stack' }, h('p', null, 'Nothing here yet. Scan the QR code at an event, or open an invitation link, and it shows up here.'),
        h('a', { class: 'btn primary big', href: '#scan' }, 'Scan a code')));
}

// ---- host
function host() {
  const places = myPlaces();
  return screen('Host',
    places.length ? h('ul', { class: 'app-list' }, places.map((x) => h('li', null,
      h('a', { class: 'app-row app-row-link', href: placeUrl(x) },
        h('div', null, h('b', null, x.n || (x.p === 'host' ? 'Your event' : 'Studio admin')), h('small', null, x.p === 'host' ? 'Host dashboard' : 'All your events')), icon('arrow'))))) : null,
    h('div', { class: 'app-actions stack' },
      h('a', { class: 'btn primary big', href: link('admin.html', {}) }, places.some((x) => x.p === 'admin') ? 'Sign in again' : 'Sign in with my key'),
      cloud ? (inStoreApp() ? null : h('a', { class: 'btn big', href: 'index.html#pricing' }, 'Start a new event')) : h('a', { class: 'btn big', href: 'setup.html' }, `Set up my own ${app}`)),
    h('p', { class: 'small muted' }, 'Got a host link from a co-host? Just open it once and it shows up here. Your keys stay on this phone.'));
}

// ---- partner
function partner() {
  return screen('Partner',
    h('div', { class: 'app-actions stack' },
      h('a', { class: 'btn primary big', href: link('admin.html', {}) }, 'Open my partner page'),
      h('a', { class: 'btn big', href: '#scan' }, 'Scan a team invite'),
      h('a', { class: 'btn big', href: 'help.html#partner-link' }, 'How partners earn')),
    h('p', { class: 'small muted' }, 'Sign in with the partner key you were given. Your page shows your link, sales, team and payouts.'));
}

// ---- share the app
async function shareApp() {
  const data = { title: app, text: `${app}: the event camera and invitation app. Add it to your home screen:`, url: appUrl };
  if (navigator.share) { try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  const close = () => overlay.remove();
  const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Share ${app}` },
    h('div', { class: 'panel stack' }, h('h2', null, `Share ${app}`),
      h('p', null, 'Scan this with a phone camera, or send the link.'),
      h('div', { class: 'qr-box app-qr' }, qrSvg(appUrl)),
      h('div', { class: 'linkline' }, h('input', { type: 'text', readonly: true, value: appUrl }), h('button', { class: 'btn small', onclick: () => copy(appUrl) }, 'Copy')),
      h('button', { class: 'btn', onclick: close }, 'Close')));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
}

// ------------------------------------------------------------------ router
const ROUTES = { '': home, scan, mine, host, partner: cloud ? partner : home };
function route() {
  if (stopScan) stopScan();
  const r = ROUTES[location.hash.slice(1)] || home;
  clear(root).append(r());
  window.scrollTo(0, 0);
  const h1 = root.querySelector('h1');
  if (h1 && r !== home) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.hidden && stopScan) stopScan(); else if (!document.hidden && location.hash === '#scan') route(); });
try { store.set('ps:app-used', Date.now()); } catch { /* private mode */ }
route();
