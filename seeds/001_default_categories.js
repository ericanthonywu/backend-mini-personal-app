'use strict';

const { v4: uuidv4 } = require('uuid');

const DEFAULT_CATEGORIES = [
  { name: 'Food', color: '#FF6B6B' },
  { name: 'Online Shopping', color: '#4ECDC4' },
  { name: 'Online Groceries', color: '#45B7D1' },
  { name: 'Offline Groceries', color: '#96CEB4' },
  { name: 'Others', color: '#95A5A6' },
];

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.seed = async function (knex) {
  // Only insert if no categories exist — safe to re-run
  const existing = await knex('categories').count('id as count').first();
  if (parseInt(existing.count, 10) > 0) {
    console.log('[seed] Categories already seeded, skipping.');
    return;
  }

  const now = new Date();
  const rows = DEFAULT_CATEGORIES.map((cat) => ({
    id: uuidv4(),
    name: cat.name,
    color: cat.color,
    is_default: true,
    created_at: now,
  }));

  await knex('categories').insert(rows);
  console.log(`[seed] Inserted ${rows.length} default categories.`);
};
