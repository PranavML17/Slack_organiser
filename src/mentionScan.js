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

// Logs one mention, using ONLY the message that actually contains the
// @mention — no thread, no surrounding channel history. If the AI
// confidently classifies it as not a real ask (priority: None — praise,
// FYI, casual chat), it's skipped entirely rather than logged. This tab is
// meant to be "things people are asking of you," not a full mention log —
// note that the daily count in `Mention Counts` still includes everything,
// FYIs included, since that's a different metric (raw mention volume).
async function logMentionDetail(match) {
  let taggerName = match.user;
  try {
    const info = await slack.getUserInfo(match.user);
    taggerName = info.real_name || info.name || match.user;
  } catch (e) { /* fall back to raw id */ }

  const analysis = await summarize.analyzeMention(match.text);
  const aiSummarized = analysis ? 'yes' : 'no';
  const priority = (analysis && analysis.priority) || '';

  // Only skip when the AI actually ran and confidently said "not a request."
  // If the AI call failed or there's no key configured, we don't know
  // what this is — log it with raw text rather than silently drop it.
  if (analysis && priority === 'None') {
    return { logged: false };
  }

  const taskText = (analysis && analysis.task) || match.text || '';

  await sheets.appendRow(MENTIONS_DETAIL_TAB, [
    todayISO(),
    taggerName,
    taskText,
    priority,
    aiSummarized,
    (match.channel && match.channel.name) || (match.channel && match.channel.id) || '',
    match.permalink || ''
  ]);
  return { logged: true };
}

async function runMentionScan() {
  const auth = store.getSlackAuth();
  if (!auth) return { skipped: true, reason: 'slack not connected' };

  const today = todayISO();
  const matches = await slack.searchMentions(auth.userId, yesterdayISO());

  await sheets.ensureTab(MENTIONS_TAB, MENTIONS_HEADER);
  await sheets.ensureTab(MENTIONS_DETAIL_TAB, MENTIONS_DETAIL_HEADER);

  let newMentions = 0;
  let skippedFyi = 0;

  for (const match of matches) {
    if (store.hasProcessedMessage(match.ts)) continue;
    store.markMessageProcessed(match.ts);
    newMentions += 1;

    const result = await logMentionDetail(match);
    if (!result.logged) skippedFyi += 1;
  }

  const total = store.incrementMentionCount(today, newMentions);
  await sheets.upsertRowByFirstColumn(MENTIONS_TAB, today, [today, total]);

  return { skipped: false, newMentions, skippedFyi, totalToday: total };
}

module.exports = { runMentionScan };
