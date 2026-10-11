'use strict';

const transactionService = require('../src/services/transaction.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const categoryRepository = require('../src/repositories/category.repository');
const notificationService = require('../src/services/notification.service');
const aiService = require('../src/services/ai.service');
const db = require('../src/config/database');

describe('TransactionService', () => {
  afterAll(async () => {
    await db.destroy();
  });

  describe('create', () => {
    it('creates manual transaction and dispatches push notification', async () => {
      const createdRow = {
        id: 'tx-manual-1',
        amount: 50000,
        merchant: 'INDOMARET',
        transaction_type: 'Manual',
        notes: 'INDOMARET - Manual',
        category_id: null,
      };

      jest.spyOn(categoryRepository, 'findAll').mockResolvedValue([]);
      jest.spyOn(aiService, 'categorizeTransaction').mockResolvedValue({ categoryId: null });
      jest.spyOn(transactionRepository, 'create').mockResolvedValue(createdRow);
      jest.spyOn(transactionRepository, 'findById').mockResolvedValue({
        ...createdRow,
        category_name: null,
        category_color: null,
      });
      const notifSpy = jest.spyOn(notificationService, 'notifyNewTransaction').mockResolvedValue(true);

      const result = await transactionService.create({
        amount: 50000,
        merchant: '  INDOMARET  ',
        transactionDate: new Date(),
      });

      expect(result).toBeDefined();
      expect(result.id).toBe('tx-manual-1');
      expect(transactionRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          merchant: 'INDOMARET',
          amount: 50000,
        })
      );
      expect(notifSpy).toHaveBeenCalled();
    });
  });
});
