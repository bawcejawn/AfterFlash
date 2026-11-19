// Host dashboard: the Invitations tab (invite details, RSVP questions, replies, CSV).
import { h, clear, toast, link, qrSvg, copy, isoToLocalInput, localInputToIso, base64ToBytes, blobToBase64, whenVisible, pool } from './util.js';
import { api } from './api.js';
import { logoBytesOk } from './brand.js';

const STATUS = { yes: 'Coming', maybe: 'Maybe', no: 'Can’t come' };
const photoPool = pool(3);

/** ctx: { studio, eventId, key, getEv, setEv, body } */
export function invitationsTab(ctx) {
  const { studio, eventId, key, body } = ctx;
  const ev = ctx.getEv();
  const i = ev.settings.invite || {};
  const url = link('invite.html', { e: eventId, s: studio });
  const replies = h('div', { class: 'stack' }, h('p', { class: 'muted' }, 'Loading replies…'));

  async function save(invite, msg) {
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      const r = await api(studio, 'hostUpdate', { e: eventId, k: key, settings: { invite: { ...invite, tz } } });
      ctx.setEv(r.event);
      toast(msg || 'Invitation saved', 'ok');
      return true;
    } catch (e) { toast(e.message, 'error'); return false; }
  }

  // ---- on/off + share
  const onOff = h('section', { class: 'panel stack' },
    h('div', { class: 'row spread' },
      h('div', null, h('h2', null, 'Invitation'),
        h('p', { class: 'muted', style: null }, i.on ? 'Your invitation is open. Anyone with the link can RSVP.' : 'Turn it on to share an invitation where guests RSVP, with an optional photo.')),
      h('button', { class: i.on ? 'btn' : 'btn primary', onclick: async () => { if (await save({ ...i, on: !i.on }, i.on ? 'Invitation turned off' : 'Invitation is open')) ctx.rerender(); } },
        i.on ? 'Turn off' : 'Turn on invitation')),
    i.on ? h('div', { class: 'row' },
      h('div', { class: 'qr-box' }, qrSvg(url)),
      h('div', { class: 'stack grow' },
        h('label', { class: 'field' }, h('span', null, 'Invitation link'),
          h('div', { class: 'linkline' }, h('input', { type: 'text', readonly: true, value: url, onfocus: (e) => e.target.select() }),
            h('button', { class: 'btn small', onclick: () => copy(url) }, 'Copy'),
            h('a', { class: 'btn small', href: url, target: '_blank', rel: 'noopener' }, 'Preview')),
          h('small', null, 'Text or email this link, or print the QR code on paper invitations. On the event day the same link shows a big “Open the camera” button.')),
        h('button', { class: 'btn small', onclick: () => downloadQr(url) }, 'Download QR code'))) : null);

  body.append(h('div', { class: 'invite-host' }, onOff, i.on ? replies : null, detailsForm()));
  if (i.on) loadReplies();

  // ---- replies
  async function loadReplies() {
    let r;
    try { r = await api(studio, 'hostRsvps', { e: eventId, k: key }); }
    catch (e) { clear(replies).append(h('p', { class: 'form-error' }, e.message)); return; }
    const t = r.totals;
    let filter = 'all', query = '';
    const list = h('div', { class: 'rsvp-list' });
    const search = h('input', { type: 'search', placeholder: 'Search names', 'aria-label': 'Search replies', oninput: (e) => { query = e.target.value.trim().toLowerCase(); draw(); } });
    const filters = h('div', { class: 'row' }, ...[['all', `All (${r.rsvps.length})`], ['yes', `Coming (${t.yes})`], ['maybe', `Maybe (${t.maybe})`], ['no', `Can’t come (${t.no})`]].map(([k, label]) =>
      h('button', { class: 'btn small', 'aria-pressed': String(k === filter), dataset: { f: k }, onclick: (e) => {
        filter = k;
        for (const b of filters.children) b.setAttribute('aria-pressed', String(b.dataset.f === k));
        draw();
      } }, label)));
    function draw() {
      const rows = r.rsvps.filter((x) => (filter === 'all' || x.status === filter) && (!query || [x.name, ...x.party.map((p) => p.n)].join(' ').toLowerCase().includes(query)));
      clear(list).append(...(rows.length ? rows.map(row) : [h('p', { class: 'muted' }, r.rsvps.length ? 'No replies match.' : 'No replies yet. Share the invitation link to get started.')]));
    }
    function row(x) {
      const thumb = h('div', { class: 'thumb', 'aria-hidden': 'true' }, (x.name || '?').trim()[0].toUpperCase());
      if (x.hasPhoto) whenVisible(thumb, () => photoPool(() => loadPhoto(x.id)).then((src) => {
        if (!src) return;
        const img = h('img', { class: 'thumb', src, alt: `Photo from ${x.name}` });
        thumb.replaceWith(img);
        img.addEventListener('click', () => window.open(src, '_blank', 'noopener'));
      }));
      const people = x.status === 'no' ? '' : x.party.map((p) => (p.m ? `${p.n} (${p.m})` : p.n)).join(', ');
      return h('div', { class: 'rsvp-row' }, thumb,
        h('div', null,
          h('h3', null, x.name, h('span', { class: `rsvp-pill rsvp-${x.status}` }, STATUS[x.status]),
            x.status !== 'no' ? h('span', { class: 'small muted' }, `${x.party.length + x.kids} ${x.party.length + x.kids === 1 ? 'person' : 'people'}`) : null),
          people ? h('p', null, people) : null,
          x.kids ? h('p', null, `Children: ${x.kids}`) : null,
          x.diet ? h('p', null, `Dietary: ${x.diet}`) : null,
          x.song ? h('p', null, `Song: ${x.song}`) : null,
          x.message ? h('p', null, `“${x.message}”`) : null,
          h('p', { class: 'muted' }, `Replied ${new Date(x.updated).toLocaleString()}`)),
        h('button', { class: 'btn small danger', 'aria-label': `Delete reply from ${x.name}`, onclick: async () => {
          if (!confirm(`Delete the reply from ${x.name}? This can’t be undone.`)) return;
          try { await api(studio, 'hostRsvpDelete', { e: eventId, k: key, ids: [x.id] }); toast('Reply deleted', 'ok'); loadReplies(); }
          catch (e) { toast(e.message, 'error'); }
        } }, 'Delete'));
    }
    draw();
    const meals = Object.entries(t.meals || {});
    clear(replies).append(
      h('div', { class: 'row spread' }, h('h2', null, 'Replies'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: loadReplies }, 'Refresh'),
          h('button', { class: 'btn small', disabled: !r.rsvps.length, onclick: () => downloadCsv(r.rsvps, ev.name) }, 'Download guest list (CSV)'))),
      h('div', { class: 'rsvp-totals' },
        h('div', null, h('b', null, String(t.yesPeople)), h('span', null, r.cap ? `coming, of ${r.cap} spots` : 'people coming')),
        t.yesKids ? h('div', null, h('b', null, String(t.yesKids)), h('span', null, 'of them children')) : null,
        h('div', null, h('b', null, String(t.maybePeople)), h('span', null, 'maybe')),
        h('div', null, h('b', null, String(t.no)), h('span', null, 'can’t come'))),
      meals.length ? h('div', null, h('h3', null, 'Meals'), h('div', { class: 'meal-list' }, meals.map(([m, n]) => h('span', { class: 'rsvp-pill' }, `${m}: ${n}`)))) : null,
      h('div', { class: 'row' }, search), filters, list);
  }

  const photoUrls = new Map();
  async function loadPhoto(id) {
    if (photoUrls.has(id)) return photoUrls.get(id);
    try {
      const r = await api(studio, 'hostRsvpPhoto', { e: eventId, k: key, id }, { retries: 1 });
      const bytes = base64ToBytes(r.data);
      if (!logoBytesOk('image/jpeg', bytes)) return '';
      const u = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
      photoUrls.set(id, u);
      return u;
    } catch { return ''; }
  }

  // ---- details + questions
  function detailsForm() {
    const inp = (name, attrs = {}) => h('input', { name, ...attrs });
    const check = (name, label, help, on) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: on }), h('span', null, label, help ? h('small', null, help) : null));
    const meals = [0, 1, 2, 3].map((n) => inp('meal' + n, { type: 'text', maxlength: 40, value: (i.meals || [])[n] || '', placeholder: ['e.g. Chicken', 'e.g. Fish', 'e.g. Vegetarian', 'Optional'][n] }));
    const coverBox = h('div', { class: 'logo-edit' });
    const showCover = () => {
      const cur = ctx.getEv();
      clear(coverBox).append(
        h('span', { class: 'small muted' }, cur.coverV ? 'A cover photo is set.' : 'No cover photo yet.'),
        h('label', { class: 'btn small' }, cur.coverV ? 'Change cover photo' : 'Upload cover photo',
          h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden', onchange: (e) => setCover(e.target.files[0], e.target) })),
        cur.coverV ? h('button', { class: 'btn small', type: 'button', onclick: () => setCover(null) }, 'Remove') : null);
    };
    async function setCover(file, input) {
      if (input) input.value = '';
      try {
        const data = file ? await blobToBase64(await prepareCover(file)) : undefined;
        const r = await api(studio, 'hostSetCover', { e: eventId, k: key, data }, { retries: 1, timeout: 60000 });
        ctx.setEv({ ...ctx.getEv(), coverV: r.coverV });
        toast(file ? 'Cover photo saved' : 'Cover photo removed', 'ok');
        showCover();
      } catch (e) { toast(e.message, 'error'); }
    }
    showCover();
    const form = h('form', { class: 'stack' },
      h('fieldset', null, h('legend', null, 'Invitation details'),
        h('p', { class: 'small muted' }, `The event name (${ev.name}), logo, colour and heading style come from Settings.`),
        h('div', { class: 'grid-form' },
          h('label', { class: 'field' }, h('span', null, 'Hosted by'), inp('hosts', { type: 'text', maxlength: 80, value: i.hosts || '', placeholder: 'e.g. Sam & Alex' }), h('small', null, 'Shown as “Sam & Alex invite you to…”')),
          h('label', { class: 'field' }, h('span', null, 'Starts'), inp('startsAt', { type: 'datetime-local', value: isoToLocalInput(i.startsAt) })),
          h('label', { class: 'field' }, h('span', null, 'Ends'), inp('endsAt', { type: 'datetime-local', value: isoToLocalInput(i.endsAt) }), h('small', null, 'Optional. Used for the calendar button.')),
          h('label', { class: 'field' }, h('span', null, 'Venue'), inp('venue', { type: 'text', maxlength: 100, value: i.venue || '', placeholder: 'e.g. Rose Hall' })),
          h('label', { class: 'field' }, h('span', null, 'Address'), inp('address', { type: 'text', maxlength: 200, value: i.address || '' }), h('small', null, 'Guests get an “Open in Maps” button.')),
          h('label', { class: 'field' }, h('span', null, 'Dress code'), inp('dress', { type: 'text', maxlength: 80, value: i.dress || '', placeholder: 'Optional' }))),
        h('label', { class: 'field' }, h('span', null, 'A note to your guests'), h('textarea', { name: 'note', maxlength: 1000, rows: 4 }, i.note || ''), h('small', null, 'Parking, hotel, gifts, the schedule… Line breaks are kept.')),
        h('div', { class: 'field' }, h('span', null, 'Cover photo'), coverBox, h('small', null, 'Shown at the top of the invitation. Wide photos look best.'))),
      h('fieldset', null, h('legend', null, 'Replies'),
        h('div', { class: 'grid-form' },
          h('label', { class: 'field' }, h('span', null, 'Reply by'), inp('deadline', { type: 'datetime-local', value: isoToLocalInput(i.deadline) }), h('small', null, 'After this, guests can’t reply or change their answer. Blank means no deadline.')),
          h('label', { class: 'field' }, h('span', null, 'Guest limit'), inp('cap', { type: 'number', min: 0, max: 5000, value: i.cap || 0 }), h('small', null, 'Most people who can say “Yes”, counting plus-ones and children. 0 means no limit.'))),
        check('photo', 'Let guests send a photo with their reply', ev.encrypted ? 'Not available for private-storage events.' : 'Optional for guests. Only you see the photos.', i.photo !== false),
        check('plusOnes', 'Ask about plus-ones and their names', null, !!i.plusOnes),
        h('label', { class: 'field' }, h('span', null, 'Largest party per reply'), inp('maxParty', { type: 'number', min: 1, max: 10, value: i.maxParty || 2 }), h('small', null, 'Including the person replying.')),
        check('kids', 'Ask how many children are coming', null, !!i.kids),
        check('askMeal', 'Ask each guest to choose a meal', 'Fill in up to 4 choices below.', !!i.askMeal),
        h('div', { class: 'grid-form' }, meals),
        check('diet', 'Ask about allergies and dietary needs', null, !!i.diet),
        check('song', 'Ask for a song request', null, !!i.song),
        check('message', 'Let guests leave you a message', null, i.message !== false)),
      h('fieldset', null, h('legend', null, 'Privacy'),
        check('whoComing', 'Show “Who’s coming” on the invitation', 'Lists first names and last initials of guests who said Yes. Photos are never shown.', !!i.whoComing)),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save invitation')));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const next = {
        on: !!i.on, hosts: fd.get('hosts'), startsAt: localInputToIso(fd.get('startsAt')), endsAt: localInputToIso(fd.get('endsAt')),
        venue: fd.get('venue'), address: fd.get('address'), dress: fd.get('dress'), note: fd.get('note'),
        deadline: localInputToIso(fd.get('deadline')), cap: Number(fd.get('cap')) || 0, maxParty: Number(fd.get('maxParty')) || 2,
        meals: [0, 1, 2, 3].map((n) => String(fd.get('meal' + n) || '').trim()).filter(Boolean),
      };
      for (const k of ['photo', 'plusOnes', 'kids', 'askMeal', 'diet', 'song', 'message', 'whoComing']) next[k] = fd.get(k) === 'on';
      if (next.askMeal && !next.meals.length) { toast('Add at least one meal choice, or turn off the meal question.', 'error'); return; }
      if (next.endsAt && next.startsAt && Date.parse(next.endsAt) <= Date.parse(next.startsAt)) { toast('The end time must be after the start time.', 'error'); return; }
      if (await save(next)) ctx.rerender();
    });
    return form;
  }
}

