# Owner checklist

Your to-do list, in order. Tick items off as you go. Step-by-step instructions are in the linked docs.

## Right now

- [x] **Free website decided (Nov 18): repo is public again.** The free site is back at **https://bawcejawn.github.io/AfterFlash/**. Anyone can read the code, but it holds no secrets. If you go private later, the free site turns off (GitHub Pro, $4/month, keeps it on).
- [x] **Old branches deleted.**
- [x] **Automatic branch cleanup turned on.**
- [ ] **Put Rememberoll on your phone:** open the site in Safari (iPhone) or Chrome (Android), sign in to your studio admin page, tap **Add to home screen**. Help article: **/help.html#home-screen-host**.

## The name: Rememberoll (before you recruit partners or print anything)

- [ ] **Lock the final name.** Working name **Rememberoll** (Nov 19); **Our Night** is also being considered (Nov 20). Its only US trademark found (OUR NIGHT, liquor, class 33) is dead/cancelled. Check for live marks in classes 9, 41, 42, 45 and the domains/handles, then tell Claude to rename everything.
- [ ] Buy **rememberoll.com** and **rememberroll.com** (double r, because people will type it that way) in Cloudflare: **Domain Registration → Register Domains**. Turn on auto-renew.
- [ ] Search **Rememberoll** at **tmsearch.uspto.gov** (classes 9 and 42).
- [ ] Get a trademark attorney's clearance search. Mention "Memory Roll" (getmemoryroll.com), the closest name found. Then file the Rememberoll trademark.
- [ ] Optional: rename the GitHub repo to **Rememberoll** (**Settings → Repository name**). The free site's address changes to `bawcejawn.github.io/Rememberoll/`, so do it before you share links, and tell Claude so the docs get updated.

## Try it with friends first ($0)

- [ ] Either set up the free self-hosted version (README → "One-time setup": Google Apps Script, about 20 minutes; needs the free site, options A or C above), or set up Cloudflare (option B) and give friends free keys from your owner panel.
- [ ] Run 3–5 real events (birthdays, a client of your wife's). Collect 5 great photos, a video of the TV wall, the highlight video and a one-line quote from each host.
- [ ] Note anything that confused people, and send it to the next chat to fix.

## Business basics (before real money)

- [ ] Form an LLC, get an EIN (free at irs.gov) and open a business bank account for Stripe payouts.
- [ ] Ask an accountant about sales tax on digital products in your state, and about 1099s for partners.
- [ ] Have a lawyer review: the Terms (**/terms.html**, "all sales are final"), the Privacy page, and the 3-tier partner program and agreement (docs/PARTNERS.md). The program is built to stay legal, but a direct-selling or MLM lawyer should confirm it for your state.
- [ ] Add the GitHub variable `BUSINESS_NAME` = your LLC's legal name.

## Launch the paid version (docs/LAUNCH.md, Parts 1–8, about 1–2 hours)

- [ ] **Part 1:** Cloudflare account, the **Workers Paid plan ($5/month)**, Account ID and API token. The free plan's 10 ms limit per request is too short for photo uploads.
- [ ] **Part 2:** make your owner key and save it in your password manager.
- [ ] **Part 3:** add the GitHub secrets and run **Deploy Rememberoll Cloud**.
- [ ] **Part 4:** connect your domain and set the `SITE_ORIGIN` variable.
- [ ] **Part 5:** Google Cloud project, Drive API, sign-in screen, client ID and secret, site verification. Then **Publish app**. If you skip publishing, customers' Drive connections stop after 7 days.
- [ ] **Part 6:** Stripe in test mode: add the secret key as a GitHub secret. Prices are already set ($5 / $10 / $30).
- [ ] **Part 7:** test everything with card 4242 4242 4242 4242: buy each plan, connect Drive, run a test event, add a test partner, buy with their link.
- [ ] **Part 8:** go live: activate Stripe, swap in the `sk_live_` key and redeploy. Optional: turn on **Crypto** (USDC) payments in Stripe.
- [ ] **Part 9:** turn on email (Resend + DNS + `RESEND_API_KEY` + `MAIL_FROM`). Move to Resend Pro ($20/month) before big invitation sends.
- [ ] **Part 10 (optional):** prints and photo books: pick a photo lab, set `PRINT_PRICE` / `BOOK_PRICE`.
- [ ] **Part 11 (optional):** guest-to-host offer: create code GUEST20, set `GUEST_OFFER_CODE`.
- [ ] **Part 12 (optional):** Rememberoll storage ($10 / $40 / $100): turn on R2, add "R2: Edit" to the token, set `STORAGE_BUCKET`.
- [ ] **Part 13:** fewer refunds and disputes: Terms URL in Stripe, `STRIPE_TOS` = `required`, statement descriptor, receipts.

## Partners

- [ ] Add your first tier-1 partners (owner panel → **Referral partners**). Tick **Free lifetime hosting key** for friends.
- [ ] Send each one their key, link and the partner agreement (docs/PARTNERS.md). Keep their "I agree" reply.
- [ ] Get a W-9 from each partner before their first payout. Store it privately, not in GitHub.
- [ ] Monthly: pay the **Payout requests** at the top of the owner panel (Venmo, PayPal, Zelle, Cash App or check), then click **Paid**.
- [ ] Each January: **Download payouts for taxes (CSV)** and give it to your accountant. A 1099-NEC is needed for anyone you paid $2,000 or more in 2026.

## Ongoing

- [ ] Glance at **Owner: system health** monthly. When it says "add one soon", follow docs/SCALING.md (two variables, then run the deploy).
- [ ] Dependabot opens at most one update PR per folder a month. Ask Claude to review and merge them.
- [ ] Customer problems: point people to **/help.html** first. Use **Add days** in the owner panel as a goodwill fix, since all sales are final.
