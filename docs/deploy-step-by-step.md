# Putting COD Flow Tracker online, step by step

This is the beginner version of [deployment.md](deployment.md). It uses **Railway** as the example host because it runs both pieces the app needs in one place:
- the web app, as a server that stays on
- a managed PostgreSQL database

Nothing here has been done for you yet: no account exists and nothing is deployed.

## First: how the database works

- **Yes, the app has a real database.** Everything is saved in it:
  - users and their workspaces
  - products and cost history
  - orders, parcels and their status history
  - ad spend, expenses, imports
  - MDM sync history, the audit log
  - each business's MDM key, encrypted
- **Every row belongs to one workspace**, and the server checks membership on every request. So two businesses sharing the same app and database never see each other's data.
- **Two databases, same design.** On a developer's computer it uses **SQLite**, a single file (`prisma/dev.db`) that needs no setup. Online it must use **PostgreSQL**, a proper database server that is safe for many users at once and easy to back up. The project includes the PostgreSQL version of the database structure, already tested.
- **The web app and the database are two separate things.** The app connects to the database through one secret address, `DATABASE_URL`. If the app is restarted or updated, the data stays safe in the database.
- **Changes to the database structure are "migrations".** One command, `npm run db:pg:deploy`, creates all the tables on a fresh database and applies any new ones on updates. It never deletes your data.

## Why Railway (and the alternative)

**Recommended: Railway.**
- The app and a managed PostgreSQL database live in one project, and Railway connects them for you.
- The app runs as a server that stays on. The automatic MDM sync runs inside the app every few minutes, so it needs that; nothing extra to set up.
- It deploys straight from GitHub: every push can update the site.
- Pricing is based on usage. Check Railway's pricing page for current numbers; one business with light traffic is a small monthly amount.

**Alternative: Render** (a "Web Service" plus "Render PostgreSQL"). It works the same way with the same commands. Pick it if you prefer its dashboard or pricing.

**Avoid "serverless" hosts like Vercel for this app.** They pause the app between visits, so the built-in automatic sync wouldn't run. It can be made to work with an outside scheduler, but it's more to manage.

## What you need before starting

1. The code in a **GitHub repository**. Add one in the project's settings; the code is then pushed there.
2. A **Railway account**, signed in with GitHub.
3. Three secret values, generated once and kept in a password manager. Run each line in a terminal that has Node.js installed:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY
   node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # PII_HASH_SALT
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"      # CRON_SECRET (optional)
   ```
   Never put these in the code or in a chat.

## Steps on Railway

1. **Create the project.** In Railway: New Project → Deploy from GitHub repo → choose the repository.
2. **Add the database.** In the same project, add PostgreSQL. Railway creates it and gives it a connection address.
3. **Connect the app to the database.** In the app service's Variables, add:
   - `DATABASE_URL` = a reference to the PostgreSQL service's `DATABASE_URL`. Railway offers it in a dropdown, so you don't copy the password by hand.
4. **Add the other variables** to the app service:
   - `APP_ENCRYPTION_KEY` = the first value from above
   - `PII_HASH_SALT` = the second value
   - `NODE_ENV` = `production`
   - Do **not** add any MDM key here. Each business enters its own inside the app.
5. **Build and start commands are already set.** The repository includes `railway.json`, which Railway reads automatically:
   - it builds with the PostgreSQL setup
   - it creates or updates the database tables each time the app starts
   - it only switches to a new version once `/api/health` answers

   There is nothing to type for this step.
6. **Deploy**, then open the generated web address. Railway provides HTTPS automatically. You can attach your own domain later in the service settings.
7. **Check it works.** Visit `https://<your-address>/api/health`: it should say `{"status":"ok"}`. If the app refuses to start, its logs name the variable that is missing or wrong.
8. **Create your account.** Sign up on the site; this creates your business workspace. Don't run the demo "seed" command online, because it adds fake demo businesses.
9. **Connect MDM Express.** Go to Settings → MDM Express, paste your MDM API key, then Encrypt & save → Test connection. When it says Connected:
    - map any statuses it lists (Settings → Status mappings)
    - go to MDM sync → Sync now
    - after that, syncs run automatically every 45 minutes
10. **Confirm the numbers.** Compare the COD amounts of a few parcels with what MDM shows. This is the first real test of the MDM connection.

## Keeping it safe

- **Backups.**
  - Turn on your host's automatic database backups if your plan offers them.
  - Also keep your own copy: from a computer with the PostgreSQL tools installed, run `DATABASE_URL="<the database's public address>" npm run db:backup`. Store the file somewhere private.
  - How to restore is in [backup-and-restore.md](backup-and-restore.md).
- **Keep `APP_ENCRYPTION_KEY` in your password manager, separately from backups.** Without it, the saved MDM keys can't be read. Your business data would be fine, but each business would have to re-enter its MDM key.
- **Updating the app:** push to GitHub. Railway rebuilds, applies any new migrations when it starts, and switches over once the health check passes. Take a backup before big updates.
- **Other businesses** use the same site: they sign up, get their own workspace, and add their own MDM key. You don't deploy anything per customer.

For more detail, see [deployment.md](deployment.md). It covers other hosts, a separate sync worker, an external scheduler with `CRON_SECRET`, and rotating the encryption key.
