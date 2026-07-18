'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('categories', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.string('name', 100).notNullable().unique();
    table.string('color', 20).notNullable().defaultTo('#95A5A6');
    table.boolean('is_default').notNullable().defaultTo(false);
    // TIMESTAMP WITHOUT TIME ZONE — all times stored as WIB (UTC+7), no conversion
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('categories');
};
