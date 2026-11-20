# The phone app and the app stores

## Today: the installable app (free, iPhone and Android)

- The app lives at **`/app.html`** on your site. Share that link (or the QR code from **Share … with someone** on the app home).
- People open it and tap **Get the app**. On iPhone: Safari → Share → **Add to Home Screen**. On Android: Chrome → **Install app**.
- The icon opens the app home: **Scan a code**, **My events**, **Host** and **Partner** (the Partner tile only shows on the paid version).
- Updates are instant. There's nothing to review or resubmit.

## Google Play (when the name is final)

The Play version is the same app in a thin Android wrapper (a "Trusted Web Activity"). Do this
**after** the name is locked in and the paid version is live on your own domain (LAUNCH.md Parts 1–4),
because the Android package name can never change.

### Before you start
1. Set the GitHub variable **`APP_NAME`** to the final name (**Settings → Secrets and variables → Actions → Variables**) and tell Claude, so the site text matches.
2. Pick the account type:
   - **Organization** (recommended once the LLC exists): needs a free **D-U-N-S number** from Dun & Bradstreet (can take up to 30 days). New organization accounts don't need the 14-day tester period.
   - **Personal**: faster to open, but before going public you must run a **closed test with at least 12 testers for 14 days in a row**. Line up 15–20 friends and family with Android phones.
3. Have about **$25** (one-time Google fee).

### Steps
1. **Create the developer account:** go to **play.google.com/console** → sign up → pay $25 → verify your identity.
2. **Build the app package:** go to **pwabuilder.com** → type `https://YOUR-DOMAIN/app.html` → **Start** → **Package for stores** → **Android** → **Generate package**. In **Options**:
   - **Package ID:** `com.yourname.app` (lowercase; this can **never** change).
   - **App name / Launcher name:** your final name.
   - **Signing key:** *Create new*.
   - Download the zip. It holds the `.aab` file and a **signing key** with its passwords: save the key file and passwords in your password manager. Never put them in GitHub.
3. **Create the app in Play Console:** **Create app** → name → *App* → *Free* → accept the declarations.
4. **Upload to a closed test:** **Testing → Closed testing → Create track** → **Create new release** → upload the `.aab` → add testers (an email list) → **Review release → Start rollout**.
5. **Connect the app to your site** (this removes the browser bar inside the app):
   - Play Console → **Setup → App integrity → App signing** → copy the **SHA-256 certificate fingerprint** of the *App signing key*.
   - Also copy the SHA-256 from the `signing-key-info.txt` file in the PWABuilder zip.
   - GitHub → **Settings → Secrets and variables → Actions → Variables** → add:
     - `ANDROID_PACKAGE` = your package ID (for example `com.yourname.app`)
     - `ANDROID_CERT_SHA256` = both fingerprints, separated by a comma
   - Run **Actions → Deploy … Cloud → Run workflow**.
   - Check that `https://YOUR-DOMAIN/.well-known/assetlinks.json` shows your package and fingerprints.
6. **Test it:** install from the closed-test link on an Android phone. If you still see an address bar at the top, the fingerprints don't match; check step 5.
7. **Fill in the store listing:** short and full description, the icon (`site/assets/img/icon-512.png`), a 1024×500 feature graphic, 2–8 phone screenshots, and your privacy policy link (`https://YOUR-DOMAIN/privacy.html`). Also complete **Data safety**, **Content rating** and **Target audience**. Choose 13+, not a kids' audience: children's apps have extra rules.
8. **Go public:** personal accounts can **Apply for production** after the 14-day test. Then Google reviews the app (usually a few days).

### Purchases in the Play app
Google requires its own billing for digital purchases inside Play apps. So the **Play version
doesn't sell plans**: the buy buttons are hidden there, and everything else (camera, invitations,
host dashboard, partner page) works the same. Customers buy on the website. The rules about
pointing people to outside payment have been changing, so ask Claude to check before adding any
"buy on our website" link inside the Play app.

## Apple App Store (later, optional)
Needs the Apple Developer Program (**$99 a year**), a **Mac with Xcode** (PWABuilder can make the iOS
project) and Apple's review. Apple rejects apps that are "just a website", so it isn't guaranteed even
with the camera and scanner features. Until then, iPhone users add the app to their home screen from
Safari, which works well.
