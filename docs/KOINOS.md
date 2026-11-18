# Koinos: permanent records, fingerprints and keepsakes

This is optional. The photo app works without it. With it, each event gets:

| On chain | Size | What it gives you |
|---|---|---|
| **Event registry** | ~200 bytes | A permanent record of the event under your address |
| **Album fingerprint** | 64 bytes | A Merkle root and manifest hash covering every original. Anyone can prove a photo is an untouched original from this album. |
| **Keepsakes** | ≤ 48 KB each | A screen-quality copy (about 1024 px WebP) of every approved photo, recoverable from the chain even if Drive and this website disappear |

Full-resolution originals stay in Google Drive. The chain proves they're authentic.

## What it costs (mana, not money)

Mana is built into KOIN. Spending it is free, and it refills over 5 days, about 20% of your balance per day. Costs come from live chain prices: disk and network are priced per byte. In November 2026, storing a byte cost about 70,000 mana units (0.0007 mana), so:

| Item | Approx. mana |
|---|---|
| Register an event | < 1 |
| Anchor a fingerprint | < 1 |
| One keepsake (~40 KB) | ~25–30 |
| 1,500-photo wedding, all keepsakes | ~40,000 |

With 500,000 KOIN you regenerate about 100,000 mana per day, so a full wedding archive uses well under half a day's mana. The archive tool shows a live estimate before you start.

### Why not put the full-size originals on chain?

At the same prices, a 1.5 MB original is about 1,100 mana, so 1,500 originals would take about 1.6 million mana. The network also accepts only about 512 KB of new data per 3-second block, shared by every user, so one wedding would fill every block on the network for hours. Every node stores everything forever, which raises costs for every operator. The chain is the right place for proofs and compact copies, not bulk storage.

## 1. Deploy the contract (once)

You need Node.js 20+ on your computer.

```bash
cd scripts
npm install
node deploy-contract.mjs --new-key        # prints a NEW contract address + WIF, once
```

Save the printed WIF in a password manager. **Whoever holds the contract key can replace the contract code**, so keep it offline and never commit it.

Deploy, paying the mana from your KOIN-holding sponsor address:

```bash
export CONTRACT_WIF='…the new contract key…'
export PAYER_WIF='…your sponsor address key…'
node deploy-contract.mjs            # dry run: shows address, payer, wasm hash
node deploy-contract.mjs --yes      # deploys
unset CONTRACT_WIF PAYER_WIF
```

The script refuses to deploy if `contract.wasm` doesn't match its committed SHA-256. Put the printed address in `site/config.js`:

```js
koinos: {
  rpc: 'https://api.koinos.io',
  contract: '1YourContractAddress…',
  explorer: 'https://koinosblocks.com',
},
```

If you change `rpc` to another provider, add its origin to the `connect-src` Content-Security-Policy in `site/archive.html` and `site/recover.html`.

## 2. Archive an event

### In the browser (Kondor wallet)

1. Install the [Kondor](https://chromewebstore.google.com/search/kondor) extension and import or create the account that holds your KOIN.
2. Open `archive.html?e=EVENT#k=HOSTKEY` (the host link with `host.html` changed to `archive.html`). The dashboard tab was removed; this tool is optional.
3. **Connect Kondor**, then **Register on Koinos** (once per event).
4. **Start archiving**. Kondor asks you to approve each batch of up to 5 photos. You can stop and resume any time; progress is saved.
5. **Anchor fingerprint** when the album is final (re-anchor if more photos arrive). This saves `manifest-….json` to the event's Drive folder and downloads a copy. **Keep the manifest.** It's what proves each original.

The connected account is the event's **owner** and pays the mana.

### Unattended, from your computer (no pop-ups)

For big albums:

```bash
cd scripts && npm install
export HOST_LINK='https://you.github.io/PhotoShare/host.html?e=Ab12Cd34Ef#k=…'
export OWNER_WIF='…key of the owner/payer address…'
# optional: export PAYER_WIF='…' if a different address should pay the mana
node archive-album.mjs --dry-run      # shows what would be archived and the mana estimate
node archive-album.mjs --anchor       # archives everything, then anchors the fingerprint
unset HOST_LINK OWNER_WIF PAYER_WIF
```

It resumes where it left off if interrupted.

## 3. Recover and verify

### Web

`https://<your-site>/recover.html?o=<owner address>&e=<event code>`

- Shows the event record and fingerprint, and every keepsake read straight from the chain.
- **Download all keepsakes (zip).**
- **Check that a photo is an original:** choose the manifest, which is verified against the on-chain hash and Merkle root, then any files. Each file is marked ✓ (an untouched original from this album) or ✗.

Only `recover.html`, its JS and Koinos are needed. Save a copy of the site folder with your records and it works from any static host.

### Command line

```bash
cd scripts && npm install
node recover.mjs --owner 1Owner… --event Ab12Cd34Ef --out ./wedding-keepsakes
```

## How the fingerprint works

- The backend hashes every original as it arrives (SHA-256 of the exact bytes stored in Drive).
- The manifest is canonical JSON: `{v, app, event, name, count, items:[{h, k, c}]}`, in upload order.
- `manifest_hash = sha256(manifest file)`.
- `album_root` is a Merkle root over the photo hashes with domain separation: `leaf = H(0x00‖h)`, `node = H(0x01‖left‖right)`, and an odd node is promoted.
- Each keepsake stores the `original_sha256` of the photo it came from, linking the screen copy to its original.

## Contract reference

Source: [`contract/assembly/Photoshare.ts`](../contract/assembly/Photoshare.ts) · Proto: [`contract/assembly/proto/photoshare.proto`](../contract/assembly/proto/photoshare.proto)

| Method | Who | Notes |
|---|---|---|
| `register_event(owner, event_id, meta)` | owner | Once per (owner, event). `meta` ≤ 512 bytes. |
| `update_meta(owner, event_id, meta)` | owner | |
| `anchor_album(owner, event_id, album_root, manifest_hash, photo_count)` | owner | 32-byte roots; version increments |
| `add_keepsake(owner, event_id, mime, data, caption, original_sha256)` | owner | JPEG, WebP or AVIF only (magic bytes checked), ≤ 49,152 bytes, ≤ 20,000 per event |
| `remove_keepsake(owner, event_id, index)` | owner | Clears the data and keeps the index |
| `get_event`, `get_keepsake`, `list_events` | anyone | read-only |

Events are keyed by **owner + event code**, so nobody can claim ("squat") your event code first. Every write requires the owner's signature.

Build and test: `cd contract && npm ci && npm test`. The build is reproducible; CI checks that the committed `contract.wasm` matches a fresh build.
