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
};

module.exports = budgetController;
