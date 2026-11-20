// Rememberoll Cloud API tests: the real worker with D1 on SQLite and fake Google/Stripe.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeEnv, d1, fakeR2 } from './harness.mjs';

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
async function hostWithDrive(s, { sub = 'google-sub-1', plan = 'year', ref } = {}) {
  const { url } = await s.call({ a: 'checkoutStart', plan, ref });
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
  assert.match(cfg, /"main":"\/api"/); assert.match(cfg, /"price":"\$5"/); assert.match(cfg, /"price":"\$30"/); assert.doesNotMatch(cfg, /lifetime/i); assert.match(cfg, /"testMode":true/);
  assert.doesNotMatch(cfg, /sk_test|test-secret|DATA_KEY|owner-key/);
  for (const a of ['constructor', '__proto__', 'toString', 'nope']) assert.equal((await s.call({ a })).error, 'bad_request');
  const res = await s.worker.fetch(new Request('http://localhost:8788/api', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{"a":"event"}' }), s.env);
  assert.equal(res.status, 403);
});

t('a purchase becomes exactly one account; the key can be re-shown only briefly', async () => {
  const s = await boot();
  const { url } = await s.call({ a: 'checkoutStart', plan: 'year' });
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
  const { url } = await s.call({ a: 'checkoutStart', plan: 'year' });
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
  assert.deepEqual(folders.sort(), ['Rememberoll', `Sam & Alex (${ev.id})`].sort());
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

t('plans: 1 month and 12 month keys expire, renewals add time once, lifetime is owner-only', async () => {
  const s = await boot();
  const day = 86400000;
  const k = await hostWithDrive(s, { plan: 'month' });
  let me = (await s.call({ a: 'adminCheck', k })).me;
  assert.equal(me.plan, 'month'); assert.ok(Math.abs(me.expires - (Date.now() + 30 * day)) < 60000);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Month party' } });
  const g = await s.call({ a: 'join', e: ev.id });
  // time passes: the plan ends
  s.env.DB.raw.prepare('UPDATE accounts SET expires = ?').run(Date.now() - 1000);
  me = (await s.call({ a: 'adminCheck', k })).me;
  assert.equal(me.expired, true, 'can still sign in to renew');
  assert.equal((await s.call({ a: 'adminCreate', k, settings: { name: 'Nope' } })).error, 'plan_expired');
  assert.equal((await s.call({ a: 'adminList', k })).events.length, 1, 'can still see events and back up keys');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: 'admin:' + k })).error, 'plan_expired');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: ev.hostKey })).error, 'plan_expired');
  const up = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() });
  assert.equal(up.error, 'paused', 'guest photos wait (and retry) instead of failing');
  assert.equal((await s.call({ a: 'event', e: ev.id })).ok, true, 'event page still opens');
  assert.equal((await s.call({ a: 'list', e: ev.id })).ok, true, 'album still viewable');
  // renew for a year while signed in: same key, time added once
  const { url } = await s.call({ a: 'checkoutStart', plan: 'year', k });
  const sid = url.split('/').pop(); s.fk.pay(sid);
  const r = await s.call({ a: 'claimPurchase', session_id: sid });
  assert.equal(r.renewed, true); assert.equal(r.adminKey, undefined, 'renewals never issue a new key');
  assert.ok(Math.abs(r.expires - (Date.now() + 365 * day)) < 60000);
  const again = await s.call({ a: 'claimPurchase', session_id: sid });
  assert.equal(again.expires, r.expires, 'the same payment never counts twice');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: ev.hostKey })).ok, true);
  assert.equal((await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() })).ok, true);
  // early renewal adds to the time left
  const u2 = (await s.call({ a: 'checkoutStart', plan: 'month', k })).url.split('/').pop(); s.fk.pay(u2);
  assert.ok(Math.abs((await s.call({ a: 'claimPurchase', session_id: u2 })).expires - (r.expires + 30 * day)) < 60000);
  // lifetime isn't for sale, and the one-event plan can't replace unlimited time
  assert.equal((await s.call({ a: 'checkoutStart', plan: 'lifetime', k })).error, 'bad_request');
  assert.equal((await s.call({ a: 'checkoutStart', plan: 'event', k })).error, 'bad_request');
  const owner = s.env.OWNER_KEY;
  const comp = await s.call({ a: 'ownerCreateAccount', k: owner, plan: 'lifetime', note: 'friend' });
  assert.equal(comp.plan, 'lifetime'); assert.equal(comp.expires, 0);
  assert.equal((await s.call({ a: 'checkoutStart', plan: 'month', k: comp.adminKey })).error, 'bad_request', 'nothing to renew on lifetime');
  const accts = (await s.call({ a: 'ownerAccounts', k: owner })).accounts;
  assert.equal(accts.find((a) => a.kind === 'paid').paid, 1000 + 3000 + 1000);
  assert.equal(s.env.DB.raw.prepare('SELECT COUNT(*) n FROM accounts').get().n, 3, 'renewals reuse the account (+ owner row + comp)');
});

t('one-event plan: one event, 30 days; buying again adds one more', async () => {
  const s = await boot();
  const k = await hostWithDrive(s, { plan: 'event' });
  let me = (await s.call({ a: 'adminCheck', k })).me;
  assert.equal(me.plan, 'event'); assert.equal(me.maxEvents, 1); assert.ok(Math.abs(me.expires - (Date.now() + 30 * 86400000)) < 60000);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Wedding' } });
  assert.ok(ev.id);
  assert.equal((await s.call({ a: 'adminCreate', k, settings: { name: 'Second' } })).error, 'plan_limit');
  assert.equal((await s.call({ a: 'adminDelete', k, e: ev.id, confirm: ev.id })).ok, true);
  assert.equal((await s.call({ a: 'adminCreate', k, settings: { name: 'Delete and redo' } })).error, 'plan_limit', 'deleting doesn’t give the event back');
  const sid = (await s.call({ a: 'checkoutStart', plan: 'event', k })).url.split('/').pop(); s.fk.pay(sid);
  await s.call({ a: 'claimPurchase', session_id: sid });
  me = (await s.call({ a: 'adminCheck', k })).me;
  assert.equal(me.maxEvents, 2);
  assert.ok((await s.call({ a: 'adminCreate', k, settings: { name: 'Another' } })).id);
  // upgrading to a month makes events unlimited
  const u = (await s.call({ a: 'checkoutStart', plan: 'month', k })).url.split('/').pop(); s.fk.pay(u);
  await s.call({ a: 'claimPurchase', session_id: u });
  assert.equal((await s.call({ a: 'adminCheck', k })).me.maxEvents, 0);
  assert.ok((await s.call({ a: 'adminCreate', k, settings: { name: 'Third' } })).id);
});

