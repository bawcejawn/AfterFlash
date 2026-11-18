/**
 * PhotoShare backend — Google Apps Script web app.
 *
 * Stores event photos/videos in the deploying account's Google Drive and
 * keeps per-event indexes in Google Sheets. Costs nothing on a personal
 * Google account (15 GB) or a Workspace account.
 *
 * Security model
 *  - Admin key  : creates/deletes events. Random 256-bit key, only its SHA-256 is stored.
 *  - Host key   : per event; moderates, edits settings, reads originals. Only SHA-256 stored.
 *  - Guest token: per guest per event; uploads/reports. Only SHA-256 stored.
 *  - Every Drive id that arrives in a request is checked against the event's own
 *    media index before it is touched, so a key holder can never reach other
 *    files in the owner's Drive.
 *  - Uploads are checked by magic bytes (never by the client-declared type),
 *    size-limited, rate-limited and JPEG metadata (EXIF/GPS) is stripped.
 *
 * Setup: see docs/SETUP.md. Run `setup()` once from the editor.
 */

var APP_VERSION = '1.9.0';

var LIMITS = {
  BODY_BYTES: 30 * 1024 * 1024,
  PHOTO_BYTES: 8 * 1024 * 1024,
  VIDEO_BYTES: 20 * 1024 * 1024,
  THUMB_BYTES: 400 * 1024,
  MANIFEST_BYTES: 4 * 1024 * 1024,
  NAME: 80,
  WELCOME: 280,
  LABEL: 24,
  MAX_GUESTS: 5000,
  MAX_SHOTS: 500,
  MAX_EVENTS_LIST: 500,
  UPLOADS_PER_GUEST_PER_MIN: 20,
  UPLOADS_PER_EVENT_PER_MIN: 600,
  JOINS_PER_EVENT_PER_MIN: 120,
  BAD_PIN_PER_EVENT_PER_10MIN: 40,
  BAD_ADMIN_PER_10MIN: 20,
  REPORTS_PER_GUEST: 15,
  NOTES_PER_GUEST: 5,
  NOTE_TEXT: 500,
  AUDIO_BYTES: 3 * 1024 * 1024,
  PHOTOS_PER_EVENT_PER_MIN: 120,
  BLUR_THRESHOLD: 40,
  THUMBS_PER_EVENT_PER_MIN: 900
};

var MEDIA_COLS = ['seq', 'id', 'thumbId', 'guestId', 'kind', 'mime', 'bytes', 'sha256', 'w', 'h', 'dur',
  'createdAt', 'status', 'reports', 'clientId', 'archIndex', 'archTx', 'flags', 'fav'];
var NOTE_COLS = ['id', 'guestId', 'label', 'text', 'audioId', 'createdAt', 'status', 'clientId', 'dur'];
var GUEST_COLS = ['guestId', 'tokenHash', 'label', 'shots', 'uploads', 'createdAt', 'reports', 'blocked'];
var EVENT_COLS = ['id', 'name', 'createdAt', 'folderId', 'sheetId', 'hostKeyHash', 'settings', 'pinHash', 'deleted', 'createdBy'];

// ---------------------------------------------------------------- entry points

function doGet() {
  return json_({ ok: true, app: 'photoshare', version: APP_VERSION });
}

function doPost(e) {
  var out;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') throw err_('bad_request', 'Missing body');
    if (e.postData.contents.length > LIMITS.BODY_BYTES) throw err_('too_large', 'Request too large');
    var req;
    try { req = JSON.parse(e.postData.contents); } catch (x) { throw err_('bad_request', 'Invalid JSON'); }
    if (!req || typeof req !== 'object' || typeof req.a !== 'string') throw err_('bad_request', 'Missing action');
    var handler = ACTIONS[req.a];
    if (!handler || !Object.prototype.hasOwnProperty.call(ACTIONS, req.a)) throw err_('bad_request', 'Unknown action');
    out = handler(req);
    out.ok = true;
  } catch (x) {
    if (x && x.code) {
      out = { ok: false, error: x.code, message: x.message };
      if (x.code === 'busy') logProblem_(req && req.a || '?', req && req.e, 'Server was busy (too many uploads at once); phones retried automatically.');
    } else {
      console.error(x && x.stack ? x.stack : x);
      logProblem_(req && req.a || '?', req && req.e, 'Unexpected error: ' + (x && x.message ? x.message : String(x)));
      out = { ok: false, error: 'server_error', message: 'Something went wrong. Please try again.' };
    }
  }
  return json_(out);
}

var ACTIONS = {
  // public
  event: aEvent,
  join: aJoin,
  upload: aUpload,
  list: aList,
  report: aReport,
  thumb: aThumb,
  photo: aPhoto,
  mine: aMine,
  guestbookAdd: aGuestbookAdd,
  guestbookList: aGuestbookList,
  noteAudio: aNoteAudio,
  me: aMe,
  // host (host key, or an admin's own key for events they manage)
  hostGet: aHostGet,
  hostUpdate: aHostUpdate,
  hostList: aHostList,
  hostModerate: aHostModerate,
  hostGuests: aHostGuests,
  hostBlockGuest: aHostBlockGuest,
  hostRotateKey: aHostRotateKey,
  hostMedia: aHostMedia,
  hostManifest: aHostManifest,
  hostSaveManifest: aHostSaveManifest,
  hostMarkArchived: aHostMarkArchived,
  hostFavorite: aHostFavorite,
  hostRecover: aHostRecover,
  hostGuestbook: aHostGuestbook,
  hostGuestbookModerate: aHostGuestbookModerate,
  // admin
  adminCheck: aAdminCheck,
  adminProblems: aAdminProblems,
  adminExportKeys: aAdminExportKeys,
  adminImportKeys: aAdminImportKeys,
  adminClearProblems: aAdminClearProblems,
  adminListAdmins: aAdminListAdmins,
  adminAddAdmin: aAdminAddAdmin,
  adminRemoveAdmin: aAdminRemoveAdmin,
  adminCreate: aAdminCreate,
  adminList: aAdminList,
  adminDelete: aAdminDelete,
  adminHostLink: aAdminHostLink
};

// ---------------------------------------------------------------- one-time setup (run from the editor)

/** Creates the root folder + index sheet and prints a new admin key to the execution log. */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ROOT_FOLDER_ID')) {
    var folder = DriveApp.createFolder('PhotoShare');
    props.setProperty('ROOT_FOLDER_ID', folder.getId());
  }
  if (!props.getProperty('INDEX_SHEET_ID')) {
    var ss = SpreadsheetApp.create('PhotoShare index');
    DriveApp.getFileById(ss.getId()).moveTo(DriveApp.getFolderById(props.getProperty('ROOT_FOLDER_ID')));
    var sh = ss.getSheets()[0];
    sh.setName('events');
    sh.getRange(1, 1, 1, EVENT_COLS.length).setValues([EVENT_COLS]);
    props.setProperty('INDEX_SHEET_ID', ss.getId());
  }
  if (!props.getProperty('ADMIN_KEY_HASH')) {
    rotateAdminKey();
  } else {
    console.log('Setup already complete. Run rotateAdminKey() to issue a new admin key.');
  }
}

/** Issues a new admin key (invalidates the old one). Copy it from the execution log. */
function rotateAdminKey() {
  var key = randomKey_(32);
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY_HASH', sha256Hex_(key));
  console.log('NEW ADMIN KEY (store it in a password manager; it is not saved anywhere): ' + key);
  return 'Admin key printed to the execution log.';
}

/** Run once to grant the Drive + Sheets permissions without doing anything else. */
function authorize() {
  DriveApp.getRootFolder();
  return 'ok';
}

// ---------------------------------------------------------------- public actions

function aEvent(req) {
  var ev = loadEvent_(req.e);
  return { event: publicEvent_(ev) };
}

function aJoin(req) {
  var ev = loadEvent_(req.e);
  var s = ev.settings;
  checkPin_(ev, req.pin);
  if (!rateOk_('join:' + ev.id, LIMITS.JOINS_PER_EVENT_PER_MIN, 60)) throw err_('rate_limited', 'Too many people joining at once. Try again in a moment.');
  // Re-join with an existing token (same phone) keeps shots.
  if (req.g && req.t) {
    var existing = findGuest_(ev, str_(req.g, 40));
    if (existing && safeEq_(existing.row.tokenHash, sha256Hex_(String(req.t)))) {
      return { guest: guestView_(ev, existing.row), event: publicEvent_(ev), key: eventKey_(ev) || undefined };
    }
  }
  var label = cleanText_(req.label, LIMITS.LABEL);
  var guestId = randomId_(12);
  var token = randomKey_(24);
  if (!label) label = 'Guest ' + guestId.slice(0, 4).toUpperCase();
  withLock_(function () {
    var sh = eventSheet_(ev, 'guests');
    // Joins are cheap, so cap them too (people re-joining on new phones/browsers is expected).
    if (sh.getLastRow() - 1 >= s.maxGuests * 4 + 50) throw err_('full', 'This event has reached its guest limit.');
    sh.appendRow([guestId, sha256Hex_(token), txt_(label), 0, 0, Date.now(), 0, false]);
  });
  var row = { guestId: guestId, label: label, shots: 0, uploads: 0, blocked: false };
  return { guest: guestView_(ev, row), token: token, event: publicEvent_(ev), shotsPerGuest: s.shotsPerGuest, key: eventKey_(ev) || undefined };
}

