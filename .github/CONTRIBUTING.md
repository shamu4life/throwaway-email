# Contributing to ShitPost.email

Thanks for your interest in contributing! This is a small, deliberately simple project — one Worker, no dependencies, no build step. Keep it that way and you'll fit right in.

Contributions are accepted under the project's [MIT License](../LICENSE). There is **no CLA** — by opening a pull request you agree your contribution is licensed under MIT. That's it.

---

## Getting Started

```bash
git clone https://github.com/shamu4life/throwaway-email.git
cd throwaway-email
npm install
npm run dev        # wrangler dev — local Worker at http://localhost:8787
npm run deploy     # wrangler deploy — push to Cloudflare
```

`npm install` only pulls **Wrangler** (the Cloudflare CLI) — there are no other dependencies. `worker.js` ships exactly as written; there is no bundler and no build step.

### Tests

The **pure MIME-parsing helpers** have unit tests using Node's built-in test runner — no dependency to install:

```bash
npm test         # node --test → runs test/parse.test.js
npm run check    # node --check worker.js → syntax only
```

The parser functions are exposed through a trailing `export { … }` at the bottom of `worker.js` (inert in the Worker — Cloudflare only uses the default export). When you extend the parser, export the new function and add a case to `test/parse.test.js`. Assert what the parser *actually* does, not an idealized version — e.g. quoted-printable is decoded byte-wise, not charset-aware (there's a test that pins this).

### What you can and can't test locally

- **MIME parser** — fully unit-tested via `npm test`.
- **UI and `/api/*`** — testable with `npm run dev`. Create inboxes/redirects, hit the API, click around the SPA.
- **Inbound email (`email()` handler)** — **not** testable via `wrangler dev`. Cloudflare Email Routing only fires it for real mail delivered to a configured zone. Test email-handling changes by deploying to a staging Worker on a domain you control (the parser logic underneath is covered by `npm test`).

A change is shippable when:

```bash
npm run check                       # no syntax errors
npm test                            # unit tests pass
npx wrangler deploy --dry-run       # config + Worker validate
```

all pass (CI enforces all three), and you've smoke-tested the relevant surface. Don't claim "tested" beyond what the suite covers — for `fetch`/`email`/KV changes, say it was smoke-tested and how.

---

## Self-Hosting (running your own instance)

To stand up your own throwaway-mail domain you need a Cloudflare account with at least one domain on it.

1. **Create a KV namespace** and copy its ID into `wrangler.toml` under `[[kv_namespaces]]` (binding name **`KV`** — the Worker looks for exactly that):

   ```bash
   npx wrangler kv namespace create KV
   ```

2. **Set your domains.** Edit `ALLOWED_DOMAINS` at the top of `worker.js` to the domain(s) you own. The first entry is the UI default. Update the `[[routes]]` block in `wrangler.toml` to match (`pattern` + `zone_name`).

3. **Configure Cloudflare Email Routing** on each domain (Cloudflare dashboard → your domain → Email → Email Routing). Add a **catch-all** rule that sends to this Worker so every inbound message invokes the `email()` handler. Without this, inboxes and redirects receive nothing.

4. **Set up Resend for redirects** (skip if you only want inboxes). Redirects re-mail through [Resend](https://resend.com) so they reach any address without the recipient verifying anything — Cloudflare's native `forward()` only delivers to pre-verified destinations, which is useless for a public service.

   1. Create a free Resend account and **add + verify a sending domain** (Resend shows the SPF/DKIM/DMARC DNS records — add them in your Cloudflare DNS dashboard). Verify the domain used in `FORWARD_FROM` at the top of `worker.js` (default `forward@shitpost.email`; change it to your own domain).
   2. Create a Resend **API key** and store it as a Worker secret — never in `wrangler.toml` or `worker.js`:

      ```bash
      npx wrangler secret put RESEND_API_KEY
      ```

   Without this secret, redirects bounce (`Forwarding failed`); inboxes still work. Note attachments are not forwarded, and the free Resend tier caps sending at ~100/day.

5. **Deploy:**

   ```bash
   npm run deploy
   ```

Cloudflare credentials are managed via `wrangler login`. The only secret is `RESEND_API_KEY` (above), set via `wrangler secret put` — there is no `.env` file in source.

---

## Workflow

1. Fork the repo and create a branch from `main`.
2. Make your change. Keep all production code in `worker.js`, in the section it belongs to. See [`CLAUDE.md`](../CLAUDE.md) for the full architecture and the worker.js anatomy.
3. Smoke-test: UI/API via `npm run dev`; email changes via a staging deploy.
4. Follow the **versioning**, **documentation**, and **changelog** requirements below.
5. Open a pull request with a clear description (the PR template will prompt you).

---

## House Rules

These are the non-negotiables. A PR that breaks one of them won't be merged without a very good reason:

- **Zero runtime dependencies.** No npm packages in production, no framework, no bundler. Wrangler (dev/deploy only) is the sole devDependency.
- **One file.** All production code lives in `worker.js`. Don't split it up — it must stay paste-able straight into the Cloudflare dashboard editor.
- **Always TTL your KV writes.** Never write an `addr:` or `msgs:` key without an `expirationTtl`. Expiry is the entire point of the product.
- **Validate before you store.** New `/api/create` inputs must be validated and return a clear `4xx` with a human-readable message on failure.
- **Don't add accounts or recovery.** Accountless, session-scoped, in-memory token access is the design. No logins, no password resets, no token recovery.
- **Don't store secrets in KV expecting privacy.** KV is plaintext. Don't build features that imply confidentiality the system can't deliver.
- **Match the voice.** User-facing copy (UI strings, README) is blunt and irreverent — keep new strings in that register. Keep `CLAUDE.md` / `CONTRIBUTING.md` professional.

---

## Versioning

Standard **semantic versioning** (`MAJOR.MINOR.PATCH`); the project is post-1.0.

| Change type | Increment |
|---|---|
| Breaking API change, data-dropping KV schema change, or domain removal | `MAJOR` |
| New endpoint, new UI feature, new domain, new address type, new config option users notice | `MINOR` |
| User-visible bug fix, copy/styling/accessibility fix | `PATCH` |
| Internal refactor with no visible change | `PATCH` |
| CI / docs only | no bump |

**Tiebreaker:** if a user would notice without being told, it's at least `MINOR`.

A version bump updates **all** of these in the same PR:

| File | What to change |
|---|---|
| `package.json` | `"version"` — source of truth |
| `README.md` | Version badge URL |
| `CLAUDE.md` | `**Version:**` in the Project Overview header |
| `docs/CHANGELOG.md` | New section at the top |
| `.github/screenshots/` | Recapture if the UI changed |

Commit message convention: `chore: bump to vX.Y.Z`.

---

## Documentation Requirements

Every PR that changes code updates the relevant docs in the **same PR**. Stale docs are treated as a bug. The full lookup table is in [`CLAUDE.md`](../CLAUDE.md) → Documentation Maintenance. The short version:

| What changed | Update |
|---|---|
| API endpoint added/changed | HTTP API tables in `CLAUDE.md` + `README.md`, `CHANGELOG` |
| KV key or record field | KV Key Schema table in `CLAUDE.md`, `CHANGELOG` if visible |
| Config limit (TTL, size, count) or domain | Config Constants table in `CLAUDE.md`, `README.md` if visible, `CHANGELOG` |
| Any visible UI change | Recapture screenshots, `CHANGELOG` |
| Version bump | All five files in the table above |

Screenshots (`home.png`, `inbox.png`) are captured by hand from the live UI in dark theme — there's no automated script. Recapture both when the home or inbox view changes visually.

---

## CHANGELOG Format

Add a new section at the top of [`docs/CHANGELOG.md`](../docs/CHANGELOG.md), following [Keep a Changelog](https://keepachangelog.com/):

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- Inbox — short description of a new capability, from the user's perspective

### Changed
- API — what changed and how it differs; internal-only refactors get an "(internal)" suffix

### Fixed
- UI — what was broken and what it does now
```

Rules:
- Omit empty sections.
- Write from the user's perspective: "Inbox now shows…" not "Refactored handleGetInbox to…".
- Start each bullet with the area: `Inbox — `, `Redirect — `, `UI — `, `API — `, `Email — `.
- One bullet per user-observable change.

---

## Code Conventions

The full conventions are in [`CLAUDE.md`](../CLAUDE.md). The essentials:

- **Single file, zero deps** — everything in `worker.js`, paste-able into the dashboard.
- **Section discipline** — keep new code under the matching banner comment.
- **CORS stays open** — the API is intentionally `Access-Control-Allow-Origin: *`.
- **Validate at the edge** — reject bad `/api/create` input before any KV write.
- **TTL everything** — every KV write carries an `expirationTtl`.
- **Pure, total parser functions** — MIME helpers should never throw on bad input; favor "store something" over strict correctness.
