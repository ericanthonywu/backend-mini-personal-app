'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/app-error');

/**
 * Auth Service — PIN verification and JWT management.
 */
const authService = {
  /**
   * Verifies the provided PIN against the env PIN.
   * If correct, returns a signed JWT.
   *
   * @param {string} pin
   * @returns {{ token: string, expiresIn: string }}
   * @throws {AppError} 401 if PIN is incorrect
   */
  login(pin) {
    if (String(pin) !== String(env.AUTH_PIN)) {
      throw new AppError('Invalid PIN', 401);
    }

    const token = jwt.sign({ sub: 'owner' }, env.JWT_SECRET, {
      expiresIn: env.JWT_EXPIRES_IN,
    });

    return { token, expiresIn: env.JWT_EXPIRES_IN };
  },

  /**
   * Verifies a JWT and returns the payload.
   *
   * @param {string} token
   * @returns {Object} decoded payload
   * @throws {AppError} 401 if token is invalid or expired
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, env.JWT_SECRET);
    } catch (err) {
      throw new AppError('Invalid or expired token', 401);
    }
  },
};

module.exports = authService;
