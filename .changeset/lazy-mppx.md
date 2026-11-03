---
"accounts": patch
---

`Provider` no longer imports mppx statically. Before, every app and dialog that bundled the SDK shipped and evaluated about 34 kB (brotli) of mppx, even with `mpp: false` or `mpp: { polyfill: false }`.

- With `mpp: false` or `mpp: { polyfill: false }`, mppx is not loaded. Without the polyfill, `Provider.create` used to create an mppx client that nothing used. Apps that compose their own client with `getMppxParameters()` are unaffected.
- With the fetch polyfill (the default where `globalThis.fetch` is writable), `Provider.create` still replaces `globalThis.fetch` synchronously and then loads mppx. A `fetch` sent before mppx finishes loading waits for it, then mppx handles it as before, including the `Accept-Payment` header on same-origin requests. Once mppx has loaded, its own polyfill takes over the global, so `Fetch.restore()` from `mppx/client` restores the original `fetch`. A `Fetch.restore()` call made before mppx loads has no effect. If mppx fails to load, `fetch` keeps working without payment handling.
