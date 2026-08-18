# Install & usage · dsh-coding-subscription-oauth

> [**中文版**](INSTALL.zh-CN.md) · English

This repository was formerly **`dsh-grok-build`**. End users should install the published npm package (latest):

```bash
# Recommended: latest from npm into the web profile
dsh plugin --profile web add dsh-coding-subscription-oauth

# Or install the latest package with npm, then attach it to your DSH profile
npm install dsh-coding-subscription-oauth
```

These commands install the **latest** release from the registry. Pin a version only when you need a specific tag — see [CHANGELOG.md](CHANGELOG.md) / npm version history. The current documented release line is **0.5.x**.

CLI primary command: `dsh-coding-oauth` (legacy `dsh-grok-build` still works). For existing profiles the Cordis id stays `llm-grok-build-oauth`, Settings HTTP paths stay `/plugins/dsh-grok-build/*`, and credential filenames are unchanged.

```bash
dsh plugin --profile web update dsh-coding-subscription-oauth
```

The old GitHub URL still resolves to the same `main`.

## Prerequisites

- DeepSeek Harness 0.1.0-rc.6+
- Node.js 22.19+
- Your own coding subscription(s); Claude/Google accounts are optional if you only need other routes
- Some networks need an HTTP/HTTPS proxy

## Install

```bash
# Recommended: latest npm release via DSH plugin manager
dsh plugin --profile web add dsh-coding-subscription-oauth

# Explicit npm install of the latest package
npm install dsh-coding-subscription-oauth

# Development / alternate: from GitHub
dsh plugin --profile web add github:lninghaha/dsh-coding-subscription-oauth

# Local development checkout (alternate)
# dsh plugin --profile web add ./dsh-coding-subscription-oauth

# Optional Google Antigravity dependency (pinned, reviewed)
dsh plugin --profile web add dsh-agy@0.1.2
```

Restart the existing `dsh web` process after install; do not start a second server on the same port.

The local API gateway is **off** by default. Enable it in the profile (loopback only):

```yaml
gateway:
  enabled: true
  bind: 127.0.0.1
  port: 18080
```

Or open **Settings → Coding OAuth → Gateway**. The Bearer key lives at `$DSH_HOME/.coding-oauth-gateway.json`. Do not bind `0.0.0.0`.

## Antigravity safety

The `/agy` standalone dashboard in `dsh-agy@0.1.2` has no auth of its own and exposes credential export. On trusted-host or reverse-proxied web deployments, disable that dashboard in the profile's final `cordis.patch.yml`:

```yaml
- id: dsh-agy-web
  disabled: true
```

This does not disable the `agy` LLM route or the profile-local `dsh-agy` CLI.

```bash
NODE_USE_ENV_PROXY=1 \
HTTPS_PROXY=http://127.0.0.1:7890 \
dsh plugin --profile web exec dsh-agy login --headless
```

Set `NODE_USE_ENV_PROXY` / `HTTPS_PROXY` only when your network needs a proxy. Never paste Google credential exports into chat or logs.

## Proxy

Preferred: configure the resident service in the profile's final patch:

```yaml
- id: llm-grok-build-oauth
  config:
    proxy: http://127.0.0.1:7890
    proxyKimi: false
```

Priority: `config.proxy` → `CODING_OAUTH_PROXY` → `GROK_BUILD_PROXY` → `HTTPS_PROXY` / `HTTP_PROXY`.

Default proxied domain groups: xAI/Grok Build, OpenAI Codex, Claude/Anthropic, Google OAuth/Cloud Code. Kimi Code China traffic stays direct unless `proxyKimi: true`.

## Resilience

OAuth access tokens refresh **five minutes** before stored expiry. If upstream still rejects a locally-valid token with 401/403, the plugin backdates `expires` and the retried step refreshes first. Transient failures (429/5xx/timeout/network) and `AUTH` retry up to 2 times by default (500 ms → 10 s, 10% jitter). Quota exhaustion and a dead refresh token do not retry.

```yaml
- id: llm-grok-build-oauth
  config:
    retryPolicy:
      mode: normal
      maxRetries: 2
      retryableCodes: [EMPTY_RESPONSE, RATE_LIMIT, SERVER, TIMEOUT, TRANSPORT, AUTH]
      backoff: { initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 }
```

## Sign-in

### Settings

Open **Settings → Coding OAuth** (tabs: Accounts, Gateway, Capabilities, About):

- **Grok Build**: authorization code or device code
- **OpenAI Codex**: device code recommended on remote DSH; browser PKCE can paste the redirect URL
- **Kimi Code**: device code
- **Claude Code**: browser PKCE; on remote access paste the full localhost redirect URL

Settings **discovers** allowlisted official Grok / Codex / Kimi / Claude CLI OAuth files (read-only). Sync is an explicit one-way **Pull** (not auto-import): discover → preview → conflict/fingerprint check → confirm overwrite. Official CLI files are never written. Reads refuse symlinks, non-regular files, non-owner files, group/other access, and oversized documents (`O_NOFOLLOW`). Preview tickets are one-use, expire in five minutes, and are capped at 32. CLI `dsh-coding-oauth import` still covers Grok only.

Login only exchanges authorization codes; status APIs never return access/refresh tokens.

### Optional capabilities

Seven subscription capability switches default **off** and apply **live** (no restart): `codexSearch`, `codexImages`, `codexImageEdits`, `codexUsage`, `codexFast`, `grokImagineImage`, `grokImagineVideo`.

