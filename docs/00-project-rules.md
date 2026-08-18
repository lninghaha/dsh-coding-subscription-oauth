# 00 · Project Rules: Versions, Releases & Maintenance

> Applies to the `dsh-coding-subscription-oauth` open-source plugin repository (formerly `dsh-grok-build`).
> This file is the single source of truth for the repo's conventions and governs `README` and the release flow.
> Principle: **publish like any general open source project, and never leak development privacy.** Anything facing external users must be public, generic and durable; anything internal (accounts, hosts, tokens, paths, credentials) stays local and must never reach git or the npm artifact.

---

## 0. Open-Source Principles

### 0.1 Why we open source

This project is published open source so that others can use, study, fork and improve the coding-subscription OAuth integration for DeepSeek Harness — the same way its upstream (`dsh-xai`) was shared with us. Openness is a goal, not an accident of hosting.

### 0.2 License & attribution

- The project is **Apache-2.0**. Every contribution is licensed under the same terms (see `LICENSE`).
- Derived work is credited in `NOTICE`, as required by Apache-2.0; derived code is never relicensed.
- Third-party review favours pinned, auditable versions (e.g. `dsh-agy@0.1.2`) so that what we link against is known and reproducible.

### 0.3 The hard boundary: no development-privacy leak

Open source does **not** mean publishing everything. The following must never reach git, the npm artifact, or any public channel:

- real credentials, tokens, passwords, API keys, private keys, `authorized_keys`;
- personal accounts / account-pool details, host aliases, exact machine paths, internal IPs;
- fault-investigation notes that describe a private machine or a specific personal incident (keep these in `docs/local/`).

When in doubt, **do not publish** — put the note in the local-only layer instead.

### 0.4 "Publishable documentation will be published"

Adopting the community norm, any document judged to be genuinely useful to contributors and free of development-privacy content **is expected to be published** (tracked in git, shipped via `files`, reachable from `README`), not merely written and left local. This includes: architecture, install/usage, contributor/release rules, changelog, and the compliance note. Documents that fail the §0.3 boundary check stay local-only. The publish/local split in §1 exists to make that call explicit and auditable.

### 0.5 Community commitments

- Welcome and respond to issues and PRs (see `CONTRIBUTING.md`).
- Keep a real changelog and a predictable release cadence (§5).
- Publish release notes and version tags so history is traceable.
- Keep git history atomic and conventional (§7); never commit secrets or mix unrelated concerns.
- Do not invent capabilities, pad releases, or impersonate vendors/clients (§5, `README` compliance note).

---

## 1. Document Layers: Publish vs Local-only

Every document in the repo belongs to one of two layers, and the two never mix:

| Layer | Location | In git / npm? | Examples | Requirements |
|---|---|---|---|---|
| **Publishable (public)** | Repo root: `README.md` + `README.zh-CN.md` + other community-language READMEs, `CONTRIBUTING.md`, `INSTALL.md`, `CHANGELOG.md`, `LICENSE`, `NOTICE`, and explicitly promoted generic `docs/` files (this rules doc, `docs/02-architecture.md` + `docs/02-architecture.zh-CN.md`) | ✅ git, shipped via `files` | architecture, install/usage, route table, compliance notes, contribution & release rules | privacy-free: no host aliases, accounts, credentials, absolute paths; external-facing tone |
| **Local-only (personal)** | `docs/local/` — investigation, risk and fault-analysis notes (e.g. `docs/local/01-research.md`, `docs/local/05-INVALID_REPLAY_STATE-调查.md`); `reference/` (vendored third-party source) | ❌ in `.gitignore`, never in `files` | concrete fault debugging, internal details, account-risk analysis | reference only; ignored by git by default |

**Hard constraints**

- `package.json` `files` whitelist contains **only** publishable docs; `docs/` must **not** be added wholesale — any doc shipped with the package is listed explicitly.
- `.gitignore` keeps `docs/local/`, `docs/` and `reference/` ignored. To promote a doc into version control, explicitly `git add -f` after moving it to the root or adopting the naming convention in §2.
- Before adding any doc, ask: *does an unrelated contributor need to see this?* Anything involving personal accounts, hosts, tokens, paths, regional-risk details or internal debugging goes to the local-only layer.

---

## 2. Document Naming & "Document Version"

- Docs use `NN-<topic>.md`, numbered from `00` (`00-project-rules` is the fixed rule file — it is not re-versioned on every release).
- **A "new document version" exists when any of the following happens**:
  - substantive content added/removed/changed (not just wording);
  - a doc is split, merged, or added;
  - `README.md` / `INSTALL.md` must be updated to stay consistent.
