# Viem

## Overview

The [`viem`](../api/plugins.viem.md) plugin adds `tempoId.viem`, a Tempo client from `viem/tempo` whose account follows the instance's session. Each sign-in sets the account to the session's access key, and a sign-out empties it, so no Viem action passes `account`.

```ts
import { Id } from 'accounts'
import { dialog, viem } from 'accounts/plugins'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

// 1. The client uses the instance's chain, Tempo mainnet by default.
const tempoId = Id.create({
  accessKey: () => ({
    expiry: Expiry.days(1),
    limits: [{ limit: 10_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  }),
  plugins: [dialog(), viem()],
})

// 2. A sign-in with a key sets the client's account.
await tempoId.dialog.signIn()

// 3. Viem sends with it, and attaches the key's authorization to the first
//    transaction, which registers the key.
const { receipt } = await tempoId.token.transferSync({
  amount: 10_000n,
  to: '0x…',
  token: ousd,
})
```

1. The plugin takes the options of `createClient` from `viem/tempo`, such as `feeToken`. Each client uses the chain's own RPC over HTTP, unless `transport` names another. A function in place of the options returns the options of each chain, such as `viem((chainId) => ({ transport: http(`/rpc/${chainId}`) }))`.
2. A read of the account before the sign-in throws [`Id.SignedOutError`](../api/errors.md#idsignedouterror). A later sign-in replaces the account.
3. Viem's wallet actions read the client's account.

## Recipes

### Use Tempo testnet

`dev: true` selects Tempo testnet for the instance's access keys and the default client.

```ts
const tempoId = Id.create({ dev: true, plugins: [dialog(), viem()] })
```

### Send on another chain

`tempoId.viem({ chainId })` returns the client of another chain, a Tempo chain or one whose options name its `chain`, with an account of the same session. An access key acts only on the chain of its authorization, so sign in with an access key on that chain, as [Access keys](access-keys.md#authorize-an-access-key-on-another-chain) shows.

```ts
import { tempoTestnet } from 'viem/tempo/chains'

const testnet = tempoId.viem({ chainId: tempoTestnet.id })
await testnet.token.transferSync({ amount: 10_000n, to: '0x…', token: ousd })
```

### Send for one session on a backend

A backend's instance holds no session, so its default client signs nothing. `tempoId.viem({ session })` returns a client whose account signs with that session's access key, such as one that [`backend.get`](../api/plugins.backend.md#backendget) returns. Create it inside the request.

```ts
const session = await tempoId.backend.get({ id })
if (!session) return c.redirect('/auth/start')
await tempoId.viem({ session }).token.transferSync({ amount, to, token: ousd })
```

### Sponsor fees

A sponsor pays the fees of a transaction through a relay, such as the Tempo API's relay at `https://api.tempo.xyz/rpc/relay/<chainId>`. The relay serves every RPC method, so it is the chain's whole transport: a plain `http` transport, with the API key in the `tempo-api-key` header. The relay's fee payer signs each transaction for its fees, with no `feePayer` parameter on the transaction. The access key still signs as the sender. A transaction with `feePayer: false` pays its own fees.

On a server, such as a backend that holds the user's session, the transport sends the API key itself. The `store` is the session store of [Backend](backend.md).

```ts
import { Id } from 'accounts'
import { backend, viem } from 'accounts/plugins'
import { http } from 'viem'
import { Expiry, Scopes } from 'viem/tempo'

const tempoId = Id.create({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  accessKey: () => ({
    expiry: Expiry.days(1),
    limits: [{ limit: 10_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  }),
  plugins: [
    backend({ store }),
    viem((chainId) => ({
      transport: http(`https://api.tempo.xyz/rpc/relay/${chainId}`, {
        fetchOptions: {
          headers: { 'tempo-api-key': process.env.TEMPO_API_KEY! },
        },
      }),
    })),
  ],
})

const session = await tempoId.backend.get({ id })
if (!session) return c.redirect('/auth/start')

await tempoId.viem({ session }).token.transferSync({
  amount: 10_000n,
  to: '0x…',
  token: ousd,
})
```

> [!WARNING]
> Keep the API key on a server. Each request with it spends the sponsor's balance, and anyone who reads a browser or mobile bundle can copy it.

A page holds no key that pays, so it sends through the app's own relay route. The page's `viem` plugin names the route as `relay`, and sends each fill, and each raw transaction without its fee payer's signature, to it. Every other request goes to the chain's RPC. The [`relay`](../api/plugins.relay.md) plugin serves the route on the app's server, with the Tempo API's sponsor or the app's own fee payer.

```ts
// The page.
import { Id } from 'accounts'
import { dialog, viem } from 'accounts/plugins'

