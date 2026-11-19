// Invitation + RSVP page. Anyone with the link can reply. Answers are seen only by the host.
// The guest's browser makes a private edit token (only its hash is stored on the server), so
// the same phone, or the private link we show after replying, can change the answer later.
import {
  $, h, clear, toast, params, studioFrom, isEventId, store, setTitle, link, frameGuard, blobToBase64, base64ToBytes, copy, fmtDate, randomId,
} from './util.js';
import { api } from './api.js';
import { applyBrand, logoEl, logoBytesOk } from './brand.js';

frameGuard();
const root = $('#app');
const { q, f } = params();
let studio, eventId, inv, data, mine = null, auth = null, editing = false;

const authKey = () => `ps:rsvp:${studio}:${eventId}`;
const inviteUrl = () => link('invite.html', { e: eventId, s: studio });
const privateUrl = () => link('invite.html', { e: eventId, s: studio, frag: { r: `${auth.r}.${auth.rt}` } });
const cameraUrl = () => link('cam.html', { e: eventId, s: studio });

function fail(title, msg) {
  clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, title), h('p', null, msg)));
}

function newToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function boot() {
  try { studio = studioFrom(q); } catch { return fail('Can’t open this invitation', 'The link looks incomplete. Ask your host to send it again.'); }
  eventId = q.get('e');
  if (!isEventId(eventId)) return fail('Can’t open this invitation', 'The link is missing its event code. Ask your host to send it again.');
  // A private edit link (#r=id.token) moves into this browser, then leaves the address bar.
  const fr = String(f.get('r') || '');
  if (/^[A-Za-z0-9]{6,40}\.[A-Za-z0-9_-]{24,64}$/.test(fr)) {
    const [r, rt] = fr.split('.');
    store.set(authKey(), { r, rt });
    history.replaceState(null, '', location.pathname + location.search);
  }
  auth = store.get(authKey());
  if (!auth || !auth.r || !auth.rt) auth = null;
  await load();
}

async function load() {
  try {
    data = await api(studio, 'invite', { e: eventId, r: auth ? auth.r : undefined, rt: auth ? auth.rt : undefined });
  } catch (e) {
    if (e.code === 'not_found') return fail('This invitation isn’t open', e.message);
    if (e.code === 'archived') return fail('This event has ended', e.message);
    return fail('Can’t load the invitation', `${e.message} Check your connection and reload.`);
  }
  inv = data.invite;
  mine = data.mine || null;
  if (auth && !mine) { store.del(authKey()); auth = null; }
  applyBrand(inv);
  setTitle(inv.name ? `You’re invited: ${inv.name}` : 'Invitation');
  render();
}

// ------------------------------------------------------------------ formatting
function when() {
  const tz = inv.tz || undefined;
  if (inv.startsAt) {
    const start = new Date(inv.startsAt);
    const day = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz }).format(start);
    const t = (d) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(d);
    let time = t(start);
    if (inv.endsAt && Date.parse(inv.endsAt) > start.getTime()) time += ` – ${t(new Date(inv.endsAt))}`;
    const zone = tz && tz !== Intl.DateTimeFormat().resolvedOptions().timeZone
      ? new Intl.DateTimeFormat(undefined, { timeZoneName: 'short', timeZone: tz }).formatToParts(start).find((p) => p.type === 'timeZoneName')?.value : '';
    return { day, time: zone ? `${time} (${zone})` : time };
  }
  return inv.date ? { day: fmtDate(inv.date), time: '' } : null;
}
const fmtDeadline = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: inv.tz || undefined }).format(new Date(iso));
const mapUrl = () => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([inv.venue, inv.address].filter(Boolean).join(', '));

/** The camera is the main thing on the event day (or once the camera opens). */
function cameraTime() {
  const now = Date.now();
  if (inv.opensAt && now >= Date.parse(inv.opensAt)) return true;
  if (inv.startsAt) return now >= Date.parse(inv.startsAt) - 2 * 3600e3;
  if (inv.date) return new Date().toISOString().slice(0, 10) >= inv.date;
  return false;
}

