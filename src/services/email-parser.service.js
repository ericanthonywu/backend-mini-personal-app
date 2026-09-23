'use strict';

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { parseBcaEmail } = require('../utils/email-parser.util');
const transactionRepository = require('../repositories/transaction.repository');
const merchantRuleRepository = require('../repositories/merchant-rule.repository');
const alertService = require('./alert.service');

const DEFAULT_ALLOWED_SENDERS = [
  'kartukreditbca@bca.co.id',
  'KartuKreditBCA@klikbca.com',
  'kartukredit@klikbca.com',
  'kartukredit@bca.co.id',
  'e-statement@klikbca.com',
  'estatement@bca.co.id',
  'info@bca.co.id',
  'halobca@bca.co.id',
];

const envSenders = process.env.BCA_ALLOWED_SENDERS
  ? process.env.BCA_ALLOWED_SENDERS.split(',').map((s) => s.trim()).filter(Boolean)
  : [];

const ALLOWED_BCA_SENDERS = Array.from(new Set([...DEFAULT_ALLOWED_SENDERS, ...envSenders]));
const BCA_SUBJECT_KEYWORD = 'Credit Card Transaction Notification';

/**
 * Builds a nested IMAP OR search criteria tree for an array of criteria.
 * IMAP RFC 3501 'OR' takes exactly two operands: OR A (OR B C)
 *
 * @param {Array} criteriaList
 * @returns {Array}
 */
function buildOrCriteria(criteriaList) {
  if (!criteriaList || criteriaList.length === 0) return [];
  if (criteriaList.length === 1) return criteriaList[0];
  if (criteriaList.length === 2) {
    return ['OR', criteriaList[0], criteriaList[1]];
  }
  return ['OR', criteriaList[0], buildOrCriteria(criteriaList.slice(1))];
}

/**
 * Email Parser Service — connects to Gmail IMAP and parses BCA emails.
 */
