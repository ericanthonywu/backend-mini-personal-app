'use strict';

const cron = require('node-cron');
const emailParserService = require('../services/email-parser.service');
const env = require('../config/env');

// Rate limiting for manual poll: timestamp of last manual trigger
let lastManualPollAt = null;
const MANUAL_POLL_COOLDOWN_MS = 60 * 1000; // 60 seconds

const imapConfig = {
  host: env.EMAIL_HOST,
  port: env.EMAIL_PORT,
  user: env.EMAIL_USER,
  password: env.EMAIL_PASSWORD,
  tls: env.EMAIL_TLS,
};

/**
 * Runs the email poll job.
 *
 * @returns {Promise<{ processed: number, inserted: number, skipped: number }>}
 */
async function runPoll() {
  console.log('[email-poller] Starting poll...');
  const result = await emailParserService.pollAndInsert(imapConfig);
  console.log(`[email-poller] Done. processed=${result.processed} inserted=${result.inserted} skipped=${result.skipped}`);
  return result;
}

/**
 * Manual poll trigger — called by the poll controller.
 * Rate limited to once per 60 seconds.
 *
 * @returns {Promise<{ processed: number, inserted: number, skipped: number }>}
 * @throws {Error} if called too soon after last poll
 */
async function triggerManualPoll() {
  const now = Date.now();

  if (lastManualPollAt && now - lastManualPollAt < MANUAL_POLL_COOLDOWN_MS) {
    const waitSecs = Math.ceil((MANUAL_POLL_COOLDOWN_MS - (now - lastManualPollAt)) / 1000);
    const err = new Error(`Rate limited. Please wait ${waitSecs}s before polling again.`);
    err.statusCode = 429;
    throw err;
  }

  lastManualPollAt = now;
  return runPoll();
}

/**
 * Starts the recurring cron poll job.
 * Interval is set by EMAIL_POLL_INTERVAL_MS env var (default: 1 hour).
 *
 * node-cron uses cron syntax, not milliseconds, so we convert:
 *   1 hour  = "0 * * * *"
 *   30 mins = "0/30 * * * *"
 *   etc.
 */
function startScheduledPoller() {
  const intervalMs = env.EMAIL_POLL_INTERVAL_MS;

  // Convert ms to a human-readable description for logging
  const intervalMins = Math.round(intervalMs / 60000);
  const cronExpression = intervalMins >= 60
    ? `0 */${Math.round(intervalMins / 60)} * * *`  // hourly
    : `*/${intervalMins} * * * *`;                    // every N minutes

  console.log(`[email-poller] Scheduled poll every ~${intervalMins} min (${cronExpression})`);

  cron.schedule(cronExpression, async () => {
    try {
      await runPoll();
    } catch (err) {
      console.error('[email-poller] Scheduled poll error:', err.message);
    }
  });

  // Run once immediately at startup
  runPoll().catch((err) => {
    console.error('[email-poller] Initial poll error:', err.message);
  });
}

module.exports = { startScheduledPoller, triggerManualPoll };
