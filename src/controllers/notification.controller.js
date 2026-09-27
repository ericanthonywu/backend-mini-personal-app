'use strict';

const notificationService = require('../services/notification.service');
const env = require('../config/env');

const notificationController = {
  /**
   * POST /api/notifications/test
   * Trigger a test notification via ntfy.sh
   */
  async test(req, res, next) {
    try {
      const { title, message } = req.body || {};
      const success = await notificationService.send({
        title: title || '🧪 Tes Notifikasi BCA Expense Tracker',
        message: message || `Notifikasi ntfy.sh berhasil terhubung pada ${new Date().toLocaleTimeString('id-ID')}`,
        priority: 'default',
        tags: ['white_check_mark', 'bell'],
      });

      return res.status(200).json({
        success,
        topic: env.NTFY_TOPIC,
        url: `${env.NTFY_URL}/${env.NTFY_TOPIC}`,
      });
    } catch (err) {
      next(err);
    }
  },

  /**
   * GET /api/notifications/config
   * Return public ntfy config so clients know which topic to subscribe to
   */
  async getConfig(req, res) {
    return res.status(200).json({
      url: env.NTFY_URL,
      topic: env.NTFY_TOPIC,
      subscribeUrl: `${env.NTFY_URL}/${env.NTFY_TOPIC}`,
    });
  },
};

module.exports = notificationController;
