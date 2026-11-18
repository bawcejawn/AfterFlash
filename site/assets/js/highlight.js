// Highlight video: a short film made in the browser from the event's best photos, guestbook
// notes and (optionally) voice messages and music. Nothing is uploaded anywhere; the host
// downloads or shares the finished file. Works for private-storage events too (frames are
// decrypted on this device).

const FORMATS = { wide: [1280, 720], tall: [720, 1280] };

/** Pick photos: all favorites, then evenly spread sharp photos across the night, in time order. */
export function pickPhotos(items, max) {
  const usable = items.filter((x) => x.s === 'visible' && x.k !== 'v');
  const favs = usable.filter((x) => x.fv);
  const rest = usable.filter((x) => !x.fv && !/blurry/.test(x.f || ''));
  const chosen = favs.slice(0, max);
  const room = max - chosen.length;
  if (room > 0 && rest.length) {
    const sorted = rest.slice().sort((a, b) => a.c - b.c);
    const step = sorted.length / Math.min(room, sorted.length);
    for (let i = 0; i < Math.min(room, sorted.length); i++) chosen.push(sorted[Math.floor(i * step)]);
  }
  return chosen.sort((a, b) => a.c - b.c);
}

function pickMime() {
  const opts = ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

export const highlightSupported = () => !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream && pickMime());

/** Small blurred copy used as the backdrop behind photos that don't fill the frame. */
function backdrop(bmp) {
  // shrink hard, then enlarge in two smooth steps: a soft, blurred version of the photo
  const tiny = document.createElement('canvas');
  tiny.width = 12; tiny.height = Math.max(1, Math.round(12 * bmp.height / bmp.width));
  tiny.getContext('2d').drawImage(bmp, 0, 0, tiny.width, tiny.height);
  const c = document.createElement('canvas');
  c.width = 120; c.height = Math.max(1, Math.round(120 * bmp.height / bmp.width));
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(tiny, 0, 0, c.width, c.height);
  return c;
}

