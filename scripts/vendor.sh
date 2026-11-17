#!/usr/bin/env bash
# Verifies (default) or refreshes (--update) the vendored browser libraries in site/assets/vendor
# against the exact npm releases they came from.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V="$ROOT/site/assets/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cd "$TMP"
for p in koilib@10.0.0 kondor-js@1.3.0 qrcode-generator@2.0.4 @fontsource/bricolage-grotesque@5.3.0 @fontsource/atkinson-hyperlegible@5.3.0; do
  npm pack --silent "$p" >/dev/null
done
for f in *.tgz; do mkdir -p "x/${f%.tgz}"; tar -xzf "$f" -C "x/${f%.tgz}"; done
mkdir -p out/fonts
cp x/koilib-10.0.0/package/dist/koinos.min.js out/koilib.min.js
cp x/kondor-js-1.3.0/package/dist/kondor.min.js out/kondor.min.js
cp x/qrcode-generator-2.0.4/package/dist/qrcode.mjs out/qrcode.mjs
for w in 500 700 800; do cp x/fontsource-bricolage-grotesque-5.3.0/package/files/bricolage-grotesque-latin-$w-normal.woff2 out/fonts/; done
for w in 400 700; do cp x/fontsource-atkinson-hyperlegible-5.3.0/package/files/atkinson-hyperlegible-latin-$w-normal.woff2 out/fonts/; done
cd out
if [[ "${1:-}" == "--update" ]]; then
  cp -r . "$V/"
  (cd "$V" && sha256sum koilib.min.js kondor.min.js qrcode.mjs fonts/*.woff2 > SHA256SUMS)
  echo "Vendored files refreshed."
else
  sha256sum -c "$V/SHA256SUMS"
  (cd "$V" && sha256sum -c SHA256SUMS)
  echo "Vendored files match the npm releases."
fi
