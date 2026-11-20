// Host dashboard: order prints or a photo book of the picked photos. Only shown on Rememberoll Cloud
// when the owner has set a price, never inside the Play Store app (store billing rules).
import { h, clear, toast, fmtDate, inStoreApp } from './util.js';
import { api } from './api.js';

let cache = null; // { key, shop }
const money = (c) => '$' + (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
const STATUS = { paid: 'Paid, being made', sent: 'Shipped', cancelled: 'Cancelled' };

export function shopStrip({ studio, eventId, key, items, selected }) {
  const box = h('section', { class: 'panel stack shop', hidden: true });
  if (inStoreApp()) return box;
  const id = eventId + ':' + key;
  const draw = (shop) => {
    if (!shop || (!shop.prints && !shop.book && !shop.orders.length)) return;
    box.hidden = false;
    const photos = items.filter((x) => selected.has(x.i) && x.k === 'p' && x.s !== 'deleted').map((x) => x.i);
    const L = shop.limits;
    const copies = h('select', { name: 'copies', 'aria-label': 'Copies of each' }, [1, 2, 3, 4, 5].map((n) => h('option', { value: String(n) }, n === 1 ? '1 copy each' : `${n} copies each`)));
    const go = async (btn, kind) => {
      btn.disabled = true;
      try {
        const r = await api(studio, 'hostOrder', { e: eventId, k: key, kind, ids: photos, copies: Number(copies.value) });
        location.assign(r.url);
      } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
    };
    const n = photos.length;
    const printBtn = shop.prints ? h('button', { class: 'btn small primary', disabled: !n || n > L.prints.max, onclick: (e) => go(e.currentTarget, 'prints') },
      n ? `Order ${n} print${n === 1 ? '' : 's'}` : 'Order prints') : null;
    copies.onchange = () => { if (printBtn && n) printBtn.textContent = `Order ${n * Number(copies.value)} prints (${money(shop.prints * n * Number(copies.value))})`; };
    copies.onchange();
    const bookOk = n >= L.book.min && n <= L.book.max;
    clear(box).append(
      h('h2', null, 'Prints and photo books'),
      h('p', { class: 'small muted' }, 'Pick photos above, then order. Tip: tap Favorites, then Select all. Shipped to the US and Canada.'),
      shop.prints ? h('div', { class: 'row' }, h('span', null, `4×6 prints, ${money(shop.prints)} each`), copies, printBtn) : null,
      shop.book ? h('div', { class: 'row' }, h('span', null, `Hardcover photo book, ${money(shop.book)}`),
        h('button', { class: 'btn small primary', disabled: !bookOk, onclick: (e) => go(e.currentTarget, 'book') }, 'Make a photo book'),
        h('span', { class: 'small muted' }, bookOk ? `${n} photos` : `Pick ${L.book.min} to ${L.book.max} photos (${n} picked)`)) : null,
      shop.orders.length ? h('h3', null, 'Your orders') : null,
      shop.orders.length ? h('ul', { class: 'msg-log' }, shop.orders.map((o) => h('li', null,
        `${fmtDate(o.created)}: ${o.kind === 'book' ? `photo book (${o.n} photos)` : `${o.n * o.copies} prints`}, ${money(o.amount)}. ${STATUS[o.status] || o.status}${o.note ? ` (${o.note})` : ''}`))) : null);
  };
  if (cache && cache.id === id) draw(cache.shop);
  else api(studio, 'hostShop', { e: eventId, k: key }, { retries: 0 }).then((shop) => { cache = { id, shop }; draw(shop); }).catch(() => { cache = { id, shop: null }; });
  return box;
}
