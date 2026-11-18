// AfterFlash Cloud: every API action. Same request/response shapes as the Apps Script backend
// (backend/Code.gs), so the website works with either. Hosts' photos go to THEIR Google Drive.
import {
  err, b64encode, b64decode, randomKey, randomId, sha256Hex, safeEq, seal, unseal,
  sniffMime, sniffAudio, sniffImage, isEnc, ENC_OVERHEAD, stripJpegMeta, cleanText, str, int, parseJson,
} from './lib.js';
import { driveFor } from './google.js';
import { createCheckout, readCheckout, PLAN_DAYS, ON_SALE, planPrices, discounted } from './stripe.js';

export const VERSION = '1.11.0';

const LIMITS = {
  PHOTO_BYTES: 8 * 1024 * 1024, VIDEO_BYTES: 20 * 1024 * 1024, THUMB_BYTES: 400 * 1024, AUDIO_BYTES: 3 * 1024 * 1024,
  LOGO_BYTES: 200 * 1024, NAME: 80, WELCOME: 280, LABEL: 24, MAX_GUESTS: 5000, MAX_SHOTS: 500, MAX_EVENTS_LIST: 500,
  UPLOADS_PER_GUEST_PER_MIN: 20, UPLOADS_PER_EVENT_PER_MIN: 600, JOINS_PER_EVENT_PER_MIN: 120, BAD_PIN_PER_EVENT_PER_10MIN: 40,
  BAD_KEY_PER_10MIN: 30, REPORTS_PER_GUEST: 15, NOTES_PER_GUEST: 5, NOTE_TEXT: 500, BLUR_THRESHOLD: 40,
  READS_PER_EVENT_PER_MIN: 900, EVENTS_PER_ACCOUNT: 200, CHECKOUTS_PER_10MIN: 60, REF_LOOKUPS_PER_10MIN: 300,
  HOLD_MS: 365 * 86400000, PAYOUT_WAIT_MS: 14 * 86400000, MAX_PCT: 50, MAX_CASH_CENTS: 100000,
  MAX_TIER: 3, MIN_PAYOUT: 2500, MAX_TEAM: 100, MAX_OPEN_INVITES: 20, INVITE_MS: 14 * 86400000, JOINS_PER_10MIN: 60,
};

// ----------------------------------------------------------------- context
const wrap = (db) => ({
  db,
  one: (sql, ...args) => db.prepare(sql).bind(...args).first(),
  all: async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [],
  run: (sql, ...args) => db.prepare(sql).bind(...args).run(),
});
/** Shard names are '' (the main DB) or SHARD_1 … SHARD_99 (extra D1 databases bound to the worker). */
export const SHARD_RE = /^SHARD_([1-9][0-9]?)$/;
export function makeCtx(env) {
  const main = wrap(env.DB);
  const shards = new Map();
  /** The database holding an event's guests, photos and notes. */
  const shard = (name) => {
    if (!name) return main;
    if (!shards.has(name)) {
      if (!SHARD_RE.test(name) || !env[name]) throw err('server_error', 'This event’s storage isn’t available right now. Try again soon.');
      shards.set(name, wrap(env[name]));
    }
    return shards.get(name);
  };
  return { env, db: env.DB, now: () => Date.now(), one: main.one, all: main.all, run: main.run, shard };
}
/** Where new events go: ACTIVE_SHARD if it names a bound database, otherwise the main one. */
export const activeShard = (env) => (SHARD_RE.test(env.ACTIVE_SHARD || '') && env[env.ACTIVE_SHARD] ? env.ACTIVE_SHARD : '');
const S = (c, ev) => c.shard(ev.shard || '');

async function rateOk(c, bucket, limit, windowSec, peek = false) {
  const slot = Math.floor(c.now() / 1000 / windowSec);
  const k = `${bucket}:${slot}`;
  if (peek) { const r = await c.one('SELECT n FROM rate WHERE k = ?', k); return !r || r.n < limit; }
  const r = await c.one('INSERT INTO rate (k, n, exp) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = n + 1 RETURNING n', k, (slot + 2) * windowSec * 1000);
  if (Math.random() < 0.01) await c.run('DELETE FROM rate WHERE exp < ?', c.now());
  return r.n <= limit;
}
const rateHit = (c, bucket, windowSec) => rateOk(c, bucket, 1e9, windowSec);

async function logProblem(c, account, where, eventId, message) {
  try {
    await c.run('INSERT INTO problems (account, t, w, e, m) VALUES (?, ?, ?, ?, ?)', account || '', c.now(), String(where).slice(0, 30), String(eventId || '').slice(0, 20), String(message).slice(0, 300));
    await c.run('DELETE FROM problems WHERE account = ? AND id NOT IN (SELECT id FROM problems WHERE account = ? ORDER BY id DESC LIMIT 50)', account || '', account || '');
  } catch { /* never let logging break a request */ }
}

// ----------------------------------------------------------------- settings / views
function sanitizeSettings(s) {
  s = s || {};
  const iso = (v) => { if (!v) return ''; const t = Date.parse(v); return isNaN(t) ? '' : new Date(t).toISOString(); };
  const looks = ['none', 'vivid', 'classic', 'warm', 'moody', 'mono'];
  return {
    name: cleanText(s.name, LIMITS.NAME),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) ? String(s.date) : '',
    welcome: cleanText(s.welcome, LIMITS.WELCOME),
    reveal: s.reveal === 'after' ? 'after' : 'live',
    revealAt: iso(s.revealAt), opensAt: iso(s.opensAt), closesAt: iso(s.closesAt),
    shotsPerGuest: int(s.shotsPerGuest, 1, LIMITS.MAX_SHOTS, 25),
    maxGuests: int(s.maxGuests, 1, LIMITS.MAX_GUESTS, 150),
    allowVideo: s.allowVideo !== false,
    maxVideoSec: int(s.maxVideoSec, 3, 60, 15),
    maxStorageMB: int(s.maxStorageMB, 100, 200000, 15000),
    allowLibrary: s.allowLibrary === true,
    approval: s.approval === true,
    guestGallery: s.guestGallery !== false,
    allowReports: s.allowReports !== false,
    enhance: s.enhance !== false,
    encrypted: s.encrypted === true,
    guestbook: s.guestbook !== false,
    paused: s.paused === true,
    look: looks.includes(s.look) ? s.look : 'none',
    guestLooks: s.guestLooks !== false,
    beauty: s.beauty !== false,
    dateStamp: s.dateStamp === true,
    accent: /^#[0-9a-fA-F]{6}$/.test(String(s.accent)) ? String(s.accent) : '#0f7c7a',
    font: ['modern', 'elegant', 'script'].includes(s.font) ? s.font : 'modern',
    tagline: cleanText(s.tagline, 80),
  };
}
function isRevealed(s) {
  if (s.reveal !== 'after') return true;
  if (!s.revealAt) return false;
  return Date.now() >= Date.parse(s.revealAt);
}
function publicEvent(ev) {
  const s = ev.settings;
  return {
    id: ev.id, name: s.name, date: s.date, welcome: s.welcome, reveal: s.reveal, revealAt: s.revealAt,
    opensAt: s.opensAt, closesAt: s.closesAt, shotsPerGuest: s.shotsPerGuest, allowVideo: s.allowVideo,
    maxVideoSec: s.maxVideoSec, allowLibrary: s.allowLibrary, guestGallery: s.guestGallery,
    allowReports: s.allowReports, paused: s.paused, look: s.look, guestLooks: s.guestLooks, beauty: s.beauty, dateStamp: s.dateStamp,
    accent: s.accent, font: s.font, tagline: s.tagline, logoV: ev.logo ? ev.logo.v : '', approval: s.approval, encrypted: s.encrypted,
    enhance: s.enhance, guestbook: s.guestbook, needsPin: !!ev.pin_hash, revealed: isRevealed(s), now: Date.now(),
  };
}
async function wallKey(ev) { return (await sha256Hex(ev.host_hash + ':wall')).slice(0, 32); }
async function hostEvent(ev) {
  const p = publicEvent(ev);
  p.wallKey = await wallKey(ev);
  p.settings = ev.settings;
  p.folderUrl = 'https://drive.google.com/drive/folders/' + ev.folder;
  p.createdAt = ev.created;
  return p;
}
const guestView = (ev, g) => ({ id: g.id, label: g.label, shotsUsed: g.shots, shotsLeft: Math.max(0, ev.settings.shotsPerGuest - g.shots), blocked: !!g.blocked });

// ----------------------------------------------------------------- loading + auth
async function loadEvent(c, id) {
  id = str(id, 20);
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) throw err('not_found', 'Event not found');
  const row = await c.one('SELECT * FROM events WHERE id = ? AND deleted = 0', id);
  if (!row) throw err('not_found', 'Event not found');
  row.settings = sanitizeSettings(parseJson(row.settings));
  row.logo = row.logo ? parseJson(row.logo) : null;
  if (row.logo && !row.logo.id) row.logo = null;
  return row;
}
async function accountOf(c, ev) {
  const a = await c.one('SELECT * FROM accounts WHERE id = ?', ev.account);
  if (!a || a.status !== 'active') throw err('not_found', 'Event not found');
  return a;
}
const drive = async (c, ev) => driveFor(c.env, c.db, await accountOf(c, ev));
// Partner-only accounts (plan 'partner') can sign in to see earnings but can't host until they buy a plan.
const expired = (a) => a.kind !== 'owner' && (a.plan === 'partner' || (Number(a.expires) > 0 && Number(a.expires) < Date.now()));
const fmtDay = (t) => new Date(t).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
/** Albums stay online for 12 months after a plan ends; after that only the host's Drive has the photos. */
const archived = (a) => a.kind !== 'owner' && a.plan !== 'partner' && Number(a.expires) > 0 && Number(a.expires) + LIMITS.HOLD_MS < Date.now();
async function loadPublicEvent(c, id) {
  const ev = await loadEvent(c, id);
  const a = await accountOf(c, ev);
  if (archived(a)) throw err('archived', 'This album has closed: albums stay online for 12 months after the host’s plan ends. The photos are still in the host’s Google Drive.');
  return ev;
}
/** Hosting (dashboards, new photos) needs the event's account to have an active plan. Viewing albums doesn't. */
async function requireActivePlan(c, ev, forGuests) {
  const a = await accountOf(c, ev);
  if (expired(a)) {
    throw forGuests ? err('paused', 'The host’s AfterFlash plan has ended, so new photos are paused for now. They’ll upload once it’s renewed.')
      : err('plan_expired', `This AfterFlash plan ended on ${fmtDay(a.expires)}. Renew it on the admin page to keep hosting.`);
  }
  return a;
}

