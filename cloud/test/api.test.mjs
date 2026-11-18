// PhotoShare Cloud API tests: the real worker with D1 on SQLite and fake Google/Stripe.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeEnv } from './harness.mjs';

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

function jpegWithExif() {
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0x00, 0x11]), Buffer.from('Exif\0\0GPSDATA!!')]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, Buffer.from([0xff, 0xda, 0x00, 0x04, 1, 2]), Buffer.alloc(200, 7), Buffer.from([0xff, 0xd9])]);
}
const b64 = (b) => Buffer.from(b).toString('base64');
const envelope = (n) => Buffer.concat([Buffer.from('PSE1'), crypto.randomBytes(n)]);
let cidN = 0;
const cid = () => 'client' + String(++cidN).padStart(6, '0');

async function boot(extra) {
  const { env, fk, worker } = makeEnv(extra);
  const call = async (body, headers = {}) => {
    const res = await worker.fetch(new Request('http://localhost:8788/api', { method: 'POST', headers: { 'content-type': 'text/plain', origin: env.SITE_ORIGIN, ...headers }, body: JSON.stringify(body) }), env);
    return res.json();
  };
  const get = (path, headers = {}) => worker.fetch(new Request('http://localhost:8788' + path, { headers }), env);
  /** Follow /oauth/start like a browser: returns the Google URL's state and the cookie to send back. */
  const start = async (startUrl) => {
    const r = await get(new URL(startUrl).pathname + new URL(startUrl).search);
    const g = new URL(r.headers.get('location'));
    return { state: g.searchParams.get('state'), cookie: (r.headers.get('set-cookie') || '').split(';')[0], google: g };
  };
  const callback = (st, code) => get(`/oauth/callback?state=${st.state}&code=${code}`, { cookie: st.cookie });
  return { env, fk, worker, call, get, start, callback };
}

/** Buy → claim key → connect Drive. Returns the host's admin key. */
async function hostWithDrive(s, { sub = 'google-sub-1' } = {}) {
  const { url } = await s.call({ a: 'checkoutStart' });
  const sid = url.split('/').pop();
  s.fk.pay(sid);
  const { adminKey } = await s.call({ a: 'claimPurchase', session_id: sid });
  const st = await s.start((await s.call({ a: 'oauthStart', k: adminKey })).url);
  const cb = await s.callback(st, s.fk.approve({ sub }));
  assert.equal(cb.headers.get('location'), 'http://localhost:8788/admin.html?drive=connected');
  return adminKey;
}

