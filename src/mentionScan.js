const slack = require('./slackClient');
const sheets = require('./sheets');
const store = require('./store');

const MENTIONS_TAB = 'Mention Counts';
const MENTIONS_HEADER = ['Date', 'Mentions'];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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

async function logThreadTranscript(match) {
  const threadTs = match.thread_ts || match.ts;
  if (store.hasProcessedThread(threadTs)) return;

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

async function runMentionScan() {
  const auth = store.getSlackAuth();
  if (!auth) return { skipped: true, reason: 'slack not connected' };

  const today = todayISO();
  const matches = await slack.searchMentions(auth.userId, today);

  await sheets.ensureTab(MENTIONS_TAB, MENTIONS_HEADER);

  let newMentions = 0;
  let threadsLogged = 0;

  for (const match of matches) {
    if (store.hasProcessedMessage(match.ts)) continue;
    store.markMessageProcessed(match.ts);
    newMentions += 1;

    if (await isThread(match)) {
      await logThreadTranscript(match);
      threadsLogged += 1;
    }
  }

  const total = store.incrementMentionCount(today, newMentions);
  await sheets.upsertRowByFirstColumn(MENTIONS_TAB, today, [today, total]);

  return { skipped: false, newMentions, threadsLogged, totalToday: total };
}

module.exports = { runMentionScan };
