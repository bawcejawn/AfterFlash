# Owner checklist

Your to-do list, in order. Tick items off as you go. Step-by-step instructions are in the linked docs.

## Right now (about 5 minutes)

- [ ] **Decide what to do about the free website.** You made the repo **private** on Nov 18. That's good: your code can't be copied, and Claude's access still works. But GitHub's free plan only runs GitHub Pages (the free site at bawcejawn.github.io/PhotoShare) for public repos, so that site is off. Pick one:
  - **A. Pay for GitHub Pro ($4/month):** github.com/settings/billing → upgrade to Pro. Then **Settings → Pages → Source: GitHub Actions** and **Actions → Deploy site to GitHub Pages → Run workflow**. The repo stays private; the site itself is public, which is fine because it holds no secrets.
  - **B. Skip the free site ($0):** set up the paid Cloudflare version (docs/LAUNCH.md). It hosts its own website from the private repo. Test with friends by giving them free keys from your owner panel, with Stripe in test mode.
  - **C. Make the repo public again ($0):** **Settings → General → Danger Zone → Change visibility.** Everything works as before, but anyone can read and copy the code.
  - Recommended: **B**. You need Cloudflare anyway, and free keys make friend tests easy.
- [ ] **Delete the old branches.** Go to **github.com/bawcejawn/PhotoShare/branches** and click the trash icon on every branch except `main`. All of their work is already in `main`.
- [ ] **Turn on automatic branch cleanup:** **Settings → General → Pull Requests →** tick **Automatically delete head branches**.

## The name (before you recruit partners or print anything)

- [ ] Search **AfterFlash** at **tmsearch.uspto.gov**. Look for anything live, especially in classes 9 or 42, or anything photo- or event-related.
- [ ] Google "AfterFlash photo booth" and "AfterFlash photos". A photo booth listing on logo.com uses the name; find out whether it's a real business.
- [ ] Check the domain in Cloudflare (**Domain Registration → Register Domains**): `afterflash.com`, or `getafterflash.com` / `afterflash.app`. Buy one (about $10–15 a year).
- [ ] Get a trademark attorney's clearance search, then file the AfterFlash trademark yourself.
- [ ] If the name isn't safe, pick another. It's a one-PR rename.
- [ ] Optional: rename the repo (**Settings → Repository name → AfterFlash**). The free site's address changes to `bawcejawn.github.io/AfterFlash/`, so do it before you share links.

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
