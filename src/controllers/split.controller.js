'use strict';

const Joi = require('joi');
const splitService = require('../services/split.service');
const validate = require('../middlewares/validator');

const createSplitSchema = Joi.object({
  amount: Joi.number().integer().min(1).required(),
  paidBy: Joi.string().trim().min(1).max(255).required(),
  notes: Joi.string().trim().max(1000).allow('').optional(),
});

const updateSplitSchema = Joi.object({
  amount: Joi.number().integer().min(1).optional(),
  paidBy: Joi.string().trim().min(1).max(255).optional(),
  notes: Joi.string().trim().max(1000).allow('').optional(),
});

const splitController = {
  /**
   * POST /api/transactions/:id/splits
   * Body: { amount, paidBy, notes? }
   */
  create: [
    validate(createSplitSchema),
    async (req, res, next) => {
      try {
        const tx = await splitService.addSplit(req.params.id, req.body);
        return res.status(201).json(tx);
      } catch (err) {
        next(err);
      }
    },
  ],

  /**
   * PATCH /api/transactions/:id/splits/:splitId
   * Body: { amount?, paidBy?, notes? }
   */
  update: [
    validate(updateSplitSchema),
    async (req, res, next) => {
      try {
        const tx = await splitService.updateSplit(req.params.id, req.params.splitId, req.body);
        return res.status(200).json(tx);
      } catch (err) {
        next(err);
      }
    },
  ],

  /**
   * DELETE /api/transactions/:id/splits/:splitId
   */
  async delete(req, res, next) {
    try {
      const tx = await splitService.deleteSplit(req.params.id, req.params.splitId);
      return res.status(200).json(tx);
    } catch (err) {
      next(err);
    }
  },
};

module.exports = splitController;
