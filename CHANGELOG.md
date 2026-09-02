# Changelog

All notable changes to `dsh-coding-subscription-oauth` are documented here, following the release loop in `docs/00-project-rules.md`. Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/). Versioning follows [SemVer](https://semver.org/).

## Unreleased

## v0.6.5 - 2026-09-02

### Fixed

- Restrict gateway key reveal/rotate to `accessMode === "loopback"`, matching the Settings UI which already hides those controls on ssh-tunnel and trusted-https-proxy.

### Changed

- Stop shipping `src/` in the npm `files` allowlist. Runtime remains the generated `lib/` bundle.
- Add `.nvmrc`, `pnpm run assert:node`, `release:inspect`, and `release:publish`. Cloud Agent verification is `pnpm run check` with optional Docker.

### Documentation

- Add `AGENTS.md` (cloud environment as the primary path; Docker optional; isolated `DSH_HOME`; operator-only npm publish).
- Align `CONTRIBUTING.md` and `docs/00-project-rules.md` so contributors are not Docker-only; Cursor Cloud / isolated `DSH_HOME` is the primary verification path.
- Localize community README upgrade banners (ja/ko/pt-BR/es/fr/de/ru) so they are not English-only under bilingual headings, keeping Cordis fix in `0.6.2+` and DSH `0.1.1-rc.2` facts accurate.

## v0.6.4 - 2026-08-29

- Pin Subscription, its shared core dependency, and both production/development dispatcher dependencies to `undici@7.29.0` with `dsh-coding-oauth-core@0.1.1`, preventing a co-installed Undici major split while preserving the proxy-store ABI and Grok Imagine's explicit pinned dispatcher.

### Documentation

- Correct the README upgrade callout so Cordis/DSH `0.1.1-rc.2` support is attributed to `0.6.2+`, and name `0.6.3` for default-off `codexImagesAnyModel`; add the any-model route-gate boundary sentence across README translations and an `INSTALL.md` `0.6.2` → `0.6.3` upgrade note.

## v0.6.3 - 2026-08-28

### Added

- Add a default-off `codexImagesAnyModel` capability that lets non-Codex model routes call Codex image generate/edit tools without bypassing Codex authentication, capability gates, current-session attachment ownership, or edit authorization.

### Fixed

- Clear `codexImagesAnyModel` in `normalizeCapabilitySettings` whenever resolved `codexImages` is false, so the any-model flag cannot remain on after images are disabled at the admit layer (UI cascade alone is insufficient).

### Documentation

- Align the Hub co-install matrix in `INSTALL.md` to `dsh-hub-oauth-gateway@1.10.0` with Subscription `0.6.3` and `dsh-coding-oauth-core@0.1.0`.
- Add a maintainer smoke checklist for new DeepSeek Harness releases in `CONTRIBUTING.md`, and point the open migration profile-verification todo at that checklist plus the green Docker `isolated-install` / `rc2-compatibility` sandbox evidence.
- Sync capability inventory lines to eight switches (`codexImagesAnyModel` included) across README translations and architecture docs; document editing the hardcoded DSH pin in `Dockerfile` for smoke builds.

## v0.6.2 - 2026-08-25

`0.6.1` was never published or packed; its unreleased changes are folded into this release.

### Fixed

- Probe optional DSH host services without eagerly reading Cordis properties, so a missing injection degrades safely instead of failing the complete plugin tree during startup.
- Require only `webServer` at plugin activation and register owner OAuth, capability, gateway, and import routes directly so optional services may arrive and leave independently.
- Inject rc.2-required pi-ai credential storage/auth context through the existing owner-locked OAuth files, fail closed for unknown provider writes, and retain image attachments under the provider request policy.

### Changed

- Verify the exact DeepSeek Harness `0.1.1-rc.2` BOM and resolve `dsh-coding-oauth-core@0.1.0` from npm rather than a sibling workspace path.

## v0.6.0 - 2026-08-22

### Added

- Add exact DSH BOM/client platform gates, host/client compatibility adapters, trusted remote owner policy, and shared `dsh-coding-oauth-core` owner election for standalone/Hub co-installation.

### Changed

- Redesign Provider management around summaries, local model drafts with batch apply, in-card CLI Pull preview, real Gateway models, explicit confirmations, retryable loading states, and compact Hub-owned co-install UI.
- Keep OAuth/Web ownership independent from optional LLM services and wait for required Web routes before reporting the standalone runtime active.

### Fixed

- Restore focus after CLI previews and logout confirmation, remove ARIA relationships to unmounted panels, and verify release client imports against the official DSH `PLATFORM_MODULES` contract.

## v0.5.8 - 2026-08-22

### Fixed

- Make the tag Release workflow idempotent for GitHub Releases (create or edit) and run npm provenance publish in a separate job so a pre-existing release no longer skips publishing.
- Skip npm publish when the exact version is already on the registry, then verify `npm view` matches the tag.
- Finish Settings theme polish: Gateway enable uses ToggleSwitch, OpenAI/Anthropic copy actions share CopyButton, snippet tabs get keyboard/ARIA parity, About gains a real heading and docs link, ProgressBar uses `button-info-fill`, and warn banners use warn-colored styling.

### Changed

- Relax Docker preview seed/`run-preview.sh` so they accept the installed `@deepseek-ai/dsh` version instead of a hard-coded `0.1.0-rc.6` pin.
- Extend `release.mjs` version checks to `INSTALL.md` and `README.zh-CN.md`.
- Document npm Trusted Publishing binding steps in `CONTRIBUTING.md`.

## v0.5.7 - 2026-08-22

### Fixed

- Make Settings primary CTAs, active step markers, and toggle thumbs follow DSH `button-primary-fill` + `label-primary-foreground` so dark theme (where brand-primary inverts to near-white) no longer renders white-on-white buttons (#13).
- Use readable `label-tertiary` for neutral badges/status dots instead of near-invisible `label-dimmed`, and correct the warn token spelling to `state-warn-primary`.

## v0.5.6 - 2026-08-19

### Fixed

- Relax Docker preview seed checks so `web-preview` images build against the current plugin version and installed DSH peer packages instead of hard-coded semver pins.
- Improve the settings screenshot capture script so isolated DSH preview overlays (Continue, internal testing notice, modal masks) are dismissed before opening **Settings → Coding OAuth**.

### Documentation

- Refresh Settings product screenshots under `media/` for the v0.5.5 UI redesign: segmented tabs with live hints, semantic status badges, sign-in step flow, toggle switches on Capabilities, and gateway quick-setup snippets on Gateway.
- Record npm publication confirmation for `dsh-coding-subscription-oauth@0.5.5` and keep README install commands on the latest release.

## v0.5.5 - 2026-08-19

### Changed

- Redesign the Coding OAuth Settings client: semantic status badges, segmented tabs with live hints, toggle switches for capabilities, sign-in step flow with copy actions, model search/filter controls, Codex usage progress bars, gateway quick-setup snippets (cURL / Python / IDE), skeleton pulse animations, and auto-dismiss success notices.

## v0.5.4 - 2026-08-19

### Changed

- Improve remote/headless Settings UX: prefer device-code CTAs on non-loopback hosts, collapse noisy per-card CLI-missing hints into one neutral tip, shorten Capabilities copy, move Antigravity onto Accounts, and enrich About with remote-login help plus plugin version.
- Load Gateway and Imagine status only when their tabs open; soft-fetch Capabilities when Codex is signed in so quota can still appear on Accounts.
- Split the Settings client into tab/components modules with display/parser Vitest coverage, and make `promote-release` resilient to overlay `EXDEV` renames.

### Documentation

- Refresh Settings product screenshots under `media/` for the remote-host Accounts tip, device-code-first CTAs, quieter CLI-missing banner, Gateway loopback hint, and shortened Capabilities copy; keep the three-column README gallery (Accounts / Gateway / Capabilities).
- Record previously unreleased screenshot gallery work (Accounts / Gateway / Capabilities under `media/`, three-column README layout) in this release.

## v0.5.3 - 2026-08-19

### Changed

- Raise the default OAuth route retry policy to 5 stacked exponential delays (5 s → 10 s → 20 s → 40 s → 80 s, ~155 s total, 10% jitter).
- Remap xAI “at capacity / high demand / priority processing / overloaded” finish messages to `RATE_LIMIT` so harness retries run instead of failing as `PI_AI_ERROR` when upstream `error.code` is null.

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
