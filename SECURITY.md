# Security

PhotoShare is built for a hostile internet: anyone can find a guest link, and the backend is a public URL. This page explains the protections and how to report problems.

## Secrets and who holds them

| Secret | Holder | Grants | Stored as |
|---|---|---|---|
| Owner admin key | Studio owner | Everything below, plus add/remove admins and manage every event | SHA-256 in Script Properties |
| Additional admin keys | People the owner adds | Create and list events; reissue host links and delete only their own events | SHA-256 in Script Properties (revocable individually) |
| Host key | Hosts (e.g. the couple, a planner) | One event: settings, moderation, guests, originals | SHA-256 in the index sheet |
| Wall key | TV screens | View one event's wall even when guest browsing is off | Derived from the host key hash; rotating the host key rotates it |
| Guest token | One phone | Upload and report in one event | SHA-256 in the event sheet |
| Private event key | Backend (Script Properties `EK:<event>`), owner's offline backup | Unlock one private event's files | AES-256 key; given to joined guests (to lock uploads), the host dashboard and the TV wall |
| Koinos keys | You, on your computer or in Kondor | Contract upgrade (contract key), event writes and mana (owner/payer) | **Never** in the site, backend or repo |

- All keys are 192–256-bit random values. Comparisons are constant-time.
- Host and wall keys travel in the URL **fragment** (`#k=…`), which browsers never send to servers or in `Referer` headers. The dashboard removes it from the address bar right after loading.
- Every page sets `<meta name="referrer" content="no-referrer">`.
- Failed admin, host and event-code attempts are rate-limited.

## Backend (Apps Script) protections

- **No path to the rest of your Drive.** Every Drive file ID in a request is looked up in that event's own media index before use, so a host key for event A can't read or delete files from event B or anything else in the Drive. This is covered by tests.
- **Uploads are verified by content, not by what the client claims.** Photos must be JPEG (magic bytes) and videos MP4 or WebM; anything else is rejected. File names and MIME types are set by the server.
- **Metadata stripping:** EXIF, GPS, XMP and comment segments are removed from every JPEG on the server, even if a modified client sends them.
- **Size limits:** 8 MB photos, 20 MB videos, 400 KB previews, 30 MB request bodies.
- **Abuse limits:** shot limits per guest are reserved under a lock (parallel uploads can't exceed the roll), with idempotent retries, per-guest and per-event upload rate limits, a guest cap that only counts guests who actually upload, an event-wide total cap, and limits on reports per guest.
- **Formula injection:** text written to Google Sheets is cleaned (leading `= + - @` removed, control characters and `<>` stripped). Transaction IDs must match a hex pattern.
- **No stack traces or internal IDs** are returned to clients. Public responses never include folder, sheet or host data.
- Unknown actions are rejected via an explicit allowlist (including `__proto__`-style names).
- Hidden, reported and pending photos are switched to **private** in Drive, so a previously seen link stops working.

## Website protections

- **Strict Content-Security-Policy** on every page: `script-src 'self'`, no inline scripts or styles, no third-party origins except Google Drive images and the Apps Script endpoint. The two Koinos pages (`archive.html`, `recover.html`) additionally allow `'unsafe-eval'` (koilib's protobuf code generation needs it) and `https://api.koinos.io`. The guest, host, admin, album and TV pages do not.
- **No `innerHTML`.** All text is inserted with `textContent` through a single helper, and URLs are filtered to `http(s)`, `blob:` and image `data:` schemes.
- **Frame-busting** on every page (GitHub Pages can't send `X-Frame-Options`).
- **Backend allowlist:** the site only talks to backend URLs listed in `config.js`. A link's `?s=` can only pick one of those, so a crafted link can't send guests' photos elsewhere.
- **No CDNs:** third-party libraries are vendored and checked against their npm releases (`scripts/vendor.sh`, run in CI).
- The service worker caches only the site's own files and never API or Drive responses.
- Recovered keepsakes are rendered only after their bytes pass the same image magic-byte check the contract enforces.

## Smart contract protections

- Every write requires the owner's authority (`System.requireAuthority`, with the SDK's enhanced caller check).
- Events are keyed by owner + event ID, so there's no squatting or overwriting another owner's event.
- Strict input validation: event ID charset and length, 32-byte roots, keepsake MIME allowlist with magic bytes, size caps, and a per-event keepsake cap.
- No token transfers, no `authorize` override, and no calls to other contracts.
- Reproducible build, checked in CI. `deploy-contract.mjs` refuses a wasm that doesn't match the committed hash.

## What you should do

- Keep the **admin key** and **Koinos keys** in a password manager. Never paste them into chats, tickets or commits.
- Share host links only with people who should moderate. Use **Access → Make a new host link** if one leaks.
- Turn on **Approve photos before anyone sees them** for events where an inappropriate photo on the wall would be a problem. Automatic image classification isn't included (it would need a large model download on every guest's phone), so human approval is the reliable control.
- Turn on 2-step verification for the Google account that owns the backend.
- When updating the backend, read the diff to `backend/Code.gs` before pasting it into Apps Script.

## Friends' own backends

- A link may name a friend's backend with `?b=<deployment id>`. The site turns that into `https://script.google.com/macros/s/<id>/exec` and nothing else, so it only ever talks to Google Apps Script. It still never contacts any other server.
- Admin keys are only ever sent to backends listed in `config.js` or set up on that device through `setup.html`. An `admin.html?b=…` link to an unknown backend is ignored with a warning, so a crafted link can't collect someone's admin key.
- All keys are stored per backend, so one PhotoShare's keys are never sent to another.
- A fresh backend can be claimed from the website exactly once (`claim`), and only while it has no admin key. The deploy URL is secret until it's shared, and once claimed it can't be claimed again.
- Everything a backend returns is treated as untrusted. Text is rendered as text, links go through `safeUrl`, and media and logos are checked by their real file signature. SVG logos are refused.

## Private storage (per event, optional)

- Files are encrypted on the guest's device with AES-256-GCM (format `PSE1` + 12-byte IV + ciphertext + tag) before upload. Drive only stores `.enc` blobs, never link-shared. EXIF can't be stripped server-side, so the camera never adds it (canvas re-encode).
- The backend checks the envelope, size and a declared type; after decrypting, the browser checks the real file signature (JPEG/MP4/WebM/Ogg) before showing anything, and a tampered file fails the GCM tag.
- The key is held by the backend, so this protects against anyone with **Drive access only**. It does not protect against someone who controls the Apps Script project or the owner's Google account itself (they can read Script Properties). Keep the key backup offline.
- Joined guests receive the key so their phone can lock uploads, which means a guest who also had Drive access could unlock files. The album, TV wall and media endpoints still apply the normal checks (host key, guest browsing on and photos revealed, wall key) before serving any file.

## Known limitations

- In normal (non-private) events, photos visible in the album are "anyone with the link" files in Drive. The IDs are long and unguessable, but anyone a guest forwards a photo link to can see that photo, as with any shared album.
- A determined guest can clear their browser and rejoin to get a fresh roll. The guest cap and the event-wide total cap bound the impact.
- Guest reports hide a photo immediately (by design, as on PartyCam), so a malicious guest could hide good photos, up to the report limit. Hosts can restore them in one click and turn reporting off.
- GitHub Actions in workflows are pinned to major version tags of GitHub's own `actions/*`. Pin to commit SHAs if your threat model requires it.

## Reporting a vulnerability

Open a private security advisory on this repository (Security → Advisories → Report a vulnerability). Please don't open a public issue for security problems.
