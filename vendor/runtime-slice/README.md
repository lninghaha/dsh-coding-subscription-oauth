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
