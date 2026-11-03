---
"accounts": patch
---

`Handler.relay` trims three cold-cache stages of `eth_fillTransaction`:

- The recent block producers' fee tokens, which the fee-liquidity check reads in three sequential rounds, keep serving for up to 10 minutes past their 60-second TTL while they reload in the background. `cached()` gained a `stale` option for this, and stores entries through their stale window.
- The token list loads alongside the fill instead of before it. A sponsored fill whose fee token is known (the sponsor's or the request's) no longer waits for it. Without a known fee token the list still loads before `validate` runs.
- A token in the list takes its decimals from it: the fee-token balance check needs no metadata read, and neither do balance diffs or the fee breakdown for tokens the simulation names (symbols and names still come from the simulation or the chain).