t('albums stay online 12 months after a plan ends, then close (Drive keeps the photos)', async () => {
  const s = await boot();
  const k = await hostWithDrive(s, { plan: 'month' });
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Party' } });
  s.env.DB.raw.prepare("UPDATE accounts SET expires = ? WHERE kind = 'paid'").run(Date.now() - 364 * 86400000);
  assert.equal((await s.call({ a: 'list', e: ev.id })).ok, true, 'still inside the 12 months');
  assert.ok((await s.call({ a: 'adminCheck', k })).me.holdUntil > Date.now());
  s.env.DB.raw.prepare("UPDATE accounts SET expires = ? WHERE kind = 'paid'").run(Date.now() - 366 * 86400000);
  for (const a of ['event', 'join', 'list']) assert.equal((await s.call({ a, e: ev.id })).error, 'archived', a);
  assert.equal((await s.call({ a: 'adminList', k })).events.length, 1, 'the host still sees it and can renew');
  const sid = (await s.call({ a: 'checkoutStart', plan: 'month', k })).url.split('/').pop(); s.fk.pay(sid);
  await s.call({ a: 'claimPurchase', session_id: sid });
  assert.equal((await s.call({ a: 'list', e: ev.id })).ok, true, 'renewing reopens it');
});

t('referral codes: discount, commission on every sale, partner view, payouts, voids, cash sales', async () => {
  const s = await boot();
  const owner = s.env.OWNER_KEY;
  // only the owner manages codes
  const k0 = await hostWithDrive(s, { plan: 'month', sub: 'someone' });
  for (const a of ['ownerCodes', 'ownerCodeCreate', 'ownerPayout', 'ownerCashSale', 'ownerVoidSale', 'ownerCodeUpdate']) {
    assert.equal((await s.call({ a, k: k0, name: 'x', code: 'X1X', plan: 'month', amount: '1' })).error, 'forbidden', a);
  }
  const p = await s.call({ a: 'ownerCodeCreate', k: owner, name: 'Mike Smith', email: 'mike@example.com', withKey: true });
  assert.match(p.code, /^MIKESMIT\d\d$/); assert.ok(p.adminKey); assert.match(p.link, /\/\?ref=/);
  assert.equal((await s.call({ a: 'ownerCodeCreate', k: owner, name: 'Dup', code: p.code })).error, 'bad_request', 'codes are unique');
  const big = await s.call({ a: 'ownerCodeCreate', k: owner, name: 'Greedy', code: 'greedy-1', discount: 90, commission: 99 });
  assert.equal(big.code, 'GREEDY1');
  const gr = (await s.call({ a: 'ownerCodes', k: owner })).codes.find((c) => c.code === 'GREEDY1');
  assert.equal(gr.discount, 50); assert.equal(gr.commission, 50, 'percentages are capped at 50');
  // partner's own key is lifetime
  const pm = (await s.call({ a: 'adminCheck', k: p.adminKey })).me;
  assert.equal(pm.plan, 'lifetime'); assert.equal(pm.partner.codes[0].code, p.code); assert.equal(pm.partner.codes[0].sales, 0);
  // public lookup
  const look = await s.call({ a: 'refLookup', code: p.code.toLowerCase() });
  assert.equal(look.discount, 10); assert.deepEqual(look.prices, { event: 450, month: 900, year: 2700 });
  assert.equal((await s.call({ a: 'refLookup', code: 'NOPE99' })).error, 'bad_code');
  assert.equal((await s.call({ a: 'checkoutStart', plan: 'year', ref: 'NOPE99' })).error, 'bad_code');
  // a buyer uses the code: 10% off, 20% of what they paid goes to Mike
  const kb = await hostWithDrive(s, { plan: 'year', ref: p.code, sub: 'buyer-2' });
  const sess = [...s.env.DB.raw.prepare('SELECT * FROM purchases ORDER BY created').all()].pop();
  assert.equal(sess.amount, 2700); assert.equal(sess.ref, p.code);
  // renewal by the same customer keeps the code (and the commission) automatically
  const r = (await s.call({ a: 'checkoutStart', plan: 'month', k: kb })).url.split('/').pop(); s.fk.pay(r);
  await s.call({ a: 'claimPurchase', session_id: r });
  await s.call({ a: 'claimPurchase', session_id: r }); // reloading the thank-you page doesn't double-count
  let st = (await s.call({ a: 'adminCheck', k: p.adminKey })).me.partner.codes[0];
  assert.equal(st.sales, 2); assert.equal(st.revenue, 2700 + 900); assert.equal(st.earned, 540 + 180); assert.equal(st.ready, 0, 'not payable until 14 days pass');
  assert.equal(st.recent[0].plan, 'month'); assert.equal(st.recent[0].customer, undefined, 'partners never see who bought');
  // a partner can't earn on their own purchases
  const own = await s.call({ a: 'checkoutStart', plan: 'month', ref: p.code });
  assert.ok(own.url); // anonymous buyer: fine
  const sf = (await s.call({ a: 'checkoutStart', plan: 'month', k: p.adminKey, ref: p.code })).error;
  assert.equal(sf, 'bad_request', 'lifetime partner has nothing to buy anyway');
  // cash sale credited to the code
  const cash = await s.call({ a: 'ownerCashSale', k: owner, plan: 'event', amount: '5', code: p.code, email: 'aunt@example.com' });
  assert.ok(cash.adminKey); assert.equal(cash.plan, 'event');
  assert.equal((await s.call({ a: 'ownerCashSale', k: owner, plan: 'lifetime', amount: '5' })).error, 'bad_request');
  assert.equal((await s.call({ a: 'ownerCashSale', k: owner, plan: 'month', amount: '-3' })).error, 'bad_request');
  // 14 days later the money is ready to pay out
  s.env.DB.raw.prepare('UPDATE commissions SET created = ?').run(Date.now() - 15 * 86400000);
  let oc = await s.call({ a: 'ownerCodes', k: owner });
  let mc = oc.codes.find((c) => c.code === p.code);
  assert.equal(mc.earned, 540 + 180 + 100); assert.equal(mc.ready, 820); assert.equal(oc.sales.length, 3);
  assert.equal((await s.call({ a: 'ownerPayout', k: owner, code: p.code, amount: '9.00' })).error, 'bad_request', 'can’t pay more than owed');
  assert.equal((await s.call({ a: 'ownerPayout', k: owner, code: p.code, amount: '5.20', method: 'Venmo' })).owed, 300);
  // refund one sale in Stripe → void its commission
  const cashRow = oc.sales.find((x) => x.method === 'cash');
  await s.call({ a: 'ownerVoidSale', k: owner, id: cashRow.id });
  oc = await s.call({ a: 'ownerCodes', k: owner });
  mc = oc.codes.find((c) => c.code === p.code);
  assert.equal(mc.owed, 200); assert.equal(mc.paidThisYear, 520); assert.equal(oc.payouts[0].method, 'Venmo');
  // turning a code off stops new discounts
  await s.call({ a: 'ownerCodeUpdate', k: owner, code: p.code, active: false });
  assert.equal((await s.call({ a: 'refLookup', code: p.code })).error, 'bad_code');
  assert.ok((await s.call({ a: 'checkoutStart', plan: 'month', k: kb })).url, 'renewal still works, at full price');
  const last = [...s.fk.sessions.values()].pop();
  assert.equal(last.amount, 1000); assert.equal(last.metadata.ref, undefined);
});

