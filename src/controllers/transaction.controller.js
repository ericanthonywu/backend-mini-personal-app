'use strict';

const Joi = require('joi');
const transactionService = require('../services/transaction.service');
const validate = require('../middlewares/validator');

const createSchema = Joi.object({
  amount: Joi.number().integer().min(0).required(),
  transactionDate: Joi.date().iso().required(),
  merchant: Joi.string().min(1).max(255).required(),
  transactionType: Joi.string().max(100).optional(),
  notes: Joi.string().max(1000).allow('').optional(),
  categoryId: Joi.string().uuid().allow(null).optional(),
  isIgnored: Joi.boolean().optional(),
});

const updateSchema = Joi.object({
  categoryId: Joi.string().uuid().allow(null).optional(),
  isIgnored: Joi.boolean().optional(),
  amount: Joi.number().integer().min(0).optional(),
});

const transactionController = {
  /**
   * GET /api/transactions
   * Query params: categoryId, isIgnored, dateFrom, dateTo, search, page, limit
   */
  async list(req, res, next) {
    try {
      const result = await transactionService.list(req.query);
      return res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/transactions/recent
   */
  async recent(req, res, next) {
    try {
      const limit = parseInt(req.query.limit || '5', 10);
      const data = await transactionService.getRecent(limit);
      return res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/transactions/:id
   */
  async getById(req, res, next) {
    try {
      const tx = await transactionService.getById(req.params.id);
      return res.status(200).json(tx);
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/transactions
   * Body: { amount, transactionDate, merchant, transactionType?, notes?, categoryId?, isIgnored? }
   */
  create: [
    validate(createSchema),
    async (req, res, next) => {
      try {
        const tx = await transactionService.create(req.body);
        return res.status(201).json(tx);
      } catch (err) {
        next(err);
      }
    },
  ],

  /**
   * DELETE /api/transactions/:id
   */
  async delete(req, res, next) {
    try {
      await transactionService.delete(req.params.id);
      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  /**
   * PATCH /api/transactions/:id
   * Body: { categoryId?: string|null, isIgnored?: boolean }
   */
  update: [
    validate(updateSchema),
    async (req, res, next) => {
      try {
        const tx = await transactionService.update(req.params.id, req.body);
        return res.status(200).json(tx);
      } catch (err) {
        next(err);
      }
    },
  ],
};

module.exports = transactionController;
