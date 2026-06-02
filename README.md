<div align="center">

<img src="logo.svg" alt="ShitPost.email" width="600">

<br><br>

[![License: MIT](https://img.shields.io/badge/License-MIT-db2777.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Deployed_on-Cloudflare_Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-22c55e.svg)]()

</div>

---

Disposable email addresses built on Cloudflare Workers. Spin up a throwaway inbox or mail redirect in seconds — no account, no logs, no drama.

Zero dependencies. Single file. Paste it into the Cloudflare dashboard and you're done.

---

## Screenshots

| Home | Inbox |
|---|---|
| ![Home](.github/screenshots/home.png) | ![Inbox](.github/screenshots/inbox.png) |

---

## What it does

- **Temp inboxes** — pick a username and domain, get a real working inbox. Emails land instantly, the whole thing self-destructs after 1–48 hours (your choice).
- **Mail redirects** — forward everything sent to your throwaway address to a real inbox. Active for 1–6 months.
- **Web UI** — fully functional SPA served from the same Worker. Dark/light theme, auto-refresh inbox, copy-to-clipboard, the works.
- **No account required** — access is token-based and session-scoped. Close the tab and it's gone, which is kind of the point.

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Cloudflare Workers |
| Storage | Cloudflare KV |
| Email ingestion | Cloudflare Email Routing |
| Dependencies | None |

Everything lives in `worker.js`. No bundler, no build step, no `node_modules` folder silently judging you.

---

## Configuration

All tuneable constants are at the top of `worker.js`:

```js
const ALLOWED_DOMAINS  = ['shitpost.email', ...]; // domains shown in the UI
const INBOX_TTL        = 86400;                    // default inbox TTL (seconds) — 24h
const REDIRECT_TTL     = 2592000;                  // default redirect TTL — 30 days
const MAX_MESSAGES     = 50;                       // max emails stored per inbox
const MAX_EMAIL_BYTES  = 5 * 1024 * 1024;          // 5 MB per email hard limit
```

Users can override TTL at creation time within these bounds:
- **Inbox**: 1–48 hours
- **Redirect**: 1–6 months

---

## Caveats

- **Nothing is encrypted.** Emails sit in Cloudflare KV as plain text. Use this for throwaway signups and OTP codes, not anything sensitive.
- **Session-scoped access.** The token is kept in memory. Close the tab and you lose inbox access permanently — no recovery.
- **5 MB per email.** Larger messages are rejected at the edge before they hit KV.
- **No uptime guarantee.** This is a Cloudflare Worker. It'll probably be fine. Probably.

---

## Screenshots

> Drop screenshots into `.github/screenshots/` and update these paths.

| Home | Inbox | Message |
|---|---|---|
| ![Home](.github/screenshots/home.png) | ![Inbox](.github/screenshots/inbox.png) | ![Message](.github/screenshots/message.png) |

---

## License

MIT. Do whatever you want. We're not your parents.
