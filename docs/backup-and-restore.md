# Backup and restore

## What to back up

| What | Why | Where it lives |
|---|---|---|
| **The database** | All business data: workspaces, users, orders, parcels, spend, expenses, sync history, audit log, and the *encrypted* MDM credentials | PostgreSQL (production) or `prisma/dev.db` (development) |
| **`APP_ENCRYPTION_KEY`** (and `APP_ENCRYPTION_KEY_VERSION`) | Without it, the stored MDM credentials can't be decrypted | Your secret manager |
| **`PII_HASH_SALT`** | Phone-number hashes are only comparable with the same salt | Your secret manager |
| The rest of the environment file | To rebuild the server | Your secret manager |

Keep the key and the database backups **in different places**. A database dump alone reveals no
MDM key; a dump plus the encryption key does.

Uploaded CSV files are not kept on disk (imports store their rows and errors in the database), so
there is no file storage to back up.

## Taking a backup

```bash
npm run db:backup                    # writes ./backups/cod-flow-tracker-<timestamp>.dump|.db
npm run db:backup -- /var/backups/codflow
```

- **PostgreSQL:** runs `pg_dump --format=custom --no-owner` against `DATABASE_URL`. Needs the
  PostgreSQL client tools on `PATH`, at the server's major version or newer.
- **SQLite (development):** `VACUUM INTO` a new file. Safe while the app is running.

The backup directory is created with owner-only permissions. Encrypt backups at rest and copy them
off the server (object storage with versioning, or another machine).

Suggested schedule: nightly, keeping 7 daily and 4 weekly copies, plus one before every deploy
that includes a migration. Example crontab on the app server:

```cron
15 2 * * *  cd /srv/cod-flow-tracker && set -a && . /etc/cod-flow-tracker.env && npm run -s db:backup -- /var/backups/codflow && find /var/backups/codflow -name 'cod-flow-tracker-*' -mtime +30 -delete
```

Managed PostgreSQL services also offer point-in-time recovery; turn it on as well. The dumps
remain useful for moving between providers and for restore drills.

## Restoring

Stop the web service **and** the sync worker first, so nothing writes during the restore.

### PostgreSQL

```bash
# 1. Create an empty database (or drop and re-create the old one if you are sure).
createdb -h db.example.com -U codflow codflow_restored

# 2. Restore the dump into it.
pg_restore --no-owner --dbname "postgresql://codflow@db.example.com:5432/codflow_restored" \
  backups/cod-flow-tracker-<timestamp>.dump

# 3. Apply any migrations newer than the backup (no-op if none).
DATABASE_URL="postgresql://codflow@db.example.com:5432/codflow_restored" npm run db:pg:deploy
```

Point `DATABASE_URL` at the restored database, make sure `APP_ENCRYPTION_KEY` (and
`APP_ENCRYPTION_KEY_VERSION`, and `APP_ENCRYPTION_KEY_PREVIOUS` if a rotation was in progress when
the backup was taken) are the ones in use at that time, then start the services.

### SQLite (development)

```bash
cp backups/cod-flow-tracker-<timestamp>.db prisma/dev.db
npx prisma migrate deploy
```

## After a restore

1. `curl https://app.example.com/api/health` returns `{"status":"ok"}`.
2. Sign in, open the dashboard and check that recent orders and the last successful MDM sync are
   what you expect for the backup's time.
3. In one workspace, open **Settings → MDM Express** and click **Test connection**. If it says the
   stored credential can't be decrypted, the encryption key doesn't match the backup: fix the key,
   or have each workspace re-enter its MDM key.
4. Run **Sync now** (or wait for the schedule). Syncs are idempotent: parcels changed since the
   backup are brought up to date and nothing is duplicated. Orders and spend imported after the
   backup must be re-imported; the importers skip anything already present.
5. Sessions in the backup are still valid until they expire. To force everyone to sign in again,
   run `DELETE FROM "Session";` on the restored database.

## Restore drill

Do this once before going live and then every quarter: restore the latest backup into a scratch
database, start a second copy of the app against it with the production key, and walk through
"After a restore". A backup that has never been restored is not a backup.

The drill was run for this release:
- **PostgreSQL 16:** the seeded demo data was dumped with `npm run db:backup` and restored with
  `pg_restore` into an empty database. Row counts and migration history matched.
- **SQLite:** the `VACUUM INTO` copy opened cleanly and `prisma migrate status` reported it up to
  date.

## If the encryption key is lost

Business data is unaffected. Stored MDM credentials become unreadable: connection tests and syncs
fail with a clear message, and each workspace owner re-enters their MDM key in Settings. Generate
a new `APP_ENCRYPTION_KEY` (and reset `APP_ENCRYPTION_KEY_VERSION` to 1) before they do.