const tempoId = Id.create({
  accessKey,
  plugins: [dialog(), viem({ relay: '/api/relay' })],
})

await tempoId.token.transferSync({ amount: 10_000n, to: '0x…', token: ousd })

// The app's server.
import { relay } from 'accounts/plugins'
import { privateKeyToAccount } from 'viem/accounts'

const server = Id.create({
  clientId: 'https://app.example',
  plugins: [
    relay({ apiKey: process.env.TEMPO_API_KEY! }),
    // or, with the app's own fee payer:
    // relay({ account: privateKeyToAccount(process.env.FEE_PAYER_KEY!) }),
  ],
})

app.post('/api/relay', (c) => server.relay.fetch(c.req.raw))
```

> [!WARNING]
> Guard the relay route, such as with the app's session. Any caller that reaches it spends the fee payer's balance.

A route relays one chain, the instance's `chainId`. Viem's fill names no chain, so an app that relays several chains serves a route for each, and returns each chain's `relay` from a function of the plugin, such as ``viem((chainId) => ({ relay: `/api/relay/${chainId}` }))``.

### Sign a message as the Tempo Account

`tempoId.signMessage` and `signTypedData` sign with the access key once the chain holds it, in a version 2 keychain envelope for the Tempo Account. On a page, the account's owner signs before that, as the [`viem`](../api/plugins.viem.md#overview) plugin describes, so a signature right after a sign-in verifies too. The app's backend verifies the signature with `tempoId.verifyMessage`, `verifyTypedData`, or `verifyHash`, with the user's access token for the app. The chain accepts any live access key of the account, so an access key's signature counts only when the token's [`access_keys`](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#access-keys) names the access key. Another app's access key on the same account does not count.

```ts
// In the app.
const signature = await tempoId.signMessage({ message })

// In the backend.
const valid = await tempoId.verifyMessage({
  accessToken,
  address,
  message,
  signature,
})
```

Without `accessToken`, an access key's signature does not count, and the owner's signature verifies as usual. A `mode` in the call, such as Viem's `allowAccessKey`, verifies the signature with Viem alone, without the app's check. A token that does not verify throws [`AccessToken.InvalidError`](../api/errors.md#accesstokeninvaliderror).

An access key signs nothing that verifies before its first transaction registers it on the chain. On a page, the account's owner signs until then, for an app with the `tempo-id:sign` scope on a chain with configurable accounts. For another app, the access key signs, and its signature verifies after the registration. Outside a page, and for a fixed `session`, the access key signs at once, so send its first transaction before a signature that a verifier checks. A session without an access key on the chain signs through the account's owner, on a page or not, such as after `email.signIn` with `accessKey: false`. A transaction then throws [`Id.KeyRequiredError`](../api/errors.md#idkeyrequirederror). To sign as the user's [configurable account](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#message-signing) with an access key in the session, an app with the `tempo-id:sign` scope calls [`Actions.account.signMessage`](../api/Actions.account.signMessage.md) or [`signTypedData`](../api/Actions.account.signTypedData.md).

### Revoke or limit an access key

`tempoId.accessKey.revoke`, `revokeSync`, `updateLimit`, and `updateLimitSync` change an access key of the user's account through Tempo ID, with the user's cloud wallet as the owner, since the chain refuses keychain changes from an access key. Each returns what Viem's own action returns. They need the app's `tempo-id:sign` scope, an access key that Tempo ID signed for the user, and a sign-in within the last 10 minutes. An access key that the chain has not registered registers with the new limit. With an `account` in the parameters, such as the account's root key, each is Viem's own action. [App revocation and changes](https://github.com/tempoxyz/id/blob/main/docs/access-keys.md#app-revocation-and-changes) describes the rules.

```ts
await tempoId.accessKey.updateLimitSync({
  accessKey,
  limit: 5_000_000n,
  token: ousd,
})
const { receipt } = await tempoId.accessKey.revokeSync({ accessKey })
```

### Use the access key with another client

[`AccessKey.toAccount`](../api/AccessKey.toAccount.md) returns the session's access key as a Viem access key account, for a client that the plugin does not create.

```ts
import { AccessKey } from 'accounts'
import { createClient } from 'viem/tempo'

const session = await tempoId.session.get()
const client = createClient({ account: AccessKey.toAccount(session!.key!) })
```

## Learn more

- [Access keys](access-keys.md)
- [`viem`](../api/plugins.viem.md)
- [Viem](https://viem.sh)
