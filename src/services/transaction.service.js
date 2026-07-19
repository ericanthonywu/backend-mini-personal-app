'use strict';

const transactionRepository = require('../repositories/transaction.repository');
const categoryRepository = require('../repositories/category.repository');
const AppError = require('../utils/app-error');

/**
 * Transaction Service — business logic for transactions.
 */
const transactionService = {
  /**
   * @param {{ categoryId?: string, isIgnored?: boolean, dateFrom?: string, dateTo?: string, search?: string, page?: number, limit?: number }} filters
   * @returns {Promise<{ data: Array, total: number, page: number, limit: number, totalPages: number }>}
   */
  async list(filters = {}) {
    const page = Math.max(1, parseInt(filters.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(filters.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const parsed = {
      categoryId: filters.categoryId,
      isIgnored: filters.isIgnored !== undefined ? filters.isIgnored === 'true' || filters.isIgnored === true : undefined,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
      search: filters.search,
      limit,
      offset,
    };

    const { data, total, totalAmount } = await transactionRepository.findAll(parsed);

    return {
      data,
      total,
      totalAmount,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * @param {string} id
   * @returns {Promise<Object>}
   * @throws {AppError} 404 if not found
   */
  async getById(id) {
    const tx = await transactionRepository.findById(id);
    if (!tx) throw new AppError('Transaction not found', 404);
    return tx;
  },

  /**
   * Update a transaction's category or ignored status.
   *
   * @param {string} id
   * @param {{ categoryId?: string, isIgnored?: boolean }} data
   * @returns {Promise<Object>}
   * @throws {AppError} 404 if transaction not found
   * @throws {AppError} 400 if categoryId references a non-existent category
   */
  async update(id, data) {
    const tx = await transactionRepository.findById(id);
    if (!tx) throw new AppError('Transaction not found', 404);

    if (data.categoryId) {
      const cat = await categoryRepository.findById(data.categoryId);
      if (!cat) throw new AppError('Category not found', 400);
    }

    const updated = await transactionRepository.update(id, {
      categoryId: data.categoryId,
      isIgnored: data.isIgnored,
      amount: data.amount,
    });
    return updated;
  },

  /**
   * Get recent transactions for the dashboard.
   *
   * @param {number} limit
   * @returns {Promise<Array>}
   */
  async getRecent(limit = 5) {
    return transactionRepository.findRecent(limit);
  },
};

module.exports = transactionService;
