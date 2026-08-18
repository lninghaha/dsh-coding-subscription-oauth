# Architecture

> [**中文版**](02-architecture.zh-CN.md) · English

This document describes the internal architecture of `dsh-coding-subscription-oauth`. It is the source for the technical notes in `README.md` and is intended for contributors and maintainers.

## 1. Routes and native providers

```text
Harness route          pi-ai provider         request authentication
────────────────────────────────────────────────────────────
grok-build             grok-build            xAI access token + Grok CLI headers
codex-oauth             openai-codex          OAuth token → apiKey override
kimi-code-oauth         kimi-coding           OAuth token → Authorization: Bearer
claude-code-oauth       anthropic             sk-ant-oat token → Claude Code headers
agy                     dsh-agy external      dsh-agy own account pool
```

External routes and the pi-ai native ids are separated by `AliasLlmAdapter`. `PiAiAdapter` always sees the native provider id, so Codex tool-calls, Claude compatibility checks and the Kimi Anthropic transport do not break when a route is renamed.

"Authenticated" in model discovery is defined as an existing, structurally valid, refreshable OAuth credential; the selector does not probe upstream on every open. Credentials that upstream has revoked but are still locally valid are recognized during token refresh or inference, avoiding extra network requests on catalog load.

## 2. Host data flow

```text
Settings / CLI
  │
  ├─ GrokBuildWebAuth ── Grok custom PKCE/device
  │                      └─ .grok-oauth-auth.json
  │
  ├─ SubscriptionWebAuth ── pi-ai OAuth login/refresh
  │         ├─ Codex  ── .codex-oauth-auth.json
  │         ├─ Kimi   ── .kimi-code-oauth-auth.json
  │         └─ Claude ── .claude-code-oauth-auth.json
  │
  └─ OAuthImportSession ── read-only allowlisted CLI discovery
            └─ explicit one-way Pull (preview ticket → dest store)
               official CLI files are never written

OAuthProviderSession.resolveAccessToken()
  └─ Models.getAuth(native id)        # refresh-under-lock
       └─ OAuthCredentialFileStore    # 0600 + atomic write + cross-process lock

CapabilitySettingsController (default-off, applies: live)
  └─ CapabilityRuntimeState
       ├─ Codex search / usage / gpt-image-2 images
       ├─ codex-oauth-fast (only after a fresh priority catalog)
       └─ Grok Imagine (api.x.ai + XAI_API_KEY via DSH credentials)

ctx.llm route
  └─ AliasLlmAdapter
       └─ PiAiAdapter
            └─ native pi-ai Provider.streamSimple()
```

## 3. Module responsibilities

- `store.ts`: one file owns one provider credential; keeps the legacy Grok store API; `invalidate()` backdates `expires` after an upstream AUTH rejection.
- `oauth-providers.ts`: Codex/Kimi/Claude definitions, route metadata, request token bridge.
- `oauth-session.ts`: login, refresh, static model catalog and model-selection cache.
- `oauth-sources.ts`: allowlisted official Grok/Codex/Kimi/Claude CLI discovery; hardened lstat/`O_NOFOLLOW`/owner/mode/regular-file/size reads; one-use preview tickets (five minutes, max 32); never writes official CLI files.
- `oauth-import-routes.ts`: same-origin Pull HTTP API (discover → preview → commit/cancel) into the destination store lock.
- `alias-adapter.ts`: translates Harness routes, does not modify pi-ai `model.provider`, and runs a credential gate before `listModels()`; unauthenticated or unreadable credentials return an empty catalog, and the provider group name is `(OAuth)`. On an AUTH finish it invalidates the stored token so the harness retry can refresh first.
- `adapter.ts`: composes Grok with the three subscription profiles; asks pi-ai for a 60 s remaining-validity floor and registers a retry policy that includes AUTH plus transient codes. Optionally wraps `codex-oauth-fast` as **Fast requested**.
- `auth-routes.ts`: legacy Grok API + the unified `/plugins/dsh-coding-subscription-oauth/oauth/*`; JSON writes use a 64 KiB bounded reader and return 400/413 for malformed/oversized bodies.
- `capability-settings.ts`: default-off live flags and limits (search 1–20, image count 1–4, artifact TTL 1 h–7 d).
- `capability-routes.ts`: secret-free capability snapshot plus optional Codex usage and Imagine credential-status routes.
- `capability-runtime.ts`: live bind/unbind of search, tools, and the Fast route after a fresh priority catalog.
- `capability-tools.ts`: optional Codex / Grok Imagine tool definitions; flags re-read at execute time.
- `codex-http.ts`: opt-in private `chatgpt.com/backend-api` client (HTTPS-only, first-party host).
- `codex-search.ts` / `codex-usage.ts` / `codex-images.ts`: opt-in search, quota, and fixed `gpt-image-2` generate/edit (edits require current-session top-level attachment ownership).
- `codex-model-capabilities.ts`: live Codex service-tier cache; fail-closed Fast eligibility; injects `service_tier: priority` and the routing hint.
- `grok-imagine.ts`: official `api.x.ai` Imagine client (`grok-imagine-image-2.0` / `grok-imagine-video-1.5`); `XAI_API_KEY` via DSH credentials only; MIME/size/time/redirect/DNS download controls; frozen hosts `imgen.x.ai`, `videogen.x.ai`, `vidgen.x.ai`.
- `imagine-routes.ts`: same-origin loopback GET routes for generated images and video artifacts.
- `media-store.ts`: owner-private artifact store (256 MiB per-object and aggregate unique-byte hard caps, seven days).
- `client/`: four native account cards, CLI Pull, capability switches, gateway controls, and the external Antigravity status card.
- `proxy.ts`: process-wide undici dispatcher, but proxies only a reviewed domain whitelist.
- `gateway*.ts`: opt-in isolated loopback OpenAI/Anthropic-compatible HTTP server (default off; independent of the DSH web port).

