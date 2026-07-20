'use strict';

const moment = require('moment-timezone');
const transactionRepository = require('../repositories/transaction.repository');
const env = require('../config/env');

const TZ = 'Asia/Jakarta'; // WIB (UTC+7)

/**
 * Get the current moment in WIB.
 *
 * @returns {moment.Moment}
 */
function nowWIB() {
  return moment().tz(TZ);
}

/**
 * Budget Service — calculates budget consumption.
 *
 * Budget calculation rules:
 *   - "Real" expenses: transactions where is_ignored = false
 *   - "Total" expenses: all transactions regardless of is_ignored
 *   - Budget limits come from env: WEEKLY_BUDGET, MONTHLY_BUDGET
 *
 * All date boundaries are computed in WIB (Asia/Jakarta).
 * The DB column `transaction_date` stores naive WIB timestamps.
 */
const budgetService = {
  /**
   * Returns budget summary for current week and current month.
   *
   * Week = Monday to Sunday (WIB)
   * Month = 1st to last day of current month (WIB)
   *
   * @returns {Promise<Object>}
   */
  async getSummary() {
    const { weekStart, weekEnd } = budgetService.getCurrentWeekRange();
    const { monthStart, monthEnd } = budgetService.getCurrentMonthRange();

    const [weekReal, weekTotal, monthReal, monthTotal] = await Promise.all([
      transactionRepository.sumAmount(weekStart, weekEnd, true),
      transactionRepository.sumAmount(weekStart, weekEnd, false),
      transactionRepository.sumAmount(monthStart, monthEnd, true),
      transactionRepository.sumAmount(monthStart, monthEnd, false),
    ]);

    return {
      week: {
        start: weekStart,
        end: weekEnd,
        budget: env.WEEKLY_BUDGET,
        realSpent: weekReal,
        totalSpent: weekTotal,
        remaining: Math.max(0, env.WEEKLY_BUDGET - weekReal),
        percentUsed: Math.min(100, Math.round((weekReal / env.WEEKLY_BUDGET) * 100)),
        isOverBudget: weekReal > env.WEEKLY_BUDGET,
      },
      month: {
        start: monthStart,
        end: monthEnd,
        budget: env.MONTHLY_BUDGET,
        realSpent: monthReal,
        totalSpent: monthTotal,
        remaining: Math.max(0, env.MONTHLY_BUDGET - monthReal),
        percentUsed: Math.min(100, Math.round((monthReal / env.MONTHLY_BUDGET) * 100)),
        isOverBudget: monthReal > env.MONTHLY_BUDGET,
      },
    };
  },

  /**
   * Returns the Monday–Sunday boundaries of the current WIB week.
   *
   * moment's isoWeek starts on Monday (ISO 8601), so startOf('isoWeek')
   * gives Monday 00:00:00 and endOf('isoWeek') gives Sunday 23:59:59 — all
   * in WIB — which we then convert to plain JS Dates for DB queries.
   *
   * @returns {{ weekStart: Date, weekEnd: Date }}
   */
  getCurrentWeekRange() {
    const weekStart = nowWIB().startOf('isoWeek').toDate();
    const weekEnd   = nowWIB().endOf('isoWeek').toDate();
    return { weekStart, weekEnd };
  },

  /**
   * Returns the first–last day boundaries of the current WIB month.
   *
   * @returns {{ monthStart: Date, monthEnd: Date }}
   */
  getCurrentMonthRange() {
    const monthStart = nowWIB().startOf('month').toDate();
    const monthEnd   = nowWIB().endOf('month').toDate();
    return { monthStart, monthEnd };
  },

  /**
   * Returns daily spending data for the current week and month for charts.
   *
   * @returns {Promise<Object>}
   */
  async getChartData() {
    const { weekStart, weekEnd }   = budgetService.getCurrentWeekRange();
    const { monthStart, monthEnd } = budgetService.getCurrentMonthRange();

    const [weekRows, monthRows] = await Promise.all([
      transactionRepository.findDailyTotals(weekStart, weekEnd),
      transactionRepository.findDailyTotals(monthStart, monthEnd),
    ]);

    // Build a map for quick lookup by 'YYYY-MM-DD' key (WIB date)
    const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.date, r]));
    const weekMap  = toMap(weekRows);
    const monthMap = toMap(monthRows);

    // Iterate day-by-day in WIB and fill gaps with zeros.
    // Only include days up to today — future days are excluded so that the
    // cumulative line stops at the current day instead of extending flat to
    // the end of the period (e.g. Sunday).
    const today = nowWIB().startOf('day');

    const fillDays = (start, end, map) => {
      const days = [];
      const cur  = moment.tz(start, TZ).startOf('day');
      // Cap at today so we don't plot future zero-spending days
      const last = moment.min(moment.tz(end, TZ).startOf('day'), today);

      while (cur.isSameOrBefore(last)) {
        const dateStr = cur.format('YYYY-MM-DD');
        days.push(map[dateStr] || { date: dateStr, realSpent: 0, totalSpent: 0 });
        cur.add(1, 'day');
      }
      return days;
    };

    return {
      weekly: {
        days: fillDays(weekStart, weekEnd, weekMap),
        budget: env.WEEKLY_BUDGET,
      },
      monthly: {
        days: fillDays(monthStart, monthEnd, monthMap),
        budget: env.MONTHLY_BUDGET,
      },
    };
  },

  /**
   * Returns per-week or per-month spending totals with budget status.
   *
   * @param {'week'|'month'} mode
   * @param {number} year
   * @param {number} [month]  1-indexed, required when mode === 'week'
   * @returns {Promise<Object>}
   */
  async getSpendingSummary(mode, year, month) {
    if (mode === 'week') {
      const rows = await transactionRepository.findWeeklyTotals(year, month);
      return {
        mode: 'week',
        year,
        month,
        budget: env.WEEKLY_BUDGET,
        entries: rows, // { week, startDate, endDate, realSpent, totalSpent }
      };
    }

    // mode === 'month'
    const rows = await transactionRepository.findMonthlyTotals(year);
    const map  = Object.fromEntries(rows.map((r) => [r.month, r]));

    const months = Array.from({ length: 12 }, (_, i) => {
      const m = i + 1;
      return map[m] || { month: m, realSpent: 0, totalSpent: 0 };
    });

    return {
      mode: 'month',
      year,
      budget: env.MONTHLY_BUDGET,
      entries: months,
    };
  },

  /**
   * Returns today's (WIB) spending summary with top 5 most expensive
   * non-ignored transactions.
   *
   * @returns {Promise<Object>}
   */
  async getDailySummary() {
    const today      = nowWIB();
    const todayStart = today.clone().startOf('day').toDate();
    const todayEnd   = today.clone().endOf('day').toDate();

    const result = await transactionRepository.findDailySummary(todayStart, todayEnd);

    return {
      date: today.format('YYYY-MM-DD'),
      totalSpent: result.totalSpent,
      realSpent:  result.realSpent,
      topTransactions: result.topTransactions,
    };
  },

  /**
   * Returns daily spending totals for a specific week of a given month & year.
   *
   * @param {number} year
   * @param {number} month (1-indexed)
   * @param {number} [weekNum] 1-indexed (optional, defaults to current/first week)
   * @returns {Promise<Object>}
   */
  async getDailyChartData(year, month, weekNum) {
    const weeklyTotals = await transactionRepository.findWeeklyTotals(year, month);
    if (!weeklyTotals || weeklyTotals.length === 0) {
      return {
        year,
        month,
        week: 1,
        startDate: '',
        endDate: '',
        budget: env.WEEKLY_BUDGET,
        availableWeeks: [],
        days: [],
      };
    }

    // Default to target week or closest matching week
    const targetWeek = weeklyTotals.find((w) => w.week === parseInt(weekNum, 10)) || weeklyTotals[0];

    const weekStart = moment.tz(targetWeek.startDate, TZ).startOf('day').toDate();
    const weekEnd   = moment.tz(targetWeek.endDate,   TZ).endOf('day').toDate();

    const dailyRows = await transactionRepository.findDailyTotals(weekStart, weekEnd);
    const dailyMap  = Object.fromEntries(dailyRows.map((r) => [r.date, r]));

    const days = [];
    const cur  = moment.tz(weekStart, TZ).startOf('day');
    const last = moment.tz(weekEnd,   TZ).startOf('day');

    while (cur.isSameOrBefore(last)) {
      const dateStr = cur.format('YYYY-MM-DD');
      days.push(dailyMap[dateStr] || { date: dateStr, realSpent: 0, totalSpent: 0 });
      cur.add(1, 'day');
    }

    return {
      year,
      month,
      week: targetWeek.week,
      startDate: targetWeek.startDate,
      endDate: targetWeek.endDate,
      budget: env.WEEKLY_BUDGET,
      availableWeeks: weeklyTotals.map((w) => ({
        week: w.week,
        startDate: w.startDate,
        endDate: w.endDate,
        realSpent: w.realSpent,
      })),
      days,
    };
  },
};

module.exports = budgetService;