- A document's version **is the npm package version** (see §3); there is no separate doc versioning scheme.

### Language policy

- **`README.md` is English-first.** It also ships community translations selected for the widest open-source reach: `README.zh-CN.md` (简体中文), `README.ja.md` (日本語), `README.ko.md` (한국어), `README.pt-BR.md` (Português do Brasil), `README.es.md` (Español), `README.fr.md` (Français), `README.de.md` (Deutsch) and `README.ru.md` (Русский). All 9 files carry an identical language-switch line at the top so readers can jump between them, and every translation must be kept in sync with `README.md` (same sections, same version references).
- Any user-facing change to `README.md` implies updating **all** translations. If that is not feasible for a very-large change, translators can open follow-up PRs, but the language switch line must never be broken.
- Publishable docs under `docs/` are written English-first as well, to match the general-OSS publishing style. `docs/local/` may stay in whatever language the author prefers, since it is never published.

---

## 3. Versioning & The Release Loop

[Semantic Versioning (SemVer)](https://semver.org/): `MAJOR.MINOR.PATCH`.

| Change | Version action |
|---|---|
| New public capability / route / provider | minor (in the `0.x` phase this bumps the second digit) |
| Bug fix, docs wording, process patch | patch |
| Breaking change to imports/config in an existing capability | major (pre-1.0, handled on a case-by-case basis) |

**The release loop (every document version → README → release) is a mandatory pipeline:**

```text
new document version formed
   │
   ▼
CHANGELOG.md updated (entry added under the matching release)
   │
   ▼
README.md synced (new capability / new doc entry / new command / new notes)
   │
   ▼
pnpm run check passes in the development environment
   │
   ▼
version bumped (package.json + built artifact metadata, see §4)
   │
   ▼
git commit + annotated tag v<version>  (clean tree only)
   │
   ▼
publish only after the verified local pack and explicit maintainer approval
   │
   ▼
confirm GitHub release / milestone stays active
```

**Every time a document version is formed, the full loop above must run.** Never change docs without syncing README, and never update README without releasing.

**Commit, tag and tree hygiene** (detail in §7): each commit is conventional and atomic; generated `lib/` is committed with the source/build change that produced it; the release commit is made only on a clean tree; the annotated tag is `v<version>` and must match `package.json` and the top `CHANGELOG.md` heading.

---

## 4. Automated Release Script

The repo provides `scripts/release.mjs` (see its header comment):

- `--dry-run` validates the current `CHANGELOG.md`/`package.json` version, verifies the already-built release artifacts, previews the real packed file list with lifecycle scripts disabled, and rejects local-only files.
- `--pack` rebuilds and verifies the release, then writes a local tarball under `output/`.
- The helper never bumps versions, commits, tags, pushes, or publishes. Those remain explicit maintainer operations after human approval.

Example:

```bash
# validate + preview only; no tarball, Git, or registry changes
node scripts/release.mjs --dry-run

# rebuild + verify + create a local candidate tarball
node scripts/release.mjs --pack
```

> Publishing and remote Git writes are intentionally outside the script.

---

## 5. Keeping the Project Active

"Active" is not about publishing many versions — it is a stable, predictable, handover-friendly rhythm:

- **Predictable release cadence**: run the release loop after every substantive feature PR; aim for at least one meaningful minor release per quarter to keep discoverability up.
- **Honest changelog**: accumulate pending entries under `Unreleased` and fold them into a version on release; never pad releases with empty entries.
- **Responsive PRs/issues**: keep the templates and conventions in `CONTRIBUTING.md` so any contributor knows how to open a PR.
- **CI & gates**: `pnpm run check` (lint + typecheck + test + build/verify) is a release precondition; CI also rebuilds committed `lib/` and rejects artifact drift.
- **Security stance**: the compliance note in `README` (own accounts only; no bulk accounts, resale, impersonation) is a hard line; any new provider or endpoint must respect it.
- **Docs/code in sync**: when adding or changing a capability, update `README.md` and `docs/02-architecture.md` (public layer) before releasing.

---

## 6. Pre-Release Self-Check (Privacy Line)

Before every real release, verify:

- [ ] `npm pack --dry-run --json --ignore-scripts` output contains **nothing** matching `*调查*`, `docs/local/`, `reference/`, account/host aliases, tokens, or absolute paths.
- [ ] `README.md` / `INSTALL.md` reference only public, generic commands, domains and accounts.
- [ ] The `files` whitelist does **not** include the whole `docs/` directory.
- [ ] `CHANGELOG.md` has an entry matching the about-to-be-released version; pending notes have been folded from `Unreleased` into `## v<version>`.
- [ ] `pnpm run check` passes.
- [ ] `git status` is clean: no leftover source, docs, lockfile or `lib/` drift.
- [ ] The annotated tag will be `v<version>` and matches `package.json` plus the top `CHANGELOG.md` heading. Never move or reuse a published tag.

---

## 7. Commits, Pushes & Tags

Contributor-facing wording lives in `CONTRIBUTING.md`. This section is the source of truth for maintainers.

### 7.1 Atomic conventional commits

- Messages follow [Conventional Commits](https://www.conventionalcommits.org/): `type(optional-scope): summary` in the imperative (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`, `ci:`, `chore:`). Optional scopes such as `M1` / `M3` or a module name are fine.
- **One coherent concern per commit.** Never mix documentation, build/toolchain and feature/fix changes unless they cannot be reviewed or built separately (a capability that is meaningless without its README/changelog note, or a source change that must ship with the `lib/` it generated).
- Run `pnpm run check:next` (fast gate) and, before a release-ready commit, `pnpm run check` (full lint + release build + test) **directly in the development environment** — including Cursor Cloud Agents and other isolated cloud workspaces. Installing dependencies, typechecking, linting, testing, building, and packing on that environment is the default workflow; an extra Docker sandbox is **not** required for day-to-day development verification. Commit that passing slice promptly — do not leave a finished, verified change sitting uncommitted next to later work, and do not commit a red tree.
- **Docker is optional, not mandatory.** The tracked `Dockerfile` remains available for CI runners and for contributors who want an offline sandbox on a shared physical host. When used: the build context is filtered by `.dockerignore`; dependencies download in their own stage; project-code `RUN` steps use `--network=none`; never use privileged mode, credential mounts, the Docker socket, or host-directory bind mounts. Host networking is prohibited except for the narrow, explicitly authorized preview fallback documented in `CONTRIBUTING.md`.
- **Host DSH boundary:** unless the maintainer explicitly requests it for the current operation, never install into, modify, stop, restart, or run validation against a DSH instance already installed on a shared host. Prefer the isolated cloud workspace DSH (`DSH_HOME=$HOME/.dsh-cloud`, bootstrapped by `.cursor/install-cloud-dsh.sh`) or, when Docker is used, a dedicated Docker DSH instance with an isolated home/profile. A Docker-based preview may publish an explicitly selected high host port on `0.0.0.0` for remote review, must not reuse the host DSH port or state directories, and must remain resource-limited and individually removable. Host networking is prohibited by default; it is allowed only after ordinary Docker port publishing has been proven unavailable and the maintainer explicitly authorizes that specific run. An authorized host-network preview must bind only pre-checked high ports, keep its DSH backend on a separate loopback high port, and never bind or probe the host DSH port.
- Generated `lib/` is a committed release artifact (git installs and the CI `git diff --exit-code -- lib` drift gate). Rebuild it and include it in the **same** commit as the `src/` or build-script change that produced it. Do not land stale `lib/` against newer source, and do not land a `lib/`-only commit unless the only change is a verified rebuild with no source delta.
- Secrets, credentials, tokens, private keys, `.env` files, host aliases, absolute machine paths, and local-only notes (`docs/local/`, `reference/`) never enter git (§0.3).

### 7.2 Pushes

- Feature branches are pushed as **checkpoints** at each version or milestone (branch names such as `work/<topic>-v0.3` are fine), not only when the PR is finished.
- Force-push is forbidden without **explicit approval**, including `--force-with-lease`, once a branch has been pushed. Default history is append-only. Never force-push `main` or a published release tag.
- Do not push a dirty or failing tree "to save it"; commit the passing slice first.

### 7.3 Changelog, versions and tags

- Day-to-day user-facing work accumulates under `CHANGELOG.md` → `## Unreleased`.
- A release folds `Unreleased` into `## v<version>`, bumps `package.json` (and any built artifact metadata) to that same version, and creates an **annotated** tag `v<version>` on a **clean** working tree. The top changelog heading, `package.json` version and tag name must be identical (the `v` prefix is tag/heading only).
- `scripts/release.mjs` does **not** bump, commit, tag, push or publish; those stay explicit maintainer steps after `pnpm run check`, `--dry-run` and `--pack` succeed.
- Never tag or publish from a dirty tree, and never move or reuse a published tag.
