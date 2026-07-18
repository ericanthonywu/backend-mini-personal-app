'use strict';

const cheerio = require('cheerio');

/**
 * Parses a BCA Credit Card Transaction Notification HTML email body.
 *
 * BCA emails use an HTML table structure. Each row contains:
 *   <td>Field Label</td> <td>:&nbsp; or :</td> <td><span>Value</span></td>
 *
 * Fields extracted:
 *   - Merchant / ATM
 *   - Jenis Transaksi
 *   - Pada Tanggal  (format: "15-07-2026 20:28:39 WIB")
 *   - Sejumlah      (format: "Rp494.614,00" | "IDR 186.000" | "AUD 30")
 *
 * @param {string} html - Raw HTML body of the BCA email
 * @returns {{ merchant: string, transactionType: string, transactionDate: Date, amount: number, notes: string } | null}
 */
function parseBcaEmail(html) {
  if (!html) return null;

  const $ = cheerio.load(html);
  const fields = {};

  // Iterate all table rows and extract key-value pairs.
  //
  // BCA has two known HTML template layouts:
  //
  //   New template: td[0] = "Merchant / ATM"  td[2] = "SUPERINDO DMO"
  //   Old template: td[0] = "Merchant/ATM\n ... : SUPERINDO DMO"  td[2] = "Merchant/ATM"
  //
  // In the old template, td[2] just echoes the column header — the actual value is
  // embedded in td[0] after a colon. We detect this by checking whether td[2]'s text
  // (after normalization) equals the extracted label; if so, we pull the value from td[0].
  $('tr').each((_, row) => {
    const tds = $(row).find('td');
    if (tds.length < 3) return;

    const td0Raw = $(tds[0]).text();
    const valueEl = $(tds[2]);
    const td2Value = valueEl.find('span').first().text().trim() || valueEl.text().trim();

    // Normalize label: take content before any colon, collapse whitespace, normalize slashes
    const colonIdx = td0Raw.indexOf(':');
    const labelPart = colonIdx > 0 ? td0Raw.substring(0, colonIdx) : td0Raw;
    const label = labelPart.replace(/\s+/g, ' ').trim().toLowerCase().replace(/\s*\/\s*/g, '/');

    if (!label) return;

    // Determine value source:
    // If td[2] is empty or its normalized text equals the label itself (old template),
    // extract the value from td[0] after the colon instead.
    const td2Normalized = td2Value.toLowerCase().replace(/\s*\/\s*/g, '/').replace(/\s+/g, ' ').trim();
    let value;
    if (!td2Value || td2Normalized === label) {
      // Old template: value is embedded in td[0] after the colon
      if (colonIdx > 0) {
        value = td0Raw.substring(colonIdx + 1).replace(/\s+/g, ' ').trim();
      }
    } else {
      // New template: value is in td[2]
      value = td2Value;
    }

    if (value) {
      fields[label] = value;
    }
  });

  // Extract required fields.
  // Keys are normalized to lowercase with slashes stripped of surrounding spaces,
  // so "Merchant / ATM" and "Merchant/ATM" both resolve to "merchant/atm".
  const merchant = fields['merchant/atm'];
  const transactionType = fields['jenis transaksi'];
  const rawDate = fields['pada tanggal'];
  const rawAmount = fields['sejumlah'];

  // Validate all required fields are present
  if (!merchant || !rawDate || !rawAmount) {
    const missing = [];
    if (!merchant) missing.push('merchant / atm');
    if (!rawDate) missing.push('pada tanggal');
    if (!rawAmount) missing.push('sejumlah');

    console.warn(`[email-parser] ❌ Parse failed — missing fields: [${missing.join(', ')}]`);
    console.warn(`[email-parser]    Fields found: ${JSON.stringify(fields, null, 2)}`);
    console.warn(`[email-parser]    HTML snippet (first 500 chars): ${html.substring(0, 500)}`);
    return null;
  }

  const transactionDate = parseBcaDate(rawDate);
  if (!transactionDate) return null;

  const amount = parseBcaAmount(rawAmount);
  if (amount === null) return null;

  const notes = transactionType
    ? `${merchant} - ${transactionType}`
    : merchant;

  return {
    merchant: merchant.trim(),
    transactionType: (transactionType || '').trim(),
    transactionDate,
    amount,
    notes,
  };
}

