'use strict';

const transactionRepository = require('../repositories/transaction.repository');
const transactionSplitRepository = require('../repositories/transaction-split.repository');
const AppError = require('../utils/app-error');

/**
 * Split Service — business logic for transaction split payments.
 */
const splitService = {
  /**
   * Add a split payment to a transaction.
   *
   * @param {string} transactionId
   * @param {{ amount: number, paidBy: string, notes?: string }} data
   * @returns {Promise<Object>} updated full transaction
   */
  async addSplit(transactionId, data) {
    const tx = await transactionRepository.findById(transactionId);
    if (!tx) {
      throw new AppError('Transaction not found', 404);
    }

    const amount = parseInt(data.amount, 10);
    if (!amount || amount <= 0) {
      throw new AppError('Split amount must be greater than 0', 400);
    }

    const currentSplitSum = tx.total_split_amount || 0;
    if (currentSplitSum + amount > tx.amount) {
      throw new AppError(
        `Total split payment cannot exceed transaction amount (Rp ${tx.amount.toLocaleString('id-ID')})`,
        400
      );
    }

    await transactionSplitRepository.create({
      transactionId,
      amount,
      paidBy: data.paidBy,
      notes: data.notes,
    });

    return transactionRepository.findById(transactionId);
  },

  /**
   * Update an existing split payment on a transaction.
   *
   * @param {string} transactionId
   * @param {string} splitId
   * @param {{ amount?: number, paidBy?: string, notes?: string }} data
   * @returns {Promise<Object>} updated full transaction
   */
  async updateSplit(transactionId, splitId, data) {
    const tx = await transactionRepository.findById(transactionId);
    if (!tx) {
      throw new AppError('Transaction not found', 404);
    }

    const split = await transactionSplitRepository.findById(splitId);
    if (!split || split.transaction_id !== transactionId) {
      throw new AppError('Split payment not found', 404);
    }

    if (data.amount !== undefined) {
      const newAmount = parseInt(data.amount, 10);
      if (!newAmount || newAmount <= 0) {
        throw new AppError('Split amount must be greater than 0', 400);
      }

      const otherSplitsSum = await transactionSplitRepository.sumByTransactionId(
        transactionId,
        splitId
      );

      if (otherSplitsSum + newAmount > tx.amount) {
        throw new AppError(
          `Total split payment cannot exceed transaction amount (Rp ${tx.amount.toLocaleString('id-ID')})`,
          400
        );
      }
    }

    await transactionSplitRepository.update(splitId, {
      amount: data.amount !== undefined ? parseInt(data.amount, 10) : undefined,
      paidBy: data.paidBy,
      notes: data.notes,
    });

    return transactionRepository.findById(transactionId);
  },

  /**
   * Delete a split payment from a transaction.
   *
   * @param {string} transactionId
   * @param {string} splitId
   * @returns {Promise<Object>} updated full transaction
   */
  async deleteSplit(transactionId, splitId) {
    const tx = await transactionRepository.findById(transactionId);
    if (!tx) {
      throw new AppError('Transaction not found', 404);
    }

    const split = await transactionSplitRepository.findById(splitId);
    if (!split || split.transaction_id !== transactionId) {
      throw new AppError('Split payment not found', 404);
    }

    await transactionSplitRepository.delete(splitId);

    return transactionRepository.findById(transactionId);
  },
};

module.exports = splitService;
