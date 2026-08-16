# Contributing

Welcome! `dsh-coding-subscription-oauth` is an open-source coding-subscription OAuth plugin for DeepSeek Harness. We appreciate issue reports, questions and pull requests. Read `docs/00-project-rules.md` first — it defines the release loop, versioning, commit/push hygiene and the publish vs local-only document split that every contribution must respect.

## Code of Conduct

- Be respectful and constructive in issues, PRs and reviews.
- Only ever use coding subscriptions you own. The project does not support bulk accounts, quota resale, remote relay, paywall bypass or client impersonation — see the compliance note in `README.md`.

## Getting started

Development verification for this plugin runs only in an isolated Docker build sandbox; do not run installs, builds, tests, typechecks, linters or package checks directly on a shared developer host. The tracked `Dockerfile` copies the filtered source into the image (never credentials), downloads dependencies in a dedicated stage, then runs project code with `--network=none`. Do not use host networking, privileged mode, ports, or bind mounts.

```bash
docker build --target check --build-arg NODE_VERSION=22.19.0 \
  --resource memory=3g --resource cpu-quota=200000 \
  --tag test-dsh-coding-oauth:check .

docker build --target verify --build-arg NODE_VERSION=22.19.0 \
  --resource memory=3g --resource cpu-quota=200000 \
  --tag test-dsh-coding-oauth:verify .
```

The `artifacts`, `package`, `inspect`, and `isolated-install` targets cover generated `lib/`, the candidate tarball, release inspection, and a script-disabled consumer install.

This repo also ships a Grok Build CLI (`dsh-coding-oauth`, legacy `dsh-grok-build`), an OAuth settings page, and verification scripts for a live deployment (`verify:deployed` / `smoke:deployed`). Those exercise real providers, so they are meant for maintainer/dev workflows, not for CI.

## Development flow

1. Open an issue describing the change (or link an existing one) so scope is agreed first.
2. Branch from the default branch. Keep commits atomic and conventional — see **Commits & pushes** below.
3. When you change a capability or add a doc, update `README.md` (and the community translations added in `docs/00-project-rules.md` §2 if user-facing) and the relevant entries in `docs/` (public layer), **and** add a changelog entry under `Unreleased` in `CHANGELOG.md`.
4. Build the Docker `check` and `verify` targets until green, then commit that passing slice promptly (do not stack later work on an uncommitted green tree).
5. Push the branch as a version/milestone checkpoint and open a PR. Describe what changed and how it was verified. Keep the scope of local-only docs (`docs/local/`) out of the PR unless you are a maintainer doing internal investigation.

## Commits & pushes

History is part of the review. The maintainer counterpart — tags, clean-tree releases, changelog folding — lives in `docs/00-project-rules.md` §7.

### Conventional, atomic commits

- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(optional-scope): summary` in the imperative, about 50–72 characters.
- Types:
  - `feat:` new capability / route / provider
  - `fix:` bug fix
  - `docs:` documentation (publishable layer)
  - `test:` tests
  - `refactor:` behaviour-preserving cleanup
  - `build:` toolchain, packaging, or committed `lib/` artifacts
  - `ci:` CI workflow
  - `chore:` process-only (including a release bump)
- Optional scopes such as `M1` / `M3` or a module name are welcome when they help a reviewer.
- **One coherent concern per commit.** Do not mix docs, build/toolchain and feature/fix work unless they are inseparable (a new capability that cannot be reviewed without its README/changelog note, or a source change that must ship with the `lib/` it generated).
- Do not rewrite published history. Amend or squash only on an unpushed local commit.

### Before you commit

- Build the relevant Docker targets (`check`, then `verify`) and wait until green. Do not commit a failing tree.
- Commit promptly once checks pass — do not leave a finished, verified change sitting uncommitted next to later work.
- Generated `lib/` is a committed release artifact (git installs + the CI `git diff --exit-code -- lib` drift gate). Rebuild it and include it in the **same** commit as the source or build-script change that produced it. Do not land stale `lib/` against newer `src/`, and do not land a `lib/`-only commit unless the only change is a verified rebuild with no source delta.
- Never commit secrets, tokens, credentials, private keys, `.env` files, host-specific paths, or local-only notes (`docs/local/`, `reference/`). See `docs/00-project-rules.md` §0.3.

### Pushing

- Push the feature branch as a **checkpoint** at each version or milestone (for example after an M1/M2/M3 slice, or when a version-ready cut is green), not only when the PR is finished.
- Never force-push (`--force` / `--force-with-lease`) without **explicit maintainer approval**. Default history is append-only, including on your own feature branch once it has been pushed.
- Open the PR from a pushed checkpoint. Describe what changed and how it was verified.

## Review & merging

- At least one other person's approval is needed to merge.
- A PR that changes public behaviour must not be merged without its README/changelog updates.
- Do not force-push `main` or a published release tag. Feature-branch force-pushes still need explicit approval (see above).
- Maintainers run the release loop (`docs/00-project-rules.md` §3–4 and §7) after merging a substantive change: clean working tree, bump version, annotated tag `v<version>`, publish to npm, and keep the GitHub milestone/release updated.

## Reporting security issues

Do not open a public issue for a credential or account-safety problem. Follow the compliance/safety policy in `README.md`; for anything sensitive, contact a maintainer directly rather than pasting tokens or credentials anywhere.

## Document layers reminder

- **Publishable**: root `README.md` + the community-language READMEs, `INSTALL.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, `docs/00-project-rules.md`, `docs/02-architecture.md` + `docs/02-architecture.zh-CN.md`, and other generic `docs/` files. These ship to npm and git — keep them privacy-free.
- **Local-only**: `docs/local/` and `reference/` are git-ignored and never shipped. Do not reference them from publishable docs.

If you are not sure whether a detail is publishable, keep it in the local-only layer or ask a maintainer.
