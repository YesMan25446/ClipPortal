# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Commands
- Install dependencies:
  - npm install
  - npm ci (uses package-lock.json for a clean install)
- Development server (auto-restart):
  - npm run dev
- Start server:
  - npm start
- Health check (should return JSON ok):
  - curl http://localhost:3000/health
- Database migration (import legacy users.json into encrypted storage):
  - node migrate-database.js
- Backups and restore:
  - node backup-system.js create "my-backup"
  - node backup-system.js list
  - node backup-system.js restore <filename>
  - node backup-system.js export
  - node backup-system.js start  # runs scheduled daily backups
- Docker:
  - docker build -t clip-portal .
  - docker run --rm -p 3000:3000 clip-portal

Build, lint, and tests
- Build: Not applicable (Node/Express app, no bundler)
- Lint: Not configured
- Tests: Not configured (no single-test command)

Architecture and structure
- Runtime stack
  - Node.js 18+ (project pins 20 via .nvmrc)
  - Express server in server.js serves static front-end (HTML/CSS/JS) and a JSON API under /api/*
- Data and storage
  - Clips and stats persisted in data/clips.json; uploaded videos in uploads/; generated thumbnails in thumbnails/
  - Media processing via fluent-ffmpeg + ffmpeg-static/ffprobe-static: verifies max duration (30s), generates 400x225 thumbnails, enforces 100MB upload limit via multer
- Users, auth, and security
  - Current runtime uses database-simple.js: JSON-backed store with symmetric encryption for sensitive fields; JWT auth (httpOnly cookie auth), optional email verification (via nodemailer if SMTP set)
  - An alternative encrypted SQLite implementation exists in database.js with better-sqlite3 and a migrate-database.js script; backup-system.js integrates with the simple store and runs daily via node-cron
  - Admin features: is_admin flag; dedicated /api/admin/* endpoints; ADMIN_PASSWORD protects the admin panel login flow
- API surface (high level)
  - Auth: /api/auth/register, /login, /logout, /me, /verify, /resend-verification
  - Clips: GET /api/clips, GET /api/clips/:id, POST /api/clips (file or URL), POST /api/clips/:id/rate
  - Social: friends (request/accept), messages with another user, comments per clip
  - Admin: approve/delete clips, list/manage users
  - Health: GET /health
- Front-end
  - Static pages (e.g., index.html, submit.html, admin.html, account.html) enhanced by script.js, which calls the API, renders clips, handles auth state, ratings, comments, and admin-only UI affordances

Configuration
- Node version: .nvmrc specifies 20
- Environment variables (common):
  - PORT (default 3000), JWT_SECRET, ADMIN_PASSWORD
  - DB_ENCRYPTION_KEY (auto-generated in .env on first run if missing), EMAIL_ENC_KEY (optional per-user email encryption), SITE_BASE_URL
  - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM (optional; enable real verification emails)

Notes from README
- Two modes are described: a static demo (no backend) and the full application. This repository contains the full application server; the demo pages will not perform server operations without the backend.
