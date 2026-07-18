'use strict';

const transactionRepository = require('../repositories/transaction.repository');
const env = require('../config/env');

/**
 * Budget Service — calculates budget consumption.
 *
 * Budget calculation rules:
 *   - "Real" expenses: transactions where is_ignored = false
 *   - "Total" expenses: all transactions regardless of is_ignored
 *   - Budget limits come from env: WEEKLY_BUDGET, MONTHLY_BUDGET
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
    const now = new Date();

    const { weekStart, weekEnd } = budgetService.getCurrentWeekRange(now);
    const { monthStart, monthEnd } = budgetService.getCurrentMonthRange(now);

    const [
      weekReal,
      weekTotal,
      monthReal,
      monthTotal,
    ] = await Promise.all([
      transactionRepository.sumAmount(weekStart, weekEnd, true),   // exclude ignored
      transactionRepository.sumAmount(weekStart, weekEnd, false),  // include ignored
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
   * Returns the Monday–Sunday range for the week containing the given date.
   * All times in WIB (no UTC adjustment needed).
   *
   * @param {Date} date
   * @returns {{ weekStart: Date, weekEnd: Date }}
   */
  getCurrentWeekRange(date) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const daysToMonday = day === 0 ? 6 : day - 1;

    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - daysToMonday);
    weekStart.setHours(0, 0, 0, 0);

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);

    return { weekStart, weekEnd };
  },

  /**
   * Returns the first–last day range for the month containing the given date.
   *
   * @param {Date} date
   * @returns {{ monthStart: Date, monthEnd: Date }}
   */
  getCurrentMonthRange(date) {
    const monthStart = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
    const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
    return { monthStart, monthEnd };
  },
};

module.exports = budgetService;
