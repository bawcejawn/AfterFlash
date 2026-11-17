// Exercises backend/Code.gs against the in-memory Apps Script mock.
import assert from 'node:assert/strict';
import { createGas } from './gas-mock.mjs';

let passed = 0;
const tests = [];
const t = (name, fn) => tests.push([name, fn]);

// --- fixtures
function jpegWithExif() {
  const soi = [0xff, 0xd8];
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const exifPayload = [...Buffer.from('Exif\0\0GPS-SECRET-LOCATION')];
  const app1 = [0xff, 0xe1, 0x00, exifPayload.length + 2, ...exifPayload];
  const com = [0xff, 0xfe, 0x00, 0x07, ...Buffer.from('hello')];
  const sos = [0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0x12, 0x34, 0x56, 0xff, 0xd9];
  return Buffer.from([...soi, ...app0, ...app1, ...com, ...sos]);
}
const b64 = (buf) => Buffer.from(buf).toString('base64');
const mp4 = () => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(64, 1)]);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const html = () => Buffer.from('<html><script>alert(1)</script></html>'.padEnd(100, ' '));
let cidN = 0;
const cid = () => 'client' + String(++cidN).padStart(6, '0');

function boot() {
  const gas = createGas();
  gas.ctx.setup();
  const line = gas.logs.find((l) => l.includes('NEW ADMIN KEY'));
  const adminKey = line.split(': ').pop().trim();
  return { gas, post: gas.post, adminKey };
}

function makeEvent(env, settings = {}) {
  const r = env.post({ a: 'adminCreate', k: env.adminKey, settings: { name: 'Sam & Alex', date: '2027-06-01', ...settings } });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r;
}

function joinGuest(env, e, extra = {}) {
  const r = env.post({ a: 'join', e, ...extra });
  assert.equal(r.ok, true, JSON.stringify(r));
  return { g: r.guest.id, t: r.token, r };
}

function upload(env, e, gst, extra = {}) {
  return env.post({ a: 'upload', e, g: gst.g, t: gst.t, kind: 'photo', data: b64(jpegWithExif()), thumb: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10, ...extra });
}

// --- tests
t('setup prints admin key and stores only its hash', () => {
  const env = boot();
  assert.ok(env.adminKey.length >= 40);
  assert.notEqual(env.gas.props.get('ADMIN_KEY_HASH'), env.adminKey);
  assert.equal(env.gas.props.get('ADMIN_KEY_HASH').length, 64);
});

t('admin actions require the admin key', () => {
  const env = boot();
  const r = env.post({ a: 'adminCreate', k: 'nope', settings: { name: 'x' } });
  assert.equal(r.ok, false); assert.equal(r.error, 'unauthorized');
  assert.equal(env.post({ a: 'adminList' }).error, 'unauthorized');
});

t('admin brute force is rate limited', () => {
  const env = boot();
  let last;
  for (let i = 0; i < 25; i++) last = env.post({ a: 'adminCheck', k: 'wrong' + i });
  assert.equal(last.error, 'rate_limited');
});

t('unknown and prototype actions are rejected', () => {
  const env = boot();
  for (const a of ['constructor', '__proto__', 'toString', 'nope', 'setup', 'rotateAdminKey']) {
    const r = env.post({ a });
    assert.equal(r.ok, false, a); assert.equal(r.error, 'bad_request', a);
  }
});

t('create event → public event info, no secrets leaked', () => {
  const env = boot();
  const ev = makeEvent(env);
  assert.match(ev.id, /^[A-Za-z0-9]{10}$/);
  const pub = env.post({ a: 'event', e: ev.id });
  assert.equal(pub.event.name, 'Sam & Alex');
  const s = JSON.stringify(pub);
  assert.ok(!s.includes('hostKey') && !s.includes('folderId') && !s.includes('sheetId') && !s.includes('wallKey'));
});

t('guest join + upload strips EXIF and stores sha256 of stored bytes', () => {
  const env = boot();
  const ev = makeEvent(env);
  const gst = joinGuest(env, ev.id, { label: 'Nana' });
  assert.equal(gst.r.guest.label, 'Nana');
  const up = upload(env, ev.id, gst);
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(up.guest.shotsLeft, 24);
  const file = env.gas.files.get(up.id);
  const stored = env.gas.unsigned(file.blob.bytes);
  assert.ok(!stored.toString('latin1').includes('GPS-SECRET'), 'EXIF must be stripped');
  assert.ok(!stored.toString('latin1').includes('hello'), 'COM must be stripped');
  assert.equal(file.sharing, 'ANYONE_WITH_LINK');
  const host = env.post({ a: 'hostList', e: ev.id, k: ev.hostKey });
  const crypto = await_import_crypto();
  assert.equal(host.items[0].sha, crypto.createHash('sha256').update(stored).digest('hex'));
});

