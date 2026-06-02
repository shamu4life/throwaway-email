# 💩 ShitPost.email

Disposable email addresses built on Cloudflare Workers. Spin up a throwaway inbox or permanent-ish mail redirect in seconds — no account, no logs, no drama.

Zero dependencies. Single file. Paste it into the Cloudflare dashboard and you're done.

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

## Self-hosting

### Prerequisites

- A Cloudflare account (free tier works)
- A domain pointed at Cloudflare with Email Routing enabled
- `wrangler` CLI: `npm install -g wrangler`

### 1. Clone and configure

```bash
git clone https://github.com/shamu4life/throwaway-email
cd throwaway-email
```

Edit the top of `worker.js` and set your domains:

```js
const ALLOWED_DOMAINS = ['yourdomain.com', 'anotherdomain.com'];
```

The first entry is the default shown in the UI.

### 2. Create a KV namespace

```bash
wrangler kv:namespace create KV
```

Copy the namespace ID into `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "your-namespace-id-here"
```

### 3. Set up Email Routing

In the Cloudflare dashboard, go to **Email Routing** for each domain and add a catch-all route:

- **Action**: Send to Worker
- **Destination**: your Worker name

This pipes all inbound mail into the `email` handler in `worker.js`.

### 4. Deploy

```bash
wrangler deploy
```

That's it.

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

## API

All endpoints live under `/api/`. The UI uses them directly; you can too.

### `POST /api/create`

Create a new inbox or redirect.

```json
{
  "username": "shitlord69",
  "domain": "shitpost.email",
  "target": "you@real.email",  // omit for an inbox
  "ttl": 86400                 // seconds; validated server-side
}
```

Returns:

```json
{
  "email": "shitlord69@shitpost.email",
  "token": "abc123...",        // null for redirects
  "type": "inbox",             // or "redirect"
  "expires": 1234567890        // unix timestamp
}
```

### `GET /api/inbox?email=...&token=...`

Fetch messages for an inbox. Returns up to 50 messages newest-first.

### `DELETE /api/inbox?email=...&token=...`

Permanently delete an inbox and all its messages.

---

## Caveats

- **Nothing is encrypted.** Emails sit in Cloudflare KV as plain text. Use this for throwaway signups and OTP codes, not anything sensitive.
- **Session-scoped access.** The token is kept in memory. Close the tab and you lose inbox access permanently — no recovery.
- **5 MB per email.** Larger messages are rejected at the edge before they hit KV.
- **No uptime guarantee.** This is a Cloudflare Worker. It'll probably be fine. Probably.

---

## License

MIT. Do whatever you want. We're not your parents.
