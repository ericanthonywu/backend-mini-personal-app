'use strict';

const db = require('../config/database');

/**
 * Transaction Repository — all DB access for transactions.
 * Returns plain objects. No business logic.
 */
const transactionRepository = {
  /**
   * Find transactions with optional filters and pagination.
   *
   * @param {{ categoryId?: string, isIgnored?: boolean, dateFrom?: Date, dateTo?: Date, search?: string, limit?: number, offset?: number }} filters
   * @returns {Promise<{ data: Array, total: number }>}
   */
  async findAll(filters = {}) {
    const {
      categoryId,
      isIgnored,
      dateFrom,
      dateTo,
      search,
      limit = 20,
      offset = 0,
    } = filters;

    const baseQuery = db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .select(
        't.*',
        'c.name as category_name',
        'c.color as category_color'
      );

    if (categoryId !== undefined) baseQuery.where('t.category_id', categoryId);
    if (isIgnored !== undefined) baseQuery.where('t.is_ignored', isIgnored);
    if (dateFrom) baseQuery.where('t.transaction_date', '>=', dateFrom);
    if (dateTo) baseQuery.where('t.transaction_date', '<=', dateTo);
    if (search) baseQuery.whereILike('t.merchant', `%${search}%`);

    const [{ count }] = await baseQuery.clone().count('t.id as count');

    const data = await baseQuery
      .orderBy('t.transaction_date', 'desc')
      .limit(limit)
      .offset(offset);

    return { data, total: parseInt(count, 10) };
  },

  /**
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async findById(id) {
    return db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .select('t.*', 'c.name as category_name', 'c.color as category_color')
      .where('t.id', id)
      .first();
  },

  /**
   * @param {string} emailMessageId
   * @returns {Promise<Object|undefined>}
   */
  async findByEmailMessageId(emailMessageId) {
    return db('transactions').where({ email_message_id: emailMessageId }).first();
  },

  /**
   * Insert transaction, silently skip if email_message_id already exists (dedup).
   *
   * @param {{ amount: number, transactionDate: Date, merchant: string, transactionType: string, notes: string, categoryId?: string, emailMessageId: string }} data
   * @returns {Promise<Object|null>} - inserted row or null if duplicate
   */
  async createIgnoreDuplicate(data) {
    const now = new Date();
    const rows = await db('transactions')
      .insert({
        amount: data.amount,
        transaction_date: data.transactionDate,
        merchant: data.merchant,
        transaction_type: data.transactionType,
        notes: data.notes,
        category_id: data.categoryId || null,
        is_ignored: false,
        email_message_id: data.emailMessageId,
        created_at: now,
        updated_at: now,
      })
      .onConflict('email_message_id')
      .ignore()
      .returning('*');

    return rows.length > 0 ? rows[0] : null;
  },

  /**
   * @param {string} id
   * @param {{ categoryId?: string, isIgnored?: boolean }} data
   * @returns {Promise<Object|undefined>}
   */
  async update(id, data) {
    const updates = { updated_at: new Date() };
    if (data.categoryId !== undefined) updates.category_id = data.categoryId;
    if (data.isIgnored !== undefined) updates.is_ignored = data.isIgnored;

    const [row] = await db('transactions').where({ id }).update(updates).returning('*');
    return row;
  },

  /**
   * Get total amount of non-ignored transactions within a date range.
   *
   * @param {Date} dateFrom
   * @param {Date} dateTo
   * @param {boolean} excludeIgnored - if true, exclude is_ignored=true rows
   * @returns {Promise<number>}
   */
  async sumAmount(dateFrom, dateTo, excludeIgnored = false) {
    const query = db('transactions')
      .whereBetween('transaction_date', [dateFrom, dateTo]);

    if (excludeIgnored) {
      query.where('is_ignored', false);
    }

    const [{ sum }] = await query.sum('amount as sum');
    return parseInt(sum || '0', 10);
  },

  /**
   * Get recent transactions for dashboard.
   *
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async findRecent(limit = 5) {
    return db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .select('t.*', 'c.name as category_name', 'c.color as category_color')
      .orderBy('t.transaction_date', 'desc')
      .limit(limit);
  },
};

module.exports = transactionRepository;