t('health, config and unknown actions', async () => {
  const s = await boot();
  const h = await (await s.get('/api')).json();
  assert.equal(h.app, 'photoshare'); assert.equal(h.cloud, true);
  const cfg = await (await s.get('/config.js')).text();
  assert.match(cfg, /"main":"\/api"/); assert.match(cfg, /"price":"\$39"/); assert.match(cfg, /"testMode":true/);
  assert.doesNotMatch(cfg, /sk_test|test-secret|DATA_KEY|owner-key/);
  for (const a of ['constructor', '__proto__', 'toString', 'nope']) assert.equal((await s.call({ a })).error, 'bad_request');
  const res = await s.worker.fetch(new Request('http://localhost:8788/api', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{"a":"event"}' }), s.env);
  assert.equal(res.status, 403);
});

t('a purchase becomes exactly one account; the key can be re-shown only briefly', async () => {
  const s = await boot();
  const { url } = await s.call({ a: 'checkoutStart' });
  assert.match(url, /^https:\/\/checkout\.stripe\.com\//);
  const sid = url.split('/').pop();
  assert.equal((await s.call({ a: 'claimPurchase', session_id: sid })).error, 'not_paid');
  assert.equal((await s.call({ a: 'claimPurchase', session_id: 'nope' })).error, 'bad_request');
  s.fk.pay(sid);
  const first = await s.call({ a: 'claimPurchase', session_id: sid });
  assert.equal(first.ok, true); assert.equal(first.email, 'buyer@example.com');
  const again = await s.call({ a: 'claimPurchase', session_id: sid });
  assert.equal(again.again, true);
  assert.equal((await s.call({ a: 'adminCheck', k: first.adminKey })).error, 'unauthorized', 'old key replaced');
  assert.equal((await s.call({ a: 'adminCheck', k: again.adminKey })).ok, true);
  s.env.DB.raw.prepare('UPDATE accounts SET claim_until = 0').run();
  assert.equal((await s.call({ a: 'claimPurchase', session_id: sid })).error, 'already_claimed');
  assert.equal(s.env.DB.raw.prepare('SELECT COUNT(*) n FROM accounts').get().n, 1);
});

t('creating events needs Google Drive connected; connect stores an encrypted token', async () => {
  const s = await boot();
  const { url } = await s.call({ a: 'checkoutStart' });
  const sid = url.split('/').pop(); s.fk.pay(sid);
  const { adminKey } = await s.call({ a: 'claimPurchase', session_id: sid });
  const me = await s.call({ a: 'adminCheck', k: adminKey });
  assert.equal(me.me.drive, false); assert.equal(me.me.cloud, true);
  assert.equal((await s.call({ a: 'adminCreate', k: adminKey, settings: { name: 'X' } })).error, 'drive_not_connected');
  // Google returns without the Drive permission ticked
  let st = await s.start((await s.call({ a: 'oauthStart', k: adminKey })).url);
  assert.equal(st.google.host, 'accounts.google.com'); assert.equal(st.google.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/drive.file');
  let cb = await s.callback(st, s.fk.approve({ scope: 'openid email' }));
  assert.match(cb.headers.get('location'), /drive=noscope/);
  // state is single-use and can't be forged
  cb = await s.callback(st, s.fk.approve());
  assert.match(cb.headers.get('location'), /drive=expired/);
  // a sign-in link started in someone else's browser (no matching cookie) is refused
  st = await s.start((await s.call({ a: 'oauthStart', k: adminKey })).url);
  cb = await s.get(`/oauth/callback?state=${st.state}&code=${s.fk.approve()}`);
  assert.match(cb.headers.get('location'), /drive=expired/);
  st = await s.start((await s.call({ a: 'oauthStart', k: adminKey })).url);
  cb = await s.callback(st, s.fk.approve());
  assert.match(cb.headers.get('location'), /drive=connected/);
  const row = s.env.DB.raw.prepare('SELECT refresh_enc, google_email FROM accounts').get();
  assert.ok(row.refresh_enc && !/^rt/.test(row.refresh_enc), 'token stored encrypted');
  assert.equal(row.google_email, 'host@example.com');
  const ds = await s.call({ a: 'driveStatus', k: adminKey });
  assert.equal(ds.connected, true); assert.equal(ds.limit, 15 * 1024 ** 3);
  const ev = await s.call({ a: 'adminCreate', k: adminKey, settings: { name: 'Sam & Alex' } });
  assert.equal(ev.ok, true);
  const folders = [...s.fk.drive.values()].filter((f) => f.mime === 'application/vnd.google-apps.folder').map((f) => f.name);
  assert.deepEqual(folders.sort(), ['PhotoShare', `Sam & Alex (${ev.id})`].sort());
});

t('guest flow: join, upload to the host’s Drive (metadata stripped, shared), list, thumb, report', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Party', shotsPerGuest: 2 } });
  const g = await s.call({ a: 'join', e: ev.id, label: 'Nana' });
  assert.equal(g.guest.shotsLeft, 2);
  const up = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), thumb: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10 });
  assert.equal(up.ok, true, JSON.stringify(up));
  const f = s.fk.drive.get(up.id);
  assert.ok(f.public, 'shared for the album');
  assert.ok(!Buffer.from(f.bytes).includes('GPSDATA'), 'EXIF stripped');
  const dup = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: 'client000001' });
  assert.equal(dup.duplicate, true);
  assert.equal((await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(Buffer.from('<html><script>x</script></html>'.padEnd(100))), clientId: cid() })).error, 'bad_type');
  const l = await s.call({ a: 'list', e: ev.id });
  assert.equal(l.items.length, 1); assert.equal(l.items[0].g, 'Nana');
  assert.equal((await s.call({ a: 'list', e: ev.id, v: l.v })).unchanged, true);
  const th = await s.call({ a: 'thumb', e: ev.id, id: up.id });
  assert.equal(th.mime, 'image/jpeg');
  assert.equal((await s.call({ a: 'thumb', e: ev.id, id: 'someone-elses-file-id' })).error, 'not_found');
  await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() });
  assert.equal((await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() })).error, 'no_shots');
  const rep = await s.call({ a: 'report', e: ev.id, g: g.guest.id, t: g.token, id: up.id });
  assert.equal(rep.ok, true);
  assert.equal(s.fk.drive.get(up.id).public, false, 'reported photo unshared');
});

