'use strict';

/**
 * AppError — structured error class for consistent error handling.
 * All thrown errors in services/repositories should use this class.
 *
 * @example
 *   throw new AppError('Transaction not found', 404);
 *   throw new AppError('Invalid amount', 400);
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable error message
   * @param {number} statusCode - HTTP status code
   */
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
