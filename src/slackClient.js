const axios = require('axios');
const store = require('./store');

const SLACK_API = 'https://slack.com/api';

function client(token) {
  return axios.create({
    baseURL: SLACK_API,
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function call(method, params, tokenOverride) {
  const auth = store.getSlackAuth();
  const token = tokenOverride || (auth && auth.userToken);
  if (!token) throw new Error('Slack is not connected yet — visit /connect/slack first.');
  const isGet = ['conversations.history', 'conversations.replies', 'search.messages', 'users.info', 'conversations.list']
    .includes(method);
  const res = isGet
    ? await client(token).get(`/${method}`, { params })
    : await client(token).post(`/${method}`, params);
  if (!res.data.ok) {
    throw new Error(`Slack API ${method} failed: ${res.data.error}`);
  }
  return res.data;
}

// Search for messages mentioning the given user id, after a given date (YYYY-MM-DD).
// NOTE: Slack's `after:` search modifier is exclusive of that date itself —
// after:2026-07-09 means "from 2026-07-10 onward," not including the 9th.
// Callers wanting to include "today" must pass yesterday's date here.
async function searchMentions(userId, afterDate) {
  const query = `<@${userId}> after:${afterDate}`;
  const data = await call('search.messages', { query, sort: 'timestamp', sort_dir: 'desc', count: 100 });
  return (data.messages && data.messages.matches) || [];
}

async function getThreadReplies(channel, threadTs) {
  const data = await call('conversations.replies', { channel, ts: threadTs, limit: 200 });
  return data.messages || [];
}

async function getConversationHistory(channel, oldest) {
  const data = await call('conversations.history', { channel, oldest, limit: 200 });
  return data.messages || [];
}

async function getUserInfo(userId) {
  const data = await call('users.info', { user: userId });
  return data.user;
}

// Finds the user's self-DM channel without needing im:write (conversations.open
// requires that scope; listing existing conversations does not). In Slack, a
// self-DM's `user` field equals the authed user's own id, which is how we spot it.
async function findSelfDmChannel(userId) {
  let cursor;
  let checked = 0;
  do {
    const data = await call('conversations.list', { types: 'im', limit: 200, cursor });
    const channels = data.channels || [];
    checked += channels.length;
    const selfDm = channels.find(c => c.user === userId);
    if (selfDm) return selfDm.id;
    cursor = data.response_metadata && data.response_metadata.next_cursor;
  } while (cursor);

  throw new Error(
    `Could not find your self-DM channel among ${checked} DM channel(s) checked. ` +
    'Open a DM with yourself in Slack (search your own name in Slack, click it, send any message) and try again.'
  );
}

async function getRecentChannelHistory(channel, latestTs, limit) {
  const data = await call('conversations.history', { channel, latest: latestTs, limit, inclusive: true });
  // Slack returns newest-first; reverse to chronological order for a readable transcript.
  return (data.messages || []).slice().reverse();
}

module.exports = { call, searchMentions, getThreadReplies, getConversationHistory, getUserInfo, findSelfDmChannel, getRecentChannelHistory };
