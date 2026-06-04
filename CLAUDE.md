# ShitPost.email — AI Assistant Guide

## Project Overview

ShitPost.email (repo: `throwaway-email`) is a disposable email service built as a single Cloudflare Worker. Users pick a username and domain and get either a self-destructing **inbox** (mail parsed and stored in KV) or a **redirect** (mail forwarded to a real address). The API, the persistence layer, and the entire web UI all live in one file with **zero runtime dependencies and no build step**.

**Stack:** Cloudflare Workers + Cloudflare KV + Cloudflare Email Routing
**UI:** Hand-rolled vanilla JS + CSS, embedded as a template string in `worker.js` (no framework, no bundler)
**Deploy:** `wrangler deploy`
**Version:** 1.4.0

The single most important constraint: **everything stays in `worker.js`, dependency-free, paste-able straight into the Cloudflare dashboard editor.** Do not introduce a bundler, a framework, an npm runtime dependency, or a second source file without explicit agreement.

---

## Repository Structure

```
throwaway-email/
├── README.md               # Product intro, screenshots, caveats, architecture overview
├── worker.js               # THE ENTIRE APP (see "worker.js Anatomy" below)
├── wrangler.toml           # Cloudflare Workers config: KV binding, route, send_email (EMAIL) binding, observability, compatibility flags
├── package.json            # Version source of truth; "type":"module"; dev/deploy/check/test scripts; Wrangler is the only devDependency (tests use the built-in node:test)
├── test/
│   └── parse.test.js       # Unit tests for the pure MIME-parsing helpers (node:test + node:assert, zero deps)
├── docs/
│   └── CHANGELOG.md        # Version history (Keep a Changelog format)
└── .github/
    ├── social-preview.svg       # 1280×640 social card (dark) — README header + repo Social Preview
    ├── social-preview-light.svg # 1280×640 social card (light) — README header light variant
    ├── social-preview.png       # Rasterized 1280×640 card; uploaded as the repo's GitHub Social Preview
    ├── logo.svg                 # Compact wordmark brand asset
    ├── screenshots/
    │   ├── home.png             # Home view — captured by hand from the live UI
    │   └── inbox.png            # Inbox view — captured by hand from the live UI
    ├── CONTRIBUTING.md          # Setup, self-hosting/deploy, workflow, versioning, conventions
    ├── PULL_REQUEST_TEMPLATE.md
    ├── ISSUE_TEMPLATE/
    │   ├── bug_report.yml
    │   ├── feature_request.yml
    │   └── config.yml
    └── workflows/
        └── ci.yml               # CI: `node --check` + `npm test` + `wrangler deploy --dry-run`
```

### worker.js Anatomy

`worker.js` is organized top-to-bottom into clearly commented sections. When editing, keep new code in the section it belongs to.

| Section | Lines (approx) | What it is |
|---|---|---|
| **Config constants** | top | `ALLOWED_DOMAINS`, `INBOX_TTL` (24 h), `REDIRECT_TTL` (30 d), `MAX_MESSAGES` (50), `MAX_EMAIL_BYTES` (5 MB), `FORWARD_FROM`, `REPO_URL`, `BMC_URL`, `MASCOT` |
| **Inline MIME parser** | `parseEmail` → `decodeRfc2047` | Dependency-free email parsing: header folding, multipart boundary recursion (depth-capped at 4), base64/quoted-printable decoding, RFC 2047 encoded-word decoding, From-address parsing |
| **Email event handling** | `handleEmailEvent`, `streamToArrayBuffer`, `forwardDisplayName`, `buildCloudflareMessage`, `buildForwardPayload`, `forwardMessage` | The `email()` handler's core: KV address lookup → re-mail (redirect) or parse-and-store (inbox); streams raw MIME with a hard 5 MB cap. `forwardMessage` sends via Cloudflare Email Service then falls back to Resend; `buildCloudflareMessage` / `buildForwardPayload` are pure, unit-tested builders for each provider's send shape |
| **API handlers** | `handleAPI`, `handleCreate`, `handleGetInbox`, `handleDeleteInbox` | The JSON HTTP API behind `/api/*` |
| **UI** | `serveUI`, `buildHTML` | Returns the full SPA as one HTML string; `buildHTML` interpolates the current domain and the `ALLOWED_DOMAINS` list. Contains all CSS and the vanilla-JS `App` module |
| **Helpers** | `json` | `json(data, status)` — JSON Response with CORS headers |
| **Exports** | `export default { fetch, email }` | The two Worker handlers |
| **Test exports** | trailing `export { … }` | Named exports of the pure parser helpers (plus `buildForwardPayload` and `buildCloudflareMessage`) for `test/parse.test.js`. **Inert in the Worker** (Cloudflare only uses the default export) and keep the file paste-able. Add a function here if you write a unit test for it. |

