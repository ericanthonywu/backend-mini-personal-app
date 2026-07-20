'use strict';

const budgetService = require('../services/budget.service');

const budgetController = {
  /**
   * GET /api/budget
   * Returns current week and month budget summary including real vs total expenses.
   */
  async getSummary(req, res, next) {
    try {
      const summary = await budgetService.getSummary();
      return res.status(200).json(summary);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/budget/chart
   * Returns daily spending data for current week and month for charts.
   */
  async getChart(req, res, next) {
    try {
      const data = await budgetService.getChartData();
      return res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/budget/spending-summary?mode=week&year=2026&month=7
   * GET /api/budget/spending-summary?mode=month&year=2026
   * Returns per-week or per-month spending totals for bar charts.
   */
  async getSpendingSummary(req, res, next) {
    try {
      const { mode, year, month } = req.query;

      if (!['week', 'month'].includes(mode)) {
        return res.status(400).json({ error: 'mode must be "week" or "month"' });
      }

      const yearNum = parseInt(year, 10);
      if (!yearNum || yearNum < 2000 || yearNum > 2100) {
        return res.status(400).json({ error: 'year must be a valid 4-digit year' });
      }

      let monthNum;
      if (mode === 'week') {
        monthNum = parseInt(month, 10);
        if (!monthNum || monthNum < 1 || monthNum > 12) {
          return res.status(400).json({ error: 'month is required (1–12) for week mode' });
        }
      }

      const data = await budgetService.getSpendingSummary(mode, yearNum, monthNum);
      return res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
  /**
   * GET /api/budget/daily-summary
   * Returns today's (WIB) spending total and top 5 most expensive transactions.
   */
  async getDailySummary(req, res, next) {
    try {
      const data = await budgetService.getDailySummary();
      return res.status(200).json(data);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = budgetController;
