## Summary

<!-- What does this PR do and why? One to three bullet points. -->

-

## Type of change

<!-- Check all that apply -->

- [ ] Bug fix (visible to users → `PATCH`)
- [ ] New feature or capability (→ `MINOR`)
- [ ] Breaking API or data-schema change / domain removal (→ `MAJOR`)
- [ ] Internal refactor / styling / accessibility (→ `PATCH`)
- [ ] CI / docs only (no version bump)

## Checklist

### Code

- [ ] `npm run check` passes (no syntax errors)
- [ ] `npm test` passes (MIME-parser unit tests)
- [ ] `npx wrangler deploy --dry-run` passes
- [ ] Production code kept inside `worker.js` (no runtime dependencies, no bundler)
- [ ] MIME-parser change has a `test/parse.test.js` case added/updated **— or** N/A
- [ ] New `/api/create` inputs are validated before any KV write **— or** N/A
- [ ] New KV writes carry an `expirationTtl` **— or** N/A
- [ ] Smoke-tested — UI/API via `wrangler dev`, email changes via a staging deploy (describe how in the Summary)

### Version & changelog

- [ ] Version bump not required (CI / docs only) **OR**
- [ ] `package.json` `version` updated
- [ ] `docs/CHANGELOG.md` new section added at the top
- [ ] `README.md` version badge URL updated
- [ ] `CLAUDE.md` `**Version:**` header updated

### Documentation

- [ ] `CLAUDE.md` updated (HTTP API table, KV Key Schema, Config Constants, or worker.js Anatomy as applicable) **— or** N/A
- [ ] `README.md` updated (How It Works / Features / Caveats) **— or** N/A
- [ ] Screenshots recaptured for any visible UI change **— or** N/A