---

## Development Workflow

### Local Dev

```bash
npm install
npm run dev        # wrangler dev — local Worker at http://localhost:8787
npm run deploy     # wrangler deploy — push to Cloudflare
```

`wrangler dev` serves the UI and API. The inbound `email()` handler **cannot be exercised locally** — Email Routing only fires it for real mail delivered to a configured zone. To test inbound parsing changes, deploy to a staging Worker (or unit-test the parser functions in isolation) rather than relying on `wrangler dev`.

### Build & Test

There is **no build step** — `worker.js` is shipped as-is.

Tests cover the **pure MIME-parsing helpers** — the riskiest, most logic-heavy part of the Worker and the only part that can run without Cloudflare. They use Node's built-in test runner (`node:test` + `node:assert`), so they add **no dependency**:

```bash
npm run check    # node --check worker.js — syntax only
npm test         # node --test — runs test/parse.test.js
```

The parser functions are exposed via a trailing `export { … }` in `worker.js` (inert in the Worker runtime). `package.json` sets `"type": "module"` so Node loads `worker.js` as ESM, matching the Worker.

The bar for a change being shippable:

1. `npm run check` passes (no syntax errors) — CI enforces this.
2. `npm test` passes — CI enforces this.
3. `npx wrangler deploy --dry-run` succeeds (config + Worker validate) — CI enforces this.
4. The change was smoke-tested against `wrangler dev` (UI/API changes) or a staging deploy (email changes — the `email()` handler does not fire under `wrangler dev`).

**What is and isn't covered:** the parser is unit-tested. The `fetch`/`email` handlers, KV access, validation flow, and Email Routing behaviour are **not** — those need a real Worker. When you change those, smoke-test and say how; don't claim "tested" beyond what the suite covers. If you add testable pure logic, export it and add a case to `test/parse.test.js`.

### Deploy

```bash
npm run deploy
```

Deployment uses `wrangler.toml`. Cloudflare account credentials are managed via `wrangler login`. The KV namespace ID and email routing must already exist in the target account (see CONTRIBUTING.md → Self-Hosting).

### Pull Requests

When opening a PR via the GitHub API or MCP tools (not the web UI, where the template auto-populates), **write the PR body to match `.github/PULL_REQUEST_TEMPLATE.md`**: fill in the Summary, check the correct Type of change, and work through every Checklist item (check it, or check it and append `— N/A` when it genuinely doesn't apply). There is **no CLA** — this project is MIT and contributions are accepted under MIT.

---

## Versioning

This project follows **semantic versioning** (`MAJOR.MINOR.PATCH`) and is **post-1.0**, so standard semver applies.

| Change type | Increment |
|---|---|
| Breaking API change, KV schema change that drops existing data, or domain removal | `MAJOR` |
| New user-visible capability (new API endpoint, new UI feature, new domain, new address type) | `MINOR` |
| New config option or non-breaking behavior change users would notice | `MINOR` |
| Bug fix visible to users | `PATCH` |
| Accessibility / copy / styling fix | `PATCH` |
| Internal refactor with no visible change | `PATCH` |
| CI / workflow config change only | no bump |
| Documentation-only change (`CLAUDE.md`, `README.md`, `CONTRIBUTING.md`) | no bump |

**Tiebreaker:** if a user would notice the change without being told, it's at least `MINOR`.

The canonical version source is `package.json` → `"version"`. Because the version is not read at runtime by `worker.js`, keeping the badge and changelog in sync is a manual step (below).

### Release checklist

Every version bump must update all of the following in the **same commit or PR**:

| File | What to change |
|---|---|
| `package.json` | `"version"` field — **source of truth** |
| `README.md` | Version badge: `https://img.shields.io/badge/version-{X.Y.Z}-db2777.svg` |
| `CLAUDE.md` | `**Version:**` in the Project Overview header |
| `docs/CHANGELOG.md` | New `## [{X.Y.Z}] — {YYYY-MM-DD}` section at the top |
| `.github/screenshots/` | Recapture if the UI changed (see Documentation Maintenance) |

Then, **once the version-bump PR is merged**, cut a matching GitHub release so the repo's Releases sidebar stays in sync (one release per version, tag `vX.Y.Z` on the merge commit, notes from that version's CHANGELOG section, newest marked Latest):

