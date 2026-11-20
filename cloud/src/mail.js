// Email through Resend (https://resend.com). Turned on by two deploy settings: the RESEND_API_KEY
// secret and the MAIL_FROM variable ("Rememberoll <hello@your-domain.com>"). Without them the
// app works the same and hosts see "email isn't switched on yet".
import { err } from './lib.js';

export const mailReady = (env) => !!(env.RESEND_API_KEY && /<[^<>@\s]+@[^<>@\s]+>$|^[^<>@\s]+@[^<>@\s]+$/.test(String(env.MAIL_FROM || '').trim()));

const EMAIL_RE = /^[^\s@<>()",;:\\[\]]{1,64}@[^\s@<>()",;:\\[\]]+\.[A-Za-z]{2,24}$/;
export function cleanEmail(v) {
  const e = String(v || '').trim().toLowerCase();
  return e.length <= 120 && EMAIL_RE.test(e) ? e : '';
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One simple, readable email. All text is escaped; links are our own https URLs. */
export function render({ app, heading, paras, button, unsub }) {
  const text = [heading, '', ...paras.flatMap((p) => [p, '']), button ? `${button.label}: ${button.url}` : '', '', `Don’t want these emails? ${unsub}`].join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#eef1fb;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1fb;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#2c45c9;color:#ffffff;padding:16px 24px;font-weight:bold;font-size:18px">${esc(app)}</td></tr>
<tr><td style="padding:28px 24px 8px"><h1 style="margin:0 0 16px;font-size:26px;line-height:1.2">${esc(heading)}</h1>
${paras.map((p) => `<p style="margin:0 0 14px;font-size:16px;line-height:1.5">${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n')}
${button ? `<p style="margin:22px 0 26px"><a href="${esc(button.url)}" style="display:inline-block;background:#f2c230;color:#2a2000;text-decoration:none;font-weight:bold;padding:14px 22px;border-radius:999px">${esc(button.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:0 24px 24px;font-size:12px;color:#6b7484">You got this because the host added you to their event. <a href="${esc(unsub)}" style="color:#6b7484">Stop emails about this event</a></td></tr>
</table></td></tr></table></body></html>`;
  return { html, text };
}

/** Send up to 100 emails per request with Resend's batch endpoint. Returns how many were accepted. */
export async function sendBatch(env, messages) {
  if (!mailReady(env)) throw err('not_configured', 'Email isn’t switched on yet.');
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({
      from: String(env.MAIL_FROM).trim(), to: [m.to], subject: m.subject, html: m.html, text: m.text,
      headers: { 'List-Unsubscribe': `<${m.unsub}>` },
    }));
    const res = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      if (sent) break;
      throw err('mail_failed', 'The email service didn’t accept the messages. Try again later.');
    }
    sent += chunk.length;
  }
  return sent;
}
