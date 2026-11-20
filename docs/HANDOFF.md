# Rememberoll: handoff for the next chat

Last updated: Nov 18, 2026 (home screen + repo rename). Read this first, then docs/CHECKLIST.md (the owner's to-dos).

## About the owner (how to work with them)

- A beginner developer who works in finance. Wants **simple, specific, step-by-step instructions**, plain words, short answers, and straight talk about risks ("don't cut corners, be straight").
- Has given permission to **read, write, push PRs and merge**, in as few PRs as possible.
- Top priority is **security**. Never ship anything that could expose users, guests, the repo or links to malware or abuse.
- Their wife is a wedding planner: a likely first customer and sales channel.
- The repo is **public** again and renamed **bawcejawn/AfterFlash** (Nov 18). The free site is at https://bawcejawn.github.io/AfterFlash/.

## What Rememberoll is

A PartyCam-style event camera. Guests scan a QR code and shoot a limited "roll" in their phone's browser, with film looks, Beauty and a date stamp. There's a live TV photo wall, a guestbook with voice notes, moderation, and a highlight video. **Photos are saved to the host's own Google Drive.**

Two ways to run it, from one codebase:

1. **Free self-hosted:** the static site in `site/` on GitHub Pages, with a Google Apps Script backend (`backend/Code.gs`, version 1.13.0) in the host's own Google account. Friends can self-host through `setup.html`.
2. **Rememberoll Cloud (paid):** a Cloudflare Worker in `cloud/` that serves `site/` plus `/api`, with a D1 database (SQLite), the Google Drive API (`drive.file` scope only) and Stripe Checkout (no webhooks; the thank-you page verifies the session). The site switches to cloud mode via `config.cloud`.

Naming history: **PhotoShare** → **AfterFlash** (Nov 18) → **Rememberoll** (Nov 19). PhotoShare was dropped because "PHOTOSHARE" is a live US trademark (Switchmate Home LLC, reg. 6720657, classes 9/42). AfterFlash was dropped because an "Afterflash" photo/camera app launched in the App Store in Sept 2026, plus an "AFTERFLASH®" browser photo booth and a German AfterFlash skincare mark. FizzRoll was rejected (Fizz Social sues over "Fizz" in event apps); Unityroll was runner-up. Closest name to Rememberoll found: "Memory Roll" (getmemoryroll.com, a competing event camera). The owner should buy rememberoll.com and rememberroll.com and get an attorney's clearance before printing or recruiting partners. Only display text changed. Internal ids stay `photoshare` on purpose: worker name, D1 names `photoshare` and `photoshare-shard-N`, `ps:` localStorage keys, health id `app: 'photoshare'`. The GitHub repo is still named `AfterFlash` (renaming it changes the free site's address).

## Business model (as decided with the owner)

- **Plans** (one-time payments, nothing renews):
  - **$5:** 1 event, usable for 30 days. Deleting it doesn't free the slot. Buying again adds 1 more event.
  - **$10:** 1 month, unlimited events.
  - **$30:** 12 months, unlimited events.
  - **Lifetime:** only the owner can give it (free keys for friends and partners).
  - Prices come from `PRICE_EVENT` / `PRICE_MONTH` / `PRICE_YEAR` (dollars). Checkout uses Stripe `price_data`, so there are no Stripe products.
- **All sales final.** Terms, FAQ and checkout say so. The owner's goodwill tool is **Add days**.
- **When a plan ends:** the host can still sign in and back up keys. Hosting and new guest photos pause; guests' phones keep the photos and retry. Album links stay online for **12 months** after the plan ends, then show "archived".
- **No storage margin.** Storage is the customer's own Google Drive; we never resell it.
- **Referral partners (3 tiers):** owner → tier 1 → tier 2 → tier 3.
  - Each code gives buyers 10% off. The seller earns 20% of what the buyer paid, renewals included.
  - The team bonus (`OVERRIDE_PCT`, default 5%) is split evenly among the partners above the seller, never the owner.
  - Tiers 1 and 2 make single-use invite links (`partner.html#invite=…`, 14 days). Invitees accept the agreement and get a **partner-only key**, which can't host until they buy a plan.
  - Legal locks (FTC MLM guidance): joining is free, inviting pays $0, partners' own purchases earn nobody anything (signed in, or the partner's own email at checkout), and 3 tiers maximum.
  - Payouts are manual. Money is "ready" 14 days after a sale; partners request at **$25** (Venmo, PayPal, Zelle, Cash App or Check). The owner pays, then marks **Paid**. Voiding a chargeback reverses its team bonuses. There's a CSV export for 1099s (threshold $2,000 for 2026 payments).
  - The owner can record **cash sales**, which make a key and credit a code.