t('previews go to a subfolder; originals stay alone in the event folder', () => {
  const env = boot();
  const ev = makeEvent(env);
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  upload(env, ev.id, joinGuest(env, ev.id));
  const orig = env.gas.files.get(up.id);
  const thumbId = env.post({ a: 'hostList', e: ev.id, k: ev.hostKey }).items.find((x) => x.i === up.id).t;
  const thumb = env.gas.files.get(thumbId);
  assert.equal(thumb.parent.name, 'Previews (used by the app)');
  assert.equal(thumb.parent.parent, orig.parent);
  const subfolders = [...env.gas.files.values()].filter((f) => f.parent === orig.parent && f.name === 'Previews (used by the app)');
  assert.equal(subfolders.length, 1, 'one previews folder, reused');
});

t('recover: missing photos in the event folder are added once; duplicates and other folders ignored', () => {
  const env = boot();
  const ev = makeEvent(env);
  const other = makeEvent(env, { name: 'Other' });
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  const U = env.gas.ctx.Utilities;
  const folder = env.gas.files.get(up.id).parent;
  const orphanBytes = [...jpegWithExif()].map((b) => (b > 127 ? b - 256 : b)).concat([1, 2, 3]);
  folder.createFile(U.newBlob(orphanBytes, 'image/jpeg', 'orphan1.jpg'));
  folder.createFile(U.newBlob(orphanBytes, 'image/jpeg', 'orphan1-retry.jpg')); // duplicate of the orphan
  folder.createFile(U.newBlob(env.gas.files.get(up.id).blob.bytes, 'image/jpeg', 'copy-of-known.jpg')); // duplicate of an album photo
  folder.createFile(U.newBlob('<html>', 'image/jpeg', 'fake.jpg')); // wrong content
  const dry = env.post({ a: 'hostRecover', e: ev.id, k: ev.hostKey, dryRun: true });
  assert.equal(dry.found, 1); assert.equal(dry.duplicates, 2); assert.equal(dry.added, 0);
  assert.equal(env.post({ a: 'hostRecover', e: other.id, k: other.hostKey }).found, 0, 'other event never sees these');
  assert.equal(env.post({ a: 'hostRecover', e: ev.id, k: 'nope' }).error, 'unauthorized');
  const r = env.post({ a: 'hostRecover', e: ev.id, k: ev.hostKey });
  assert.equal(r.added, 1);
  const items = env.post({ a: 'hostList', e: ev.id, k: ev.hostKey }).items;
  assert.equal(items.length, 2);
  assert.ok(items.some((x) => x.g === 'Recovered from Drive'));
  assert.equal(env.post({ a: 'hostRecover', e: ev.id, k: ev.hostKey }).added, 0, 'idempotent');
  assert.equal(env.post({ a: 'list', e: ev.id }).items.length, 2);
});

t('date stamp is off by default for new events', () => {
  const env = boot();
  const ev = makeEvent(env);
  assert.equal(env.post({ a: 'event', e: ev.id }).event.dateStamp, false);
});

t('voice notes: Safari m4a and Firefox ogg accepted, retries are idempotent, duration kept', () => {
  const env = boot();
  const ev = makeEvent(env);
  const g = joinGuest(env, ev.id);
  const m4a = Buffer.concat([Buffer.from([0, 0, 0, 0x1c]), Buffer.from('ftypM4A '), Buffer.alloc(200, 3)]);
  const ogg = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(200, 4)]);
  const a = env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, audio: b64(m4a), dur: 12, clientId: 'note-abc-0001' });
  assert.equal(a.ok, true, JSON.stringify(a));
  const again = env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, audio: b64(m4a), dur: 12, clientId: 'note-abc-0001' });
  assert.equal(again.duplicate, true); assert.equal(again.id, a.id);
  const b = env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, audio: b64(ogg), dur: 3, clientId: 'note-abc-0002' });
  assert.equal(b.ok, true, JSON.stringify(b));
  const notes = env.post({ a: 'guestbookList', e: ev.id }).notes;
  assert.equal(notes.length, 2);
  assert.ok(notes.some((n) => n.d === 12));
  const mimes = notes.map((n) => env.gas.files.get(n.a).blob.mime).sort();
  assert.deepEqual(mimes, ['audio/mp4', 'audio/ogg']);
  assert.equal(env.gas.files.get(notes[0].a).parent.name, 'Guestbook voice messages');
  const listen = env.post({ a: 'hostMedia', e: ev.id, k: ev.hostKey, id: notes[0].a, which: 'note' });
  assert.equal(listen.ok, true); assert.ok(/^audio\//.test(listen.mime));
  const other = makeEvent(env, { name: 'B' });
  assert.equal(env.post({ a: 'hostMedia', e: other.id, k: other.hostKey, id: notes[0].a, which: 'note' }).error, 'not_found');
});

