# Deploying to Railway — step by step

Total time: ~30-40 minutes, most of it is the Slack/Google credential setup,
not Railway itself.

## Part 1 — Slack App

1. Go to **https://api.slack.com/apps** → **Create New App** → **From scratch**.
2. Name it (e.g. "Daybook"), pick your workspace, **Create App**.
3. Left sidebar → **OAuth & Permissions**.
4. Scroll to **User Token Scopes** (not Bot Token Scopes — this app needs a
   user token because `search.messages` doesn't work with bot tokens). Add:
   - `search:read`
   - `channels:history`, `groups:history`, `im:history`, `mpim:history`
   - `channels:read`, `groups:read`, `im:read`, `mpim:read`
   - `users:read`
5. Still on that page, under **Redirect URLs**, add a placeholder for now —
   you'll come back and fix this once Railway gives you a real URL:
   `https://placeholder.up.railway.app/slack/oauth/callback`
6. Left sidebar → **Basic Information**. Copy **Client ID** and
   **Client Secret** — you'll need both in Railway's env vars.
7. Leave the app uninstalled for now. The website installs it (per-user)
   the first time you click "Connect Slack" — you don't install it manually
   from this dashboard.

## Part 2 — Google service account

1. **https://console.cloud.google.com** → top bar → **New Project** (or pick
   an existing one).
2. Search bar → "Google Sheets API" → **Enable**.
3. Left sidebar → **IAM & Admin → Service Accounts → + Create Service Account**.
   Give it any name. Skip the optional role/permissions steps — access is
   granted per-sheet, not per-project.
4. Click into the new service account → **Keys** tab → **Add Key → Create
   new key → JSON**. A file downloads — keep it somewhere safe, this is the
   only copy.
5. Open the file. Note the `client_email` field — looks like
   `something@your-project.iam.gserviceaccount.com`.
6. Create (or open) the Google Sheet you want everything logged to. Click
   **Share** (top right) → paste that service account email → set role to
   **Editor** → Send (it's fine that it can't receive email, ignore the warning).
7. From the sheet's URL — `docs.google.com/spreadsheets/d/`**`THIS`**`/edit` —
   copy the ID part. That's your `GOOGLE_SHEET_ID`.
8. Open the downloaded JSON key file, copy its *entire contents* as one
   string — you'll paste this whole thing into one env var on Railway.

## Part 3 — Push the code to GitHub

Railway deploys from a GitHub repo (or its CLI — GitHub is simpler).

```bash
cd daybook-web
git init
git add .
git commit -m "Initial commit"
```

Create an empty repo on GitHub (github.com/new, don't initialize with a
README), then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/daybook-web.git
git branch -M main
git push -u origin main
```

## Part 4 — Deploy on Railway

1. **https://railway.com** → sign up / log in (connecting GitHub during
   signup gets you off the network-restricted trial faster).
2. **New Project → Deploy from GitHub repo** → pick `daybook-web`.
   Railway auto-detects Node.js from `package.json` — no config needed.
3. It'll try to deploy immediately and fail (no env vars yet). That's expected.
4. Click into the service → **Variables** tab → **Raw Editor** → paste:

   ```
   SLACK_CLIENT_ID=<from Part 1>
   SLACK_CLIENT_SECRET=<from Part 1>
   SLACK_REDIRECT_URI=https://placeholder.up.railway.app/slack/oauth/callback
   GOOGLE_SERVICE_ACCOUNT_JSON=<paste the whole JSON key from Part 2, step 8>
   GOOGLE_SHEET_ID=<from Part 2, step 7>
   SESSION_SECRET=<any random string>
   DATA_DIR=/data
   PORT=3000
   TASK_SYNC_CRON=*/15 5-11 * * *
   MENTION_SCAN_CRON=0 * * * *
   ```

5. **Settings** tab → **Networking** → **Generate Domain**. Railway gives you
   a real URL like `daybook-web-production-xxxx.up.railway.app`.
6. Go back to **Variables** and replace the placeholder `SLACK_REDIRECT_URI`
   with that real domain + `/slack/oauth/callback`.
7. Go back to Slack's app settings (**OAuth & Permissions → Redirect URLs**)
   and replace the placeholder there too, with the exact same URL. **Save URLs.**
8. **Settings** tab → **Volumes** → **+ New Volume**. Mount path: `/data`.
   Attach it to this service. This is what makes your Slack connection and
   dedupe records survive future redeploys.
9. Railway redeploys automatically whenever you change variables or add a
   volume. Wait for the deploy to go green.

## Part 5 — Connect and test

1. Visit your Railway domain in a browser. You should see the Daybook
   status page with "Slack: not connected."
2. Click **Connect Slack** → approve the permissions Slack shows you.
   You'll land back on the status page showing "connected."
3. Click **Run task sync** and **Run mention scan** to test immediately
   instead of waiting for the schedule. Check your Google Sheet — you
   should see `Tasks` and `Mention Counts` tabs appear.
4. Post a message to yourself on Slack starting with "Task to do today:"
   followed by a list, then hit **Run task sync** again to confirm it
   parses correctly.

## If something's wrong

- **"Slack rejected the exchange"** on the callback — the redirect URI in
  Railway's env var and in Slack's app settings must match *exactly*,
  including trailing slashes.
- **Sheet writes fail with a permissions error** — you shared the sheet
  with the service account email, right? (Part 2, step 6). This is the
  most common miss.
- **Data resets after every deploy** — the Volume isn't attached, or
  `DATA_DIR` doesn't match its mount path. Check both in Settings.
- **Railway build fails** — check the build logs tab; almost always a
  missing env var it needed at boot. Google creds are read lazily on first
  use, not at boot, so a malformed `GOOGLE_SERVICE_ACCOUNT_JSON` won't show
  up here — it'll surface the first time a Sheets call actually runs.
