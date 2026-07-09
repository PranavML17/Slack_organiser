const slack = require('./slackClient');
const sheets = require('./sheets');
const store = require('./store');

const TASKS_TAB = 'Tasks';
const TASK_HEADER = ['Date', 'Task', 'Raw message ts'];

const TASK_TRIGGER = /task(s)?\s*(to\s*do)?\s*today\s*:?/i;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function parseTasks(text) {
  // Drop the trigger line itself, then split remaining lines into items.
  const withoutTrigger = text.replace(TASK_TRIGGER, '').trim();
  const lines = withoutTrigger
    .split('\n')
    .map(l => l.replace(/^\s*[-*\u2022]\s*/, '').replace(/^\s*\d+[\.\)]\s*/, '').trim())
    .filter(Boolean);
  return lines.length ? lines : (withoutTrigger ? [withoutTrigger] : []);
}

async function runTaskSync() {
  const auth = store.getSlackAuth();
  if (!auth) return { skipped: true, reason: 'slack not connected' };

  // Find your self-DM channel — the same one every time, since it's tied to your own user id.
  const channelId = await slack.findSelfDmChannel(auth.userId);

  const since = Math.floor((Date.now() - 12 * 60 * 60 * 1000) / 1000); // look back 12h
  const messages = await slack.getConversationHistory(channelId, since);

  await sheets.ensureTab(TASKS_TAB, TASK_HEADER);

  let logged = 0;
  for (const msg of messages) {
    if (!msg.text || !TASK_TRIGGER.test(msg.text)) continue;
    if (store.hasProcessedMessage(msg.ts)) continue;

    const tasks = parseTasks(msg.text);
    for (const task of tasks) {
      await sheets.appendRow(TASKS_TAB, [todayISO(), task, msg.ts]);
      logged += 1;
    }
    store.markMessageProcessed(msg.ts);
  }
  return { skipped: false, logged };
}

module.exports = { runTaskSync };
