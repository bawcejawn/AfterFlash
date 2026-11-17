# PhotoShare

A shared disposable camera for weddings, parties and other events. Guests scan a QR code, take photos from their phone's browser, and every photo lands in one album stored in **your** Google Drive. There's no app to install, guests don't need accounts, and it costs nothing to run.

- **Live site:** https://bawcejawn.github.io/PhotoShare/
- **Studio sign-in (create events):** https://bawcejawn.github.io/PhotoShare/admin.html

---

## Contents

1. [What you get](#what-you-get)
2. [One-time setup (about 20 minutes)](#one-time-setup)
3. [Run an event](#run-an-event)
4. [Add another admin](#add-another-admin)
5. [Update the backend when the code changes](#update-the-backend)
6. [Troubleshooting](#troubleshooting)
7. [Keep it safe](#keep-it-safe)
8. [For developers](#for-developers)

---

## What you get

| Page | Who uses it | What it does |
|---|---|---|
| **Camera** (`cam.html`) | Guests | Opens when they scan the QR code. A limited roll of shots, film looks, short videos. Works on weak signal: photos upload when there's a connection. |
| **Album** (`album.html`) | Guests | Browse, download and report photos. **Enhance** toggle (an automatic touch-up; originals never change), **Hosts’ picks**, **My photos** (each guest’s own shots, even before the reveal), and the **Guestbook**. |
| **TV wall** (`tv.html`) | A TV or projector | New photos appear in seconds, with the QR code beside them. |
| **Host dashboard** (`host.html`) | The host | QR sign, moderation, **♥ favorites** (shown more often on the TV, one-click download), **blurry-photo flags**, guestbook moderation, guests, settings. |
| **Studio admin** (`admin.html`) | You | Create and delete events, add admins. |

Photos are stored in your Google Drive (15 GB free). Location data is removed from every photo.

---

## One-time setup

You need a Google account (personal Gmail or a Workspace business account). Do this on a computer.

### Step 1: Create the backend in Google

1. Go to **https://script.google.com** and sign in with the Google account whose Drive should hold the photos.
2. Click **New project**. Click **Untitled project** at the top and rename it **PhotoShare**.
3. On the left, click the **gear icon** (Project Settings). Tick **Show "appsscript.json" manifest file in editor**.
4. On the left, click the **`< >` icon** (Editor).
5. Click **Code.gs**. Select everything (**Ctrl+A**, Mac **Cmd+A**) and delete it.
6. Open [backend/Code.gs](backend/Code.gs), click the **copy raw file** button (two overlapping squares, top right), and paste into Code.gs.
7. Click **appsscript.json** and replace its contents the same way with [backend/appsscript.json](backend/appsscript.json).
8. Press **Ctrl+S** (Mac **Cmd+S**) to save.

### Step 2: Run setup and save your admin key

1. At the top, in the dropdown next to **Run**, choose **setup**, then click **Run**.
2. Google asks for permission: **Review permissions** → pick your account → **Advanced** → **Go to PhotoShare (unsafe)** → **Allow**.
   - "Unsafe" only means it's your own private script, not a published app. It asks for access to Drive and Sheets only.
3. The **Execution log** at the bottom shows `NEW ADMIN KEY: …`.
   **Copy that key into a password manager now.** It's shown only once.
   - Lost it? Choose **rotateAdminKey** in the dropdown, click **Run**, and use the new key it prints.

### Step 3: Publish the backend

1. Top right: **Deploy** → **New deployment**.
2. Click the **gear** next to "Select type" and choose **Web app**.
3. Set:
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**, then click **Copy** under **Web app URL**. It ends in `/exec`.

### Step 4: Connect the website to the backend

1. On GitHub, open [site/config.js](site/config.js) and click the **pencil icon** to edit.
2. Replace the address after `main:` with your Web app URL, keeping the quotes:
   ```js
   main: 'https://script.google.com/macros/s/AKfy…your-id…/exec',
   ```
3. Click **Commit changes**.
4. Open the **Actions** tab. Wait for **Deploy site to GitHub Pages** to show a green check (about a minute).

> If you forked this repo, also turn on Pages once: **Settings → Pages → Source: GitHub Actions**.

### Step 5: Check it's connected

Open the studio sign-in page. Under the **Sign in** button it should say **"Backend connected"**. If it doesn't, see [Troubleshooting](#troubleshooting).

---

## Run an event

### Create the event
1. Open **admin.html** and sign in with your admin key.
2. Fill in **New event** (name, date, shots per guest, reveal) and click **Create event**.
3. **Copy the host link** and save it. It's the key to that event's dashboard.
4. Click **Open dashboard**.

### Private events (optional)
Tick **Private storage** when you create an event if the photos must stay private even from people who can open your Google Drive (a co-admin, a shared Drive, a synced computer, a hacked Google account).

- Every photo, video and voice message is **locked (encrypted) on the guest's phone** before it uploads. Drive only ever holds `.enc` files that look like random noise.
- The app (album, TV wall, host dashboard) unlocks them for people who have the event link. Nothing changes for guests.
- It can't be switched on or off later. Normal events are unchanged.
- **After the event:** on the host dashboard **Share tab**, click **Download all (unlocked)**. (Downloading the Drive folder gives you locked `.enc` files.)
- **Back up the keys:** on **admin.html**, under **Private event keys**, click **Download key backup** after you create a private event. Save the file somewhere offline (a USB stick). Treat it like a password: anyone with it and the Drive files can open the photos.
- **If the backend is ever gone:** download the Drive folder, then run `node scripts/unlock-folder.mjs key-backup.json EVENTCODE path/to/folder` to unlock every file on your computer.

### Before the event (dashboard)
- **Settings tab:** the Enhance button and the Guestbook are on by default; turn either off under **Safety and privacy**.
- **Settings tab:** set **Album closes** to after the party ends. Choose **Live** or **Develop later**. For a public screen, turn on **Approve photos before anyone sees them**.
- **Share tab:** click **Print sign** for the tables. The **event code** is shown there too; guests can type it on the home page instead of scanning.
- **Test it yourself:** scan the QR code with your phone and take a photo.

### On the day
1. **TV:** open the **TV wall** link (Share tab) on a laptop connected to the TV. Click **Start the show** *before* you mirror or cast. Keep the laptop plugged in.
2. **Guests:** they scan the QR code → type a name (optional) → **Open the camera** → shoot.
3. **Moderate** from the **Photos** tab: show, hide or delete. Reported photos hide automatically until you decide.

### After the event
Open the **Google Drive folder** (link on the Share tab) and download it. Google zips every original at full resolution. For a **private** event, use **Download all (unlocked)** on the Share tab instead.

### Which link goes to whom

| Link | Share with | Can they change anything? |
|---|---|---|
| QR code / guest link / event code | Guests | No. They can only take photos and report. |
| TV wall link | The screen | No. View only. |
| Album link | Guests | No |
| **Host link** | **Only a trusted co-host** | **Yes, everything for that event.** If it leaks: **Access → Make a new host link**. |
| **Admin key** | **Nobody**; give others their own | Yes, studio-wide |

---

## Add another admin

Don't share your admin key. Give each person their own:

1. Sign in on **admin.html**. It should say **Signed in as Owner**.
2. Scroll to **Studio admins**, type their name, and click **Create admin key**.
3. Send them the key privately. It's shown once.

Admins can create events and manage the events they created. Only the owner can add or remove admins. **Remove** turns their key off immediately.

---

## Update the backend

Do this whenever `backend/Code.gs` changes:

1. Open [backend/Code.gs](backend/Code.gs) and click **copy raw file**.
2. Go to **script.google.com** → **PhotoShare** → **Code.gs**.
3. **Ctrl+A** → **Delete** → **Ctrl+V** → **Ctrl+S** (Mac: use **Cmd**).
4. **Deploy** → **Manage deployments** → **pencil icon** → **Version: New version** → **Deploy** → **Done**.

The web address stays the same, so there's nothing to change in `config.js`.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Sign-in page says it can't reach the backend | Check `site/config.js` has your URL ending in `/exec`, and the deployment's **Who has access** is **Anyone**. |
| Opening the backend URL shows "Sorry, unable to open the file" | You're signed into several Google accounts. Open it in a private window. Guests aren't affected. |
| Admin key rejected | Run **rotateAdminKey** in Apps Script and use the new key. |
| Code changes don't take effect | You must publish a **New version** (see [Update the backend](#update-the-backend)). |
| Uploads fail with a sharing error (Workspace) | A Google Workspace admin must allow "Anyone with the link" sharing. |
| Site looks out of date after a change | Wait for the green check in **Actions**, then reload the page twice. |
| Photos are in the Drive folder but not in the album | Dashboard → **Photos** → **Find missing photos**. It adds them once and skips duplicate copies. |
| Photos won't open in Google Drive (but download fine) | You're signed into several Google accounts. Open Drive in a private window, or a Chrome profile with only the PhotoShare account. |
| A guest's photos aren't uploading | They're saved on the phone and upload automatically when there's signal. Ask them to keep the page open for a moment. |

---

## Keep it safe

- Keep your **admin key** in a password manager. Never post it or paste it into chats.
- Share **host links** only with people who should moderate.
- Turn on 2-step verification for the Google account that owns the backend.
- For events with strangers or a public screen, turn on **Approve photos before anyone sees them**.

More detail: [SECURITY.md](SECURITY.md).

---

## Optional: Koinos blockchain archive

You can store a permanent record and a tamper-proof fingerprint of each album, plus phone-quality copies, on the Koinos blockchain. Full-size photos stay in Drive. This is off until you deploy the contract. See [docs/KOINOS.md](docs/KOINOS.md).

---

## For developers

```
site/        static website (deployed to GitHub Pages automatically)
backend/     Google Apps Script backend (Code.gs + appsscript.json)
contract/    Koinos smart contract (AssemblyScript), build + tests
scripts/     CLI: deploy-contract, archive-album, recover
test/        backend unit tests, local test server, browser end-to-end test
docs/        SETUP, KOINOS, ARCHITECTURE
```

```bash
node test/backend.test.mjs            # backend tests (real Code.gs, mocked Google services)
(cd contract && npm ci && npm test)   # contract build + tests
node test/server.mjs 8787             # run locally at http://localhost:8787 (fake backend)
python3 test/e2e.py                   # end-to-end browser test (needs the local server)
```

There's no build step and no CDN scripts. Third-party code is vendored and checksum-verified (`scripts/vendor.sh`). CI runs everything on every pull request.

**More docs:** [docs/SETUP.md](docs/SETUP.md) (full setup and scaling), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it works), [SECURITY.md](SECURITY.md)

## License

MIT
