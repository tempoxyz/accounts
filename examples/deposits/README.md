```
npx gitpick tempoxyz/accounts/examples/deposits
npm i
npm dev
```

This example also shows the MPP Credits onramp entry point. A third-party site can open
the wallet directly to the credit-card credits flow with:

```ts
await provider.request({
  method: 'wallet_deposit',
  params: [{ intent: 'credits', displayName: 'My App' }],
})
```

The onramp remains wallet-hosted: the app embeds/opens Tempo Wallet through the SDK, and
the wallet handles sign-in, eligibility, saved cards, and checkout.