t('rejects non-JPEG photos, html, png and spoofed types', () => {
  const env = boot();
  const ev = makeEvent(env);
  const gst = joinGuest(env, ev.id);
  for (const data of [png(), html(), mp4()]) {
    const r = upload(env, ev.id, gst, { data: b64(data) });
    assert.equal(r.ok, false); assert.equal(r.error, 'bad_type');
  }
  const badThumb = upload(env, ev.id, gst, { thumb: b64(html()) });
  assert.equal(badThumb.error, 'bad_type');
  const notB64 = upload(env, ev.id, gst, { data: '%%%' });
  assert.equal(notB64.error, 'bad_request');
});

t('video upload requires mp4/webm and a preview; can be disabled', () => {
  const env = boot();
  const ev = makeEvent(env);
  const gst = joinGuest(env, ev.id);
  const ok = upload(env, ev.id, gst, { kind: 'video', data: b64(mp4()) });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  const noThumb = upload(env, ev.id, gst, { kind: 'video', data: b64(mp4()), thumb: undefined });
  assert.equal(noThumb.error, 'bad_request');
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { allowVideo: false } });
  const off = upload(env, ev.id, gst, { kind: 'video', data: b64(mp4()) });
  assert.equal(off.error, 'no_video');
});

t('shot limit enforced; refund not abusable; idempotent clientId', () => {
  const env = boot();
  const ev = makeEvent(env, { shotsPerGuest: 2 });
  const gst = joinGuest(env, ev.id);
  const id = cid();
  const a = upload(env, ev.id, gst, { clientId: id });
  const again = upload(env, ev.id, gst, { clientId: id });
  assert.equal(again.duplicate, true);
  assert.equal(again.id, a.id);
  assert.equal(upload(env, ev.id, gst).ok, true);
  const third = upload(env, ev.id, gst);
  assert.equal(third.error, 'no_shots');
});

t('guest tokens are required and bound to the guest', () => {
  const env = boot();
  const ev = makeEvent(env);
  const a = joinGuest(env, ev.id);
  const b = joinGuest(env, ev.id);
  assert.equal(upload(env, ev.id, { g: a.g, t: b.t }).error, 'unauthorized');
  assert.equal(upload(env, ev.id, { g: a.g, t: '' }).error, 'unauthorized');
  // rejoin with own token keeps the same guest
  const re = env.post({ a: 'join', e: ev.id, g: a.g, t: a.t });
  assert.equal(re.guest.id, a.g); assert.equal(re.token, undefined);
});

t('guest limit counts only guests who uploaded', () => {
  const env = boot();
  const ev = makeEvent(env, { maxGuests: 1 });
  const a = joinGuest(env, ev.id);
  const b = joinGuest(env, ev.id);
  assert.equal(upload(env, ev.id, a).ok, true);
  assert.equal(upload(env, ev.id, b).error, 'full');
  assert.equal(upload(env, ev.id, a).ok, true);
});

t('paused / closed / not-open / blocked guest', () => {
  const env = boot();
  const ev = makeEvent(env);
  const gst = joinGuest(env, ev.id);
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { paused: true } });
  assert.equal(upload(env, ev.id, gst).error, 'paused');
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { paused: false, closesAt: '2000-01-01T00:00:00Z' } });
  assert.equal(upload(env, ev.id, gst).error, 'closed');
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { closesAt: '', opensAt: '2999-01-01T00:00:00Z' } });
  assert.equal(upload(env, ev.id, gst).error, 'not_open');
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { opensAt: '' } });
  env.post({ a: 'hostBlockGuest', e: ev.id, k: ev.hostKey, guestId: gst.g, block: true });
  assert.equal(upload(env, ev.id, gst).error, 'blocked');
});