async function checkPin(c, ev, pin) {
  if (!ev.pin_hash) return;
  const bucket = 'badpin:' + ev.id;
  if (!(await rateOk(c, bucket, LIMITS.BAD_PIN_PER_EVENT_PER_10MIN, 600, true))) throw err('rate_limited', 'Too many wrong codes. Wait a few minutes.');
  if (!pin || !safeEq(await sha256Hex(ev.id + ':' + pin), ev.pin_hash)) { await rateHit(c, bucket, 600); throw err('pin_required', 'Enter the event code.'); }
}

/** Host account from an admin key. The site owner's key (OWNER_KEY secret) has extra powers. */
async function authAccount(c, req, { allowExpired = false } = {}) {
  const k = req.k ? String(req.k).slice(0, 200) : '';
  if (k) {
    const hash = await sha256Hex(k);
    if (c.env.OWNER_KEY && safeEq(hash, await sha256Hex(String(c.env.OWNER_KEY)))) {
      let owner = await c.one('SELECT * FROM accounts WHERE id = ?', 'owner');
      if (!owner) {
        await c.run('INSERT INTO accounts (id, key_hash, kind, created) VALUES (?, ?, ?, ?)', 'owner', null, 'owner', c.now());
        owner = await c.one('SELECT * FROM accounts WHERE id = ?', 'owner');
      }
      return owner;
    }
    const a = await c.one('SELECT * FROM accounts WHERE key_hash = ?', hash);
    if (a) {
      if (a.status !== 'active') throw err('forbidden', 'This account is turned off. Contact support.');
      if (!allowExpired && expired(a)) throw err('plan_expired', a.plan === 'partner' ? 'This is a partner account. Buy a plan to host your own events.' : `Your AfterFlash plan ended on ${fmtDay(a.expires)}. Renew to keep hosting; your events and photos are safe.`);
      return a;
    }
  }
  if (!(await rateOk(c, 'badkey', LIMITS.BAD_KEY_PER_10MIN, 600, true))) throw err('rate_limited', 'Too many attempts. Wait 10 minutes.');
  await rateHit(c, 'badkey', 600);
  throw err('unauthorized', 'That admin key isn’t right.');
}
const requireOwner = (a) => { if (a.kind !== 'owner') throw err('forbidden', 'Only the site owner can do that.'); };

async function authHost(c, req) {
  const ev = await loadEvent(c, req.e);
  if (typeof req.k === 'string' && req.k.startsWith('admin:')) {
    const a = await authAccount(c, { k: req.k.slice(6) });
    if (a.id !== ev.account) throw err('forbidden', 'Only the account that created this event can open its dashboard.');
    return ev;
  }
  if (req.k && safeEq(await sha256Hex(String(req.k).slice(0, 200)), ev.host_hash)) { await requireActivePlan(c, ev, false); return ev; }
  const bucket = 'badhost:' + ev.id;
  if (!(await rateOk(c, bucket, LIMITS.BAD_KEY_PER_10MIN, 600, true))) throw err('rate_limited', 'Too many attempts. Wait 10 minutes.');
  await rateHit(c, bucket, 600);
  throw err('unauthorized', 'Invalid host link');
}
async function findGuest(c, ev, id) {
  if (!id) return null;
  return S(c, ev).one('SELECT * FROM guests WHERE event = ? AND id = ?', ev.id, str(id, 40));
}
async function authGuest(c, ev, req) {
  const g = await findGuest(c, ev, req.g);
  if (!g || !req.t || !safeEq(g.token_hash, await sha256Hex(String(req.t).slice(0, 200)))) throw err('unauthorized', 'Please re-open the event link.');
  return g;
}
const bump = (c, ev) => c.run('UPDATE events SET v = ? WHERE id = ?', randomId(8), ev.id);
async function eventKey(c, ev) {
  if (!ev.settings.encrypted) return '';
  const k = await unseal(c.env, ev.ek_enc);
  if (!k) throw err('server_error', 'This private event’s key is missing.');
  return k;
}
async function subFolder(c, ev, col, name) {
  if (ev[col]) return ev[col];
  const d = await drive(c, ev);
  const id = await d.createFolder(name, ev.folder);
  await c.run(`UPDATE events SET ${col} = ? WHERE id = ?`, id, ev.id);
  ev[col] = id;
  return id;
}
async function share(c, ev, ids, isPublic) {
  const d = await drive(c, ev);
  let ok = true;
  for (const id of ids.filter(Boolean)) {
    try { await d.share(id, isPublic); } catch (e) { ok = false; await logProblem(c, ev.account, 'sharing', ev.id, `Google Drive refused link sharing (${e.message}). Photos still upload.`); }
  }
  return ok;
}
async function readable(c, ev, req, m) {
  if (!m || m.status === 'deleted' || m.event !== ev.id) return false;
  const s = ev.settings;
  const isWall = !!req.wk && safeEq(String(req.wk), await wallKey(ev));
  if (req.g && req.t) {
    const g = await findGuest(c, ev, req.g);
    if (g && safeEq(g.token_hash, await sha256Hex(String(req.t))) && m.guest === g.id) return true;
  }
  if (m.status !== 'visible' || !isRevealed(s) || (!s.guestGallery && !isWall)) return false;
  if (!isWall) await checkPin(c, ev, req.pin);
  return true;
}
const mediaRow = (c, ev, id) => S(c, ev).one('SELECT * FROM media WHERE event = ? AND id = ?', ev.id, str(id, 100));

// ================================================================= public (guests)
const A = {};

A.event = async (c, req) => ({ event: publicEvent(await loadPublicEvent(c, req.e)) });

A.join = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  await checkPin(c, ev, req.pin);
  if (!(await rateOk(c, 'join:' + ev.id, LIMITS.JOINS_PER_EVENT_PER_MIN, 60))) throw err('rate_limited', 'Too many people joining at once. Try again in a moment.');
  if (req.g && req.t) {
    const g = await findGuest(c, ev, req.g);
    if (g && safeEq(g.token_hash, await sha256Hex(String(req.t)))) return { guest: guestView(ev, g), event: publicEvent(ev), key: (await eventKey(c, ev)) || undefined };
  }
  const n = await S(c, ev).one('SELECT COUNT(*) AS n FROM guests WHERE event = ?', ev.id);
  if (n.n >= ev.settings.maxGuests * 4 + 50) throw err('full', 'This event has reached its guest limit.');
  const id = randomId(12), token = randomKey(24);
  const label = cleanText(req.label, LIMITS.LABEL) || 'Guest ' + id.slice(0, 4).toUpperCase();
  await S(c, ev).run('INSERT INTO guests (event, id, token_hash, label, created) VALUES (?, ?, ?, ?, ?)', ev.id, id, await sha256Hex(token), label, c.now());
  return { guest: guestView(ev, { id, label, shots: 0, blocked: 0 }), token, event: publicEvent(ev), shotsPerGuest: ev.settings.shotsPerGuest, key: (await eventKey(c, ev)) || undefined };
};

A.me = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const g = await authGuest(c, ev, req);
  return { guest: guestView(ev, g), key: (await eventKey(c, ev)) || undefined };
};