```bash
gh release create vX.Y.Z --target <merge-commit-sha> --title vX.Y.Z --notes-file <changelog-section> --latest
```

The `compatibility_date` in `wrangler.toml` is **not** part of a version bump — change it only when intentionally upgrading the Workers runtime.

### CHANGELOG entry format

Follow [Keep a Changelog](https://keepachangelog.com/) — add a new section at the very top of `docs/CHANGELOG.md`:

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Added
- Short description of a new capability, from the user's perspective

### Changed
- What changed and how it differs; internal-only refactors get an "(internal)" suffix

### Fixed
- What was broken and what it does now

### Removed
- What was removed
```

Rules:
- Omit sections with no entries.
- Write from the user's perspective: "Inbox now shows…" not "Refactored handleGetInbox to…".
- Start bullets with the area for scannability: `Inbox — `, `Redirect — `, `UI — `, `API — `, `Email — `.
- One bullet per user-observable change.

---

## Documentation Maintenance

Every PR that changes code must update relevant documentation in the **same commit or PR**. Stale docs are treated as a bug.

| What changed | `CLAUDE.md` | `README.md` | `docs/CHANGELOG.md` | Screenshots |
|---|---|---|---|---|
| New / changed API endpoint | Update HTTP API table + worker.js Anatomy | Update API table in How It Works | ✓ | — |
| New / changed KV key or record shape | Update KV Key Schema table | Update KV schema table in How It Works | ✓ if user-visible | — |
| New config constant or changed limit (TTL, size, count) | Update Config Constants table | Update Caveats / Features if user-visible | ✓ if user-visible | — |
| New domain added/removed in `ALLOWED_DOMAINS` | — | Mention if relevant | ✓ | ✓ if it changes the domain dropdown |
| New worker.js section or major function | Update worker.js Anatomy table | — | ✓ if user-visible | — |
| MIME-parser logic change | Note any contract change (e.g. Known Issues) | — | — | add/adjust `test/parse.test.js` |
| Any visible UI change (layout, text, color, new control) | — | — | ✓ if user-visible | ✓ recapture |
| Version bump | Update `**Version:**` header | Update version badge | Add new section | ✓ if UI changed |

### Screenshots

`.github/screenshots/` holds four shots: `home.png` / `inbox.png` (dark) and `home-light.png` / `inbox-light.png` (light). The README pairs them with `#gh-dark-mode-only` / `#gh-light-mode-only` so they swap with the reader's GitHub theme. Recapture **all four** when the home or inbox view changes visually — layout, controls, colors, or copy.

Capture at **1280×800** to match the existing shots. There's no committed script, but they regenerate cleanly by driving the local UI with a headless browser — run `wrangler dev`, then a one-off `puppeteer-core` (system Chrome via `executablePath`) script: set `page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' | 'light' }])` for each theme, screenshot the home view, then create an inbox and intercept `GET /api/inbox` with sample messages for the inbox view (the `email()` handler can't run locally). Do not hand-edit the PNGs.

### Social preview card

`.github/social-preview.svg` (dark) and `social-preview-light.svg` (light) are the 1280×640 cards shown in the README header (via `#gh-dark-mode-only` / `#gh-light-mode-only`). `social-preview.png` is the rasterized dark card uploaded under **Settings → General → Social preview** so links unfurl correctly (GitHub's social-preview upload requires a raster image, not SVG).

When the wordmark, tagline, brand color, or icon changes, edit the SVGs and re-rasterize the PNG. There's no committed build script; rasterize with a one-off headless-Chromium render at the SVG's native 1280×640, e.g.:

```js
// node raster.mjs  (Playwright must be available)
import pw from 'playwright';
import { readFileSync } from 'node:fs';
const svg = readFileSync('.github/social-preview.svg', 'utf8');
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 1 });
await p.setContent(`<body style="margin:0">${svg}</body>`, { waitUntil: 'networkidle' });
await p.locator('svg').screenshot({ path: '.github/social-preview.png' });
await b.close();
```

### Keeping CLAUDE.md accurate

CLAUDE.md documents the *current state* of the code — it must stay accurate, not just accumulate additions:

- **Adding** an API endpoint, KV key, config constant, or worker.js section: add it to the relevant table above.
- **Removing** something: delete its entry — do not leave stale references.
- **Renaming** a function or changing a signature/limit: update every mention, including the Anatomy and schema tables.
- **Changing a convention** (the zero-dep rule, the single-file rule, the CORS policy): update the relevant section here.

---

## Architecture Reference

### Config Constants

Defined at the top of `worker.js`. Changing any of these is a user-visible behavior change — bump the version and update the docs.

| Constant | Value | Meaning |
|---|---|---|
| `ALLOWED_DOMAINS` | array of strings | Domains offered in the UI dropdown and accepted by `/api/create`. The first entry is the default. Must be backed by real Cloudflare Email Routing on each domain's zone. |
| `INBOX_TTL` | `86400` (24 h) | Default inbox lifetime when the request omits/overrides `ttl`. Accepted override range: **3600–172800** (1–48 h). |
| `REDIRECT_TTL` | `2592000` (30 d) | Default redirect lifetime. Accepted override range: **2592000–15552000** (1–6 months). |
| `MAX_MESSAGES` | `50` | Hard cap on messages retained per inbox (oldest dropped first). |
| `MAX_EMAIL_BYTES` | `5 * 1024 * 1024` (5 MB) | Inbound messages larger than this are rejected at the edge before storage. |
| `FORWARD_FROM` | `'forward@shitpost.email'` | The `From` address redirected mail is re-sent from. Must be a domain verified for sending in Cloudflare Email Service (and in Resend, if the fallback is configured). |
| `REPO_URL` | GitHub repo URL | Target for the header "View source" link and the "Report a bug" link (`+ /issues/new?template=bug_report.yml`). |
| `BMC_URL` | Buy Me a Coffee URL | Target for the self-hosted floating "Buy me a coffee" button. |
| `MASCOT` | base64 PNG data URI | The mascot image, inlined. Used for both the favicon (`<link rel="icon">`) and the header logo (`<img class="logo-mascot">`) — no external image request. Swap this one constant to change the mascot everywhere. |

### Bindings & Secrets

| Name | Kind | Used by | Meaning |
|---|---|---|---|
| `KV` | KV namespace binding (`wrangler.toml`) | everywhere | The only persistence layer. |
| `EMAIL` | `send_email` binding (`wrangler.toml`) | `forwardMessage` | Cloudflare Email Service. **Primary** sender for redirect mail (`env.EMAIL.send()`). Sending to arbitrary recipients requires the Workers **Paid** plan. |
| `RESEND_API_KEY` | secret (`wrangler secret put`) | `forwardMessage` | Resend API key. **Optional fallback** — used only if `env.EMAIL.send()` fails. |

If **neither** `EMAIL` nor `RESEND_API_KEY` is available, redirected mail is bounced (`Forwarding failed`). Inboxes work without either. Secrets never go in `wrangler.toml` or `worker.js`.

### KV Key Schema

Cloudflare KV (binding name `KV`) is the only persistence layer. Two key families:

| Key | Value shape | TTL |
|---|---|---|
| `addr:<email>` | `{ type: 'inbox' \| 'redirect', target?: string, token?: string, created: number, expires: number }` | set to the chosen lifetime via `expirationTtl` |
| `msgs:<email>` | `Array<{ id, from, fromName, subject, text, html, date }>` — newest first, sliced to `MAX_MESSAGES` | set to the inbox's **remaining** lifetime (`expires - now`) on each write |

- `token` exists only for `inbox` records; it gates `GET`/`DELETE /api/inbox`. Redirects have no token (nothing to read).
- `target` exists only for `redirect` records — the real address mail is re-sent to (via Cloudflare Email Service, Resend fallback).
- `created` / `expires` are **seconds** since epoch.
- Expiry is enforced entirely by KV's `expirationTtl`; there is no cleanup cron.

### HTTP API

All API routes live under `/api/`, dispatched by `handleAPI`. Every response is JSON with `Access-Control-Allow-Origin: *`. `handleAPI` guards that the `KV` binding exists and returns a 500 with setup instructions if not.

| Endpoint | Body / params | Success | Notable errors |
|---|---|---|---|
| `POST /api/create` | `{ username, domain, target?, ttl? }` | `{ email, token, type, expires }` | `400` invalid JSON / missing fields / invalid domain / bad username (`^[a-zA-Z0-9._+\-]{1,64}$`) / bad redirect target; `409` address already taken |
| `GET /api/inbox` | `?email=&token=` | `{ email, messages, expires, count }` | `400` missing params; `404` not an inbox; `401` wrong token |
| `DELETE /api/inbox` | `?email=&token=` | `{ deleted: true }` | `400` missing params; `401` wrong token |