// ------------------------------------------------------------------ calendar
const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsTime = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function calendarTimes() {
  if (inv.startsAt) {
    const s = new Date(inv.startsAt);
    const e = inv.endsAt && Date.parse(inv.endsAt) > s.getTime() ? new Date(inv.endsAt) : new Date(s.getTime() + 4 * 3600e3);
    return { s, e, allDay: false };
  }
  if (inv.date) return { s: inv.date.replace(/-/g, ''), e: new Date(Date.parse(inv.date) + 864e5).toISOString().slice(0, 10).replace(/-/g, ''), allDay: true };
  return null;
}
function downloadIcs() {
  const t = calendarTimes();
  if (!t) return;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rememberoll//Invitation//EN', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:${eventId}@rememberoll`, `DTSTAMP:${icsTime(new Date())}`,
    t.allDay ? `DTSTART;VALUE=DATE:${t.s}` : `DTSTART:${icsTime(t.s)}`, t.allDay ? `DTEND;VALUE=DATE:${t.e}` : `DTEND:${icsTime(t.e)}`,
    `SUMMARY:${icsText(inv.name)}`, `LOCATION:${icsText([inv.venue, inv.address].filter(Boolean).join(', '))}`,
    `DESCRIPTION:${icsText([inv.note, `Invitation: ${inviteUrl()}`].filter(Boolean).join('\n\n'))}`, `URL:${inviteUrl()}`,
    'END:VEVENT', 'END:VCALENDAR'];
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/calendar' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${(inv.name || 'event').replace(/[^\w -]+/g, '').trim() || 'event'}.ics` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
function googleCalUrl() {
  const t = calendarTimes();
  if (!t) return '';
  const dates = t.allDay ? `${t.s}/${t.e}` : `${icsTime(t.s)}/${icsTime(t.e)}`;
  const u = new URL('https://calendar.google.com/calendar/render');
  u.searchParams.set('action', 'TEMPLATE');
  u.searchParams.set('text', inv.name || 'Event');
  u.searchParams.set('dates', dates);
  u.searchParams.set('details', [inv.note, `Invitation: ${inviteUrl()}`].filter(Boolean).join('\n\n'));
  u.searchParams.set('location', [inv.venue, inv.address].filter(Boolean).join(', '));
  return u.toString();
}
function calendarButtons() {
  if (!calendarTimes()) return null;
  return h('div', { class: 'row invite-cal' },
    h('button', { class: 'btn small', type: 'button', onclick: downloadIcs }, 'Add to Apple or Outlook calendar'),
    h('a', { class: 'btn small', href: googleCalUrl(), target: '_blank', rel: 'noopener' }, 'Add to Google Calendar'));
}

// ------------------------------------------------------------------ cover photo
function coverEl() {
  if (!inv.coverV) return null;
  const img = h('img', { class: 'invite-cover', alt: '', hidden: true });
  (async () => {
    const ck = `ps:cover:${studio}:${eventId}:${inv.coverV}`;
    let r = store.get(ck, sessionStorage);
    if (!r || !r.data) { r = await api(studio, 'cover', { e: eventId }, { retries: 1 }); try { store.set(ck, { mime: r.mime, data: r.data }, sessionStorage); } catch { /* too big for storage */ } }
    const bytes = base64ToBytes(r.data);
    if (!logoBytesOk(r.mime, bytes)) return;
    img.src = URL.createObjectURL(new Blob([bytes], { type: r.mime }));
    img.hidden = false;
  })().catch(() => {});
  return img;
}

