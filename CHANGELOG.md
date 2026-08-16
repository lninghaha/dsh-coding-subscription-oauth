# Changelog

All notable changes to `dsh-grok-build` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

## v0.2.0

### Added

- Add unified `/plugins/dsh-grok-build/oauth/*` API across Grok, Codex, Kimi and Claude.
- Add `codex-oauth`, `kimi-code-oauth` and `claude-code-oauth` routes alongside the preserved Grok Build and native API-key routes.
- Add the Coding OAuth settings page with per-provider sign-in, model selection and status cards.
- Add pinned `dsh-agy@0.1.2` integration for Google Antigravity and a safe patch that hides unauthenticated models and labels the provider `(OAuth)`.
- Add authentication-gated model discovery: unauthenticated OAuth routes expose no models, while authenticated providers are explicitly labelled `(OAuth)`.
- Add `verify:deployed` and `smoke:deployed` scripts for live-deployment verification.
- Add plugin-level scoped proxy configuration (`config.proxy`) and Kimi direct-connect default.
- Add high-contrast settings actions and localized community README translations.

### Fixed

- Fix Kimi OAuth wire authentication so the final request uses `Authorization: Bearer` without an extra Anthropic `x-api-key`.
- Fix OAuth catalog refresh so listeners cannot make a successful login/logout appear failed, and cleanup failures cannot leave stale models visible.
- Fix OAuth route replay state so Codex/Kimi assistant messages keep the Harness route provider id and remain replayable across multi-turn conversations.
- Heal older poisoned OAuth replay metadata at request time and strip replay state when switching between sibling OAuth routes.
- Make deployment smoke require explicit `DSH_RESTORE_PROVIDER`/`DSH_RESTORE_MODEL`, then restore that default after testing.

### Security

- Store all OAuth credential files as owner-only `0600` with atomic writes and cross-process locks.
- Keep OAuth tokens out of HTTP status responses, logs and the settings UI.
- Document disabling the unauthenticated `dsh-agy-web` dashboard on trusted-host deployments.

## v0.1.0

- Initial release: Grok Build device OAuth, `import`, dynamic `/v1/models-v2` catalog and Responses streaming inference.
- `dsh-grok-build` CLI with login/import/status/logout.
- Web settings section for Grok Build account.