function aMe(req) {
  var ev = loadEvent_(req.e);
  var g = authGuest_(ev, req);
  return { guest: guestView_(ev, g.row), key: eventKey_(ev) || undefined };
}

function aUpload(req) {
  var ev = loadEvent_(req.e);
  var s = ev.settings;
  var g = authGuest_(ev, req);
  var now = Date.now();
  if (s.paused) throw err_('paused', 'The host has paused uploads.');
  if (s.opensAt && now < Date.parse(s.opensAt)) throw err_('not_open', 'Uploads have not opened yet.');
  if (s.closesAt && now > Date.parse(s.closesAt)) throw err_('closed', 'This album is closed.');
  if (g.row.blocked) throw err_('blocked', 'Uploads are turned off for this guest.');

  var kind = req.kind === 'video' ? 'video' : 'photo';
  if (kind === 'video' && !s.allowVideo) throw err_('no_video', 'Videos are turned off for this event.');
  var clientId = str_(req.clientId, 64);
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(clientId)) throw err_('bad_request', 'Invalid clientId');

  if (!rateOk_('upg:' + ev.id + ':' + g.row.guestId, LIMITS.UPLOADS_PER_GUEST_PER_MIN, 60)) throw err_('rate_limited', 'Slow down a little.');
  if (!rateOk_('upe:' + ev.id, LIMITS.UPLOADS_PER_EVENT_PER_MIN, 60)) throw err_('rate_limited', 'Lots of uploads right now. Retrying soon.');

  // Idempotency: offline queue retries must not double-count. Same pass totals storage used.
  var stats = mediaStats_(ev, g.row.guestId, clientId);
  if (stats.dup) return { id: stats.dup.id, duplicate: true, guest: guestView_(ev, g.row) };

  var enc = s.encrypted === true;
  var bytes = decodeB64_(req.data);
  var max = (kind === 'video' ? LIMITS.VIDEO_BYTES : LIMITS.PHOTO_BYTES) + (enc ? ENC_OVERHEAD : 0);
  if (!bytes.length || bytes.length > max) throw err_('too_large', 'File is too large.');
  if (stats.bytes + bytes.length > s.maxStorageMB * 1024 * 1024) throw err_('full', 'This album has reached its storage limit.');
  var mime, plainSha = '';
  if (enc) {
    // Private storage: the phone encrypted the file (and already stripped location data when it
    // re-encoded the photo). The server can't look inside, so it checks the envelope and the
    // declared type; the app re-checks the real type after decrypting before showing anything.
    if (!isEnc_(bytes)) throw err_('needs_update', 'This event needs the latest version of the camera page. Please reload.');
    mime = String(req.mime || '');
    if (kind === 'photo' && mime !== 'image/jpeg') throw err_('bad_type', 'Photos must be JPEG.');
    if (kind === 'video' && mime !== 'video/mp4' && mime !== 'video/webm') throw err_('bad_type', 'Unsupported video format.');
    plainSha = /^[0-9a-f]{64}$/.test(String(req.sha)) ? String(req.sha) : '';
  } else {
    mime = sniffMime_(bytes);
    if (kind === 'photo' && mime !== 'image/jpeg') throw err_('bad_type', 'Photos must be JPEG.');
    if (kind === 'video' && mime !== 'video/mp4' && mime !== 'video/webm') throw err_('bad_type', 'Unsupported video format.');
    if (mime === 'image/jpeg') bytes = stripJpegMeta_(bytes);
  }

  var thumbBytes = null;
  if (req.thumb) {
    thumbBytes = decodeB64_(req.thumb);
    if (enc) {
      if (thumbBytes.length > LIMITS.THUMB_BYTES + ENC_OVERHEAD || !isEnc_(thumbBytes)) throw err_('bad_type', 'Invalid preview image.');
    } else {
      if (thumbBytes.length > LIMITS.THUMB_BYTES || sniffMime_(thumbBytes) !== 'image/jpeg') throw err_('bad_type', 'Invalid preview image.');
      thumbBytes = stripJpegMeta_(thumbBytes);
    }
  }
  if (kind === 'video' && !thumbBytes) throw err_('bad_request', 'Video preview required.');

  // Reserve a shot under lock so parallel uploads can't exceed the roll.
  var inflightKey = 'cid:' + ev.id + ':' + g.row.guestId + ':' + clientId;
  withLock_(function () {
    var cache = CacheService.getScriptCache();
    // Concurrent retries of the same photo: the second waits and later gets the duplicate answer.
    if (cache.get(inflightKey)) throw err_('in_progress', 'Already uploading this photo.');
    cache.put(inflightKey, '1', 300);
    var fresh = findGuest_(ev, g.row.guestId);
    if (fresh.row.shots >= s.shotsPerGuest) throw err_('no_shots', 'Your roll is finished!');
    if (fresh.row.uploads === 0 && countActiveGuests_(ev) >= s.maxGuests) throw err_('full', 'This event has reached its guest limit.');
    var total = mediaSheet_(ev).getLastRow() - 1;
    if (total >= s.maxGuests * s.shotsPerGuest + 50) throw err_('full', 'This album is full.');
    fresh.sheet.getRange(fresh.rowIndex, 4, 1, 2).setValues([[fresh.row.shots + 1, fresh.row.uploads + 1]]);
    g.row.shots = fresh.row.shots + 1;
    g.row.uploads = fresh.row.uploads + 1;
  });

  var folder = DriveApp.getFolderById(ev.folderId);
  var ext = { 'image/jpeg': 'jpg', 'video/mp4': 'mp4', 'video/webm': 'webm' }[mime];
  var base = Utilities.formatDate(new Date(now), 'UTC', "yyyyMMdd'T'HHmmss") + '_' + g.row.guestId.slice(0, 6) + '_' + clientId.slice(0, 8);
  var file, thumb = null;
  try {
    var fileMime = enc ? 'application/octet-stream' : mime;
    var sfx = enc ? '.enc' : '';
    file = folder.createFile(Utilities.newBlob(bytes, fileMime, base + '.' + ext + sfx));
    if (thumbBytes) thumb = subFolder_(ev, 'Previews (used by the app)').createFile(Utilities.newBlob(thumbBytes, enc ? 'application/octet-stream' : 'image/jpeg', base + '_preview.jpg' + sfx));
  } catch (x) {
    refundShot_(ev, g.row.guestId);
    CacheService.getScriptCache().remove(inflightKey);
    throw x;
  }
  var status = s.approval ? 'pending' : 'visible';
  try {
    // A sharing failure must not lose the photo: it is saved and still viewable through the
    // site's fallback; the problem is logged for the admin instead.
    var flagList = [];
    var blur = Number(req.blur);
    if (kind === 'photo' && isFinite(blur) && blur >= 0 && blur < LIMITS.BLUR_THRESHOLD) flagList.push('blurry');
    if (!enc && status === 'visible' && !share_(file, thumb, true, ev.id)) flagList.push('share-failed');
    if (enc) flagList.push('encrypted');
    var flags = flagList.join(',');
    var sha = enc ? plainSha : sha256Hex_(bytes);
    var w = int_(req.w, 0, 20000, 0), h = int_(req.h, 0, 20000, 0), dur = int_(req.dur, 0, 600, 0);
    withLock_(function () {
      var sh = mediaSheet_(ev);
      var seq = sh.getLastRow();
      sh.appendRow([seq, file.getId(), thumb ? thumb.getId() : '', g.row.guestId, kind, mime, bytes.length, sha,
        w, h, dur, now, status, 0, clientId, '', '', flags, false]);
    });
  } catch (x) {
    // Never leave orphan files in Drive: undo the upload so the phone's retry starts clean.
    try { file.setTrashed(true); if (thumb) thumb.setTrashed(true); } catch (y) { /* ignore */ }
    refundShot_(ev, g.row.guestId);
    CacheService.getScriptCache().remove(inflightKey);
    throw x;
  }
  bumpVersion_(ev.id);
  return { id: file.getId(), status: status, guest: guestView_(ev, g.row) };
}

function aList(req) {
  var ev = loadEvent_(req.e);
  var s = ev.settings;
  var isWall = req.mode === 'wall' && !!req.wk && safeEq_(String(req.wk), wallKey_(ev));
  if (!isWall) checkPin_(ev, req.pin);
  var revealed = isRevealed_(s);
  var v = getVersion_(ev.id);
  var base = { v: v, revealed: revealed, event: publicEvent_(ev) };
  if (req.v && req.v === v) { base.unchanged = true; return base; }
  var all = readMedia_(ev);
  var visible = all.filter(function (m) { return m.status === 'visible'; });
  base.count = visible.length;
  base.pending = all.filter(function (m) { return m.status === 'pending'; }).length;
  if (s.encrypted && revealed && (s.guestGallery || isWall)) base.key = eventKey_(ev);
  if (!revealed || (!s.guestGallery && !isWall)) {
    base.items = [];
    return base;
  }
  var labels = guestLabels_(ev);
  base.items = visible.map(function (m) {
    return { i: m.id, t: m.thumbId || '', k: m.kind === 'video' ? 'v' : 'p', g: labels[m.guestId] || (m.guestId === 'recovered' ? 'Recovered from Drive' : ''), c: m.createdAt, w: m.w, h: m.h, d: Number(m.dur) || 0, f: m.fav === true ? 1 : 0 };
  });
  return base;
}

