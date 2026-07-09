require('dotenv').config();
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const store = require('./src/store');
const slack = require('./src/slackClient');
const { runTaskSync } = require('./src/taskSync');
const { runMentionScan } = require('./src/mentionScan');
const scheduler = require('./src/scheduler');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const oauthStates = new Set(); // simple in-memory CSRF nonce store, fine for single-user use

app.get('/', (req, res) => {
  const auth = store.getSlackAuth();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/api/status', (req, res) => {
  const auth = store.getSlackAuth();
  res.json({
    connected: !!auth,
    slackUserId: auth ? auth.userId : null,
    slackUserName: auth ? auth.userName : null,
    teamName: auth ? auth.teamName : null
  });
});

// Step 1: kick off Slack OAuth (user-token scopes — bot scopes won't work for search.messages)
app.get('/connect/slack', (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.add(state);
  const scopes = [
    'search:read',
    'channels:history', 'groups:history', 'im:history', 'mpim:history',
    'channels:read', 'groups:read', 'im:read', 'mpim:read',
    'users:read'
  ].join(',');
  const url = `https://slack.com/oauth/v2/authorize?client_id=${process.env.SLACK_CLIENT_ID}` +
    `&user_scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(process.env.SLACK_REDIRECT_URI)}` +
    `&state=${state}`;
  res.redirect(url);
});

// Step 2: Slack redirects back here with a code
app.get('/slack/oauth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!state || !oauthStates.has(state)) {
    return res.status(400).send('Invalid or expired OAuth state. Go back to /connect/slack and try again.');
  }
  oauthStates.delete(state);

  try {
    const tokenRes = await axios.post('https://slack.com/api/oauth.v2.access', null, {
      params: {
        client_id: process.env.SLACK_CLIENT_ID,
        client_secret: process.env.SLACK_CLIENT_SECRET,
        code,
        redirect_uri: process.env.SLACK_REDIRECT_URI
      }
    });
    const data = tokenRes.data;
    if (!data.ok) {
      return res.status(400).send(`Slack rejected the exchange: ${data.error}`);
    }
    const userToken = data.authed_user && data.authed_user.access_token;
    const userId = data.authed_user && data.authed_user.id;
    if (!userToken) {
      return res.status(400).send('No user token came back — check that user_scope was requested (see /connect/slack).');
    }
    store.saveSlackAuth({
      userToken,
      userId,
      teamId: data.team && data.team.id,
      teamName: data.team && data.team.name
    });

    // Best-effort: look up the real display name so the status page doesn't
    // just show a raw user ID. Not critical — if this fails, everything
    // still works, it just falls back to the ID.
    try {
      const info = await slack.getUserInfo(userId);
      store.saveSlackAuth({
        userToken,
        userId,
        teamId: data.team && data.team.id,
        teamName: data.team && data.team.name,
        userName: info.real_name || info.name || null
      });
    } catch (e) {
      console.error('Could not fetch display name (non-fatal):', e.message);
    }

    res.redirect('/?connected=1');
  } catch (e) {
    res.status(500).send(`OAuth exchange failed: ${e.message}`);
  }
});

// Manual triggers — useful for testing without waiting for the cron schedule.
app.post('/api/run/task-sync', async (req, res) => {
  try {
    res.json(await runTaskSync());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/run/mention-scan', async (req, res) => {
  try {
    res.json(await runMentionScan());
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Daybook web running on port ${PORT}`);
  scheduler.start();
});
