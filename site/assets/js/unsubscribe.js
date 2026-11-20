// One-click stop for emails about one event (the link at the bottom of every email).
import { $, h, clear, params, studioFrom, isEventId, frameGuard } from './util.js';
import { api } from './api.js';

frameGuard();
const root = $('#app');
const { q } = params();
const show = (title, msg) => clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, title), h('p', null, msg)));
(async () => {
  let studio;
  try { studio = studioFrom(q); } catch { return show('This link isn’t complete', 'Use the stop link from the bottom of the email.'); }
  const e = q.get('e'), t = q.get('t') || '';
  if (!isEventId(e) || !/^[A-Za-z0-9]{24}$/.test(t)) return show('This link isn’t complete', 'Use the stop link from the bottom of the email.');
  try {
    const r = await api(studio, 'unsubscribe', { e, t });
    show('You won’t get more emails about this event', `We’ve stopped emails about ${r.name || 'this event'} to your address. You can still open the invitation or album links any time.`);
  } catch (x) {
    show('Couldn’t update your email settings', x.code === 'not_found' ? 'This link isn’t valid any more. If emails keep coming, reply to one and ask the host.' : x.message);
  }
})();
