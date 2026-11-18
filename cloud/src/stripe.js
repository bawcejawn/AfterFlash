// Stripe Checkout: one payment buys one host account (an admin key). No webhooks needed: the
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

export async function createCheckout(env) {
  if (!env.STRIPE_PRICE_ID) throw err('not_configured', 'Payments aren’t set up on this server yet.');
  const s = await stripe(env, '/checkout/sessions', {
    method: 'POST',
    form: {
      mode: 'payment',
      'line_items[0][price]': env.STRIPE_PRICE_ID,
      'line_items[0][quantity]': '1',
      success_url: `${env.SITE_ORIGIN}/welcome.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.SITE_ORIGIN}/index.html#pricing`,
      allow_promotion_codes: 'true',
      'consent_collection[terms_of_service]': env.STRIPE_TOS === 'required' ? 'required' : 'none',
      'custom_text[submit][message]': 'You’ll get your admin key right after paying.',
    },
  });
  return s.url;
}

/** Returns { paid, email, amount } for a Checkout Session id. */
export async function readCheckout(env, id) {
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(String(id))) throw err('bad_request', 'That link isn’t a valid purchase link.');
  const s = await stripe(env, `/checkout/sessions/${encodeURIComponent(id)}`);
  return { paid: s.payment_status === 'paid' || s.payment_status === 'no_payment_required', email: (s.customer_details && s.customer_details.email) || '', amount: s.amount_total || 0, live: !!s.livemode };
}
