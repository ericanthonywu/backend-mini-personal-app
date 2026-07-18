'use strict';

require('dotenv').config();

/**
 * Centralized environment variable access.
 * All other modules must use this instead of process.env directly.
 */
const env = {
  // Database
  DB_HOST: process.env.DB_HOST || 'localhost',
  DB_PORT: parseInt(process.env.DB_PORT || '5432', 10),
  DB_USER: process.env.DB_USER,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_NAME: process.env.DB_NAME || 'expense_tracker',
  DB_DEBUG: process.env.DB_DEBUG === 'true',

  // Email
  EMAIL_HOST: process.env.EMAIL_HOST || 'imap.gmail.com',
  EMAIL_PORT: parseInt(process.env.EMAIL_PORT || '993', 10),
  EMAIL_USER: process.env.EMAIL_USER,
  EMAIL_PASSWORD: process.env.EMAIL_PASSWORD,
  EMAIL_TLS: process.env.EMAIL_TLS !== 'false',

  // Polling
  EMAIL_POLL_INTERVAL_MS: parseInt(process.env.EMAIL_POLL_INTERVAL_MS || '3600000', 10),

  // Budget (integers, IDR)
  WEEKLY_BUDGET: parseInt(process.env.WEEKLY_BUDGET || '1000000', 10),
  MONTHLY_BUDGET: parseInt(process.env.MONTHLY_BUDGET || '5000000', 10),

  // Auth
  AUTH_PIN: process.env.AUTH_PIN || '1234',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '30d',

  // Server
  PORT: parseInt(process.env.PORT || '3000', 10),
  NODE_ENV: process.env.NODE_ENV || 'development',

  get isDev() {
    return this.NODE_ENV === 'development';
  },
};

// Validate required env vars at startup
const required = ['DB_USER', 'DB_PASSWORD', 'EMAIL_USER', 'EMAIL_PASSWORD', 'JWT_SECRET'];
const missing = required.filter((key) => !env[key]);

if (missing.length > 0) {
  console.error(`[env] Missing required environment variables: ${missing.join(', ')}`);
  if (env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

module.exports = env;