/**
 * Who may read a media item through the API (used when Google's own URLs can't be used):
 * anyone, if it is visible and revealed in a browsable album (or the TV wall key is given);
 * and the guest who took it, always (powers "My photos", even before the reveal).
 */
function mediaReadable_(ev, req, m) {
  if (!m || m.row.status === 'deleted') return false;
  var s = ev.settings;
  var isWall = !!req.wk && safeEq_(String(req.wk), wallKey_(ev));
  if (req.g && req.t) {
    var g = findGuest_(ev, str_(req.g, 40));
    if (g && safeEq_(g.row.tokenHash, sha256Hex_(String(req.t))) && String(m.row.guestId) === g.row.guestId) return true;
  }
  if (m.row.status !== 'visible' || !isRevealed_(s) || (!s.guestGallery && !isWall)) return false;
  if (!isWall) checkPin_(ev, req.pin);
  return true;
}

/** Preview image (~1024 px JPEG) for a photo or video the caller may see. */
function aThumb(req) {
  var ev = loadEvent_(req.e);
  if (!rateOk_('thumb:' + ev.id, LIMITS.THUMBS_PER_EVENT_PER_MIN, 60)) throw err_('rate_limited', 'Busy, try again.');
  var m = findMedia_(ev, str_(req.id, 100));
  if (!mediaReadable_(ev, req, m)) throw err_('not_found', 'Not found');
  var blob = DriveApp.getFileById(m.row.thumbId || m.row.id).getBlob();
  var bytes = blob.getBytes();
  if (isEnc_(bytes)) {
    if (bytes.length > LIMITS.THUMB_BYTES + ENC_OVERHEAD) throw err_('too_large', 'Preview too large');
    return { mime: 'image/jpeg', enc: true, data: Utilities.base64Encode(bytes) };
  }
  if (blob.getContentType() !== 'image/jpeg') throw err_('not_found', 'Not found');
  if (bytes.length > LIMITS.THUMB_BYTES) throw err_('too_large', 'Preview too large');
  return { mime: 'image/jpeg', data: Utilities.base64Encode(bytes) };
}

/** Full-resolution photo or video for enhance/download/playback, same access rules as aThumb. */
function aPhoto(req) {
  var ev = loadEvent_(req.e);
  if (!rateOk_('photo:' + ev.id, LIMITS.PHOTOS_PER_EVENT_PER_MIN, 60)) throw err_('rate_limited', 'Busy, try again.');
  var m = findMedia_(ev, str_(req.id, 100));
  if (!mediaReadable_(ev, req, m)) throw err_('not_found', 'Not found');
  var bytes = DriveApp.getFileById(m.row.id).getBlob().getBytes();
  // Private-storage events: photos and videos are only viewable through the app.
  if (isEnc_(bytes)) {
    if (bytes.length > LIMITS.VIDEO_BYTES + ENC_OVERHEAD) throw err_('too_large', 'Too large');
    return { mime: String(m.row.mime), enc: true, data: Utilities.base64Encode(bytes) };
  }
  var mime = sniffMime_(bytes);
  if (m.row.kind === 'video') {
    // Videos come through here only when Drive can't serve them (e.g. a guest's own video before it's public).
    if (bytes.length > LIMITS.VIDEO_BYTES || (mime !== 'video/mp4' && mime !== 'video/webm')) throw err_('not_found', 'Not found');
    return { mime: mime, data: Utilities.base64Encode(bytes) };
  }
  if (bytes.length > LIMITS.PHOTO_BYTES || mime !== 'image/jpeg') throw err_('not_found', 'Not found');
  return { mime: 'image/jpeg', data: Utilities.base64Encode(bytes) };
}

/** A guest's own photos and videos, whatever the reveal setting. */
function aMine(req) {
  var ev = loadEvent_(req.e);
  var g = authGuest_(ev, req);
  var items = readMedia_(ev).filter(function (m) { return String(m.guestId) === g.row.guestId && m.status !== 'deleted'; })
    .map(function (m) { return { i: m.id, t: m.thumbId || '', k: m.kind === 'video' ? 'v' : 'p', c: m.createdAt, w: m.w, h: m.h, s: m.status }; });
  return { items: items, guest: guestView_(ev, g.row) };
}

// ---------------------------------------------------------------- guestbook

function notesSheet_(ev) {
  var ss = SpreadsheetApp.openById(ev.sheetId);
  var sh = ss.getSheetByName('notes');
  if (!sh) {
    sh = ss.insertSheet('notes');
    sh.getRange(1, 1, 1, NOTE_COLS.length).setValues([NOTE_COLS]);
  }
  return sh;
}

function aGuestbookAdd(req) {
  var ev = loadEvent_(req.e);
  var s = ev.settings;
  if (!s.guestbook) throw err_('disabled', 'The guestbook is turned off.');
  var g = authGuest_(ev, req);
  if (g.row.blocked) throw err_('blocked', 'Posting is turned off for this guest.');
  if (s.closesAt && Date.now() > Date.parse(s.closesAt)) throw err_('closed', 'This album is closed.');
  var clientId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.clientId || '')) ? String(req.clientId) : '';
  // A retry of the same message (weak signal) returns the first result instead of failing.
  if (clientId) {
    var prev = readNotes_(ev).filter(function (n) { return n.guestId === g.row.guestId && n.clientId === clientId; })[0];
    if (prev) return { id: prev.id, status: prev.status, duplicate: true };
  }
  var text = cleanText_(req.text, LIMITS.NOTE_TEXT);
  var audio = null, mime = '';
  if (req.audio) {
    audio = decodeB64_(req.audio);
    if (audio.length > LIMITS.AUDIO_BYTES + ENC_OVERHEAD) throw err_('too_large', 'That voice message is too long.');
    if (s.encrypted) {
      if (!isEnc_(audio)) throw err_('needs_update', 'This event needs the latest version of the page. Please reload.');
      mime = /^audio\/(webm|mp4|ogg)$/.test(String(req.audioMime)) ? String(req.audioMime) : '';
    } else {
      mime = sniffAudio_(audio);
    }
    if (!mime) throw err_('bad_type', 'This phone recorded in a format we can’t save. Try typing a message instead.');
  }
  if (!text && !audio) throw err_('bad_request', 'Write a note or record a message.');
  if (!rateOk_('gb:' + ev.id + ':' + g.row.guestId, 4, 60)) throw err_('rate_limited', 'Slow down a little.');
  var existing = readNotes_(ev).filter(function (n) { return n.guestId === g.row.guestId && n.status !== 'deleted'; }).length;
  if (existing >= LIMITS.NOTES_PER_GUEST) throw err_('full', 'You’ve left the maximum number of messages.');
  var status = s.approval ? 'pending' : 'visible';
  var id = randomId_(12);
  var audioId = '';
  var dur = int_(req.dur, 0, 600, 0);
  // Save the recording before taking the lock, so the lock is held only for the sheet write.
  if (audio) {
    var ext = { 'audio/webm': '.webm', 'audio/mp4': '.m4a', 'audio/ogg': '.ogg' }[mime];
    var f = subFolder_(ev, 'Guestbook voice messages').createFile(Utilities.newBlob(audio, mime, 'guestbook_' + id + ext + (s.encrypted ? '.enc' : '')));
    if (status === 'visible' && !s.encrypted) share_(f, null, true, ev.id);
    audioId = f.getId();
  }
  try {
    withLock_(function () {
      notesSheet_(ev).appendRow([id, g.row.guestId, txt_(g.row.label), txt_(text), audioId, Date.now(), status, clientId, dur]);
    });
  } catch (x) {
    if (audioId) { try { DriveApp.getFileById(audioId).setTrashed(true); } catch (y) { /* ignore */ } }
    throw x;
  }
  bumpVersion_(ev.id);
  return { id: id, status: status };
}

/** Audio containers browsers record: WebM (Chrome/Android), MP4/M4A (Safari, newer Chrome), Ogg (Firefox). */
function sniffAudio_(b) {
  if (b.length < 12) return '';
  if (u8_(b[0]) === 0x1a && u8_(b[1]) === 0x45 && u8_(b[2]) === 0xdf && u8_(b[3]) === 0xa3) return 'audio/webm';
  if (u8_(b[4]) === 0x66 && u8_(b[5]) === 0x74 && u8_(b[6]) === 0x79 && u8_(b[7]) === 0x70) return 'audio/mp4';
  if (u8_(b[0]) === 0x4f && u8_(b[1]) === 0x67 && u8_(b[2]) === 0x67 && u8_(b[3]) === 0x53) return 'audio/ogg';
  return '';
}

