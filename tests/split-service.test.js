'use strict';

const splitService = require('../src/services/split.service');
const transactionRepository = require('../src/repositories/transaction.repository');
const transactionSplitRepository = require('../src/repositories/transaction-split.repository');
const AppError = require('../src/utils/app-error');
const db = require('../src/config/database');

describe('SplitService', () => {
  afterAll(async () => {
    await db.destroy();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('addSplit', () => {
    it('throws 404 if transaction is not found', async () => {
      jest.spyOn(transactionRepository, 'findById').mockResolvedValue(null);

      await expect(
        splitService.addSplit('non-existent-id', { amount: 50000, paidBy: 'Budi' })
      ).rejects.toThrow('Transaction not found');
    });

    it('throws 400 if split amount exceeds transaction amount', async () => {
      jest.spyOn(transactionRepository, 'findById').mockResolvedValue({
        id: 'tx-1',
        amount: 100000,
        total_split_amount: 60000,
      });

      await expect(
        splitService.addSplit('tx-1', { amount: 50000, paidBy: 'Budi' })
      ).rejects.toThrow('Total split payment cannot exceed transaction amount');
    });

    it('successfully adds split and returns updated transaction', async () => {
      const tx = {
        id: 'tx-1',
        amount: 100000,
        total_split_amount: 20000,
      };

      const updatedTx = {
        id: 'tx-1',
        amount: 100000,
        original_amount: 100000,
        total_split_amount: 70000,
        net_amount: 30000,
        splits: [
          { id: 'sp-1', transaction_id: 'tx-1', amount: 20000, paid_by: 'Budi' },
          { id: 'sp-2', transaction_id: 'tx-1', amount: 50000, paid_by: 'Citra', notes: 'Makan' },
        ],
      };

      jest.spyOn(transactionRepository, 'findById')
        .mockResolvedValueOnce(tx)
        .mockResolvedValueOnce(updatedTx);
      jest.spyOn(transactionSplitRepository, 'create').mockResolvedValue({ id: 'sp-2' });

      const result = await splitService.addSplit('tx-1', {
        amount: 50000,
        paidBy: 'Citra',
        notes: 'Makan',
      });

      expect(transactionSplitRepository.create).toHaveBeenCalledWith({
        transactionId: 'tx-1',
        amount: 50000,
        paidBy: 'Citra',
        notes: 'Makan',
      });
      expect(result.net_amount).toBe(30000);
      expect(result.total_split_amount).toBe(70000);
      expect(result.splits).toHaveLength(2);
    });
  });

  describe('updateSplit', () => {
    it('throws 404 if split does not belong to transaction', async () => {
      jest.spyOn(transactionRepository, 'findById').mockResolvedValue({ id: 'tx-1', amount: 100000 });
      jest.spyOn(transactionSplitRepository, 'findById').mockResolvedValue({
        id: 'sp-1',
        transaction_id: 'tx-other',
      });

      await expect(
        splitService.updateSplit('tx-1', 'sp-1', { amount: 40000 })
      ).rejects.toThrow('Split payment not found');
    });

    it('throws 400 if new amount exceeds transaction amount', async () => {
      jest.spyOn(transactionRepository, 'findById').mockResolvedValue({ id: 'tx-1', amount: 100000 });
      jest.spyOn(transactionSplitRepository, 'findById').mockResolvedValue({
        id: 'sp-1',
        transaction_id: 'tx-1',
        amount: 30000,
      });
      jest.spyOn(transactionSplitRepository, 'sumByTransactionId').mockResolvedValue(50000);

      await expect(
        splitService.updateSplit('tx-1', 'sp-1', { amount: 60000 })
      ).rejects.toThrow('Total split payment cannot exceed transaction amount');
    });

    it('successfully updates split and returns updated transaction', async () => {
      jest.spyOn(transactionRepository, 'findById')
        .mockResolvedValueOnce({ id: 'tx-1', amount: 100000 })
        .mockResolvedValueOnce({ id: 'tx-1', amount: 100000, net_amount: 40000, total_split_amount: 60000 });
      jest.spyOn(transactionSplitRepository, 'findById').mockResolvedValue({
        id: 'sp-1',
        transaction_id: 'tx-1',
        amount: 30000,
      });
      jest.spyOn(transactionSplitRepository, 'sumByTransactionId').mockResolvedValue(20000);
      jest.spyOn(transactionSplitRepository, 'update').mockResolvedValue({ id: 'sp-1' });

      const result = await splitService.updateSplit('tx-1', 'sp-1', {
        amount: 40000,
        paidBy: 'Budi Updated',
      });

      expect(transactionSplitRepository.update).toHaveBeenCalledWith('sp-1', {
        amount: 40000,
        paidBy: 'Budi Updated',
        notes: undefined,
      });
      expect(result.net_amount).toBe(40000);
    });
  });

  describe('deleteSplit', () => {
    it('successfully deletes split and returns updated transaction', async () => {
      jest.spyOn(transactionRepository, 'findById')
        .mockResolvedValueOnce({ id: 'tx-1', amount: 100000 })
        .mockResolvedValueOnce({ id: 'tx-1', amount: 100000, net_amount: 100000, total_split_amount: 0 });
      jest.spyOn(transactionSplitRepository, 'findById').mockResolvedValue({
        id: 'sp-1',
        transaction_id: 'tx-1',
      });
      jest.spyOn(transactionSplitRepository, 'delete').mockResolvedValue(1);

      const result = await splitService.deleteSplit('tx-1', 'sp-1');

      expect(transactionSplitRepository.delete).toHaveBeenCalledWith('sp-1');
      expect(result.net_amount).toBe(100000);
    });
  });
});
