# Isolated smoke on DSH `0.1.2-alpha.*` (cadence)

Tracker: [#29](https://github.com/lninghaha/dsh-coding-subscription-oauth/issues/29)

## Rules

- Isolated `DSH_HOME=/tmp/dsh-verify-sub-<ver>` only.
- Prefix-install alpha CLI; do not overwrite global `0.1.1-rc.2`.
- High port (default `18381`); never `3080`.
- Never restart operator `dsh-web`.
- Do **not** use `smoke:deployed` for this cadence (touches real sessions).
- Comment versions + reveal allow/deny codes on #29; never paste keys.

## Quick path

```bash
pnpm run assert:node
pnpm run smoke:dsh-alpha
```

## Checks

1. Loopback `Host` gateway reveal → allowed (non-403)
2. Non-loopback `Host` → **403**
