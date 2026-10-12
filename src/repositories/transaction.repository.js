'use strict';

const crypto = require('crypto');
const moment = require('moment-timezone');
const db     = require('../config/database');

const TZ = 'Asia/Jakarta'; // WIB (UTC+7)

/**
 * Returns a Knex subquery that aggregates total split amounts per transaction.
 */
function getSplitsSubquery() {
  return db('transaction_splits')
    .select('transaction_id')
    .sum('amount as total_split')
    .groupBy('transaction_id')
    .as('ts');
}

/**
 * Attaches split payments, total_split_amount, and net_amount to an array of transaction objects.
 *
 * @param {Array<Object>} transactions
 * @returns {Promise<Array<Object>>}
 */
async function attachSplitsToTransactions(transactions) {
  if (!transactions || transactions.length === 0) return [];
  const txIds = transactions.map((t) => t.id);
  const splits = await db('transaction_splits')
    .whereIn('transaction_id', txIds)
    .orderBy('created_at', 'asc');

  const splitsByTxId = {};
  for (const s of splits) {
    if (!splitsByTxId[s.transaction_id]) {
      splitsByTxId[s.transaction_id] = [];
    }
    splitsByTxId[s.transaction_id].push({
      id: s.id,
      transaction_id: s.transaction_id,
      amount: parseInt(s.amount, 10),
      paid_by: s.paid_by,
      notes: s.notes || '',
      created_at: s.created_at,
      updated_at: s.updated_at,
    });
  }

  return transactions.map((t) => {
    const txSplits = splitsByTxId[t.id] || [];
    const totalSplit = txSplits.reduce((sum, s) => sum + s.amount, 0);
    const amount = parseInt(t.amount, 10);
    return {
      ...t,
      amount,
      original_amount: amount,
      total_split_amount: totalSplit,
      net_amount: Math.max(0, amount - totalSplit),
      splits: txSplits,
    };
  });
}

/**
 * Transaction Repository — all DB access for transactions.
 * Returns plain objects. No business logic.
 */
