<div align="center">

<img src=".github/social-preview.svg#gh-dark-mode-only"       alt="ShitPost.email — Disposable email, no bullshit" width="720">
<img src=".github/social-preview-light.svg#gh-light-mode-only" alt="ShitPost.email — Disposable email, no bullshit" width="720">

[![License: MIT](https://img.shields.io/badge/License-MIT-db2777.svg)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/shamu4life/throwaway-email/ci.yml?branch=main&label=CI&color=db2777)](../../actions/workflows/ci.yml)
[![Version](https://img.shields.io/badge/version-1.4.0-db2777.svg)](docs/CHANGELOG.md)
[![Cloudflare Workers](https://img.shields.io/badge/Deployed_on-Cloudflare_Workers-f38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-22c55e.svg)]()

</div>

<p align="center"><strong>Disposable email addresses on Cloudflare Workers.</strong> Spin up a throwaway inbox or mail redirect in seconds — no account, no tracking, no drama.</p>

---

ShitPost.email is a single-file Cloudflare Worker that gives you real, working email addresses you can throw away. Pick a username and a domain, and you get either a self-destructing inbox or a redirect to your real address. The whole thing — API, storage, and web UI — lives in one `worker.js` with **zero dependencies and no build step**.

---

## Get Started

**[shitpost.email](https://shitpost.email)** — open it in any browser, pick a username, hit create. No sign-up, nothing to install.

## Why?

You need an email address for a one-time signup, an OTP code, or a sketchy download link, and you'd rather not hand over your real one. Most disposable-mail services are ad-riddled, slow, or want you to make an account — which rather defeats the purpose. ShitPost.email is the opposite:

- **Instant** — type a username, get a working address, watch mail land in real time
- **Accountless** — access is a session-scoped token held in memory; close the tab and it's gone
- **Self-destructing** — inboxes expire after 1–48 hours, redirects after 1–6 months; nothing lingers
- **Tiny** — one Worker, no `node_modules`, no bundler, no database server

---

## Screenshots

| Home | Inbox |
|---|---|
| <img alt="Home — pick a username and domain, choose inbox or redirect" src=".github/screenshots/home.png#gh-dark-mode-only"><img alt="Home — pick a username and domain, choose inbox or redirect" src=".github/screenshots/home-light.png#gh-light-mode-only"> | <img alt="Inbox — messages land in real time with a live countdown" src=".github/screenshots/inbox.png#gh-dark-mode-only"><img alt="Inbox — messages land in real time with a live countdown" src=".github/screenshots/inbox-light.png#gh-light-mode-only"> |

<sub>Screenshots swap automatically with your GitHub light/dark theme.</sub>

---

## Features

<details>
<summary><strong>Temporary Inboxes</strong></summary>

Pick a username and a domain and you get a real, working inbox. Mail addressed to it is parsed at the edge and stored in Cloudflare KV; the web UI polls every 30 seconds and shows new messages as they arrive, with subject, sender, plain-text body, and an optional rendered-HTML view. The inbox self-destructs after a TTL you choose at creation (**1 to 48 hours**), and only the most recent **50** messages are kept.

</details>

<details>
<summary><strong>Mail Redirects</strong></summary>

Instead of an inbox, point a throwaway address at a real one. Everything sent to `you@shitpost.email` is re-sent to your real inbox — nothing is stored. Forwarding works to **any** address (no verification dance): the mail arrives from `forward@shitpost.email` with the original sender in **Reply-To**, so just hit reply to write back. Attachments aren't forwarded. Redirects stay active for a window you choose (**1 to 6 months**) and then expire automatically.

</details>

<details>
<summary><strong>Web UI</strong></summary>

A fully functional single-page app served from the same Worker — no separate frontend, no framework, just hand-rolled vanilla JS and CSS embedded in `worker.js`. Dark and light themes (follows your OS by default, with a manual toggle persisted in `localStorage`), a live auto-refreshing inbox with countdown, copy-to-clipboard for your address, and one-tap message delete. The header links to the source on GitHub and a quick **Report a bug** form, and there's a self-hosted Buy Me a Coffee widget (a floating button that expands to a support popover) — built from scratch, so no third-party scripts load on the page.

</details>

<details>
<summary><strong>No Account, Session-Scoped Access</strong></summary>

Creating an inbox returns a random token that the UI keeps **in memory only**. There is no login, no password, no recovery flow — the token is your one and only key, and closing the tab discards it permanently. That's a feature: there's nothing to leak, nothing to subpoena, nothing to forget to delete.

</details>

---

## Caveats

This is a throwaway-mail toy, not a secure mailbox. Know what you're getting:

- **Nothing is encrypted.** Emails sit in Cloudflare KV as plain text. Use this for junk signups and OTP codes, **not** anything sensitive.
- **Access is session-scoped and unrecoverable.** The token lives in memory. Close the tab and you lose the inbox forever — no reset, no recovery.
- **5 MB per email.** Larger messages are rejected at the edge before they ever hit KV.
- **Redirects re-mail, they don't relay.** Forwarded mail arrives from `forward@shitpost.email` (reply still reaches the real sender), **attachments are dropped**, and sending is subject to your provider's send limits.
- **No uptime guarantee.** It's a Cloudflare Worker. It'll probably be fine. Probably.

---

## How It Works

<details>
<summary><strong>Architecture</strong></summary>

Everything is one Worker exporting two handlers:

- **`fetch`** — serves the web UI on every non-API route and dispatches `/api/*` requests to the JSON API. CORS is wide open (`Access-Control-Allow-Origin: *`).
- **`email`** — Cloudflare Email Routing invokes this for every inbound message. It looks up the destination address in KV: `redirect` records are parsed and re-mailed to the target via Cloudflare Email Service (with Resend as an automatic fallback), so they reach any address with no verification needed; `inbox` records have their raw MIME streamed (capped at 5 MB), parsed in-Worker, and prepended to the message list in KV.

There is no separate database, queue, or backend — **Cloudflare KV is the only persistence layer**, and the inline MIME parser means no mail-parsing dependency.

### KV key schema

| Key | Value | TTL |
|---|---|---|
| `addr:<email>` | `{ type, target?, token?, created, expires }` — the address record (`inbox` or `redirect`) | matches the chosen expiry |
| `msgs:<email>` | array of parsed messages, newest first, capped at 50 | matches the inbox's remaining lifetime |

Both keys carry a KV `expirationTtl`, so expiry is enforced by KV itself — there's no cron sweep to maintain.

### HTTP API

| Method & path | Purpose |
|---|---|
| `POST /api/create` | Create an inbox or redirect. Body: `{ username, domain, target?, ttl? }`. A non-empty `target` makes it a redirect; otherwise it's an inbox. Returns `{ email, token, type, expires }`. |
| `GET /api/inbox?email=&token=` | Fetch messages for an inbox. Token-gated. Returns `{ email, messages, expires, count }`. |
| `DELETE /api/inbox?email=&token=` | Destroy an inbox and all its messages. Token-gated. |

</details>

<details>
<summary><strong>Tech Stack &amp; Project Structure</strong></summary>

| Layer | Technology |
|---|---|
| Runtime | Cloudflare Workers |
| Storage | Cloudflare KV |
| Email ingestion | Cloudflare Email Routing |
| Redirect forwarding | Cloudflare Email Service (primary) · Resend API (fallback) |
| Web UI | Hand-rolled vanilla JS + CSS (no framework) |
| Dependencies | None (Wrangler is the only dev dependency) |

```
throwaway-email/
├── worker.js               # The entire app: MIME parser, email handler, JSON API, and embedded SPA
├── wrangler.toml           # Cloudflare Workers config: KV binding, routes, observability
├── package.json            # Version source of truth; dev/deploy/test scripts (Wrangler + Node test runner)
├── test/
│   └── parse.test.js       # Unit tests for the MIME parser (node:test, zero deps)
├── docs/
│   └── CHANGELOG.md        # Version history (Keep a Changelog)
└── .github/
    ├── social-preview.svg       # 1280×640 social card (dark) — README header + repo Social Preview
    ├── social-preview-light.svg # 1280×640 social card (light)
    ├── social-preview.png       # Rasterized 1280×640 card for the GitHub Social Preview upload
    ├── logo.svg                 # Compact wordmark brand asset
    ├── screenshots/             # home/inbox .png (dark) + -light variants — theme-swapped in the README
    ├── CONTRIBUTING.md          # Setup, deploy, workflow, and conventions
    ├── PULL_REQUEST_TEMPLATE.md
    ├── ISSUE_TEMPLATE/          # Bug report + feature request forms
    └── workflows/
        └── ci.yml               # Syntax check + unit tests + `wrangler deploy --dry-run`
```

Everything that runs in production lives in `worker.js`. No bundler, no build step, no `node_modules` folder silently judging you.

</details>

---

## Self-Hosting

Want your own throwaway-mail domain? See **[CONTRIBUTING.md](.github/CONTRIBUTING.md)** for the full setup — creating the KV namespace, wiring up Cloudflare Email Routing, enabling Cloudflare Email Service (with an optional Resend fallback) for redirects, and pointing your own domains at the Worker. The short version:

```bash
git clone https://github.com/shamu4life/throwaway-email.git
cd throwaway-email
npm install
npm run dev        # local Worker at http://localhost:8787
npm test           # run the MIME-parser unit tests
npm run deploy     # ship it to Cloudflare
```

> The 1280×640 `social-preview.png` is wired up as this repo's GitHub **Social Preview** (Settings → General → Social preview), so links unfurl with the card above.

---

## Contributing

Issues and pull requests are welcome. See **[CONTRIBUTING.md](.github/CONTRIBUTING.md)** for setup, the (lightweight) versioning and changelog conventions, and the house rules — chief among them: **keep it dependency-free and single-file.**

---

## License

MIT. Do whatever you want. We're not your parents. Contributions are accepted under the same [MIT License](LICENSE).
