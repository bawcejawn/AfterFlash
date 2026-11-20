// Printable table cards: a PDF with 2 or 4 cards per page, each with a big QR code to the camera.
// Made entirely in the browser (canvas → JPEG pages → a tiny PDF), so it works on self-host too.
import { h, qrMatrix, toast } from './util.js';

const DPI = 150;
const PAGE = { letter: [8.5, 11], a4: [8.27, 11.69] };

/** The dialog content: options and a Download PDF button. */
export function tableCardsPanel({ ev, eventId, guestUrl, logo }) {
  const count = h('input', { type: 'number', name: 'cards', min: 1, max: 80, value: 10 });
  const numbers = h('input', { type: 'checkbox', name: 'numbers', checked: true });
  const names = h('textarea', { name: 'names', rows: 3, maxlength: 2000, placeholder: 'Optional: one table name per line (Head table, Table 2, Family…)' });
  const showName = h('input', { type: 'checkbox', name: 'showName', checked: true });
  const showCode = h('input', { type: 'checkbox', name: 'showCode', checked: true });
  const layout = h('select', { name: 'layout' }, h('option', { value: '4' }, '4 per page (small, tabletop)'), h('option', { value: '2' }, '2 per page (large)'));
  const paper = h('select', { name: 'paper' }, h('option', { value: 'letter' }, 'Letter (US)'), h('option', { value: 'a4' }, 'A4'));
  const btn = h('button', { class: 'btn primary', type: 'button' }, 'Download PDF');
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = 'Making your PDF…';
    try {
      const list = names.value.split('\n').map((x) => x.trim().slice(0, 40)).filter(Boolean);
      const n = list.length || Math.min(80, Math.max(1, Math.floor(Number(count.value) || 1)));
      const labels = Array.from({ length: n }, (_, i) => list[i] || (numbers.checked ? `Table ${i + 1}` : ''));
      const pdf = await makeCardsPdf({ ev, eventId, url: guestUrl, labels, perPage: Number(layout.value), paper: paper.value,
        showName: showName.checked, showCode: showCode.checked, logo: logo && await logo().catch(() => null) });
      const safe = (ev.name || 'event').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 50) || 'event';
      const a = h('a', { href: URL.createObjectURL(pdf), download: `Table-cards-${safe}.pdf` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { toast('Couldn’t make the PDF: ' + e.message, 'error'); }
    btn.disabled = false; btn.textContent = 'Download PDF';
  };
  return h('details', { class: 'panel stack table-cards' },
    h('summary', null, h('b', null, 'Table cards'), h('span', { class: 'small muted' }, ' A ready-to-print PDF with the QR code for every table')),
    h('div', { class: 'grid-form' },
      h('label', { class: 'field' }, h('span', null, 'How many cards'), count),
      h('label', { class: 'field' }, h('span', null, 'Layout'), layout),
      h('label', { class: 'field' }, h('span', null, 'Paper'), paper)),
    h('label', { class: 'field' }, h('span', null, 'Table names'), names),
    h('label', { class: 'check' }, numbers, h('span', null, 'Number the tables (Table 1, Table 2…) when no names are given')),
    h('label', { class: 'check' }, showName, h('span', null, 'Show the event name and date')),
    h('label', { class: 'check' }, showCode, h('span', null, 'Show the event code under the QR (for people who can’t scan)')),
    h('div', { class: 'row' }, btn, h('span', { class: 'small muted' }, 'Prints well in black and white too.')));
}

function fmtDay(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) return '';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function fitText(ctx, text, font, size, maxW) {
  let s = size;
  do { ctx.font = font.replace('{s}', s); s -= 2; } while (ctx.measureText(text).width > maxW && s > 10);
}

function drawCard(ctx, x, y, w, hgt, o) {
  const pad = w * 0.07;
  const accent = /^#[0-9a-f]{6}$/i.test(o.ev.accent || '') ? o.ev.accent : '#2c45c9';
  ctx.save();
  // cut line
  ctx.strokeStyle = '#c8c8c8'; ctx.setLineDash([10, 10]); ctx.lineWidth = 2; ctx.strokeRect(x, y, w, hgt); ctx.setLineDash([]);
  // top band in the event colour
  const band = hgt * 0.06;
  ctx.fillStyle = accent; ctx.fillRect(x + pad, y + pad, w - pad * 2, band * 0.35);
  let cy = y + pad + band;
  ctx.textAlign = 'center'; ctx.fillStyle = '#111';
  const cx = x + w / 2, maxW = w - pad * 2;
  if (o.logo) {
    const lh = hgt * 0.11, lw = Math.min(maxW, lh * (o.logo.width / o.logo.height));
    ctx.drawImage(o.logo, cx - lw / 2, cy, lw, lh); cy += lh + hgt * 0.02;
  }
  if (o.showName) {
    const fs = Math.round(hgt * 0.075);
    fitText(ctx, o.ev.name || '', `600 {s}px ${o.display}`, fs, maxW);
    ctx.textBaseline = 'top'; ctx.fillText(o.ev.name || '', cx, cy); cy += fs * 1.15;
    const day = fmtDay(o.ev.date);
    if (day) { ctx.font = `500 ${Math.round(hgt * 0.035)}px ${o.body}`; ctx.fillStyle = '#444'; ctx.fillText(day, cx, cy); cy += hgt * 0.05; ctx.fillStyle = '#111'; }
  }
  // QR: as big as fits, black on white
  const bottomText = hgt * (0.11 + (o.showCode ? 0.05 : 0) + (o.label ? 0.085 : 0));
  const qs = Math.min(maxW * 0.85, y + hgt - pad - bottomText - cy - hgt * 0.02);
  const n = o.qr.length + 4, cell = qs / n, qx = cx - qs / 2, qy = cy + hgt * 0.01;
  ctx.fillStyle = '#fff'; ctx.fillRect(qx, qy, qs, qs); ctx.fillStyle = '#000';
  o.qr.forEach((row, r) => row.forEach((on, c) => { if (on) ctx.fillRect(Math.floor(qx + (c + 2) * cell), Math.floor(qy + (r + 2) * cell), Math.ceil(cell), Math.ceil(cell)); }));
  cy = qy + qs + hgt * 0.03;
  ctx.textBaseline = 'top'; ctx.fillStyle = '#111';
  ctx.font = `700 ${Math.round(hgt * 0.05)}px ${o.body}`; fitText(ctx, 'Scan to add your photos', `700 {s}px ${o.body}`, Math.round(hgt * 0.05), maxW);
  ctx.fillText('Scan to add your photos', cx, cy); cy += hgt * 0.065;
  if (o.showCode) { ctx.font = `500 ${Math.round(hgt * 0.032)}px ${o.body}`; ctx.fillStyle = '#444'; ctx.fillText(`No camera app? Event code: ${o.eventId}`, cx, cy); cy += hgt * 0.05; }
  if (o.label) { ctx.fillStyle = accent; ctx.font = `800 ${Math.round(hgt * 0.07)}px ${o.body}`; fitText(ctx, o.label, `800 {s}px ${o.body}`, Math.round(hgt * 0.07), maxW); ctx.fillText(o.label, cx, cy); }
  ctx.restore();
}

/** Build the PDF as a Blob. */
export async function makeCardsPdf({ ev, eventId, url, labels, perPage, paper, showName, showCode, logo }) {
  await document.fonts.ready.catch(() => {});
  const [pw, ph] = PAGE[paper] || PAGE.letter;
  const W = Math.round(pw * DPI), H = Math.round(ph * DPI);
  const css = getComputedStyle(document.documentElement);
  const display = css.getPropertyValue('--display').trim() || 'Georgia, serif';
  const body = getComputedStyle(document.body).fontFamily || 'sans-serif';
  const qr = qrMatrix(url);
  const cells = perPage === 2 ? [[0, 0, W, H / 2], [0, H / 2, W, H / 2]] : [[0, 0, W / 2, H / 2], [W / 2, 0, W / 2, H / 2], [0, H / 2, W / 2, H / 2], [W / 2, H / 2, W / 2, H / 2]];
  const pages = [];
  for (let i = 0; i < labels.length; i += perPage) {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    labels.slice(i, i + perPage).forEach((label, j) => {
      const [x, y, w, hh] = cells[j];
      const m = DPI * 0.25; // keep away from the printer's edge
      drawCard(ctx, x + m, y + m, w - m * 2, hh - m * 2, { ev, eventId, qr, label, showName, showCode, logo, display, body });
    });
    const blob = await new Promise((res) => cv.toBlob(res, 'image/jpeg', 0.92));
    pages.push(new Uint8Array(await blob.arrayBuffer()));
  }
  return jpegPagesToPdf(pages, W, H, pw * 72, ph * 72);
}

/** A minimal PDF: one full-page JPEG image per page. */
export function jpegPagesToPdf(pages, imgW, imgH, ptW, ptH) {
  const enc = new TextEncoder();
  const parts = []; const offsets = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  pages.forEach((jpg, i) => {
    const p = 3 + i * 3;
    const draw = enc.encode(`q ${ptW.toFixed(2)} 0 0 ${ptH.toFixed(2)} 0 0 cm /Im0 Do Q`);
    obj(p, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW.toFixed(2)} ${ptH.toFixed(2)}] /Resources << /XObject << /Im0 ${p + 2} 0 R >> >> /Contents ${p + 1} 0 R >>`);
    obj(p + 1, `<< /Length ${draw.length} >>`, draw);
    obj(p + 2, `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>`, jpg);
  });
  const total = 3 + pages.length * 3;
  const xref = len;
  push(`xref\n0 ${total}\n0000000000 65535 f \n`);
  for (let n = 1; n < total; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}
