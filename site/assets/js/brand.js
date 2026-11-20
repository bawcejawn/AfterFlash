// Event branding: accent colour, heading font, tagline and logo, applied on every guest page.
import { h, setAccent, store, base64ToBytes, link, inStoreApp } from './util.js';
import { api } from './api.js';

export const FONTS = { modern: 'Modern', elegant: 'Elegant serif', script: 'Script' };

export function applyBrand(ev) {
  if (!ev) return;
  setAccent(ev.accent);
  document.documentElement.dataset.font = FONTS[ev.font] ? ev.font : 'modern';
}

/** "Planned by Bright Day Events" for planners' events (Cloud). Only https links. */
export function plannerCredit(ev) {
  const p = ev && ev.planner;
  if (!p || !p.name) return null;
  return h('p', { class: 'planner-credit small muted' }, 'Planned by ',
    /^https:\/\//i.test(p.url || '') ? h('a', { href: p.url, target: '_blank', rel: 'noopener noreferrer' }, p.name) : h('b', null, p.name));
}

/** Small "Made with Rememberoll" line under albums and invitations, linking to the home page. */
export function madeWith() {
  return h('p', { class: 'made-with small muted' }, 'Made with ', h('a', { href: link('index.html') }, 'Rememberoll'));
}

/** After the event, guests see one soft offer to host their own (Cloud only, never in the Play app). */
export function guestOffer(studio, ev) {
  const box = h('aside', { class: 'guest-offer', hidden: true });
  const today = new Date().toISOString().slice(0, 10);
  const over = (ev.date && today > ev.date) || (ev.closesAt && Date.now() > Date.parse(ev.closesAt));
  if (!over || inStoreApp()) return box;
  api(studio, 'offer', {}, { retries: 0 }).then((r) => {
    const o = r && r.offer;
    if (!o || !/^[A-Z0-9-]{3,30}$/i.test(o.code)) return;
    box.append(h('b', null, 'Planning your own event?'), h('span', null, ` Get ${Number(o.discount) || 0}% off your first Rememberoll plan.`),
      h('a', { class: 'btn small', href: link('index.html', { extra: { ref: o.code } }) }, 'See plans'));
    box.hidden = false;
  }).catch(() => {});
  return box;
}

/** Only real PNG/JPEG/WebP bytes become a logo (never SVG or anything else). */
export function logoBytesOk(mime, d) {
  if (!d || d.length < 12) return false;
  if (mime === 'image/png') return d[0] === 0x89 && d[1] === 0x50 && d[2] === 0x4e && d[3] === 0x47;
  if (mime === 'image/jpeg') return d[0] === 0xff && d[1] === 0xd8 && d[2] === 0xff;
  if (mime === 'image/webp') return d[0] === 0x52 && d[1] === 0x49 && d[2] === 0x46 && d[3] === 0x46 && d[8] === 0x57 && d[9] === 0x45 && d[10] === 0x42 && d[11] === 0x50;
  return false;
}

const blobs = new Map();
/** The event's logo as a Blob, or null (cached per page and per browser session). */
export function logoBlob(studio, eventId, ev) {
  if (!ev || !ev.logoV) return Promise.resolve(null);
  const ck = `${studio}:${eventId}:${ev.logoV}`;
  if (!blobs.has(ck)) {
    blobs.set(ck, (async () => {
      let r = store.get('ps:logo:' + ck, sessionStorage);
      if (!r || !r.data) {
        r = await api(studio, 'logo', { e: eventId }, { retries: 1 });
        store.set('ps:logo:' + ck, { mime: r.mime, data: r.data }, sessionStorage);
      }
      const bytes = base64ToBytes(r.data);
      if (!logoBytesOk(r.mime, bytes)) return null;
      return new Blob([bytes], { type: r.mime });
    })().catch(() => null));
  }
  return blobs.get(ck);
}
const urls = new Map();
/** blob: URL for the event's logo, or ''. */
export function logoUrl(studio, eventId, ev) {
  const ck = `${studio}:${eventId}:${ev && ev.logoV}`;
  if (!urls.has(ck)) urls.set(ck, logoBlob(studio, eventId, ev).then((b) => (b ? URL.createObjectURL(b) : '')));
  return urls.get(ck);
}

/** The logo as a decoded image for drawing on a canvas, or null. */
export async function logoImage(studio, eventId, ev) {
  const u = await logoUrl(studio, eventId, ev);
  if (!u) return null;
  const img = new Image(); img.src = u;
  await img.decode();
  return img;
}

/** An <img> that fills in with the logo when it's loaded (stays hidden if there is none). */
export function logoEl(studio, eventId, ev, cls = 'brand-logo') {
  const img = h('img', { class: cls, alt: '', hidden: true });
  logoUrl(studio, eventId, ev).then((u) => { if (u) { img.src = u; img.hidden = false; } });
  return img;
}

/** Shrink a picked image to a small logo (max 512 px): PNG if it has transparency, else JPEG. */
export async function prepareLogo(file) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP image.');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too big.');
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close && bmp.close();
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let alpha = false;
  for (let i = 3; i < px.length; i += 16) if (px[i] < 250) { alpha = true; break; }
  for (const [type, q] of alpha ? [['image/png'], ['image/webp', 0.9]] : [['image/jpeg', 0.9], ['image/jpeg', 0.75]]) {
    const blob = await new Promise((res) => c.toBlob(res, type, q));
    if (blob && blob.size <= 190 * 1024) return blob;
  }
  throw new Error('Couldn’t make that image small enough. Try a simpler logo.');
}
