'use strict';

const express = require('express');
const cors = require('cors');

const env = require('./config/env');
const routes = require('./routes/index');
const errorHandler = require('./middlewares/error-handler');
const { startScheduledPoller } = require('./jobs/email-poller.job');

const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json());

// --- Health check ---
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), env: env.NODE_ENV });
});

// --- API Routes ---
app.use('/api', routes);

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// --- Global error handler (must be last) ---
app.use(errorHandler);

// --- Start server ---
app.listen(env.PORT, () => {
  console.log(`[app] Server running on port ${env.PORT} (${env.NODE_ENV})`);
  console.log(`[app] Health check: http://localhost:${env.PORT}/health`);

  // Start the email polling cron job
  startScheduledPoller();
});

module.exports = app;