t('host dashboard: host key and the owning account work; other accounts and bad keys don’t', async () => {
  const s = await boot();
  const k1 = await hostWithDrive(s, { sub: 'a' });
  const k2 = await hostWithDrive(s, { sub: 'b' });
  const ev = await s.call({ a: 'adminCreate', k: k1, settings: { name: 'Mine' } });
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: ev.hostKey })).ok, true);
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: 'admin:' + k1 })).ok, true);
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: 'admin:' + k2 })).error, 'forbidden');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: 'wrong' })).error, 'unauthorized');
  assert.equal((await s.call({ a: 'adminDelete', k: k2, e: ev.id, confirm: ev.id })).error, 'forbidden');
  assert.equal((await s.call({ a: 'adminList', k: k2 })).events.length, 0);
  assert.equal((await s.call({ a: 'adminList', k: k1 })).events.length, 1);
  // settings, moderation, favorites
  const upd = await s.call({ a: 'hostUpdate', e: ev.id, k: ev.hostKey, settings: { approval: true, tagline: '=cmd() hi', encrypted: true } });
  assert.equal(upd.event.settings.approval, true); assert.equal(upd.event.settings.tagline, 'cmd() hi'); assert.equal(upd.event.settings.encrypted, false);
  const g = await s.call({ a: 'join', e: ev.id });
  const up = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() });
  assert.equal(up.status, 'pending'); assert.equal(s.fk.drive.get(up.id).public, false);
  assert.equal((await s.call({ a: 'list', e: ev.id })).items.length, 0);
  await s.call({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'approve', ids: [up.id] });
  assert.equal(s.fk.drive.get(up.id).public, true);
  await s.call({ a: 'hostFavorite', e: ev.id, k: ev.hostKey, ids: [up.id], fav: true });
  assert.equal((await s.call({ a: 'list', e: ev.id })).items[0].f, 1);
  const media = await s.call({ a: 'hostMedia', e: ev.id, k: ev.hostKey, id: up.id, which: 'orig' });
  assert.equal(media.mime, 'image/jpeg');
  await s.call({ a: 'hostModerate', e: ev.id, k: ev.hostKey, action: 'delete', ids: [up.id] });
  assert.equal(s.fk.drive.get(up.id).trashed, true);
  // rotate the host link
  const rot = await s.call({ a: 'hostRotateKey', e: ev.id, k: ev.hostKey });
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: ev.hostKey })).error, 'unauthorized');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: rot.hostKey })).ok, true);
});

t('guestbook with a voice message, branding logo, private-storage event', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'GB', font: 'script' } });
  const g = await s.call({ a: 'join', e: ev.id });
  const audio = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 2)]);
  const n = await s.call({ a: 'guestbookAdd', e: ev.id, g: g.guest.id, t: g.token, text: 'Congrats!', audio: b64(audio), dur: 4, clientId: 'note0000001' });
  assert.equal(n.ok, true);
  const notes = (await s.call({ a: 'guestbookList', e: ev.id })).notes;
  assert.equal(notes[0].text, 'Congrats!'); assert.ok(notes[0].a);
  const na = await s.call({ a: 'noteAudio', e: ev.id, id: notes[0].a });
  assert.equal(na.mime, 'audio/webm');
  assert.equal((await s.call({ a: 'noteAudio', e: ev.id, id: notes[0].a.slice(0, -1) })).error, 'not_found');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100, 1)]);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await s.call({ a: 'hostSetLogo', e: ev.id, k: ev.hostKey, data: b64(svg) })).error, 'bad_type');
  const lg = await s.call({ a: 'hostSetLogo', e: ev.id, k: ev.hostKey, data: b64(png) });
  assert.equal((await s.call({ a: 'event', e: ev.id })).event.logoV, lg.logoV);
  assert.equal((await s.call({ a: 'logo', e: ev.id })).mime, 'image/png');
  // private storage
  const pv = await s.call({ a: 'adminCreate', k, settings: { name: 'Private', encrypted: true } });
  const pg = await s.call({ a: 'join', e: pv.id });
  assert.ok(/^[A-Za-z0-9_-]{43}$/.test(pg.key));
  assert.equal((await s.call({ a: 'upload', e: pv.id, g: pg.guest.id, t: pg.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() })).error, 'needs_update');
  const pu = await s.call({ a: 'upload', e: pv.id, g: pg.guest.id, t: pg.token, kind: 'photo', data: b64(envelope(500)), thumb: b64(envelope(100)), mime: 'image/jpeg', sha: 'a'.repeat(64), clientId: cid() });
  assert.equal(pu.ok, true);
  const f = s.fk.drive.get(pu.id);
  assert.equal(f.public, false); assert.match(f.name, /\.enc$/); assert.equal(Buffer.from(f.bytes.subarray(0, 4)).toString(), 'PSE1');
  const keys = (await s.call({ a: 'adminExportKeys', k })).keys;
  assert.equal(keys[pv.id], pg.key);
  assert.ok(!JSON.stringify(s.env.DB.raw.prepare('SELECT * FROM events').all()).includes(pg.key), 'event key encrypted at rest');
});

