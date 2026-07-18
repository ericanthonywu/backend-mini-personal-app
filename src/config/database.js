'use strict';

const knex = require('knex');
const env = require('./env');

const db = knex({
  client: 'pg',
  connection: {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
  },
  debug: env.DB_DEBUG,
  pool: {
    min: 2,
    max: 10,
  },
});

module.exports = db;
