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

    it('handles chatWithAdvisor structure gracefully with response', async () => {
      const spy = jest.spyOn(aiService, 'callGemini').mockResolvedValueOnce({
        reply: 'Pengeluaran Anda bulan ini cukup terkendali.',
        suggestions: ['Bagaimana budget minggu ini?', 'Saran penghematan makanan?'],
      });

      const response = await aiService.chatWithAdvisor({
        userMessage: 'Bagaimana cara hemat bulan ini?',
        history: [],
        financialContext: {
          period: 'Bulan Ini',
          totalSpent: 1500000,
          totalCount: 10,
          categories: [{ categoryName: 'Food', totalAmount: 1000000, percentage: 66, transactionCount: 7 }],
          topMerchants: [{ merchant: 'Resto Test', count: 4, totalSpent: 600000 }],
        },
      });

      expect(spy).toHaveBeenCalled();
      expect(response).toBeDefined();
      expect(response.reply).toContain('Pengeluaran Anda');
      expect(response.suggestions.length).toBe(2);
      expect(response.timestamp).toBeDefined();

      spy.mockRestore();
    });

    it('falls back gracefully if callGemini throws in chatWithAdvisor', async () => {
      const spy = jest.spyOn(aiService, 'callGemini').mockRejectedValueOnce(new Error('Network error'));

      const response = await aiService.chatWithAdvisor({
        userMessage: 'Halo',
        financialContext: {
          period: 'Bulan Ini',
          totalSpent: 500000,
          totalCount: 5,
        },
      });

      expect(response).toBeDefined();
      expect(response.reply).toContain('Halo Eric');
      expect(Array.isArray(response.suggestions)).toBe(true);

      spy.mockRestore();
    });
  });
});
