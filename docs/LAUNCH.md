# Launch PhotoShare (the paid version)

Everything is built and tested. What's left needs **your** accounts, so only you can do it: Cloudflare (runs the site), Google (the "Connect Google Drive" button) and Stripe (payments). Do the parts in order. Plan on about 1½–2 hours the first time. Screens change now and then, so if a button name is slightly different, look for the closest match.

**How it works for customers:** buy (Stripe) → get an admin key → click **Connect Google Drive** → create events. Photos go to the customer's own Google Drive, so you never pay for their storage.

**Your running costs:**
- Cloudflare Workers Paid: $5/month (needed so photo uploads don't hit the free plan's time limit).
- A domain name: about $10–15/year (strongly recommended).
- Stripe's fee on each sale: 2.9% + 30¢.
- Nothing per customer.

---

## Part 1: Cloudflare (runs the website and the API)

1. Go to **dash.cloudflare.com** → **Sign up** (free). Verify your email.
2. In the left menu click **Workers & Pages**. If it asks you to choose a **workers.dev subdomain**, pick something short (e.g. `yourname`) and save.
3. Upgrade to Workers Paid: **Workers & Pages** → **Plans** → **Workers Paid** ($5/month) → add a card.
4. **Account ID:** on the **Workers & Pages** overview page, the right side shows **Account ID**. Click copy and paste it into a note.
5. **API token:**
   1. Click your profile icon (top right) → **My Profile** → **API Tokens** → **Create Token**.
   2. Next to **Edit Cloudflare Workers** click **Use template**.
   3. Under **Permissions** click **+ Add more**: choose **Account** → **D1** → **Edit**.
   4. Under **Account Resources** pick your account. Under **Zone Resources** pick **All zones**.
   5. **Continue to summary** → **Create Token**, then copy the token. It's shown once.

## Part 2: Your owner key

This is *your* admin key. It shows the owner tools (all accounts, free keys for friends).

1. Make a random password of at least **40 letters and numbers**. Your password manager's generator is perfect: turn symbols off.
2. Save it in your password manager as "PhotoShare owner key".

## Part 3: Put the settings in GitHub and deploy

1. Open **github.com/bawcejawn/PhotoShare** → **Settings** → **Secrets and variables** → **Actions**.
2. On the **Secrets** tab, click **New repository secret** for each:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from Part 1, step 5 |
   | `CLOUDFLARE_ACCOUNT_ID` | the Account ID from Part 1, step 4 |
   | `OWNER_KEY` | your owner key from Part 2 |

