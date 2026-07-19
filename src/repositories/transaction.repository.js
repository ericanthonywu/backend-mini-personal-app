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
      sortBy = 'date',
      sortOrder = 'desc',
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

    // Separate count and sum queries to avoid GROUP BY conflicts with SELECT *
    const countQuery = db('transactions as t');
    const sumQuery = db('transactions as t');

    if (categoryId !== undefined) {
      baseQuery.where('t.category_id', categoryId);
      countQuery.where('t.category_id', categoryId);
      sumQuery.where('t.category_id', categoryId);
    }
    if (isIgnored !== undefined) {
      baseQuery.where('t.is_ignored', isIgnored);
      countQuery.where('t.is_ignored', isIgnored);
      sumQuery.where('t.is_ignored', isIgnored);
    }
    if (dateFrom) {
      baseQuery.where('t.transaction_date', '>=', dateFrom);
      countQuery.where('t.transaction_date', '>=', dateFrom);
      sumQuery.where('t.transaction_date', '>=', dateFrom);
    }
    if (dateTo) {
      baseQuery.where('t.transaction_date', '<=', dateTo);
      countQuery.where('t.transaction_date', '<=', dateTo);
      sumQuery.where('t.transaction_date', '<=', dateTo);
    }
    if (search) {
      baseQuery.whereILike('t.merchant', `%${search}%`);
      countQuery.whereILike('t.merchant', `%${search}%`);
      sumQuery.whereILike('t.merchant', `%${search}%`);
    }

    const [{ count }] = await countQuery.count('t.id as count');
    const [{ sum }] = await sumQuery.sum('t.amount as sum');

    const sortColumn = sortBy === 'amount' ? 't.amount' : 't.transaction_date';
    const data = await baseQuery
      .orderBy(sortColumn, sortOrder)
      .orderBy('t.transaction_date', 'desc')
      .limit(limit)
      .offset(offset);

    return {
      data,
      total: parseInt(count, 10),
      totalAmount: parseInt(sum || '0', 10),
    };
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
    if (data.amount !== undefined) updates.amount = data.amount;

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

  /**
   * Get daily spending totals for a date range, split by real vs total.
   *
   * @param {Date} dateFrom
   * @param {Date} dateTo
   * @returns {Promise<Array<{ date: string, realSpent: number, totalSpent: number }>>}
   */
  async findDailyTotals(dateFrom, dateTo) {
    const rows = await db('transactions')
      .whereBetween('transaction_date', [dateFrom, dateTo])
      .select(
        db.raw('DATE(transaction_date) as date'),
        db.raw('SUM(amount) as total_spent'),
        db.raw('SUM(CASE WHEN is_ignored = false THEN amount ELSE 0 END) as real_spent')
      )
      .groupByRaw('DATE(transaction_date)')
      .orderBy('date', 'asc');

    return rows.map((r) => ({
      date: r.date instanceof Date ? r.date.toISOString().split('T')[0] : String(r.date),
      realSpent: parseInt(r.real_spent || '0', 10),
      totalSpent: parseInt(r.total_spent || '0', 10),
    }));
  },

  /**
   * Get spending totals grouped by week-of-month for a given year/month.
   * Week 1 = days 1–7, Week 2 = 8–14, Week 3 = 15–21, Week 4 = 22–28, Week 5 = 29–end.
   *
   * @param {number} year
   * @param {number} month  1-indexed
   * @returns {Promise<Array<{ week: number, realSpent: number, totalSpent: number }>>}
   */
  async findWeeklyTotals(year, month) {
    const monthStart = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const monthEnd   = new Date(year, month, 0, 23, 59, 59, 999);

    const rows = await db('transactions')
      .whereBetween('transaction_date', [monthStart, monthEnd])
      .select(
        db.raw(`CEIL(EXTRACT(DAY FROM transaction_date) / 7.0)::int AS week_num`),
        db.raw('SUM(amount) as total_spent'),
        db.raw('SUM(CASE WHEN is_ignored = false THEN amount ELSE 0 END) as real_spent')
      )
      .groupByRaw(`CEIL(EXTRACT(DAY FROM transaction_date) / 7.0)::int`)
      .orderBy('week_num', 'asc');

    return rows.map((r) => ({
      week: parseInt(r.week_num, 10),
      realSpent: parseInt(r.real_spent || '0', 10),
      totalSpent: parseInt(r.total_spent || '0', 10),
    }));
  },

  /**
   * Get spending totals grouped by month for a given year.
   *
   * @param {number} year
   * @returns {Promise<Array<{ month: number, realSpent: number, totalSpent: number }>>}
   */
  async findMonthlyTotals(year) {
    const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
    const yearEnd   = new Date(year, 11, 31, 23, 59, 59, 999);

    const rows = await db('transactions')
      .whereBetween('transaction_date', [yearStart, yearEnd])
      .select(
        db.raw('EXTRACT(MONTH FROM transaction_date)::int AS month_num'),
        db.raw('SUM(amount) as total_spent'),
        db.raw('SUM(CASE WHEN is_ignored = false THEN amount ELSE 0 END) as real_spent')
      )
      .groupByRaw('EXTRACT(MONTH FROM transaction_date)::int')
      .orderBy('month_num', 'asc');

    return rows.map((r) => ({
      month: parseInt(r.month_num, 10),
      realSpent: parseInt(r.real_spent || '0', 10),
      totalSpent: parseInt(r.total_spent || '0', 10),
    }));
  },
};

module.exports = transactionRepository;
