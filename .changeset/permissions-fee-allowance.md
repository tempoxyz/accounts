---
'accounts': patch
---

Added a fee allowance to each sign-in's access key. Tempo charges the network fees of an access key to its limit of the fee token, so limits that name no stablecoin, such as limits of MACH alone, pay no fee. For such limits with named `scopes`, the key authorization request now holds 0.1 of each of pathUSD, USDC.e, USDT0, OUSD, alphaUSD, betaUSD, and thetaUSD that the chain lists, after the app's own limits. No scope calls those tokens, so the allowance pays fees only. `Permissions.resolve` returns it as `fees`, apart from `limits`. Limits that name one of those stablecoins, an access key without limits or scopes, an access key that another party holds, and scopes that call the channel reserve, the stablecoin DEX, or the fee manager receive none. The scopes that the library fills from `limits` call the channel reserve, so they receive none.

```ts
const resolved = Permissions.resolve(
  {
    limits: [{ limit: '2', token: 'mach' }],
    scopes: [Scopes.tip20(mach).transferWithMemo()],
  },
  { chainId: tempo.id },
)

resolved.limits // 2 MACH
resolved.fees // 0.1 of each of pathUSD, USDC.e, USDT0, and OUSD
```
