<div align="center">

<img src=".github/logo.svg" alt="ShitPost.email" width="600">

[![License: MIT](https://img.shields.io/badge/License-MIT-db2777.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Deployed_on-Cloudflare_Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-22c55e.svg)]()

</div>

---

Disposable email addresses built on Cloudflare Workers. Spin up a throwaway inbox or mail redirect in seconds — no account, no logs, no drama.

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

## Caveats

- **Nothing is encrypted.** Emails sit in Cloudflare KV as plain text. Use this for throwaway signups and OTP codes, not anything sensitive.
- **Session-scoped access.** The token is kept in memory. Close the tab and you lose inbox access permanently — no recovery.
- **5 MB per email.** Larger messages are rejected at the edge before they hit KV.
- **No uptime guarantee.** This is a Cloudflare Worker. It'll probably be fine. Probably.

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

## License

MIT. Do whatever you want. We're not your parents.
