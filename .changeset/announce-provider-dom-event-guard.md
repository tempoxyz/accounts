---
'accounts': patch
---

Skipped EIP-6963 provider announcement in partial `window`-like runtimes (e.g. React Native) that lack `window.dispatchEvent`/`window.addEventListener`, preventing `Provider.create` from throwing at startup.