t('reveal-after hides list until revealAt; wall key respects guestGallery off', () => {
  const env = boot();
  const ev = makeEvent(env, { reveal: 'after', revealAt: '2999-01-01T00:00:00Z', guestGallery: false });
  const gst = joinGuest(env, ev.id);
  upload(env, ev.id, gst);
  let l = env.post({ a: 'list', e: ev.id });
  assert.equal(l.revealed, false); assert.equal(l.items.length, 0); assert.equal(l.count, 1);
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { revealAt: '2000-01-01T00:00:00Z' } });
  l = env.post({ a: 'list', e: ev.id });
  assert.equal(l.revealed, true); assert.equal(l.items.length, 0, 'guest gallery off → no items');
  const wallBad = env.post({ a: 'list', e: ev.id, mode: 'wall', wk: 'x'.repeat(32) });
  assert.equal(wallBad.items.length, 0);
  const wk = env.post({ a: 'hostGet', e: ev.id, k: ev.hostKey }).event.wallKey;
  const wall = env.post({ a: 'list', e: ev.id, mode: 'wall', wk });
  assert.equal(wall.items.length, 1);
  assert.equal(wall.items[0].g.startsWith('Guest '), true);
});

t('list version short-circuits when unchanged', () => {
  const env = boot();
  const ev = makeEvent(env);
  const a = env.post({ a: 'list', e: ev.id });
  const b = env.post({ a: 'list', e: ev.id, v: a.v });
  assert.equal(b.unchanged, true);
  upload(env, ev.id, joinGuest(env, ev.id));
  const c = env.post({ a: 'list', e: ev.id, v: a.v });
  assert.ok(!c.unchanged); assert.equal(c.items.length, 1);
});

t('approval mode keeps photos private until approved', () => {
  const env = boot();
  const ev = makeEvent(env, { approval: true });
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  assert.equal(up.status, 'pending');
  assert.equal(env.gas.files.get(up.id).sharing, 'PRIVATE');
  assert.equal(env.post({ a: 'list', e: ev.id }).items.length, 0);
  assert.equal(env.post({ a: 'list', e: ev.id }).pending, 1);
  assert.equal(env.post({ a: 'event', e: ev.id }).event.approval, true);
  env.post({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'approve', ids: [up.id] });
  assert.equal(env.gas.files.get(up.id).sharing, 'ANYONE_WITH_LINK');
  assert.equal(env.post({ a: 'list', e: ev.id }).items.length, 1);
});

t('report hides immediately; host can restore; report limit', () => {
  const env = boot();
  const ev = makeEvent(env);
  const gst = joinGuest(env, ev.id);
  const up = upload(env, ev.id, gst);
  const rep = env.post({ a: 'report', e: ev.id, g: gst.g, t: gst.t, id: up.id });
  assert.equal(rep.ok, true, JSON.stringify(rep));
  assert.equal(env.gas.files.get(up.id).sharing, 'PRIVATE');
  assert.equal(env.post({ a: 'list', e: ev.id }).items.length, 0);
  const hl = env.post({ a: 'hostList', e: ev.id, k: ev.hostKey });
  assert.equal(hl.items[0].s, 'reported'); assert.equal(hl.items[0].r, 1);
  env.post({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'show', ids: [up.id] });
  assert.equal(env.post({ a: 'list', e: ev.id }).items.length, 1);
  for (let i = 0; i < 20; i++) env.post({ a: 'report', e: ev.id, g: gst.g, t: gst.t, id: up.id });
  assert.equal(env.post({ a: 'report', e: ev.id, g: gst.g, t: gst.t, id: up.id }).error, 'rate_limited');
});

t('host key required; wrong key rate-limited; rotate invalidates old', () => {
  const env = boot();
  const ev = makeEvent(env);
  assert.equal(env.post({ a: 'hostGet', e: ev.id, k: 'bad' }).error, 'unauthorized');
  const rot = env.post({ a: 'hostRotateKey', e: ev.id, k: ev.hostKey });
  assert.equal(env.post({ a: 'hostGet', e: ev.id, k: ev.hostKey }).error, 'unauthorized');
  assert.equal(env.post({ a: 'hostGet', e: ev.id, k: rot.hostKey }).ok, true);
});

t('host of event A cannot touch files of event B or arbitrary Drive files', () => {
  const env = boot();
  const A = makeEvent(env);
  const B = makeEvent(env, { name: 'Other' });
  const upB = upload(env, B.id, joinGuest(env, B.id));
  const secret = env.gas.ctx.DriveApp.getRootFolder().createFile(env.gas.ctx.Utilities.newBlob('secret', 'text/plain', 'tax.pdf'));
  for (const id of [upB.id, secret.getId()]) {
    assert.equal(env.post({ a: 'hostMedia', e: A.id, k: A.hostKey, id }).error, 'not_found');
    const m = env.post({ a: 'hostModerate', e: A.id, k: A.hostKey, action: 'delete', ids: [id] });
    assert.equal(m.changed, 0);
  }
  assert.equal(env.gas.files.get(upB.id).trashed, false);
  assert.equal(secret.trashed, false);
  // B's own host can fetch it
  const ok = env.post({ a: 'hostMedia', e: B.id, k: B.hostKey, id: upB.id });
  assert.equal(ok.ok, true); assert.ok(ok.data.length > 10);
});

