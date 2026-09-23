'use strict';

const emailParserService = require('../src/services/email-parser.service');
const { parseBcaEmail, parseBcaDate, parseBcaAmount } = require('../src/utils/email-parser.util');
const transactionRepository = require('../src/repositories/transaction.repository');
const merchantRuleRepository = require('../src/repositories/merchant-rule.repository');
const alertService = require('../src/services/alert.service');
const db = require('../src/config/database');

describe('email-parser.util', () => {
  afterAll(async () => {
    await db.destroy();
  });
  describe('parseBcaAmount', () => {
    it('parses Rp format with thousand dots and comma decimal', () => {
      expect(parseBcaAmount('Rp494.614,00')).toBe(494614);
      expect(parseBcaAmount('Rp 1.234.567,00')).toBe(1234567);
      expect(parseBcaAmount('Rp100,50')).toBe(101);
    });

    it('parses IDR prefix without decimals', () => {
      expect(parseBcaAmount('IDR 186.000')).toBe(186000);
      expect(parseBcaAmount('IDR 1.500.000')).toBe(1500000);
    });

    it('parses foreign currency', () => {
      expect(parseBcaAmount('AUD 30')).toBe(30);
      expect(parseBcaAmount('USD 99.99')).toBe(100);
      expect(parseBcaAmount('AUD 87,95')).toBe(88);
    });

    it('returns null for invalid amounts', () => {
      expect(parseBcaAmount('')).toBeNull();
      expect(parseBcaAmount(null)).toBeNull();
      expect(parseBcaAmount('invalid')).toBeNull();
    });
  });

  describe('parseBcaDate', () => {
    it('parses standard BCA WIB date string', () => {
      const date = parseBcaDate('15-07-2026 20:28:39 WIB');
      expect(date).toBeInstanceOf(Date);
      expect(date.getFullYear()).toBe(2026);
      expect(date.getMonth()).toBe(6); // 0-indexed July
      expect(date.getDate()).toBe(15);
      expect(date.getHours()).toBe(20);
      expect(date.getMinutes()).toBe(28);
      expect(date.getSeconds()).toBe(39);
    });

    it('returns null for invalid dates', () => {
      expect(parseBcaDate('invalid date')).toBeNull();
    });
  });

  describe('parseBcaEmail', () => {
    it('parses valid HTML table with merchant, date, amount, and transaction type', () => {
      const html = `
        <table>
          <tr><td>Merchant / ATM</td><td>:</td><td><span>STARBUCKS COFFEE</span></td></tr>
          <tr><td>Jenis Transaksi</td><td>:</td><td><span>DOMESTIK</span></td></tr>
          <tr><td>Pada Tanggal</td><td>:</td><td><span>23-09-2026 14:10:00 WIB</span></td></tr>
          <tr><td>Sejumlah</td><td>:</td><td><span>Rp75.000,00</span></td></tr>
        </table>
      `;

      const result = parseBcaEmail(html);
      expect(result).not.toBeNull();
      expect(result.error).toBeUndefined();
      expect(result.merchant).toBe('STARBUCKS COFFEE');
      expect(result.transactionType).toBe('DOMESTIK');
      expect(result.amount).toBe(75000);
      expect(result.notes).toBe('STARBUCKS COFFEE - DOMESTIK');
    });

    it('returns missingFields error when required fields are absent', () => {
      const html = `
        <table>
          <tr><td>Merchant / ATM</td><td>:</td><td><span>UNKNOWN</span></td></tr>
        </table>
      `;

      const result = parseBcaEmail(html);
      expect(result).toEqual({
        error: true,
        missingFields: ['pada tanggal', 'sejumlah'],
      });
    });
  });
});

