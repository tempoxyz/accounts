# Access keys

## Overview

An access key is a key that the app holds, which acts for the user's Tempo Account within its limits until it expires. Each sign-in with `accessKey` authorizes one, and the session holds it as `key`. The [`viem`](../api/plugins.viem.md) plugin's client signs transactions with it.

```ts
import { Accounts } from 'accounts'
import { dialog, viem } from 'accounts/plugins'
import { tempo } from 'viem/tempo/chains'

const accounts = Accounts.create({
  // 1. Each sign-in requests an access key that may spend up to 10 OUSD for a day.
  accessKey: {
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  },
  plugins: [dialog(), viem()],
})

// 2. The sign-in authorizes the access key, and the session holds it.
const session = await accounts.dialog.signIn()

// 3. Send with it. The first transaction registers the access key on chain.
const { receipt } = await accounts.token.transferSync({
  amount: 10_000n,
  to: '0x…',
  token: Addresses.ousd,
})
```

1. The instance resolves `accessKey` at each sign-in, so `'1d'` counts from the sign-in. `'ousd'` resolves to the token's address on the chain, and `'10'` to base units. Without `scopes`, the access key may call `transfer` and `transferWithMemo` on OUSD, and `open` and `topUp` on the channel reserve for MPP sessions.
2. The sign-in creates the access key, a non-extractable WebCrypto P256 key in a browser, else secp256k1. It returns the key authorization that the user's Tempo Account signed, as `session.key`, which the instance saves.
3. The client's account attaches the key authorization to transactions until the chain registers the access key.

`accessKey` requests the access key, and sets its chain, expiry, limits, and scopes, as [`Permissions`](../api/types.md#permissions) describes. A sign-in without `accessKey` authorizes no access key. The library fills only `chainId`, from the instance's chain, and `scopes`, from `limits`. Name `limits`, or Tempo ID refuses the access key with [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions).

Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry): the app's refresh token lifetime from the sign-in, at most one year. The default refresh token lifetime is 30 days.

Headless sign-ins (`authorize`, `email.signIn`, `passkey.signIn`) must stay within the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), unless the app holds `tempo-id:sign`. Sign-ins with a page (`dialog.signIn`, `redirect.signIn`, `device.signIn`, `backend.start`) may exceed it, since the user approves the limits.

## Recipes

### Request another access key for one sign-in

Each sign-in takes `accessKey`, which overrides the instance's for that sign-in. `false` signs in without an access key.

```ts
const session = await accounts.dialog.signIn({
  accessKey: {
    expiry: '30d',
    limits: [{ limit: '100', period: '1d', token: 'ousd' }],
  },
})
```

### Authorize an access key without a sign-in

`accounts.authorize` requests a new access key for the user's Tempo ID session, with no sign-in, such as when the app needs a higher limit. It takes `accessKey` as a sign-in does, within the headless ceiling.

```ts
const session = await accounts.authorize({
  accessKey: {
    expiry: '1h',
    limits: [{ limit: '50', token: 'ousd' }],
  },
})
```

### Allow an access key to approve a spender

A limit's `spenders` adds an `approve` scope for those contracts, which then move the token within the access key's limit.

```ts
const session = await accounts.dialog.signIn({
  accessKey: {
    expiry: '1d',
    limits: [{ limit: '10', spenders: ['0x…'], token: 'ousd' }],
  },
})
```

### Name the scopes

`scopes` replaces the scopes that the library fills from `limits`. Build them with Viem's `Scopes`.

```ts
import { Addresses, Scopes } from 'viem/tempo'

const session = await accounts.dialog.signIn({
  accessKey: {
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
    scopes: [Scopes.tip20(Addresses.ousd).transfer({ recipients: ['0x…'] })],
  },
})
```

### Authorize an access key on another chain

`accessKey.chainId` names the access key's chain in place of the instance's.

```ts
import { tempoTestnet } from 'viem/tempo/chains'

const session = await accounts.dialog.signIn({
  accessKey: { ...permissions, chainId: tempoTestnet.id },
})
```

### Authorize an access key on a passkey-owned account

A passkey, such as a wallet.tempo passkey, signs an access key on the app's page when its relying party covers the page. `passkey.signIn` and `email.signIn` run its ceremony. `accounts.authorize` runs it with `passkey: true`, so call it from a click. On another page, the call throws `webauthn_required`, so authorize through a sign-in with a page, whose approval page asks the passkey to sign.

```ts
button.onclick = async () => {
  const session = await accounts
    .authorize({ passkey: true })
    .catch((error: unknown) => {
      if (
        error instanceof Accounts.RequestError &&
        error.reason === 'webauthn_required'
      )
        return accounts.dialog.signIn()
      throw error
    })
}
```

### Bind a challenge to the access key's signature

An app with the `tempo-id:sign` scope can pass a [challenge](https://github.com/tempoxyz/id/blob/main/docs/challenges.md), such as a sign-in message from its backend. Tempo ID binds its hash as the key authorization's witness, so the owner's signature proves the Tempo Account to the backend. A sign-in without `accessKey` takes no challenge, and throws [`Accounts.ChallengeWithoutKeyError`](../api/errors.md#accountschallengewithoutkeyerror).

```ts
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { hashMessage } from 'viem'

// In the app: send the account and the signed authorization, never the access key.
const session = await accounts.dialog.signIn({ challenge })
const { account, keyAuthorization } = session.key!
await sendToBackend({ account, keyAuthorization })

// In the backend: check the witness, then the signer.
const signed = KeyAuthorization.fromRpc(keyAuthorization)
if (signed.witness !== hashMessage(challenge))
  throw new Error('Wrong challenge.')
if (
  !SignatureEnvelope.verify(signed.signature, {
    address: account,
    payload: KeyAuthorization.getSignPayload(signed),
  })
)
  throw new Error('Wrong signer.')
```

The chain does not spend a witness, so the backend spends each challenge on its first successful check.

### Authorize an access key without bounds

A first-party app with the `tempo-id:sign` scope may request an access key without bounds in a headless sign-in, and its access key skips the headless ceiling. `expiry: false` requests an access key that never expires. Without `limits`, the access key spends any amount of any token. `scopes: 'any'`, or no `scopes` and no `limits`, lets the access key make any call. Every other flow, and every other app, receives [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions) for absent `limits` or `scopes`, and [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry) for `expiry: false`.

```ts
// An access key that never expires, spends any amount, and makes any call.
const session = await accounts.authorize({ accessKey: { expiry: false } })

// An access key that never expires, spends up to 10 OUSD, and makes any call.
const limited = await accounts.authorize({
  accessKey: {
    expiry: false,
    limits: [{ limit: '10', token: 'ousd' }],
    scopes: 'any',
  },
})
```

> [!WARNING]
> Keep an access key without bounds as secret as the account's owner. It sends any transaction for the Tempo Account, with no expiry.

## Learn more

- [Sessions](sessions.md)
- [Viem](viem.md)
- [`Permissions`](../api/types.md#permissions)
- [Access keys](https://github.com/tempoxyz/id/blob/main/docs/access-keys.md)
- [Permissions](https://github.com/tempoxyz/id/blob/main/docs/permissions.md)
- [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md)
