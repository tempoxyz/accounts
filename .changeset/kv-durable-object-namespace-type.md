---
'accounts': patch
---

Relaxed the `id` parameter on `Kv.durableObject.Namespace.get` from `unknown` to `any` so Cloudflare's `DurableObjectNamespace<T>` is structurally assignable without an intermediate cast at the call site.