A.upload = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const s = ev.settings;
  const g = await authGuest(c, ev, req);
  const now = c.now();
  if (s.paused) throw err('paused', 'The host has paused uploads.');
  await requireActivePlan(c, ev, true);
  if (s.opensAt && now < Date.parse(s.opensAt)) throw err('not_open', 'Uploads have not opened yet.');
  if (s.closesAt && now > Date.parse(s.closesAt)) throw err('closed', 'This album is closed.');
  if (g.blocked) throw err('blocked', 'Uploads are turned off for this guest.');
  const kind = req.kind === 'video' ? 'video' : 'photo';
  if (kind === 'video' && !s.allowVideo) throw err('no_video', 'Videos are turned off for this event.');
  const clientId = str(req.clientId, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) throw err('bad_request', 'Invalid clientId');
  if (!(await rateOk(c, `upg:${ev.id}:${g.id}`, LIMITS.UPLOADS_PER_GUEST_PER_MIN, 60))) throw err('rate_limited', 'Slow down a little.');
  if (!(await rateOk(c, 'upe:' + ev.id, LIMITS.UPLOADS_PER_EVENT_PER_MIN, 60))) throw err('rate_limited', 'Lots of uploads right now. Retrying soon.');
  const dup = await S(c, ev).one('SELECT id FROM media WHERE event = ? AND guest = ? AND client = ?', ev.id, g.id, clientId);
  if (dup) return { id: dup.id, duplicate: true, guest: guestView(ev, g) };
  const used = await S(c, ev).one("SELECT COALESCE(SUM(bytes), 0) AS b FROM media WHERE event = ? AND status != 'deleted'", ev.id);

  const enc = s.encrypted === true;
  let bytes = b64decode(req.data);
  const max = (kind === 'video' ? LIMITS.VIDEO_BYTES : LIMITS.PHOTO_BYTES) + (enc ? ENC_OVERHEAD : 0);
  if (!bytes.length || bytes.length > max) throw err('too_large', 'File is too large.');
  if (used.b + bytes.length > s.maxStorageMB * 1024 * 1024) throw err('full', 'This album has reached its storage limit.');
  let mime, plainSha = '';
  if (enc) {
    if (!isEnc(bytes)) throw err('needs_update', 'This event needs the latest version of the camera page. Please reload.');
    mime = String(req.mime || '');
    if (kind === 'photo' && mime !== 'image/jpeg') throw err('bad_type', 'Photos must be JPEG.');
    if (kind === 'video' && mime !== 'video/mp4' && mime !== 'video/webm') throw err('bad_type', 'Unsupported video format.');
    plainSha = /^[0-9a-f]{64}$/.test(String(req.sha)) ? String(req.sha) : '';
  } else {
    mime = sniffMime(bytes);
    if (kind === 'photo' && mime !== 'image/jpeg') throw err('bad_type', 'Photos must be JPEG.');
    if (kind === 'video' && mime !== 'video/mp4' && mime !== 'video/webm') throw err('bad_type', 'Unsupported video format.');
    if (mime === 'image/jpeg') bytes = stripJpegMeta(bytes);
    plainSha = /^[0-9a-f]{64}$/.test(String(req.sha)) ? String(req.sha) : '';
  }
  let thumbBytes = null;
  if (req.thumb) {
    thumbBytes = b64decode(req.thumb);
    if (enc) { if (thumbBytes.length > LIMITS.THUMB_BYTES + ENC_OVERHEAD || !isEnc(thumbBytes)) throw err('bad_type', 'Invalid preview image.'); }
    else {
      if (thumbBytes.length > LIMITS.THUMB_BYTES || sniffMime(thumbBytes) !== 'image/jpeg') throw err('bad_type', 'Invalid preview image.');
      thumbBytes = stripJpegMeta(thumbBytes);
    }
  }
  if (kind === 'video' && !thumbBytes) throw err('bad_request', 'Video preview required.');

  // Reserve a shot atomically so parallel uploads can't exceed the roll or the guest limit.
  if (g.uploads === 0) {
    const active = await S(c, ev).one('SELECT COUNT(*) AS n FROM guests WHERE event = ? AND uploads > 0', ev.id);
    if (active.n >= s.maxGuests) throw err('full', 'This event has reached its guest limit.');
  }
  const total = await S(c, ev).one('SELECT COUNT(*) AS n FROM media WHERE event = ?', ev.id);
  if (total.n >= s.maxGuests * s.shotsPerGuest + 50) throw err('full', 'This album is full.');
  const res = await S(c, ev).run('UPDATE guests SET shots = shots + 1, uploads = uploads + 1 WHERE event = ? AND id = ? AND shots < ?', ev.id, g.id, s.shotsPerGuest);
  if (!res.meta || !res.meta.changes) throw err('no_shots', 'Your roll is finished!');
  g.shots += 1; g.uploads += 1;
  const refund = () => S(c, ev).run('UPDATE guests SET shots = MAX(0, shots - 1), uploads = MAX(0, uploads - 1) WHERE event = ? AND id = ?', ev.id, g.id);

  const d = await drive(c, ev).catch(async (e) => { await refund(); throw e; });
  const ext = { 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/webm': 'webm' }[mime];
  const base = new Date(now).toISOString().replace(/[-:]/g, '').slice(0, 15) + '_' + g.id.slice(0, 6) + '_' + clientId.slice(0, 8);
  const sfx = enc ? '.enc' : '';
  let fileId = '', thumbId = '';
  try {
    fileId = await d.upload({ name: `${base}.${ext}${sfx}`, mime: enc ? 'application/octet-stream' : mime, parent: ev.folder, bytes });
    if (thumbBytes) thumbId = await d.upload({ name: `${base}_preview.jpg${sfx}`, mime: enc ? 'application/octet-stream' : 'image/jpeg', parent: await subFolder(c, ev, 'previews_folder', 'Previews (used by the app)'), bytes: thumbBytes });
  } catch (e) {
    await refund();
    if (fileId) await d.trash(fileId).catch(() => {});
    if (e.code === 'drive_full') await logProblem(c, ev.account, 'upload', ev.id, 'Your Google Drive is full, so new photos can’t be saved. Free up space or add storage from Google.');
    throw e;
  }
  const status = s.approval ? 'pending' : 'visible';
  const flags = [];
  const blur = Number(req.blur);
  if (kind === 'photo' && isFinite(blur) && blur >= 0 && blur < LIMITS.BLUR_THRESHOLD) flags.push('blurry');
  if (!enc && status === 'visible' && !(await share(c, ev, [fileId, thumbId], true))) flags.push('share-failed');
  if (enc) flags.push('encrypted');
  try {
    await S(c, ev).run('INSERT INTO media (event, id, thumb, guest, kind, mime, bytes, sha, w, h, dur, created, status, client, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ev.id, fileId, thumbId, g.id, kind, mime, bytes.length, plainSha, int(req.w, 0, 20000, 0), int(req.h, 0, 20000, 0), int(req.dur, 0, 600, 0), now, status, clientId, flags.join(','));
  } catch (e) {
    await d.trash(fileId).catch(() => {}); if (thumbId) await d.trash(thumbId).catch(() => {});
    await refund();
    const again = await S(c, ev).one('SELECT id FROM media WHERE event = ? AND guest = ? AND client = ?', ev.id, g.id, clientId);
    if (again) return { id: again.id, duplicate: true, guest: guestView(ev, g) };
    throw e;
  }
  await bump(c, ev);
  return { id: fileId, status, guest: guestView(ev, g) };
};

A.list = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const s = ev.settings;
  const isWall = req.mode === 'wall' && !!req.wk && safeEq(String(req.wk), await wallKey(ev));
  if (!isWall) await checkPin(c, ev, req.pin);
  const revealed = isRevealed(s);
  if (!ev.v) { ev.v = randomId(8); await c.run('UPDATE events SET v = ? WHERE id = ?', ev.v, ev.id); }
  const base = { v: ev.v, revealed, event: publicEvent(ev) };
  if (req.v && req.v === ev.v) { base.unchanged = true; return base; }
  const rows = await S(c, ev).all('SELECT m.*, g.label AS glabel FROM media m LEFT JOIN guests g ON g.event = m.event AND g.id = m.guest WHERE m.event = ? ORDER BY m.seq', ev.id);
  const visible = rows.filter((m) => m.status === 'visible');
  base.count = visible.length;
  base.pending = rows.filter((m) => m.status === 'pending').length;
  if (s.encrypted && revealed && (s.guestGallery || isWall)) base.key = await eventKey(c, ev);
  if (!revealed || (!s.guestGallery && !isWall)) { base.items = []; return base; }
  base.items = visible.map((m) => ({ i: m.id, t: m.thumb || '', k: m.kind === 'video' ? 'v' : 'p', g: m.glabel || (m.guest === 'recovered' ? 'Recovered from Drive' : ''), c: m.created, w: m.w, h: m.h, d: m.dur || 0, f: m.fav ? 1 : 0 }));
  return base;
};

A.thumb = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  if (!(await rateOk(c, 'read:' + ev.id, LIMITS.READS_PER_EVENT_PER_MIN, 60))) throw err('rate_limited', 'Busy, try again.');
  const m = await mediaRow(c, ev, req.id);
  if (!(await readable(c, ev, req, m))) throw err('not_found', 'Not found');
  if (!m.thumb && m.kind === 'video') throw err('not_found', 'Not found');
  const bytes = await (await drive(c, ev)).download(m.thumb || m.id);
  if (isEnc(bytes)) {
    if (bytes.length > LIMITS.THUMB_BYTES + ENC_OVERHEAD) throw err('too_large', 'Preview too large');
    return { mime: 'image/jpeg', enc: true, data: b64encode(bytes) };
  }
  if (sniffMime(bytes) !== 'image/jpeg') throw err('not_found', 'Not found');
  if (bytes.length > LIMITS.THUMB_BYTES && m.thumb) throw err('too_large', 'Preview too large');
  return { mime: 'image/jpeg', data: b64encode(bytes) };
};

A.photo = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  if (!(await rateOk(c, 'read:' + ev.id, LIMITS.READS_PER_EVENT_PER_MIN, 60))) throw err('rate_limited', 'Busy, try again.');
  const m = await mediaRow(c, ev, req.id);
  if (!(await readable(c, ev, req, m))) throw err('not_found', 'Not found');
  const bytes = await (await drive(c, ev)).download(m.id);
  if (isEnc(bytes)) {
    if (bytes.length > LIMITS.VIDEO_BYTES + ENC_OVERHEAD) throw err('too_large', 'Too large');
    return { mime: m.mime, enc: true, data: b64encode(bytes) };
  }
  const mime = sniffMime(bytes);
  if (m.kind === 'video') {
    if (bytes.length > LIMITS.VIDEO_BYTES || (mime !== 'video/mp4' && mime !== 'video/webm')) throw err('not_found', 'Not found');
    return { mime, data: b64encode(bytes) };
  }
  if (bytes.length > LIMITS.PHOTO_BYTES || mime !== 'image/jpeg') throw err('not_found', 'Not found');
  return { mime: 'image/jpeg', data: b64encode(bytes) };
};

A.mine = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const g = await authGuest(c, ev, req);
  const rows = await S(c, ev).all("SELECT * FROM media WHERE event = ? AND guest = ? AND status != 'deleted' ORDER BY seq", ev.id, g.id);
  return { items: rows.map((m) => ({ i: m.id, t: m.thumb || '', k: m.kind === 'video' ? 'v' : 'p', c: m.created, w: m.w, h: m.h, s: m.status })), guest: guestView(ev, g) };
};

A.report = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  if (!ev.settings.allowReports) throw err('disabled', 'Reporting is turned off.');
  const g = await authGuest(c, ev, req);
  if (g.uploads < 1) throw err('not_allowed', 'Take a photo first, then you can report photos.');
  if (g.reports >= LIMITS.REPORTS_PER_GUEST) throw err('rate_limited', 'Report limit reached. Please tell the host.');
  const m = await mediaRow(c, ev, req.id);
  if (!m) throw err('not_found', 'Photo not found.');
  if (m.status === 'visible') {
    await S(c, ev).run("UPDATE media SET status = 'reported', reports = reports + 1 WHERE seq = ?", m.seq);
    await share(c, ev, [m.id, m.thumb], false);
  }
  await S(c, ev).run('UPDATE guests SET reports = reports + 1 WHERE event = ? AND id = ?', ev.id, g.id);
  await bump(c, ev);
  return {};
};

// ---- guestbook
A.guestbookAdd = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const s = ev.settings;
  if (!s.guestbook) throw err('disabled', 'The guestbook is turned off.');
  const g = await authGuest(c, ev, req);
  if (g.blocked) throw err('blocked', 'Posting is turned off for this guest.');
  await requireActivePlan(c, ev, true);
  if (s.closesAt && c.now() > Date.parse(s.closesAt)) throw err('closed', 'This album is closed.');
  const clientId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.clientId || '')) ? String(req.clientId) : '';
  if (clientId) {
    const prev = await S(c, ev).one('SELECT id, status FROM notes WHERE event = ? AND guest = ? AND client = ?', ev.id, g.id, clientId);
    if (prev) return { id: prev.id, status: prev.status, duplicate: true };
  }
  const text = cleanText(req.text, LIMITS.NOTE_TEXT);
  let audio = null, mime = '';
  if (req.audio) {
    audio = b64decode(req.audio);
    if (audio.length > LIMITS.AUDIO_BYTES + ENC_OVERHEAD) throw err('too_large', 'That voice message is too long.');
    if (s.encrypted) {
      if (!isEnc(audio)) throw err('needs_update', 'This event needs the latest version of the page. Please reload.');
      mime = /^audio\/(webm|mp4|ogg)$/.test(String(req.audioMime)) ? String(req.audioMime) : '';
    } else mime = sniffAudio(audio);
    if (!mime) throw err('bad_type', 'This phone recorded in a format we can’t save. Try typing a message instead.');
  }
  if (!text && !audio) throw err('bad_request', 'Write a note or record a message.');
  if (!(await rateOk(c, `gb:${ev.id}:${g.id}`, 4, 60))) throw err('rate_limited', 'Slow down a little.');
  const existing = await S(c, ev).one("SELECT COUNT(*) AS n FROM notes WHERE event = ? AND guest = ? AND status != 'deleted'", ev.id, g.id);
  if (existing.n >= LIMITS.NOTES_PER_GUEST) throw err('full', 'You’ve left the maximum number of messages.');
  const status = s.approval ? 'pending' : 'visible';
  const id = randomId(12);
  let audioId = '';
  if (audio) {
    const ext = { 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg' }[mime];
    const d = await drive(c, ev);
    audioId = await d.upload({ name: `guestbook_${id}${ext}${s.encrypted ? '.enc' : ''}`, mime: s.encrypted ? 'application/octet-stream' : mime, parent: await subFolder(c, ev, 'voice_folder', 'Guestbook voice messages'), bytes: audio });
  }
  await S(c, ev).run('INSERT INTO notes (id, event, guest, label, text, audio, created, status, client, dur) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, ev.id, g.id, g.label, text, audioId ? `${audioId}|${mime}` : '', c.now(), status, clientId, int(req.dur, 0, 600, 0));
  await bump(c, ev);
  return { id, status };
};
const audioParts = (a) => { const [id, mime] = String(a || '').split('|'); return { id: id || '', mime: mime || '' }; };

A.guestbookList = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const s = ev.settings;
  const isWall = !!req.wk && safeEq(String(req.wk), await wallKey(ev));
  if (!isWall) await checkPin(c, ev, req.pin);
  if (!s.guestbook || !isRevealed(s) || (!s.guestGallery && !isWall)) return { notes: [] };
  const rows = await S(c, ev).all("SELECT * FROM notes WHERE event = ? AND status = 'visible' ORDER BY created", ev.id);
  return { notes: rows.map((n) => ({ id: n.id, g: n.label, text: n.text, a: audioParts(n.audio).id, c: n.created, d: n.dur })) };
};

