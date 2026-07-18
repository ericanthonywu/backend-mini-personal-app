# Expense Tracker — Backend

Personal BCA credit card expense tracker backend. Parses Gmail IMAP for BCA transaction notifications.

## Setup

1. Copy `.env.example` to `.env` and fill in values
2. Create PostgreSQL database
3. Run migrations: `npm run migrate`
4. Run seeds: `npm run seed`
5. Start: `npm run dev`

## Tech Stack

- Node.js + Express
- PostgreSQL via Knex.js
- Gmail IMAP for email polling
- node-cron for scheduling
- JWT for authentication

## Gmail Setup

1. Enable IMAP in Gmail settings
2. Create an App Password: Google Account → Security → 2FA → App Passwords
3. Use the app password in `EMAIL_PASSWORD` env var
