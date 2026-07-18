'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('merchant_category_rules', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Pattern to match against merchant name (case-insensitive substring match)
    table.string('merchant_pattern', 255).notNullable();

    table.uuid('category_id').notNullable().references('id').inTable('categories').onDelete('CASCADE');

    // WIB timestamp
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('merchant_category_rules');
};