A.noteAudio = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  const s = ev.settings;
  const isWall = !!req.wk && safeEq(String(req.wk), await wallKey(ev));
  if (!isWall) await checkPin(c, ev, req.pin);
  if (!s.guestbook || !isRevealed(s) || (!s.guestGallery && !isWall)) throw err('not_found', 'Not found');
  if (!(await rateOk(c, 'read:' + ev.id, LIMITS.READS_PER_EVENT_PER_MIN, 60))) throw err('rate_limited', 'Busy, try again.');
  const id = str(req.id, 100);
  const note = id && await S(c, ev).one("SELECT * FROM notes WHERE event = ? AND status = 'visible' AND substr(audio, 1, ?) = ?", ev.id, id.length + 1, id + '|');
  if (!note || !id) throw err('not_found', 'Not found');
  const { mime } = audioParts(note.audio);
  const bytes = await (await drive(c, ev)).download(id);
  if (isEnc(bytes)) return { mime, enc: true, data: b64encode(bytes) };
  if (bytes.length > LIMITS.AUDIO_BYTES || !sniffAudio(bytes)) throw err('not_found', 'Not found');
  return { mime: sniffAudio(bytes), data: b64encode(bytes) };
};

A.logo = async (c, req) => {
  const ev = await loadPublicEvent(c, req.e);
  if (!ev.logo) throw err('not_found', 'No logo');
  if (!(await rateOk(c, 'logo:' + ev.id, 240, 60))) throw err('rate_limited', 'Busy, try again.');
  const bytes = await (await drive(c, ev)).download(ev.logo.id);
  if (bytes.length > LIMITS.LOGO_BYTES || sniffImage(bytes) !== ev.logo.mime) throw err('not_found', 'No logo');
  return { mime: ev.logo.mime, v: ev.logo.v, data: b64encode(bytes) };
};

// ================================================================= host (host key or the owning account's admin key)
A.hostGet = async (c, req) => {
  const ev = await authHost(c, req);
  return { event: { ...(await hostEvent(ev)), purged: !!ev.purged }, key: (await eventKey(c, ev)) || undefined };
};

A.hostUpdate = async (c, req) => {
  const ev = await authHost(c, req);
  const incoming = req.settings && typeof req.settings === 'object' ? req.settings : {};
  const merged = {};
  for (const k of Object.keys(ev.settings)) merged[k] = Object.prototype.hasOwnProperty.call(incoming, k) ? incoming[k] : ev.settings[k];
  merged.encrypted = ev.settings.encrypted;
  const next = sanitizeSettings(merged);
  let pinHash = ev.pin_hash;
  if (req.pin === '') pinHash = '';
  else if (req.pin != null) {
    if (!/^[0-9]{4,8}$/.test(String(req.pin))) throw err('bad_request', 'Code must be 4–8 digits.');
    pinHash = await sha256Hex(ev.id + ':' + req.pin);
  }
  await c.run('UPDATE events SET name = ?, settings = ?, pin_hash = ?, v = ? WHERE id = ?', next.name, JSON.stringify(next), pinHash, randomId(8), ev.id);
  ev.settings = next; ev.pin_hash = pinHash;
  return { event: await hostEvent(ev) };
};

A.hostList = async (c, req) => {
  const ev = await authHost(c, req);
  const rows = await S(c, ev).all("SELECT m.*, g.label AS glabel FROM media m LEFT JOIN guests g ON g.event = m.event AND g.id = m.guest WHERE m.event = ? AND m.status != 'deleted' ORDER BY m.seq", ev.id);
  if (!ev.v) { ev.v = randomId(8); await c.run('UPDATE events SET v = ? WHERE id = ?', ev.v, ev.id); }
  return {
    items: rows.map((m) => ({ i: m.id, t: m.thumb, k: m.kind === 'video' ? 'v' : 'p', g: m.glabel || (m.guest === 'recovered' ? 'Recovered from Drive' : ''), gid: m.guest,
      c: m.created, w: m.w, h: m.h, s: m.status, r: m.reports || 0, b: m.bytes, sha: m.sha, ai: null, f: m.flags || '', fv: !!m.fav })),
    v: ev.v, event: await hostEvent(ev),
  };
};

A.hostModerate = async (c, req) => {
  const ev = await authHost(c, req);
  const map = { show: 'visible', approve: 'visible', hide: 'hidden', delete: 'deleted' };
  const status = map[req.action];
  if (!status) throw err('bad_request', 'Unknown moderation action');
  const ids = Array.isArray(req.ids) ? req.ids.slice(0, 200).map((x) => str(x, 100)) : [];
  const d = await drive(c, ev);
  let changed = 0;
  for (const id of ids) {
    const m = await mediaRow(c, ev, id);
    if (!m || m.status === 'deleted') continue;
    if (status === 'deleted') { await d.trash(m.id).catch(() => {}); if (m.thumb) await d.trash(m.thumb).catch(() => {}); }
    else if (!m.flags.includes('encrypted')) await share(c, ev, [m.id, m.thumb], status === 'visible');
    await S(c, ev).run('UPDATE media SET status = ?, reports = ? WHERE seq = ?', status, status === 'visible' ? 0 : m.reports, m.seq);
    changed++;
  }
  await bump(c, ev);
  return { changed };
};

A.hostFavorite = async (c, req) => {
  const ev = await authHost(c, req);
  const ids = Array.isArray(req.ids) ? req.ids.slice(0, 200).map((x) => str(x, 100)) : [];
  let changed = 0;
  for (const id of ids) { const r = await S(c, ev).run("UPDATE media SET fav = ? WHERE event = ? AND id = ? AND status != 'deleted'", req.fav === true ? 1 : 0, ev.id, id); changed += r.meta.changes || 0; }
  await bump(c, ev);
  return { changed };
};

A.hostGuests = async (c, req) => {
  const ev = await authHost(c, req);
  const rows = await S(c, ev).all('SELECT * FROM guests WHERE event = ? ORDER BY created', ev.id);
  return { guests: rows.map((r) => ({ id: r.id, label: r.label, shots: r.shots, uploads: r.uploads, joined: r.created, reports: r.reports, blocked: !!r.blocked })) };
};

A.hostBlockGuest = async (c, req) => {
  const ev = await authHost(c, req);
  const r = await S(c, ev).run('UPDATE guests SET blocked = ? WHERE event = ? AND id = ?', req.block === true ? 1 : 0, ev.id, str(req.guestId, 40));
  if (!r.meta.changes) throw err('not_found', 'Guest not found');
  return {};
};

A.hostRotateKey = async (c, req) => {
  const ev = await authHost(c, req);
  const key = randomKey(32);
  await c.run('UPDATE events SET host_hash = ? WHERE id = ?', await sha256Hex(key), ev.id);
  return { hostKey: key };
};

A.hostMedia = async (c, req) => {
  const ev = await authHost(c, req);
  const id = str(req.id, 100);
  const d = await drive(c, ev);
  const m = await mediaRow(c, ev, id);
  if (!m && req.which === 'note') {
    const note = id && await S(c, ev).one("SELECT * FROM notes WHERE event = ? AND status != 'deleted' AND substr(audio, 1, ?) = ?", ev.id, id.length + 1, id + '|');
    if (!note || !id) throw err('not_found', 'Not found');
    const bytes = await d.download(id);
    return { mime: audioParts(note.audio).mime, enc: isEnc(bytes) || undefined, data: b64encode(bytes) };
  }
  if (!m || m.status === 'deleted') throw err('not_found', 'Not found');
  const which = req.which === 'orig' ? m.id : (m.thumb || m.id);
  const bytes = await d.download(which);
  if (bytes.length > LIMITS.VIDEO_BYTES + ENC_OVERHEAD) throw err('too_large', 'File too large to fetch');
  const mime = which === m.id ? m.mime : 'image/jpeg';
  if (isEnc(bytes)) return { mime, enc: true, data: b64encode(bytes), sha256: m.sha };
  return { mime: which === m.id ? (sniffMime(bytes) || m.mime) : 'image/jpeg', data: b64encode(bytes), sha256: m.sha };
};

A.hostSetLogo = async (c, req) => {
  const ev = await authHost(c, req);
  const d = await drive(c, ev);
  const old = ev.logo;
  let rec = null;
  if (req.data) {
    const bytes = b64decode(req.data);
    if (bytes.length > LIMITS.LOGO_BYTES) throw err('too_large', 'That logo is too big. Use an image under 200 KB.');
    const mime = sniffImage(bytes);
    if (!mime) throw err('bad_type', 'Use a PNG, JPEG or WebP image.');
    rec = { id: await d.upload({ name: 'logo.' + mime.split('/')[1], mime, parent: ev.folder, bytes }), v: randomId(8), mime };
  }
  await c.run('UPDATE events SET logo = ?, v = ? WHERE id = ?', rec ? JSON.stringify(rec) : '', randomId(8), ev.id);
  if (old) await d.trash(old.id).catch(() => {});
  return { logoV: rec ? rec.v : '' };
};

A.hostGuestbook = async (c, req) => {
  const ev = await authHost(c, req);
  const rows = await S(c, ev).all("SELECT * FROM notes WHERE event = ? AND status != 'deleted' ORDER BY created", ev.id);
  return { notes: rows.map((n) => ({ id: n.id, g: n.label, gid: n.guest, text: n.text, a: audioParts(n.audio).id, c: n.created, s: n.status, d: n.dur })) };
};

