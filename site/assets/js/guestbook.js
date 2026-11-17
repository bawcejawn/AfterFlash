// Guestbook: write a note and/or record a short voice message; list notes.
import { h, clear, toast, blobToBase64, fmtWhen, videoUrl, isDriveId } from './util.js';
import { api } from './api.js';

const MAX_SEC = 60;

function pickAudioMime() {
  const opts = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];
  return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}

/** Opens a modal composer. Resolves when closed. */
export function openComposer({ studio, eventId, auth, dark = false, onDone }) {
  if (!auth) { toast('Open the camera link first to join the event.'); return; }
  let recorder = null, chunks = [], audioBlob = null, timer = null, stream = null;
  const text = h('textarea', { maxlength: 500, placeholder: 'Your message for the hosts…', 'aria-label': 'Message' });
  const status = h('p', { class: 'small muted', 'aria-live': 'polite' });
  const player = h('audio', { controls: true, hidden: true });
  const recBtn = h('button', { class: 'btn', type: 'button', onclick: toggleRec }, 'Record a voice message');
  const send = h('button', { class: 'btn flash', type: 'submit' }, 'Send');
  const close = () => { stopStream(); clearTimeout(timer); overlay.remove(); if (onDone) onDone(); };
  const form = h('form', { class: 'panel stack' + (dark ? ' dark-panel' : '') },
    h('h2', null, 'Sign the guestbook'),
    text,
    h('div', { class: 'row' }, recBtn, player),
    status,
    h('div', { class: 'row' }, send, h('button', { class: 'btn', type: 'button', onclick: close }, 'Cancel')));
  const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Guestbook' }, form);

  function stopStream() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; }

  async function toggleRec() {
    if (recorder) { recorder.stop(); return; }
    const mime = pickAudioMime();
    if (!mime) { toast('Voice messages aren’t supported in this browser.', 'error'); return; }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { toast('Microphone access is off.', 'error'); return; }
    chunks = [];
    audioBlob = null;
    player.hidden = true;
    recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64000 });
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      clearTimeout(timer);
      stopStream();
      audioBlob = new Blob(chunks, { type: mime.split(';')[0] });
      recorder = null;
      recBtn.textContent = 'Record again';
      player.src = URL.createObjectURL(audioBlob);
      player.hidden = false;
      status.textContent = 'Voice message ready. Play it back, then send.';
    };
    recorder.start(500);
    const started = Date.now();
    const tick = () => {
      const left = MAX_SEC - Math.floor((Date.now() - started) / 1000);
      recBtn.textContent = `Stop recording (${left}s)`;
      if (left <= 0) recorder && recorder.stop(); else timer = setTimeout(tick, 500);
    };
    tick();
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (recorder) recorder.stop();
    if (!text.value.trim() && !audioBlob) { status.textContent = 'Write a message or record one first.'; return; }
    send.disabled = true; send.textContent = 'Sending…';
    try {
      const r = await api(studio, 'guestbookAdd', {
        e: eventId, g: auth.g, t: auth.t, text: text.value.trim(),
        audio: audioBlob ? await blobToBase64(audioBlob) : undefined,
      }, { retries: 2, timeout: 90000 });
      toast(r.status === 'pending' ? 'Thanks! The hosts will see your message.' : 'Thanks! Your message is in the guestbook.', 'ok');
      close();
    } catch (err) {
      status.textContent = err.message;
      send.disabled = false; send.textContent = 'Send';
    }
  });
  document.body.append(overlay);
  text.focus();
}

/** Render notes as cards. Audio plays straight from Drive. */
export function renderNotes(notes) {
  if (!notes.length) return h('p', { class: 'empty' }, 'No messages yet.');
  return h('div', { class: 'notes' }, notes.slice().sort((a, b) => b.c - a.c).map((n) => h('article', { class: 'note' },
    n.text ? h('p', null, n.text) : null,
    n.a && isDriveId(n.a) ? h('audio', { controls: true, preload: 'none', src: videoUrl(n.a) }) : null,
    h('p', { class: 'small muted' }, [n.g, fmtWhen(n.c)].filter(Boolean).join(', ')))));
}

export { clear };