/**
 * Parses BCA date string to a JavaScript Date object in WIB context.
 * Input format: "15-07-2026 20:28:39 WIB"
 * We strip the "WIB" suffix and treat it as a local WIB time.
 * The Date object is created as a plain local date — no UTC conversion.
 *
 * @param {string} rawDate
 * @returns {Date | null}
 */
function parseBcaDate(rawDate) {
  // Remove " WIB" suffix if present
  const cleaned = rawDate.replace(/\s*WIB\s*$/i, '').trim();

  // Expected format: "DD-MM-YYYY HH:mm:ss"
  const match = cleaned.match(
    /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/
  );

  if (!match) {
    console.warn(`[email-parser] Unrecognized date format: "${rawDate}"`);
    return null;
  }

  const [, day, month, year, hours, minutes, seconds] = match;

  // Construct as a WIB local time — PostgreSQL stores TIMESTAMP WITHOUT TIME ZONE as-is
  const date = new Date(
    parseInt(year, 10),
    parseInt(month, 10) - 1, // months are 0-indexed in JS
    parseInt(day, 10),
    parseInt(hours, 10),
    parseInt(minutes, 10),
    parseInt(seconds, 10)
  );

  return isNaN(date.getTime()) ? null : date;
}

/**
 * Parses BCA amount string to an integer in the transaction's currency units.
 *
 * BCA uses three distinct formats depending on transaction type:
 *
 *   1. Rp prefix — Indonesian IDR (dots=thousands, comma=decimal):
 *      "Rp494.614,00"      → 494614
 *      "Rp 1.234.567,00"   → 1234567
 *      "Rp100,50"          → 101  (rounded)
 *
 *   2. IDR prefix — BCA alternate IDR format (dots=thousands, NO decimal comma):
 *      "IDR 186.000"       → 186000
 *      "IDR 1.500.000"     → 1500000
 *
 *   3. Foreign currency — AUD, USD, SGD, EUR, etc. (dot=decimal):
 *      "AUD 30"            → 30
 *      "USD 99.99"         → 100  (rounded)
 *
 * @param {string} rawAmount
 * @returns {number | null}
 */
function parseBcaAmount(rawAmount) {
  if (!rawAmount) return null;

  const trimmed = rawAmount.trim();

  // --- Case 1: Rp prefix — Indonesian IDR format ---
  // Dots = thousand separators, comma = decimal separator
  if (/^Rp\s*/i.test(trimmed)) {
    let cleaned = trimmed.replace(/^Rp\s*/i, '');
    cleaned = cleaned.replace(/\./g, '');   // strip thousand dots
    cleaned = cleaned.replace(',', '.');     // comma → decimal dot
    const parsed = parseFloat(cleaned);
    if (isNaN(parsed)) {
      console.warn(`[email-parser] Could not parse Rp amount: "${rawAmount}"`);
      return null;
    }
    return Math.round(parsed);
  }

  // --- Case 2: IDR prefix — "IDR 186.000" style ---
  // Dots = thousand separators, whole number (no decimal part)
  if (/^IDR\s+/i.test(trimmed)) {
    let cleaned = trimmed.replace(/^IDR\s+/i, '');
    cleaned = cleaned.replace(/\./g, '');   // strip thousand dots
    const parsed = parseInt(cleaned, 10);
    if (isNaN(parsed)) {
      console.warn(`[email-parser] Could not parse IDR amount: "${rawAmount}"`);
      return null;
    }
    return parsed;
  }

  // --- Case 3: Foreign currency — AUD, USD, SGD, EUR, etc. ---
  // BCA uses comma as decimal separator for foreign currencies too.
  // e.g. "AUD 30", "AUD 87,95", "USD 99.99", "EUR 10,61"
  const foreignMatch = trimmed.match(/^([A-Z]{3})\s+([\d.,]+)$/);
  if (foreignMatch) {
    const [, currency, numStr] = foreignMatch;
    // Normalize: replace comma decimal → dot decimal
    const normalized = numStr.replace(',', '.');
    const parsed = parseFloat(normalized);
    if (isNaN(parsed)) {
      console.warn(`[email-parser] Could not parse ${currency} amount: "${rawAmount}"`);
      return null;
    }
    return Math.round(parsed);
  }

  console.warn(`[email-parser] Could not parse amount: "${rawAmount}"`);
  return null;
}

module.exports = { parseBcaEmail, parseBcaDate, parseBcaAmount };