A.hostGuestbookModerate = async (c, req) => {
  const ev = await authHost(c, req);
  const map = { show: 'visible', approve: 'visible', hide: 'hidden', delete: 'deleted' };
  const status = map[req.action];
  if (!status) throw err('bad_request', 'Unknown action');
  const ids = Array.isArray(req.ids) ? req.ids.slice(0, 200).map((x) => str(x, 40)) : [];
  let changed = 0;
  for (const id of ids) {
    const n = await S(c, ev).one('SELECT * FROM notes WHERE event = ? AND id = ?', ev.id, id);
    if (!n || n.status === 'deleted') continue;
    const a = audioParts(n.audio);
    if (a.id) {
      if (status === 'deleted') await (await drive(c, ev)).trash(a.id).catch(() => {});
      else if (!ev.settings.encrypted) await share(c, ev, [a.id], status === 'visible');
    }
    await S(c, ev).run('UPDATE notes SET status = ? WHERE id = ?', status, id);
    changed++;
  }
  await bump(c, ev);
  return { changed };
};

/** Adds files the app saved in the event folder but the album doesn't list (rare: interrupted uploads). */
A.hostRecover = async (c, req) => {
  const ev = await authHost(c, req);
  const d = await drive(c, ev);
  const known = new Set((await S(c, ev).all('SELECT id FROM media WHERE event = ?', ev.id)).map((r) => r.id));
  const files = (await d.list(ev.folder)).filter((f) => !known.has(f.id) && /\.(jpg|mp4|webm)(\.enc)?$/.test(f.name) && !/^logo\./.test(f.name));
  if (req.dryRun === true || !files.length) return { found: files.length, duplicates: 0, added: 0 };
  // An album whose photo list the nightly cleanup cleared comes back "waiting for approval", so
  // photos the host had hidden don't reappear without them deciding again.
  const status = ev.settings.approval || ev.purged ? 'pending' : 'visible';
  for (const f of files) {
    const mime = /\.mp4/.test(f.name) ? 'video/mp4' : /\.webm/.test(f.name) ? 'video/webm' : 'image/jpeg';
    await S(c, ev).run('INSERT OR IGNORE INTO media (event, id, thumb, guest, kind, mime, bytes, created, status, client, flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ev.id, f.id, '', 'recovered', mime.startsWith('video') ? 'video' : 'photo', mime, Number(f.size) || 0, Date.parse(f.createdTime) || c.now(), status, 'recovered-' + f.id.slice(0, 40), 'recovered' + (/\.enc$/.test(f.name) ? ',encrypted' : ''));
    if (status === 'visible' && !/\.enc$/.test(f.name)) await share(c, ev, [f.id], true);
  }
  if (ev.purged) await c.run('UPDATE events SET purged = 0 WHERE id = ?', ev.id);
  await bump(c, ev);
  return { found: files.length, duplicates: 0, added: files.length };
};

// ================================================================= accounts (admin key)
A.adminCheck = async (c, req) => {
  const a = await authAccount(c, req, { allowExpired: true });
  return { version: VERSION, me: {
    name: a.kind === 'owner' ? 'Owner' : (a.email || 'Host'), role: a.kind === 'owner' ? 'owner' : 'host', cloud: true,
    drive: !!a.refresh_enc, googleEmail: a.google_email || '',
    plan: a.kind === 'owner' ? 'lifetime' : (a.plan || 'lifetime'), expires: a.kind === 'owner' ? 0 : Number(a.expires) || 0, expired: expired(a),
    maxEvents: Number(a.max_events) || 0, eventsUsed: (await c.one('SELECT COUNT(*) AS n FROM events WHERE account = ?', a.id)).n,
    holdUntil: Number(a.expires) > 0 && a.kind !== 'owner' && a.plan !== 'partner' ? Number(a.expires) + LIMITS.HOLD_MS : 0,
    partner: await partnerView(c, a) } };
};

A.driveStatus = async (c, req) => {
  const a = await authAccount(c, req);
  if (!a.refresh_enc) return { connected: false };
  try {
    const about = await (await driveFor(c.env, c.db, a)).about();
    const q = about.storageQuota || {};
    return { connected: true, email: a.google_email || (about.user && about.user.emailAddress) || '', used: Number(q.usage) || 0, limit: Number(q.limit) || 0 };
  } catch (e) {
    if (e.code === 'drive_not_connected') return { connected: false };
    return { connected: true, email: a.google_email || '', used: 0, limit: 0 };
  }
};

/** Starts "Connect Google Drive" (purpose connect) for a signed-in account. */
A.oauthStart = async (c, req) => {
  const a = await authAccount(c, req);
  if (!c.env.GOOGLE_CLIENT_ID) throw err('not_configured', 'Google sign-in isn’t set up on this server yet.');
  const state = randomKey(24);
  await c.run('INSERT INTO oauth_state (state, account, purpose, exp) VALUES (?, ?, ?, ?)', state, a.id, 'connect', c.now() + 15 * 60000);
  return { url: `${c.env.SITE_ORIGIN}/oauth/start?s=${state}` };
};

/** "Lost your admin key?": sign in with the Google account connected to it to get a new key. */
A.recoverStart = async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) throw err('not_configured', 'Google sign-in isn’t set up on this server yet.');
  if (!(await rateOk(c, 'recover', 60, 600))) throw err('rate_limited', 'Too many attempts. Wait 10 minutes.');
  const state = randomKey(24);
  await c.run('INSERT INTO oauth_state (state, account, purpose, exp) VALUES (?, ?, ?, ?)', state, '', 'recover', c.now() + 15 * 60000);
  return { url: `${c.env.SITE_ORIGIN}/oauth/start?s=${state}` };
};

/** Finishes the recovery after Google sent the browser back: one-time ticket → new key. */
A.recoverFinish = async (c, req) => {
  const t = str(req.ticket, 64);
  const row = t && await c.one("SELECT * FROM oauth_state WHERE state = ? AND purpose = 'ticket' AND exp > ?", t, c.now());
  if (!row) throw err('expired', 'That sign-in link expired. Try again.');
  await c.run('DELETE FROM oauth_state WHERE state = ?', t);
  const key = randomKey(32);
  await c.run('UPDATE accounts SET key_hash = ? WHERE id = ? AND kind != \'owner\'', await sha256Hex(key), row.account);
  return { adminKey: key };
};

A.adminList = async (c, req) => {
  const a = await authAccount(c, req, { allowExpired: true });
  const rows = await c.all('SELECT id, name, created, folder, settings FROM events WHERE account = ? AND deleted = 0 ORDER BY created DESC LIMIT ?', a.id, LIMITS.MAX_EVENTS_LIST);
  return { events: rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created, date: parseJson(r.settings).date || '', folderUrl: 'https://drive.google.com/drive/folders/' + r.folder, createdBy: '', canManage: true })) };
};

A.adminCreate = async (c, req) => {
  const a = await authAccount(c, req);
  const settings = sanitizeSettings(req.settings || {});
  if (!settings.name) throw err('bad_request', 'Event name required');
  if (!a.refresh_enc) throw err('drive_not_connected', 'Connect your Google Drive first: it’s where your photos are saved.');
  const n = await c.one('SELECT COUNT(*) AS n FROM events WHERE account = ? AND deleted = 0', a.id);
  if (n.n >= LIMITS.EVENTS_PER_ACCOUNT) throw err('full', 'You’ve reached the event limit. Delete old events first.');
  if (Number(a.max_events) > 0) {
    const all = await c.one('SELECT COUNT(*) AS n FROM events WHERE account = ?', a.id); // deleted ones count too
    if (all.n >= Number(a.max_events)) throw err('plan_limit', `Your plan includes ${a.max_events === 1 ? '1 event' : a.max_events + ' events'}, and it’s been used. Get 1 month or 12 months for unlimited events.`);
  }
  const d = await driveFor(c.env, c.db, a);
  let root = a.root_folder;
  if (!root) { root = await d.createFolder('AfterFlash'); await c.run('UPDATE accounts SET root_folder = ? WHERE id = ?', root, a.id); }
  const id = randomId(10);
  let folder;
  try { folder = await d.createFolder(`${settings.name.replace(/[\\/:*?"<>|]/g, ' ')} (${id})`, root); }
  catch (e) {
    if (e.code !== 'not_found') throw e;
    root = await d.createFolder('AfterFlash'); // the folder was deleted in Drive: make a new one
    await c.run('UPDATE accounts SET root_folder = ? WHERE id = ?', root, a.id);
    folder = await d.createFolder(`${settings.name.replace(/[\\/:*?"<>|]/g, ' ')} (${id})`, root);
  }
  const hostKey = randomKey(32);
  const ek = settings.encrypted ? await seal(c.env, randomKey(32)) : '';
  await c.run('INSERT INTO events (id, account, name, created, folder, host_hash, settings, v, ek_enc, shard) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, a.id, settings.name, c.now(), folder, await sha256Hex(hostKey), JSON.stringify(settings), randomId(8), ek, activeShard(c.env));
  return { id, hostKey };
};

async function ownedEvent(c, req) {
  const a = await authAccount(c, req);
  const ev = await loadEvent(c, req.e);
  if (ev.account !== a.id) throw err('forbidden', 'That event belongs to another account.');
  return { a, ev };
}
A.adminHostLink = async (c, req) => {
  const { ev } = await ownedEvent(c, req);
  const key = randomKey(32);
  await c.run('UPDATE events SET host_hash = ? WHERE id = ?', await sha256Hex(key), ev.id);
  return { hostKey: key };
};
A.adminDelete = async (c, req) => {
  const { ev } = await ownedEvent(c, req);
  if (req.confirm !== ev.id) throw err('bad_request', 'Confirmation does not match');
  try { await (await drive(c, ev)).trash(ev.folder); } catch { /* folder already gone */ }
  await c.run('UPDATE events SET deleted = 1 WHERE id = ?', ev.id);
  return {};
};
A.adminProblems = async (c, req) => {
  const a = await authAccount(c, req, { allowExpired: true });
  const rows = await c.all('SELECT t, w, e, m FROM problems WHERE account = ? ORDER BY id DESC LIMIT 50', a.id);
  return { problems: rows };
};
A.adminClearProblems = async (c, req) => { const a = await authAccount(c, req); await c.run('DELETE FROM problems WHERE account = ?', a.id); return {}; };
A.adminExportKeys = async (c, req) => {
  const a = await authAccount(c, req, { allowExpired: true });
  const rows = await c.all("SELECT id, ek_enc FROM events WHERE account = ? AND ek_enc != ''", a.id);
  const keys = {};
  for (const r of rows) keys[r.id] = await unseal(c.env, r.ek_enc);
  return { keys };
};

// ---- referral codes
const normCode = (v) => String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
const pct = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(0, Math.min(LIMITS.MAX_PCT, n)) : d; };
async function activeCode(c, code) {
  code = normCode(code);
  if (code.length < 3) return null;
  return c.one('SELECT * FROM ref_codes WHERE code = ? AND active = 1', code);
}
const overridePct = (env) => { const n = Math.round(Number(env.OVERRIDE_PCT == null || env.OVERRIDE_PCT === '' ? 5 : env.OVERRIDE_PCT)); return Number.isFinite(n) ? Math.max(0, Math.min(10, n)) : 5; };
export const PAYOUT_METHODS = ['Venmo', 'PayPal', 'Zelle', 'Cash App', 'Check'];

