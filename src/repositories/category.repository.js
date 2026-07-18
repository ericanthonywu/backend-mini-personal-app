'use strict';

const db = require('../config/database');

/**
 * Category Repository — all DB access for categories.
 * Returns plain objects. No business logic here.
 */
const categoryRepository = {
  /**
   * @returns {Promise<Array>}
   */
  async findAll() {
    return db('categories').orderBy('is_default', 'desc').orderBy('name', 'asc');
  },

  /**
   * @param {string} id
   * @returns {Promise<Object|undefined>}
   */
  async findById(id) {
    return db('categories').where({ id }).first();
  },

  /**
   * @param {string} name
   * @returns {Promise<Object|undefined>}
   */
  async findByName(name) {
    return db('categories').whereRaw('LOWER(name) = LOWER(?)', [name]).first();
  },

  /**
   * @param {{ name: string, color: string }} data
   * @returns {Promise<Object>}
   */
  async create(data) {
    const [row] = await db('categories')
      .insert({
        name: data.name,
        color: data.color || '#95A5A6',
        is_default: false,
        created_at: new Date(),
      })
      .returning('*');
    return row;
  },

  /**
   * @param {string} id
   * @param {{ name?: string, color?: string }} data
   * @returns {Promise<Object|undefined>}
   */
  async update(id, data) {
    const [row] = await db('categories').where({ id }).update(data).returning('*');
    return row;
  },

  /**
   * @param {string} id
   * @returns {Promise<number>} - number of deleted rows
   */
  async delete(id) {
    return db('categories').where({ id }).delete();
  },
};

module.exports = categoryRepository;