function isM4a_(bytes) {
  if (bytes.length < 12) return false;
  var brand = String.fromCharCode(u8_(bytes[8]), u8_(bytes[9]), u8_(bytes[10]), u8_(bytes[11]));
  return u8_(bytes[4]) === 0x66 && u8_(bytes[5]) === 0x74 && u8_(bytes[6]) === 0x79 && u8_(bytes[7]) === 0x70 && /^(M4A |M4B |mp41|mp42|isom|iso5|iso6)$/.test(brand);
}

function readNotes_(ev) {
  return notesSheet_(ev).getDataRange().getValues().slice(1).map(function (r) {
    return { id: String(r[0]), guestId: String(r[1]), label: String(r[2]), text: String(r[3] == null ? '' : r[3]), audioId: r[4] || '', createdAt: r[5], status: r[6], clientId: String(r[7] || ''), dur: Number(r[8]) || 0 };
  });
}

function aGuestbookList(req) {
  var ev = loadEvent_(req.e);
  var s = ev.settings;
  var isWall = !!req.wk && safeEq_(String(req.wk), wallKey_(ev));
  if (!isWall) checkPin_(ev, req.pin);
  if (!s.guestbook || !isRevealed_(s) || (!s.guestGallery && !isWall)) return { notes: [] };
  return {
    notes: readNotes_(ev).filter(function (n) { return n.status === 'visible'; }).map(function (n) {
      return { id: n.id, g: n.label, text: n.text, a: n.audioId, c: n.createdAt, d: n.dur };
    })
  };
}

/** Voice message bytes for a visible guestbook note (played through the app, not Drive's player). */
function aNoteAudio(req) {
  var ev = loadEvent_(req.e);
  var s = ev.settings;
  var isWall = !!req.wk && safeEq_(String(req.wk), wallKey_(ev));
  if (!isWall) checkPin_(ev, req.pin);
  if (!s.guestbook || !isRevealed_(s) || (!s.guestGallery && !isWall)) throw err_('not_found', 'Not found');
  if (!rateOk_('audio:' + ev.id, LIMITS.PHOTOS_PER_EVENT_PER_MIN, 60)) throw err_('rate_limited', 'Busy, try again.');
  var id = str_(req.id, 100);
  var note = readNotes_(ev).filter(function (n) { return n.audioId === id && n.status === 'visible'; })[0];
  if (!note) throw err_('not_found', 'Not found');
  var blob = DriveApp.getFileById(id).getBlob();
  var bytes = blob.getBytes();
  if (isEnc_(bytes)) return { mime: blob.getContentType(), enc: true, data: Utilities.base64Encode(bytes) };
  if (bytes.length > LIMITS.AUDIO_BYTES || !sniffAudio_(bytes)) throw err_('not_found', 'Not found');
  return { mime: sniffAudio_(bytes), data: Utilities.base64Encode(bytes) };
}

function aHostGuestbook(req) {
  var ev = authHost_(req);
  return {
    notes: readNotes_(ev).filter(function (n) { return n.status !== 'deleted'; }).map(function (n) {
      return { id: n.id, g: n.label, gid: n.guestId, text: n.text, a: n.audioId, c: n.createdAt, s: n.status, d: n.dur };
    })
  };
}

function aHostGuestbookModerate(req) {
  var ev = authHost_(req);
  var map = { show: 'visible', approve: 'visible', hide: 'hidden', delete: 'deleted' };
  var status = map[req.action];
  if (!status) throw err_('bad_request', 'Unknown action');
  var wanted = Object.create(null);
  (Array.isArray(req.ids) ? req.ids.slice(0, 200) : []).forEach(function (x) { wanted[str_(x, 40)] = true; });
  var changed = 0;
  withLock_(function () {
    var sh = notesSheet_(ev);
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (!wanted[String(data[r][0])] || data[r][6] === 'deleted') continue;
      if (data[r][4]) {
        var f = DriveApp.getFileById(String(data[r][4]));
        if (status === 'deleted') f.setTrashed(true); else share_(f, null, status === 'visible', ev.id);
      }
      sh.getRange(r + 1, 7).setValue(status);
      changed++;
    }
  });
  bumpVersion_(ev.id);
  return { changed: changed };
}

// ---------------------------------------------------------------- favorites

/**
 * Finds photos/videos sitting in the event's Drive folder that the album doesn't know about
 * (e.g. uploads interrupted by an error before v1.2, or files the owner added by hand) and
 * adds them to the album. Duplicates of the same photo (by SHA-256) are added only once.
 * Only the event's own folder is scanned.
 */
function aHostRecover(req) {
  var ev = authHost_(req);
  var dryRun = req.dryRun === true;
  var known = Object.create(null);
  readMedia_(ev).forEach(function (m) { known[String(m.id)] = true; known['sha:' + m.sha256] = true; });
  var found = [], dupes = 0;
  var it = DriveApp.getFolderById(ev.folderId).getFiles();
  var scanned = 0;
  while (it.hasNext() && scanned < 2000) {
    var f = it.next();
    scanned++;
    if (known[f.getId()] || f.isTrashed()) continue;
    if (ev.settings.encrypted) {
      // Private storage: files are locked, so match by name and the lock header instead.
      var em = /^(.+)\.(jpg|mp4|webm)\.enc$/.exec(f.getName());
      if (!em || /_preview$/.test(em[1])) continue;
      var eb = f.getBlob().getBytes();
      if (!isEnc_(eb)) continue;
      var csha = sha256Hex_(eb);
      if (known['csha:' + csha]) { dupes++; continue; }
      known['csha:' + csha] = true;
      found.push({ file: f, mime: { jpg: 'image/jpeg', mp4: 'video/mp4', webm: 'video/webm' }[em[2]], bytes: eb.length, sha: '', created: f.getDateCreated().getTime(), base: em[1] });
      continue;
    }
    var mime = f.getMimeType();
    if (mime !== 'image/jpeg' && mime !== 'video/mp4' && mime !== 'video/webm') continue;
    if (/_preview\.jpg$/.test(f.getName())) continue;
    var bytes = f.getBlob().getBytes();
    var sniff = sniffMime_(bytes);
    if (sniff !== mime) continue;
    var sha = sha256Hex_(bytes);
    if (known['sha:' + sha]) { dupes++; continue; }
    known['sha:' + sha] = true;
    found.push({ file: f, mime: mime, bytes: bytes.length, sha: sha, created: f.getDateCreated().getTime() });
  }
  if (dryRun || !found.length) return { found: found.length, duplicates: dupes, added: 0 };
  var status = ev.settings.approval ? 'pending' : 'visible';
  var rows = found.map(function (x) {
    var thumbId = '';
    if (x.base) { // private storage: reuse the locked preview saved at upload time, if it's there
      var pit = subFolder_(ev, 'Previews (used by the app)').getFilesByName(x.base + '_preview.jpg.enc');
      if (pit.hasNext()) thumbId = pit.next().getId();
      return [0, x.file.getId(), thumbId, 'recovered', x.mime.indexOf('video') === 0 ? 'video' : 'photo', x.mime, x.bytes, x.sha,
        0, 0, 0, x.created, status, 0, 'recovered-' + x.file.getId().slice(0, 40), '', '', 'recovered,encrypted', false];
    }
    try {
      var t = x.file.getThumbnail();
      if (t) thumbId = subFolder_(ev, 'Previews (used by the app)').createFile(t.setName(x.file.getName().replace(/\.[^.]+$/, '') + '_preview.jpg')).getId();
    } catch (e) { /* video thumbnails may not be ready yet */ }
    if (status === 'visible') share_(x.file, thumbId ? DriveApp.getFileById(thumbId) : null, true, ev.id);
    return [0, x.file.getId(), thumbId, 'recovered', x.mime.indexOf('video') === 0 ? 'video' : 'photo', x.mime, x.bytes, x.sha,
      0, 0, 0, x.created, status, 0, 'recovered-' + x.file.getId().slice(0, 40), '', '', 'recovered', false];
  });
  withLock_(function () {
    var sh = mediaSheet_(ev);
    rows.forEach(function (r) { r[0] = sh.getLastRow(); sh.appendRow(r); });
  });
  bumpVersion_(ev.id);
  return { found: found.length, duplicates: dupes, added: rows.length };
}

function aHostFavorite(req) {
  var ev = authHost_(req);
  var fav = req.fav === true;
  var wanted = Object.create(null);
  (Array.isArray(req.ids) ? req.ids.slice(0, 200) : []).forEach(function (x) { wanted[str_(x, 100)] = true; });
  var changed = 0;
  withLock_(function () {
    var sh = mediaSheet_(ev);
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      if (!wanted[String(data[r][1])] || data[r][12] === 'deleted') continue;
      sh.getRange(r + 1, 19).setValue(fav);
      changed++;
    }
  });
  bumpVersion_(ev.id);
  return { changed: changed };
}