t('host delete trashes file and thumb and removes from lists/manifest', () => {
  const env = boot();
  const ev = makeEvent(env);
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  const thumbId = env.post({ a: 'hostList', e: ev.id, k: ev.hostKey }).items[0].t;
  env.post({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'delete', ids: [up.id] });
  assert.equal(env.gas.files.get(up.id).trashed, true);
  assert.equal(env.gas.files.get(thumbId).trashed, true);
  assert.equal(env.post({ a: 'hostManifest', e: ev.id, k: ev.hostKey }).items.length, 0);
});

t('event PIN gates join/list and is brute-force limited; wall key bypasses', () => {
  const env = boot();
  const ev = makeEvent(env);
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, pin: '4321' });
  assert.equal(env.post({ a: 'join', e: ev.id }).error, 'pin_required');
  assert.equal(env.post({ a: 'join', e: ev.id, pin: '4321' }).ok, true);
  assert.equal(env.post({ a: 'list', e: ev.id }).error, 'pin_required');
  const wk = env.post({ a: 'hostGet', e: ev.id, k: ev.hostKey }).event.wallKey;
  assert.equal(env.post({ a: 'list', e: ev.id, mode: 'wall', wk }).ok, true);
  let last;
  for (let i = 0; i < 45; i++) last = env.post({ a: 'join', e: ev.id, pin: String(1000 + i) });
  assert.equal(last.error, 'rate_limited');
  assert.equal(env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, pin: '12' }).error, 'bad_request');
});

t('text inputs are sanitised (formula injection, html, length)', () => {
  const env = boot();
  const ev = makeEvent(env, { name: '=IMPORTXML("http://evil","//a")<b>', welcome: 'x'.repeat(999) });
  const pub = env.post({ a: 'event', e: ev.id }).event;
  assert.ok(!pub.name.startsWith('=')); assert.ok(!pub.name.includes('<'));
  assert.equal(pub.welcome.length, 280);
  const g = env.post({ a: 'join', e: ev.id, label: '+cmd|calc' });
  assert.ok(!g.guest.label.startsWith('+'));
  const s = env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { accent: 'red;}</style>', shotsPerGuest: 99999, look: 'evil' } }).event.settings;
  assert.equal(s.accent, '#0f7c7a'); assert.equal(s.shotsPerGuest, 500); assert.equal(s.look, 'classic');
});

t('bad event ids never hit storage', () => {
  const env = boot();
  for (const e of ['', '../x', 'a'.repeat(50), { $ne: 1 }, '<script>']) {
    assert.equal(env.post({ a: 'event', e }).error, 'not_found');
  }
});

t('markArchived validates tx ids; manifest reflects archive index', () => {
  const env = boot();
  const ev = makeEvent(env);
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  env.post({ a: 'hostMarkArchived', e: ev.id, k: ev.hostKey, items: [{ id: up.id, index: 3, tx: '=HYPERLINK("x")' }] });
  let m = env.post({ a: 'hostManifest', e: ev.id, k: ev.hostKey });
  assert.equal(m.items[0].archIndex, 3);
  env.post({ a: 'hostMarkArchived', e: ev.id, k: ev.hostKey, items: [{ id: up.id, index: 4, tx: '0x1220abcdef' }] });
  m = env.post({ a: 'hostManifest', e: ev.id, k: ev.hostKey });
  assert.equal(m.items[0].archIndex, 4);
  const sh = [...env.gas.sheets.values()].find((x) => x.name === 'PhotoShare ' + ev.id).getSheetByName('media');
  assert.ok(!String(sh.rows[1][16]).startsWith('='));
});

t('admin delete requires confirmation and trashes folder', () => {
  const env = boot();
  const ev = makeEvent(env);
  assert.equal(env.post({ a: 'adminDelete', k: env.adminKey, e: ev.id, confirm: 'nope' }).error, 'bad_request');
  assert.equal(env.post({ a: 'adminDelete', k: env.adminKey, e: ev.id, confirm: ev.id }).ok, true);
  assert.equal(env.post({ a: 'event', e: ev.id }).error, 'not_found');
  assert.equal(env.post({ a: 'adminList', k: env.adminKey }).events.length, 0);
});

