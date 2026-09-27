'use strict';

const { Router } = require('express');
const authMiddleware = require('../middlewares/auth.middleware');

const authController = require('../controllers/auth.controller');
const pollController = require('../controllers/poll.controller');
const transactionController = require('../controllers/transaction.controller');
const categoryController = require('../controllers/category.controller');
const budgetController = require('../controllers/budget.controller');
const alertController = require('../controllers/alert.controller');
const notificationController = require('../controllers/notification.controller');

const router = Router();

// --- Public routes ---
router.post('/auth/login', ...authController.login);

// --- Protected routes (JWT required) ---
router.use(authMiddleware);

// Manual poll trigger
router.post('/poll', pollController.trigger);

// Transactions
router.get('/transactions', transactionController.list);
router.post('/transactions', ...transactionController.create);
router.get('/transactions/recent', transactionController.recent);
router.post('/transactions/ai-categorize-all', transactionController.aiCategorizeAll);
router.post('/transactions/:id/ai-categorize', transactionController.aiCategorize);
router.get('/transactions/:id', transactionController.getById);
router.patch('/transactions/:id', ...transactionController.update);
router.delete('/transactions/:id', transactionController.delete);

// Categories
router.get('/categories', categoryController.list);
router.post('/categories', ...categoryController.create);
router.patch('/categories/:id', ...categoryController.update);
router.delete('/categories/:id', categoryController.delete);

// Merchant rules
router.get('/merchant-rules', categoryController.listRules);
router.post('/merchant-rules', ...categoryController.createRule);
router.delete('/merchant-rules/:id', categoryController.deleteRule);

// Budget & Analytics
router.get('/budget/chart', budgetController.getChart);
router.get('/budget/daily-chart', budgetController.getDailyChart);
router.get('/budget/spending-summary', budgetController.getSpendingSummary);
router.get('/budget/daily-summary', budgetController.getDailySummary);
router.get('/budget/category-breakdown', budgetController.getCategoryBreakdown);
router.get('/budget/ai-summary', budgetController.getAiSummary);
router.post('/budget/ai-advisor/chat', budgetController.chatWithAiAdvisor);
router.get('/budget', budgetController.getSummary);

// Notifications (ntfy.sh)
router.post('/notifications/test', notificationController.test);
router.get('/notifications/config', notificationController.getConfig);

// Alerts
router.get('/alerts/count', alertController.count);      // lightweight — widget badge
router.get('/alerts', alertController.list);
router.patch('/alerts/:id/resolve', alertController.resolve);
router.post('/alerts/resolve-all', alertController.resolveAll);

module.exports = router;
