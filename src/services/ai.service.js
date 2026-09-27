'use strict';

const env = require('../config/env');

const FALLBACK_MODELS = [
  env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.8-flash',
  'gemini-flash-latest',
];

// Unique set of models to try
const MODEL_CANDIDATES = Array.from(new Set(FALLBACK_MODELS.filter(Boolean)));

class AiService {
  /**
   * Raw invocation to Google AI Studio Gemini API with model fallback and JSON parsing.
   *
   * @param {string} prompt
   * @param {Object} [options]
   * @param {boolean} [options.json=true]
   * @param {number} [options.temperature=0.2]
   * @returns {Promise<any>}
   */
  static async callGemini(prompt, { json = true, temperature = 0.2 } = {}) {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured in backend environment');
    }

    let lastError = null;

    for (const model of MODEL_CANDIDATES) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const requestBody = {
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature,
        },
      };

      if (json) {
        requestBody.generationConfig.responseMimeType = 'application/json';
      }

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          lastError = new Error(`Gemini model ${model} HTTP ${response.status}: ${errText}`);
          console.warn(`[ai-service] Model ${model} failed with status ${response.status}. Trying next candidate...`);
          continue; // try next candidate model
        }

        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = new Error(`Empty response from Gemini model ${model}`);
          continue;
        }

        if (json) {
          try {
            // Clean markdown code blocks if present
            const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            return JSON.parse(cleaned);
          } catch (parseErr) {
            console.warn('[ai-service] Failed to parse JSON response from Gemini, raw text:', text);
            throw new Error(`Invalid JSON returned by Gemini: ${parseErr.message}`);
          }
        }

        return text;
      } catch (err) {
        lastError = err;
        console.warn(`[ai-service] Error calling model ${model}:`, err.message);
      }
    }

    throw lastError || new Error('All Gemini model candidates failed');
  }

  /**
   * Auto-categorize a transaction using AI based on scraped email information,
   * merchant name, notes, amount, and existing categories.
   *
   * @param {Object} params
   * @param {string} params.merchant
   * @param {number} params.amount
   * @param {string} [params.transactionType]
   * @param {string} [params.notes]
   * @param {string} [params.rawEmailSnippet]
   * @param {Array<{ id: string, name: string }>} params.categories
   * @returns {Promise<{ categoryId: string|null, categoryName: string|null, confidence: number, reasoning: string }>}
   */
  static async categorizeTransaction({ merchant, amount, transactionType, notes, rawEmailSnippet, categories = [] }) {
    if (!categories || categories.length === 0) {
      return { categoryId: null, categoryName: null, confidence: 0, reasoning: 'No categories available' };
    }

    const categoryListStr = categories.map((c) => `- "${c.name}" (ID: ${c.id})`).join('\n');

    const prompt = `You are an expert AI financial classifier for an Indonesian personal credit card expense tracker (BCA Credit Card).
A new transaction was scraped and parsed from an email notification:

Merchant / Payee: "${merchant || 'Unknown'}"
Transaction Amount: Rp ${Number(amount || 0).toLocaleString('id-ID')}
Transaction Type: "${transactionType || 'Credit Card'}"
Notes / Raw Context: "${notes || ''}"
${rawEmailSnippet ? `Scraped Email Context Snippet: "${rawEmailSnippet.substring(0, 500)}"` : ''}

Available Categories in the user's budget app:
${categoryListStr}

Common Indonesian context clues:
- "GOPAY", "GRABFOOD", "SHOPEEFOOD", "STARBUCKS", "KFC", "MCDONALD", "KOPI", "BAKMI", "RESTORAN" -> Food
- "TOKOPEDIA", "SHOPEE", "TIKTOK SHOP", "ZALORA", "BLIBLI" -> Online Shopping (or Online Groceries if specific grocery merchant)
- "SUPERINDO", "ALFAMART", "INDOMARET", "HYPERMART", "FARMERS MARKET", "RANCH MARKET", "GRAND LUCKY", "HERO" -> Groceries (Offline Groceries or Online Groceries)
- "PLN", "TELKOM", "INDIHOME", "BPJS", "PBB", "PULSA" -> Bills / Utilities
- "SHELL", "PERTAMINA", "BLUEBIRD", "MAXIM", "KRL", "MRT", "PARKIR" -> Transport

Task:
Analyze the transaction and select the SINGLE best category from the available categories list above.
Return a valid JSON object matching this schema:
{
  "categoryId": "<the exact matching category ID from the list, or null if no appropriate fit>",
  "categoryName": "<the exact name of the selected category>",
  "confidence": <number between 0.0 and 1.0 indicating confidence>,
  "reasoning": "<short Indonesian or English explanation of why this category was selected>"
}`;

    try {
      const result = await this.callGemini(prompt, { json: true, temperature: 0.1 });
      
      // Verify that categoryId matches an existing category
      const matched = categories.find((c) => c.id === result.categoryId || c.name.toLowerCase() === (result.categoryName || '').toLowerCase());
      if (matched) {
        return {
          categoryId: matched.id,
          categoryName: matched.name,
          confidence: typeof result.confidence === 'number' ? result.confidence : 0.85,
          reasoning: result.reasoning || `Auto-categorized as ${matched.name}`,
        };
      }

      // If categoryId wasn't exact, check if "Others" exists
      const others = categories.find((c) => c.name.toLowerCase() === 'others' || c.name.toLowerCase() === 'lainnya');
      return {
        categoryId: others ? others.id : null,
        categoryName: others ? others.name : null,
        confidence: 0.5,
        reasoning: result.reasoning || 'Categorized as general/others',
      };
    } catch (err) {
      console.error('[ai-service] Error during categorization:', err.message);
      return {
        categoryId: null,
        categoryName: null,
        confidence: 0,
        reasoning: `AI categorization failed: ${err.message}`,
      };
    }
  }

  /**
   * Generate an executive financial summary of whole expenses.
   *
   * @param {Object} data
   * @param {string} [data.period='this_month']
   * @param {number} data.totalSpent
   * @param {number} data.totalCount
   * @param {Array} data.categoryBreakdown
   * @param {Array} data.topMerchants
   * @param {Object} [data.budget]
   * @param {Array} [data.recentTransactions]
   * @returns {Promise<{ summary: string, healthScore: 'healthy'|'caution'|'critical', keyInsights: string[], recommendations: string[], generatedAt: string }>}
   */
  static async generateExpenseSummary(data) {
    const {
      period = 'Bulan Ini',
      totalSpent = 0,
      totalCount = 0,
      categoryBreakdown = [],
      topMerchants = [],
      budget = null,
      recentTransactions = [],
    } = data;

    const breakdownText = categoryBreakdown.map((c) =>
      `- ${c.categoryName}: Rp ${Number(c.totalAmount || 0).toLocaleString('id-ID')} (${c.percentage || 0}%, ${c.transactionCount || 0} transaksi)`
    ).join('\n') || 'Tidak ada data kategori.';

    const merchantsText = topMerchants.map((m) =>
      `- ${m.merchant}: Rp ${Number(m.totalSpent || m.totalAmount || 0).toLocaleString('id-ID')} (${m.count} transaksi)`
    ).join('\n') || 'Tidak ada data merchant.';

    const recentText = recentTransactions.slice(0, 5).map((t) =>
      `- ${t.merchant}: Rp ${Number(t.amount).toLocaleString('id-ID')} (${t.category_name || 'Tanpa Kategori'})`
    ).join('\n') || 'Tidak ada transaksi terbaru.';

    let budgetText = 'Batas anggaran belum diatur.';
    if (budget) {
      const budgetAmount = budget.budget || 0;
      const pct = budget.percentUsed || 0;
      budgetText = `Batas Anggaran: Rp ${Number(budgetAmount).toLocaleString('id-ID')}, Terpakai: ${pct}% (${budget.isOverBudget ? 'OVER BUDGET' : 'Dalam Batas Aman'})`;
    }

    const prompt = `You are a world-class personal finance advisor reviewing Indonesian BCA credit card expenses.
Review the following expense data for period "${period}":

TOTAL PENGELUARAN: Rp ${Number(totalSpent).toLocaleString('id-ID')} (${totalCount} transaksi)
STATUS BUDGET: ${budgetText}

BREAKDOWN PER KATEGORI:
${breakdownText}

TOP 5 MERCHANT DENGAN PENGELUARAN TERTINGGI:
${merchantsText}

TRANSAKSI TERBARU:
${recentText}

Please analyze this spending profile with financial acumen and return a JSON object with this exact structure:
{
  "healthScore": "<'healthy' if spending is well within budget and reasonable, 'caution' if spending is close to budget (75-99%) or elevated, 'critical' if over budget or has excessive impulse spending>",
  "summary": "<A 2-3 paragraph insightful, executive financial narrative written in professional, friendly Indonesian. Highlight main expense drivers, compare essentials vs discretionary, note any spending patterns, and summarize overall fiscal health>",
  "keyInsights": [
    "<Concise bullet point 1 on biggest spending driver or pattern>",
    "<Concise bullet point 2 on budget consumption pace>",
    "<Concise bullet point 3 on merchant frequency or habits>"
  ],
  "recommendations": [
    "<Actionable, practical tip 1 to optimize spending next period>",
    "<Actionable, practical tip 2 on specific high-cost category>",
    "<Actionable, practical tip 3 on financial wellness>"
  ]
}`;

    try {
      const result = await this.callGemini(prompt, { json: true, temperature: 0.3 });
      return {
        healthScore: result.healthScore || 'healthy',
        summary: result.summary || 'Pengeluaran berjalan normal.',
        keyInsights: Array.isArray(result.keyInsights) ? result.keyInsights : [],
        recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
        generatedAt: new Date().toISOString(),
      };
    } catch (err) {
      console.error('[ai-service] Error generating expense summary:', err.message);
      // Fallback response so user always gets valuable info even if Gemini is unreachable
      const isOver = budget ? budget.isOverBudget : false;
      const topCat = categoryBreakdown[0] ? categoryBreakdown[0].categoryName : 'Lainnya';
      return {
        healthScore: isOver ? 'critical' : 'healthy',
        summary: `Total pengeluaran Anda untuk ${period} adalah Rp ${Number(totalSpent).toLocaleString('id-ID')} dengan total ${totalCount} transaksi. Pengeluaran terbesar didominasi oleh kategori ${topCat}. Selalu perhatikan rasio pengeluaran primer dan sekunder agar arus kas tetap sehat.`,
        keyInsights: [
          `Total pengeluaran tercatat Rp ${Number(totalSpent).toLocaleString('id-ID')} dari ${totalCount} transaksi.`,
          `Kategori pengeluaran terbesar adalah ${topCat}.`,
          budget ? `Status anggaran berada pada ${budget.percentUsed}% pemakaian.` : 'Tetapkan target anggaran untuk pemantauan lebih baik.',
        ],
        recommendations: [
          'Evaluasi transaksi pada kategori teratas untuk efisiensi pengeluaran berkala.',
          'Catat transaksi kecil harian yang sering kali terabaikan namun berakumulasi besar.',
          'Prioritaskan pembayaran tagihan sebelum batas waktu untuk menghindari denda bunga.',
        ],
        generatedAt: new Date().toISOString(),
      };
    }
  }
}

module.exports = AiService;