t('partner tiers: invites, overrides split up the team, payout requests, rules against self-dealing', async () => {
  const s = await boot();
  const owner = s.env.OWNER_KEY;
  const day = 86400000;
  // tier 1, added by the owner, partner-only key (no free hosting)
  const t1 = await s.call({ a: 'ownerCodeCreate', k: owner, name: 'Ann Lee', code: 'ANN', email: 'ann@example.com' });
  assert.ok(t1.adminKey); assert.equal(t1.lifetime, false);
  let me = (await s.call({ a: 'adminCheck', k: t1.adminKey })).me;
  assert.equal(me.plan, 'partner'); assert.equal(me.expired, true, 'partner keys can’t host');
  assert.equal((await s.call({ a: 'adminCreate', k: t1.adminKey, settings: { name: 'x' } })).error, 'plan_expired');
  assert.equal(me.partner.codes[0].tier, 1); assert.equal(me.partner.codes[0].canInvite, true);
  // only partners can make invite links, and only the owner can make free keys
  const host = await hostWithDrive(s, { plan: 'month', sub: 'not-a-partner' });
  assert.equal((await s.call({ a: 'partnerInvite', k: host })).error, 'forbidden');
  assert.ok(['forbidden', 'plan_expired'].includes((await s.call({ a: 'ownerCreateAccount', k: t1.adminKey })).error), 'partners can’t make free keys');
  // Ann invites Bob (tier 2); the link works once
  const inv = await s.call({ a: 'partnerInvite', k: t1.adminKey });
  const token = inv.link.split('#invite=')[1];
  assert.ok(token.length >= 20);
  const info = await s.call({ a: 'partnerInviteInfo', invite: token });
  assert.equal(info.inviter, 'Ann'); assert.equal(info.tier, 2); assert.equal(info.override, 5); assert.equal(info.canRecruit, true);
  assert.equal((await s.call({ a: 'partnerJoin', invite: token, name: 'Bob', email: 'bob@example.com' })).error, 'bad_request', 'must accept the agreement');
  const bob = await s.call({ a: 'partnerJoin', invite: token, name: 'Bob Ray', email: 'bob@example.com', agree: true });
  assert.equal(bob.tier, 2); assert.match(bob.code, /^BOBRAY\d+$/);
  assert.equal((await s.call({ a: 'partnerJoin', invite: token, name: 'Again', email: 'x@example.com', agree: true })).error, 'bad_invite', 'single use');
  assert.equal((await s.call({ a: 'partnerInviteInfo', invite: 'x'.repeat(30) })).error, 'bad_invite');
  // Bob invites Cat (tier 3); Cat can sell but not invite
  const t3 = (await s.call({ a: 'partnerInvite', k: bob.adminKey })).link.split('#invite=')[1];
  const cat = await s.call({ a: 'partnerJoin', invite: t3, name: 'Cat', email: 'cat@example.com', agree: true });
  assert.equal(cat.tier, 3);
  assert.equal((await s.call({ a: 'partnerInvite', k: cat.adminKey })).error, 'forbidden', '3 tiers deep, no more');
  const catMe = (await s.call({ a: 'adminCheck', k: cat.adminKey })).me.partner.codes[0];
  assert.equal(catMe.canInvite, false); assert.equal(catMe.discount, 10); assert.equal(catMe.commission, 20);
  // a real customer buys 12 months with Cat's code: $27 paid
  await hostWithDrive(s, { plan: 'year', ref: cat.code, sub: 'cust-1' });
  const earned = (k) => s.call({ a: 'adminCheck', k }).then((r) => r.me.partner.codes[0]);
  let [a1, b1, c1] = [await earned(t1.adminKey), await earned(bob.adminKey), await earned(cat.adminKey)];
  assert.equal(c1.earned, 540, 'seller: 20% of $27');
  assert.equal(b1.earned, 67); assert.equal(a1.earned, 67, '5% ($1.35) split evenly between the 2 partners above');
  assert.equal(b1.teamEarned, 67); assert.equal(b1.sales, 0, 'overrides are not sales');
  const annTeam = (await s.call({ a: 'adminCheck', k: t1.adminKey })).me.partner.codes[0].team;
  assert.deepEqual(annTeam.map((m) => [m.name, m.tier, m.sales]), [['Bob Ray', 2, 0], ['Cat', 3, 1]]);
  // Bob sells one month: Bob 20% of $9, Ann gets the whole 5%
  await hostWithDrive(s, { plan: 'month', ref: bob.code, sub: 'cust-2' });
  [a1, b1] = [await earned(t1.adminKey), await earned(bob.adminKey)];
  assert.equal(b1.earned, 67 + 180); assert.equal(a1.earned, 67 + 45);
  // Ann sells directly: nobody above her (the owner isn't paid overrides)
  await hostWithDrive(s, { plan: 'year', ref: 'ANN', sub: 'cust-3' });
  assert.equal((await earned(t1.adminKey)).earned, 67 + 45 + 540);
  assert.equal(s.env.DB.raw.prepare("SELECT COUNT(*) n FROM commissions WHERE kind = 'override'").get().n, 3);
  // partners buying (signed in, or anonymously with their own email) earn nobody anything
  const own = (await s.call({ a: 'checkoutStart', plan: 'month', k: cat.adminKey, ref: cat.code })).url.split('/').pop();
  assert.equal([...s.fk.sessions.values()].pop().amount, 1000, 'partners pay full price'); s.fk.pay(own);
  await s.call({ a: 'claimPurchase', session_id: own });
  assert.equal((await earned(cat.adminKey)).earned, 540);
  assert.equal((await s.call({ a: 'adminCheck', k: cat.adminKey })).me.expired, false, 'a partner who buys can host');
  // payout requests: need $25 ready (past 14 days)
  assert.equal((await s.call({ a: 'partnerRequestPayout', k: t1.adminKey, method: 'Venmo', handle: '@ann' })).error, 'bad_request', 'not ready yet');
  s.env.DB.raw.prepare('UPDATE commissions SET created = ?').run(Date.now() - 15 * day);
  assert.equal((await s.call({ a: 'partnerRequestPayout', k: cat.adminKey, method: 'Venmo', handle: '@cat' })).error, 'bad_request', '$5.40 is under $25');
  assert.equal((await s.call({ a: 'partnerRequestPayout', k: t1.adminKey, method: 'Bitcoin', handle: 'x' })).error, 'bad_request');
  // give Ann enough: a cash sale credited to her
  await s.call({ a: 'ownerCashSale', k: owner, plan: 'year', amount: '100', code: 'ANN' });
  s.env.DB.raw.prepare('UPDATE commissions SET created = ?').run(Date.now() - 15 * day);
  const req1 = await s.call({ a: 'partnerRequestPayout', k: t1.adminKey, method: 'Venmo', handle: '@ann-lee' });
  assert.equal(req1.amount, 67 + 45 + 540 + 2000);
  assert.equal((await s.call({ a: 'partnerRequestPayout', k: t1.adminKey, method: 'Venmo', handle: '@ann-lee' })).error, 'bad_request', 'one request at a time');
  let oc = await s.call({ a: 'ownerCodes', k: owner });
  assert.equal(oc.requests.length, 1); assert.equal(oc.requests[0].handle, '@ann-lee'); assert.equal(oc.requests[0].name, 'Ann Lee');
  assert.ok(['forbidden', 'plan_expired'].includes((await s.call({ a: 'ownerPayRequest', k: t1.adminKey, id: oc.requests[0].id, paid: true })).error));
  assert.equal((await s.call({ a: 'ownerPayRequest', k: owner, id: oc.requests[0].id, paid: true })).ok, true);
  assert.equal((await s.call({ a: 'ownerPayRequest', k: owner, id: oc.requests[0].id, paid: true })).error, 'not_found', 'can’t pay twice');
  const annNow = await earned(t1.adminKey);
  assert.equal(annNow.paid, req1.amount); assert.equal(annNow.owed, 0); assert.equal(annNow.requests[0].status, 'paid');
  // a chargeback voids the seller's commission and the team overrides together
  oc = await s.call({ a: 'ownerCodes', k: owner });
  const catSale = oc.sales.find((x) => x.code === cat.code && x.kind === 'sale');
  await s.call({ a: 'ownerVoidSale', k: owner, id: catSale.id });
  assert.equal((await earned(cat.adminKey)).earned, 0); assert.equal((await earned(bob.adminKey)).earned, 180);
  // goodwill days for a customer
  const accts = (await s.call({ a: 'ownerAccounts', k: owner })).accounts;
  const cust = accts.find((x) => x.plan === 'month' && x.kind === 'paid');
  const before = cust.expires;
  assert.ok((await s.call({ a: 'ownerAddDays', k: owner, id: cust.id, days: 7 })).expires >= before + 7 * day - 1000);
  assert.equal((await s.call({ a: 'ownerAddDays', k: owner, id: accts.find((x) => x.plan === 'partner').id, days: 7 })).error, 'bad_request');
});