/** Earnings for one code, in cents. "ready" = earned on sales older than 14 days (past the dispute window), minus payouts. */
async function codeStats(c, code) {
  const cut = c.now() - LIMITS.PAYOUT_WAIT_MS;
  const r = await c.one("SELECT COUNT(CASE WHEN kind = 'sale' THEN 1 END) AS sales, COALESCE(SUM(CASE WHEN kind = 'sale' THEN paid ELSE 0 END), 0) AS revenue, COALESCE(SUM(amount), 0) AS earned, COALESCE(SUM(CASE WHEN kind = 'override' THEN amount ELSE 0 END), 0) AS teamEarned, COALESCE(SUM(CASE WHEN created < ? THEN amount ELSE 0 END), 0) AS settled FROM commissions WHERE code = ? AND status = 'ok'", cut, code);
  const yr = Date.UTC(new Date(c.now()).getUTCFullYear(), 0, 1);
  const p = await c.one('SELECT COALESCE(SUM(amount), 0) AS paid, COALESCE(SUM(CASE WHEN created >= ? THEN amount ELSE 0 END), 0) AS year FROM payouts WHERE code = ?', yr, code);
  const q = await c.one("SELECT COALESCE(SUM(amount), 0) AS n FROM payout_requests WHERE code = ? AND status = 'pending'", code);
  return { sales: r.sales, revenue: r.revenue, earned: r.earned, teamEarned: r.teamEarned, paid: p.paid, paidThisYear: p.year, owed: r.earned - p.paid, ready: Math.max(0, r.settled - p.paid), requested: q.n };
}
const salesOf = async (c, code) => (await c.one("SELECT COUNT(*) AS n FROM commissions WHERE code = ? AND kind = 'sale' AND status = 'ok'", code)).n;
/** The partners below a code (up to two levels), with their sale counts. */
async function teamOf(c, code) {
  const out = [];
  const kids = await c.all('SELECT code, name, tier, parent, active, created FROM ref_codes WHERE parent = ? ORDER BY created', code);
  for (const k of kids) {
    out.push({ code: k.code, name: k.name, tier: k.tier, under: '', active: !!k.active, sales: await salesOf(c, k.code) });
    for (const g of await c.all('SELECT code, name, tier, active FROM ref_codes WHERE parent = ? ORDER BY created', k.code)) {
      out.push({ code: g.code, name: g.name, tier: g.tier, under: k.code, active: !!g.active, sales: await salesOf(c, g.code) });
    }
  }
  return out;
}
/** What a partner sees on their own admin page: code, link, earnings, team and payout requests (never customers' details). */
async function partnerView(c, a) {
  if (a.kind === 'owner') return null;
  const rows = await c.all('SELECT * FROM ref_codes WHERE account = ? ORDER BY created', a.id);
  if (!rows.length) return null;
  const codes = [];
  for (const r of rows) {
    const recent = await c.all('SELECT created, plan, paid, amount, status, kind FROM commissions WHERE code = ? ORDER BY id DESC LIMIT 25', r.code);
    const requests = await c.all('SELECT id, amount, method, created, status, done FROM payout_requests WHERE code = ? ORDER BY id DESC LIMIT 10', r.code);
    codes.push({ code: r.code, tier: r.tier, discount: r.discount, commission: r.commission, override: overridePct(c.env), active: !!r.active,
      canInvite: !!r.active && r.tier < LIMITS.MAX_TIER, link: `${c.env.SITE_ORIGIN || ''}/?ref=${r.code}`,
      ...(await codeStats(c, r.code)), recent, requests, team: await teamOf(c, r.code) });
  }
  return { codes, minPayout: LIMITS.MIN_PAYOUT, methods: PAYOUT_METHODS };
}
/** Public: is this code valid, and how much does it take off? */
A.refLookup = async (c, req) => {
  if (!(await rateOk(c, 'reflookup', LIMITS.REF_LOOKUPS_PER_10MIN, 600))) throw err('rate_limited', 'Busy, try again in a minute.');
  if (!(await rateOk(c, 'badcode', 60, 600, true))) throw err('rate_limited', 'Too many tries. Wait 10 minutes.');
  const r = await activeCode(c, req.code);
  if (!r) { await rateHit(c, 'badcode', 600); throw err('bad_code', 'That code isn’t valid.'); }
  const p = planPrices(c.env);
  return { code: r.code, discount: r.discount, prices: Object.fromEntries(ON_SALE.map((id) => [id, r.discount ? discounted(p[id], r.discount) : p[id]])) };
};

// ---- buying a key
A.checkoutStart = async (c, req) => {
  if (!(await rateOk(c, 'checkout', LIMITS.CHECKOUTS_PER_10MIN, 600))) throw err('rate_limited', 'Busy, try again in a minute.');
  if (!ON_SALE.includes(req.plan)) throw err('bad_request', 'Pick a plan.');
  const plan = req.plan;
  let a = null;
  if (req.k) { // renewing or upgrading a signed-in account
    a = await authAccount(c, req, { allowExpired: true });
    if (a.kind === 'owner') throw err('bad_request', 'The owner account doesn’t need a plan.');
    if ((a.plan || 'lifetime') === 'lifetime' && !Number(a.expires)) throw err('bad_request', 'You already have lifetime access.');
    if (plan === 'event' && a.plan !== 'event' && !expired(a)) throw err('bad_request', 'You already have unlimited events. Add 1 month or 12 months instead.');
  }
  let ref = null;
  if (req.ref) {
    ref = await activeCode(c, req.ref);
    if (!ref) throw err('bad_code', 'That code isn’t valid. Remove it to pay full price.');
  } else if (a && a.ref) ref = await activeCode(c, a.ref); // renewals keep the code the customer first used
  if (ref && a && (await c.one('SELECT code FROM ref_codes WHERE account = ? LIMIT 1', a.id))) ref = null; // partners' own purchases never earn anyone anything
  return { url: await createCheckout(c.env, { plan, account: a ? a.id : '', ref }) };
};

/** Plan after buying `plan`: time is added to what's left; the one-event plan adds one event. */
function extend(a, plan, now, eventsUsed = 0) {
  if (plan === 'lifetime') return { plan: 'lifetime', expires: 0, max_events: 0 };
  if (a && (a.plan || 'lifetime') === 'lifetime' && !Number(a.expires)) return { plan: 'lifetime', expires: 0, max_events: 0 };
  const base = Math.max(now, (a && Number(a.expires)) || 0);
  const expires = base + PLAN_DAYS[plan] * 86400000;
  if (plan !== 'event') return { plan, expires, max_events: 0 };
  if (a && a.plan !== 'event' && !expired(a)) return { plan: a.plan, expires, max_events: 0 }; // already unlimited
  const had = a && a.plan === 'event' ? Number(a.max_events) || 0 : 0;
  return { plan: 'event', expires, max_events: Math.max(had, eventsUsed) + 1 };
}

/**
 * Pays a sale out to partners: the seller earns their commission, and the partners above them
 * (up to 2 tiers, never the owner) split the team override evenly. Only real customers' purchases
 * count: a purchase by any partner account, or with the partner's own email, earns nobody anything.
 * Each sale counts once (UNIQUE(session, code)).
 */
