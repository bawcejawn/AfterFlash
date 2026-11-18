# Referral partners

Partners (friends, planners, DJs, photographers) share a code or link. Their buyers get a discount, and the partner earns a commission on every sale made with that code. That includes renewals by the same customer, because the key remembers the code it was bought with. You pay partners yourself and record it in the owner panel.

Default deal: **10% off for the buyer, 20% commission** of what the buyer paid. You can set it per partner (each up to 50%).

| Plan | Price | Buyer pays with a code | Partner earns (20%) | Stripe card fee | You keep |
|---|---|---|---|---|---|
| 1 event | $5 | $4.50 | $0.90 | $0.43 | $3.17 |
| 1 month | $10 | $9.00 | $1.80 | $0.56 | $6.64 |
| 12 months | $30 | $27.00 | $5.40 | $1.08 | $20.52 |

The card fee is 2.9% + 30¢, and "you keep" is before your own taxes. A sale without a code keeps $4.55, $9.41 or $28.83.

## Adding a partner (2 minutes)

1. Sign in to your admin page with your owner key, then scroll to **Owner: referral partners**.
2. Type their name and, optionally, their email and a code you like (e.g. `MIKE`). Leave the code empty to get one like `MIKE47`.
3. Leave **Also give them a free lifetime admin key** ticked for friends you want to give a lifetime pass.
4. Click **Add partner**. Copy the **link** and the **admin key** (the key is shown once) and send both privately: a text or DM, never a public post.
5. When they sign in with that key, their admin page shows their code, their link, every sale (date, plan and amount, never the buyer's name) and what they're owed.

## Before you pay anyone: paperwork

- Get a **W-9** from each partner before their first payout (the IRS form with their legal name, address and SSN or EIN). Keep it in a private folder, not in PhotoShare or GitHub.
- **1099-NEC:** for payments made in 2026, you file one for each partner you paid **$2,000 or more** in the year (the threshold was $600 before 2026). Payments sent through PayPal, Venmo or Zelle *business* accounts or by card are generally reported by the payment company on a 1099-K instead, so ask your accountant how you pay before January.
- Use **Download payouts for taxes (CSV)** in the owner panel each January; it lists every payout with name, email, amount and method.
- Partners are independent contractors, not employees: no set hours, they use their own phone and network, and they pay their own taxes.

## Paying partners (once a month)

1. Owner panel: each partner shows **Ready to pay**. That's commission on sales older than 14 days, so a refund can't catch you out.
2. Pay them (Venmo, PayPal, Zelle, cash), then click **Record payout**, enter the amount and how you paid.
3. If you refund a sale in Stripe, find it under **Sales with codes** and click **Void (refunded)**. Its commission is taken off what they're owed. (If you'd already paid them, the next payout is smaller.)
4. **Cash sale:** sold a key in person? Use **Cash sale**: pick the plan, the amount and their partner's code. It makes the buyer's admin key and credits the partner.

## Partner rules (send this with their link)

A plain-English agreement to send each partner and keep their "I agree" reply. Have a lawyer look at it when the program grows.

> **PhotoShare partner agreement**
>
> 1. You're an independent contractor, not an employee or agent of [BUSINESS NAME]. You're responsible for your own taxes. Before your first payout you'll give us a completed W-9.
> 2. Your code gives buyers [10]% off. You earn [20]% of what each buyer actually pays with your code, including their later renewals, while this agreement is active.
> 3. Commissions are paid monthly, for sales more than 14 days old. Refunded or charged-back sales don't earn; if one was already paid, we subtract it from your next payout.
> 4. You can't earn on your own purchases, and you can't use paid ads that bid on the PhotoShare name.
> 5. **Say you earn a commission** whenever you share your link or code (e.g. "I get a small commission if you use my code"). This is a legal requirement (FTC Endorsement Guides). Put it next to the link, not hidden at the end.
> 6. No spam, no fake reviews, no promises we don't make (for example, "free storage" or "lifetime"), and no posting your code on coupon sites.
> 7. Either of us can end this at any time by message. We'll pay what you've earned up to that day. We may change the rates with 30 days' notice.
>
> Reply "I agree" to accept.

## Questions people ask

- **Can a buyer use two codes?** No, one code per purchase.
- **What does the buyer see?** The discounted price on the pricing page, and "(10% off with code MIKE)" on the Stripe checkout.
- **Does a code work forever?** Until you click **Turn off**. Existing customers keep renewing at full price after that, and the partner stops earning.
- **Where's the tracking?** In your own database. Nothing is shared with Stripe beyond the code name on the receipt.
