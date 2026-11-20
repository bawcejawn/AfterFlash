// Stripe Checkout: one payment buys admin-key time (a new key, or more time on an existing one). No webhooks needed: the
// thank-you page asks the server to check the Checkout Session with Stripe directly.
import { err } from './lib.js';

const API = 'https://api.stripe.com/v1';

async function stripe(env, path, { method = 'GET', form } = {}) {
  if (!env.STRIPE_SECRET_KEY) throw err('not_configured', 'Payments aren’t set up on this server yet.');
  const res = await fetch(API + path, {
    method,
    headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}`, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 404) throw err('not_found', 'That purchase wasn’t found.');
    throw err('payment_error', (data.error && data.error.message) || 'The payment service didn’t answer. Try again.');
  }
  return data;
}

/** The plans: each is a one-time payment for that much admin-key time. Lifetime is only given by the owner. */
export const PLAN_DAYS = { event: 30, month: 30, year: 365, lifetime: 0 };
export const ON_SALE = ['event', 'month', 'year'];
export const PLAN_NAMES = { event: '1 event (30 days)', month: '1 month', year: '12 months', lifetime: 'Lifetime' };
const DEFAULT_PRICE = { event: '5', month: '10', year: '30' };

/** "$5", "5" or "4.99" → 500 cents. Anything odd falls back to the default price. */
export function toCents(v, fallback) {
  const m = /^\s*\$?\s*(\d{1,5})(?:\.(\d{1,2}))?\s*$/.exec(String(v == null ? '' : v));
  if (!m) return fallback == null ? 0 : toCents(fallback);
  return Number(m[1]) * 100 + Number((m[2] || '0').padEnd(2, '0'));
}
export const money = (cents) => '$' + (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
/** Price of each plan in cents, from the PRICE_EVENT / PRICE_MONTH / PRICE_YEAR settings. */
export function planPrices(env) {
  return {
    event: toCents(env.PRICE_EVENT, DEFAULT_PRICE.event),
    month: toCents(env.PRICE_MONTH, DEFAULT_PRICE.month),
    year: toCents(env.PRICE_YEAR, DEFAULT_PRICE.year),
  };
}
export const discounted = (cents, pct) => Math.max(50, Math.round(cents * (100 - pct) / 100)); // Stripe's minimum is 50¢

/**
 * Stripe Checkout for a plan. The price is set here (no Stripe products needed), so referral
 * discounts are exact. With `account`, the payment extends that account instead of making a new one.
 */
export async function createCheckout(env, { plan, account = '', ref = null }) {
  if (!ON_SALE.includes(plan)) throw err('bad_request', 'That plan isn’t on sale.');
  const full = planPrices(env)[plan];
  const amount = ref ? discounted(full, ref.discount) : full;
  const s = await stripe(env, '/checkout/sessions', {
    method: 'POST',
    form: {
      mode: 'payment',
      'metadata[plan]': plan,
      ...(account ? { 'metadata[account]': account } : {}),
      ...(ref ? { 'metadata[ref]': ref.code, 'metadata[commission]': String(ref.commission) } : {}),
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': 'Rememberoll ' + PLAN_NAMES[plan] + (ref ? ` (${ref.discount}% off with code ${ref.code})` : ''),
      'line_items[0][quantity]': '1',
      success_url: `${env.SITE_ORIGIN}/welcome.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.SITE_ORIGIN}/index.html#pricing`,
      'consent_collection[terms_of_service]': env.STRIPE_TOS === 'required' ? 'required' : 'none',
      'custom_text[submit][message]': 'All sales are final. You’ll get your admin key right after paying.',
    },
  });
  return s.url;
}

/** Returns { paid, email, amount, plan, account, ref, commission } for a Checkout Session id. */
export async function readCheckout(env, id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(String(id))) throw err('bad_request', 'That link isn’t a valid purchase link.');
  const s = await stripe(env, `/checkout/sessions/${encodeURIComponent(id)}`);
  const meta = s.metadata || {};
  const pct = Number(meta.commission);
  return {
    paid: s.payment_status === 'paid' || s.payment_status === 'no_payment_required',
    email: (s.customer_details && s.customer_details.email) || '', amount: s.amount_total || 0, live: !!s.livemode,
    plan: Object.prototype.hasOwnProperty.call(PLAN_DAYS, meta.plan) ? meta.plan : 'month',
    account: /^[A-Za-z0-9]{6,20}$/.test(meta.account || '') ? meta.account : '',
    ref: /^[A-Z0-9]{3,16}$/.test(meta.ref || '') ? meta.ref : '',
    commission: Number.isInteger(pct) && pct >= 0 && pct <= 50 ? pct : 0,
  };
}

// ---- prints and photo books (add-ons the owner turns on by setting a price; fulfilled by hand)
export const SHOP = { prints: { min: 1, max: 100, name: 'prints' }, book: { min: 20, max: 60, name: 'photo book' } };
/** Prices in cents from PRINT_PRICE (per print) and BOOK_PRICE (per book). 0 = not offered. */
export function shopPrices(env) {
  return { prints: toCents(env.PRINT_PRICE, '0'), book: toCents(env.BOOK_PRICE, '0') };
}
const COUNTRIES = ['US', 'CA'];

/** Stripe Checkout for a print or book order. Stripe collects the shipping address. */
export async function createOrderCheckout(env, { order, kind, count, copies, amount, event }) {
  const label = kind === 'book' ? `Photo book (${count} photos)` : `${count * copies} photo print${count * copies === 1 ? '' : 's'} (4×6)`;
  const form = {
    mode: 'payment',
    'metadata[order]': order,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][price_data][product_data][name]': `${label}: ${event}`.slice(0, 200),
    'line_items[0][quantity]': '1',
    success_url: `${env.SITE_ORIGIN}/order.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.SITE_ORIGIN}/order.html?cancelled=1`,
    'custom_text[submit][message]': 'Printed and shipped within about 2 weeks. Made to order, so all sales are final.',
  };
  COUNTRIES.forEach((cc, i) => { form[`shipping_address_collection[allowed_countries][${i}]`] = cc; });
  const s = await stripe(env, '/checkout/sessions', { method: 'POST', form });
  return s.url;
}

/** { paid, email, amount, order, ship } for an order's Checkout Session. */
export async function readOrderCheckout(env, id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(String(id))) throw err('bad_request', 'That link isn’t a valid order link.');
  const s = await stripe(env, `/checkout/sessions/${encodeURIComponent(id)}`);
  const meta = s.metadata || {};
  const sd = (s.collected_information && s.collected_information.shipping_details) || s.shipping_details || null;
  const a = (sd && sd.address) || {};
  const clip = (v) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 120);
  return {
    paid: s.payment_status === 'paid',
    email: clip(s.customer_details && s.customer_details.email), amount: s.amount_total || 0,
    order: /^[A-Za-z0-9]{12}$/.test(meta.order || '') ? meta.order : '',
    ship: sd ? { name: clip(sd.name), line1: clip(a.line1), line2: clip(a.line2), city: clip(a.city), state: clip(a.state), zip: clip(a.postal_code), country: clip(a.country) } : null,
  };
}
