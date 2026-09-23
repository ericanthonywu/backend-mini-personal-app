'use strict';

const emailPollerJob = require('../src/jobs/email-poller.job');
const emailParserService = require('../src/services/email-parser.service');
const alertService = require('../src/services/alert.service');
const db = require('../src/config/database');

describe('email-poller.job', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    emailPollerJob.stopRealtimeListener();
  });

  afterAll(async () => {
    await db.destroy();
  });

  describe('runPoll', () => {
    it('calls pollAndInsert on emailParserService and resolves poll failure alerts on success', async () => {
      jest.spyOn(emailParserService, 'pollAndInsert').mockResolvedValue({
        processed: 3,
        inserted: 2,
        skipped: 1,
      });
      jest.spyOn(alertService, 'resolvePollFailureAlerts').mockResolvedValue(1);

      const result = await emailPollerJob.runPoll();
      expect(result).toEqual({ processed: 3, inserted: 2, skipped: 1 });
      expect(emailParserService.pollAndInsert).toHaveBeenCalledTimes(1);
      expect(alertService.resolvePollFailureAlerts).toHaveBeenCalledTimes(1);
    });

    it('creates a poll failure alert when pollAndInsert throws an error', async () => {
      jest.spyOn(emailParserService, 'pollAndInsert').mockRejectedValue(new Error('IMAP connection lost'));
      jest.spyOn(alertService, 'createPollFailureAlert').mockResolvedValue({ id: 'alert-poll-1' });

      await expect(emailPollerJob.runPoll()).rejects.toThrow('IMAP connection lost');
      expect(alertService.createPollFailureAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('IMAP connection lost'),
        })
      );
    });
  });

  describe('handleIncomingMail', () => {
    it('executes runPoll when incoming mail event occurs', async () => {
      jest.spyOn(emailParserService, 'pollAndInsert').mockResolvedValue({
        processed: 1,
        inserted: 1,
        skipped: 0,
      });

      await emailPollerJob.handleIncomingMail();
      expect(emailParserService.pollAndInsert).toHaveBeenCalledTimes(1);
    });

    it('queues a pending check if another poll is currently running', async () => {
      let resolveFirst;
      const firstPollPromise = new Promise((resolve) => {
        resolveFirst = resolve;
      });

      let callCount = 0;
      jest.spyOn(emailParserService, 'pollAndInsert').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          await firstPollPromise;
        }
        return { processed: 1, inserted: 1, skipped: 0 };
      });

      // Start first poll (blocks until resolveFirst)
      const p1 = emailPollerJob.handleIncomingMail();

      // Trigger second poll while p1 is in-flight
      const p2 = emailPollerJob.handleIncomingMail();

      // Second poll should immediately return because isProcessing is true, but set hasPendingCheck
      await p2;

      // Release first poll
      resolveFirst();
      await p1;

      // Should have run twice in total: first run + queued second run
      expect(callCount).toBe(2);
    });
  });

  describe('triggerManualPoll', () => {
    it('throws rate limit error when called again within 60s', async () => {
      jest.spyOn(emailParserService, 'pollAndInsert').mockResolvedValue({
        processed: 0,
        inserted: 0,
        skipped: 0,
      });

      await emailPollerJob.triggerManualPoll();

      await expect(emailPollerJob.triggerManualPoll()).rejects.toThrow(/Rate limited/);
    });
  });
});
