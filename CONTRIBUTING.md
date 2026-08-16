# Contributing

Welcome! `dsh-coding-subscription-oauth` is an open-source coding-subscription OAuth plugin for DeepSeek Harness. We appreciate issue reports, questions and pull requests. Read `docs/00-project-rules.md` first — it defines the release loop, versioning and the publish vs local-only document split that every contribution must respect.

## Code of Conduct

- Be respectful and constructive in issues, PRs and reviews.
- Only ever use coding subscriptions you own. The project does not support bulk accounts, quota resale, remote relay, paywall bypass or client impersonation — see the compliance note in `README.md`.

## Getting started

```bash
npm install
npm run check          # typecheck + test + build — must pass before any PR
```

This repo also ships a Grok Build CLI (`dsh-coding-oauth`, legacy `dsh-grok-build`), an OAuth settings page, and verification scripts for a live deployment (`verify:deployed` / `smoke:deployed`). Those exercise real providers, so they are meant for maintainer/dev workflows, not for CI.

## Development flow

1. Open an issue describing the change (or link an existing one) so scope is agreed first.
2. Branch from the default branch; keep commits small and message them conventionally:
   - `feat:` new capability / route / provider
   - `fix:` bug fix
   - `docs:` documentation (publishable layer)
   - `test:` tests
   - `refactor:` behaviour-preserving cleanup
3. When you change a capability or add a doc, update `README.md` (and the community translations added in `docs/00-project-rules.md` §2 if user-facing) and the relevant entries in `docs/` (public layer), **and** add a changelog entry under `Unreleased` in `CHANGELOG.md`.
4. Run `npm run check` locally until green.
5. Push and open a PR. Describe what changed and how it was verified. Keep the scope of local-only docs (`docs/local/`) out of the PR unless you are a maintainer doing internal investigation.

## Review & merging

- At least one other person's approval is needed to merge.
- A PR that changes public behaviour must not be merged without its README/changelog updates.
- Maintainers run the release loop (`docs/00-project-rules.md` §3–4) after merging a substantive change: bump version, tag `v<version>`, publish to npm, and keep the GitHub milestone/release updated.

## Reporting security issues

Do not open a public issue for a credential or account-safety problem. Follow the compliance/safety policy in `README.md`; for anything sensitive, contact a maintainer directly rather than pasting tokens or credentials anywhere.

## Document layers reminder

- **Publishable**: root `README.md` + the community-language READMEs, `INSTALL.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, `docs/00-project-rules.md`, `docs/02-architecture.md` + `docs/02-architecture.zh-CN.md`, and other generic `docs/` files. These ship to npm and git — keep them privacy-free.
- **Local-only**: `docs/local/` and `reference/` are git-ignored and never shipped. Do not reference them from publishable docs.

If you are not sure whether a detail is publishable, keep it in the local-only layer or ask a maintainer.
