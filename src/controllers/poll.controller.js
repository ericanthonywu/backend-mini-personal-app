'use strict';

const { triggerManualPoll } = require('../jobs/email-poller.job');

const pollController = {
  /**
   * POST /api/poll
   * Triggers an immediate email poll.
   * Rate limited to once per 60 seconds.
   *
   * Response: { processed: number, inserted: number, skipped: number }
   */
  async trigger(req, res, next) {
    try {
      const result = await triggerManualPoll();
      return res.status(200).json({
        message: `Poll complete. ${result.inserted} new transaction(s) found.`,
        ...result,
      });
    } catch (err) {
      next(err);
    }
  },
};

module.exports = pollController;
