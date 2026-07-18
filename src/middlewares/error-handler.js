'use strict';

const env = require('../config/env');

/**
 * Global error handler middleware.
 * Must be registered LAST in Express (after all routes).
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  if (env.isDev) {
    console.error(`[error] ${req.method} ${req.path} → ${statusCode}: ${message}`);
    if (statusCode === 500) console.error(err.stack);
  }

  return res.status(statusCode).json({
    error: message,
    ...(env.isDev && statusCode === 500 ? { stack: err.stack } : {}),
  });
}

module.exports = errorHandler;