async function recordCommission(c, { code, session, customer, plan, paid, rate, method, email = '' }) {
  if (!code || !paid) return;
  const r = await c.one('SELECT * FROM ref_codes WHERE code = ?', code);
  if (!r) return;
  if (customer && (await c.one('SELECT code FROM ref_codes WHERE account = ? LIMIT 1', customer))) return;
  if (email && r.email && email.toLowerCase() === String(r.email).toLowerCase()) return;
  const now = c.now();
  const add = (who, amount, kind) => c.run('INSERT OR IGNORE INTO commissions (code, session, customer, plan, paid, amount, created, method, kind, seller) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    who, session, customer, plan, paid, amount, now, method, kind, code);
  await add(code, Math.round(paid * (rate == null ? r.commission : rate) / 100), 'sale');
  const up = [];
  for (let p = r.parent, i = 0; p && i < LIMITS.MAX_TIER - 1; i++) {
    const u = await c.one('SELECT code, parent, active FROM ref_codes WHERE code = ?', p);
    if (!u) break;
    up.push(u);
    p = u.parent;
  }
  if (!up.length) return;
  const each = Math.floor(paid * overridePct(c.env) / 100 / up.length); // a turned-off partner's share stays with the owner
  if (each > 0) for (const u of up) if (u.active) await add(u.code, each, 'override');
}

/** After paying: turn the Stripe Checkout Session into an account and show its admin key. */
A.claimPurchase = async (c, req) => {
  if (!(await rateOk(c, 'claim', 120, 600))) throw err('rate_limited', 'Busy, try again in a minute.');
  const sid = str(req.session_id, 260);
  const p = await readCheckout(c.env, sid);
  if (!p.paid) throw err('not_paid', 'This payment hasn’t gone through yet. If you just paid, wait a moment and refresh.');
  if (p.account) { // a renewal: extend the account once, never issue a new key
    const a = await c.one('SELECT * FROM accounts WHERE id = ?', p.account);
    if (!a) throw err('not_found', 'That account wasn’t found. Contact support with your receipt.');
    const done = await c.one('SELECT session FROM purchases WHERE session = ?', sid);
    if (!done) {
      const used = (await c.one('SELECT COUNT(*) AS n FROM events WHERE account = ?', a.id)).n;
      const n = extend(a, p.plan, c.now(), used);
      await c.run('INSERT INTO purchases (session, account, plan, amount, created, ref) VALUES (?, ?, ?, ?, ?, ?)', sid, a.id, p.plan, p.amount, c.now(), p.ref);
      await c.run('UPDATE accounts SET plan = ?, expires = ?, max_events = ?, ref = CASE WHEN ref = \'\' OR ref IS NULL THEN ? ELSE ref END WHERE id = ?', n.plan, n.expires, n.max_events, p.ref, a.id);
      await recordCommission(c, { code: p.ref, session: sid, customer: a.id, plan: p.plan, paid: p.amount, rate: p.commission, method: 'card', email: p.email });
    }
    const now = await c.one('SELECT plan, expires FROM accounts WHERE id = ?', a.id);
    return { renewed: true, plan: now.plan, expires: Number(now.expires) || 0, email: p.email };
  }
  const key = randomKey(32);
  const hash = await sha256Hex(key);
  const existing = await c.one('SELECT * FROM accounts WHERE stripe_session = ?', sid);
  if (existing) {
    // The thank-you page can show a fresh key for a short while (e.g. it was closed by mistake).
    if (existing.claim_until < c.now()) throw err('already_claimed', 'This purchase was already set up. Sign in with your admin key, or use “Lost your key?” on the sign-in page.');
    await c.run('UPDATE accounts SET key_hash = ? WHERE id = ?', hash, existing.id);
    return { adminKey: key, email: existing.email, again: true, plan: existing.plan, expires: Number(existing.expires) || 0 };
  }
  const id = randomId(12);
  const n = extend(null, p.plan, c.now());
  await c.run('INSERT INTO accounts (id, key_hash, kind, email, created, stripe_session, claim_until, plan, expires, max_events, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, hash, 'paid', p.email, c.now(), sid, c.now() + 2 * 3600000, n.plan, n.expires, n.max_events, p.ref);
  await c.run('INSERT OR IGNORE INTO purchases (session, account, plan, amount, created, ref) VALUES (?, ?, ?, ?, ?, ?)', sid, id, p.plan, p.amount, c.now(), p.ref);
  await recordCommission(c, { code: p.ref, session: sid, customer: id, plan: p.plan, paid: p.amount, rate: p.commission, method: 'card', email: p.email });
  return { adminKey: key, email: p.email, plan: n.plan, expires: n.expires };
};

// ---- owner tools
async function newAccount(c, { plan, kind, email = '', note = '', ref = '' }) {
  const key = randomKey(32);
  const id = randomId(12);
  const n = plan === 'partner' ? { plan: 'partner', expires: 0, max_events: 0 } : extend(null, plan, c.now());
  await c.run('INSERT INTO accounts (id, key_hash, kind, email, created, note, plan, expires, max_events, ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, await sha256Hex(key), kind, email, c.now(), note, n.plan, n.expires, n.max_events, ref);
  return { id, adminKey: key, plan: n.plan, expires: n.expires };
}
const cleanEmail = (v) => { const e = str(v, 120).trim(); return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(e) ? e : ''; };
const dollarsToCents = (v) => { const m = /^\s*\$?\s*(\d{1,6})(?:\.(\d{1,2}))?\s*$/.exec(String(v == null ? '' : v)); return m ? Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0')) : -1; };

A.ownerCreateAccount = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const plan = Object.prototype.hasOwnProperty.call(PLAN_DAYS, req.plan) ? req.plan : 'lifetime';
  return newAccount(c, { plan, kind: 'comp', note: cleanText(req.note, 60) });
};
A.ownerAccounts = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const rows = await c.all("SELECT a.id, a.kind, a.status, a.email, a.created, a.google_email, a.note, a.plan, a.expires, a.ref, (SELECT COALESCE(SUM(amount), 0) FROM purchases p WHERE p.account = a.id) AS paid, a.refresh_enc != '' AS drive, (SELECT COUNT(*) FROM events e WHERE e.account = a.id AND e.deleted = 0) AS events FROM accounts a WHERE a.kind != 'owner' ORDER BY a.created DESC LIMIT 1000");
  return { accounts: rows.map((r) => ({ ...r, drive: !!r.drive })) };
};
A.ownerSetStatus = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const status = req.status === 'disabled' ? 'disabled' : 'active';
  const r = await c.run("UPDATE accounts SET status = ? WHERE id = ? AND kind != 'owner'", status, str(req.id, 20));
  if (!r.meta.changes) throw err('not_found', 'Account not found');
  return {};
};

/** Referral partners: every code with its earnings, the latest sales and payouts. */
A.ownerCodes = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const rows = await c.all('SELECT * FROM ref_codes ORDER BY created DESC LIMIT 500');
  const codes = [];
  for (const r of rows) codes.push({ code: r.code, name: r.name, email: r.email, discount: r.discount, commission: r.commission, active: !!r.active, created: r.created, note: r.note, tier: r.tier, parent: r.parent, agreed: r.agreed, hasKey: !!r.account, link: `${c.env.SITE_ORIGIN || ''}/?ref=${r.code}`, ...(await codeStats(c, r.code)) });
  const sales = await c.all('SELECT id, code, seller, kind, plan, paid, amount, created, status, method FROM commissions ORDER BY id DESC LIMIT 300');
  const payouts = await c.all('SELECT id, code, amount, created, method, note FROM payouts ORDER BY id DESC LIMIT 500');
  const requests = await c.all("SELECT q.id, q.code, q.amount, q.method, q.handle, q.created, r.name, r.email FROM payout_requests q LEFT JOIN ref_codes r ON r.code = q.code WHERE q.status = 'pending' ORDER BY q.id");
  return { codes, sales, payouts, requests, override: overridePct(c.env) };
};
/** A free code made from a name, e.g. "Mike Smith" → MIKESMIT47. */
async function freshCode(c, name) {
  const base = normCode(name).replace(/[0-9]/g, '').slice(0, 8) || 'PS';
  for (let i = 0; i < 40; i++) {
    const t = base + String(10 + Math.floor(Math.random() * (i < 20 ? 90 : 9990)));
    if (!(await c.one('SELECT code FROM ref_codes WHERE code = ?', t))) return t;
  }
  throw err('busy', 'Couldn’t make a code. Try again.');
}
/** New partner code. With withKey, also makes the partner a free lifetime admin key linked to the code. */
A.ownerCodeCreate = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const name = cleanText(req.name, 60);
  if (!name) throw err('bad_request', 'Enter the partner’s name.');
  let code = normCode(req.code);
  if (code && code.length < 3) throw err('bad_request', 'Codes need 3 to 16 letters or numbers.');
  if (!code) code = await freshCode(c, name);
  else if (await c.one('SELECT code FROM ref_codes WHERE code = ?', code)) throw err('bad_request', 'That code is taken. Pick another.');
  // Every partner gets a sign-in key to see their earnings; only the owner can make it a free lifetime hosting key.
  const acct = req.withKey ? await newAccount(c, { plan: 'lifetime', kind: 'comp', email: cleanEmail(req.email), note: ('Partner ' + name).slice(0, 60) })
    : await newAccount(c, { plan: 'partner', kind: 'partner', email: cleanEmail(req.email), note: ('Partner ' + name).slice(0, 60) });
  await c.run('INSERT INTO ref_codes (code, account, name, email, discount, commission, created, note, tier, parent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
    code, acct.id, name, cleanEmail(req.email), pct(req.discount, 10), pct(req.commission, 20), c.now(), cleanText(req.note, 120), '');
  return { code, link: `${c.env.SITE_ORIGIN || ''}/?ref=${code}`, adminKey: acct.adminKey, lifetime: !!req.withKey };
};
A.ownerCodeUpdate = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const r = await c.one('SELECT * FROM ref_codes WHERE code = ?', normCode(req.code));
  if (!r) throw err('not_found', 'Code not found');
  await c.run('UPDATE ref_codes SET discount = ?, commission = ?, active = ?, name = ?, email = ? WHERE code = ?',
    pct(req.discount, r.discount), pct(req.commission, r.commission), req.active === undefined ? r.active : (req.active ? 1 : 0),
    cleanText(req.name, 60) || r.name, req.email === undefined ? r.email : cleanEmail(req.email), r.code);
  return {};
};
/** Records money the owner paid a partner (by Venmo, PayPal, cash...). */
A.ownerPayout = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const r = await c.one('SELECT code FROM ref_codes WHERE code = ?', normCode(req.code));
  if (!r) throw err('not_found', 'Code not found');
  const cents = dollarsToCents(req.amount);
  if (cents <= 0) throw err('bad_request', 'Enter the amount you paid, like 12.50.');
  const st = await codeStats(c, r.code);
  if (cents > st.owed) throw err('bad_request', `That’s more than they’re owed ($${(st.owed / 100).toFixed(2)}).`);
  await c.run('INSERT INTO payouts (code, amount, created, method, note) VALUES (?, ?, ?, ?, ?)', r.code, cents, c.now(), cleanText(req.method, 30), cleanText(req.note, 120));
  return { owed: st.owed - cents };
};
/** Voids (or restores) a sale's commissions (the seller's and the team overrides), e.g. after a chargeback. */
A.ownerVoidSale = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const row = await c.one('SELECT session FROM commissions WHERE id = ?', int(req.id, 0, 1e12, 0));
  if (!row) throw err('not_found', 'Sale not found');
  await c.run('UPDATE commissions SET status = ? WHERE session = ?', req.restore ? 'ok' : 'void', row.session);
  return {};
};
/** Pays (or declines) a partner's payout request. Paying records a payout of the requested amount. */
A.ownerPayRequest = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const q = await c.one("SELECT * FROM payout_requests WHERE id = ? AND status = 'pending'", int(req.id, 0, 1e12, 0));
  if (!q) throw err('not_found', 'That request was already handled.');
  if (!req.paid) {
    await c.run("UPDATE payout_requests SET status = 'declined', done = ?, note = ? WHERE id = ?", c.now(), cleanText(req.note, 120), q.id);
    return {};
  }
  const st = await codeStats(c, q.code);
  if (q.amount > st.owed) throw err('bad_request', `That’s more than they’re owed now ($${(st.owed / 100).toFixed(2)}), probably because a sale was voided. Decline it and ask them to request again.`);
  await c.run('INSERT INTO payouts (code, amount, created, method, note) VALUES (?, ?, ?, ?, ?)', q.code, q.amount, c.now(), q.method, cleanText(req.note, 120) || `Request #${q.id}`);
  await c.run("UPDATE payout_requests SET status = 'paid', done = ? WHERE id = ?", c.now(), q.id);
  return {};
};
/** Adds days to a customer's plan (goodwill when something went wrong). */
A.ownerAddDays = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const a = await c.one("SELECT * FROM accounts WHERE id = ? AND kind != 'owner'", str(req.id, 20));
  if (!a) throw err('not_found', 'Account not found');
  if (a.plan === 'partner' || ((a.plan || 'lifetime') === 'lifetime' && !Number(a.expires))) throw err('bad_request', 'That account has no end date to extend.');
  const days = int(req.days, 1, 365, 0);
  if (!days) throw err('bad_request', 'Enter 1 to 365 days.');
  const expires = Math.max(c.now(), Number(a.expires) || 0) + days * 86400000;
  await c.run('UPDATE accounts SET expires = ? WHERE id = ?', expires, a.id);
  return { expires };
};