describe('emailParserService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildOrCriteria', () => {
    it('correctly builds nested OR structure for IMAP', () => {
      expect(emailParserService.buildOrCriteria([])).toEqual([]);
      expect(emailParserService.buildOrCriteria(['A'])).toEqual('A');
      expect(emailParserService.buildOrCriteria(['A', 'B'])).toEqual(['OR', 'A', 'B']);
      expect(emailParserService.buildOrCriteria(['A', 'B', 'C'])).toEqual(['OR', 'A', ['OR', 'B', 'C']]);
    });
  });

  describe('pollAndInsert', () => {
    const validHtml = `
      <table>
        <tr><td>Merchant / ATM</td><td>:</td><td><span>SHOPEEFOOD</span></td></tr>
        <tr><td>Jenis Transaksi</td><td>:</td><td><span>E-COMMERCE</span></td></tr>
        <tr><td>Pada Tanggal</td><td>:</td><td><span>23-09-2026 16:17:42 WIB</span></td></tr>
        <tr><td>Sejumlah</td><td>:</td><td><span>Rp41.900,00</span></td></tr>
      </table>
    `;

    it('processes emails with allowed senders and matching subject', async () => {
      jest.spyOn(emailParserService, 'fetchBcaEmails').mockResolvedValue([
        {
          messageId: '<valid-bca-co-id@bca.co.id>',
          subject: 'Credit Card Transaction Notification',
          from: { value: [{ address: 'kartukreditbca@bca.co.id' }] },
          html: validHtml,
        },
        {
          messageId: '<valid-klikbca@klikbca.com>',
          subject: 'Credit Card Transaction Notification',
          from: { value: [{ address: 'KartuKreditBCA@klikbca.com' }] },
          html: validHtml,
        },
      ]);

      jest.spyOn(merchantRuleRepository, 'findMatchingRule').mockResolvedValue(null);
      jest.spyOn(transactionRepository, 'createIgnoreDuplicate').mockResolvedValue({ id: 'tx-1' });

      const result = await emailParserService.pollAndInsert({});

      expect(result.processed).toBe(2);
      expect(result.inserted).toBe(2);
      expect(result.skipped).toBe(0);
      expect(transactionRepository.createIgnoreDuplicate).toHaveBeenCalledTimes(2);
    });

    it('skips emails with unauthorized sender', async () => {
      jest.spyOn(emailParserService, 'fetchBcaEmails').mockResolvedValue([
        {
          messageId: '<fake-sender@random.com>',
          subject: 'Credit Card Transaction Notification',
          from: { value: [{ address: 'phishing@random.com' }] },
          html: validHtml,
        },
      ]);

      jest.spyOn(merchantRuleRepository, 'findMatchingRule').mockResolvedValue(null);
      jest.spyOn(transactionRepository, 'createIgnoreDuplicate').mockResolvedValue({ id: 'tx-1' });

      const result = await emailParserService.pollAndInsert({});

      expect(result.processed).toBe(1);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(transactionRepository.createIgnoreDuplicate).not.toHaveBeenCalled();
    });

    it('skips emails with non-matching subject', async () => {
      jest.spyOn(emailParserService, 'fetchBcaEmails').mockResolvedValue([
        {
          messageId: '<statement@bca.co.id>',
          subject: 'Your Monthly Bank Statement',
          from: { value: [{ address: 'kartukreditbca@bca.co.id' }] },
          html: validHtml,
        },
      ]);

      jest.spyOn(merchantRuleRepository, 'findMatchingRule').mockResolvedValue(null);
      jest.spyOn(transactionRepository, 'createIgnoreDuplicate').mockResolvedValue({ id: 'tx-1' });

      const result = await emailParserService.pollAndInsert({});

      expect(result.processed).toBe(1);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(transactionRepository.createIgnoreDuplicate).not.toHaveBeenCalled();
    });

    it('handles parse failures gracefully and creates alert', async () => {
      jest.spyOn(emailParserService, 'fetchBcaEmails').mockResolvedValue([
        {
          messageId: '<bad-parse@bca.co.id>',
          subject: 'Credit Card Transaction Notification',
          from: { value: [{ address: 'kartukreditbca@bca.co.id' }] },
          html: '<div>Incomplete email</div>',
        },
      ]);

      jest.spyOn(alertService, 'createParseFailureAlert').mockResolvedValue({ id: 'alert-1' });

      const result = await emailParserService.pollAndInsert({});

      expect(result.processed).toBe(1);
      expect(result.inserted).toBe(0);
      expect(result.skipped).toBe(1);
      expect(alertService.createParseFailureAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          emailMessageId: '<bad-parse@bca.co.id>',
        })
      );
    });
  });
});