`POST /api/create` decides type by presence of a non-empty `target`: `target` set → `redirect`, otherwise → `inbox`. A token is minted only for inboxes (`crypto.randomUUID()` with dashes stripped).

### Email Event Flow (`email()` handler)

1. Lowercase + trim the destination address; look up `addr:<to>` in KV.
2. No record → `message.setReject('Unknown address')`.
3. `redirect` record → stream `message.raw` (same 5 MB cap) → `parseEmail` → `forwardMessage`: re-mail the message to `record.target` (`from` = `FORWARD_FROM`, original sender in `Reply-To`). Tries **Cloudflare Email Service** (`env.EMAIL.send()`) first, then falls back to **Resend**. Nothing is stored. Only if every available provider fails is the message rejected with `Forwarding failed` so the sender gets a bounce. **Attachments are not re-sent** — the parser extracts text/HTML only.
4. `inbox` record → stream `message.raw` through `streamToArrayBuffer` with a 5 MB cap (reject `Message exceeds 5 MB size limit` if exceeded) → `parseEmail` → prepend to `msgs:<to>` (truncating to `MAX_MESSAGES`), writing with the inbox's remaining TTL.
5. The whole handler is wrapped in try/catch; unexpected errors `console.error` and `setReject('Internal error')` so mail bounces rather than silently vanishing.

Stored message bodies are clamped: `text` to 10 000 chars, `html` to 50 000 chars.

### Web UI (`buildHTML`)

- One HTML string with inline `<style>` and a single `<script>` defining a vanilla-JS `App` IIFE module — **no framework**.
- **Theme:** dark by default; light via `prefers-color-scheme`; manual override stored in `localStorage` under `tm-theme` and applied before first paint to avoid a flash. Accent color is `#db2777` (pink).
- **Inbox polling:** auto-refreshes every `REFRESH_SECS` (30 s) with a visible countdown.
- **Session token:** the inbox token is held **in memory only** (module-scoped `_inbox`), never persisted. Closing the tab discards it — by design.
- **Header links:** two `.icon-btn` anchors — "View source on GitHub" (`REPO_URL`) and "Report a bug" (`REPO_URL` + `/issues/new?template=bug_report.yml`) — sit next to the theme toggle.
- **Buy Me a Coffee widget:** a self-hosted recreation of the BMC floating-widget UX — a circular accent-pink `.bmc-fab` button (icon is an **inlined base64 PNG data URI**, like the favicon — no external image request) that toggles a `.bmc-pop` popover (message + CTA to `BMC_URL`), wired by a tiny IIFE at the end of the script (click / click-outside / Esc; respects `prefers-reduced-motion`). **Not** the third-party BMC widget script — it's plain HTML/CSS/JS, so the page loads **no** external client-side resources. To change the icon, swap the data URI in the `.bmc-fab` `<img>`.
- `buildHTML(currentDomain)` interpolates the current request's domain (so the displayed default matches the host) and the full `ALLOWED_DOMAINS` list into the dropdown.

---

## Conventions

- **Single file, zero dependencies.** All production code stays in `worker.js`. Do not add an npm runtime dependency, a bundler, a framework, or a second source file. Wrangler (dev/deploy only) is the sole devDependency. The served page loads **no third-party client-side scripts or assets** either (the "Buy me a coffee" floating widget is a self-hosted recreation, not the BMC widget script) — keep it that way.
- **Paste-ability.** `worker.js` must remain valid to paste directly into the Cloudflare dashboard editor. No imports of local modules, no build-time transforms.
- **Section discipline.** Keep new code under the matching banner comment (Config / MIME parser / Email / API / UI / Helpers / Exports).
- **CORS stays open.** The API is intentionally `Access-Control-Allow-Origin: *`. Don't tighten it without a reason — the UI and any third-party caller depend on it.
- **Validate at the edge.** New `/api/create` inputs must be validated before any KV write (see the existing username/domain/target/ttl checks) and return a clear `4xx` with a human message on failure.
- **KV writes always carry a TTL.** Never write an `addr:` or `msgs:` key without an `expirationTtl` — expiry is the whole product.
- **Tone in user-facing copy.** The UI and README voice is deliberately blunt and irreverent. Keep new user-facing strings in that register; keep CLAUDE.md/CONTRIBUTING professional.

