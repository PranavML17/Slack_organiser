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

// Fetches a thread's replies once and resolves display names once, so both
// the transcript tab and the AI summary can reuse the same data instead of
// each re-fetching (and instead of the AI only ever seeing the isolated
// @mention line with no surrounding context).
async function getThreadWithNames(match, threadTs) {
  const replies = await slack.getThreadReplies(match.channel.id, threadTs);
  const withNames = await Promise.all(
    replies.map(async r => {
      let label = r.user;
      try {
        const info = await slack.getUserInfo(r.user);
        label = info.real_name || info.name || r.user;
      } catch (e) { /* fall back to raw id */ }
      return { userLabel: label, text: r.text };
    })
  );
  return withNames;
}

function formatTranscript(withNames) {
  return withNames.map(m => `${m.userLabel}: ${m.text}`).join('\n');
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

    // Default: just the single message. Only upgraded to the full thread
    // transcript below if this mention actually turned out to be part of one.
    let contextText = match.text;

    if (inThread) {
      const withNames = await getThreadWithNames(match, threadTs);
      contextText = formatTranscript(withNames);
      await writeThreadTranscriptTab(match, threadTs, withNames);
      threadsLogged += 1;
    }

    await logMentionDetail(match, contextText);
  }

  const total = store.incrementMentionCount(today, newMentions);
  await sheets.upsertRowByFirstColumn(MENTIONS_TAB, today, [today, total]);

  return { skipped: false, newMentions, threadsLogged, totalToday: total };
}

module.exports = { runMentionScan };