function wrapText(ctx, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Render the film. opts: { photos:[Blob], notes:[{text,g}], voices:[Blob], music:File|null,
 *  title, subtitle, closing, logo:Blob|null, accent, font, format:'wide'|'tall', perPhoto:seconds,
 *  onProgress(fraction, label) } → Promise<Blob>
 */
export async function renderHighlight(opts) {
  const [W, H] = FORMATS[opts.format] || FORMATS.wide;
  const per = Math.max(1.5, Math.min(6, opts.perPhoto || 3));
  const fade = Math.min(0.8, per / 4);
  const progress = opts.onProgress || (() => {});
  const display = opts.font === 'script' ? '"Great Vibes", "Cormorant", cursive' : opts.font === 'elegant' ? '"Cormorant", Georgia, serif' : '"Bricolage", system-ui, sans-serif';
  const body = '"Atkinson", system-ui, sans-serif';
  const noteFont = opts.font === 'modern' || !opts.font ? display : '"Cormorant", Georgia, serif'; // script is too hard to read at length
  try { await Promise.all([document.fonts.load(`64px ${display}`), document.fonts.load(`32px ${body}`), document.fonts.load('600 32px "Cormorant"')]); } catch { /* fallback fonts */ }

  progress(0, 'Loading photos…');
  const frames = [];
  for (let i = 0; i < opts.photos.length; i++) {
    try { const bmp = await createImageBitmap(opts.photos[i]); frames.push({ bmp, bg: backdrop(bmp) }); } catch { /* skip unreadable */ }
    progress(0.15 * (i + 1) / opts.photos.length, 'Loading photos…');
  }
  if (!frames.length) throw new Error('No photos to use yet.');
  const logo = opts.logo ? await createImageBitmap(opts.logo).catch(() => null) : null;

  // ---- timeline: title, photos (a guestbook note after every 5th photo), closing card
  const timeline = [{ kind: 'title', dur: 3.2 }];
  const notes = (opts.notes || []).filter((n) => n.text).slice(0, Math.floor(frames.length / 5) + 1);
  let ni = 0;
  frames.forEach((f, i) => {
    timeline.push({ kind: 'photo', f, dur: per, seed: i });
    const noteHere = frames.length < 5 ? i === Math.floor((frames.length - 1) / 2) : (i + 1) % 5 === 0;
    if (noteHere && ni < notes.length) timeline.push({ kind: 'note', n: notes[ni++], dur: 4 });
  });
  timeline.push({ kind: 'end', dur: 3.5 });
  let t0 = 0;
  for (const s of timeline) { s.start = t0; t0 += s.dur; }
  const total = t0;

  // ---- audio: music (looped, softer under voices) and voice messages one after another
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  let actx = null;
  const sources = [];
  if (opts.music || (opts.voices && opts.voices.length)) {
    actx = new AudioContext();
    const dest = actx.createMediaStreamDestination();
    const musicGain = actx.createGain();
    musicGain.connect(dest);
    let voiceAt = 3.5;
    const voiceSlots = [];
    for (const v of opts.voices || []) {
      try {
        const buf = await actx.decodeAudioData(await v.arrayBuffer());
        if (voiceAt + buf.duration > total - 1) break;
        voiceSlots.push({ buf, at: voiceAt });
        voiceAt += buf.duration + 1.5;
      } catch { /* skip */ }
    }
    if (opts.music) {
      try {
        const buf = await actx.decodeAudioData(await opts.music.arrayBuffer());
        const src = actx.createBufferSource();
        src.buffer = buf; src.loop = true; src.connect(musicGain);
        sources.push({ src, at: 0, music: true });
      } catch { throw new Error('That music file couldn’t be read. Try an MP3 or M4A.'); }
    }
    for (const v of voiceSlots) {
      const src = actx.createBufferSource();
      src.buffer = v.buf; src.connect(dest);
      sources.push({ src, at: v.at, dur: v.buf.duration });
    }
    // duck the music while someone is speaking, fade it out at the end
    const base = 0.7;
    musicGain.gain.value = base;
    actx._schedule = (startTime) => {
      const g = musicGain.gain;
      g.setValueAtTime(base, startTime);
      for (const s of sources) if (!s.music) { g.setTargetAtTime(0.18, startTime + s.at - 0.3, 0.15); g.setTargetAtTime(base, startTime + s.at + s.dur, 0.4); }
      g.setTargetAtTime(0, startTime + total - 2, 0.6);
    };
    for (const tr of dest.stream.getAudioTracks()) stream.addTrack(tr);
    await actx.suspend();
  }

  const mime = pickMime();
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.format === 'tall' ? 3_000_000 : 3_500_000, audioBitsPerSecond: 128_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopped = new Promise((res) => { rec.onstop = res; });

  // ---- drawing
  const unit = Math.min(W, H);
  const accent = /^#[0-9a-f]{6}$/i.test(opts.accent || '') ? opts.accent : '#f2c230';
  const drawPhoto = (f, p, seed, alpha) => {
    const { bmp, bg } = f;
    ctx.globalAlpha = alpha;
    // blurred backdrop
    const bs = Math.max(W / bg.width, H / bg.height);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bg, (W - bg.width * bs) / 2, (H - bg.height * bs) / 2, bg.width * bs, bg.height * bs);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(0, 0, W, H);
    // the photo, gently zooming and drifting (Ken Burns)
    const fit = Math.min(W / bmp.width, H / bmp.height);
    const cover = Math.max(W / bmp.width, H / bmp.height);
    const baseScale = cover / fit < 1.35 ? cover : fit; // fill the frame unless that would crop a lot
    const z = baseScale * (1 + 0.07 * p);
    const dir = seed % 4;
    const dx = (dir === 0 ? -1 : dir === 1 ? 1 : 0) * 0.02 * W * p;
    const dy = (dir === 2 ? -1 : dir === 3 ? 1 : 0) * 0.02 * H * p;
    const w = bmp.width * z, h = bmp.height * z;
    ctx.drawImage(bmp, (W - w) / 2 + dx, (H - h) / 2 + dy, w, h);
    ctx.globalAlpha = 1;
  };
  const card = (lines, alpha) => {
    ctx.globalAlpha = alpha;
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#11151f'); g.addColorStop(1, '#232b3b');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    let y = H / 2 - (lines.reduce((a, l) => a + l.size * 1.25, 0)) / 2;
    if (logo && lines.logo) {
      const k = Math.min((W * 0.4) / logo.width, (H * 0.18) / logo.height);
      const lw = logo.width * k, lh = logo.height * k;
      ctx.drawImage(logo, (W - lw) / 2, y - lh - unit * 0.04, lw, lh);
    }
    for (const l of lines) {
      ctx.font = `${l.weight || 400} ${l.size}px ${l.family}`;
      ctx.fillStyle = l.color || '#fff';
      for (const part of wrapText(ctx, l.text, W * 0.82)) { y += l.size * 0.625; ctx.fillText(part, W / 2, y); y += l.size * 0.625; }
    }
    ctx.fillStyle = accent; ctx.fillRect(W / 2 - unit * 0.08, y + unit * 0.04, unit * 0.16, Math.max(3, unit * 0.005));
    ctx.globalAlpha = 1;
  };
  const titleLines = Object.assign([
    { text: opts.title || '', size: unit * (opts.font === 'script' ? 0.13 : 0.1), family: display, weight: 700 },
    ...(opts.subtitle ? [{ text: opts.subtitle, size: unit * 0.04, family: body, color: '#c9d1dc' }] : []),
  ], { logo: true });
  const endLines = Object.assign([
    { text: opts.closing || 'Thank you for celebrating with us', size: unit * (opts.font === 'script' ? 0.08 : 0.065), family: display, weight: 700 },
    ...(opts.title ? [{ text: opts.title, size: unit * 0.038, family: body, color: '#c9d1dc' }] : []),
  ], { logo: true });

  const drawAt = (t) => {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const idx = timeline.findIndex((s) => t >= s.start && t < s.start + s.dur);
    const i = idx < 0 ? timeline.length - 1 : idx;
    const draw = (s, alpha) => {
      const p = Math.min(1, Math.max(0, (t - s.start) / s.dur));
      if (s.kind === 'photo') drawPhoto(s.f, p, s.seed, alpha);
      else if (s.kind === 'title') card(titleLines, alpha);
      else if (s.kind === 'end') card(endLines, alpha);
      else if (s.kind === 'note') card([{ text: `“${s.n.text}”`, size: unit * 0.06, family: noteFont, weight: 600 }, { text: `– ${s.n.g || 'A guest'}`, size: unit * 0.035, family: body, color: '#c9d1dc' }], alpha);
    };
    const s = timeline[i];
    draw(s, 1);
    const next = timeline[i + 1];
    if (next && t > s.start + s.dur - fade) draw(next, (t - (s.start + s.dur - fade)) / fade); // cross-fade
    if (t > total - 1) { ctx.fillStyle = `rgba(0,0,0,${Math.min(1, t - (total - 1))})`; ctx.fillRect(0, 0, W, H); }
  };

  // ---- record in real time (the tab must stay visible; we pause while it's hidden)
  drawAt(0);
  progress(0.15, 'Recording your film… keep this tab open');
  rec.start(1000);
  let start = performance.now(), pausedAt = 0;
  if (actx) {
    await actx.resume();
    const at = actx.currentTime + 0.05;
    for (const s of sources) s.src.start(at + s.at);
    actx._schedule(at);
  }
  const onVis = () => {
    if (document.hidden && rec.state === 'recording') { rec.pause(); pausedAt = performance.now(); if (actx) actx.suspend(); }
    else if (!document.hidden && rec.state === 'paused') { start += performance.now() - pausedAt; rec.resume(); if (actx) actx.resume(); }
  };
  document.addEventListener('visibilitychange', onVis);
  await new Promise((resolve) => {
    const tick = () => {
      if (rec.state === 'paused') { requestAnimationFrame(tick); return; }
      const t = (performance.now() - start) / 1000;
      drawAt(Math.min(t, total));
      progress(0.15 + 0.85 * Math.min(1, t / total), 'Recording your film… keep this tab open');
      if (t >= total) resolve(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  document.removeEventListener('visibilitychange', onVis);
  rec.stop();
  await stopped;
  for (const s of sources) { try { s.src.stop(); } catch { /* already stopped */ } }
  if (actx) actx.close();
  for (const f of frames) f.bmp.close && f.bmp.close();
  stream.getTracks().forEach((tr) => tr.stop());
  return new Blob(chunks, { type: mime.split(';')[0] });
}
