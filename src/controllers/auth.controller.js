'use strict';

const Joi = require('joi');
const authService = require('../services/auth.service');
const validate = require('../middlewares/validator');

const loginSchema = Joi.object({
  pin: Joi.string().min(4).max(10).required(),
});

const authController = {
  /**
   * POST /api/auth/login
   * Body: { pin: string }
   * Response: { token: string, expiresIn: string }
   */
  login: [
    validate(loginSchema),
    (req, res, next) => {
      try {
        const result = authService.login(req.body.pin);
        return res.status(200).json(result);
      } catch (err) {
        next(err);
      }
    },
  ],
};

module.exports = authController;
