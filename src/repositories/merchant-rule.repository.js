'use strict';

const db = require('../config/database');

/**
 * Merchant Category Rule Repository — auto-categorization rules.
 */
const merchantRuleRepository = {
  /**
   * @returns {Promise<Array>}
   */
  async findAll() {
    return db('merchant_category_rules as r')
      .join('categories as c', 'r.category_id', 'c.id')
      .select('r.*', 'c.name as category_name', 'c.color as category_color')
      .orderBy('r.created_at', 'desc');
  },

  /**
   * Find a matching rule for a given merchant name.
   * Rules are matched by case-insensitive substring.
   *
   * @param {string} merchantName
   * @returns {Promise<Object|undefined>}
   */
  async findMatchingRule(merchantName) {
    // Fetch all rules and do substring match in JS for simplicity
    const rules = await db('merchant_category_rules').select('*');

    const upperMerchant = merchantName.toUpperCase();
    return rules.find((rule) =>
      upperMerchant.includes(rule.merchant_pattern.toUpperCase())
    );
  },

  /**
   * @param {{ merchantPattern: string, categoryId: string }} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const [row] = await db('merchant_category_rules')
      .insert({
        merchant_pattern: data.merchantPattern,
        category_id: data.categoryId,
        created_at: new Date(),
      })
      .returning('*');
    return row;
  },

  /**
   * @param {string} id
   * @returns {Promise<number>}
   */
  async delete(id) {
    return db('merchant_category_rules').where({ id }).delete();
  },
};

module.exports = merchantRuleRepository;
