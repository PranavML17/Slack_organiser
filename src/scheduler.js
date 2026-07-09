const cron = require('node-cron');
const { runTaskSync } = require('./taskSync');
const { runMentionScan } = require('./mentionScan');

function start() {
  const taskCron = process.env.TASK_SYNC_CRON || '*/15 5-11 * * *';
  const mentionCron = process.env.MENTION_SCAN_CRON || '0 * * * *';

  cron.schedule(taskCron, async () => {
    try {
      const result = await runTaskSync();
      console.log('[task-sync]', result);
    } catch (e) {
      console.error('[task-sync] failed:', e.message);
    }
  });

  cron.schedule(mentionCron, async () => {
    try {
      const result = await runMentionScan();
      console.log('[mention-scan]', result);
    } catch (e) {
      console.error('[mention-scan] failed:', e.message);
    }
  });

  console.log(`Scheduler started. Task sync: "${taskCron}" | Mention scan: "${mentionCron}"`);
}

module.exports = { start };