// ---- partners: invite links, joining, payout requests
async function myCode(c, a, code) {
  const r = code ? await c.one('SELECT * FROM ref_codes WHERE account = ? AND code = ?', a.id, normCode(code))
    : await c.one('SELECT * FROM ref_codes WHERE account = ? ORDER BY created LIMIT 1', a.id);
  if (!r) throw err('forbidden', 'This account isn’t a partner.');
  return r;
}
/** A partner makes a single-use link for someone joining their team (tiers 1 and 2 only). */
A.partnerInvite = async (c, req) => {
  const a = await authAccount(c, req, { allowExpired: true });
  const r = await myCode(c, a, req.code);
  if (!r.active) throw err('forbidden', 'Your code is turned off.');
  if (r.tier >= LIMITS.MAX_TIER) throw err('forbidden', 'Tier 3 partners can sell but can’t add partners.');
  const team = await c.one('SELECT COUNT(*) AS n FROM ref_codes WHERE parent = ?', r.code);
  if (team.n >= LIMITS.MAX_TEAM) throw err('full', 'Your team is full. Contact support.');
  const open = await c.one('SELECT COUNT(*) AS n FROM invites WHERE code = ? AND used = 0 AND exp > ?', r.code, c.now());
  if (open.n >= LIMITS.MAX_OPEN_INVITES) throw err('rate_limited', 'You have 20 unused invite links. Wait until some are used or expire.');
  const token = randomKey(24);
  const exp = c.now() + LIMITS.INVITE_MS;
  await c.run('INSERT INTO invites (token_hash, code, created, exp) VALUES (?, ?, ?, ?)', await sha256Hex(token), r.code, c.now(), exp);
  return { link: `${c.env.SITE_ORIGIN || ''}/partner.html#invite=${token}`, expires: exp };
};
async function openInvite(c, token) {
  if (!(await rateOk(c, 'badinvite', 60, 600, true))) throw err('rate_limited', 'Too many tries. Wait 10 minutes.');
  const t = str(token, 80);
  const inv = /^[A-Za-z0-9_-]{20,80}$/.test(t) ? await c.one('SELECT * FROM invites WHERE token_hash = ?', await sha256Hex(t)) : null;
  const r = inv && !inv.used && inv.exp > c.now() ? await c.one('SELECT * FROM ref_codes WHERE code = ? AND active = 1', inv.code) : null;
  if (!r || r.tier >= LIMITS.MAX_TIER) { await rateHit(c, 'badinvite', 600); throw err('bad_invite', 'This invite link has expired or was already used. Ask for a new one.'); }
  return { inv, r };
}
const firstName = (n) => String(n || '').trim().split(/\s+/)[0] || 'A partner';
/** Public: what joining through this invite means (shown before they agree). */
A.partnerInviteInfo = async (c, req) => {
  const { r } = await openInvite(c, req.invite);
  return { inviter: firstName(r.name), tier: r.tier + 1, discount: r.discount, commission: r.commission, override: overridePct(c.env), canRecruit: r.tier + 1 < LIMITS.MAX_TIER, minPayout: LIMITS.MIN_PAYOUT };
};
/** Public: accept an invite. Makes a partner sign-in key and code. Joining is free and never earns anyone money. */
A.partnerJoin = async (c, req) => {
  if (!(await rateOk(c, 'joins', LIMITS.JOINS_PER_10MIN, 600))) throw err('rate_limited', 'Busy, try again in a few minutes.');
  const { inv, r } = await openInvite(c, req.invite);
  if (req.agree !== true) throw err('bad_request', 'Please read and accept the partner agreement.');
  const name = cleanText(req.name, 60);
  if (!name) throw err('bad_request', 'Enter your name.');
  const email = cleanEmail(req.email);
  if (!email) throw err('bad_request', 'Enter your email, so we can reach you about payouts.');
  const used = await c.run('UPDATE invites SET used = ? WHERE token_hash = ? AND used = 0', c.now(), inv.token_hash);
  if (!used.meta.changes) throw err('bad_invite', 'This invite link was already used. Ask for a new one.');
  const code = await freshCode(c, name);
  const acct = await newAccount(c, { plan: 'partner', kind: 'partner', email, note: ('Partner ' + name).slice(0, 60) });
  await c.run('INSERT INTO ref_codes (code, account, name, email, discount, commission, created, tier, parent, agreed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    code, acct.id, name, email, r.discount, r.commission, c.now(), r.tier + 1, r.code, c.now());
  return { adminKey: acct.adminKey, code, link: `${c.env.SITE_ORIGIN || ''}/?ref=${code}`, tier: r.tier + 1 };
};
/** A partner asks to be paid everything that's ready (at least $25). */
A.partnerRequestPayout = async (c, req) => {
  const a = await authAccount(c, req, { allowExpired: true });
  const r = await myCode(c, a, req.code);
  if (!PAYOUT_METHODS.includes(req.method)) throw err('bad_request', 'Pick how you want to be paid.');
  const handle = String(req.handle == null ? '' : req.handle).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80); // keeps @handles
  if (handle.length < 3) throw err('bad_request', 'Enter your username, email or phone for that payment app (or a mailing address for a check).');
  if (await c.one("SELECT id FROM payout_requests WHERE code = ? AND status = 'pending'", r.code)) throw err('bad_request', 'You already have a payout request waiting.');
  const st = await codeStats(c, r.code);
  if (st.ready < LIMITS.MIN_PAYOUT) throw err('bad_request', `You can request a payout once $${(LIMITS.MIN_PAYOUT / 100).toFixed(2)} is ready. Ready now: $${(st.ready / 100).toFixed(2)}.`);
  await c.run('INSERT INTO payout_requests (code, amount, method, handle, created) VALUES (?, ?, ?, ?, ?)', r.code, st.ready, req.method, handle, c.now());
  return { amount: st.ready };
};

/** A sale paid in cash (or any way outside Stripe): makes a new admin key and credits the partner's code. */
A.ownerCashSale = async (c, req) => {
  requireOwner(await authAccount(c, req));
  if (!ON_SALE.includes(req.plan)) throw err('bad_request', 'Pick a plan.');
  const cents = dollarsToCents(req.amount);
  if (cents < 0 || cents > LIMITS.MAX_CASH_CENTS) throw err('bad_request', 'Enter the amount they paid, like 10 or 9.50.');
  let code = '';
  if (req.code) { const r = await activeCode(c, req.code); if (!r) throw err('bad_code', 'That code isn’t valid.'); code = r.code; }
  const acct = await newAccount(c, { plan: req.plan, kind: 'paid', email: cleanEmail(req.email), note: cleanText(req.note, 60), ref: code });
  const session = 'cash:' + randomId(16);
  await c.run('INSERT INTO purchases (session, account, plan, amount, created, ref, method) VALUES (?, ?, ?, ?, ?, ?, ?)', session, acct.id, req.plan, cents, c.now(), code, 'cash');
  await recordCommission(c, { code, session, customer: acct.id, plan: req.plan, paid: cents, method: 'cash' });
  return acct;
};

export const ACTIONS = A;

// ================================================================= nightly cleanup
/**
 * Run by the worker's daily cron. Keeps the databases small:
 * - clears the photo index (guests, photos, notes rows) of albums past their 12-month hold and of
 *   deleted events. The photos stay in the host's Drive; renewing + "Find missing photos" rebuilds it.
 * - removes expired rate-limit, sign-in and invite rows and problem logs older than 90 days.
 * Works in batches so one run stays well inside the worker's time limits; the next night continues.
 */
export async function nightly(env, { batch = 200 } = {}) {
  const c = makeCtx(env);
  const now = c.now();
  const day = 86400000;
  const out = { at: now, albums: 0, rows: 0, rate: 0, oauth: 0, invites: 0, problems: 0, more: false };
  const evs = await c.all(`SELECT e.id, e.shard FROM events e JOIN accounts a ON a.id = e.account
    WHERE e.purged = 0 AND (e.deleted = 1 OR (a.kind != 'owner' AND a.plan != 'partner' AND COALESCE(a.expires, 0) > 0 AND a.expires < ?))
    LIMIT ?`, now - LIMITS.HOLD_MS, batch + 1);
  out.more = evs.length > batch;
  for (const ev of evs.slice(0, batch)) {
    const db = c.shard(ev.shard || '');
    for (const t of ['media', 'notes', 'guests']) out.rows += (await db.run(`DELETE FROM ${t} WHERE event = ?`, ev.id)).meta.changes || 0;
    await c.run('UPDATE events SET purged = ? WHERE id = ?', now, ev.id);
    out.albums++;
  }
  out.rate = (await c.run('DELETE FROM rate WHERE exp < ?', now)).meta.changes || 0;
  out.oauth = (await c.run('DELETE FROM oauth_state WHERE exp < ?', now)).meta.changes || 0;
  out.invites = (await c.run('DELETE FROM invites WHERE exp < ?', now - 30 * day)).meta.changes || 0;
  out.problems = (await c.run('DELETE FROM problems WHERE t < ?', now - 90 * day)).meta.changes || 0;
  await c.run('INSERT INTO meta (k, v, t) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t', 'nightly', JSON.stringify(out), now);
  return out;
}

// ================================================================= system health (owner)
const GB = 1024 * 1024 * 1024;
const DB_LIMIT = 10 * GB; // Cloudflare D1's per-database maximum
/** Size of one D1 database in bytes (D1 reports it on every query), or 0 if unknown. */
async function dbSize(db) {
  try { const r = await db.prepare('SELECT 1').run(); return Number(r.meta && r.meta.size_after) || 0; } catch { return 0; }
}
A.ownerHealth = async (c, req) => {
  requireOwner(await authAccount(c, req));
  const names = [''];
  for (let i = 1; i <= 99; i++) if (c.env['SHARD_' + i]) names.push('SHARD_' + i);
  const active = activeShard(c.env);
  const dbs = [];
  for (const name of names) {
    const db = c.shard(name);
    const size = await dbSize(db.db);
    const ev = await c.one('SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN deleted = 0 AND purged = 0 THEN 1 ELSE 0 END), 0) AS live FROM events WHERE shard = ?', name);
    const media = await db.one('SELECT COUNT(*) AS n FROM media');
    dbs.push({ name: name || 'Main', active: name === active, size, limit: DB_LIMIT, pct: size ? Math.round((size / DB_LIMIT) * 1000) / 10 : 0, events: ev.n, live: ev.live, photos: media.n });
  }
  const m = await c.one("SELECT v, t FROM meta WHERE k = 'nightly'");
  const fullest = dbs.find((d) => d.name === (active || 'Main')) || dbs[0];
  const advice = fullest.pct >= 85 ? 'urgent' : fullest.pct >= 70 ? 'soon' : 'ok';
  return { dbs, nightly: m ? { ...parseJson(m.v), t: m.t } : null, advice, accounts: (await c.one("SELECT COUNT(*) AS n FROM accounts WHERE kind != 'owner'")).n };
};
/** Owner: run the cleanup now (normally it runs every night). */
A.ownerRunCleanup = async (c, req) => {
  requireOwner(await authAccount(c, req));
  return { result: await nightly(c.env) };
};