function aReport(req) {
  var ev = loadEvent_(req.e);
  if (!ev.settings.allowReports) throw err_('disabled', 'Reporting is turned off.');
  var g = authGuest_(ev, req);
  // Only guests who have actually taken a photo can report: stops drive-by accounts hiding the album.
  if (g.row.uploads < 1) throw err_('not_allowed', 'Take a photo first, then you can report photos.');
  if (g.row.reports >= LIMITS.REPORTS_PER_GUEST) throw err_('rate_limited', 'Report limit reached. Please tell the host.');
  var id = str_(req.id, 100);
  withLock_(function () {
    var m = findMedia_(ev, id);
    if (!m) throw err_('not_found', 'Photo not found.');
    if (m.row.status === 'visible') {
      m.sheet.getRange(m.rowIndex, 13, 1, 2).setValues([['reported', (Number(m.row.reports) || 0) + 1]]);
      share_(DriveApp.getFileById(m.row.id), m.row.thumbId ? DriveApp.getFileById(m.row.thumbId) : null, false, ev.id);
    }
    var fresh = findGuest_(ev, g.row.guestId);
    fresh.sheet.getRange(fresh.rowIndex, 7).setValue((Number(fresh.row.reports) || 0) + 1);
  });
  bumpVersion_(ev.id);
  return {};
}

// ---------------------------------------------------------------- host actions

function aHostGet(req) {
  var ev = authHost_(req);
  return { event: hostEvent_(ev), key: eventKey_(ev) || undefined };
}

function aHostUpdate(req) {
  var ev = authHost_(req);
  var incoming = req.settings && typeof req.settings === 'object' ? req.settings : {};
  var merged = {};
  Object.keys(ev.settings).forEach(function (k) {
    merged[k] = Object.prototype.hasOwnProperty.call(incoming, k) ? incoming[k] : ev.settings[k];
  });
  merged.encrypted = ev.settings.encrypted; // private storage is chosen when the event is created
  var next = sanitizeSettings_(merged);
  var pinHash = ev.pinHash;
  if (req.pin === '') pinHash = '';
  else if (req.pin != null) {
    if (!/^[0-9]{4,8}$/.test(String(req.pin))) throw err_('bad_request', 'Code must be 4–8 digits.');
    pinHash = sha256Hex_(ev.id + ':' + req.pin);
  }
  withLock_(function () {
    var row = findEventRow_(ev.id);
    row.sheet.getRange(row.rowIndex, 2).setValue(txt_(next.name));
    row.sheet.getRange(row.rowIndex, 7, 1, 2).setValues([[JSON.stringify(next), pinHash]]);
  });
  dropEventCache_(ev.id);
  bumpVersion_(ev.id);
  ev.settings = next;
  ev.pinHash = pinHash;
  return { event: hostEvent_(ev) };
}

function aHostList(req) {
  var ev = authHost_(req);
  var labels = guestLabels_(ev);
  var items = readMedia_(ev).filter(function (m) { return m.status !== 'deleted'; }).map(function (m) {
    return { i: m.id, t: m.thumbId, k: m.kind === 'video' ? 'v' : 'p', g: labels[m.guestId] || (m.guestId === 'recovered' ? 'Recovered from Drive' : ''), gid: m.guestId,
      c: m.createdAt, w: m.w, h: m.h, s: m.status, r: Number(m.reports) || 0, b: m.bytes, sha: m.sha256,
      ai: m.archIndex === '' ? null : Number(m.archIndex), f: m.flags || '', fv: m.fav === true };
  });
  return { items: items, v: getVersion_(ev.id), event: hostEvent_(ev) };
}

function aHostModerate(req) {
  var ev = authHost_(req);
  var action = req.action;
  var map = { show: 'visible', approve: 'visible', hide: 'hidden', delete: 'deleted' };
  if (!map[action]) throw err_('bad_request', 'Unknown moderation action');
  var ids = Array.isArray(req.ids) ? req.ids.slice(0, 200).map(function (x) { return str_(x, 100); }) : [];
  var changed = 0;
  withLock_(function () {
    var sh = mediaSheet_(ev);
    var data = sh.getDataRange().getValues();
    var wanted = Object.create(null);
    ids.forEach(function (id) { wanted[id] = true; });
    for (var r = 1; r < data.length; r++) {
      var id = String(data[r][1]);
      if (!wanted[id] || data[r][12] === 'deleted') continue;
      var file = DriveApp.getFileById(id);
      var thumb = data[r][2] ? DriveApp.getFileById(data[r][2]) : null;
      var status = map[action];
      if (status === 'deleted') {
        file.setTrashed(true);
        if (thumb) thumb.setTrashed(true);
      } else {
        share_(file, thumb, status === 'visible', ev.id);
      }
      sh.getRange(r + 1, 13, 1, 2).setValues([[status, status === 'visible' ? 0 : data[r][13]]]);
      changed++;
    }
  });
  bumpVersion_(ev.id);
  return { changed: changed };
}

function aHostGuests(req) {
  var ev = authHost_(req);
  var rows = eventSheet_(ev, 'guests').getDataRange().getValues().slice(1);
  return {
    guests: rows.map(function (r) {
      return { id: r[0], label: r[2], shots: Number(r[3]) || 0, uploads: Number(r[4]) || 0, joined: r[5], reports: Number(r[6]) || 0, blocked: r[7] === true };
    })
  };
}

function aHostBlockGuest(req) {
  var ev = authHost_(req);
  var gid = str_(req.guestId, 40);
  var block = req.block === true;
  withLock_(function () {
    var g = findGuest_(ev, gid);
    if (!g) throw err_('not_found', 'Guest not found');
    g.sheet.getRange(g.rowIndex, 8).setValue(block);
  });
  return {};
}

function aHostRotateKey(req) {
  var ev = authHost_(req);
  var key = randomKey_(32);
  withLock_(function () {
    var row = findEventRow_(ev.id);
    row.sheet.getRange(row.rowIndex, 6).setValue(sha256Hex_(key));
  });
  dropEventCache_(ev.id);
  return { hostKey: key };
}

/** Returns file bytes (base64) for one of THIS event's media files. Used for archiving to chain. */
function aHostMedia(req) {
  var ev = authHost_(req);
  var id = str_(req.id, 100);
  var m = findMedia_(ev, id);
  if (!m && req.which === 'note') {
    // Voice message from this event's guestbook (lets hosts listen before approving).
    var note = readNotes_(ev).filter(function (n) { return n.audioId === id && n.status !== 'deleted'; })[0];
    if (!note) throw err_('not_found', 'Not found');
    var ab = DriveApp.getFileById(id).getBlob();
    var abytes = ab.getBytes();
    return { mime: ab.getContentType(), enc: isEnc_(abytes) || undefined, data: Utilities.base64Encode(abytes) };
  }
  if (!m || m.row.status === 'deleted') throw err_('not_found', 'Not found');
  var which = req.which === 'orig' ? m.row.id : (m.row.thumbId || m.row.id);
  var blob = DriveApp.getFileById(which).getBlob();
  var bytes = blob.getBytes();
  if (bytes.length > LIMITS.VIDEO_BYTES + ENC_OVERHEAD) throw err_('too_large', 'File too large to fetch');
  if (isEnc_(bytes)) return { mime: which === m.row.id ? String(m.row.mime) : 'image/jpeg', enc: true, data: Utilities.base64Encode(bytes), sha256: m.row.sha256 };
  return { mime: blob.getContentType(), data: Utilities.base64Encode(bytes), sha256: m.row.sha256 };
}

function aHostManifest(req) {
  var ev = authHost_(req);
  var items = readMedia_(ev).filter(function (m) { return m.status !== 'deleted'; }).map(function (m) {
    return { id: m.id, sha256: m.sha256, kind: m.kind, bytes: m.bytes, createdAt: m.createdAt, status: m.status, archIndex: m.archIndex === '' ? null : Number(m.archIndex) };
  });
  return { eventId: ev.id, name: ev.settings.name, items: items };
}

function aHostSaveManifest(req) {
  var ev = authHost_(req);
  var text = String(req.manifest || '');
  if (!text || text.length > LIMITS.MANIFEST_BYTES) throw err_('bad_request', 'Invalid manifest');
  try { JSON.parse(text); } catch (x) { throw err_('bad_request', 'Manifest must be JSON'); }
  var folder = DriveApp.getFolderById(ev.folderId);
  var name = 'manifest-' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss") + '.json';
  var f = folder.createFile(Utilities.newBlob(text, 'application/json', name));
  return { fileId: f.getId(), name: name };
}

function aHostMarkArchived(req) {
  var ev = authHost_(req);
  var list = Array.isArray(req.items) ? req.items.slice(0, 100) : [];
  var byId = Object.create(null);
  list.forEach(function (x) {
    if (x && typeof x.id === 'string') {
      var tx = /^0x[0-9a-fA-F]{2,80}$/.test(String(x.tx)) ? String(x.tx) : '';
      byId[x.id] = { index: int_(x.index, 0, 1000000, 0), tx: tx };
    }
  });
  var n = 0;
  withLock_(function () {
    var sh = mediaSheet_(ev);
    var data = sh.getDataRange().getValues();
    for (var r = 1; r < data.length; r++) {
      var hit = byId[String(data[r][1])];
      if (!hit) continue;
      sh.getRange(r + 1, 16, 1, 2).setValues([[hit.index, hit.tx]]);
      n++;
    }
  });
  return { updated: n };
}

