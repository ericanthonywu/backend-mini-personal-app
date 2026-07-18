'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('transactions', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Amount in IDR as integer — no decimals ever
    table.integer('amount').notNullable();

    // Transaction date stored as WIB (TIMESTAMP WITHOUT TIME ZONE — no UTC conversion)
    table.timestamp('transaction_date', { useTz: false }).notNullable();

    table.string('merchant', 255).notNullable();
    table.string('transaction_type', 100).notNullable().defaultTo('');

    // notes = "MERCHANT - TRANSACTION_TYPE" combined
    table.text('notes').defaultTo('');

    // Foreign key to categories
    table.uuid('category_id').nullable().references('id').inTable('categories').onDelete('SET NULL');

    // Whether to exclude this transaction from budget calculations
    // (still counted in total expenses but not in "real" budget)
    table.boolean('is_ignored').notNullable().defaultTo(false);

    // IMAP Message-ID header — unique constraint prevents duplicate insertion on re-poll
    table.string('email_message_id', 500).notNullable().unique();

    // WIB timestamps
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  // Index for common queries
  await knex.schema.raw(
    'CREATE INDEX idx_transactions_date ON transactions (transaction_date DESC)'
  );
  await knex.schema.raw(
    'CREATE INDEX idx_transactions_category ON transactions (category_id)'
  );
  await knex.schema.raw(
    'CREATE INDEX idx_transactions_ignored ON transactions (is_ignored)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('transactions');
};
