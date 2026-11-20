# Launch Rememberoll (the paid version)

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
2. Save it in your password manager as "Rememberoll owner key".

## Part 3: Put the settings in GitHub and deploy

1. Open **github.com/bawcejawn/AfterFlash** → **Settings** → **Secrets and variables** → **Actions**.
2. On the **Secrets** tab, click **New repository secret** for each:

   | Name | Value |
   |---|---|
   | `CLOUDFLARE_API_TOKEN` | the token from Part 1, step 5 |
   | `CLOUDFLARE_ACCOUNT_ID` | the Account ID from Part 1, step 4 |
   | `OWNER_KEY` | your owner key from Part 2 |

3. Go to the repo's **Actions** tab → **Deploy Rememberoll Cloud** (left list) → **Run workflow** → **Run workflow**.
4. Wait for the green check (2–3 minutes). Click the run → **deploy** → the **Deploy** step. The last lines say:
   `✔ Rememberoll Cloud is live at https://photoshare.<yourname>.workers.dev`
   Open that address: you'll see the sales page with "Sales open soon". That's expected until Part 6.

## Part 4: Your own domain (recommended; Google needs it for a smooth sign-in)

1. Cloudflare dashboard → **Domain Registration** → **Register Domains**. Search a name (e.g. `photosharecam.com`), buy it (about $10–15/year).
2. **Workers & Pages** → **photoshare** → **Settings** → **Domains & Routes** → **+ Add** → **Custom domain** → type your domain (e.g. `photosharecam.com`) → **Add domain**. Wait until it says **Active** (a few minutes).
3. GitHub → **Settings** → **Secrets and variables** → **Actions** → **Variables** → **New repository variable**: `SITE_ORIGIN` = `https://photosharecam.com` (your domain, no slash at the end).
4. **Actions** → **Deploy Rememberoll Cloud** → **Run workflow** again. Your site now lives at your domain.

(Skipping this? Everything still works on the workers.dev address, but Google may refuse to verify it in Part 5, step 7.)

## Part 5: Google ("Connect Google Drive" and "Lost your key?")

Use the Google account you want to own the app (a business Gmail is fine). Below, `YOUR-SITE` means your address from Part 4 (or Part 3).

1. Go to **console.cloud.google.com** → top bar project picker → **New project** → name it `Rememberoll` → **Create** → make sure it's selected.
2. Search bar: **Google Drive API** → open it → **Enable**.
3. Left menu (☰) → **Google Auth Platform** (it may also be under **APIs & Services → OAuth consent screen**) → **Get started**:
   - App name: `Rememberoll` (or your brand); User support email: your email → **Next**.
   - Audience: **External** → **Next**.
   - Contact information: your email → **Next** → agree → **Create**.
4. **Branding** (left menu):
   - Application home page: `https://YOUR-SITE/`
   - Privacy policy: `https://YOUR-SITE/privacy.html`
   - Terms of service: `https://YOUR-SITE/terms.html`
   - **Authorized domains → + Add domain**: your domain (e.g. `photosharecam.com`) → **Save**.
5. **Data access** (left menu) → **Add or remove scopes**. Tick `.../auth/drive.file`, `openid` and `.../auth/userinfo.email` → **Update** → **Save**. All three are "non-sensitive", so no security audit is needed.
6. **Clients** (left menu) → **+ Create client**:
   - Application type: **Web application**; Name: `Rememberoll web`.
   - **Authorized redirect URIs → + Add URI**: `https://YOUR-SITE/oauth/callback` (exactly).
   - **Create**, then copy the **Client ID** and **Client secret**.
