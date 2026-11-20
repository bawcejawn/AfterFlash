# Vendored third-party files

Committed so the site has no runtime CDN dependencies (no third-party script can be swapped
under you). Re-create or verify with `scripts/vendor.sh`, which downloads the exact npm versions
below and checks the SHA-256 sums in `SHA256SUMS`.

| File | Package | License |
|---|---|---|
| koilib.min.js | koilib@10.0.0 (`dist/koinos.min.js`) | MIT |
| kondor.min.js | kondor-js@1.3.0 | MIT |
| qrcode.mjs | qrcode-generator@2.0.4 | MIT |
| jsQR.js | jsqr@1.4.0 (`dist/jsQR.js`, QR reader for phones without a built-in one) | Apache-2.0 (`jsQR.LICENSE.txt`) |
| fonts/figtree-* | @fontsource/figtree@5.3.0 | OFL-1.1 |
| fonts/atkinson-hyperlegible-* | @fontsource/atkinson-hyperlegible@5.3.0 | OFL-1.1 |
