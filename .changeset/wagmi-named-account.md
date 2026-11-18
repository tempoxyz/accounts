---
'accounts': patch
---

Fixed wagmi's actions with the `tempoId` connector for a call that names the connected account by address as `account`, such as `sendTransaction`, `signMessage`, `signTypedData`, and `Actions.token.transferSync` of `@wagmi/core/tempo`. The access key now signs the call, as for a call without `account`. Before, Viem read the address as an account of the node, so the call sent `eth_sendTransaction`, `eth_signTransaction`, `personal_sign`, or `eth_signTypedData_v4` to the chain's RPC, which refused it, and a transfer over the access key's limit never opened the screen for a new access key.

```ts
const { address } = getConnection(config)
await Actions.token.transferSync(config, { account: address, amount, to, token })
``` The provider also signs `eth_signTransaction` of the session's account with the access key.
