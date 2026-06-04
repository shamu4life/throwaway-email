# Changelog

All notable changes to ShitPost.email are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.0.1] — 2026-06-03

### Changed
- API — inbox token checks now use a constant-time comparison, closing a timing side-channel on inbox read/delete.
- API — unexpected server-side errors on the HTTP path now return a JSON `500` instead of a raw error page, so the UI can surface them cleanly.
- Email — handler and request errors are logged as structured JSON. (internal)
- Observability — enabled Workers logs/traces in `wrangler.toml` so errors are queryable. (internal)
- Updated the Workers `compatibility_date` to `2025-09-23`. (internal)

### Removed
- Removed the unused `[[send_email]]` binding from `wrangler.toml`. Redirects use `message.forward()`, which does not require it.

## [1.0.0] — 2026-06-03

### Added
- Inbox — create a self-destructing temporary inbox on any supported domain; messages are parsed at the edge and shown in a live, auto-refreshing list. Choose a lifetime of 1–48 hours; the 50 most recent messages are kept.
- Redirect — point a throwaway address at a real inbox; mail is forwarded via Cloudflare Email Routing and nothing is stored. Active for 1–6 months.
- UI — single-page web app served from the Worker, with dark/light themes, copy-to-clipboard, per-message delete, and an optional rendered-HTML view.
- API — JSON HTTP API: `POST /api/create`, `GET /api/inbox`, `DELETE /api/inbox`, token-gated for inbox access.
- Email — dependency-free inline MIME parser handling multipart messages, base64 / quoted-printable encodings, and RFC 2047 encoded words; inbound messages capped at 5 MB.
