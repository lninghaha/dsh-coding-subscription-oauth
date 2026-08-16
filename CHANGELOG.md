# Changelog

All notable changes to `dsh-coding-subscription-oauth` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

## v0.3.0

### Added

- Add a provider retry policy for the four OAuth routes: transient failures (`RATE_LIMIT`/`SERVER`/`TIMEOUT`/`TRANSPORT`/`EMPTY_RESPONSE`) **and `AUTH`** now retry with exponential backoff (default 2 retries, 500 ms → 10 s, 10% jitter) instead of killing the turn.
- Add AUTH-failure credential invalidation: when an upstream rejects a locally-valid token with 401/403, the stored credential's expiry is backdated so the retried step refreshes before reuse — recovering the stale-token 401 race without user-visible failure.
- Add an optional `retryPolicy` plugin config (harness `RetryPolicySchema`) to override the built-in policy per deployment.

### Changed

- Migrate the package toolchain from npm/tsdown to pnpm 11, TypeScript 6, Biome, and an esbuild multi-entry server/client build with declaration emit, promote/verify, and CI. Published package identity, dual CLI, Cordis/HTTP/credential identifiers, and `pi-ai` 0.84.2 stay unchanged.
- Require Node.js 22.19+ (or 24+) for the TypeScript 6/esbuild release pipeline and runtime bundle.
- Upgrade `@earendil-works/pi-ai` to `^0.84.2`: OAuth access tokens now refresh proactively five minutes before the stored expiry (previously only at the exact expiry instant, which raced server-side revocation on the Kimi/Codex routes), with a 15 s refresh timeout.
- Request OAuth access tokens with an explicit minimum remaining validity (60 s); a refresh that returns an even-shorter-lived token hard-fails instead of being handed to a request.
- Translate a rejected token refresh (revoked refresh token / dead grant) into `MISSING_CREDENTIAL` with a sign-in prompt rather than surfacing a bare upstream 401, and never retry it.
- Quota exhaustion stays outside the retryable set so a billing-limit response fails fast with its real message instead of the generic "API key is invalid".
- Expand README (all languages) with a searchable “problems this plugin solves” table covering SuperGrok vs `api.x.ai`, AUTH/`API key is invalid`, `INVALID_REPLAY_STATE`, grok-4.6 `xhigh`, Kimi Bearer vs `x-api-key`, remote device login and China-direct Kimi.
- Rename the published project to **`dsh-coding-subscription-oauth`**. The old `dsh-grok-build` name only covered the first provider. Cordis id, HTTP `/plugins/dsh-grok-build/*` paths, credential files and the `dsh-grok-build` CLI alias stay compatible.

### Fixed

- Fix the stale-token 401 turn failure (`API key is invalid` banner) observed on the Kimi Code OAuth route when an access token expired mid-session: the turn now refreshes and retries transparently.
- Expose Grok 4.6 `xhigh` reasoning effort. Live `/models-v2` already returns `reasoning_efforts` including xhigh, but the plugin previously kept only model ids and materialized grok-4.6 from the grok-4.5 template. pi-ai hides xhigh unless that key is an explicit non-null mapping. The catalog now applies live effort lists; the baseline ships grok-4.6 with xhigh while grok-4.5 stays low/medium/high.
- Invalidate credentials on an `AUTH` finish even when that same finish also carries replay state, then rewrite the replay provider without skipping the refresh path.
- Bound OAuth JSON request bodies to 64 KiB (400 for malformed JSON, 413 for oversized bodies) and stream the live model catalog through a real 4 MiB ceiling.
- Contain startup cache/catalog failures and redact token-like material from refresh diagnostics instead of retaining it in user-visible errors or error causes.

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
