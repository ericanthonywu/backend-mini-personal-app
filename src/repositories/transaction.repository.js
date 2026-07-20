'use strict';

const moment = require('moment-timezone');
const db     = require('../config/database');

const TZ = 'Asia/Jakarta'; // WIB (UTC+7)

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
    // Use WIB timezone for DATE extraction so that transactions that occur
    // in the evening (e.g. 18:00 UTC = midnight+1 WIB) are grouped to the
    // correct WIB calendar day.
    const rows = await db('transactions')
      .whereBetween('transaction_date', [dateFrom, dateTo])
      .select(
        db.raw(`DATE(transaction_date AT TIME ZONE 'Asia/Jakarta') as date`),
        db.raw('SUM(amount) as total_spent'),
        db.raw('SUM(CASE WHEN is_ignored = false THEN amount ELSE 0 END) as real_spent')
      )
      .groupByRaw(`DATE(transaction_date AT TIME ZONE 'Asia/Jakarta')`)
      .orderBy('date', 'asc');

    return rows.map((r) => ({
      // moment parses the raw date value and formats it cleanly in WIB.
      date: moment.tz(r.date, TZ).format('YYYY-MM-DD'),
      realSpent:  parseInt(r.real_spent  || '0', 10),
      totalSpent: parseInt(r.total_spent || '0', 10),
    }));
  },

  /**
   * Get spending totals grouped by calendar week (Mon–Sun) for a given year/month.
   *
   * Weeks are full Mon–Sun calendar weeks. The first week starts on the Monday
   * on or before the 1st of the month, and the last week ends on the Sunday on
   * or after the last day of the month — meaning weeks can span month boundaries.
   * A cross-month week (e.g. Jul 27–Aug 2) will appear in both July and August
   * with the same combined total, so the spending summary and transaction list
   * always show the same numbers for any given week.
   *
   * @param {number} year
   * @param {number} month  1-indexed
   * @returns {Promise<Array<{ week: number, startDate: string, endDate: string, realSpent: number, totalSpent: number }>>}
   */
  async findWeeklyTotals(year, month) {
    // Build the Mon–Sun week boundaries that cover this month.
    const firstDayOfMonth = new Date(year, month - 1, 1);
    const lastDayOfMonth  = new Date(year, month, 0); // day 0 = last day of month

    // Find the Monday on or before the 1st of the month
    const firstDow = firstDayOfMonth.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysToMonday = firstDow === 0 ? 6 : firstDow - 1;
    const firstWeekStart = new Date(firstDayOfMonth);
    firstWeekStart.setDate(firstDayOfMonth.getDate() - daysToMonday);

    const weeks = [];
    let weekNum = 1;
    let weekStart = new Date(firstWeekStart);
    weekStart.setHours(0, 0, 0, 0);

    // Generate weeks until the start is after the last day of the month
    while (weekStart <= lastDayOfMonth) {
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);
      weekEnd.setHours(23, 59, 59, 999);

      weeks.push({
        week: weekNum,
        start: new Date(weekStart),
        end: new Date(weekEnd),
      });

      weekNum++;
      weekStart = new Date(weekStart);
      weekStart.setDate(weekStart.getDate() + 7);
    }

    // Query each week separately so cross-month transactions are included
    const results = await Promise.all(
      weeks.map(async (w) => {
        const [row] = await db('transactions')
          .whereBetween('transaction_date', [w.start, w.end])
          .select(
            db.raw('SUM(amount) as total_spent'),
            db.raw('SUM(CASE WHEN is_ignored = false THEN amount ELSE 0 END) as real_spent')
          );
        // Format dates in WIB using moment-timezone.
        return {
          week: w.week,
          startDate: moment.tz(w.start, TZ).format('YYYY-MM-DD'),
          endDate:   moment.tz(w.end,   TZ).format('YYYY-MM-DD'),
          realSpent:  parseInt(row.real_spent  || '0', 10),
          totalSpent: parseInt(row.total_spent || '0', 10),
        };
      })
    );

    return results;
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

  /**
   * Get today's spending totals and top N most expensive non-ignored transactions.
   *
   * @param {Date} dateFrom  — start of today (WIB midnight)
   * @param {Date} dateTo    — end of today (WIB 23:59:59)
   * @param {number} [limit] — max transactions to return (default 5)
   * @returns {Promise<{ totalSpent: number, realSpent: number, topTransactions: Array }>}
   */
  async findDailySummary(dateFrom, dateTo, limit = 5) {
    const [totalsRow] = await db('transactions')
      .whereBetween('transaction_date', [dateFrom, dateTo])
      .select(
        db.raw('SUM(amount) as total_spent'),
        db.raw('SUM(CASE WHEN is_ignored = false THEN amount ELSE 0 END) as real_spent')
      );

    const topRows = await db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .whereBetween('t.transaction_date', [dateFrom, dateTo])
      .where('t.is_ignored', false)
      .select(
        't.id',
        't.merchant',
        't.amount',
        't.transaction_date',
        't.notes',
        'c.name as category_name',
        'c.color as category_color'
      )
      .orderBy('t.amount', 'desc')
      .limit(limit);

    return {
      totalSpent: parseInt(totalsRow.total_spent || '0', 10),
      realSpent:  parseInt(totalsRow.real_spent  || '0', 10),
      topTransactions: topRows.map((r) => ({
        id:              r.id,
        merchant:        r.merchant,
        amount:          parseInt(r.amount, 10),
        transactionDate: r.transaction_date,
        notes:           r.notes || '',
        categoryName:    r.category_name  || null,
        categoryColor:   r.category_color || null,
      })),
    };
  },
};

module.exports = transactionRepository;
