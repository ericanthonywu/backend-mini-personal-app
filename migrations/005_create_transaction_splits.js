'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('transaction_splits', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Foreign key to transactions — cascade delete if transaction is removed
    table
      .uuid('transaction_id')
      .notNullable()
      .references('id')
      .inTable('transactions')
      .onDelete('CASCADE');

    // Amount in IDR as integer — no decimals ever
    table.integer('amount').notNullable();

    // Name of the person who paid / reimbursed
    table.string('paid_by', 255).notNullable();

    // Optional notes/catatan for this split payment
    table.text('notes').defaultTo('');

    // WIB timestamps
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  // Index for fast lookups by transaction_id
  await knex.schema.raw(
    'CREATE INDEX idx_transaction_splits_transaction_id ON transaction_splits (transaction_id)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('transaction_splits');
};