t('oversized body rejected; malformed JSON rejected', () => {
  const env = boot();
  const r1 = JSON.parse(env.gas.ctx.doPost({ postData: { contents: '{bad' } }).body);
  assert.equal(r1.error, 'bad_request');
  const r2 = JSON.parse(env.gas.ctx.doPost({}).body);
  assert.equal(r2.error, 'bad_request');
});

t('only guests who have taken a photo can report', () => {
  const env = boot();
  const ev = makeEvent(env);
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  const lurker = joinGuest(env, ev.id);
  assert.equal(env.post({ a: 'report', e: ev.id, g: lurker.g, t: lurker.t, id: up.id }).error, 'not_allowed');
  assert.equal(env.post({ a: 'list', e: ev.id }).items.length, 1);
});

t('per-event storage cap stops someone filling the Drive', () => {
  const env = boot();
  const ev = makeEvent(env, { maxStorageMB: 100 });
  const g = joinGuest(env, ev.id);
  assert.equal(upload(env, ev.id, g).ok, true);
  // pretend 100 MB is already used
  const sh = [...env.gas.sheets.values()].find((x) => x.name === 'PhotoShare ' + ev.id).getSheetByName('media');
  sh.rows[1][6] = 100 * 1024 * 1024;
  assert.equal(upload(env, ev.id, g).error, 'full');
});

t('join spam is capped', () => {
  const env = boot();
  const ev = makeEvent(env, { maxGuests: 1 });
  let last;
  for (let i = 0; i < 60; i++) last = env.post({ a: 'join', e: ev.id });
  assert.equal(last.error, 'full');
});

t('thumb proxy only serves visible, revealed photos', () => {
  const env = boot();
  const ev = makeEvent(env);
  const g = joinGuest(env, ev.id);
  const up = upload(env, ev.id, g);
  const ok = env.post({ a: 'thumb', e: ev.id, id: up.id });
  assert.equal(ok.ok, true); assert.ok(ok.data.length > 10);
  env.post({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'hide', ids: [up.id] });
  assert.equal(env.post({ a: 'thumb', e: ev.id, id: up.id }).error, 'not_found');
  env.post({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'show', ids: [up.id] });
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { reveal: 'after', revealAt: '2999-01-01T00:00:00Z' } });
  assert.equal(env.post({ a: 'thumb', e: ev.id, id: up.id }).error, 'not_found');
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { reveal: 'live', guestGallery: false } });
  assert.equal(env.post({ a: 'thumb', e: ev.id, id: up.id }).error, 'not_found');
  const wk = env.post({ a: 'hostGet', e: ev.id, k: ev.hostKey }).event.wallKey;
  assert.equal(env.post({ a: 'thumb', e: ev.id, id: up.id, wk }).ok, true);
  const other = makeEvent(env, { name: 'B' });
  assert.equal(env.post({ a: 'thumb', e: other.id, id: up.id }).error, 'not_found');
});

t('settings updates ignore unknown keys and __proto__', () => {
  const env = boot();
  const ev = makeEvent(env);
  const body = '{"a":"hostUpdate","e":"' + ev.id + '","k":"' + ev.hostKey + '","settings":{"__proto__":{"paused":true},"evil":1,"name":"Ok"}}';
  const r = JSON.parse(env.gas.ctx.doPost({ postData: { contents: body } }).body);
  assert.equal(r.ok, true);
  assert.equal(r.event.settings.paused, false);
  assert.equal(r.event.settings.evil, undefined);
  assert.equal(r.event.settings.name, 'Ok');
});

t('owner can add/remove admins; admins have their own keys and limited rights', () => {
  const env = boot();
  const add = env.post({ a: 'adminAddAdmin', k: env.adminKey, name: 'Sarah' });
  assert.equal(add.ok, true); assert.ok(add.key.length >= 40);
  const sarah = add.key;
  assert.equal(env.post({ a: 'adminCheck', k: sarah }).me.role, 'admin');
  assert.ok(!JSON.stringify(env.gas.props.get('ADMINS')).includes(sarah), 'only the hash is stored');
  // admins can't manage admins
  assert.equal(env.post({ a: 'adminAddAdmin', k: sarah, name: 'Eve' }).error, 'forbidden');
  assert.equal(env.post({ a: 'adminListAdmins', k: sarah }).error, 'forbidden');
  // admin creates own event and can manage it; can't delete the owner's event
  const mine = env.post({ a: 'adminCreate', k: sarah, settings: { name: 'Sarah party' } });
  const owners = makeEvent(env);
  const list = env.post({ a: 'adminList', k: sarah }).events;
  assert.equal(list.find((e) => e.id === mine.id).createdBy, 'Sarah');
  assert.equal(list.find((e) => e.id === owners.id).canManage, false);
  assert.equal(env.post({ a: 'adminDelete', k: sarah, e: owners.id, confirm: owners.id }).error, 'forbidden');
  assert.equal(env.post({ a: 'adminHostLink', k: sarah, e: owners.id }).error, 'forbidden');
  assert.equal(env.post({ a: 'adminHostLink', k: sarah, e: mine.id }).ok, true);
  // owner can manage everything, and revoking works immediately
  const admins = env.post({ a: 'adminListAdmins', k: env.adminKey }).admins;
  assert.equal(admins.length, 1); assert.equal(admins[0].hash, undefined);
  assert.equal(env.post({ a: 'adminRemoveAdmin', k: env.adminKey, id: admins[0].id }).ok, true);
  assert.equal(env.post({ a: 'adminCheck', k: sarah }).error, 'unauthorized');
  assert.equal(env.post({ a: 'adminDelete', k: env.adminKey, e: mine.id, confirm: mine.id }).ok, true);
});

