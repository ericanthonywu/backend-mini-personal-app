'use strict';

const categoryRepository = require('../repositories/category.repository');
const merchantRuleRepository = require('../repositories/merchant-rule.repository');
const AppError = require('../utils/app-error');

/**
 * Category Service — business logic for categories and merchant rules.
 */
const categoryService = {
  /**
   * @returns {Promise<Array>}
   */
  async list() {
    return categoryRepository.findAll();
  },

  /**
   * @param {string} id
   * @returns {Promise<Object>}
   * @throws {AppError} 404
   */
  async getById(id) {
    const cat = await categoryRepository.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    return cat;
  },

  /**
   * @param {{ name: string, color?: string }} data
   * @returns {Promise<Object>}
   * @throws {AppError} 409 if name already exists
   */
  async create(data) {
    const existing = await categoryRepository.findByName(data.name);
    if (existing) throw new AppError(`Category "${data.name}" already exists`, 409);

    return categoryRepository.create({
      name: data.name.trim(),
      color: data.color || '#95A5A6',
    });
  },

  /**
   * @param {string} id
   * @param {{ name?: string, color?: string }} data
   * @returns {Promise<Object>}
   * @throws {AppError} 404 or 409
   */
  async update(id, data) {
    const cat = await categoryRepository.findById(id);
    if (!cat) throw new AppError('Category not found', 404);

    if (data.name && data.name !== cat.name) {
      const existing = await categoryRepository.findByName(data.name);
      if (existing) throw new AppError(`Category "${data.name}" already exists`, 409);
    }

    const updates = {};
    if (data.name) updates.name = data.name.trim();
    if (data.color) updates.color = data.color;

    return categoryRepository.update(id, updates);
  },

  /**
   * Deletes a category. Prevents deletion of default categories unless forced.
   *
   * @param {string} id
   * @throws {AppError} 404 or 403 for defaults
   */
  async delete(id) {
    const cat = await categoryRepository.findById(id);
    if (!cat) throw new AppError('Category not found', 404);
    if (cat.is_default) throw new AppError('Cannot delete a default category', 403);

    await categoryRepository.delete(id);
  },

  // --- Merchant Rules ---

  /**
   * @returns {Promise<Array>}
   */
  async listMerchantRules() {
    return merchantRuleRepository.findAll();
  },

  /**
   * @param {{ merchantPattern: string, categoryId: string }} data
   * @returns {Promise<Object>}
   * @throws {AppError} 400 if category not found
   */
  async createMerchantRule(data) {
    const cat = await categoryRepository.findById(data.categoryId);
    if (!cat) throw new AppError('Category not found', 400);

    return merchantRuleRepository.create({
      merchantPattern: data.merchantPattern.trim().toUpperCase(),
      categoryId: data.categoryId,
    });
  },

  /**
   * @param {string} id
   */
  async deleteMerchantRule(id) {
    const deleted = await merchantRuleRepository.delete(id);
    if (!deleted) throw new AppError('Merchant rule not found', 404);
  },
};

module.exports = categoryService;
