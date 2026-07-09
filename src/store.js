// Minimal file-based store. Fine for a single-user personal deployment.
// NOTE: most free hosting tiers wipe the local filesystem on every deploy
// or restart. If your host doesn't give you a persistent disk, either:
//   - copy the SLACK_USER_TOKEN this produces into an env var once you've
//     connected, and read from env as a fallback (see slackClient.js), or
//   - swap this file for a real DB (Postgres on Supabase/Neon is free and
//     takes ~10 minutes). The rest of the app only talks to this module
//     through the functions below, so swapping the backend is contained
//     to this one file.
const path = require('path');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// If DATA_DIR is set (e.g. a Railway Volume mount path), store the DB there
// so it survives redeploys/restarts. Otherwise falls back to the project
// folder, which is fine for local testing but NOT durable on most hosts.
const dataDir = process.env.DATA_DIR || path.join(__dirname, '..');
const dbPath = path.join(dataDir, 'data.json');
const adapter = new FileSync(dbPath);
const db = low(adapter);

db.defaults({
  slack: null, // { userToken, userId, teamId, teamName }
  processedMessageTs: [], // dedupe for task-sync
  processedThreadTs: [],  // dedupe for thread summaries
  mentionCounts: {}       // { 'YYYY-MM-DD': count } — mirrors what's in the sheet, used to avoid re-adding same day row
}).write();

function saveSlackAuth(auth) {
  db.set('slack', auth).write();
}

function getSlackAuth() {
  const stored = db.get('slack').value();
  if (stored && stored.userToken) return stored;
  // Fallback: if you copied the token into an env var for durability.
  if (process.env.SLACK_USER_TOKEN) {
    return {
      userToken: process.env.SLACK_USER_TOKEN,
      userId: process.env.SLACK_USER_ID || null,
      teamId: null,
      teamName: null
    };
  }
  return null;
}

function hasProcessedMessage(ts) {
  return db.get('processedMessageTs').value().includes(ts);
}
function markMessageProcessed(ts) {
  const list = db.get('processedMessageTs').value();
  list.push(ts);
  // Keep this list from growing forever — 5000 is generous for dedupe purposes.
  db.set('processedMessageTs', list.slice(-5000)).write();
}

function hasProcessedThread(threadTs) {
  return db.get('processedThreadTs').value().includes(threadTs);
}
function markThreadProcessed(threadTs) {
  const list = db.get('processedThreadTs').value();
  list.push(threadTs);
  db.set('processedThreadTs', list.slice(-5000)).write();
}

function getMentionCount(dateKey) {
  return db.get(`mentionCounts.${dateKey}`).value() || 0;
}
function incrementMentionCount(dateKey, by = 1) {
  const current = getMentionCount(dateKey);
  db.set(`mentionCounts.${dateKey}`, current + by).write();
  return current + by;
}

module.exports = {
  saveSlackAuth,
  getSlackAuth,
  hasProcessedMessage,
  markMessageProcessed,
  hasProcessedThread,
  markThreadProcessed,
  getMentionCount,
  incrementMentionCount
};
