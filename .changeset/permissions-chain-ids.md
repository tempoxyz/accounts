---
'accounts': patch
---

Removed the import of `viem/tempo/chains` from `Permissions`, which read only four chain IDs. Each chain definition imports Viem's Tempo actions and their ABIs, so every page's instance bundled them. A page with `redirect()` loads 102 kB gzip in place of 169 kB.