// ---------------------------------------------------------------- admin actions

function aAdminCheck(req) {
  var me = authAdmin_(req);
  return { version: APP_VERSION, me: { name: me.name, role: me.role } };
}

// ---- additional admins (owner only). Each admin has their own key; only its hash is stored.

function readAdmins_() {
  var list = parseJson_(PropertiesService.getScriptProperties().getProperty('ADMINS') || '[]');
  return Array.isArray(list) ? list : [];
}

function writeAdmins_(list) {
  PropertiesService.getScriptProperties().setProperty('ADMINS', JSON.stringify(list));
}

function aAdminListAdmins(req) {
  requireOwner_(authAdmin_(req));
  return { admins: readAdmins_().map(function (a) { return { id: a.id, name: a.name, createdAt: a.createdAt }; }) };
}

function aAdminAddAdmin(req) {
  requireOwner_(authAdmin_(req));
  var name = cleanText_(req.name, 40);
  if (!name) throw err_('bad_request', 'Give the admin a name, like “Sarah”.');
  var key = randomKey_(32);
  var entry = { id: randomId_(8), name: name, hash: sha256Hex_(key), createdAt: Date.now() };
  withLock_(function () {
    var list = readAdmins_();
    if (list.length >= 25) throw err_('bad_request', 'Too many admins. Remove one first.');
    list.push(entry);
    writeAdmins_(list);
  });
  return { admin: { id: entry.id, name: entry.name }, key: key };
}

function aAdminRemoveAdmin(req) {
  requireOwner_(authAdmin_(req));
  var id = str_(req.id, 20);
  var removed = false;
  withLock_(function () {
    var list = readAdmins_().filter(function (a) { if (a.id === id) { removed = true; return false; } return true; });
    writeAdmins_(list);
  });
  if (!removed) throw err_('not_found', 'Admin not found');
  return {};
}

function requireOwner_(me) {
  if (me.role !== 'owner') throw err_('forbidden', 'Only the studio owner can manage admins.');
}

/** Owners may act on any event; other admins only on events they created. */
function requireEventAdmin_(me, eventId) {
  if (me.role === 'owner') return;
  var row = findEventRow_(eventId);
  if (!row || String(row.row[9]) !== me.id) throw err_('forbidden', 'Only the studio owner or the admin who created this event can do that.');
}

function aAdminCreate(req) {
  var me = authAdmin_(req);
  var settings = sanitizeSettings_(req.settings || {});
  if (!settings.name) throw err_('bad_request', 'Event name required');
  var id = randomId_(10);
  var hostKey = randomKey_(32);
  var root = DriveApp.getFolderById(prop_('ROOT_FOLDER_ID'));
  var folder = root.createFolder(settings.name.replace(/[\\/:*?"<>|]/g, ' ') + ' (' + id + ')');
  var ss = SpreadsheetApp.create('PhotoShare ' + id);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  var media = ss.getSheets()[0];
  media.setName('media');
  media.getRange(1, 1, 1, MEDIA_COLS.length).setValues([MEDIA_COLS]);
  var guests = ss.insertSheet('guests');
  guests.getRange(1, 1, 1, GUEST_COLS.length).setValues([GUEST_COLS]);
  if (settings.encrypted) {
    // The event key lives in Script Properties (only visible to the script owner), never in Drive.
    PropertiesService.getScriptProperties().setProperty('EK:' + id, randomKey_(32));
  }
  withLock_(function () {
    indexSheet_().appendRow([id, txt_(settings.name), Date.now(), folder.getId(), ss.getId(), sha256Hex_(hostKey), JSON.stringify(settings), '', false, me.id]);
  });
  return { id: id, hostKey: hostKey };
}

function aAdminList(req) {
  var me = authAdmin_(req);
  var names = { owner: 'Owner' };
  readAdmins_().forEach(function (a) { names[a.id] = a.name; });
  var rows = indexSheet_().getDataRange().getValues().slice(1);
  var events = rows.filter(function (r) { return r[8] !== true; }).slice(-LIMITS.MAX_EVENTS_LIST).map(function (r) {
    var s = parseJson_(r[6]);
    var by = String(r[9] || 'owner');
    return { id: r[0], name: r[1], createdAt: r[2], date: s.date || '', folderUrl: 'https://drive.google.com/drive/folders/' + r[3],
      createdBy: names[by] || 'Removed admin', canManage: me.role === 'owner' || by === me.id };
  });
  return { events: events.reverse() };
}

/** Admin can mint a fresh host key for an event (e.g. if the host link was lost). */
function aAdminHostLink(req) {
  var me = authAdmin_(req);
  var ev = loadEvent_(req.e);
  requireEventAdmin_(me, ev.id);
  var key = randomKey_(32);
  withLock_(function () {
    var row = findEventRow_(ev.id);
    row.sheet.getRange(row.rowIndex, 6).setValue(sha256Hex_(key));
  });
  dropEventCache_(ev.id);
  return { hostKey: key };
}

function aAdminDelete(req) {
  var me = authAdmin_(req);
  var ev = loadEvent_(req.e);
  requireEventAdmin_(me, ev.id);
  if (req.confirm !== ev.id) throw err_('bad_request', 'Confirmation does not match');
  DriveApp.getFolderById(ev.folderId).setTrashed(true);
  withLock_(function () {
    var row = findEventRow_(ev.id);
    row.sheet.getRange(row.rowIndex, 9).setValue(true);
  });
  dropEventCache_(ev.id);
  return {};
}

// ---------------------------------------------------------------- auth

/** Returns { id, name, role } for the owner key (from setup) or an added admin's key. */
function authAdmin_(req) {
  var ownerHash = prop_('ADMIN_KEY_HASH');
  // Keys are 256-bit random values, so guessing is hopeless; the limit only stops abuse.
  // A correct key always works, so a stranger spamming wrong keys can't lock the studio out.
  var given = req.k ? sha256Hex_(String(req.k).slice(0, 200)) : '';
  if (given && safeEq_(given, ownerHash)) return { id: 'owner', name: 'Owner', role: 'owner' };
  var admins = readAdmins_();
  for (var i = 0; i < admins.length; i++) {
    if (given && safeEq_(given, admins[i].hash)) return { id: admins[i].id, name: admins[i].name, role: 'admin' };
  }
  if (!rateOk_('badadmin', LIMITS.BAD_ADMIN_PER_10MIN, 600, true)) throw err_('rate_limited', 'Too many attempts. Wait 10 minutes.');
  rateHit_('badadmin', 600);
  throw err_('unauthorized', 'Invalid admin key');
}

function authHost_(req) {
  var ev = loadEvent_(req.e);
  // Studio admins can open any event dashboard they're allowed to manage, using their own
  // admin key (sent as "admin:<key>") instead of the event's host key.
  if (typeof req.k === 'string' && req.k.indexOf('admin:') === 0) {
    var me = authAdmin_({ k: req.k.slice(6) });
    requireEventAdmin_(me, ev.id);
    return ev;
  }
  if (req.k && safeEq_(sha256Hex_(String(req.k).slice(0, 200)), ev.hostKeyHash)) return ev;
  var bucket = 'badhost:' + ev.id;
  if (!rateOk_(bucket, LIMITS.BAD_ADMIN_PER_10MIN, 600, true)) throw err_('rate_limited', 'Too many attempts. Wait 10 minutes.');
  rateHit_(bucket, 600);
  throw err_('unauthorized', 'Invalid host link');
}

function authGuest_(ev, req) {
  var gid = str_(req.g, 40);
  var g = gid ? findGuest_(ev, gid) : null;
  if (!g || !req.t || !safeEq_(g.row.tokenHash, sha256Hex_(String(req.t).slice(0, 200)))) throw err_('unauthorized', 'Please re-open the event link.');
  return g;
}

function checkPin_(ev, pin) {
  if (!ev.pinHash) return;
  var bucket = 'badpin:' + ev.id;
  if (!rateOk_(bucket, LIMITS.BAD_PIN_PER_EVENT_PER_10MIN, 600, true)) throw err_('rate_limited', 'Too many wrong codes. Wait a few minutes.');
  if (!pin || !safeEq_(sha256Hex_(ev.id + ':' + pin), ev.pinHash)) {
    rateHit_(bucket, 600);
    throw err_('pin_required', 'Enter the event code.');
  }
}

// ---------------------------------------------------------------- events

function loadEvent_(id) {
  id = str_(id, 20);
  if (!/^[A-Za-z0-9]{6,20}$/.test(id)) throw err_('not_found', 'Event not found');
  var cache = CacheService.getScriptCache();
  var cached = cache.get('e:' + id);
  var ev = cached ? parseJson_(cached) : null;
  if (!ev || !ev.id) {
    var row = findEventRow_(id);
    if (!row || row.row[8] === true) throw err_('not_found', 'Event not found');
    var r = row.row;
    ev = { id: r[0], createdAt: r[2], folderId: r[3], sheetId: r[4], hostKeyHash: r[5], settings: sanitizeSettings_(parseJson_(r[6])), pinHash: r[7] || '' };
    cache.put('e:' + id, JSON.stringify(ev), 300);
  }
  return ev;
}

function dropEventCache_(id) {
  CacheService.getScriptCache().remove('e:' + id);
}

function findEventRow_(id) {
  var sh = indexSheet_();
  var ids = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = ids.length - 1; i >= 1; i--) {
    if (String(ids[i][0]) === id) {
      return { sheet: sh, rowIndex: i + 1, row: sh.getRange(i + 1, 1, 1, EVENT_COLS.length).getValues()[0] };
    }
  }
  return null;
}

function sanitizeSettings_(s) {
  s = s || {};
  var iso = function (v) {
    if (!v) return '';
    var t = Date.parse(v);
    return isNaN(t) ? '' : new Date(t).toISOString();
  };
  var looks = ['none', 'glow', 'vivid', 'classic', 'warm', 'fade', 'moody', 'mono'];
  var color = /^#[0-9a-fA-F]{6}$/.test(String(s.accent)) ? String(s.accent) : '#0f7c7a';
  return {
    name: cleanText_(s.name, LIMITS.NAME),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(s.date)) ? String(s.date) : '',
    welcome: cleanText_(s.welcome, LIMITS.WELCOME),
    reveal: s.reveal === 'after' ? 'after' : 'live',
    revealAt: iso(s.revealAt),
    opensAt: iso(s.opensAt),
    closesAt: iso(s.closesAt),
    shotsPerGuest: int_(s.shotsPerGuest, 1, LIMITS.MAX_SHOTS, 25),
    maxGuests: int_(s.maxGuests, 1, LIMITS.MAX_GUESTS, 150),
    allowVideo: s.allowVideo !== false,
    maxVideoSec: int_(s.maxVideoSec, 3, 60, 15),
    maxStorageMB: int_(s.maxStorageMB, 100, 200000, 5000),
    allowLibrary: s.allowLibrary === true,
    approval: s.approval === true,
    guestGallery: s.guestGallery !== false,
    allowReports: s.allowReports !== false,
    enhance: s.enhance !== false,
    encrypted: s.encrypted === true,
    guestbook: s.guestbook !== false,
    paused: s.paused === true,
    look: looks.indexOf(s.look) >= 0 ? s.look : 'classic',
    guestLooks: s.guestLooks !== false,
    beauty: s.beauty !== false,
    dateStamp: s.dateStamp === true,
    accent: color
  };
}

function isRevealed_(s) {
  if (s.reveal !== 'after') return true;
  if (!s.revealAt) return false;
  return Date.now() >= Date.parse(s.revealAt);
}

function publicEvent_(ev) {
  var s = ev.settings;
  return {
    id: ev.id, name: s.name, date: s.date, welcome: s.welcome, reveal: s.reveal, revealAt: s.revealAt,
    opensAt: s.opensAt, closesAt: s.closesAt, shotsPerGuest: s.shotsPerGuest, allowVideo: s.allowVideo,
    maxVideoSec: s.maxVideoSec, allowLibrary: s.allowLibrary, guestGallery: s.guestGallery,
    allowReports: s.allowReports, paused: s.paused, look: s.look, guestLooks: s.guestLooks, beauty: s.beauty, dateStamp: s.dateStamp,
    accent: s.accent, approval: s.approval, encrypted: s.encrypted, enhance: s.enhance, guestbook: s.guestbook, needsPin: !!ev.pinHash, revealed: isRevealed_(s), now: Date.now()
  };
}

/** Key for the TV wall link: lets a screen show photos without exposing the host key. */
function wallKey_(ev) {
  return sha256Hex_(ev.hostKeyHash + ':wall').slice(0, 32);
}

function hostEvent_(ev) {
  var p = publicEvent_(ev);
  p.wallKey = wallKey_(ev);
  p.settings = ev.settings;
  p.folderUrl = 'https://drive.google.com/drive/folders/' + ev.folderId;
  p.createdAt = ev.createdAt;
  return p;
}

// ---------------------------------------------------------------- sheets helpers

function indexSheet_() {
  return SpreadsheetApp.openById(prop_('INDEX_SHEET_ID')).getSheetByName('events');
}

function eventSheet_(ev, name) {
  return SpreadsheetApp.openById(ev.sheetId).getSheetByName(name);
}

function mediaSheet_(ev) { return eventSheet_(ev, 'media'); }

function rowObj_(cols, r) {
  var o = {};
  for (var i = 0; i < cols.length; i++) o[cols[i]] = r[i];
  return o;
}

function readMedia_(ev) {
  return mediaSheet_(ev).getDataRange().getValues().slice(1).map(function (r) { return rowObj_(MEDIA_COLS, r); });
}

function findMedia_(ev, id) {
  if (!id) return null;
  var sh = mediaSheet_(ev);
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][1]) === id) return { sheet: sh, rowIndex: r + 1, row: rowObj_(MEDIA_COLS, data[r]) };
  }
  return null;
}