// ------------------------------------------------------------------ page
function render() {
  const w = when();
  const card = h('article', { class: 'invite-card' },
    coverEl(),
    h('div', { class: 'invite-body stack' },
      logoEl(studio, eventId, inv),
      h('p', { class: 'invite-kicker' }, inv.hosts ? `${inv.hosts} invite you to` : 'You’re invited to'),
      h('h1', { class: 'invite-title' }, inv.name || 'Our celebration'),
      inv.tagline ? h('p', { class: 'invite-tagline' }, inv.tagline) : null,
      h('dl', { class: 'invite-facts' },
        w ? [h('dt', null, 'When'), h('dd', null, h('b', null, w.day), w.time ? h('span', null, w.time) : null)] : null,
        inv.venue || inv.address ? [h('dt', null, 'Where'), h('dd', null, inv.venue ? h('b', null, inv.venue) : null, inv.address ? h('span', null, inv.address) : null,
          h('a', { href: mapUrl(), target: '_blank', rel: 'noopener', class: 'invite-map' }, 'Open in Maps'))] : null,
        inv.dress ? [h('dt', null, 'Dress code'), h('dd', null, inv.dress)] : null,
        inv.deadline ? [h('dt', null, 'Please reply by'), h('dd', null, fmtDeadline(inv.deadline))] : null),
      inv.note ? h('div', { class: 'invite-note' }, inv.note.split(/\n{2,}/).map((p) => h('p', null, p.split('\n').flatMap((l, i) => (i ? [h('br'), l] : [l]))))) : null,
      calendarButtons()));
  const cam = cameraTime() ? h('section', { class: 'invite-camera stack' },
    h('h2', null, 'It’s party time'),
    h('p', null, 'Open the camera to take photos for the shared album.'),
    h('a', { class: 'btn flash big', href: cameraUrl() }, 'Open the camera')) : null;
  clear(root).append(h('div', { class: 'invite-page' }, cam, card, rsvpSection(), whoComing(),
    h('p', { class: 'small muted invite-foot' }, 'Your reply goes only to the host.')));
}

function whoComing() {
  if (!data.coming || !data.coming.length) return null;
  return h('section', { class: 'invite-section stack' }, h('h2', null, `Who’s coming (${data.coming.length})`),
    h('p', { class: 'invite-coming' }, data.coming.join(', ')));
}

const STATUS = { yes: 'Yes, I’ll be there', maybe: 'Maybe', no: 'Sorry, can’t make it' };
function summary() {
  const people = mine.party || [];
  const lines = [];
  if (mine.status !== 'no') {
    lines.push(people.map((p) => (p.m ? `${p.n} (${p.m})` : p.n)).join(', '));
    if (mine.kids) lines.push(`${mine.kids} ${mine.kids === 1 ? 'child' : 'children'}`);
    if (mine.diet) lines.push(`Dietary notes: ${mine.diet}`);
    if (mine.song) lines.push(`Song request: ${mine.song}`);
  }
  if (mine.message) lines.push(`Message: ${mine.message}`);
  const priv = h('div', { class: 'stack invite-private' },
    h('label', { class: 'field' }, h('span', null, 'Your private link'),
      h('div', { class: 'linkline' }, h('input', { type: 'text', readonly: true, value: privateUrl(), onfocus: (e) => e.target.select() }),
        h('button', { class: 'btn small', type: 'button', onclick: () => copy(privateUrl()) }, 'Copy'))),
    h('small', null, 'Save it to change your answer from another phone. Don’t share it: anyone with it can change your reply.'));
  return h('section', { class: 'invite-section stack', id: 'rsvp' },
    h('h2', null, mine.status === 'yes' ? 'You’re on the list!' : mine.status === 'maybe' ? 'Thanks, we’ve noted a maybe' : 'Thanks for letting us know'),
    h('p', { class: 'invite-answer' }, h('span', { class: `rsvp-pill rsvp-${mine.status}` }, STATUS[mine.status]), mine.hasPhoto ? h('span', { class: 'small muted' }, ' Photo sent') : null),
    lines.length ? h('ul', { class: 'invite-lines' }, lines.map((l) => h('li', null, l))) : null,
    inv.closed ? h('p', { class: 'small muted' }, 'Replies are closed now. Contact your host if your plans change.')
      : h('button', { class: 'btn', type: 'button', onclick: () => { editing = true; render(); document.getElementById('rsvp').scrollIntoView({ behavior: 'smooth' }); } }, 'Change my answer'),
    priv);
}

function rsvpSection() {
  if (mine && !editing) return summary();
  if (inv.closed) {
    return h('section', { class: 'invite-section stack', id: 'rsvp' }, h('h2', null, 'Replies are closed'),
      h('p', null, 'The RSVP deadline has passed. Contact your host if you still need to reply.'));
  }
  return rsvpForm();
}

