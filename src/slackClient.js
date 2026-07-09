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
  const isGet = ['conversations.history', 'conversations.replies', 'search.messages', 'users.info']
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
  const data = await call('conversations.list', { types: 'im', limit: 200 });
  const channels = data.channels || [];
  const selfDm = channels.find(c => c.user === userId);
  if (!selfDm) {
    throw new Error(
      'Could not find your self-DM channel. Open a DM with yourself in Slack ' +
      '(search your own name in Slack, click it, send any message) and try again.'
    );
  }
  return selfDm.id;
}

module.exports = { call, searchMentions, getThreadReplies, getConversationHistory, getUserInfo, findSelfDmChannel };