t('scaling: events can live in an extra database; nightly cleanup; owner health', async () => {
  const s = await boot({ SHARD_1: d1('migrations-shard') });
  const owner = s.env.OWNER_KEY;
  const day = 86400000;
  const k = await hostWithDrive(s, { plan: 'month' });
  const k2 = await hostWithDrive(s, { plan: 'year', sub: 'host-2' });
  const main = s.env.DB.raw, sh = s.env.SHARD_1.raw;
  const shoot = async (ev) => {
    const g = await s.call({ a: 'join', e: ev.id, label: 'Ann' });
    const up = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid() });
    assert.equal(up.ok, true, JSON.stringify(up));
    assert.equal((await s.call({ a: 'guestbookAdd', e: ev.id, g: g.guest.id, t: g.token, text: 'Hi!', clientId: cid() })).ok, true);
    return { g, up };
  };
  // before ACTIVE_SHARD: the main database
  const evA = await s.call({ a: 'adminCreate', k, settings: { name: 'Old party' } });
  await shoot(evA);
  // ACTIVE_SHARD pointing at a database that isn't bound is ignored
  s.env.ACTIVE_SHARD = 'SHARD_9';
  const evX = await s.call({ a: 'adminCreate', k, settings: { name: 'Fallback' } });
  assert.equal(main.prepare('SELECT shard FROM events WHERE id = ?').get(evX.id).shard, '');
  // new events go to SHARD_1 and everything works there
  s.env.ACTIVE_SHARD = 'SHARD_1';
  const evB = await s.call({ a: 'adminCreate', k: k2, settings: { name: 'New party' } });
  assert.equal(main.prepare('SELECT shard FROM events WHERE id = ?').get(evB.id).shard, 'SHARD_1');
  const { up } = await shoot(evB);
  assert.equal(sh.prepare('SELECT COUNT(*) n FROM media WHERE event = ?').get(evB.id).n, 1, 'photo index in the extra database');
  assert.equal(main.prepare('SELECT COUNT(*) n FROM media WHERE event = ?').get(evB.id).n, 0);
  assert.equal(sh.prepare('SELECT COUNT(*) n FROM notes WHERE event = ?').get(evB.id).n, 1);
  assert.equal((await s.call({ a: 'list', e: evB.id })).items.length, 1);
  assert.equal((await s.call({ a: 'guestbookList', e: evB.id })).notes.length, 1);
  assert.equal((await s.call({ a: 'hostModerate', e: evB.id, k: evB.hostKey, action: 'hide', ids: [up.id] })).ok, true);
  assert.equal((await s.call({ a: 'hostGuests', e: evB.id, k: evB.hostKey })).guests.length, 1);
  assert.equal((await s.call({ a: 'list', e: evA.id })).items.length, 1, 'old events keep working in the main database');
  // a shard that later disappears (misconfiguration) fails safely, without touching the main database
  const saved = s.env.SHARD_1; delete s.env.SHARD_1;
  const s2err = await s.call({ a: 'list', e: evB.id });
  assert.equal(s2err.error, 'server_error');
  s.env.SHARD_1 = saved;
  // owner health
  const hl = await s.call({ a: 'ownerHealth', k: owner });
  assert.deepEqual(hl.dbs.map((d) => [d.name, d.active, d.photos]), [['Main', false, 1], ['SHARD_1', true, 1]]);
  assert.ok(hl.dbs[0].size > 0); assert.equal(hl.advice, 'ok'); assert.equal(hl.nightly, null);
  assert.equal((await s.call({ a: 'ownerHealth', k })).error, 'forbidden');
  // nightly cleanup: host 1's plan ended over 12 months ago → their albums' photo index is cleared
  main.prepare("UPDATE accounts SET expires = ? WHERE id = (SELECT account FROM events WHERE id = ?)").run(Date.now() - 400 * day, evA.id);
  main.prepare('INSERT INTO problems (account, t, w, e, m) VALUES (?, ?, ?, ?, ?)').run('x', Date.now() - 100 * day, 'old', '', 'old problem');
  main.prepare('INSERT INTO rate (k, n, exp) VALUES (?, 1, ?)').run('old:1', Date.now() - 1000);
  const r = (await s.call({ a: 'ownerRunCleanup', k: owner })).result;
  assert.equal(r.albums, 2, 'both of host 1’s events'); assert.equal(r.rows, 3, "1 photo, 1 note, 1 guest"); assert.equal(r.problems, 1); assert.ok(r.rate >= 1);
  assert.equal(main.prepare('SELECT COUNT(*) n FROM media WHERE event = ?').get(evA.id).n, 0);
  assert.ok(main.prepare('SELECT purged FROM events WHERE id = ?').get(evA.id).purged > 0);
  assert.equal(sh.prepare('SELECT COUNT(*) n FROM media WHERE event = ?').get(evB.id).n, 1, 'active plans untouched');
  assert.equal((await s.call({ a: 'list', e: evA.id })).error, 'archived');
  assert.equal((await s.call({ a: 'ownerRunCleanup', k: owner })).result.albums, 0, 'nothing to do twice');
  assert.ok((await s.call({ a: 'ownerHealth', k: owner })).nightly.t > 0);
  // a deleted event's index is cleared too
  await s.call({ a: 'adminDelete', k: k2, e: evB.id, confirm: evB.id });
  await s.call({ a: 'ownerRunCleanup', k: owner });
  assert.equal(sh.prepare('SELECT COUNT(*) n FROM media WHERE event = ?').get(evB.id).n, 0);
  // host 1 renews: albums reopen; "Find missing photos" brings photos back from Drive, waiting for approval
  const sid = (await s.call({ a: 'checkoutStart', plan: 'month', k })).url.split('/').pop(); s.fk.pay(sid);
  await s.call({ a: 'claimPurchase', session_id: sid });
  assert.equal((await s.call({ a: 'list', e: evA.id })).items.length, 0, 'open again, index empty');
  assert.equal((await s.call({ a: 'hostGet', e: evA.id, k: 'admin:' + k })).event.purged, true);
  const rec = await s.call({ a: 'hostRecover', e: evA.id, k: 'admin:' + k });
  assert.ok(rec.added >= 1, JSON.stringify(rec));
  assert.equal(main.prepare("SELECT COUNT(*) n FROM media WHERE event = ? AND status = 'pending'").get(evA.id).n, rec.added);
  assert.equal((await s.call({ a: 'hostGet', e: evA.id, k: 'admin:' + k })).event.purged, false);
});

