# Owner checklist

Your to-do list, in order. Tick items off as you go. Step-by-step instructions are in the linked docs.

## Right now

- [x] **Free website decided (Nov 18): repo is public again.** The free site is back at **https://bawcejawn.github.io/AfterFlash/**. Anyone can read the code, but it holds no secrets. If you go private later, the free site turns off (GitHub Pro, $4/month, keeps it on).
- [x] **Old branches deleted.**
- [x] **Automatic branch cleanup turned on.**
- [ ] **Put AfterFlash on your phone:** open the site in Safari (iPhone) or Chrome (Android), sign in to your studio admin page, tap **Add to home screen**. Help article: **/help.html#home-screen-host**.

## The name (before you recruit partners or print anything)

- [ ] Search **AfterFlash** at **tmsearch.uspto.gov**. Look for anything live, especially in classes 9 or 42, or anything photo- or event-related.
- [ ] Google "AfterFlash photo booth" and "AfterFlash photos". A photo booth listing on logo.com uses the name; find out whether it's a real business.
- [ ] Check the domain in Cloudflare (**Domain Registration → Register Domains**): `afterflash.com`, or `getafterflash.com` / `afterflash.app`. Buy one (about $10–15 a year).
- [ ] Get a trademark attorney's clearance search, then file the AfterFlash trademark yourself.
- [ ] If the name isn't safe, pick another. It's a one-PR rename.
- [x] Repo renamed to **AfterFlash** (Nov 18). Old `/PhotoShare/` site links no longer work.

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
- [ ] **Part 3:** add the GitHub secrets and run **Deploy AfterFlash Cloud**.
- [ ] **Part 4:** connect your domain and set the `SITE_ORIGIN` variable.
- [ ] **Part 5:** Google Cloud project, Drive API, sign-in screen, client ID and secret, site verification. Then **Publish app**. If you skip publishing, customers' Drive connections stop after 7 days.
- [ ] **Part 6:** Stripe in test mode: add the secret key as a GitHub secret. Prices are already set ($5 / $10 / $30).
- [ ] **Part 7:** test everything with card 4242 4242 4242 4242: buy each plan, connect Drive, run a test event, add a test partner, buy with their link.
- [ ] **Part 8:** go live: activate Stripe, swap in the `sk_live_` key and redeploy. Optional: turn on **Crypto** (USDC) payments in Stripe.

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