/** One pass over the media sheet: duplicate lookup + total bytes stored (excluding deleted). */
function mediaStats_(ev, guestId, clientId) {
  var data = mediaSheet_(ev).getDataRange().getValues();
  var out = { dup: null, bytes: 0 };
  for (var r = 1; r < data.length; r++) {
    if (data[r][12] !== 'deleted') out.bytes += Number(data[r][6]) || 0;
    if (!out.dup && String(data[r][14]) === clientId && String(data[r][3]) === guestId) out.dup = rowObj_(MEDIA_COLS, data[r]);
  }
  return out;
}

function findMediaByClient_(ev, guestId, clientId) {
  var data = mediaSheet_(ev).getDataRange().getValues();
  for (var r = data.length - 1; r >= 1; r--) {
    if (String(data[r][14]) === clientId && String(data[r][3]) === guestId) return rowObj_(MEDIA_COLS, data[r]);
  }
  return null;
}

function findGuest_(ev, guestId) {
  if (!guestId) return null;
  var sh = eventSheet_(ev, 'guests');
  var data = sh.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (String(data[r][0]) === guestId) {
      var row = rowObj_(GUEST_COLS, data[r]);
      row.shots = Number(row.shots) || 0;
      row.uploads = Number(row.uploads) || 0;
      row.reports = Number(row.reports) || 0;
      row.blocked = row.blocked === true;
      return { sheet: sh, rowIndex: r + 1, row: row };
    }
  }
  return null;
}

function countActiveGuests_(ev) {
  var data = eventSheet_(ev, 'guests').getDataRange().getValues();
  var n = 0;
  for (var r = 1; r < data.length; r++) if (Number(data[r][4]) > 0) n++;
  return n;
}

function guestLabels_(ev) {
  var data = eventSheet_(ev, 'guests').getDataRange().getValues();
  var out = {};
  for (var r = 1; r < data.length; r++) out[data[r][0]] = String(data[r][2]);
  return out;
}

function refundShot_(ev, guestId) {
  withLock_(function () {
    var g = findGuest_(ev, guestId);
    if (g) g.sheet.getRange(g.rowIndex, 4, 1, 2).setValues([[Math.max(0, g.row.shots - 1), Math.max(0, g.row.uploads - 1)]]);
  });
}

function guestView_(ev, row) {
  return {
    id: row.guestId, label: row.label, shotsUsed: Number(row.shots) || 0,
    shotsLeft: Math.max(0, ev.settings.shotsPerGuest - (Number(row.shots) || 0)), blocked: row.blocked === true
  };
}

// ---------------------------------------------------------------- drive helpers

/** Child folder of the event folder (created on first use), so originals stay uncluttered. */
function subFolder_(ev, name) {
  var cache = CacheService.getScriptCache();
  var key = 'sf:' + ev.id + ':' + name;
  var id = cache.get(key);
  if (id) { try { return DriveApp.getFolderById(id); } catch (x) { /* recreate below */ } }
  var parent = DriveApp.getFolderById(ev.folderId);
  var it = parent.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : parent.createFolder(name);
  cache.put(key, folder.getId(), 21600);
  return folder;
}

/** Set link sharing. Returns false (and logs for the admin) instead of throwing. */
function share_(file, thumb, isPublic, eventId) {
  // Private-storage files are never link-shared; the app serves them.
  if (isPublic && /\.enc$/.test(file.getName())) return true;
  var access = isPublic ? DriveApp.Access.ANYONE_WITH_LINK : DriveApp.Access.PRIVATE;
  var perm = isPublic ? DriveApp.Permission.VIEW : DriveApp.Permission.NONE;
  try {
    file.setSharing(access, perm);
    if (thumb) thumb.setSharing(access, perm);
    return true;
  } catch (x) {
    logProblem_('sharing', eventId || '', 'Google Drive refused to change link sharing (' + (x && x.message ? x.message : x) +
      '). Photos still upload; ask a Workspace admin to allow "Anyone with the link" sharing.');
    return false;
  }
}