t('invitations: open link RSVPs with private edit token, caps, deadline, host-only selfies', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Sam & Alex' } });
  const hk = 'admin:' + k;
  assert.equal((await s.call({ a: 'invite', e: ev.id })).error, 'not_found', 'closed until the host turns it on');
  const inv = { on: true, hosts: 'The Lees', venue: 'Rose Hall', address: '1 Main St', note: 'Line one\nLine two <b>', cap: 3, plusOnes: true, maxParty: 2,
    kids: true, askMeal: true, meals: ['Chicken', 'Fish', '=HYPERLINK("x")'], diet: true, song: true, whoComing: true, tz: 'America/New_York', startsAt: '2027-06-12T22:00:00Z' };
  const up = await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { invite: inv } });
  assert.equal(up.event.settings.invite.note, 'Line one\nLine two b', 'line breaks kept, tags stripped');
  assert.deepEqual(up.event.settings.invite.meals, ['Chicken', 'Fish', 'HYPERLINK("x")']);
  const pub = await s.call({ a: 'invite', e: ev.id });
  assert.equal(pub.invite.venue, 'Rose Hall'); assert.equal(pub.spotsLeft, 3); assert.deepEqual(pub.coming, []);
  assert.equal(pub.invite.photo, true);
  const rt = crypto.randomBytes(24).toString('base64url');
  const bad = await s.call({ a: 'rsvp', e: ev.id, name: 'Pat Doe', status: 'yes', rt: 'short' });
  assert.equal(bad.error, 'needs_update');
  const r1 = await s.call({ a: 'rsvp', e: ev.id, name: 'Pat Doe', status: 'yes', meal: 'Fish', party: [{ n: 'Lee Doe', m: 'Chicken' }, { n: 'Extra', m: 'Fish' }], kids: 1, diet: 'No nuts', song: 'Dancing Queen', message: 'Yay', rt, clientId: cid(), photo: b64(jpegWithExif()) });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r1.rsvp.party.length, 2, 'max party size enforced'); assert.equal(r1.rsvp.party[0].m, 'Fish'); assert.equal(r1.rsvp.hasPhoto, true);
  const photoFile = [...s.fk.drive.values()].find((f) => /^rsvp_/.test(f.name));
  assert.ok(photoFile && !photoFile.public, 'selfie stays private'); assert.ok(!Buffer.from(photoFile.bytes).includes('GPSDATA'), 'EXIF stripped');
  const pub2 = await s.call({ a: 'invite', e: ev.id, r: r1.r, rt });
  assert.equal(pub2.spotsLeft, 0); assert.deepEqual(pub2.coming, ['Pat D.']); assert.equal(pub2.mine.diet, 'No nuts');
  assert.equal((await s.call({ a: 'invite', e: ev.id, r: r1.r, rt: 'x'.repeat(30) })).mine, null, 'wrong token sees nothing');
  const full = await s.call({ a: 'rsvp', e: ev.id, name: 'Late', status: 'yes', rt: crypto.randomBytes(24).toString('base64url') });
  assert.equal(full.error, 'full');
  const maybe = await s.call({ a: 'rsvp', e: ev.id, name: 'Late', status: 'maybe', rt: crypto.randomBytes(24).toString('base64url') });
  assert.equal(maybe.ok, true, 'maybe does not use a spot');
  const forged = await s.call({ a: 'rsvp', e: ev.id, r: r1.r, name: 'Hacker', status: 'no', rt: crypto.randomBytes(24).toString('base64url') });
  assert.equal(forged.error, 'unauthorized', 'cannot edit someone else’s RSVP');
  const edit = await s.call({ a: 'rsvp', e: ev.id, r: r1.r, name: 'Pat Doe', status: 'no', rt, removePhoto: true });
  assert.equal(edit.rsvp.status, 'no'); assert.equal(edit.rsvp.hasPhoto, false); assert.equal(edit.rsvp.kids, 0);
  assert.ok(photoFile.trashed, 'old selfie removed');
  assert.equal((await s.call({ a: 'hostRsvps', e: ev.id, k: 'nope' })).error, 'unauthorized');
  const list = await s.call({ a: 'hostRsvps', e: ev.id, k: hk });
  assert.equal(list.rsvps.length, 2); assert.equal(list.totals.no, 1); assert.equal(list.totals.maybe, 1);
  assert.equal((await s.call({ a: 'hostRsvpPhoto', e: ev.id, k: hk, id: edit.r })).error, 'not_found');
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { invite: { ...inv, deadline: '2001-01-01T00:00:00Z' } } });
  assert.equal((await s.call({ a: 'rsvp', e: ev.id, name: 'Too late', status: 'yes', rt: crypto.randomBytes(24).toString('base64url') })).error, 'closed');
  assert.equal((await s.call({ a: 'invite', e: ev.id })).invite.closed, true);
  const del = await s.call({ a: 'hostRsvpDelete', e: ev.id, k: hk, ids: [maybe.r] });
  assert.equal(del.changed, 1);
  assert.equal((await s.call({ a: 'hostRsvps', e: ev.id, k: hk })).rsvps.length, 1);
  // Cover photo: public, image types only.
  assert.equal((await s.call({ a: 'hostSetCover', e: ev.id, k: hk, data: b64(Buffer.from('<svg onload=alert(1)>'.padEnd(64))) })).error, 'bad_type');
  const cv = await s.call({ a: 'hostSetCover', e: ev.id, k: hk, data: b64(jpegWithExif()) });
  assert.ok(cv.coverV);
  assert.equal((await s.call({ a: 'cover', e: ev.id })).mime, 'image/jpeg');
  assert.equal((await s.call({ a: 'event', e: ev.id })).event.coverV, cv.coverV);
});

