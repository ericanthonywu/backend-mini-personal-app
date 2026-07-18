'use strict';

const Joi = require('joi');
const categoryService = require('../services/category.service');
const validate = require('../middlewares/validator');

const createSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const updateSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  color: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
});

const ruleCreateSchema = Joi.object({
  merchantPattern: Joi.string().min(1).max(255).required(),
  categoryId: Joi.string().uuid().required(),
});

const categoryController = {
  /**
   * GET /api/categories
   */
  async list(req, res, next) {
    try {
      const data = await categoryService.list();
      return res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/categories
   */
  create: [
    validate(createSchema),
    async (req, res, next) => {
      try {
        const cat = await categoryService.create(req.body);
        return res.status(201).json(cat);
      } catch (err) {
        next(err);
      }
    },
  ],

  /**
   * PATCH /api/categories/:id
   */
  update: [
    validate(updateSchema),
    async (req, res, next) => {
      try {
        const cat = await categoryService.update(req.params.id, req.body);
        return res.status(200).json(cat);
      } catch (err) {
        next(err);
      }
    },
  ],

  /**
   * DELETE /api/categories/:id
   */
  async delete(req, res, next) {
    try {
      await categoryService.delete(req.params.id);
      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  },

  // --- Merchant Rules ---

  /**
   * GET /api/merchant-rules
   */
  async listRules(req, res, next) {
    try {
      const data = await categoryService.listMerchantRules();
      return res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  },

  /**
   * POST /api/merchant-rules
   */
  createRule: [
    validate(ruleCreateSchema),
    async (req, res, next) => {
      try {
        const rule = await categoryService.createMerchantRule(req.body);
        return res.status(201).json(rule);
      } catch (err) {
        next(err);
      }
    },
  ],

  /**
   * DELETE /api/merchant-rules/:id
   */
  async deleteRule(req, res, next) {
    try {
      await categoryService.deleteMerchantRule(req.params.id);
      return res.status(204).send();
    } catch (err) {
      next(err);
    }
  },
};

module.exports = categoryController;