Numeric controls: `searchResults` (1–20, default 5), `imageCount` (1–4, default 1), `videoArtifactTtlMs` (1 hour–7 days, default 7 days; UI shows 1–168 hours). Lowering video retention shortens and cleans existing artifacts immediately; raising it affects only artifacts created afterward. Administrators may set secret-free composition defaults under plugin config `capabilities`; live user settings in the `coding-subscription-oauth` section override that base.

`codex-oauth-fast` appears only after a fresh live catalog lists at least one `priority`-eligible model. Requests send `service_tier: priority` plus a routing hint; the UI says **Fast requested** and never guarantees latency. Codex search/usage/images are opt-in private `chatgpt.com/backend-api` endpoints; images use fixed `gpt-image-2`; edits accept only current-session top-level attachments this session owns.

Grok Imagine uses official `https://api.x.ai` (`grok-imagine-image-2.0` / `grok-imagine-video-1.5`) with a separate DSH credential reference `XAI_API_KEY` — never Grok OAuth, never process-env fallback. Downloads are MIME/size/time/redirect/DNS controlled from frozen hosts `imgen.x.ai`, `videogen.x.ai`, `vidgen.x.ai`; private store hard-caps 256 MiB per object and aggregate unique bytes, seven days max; served only on same-origin loopback routes.

### CLI

```bash
# Grok (`dsh-grok-build` remains an alias)
dsh-coding-oauth login
dsh-coding-oauth login --pkce
dsh-coding-oauth import

# Codex / Kimi / Claude
dsh-coding-oauth login codex --device-auth
dsh-coding-oauth login codex --browser
dsh-coding-oauth login kimi
dsh-coding-oauth login claude

dsh-coding-oauth status all
dsh-coding-oauth logout kimi
```

## Model routes

- `grok-build/<model>`
- `codex-oauth/<model>`
- `codex-oauth-fast/<model>` (optional; only after a fresh live `priority` catalog)
- `kimi-code-oauth/<model>`
- `claude-code-oauth/<model>`
- `agy/<model>` (after installing `dsh-agy`)

These aliases avoid colliding with existing `xai`, `openai`, and `kimi-coding` API-key routes. Unauthenticated OAuth routes return an empty model list; after sign-in provider names show `(OAuth)`.

## Kimi in China

Kimi Code subscription OAuth uses `https://auth.kimi.com`; inference uses `https://api.kimi.com/coding`. `https://api.moonshot.cn/v1` is the pay-as-you-go **Moonshot Open Platform** API-key channel — there is no switchable "China OAuth endpoint". This plugin uses a separate `kimi-code-oauth` route and does not affect an existing `kimi-coding` API-key config.

## Credentials & cache

```text
$DSH_HOME/.grok-build-auth.json
$DSH_HOME/.codex-oauth-auth.json
$DSH_HOME/.kimi-code-oauth-auth.json
$DSH_HOME/.claude-code-oauth-auth.json
```

All are `0600`, atomically written, file-lock protected. Model caches are matching `*-models.json` files (no tokens). Grok Imagine uses DSH credential `XAI_API_KEY`. Video artifacts live under `$DSH_HOME/.dsh-coding-subscription-oauth-media/` (dir `0700`, files `0600`). **No HTTP status, log, or UI may ever return a token.**

## Uninstall

```bash
dsh plugin --profile web remove dsh-agy dsh-coding-subscription-oauth
rm -f ~/.dsh/.grok-build-auth.json ~/.dsh/.codex-oauth-auth.json \
  ~/.dsh/.kimi-code-oauth-auth.json ~/.dsh/.claude-code-oauth-auth.json
rm -f ~/.dsh/.grok-build-models.json ~/.dsh/.codex-oauth-models.json \
  ~/.dsh/.kimi-code-oauth-models.json ~/.dsh/.claude-code-oauth-models.json
```

Delete credential files only after you confirm you no longer need those accounts.

## Maintainer verification

These commands are for maintainers from a source checkout; npm installs do not include them. See also [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
pnpm run verify:deployed

DSH_RESTORE_PROVIDER=openai \
DSH_RESTORE_MODEL=gpt-5.6-sol \
DSH_RESTORE_REASONING=max \
pnpm run smoke:deployed
```

`verify:deployed` checks the live model catalog auth gate and `(OAuth)` labels. `smoke:deployed` runs Codex/Kimi tool-calls plus a second user turn (covers `INVALID_REPLAY_STATE`), then restores the declared default model and archives sessions. The smoke script refuses to run without `DSH_RESTORE_*`.

## Troubleshooting

| Symptom | Action |
|---|---|
| Still searching for / installing `dsh-grok-build` | Repo renamed to `dsh-coding-subscription-oauth`; old GitHub URL tracks the same `main`. New installs use the new name |
| Codex localhost callback unreachable | Use device code, or paste the full redirect URL into Settings |
| Claude localhost callback on a remote browser | Paste the full redirect URL into Settings |
| Kimi 401/403 | Re-sign-in and confirm Kimi Code membership; do not switch to moonshot.cn OAuth |
| OAuth refresh failed | Re-sign-in that account; the plugin does not fall back to another account or API key |
| Duplicate model routes | Keep this plugin's `*-oauth` aliases; remove conflicting third-party OAuth plugins |
| Antigravity page 404 | Safety config disables `dsh-agy-web`; use the CLI |
| Google/Claude/OpenAI unreachable | Check the plugin scoped proxy; do not restart or rewrite system networking |

## Compliance

Using coding subscriptions through a third-party harness may sit in a gray area of each vendor's terms. Use **only your own accounts**; this project does not support bulk accounts, quota resale, remote relay, paywall bypass, or client impersonation. For commercial use, prefer the vendors' official API-key channels.
