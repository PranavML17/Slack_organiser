# Daybook — Slack → Google Sheets daily log

Reads your "Task to do today:" self-message every morning, counts how many
messages mention you each day, and drops the raw transcript into a new sheet
tab whenever one of those mentions is part of a thread.

No AI/LLM is required for this to work — everything core is direct Slack/Sheets
API calls. There's one optional AI feature: if you set `GEMINI_API_KEY`, the
"Task" column in the `Mentions` tab gets rewritten into a short, clean task
description via Gemini 3.1 Flash-Lite instead of showing the raw Slack message
verbatim. Leave that key blank and you get the raw text — nothing else changes,
and nothing else depends on it.

Everything writes to **one Google Sheet**, across four kinds of tabs:
- `Tasks` — one row per task, dated, from your own "Task to do today" message
- `Mention Counts` — one row per day, running total of @mentions
- `Mentions` — one row per mention: who tagged you, the task/message (raw or
  AI-cleaned, see above), channel, permalink
- `Thread_<date>_<channel>_<id>` — a new tab per thread, with the full
  back-and-forth (speaker + message), created whenever a mention turns out
  to be part of a thread

## What you need before this runs (~20 minutes)

### 1. A Slack App
1. Go to https://api.slack.com/apps → **Create New App** → From scratch.
2. Under **OAuth & Permissions**, you don't need to add bot scopes — this
   app uses a **user token**, because Slack's `search.messages` (the only
   way to find every mention of you without inviting a bot into every
   channel) only works with user tokens.
3. Under **OAuth & Permissions → Redirect URLs**, add the URL you'll deploy
   this to, e.g. `https://your-app.onrender.com/slack/oauth/callback`.
   This must match `SLACK_REDIRECT_URI` in your `.env` exactly.
4. Copy **Client ID** and **Client Secret** from **Basic Information** into
   your `.env`.
5. You don't need to install the app yet — the app itself does that the
   first time you click "Connect Slack" on its homepage.

### 2. A Google service account (for Sheets)
1. Go to https://console.cloud.google.com → create a project (or reuse one).
2. Enable the **Google Sheets API** for it.
3. **IAM & Admin → Service Accounts → Create Service Account**. No roles
   needed at the project level — access is granted per-sheet in step 5.
4. Open the new service account → **Keys → Add Key → Create new key → JSON**.
   Download it.
5. Create (or open) the Google Sheet you want data to land in. Click
   **Share**, and share it with the service account's email address
   (looks like `xyz@your-project.iam.gserviceaccount.com`) as **Editor**.
6. Grab the Sheet ID from its URL:
   `docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`
7. Either paste the whole downloaded JSON key as one line into
   `GOOGLE_SERVICE_ACCOUNT_JSON`, or upload the file to your host and point
   `GOOGLE_SERVICE_ACCOUNT_FILE` at its path.

### 3. Fill in `.env`
Copy `.env.example` to `.env` and fill in everything from steps 1-2.

## Running it

```bash
npm install
npm start
```

Visit the URL it prints, click **Connect Slack**, approve the permissions.
That's the OAuth flow — it stores your user token in `data.json` (see
caveat below) and from then on the scheduled jobs run on their own.

Use the **Run task sync** / **Run mention scan** buttons on the homepage to
test immediately instead of waiting for the next scheduled run.

## Deploying

This needs to run continuously (for the cron jobs) and needs a public
HTTPS URL (for the Slack OAuth redirect), so a serverless/static host won't
work. Render, Railway, and Fly.io all have small free/cheap tiers that fit:

1. Push this folder to a GitHub repo.
2. Create a new **Web Service** on your host, point it at the repo.
3. Build command: `npm install`. Start command: `npm start`.
4. Add all the `.env` values as environment variables in the host's dashboard.
5. Once deployed, update `SLACK_REDIRECT_URI` (and the Redirect URL in your
   Slack app settings) to match the real deployed URL, redeploy, then
   connect Slack from the live site.

## The honest limitations

- **Filesystem persistence.** `data.json` (where your Slack token and
  dedupe records live) is a plain file. Most free hosting tiers wipe local
  disk on every redeploy or restart, which means you'd have to reconnect
  Slack each time. For anything beyond testing, swap `src/store.js` for a
  real database — Supabase or Neon's free Postgres tiers both work and the
  rest of the app only talks to `store.js`, so it's a contained change.
  A cheaper stopgap: after connecting once, copy the token out of
  `data.json` into a `SLACK_USER_TOKEN` env var — `store.js` already falls
  back to that if no stored auth is found.
- **Mention coverage is bounded by what you can see.** `search.messages`
  only searches channels you're a member of, same as Slack's own search bar.
  There's no workspace-wide firehose available to personal apps.
- **Mention count is literal @mentions, not "asked for something."**
  Someone tagging you to say "nice work" counts the same as someone tagging
  you with a request. If you want that distinction, it's a follow-up
  feature (an LLM classification pass per mention), not something this
  version does.
- **Thread detection is a heuristic.** A search result is treated as part
  of a thread if it carries a `thread_ts` different from its own `ts`, or
  if fetching replies returns more than one message. Fast-changing threads
  or edge cases in Slack's search response could occasionally be missed.
- **Thread tabs are raw transcripts, not summaries.** No AI is involved —
  you get the full back-and-forth as-is. For a long thread that means a
  long tab. If you want condensed summaries instead, that's a small,
  isolated addition to `logThreadTranscript` in `src/mentionScan.js`.
- **Rate limits.** Slack's `search.messages` and Google Sheets both have
  rate limits fine for personal volume, but if a scan finds a lot of
  mentions at once (e.g. after downtime), you may hit them. The scheduler
  runs hourly by default specifically to keep batches small.
