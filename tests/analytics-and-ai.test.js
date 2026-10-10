'use strict';

const notificationService = require('../src/services/notification.service');
const aiService = require('../src/services/ai.service');
const budgetService = require('../src/services/budget.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const db = require('../src/config/database');

describe('Notification and AI Services', () => {
  afterAll(async () => {
    await db.destroy();
  });

  describe('NotificationService', () => {
    it('formats and dispatches transaction notification including weekly expense', async () => {
      const sendSpy = jest.spyOn(notificationService, 'send').mockResolvedValue(true);
      const weekSpentSpy = jest.spyOn(budgetService, 'getCurrentWeekSpent').mockResolvedValue(250000);

      const result = await notificationService.notifyNewTransaction(
        {
          merchant: 'STARBUCKS TEST',
          amount: 55000,
          transaction_date: new Date(),
        },
        'Food'
      );
      expect(result).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('STARBUCKS TEST'),
          message: expect.stringContaining('Rp 55.000'),
        })
      );
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Total pengeluaran minggu ini: Rp 250.000'),
        })
      );
      sendSpy.mockRestore();
      weekSpentSpy.mockRestore();
    });

    it('formats transaction notification with explicitly provided weeklySpent', async () => {
      const sendSpy = jest.spyOn(notificationService, 'send').mockResolvedValue(true);

      const result = await notificationService.notifyNewTransaction(
        {
          merchant: 'KOPI KENANGAN',
          amount: 28000,
          transaction_date: new Date(),
        },
        'Food',
        500000
      );
      expect(result).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('KOPI KENANGAN'),
          message: expect.stringContaining('Rp 28.000'),
        })
      );
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Total pengeluaran minggu ini: Rp 500.000'),
        })
      );
      sendSpy.mockRestore();
    });

    it('handles failure in getCurrentWeekSpent gracefully', async () => {
      const sendSpy = jest.spyOn(notificationService, 'send').mockResolvedValue(true);
      const weekSpentSpy = jest.spyOn(budgetService, 'getCurrentWeekSpent').mockRejectedValue(new Error('DB error'));

      const result = await notificationService.notifyNewTransaction(
        {
          merchant: 'INDOMARET',
          amount: 45000,
          transaction_date: new Date(),
        },
        'Groceries'
      );
      expect(result).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('INDOMARET'),
          message: expect.stringContaining('Rp 45.000'),
        })
      );
      sendSpy.mockRestore();
      weekSpentSpy.mockRestore();
    });

    it('formats and dispatches budget status notification', async () => {
      const sendSpy = jest.spyOn(notificationService, 'send').mockResolvedValue(true);
      const result = await notificationService.notifyBudgetStatus({
        period: 'Bulan',
        spent: 4500000,
        budget: 5000000,
        percentUsed: 90,
        isOverBudget: false,
      });
      expect(result).toBe(true);
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringContaining('Status Anggaran Bulan'),
          message: expect.stringContaining('4.500.000'),
        })
      );
      sendSpy.mockRestore();
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

    it('computes current week spent correctly via transactionRepository', async () => {
      const sumSpy = jest.spyOn(transactionRepository, 'sumAmount').mockResolvedValue(875000);
      const spent = await budgetService.getCurrentWeekSpent();
      expect(spent).toBe(875000);
      expect(sumSpy).toHaveBeenCalledWith(expect.any(Date), expect.any(Date), true);
      sumSpy.mockRestore();
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

  describe('AiService Safety in Testing', () => {
    it('never calls live fetch to Gemini API during tests', async () => {
      const fetchSpy = jest.spyOn(global, 'fetch');
      const result = await aiService.callGemini('Test prompt', { json: true });
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.reasoning).toContain('Test environment');
      fetchSpy.mockRestore();
    });

    it('categorizes transaction using mocked Gemini without network', async () => {
      const spy = jest.spyOn(aiService, 'callGemini').mockResolvedValueOnce({
        categoryId: 'cat-1',
        categoryName: 'Food',
        confidence: 0.95,
        reasoning: 'Shopeefood matches food category',
      });

      const res = await aiService.categorizeTransaction({
        merchant: 'SHOPEEFOOD',
        amount: 45000,
        categories: [{ id: 'cat-1', name: 'Food' }, { id: 'cat-2', name: 'Transport' }],
      });

      expect(spy).toHaveBeenCalled();
      expect(res.categoryId).toBe('cat-1');
      expect(res.categoryName).toBe('Food');
      expect(res.confidence).toBe(0.95);
      spy.mockRestore();
    });

    it('generates expense summary using mocked Gemini without network', async () => {
      const spy = jest.spyOn(aiService, 'callGemini').mockResolvedValueOnce({
        healthScore: 'healthy',
        summary: 'Kondisi pengeluaran sangat sehat.',
        keyInsights: ['Pengeluaran stabil'],
        recommendations: ['Pertahankan pola belanja'],
      });

      const res = await aiService.generateExpenseSummary({
        period: 'Bulan Ini',
        totalSpent: 1000000,
        totalCount: 5,
        categoryBreakdown: [{ categoryName: 'Food', totalAmount: 500000, percentage: 50, transactionCount: 3 }],
        topMerchants: [{ merchant: 'Resto A', totalSpent: 300000, count: 2 }],
      });

      expect(spy).toHaveBeenCalled();
      expect(res.healthScore).toBe('healthy');
      expect(res.summary).toContain('sangat sehat');
      expect(res.keyInsights.length).toBe(1);
      spy.mockRestore();
    });
  });
});
