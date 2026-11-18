# Referral partners (3 tiers)

```
You (owner)
└── Tier 1 partner (you add them)
    └── Tier 2 partner (a tier 1 partner invites them)
        └── Tier 3 partner (a tier 2 partner invites them; sells only, can't invite)
```

- **Every partner** gets a code and a link. Buyers get **10% off** and the seller earns **20%** of what the buyer paid, on every sale with that code. Renewals count too, because the customer's key remembers the code.
- **Team bonus: 5%** of each sale, split evenly among the partners *above* the seller (never you, the owner). A tier 3 sale pays tier 2 and tier 1 2.5% each, a tier 2 sale pays tier 1 the whole 5%, and a tier 1 sale has nobody above, so you keep the 5%. To change it, add a GitHub variable `OVERRIDE_PCT` (0–10).
- **Only you give free keys.** Partners get a partner-only key: it shows sales, team and payouts, and can't host events unless they buy a plan.

## What each sale pays (12-month plan, $30)

| | Tier 1 sells | Tier 2 sells | Tier 3 sells |
|---|---|---|---|
| Buyer pays (10% off) | $27.00 | $27.00 | $27.00 |
| Seller (20%) | $5.40 | $5.40 | $5.40 |
| Team bonus (5%) | (you keep it) | $1.35 to tier 1 | $0.67 to tier 2, $0.67 to tier 1 |
| Stripe card fee | $1.08 | $1.08 | $1.08 |
| **You keep** | **$20.52** | **$19.17** | **$19.18** |

The $10 month and $5 event plans split the same way (20% and 5% of what was paid).

## The rules that keep this legal

Tiered sales programs are legal only when the money comes from real customers, not from recruiting. The FTC's test is whether pay is based on actual sales to real customers. AfterFlash enforces these rules in the code:

1. **Joining is free.** Nobody ever has to buy anything to join or stay.
2. **Inviting pays $0.** Money only comes from a real customer's purchase.
3. **Partners' own purchases earn nobody anything.** That covers buying while signed in with a partner key, and buying with the partner's own email.
4. **Three tiers maximum.**
5. **Partners must disclose the commission when they share, and must never promise earnings.** This is in the agreement every invited partner accepts.

Before you push tier 2 and 3 hard, have a lawyer who knows direct selling or MLM law review this page and the agreement. State laws vary.

## Adding a tier 1 partner (you)

1. Admin page with your owner key → **Owner: referral partners**.
2. Type their name, email and optionally a code (e.g. `MIKE`).
3. Tick **Free lifetime hosting key** for friends you're giving a lifetime pass. Leave it unticked for a partner-only key.
4. **Add partner**, then send them the key and link privately, plus the agreement below. Keep their "I agree" reply.

## How partners grow their team (tiers 1 and 2)

1. On their partner page: **Make an invite link**. Each link works once and expires in 14 days.
2. The new person opens it, reads the agreement, ticks "I agree", enters their name and email, and gets their own key, code and link. Nobody else ever sees their key.
3. The inviter sees their team (names, tier, sale counts) on their page. Nobody sees customers' names or emails.

## Payouts

1. A partner's balance updates with every sale. Money is **ready** 14 days after a sale, in case of a chargeback.
2. At **$25 ready**, they tap **Request payout** and choose Venmo, PayPal, Zelle, Cash App or Check, plus their username/email/phone.
3. You see it at the top of **Owner: referral partners**. Send the money in that app, then click **Paid**. That records the payout for their 1099. **Decline** lets them request again.
4. **Chargeback?** Under **Sales with codes**, click **Void (chargeback)**. That reverses the seller's commission and the team bonuses for that sale.
5. Automatic payouts with Stripe Connect can be added later. It costs $2 per partner in each month they're paid, plus 0.25% + 25¢ per payout, and Stripe then collects W-9s and files 1099s for you.

## Taxes

- Get a **W-9** from each partner before you pay them, and store it privately (not in AfterFlash or GitHub).
- **1099-NEC:** for payments made in 2026, file one for each partner you paid **$2,000 or more** in the year. Payments by card or a payment app are generally reported by the app on a 1099-K instead. Ask your accountant.
- Each January, use **Download payouts for taxes (CSV)**.

## Partner agreement (for tier 1 partners you add; invited partners accept it on the join page)

> **AfterFlash partner agreement**
>
> 1. You're an independent contractor, not an employee or agent of [BUSINESS NAME]. You pay your own taxes. Before your first payout you'll give us a W-9.
> 2. Your code gives buyers [10]% off. You earn [20]% of what each buyer actually pays with your code, including their later purchases with the same key.
> 3. You can invite partners to your team. When someone on your team (up to 2 levels below you) makes a sale, a [5]% team bonus is split evenly among the partners above the seller. Inviting people earns nothing by itself: money only comes from real customers' purchases.
> 4. Joining is free. You never have to buy anything, and purchases by partners (yours or your team's) don't earn anyone a commission.
> 5. Earnings can be paid once $25 is ready (sales more than 14 days old). Request payouts on your partner page. Sales reversed by a chargeback don't earn.
> 6. Say you earn a commission whenever you share your link or code (e.g. "I get a small commission if you use my code"). This is a legal requirement (FTC Endorsement Guides).
> 7. Don't promise earnings or income to anyone you invite, and don't make claims we don't (e.g. "free storage", "lifetime access"). No spam, no fake reviews, no coupon sites, no ads that bid on our name.
> 8. Either of us can end this at any time. We'll pay what you've earned up to that day. We may change the rates with 30 days' notice.
>
> Reply "I agree" to accept.

## Cash sales

Sold a key in person? Use **Cash sale** in the owner panel. It makes the buyer's admin key and credits the partner's code, team bonuses included.
