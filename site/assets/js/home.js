import { $, frameGuard, isEventId } from './util.js';

frameGuard();
const form = $('#join');
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const raw = $('#code').value.trim();
  // Accept a bare code or a pasted link.
  let code = raw;
  try { const u = new URL(raw); code = u.searchParams.get('e') || ''; } catch { /* not a URL */ }
  if (!isEventId(code)) { $('#join-msg').textContent = 'That doesn’t look like an event code. It’s 10 letters and numbers on the sign.'; return; }
  location.href = 'cam.html?e=' + encodeURIComponent(code);
});