## Code map

- `site/`: static site, no build step, vanilla ES modules with a strict CSP (no inline scripts or styles).
  - Pages: `index` (sales + join), `cam` (guest camera), `album`, `tv`, `host` (event dashboard), `admin`, `welcome` (after paying), `partner` (join a team), `help` (FAQ with search), `terms`, `privacy` (`legal.js`), `setup` (self-host).
  - Home screen (PWA): `manifest.webmanifest` (SVG + PNG + maskable icons), `apple-touch-icon.png`, `sw.js` (offline shell; bump VERSION when adding files the camera needs). `install.js` has the shared "Add to home screen" dialog and remembers the last dashboard used (`ps:last`: page, studio, event code, never a key). `home.js` sends the icon there once per launch; a host place counts only if the host ticked "Remember me".
  - Front page: `index.html` + `assets/css/home.css` (cobalt hero with a pile of illustrated prints in `assets/img/prints/`; no real photos yet). Swap in real event photos once the owner sends them.
  - Photo quality (Nov 18): on phones **HD is on by default**: the shutter opens the phone's own camera app, which gets the phone's HDR/night processing that browsers can't use. New events default to the **Original** look with light Beauty (0.3).
  - Key JS: `cam.js` (full-res ImageCapture on Android, HD native camera on iOS, in-app browser warning), `film.js` (looks, encodeBest/encodePreview), `cloud-admin.js` (plan, partner, owner, partners, health panels), `home.js` (pricing, referral codes), `help.js`.
- `cloud/src/`: `index.js` (routes, config.js, OAuth, the `scheduled` cron), `actions.js` (all API actions, plans, referrals, tiers, payouts, nightly cleanup, health), `stripe.js`, `google.js`, `lib.js`.
- `cloud/migrations/` (0001–0005, main DB) and `cloud/migrations-shard/` (guests, media and notes tables for extra DBs).
- `cloud/scripts/deploy.mjs`: run by `.github/workflows/cloud.yml`. Creates and binds D1 databases and shards, applies migrations, deploys, sets secrets. Never prints secrets.
- `backend/Code.gs`: the Apps Script backend (self-host mode).
- `docs/`: LAUNCH (paid setup, Parts 1–8), PARTNERS, SCALING, CHECKLIST, SETUP/README (self-host), ARCHITECTURE. `contract/` and KOINOS.md are a leftover Koinos feature, removed from the UI.

## Look + captions + photo challenges (built Nov 20)

- **Look:** a "brand pass" at the end of `app.css`: cobalt header band on every app page (`body:not(.home) .topbar`), flat white panels on a cool mist page, cobalt primary buttons, colour-block tiles on the app home, stationery-style invitation card. Event pages still use each event's own accent.
- **Captions:** guests tap **Aa Caption** on the camera; the caption rides with the next shot (`caption`, max 80, cleaned). Shown on album tiles, the lightbox and the TV wall. Off for private-storage events. Hosts can **Remove caption** per photo (`hostClearCaption`). Setting `captions` (default on).
- **Photo challenges:** setting `challenges: { on, list }` (up to 15 prompts, "Use our ideas" fills 15). The camera shows one prompt; **Shoot it** tags the next photo, then moves to the next prompt. The server only accepts a challenge that is in the host's list. The album shows challenge filter chips; the host grid shows the tag.
- **Messages (email):** Cloud only sends email when `RESEND_API_KEY` (secret) and `MAIL_FROM` (variable) are set (LAUNCH Part 9); otherwise hosts get "Use your own email app" BCC links and "Copy all emails" (also the only option on self-host). Code: `cloud/src/mail.js` (Resend batch API, escaped HTML), actions `hostMessages`, `hostAddInvitees`, `hostRemoveInvitee`, `hostSend` (10/hour, 1-hour cooldown per kind, 600 emails per event per day, 1000 invitees max, needs an active plan), public `unsubscribe` (24-char token, opt-out is permanent). Tables `invitees` and `msg_log` (migrations 0008 / shard 0004). The hourly cron `17 * * * *` runs `autoMessages`: reminder from 3 days before reply-by, camera from 1h before start, photos/thank-you 16h–7 days after. Settings `messages: {autoReminder, autoCamera, autoPhotos, thanks}`. `safeUrl` allows only `mailto:?` links (BCC, no address in "to").
- **Storage:** Cloud migration 0007 + shard 0003 (`media.caption`, `media.challenge`); self-host `MEDIA_COLS` gained `caption`, `challenge` (Code.gs 1.12.0).

