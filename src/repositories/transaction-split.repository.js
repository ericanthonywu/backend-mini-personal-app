'use strict';

const db = require('../config/database');

/**
 * Transaction Split Repository — all DB access for transaction splits.
 * Returns plain objects. No business logic.
 */
const transactionSplitRepository = {
  /**
   * Insert a new split payment.
   *
   * @param {{ transactionId: string, amount: number, paidBy: string, notes?: string }} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const now = new Date();
    const [row] = await db('transaction_splits')
      .insert({
        transaction_id: data.transactionId,
        amount: data.amount,
        paid_by: data.paidBy.trim(),
        notes: (data.notes || '').trim(),
        created_at: now,
        updated_at: now,
      })
      .returning('*');
    return row;
  },

  /**
   * Find a single split payment by ID.
   *
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async findById(id) {
    return db('transaction_splits').where({ id }).first();
  },

  /**
   * Find all split payments for a transaction ordered by created_at asc.
   *
   * @param {string} transactionId
   * @returns {Promise<Array>}
   */
  async findByTransactionId(transactionId) {
    return db('transaction_splits')
      .where({ transaction_id: transactionId })
      .orderBy('created_at', 'asc');
  },

  /**
   * Update an existing split payment.
   *
   * @param {string} id
   * @param {{ amount?: number, paidBy?: string, notes?: string }} data
   * @returns {Promise<Object|undefined>}
   */
  async update(id, data) {
    const updates = { updated_at: new Date() };
    if (data.amount !== undefined) updates.amount = data.amount;
    if (data.paidBy !== undefined) updates.paid_by = data.paidBy.trim();
    if (data.notes !== undefined) updates.notes = data.notes.trim();

    const [row] = await db('transaction_splits').where({ id }).update(updates).returning('*');
    return row;
  },

  /**
   * Delete a split payment.
   *
   * @param {string} id
   * @returns {Promise<number>}
   */
  async delete(id) {
    return db('transaction_splits').where({ id }).delete();
  },

  /**
   * Sum total split amounts for a transaction, optionally excluding a specific split ID (for edits).
   *
   * @param {string} transactionId
   * @param {string} [excludeSplitId]
   * @returns {Promise<number>}
   */
  async sumByTransactionId(transactionId, excludeSplitId) {
    const query = db('transaction_splits').where({ transaction_id: transactionId });
    if (excludeSplitId) {
      query.whereNot({ id: excludeSplitId });
    }
    const [{ sum }] = await query.sum('amount as sum');
    return parseInt(sum || '0', 10);
  },
};

module.exports = transactionSplitRepository;
