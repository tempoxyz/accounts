---
'accounts': patch
---

Skipped the `mppx` `globalThis.fetch` polyfill on runtimes where `fetch` is read-only (e.g. Cloudflare Workers). Added `mpp.polyfill` option for explicit control; defaults to auto-detect via the property descriptor.