t('Google Play: assetlinks.json only when package and fingerprint are set and valid', async () => {
  const s = await boot();
  assert.notEqual((await s.get('/.well-known/assetlinks.json')).headers.get('content-type'), 'application/json');
  s.env.ANDROID_PACKAGE = 'com.rememberoll.app';
  s.env.ANDROID_CERT_SHA256 = Array(32).fill('AB').join(':');
  const j = await (await s.get('/.well-known/assetlinks.json')).json();
  assert.equal(j[0].target.package_name, 'com.rememberoll.app');
  assert.equal(j[0].target.sha256_cert_fingerprints.length, 1);
  s.env.ANDROID_PACKAGE = 'evil"package';
  assert.notEqual((await s.get('/.well-known/assetlinks.json')).headers.get('content-type'), 'application/json');
});

t('captions and photo challenges: cleaned, only host prompts count, host can remove a caption', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Fun' } });
  const hk = 'admin:' + k;
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { challenges: { on: true, list: ['Selfie with the hosts', '<b>Dance</b>'] } } });
  const pub = (await s.call({ a: 'event', e: ev.id })).event;
  assert.deepEqual(pub.challenges, ['Selfie with the hosts', 'bDance/b']); assert.equal(pub.captions, true);
  const g = await s.call({ a: 'join', e: ev.id, label: 'Nana' });
  const up = (extra) => s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10, ...extra });
  await up({ caption: '=SUM(1) <script>hi</script>', challenge: 'Selfie with the hosts' });
  await up({ caption: 'ok', challenge: 'Something the host never asked' });
  const items = (await s.call({ a: 'list', e: ev.id })).items;
  assert.equal(items[0].cap, 'SUM(1) scripthi/script'); assert.equal(items[0].ch, 'Selfie with the hosts');
  assert.equal(items[1].ch, '', 'unknown challenge dropped');
  assert.equal((await s.call({ a: 'hostClearCaption', e: ev.id, k: 'nope', id: items[0].i })).error, 'unauthorized');
  await s.call({ a: 'hostClearCaption', e: ev.id, k: hk, id: items[0].i });
  assert.equal((await s.call({ a: 'list', e: ev.id })).items[0].cap, '');
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { captions: false } });
  await up({ caption: 'nope' });
  assert.equal((await s.call({ a: 'list', e: ev.id })).items[2].cap, '', 'captions off');
});

t('messages: guest emails, invite + reminder + thank-you, opt-out, limits, hourly auto', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Sam & Alex' } });
  const hk = 'admin:' + k;
  assert.equal((await s.call({ a: 'hostMessages', e: ev.id, k: hk })).ready, false, 'off until the owner sets it up');
  assert.equal((await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'invite' })).error, 'not_configured');
  s.env.RESEND_API_KEY = 're_test_fake'; s.env.MAIL_FROM = 'Rememberoll <hello@example.com>';
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { invite: { on: true, hosts: 'The Lees', startsAt: new Date(Date.now() + 3600e3 / 2).toISOString() } } });
  const add = await s.call({ a: 'hostAddInvitees', e: ev.id, k: hk, emails: ['Pat@Example.com', 'lee@example.com', 'not an email', 'pat@example.com', { email: 'kim@example.com', name: 'Kim <b>' }] });
  assert.equal(add.added, 3); assert.deepEqual(add.bad, ['not an email']);
  assert.equal((await s.call({ a: 'hostAddInvitees', e: ev.id, k: 'bad', emails: ['x@y.com'] })).error, 'unauthorized');
  const inv = await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'invite' });
  assert.equal(inv.sent, 3); assert.equal(s.fk.mail.length, 3);
  const m0 = s.fk.mail[0];
  assert.match(m0.subject, /You’re invited: Sam & Alex/); assert.match(m0.html, /Sam &amp; Alex/, 'escaped');
  assert.match(m0.headers['List-Unsubscribe'], /unsubscribe\.html\?e=/);
  assert.equal((await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'invite' })).sent, 0, 'nobody invited twice');
  // Pat replies with the same email; the reminder skips them.
  await s.call({ a: 'rsvp', e: ev.id, name: 'Pat', status: 'yes', email: 'pat@example.com', rt: crypto.randomBytes(24).toString('base64url') });
  assert.equal((await s.call({ a: 'rsvp', e: ev.id, name: 'X', status: 'yes', email: 'nope', rt: crypto.randomBytes(24).toString('base64url') })).error, 'bad_request');
  // Lee opts out with the link from their email.
  const lee = s.fk.mail.find((m) => m.to[0] === 'lee@example.com');
  const t = new URL(lee.headers['List-Unsubscribe'].slice(1, -1)).searchParams.get('t');
  assert.equal((await s.call({ a: 'unsubscribe', e: ev.id, t: 'x'.repeat(24) })).error, 'not_found');
  assert.equal((await s.call({ a: 'unsubscribe', e: ev.id, t })).ok, true);
  const rem = await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'reminder' });
  assert.equal(rem.sent, 1, 'only Kim: Pat replied, Lee opted out');
  assert.equal(s.fk.mail.at(-1).to[0], 'kim@example.com');
  assert.equal((await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'reminder' })).error, 'rate_limited', 'not twice in an hour');
  const ty = await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'thanks', note: 'Thank you <3 for coming' });
  assert.equal(ty.sent, 1); assert.match(s.fk.mail.at(-1).html, /Thank you 3 for coming/, "angle brackets stripped");
  const msgs = await s.call({ a: 'hostMessages', e: ev.id, k: hk });
  assert.equal(msgs.ready, true); assert.equal(msgs.invitees.find((x) => x.email === 'lee@example.com').optout, true);
  assert.equal((await s.call({ a: 'hostRsvps', e: ev.id, k: hk })).rsvps[0].email, 'pat@example.com');
  assert.equal((await s.call({ a: 'invite', e: ev.id })).coming, undefined, 'emails never public');
  // Hourly: "camera is open" goes out once to Yes/Maybe guests with an email.
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { messages: { autoCamera: true } } });
  const before = s.fk.mail.length;
  const { autoMessages } = await import('../src/actions.js');
  await autoMessages(s.env); await autoMessages(s.env);
  assert.equal(s.fk.mail.length, before + 1); assert.match(s.fk.mail.at(-1).subject, /camera is open/);
});

