# Security Policy

## Supported versions

ShitPost.email is a single hosted Cloudflare Worker, shipped from the `main`
branch. Only the **latest released version** receives security fixes.

| Version | Supported |
|---------|-----------|
| latest (`main`) | ✅ |
| older releases  | ❌ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub's **Report a vulnerability** flow:

1. Go to the repository's **[Security](https://github.com/shamu4life/throwaway-email/security)** tab.
2. Click **Report a vulnerability**.
3. Describe the issue, steps to reproduce, and impact.

This opens a private advisory visible only to the maintainers. We aim to
acknowledge reports within a few days. There is no bug-bounty program — this is
a hobby project — but credit is gladly given in the advisory if you'd like it.

## What is in scope

- Authentication/authorization flaws (e.g. reading or deleting an inbox without
  the correct token, token guessing).
- Injection or XSS, including in the rendered-HTML email view.
- Ways to bypass the input validation on `/api/create`.
- Anything that lets one user affect another user's address or messages.

## What is *not* a vulnerability (by design)

These are documented properties of a throwaway-mail toy, not bugs — please don't
report them:

- **Mail is stored unencrypted** in Cloudflare KV. The product is explicitly for
  non-sensitive, disposable use.
- **No account or recovery.** Access is a session-scoped, in-memory token; losing
  it means losing the inbox. This is intentional.
- **Addresses are guessable / first-come-first-served.** Anyone can create any
  available username; there is no ownership beyond holding the token.
- **CORS is fully open** (`Access-Control-Allow-Origin: *`) on the API, on purpose.

See [`README.md`](../README.md) → Caveats and [`CLAUDE.md`](../CLAUDE.md) for the
full design rationale.