7. Prove you own the site (needed for Google's brand check):
   1. Go to **search.google.com/search-console** → **Add property** → **URL prefix** → `https://YOUR-SITE/` → **Continue**.
   2. Choose **HTML file**. Note the file name it shows, like `google1a2b3c4d5e.html`. You don't need to download it.
   3. GitHub → **Variables** → **New repository variable**: `GOOGLE_SITE_VERIFICATION` = that file name.
   4. Run **Deploy Rememberoll Cloud** again, then back in Search Console click **Verify**.
8. GitHub → **Secrets and variables → Actions**:
   - **Variables** → `GOOGLE_CLIENT_ID` = the Client ID.
   - **Secrets** → `GOOGLE_CLIENT_SECRET` = the Client secret.
9. Google Auth Platform → **Audience** → **Publish app** → **Confirm**. **Don't skip this:** while an app is in "Testing", Google disconnects everyone's Drive after 7 days. If Google asks for verification, follow its prompts (for these scopes it's a quick brand check of your name, home page and privacy page).
10. Run **Deploy Rememberoll Cloud** again.

## Part 6: Stripe (payments)

You don't need to create products in Stripe: Rememberoll sets the prices itself, which is what makes referral discounts exact.

1. **dashboard.stripe.com** → sign up. Stay in **Test mode** (toggle at the top) for now.
2. **Developers** → **API keys** → copy the **Secret key** (starts `sk_test_`).
3. GitHub → **Settings → Secrets and variables → Actions**:
   - **Secrets** → `STRIPE_SECRET_KEY` = the secret key.
   - **Variables** → `SUPPORT_EMAIL` = the email customers should write to.
   - Prices are $5 (1 event), $10 (1 month) and $30 (12 months). To change one, add a variable `PRICE_EVENT`, `PRICE_MONTH` or `PRICE_YEAR` with the dollar amount, e.g. `15`.
4. Run **Deploy Rememberoll Cloud**. The site shows the yellow **Test mode** bar and three plans. Buy each one with card `4242 4242 4242 4242`.
5. Optional, after you go live (Part 8): **Settings → Payments → Payment methods** → turn on **Crypto**, so people can pay in USDC stablecoin. The fee is 1.5% instead of 2.9% + 30¢, and you get dollars. Only US businesses can turn it on, and only on a live (activated) account. Nothing to change in Rememberoll.

**How plans work:**
- **1 event** ($5): one event, usable for 30 days from purchase. Deleting it doesn't give the event back.
- **1 month** ($10) and **12 months** ($30): unlimited events for 30 or 365 days.
- Buying again while signed in adds time (or one more event) to the same key. Lifetime keys exist, but only you can give them (owner panel).
- When a plan ends, hosts can still sign in, see their events and back up private keys. Creating events, host dashboards and new guest photos stop until they renew; guests' phones keep the photos and upload them after renewal.
- **Albums stay online for 12 months after a plan ends**, then their links close. The photos stay in the host's Google Drive. Renewing reopens them.
- Nothing renews automatically and there are no reminder emails yet: the admin page warns hosts 7 days before the end.

**Referral partners and cash sales** are in your owner panel; see [PARTNERS.md](PARTNERS.md).

## Part 7: Test the whole thing yourself (test mode, no real money)

1. Open your site → **Get your admin key** → pay with card **4242 4242 4242 4242**, any future date, any CVC, any ZIP.
2. You land on **Thank you! Here's your admin key** → copy it → tick **I saved my admin key** → **Continue**.
3. **Connect Google Drive** → pick a Google account → **Continue/Allow**. Make sure the Drive box is ticked.
4. Create an event → open the guest link on your phone → take two photos → check they appear in **Google Drive → Rememberoll → (your event)**.
5. Open the TV wall on a laptop, try the album, and make a highlight video.
6. Sign out → **Lost your key? Sign in with Google** → you should get a new key.
7. Sign in with your **owner key** → **Owner: accounts** lists the test purchase. Use **Create a free key** for friends.

## Part 8: Go live

1. Stripe: **Activate payments** (business details, bank account for payouts). Switch the toggle to **Live mode**. Repeat Part 6 steps 2–4 in Live mode (`sk_live_` key), update the `STRIPE_SECRET_KEY` secret, and run the workflow again. The yellow bar disappears.
2. Read your **Terms** and **Privacy** pages (`/terms.html`, `/privacy.html`). They say **all sales are final** (no refunds), and that you'll fix problems on your side and may add time as goodwill (owner panel → **Add days**). Buyers can still dispute a charge with their bank; a clear no-refund policy shown at checkout helps you win those. To edit, tell me or change `site/assets/js/legal.js`. Have a lawyer glance at both when you can.
3. Business basics (ask an accountant for your state):
   - an LLC
   - a separate bank account for Stripe payouts
   - whether you must collect sales tax on digital products (Stripe Tax can do it)
4. Optional: `BUSINESS_NAME` variable (shown in the legal pages), `APP_NAME` if you rebrand.

**Keep safe:** your owner key, and don't delete the Cloudflare `DATA_KEY` secret. The deploy creates it once, and it unlocks everyone's Google Drive connections. For a backup, set your own `DATA_KEY` repository secret *before* the first real customer. After customers have connected, don't change it, or they'll all need to reconnect.

---

## Part 9: Turn on email (optional, about 15 minutes)

Lets hosts email invitations, reminders, "the camera is open", "the photos are ready" and thank-you notes, by hand or automatically. Without it, hosts can still use their own email app (the Invitations tab has buttons for that).

1. Go to **resend.com** → sign up. The free plan sends 3,000 emails a month but **only 100 a day**, so one big wedding's invitations can hit the cap. Once real customers use email, switch to Resend **Pro ($20/month, 50,000 emails, no daily cap)**.
2. **Domains → Add domain** → type your domain (e.g. `rememberoll.com`) → Resend shows a few DNS records.
3. In **Cloudflare → your domain → DNS → Records**, add each record exactly as Resend shows it (or click **Auto configure** if Resend offers Cloudflare). Back in Resend, click **Verify**. It can take a few minutes.
4. Resend: **API Keys → Create API key** → name "Rememberoll", permission **Sending access**, domain: yours → **Add** → copy the key (starts with `re_`).
5. GitHub → **Settings → Secrets and variables → Actions**:
   - **Secrets → New repository secret:** `RESEND_API_KEY` = the key.
   - **Variables → New repository variable:** `MAIL_FROM` = `Rememberoll <hello@YOUR-DOMAIN>` (the part in `<>` must use your verified domain).
6. Run **Actions → Deploy Rememberoll Cloud → Run workflow**.
7. Test: open a test event → **Invitations** tab → add your own email → **Send the invitation**. Check it arrives (and look in spam the first time).

Limits built in: each event can send up to 600 emails a day, the same message can't go out twice within an hour, and anyone who clicks "Stop emails" never gets another one about that event.

## Part 10: Sell prints and photo books (optional, about 10 minutes)

Hosts pick photos on their Photos tab and pay through Stripe, and Stripe collects the shipping address. You order the prints or book from any photo lab and have it shipped to the host. You keep the difference.

1. Choose a lab you like (for example a local shop, or an online lab that ships straight to the customer). Look up its current price for 4×6 prints and a 20-page hardcover book, including shipping.
2. Set your prices well above that cost. Prints often sell for about $1 each and books for $60–90.
3. GitHub → your repo → **Settings → Secrets and variables → Actions → Variables** → add **PRINT_PRICE** (for example `1`) and/or **BOOK_PRICE** (for example `79`). Leave one out to offer only the other.
4. **Actions → Deploy Rememberoll Cloud → Run workflow.**
5. To test, in Stripe test mode, open an event's **Photos** tab, pick a few photos and order prints. Use card `4242 4242 4242 4242`.
6. When an order comes in: open **admin.html** → **Owner: print orders** → **Download photos** → upload them to your lab with the customer's address → **Mark shipped** and paste the tracking number. The host sees the status on their Photos tab.

Notes:
- Only Cloud events offer this. Encrypted (private storage) events don't, because you can't open their photos.
- It is turned off inside the Google Play app for now, to keep the store review simple. Hosts order on the website. (Play does allow outside payment for physical goods, so this can be turned on later.)
- Shipping is to the US and Canada only. Orders are made to order, so the checkout says all sales are final; still refund in Stripe if a lab ruins an order.

## Part 11: Guest-to-host discount (optional, 5 minutes)

After an event, albums and the "photos are ready" emails can offer guests a discount on their own plan. It's free marketing with no ads.

1. Open **admin.html** → owner partner codes → create a code named **GUEST20** with **20%** discount and **0%** commission.
2. GitHub → **Settings → Secrets and variables → Actions → Variables** → add **GUEST_OFFER_CODE** = `GUEST20`.
3. **Actions → Deploy Rememberoll Cloud → Run workflow.**
4. To stop the offer, turn the code off on the admin page (or delete the variable and deploy).

## Your first sale: step by step

**Week 1: proof**
1. Run one real event with it (a friend's party or one of your wife's clients) for free. Collect: 5 great photos, a screen recording of the TV wall filling up, the highlight video, and a one-line quote from the host.
2. Put the quote and the highlight video on your sales page (send them to me and I'll add them).

**Week 2: warm network (your most likely first buyers)**

3. Write a list of 30 people who'll host something in the next 3 months: engaged couples, people planning a 30th/40th/50th birthday, graduation parties, baby showers, reunions.
4. Send each one a personal text (not a group blast):

   > "Hey! I built an app for [event]: guests scan a QR code and every photo they take lands in your Google Drive, with a live slideshow on the TV and a highlight video the next morning. No app for guests. Want to try it for yours? It's $5 for your event, and I'll set it up with you."

5. Give your own launch code: Owner panel → **Referral partners** → name `Launch`, code `FIRST10`, 10% off, 0% commission, untick the free key. Send people `YOUR-SITE/?ref=FIRST10` and the discount shows on the price. Turn it off when the launch ends.

**Weeks 2–4: planners (your wife's network)**

6. List 15 wedding planners, venues, DJs and photographers she knows.
7. Give each a **free key** (Owner tools → Create a free key) for their next event, in exchange for honest feedback, a testimonial and permission to mention them.
8. Make the ones who like it **referral partners** (see [PARTNERS.md](PARTNERS.md)): they get a code that gives their clients 10% off and earns them 20% of every sale. Or they buy a 12-month key and include events in their packages (they can mark it up).

**Ongoing (30 minutes a day)**

9. Post short videos (TikTok, Instagram Reels, Facebook): "the TV wall filling up live", "the morning-after highlight video", "how guests join in 5 seconds". Real events beat polished ads.
10. Local Facebook groups (wedding planning, moms, event pros): share your real event video when it's allowed. Read each group's rules first.
11. Every printed QR sign already shows your brand to 100+ guests. After each event, ask the host: "Know anyone else hosting something?"
12. Track it in Stripe (sales) and the owner panel (accounts, events, Drive connected, partner sales). Expect the first sale from the warm list or a planner, not from strangers.

**A realistic first goal:** 10 paying hosts. Then decide whether to spend on ads.
