# Architecture

> [**中文版**](docs/02-architecture.zh-CN.md) · English

This document describes the internal architecture of `dsh-grok-build`. It is the source for the technical notes in `README.md` and is intended for contributors and maintainers.

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
  ├─ GrokBuildWebAuth ── Grok custom PKCE/device/import
  │                      └─ .grok-build-auth.json
  │
  └─ SubscriptionWebAuth ── pi-ai OAuth login/refresh
            ├─ Codex  ── .codex-oauth-auth.json
            ├─ Kimi   ── .kimi-code-oauth-auth.json
            └─ Claude ── .claude-code-oauth-auth.json

OAuthProviderSession.resolveAccessToken()
  └─ Models.getAuth(native id)        # refresh-under-lock
       └─ OAuthCredentialFileStore    # 0600 + atomic write + cross-process lock

ctx.llm route
  └─ AliasLlmAdapter
       └─ PiAiAdapter
            └─ native pi-ai Provider.streamSimple()
```

## 3. Module responsibilities

- `store.ts`: one file owns one provider credential; keeps the legacy Grok store API.
- `oauth-providers.ts`: Codex/Kimi/Claude definitions, route metadata, request token bridge.
- `oauth-session.ts`: login, refresh, static model catalog and model-selection cache.
- `alias-adapter.ts`: translates Harness routes, does not modify pi-ai `model.provider`, and runs a credential gate before `listModels()`; unauthenticated or unreadable credentials return an empty catalog, and the provider group name is `(OAuth)`.
- `adapter.ts`: composes Grok with the three subscription profiles.
- `auth-routes.ts`: legacy Grok API + the new unified `/plugins/dsh-grok-build/oauth/*`.
- `client/`: four native account cards on the settings page plus the external Antigravity status card.
- `proxy.ts`: process-wide undici dispatcher, but proxies only a reviewed domain whitelist.

## 4. Web API

Unified interface:

```text
GET  /plugins/dsh-grok-build/oauth/status
POST /plugins/dsh-grok-build/oauth/login
POST /plugins/dsh-grok-build/oauth/code
POST /plugins/dsh-grok-build/oauth/cancel
POST /plugins/dsh-grok-build/oauth/logout
POST /plugins/dsh-grok-build/oauth/models
```

Write endpoints take `provider: grok|codex|kimi|claude` in the body. Responses contain only status, authorization URL, device user code, model ids and a non-sensitive expiry; they never contain access/refresh tokens.

The legacy `/plugins/dsh-grok-build/auth/*` endpoints remain registered and reuse the same Grok controller.

## 5. Antigravity

This project does not replicate the private Google Antigravity protocol. The profile separately installs `dsh-agy@0.1.2`, which provides the `agy` route. Because the `/agy` dashboard in that version includes an export API with no authentication of its own, current deployments disable `dsh-agy-web` by default and keep only the host adapter and CLI. The profile uses a pnpm patch with a lockfile hash: with no Google session, `listModels()` returns empty; after authentication the provider group name is `Google Antigravity (OAuth)`.

## 6. Compatibility

- Package name stays `dsh-grok-build`.
- Cordis id stays `llm-grok-build-oauth`.
- The `$DSH_HOME/.grok-build-auth.json` format is not migrated.
- The `grok-build` fallback model is unchanged.
- New routes use the `*-oauth` alias and do not occupy `openai`, `xai` or `kimi-coding`.