t('Drive refusing link sharing does not lose photos; admin sees the problem', () => {
  const env = boot();
  const ev = makeEvent(env);
  const g = joinGuest(env, ev.id);
  env.gas.faults.sharing = true;
  const up = upload(env, ev.id, g);
  assert.equal(up.ok, true, JSON.stringify(up));
  assert.equal(env.post({ a: 'hostList', e: ev.id, k: ev.hostKey }).items.length, 1);
  assert.equal(env.post({ a: 'thumb', e: ev.id, id: up.id }).ok, true, 'fallback still serves it');
  const probs = env.post({ a: 'adminProblems', k: env.adminKey }).problems;
  assert.ok(probs.length >= 1 && /sharing/i.test(probs[0].m));
  assert.equal(env.post({ a: 'adminClearProblems', k: env.adminKey }).ok, true);
  assert.equal(env.post({ a: 'adminProblems', k: env.adminKey }).problems.length, 0);
});

t('a failure after saving the file leaves no orphan files and refunds the shot', () => {
  const env = boot();
  const ev = makeEvent(env, { shotsPerGuest: 2 });
  const g = joinGuest(env, ev.id);
  const before = [...env.gas.files.values()].filter((f) => f.blob && !f.trashed).length;
  env.gas.faults.append = true;
  const r = upload(env, ev.id, g, { clientId: 'retryme00001' });
  assert.equal(r.ok, false);
  env.gas.faults.append = false;
  const live = [...env.gas.files.values()].filter((f) => f.blob && !f.trashed).length;
  assert.equal(live, before, 'created files were trashed');
  const probs = env.post({ a: 'adminProblems', k: env.adminKey }).problems;
  assert.ok(probs.some((p) => /Unexpected error/.test(p.m)));
  // the retry of the same photo succeeds and the roll is intact
  env.gas.cache.clear();
  const again = upload(env, ev.id, g, { clientId: 'retryme00001' });
  assert.equal(again.ok, true, JSON.stringify(again));
  assert.equal(again.guest.shotsLeft, 1);
});

const webmAudio = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(200, 2)]);

t('favorites: host marks, public list exposes, strangers cannot', () => {
  const env = boot();
  const ev = makeEvent(env);
  const up = upload(env, ev.id, joinGuest(env, ev.id));
  assert.equal(env.post({ a: 'hostFavorite', e: ev.id, k: 'nope', ids: [up.id], fav: true }).error, 'unauthorized');
  assert.equal(env.post({ a: 'hostFavorite', e: ev.id, k: ev.hostKey, ids: [up.id], fav: true }).changed, 1);
  assert.equal(env.post({ a: 'list', e: ev.id }).items[0].f, 1);
  assert.equal(env.post({ a: 'hostList', e: ev.id, k: ev.hostKey }).items[0].fv, true);
  env.post({ a: 'hostFavorite', e: ev.id, k: ev.hostKey, ids: [up.id], fav: false });
  assert.equal(env.post({ a: 'list', e: ev.id }).items[0].f, 0);
});

t('blurry photos are flagged for the host (score sent by the phone)', () => {
  const env = boot();
  const ev = makeEvent(env);
  const g = joinGuest(env, ev.id);
  upload(env, ev.id, g, { blur: 12 });
  upload(env, ev.id, g, { blur: 300 });
  const items = env.post({ a: 'hostList', e: ev.id, k: ev.hostKey }).items;
  assert.equal(items.filter((x) => /blurry/.test(x.f)).length, 1);
});

