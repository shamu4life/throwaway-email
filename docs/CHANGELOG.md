# Changelog

All notable changes to ShitPost.email are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.4.0] — 2026-06-04

### Changed
- UI — the Buy Me a Coffee button is now a floating **widget**: a circular, on-brand button (a custom money-mouth 💩 icon on the site's accent pink) that expands into a support popover (message + CTA). It's a self-hosted recreation of the widget experience — still no third-party scripts or external assets load on the page.

### Added
- UI — new **mascot** (a poop-in-a-love-letter) now used for the favicon and the header logo. Inlined as a data URI, so nothing external loads.
- Docs — README screenshots now ship in **light and dark variants** that swap automatically with your GitHub theme.

### Security
- CI — pinned the GitHub Actions workflow to least-privilege `permissions: contents: read`, resolving a code-scanning alert. (internal)

## [1.3.0] — 2026-06-04

### Added
- UI — header now has a **View source on GitHub** link and a **Report a bug** link (opens a pre-filled GitHub issue).
- UI — a **Buy Me a Coffee** support button (floating, bottom-right). Self-hosted HTML/CSS linking to Buy Me a Coffee — no third-party script or external asset is loaded.

### Changed
- Copy — replaced the "no logs / no logging" claim with "no tracking" (footer, home page, meta tags) to match reality, and added a disclosure note that redirects are re-sent through a third-party mail provider. The web app still loads no trackers; mail forwarding inherently passes content through a sender.

### Fixed
- Redirect — the "Forward to" field no longer rejects valid addresses whose local part contains the letter `s` (e.g. `shamu4life@gmail.com`). A regex-escaping bug in the client-side validation had been silently substituting "no letter s" for "no whitespace"; it now also correctly rejects addresses containing spaces. (Server-side validation was unaffected.)

## [1.2.0] — 2026-06-04

### Added
- Redirect — forwarding now sends through **Cloudflare Email Service** (`env.EMAIL.send()`) as the primary path, with **Resend** kept as an automatic fallback. No behavior change for users; redirected mail still arrives from `forward@shitpost.email` with the original sender in Reply-To.

### Changed
- Redirect — a redirect only bounces now if **both** providers fail (previously it depended solely on Resend). (internal)

### Notes
- Self-hosting: redirects use the `[[send_email]]` binding (`EMAIL`); sending to arbitrary recipients via Cloudflare Email Service requires the Workers **Paid** plan. `RESEND_API_KEY` is now an optional fallback. See CONTRIBUTING → Self-Hosting.

## [1.1.0] — 2026-06-04

### Changed
- Redirect — forwarding now works to **any** email address, not just Cloudflare-verified ones. Mail is re-sent through Resend, so the recipient never has to verify anything. Forwarded mail arrives from `forward@shitpost.email` with the original sender in Reply-To (hit reply and it reaches them).

### Removed
- Redirect — **attachments are no longer included** in forwarded mail (the message is rebuilt from its text/HTML). Inboxes are unaffected.

### Notes
- Self-hosting now requires a `RESEND_API_KEY` secret for redirects to work; inboxes work without it. Free Resend tier caps sending at ~100/day. See CONTRIBUTING → Self-Hosting.

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
