'use strict';

const alertService = require('../services/alert.service');

/**
 * Alert Controller — HTTP handlers for alert endpoints.
 *
 * Style: ES6 named exports (exports.fn = async (req, res, next) => {})
 */

/**
 * GET /api/alerts
 * Returns all unresolved alerts with total count.
 *
 * Response: { data: AlertRow[], count: number }
 */
exports.list = async (req, res, next) => {
  try {
    const data = await alertService.getUnresolved();
    return res.status(200).json({ data, count: data.length });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/alerts/count
 * Returns only the count of unresolved alerts — used by the iOS widget to show the badge
 * without fetching the full alert list.
 *
 * Response: { count: number }
 */
exports.count = async (req, res, next) => {
  try {
    const count = await alertService.getUnresolvedCount();
    return res.status(200).json({ count });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/alerts/:id/resolve
 * Marks a single alert as resolved.
 *
 * Response: the updated alert row
 */
exports.resolve = async (req, res, next) => {
  try {
    const alert = await alertService.resolveAlert(req.params.id);
    return res.status(200).json(alert);
  } catch (err) {
    next(err);
  }
};

/**
 * POST /api/alerts/resolve-all
 * Marks every currently-unresolved alert as resolved in a single query.
 * Called by the mobile "Tandai Semua Selesai" button.
 *
 * Response: { resolved: number }
 */
exports.resolveAll = async (req, res, next) => {
  try {
    const count = await alertService.resolveAll();
    return res.status(200).json({ resolved: count });
  } catch (err) {
    next(err);
  }
};
