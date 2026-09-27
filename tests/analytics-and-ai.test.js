'use strict';

const notificationService = require('../src/services/notification.service');
const aiService = require('../src/services/ai.service');
const budgetService = require('../src/services/budget.service');

describe('Notification and AI Services', () => {
  describe('NotificationService', () => {
    it('formats and dispatches transaction notification', async () => {
      const result = await notificationService.notifyNewTransaction(
        {
          merchant: 'STARBUCKS TEST',
          amount: 55000,
          transaction_date: new Date(),
        },
        'Food'
      );
      expect(result).toBe(true);
    });

    it('formats and dispatches budget status notification', async () => {
      const result = await notificationService.notifyBudgetStatus({
        period: 'Bulan',
        spent: 4500000,
        budget: 5000000,
        percentUsed: 90,
        isOverBudget: false,
      });
      expect(result).toBe(true);
    });
  });

  describe('BudgetService Breakdown', () => {
    it('resolves period bounds correctly', () => {
      const monthBounds = budgetService.resolvePeriodBounds('month');
      expect(monthBounds.dateFrom).toBeInstanceOf(Date);
      expect(monthBounds.dateTo).toBeInstanceOf(Date);
      expect(monthBounds.label).toBeTruthy();

      const weekBounds = budgetService.resolvePeriodBounds('week');
      expect(weekBounds.dateFrom).toBeInstanceOf(Date);
      expect(weekBounds.dateTo).toBeInstanceOf(Date);
      expect(weekBounds.label).toBe('Minggu Ini');
    });
  });
});
