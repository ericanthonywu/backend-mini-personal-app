'use strict';

const Imap = require('imap');
const { simpleParser } = require('mailparser');
const { parseBcaEmail } = require('../utils/email-parser.util');
const transactionRepository = require('../repositories/transaction.repository');
const merchantRuleRepository = require('../repositories/merchant-rule.repository');

const BCA_SENDER = 'kartukredit@klikbca.com';
const BCA_SENDER_ALT = 'KartuKreditBCA@klikbca.com';
const BCA_SUBJECT_KEYWORD = 'Credit Card Transaction Notification';

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
      const parsed = parseBcaEmail(email.html || email.textAsHtml || '');
      if (!parsed) {
        console.warn(`[email-parser] Could not parse email: ${email.messageId}`);
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

          // Search only UNSEEN BCA emails — already-processed emails are marked SEEN
          imap.search(
            [
              'UNSEEN',
              ['HEADER', 'SUBJECT', BCA_SUBJECT_KEYWORD],
              ['OR',
                ['HEADER', 'FROM', BCA_SENDER],
                ['HEADER', 'FROM', BCA_SENDER_ALT],
              ],
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

      imap.once('error', (err) => {
        console.error('[email-parser] IMAP connection error:', err.message);
        reject(err);
      });

      imap.once('end', () => {
        resolve(emails);
      });

      imap.connect();
    });
  },
};

module.exports = emailParserService;