// ---------------------------------------------------------------- private storage

var ENC_OVERHEAD = 32; // "PSE1" + 12-byte IV + 16-byte GCM tag

/** Files encrypted by the app start with the ASCII magic "PSE1". */
function isEnc_(b) {
  return b.length > ENC_OVERHEAD && u8_(b[0]) === 0x50 && u8_(b[1]) === 0x53 && u8_(b[2]) === 0x45 && u8_(b[3]) === 0x31;
}

function eventKey_(ev) {
  if (!ev.settings.encrypted) return '';
  var k = PropertiesService.getScriptProperties().getProperty('EK:' + ev.id);
  if (!k) throw err_('server_error', 'This private event’s key is missing. Restore it from your key backup.');
  return k;
}

/** Owner-only backup of every private event's key (keep it somewhere safe and offline). */
function aAdminExportKeys(req) {
  requireOwner_(authAdmin_(req));
  var all = PropertiesService.getScriptProperties().getProperties();
  var keys = {};
  Object.keys(all).forEach(function (k) { if (k.indexOf('EK:') === 0) keys[k.slice(3)] = all[k]; });
  return { keys: keys };
}

/** Owner-only: put back keys from a backup file. Only fills in missing keys for private events. */
function aAdminImportKeys(req) {
  requireOwner_(authAdmin_(req));
  var keys = req.keys && typeof req.keys === 'object' ? req.keys : {};
  var props = PropertiesService.getScriptProperties();
  var restored = 0, skipped = 0;
  Object.keys(keys).slice(0, 2000).forEach(function (id) {
    var k = String(keys[id]);
    if (!/^[A-Za-z0-9]{6,20}$/.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(k)) { skipped++; return; }
    var row = findEventRow_(id);
    var settings = row ? parseJson_(row.row[6]) : null;
    if (!settings || settings.encrypted !== true || props.getProperty('EK:' + id)) { skipped++; return; }
    props.setProperty('EK:' + id, k);
    restored++;
  });
  return { restored: restored, skipped: skipped };
}

// ---------------------------------------------------------------- problem log (shown on admin page)

function logProblem_(where, eventId, message) {
  try {
    var props = PropertiesService.getScriptProperties();
    var list = parseJson_(props.getProperty('PROBLEMS') || '[]');
    if (!Array.isArray(list)) list = [];
    list.push({ t: Date.now(), w: String(where).slice(0, 30), e: String(eventId || '').slice(0, 20), m: String(message).slice(0, 300) });
    while (JSON.stringify(list).length > 8000) list.shift();
    props.setProperty('PROBLEMS', JSON.stringify(list));
  } catch (x) { /* never let logging break a request */ }
}

function aAdminProblems(req) {
  authAdmin_(req);
  var list = parseJson_(PropertiesService.getScriptProperties().getProperty('PROBLEMS') || '[]');
  return { problems: Array.isArray(list) ? list.slice().reverse() : [] };
}

function aAdminClearProblems(req) {
  requireOwner_(authAdmin_(req));
  PropertiesService.getScriptProperties().deleteProperty('PROBLEMS');
  return {};
}

// ---------------------------------------------------------------- versioning / caching

function getVersion_(id) {
  var cache = CacheService.getScriptCache();
  var v = cache.get('v:' + id);
  if (!v) {
    v = randomId_(8);
    cache.put('v:' + id, v, 21600);
  }
  return v;
}

function bumpVersion_(id) {
  CacheService.getScriptCache().put('v:' + id, randomId_(8), 21600);
}

// ---------------------------------------------------------------- rate limiting

function rateOk_(bucket, limit, windowSec, peekOnly) {
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + bucket + ':' + Math.floor(Date.now() / 1000 / windowSec);
  var n = Number(cache.get(key)) || 0;
  if (n >= limit) return false;
  if (!peekOnly) cache.put(key, String(n + 1), windowSec + 5);
  return true;
}

function rateHit_(bucket, windowSec) {
  var cache = CacheService.getScriptCache();
  var key = 'rl:' + bucket + ':' + Math.floor(Date.now() / 1000 / windowSec);
  cache.put(key, String((Number(cache.get(key)) || 0) + 1), windowSec + 5);
}

// ---------------------------------------------------------------- bytes / crypto

function decodeB64_(s) {
  if (typeof s !== 'string' || !s.length) throw err_('bad_request', 'Missing file data');
  s = s.replace(/^data:[^,]*,/, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(s)) throw err_('bad_request', 'Invalid file data');
  try {
    return s.indexOf('-') >= 0 || s.indexOf('_') >= 0 ? Utilities.base64DecodeWebSafe(s) : Utilities.base64Decode(s);
  } catch (x) {
    throw err_('bad_request', 'Invalid file data');
  }
}

function u8_(b) { return b < 0 ? b + 256 : b; }

/** Identify content by magic bytes. Only formats PhotoShare accepts are recognised. */
function sniffMime_(bytes) {
  if (bytes.length < 12) return '';
  var b = [];
  for (var i = 0; i < 12; i++) b.push(u8_(bytes[i]));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) {
    var brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
    if (/^(isom|iso2|iso5|iso6|mp41|mp42|avc1|M4V |qt  |3gp4|3gp5|dash)$/.test(brand)) return 'video/mp4';
  }
  return '';
}

/**
 * Removes APP1..APP15 and COM segments (EXIF, GPS, XMP, comments) from a JPEG.
 * Keeps APP0 (JFIF) and everything from SOS onward. Returns the original on parse errors.
 */
function stripJpegMeta_(bytes) {
  // Works on the signed byte arrays Apps Script uses; copies whole segments with slice().
  var slice = Array.prototype.slice;
  var parts = [slice.call(bytes, 0, 2)];
  var i = 2, n = bytes.length;
  while (i + 4 <= n) {
    if (u8_(bytes[i]) !== 0xff) return bytes;
    var marker = u8_(bytes[i + 1]);
    if (marker === 0xd9) break;
    if (marker === 0xda) { // start of scan: keep the rest verbatim
      parts.push(slice.call(bytes, i));
      return Array.prototype.concat.apply([], parts);
    }
    if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) { parts.push(slice.call(bytes, i, i + 2)); i += 2; continue; }
    var len = (u8_(bytes[i + 2]) << 8) | u8_(bytes[i + 3]);
    if (len < 2 || i + 2 + len > n) return bytes;
    var drop = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!drop) parts.push(slice.call(bytes, i, i + 2 + len));
    i += 2 + len;
  }
  return bytes;
}

function toSigned_(arr) {
  var out = new Array(arr.length);
  for (var i = 0; i < arr.length; i++) out[i] = arr[i] > 127 ? arr[i] - 256 : arr[i];
  return out;
}

function sha256Hex_(input) {
  var d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, input);
  var s = '';
  for (var i = 0; i < d.length; i++) s += ('0' + u8_(d[i]).toString(16)).slice(-2);
  return s;
}

function randomBytes_(n) {
  var hex = '';
  while (hex.length < n * 2) hex += Utilities.getUuid().replace(/-/g, '') + sha256Hex_(Utilities.getUuid() + Date.now());
  var out = [];
  for (var i = 0; i < n; i++) out.push(parseInt(hex.substr(i * 2, 2), 16));
  return out;
}

function randomKey_(n) {
  return Utilities.base64EncodeWebSafe(toSigned_(randomBytes_(n))).replace(/=+$/, '');
}

function randomId_(len) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  var bytes = randomBytes_(len * 2);
  var s = '';
  for (var i = 0; s.length < len && i < bytes.length; i++) {
    if (bytes[i] < 228) s += alphabet[bytes[i] % alphabet.length]; // 228 = 57*4 → unbiased
  }
  while (s.length < len) s += alphabet[randomBytes_(1)[0] % alphabet.length];
  return s;
}

function safeEq_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ---------------------------------------------------------------- misc

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw err_('busy', 'Server busy, retrying.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function prop_(k) {
  var v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v) throw err_('not_configured', 'Backend not set up. Run setup() in Apps Script.');
  return v;
}

function cleanText_(v, max) {
  if (v == null) return '';
  // strip control chars and angle brackets, collapse whitespace, and remove leading
  // = + - @ so text can never be interpreted as a Sheets formula (formula injection).
  // The UI also renders every user string as plain text.
  return String(v).replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim()
    .replace(/^[=+\-@\s]+/, '').slice(0, max);
}

/** Text for a sheet cell: a leading apostrophe stops Sheets reading "3/4" as a date or "007" as 7. */
function txt_(v) {
  v = String(v == null ? '' : v);
  return /^[0-9.,:\/\s]|^(true|false)$/i.test(v) ? "'" + v : v;
}

function str_(v, max) { return v == null ? '' : String(v).slice(0, max); }

function int_(v, min, max, dflt) {
  var n = parseInt(v, 10);
  if (isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

function parseJson_(s) { try { return JSON.parse(s) || {}; } catch (x) { return {}; } }

function err_(code, message) {
  var e = new Error(message);
  e.code = code;
  return e;
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
