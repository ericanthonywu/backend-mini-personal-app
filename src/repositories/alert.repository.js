'use strict';

const db = require('../config/database');

/**
 * Alert Repository — all DB access for the alerts table.
 * Returns plain objects. No business logic.
 *
 * Style: ES6 named exports (exports.fn = async () => {})
 */

/**
 * Create a new alert.
 *
 * @param {{ type?: string, title: string, message: string, metadata?: object }} data
 * @returns {Promise<Object>} the inserted row
 */
exports.create = async (data) => {
  const now = new Date();
  const [row] = await db('alerts')
    .insert({
      type: data.type || 'parse_failure',
      title: data.title,
      message: data.message,
      metadata: JSON.stringify(data.metadata || {}),
      is_resolved: false,
      created_at: now,
      updated_at: now,
    })
    .returning('*');
  return row;
};

/**
 * Find all unresolved alerts, newest first.
 *
 * @returns {Promise<Array>}
 */
exports.findUnresolved = async () =>
  db('alerts').where('is_resolved', false).orderBy('created_at', 'desc');

/**
 * Count unresolved alerts — lightweight query used by the widget badge endpoint.
 *
 * @returns {Promise<number>}
 */
exports.countUnresolved = async () => {
  const [{ count }] = await db('alerts')
    .where('is_resolved', false)
    .count('id as count');
  return parseInt(count, 10);
};

/**
 * Mark one alert as resolved.
 *
 * @param {string} id
 * @returns {Promise<Object|undefined>} updated row, or undefined if not found
 */
exports.resolve = async (id) => {
  const now = new Date();
  const [row] = await db('alerts')
    .where({ id })
    .update({ is_resolved: true, resolved_at: now, updated_at: now })
    .returning('*');
  return row;
};

/**
 * Mark ALL currently unresolved alerts as resolved at once.
 *
 * @returns {Promise<number>} number of rows updated
 */
exports.resolveAll = async () => {
  const now = new Date();
  return db('alerts')
    .where('is_resolved', false)
    .update({ is_resolved: true, resolved_at: now, updated_at: now });
};

/**
 * Find unresolved alerts filtered by type.
 *
 * @param {string} type
 * @returns {Promise<Array>}
 */
exports.findUnresolvedByType = async (type) =>
  db('alerts')
    .where({ is_resolved: false, type })
    .orderBy('created_at', 'desc');

/**
 * Update message and metadata on an existing alert.
 *
 * @param {string} id
 * @param {{ message: string, metadata?: object }} data
 * @returns {Promise<Object|undefined>}
 */
exports.updateMessage = async (id, { message, metadata }) => {
  const now = new Date();
  const [row] = await db('alerts')
    .where({ id })
    .update({
      message,
      metadata: JSON.stringify(metadata || {}),
      updated_at: now,
    })
    .returning('*');
  return row;
};

/**
 * Mark all unresolved alerts of a specific type as resolved.
 *
 * @param {string} type
 * @returns {Promise<number>} number of rows updated
 */
exports.resolveByType = async (type) => {
  const now = new Date();
  return db('alerts')
    .where({ is_resolved: false, type })
    .update({ is_resolved: true, resolved_at: now, updated_at: now });
};
