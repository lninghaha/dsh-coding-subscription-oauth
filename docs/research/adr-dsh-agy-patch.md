# ADR: Fate of `patches/dsh-agy@0.1.2.patch`（#32）

**Status:** Accepted — **KEEP** the patch for the pinned `dsh-agy@0.1.2` profile install  
**Date:** 2026-09-02  
**Parent:** #28 / #32  
**Artifact:** `patches/dsh-agy@0.1.2.patch` (listed in `package.json#files`; composition tests assert contents)

## What the patch does

Against stock `dsh-agy@0.1.2` `lib/plugin-common-*.mjs` it:

1. Renames the provider group from `Antigravity (agy)` to **`Google Antigravity (OAuth)`**.
2. Makes `listModels()` return **`[]` when there is no Google session** (and swallow session-read errors into an empty catalog) instead of probing with a missing token.

It does **not** touch the `/agy` web dashboard or its unauthenticated export APIs. Trusted-host profiles must still disable `dsh-agy-web` (see `INSTALL.md`).

## Upstream check (2026-09-02)

| Version | Display name | No-session `listModels` | Unauthenticated `/agy` export |
| --- | --- | --- | --- |
| `0.1.2` (pinned) | `Antigravity (agy)` — needs patch | Calls `listAgyModels(session?.…)` without empty-catalog guard | Present |
| `0.2.4` (latest at check) | Still `Antigravity (agy)` | Different try/catch; not the same empty-catalog + OAuth naming contract | Still present |

Upstream has **not** absorbed this patch’s semantics into a drop-in replacement for the pinned `0.1.2` install story. Bumping the whole profile to `0.2.x` is a separate migration (dashboard risk unchanged; catalog/error behaviour differs).

## Options

| Option | Action | When |
| --- | --- | --- |
| **KEEP (chosen)** | Ship patch + docs pin `dsh-agy@0.1.2`; composition test stays | Upstream unfixed for 0.1.2 contract |
| **DROP** | Delete patch, update `files` / composition / architecture copy | Only after a pinned agy release documents equivalent behaviour **or** we deliberately stop caring about empty catalog / display name |
| **REPLACE** | New patch for a newer agy version | After an intentional pin bump with its own threat review |

## Decision

**Keep** `patches/dsh-agy@0.1.2.patch`.

Reasons:

1. Documented install path still pins **`dsh-agy@0.1.2`**.
2. Patch remains the auditable, hashable fix for authentication-discovery UX (empty model list without a session; clearer OAuth group name).
3. Deleting it without an upstream absorb would regress catalog behaviour for profiles that apply the shipped patch via pnpm lockfile hash.
4. Keeping the patch does **not** introduce or re-enable the unauthenticated export dashboard — that stays a profile `cordis.patch.yml` concern.

## Non-goals

- Do not auto-upgrade operators to `dsh-agy@0.2.x` in this issue.
- Do not imply the patch hardens the `/agy` export surface.

## Revisit / drop triggers

- A future `dsh-agy` release that (a) we pin in INSTALL/README and (b) includes equivalent no-session empty catalog + agreed provider naming, **or**
- Product decision to stop shipping an agy patch and accept stock upstream strings/errors.

When dropping: remove the file, drop it from `package.json#files`, update `tests/composition.spec.ts`, and refresh architecture / INSTALL Antigravity paragraphs.
