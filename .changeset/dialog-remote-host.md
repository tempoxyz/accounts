---
"accounts": patch
---

The legacy `dialog()` adapter, and with it Wagmi's `tempoWallet` connector, now opens `https://wallet.tempo.xyz/remote` by default instead of `https://wallet.tempo.xyz/embed`. `/embed` answers with a `301` to `/remote`, so every iframe and popup boot paid an extra round trip before the wallet page started loading. The wallet keeps the redirect for older SDK versions and explicit `/embed` hosts.
