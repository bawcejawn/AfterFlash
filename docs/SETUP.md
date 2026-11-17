# Setup

This takes about 20 minutes. You need a Google account (a personal Gmail or a Workspace account) and this GitHub repository. Nothing costs money.

## 1. Deploy the backend (Google Apps Script)

The backend receives uploads and saves them to **your** Google Drive.

1. Go to <https://script.google.com> and sign in with the Google account whose Drive should hold the photos. For a business, use the business Workspace account.
2. Click **New project** and rename it to `PhotoShare`.
3. Open **Project Settings** (the gear icon) and turn on **Show "appsscript.json" manifest file in editor**.
4. Back in the **Editor**:
   - Replace the contents of `Code.gs` with [`backend/Code.gs`](../backend/Code.gs).
   - Replace the contents of `appsscript.json` with [`backend/appsscript.json`](../backend/appsscript.json).
   - Click **Save**.
5. In the function dropdown at the top, choose **`setup`** and click **Run**.
   - Google asks for permission. Click **Review permissions**, choose your account, then **Advanced → Go to PhotoShare (unsafe) → Allow**. The "unsafe" warning appears because it's your own unpublished script. It only asks for Drive and Sheets access.
   - Open **Execution log**. It prints `NEW ADMIN KEY …`. **Copy that key into a password manager.** It's shown once and only a hash of it is stored. (If you lose it, run `rotateAdminKey` to print a new one.)
   - A `PhotoShare` folder now exists in your Drive.
6. Click **Deploy → New deployment**:
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then copy the **Web app URL**. It looks like `https://script.google.com/macros/s/AKfy…/exec`.

> **Updating the backend later:** paste the new `Code.gs`, then go to **Deploy → Manage deployments → ✏️ Edit → Version: New version → Deploy**. This keeps the same URL. Creating a *new deployment* would change the URL.

> **"Who has access: Anyone"** is required so guests can upload without signing in. It doesn't expose your Drive. Every request must pass the checks in `Code.gs`, and the script can only touch files it created for an event (see [SECURITY.md](../SECURITY.md)).

> **Google Workspace accounts** (e.g. a business domain) get URLs like `https://script.google.com/a/macros/yourdomain.com/s/…/exec`. That's supported. If "Anyone" is missing from the access options, a Workspace admin must allow sharing web apps outside the domain.

## 2. Point the site at your backend

Edit [`site/config.js`](../site/config.js) and paste your Web app URL:

```js
backends: {
  main: 'https://script.google.com/macros/s/AKfy…/exec',
},
```

Commit and push to `main`.

## 3. Turn on GitHub Pages

1. In the repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. The **Deploy site to GitHub Pages** workflow runs on every push to `main` that changes `site/`. You can also run it by hand from the **Actions** tab.
4. Your site will be at `https://<your-user>.github.io/<repo>/`, for example `https://bawcejawn.github.io/PhotoShare/`.

> A custom domain (e.g. `photos.yourstudio.com`) also works: add it under Settings → Pages and turn on **Enforce HTTPS**. The camera needs HTTPS.

## 4. Create your first event

1. Open `https://<your-site>/admin.html` and sign in with the admin key.
2. Fill in **New event** and click **Create event**.
3. **Copy the host link** that appears. It's the key to that event's dashboard and isn't shown again. (If it's lost, the admin page has **New host link**.)
4. Open the host link. From the dashboard you can:
   - **Share**: print the QR sign, download the QR code, copy the guest, TV and album links, and open the Drive folder.
   - **Photos**: approve, hide, delete and review reports.
   - **Guests**: see who's shooting, and block someone if needed.
   - **Settings**: shots per guest, film look, live or develop-later reveal, open and close times, approval mode, event code, and more.
   - **Access**: remember this device, or make a new host link (instantly turns off the old one).

**Test it on your phone first.** Scan the QR code, take a photo, and watch it appear on the TV wall.

## 5. On the day

- **TV wall:** open the TV link on a laptop connected to the screen (HDMI, AirPlay or Chromecast tab cast) or on a smart-TV browser. Click **Start the show** *before* mirroring. Keep the laptop plugged in.
- **Signal:** guests' photos queue on their phones and upload when there's a connection. They can keep shooting with no signal once the page has loaded.
- **Moderation:** with **Approve photos before anyone sees them** on, nothing reaches the wall until you approve it. Reported photos hide immediately.
- **After:** open the Drive folder from the dashboard and download it. Google zips it for you, with every original at full resolution.

## Adding another admin (e.g. a business partner)

Don't share your own admin key. Give each person their own:

1. Sign in to `admin.html` with your key (the one from `setup`). You're the **Owner**.
2. Scroll to **Studio admins**, type their name, and click **Create admin key**.
3. Send them the key privately. It's shown only once.

Admins can create events, see all events, and manage (new host link, delete) the events **they** created. Only the owner can add or remove admins or manage everyone's events. **Remove** turns a key off immediately; their events stay.

## Running more than one studio (scaling)

Each Google account that deploys the backend is a "studio" with its own free Drive storage. Add more studios to `config.js`:

```js
backends: {
  main: 'https://script.google.com/macros/s/AAA…/exec',      // you
  studio: 'https://script.google.com/macros/s/BBB…/exec',    // your wife's Workspace account
},
```

Links for a non-default studio carry `?s=studio`. The admin page shows a studio picker. Only URLs listed in `config.js` are ever contacted, so links can't redirect the app to someone else's server.

When one Drive gets full, create a new Google account (or add Workspace storage), deploy the backend there, and add it as another studio. Older events keep working from their original studio.

## Limits to know about

These are Google's free-tier limits. Workspace accounts are higher. Google publishes the current numbers at <https://developers.google.com/apps-script/guides/services/quotas>.

- **Storage:** 15 GB shared with Gmail and Google Photos on a free account. A photo is about 1–2 MB; a 15-second video about 5 MB.
- **Concurrent requests:** Apps Script runs a limited number of requests at once for each account (about 30). At a big wedding's busiest moment, uploads queue on phones and retry automatically. Nothing is lost, and photos arrive a few seconds later.
- **File sizes:** photos up to 8 MB (the camera produces about 1–2 MB) and videos up to 20 MB.
- **Drive link sharing:** photos are shared "anyone with the link" so they can show in the album and on the TV. Workspace admins sometimes block this. If uploads fail with a sharing error, allow link sharing for the account in the Google Admin console.

## Branding

- `site/config.js → appName` changes the name everywhere.
- Each event has an **accent colour** in its settings.
- The main design tokens are at the top of `site/assets/css/app.css`.

## Troubleshooting

| What you see | Fix |
|---|---|
| Admin page says "Can't reach the backend" | Check the URL in `config.js` ends in `/exec`, and the deployment's **Who has access** is **Anyone**. |
| "The backend didn't answer correctly" | Same as above, or the code didn't save. Open Apps Script, check `Code.gs` has no red errors, then **Manage deployments → Edit → New version**. |
| Admin key rejected | Run `rotateAdminKey` in Apps Script and use the new key from the execution log. |
| Uploads fail with a sharing error | Workspace accounts: allow "Anyone with the link" sharing in the Google Admin console. |
| Changes to `Code.gs` don't take effect | Every code change needs **Manage deployments → Edit (pencil) → Version: New version → Deploy**. |
| Site still shows old behaviour after a push | Wait for the Pages workflow to finish (Actions tab), then reload twice: the offline cache updates on the next visit. |