## 4. Web API

Unified interface:

```text
GET  /plugins/dsh-coding-subscription-oauth/oauth/status
POST /plugins/dsh-coding-subscription-oauth/oauth/login
POST /plugins/dsh-coding-subscription-oauth/oauth/code
POST /plugins/dsh-coding-subscription-oauth/oauth/cancel
POST /plugins/dsh-coding-subscription-oauth/oauth/logout
POST /plugins/dsh-coding-subscription-oauth/oauth/models

GET  /plugins/dsh-coding-subscription-oauth/oauth/sources
POST /plugins/dsh-coding-subscription-oauth/oauth/sources/preview
POST /plugins/dsh-coding-subscription-oauth/oauth/sources/commit
POST /plugins/dsh-coding-subscription-oauth/oauth/sources/cancel

GET    /plugins/dsh-coding-subscription-oauth/capabilities
PATCH  /plugins/dsh-coding-subscription-oauth/capabilities
PUT    /plugins/dsh-coding-subscription-oauth/capabilities
GET    /plugins/dsh-coding-subscription-oauth/codex/usage
GET    /plugins/dsh-coding-subscription-oauth/imagine/credential-status
GET    /plugins/dsh-coding-subscription-oauth/imagine/images/<id>
GET    /plugins/dsh-coding-subscription-oauth/imagine/media/<id>
GET    /plugins/dsh-coding-subscription-oauth/gateway
PATCH  /plugins/dsh-coding-subscription-oauth/gateway
POST   /plugins/dsh-coding-subscription-oauth/gateway/rotate
```

Write endpoints take `provider: grok|codex|kimi|claude` in the body. Responses contain only status, authorization URL, device user code, model ids and a non-sensitive expiry; they never contain access/refresh tokens. JSON request bodies are capped at 64 KiB before parsing.

`/oauth/sources` is read-only discovery. Preview/commit is the explicit one-way Pull (tickets one-use, five minutes, max 32). Capability writes are secret-free compare-and-swap snapshots in the `coding-subscription-oauth` settings section and apply live. Seven flags default off; `searchResults` is 1–20 (default 5), `imageCount` is 1–4 (default 1), and `videoArtifactTtlMs` is 1 hour–7 days (default 7 days; UI 1–168 hours); decreases rewrite/clean existing expiries immediately, while increases affect only new artifacts. Imagine download routes are same-origin loopback GETs; they never return a signed upstream URL.

The legacy `/plugins/dsh-coding-subscription-oauth/auth/*` endpoints remain registered and reuse the same Grok controller.

## 5. Antigravity

This project does not replicate the private Google Antigravity protocol. The profile separately installs `dsh-agy@0.1.2`, which provides the `agy` route. Because the `/agy` dashboard in that version includes an export API with no authentication of its own, trusted-host deployments should disable `dsh-agy-web` in the profile's final `cordis.patch.yml` (see `INSTALL.md`) and keep only the host adapter and CLI. The profile uses a pnpm patch with a lockfile hash: with no Google session, `listModels()` returns empty; after authentication the provider group name is `Google Antigravity (OAuth)`.

## 6. Package identity

The canonical package and repository name is **`dsh-coding-subscription-oauth`**. Install via npm or `github:lninghaha/dsh-coding-subscription-oauth`. The first public npm/GitHub Release was **`0.4.1`**. The current release is **`0.5.2`** (`dsh plugin --profile web add dsh-coding-subscription-oauth@0.5.2`).

Stable identifiers:

- Cordis id: `llm-coding-subscription-oauth`
- Settings HTTP API: `/plugins/dsh-coding-subscription-oauth/oauth/*`, `/plugins/dsh-coding-subscription-oauth/capabilities`, `/plugins/dsh-coding-subscription-oauth/codex/usage`, `/plugins/dsh-coding-subscription-oauth/imagine/*`, `/plugins/dsh-coding-subscription-oauth/gateway/*`
- Credential files: `$DSH_HOME/.grok-oauth-auth.json` and the other `*-oauth-auth.json` files
- Imagine credential: DSH credentials reference `XAI_API_KEY` (never Grok OAuth, never process-env fallback)
- CLI: `dsh-coding-oauth`
- LLM routes: `grok-build`, `codex-oauth`, `kimi-code-oauth`, `claude-code-oauth`; optional `codex-oauth-fast` (advertised only when a fresh live catalog lists `priority`)

OAuth routes use the `*-oauth` / `grok-build` provider ids and do not occupy `openai`, `xai` or `kimi-coding`. The `grok-build` fallback/default model is `grok-4.6`; saved user defaults still win.
