'use strict';

const Imap = require('imap');
const emailParserService = require('../services/email-parser.service');
const alertService = require('../services/alert.service');
const env = require('../config/env');

// Rate limiting for manual poll: timestamp of last manual trigger
let lastManualPollAt = null;
const MANUAL_POLL_COOLDOWN_MS = 60 * 1000; // 60 seconds

// Reconnect backoff constants
const INITIAL_RECONNECT_DELAY_MS = 5000;
const MAX_RECONNECT_DELAY_MS = 60000;
let currentReconnectDelay = INITIAL_RECONNECT_DELAY_MS;

// Low-frequency safety fallback interval (default: 12 hours)
const SAFETY_FALLBACK_INTERVAL_MS = 12 * 60 * 60 * 1000;
let fallbackTimer = null;

const imapConfig = {
  host: env.EMAIL_HOST,
  port: env.EMAIL_PORT,
  user: env.EMAIL_USER,
  password: env.EMAIL_PASSWORD,
  tls: env.EMAIL_TLS,
};

let idleClient = null;
let isProcessing = false;
let hasPendingCheck = false;
let reconnectTimer = null;
let isStopped = false;
let isBoxOpen = false;

/**
 * Runs the email poll and insertion process.
 *
 * @returns {Promise<{ processed: number, inserted: number, skipped: number }>}
 */
async function runPoll() {
  console.log('[email-poller] Checking for matching BCA transactions...');
  try {
    const result = await emailParserService.pollAndInsert(imapConfig);
    if (result.inserted > 0) {
      console.log(`[email-poller] Successfully inserted ${result.inserted} transaction(s).`);
    } else {
      console.log(`[email-poller] Check complete. processed=${result.processed} inserted=${result.inserted} skipped=${result.skipped}`);
    }

    // Auto-resolve any previous poll failure alerts upon successful execution
    await alertService.resolvePollFailureAlerts().catch(() => {});

    return result;
  } catch (err) {
    console.error('[email-poller] Error during poll execution:', err.message);

    // Create or update a poll-failure alert so mobile app displays the warning banner
    await alertService.createPollFailureAlert({
      error: `Gagal memeriksa email transaksi: ${err.message}`,
    }).catch(() => {});

    throw err;
  }
}

/**
 * Serialized handler for incoming mail events.
 * Prevents concurrent polls while ensuring new arrivals during processing are queued.
 */
async function handleIncomingMail() {
  if (isProcessing) {
    hasPendingCheck = true;
    return;
  }

  isProcessing = true;
  try {
    await runPoll();
  } catch (err) {
    console.error('[email-listener] Error processing matching transactions:', err.message);
  } finally {
    isProcessing = false;
    if (hasPendingCheck) {
      hasPendingCheck = false;
      await handleIncomingMail();
    }
  }
}

/**
 * Cleans up the existing IMAP client instance and removes all event listeners.
 */
function cleanupCurrentClient() {
  isBoxOpen = false;
  if (!idleClient) return;

  try {
    idleClient.removeAllListeners();
    idleClient.end();
  } catch (_) {}
  idleClient = null;
}

/**
 * Connects to IMAP in IDLE mode to listen for push notifications from Gmail.
 * When a new email arrives, Gmail immediately signals the connection,
 * triggering real-time inspection and transaction insertion only when criteria match.
 */
