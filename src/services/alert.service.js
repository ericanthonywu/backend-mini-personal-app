'use strict';

const alertRepository = require('../repositories/alert.repository');
const AppError = require('../utils/app-error');

/**
 * Alert Service — business logic for alerts.
 *
 * Style: ES6 named exports (exports.fn = async () => {})
 */

/**
 * Create a parse-failure alert with full metadata for later investigation.
 * Called by email-parser.service when parseBcaEmail() fails.
 *
 * @param {{ emailMessageId?: string, htmlSnippet?: string, missingFields?: string[] }} data
 * @returns {Promise<Object>} inserted alert row
 */
exports.createParseFailureAlert = async ({ emailMessageId, htmlSnippet, missingFields } = {}) => {
  const fields = (missingFields || []).join(', ') || 'unknown';
  return alertRepository.create({
    type: 'parse_failure',
    title: 'Email gagal di-parse',
    message:
      `Email ${emailMessageId || 'unknown'} tidak bisa diproses. ` +
      `Field yang hilang: ${fields}. Perlu investigasi manual.`,
    metadata: {
      emailMessageId: emailMessageId || null,
      // Cap HTML snippet at 1 KB — enough to diagnose format changes, not bloat the DB
      htmlSnippet: (htmlSnippet || '').substring(0, 1000),
      missingFields: missingFields || [],
      occurredAt: new Date().toISOString(),
    },
  });
};

/**
 * Return all unresolved alerts (newest first).
 *
 * @returns {Promise<Array>}
 */
exports.getUnresolved = async () => alertRepository.findUnresolved();

/**
 * Return the count of unresolved alerts — lightweight call for the widget badge.
 *
 * @returns {Promise<number>}
 */
exports.getUnresolvedCount = async () => alertRepository.countUnresolved();

/**
 * Resolve a single alert by ID.
 *
 * @param {string} id
 * @returns {Promise<Object>}
 * @throws {AppError} 404 if the alert doesn't exist
 */
exports.resolveAlert = async (id) => {
  const alert = await alertRepository.resolve(id);
  if (!alert) throw new AppError('Alert not found', 404);
  return alert;
};

/**
 * Resolve ALL currently unresolved alerts at once.
 *
 * @returns {Promise<number>} number of alerts resolved
 */
exports.resolveAll = async () => alertRepository.resolveAll();
