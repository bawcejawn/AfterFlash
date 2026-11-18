# Scaling AfterFlash Cloud

Everything here is already built. Nothing needs doing until the **Owner: system health** panel on your admin page asks you to.

## What grows, and what keeps it small

| Part | Limit | What handles it |
|---|---|---|
| Photos and videos | Each host's own Google Drive | Nothing to do: storage never lands on you. |
| Database (the photo list, guests, guestbook) | 10 GB per Cloudflare D1 database | **Extra databases ("shards")** for new events, plus the **nightly cleanup**. |
| Website, API, uploads | Cloudflare Workers scale on their own | About $0.30 per extra million requests after the first 10 million a month. |
| Google Drive API | Shared by all customers (one Google project) | Fine for hundreds of big events at the same moment. You can request more in Google Cloud. |

## The nightly cleanup (automatic)

Every night at about 7:17 UTC the worker:

- clears the photo list (not the photos) of albums whose plan ended more than **12 months** ago, and of deleted events. The photos stay in the host's Google Drive.
- deletes expired sign-in, rate-limit and invite rows, and problem logs older than 90 days.

It works in batches of 200 albums a night and carries on the next night if there are more.

If a host renews after their album was cleared, the album opens again with an empty list. On the dashboard they click **Find missing photos**: every photo comes back from their Drive, **waiting for approval**, so anything they had hidden stays hidden until they decide. The dashboard tells them this.

To run the cleanup right away, use **Run cleanup now** in **Owner: system health**.

## Adding an extra database (when the health panel says so)

The panel shows each database's size out of 10 GB. At **70%** it says "add one soon", and at **85%** it says "add one now". One database holds roughly 25,000 big events' photo lists, and the cleanup frees space all the time, so this is a nice problem to have.

1. GitHub → **Settings → Secrets and variables → Actions → Variables**:
   - `SHARDS` = `1` (how many extra databases to have)
   - `ACTIVE_SHARD` = `SHARD_1` (where **new** events go)
2. **Actions → Deploy AfterFlash Cloud → Run workflow.** The deploy creates the database, sets up its tables and connects it.
3. Check **Owner: system health**: the new database is listed as "new events go here".

Next time: `SHARDS` = `2`, `ACTIVE_SHARD` = `SHARD_2`, and so on, up to 20.

**Rules:**
- Old events stay where they are. Only new events go to the active database.
- **Never delete an extra database in Cloudflare.** Events stored in it would break. The deploy keeps every existing one connected, even if you lower `SHARDS`.
- If `ACTIVE_SHARD` names a database that doesn't exist, new events go to the main database, and the deploy stops with an explanation.

## Further out (not built yet)

- **Stripe Connect** for automatic partner payouts and 1099s, once you have more than about 20–30 partners.
- **More Google Drive quota:** in Google Cloud go to **APIs & Services → Google Drive API → Quotas** and request an increase. It's free, but approval isn't guaranteed.
- **Support help:** a part-time person once you have hundreds of customers a week. The Help page (help.html) handles the common questions.