function startRealtimeListener() {
  isStopped = false;

  // If already connected and authenticated, do not re-instantiate
  if (idleClient && idleClient.state === 'authenticated') {
    return;
  }

  cleanupCurrentClient();

  console.log('[email-listener] Initializing IMAP IDLE real-time listener...');

  idleClient = new Imap({
    user: env.EMAIL_USER,
    password: env.EMAIL_PASSWORD,
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    tls: env.EMAIL_TLS,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 15000,
    authTimeout: 15000,
    keepalive: {
      interval: 10000,      // 10s heartbeat check
      idleInterval: 300000, // Re-issue IDLE every 5 minutes (well within RFC 29m limit)
      forceNoop: false,
    },
  });

  idleClient.once('ready', () => {
    console.log('[email-listener] Connected to IMAP. Opening INBOX for real-time IDLE...');
    idleClient.openBox('INBOX', false, (err) => {
      if (err) {
        console.error('[email-listener] Failed to open INBOX:', err.message);
        scheduleReconnect();
        return;
      }

      isBoxOpen = true;
      currentReconnectDelay = INITIAL_RECONNECT_DELAY_MS; // Reset backoff on success
      console.log('[email-listener] INBOX is in IDLE mode. Listening for incoming BCA notifications in real time.');

      // Auto-resolve any previous connection failure alerts on successful connect
      alertService.resolvePollFailureAlerts().catch(() => {});

      // Check for any unread transactions that arrived while the server was down
      handleIncomingMail();

      // Start safety fallback timer (every 12 hours) to guard against any silent network drops
      startSafetyFallback();
    });
  });

  // Emitted by node-imap whenever Gmail delivers a new email
  idleClient.on('mail', (numNewMsgs) => {
    // Ignore synthetic mail events emitted during initial mailbox open
    if (!isBoxOpen) return;

    console.log(`[email-listener] Incoming email event received (${numNewMsgs} new message(s)). Checking criteria...`);
    handleIncomingMail();
  });

  // Persistent error listener triggers reconnect even if close event is delayed
  idleClient.on('error', (err) => {
    console.error('[email-listener] IMAP socket error:', err.message);
    alertService.createPollFailureAlert({
      error: `Koneksi IMAP terputus: ${err.message}`,
    }).catch(() => {});
    scheduleReconnect();
  });

  idleClient.once('close', (hadError) => {
    console.warn(`[email-listener] IMAP connection closed (hadError: ${hadError}).`);
    scheduleReconnect();
  });

  idleClient.once('end', () => {
    console.log('[email-listener] IMAP connection ended.');
  });

  try {
    idleClient.connect();
  } catch (err) {
    console.error('[email-listener] Failed to start connection:', err.message);
    scheduleReconnect();
  }
}

/**
 * Schedules a reconnection attempt with exponential backoff and jitter.
 */
function scheduleReconnect() {
  if (isStopped || reconnectTimer) return;

  const jitter = Math.floor(Math.random() * 1000);
  const delay = Math.min(currentReconnectDelay + jitter, MAX_RECONNECT_DELAY_MS);
  currentReconnectDelay = Math.min(currentReconnectDelay * 2, MAX_RECONNECT_DELAY_MS);

  console.log(`[email-listener] Will attempt reconnect in ${(delay / 1000).toFixed(1)}s...`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startRealtimeListener();
  }, delay);
}

/**
 * Starts a low-frequency safety check to catch any rare dropped socket edge cases.
 */
function startSafetyFallback() {
  if (fallbackTimer) clearInterval(fallbackTimer);
  fallbackTimer = setInterval(() => {
    console.log('[email-listener] Running periodic safety check...');
    handleIncomingMail();
  }, SAFETY_FALLBACK_INTERVAL_MS);
}

/**
 * Stops the real-time listener, clears timers, and terminates active connection.
 */
function stopRealtimeListener() {
  isStopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (fallbackTimer) {
    clearInterval(fallbackTimer);
    fallbackTimer = null;
  }
  cleanupCurrentClient();
  console.log('[email-listener] Real-time listener stopped.');
}

/**
 * Manual poll trigger — called by the poll controller (POST /api/poll).
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

// Graceful process shutdown handling
process.once('SIGINT', stopRealtimeListener);
process.once('SIGTERM', stopRealtimeListener);

module.exports = {
  startRealtimeListener,
  startScheduledPoller: startRealtimeListener, // Backward compatibility alias for app.js
  stopRealtimeListener,
  triggerManualPoll,
  runPoll,
  handleIncomingMail,
};