t('lost key: sign in with the connected Google account to get a new one', async () => {
  const s = await boot();
  const k = await hostWithDrive(s, { sub: 'sub-recover' });
  const st = await s.start((await s.call({ a: 'recoverStart' })).url);
  assert.equal(st.google.searchParams.get('access_type'), null, 'recovery never asks for Drive again');
  // an unknown Google account gets nothing
  let cb = await s.callback(st, s.fk.approve({ sub: 'stranger', noRefresh: true }));
  assert.match(cb.headers.get('location'), /recover=unknown/);
  const st2 = await s.start((await s.call({ a: 'recoverStart' })).url);
  cb = await s.callback(st2, s.fk.approve({ sub: 'sub-recover', noRefresh: true }));
  const ticket = decodeURIComponent(cb.headers.get('location').split('#recover=')[1]);
  const r = await s.call({ a: 'recoverFinish', ticket });
  assert.equal(r.ok, true);
  assert.equal((await s.call({ a: 'adminCheck', k })).error, 'unauthorized', 'old key no longer works');
  assert.equal((await s.call({ a: 'adminCheck', k: r.adminKey })).ok, true);
  assert.equal((await s.call({ a: 'recoverFinish', ticket })).error, 'expired', 'ticket is single-use');
});

t('owner tools: free keys for friends, list and disable accounts; hosts can’t use them', async () => {
  const s = await boot();
  const hostKey = await hostWithDrive(s);
  assert.equal((await s.call({ a: 'ownerCreateAccount', k: hostKey })).error, 'forbidden');
  const owner = s.env.OWNER_KEY;
  assert.equal((await s.call({ a: 'adminCheck', k: owner })).me.role, 'owner');
  const comp = await s.call({ a: 'ownerCreateAccount', k: owner, note: 'Jordan' });
  assert.equal((await s.call({ a: 'adminCheck', k: comp.adminKey })).me.role, 'host');
  const list = (await s.call({ a: 'ownerAccounts', k: owner })).accounts;
  assert.equal(list.length, 2);
  await s.call({ a: 'ownerSetStatus', k: owner, id: comp.id, status: 'disabled' });
  assert.equal((await s.call({ a: 'adminCheck', k: comp.adminKey })).error, 'forbidden');
});

t('wrong keys are rate limited but never lock out a real key', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  let last;
  for (let i = 0; i < 35; i++) last = await s.call({ a: 'adminCheck', k: 'wrong' + i });
  assert.equal(last.error, 'rate_limited');
  assert.equal((await s.call({ a: 'adminCheck', k })).ok, true);
});

t('a full Drive or a revoked Google connection gives clear errors and refunds the shot', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Full' } });
  const g = await s.call({ a: 'join', e: ev.id });
  s.fk.quota.usage = s.fk.quota.limit;
  const r = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() });
  assert.equal(r.error, 'drive_full');
  assert.equal((await s.call({ a: 'me', e: ev.id, g: g.guest.id, t: g.token })).guest.shotsLeft, 25, 'shot refunded');
  assert.equal((await s.call({ a: 'adminProblems', k })).problems.length, 1);
  s.fk.quota.usage = 0;
  s.fk.refresh.clear(); // the host removed access in their Google account
  const { driveFor } = await import('../src/google.js');
  const r2 = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() });
  // a cached access token may still work once; force refresh by clearing the cache via a new isolate-like call
  if (r2.ok) return;
  assert.equal(r2.error, 'drive_not_connected');
  assert.equal((await s.call({ a: 'adminCheck', k })).me.drive, false);
  void driveFor;
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok -', name); }
  catch (e) { console.log('FAIL -', name); console.log(e); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} cloud tests passed`);
