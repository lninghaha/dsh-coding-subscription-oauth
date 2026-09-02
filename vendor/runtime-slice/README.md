# Runtime slice mirror

Byte-identical copies of the first shared-runtime extract from Hub’s vendored
`dsh-coding-oauth-core` (`http-json`, `grok-errors`, `kimi-errors`,
`gateway-protocol`).

Subscription cannot consume an unpublished core bump yet, so these files (and
the `src/runtime/` build copies) bridge until the next published
`dsh-coding-oauth-core` release absorbs the slice. Keep them in sync with:

```bash
pnpm run assert:runtime-slice
```

`SYNC_HASHES.json` pins SHA-256 digests so isolated CI can verify the mirror without a Hub checkout. When Hub is available as a sibling (or via `HUB_OAUTH_GATEWAY_ROOT`), `pnpm run assert:runtime-slice` also compares live Hub files.