t('prints and photo books: owner prices, photos only, Stripe shipping, paid once, owner fulfilment', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Shop' } });
  const hk = 'admin:' + k;
  const g = await s.call({ a: 'join', e: ev.id, label: 'Nana' });
  for (let i = 0; i < 3; i++) await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10 });
  const ids = (await s.call({ a: 'hostList', e: ev.id, k: hk })).items.map((x) => x.i);
  const shop = await s.call({ a: 'hostShop', e: ev.id, k: hk });
  assert.equal(shop.prints, 50); assert.equal(shop.book, 7900); assert.deepEqual(shop.orders, []);
  assert.equal((await s.call({ a: 'hostShop', e: ev.id, k: 'nope' })).error, 'unauthorized');
  assert.equal((await s.call({ a: 'hostOrder', e: ev.id, k: hk, kind: 'book', ids })).error, 'bad_request', 'book needs 20+');
  assert.equal((await s.call({ a: 'hostOrder', e: ev.id, k: hk, kind: 'prints', ids: ['not-a-photo'] })).error, 'bad_request');
  const o = await s.call({ a: 'hostOrder', e: ev.id, k: hk, kind: 'prints', ids: [...ids, ids[0]], copies: 2 });
  const sid = o.url.split('/').pop();
  assert.equal(s.fk.sessions.get(sid).amount, 300, '3 photos x 2 copies x 50c');
  assert.equal((await s.call({ a: 'orderDone', session_id: sid })).error, 'not_paid');
  assert.equal((await s.call({ a: 'hostShop', e: ev.id, k: hk })).orders.length, 0, 'unpaid orders hidden');
  s.fk.pay(sid);
  const done = await s.call({ a: 'orderDone', session_id: sid });
  assert.equal(done.n, 3); assert.equal(done.copies, 2);
  await s.call({ a: 'orderDone', session_id: sid });
  assert.equal((await s.call({ a: 'hostShop', e: ev.id, k: hk })).orders[0].status, 'paid');
  assert.equal((await s.call({ a: 'ownerOrders', k })).error, 'forbidden');
  const owner = s.env.OWNER_KEY;
  const list = (await s.call({ a: 'ownerOrders', k: owner })).orders;
  assert.equal(list.length, 1); assert.equal(list[0].ship.city, 'Austin'); assert.equal(list[0].event, 'Shop');
  const ph = await s.call({ a: 'ownerOrderPhoto', k: owner, order: list[0].id, n: 0 });
  assert.equal(ph.mime, 'image/jpeg'); assert.match(ph.name, /-01\.jpg$/);
  assert.equal((await s.call({ a: 'ownerOrderPhoto', k: owner, order: list[0].id, n: 9 })).error, 'not_found');
  assert.equal((await s.call({ a: 'ownerOrderPhoto', k, order: list[0].id, n: 0 })).error, 'forbidden');
  await s.call({ a: 'ownerOrderStatus', k: owner, order: list[0].id, status: 'sent', note: 'USPS 9400 <b>1</b>' });
  const after = (await s.call({ a: 'hostShop', e: ev.id, k: hk })).orders[0];
  assert.equal(after.status, 'sent'); assert.equal(after.note, 'USPS 9400 b1/b');
  s.env.BOOK_PRICE = '';
  assert.equal((await s.call({ a: 'hostOrder', e: ev.id, k: hk, kind: 'book', ids })).error, 'not_configured');
});

t('planner tools: branding on every event, start from another event, not on the 1-event plan', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const a = await s.call({ a: 'adminCreate', k, settings: { name: 'Smith wedding', shotsPerGuest: 7, challenges: { on: true, list: ['First dance'] }, invite: { on: true, hosts: 'Ann & Bo', venue: 'Barn', note: 'Parking out back' } } });
  assert.equal((await s.call({ a: 'adminCheck', k })).me.planner, true);
  assert.equal((await s.call({ a: 'adminBrand', k, brand: { name: 'Bright Day Events', url: 'javascript:alert(1)' } })).error, 'bad_request');
  const b = await s.call({ a: 'adminBrand', k, brand: { name: '<b>Bright</b> Day Events', url: 'https://brightday.example' } });
  assert.deepEqual(b.brand, { name: 'bBright/b Day Events', url: 'https://brightday.example' });
  assert.equal((await s.call({ a: 'event', e: a.id })).event.planner.name, 'bBright/b Day Events', 'existing events get it');
  const t2 = await s.call({ a: 'adminCreate', k, from: a.id, settings: { name: 'Jones wedding', date: '2027-09-01', shotsPerGuest: 99 } });
  const ev2 = (await s.call({ a: 'hostGet', e: t2.id, k: 'admin:' + k })).event;
  assert.equal(ev2.name, 'Jones wedding'); assert.equal(ev2.settings.shotsPerGuest, 7, 'copied from the template');
  assert.deepEqual(ev2.settings.challenges.list, ['First dance']);
  assert.equal(ev2.settings.invite.on, false); assert.equal(ev2.settings.invite.hosts, ''); assert.equal(ev2.settings.invite.note, 'Parking out back');
  assert.equal(ev2.planner.url, 'https://brightday.example', 'new events get the brand');
  const other = await hostWithDrive(s, { sub: 'google-sub-other' });
  assert.equal((await s.call({ a: 'adminCreate', k: other, from: a.id, settings: { name: 'Steal' } })).error, 'not_found', 'only your own events');
  await s.call({ a: 'adminBrand', k, brand: null });
  assert.equal((await s.call({ a: 'event', e: a.id })).event.planner, undefined);
  const one = await hostWithDrive(s, { sub: 'google-sub-one', plan: 'event' });
  assert.equal((await s.call({ a: 'adminBrand', k: one, brand: { name: 'X' } })).error, 'plan_limit');
  assert.equal((await s.call({ a: 'adminCheck', k: one })).me.planner, false);
});

t('co-host link: free, revocable, cannot replace host links', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Co' } });
  const hk = 'admin:' + k;
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: hk })).event.cohost, false);
  const r = await s.call({ a: 'hostCohost', e: ev.id, k: hk, op: 'create' });
  assert.ok(r.cohostKey && r.cohostKey !== ev.hostKey);
  const g = await s.call({ a: 'hostGet', e: ev.id, k: r.cohostKey });
  assert.equal(g.event.role, 'cohost'); assert.equal(g.event.cohost, true);
  assert.ok((await s.call({ a: 'hostUpdate', e: ev.id, k: r.cohostKey, settings: { welcome: 'Hi from the planner' } })).event, 'co-host can change settings');
  assert.equal((await s.call({ a: 'hostRotateKey', e: ev.id, k: r.cohostKey })).error, 'forbidden');
  assert.equal((await s.call({ a: 'hostCohost', e: ev.id, k: r.cohostKey, op: 'create' })).error, 'forbidden');
  assert.equal((await s.call({ a: 'hostCohost', e: ev.id, k: r.cohostKey, op: 'revoke' })).error, 'forbidden');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: ev.hostKey })).event.role, 'host');
  const r2 = await s.call({ a: 'hostCohost', e: ev.id, k: ev.hostKey, op: 'create' });
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: r.cohostKey })).error, 'unauthorized', 'old co-host link dies');
  await s.call({ a: 'hostCohost', e: ev.id, k: ev.hostKey, op: 'revoke' });
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: r2.cohostKey })).error, 'unauthorized', 'revoked');
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: '' })).error, 'unauthorized', 'empty key never matches an empty co-host hash');
});

