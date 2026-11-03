---
"accounts": patch
---

`Handler.relay` reads fee-pool reserves only for tokens the sender holds when it picks a fee token for an unsponsored fill. It read them for every token in the list while their balances loaded: about 370 pool reads for mainnet's 37 tokens, which a Worker's six-connection limit queued ahead of `eth_fillTransaction`. The recent block producers' fee tokens still load from the start of resolution, now alongside the token list when no sponsor is asked, so the chosen token's reserves are read alongside the fill and still checked before signing. Balance reads no longer also read each token's decimals, and an autoSwap's source token reuses the balances that fee-token resolution read.
