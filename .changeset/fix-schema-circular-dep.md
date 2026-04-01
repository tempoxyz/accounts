---
'accounts': patch
---

Broke circular dependency between `Schema` and `rpc` modules that caused runtime errors when bundled with esbuild.
