'use strict';

const authService = require('../services/auth.service');

/**
 * JWT authentication middleware.
 * Extracts Bearer token from Authorization header and verifies it.
 * Attaches decoded payload to req.user.
 */
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or malformed' });
  }

  const token = authHeader.split(' ')[1];

  try {
    req.user = authService.verifyToken(token);
    next();
  } catch (err) {
    return res.status(err.statusCode || 401).json({ error: err.message });
  }
}

module.exports = authMiddleware;