const emailParserService = {
  /**
   * Main entry point: fetch new BCA emails and insert transactions.
   * Called by both the cron job and the manual poll endpoint.
   *
   * @param {Object} imapConfig - IMAP connection config
   * @returns {Promise<{ processed: number, inserted: number, skipped: number }>}
   */
  async pollAndInsert(imapConfig) {
    const emails = await emailParserService.fetchBcaEmails(imapConfig);

    let inserted = 0;
    let skipped = 0;

    for (const email of emails) {
      // Ensure the email subject contains Credit Card Transaction Notification
      const subject = email.subject || '';
      if (!subject.toLowerCase().includes(BCA_SUBJECT_KEYWORD.toLowerCase())) {
        console.warn(`[email-parser] Skipping email with non-matching subject: "${subject}" (${email.messageId})`);
        skipped++;
        continue;
      }

      // Ensure the email sender matches an allowed BCA sender
      const fromAddress = (email.from?.value?.[0]?.address || email.from?.text || '').toLowerCase();
      const isAllowedSender = ALLOWED_BCA_SENDERS.some((allowed) =>
        fromAddress.includes(allowed.toLowerCase())
      );

      if (!isAllowedSender) {
        console.warn(`[email-parser] Skipping email from unauthorized sender: "${fromAddress}" (${email.messageId})`);
        skipped++;
        continue;
      }

      const parsed = parseBcaEmail(email.html || email.textAsHtml || '');

      // parsed is null (date/amount parse failure) or { error, missingFields } (missing fields)
      if (!parsed || parsed.error) {
        console.warn(`[email-parser] Could not parse email: ${email.messageId}`);

        // Persist a parse-failure alert so the mobile app can surface it to the user.
        // Wrapped in try-catch — alert DB failure must never break email processing.
        try {
          await alertService.createParseFailureAlert({
            emailMessageId: email.messageId,
            htmlSnippet: (email.html || email.textAsHtml || '').substring(0, 1000),
            missingFields: parsed?.missingFields || [],
          });
        } catch (alertErr) {
          console.error('[email-parser] Failed to persist parse-failure alert:', alertErr.message);
        }

        skipped++;
        continue;
      }

      // Auto-categorize based on merchant rules
      const rule = await merchantRuleRepository.findMatchingRule(parsed.merchant);
      const categoryId = rule ? rule.category_id : null;

      const result = await transactionRepository.createIgnoreDuplicate({
        amount: parsed.amount,
        transactionDate: parsed.transactionDate,
        merchant: parsed.merchant,
        transactionType: parsed.transactionType,
        notes: parsed.notes,
        categoryId,
        emailMessageId: email.messageId,
      });

      if (result) {
        inserted++;
        console.log(`[email-parser] Inserted transaction: ${parsed.merchant} Rp${parsed.amount}`);
      } else {
        skipped++;
        console.log(`[email-parser] Skipped duplicate: ${email.messageId}`);
      }
    }

    return { processed: emails.length, inserted, skipped };
  },

  /**
   * Connects to IMAP and fetches only UNSEEN BCA notification emails.
   * After fetching, marks them as SEEN so they won't be re-processed.
   *
   * @param {{ host: string, port: number, user: string, password: string, tls: boolean }} config
   * @returns {Promise<Array>} - array of parsed email objects from mailparser
   */
  fetchBcaEmails(config) {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls,
        tlsOptions: { rejectUnauthorized: false },
        authTimeout: 10000,
      });

      const emails = [];

      imap.once('ready', () => {
        // Open inbox as read-write (false = not read-only) so we can set flags
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          const senderCriteria = buildOrCriteria(
            ALLOWED_BCA_SENDERS.map((sender) => ['HEADER', 'FROM', sender])
          );

          // Search only UNSEEN BCA emails matching the CC notification subject and allowed senders
          imap.search(
            [
              'UNSEEN',
              ['HEADER', 'SUBJECT', BCA_SUBJECT_KEYWORD],
              senderCriteria,
            ],
            (searchErr, results) => {
              if (searchErr) {
                imap.end();
                return reject(searchErr);
              }

              if (!results || results.length === 0) {
                console.log('[email-parser] No new (unseen) BCA emails found');
                imap.end();
                return resolve([]);
              }

              console.log(`[email-parser] Found ${results.length} new BCA email(s) to process`);

              const fetch = imap.fetch(results, { bodies: '' });
              const pending = [];

              fetch.on('message', (msg) => {
                pending.push(
                  new Promise((res, rej) => {
                    msg.on('body', (stream) => {
                      simpleParser(stream, (parseErr, parsed) => {
                        if (parseErr) return rej(parseErr);
                        res(parsed);
                      });
                    });
                  })
                );
              });

              fetch.once('error', (fetchErr) => {
                imap.end();
                reject(fetchErr);
              });

              fetch.once('end', async () => {
                try {
                  const resolved = await Promise.all(pending);
                  emails.push(...resolved.filter(Boolean));

                  // Mark fetched emails as SEEN so they won't be picked up again
                  imap.setFlags(results, ['\\Seen'], (flagErr) => {
                    if (flagErr) {
                      console.warn('[email-parser] Failed to mark emails as SEEN:', flagErr.message);
                    }
                    imap.end();
                  });
                } catch (e) {
                  imap.end();
                  reject(e);
                }
              });
            }
          );
        });
      });

      let isSettled = false;
      function safeReject(err) {
        if (!isSettled) {
          isSettled = true;
          reject(err);
        }
      }
      function safeResolve(val) {
        if (!isSettled) {
          isSettled = true;
          resolve(val);
        }
      }

      // Persistent error listener prevents unhandled error crashes if connection resets during disconnect
      imap.on('error', (err) => {
        if (!isSettled) {
          console.error('[email-parser] IMAP connection error:', err.message);
          safeReject(err);
        } else {
          console.warn('[email-parser] IMAP socket teardown warning:', err.message);
        }
      });

      imap.once('end', () => {
        safeResolve(emails);
      });

      imap.connect();
    });
  },
};

emailParserService.ALLOWED_BCA_SENDERS = ALLOWED_BCA_SENDERS;
emailParserService.buildOrCriteria = buildOrCriteria;

module.exports = emailParserService;
