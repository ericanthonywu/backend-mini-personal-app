'use strict';

const env = require('../config/env');

/**
 * Helper to format IDR currency.
 * e.g. 50000 -> "Rp 50.000"
 */
function formatIDR(amount) {
  return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

/**
 * Notification Service — sends push notifications using ntfy.sh.
 * Safe fire-and-forget logic that never throws unhandled errors to the caller.
 */
class NotificationService {
  /**
   * Send a raw notification via ntfy.sh.
   *
   * @param {Object} options
   * @param {string} [options.topic] - override default topic
   * @param {string} options.title - Notification title
   * @param {string} options.message - Notification body
   * @param {string} [options.priority] - 'min'|'low'|'default'|'high'|'urgent' (default: 'default')
   * @param {string|string[]} [options.tags] - Emoji/tag names
   * @param {string} [options.click] - URL to open when tapped
   * @returns {Promise<boolean>}
   */
  static async send({ topic, title, message, priority = 'default', tags = [], click } = {}) {
    const targetTopic = topic || env.NTFY_TOPIC;
    if (!targetTopic) {
      console.warn('[notification] Skipping notification: No NTFY_TOPIC configured.');
      return false;
    }

    const ntfyBaseUrl = (env.NTFY_URL || 'https://ntfy.sh').replace(/\/+$/, '');
    const url = `${ntfyBaseUrl}`;

    // Priority mapping for ntfy (1=min, 2=low, 3=default, 4=high, 5=urgent)
    let priorityNum = 3;
    if (priority === 'urgent' || priority === 5) priorityNum = 5;
    else if (priority === 'high' || priority === 4) priorityNum = 4;
    else if (priority === 'low' || priority === 2) priorityNum = 2;
    else if (priority === 'min' || priority === 1) priorityNum = 1;

    const payload = {
      topic: targetTopic,
      title: title || 'BCA Expense Tracker',
      message: message || '',
      priority: priorityNum,
    };

    if (Array.isArray(tags) && tags.length > 0) {
      payload.tags = tags;
    } else if (typeof tags === 'string' && tags.length > 0) {
      payload.tags = tags.split(',').map((t) => t.trim()).filter(Boolean);
    }

    if (click) {
      payload.click = click;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.warn(`[notification] ntfy.sh returned status ${response.status}: ${await response.text()}`);
        return false;
      }

      console.log(`[notification] Successfully sent ntfy notification: "${title}" to topic "${targetTopic}"`);
      return true;
    } catch (err) {
      console.error('[notification] Failed to send ntfy notification:', err.message);
      return false;
    }
  }

  /**
   * Notify when a new transaction is recorded (via email scrape or manual entry).
   *
   * @param {Object} transaction
   * @param {string} [categoryName]
   * @returns {Promise<boolean>}
   */
  static async notifyNewTransaction(transaction, categoryName) {
    if (!transaction) return false;

    const amountStr = formatIDR(transaction.amount);
    const merchant = transaction.merchant || 'BCA Merchant';
    const category = categoryName || transaction.category_name || 'Tanpa Kategori';
    const isLarge = Number(transaction.amount || 0) >= 1000000;

    let dateStr = '';
    if (transaction.transaction_date || transaction.transactionDate) {
      const d = new Date(transaction.transaction_date || transaction.transactionDate);
      dateStr = d.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    const title = `💳 Transaksi Baru: ${merchant}`;
    const message = `${amountStr} • ${category}${dateStr ? `\n🕒 ${dateStr} WIB` : ''}`;
    const priority = isLarge ? 'high' : 'default';
    const tags = isLarge ? ['warning', 'money_with_wings', 'credit_card'] : ['credit_card', 'moneybag'];

    return this.send({
      title,
      message,
      priority,
      tags,
    });
  }

  /**
   * Notify budget threshold warnings or status.
   *
   * @param {Object} budgetData
   * @returns {Promise<boolean>}
   */
  static async notifyBudgetStatus(budgetData) {
    if (!budgetData) return false;

    const { period = 'Bulan', spent, budget, percentUsed, isOverBudget } = budgetData;
    const spentStr = formatIDR(spent);
    const budgetStr = formatIDR(budget);

    const title = isOverBudget
      ? `⚠️ Anggaran ${period} Ini Terlampaui!`
      : `🔔 Status Anggaran ${period}`;

    const message = `Terpakai: ${spentStr} / ${budgetStr} (${percentUsed}%)\n` +
      (isOverBudget ? 'Pengeluaran telah melebihi batas anggaran.' : 'Pantau pengeluaran Anda agar tetap aman.');

    const priority = isOverBudget ? 'high' : (percentUsed >= 80 ? 'default' : 'low');
    const tags = isOverBudget ? ['rotating_light', 'chart_with_upwards_trend'] : ['bell', 'bar_chart'];

    return this.send({
      title,
      message,
      priority,
      tags,
    });
  }
}

module.exports = NotificationService;
