# Production deployment

COD Flow Tracker is one Node.js web process plus a PostgreSQL database. An optional second
process runs MDM syncs outside the web server. Nothing here is tied to a specific host: any
place that runs Node.js 20+ behind HTTPS works (a VPS, a container platform, a PaaS).

> **There is no MDM key in the server configuration.** Each business enters its own MDM Express
> API key in the app (Settings → MDM Express). It is encrypted with `APP_ENCRYPTION_KEY` and only
> ever decrypted inside server-side sync code. Never set a customer's key as an environment variable.

## 1. What you need

| Piece | Requirement |
|---|---|
| Runtime | Node.js 20 or newer, npm |
| Database | PostgreSQL 14 or newer (verified on 16). SQLite is for development only. |
| HTTPS | A reverse proxy or platform TLS in front of the app (Caddy, nginx, the platform's router) |
| Outbound network | HTTPS to `api.mdm.express` (and any extra host in `MDM_ALLOWED_HOSTS`) |
| Secrets store | Somewhere to keep `APP_ENCRYPTION_KEY`, `PII_HASH_SALT`, `CRON_SECRET` and the database password, outside the repository |

## 2. Environment variables

| Variable | Required | What it is |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://user:password@host:5432/codflow?sslmode=require` |
| `APP_ENCRYPTION_KEY` | yes | 32 random bytes, base64. Encrypts every workspace's MDM credential. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Back it up separately from the database** (see [backup and restore](backup-and-restore.md)). |
| `APP_ENCRYPTION_KEY_VERSION` | no | Starts at `1`. Bumped when rotating the key. |
| `APP_ENCRYPTION_KEY_PREVIOUS` | no | Only during a rotation: the old key. |
| `PII_HASH_SALT` | yes | At least 16 random characters. Salts the phone-number hashes. Changing it later breaks phone matching for existing data, so treat it as permanent. |
| `CRON_SECRET` | no | 32+ random characters. Enables `/api/cron/sync` for an external scheduler. Unset = endpoint disabled (404). |
| `SYNC_SCHEDULER` | no | `off` = don't schedule syncs from inside the web server (use when an external cron does it). Default on. |
| `SYNC_BACKGROUND` | no | `off` = the web server runs no sync jobs at all. Use with the standalone worker, or with a cron in "inline" mode (below). Default on. |
| `MDM_ALLOWED_HOSTS` | no | Extra MDM hosts allowed as a workspace's base URL, comma separated. `api.mdm.express` is always allowed. HTTPS only; private addresses are always refused. |
| `MDM_API_KEY` | **no — leave unset** | Placeholder for local development only. The server refuses to start in production if it holds a real-looking value. |

On start, a production server (`NODE_ENV=production`) checks these and **refuses to start** if the
encryption key is missing, a placeholder or the wrong length, if the salt is weak, or if
`CRON_SECRET` is too short. The error names the variable, never its value.

## 3. First deployment

```bash
git clone <your repository> cod-flow-tracker && cd cod-flow-tracker
npm ci                       # installs and generates the (SQLite) client
npm run db:pg:generate       # switch the generated client to PostgreSQL
npm run db:pg:deploy         # apply prisma/postgres/migrations to DATABASE_URL
npm run build
NODE_ENV=production npm start -- -p 3000
```

`db:pg:generate` must run **after** `npm ci` and **before** `npm run build`, on every deploy,
because `npm ci` regenerates the development (SQLite) client.

Do **not** run `npm run db:seed` in production: it creates the synthetic demo workspaces.

Put the app behind HTTPS. In production the session cookie is `Secure`, `HttpOnly` and
`SameSite=Lax`, HSTS is sent, and mutations from another origin are rejected, so plain HTTP
will not work. Forward the `Host` (or `X-Forwarded-Host`) header unchanged.

Minimal Caddy example:

```
app.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Minimal systemd unit (`/etc/systemd/system/cod-flow-tracker.service`):

```ini
[Service]
WorkingDirectory=/srv/cod-flow-tracker
EnvironmentFile=/etc/cod-flow-tracker.env   # chmod 600, owned by root
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start -- -p 3000
Restart=always
User=codflow

[Install]
WantedBy=multi-user.target
```

## 4. Health check

`GET /api/health` returns `200 {"status":"ok"}` when the app can reach its database and `503`
otherwise. It reveals nothing else. Point the load balancer or uptime monitor at it.

## 5. Scheduled MDM sync

Each workspace syncs incrementally every *N* minutes once its connection test has passed
(default 45; owners change it in Settings → MDM Express → Sync interval, from 15 minutes to 24
hours). A workspace is due when its interval has passed since its **last** sync, manual or
scheduled. One sync per workspace can be active at a time (a database lock), so running several
schedulers at once never double-syncs. A workspace whose connection is in error, or whose key was
removed, is skipped until an owner fixes it.

Pick one of these:

**A. Built in (default, one long-running server).** Nothing to configure. The web server checks
every minute, queues due syncs and runs them in the background.

**B. Separate worker process.** Run `npm run sync:worker` as a second service with the same
environment, and set `SYNC_BACKGROUND=off` on the web server. The worker checks every 30 seconds
(`SYNC_WORKER_INTERVAL_MS`). Use this when you run several web instances or want syncs isolated
from web traffic.

**C. External cron** (a platform scheduler, GitHub Actions, crontab on another box). Set
`CRON_SECRET` and `SYNC_SCHEDULER=off`, then call every 5–15 minutes:

```bash
curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://app.example.com/api/cron/sync
```

It answers `202 {"scheduled": n, "processed": m}` at once and the syncs run in the background.
On hosts that freeze or kill the process between requests (serverless), also set
`SYNC_BACKGROUND=off`: the cron request then runs the due jobs itself before answering, so give
it a generous timeout. `GET` works too, for schedulers that can only send GET.

Whatever the mode, the browser is never the scheduler, and a sync that stops (a restart, a
crash) is resumed from its last saved page by the next pass.

## 6. How each customer adds their own MDM key

Tell every business using the app to do this once, as a workspace **Owner** or **Admin**:

1. Sign up (this creates their workspace) or sign in and pick the workspace.
2. Open **Settings → MDM Express**.
3. Paste the API key from their own MDM Express account and click **Encrypt & save**. The field
   clears; from then on only the last four characters are shown.
4. Click **Test connection**. This only reads their MDM profile and status list. It must say
   *Connected* before any sync can run.
5. If the test lists MDM statuses that aren't mapped yet, map them in **Settings → Status
   mappings** (or wait: parcels in unmapped statuses show up for review and are never counted as
   delivered or returned).
6. Go to **MDM sync** and click **Sync now** for the first full import. Scheduled incremental
   syncs follow automatically.
7. Review **Unmatched parcels** on the sync page: link each to its order or ignore it.

To change keys: **Replace key** (the new key must pass the test again). To disconnect:
**Remove key**. That deletes the encrypted key but keeps all orders, parcels and sync history.
Analysts and operators can't see or change the key.

## 7. Rotating the encryption key

1. Generate a new key. Set `APP_ENCRYPTION_KEY` to it, move the old one to
   `APP_ENCRYPTION_KEY_PREVIOUS`, and bump `APP_ENCRYPTION_KEY_VERSION` (1 → 2). Restart.
   Existing credentials keep working, because each one records which key version encrypted it.
2. Run `npm run secrets:reencrypt` with the same environment. It re-encrypts every stored
   credential with the new key and prints counts only.
3. When it reports 0 that could not be decrypted, remove `APP_ENCRYPTION_KEY_PREVIOUS` and restart.
4. Update the key in your secret store and in your backup notes.

If the key is lost, business data is unaffected but stored MDM credentials can't be decrypted:
each workspace re-enters its key in Settings.

## 8. Updating the app

```bash
git pull
npm ci
npm run db:pg:generate
npm run db:backup            # before every migration; see backup-and-restore.md
npm run db:pg:deploy
npm run build
# restart the web service (and the worker, if you run one)
```

Migrations only add; take a backup anyway.

## 9. Changing the database schema (developers)

`prisma/schema.prisma` (SQLite) is the source of truth. After changing it and creating the SQLite
migration as usual:

```bash
npm run db:pg:schema          # regenerates prisma/postgres/schema.prisma
npx prisma migrate diff \
  --from-migrations prisma/postgres/migrations \
  --to-schema-datamodel prisma/postgres/schema.prisma \
  --shadow-database-url "postgresql://user@localhost:5432/codflow_shadow" \
  --script > prisma/postgres/migrations/<timestamp>_<name>/migration.sql
npm run test:postgres         # whole suite against PostgreSQL
```

`TEST_DATABASE_URL` must name a throwaway database ending in `_test`, e.g.
`TEST_DATABASE_URL=postgresql://user@localhost:5432/codflow_test npm run test:postgres`. The run
drops and re-creates that database's `public` schema. `node scripts/postgres-schema.mjs --check`
fails when the PostgreSQL schema copy is out of date (useful in CI).

## 10. Before going live

- [ ] HTTPS in front of the app; plain HTTP redirects to HTTPS
- [ ] `APP_ENCRYPTION_KEY`, `PII_HASH_SALT`, `CRON_SECRET` generated fresh and stored in a secret manager, not in the repository
- [ ] `MDM_API_KEY` unset
- [ ] Database reachable only from the app (and the backup job), with TLS and its own password
- [ ] `npm run db:seed` **not** run
- [ ] One sync mode chosen (section 5), and `/api/health` monitored
- [ ] Nightly backups running and one restore drill done ([backup and restore](backup-and-restore.md))
- [ ] Server logs kept private: they may contain workspace IDs and error details, never keys or customer phone numbers
- [ ] Test suites green on the release: `npm test`, `npm run test:postgres`, `npm run test:e2e`
