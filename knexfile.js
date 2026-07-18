require('dotenv').config();
const env = require('./src/config/env');

/**
 * @type { Object.<string, import("knex").Knex.Config> }
 */
module.exports = {
  development: {
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    },
    debug: env.DB_DEBUG,
    migrations: {
      directory: './migrations',
      extension: 'js',
    },
    seeds: {
      directory: './seeds',
    },
  },
  production: {
    client: 'pg',
    connection: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
    },
    debug: false,
    migrations: {
      directory: './migrations',
      extension: 'js',
    },
    seeds: {
      directory: './seeds',
    },
  },
};
