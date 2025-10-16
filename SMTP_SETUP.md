# SMTP setup for magic links

What I need from you
- SMTP_HOST: your SMTP server hostname (e.g., smtp.sendgrid.net, smtp.mailgun.org, smtp.gmail.com)
- SMTP_PORT: 587 (STARTTLS) or 465 (SSL)
- SMTP_USER: SMTP username (often an API key ID)
- SMTP_PASS: SMTP password or API key secret
- SMTP_FROM: From address (e.g., no-reply@yourdomain.com)
- SITE_BASE_URL: Your public site URL (e.g., https://clipportal.up.railway.app)
- Optional security: JWT_SECRET (random string), EMAIL_ENC_KEY (32-byte hex; see .env.example)

How to configure on Railway
1) Open your service -> Variables -> Add variables for all the above keys.
2) Redeploy. The server will use Nodemailer automatically when these are present.

Local development (optional)
- Duplicate .env.example to .env and fill values. We load .env automatically in development.

Testing email delivery
- Register a new account or POST /api/auth/request-magic-link with { email, redirectTo }.
- Check your inbox; if misconfigured, the server will log an error and still print the magic link URL in the logs.

Notes
- Use a verified domain and sender with your email provider to avoid spam.
- For port 465, messages are sent over implicit TLS; for 587, STARTTLS is used.
- Do not commit real secrets; only use .env locally. Railway stores vars securely.