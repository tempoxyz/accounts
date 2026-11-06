---
'accounts': patch
---

Skipped `postMessage` adapter session warm-up in partial `window`-like runtimes (e.g. React Native) that expose `window` without `document`, preventing `postMessage`/`tempoWallet` from throwing at creation.