function downloadQr(url) {
  const blob = new Blob([new XMLSerializer().serializeToString(qrSvg(url))], { type: 'image/svg+xml' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'invitation-qr.svg' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function downloadCsv(rsvps, name) {
  // Every cell is quoted, and a leading = + - @ is neutralised so spreadsheets never run it as a formula.
  const q = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/^([=+\-@])/, "'$1") + '"';
  const rows = [['Name', 'Reply', 'Party size', 'Guests (meal)', 'Children', 'Dietary needs', 'Song request', 'Message', 'Photo', 'Replied']];
  for (const x of rsvps) {
    rows.push([x.name, STATUS[x.status], x.status === 'no' ? 0 : x.party.length + x.kids, x.status === 'no' ? '' : x.party.map((p) => (p.m ? `${p.n} (${p.m})` : p.n)).join('; '),
      x.kids, x.diet, x.song, x.message, x.hasPhoto ? 'Yes' : '', new Date(x.updated).toISOString().slice(0, 16).replace('T', ' ')]);
  }
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${String(name || 'guests').replace(/[^\w -]+/g, '').trim() || 'guests'} - RSVPs.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Shrink a cover photo to at most 1600 px wide, under ~650 KB. */
async function prepareCover(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP image.');
  if (file.size > 30 * 1024 * 1024) throw new Error('That image is too big.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  for (const qy of [0.85, 0.75, 0.62, 0.5]) {
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', qy));
    if (blob && blob.size <= 650 * 1024) return blob;
  }
  throw new Error('Couldn’t make that photo small enough. Try another one.');
}
