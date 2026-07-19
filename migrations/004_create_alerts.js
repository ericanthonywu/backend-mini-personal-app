'use strict';

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('alerts', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));

    // Alert category — 'parse_failure' for now, extensible for future types
    table.string('type', 50).notNullable().defaultTo('parse_failure');

    // Short human-readable headline shown in the mobile banner
    table.string('title', 255).notNullable();

    // Full description with context (email ID, missing fields, etc.)
    table.text('message').notNullable();

    // Arbitrary JSON context for investigation (email_message_id, html_snippet, missing_fields, etc.)
    table.jsonb('metadata').notNullable().defaultTo('{}');

    // false = active/unresolved, true = user has dismissed it from the app
    table.boolean('is_resolved').notNullable().defaultTo(false);

    // WIB timestamp when the user resolved the alert (null until resolved)
    table.timestamp('resolved_at', { useTz: false }).nullable();

    // WIB timestamps — match convention used in all other tables
    table.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.fn.now());
  });

  // Primary query pattern: fetch all unresolved alerts, newest first
  await knex.schema.raw(
    'CREATE INDEX idx_alerts_unresolved ON alerts (is_resolved, created_at DESC)'
  );

  // Filter by type for future alert categories
  await knex.schema.raw(
    'CREATE INDEX idx_alerts_type ON alerts (type)'
  );
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('alerts');
};
