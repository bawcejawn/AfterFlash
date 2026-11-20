// After paying for prints or a photo book: confirm the payment with the server and say what happens next.
import { $, h, clear, frameGuard, params } from './util.js';
import { api } from './api.js';

frameGuard();
const root = $('#app');
const { q } = params();
const sid = q.get('session_id') || '';
const money = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
const back = () => h('div', { class: 'row' }, h('a', { class: 'btn', href: 'app.html' }, 'Back to my events'));

function show(title, ...body) { clear(root).append(h('div', { class: 'narrow section stack' }, h('h1', null, title), ...body)); }

async function confirm() {
  if (q.get('cancelled')) return show('No order placed', h('p', null, 'You weren’t charged. Go back to your event’s Photos tab to try again.'), back());
  if (!sid) return show('Order not found', h('p', null, 'This link is missing its order number.'), back());
  show('Checking your order…');
  try {
    const r = await api('main', 'orderDone', { session_id: sid }, { retries: 2 });
    history.replaceState(null, '', location.pathname);
    const what = r.kind === 'book' ? `a photo book with ${r.n} photos` : `${r.n * r.copies} prints`;
    show('Thank you! Your order is in',
      h('p', null, `We’re making ${what}. It usually ships within about 2 weeks.`),
      h('p', { class: 'muted' }, `Paid ${money(r.amount)}.${r.email ? ` Receipt sent to ${r.email}.` : ''} You can check the status on your event’s Photos tab.`),
      back());
  } catch (e) {
    show('Almost there', h('p', { class: 'callout warn' }, e.message),
      e.code === 'not_paid' || e.code === 'network' ? h('button', { class: 'btn primary', onclick: confirm }, 'Try again') : null, back());
  }
}
confirm();
