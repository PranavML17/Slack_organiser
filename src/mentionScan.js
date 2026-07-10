const slack = require('./slackClient');
const sheets = require('./sheets');
const store = require('./store');
const summarize = require('./summarize');

const MENTIONS_TAB = 'Mention Counts';
const MENTIONS_HEADER = ['Date', 'Mentions'];

const MENTIONS_DETAIL_TAB = 'Mentions';
const MENTIONS_DETAIL_HEADER = ['Date', 'Who tagged', 'Task', 'Priority', 'AI Summarized', 'Channel', 'Permalink'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function yesterdayISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function slugForThread(channelName, ts) {
  const datePart = new Date(Number(ts.split('.')[0]) * 1000).toISOString().slice(0, 10);
  const shortTs = ts.replace('.', '').slice(-6);
  return `Thread_${datePart}_${channelName || 'dm'}_${shortTs}`;
}

async function isThread(match) {
  // Search results sometimes carry thread_ts directly.
  if (match.thread_ts && match.thread_ts !== match.ts) return true;
  try {
    const replies = await slack.getThreadReplies(match.channel.id, match.ts);
    return replies.length > 1;
  } catch (e) {
    return false; // if we can't tell, treat as a plain mention rather than fail the whole scan
  }
}

async function getNamedMessages(rawMessages) {
  return Promise.all(
    rawMessages.map(async r => {
      let label = r.user;
      try {
        const info = await slack.getUserInfo(r.user);
        label = info.real_name || info.name || r.user;
      } catch (e) { /* fall back to raw id */ }
      return { ts: r.ts, userLabel: label, text: r.text };
    })
  );
}

function formatTranscript(withNames, anchorTs) {
  return withNames.map(m => {
    const prefix = m.ts === anchorTs ? '>>> [THIS MESSAGE TAGGED THE PERSON] ' : '';
    return `${prefix}${m.userLabel}: ${m.text}`;
  }).join('\n');
}

// Context source depends entirely on whether this mention is part of a real
// Slack thread:
//  - If it IS a thread: use ONLY that thread's replies. Mixing in channel
//    history here was the actual bug — a busy channel's unrelated messages
//    would ride along even with the anchor marker, because the marker only
//    tells the model which LINE is the mention, not that the surrounding
//    noise belongs to a different topic entirely.
//  - If it's NOT a thread: fall back to recent channel history, which is
//    what catches ordinary sequential posts that were never formally
//    threaded (separate messages days apart, same topic, no thread_ts).
const CHANNEL_CONTEXT_WINDOW = 10;

async function buildContext(match, threadTs, inThread) {
  const rawMessages = inThread
    ? await slack.getThreadReplies(match.channel.id, threadTs)
    : await slack.getRecentChannelHistory(match.channel.id, match.ts, CHANNEL_CONTEXT_WINDOW);

  const withNames = await getNamedMessages(rawMessages);
  const threadOnlyWithNames = inThread ? withNames : null;

  return { contextText: formatTranscript(withNames, match.ts), threadOnlyWithNames };
}

async function writeThreadTranscriptTab(match, threadTs, withNames) {
  if (store.hasProcessedThread(threadTs)) return;
  const participants = [...new Set(withNames.map(m => m.userLabel))];
  const tabName = slugForThread(match.channel.name, threadTs);
  await sheets.createThreadTranscriptTab(tabName, [
    ['Channel', match.channel.name || match.channel.id],
    ['Thread started', new Date(Number(threadTs.split('.')[0]) * 1000).toString()],
    ['Permalink', match.permalink || ''],
    ['Participants', participants.join(', ')],
    ['Message count', String(withNames.length)],
    [],
    ['Speaker', 'Message'],
    ...withNames.map(m => [m.userLabel, m.text])
  ]);
  store.markThreadProcessed(threadTs);
}

async function logMentionDetail(match, contextText) {
  let taggerName = match.user;
  try {
    const info = await slack.getUserInfo(match.user);
    taggerName = info.real_name || info.name || match.user;
  } catch (e) { /* fall back to raw id */ }

  const analysis = await summarize.analyzeMention(contextText);
  const taskText = (analysis && analysis.task) || match.text || '';
  const priority = (analysis && analysis.priority) || '';
  const aiSummarized = analysis ? 'yes' : 'no';

  await sheets.appendRow(MENTIONS_DETAIL_TAB, [
    todayISO(),
    taggerName,
    taskText,
    priority,
    aiSummarized,
    (match.channel && match.channel.name) || (match.channel && match.channel.id) || '',
    match.permalink || ''
  ]);
}

async function runMentionScan() {
  const auth = store.getSlackAuth();
  if (!auth) return { skipped: true, reason: 'slack not connected' };

  const today = todayISO();
  const matches = await slack.searchMentions(auth.userId, yesterdayISO());

  await sheets.ensureTab(MENTIONS_TAB, MENTIONS_HEADER);
  await sheets.ensureTab(MENTIONS_DETAIL_TAB, MENTIONS_DETAIL_HEADER);

  let newMentions = 0;
  let threadsLogged = 0;

  for (const match of matches) {
    if (store.hasProcessedMessage(match.ts)) continue;
    store.markMessageProcessed(match.ts);
    newMentions += 1;

    const threadTs = match.thread_ts || match.ts;
    const inThread = await isThread(match);

    const { contextText, threadOnlyWithNames } = await buildContext(match, threadTs, inThread);

    if (inThread) {
      await writeThreadTranscriptTab(match, threadTs, threadOnlyWithNames);
      threadsLogged += 1;
    }

    await logMentionDetail(match, contextText);
  }

  const total = store.incrementMentionCount(today, newMentions);
  await sheets.upsertRowByFirstColumn(MENTIONS_TAB, today, [today, total]);

  return { skipped: false, newMentions, threadsLogged, totalToday: total };
}

module.exports = { runMentionScan };
