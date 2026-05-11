---
'accounts': patch
---

Bumped `hono` to `^4.12.18` and added `pnpm` overrides for `tar`, `js-yaml`, `qs`, `file-type`, `follow-redirects`, and `postcss` to resolve `pnpm audit` advisories. Added a `pnpm audit` step to CI so future advisories block the build.
