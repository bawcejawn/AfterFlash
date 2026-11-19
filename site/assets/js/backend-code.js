// The backend source, served by this website (copied from backend/Code.gs when the site is
// published), so friends can set up or update their own Rememberoll without visiting GitHub.
import { toast } from './util.js';

export const CODE_URL = 'backend/Code.gs.txt';

export async function copyBackendCode(btn) {
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Copying…'; }
  try {
    const res = await fetch(CODE_URL, { cache: 'no-store', credentials: 'omit' });
    const text = await res.text();
    if (!res.ok || !/var APP_VERSION = '/.test(text)) throw new Error('bad');
    await navigator.clipboard.writeText(text);
    toast('Code copied. Paste it into Apps Script.', 'ok');
    if (btn) btn.textContent = 'Copied ✓';
    return true;
  } catch {
    toast('Couldn’t copy automatically. Opening the code: select all and copy it.', 'error');
    window.open(CODE_URL, '_blank', 'noopener');
    if (btn) btn.textContent = label;
    return false;
  } finally {
    if (btn) setTimeout(() => { btn.disabled = false; if (btn.textContent === 'Copied ✓') btn.textContent = label; }, 4000);
  }
}

/** Parse a pasted web app URL into its deployment id (personal Google accounts). */
export function deploymentFromUrl(raw) {
  const s = String(raw || '').trim().replace(/\/macros\/u\/\d+\/s\//, '/macros/s/');
  const m = /^https:\/\/script\.google\.com\/macros\/s\/(AKfy[A-Za-z0-9_-]{20,140})\/(exec|dev)\/?$/.exec(s);
  if (m) return { id: m[1], dev: m[2] === 'dev' };
  if (/^https:\/\/script\.google\.com\/a\/macros\//.test(s)) return { error: 'workspace' };
  return { error: 'format' };
}