---

## Known Issues & Pitfalls

- **The `email()` handler can't be tested via `wrangler dev`.** Email Routing only invokes it for real inbound mail on a configured zone. Test parser/handler changes by deploying to a staging Worker or by exercising the pure parser functions directly — not by hoping `wrangler dev` triggers them.
- **The inline MIME parser is best-effort, not RFC-complete.** It handles common multipart, base64/quoted-printable, and RFC 2047 cases, with multipart recursion capped at depth 4. Exotic or malformed messages may parse imperfectly; it deliberately favors "never throw, store something" over strict correctness.
- **Quoted-printable is decoded byte-wise, not charset-aware.** Unlike the base64 path (which honors the declared `charset`), the QP branch of `decodePart` maps each `=XX` escape straight through `String.fromCharCode`, so multi-byte UTF-8 sequences in QP bodies are **not** reassembled into characters. `test/parse.test.js` pins this as documented behavior. If you "fix" it, update that test.
- **No token = no recovery.** Inbox access is the in-memory token only. There is intentionally no recovery path; don't add one without re-thinking the whole "accountless, nothing-to-leak" premise.
- **KV is eventually consistent.** A freshly created address may take a moment to be globally visible. The taken-address `409` check is best-effort, not a hard uniqueness guarantee.
- **Adding a domain is not just code.** Putting a string in `ALLOWED_DOMAINS` does nothing unless that domain has Cloudflare Email Routing configured to invoke this Worker. Update both together.
- **Redirects re-mail, they don't use Cloudflare's native `forward()`.** `forward()` only delivers to *pre-verified* destination addresses, useless for a public service. So redirects re-send the message: **Cloudflare Email Service** (`env.EMAIL.send()`) first, **Resend** as fallback. Either way the message arrives **from `FORWARD_FROM`** (original sender in `Reply-To`) and **attachments are dropped**. Sending to arbitrary recipients via Cloudflare Email Service needs the Workers **Paid** plan; both providers have per-account/plan send limits. If neither provider is configured/working, redirects bounce.
- **Forwarded mail is re-mailed, not relayed verbatim.** Because the body is rebuilt from the parser's text/HTML, anything the parser doesn't extract (attachments, inline images, unusual parts) is lost in forwarding. This is a deliberate trade for "forward to anyone without verification."

---

## Adding Features — Checklist

1. **New API endpoint?** Add the route to `handleAPI`, write the handler in the API section, validate inputs before any KV write, return `json(...)`. Update the HTTP API tables in `CLAUDE.md` and `README.md`, and add a `CHANGELOG` entry.
2. **New KV key or record field?** Always write with an `expirationTtl`. Update the KV Key Schema table.
3. **New config limit or domain?** Add/adjust the constant at the top of `worker.js`, update the Config Constants table, and bump the version (it's user-visible). For a domain, configure Email Routing too.
4. **UI change?** Edit `buildHTML`; keep it framework-free and within the existing CSS-variable theme system. Recapture screenshots if it's visible, and add a `CHANGELOG` entry.
5. **Extending the MIME parser?** Keep functions pure and total (never throw on bad input). Export the function in the trailing `export { … }` block and add a case to `test/parse.test.js` — `npm test` runs in CI. Assert the parser's *actual* contract (see the documented quoted-printable quirk), not an idealized one.
6. **Touching anything user-visible?** Apply the Documentation Maintenance table — update `CLAUDE.md`, `README.md`, `docs/CHANGELOG.md`, and screenshots as required.

---

## What NOT to Do

- **Do not add runtime dependencies, a bundler, or a framework.** The zero-dep, single-file, paste-into-the-dashboard property is the core design constraint.
- **Do not split `worker.js` into multiple source files.** It ships as one file by design.
- **Do not add accounts, passwords, or a token-recovery flow.** Accountless, session-scoped, unrecoverable access is the product.
- **Do not store anything you wouldn't want in plaintext.** KV is unencrypted; the README says so plainly. Don't add features that imply confidentiality the system can't provide.
- **Do not write a KV key without a TTL**, and do not introduce a background cron to "clean up" — expiry is KV's job.
- **Do not tighten or remove CORS** without a concrete reason.
- **Do not claim a change is "tested" beyond what the suite covers.** `npm test` covers the pure MIME parser only. For `fetch`/`email`/KV/validation changes, state that it was smoke-tested and how (UI via `wrangler dev`, email via staging deploy).