function rsvpForm() {
  const prev = mine || {};
  let status = prev.status || '';
  let photo = null; // Blob of the new selfie
  let removePhoto = false;
  const err = h('p', { class: 'form-error', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', name: 'name', maxlength: 60, required: true, autocomplete: 'name', value: (prev.party && prev.party[0] && prev.party[0].n) || prev.name || '' });
  const statusRow = h('div', { class: 'rsvp-choices', role: 'radiogroup', 'aria-label': 'Will you come?' });
  const attending = h('div', { class: 'stack' });
  const mealSel = (val) => h('select', { class: 'meal' }, h('option', { value: '' }, 'Choose a meal'), inv.meals.map((m) => h('option', { value: m, selected: m === val }, m)));
  const myMeal = inv.askMeal ? mealSel(prev.party && prev.party[0] ? prev.party[0].m : '') : null;
  const extras = h('div', { class: 'stack' });
  const prevExtras = (prev.party || []).slice(1);
  const size = inv.plusOnes ? h('select', { name: 'size', onchange: () => drawExtras() },
    Array.from({ length: inv.maxParty }, (_, i) => h('option', { value: i + 1, selected: i + 1 === Math.max(1, (prev.party || []).length) }, i === 0 ? 'Just me' : `Me + ${i}`))) : null;
  const extraRows = [];
  function drawExtras() {
    const n = size ? Number(size.value) - 1 : 0;
    while (extraRows.length < n) {
      const i = extraRows.length;
      const p = prevExtras[i] || {};
      extraRows.push({
        name: h('input', { type: 'text', maxlength: 60, autocomplete: 'off', value: p.n && !/^Guest of /.test(p.n) ? p.n : '', placeholder: 'Their name' }),
        meal: inv.askMeal ? mealSel(p.m) : null,
      });
    }
    clear(extras).append(...extraRows.slice(0, n).map((r, i) => h('div', { class: 'rsvp-person' },
      h('label', { class: 'field' }, h('span', null, `Guest ${i + 2}`), r.name), r.meal ? h('label', { class: 'field' }, h('span', null, 'Meal'), r.meal) : null)));
  }
  drawExtras();
  const kids = inv.kids ? h('input', { type: 'number', min: 0, max: 10, value: prev.kids || 0, inputmode: 'numeric' }) : null;
  const diet = inv.diet ? h('textarea', { maxlength: 300, rows: 2, placeholder: 'Allergies, vegetarian, anything we should know' }, prev.diet || '') : null;
  const song = inv.song ? h('input', { type: 'text', maxlength: 120, placeholder: 'Song and artist', value: prev.song || '' }) : null;
  const message = inv.message ? h('textarea', { maxlength: 500, rows: 3, placeholder: 'Optional' }, prev.message || '') : null;

  // Optional selfie with the reply.
  const preview = h('div', { class: 'rsvp-photo-preview' });
  const fileIn = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'hidden', onchange: async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try { photo = await prepareSelfie(file); removePhoto = false; showPhoto(); }
    catch (x) { toast(x.message, 'error'); }
  } });
  function showPhoto() {
    const has = photo || (prev.hasPhoto && !removePhoto);
    clear(preview).append(
      photo ? h('img', { src: URL.createObjectURL(photo), alt: 'Your photo' }) : has ? h('span', { class: 'small muted' }, 'Your photo is saved.') : null,
      h('label', { class: 'btn small' }, has ? 'Take a new photo' : 'Add a photo', fileIn),
      has ? h('button', { class: 'btn small', type: 'button', onclick: () => { photo = null; removePhoto = true; showPhoto(); } }, 'Remove') : null);
  }
  showPhoto();

  function drawAttending() {
    const going = status === 'yes' || status === 'maybe';
    clear(attending).append(
      going && myMeal ? h('label', { class: 'field' }, h('span', null, 'Your meal'), myMeal) : null,
      going && size ? h('label', { class: 'field' }, h('span', null, 'How many in your party?'), size, h('small', null, `Up to ${inv.maxParty}, including you.`)) : null,
      going && size ? extras : null,
      going && kids ? h('label', { class: 'field' }, h('span', null, 'Children coming'), kids) : null,
      going && diet ? h('label', { class: 'field' }, h('span', null, 'Dietary needs'), diet) : null,
      going && song ? h('label', { class: 'field' }, h('span', null, 'Song request'), song, h('small', null, 'What gets you on the dance floor?')) : null,
      status && message ? h('label', { class: 'field' }, h('span', null, 'Message to the host'), message) : null,
      status && inv.photo ? h('div', { class: 'field' }, h('span', null, 'Send a photo with your reply'), preview, h('small', null, 'Optional. Only the host sees it.')) : null);
  }
  for (const [k, label] of Object.entries(STATUS)) {
    statusRow.append(h('button', { type: 'button', role: 'radio', class: `rsvp-choice rsvp-${k}`, 'aria-checked': String(status === k), dataset: { v: k }, onclick: () => {
      status = k;
      for (const b of statusRow.children) b.setAttribute('aria-checked', String(b.dataset.v === k));
      drawAttending();
    } }, label));
  }
  drawAttending();

  const spots = inv.capped && data.spotsLeft != null && data.spotsLeft <= 20
    ? h('p', { class: 'small muted' }, data.spotsLeft ? `${data.spotsLeft} ${data.spotsLeft === 1 ? 'spot' : 'spots'} left.` : 'The guest list is full, but you can still reply Maybe or No.') : null;
  const submit = h('button', { class: 'btn primary big', type: 'submit' }, mine ? 'Update my RSVP' : 'Send my RSVP');
  const form = h('form', { class: 'stack', novalidate: true },
    h('label', { class: 'field' }, h('span', null, 'Your name'), name),
    h('div', { class: 'field' }, h('span', null, 'Will you come?'), statusRow), spots,
    attending, err,
    h('div', { class: 'row' }, submit, mine ? h('button', { class: 'btn', type: 'button', onclick: () => { editing = false; render(); } }, 'Cancel') : null));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const show = (m) => { err.textContent = m; err.hidden = false; };
    if (!name.value.trim()) { name.focus(); return show('Please add your name.'); }
    if (!status) return show('Choose Yes, Maybe or No.');
    const going = status !== 'no';
    const n = size && going ? Number(size.value) - 1 : 0;
    const payload = {
      e: eventId, name: name.value.trim(), status,
      meal: going && myMeal ? myMeal.value : '',
      party: extraRows.slice(0, n).map((r) => ({ n: r.name.value.trim(), m: r.meal ? r.meal.value : '' })),
      kids: going && kids ? Number(kids.value) || 0 : 0,
      diet: going && diet ? diet.value : '', song: going && song ? song.value : '', message: message ? message.value : '',
    };
    if (auth) { payload.r = auth.r; payload.rt = auth.rt; }
    else {
      const pending = store.get(authKey() + ':pending') || { rt: newToken(), clientId: randomId(16) };
      store.set(authKey() + ':pending', pending);
      payload.rt = pending.rt; payload.clientId = pending.clientId;
    }
    if (photo) payload.photo = await blobToBase64(photo);
    if (removePhoto) payload.removePhoto = true;
    submit.disabled = true; submit.textContent = 'Sending…';
    try {
      const r = await api(studio, 'rsvp', payload, { retries: 2, timeout: 60000 });
      auth = { r: r.r, rt: payload.rt };
      store.set(authKey(), auth);
      store.del(authKey() + ':pending');
      try { localStorage.setItem(`ps:rsvpname:${studio}:${eventId}`, payload.name.slice(0, 24)); } catch { /* private mode */ }
      mine = r.rsvp; editing = false;
      await load();
      toast(status === 'no' ? 'Reply sent' : 'RSVP sent. See you there!', 'ok');
      const sec = document.getElementById('rsvp');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
    } catch (x) {
      if (x.code === 'unauthorized') { store.del(authKey()); auth = null; mine = null; }
      show(x.message);
      submit.disabled = false; submit.textContent = mine ? 'Update my RSVP' : 'Send my RSVP';
    }
  });
  return h('section', { class: 'invite-section stack', id: 'rsvp' }, h('h2', null, mine ? 'Change your RSVP' : 'RSVP'),
    inv.deadline ? h('p', { class: 'small muted' }, `Please reply by ${fmtDeadline(inv.deadline)}.`) : null, form);
}

/** Shrink a selfie to at most 1280 px as a JPEG under 1 MB (location data never leaves: canvas drops it). */
async function prepareSelfie(file) {
  if (!/^image\//.test(file.type)) throw new Error('Choose a photo.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That photo is too big.');
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch { throw new Error('This phone saved the photo in a format we can’t read. Try taking it again.'); }
  const scale = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  for (const qy of [0.85, 0.72, 0.6]) {
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', qy));
    if (blob && blob.size <= 950 * 1024) return blob;
  }
  throw new Error('Couldn’t make that photo small enough. Try another one.');
}

boot();