## The phone app (built Nov 19; see docs/APP-STORES.md)

- **`app.html` + `app.js`:** the app home, and the manifest's `start_url`. A "Continue" card (last camera within 3 days, or last dashboard), then big tiles: **Scan a code**, **My events**, **Host**, **Partner** (paid version only). Hash routes `#scan`, `#mine`, `#host`, `#partner`; long-press shortcuts in the manifest.
- **Scanner:** `BarcodeDetector` where available, otherwise vendored **jsQR** (`assets/vendor/jsQR.js`, Apache-2.0). `safeTarget()` only opens a bare event code or a link to our own pages on the **same origin**, so a fake QR sticker can't send guests elsewhere.
- **What the phone remembers** (`install.js`): `ps:places` (dashboards: page, studio, event code, name; never a key; a host place needs "Remember me"), `ps:g:*` (events joined), `ps:rsvp:*` (invitations replied to, with the event name and answer).
- **index.html** in standalone mode jumps to the app home once per launch; tapping the logo anywhere comes back.
- **Google Play prep:** the worker serves `/.well-known/assetlinks.json` from the GitHub variables `ANDROID_PACKAGE` and `ANDROID_CERT_SHA256` (validated in deploy and at request time). `inStoreApp()` (util.js) detects the Play wrapper (an `android-app://` referrer) and **hides plan purchases** there (Play Billing rules).
- **Not done:** the actual Play listing (needs the final name, the domain and the owner's Play account) and Apple (needs $99/yr, a Mac, and review).

## Invitations + RSVPs (built Nov 19)

- **Host:** the **Invitations** tab on the host dashboard. Turn it on, fill in hosted by, start/end time, venue + address (Maps button), dress code, a note (line breaks kept), cover photo, RSVP deadline and a guest limit (counts plus-ones and children). Questions the host can turn on: selfie with the reply (default on, host-only), plus-ones with names (max party 1–10), children count, a meal per person (up to 4 choices), dietary needs, song request, a message. Optional "Who's coming" shows first name + last initial of Yes guests (never photos). Replies list with totals, meal counts, search, filters, delete, and CSV (formula-injection guarded).
- **Guest:** `invite.html?e=…`. Anyone with the link can RSVP (Yes / Maybe / No). The browser makes a private edit token (`rt`); only its SHA-256 is stored. The private link `invite.html#r=<id>.<token>` lets them edit from another device (moved into localStorage, then removed from the address bar). Calendar buttons (.ics download + Google Calendar). From 2 hours before the start (or once the camera opens) the page shows a big "Open the camera" button. The guest's RSVP name pre-fills the camera's name box.
- **Server rules (both backends):** invite must be on; deadline blocks new replies and edits; the guest limit is checked against other Yes replies; 60 RSVPs per event per minute; 3,000 replies per event; selfies are JPEG only, ≤ 1 MB, EXIF stripped, saved private in `RSVP photos (private)` in the host's Drive, and never shown to anyone but the host; no selfies on private-storage (encrypted) events; retries with the same browser id update instead of duplicating.
- **Storage:** Cloud: `rsvps` table (main DB migration 0006 + shard migration 0002), `events.rsvp_folder`, `events.cover`; nightly cleanup purges `rsvps` with the rest. Self-host: an `rsvps` tab in each event's sheet; cover in Script Properties (`COVER:<id>`).
- **Actions:** public `invite`, `rsvp`, `cover`; host `hostRsvps`, `hostRsvpPhoto`, `hostRsvpDelete`, `hostSetCover`. Settings live in `settings.invite` (sanitized by `sanitizeInvite`).
- **Not built yet:** emailing or texting invitations and reminders (needs an email provider), per-household private links (the owner chose open links).

## Scaling (built Nov 18; see docs/SCALING.md)

- Each event has `events.shard`: `''` means the main DB; `SHARD_1`…`SHARD_99` are extra D1 databases bound to the worker. All guests, media and notes queries go through `S(c, ev)`. New events go to `ACTIVE_SHARD` if that database is bound.
- The deploy reads GitHub variables `SHARDS` (0–20) and `ACTIVE_SHARD`. It never unbinds an existing shard.
- **Nightly cron (7:17 UTC):** clears the photo index of albums past the 12-month hold and of deleted events (sets `events.purged`), plus expired rate, oauth and invite rows and problem logs older than 90 days. Batches of 200. A renewed purged album is rebuilt with **Find missing photos**, with photos coming back *pending* so hidden ones don't reappear.
- **Owner: system health** panel shows DB sizes against 10 GB, events and photos per DB, and the last cleanup. It warns at 70% and 85%, and has a "Run cleanup now" button.

## How to work in this repo

- Clone with `gh` or git. The repo is `bawcejawn/AfterFlash` (public; GitHub forwards the old PhotoShare name).
- **Tests (run all before every PR):**
  - `cd cloud && npm test`: API tests on node:sqlite with fake Google and Stripe (16 tests).
  - `cd cloud && bash test/run-e2e.sh`: Playwright browser test of the whole cloud flow, including referrals, tiers and help.
  - `cd cloud && npx wrangler deploy --dry-run --outdir /tmp/wr`.
  - `node test/backend.test.mjs`: Apps Script backend tests (50).
  - `node test/server.mjs 8787 &` then `python3 test/e2e.py`: self-host browser test.
- **Commits:** `git -c user.name="bawcejawn" -c user.email="bawcejawn@users.noreply.github.com" commit`, ending with the Co-Authored-By / Claude-Session lines the session gives you.
- **Push:** `git -c push.negotiate=true push -u origin BRANCH`. Always branch from a **fresh** `origin/main`: `git fetch origin '+refs/heads/main:refs/remotes/origin/main'`. A plain `git fetch` once returned a stale main.
- **PRs:** `gh api repos/bawcejawn/AfterFlash/pulls -f title=… -f head=… -f base=main -F body=@file`. Wait for CI to pass, then `gh api -X PUT …/pulls/N/merge -f merge_method=squash`. Then check that **Deploy Rememberoll Cloud** and **Deploy site to GitHub Pages** succeed.
- **Never reuse a branch that was already squash-merged** (it causes conflicts). Make a new one.
- **The proxy blocks:** deleting branches, changing repo settings and reading Pages settings. Ask the owner to do those.
- **Security habits already in place:**
  - Rate limits on keys, codes and invites. Owner-only actions are checked server-side.
  - Hashed keys and invite tokens. The DATA_KEY-encrypted Google refresh token.
  - EXIF/GPS stripping, magic-byte file checks, a strict CSP, `safeUrl` for links, and a formula-injection guard in the CSV export.
  - Keep doing all of this.

## Next in line (suggested order)

1. **Help the owner through docs/CHECKLIST.md**: free-site decision, branch cleanup, name clearance, LLC, then LAUNCH.md Parts 1–8. Walk through it step by step when asked.
2. **Email/text invitations and reminders:** send the invite and RSVP reminders by email (Resend) or text. Pairs with item 5.
3. **Their own storage (asked Nov 18):** customers who already pay for Dropbox or OneDrive could link those instead of Google Drive.
   - Both have APIs with app-folder-only access: Dropbox "App folder" permission; OneDrive `Files.ReadWrite.AppFolder` and `approot`.
   - iCloud and Amazon Photos have no public upload API, so they can't be supported.
   - The work: a storage-provider interface in `cloud/src` (today it's `google.js`), per-provider OAuth plus upload, share and list calls, a provider picker in the Drive panel, and each provider's developer app registration and review (Dropbox production approval; Microsoft publisher verification).
   - Do Dropbox first, and only once customers ask.
4. **Stripe Connect** for automatic partner payouts and 1099s, once there are more than about 20–30 partners. It costs $2 per active partner a month plus 0.25% + 25¢ per payout.
5. **Reminder emails** before a plan ends (needs an email provider, e.g. Resend). Today the admin page warns 7 days before.
6. **Testimonials and real event media** on the home page once the owner sends them.
7. Optional: remove the leftover `contract/` (Koinos) folder and its CI check.

## Open questions for the owner

- Final name: Rememberoll, pending attorney clearance and domain purchase.
- Legal business name for `BUSINESS_NAME`, once the LLC is formed.

---

## First prompt for the new chat (copy and paste this)

> I'm continuing my Rememberoll project (an event camera and invitation app, formerly AfterFlash and PhotoShare) in my GitHub repo **bawcejawn/AfterFlash**. Please add the repo, clone it, and read **docs/HANDOFF.md** first, then **docs/CHECKLIST.md**. They explain the whole project, how I like to work (beginner, simple step-by-step instructions, security first, you may push PRs and merge, as few PRs as possible), what's built, and what's next.
>
> After reading, give me: (1) a 5-line summary of where things stand, (2) my next 3 to-dos from the checklist with exact click-by-click steps, and (3) the top item from "Next in line" that you'd build next and why. Don't start building until I say go.
