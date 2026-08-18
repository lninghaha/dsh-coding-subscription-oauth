# Changelog

All notable changes to `dsh-coding-subscription-oauth` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

### Changed

- Make native `pnpm` checks the default development verification path (including cloud agent environments). Docker sandbox targets remain optional for CI and shared-host isolation.
- Bootstrap an isolated Cloud Agent DSH (`@deepseek-ai/dsh@0.1.0-rc.6`, `DSH_HOME=$HOME/.dsh-cloud`) via `.cursor/install-cloud-dsh.sh` and `.cursor/environment.json`, linking this checkout into the `web` profile.

## v0.5.2 - 2026-08-18

### Documentation

- Make the published npm package the first installation path for normal users; keep GitHub and local-directory installs explicitly as development or fallback options.

## v0.5.1 - 2026-08-18

### Documentation

- Sync the English and translated READMEs with the v0.5.0 Settings tabs, collapsed account cards, local gateway copy/reveal/rotation controls, persisted listen-port controls, and npm installation path.

## v0.5.0 - 2026-08-17

### Added

- Add an opt-in local API gateway (`gateway.enabled`, default off) that binds loopback-only and serves `/healthz`, `/v1/models`, streaming `POST /v1/chat/completions`, `POST /v1/responses`, and `POST /v1/messages` from signed-in subscription sessions.
- Let Settings copy the OpenAI/Anthropic base URLs and the current Bearer key. Loopback `POST /gateway/reveal` returns the current key without rotating it; rotate stays a confirmed destructive action.
- Let Settings change the gateway listen port with Apply or Random (18100–18999). The chosen port is stored in the owner-only gateway document and the listener rebinds when it is already running.

### Changed

- Rebuild Settings as four top tabs (Accounts, Gateway, Capabilities, About). Signed-in account cards stay collapsed until expanded, CLI pull preview is full-width, and Imagine status sits on Capabilities.

## v0.4.1 - 2026-08-17

### Added

- Add accessible live numeric controls for `searchResults`, `imageCount`, and video artifact retention (shown as 1–168 hours), using the same compare-and-swap conflict handling as capability switches. Lowering retention rewrites and cleans existing expiries; raising it affects only new artifacts.
- Add a fast `check:next` Docker development gate (`lint` + `typecheck` + tests) before the full release build gate.

### Changed

- Resolve the Codex search model at call time so sign-in, sign-out, and live catalog changes do not leave a stale model captured by an existing provider.
- Clarify browser, device-code, and manual redirect/code sign-in guidance; use the profile-aware Antigravity command `dsh plugin --profile web exec dsh-agy login --headless`.
- Raise the `undici` floor to `^7.24.8` so scoped `socks5://` proxies are supported.
- Document the first public install path as `dsh plugin --profile web add dsh-coding-subscription-oauth@0.4.1`, matching other DSH plugins.

### Fixed

- Declare image input on the Grok 4.5 and Grok 4.6 baseline descriptors so both fallback and live-derived catalog entries accept image attachments instead of failing locally as unsupported.
- Resolve subscription requests from the refreshed access token persisted by each OAuth session. This prevents Kimi's header-only `Authorization: Bearer` auth result from being misclassified as “not signed in” merely because it has no `auth.apiKey` field.
- Treat Kimi Code's HTTP 401 `authentication_error` that says a model `supports only 256K context` as `CONTEXT_WINDOW_EXCEEDED`. The previous AUTH classification invalidated a still-valid token and retried a request that cannot succeed.
- Strip `user:pass@` from the CLI proxy line, and when a scoped proxy is installed append a `CODING_OAUTH_PROXY` reachability hint to Grok discovery, token, and live-catalog transport errors.
- Preserve composition capability defaults before Settings is injected and after a Settings service is replaced or disposed; contain asynchronous settings-listener failures; keep empty PATCH writes revision-checked but side-effect free.
- Make generated media download filenames safe for `Content-Disposition` while preserving opaque DSH attachment ids.
- Dispose in-flight Grok Imagine API/download work before awaiting media cleanup, isolate caller-owned video-poll cancellation, and remove an artifact if cancellation wins during persistence.
- Finish Settings disposal even when an injected watch disposer throws, while reporting the contained failure.
- Reject owner-only or group/world-writable npm package entries and require the packed CLI to remain executable.
- Close preview-proxy WebSocket halves when either side ends so isolated proxy tests and shutdown cannot hang on leftover upgrade pipes.

### Security

- Require Grok discovery to declare the exact configured issuer identity, pin authorization/token endpoints to its approved origin, refuse redirects, bound discovery/token responses and pasted authorization codes, and redact every repeated opaque credential-shaped diagnostic.
- Reject unknown, secret-shaped, mistyped, fractional, and out-of-range capability writes instead of silently coercing or clamping caller-authored values.
- Add a 60-second Codex request ceiling that covers response streaming, plus cancellation-aware stream cleanup; strengthen Imagine request-id, prompt, base64, redirect, MIME, size, and cancellation boundaries.

## v0.4.0 - 2026-08-16

### Added

- Add read-only Settings discovery of allowlisted official Grok / Codex / Kimi / Claude CLI OAuth files, plus an explicit one-way manual Pull: discover → preview → conflict/fingerprint check → overwrite confirmation. Official CLI files are never written.
- Add default-off live optional capabilities: Codex search, usage/quota, image generation/edit, Fast, and Grok Imagine image/video. Limits: search results 1–20, image count 1–4, artifact TTL 1 hour–7 days. A secret-free `capabilities` composition base is optional; user settings override it.
- Advertise `codex-oauth-fast` only after a fresh live catalog lists at least one `priority`-eligible model. Requests send `service_tier: priority` and a routing hint. The UI says **Fast requested** and does not guarantee latency or upstream honor.
- Add opt-in Codex private `chatgpt.com/backend-api` endpoints. Image generation uses the fixed model `gpt-image-2`. Image edit requires current-session top-level attachment ownership.
- Add Grok Imagine against official `https://api.x.ai` with `grok-imagine-image-2.0` and `grok-imagine-video-1.5`, using a separate DSH credential reference `XAI_API_KEY` (never Grok OAuth, never a process-env fallback).
- Serve generated outputs on same-origin loopback routes under `/plugins/dsh-grok-build/imagine/*`. Remote downloads apply MIME / size / time / redirect / DNS controls from frozen hosts `imgen.x.ai`, `videogen.x.ai`, and `vidgen.x.ai`. The private artifact store hard-caps both one object and aggregate unique object bytes at 256 MiB, with retention capped at seven days.

### Changed

- Add a tracked multi-stage Docker sandbox for networkless check/verify, generated artifact export, local candidate packaging, and a script-disabled isolated consumer install.
- Settings CLI synchronization is a manual Pull, not auto-import. Discovery stays automatic and read-only; writing the dsh store still requires preview and an explicit confirm.
- Capability switches apply live; turning one off withdraws the matching search provider, tools, or Fast route without a restart.

### Fixed

- Bound in-memory Pull preview tickets to one-use, a five-minute TTL, and a process maximum of 32 so credential-bearing preview material cannot accumulate.

### Security

- Harden official CLI reads: reject symlinks, non-regular files, non-owner files, group/other access, and oversized documents; open with `O_NOFOLLOW`; never write the official CLI path.
- Keep Imagine media on frozen xAI output hosts with DNS pinning and blocked private/loopback addresses; never return a signed upstream URL to the client.

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