t('my photos: guest sees own items before reveal; others cannot read them', () => {
  const env = boot();
  const ev = makeEvent(env, { reveal: 'after', revealAt: '2999-01-01T00:00:00Z' });
  const a = joinGuest(env, ev.id);
  const b = joinGuest(env, ev.id);
  const up = upload(env, ev.id, a);
  const mine = env.post({ a: 'mine', e: ev.id, g: a.g, t: a.t });
  assert.equal(mine.items.length, 1);
  assert.equal(env.post({ a: 'mine', e: ev.id, g: b.g, t: b.t }).items.length, 0);
  assert.equal(env.post({ a: 'thumb', e: ev.id, id: up.id, g: a.g, t: a.t }).ok, true);
  assert.equal(env.post({ a: 'photo', e: ev.id, id: up.id, g: a.g, t: a.t }).ok, true);
  assert.equal(env.post({ a: 'photo', e: ev.id, id: up.id, g: b.g, t: b.t }).error, 'not_found');
  assert.equal(env.post({ a: 'photo', e: ev.id, id: up.id }).error, 'not_found');
  assert.equal(env.post({ a: 'photo', e: ev.id, id: up.id, g: a.g, t: b.t }).error, 'not_found');
});

t('guestbook: text + voice, validated, moderated, respects reveal', () => {
  const env = boot();
  const ev = makeEvent(env);
  const g = joinGuest(env, ev.id, { label: 'Nana' });
  assert.equal(env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, text: '' }).error, 'bad_request');
  assert.equal(env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, text: 'hi', audio: b64(html()) }).error, 'bad_type');
  const n1 = env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, text: '=cheers <b>love</b>' });
  assert.equal(n1.ok, true, JSON.stringify(n1));
  const n2 = env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, text: '', audio: b64(webmAudio()) });
  assert.equal(n2.ok, true, JSON.stringify(n2));
  let list = env.post({ a: 'guestbookList', e: ev.id }).notes;
  assert.equal(list.length, 2);
  assert.ok(!list[0].text.startsWith('=') && !list[0].text.includes('<'));
  assert.equal(list[0].g, 'Nana');
  const audioFile = env.gas.files.get(list.find((x) => x.a).a);
  assert.equal(audioFile.blob.mime, 'audio/webm'); assert.equal(audioFile.sharing, 'ANYONE_WITH_LINK');
  env.post({ a: 'hostGuestbookModerate', e: ev.id, k: ev.hostKey, action: 'hide', ids: [n2.id] });
  assert.equal(audioFile.sharing, 'PRIVATE');
  assert.equal(env.post({ a: 'guestbookList', e: ev.id }).notes.length, 1);
  assert.equal(env.post({ a: 'hostGuestbook', e: ev.id, k: ev.hostKey }).notes.length, 2);
  // limits + turning it off
  const g2 = joinGuest(env, ev.id);
  for (let i = 0; i < 4; i++) env.post({ a: 'guestbookAdd', e: ev.id, g: g2.g, t: g2.t, text: 'x' + i });
  assert.equal(env.post({ a: 'guestbookAdd', e: ev.id, g: g2.g, t: g2.t, text: 'again' }).error, 'rate_limited');
  env.post({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { guestbook: false } });
  assert.equal(env.post({ a: 'guestbookAdd', e: ev.id, g: g.g, t: g.t, text: 'x' }).error, 'disabled');
  assert.equal(env.post({ a: 'guestbookList', e: ev.id }).notes.length, 0);
});

t('admins can open dashboards for events they manage with their own key', () => {
  const env = boot();
  const sarah = env.post({ a: 'adminAddAdmin', k: env.adminKey, name: 'Sarah' }).key;
  const hers = env.post({ a: 'adminCreate', k: sarah, settings: { name: 'Hers' } });
  const owners = makeEvent(env);
  assert.equal(env.post({ a: 'hostGet', e: hers.id, k: 'admin:' + sarah }).ok, true);
  assert.equal(env.post({ a: 'hostGet', e: owners.id, k: 'admin:' + sarah }).error, 'forbidden');
  assert.equal(env.post({ a: 'hostGet', e: owners.id, k: 'admin:' + env.adminKey }).ok, true);
  assert.equal(env.post({ a: 'hostGet', e: owners.id, k: 'admin:wrong' }).error, 'unauthorized');
  assert.equal(env.post({ a: 'hostList', e: hers.id, k: 'admin:' + sarah }).ok, true);
});

// tiny helper so the test above can stay sync
import nodeCrypto from 'node:crypto';
function await_import_crypto() { return nodeCrypto; }

for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok -', name); }
  catch (e) { console.log('FAIL -', name); console.log(e); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} backend tests passed`);
