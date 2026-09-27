'use strict';

const db = require('../src/config/database');
const aiService = require('../src/services/ai.service');

const CHUNK_SIZE = 45;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function categorizeAll() {
  console.log('=== Starting Full Manual AI Categorization ===');

  // 1. Fetch available categories
  const categories = await db('categories').select('id', 'name');
  console.log(`Loaded ${categories.length} categories:`, categories.map((c) => c.name).join(', '));

  const categoryMap = new Map();
  for (const cat of categories) {
    categoryMap.set(cat.name.toLowerCase().trim(), cat.id);
  }

  const othersId = categoryMap.get('others');
  if (!othersId) {
    throw new Error('Default category "Others" not found in database');
  }

  function findCategoryId(name) {
    if (!name) return othersId;
    const lower = name.toLowerCase().trim();
    if (categoryMap.has(lower)) return categoryMap.get(lower);
    for (const [catName, id] of categoryMap.entries()) {
      if (lower.includes(catName) || catName.includes(lower)) {
        return id;
      }
    }
    return othersId;
  }

  // 2. Reset transactions that were bulk assigned to Others in the last 30 minutes so they get classified properly
  const resetCount = await db('transactions')
    .where('category_id', othersId)
    .where('updated_at', '>=', new Date(Date.now() - 30 * 60 * 1000))
    .update({ category_id: null });
  console.log(`Reset ${resetCount} transactions that were temporarily set to Others back to NULL for accurate classification.`);

  // 3. Count uncategorized transactions
  const initialUncat = await db('transactions')
    .whereNull('category_id')
    .count('id as count')
    .first();
  const totalUncat = parseInt(initialUncat.count, 10);
  console.log(`Total uncategorized transactions to process: ${totalUncat}`);

  if (totalUncat === 0) {
    console.log('No uncategorized transactions to process!');
    await db.destroy();
    return;
  }

  // 4. Fetch all distinct merchants with uncategorized transactions
  const merchantRows = await db('transactions')
    .whereNull('category_id')
    .select('merchant')
    .count('id as count')
    .groupBy('merchant')
    .orderBy('count', 'desc');

  console.log(`Found ${merchantRows.length} distinct merchants across ${totalUncat} transactions.`);

  // 5. Process in chunks
  let updatedCount = 0;
  let batchNum = 0;
  const totalBatches = Math.ceil(merchantRows.length / CHUNK_SIZE);

  for (let i = 0; i < merchantRows.length; i += CHUNK_SIZE) {
    batchNum++;
    const chunk = merchantRows.slice(i, i + CHUNK_SIZE);
    const merchantNames = chunk.map((m) => m.merchant.trim()).filter(Boolean);

    console.log(`\nProcessing Batch ${batchNum}/${totalBatches} (${merchantNames.length} merchants)...`);

    const prompt = `
You are an expert personal finance categorizer for Indonesian transactions.
Classify each merchant into EXACTLY ONE of these categories:
- Food (restaurants, cafes, food delivery, coffee, fast food, bakery, snacks, alcohol, bar)
- Online Shopping (e-commerce like Tokopedia, Shopee, TikTok Shop, electronics, clothing, retail stores, gaming digital goods)
- Online Groceries (Sayurbox, Astro, Segari, online fresh food delivery)
- Offline Groceries (supermarkets, hypermarkets, minimarkets like Superindo, Indomaret, Alfamart, Grand Lucky, Farmer's Market, Ranch Market, Lawson)
- Others (gas stations SPBU/Pertamina/Shell, subscriptions Netflix/Spotify/PlayStation/Bumble, parking, toll, entertainment, health, clinic, dental, hair salon, utilities, transfers, unclassified)

Merchants:
${JSON.stringify(merchantNames, null, 2)}

Return a strict JSON object:
{
  "classifications": [
    { "merchant": "EXACT_MERCHANT_NAME", "category": "Food" }
  ]
}
`;

    let classifications = [];
    try {
      const response = await aiService.callGemini(prompt, { json: true, temperature: 0.1 });
      classifications = response?.classifications || [];
    } catch (err) {
      console.warn(`[Batch ${batchNum}] AI call failed: ${err.message}. Assigning fallback.`);
      classifications = merchantNames.map((m) => ({ merchant: m, category: 'Others' }));
    }

    const resultMap = new Map();
    for (const item of classifications) {
      if (item.merchant) {
        resultMap.set(item.merchant.trim(), item.category);
      }
    }

    // Apply classifications to database
    for (const mName of merchantNames) {
      const catName = resultMap.get(mName) || 'Others';
      const catId = findCategoryId(catName);
      const rowsAffected = await db('transactions')
        .whereNull('category_id')
        .where('merchant', mName)
        .update({
          category_id: catId,
          updated_at: db.fn.now(),
        });

      updatedCount += rowsAffected;
      if (rowsAffected > 0) {
        console.log(`  -> "${mName}" (${rowsAffected} tx) => ${catName}`);
      }
    }

    // Safe 4.5s delay to stay well under 15 RPM
    if (batchNum < totalBatches) {
      console.log('  Waiting 4.5s for rate limit...');
      await sleep(4500);
    }
  }

  // 6. Catch any remaining transactions where merchant was null or mismatched
  const remainingRows = await db('transactions')
    .whereNull('category_id')
    .update({
      category_id: othersId,
      updated_at: db.fn.now(),
    });

  if (remainingRows > 0) {
    console.log(`\nAssigned fallback "Others" to ${remainingRows} remaining transactions.`);
    updatedCount += remainingRows;
  }

  // 7. Verify final stats
  const finalUncat = await db('transactions')
    .whereNull('category_id')
    .count('id as count')
    .first();
  const finalCount = parseInt(finalUncat.count, 10);

  const breakdown = await db('transactions')
    .join('categories', 'transactions.category_id', 'categories.id')
    .select('categories.name')
    .count('transactions.id as count')
    .sum('transactions.amount as total_amount')
    .groupBy('categories.name')
    .orderBy('count', 'desc');

  console.log('\n=============================================');
  console.log('           CATEGORIZATION SUMMARY            ');
  console.log('=============================================');
  console.log(`Total transactions categorized: ${updatedCount}`);
  console.log(`Remaining uncategorized:        ${finalCount}`);
  console.log('\nFinal Category Distribution:');
  for (const b of breakdown) {
    const formattedAmt = Number(b.total_amount || 0).toLocaleString('id-ID');
    console.log(`  - ${b.name.padEnd(20)}: ${String(b.count).padStart(5)} transaksi | Rp ${formattedAmt}`);
  }
  console.log('=============================================\n');

  await db.destroy();
}

categorizeAll().catch((err) => {
  console.error('Fatal error during categorization:', err);
  process.exit(1);
});
