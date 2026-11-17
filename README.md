# PhotoShare

- **Live site:** https://bawcejawn.github.io/PhotoShare/
- **Studio sign-in (create events):** https://bawcejawn.github.io/PhotoShare/admin.html

A shared disposable camera for weddings, parties and any event. Guests scan a QR code, shoot a limited roll from their phone's browser, and every photo lands in one album that **you own**. No app, no guest accounts, no fees.

- **$0 to run.** A static site on GitHub Pages plus a Google Apps Script backend that stores photos in your own Google Drive (15 GB free, more with Google Workspace).
- **Works on bad venue Wi-Fi.** Photos save on the guest's phone first and upload when there's signal.
- **A real roll of film.** A limited shot count, film looks baked in at capture, an optional date stamp, and short videos.
- **Live TV wall.** New photos appear within seconds, with a QR code beside them so more guests join.
- **You stay in control.** Approve photos before they show, hide, delete, pause uploads, block a guest, set an event code, and reveal live or "develop" later.
- **Private by default.** No tracking or ads. EXIF and GPS data are stripped, and files live in your Drive.
- **Optional Koinos archive.** A permanent on-chain record of each event, a fingerprint that proves every original is untouched, and screen-quality keepsakes you can recover from the chain alone, paid with free, regenerating mana.

| Page | Who | What |
|---|---|---|
| `index.html` | Everyone | Landing page and join-by-code |
| `cam.html?e=…` | Guests | The camera (the QR code opens this) |
| `album.html?e=…` | Guests | Shared album with lightbox, download and report |
| `tv.html?e=…#wk=…` | Screens | Live photo wall for a TV or projector |
| `admin.html` | You (studio) | Create and delete events, issue host links |
| `host.html?e=…#k=…` | Hosts | Share, moderate, guests, settings, access |
| `archive.html` | Hosts | Register, archive and anchor on Koinos (Kondor wallet) |
| `recover.html` | Anyone | Rebuild keepsakes from Koinos and verify originals |

## Get started

1. **[docs/SETUP.md](docs/SETUP.md)**: deploy the backend and the site (about 20 minutes, no coding).
2. **[docs/KOINOS.md](docs/KOINOS.md)**: optional. Deploy the contract, archive albums, and recover them.
3. **[SECURITY.md](SECURITY.md)**: how keys, links and uploads are protected.
4. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**: how it fits together, the design choices, what we learned from PartyCam, and how to scale it into a planning business.

## Repository layout

```
site/        static website (deployed to GitHub Pages by .github/workflows/pages.yml)
backend/     Google Apps Script backend: Code.gs + appsscript.json
contract/    Koinos smart contract (AssemblyScript) + build + tests; wasm and ABI are committed
scripts/     CLI: deploy-contract, archive-album (unattended), recover
test/        backend unit tests, local test server, end-to-end browser test
```

## Development

```bash
node test/backend.test.mjs            # 25 backend tests (real Code.gs, mocked Google services)
(cd contract && npm ci && npm test)   # contract build + mock-VM tests + koilib integration
node test/server.mjs 8787             # local site + real backend logic at http://localhost:8787
python3 test/e2e.py                   # end-to-end in Chrome with a fake camera (needs the server)
scripts/vendor.sh                     # verify vendored JS/fonts match their npm releases
```

The site is plain HTML, CSS and ES modules, with no build step and no CDN scripts. Third-party code is vendored and checksum-verified.

## License

MIT