const transactionRepository = {
  /**
   * Find transactions with optional filters and pagination.
   *
   * @param {{ categoryId?: string, isIgnored?: boolean, dateFrom?: Date, dateTo?: Date, search?: string, limit?: number, offset?: number }} filters
   * @returns {Promise<{ data: Array, total: number, totalAmount: number }>}
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
    const sumQuery = db('transactions as t')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id');

    if (categoryId !== undefined) {
      baseQuery.where('t.category_id', categoryId);
      countQuery.where('t.category_id', categoryId);
      sumQuery.where('t.category_id', categoryId);
    }
    if (isIgnored !== undefined) {
      baseQuery.where('t.is_ignored', isIgnored);
      countQuery.where('t.is_ignored', isIgnored);
      sumQuery.where('t.is_ignored', isIgnored);
    } else {
      sumQuery.where('t.is_ignored', false);
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

    const sortColumn = sortBy === 'amount' ? 't.amount' : 't.transaction_date';
    const rows = await baseQuery
      .orderBy(sortColumn, sortOrder)
      .orderBy('t.transaction_date', 'desc')
      .limit(limit)
      .offset(offset);

    const data = await attachSplitsToTransactions(rows);

    const hasDateFilter = Boolean(dateFrom || dateTo);

    let total = 0;
    let totalAmount = 0;

    if (hasDateFilter) {
      const [{ count }] = await countQuery.count('t.id as count');
      const [{ sum }] = await sumQuery.select(
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as sum')
      );
      total = parseInt(count, 10);
      totalAmount = parseInt(sum || '0', 10);
    } else {
      total = offset + data.length + (data.length === limit ? 1 : 0);
    }

    return {
      data,
      total,
      totalAmount,
    };
  },

  /**
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async findById(id) {
    const tx = await db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .select('t.*', 'c.name as category_name', 'c.color as category_color')
      .where('t.id', id)
      .first();

    if (!tx) return undefined;
    const [withSplits] = await attachSplitsToTransactions([tx]);
    return withSplits;
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
   * Insert a manually-entered transaction.
   *
   * @param {{ amount: number, transactionDate: Date, merchant: string, transactionType?: string, notes?: string, categoryId?: string, isIgnored?: boolean }} data
   * @returns {Promise<Object>} - inserted row
   */
  async create(data) {
    const now = new Date();
    const [row] = await db('transactions')
      .insert({
        amount: data.amount,
        transaction_date: data.transactionDate,
        merchant: data.merchant,
        transaction_type: data.transactionType || 'Manual',
        notes: data.notes || '',
        category_id: data.categoryId || null,
        is_ignored: data.isIgnored || false,
        email_message_id: `manual:${crypto.randomUUID()}`,
        created_at: now,
        updated_at: now,
      })
      .returning('*');
    return row;
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
   * Permanently delete a transaction.
   *
   * @param {string} id
   * @returns {Promise<number>} - number of deleted rows
   */
  async delete(id) {
    return db('transactions').where({ id }).delete();
  },

  /**
   * Get total amount of non-ignored transactions within a date range, net of splits.
   *
   * @param {Date} dateFrom
   * @param {Date} dateTo
   * @param {boolean} excludeIgnored - if true, exclude is_ignored=true rows
   * @returns {Promise<number>}
   */
  async sumAmount(dateFrom, dateTo, excludeIgnored = false) {
    const query = db('transactions as t')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .whereBetween('t.transaction_date', [dateFrom, dateTo]);

    if (excludeIgnored) {
      query.where('t.is_ignored', false);
    }

    const [{ sum }] = await query.select(
      db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as sum')
    );
    return parseInt(sum || '0', 10);
  },

  /**
   * Get recent transactions for dashboard.
   *
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async findRecent(limit = 5) {
    const rows = await db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .select('t.*', 'c.name as category_name', 'c.color as category_color')
      .orderBy('t.transaction_date', 'desc')
      .limit(limit);

    return attachSplitsToTransactions(rows);
  },

  /**
   * Get daily spending totals for a date range, net of splits.
   *
   * @param {Date} dateFrom
   * @param {Date} dateTo
   * @returns {Promise<Array<{ date: string, realSpent: number, totalSpent: number }>>}
   */
  async findDailyTotals(dateFrom, dateTo) {
    const rows = await db('transactions as t')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .whereBetween('t.transaction_date', [dateFrom, dateTo])
      .where('t.is_ignored', false)
      .select(
        db.raw(`DATE(t.transaction_date AT TIME ZONE 'Asia/Jakarta') as date`),
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as total_spent'),
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as real_spent')
      )
      .groupByRaw(`DATE(t.transaction_date AT TIME ZONE 'Asia/Jakarta')`)
      .orderBy('date', 'asc');

    return rows.map((r) => ({
      date: moment.tz(r.date, TZ).format('YYYY-MM-DD'),
      realSpent:  parseInt(r.real_spent  || '0', 10),
      totalSpent: parseInt(r.total_spent || '0', 10),
    }));
  },

  /**
   * Get spending totals grouped by calendar week (Mon–Sun) for a given year/month, net of splits.
   *
   * @param {number} year
   * @param {number} month  1-indexed
   * @returns {Promise<Array<{ week: number, startDate: string, endDate: string, realSpent: number, totalSpent: number }>>}
   */
  async findWeeklyTotals(year, month) {
    const monthStr = String(month).padStart(2, '0');
    const firstDayOfMonth = moment.tz(`${year}-${monthStr}-01`, 'YYYY-MM-DD', TZ).startOf('day');
    const lastDayOfMonth  = firstDayOfMonth.clone().endOf('month').endOf('day');

    const firstWeekStart = firstDayOfMonth.clone().startOf('isoWeek');

    const weeks = [];
    let weekNum = 1;
    let curWeekStart = firstWeekStart.clone();

    while (curWeekStart.isSameOrBefore(lastDayOfMonth)) {
      const curWeekEnd = curWeekStart.clone().endOf('isoWeek').endOf('day');

      weeks.push({
        week: weekNum,
        start: curWeekStart.toDate(),
        end: curWeekEnd.toDate(),
        startDateStr: curWeekStart.format('YYYY-MM-DD'),
        endDateStr:   curWeekEnd.format('YYYY-MM-DD'),
      });

      weekNum++;
      curWeekStart.add(1, 'week');
    }

    const results = await Promise.all(
      weeks.map(async (w) => {
        const [row] = await db('transactions as t')
          .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
          .whereBetween('t.transaction_date', [w.start, w.end])
          .where('t.is_ignored', false)
          .select(
            db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as total_spent'),
            db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as real_spent')
          );
        return {
          week: w.week,
          startDate: w.startDateStr,
          endDate:   w.endDateStr,
          realSpent:  parseInt(row.real_spent  || '0', 10),
          totalSpent: parseInt(row.total_spent || '0', 10),
        };
      })
    );

    return results;
  },

  /**
   * Get spending totals grouped by month for a given year, net of splits.
   *
   * @param {number} year
   * @returns {Promise<Array<{ month: number, realSpent: number, totalSpent: number }>>}
   */
  async findMonthlyTotals(year) {
    const yearStart = moment.tz(`${year}-01-01 00:00:00`, 'YYYY-MM-DD HH:mm:ss', TZ).toDate();
    const yearEnd   = moment.tz(`${year}-12-31 23:59:59.999`, 'YYYY-MM-DD HH:mm:ss.SSS', TZ).toDate();

    const rows = await db('transactions as t')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .whereBetween('t.transaction_date', [yearStart, yearEnd])
      .where('t.is_ignored', false)
      .select(
        db.raw(`EXTRACT(MONTH FROM (t.transaction_date AT TIME ZONE 'Asia/Jakarta'))::int AS month_num`),
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as total_spent'),
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as real_spent')
      )
      .groupByRaw(`EXTRACT(MONTH FROM (t.transaction_date AT TIME ZONE 'Asia/Jakarta'))::int`)
      .orderBy('month_num', 'asc');

    return rows.map((r) => ({
      month: parseInt(r.month_num, 10),
      realSpent: parseInt(r.real_spent || '0', 10),
      totalSpent: parseInt(r.total_spent || '0', 10),
    }));
  },

  /**
   * Get today's spending totals and top N most expensive non-ignored transactions, net of splits.
   *
   * @param {Date} dateFrom  — start of today (WIB midnight)
   * @param {Date} dateTo    — end of today (WIB 23:59:59)
   * @param {number} [limit] — max transactions to return (default 5)
   * @returns {Promise<{ totalSpent: number, realSpent: number, topTransactions: Array }>}
   */
  async findDailySummary(dateFrom, dateTo, limit = 5) {
    const [totalsRow] = await db('transactions as t')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .whereBetween('t.transaction_date', [dateFrom, dateTo])
      .where('t.is_ignored', false)
      .select(
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as total_spent'),
        db.raw('COALESCE(SUM(CASE WHEN t.is_ignored = false THEN (t.amount - COALESCE(ts.total_split, 0)) ELSE 0 END), 0) as real_spent')
      );

    const topRows = await db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .whereBetween('t.transaction_date', [dateFrom, dateTo])
      .where('t.is_ignored', false)
      .select(
        't.id',
        't.merchant',
        't.amount',
        't.transaction_date',
        't.notes',
        'c.name as category_name',
        'c.color as category_color',
        db.raw('COALESCE(ts.total_split, 0)::integer as total_split_amount'),
        db.raw('(t.amount - COALESCE(ts.total_split, 0))::integer as net_amount')
      )
      .orderByRaw('(t.amount - COALESCE(ts.total_split, 0)) desc')
      .limit(limit);

    return {
      totalSpent: parseInt(totalsRow.total_spent || '0', 10),
      realSpent:  parseInt(totalsRow.real_spent  || '0', 10),
      topTransactions: topRows.map((r) => ({
        id:              r.id,
        merchant:        r.merchant,
        amount:          parseInt(r.amount, 10),
        originalAmount:  parseInt(r.amount, 10),
        totalSplitAmount: parseInt(r.total_split_amount || '0', 10),
        netAmount:       parseInt(r.net_amount || r.amount, 10),
        transactionDate: r.transaction_date,
        notes:           r.notes || '',
        categoryName:    r.category_name  || null,
        categoryColor:   r.category_color || null,
      })),
    };
  },

  /**
   * Get category breakdown of expenses within a date range, net of splits.
   *
   * @param {Object} [params]
   * @param {Date} [params.dateFrom]
   * @param {Date} [params.dateTo]
   * @param {boolean} [params.excludeIgnored=true]
   * @returns {Promise<{ categories: Array, totalSpent: number, totalCount: number, uncategorizedCount: number, uncategorizedSpent: number }>}
   */
  async findCategoryBreakdown({ dateFrom, dateTo, excludeIgnored = true } = {}) {
    const query = db('transactions as t')
      .leftJoin('categories as c', 't.category_id', 'c.id')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .select(
        'c.id as category_id',
        db.raw("COALESCE(c.name, 'Uncategorized') as category_name"),
        db.raw("COALESCE(c.color, '#94A3B8') as category_color"),
        db.raw('COUNT(t.id) as transaction_count'),
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as total_amount'),
        db.raw('COALESCE(AVG(t.amount - COALESCE(ts.total_split, 0)), 0) as average_amount')
      );

    if (excludeIgnored) {
      query.where('t.is_ignored', false);
    }
    if (dateFrom) {
      query.where('t.transaction_date', '>=', dateFrom);
    }
    if (dateTo) {
      query.where('t.transaction_date', '<=', dateTo);
    }

    query.groupBy('c.id', 'c.name', 'c.color')
      .orderByRaw('SUM(t.amount - COALESCE(ts.total_split, 0)) DESC');

    const rows = await query;

    let totalSpent = 0;
    let totalCount = 0;
    let uncategorizedCount = 0;
    let uncategorizedSpent = 0;

    for (const r of rows) {
      const amount = parseInt(r.total_amount || '0', 10);
      const count = parseInt(r.transaction_count || '0', 10);
      totalSpent += amount;
      totalCount += count;
      if (!r.category_id) {
        uncategorizedSpent += amount;
        uncategorizedCount += count;
      }
    }

    const categories = rows.map((r) => {
      const amount = parseInt(r.total_amount || '0', 10);
      const count = parseInt(r.transaction_count || '0', 10);
      const avg = Math.round(parseFloat(r.average_amount || '0'));
      const percentage = totalSpent > 0 ? Math.round((amount / totalSpent) * 1000) / 10 : 0;

      return {
        categoryId: r.category_id || null,
        categoryName: r.category_name,
        categoryColor: r.category_color,
        transactionCount: count,
        totalAmount: amount,
        averageAmount: avg,
        percentage,
      };
    });

    return {
      categories,
      totalSpent,
      totalCount,
      uncategorizedCount,
      uncategorizedSpent,
    };
  },

  /**
   * Find top spending merchants in a date range, net of splits.
   *
   * @param {Object} [params]
   * @param {Date} [params.dateFrom]
   * @param {Date} [params.dateTo]
   * @param {number} [params.limit=5]
   * @param {boolean} [params.excludeIgnored=true]
   * @returns {Promise<Array<{ merchant: string, totalSpent: number, count: number }>>}
   */
  async findTopMerchants({ dateFrom, dateTo, limit = 5, excludeIgnored = true } = {}) {
    const query = db('transactions as t')
      .leftJoin(getSplitsSubquery(), 't.id', 'ts.transaction_id')
      .select('t.merchant')
      .select(
        db.raw('COALESCE(SUM(t.amount - COALESCE(ts.total_split, 0)), 0) as total_spent'),
        db.raw('COUNT(t.id) as count')
      );

    if (excludeIgnored) {
      query.where('t.is_ignored', false);
    }
    if (dateFrom) {
      query.where('t.transaction_date', '>=', dateFrom);
    }
    if (dateTo) {
      query.where('t.transaction_date', '<=', dateTo);
    }

    query.groupBy('t.merchant')
      .orderByRaw('SUM(t.amount - COALESCE(ts.total_split, 0)) DESC')
      .limit(limit);

    const rows = await query;
    return rows.map((r) => ({
      merchant: r.merchant,
      totalSpent: parseInt(r.total_spent || '0', 10),
      count: parseInt(r.count || '0', 10),
    }));
  },

  /**
   * Find transactions that currently have no category assigned.
   *
   * @param {number} [limit=50]
   * @returns {Promise<Array>}
   */
  async findUncategorized(limit = 50) {
    return db('transactions')
      .whereNull('category_id')
      .orderBy('transaction_date', 'desc')
      .limit(limit);
  },

  /**
   * Set category for a transaction.
   *
   * @param {string} id
   * @param {string} categoryId
   * @returns {Promise<Object>}
   */
  async updateCategoryId(id, categoryId) {
    const [row] = await db('transactions')
      .where({ id })
      .update({ category_id: categoryId, updated_at: new Date() })
      .returning('*');
    return row;
  },
};

module.exports = transactionRepository;