3. On the **Variables** tab, click **New repository variable**: `PRICE_LABEL` = `$39`, or whatever price you choose (it's only the text shown on the site; the real price is set in Stripe).
4. Go to the repo's **Actions** tab → **Deploy PhotoShare Cloud** (left list) → **Run workflow** → **Run workflow**.
5. Wait for the green check (2–3 minutes). Click the run → **deploy** → the **Deploy** step. The last lines say:
   `✔ PhotoShare Cloud is live at https://photoshare.<yourname>.workers.dev`
   Open that address: you'll see the sales page with "Sales open soon". That's expected until Part 6.

## Part 4: Your own domain (recommended; Google needs it for a smooth sign-in)

1. Cloudflare dashboard → **Domain Registration** → **Register Domains**. Search a name (e.g. `photosharecam.com`), buy it (about $10–15/year).
2. **Workers & Pages** → **photoshare** → **Settings** → **Domains & Routes** → **+ Add** → **Custom domain** → type your domain (e.g. `photosharecam.com`) → **Add domain**. Wait until it says **Active** (a few minutes).
3. GitHub → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**: `SITE_ORIGIN` = `https://photosharecam.com` (your domain, no slash at the end).
4. **Actions** → **Deploy PhotoShare Cloud** → **Run workflow** again. Your site now lives at your domain.

(Skipping this? Everything still works on the workers.dev address, but Google may refuse to verify it in Part 5, step 7.)

## Part 5: Google ("Connect Google Drive" and "Lost your key?")

Use the Google account you want to own the app (a business Gmail is fine). Below, `YOUR-SITE` means your address from Part 4 (or Part 3).

1. Go to **console.cloud.google.com** → top bar project picker → **New project** → name it `PhotoShare` → **Create** → make sure it's selected.
2. Search bar: **Google Drive API** → open it → **Enable**.
3. Left menu (☰) → **Google Auth Platform** (it may also be under **APIs & Services → OAuth consent screen**) → **Get started**:
   - App name: `PhotoShare` (or your brand); User support email: your email → **Next**.
   - Audience: **External** → **Next**.
   - Contact information: your email → **Next** → agree → **Create**.
4. **Branding** (left menu):
   - Application home page: `https://YOUR-SITE/`
   - Privacy policy: `https://YOUR-SITE/privacy.html`
   - Terms of service: `https://YOUR-SITE/terms.html`
   - **Authorized domains → + Add domain**: your domain (e.g. `photosharecam.com`) → **Save**.
5. **Data access** (left menu) → **Add or remove scopes**. Tick `.../auth/drive.file`, `openid` and `.../auth/userinfo.email` → **Update** → **Save**. All three are "non-sensitive", so no security audit is needed.
6. **Clients** (left menu) → **+ Create client**:
   - Application type: **Web application**; Name: `PhotoShare web`.
   - **Authorized redirect URIs → + Add URI**: `https://YOUR-SITE/oauth/callback` (exactly).
   - **Create**, then copy the **Client ID** and **Client secret**.
7. Prove you own the site (needed for Google's brand check):
   1. Go to **search.google.com/search-console** → **Add property** → **URL prefix** → `https://YOUR-SITE/` → **Continue**.
   2. Choose **HTML file**. Note the file name it shows, like `google1a2b3c4d5e.html`. You don't need to download it.
   3. GitHub → **Variables** → **New repository variable**: `GOOGLE_SITE_VERIFICATION` = that file name.
   4. Run **Deploy PhotoShare Cloud** again, then back in Search Console click **Verify**.
8. GitHub → **Secrets and variables → Actions**:
   - **Variables** → `GOOGLE_CLIENT_ID` = the Client ID.
   - **Secrets** → `GOOGLE_CLIENT_SECRET` = the Client secret.
9. Google Auth Platform → **Audience** → **Publish app** → **Confirm**. **Don't skip this:** while an app is in "Testing", Google disconnects everyone's Drive after 7 days. If Google asks for verification, follow its prompts (for these scopes it's a quick brand check of your name, home page and privacy page).
10. Run **Deploy PhotoShare Cloud** again.

## Part 6: Stripe (payments)

1. **dashboard.stripe.com** → sign up. Stay in **Test mode** (toggle at the top) for now.
2. **Product catalog** → **+ Add product**:
   - Name: `PhotoShare host license`
   - Description: `Unlimited events. Photos save to your own Google Drive.`
   - Pricing: **One-off**, **$39.00 USD** (or your price) → **Add product**.
3. Open the product. Under **Pricing**, click the price → copy its **Price ID** (starts `price_`).
4. **Developers** → **API keys** → copy the **Secret key** (starts `sk_test_`).
5. GitHub:
   - **Variables** → `STRIPE_PRICE_ID` = the price ID; also set `SUPPORT_EMAIL` = the email customers should write to.
   - **Secrets** → `STRIPE_SECRET_KEY` = the secret key.
6. Run **Deploy PhotoShare Cloud**. The site now shows a yellow **Test mode** bar and a working **Get your admin key** button.

## Part 7: Test the whole thing yourself (test mode, no real money)

1. Open your site → **Get your admin key** → pay with card **4242 4242 4242 4242**, any future date, any CVC, any ZIP.
2. You land on **Thank you! Here's your admin key** → copy it → tick **I saved my admin key** → **Continue**.
3. **Connect Google Drive** → pick a Google account → **Continue/Allow**. Make sure the Drive box is ticked.
4. Create an event → open the guest link on your phone → take two photos → check they appear in **Google Drive → PhotoShare → (your event)**.
5. Open the TV wall on a laptop, try the album, and make a highlight video.
6. Sign out → **Lost your key? Sign in with Google** → you should get a new key.
7. Sign in with your **owner key** → **Owner: accounts** lists the test purchase. Use **Create a free key** for friends.

## Part 8: Go live

1. Stripe: **Activate payments** (business details, bank account for payouts). Switch the toggle to **Live mode**. Repeat Part 6 steps 2–4 in Live mode (new price ID, `sk_live_` key), update the two GitHub settings, and run the workflow again. The yellow bar disappears.
2. Read your **Terms** and **Privacy** pages (`/terms.html`, `/privacy.html`). They include a 14-day refund promise; change it if you want a different policy. To edit, tell me or change `site/assets/js/legal.js`. Have a lawyer glance at both when you can.
3. Business basics (ask an accountant for your state):
   - an LLC
   - a separate bank account for Stripe payouts
   - whether you must collect sales tax on digital products (Stripe Tax can do it)
4. Optional: `BUSINESS_NAME` variable (shown in the legal pages), `APP_NAME` if you rebrand.

**Keep safe:** your owner key, and don't delete the Cloudflare `DATA_KEY` secret. The deploy creates it once, and it unlocks everyone's Google Drive connections. For a backup, set your own `DATA_KEY` repository secret *before* the first real customer. After customers have connected, don't change it, or they'll all need to reconnect.

---

## Your first sale: step by step

**Week 1: proof**
1. Run one real event with it (a friend's party or one of your wife's clients) for free. Collect: 5 great photos, a screen recording of the TV wall filling up, the highlight video, and a one-line quote from the host.
2. Put the quote and the highlight video on your sales page (send them to me and I'll add them).

**Week 2: warm network (your most likely first buyers)**

3. Write a list of 30 people who'll host something in the next 3 months: engaged couples, people planning a 30th/40th/50th birthday, graduation parties, baby showers, reunions.
4. Send each one a personal text (not a group blast):

   > "Hey! I built an app for [event]: guests scan a QR code and every photo they take lands in your Google Drive, with a live slideshow on the TV and a highlight video the next morning. No app for guests. Want to try it for yours? It's $39, and I'll set it up with you."

5. In Stripe → **Product catalog** → **Coupons** → **+ Create coupon**: 25% off, **Once**, limit 10 redemptions. In the coupon's **Promotion codes** section, add the code `FIRST10`. Buyers type it at checkout ("Add promotion code").

**Weeks 2–4: planners (your wife's network)**

6. List 15 wedding planners, venues, DJs and photographers she knows.
7. Give each a **free key** (Owner tools → Create a free key) for their next event, in exchange for honest feedback, a testimonial and permission to mention them.
8. Ask the ones who like it to recommend it to clients, or to buy one for each couple and include it in their packages (they can mark it up).

**Ongoing (30 minutes a day)**

9. Post short videos (TikTok, Instagram Reels, Facebook): "the TV wall filling up live", "the morning-after highlight video", "how guests join in 5 seconds". Real events beat polished ads.
10. Local Facebook groups (wedding planning, moms, event pros): share your real event video when it's allowed. Read each group's rules first.
11. Every printed QR sign already shows your brand to 100+ guests. After each event, ask the host: "Know anyone else hosting something?"
12. Track it in Stripe (sales) and the owner panel (accounts, events, Drive connected). Expect the first sale from the warm list or a planner, not from strangers.

**A realistic first goal:** 10 paying hosts. Then decide whether to spend on ads.
