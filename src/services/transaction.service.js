const transactionRepository = require('../repositories/transaction.repository');
const categoryRepository = require('../repositories/category.repository');
const aiService = require('./ai.service');
const notificationService = require('./notification.service');
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
      sortBy: filters.sortBy || 'date',
      sortOrder: filters.sortOrder || 'desc',
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
   * Create a manually-entered transaction.
   *
   * @param {{ amount: number, transactionDate: string|Date, merchant: string, transactionType?: string, notes?: string, categoryId?: string, isIgnored?: boolean }} data
   * @returns {Promise<Object>}
   * @throws {AppError} 400 if categoryId references a non-existent category
   */
    const merchant = data.merchant.trim();
    const transactionType = data.transactionType || 'Manual';
    // Mirror the email-parsed convention: "MERCHANT - TRANSACTION_TYPE"
    const notes = data.notes && data.notes.trim()
      ? data.notes.trim()
      : `${merchant} - ${transactionType}`;

    let categoryId = data.categoryId;
    if (categoryId) {
      const cat = await categoryRepository.findById(categoryId);
      if (!cat) throw new AppError('Category not found', 400);
    } else {
      try {
        const allCategories = await categoryRepository.findAll();
        const aiResult = await aiService.categorizeTransaction({
          merchant,
          amount: data.amount,
          transactionType,
          notes,
          categories: allCategories,
        });
        if (aiResult && aiResult.categoryId) {
          categoryId = aiResult.categoryId;
        }
      } catch (aiErr) {
        console.warn('[transaction-service] AI auto-categorization skipped for manual transaction:', aiErr.message);
      }
    }

    const created = await transactionRepository.create({
      amount: data.amount,
      transactionDate: new Date(data.transactionDate),
      merchant,
      transactionType,
      notes,
      categoryId,
      isIgnored: data.isIgnored,
    });

    // Return the joined row so the response includes category name/color.
    const fullTx = await transactionRepository.findById(created.id);

    // Send ntfy push notification for newly recorded manual transaction
    try {
      await notificationService.notifyNewTransaction(
        fullTx,
        fullTx ? fullTx.category_name : null
      );
    } catch (notifErr) {
      console.error('[transaction-service] Failed to send ntfy notification:', notifErr.message);
    }

    return fullTx;
  },

  /**
   * Permanently delete a transaction.
   *
   * @param {string} id
   * @throws {AppError} 404 if transaction not found
   */
  async delete(id) {
    const tx = await transactionRepository.findById(id);
    if (!tx) throw new AppError('Transaction not found', 404);
    await transactionRepository.delete(id);
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

  /**
   * Auto-categorize a single transaction with AI.
   *
   * @param {string} id
   * @returns {Promise<Object>} updated transaction and AI result
   */
  async aiCategorize(id) {
    const tx = await transactionRepository.findById(id);
    if (!tx) throw new AppError('Transaction not found', 404);

    const categories = await categoryRepository.findAll();
    const aiResult = await aiService.categorizeTransaction({
      merchant: tx.merchant,
      amount: tx.amount,
      transactionType: tx.transaction_type,
      notes: tx.notes,
      categories,
    });

    if (aiResult && aiResult.categoryId) {
      await transactionRepository.updateCategoryId(id, aiResult.categoryId);
    }

    const updated = await transactionRepository.findById(id);
    return {
      transaction: updated,
      ai: aiResult,
    };
  },

  /**
   * Batch auto-categorize all uncategorized transactions with AI.
   *
   * @returns {Promise<{ processed: number, categorized: number, results: Array }>}
   */
  async aiCategorizeAll() {
    const uncategorized = await transactionRepository.findUncategorized(50);
    const categories = await categoryRepository.findAll();

    let categorized = 0;
    const results = [];

    for (const tx of uncategorized) {
      try {
        const aiResult = await aiService.categorizeTransaction({
          merchant: tx.merchant,
          amount: tx.amount,
          transactionType: tx.transaction_type,
          notes: tx.notes,
          categories,
        });

        if (aiResult && aiResult.categoryId) {
          await transactionRepository.updateCategoryId(tx.id, aiResult.categoryId);
          categorized++;
        }

        results.push({
          id: tx.id,
          merchant: tx.merchant,
          categoryId: aiResult.categoryId,
          categoryName: aiResult.categoryName,
          confidence: aiResult.confidence,
          reasoning: aiResult.reasoning,
        });
      } catch (err) {
        results.push({
          id: tx.id,
          merchant: tx.merchant,
          error: err.message,
        });
      }
    }

    return {
      processed: uncategorized.length,
      categorized,
      results,
    };
  },
};

module.exports = transactionService;