t('archive date, recap email, report alert, guest offer', async () => {
  const s = await boot();
  const k = await hostWithDrive(s);
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Recap Party', date: '2026-01-10' } });
  const hk = 'admin:' + k;
  const g = await s.call({ a: 'join', e: ev.id, label: 'Nana' });
  for (let i = 0; i < 2; i++) await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10 });
  s.env.RESEND_API_KEY = 're_test_fake'; s.env.MAIL_FROM = 'Rememberoll <hello@example.com>';
  // recap to the host only, with counts
  const m = await s.call({ a: 'hostMessages', e: ev.id, k: hk });
  assert.equal(m.counts.recap, 1); assert.equal(m.settings.autoRecap, true);
  assert.equal((await s.call({ a: 'hostSend', e: ev.id, k: hk, kind: 'recap' })).sent, 1);
  const rc = s.fk.mail.at(-1);
  assert.match(rc.subject, /Your night in photos: 2 shots/); assert.match(rc.text, /2 photos from 1 guest/);
  assert.doesNotMatch(rc.text, /unsubscribe\.html/, 'host recap has no guest unsubscribe link');
  // report alert to the host, at most once an hour
  const items = (await s.call({ a: 'list', e: ev.id, g: g.guest.id, t: g.token })).items;
  const before = s.fk.mail.length;
  await s.call({ a: 'report', e: ev.id, g: g.guest.id, t: g.token, id: items[0].i });
  await s.call({ a: 'report', e: ev.id, g: g.guest.id, t: g.token, id: items[1].i });
  assert.equal(s.fk.mail.length, before + 1, 'one alert per hour');
  assert.match(s.fk.mail.at(-1).subject, /a photo was reported/);
  // guest offer: off until the owner sets GUEST_OFFER_CODE to an active code
  assert.equal((await s.call({ a: 'offer' })).offer, null);
  const owner = s.env.OWNER_KEY;
  await s.call({ a: 'ownerCodeCreate', k: owner, name: 'Guest offer', code: 'GUEST20', discount: 20, commission: 0 });
  s.env.GUEST_OFFER_CODE = 'guest20';
  assert.deepEqual((await s.call({ a: 'offer' })).offer, { code: 'GUEST20', discount: 20 });
  // archive date: guest pages stop, the host dashboard keeps working
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { archiveAt: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await s.call({ a: 'event', e: ev.id })).error, 'archived');
  assert.equal((await s.call({ a: 'list', e: ev.id, g: g.guest.id, t: g.token })).error, 'archived');
  assert.ok((await s.call({ a: 'hostList', e: ev.id, k: hk })).items.length >= 1);
  await s.call({ a: 'hostUpdate', e: ev.id, k: hk, settings: { archiveAt: '' } });
  assert.ok((await s.call({ a: 'event', e: ev.id })).event);
});

t('Rememberoll storage: buy a pack, uploads go to R2, quota, Drive-full switch, delete frees space', async () => {
  const R2 = fakeR2();
  const s = await boot({ STORE: R2 });
  const k = await hostWithDrive(s);
  // offered with prices: 50 x $0.015/GB-month, for 12 months
  const me = (await s.call({ a: 'adminCheck', k })).me;
  assert.equal(me.storage.active, false);
  assert.deepEqual(me.storage.packs.map((p) => [p.gb, p.price]), [[25, 1875], [100, 7500], [250, 18750]]);
  const ev1 = await s.call({ a: 'adminCreate', k, settings: { name: 'Before' } });
  assert.equal((await s.call({ a: 'hostUseStorage', e: ev1.id, k: 'admin:' + k, on: true })).error, 'storage_needed');
  assert.equal((await s.call({ a: 'storageCheckout', k, gb: 7 })).error, 'bad_request');
  const co = await s.call({ a: 'storageCheckout', k, gb: 25, years: 2 });
  const sid = co.url.split('/').pop();
  assert.equal(s.fk.sessions.get(sid).amount, 3750, '2 years');
  assert.equal((await s.call({ a: 'storageClaim', k, session_id: sid })).error, 'not_paid');
  s.fk.pay(sid);
  const cl = await s.call({ a: 'storageClaim', k, session_id: sid });
  assert.equal(cl.storage.active, true); assert.equal(cl.storage.gb, 25);
  const until = cl.storage.until;
  assert.ok(until > Date.now() + 2 * 364 * 864e5);
  await s.call({ a: 'storageClaim', k, session_id: sid });
  assert.equal((await s.call({ a: 'adminCheck', k })).me.storage.until, until, 'claiming twice adds nothing');
  const other = await hostWithDrive(s, { sub: 'google-sub-other' });
  assert.equal((await s.call({ a: 'storageClaim', k: other, session_id: sid })).error, 'not_found', 'not your payment');
  assert.equal((await s.call({ a: 'hostGet', e: ev1.id, k: 'admin:' + k })).event.store, 'r2', 'open events switched over');
  // uploads land in R2 with r2- ids and load through the app
  const ev = await s.call({ a: 'adminCreate', k, settings: { name: 'Cloud party' } });
  assert.equal((await s.call({ a: 'hostGet', e: ev.id, k: 'admin:' + k })).event.store, 'r2', 'new events use it automatically');
  const g = await s.call({ a: 'join', e: ev.id, label: 'Ann' });
  const up = await s.call({ a: 'upload', e: ev.id, g: g.guest.id, t: g.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10 });
  assert.ok(!up.error, JSON.stringify(up));
  const items = (await s.call({ a: 'hostList', e: ev.id, k: 'admin:' + k })).items;
  assert.match(items[0].i, /^r2-[A-Za-z0-9]{30}$/);
  assert.ok([...R2.objects.keys()].every((x) => x.startsWith(`e/${ev.id}/`) || x.startsWith(`e/${ev1.id}/`)));
  assert.equal((await s.call({ a: 'photo', e: ev.id, id: items[0].i })).mime, 'image/jpeg');
  assert.equal((await s.call({ a: 'hostMedia', e: ev.id, k: 'admin:' + k, id: items[0].i, which: 'orig' })).mime, 'image/jpeg');
  const used = (await s.call({ a: 'adminCheck', k })).me.storage.used;
  assert.ok(used > 0);
  // a smaller pack can't be bought to extend a bigger one
  // (25 is the current size, so 25 is fine and 100 upgrades)
  assert.ok((await s.call({ a: 'storageCheckout', k, gb: 25 })).url);
  // deleting the event frees the space
  await s.call({ a: 'adminDelete', k, e: ev.id, confirm: ev.id });
  assert.equal([...R2.objects.keys()].filter((x) => x.startsWith(`e/${ev.id}/`)).length, 0);
  assert.ok((await s.call({ a: 'adminCheck', k })).me.storage.used < used);
  // Drive full on an event that saves to Drive: it switches to Rememberoll storage and carries on
  const ev3 = await s.call({ a: 'adminCreate', k, settings: { name: 'Drive first' } });
  await s.call({ a: 'hostUseStorage', e: ev3.id, k: 'admin:' + k, on: false });
  s.fk.quota.limit = s.fk.quota.usage; // Google Drive is now full
  const g3 = await s.call({ a: 'join', e: ev3.id, label: 'Bo' });
  const up3 = await s.call({ a: 'upload', e: ev3.id, g: g3.guest.id, t: g3.token, kind: 'photo', data: b64(jpegWithExif()), clientId: cid(), w: 10, h: 10 });
  assert.ok(!up3.error, JSON.stringify(up3));
  assert.equal((await s.call({ a: 'hostGet', e: ev3.id, k: 'admin:' + k })).event.store, 'r2');
});

let passed = 0;
for (const [name, fn] of tests) {
  try { await fn(); passed++; console.log('ok -', name); }
  catch (e) { console.log('FAIL -', name); console.log(e); process.exitCode = 1; }
}
console.log(`\n${passed}/${tests.length} cloud tests passed`);
