# Sessions

## Overview

An instance holds the [session](../api/types.md#session) of its user: the tokens, the user, the app's access key, and the user's Tempo Account. Each sign-in sets it, and the instance saves it to its `store`, so a reload or a new run restores it. In a browser, the store defaults to IndexedDB. Elsewhere, the instance holds a session only with a `store`, such as [`Store.file`](../api/Store.file.md).

```ts
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'

const tempoId = Accounts.create({ plugins: [dialog()] })

// 1. On every page load, restore the saved session.
const session = await tempoId.session.get()

// 2. Render it now, and again at each sign-in and sign-out.
render(session)
tempoId.session.subscribe((next) => render(next))

// 3. Refresh the access token before a request that needs a fresh one.
async function token() {
  const current = await tempoId.session.get()
  if (current && current.expiresAt - 30_000 < Date.now())
    return (await tempoId.session.refresh())?.accessToken
  return current?.accessToken
}

// 4. Sign out of this app, and forget the saved session.
async function signOut() {
  await tempoId.signOut()
}
```

1. [`session.get`](../api/Accounts.create.md#sessionget) reads the saved session once, completes a redirect's callback with the `redirect` plugin, and returns `undefined` when the saved access key expired.
2. [`session.subscribe`](../api/Accounts.create.md#sessionsubscribe) calls its listener with each new session and the one before it. [`session.status`](../api/Accounts.create.md#sessionstatus) returns the session's [status](../api/types.md#sessionstatus) with `get`, and calls a listener at each change with `subscribe`, such as `reauthorizing` while an authorization renews an expired session. In React, [`tempoId.useSession()`](../api/react.react.md) reads it, as [React](react.md) describes.
3. [`session.refresh`](../api/Accounts.create.md#sessionrefresh) exchanges the refresh token for new tokens, saves them, and returns the session. An access key past its expiry needs a new sign-in.
4. [`signOut`](../api/Accounts.create.md#signout) empties the session at once, and revokes the refresh token. The user's Tempo ID session and the user's other apps stay signed in. With `everywhere: true`, a first-party app also ends the Tempo ID session for every app that relies on it. Any other app's `everywhere` throws. The access key works until its `expiry`, but the instance forgets it.

| Field          | Lifetime                                                |
| -------------- | ------------------------------------------------------- |
| `accessToken`  | Until `expiresAt`, 300 seconds after Tempo ID issues it |
| `refreshToken` | Until its use. Each refresh returns a new one           |
| `key`          | Until its authorization's `expiry`                      |

After a sign-out with `everywhere`, introspection reports the access tokens inactive. After any other sign-out, the Tempo ID session lives on, so introspection, and an API that verifies them locally, accept them until they expire.

A session belongs to one deployment, one client ID, and one chain, so an instance with another `url`, `clientId`, or `chainId` restores none of it. A sign-in that another sign-in or a sign-out overtakes throws [`Accounts.SupersededError`](../api/errors.md#accountssupersedederror), and the instance keeps the newer session.

## Recipes

### Choose where to store it

- **Browser:** the default IndexedDB store keeps the access key as a non-extractable `CryptoKey` pair, without exporting it.
- **CLI:** [`Store.file`](../api/Store.file.md) keeps the session in a file that only the user reads. The access key is a secp256k1 private key.
- **Device:** [`Store.from`](../api/types.md#store) wraps a secure store, such as `expo-secure-store`, as [Mobile apps](mobile.md) shows.
- **Backend:** an instance holds no session. The [`backend`](../api/plugins.backend.md) plugin keeps one for each user, as [Backends](backend.md) describes.

```ts
import { Accounts, Store } from 'accounts'

const tempoId = Accounts.create({
  clientId: 'cli:acme-deploy',
  store: Store.file('~/.config/acme-deploy/session.json'),
})
```

### Check the access key's expiry

[`Session.expired`](../api/Session.expired.md) reports an access key past its expiry, which the chain rejects. `session.get` empties such a session when it reads the store, but a page that stays open can hold one.

```ts
import { Session } from 'accounts'

const session = await tempoId.session.get()
if (session && Session.expired(session)) await tempoId.dialog.signIn()
```

### Call a Tempo API

Send the access token with [`Actions.fetch`](../api/Actions.fetch.md), which sends a Bearer token as one, and a DPoP token with its proof.

```ts
import { Actions } from 'accounts/internal'

const session = await tempoId.session.get()
const response = await Actions.fetch(tempoId.config, {
  accessToken: session!.accessToken,
  url: 'https://api.example/me',
})
```

### Bind the tokens to a key

Pass a [`Dpop.create`](../api/Dpop.create.md) key as `dpop`, so each token request sends a [DPoP proof](https://github.com/tempoxyz/id/blob/main/docs/dpop.md), and a stolen token is of no use without the key. Keep the key beside the session, since each refresh needs a proof from the key that bound the tokens. [`Actions.fetch`](../api/Actions.fetch.md) sends the access token with the `DPoP` scheme and a new proof on each request.

```ts
import { Accounts } from 'accounts'
import { Dpop } from 'accounts/internal'

const dpop = (await keys.get('dpop')) ?? (await Dpop.create())
await keys.set('dpop', dpop)
const tempoId = Accounts.create({ dpop })
```

### Keep the state without an instance

An app that keeps its state itself, such as in a sealed cookie, calls the low-level [`Actions`](../api/Actions.md) with [`Accounts.from`](../api/Accounts.from.md). Each sign-in action returns an [`Authorization`](../api/types.md#authorization), and [`Actions.refresh`](../api/Actions.refresh.md) returns new tokens. Refresh tokens rotate, so save the new tokens over the old ones.

```ts
import { Accounts } from 'accounts'
import { Actions } from 'accounts/internal'

const config = Accounts.from({ clientId: 'client_…' })
const tokens = await Actions.refresh(config, {
  refreshToken: saved.refreshToken!,
})
await save({ ...saved, ...tokens })
```

## Learn more

- [React](react.md)
- [Access keys](access-keys.md)
- [`Accounts.create`](../api/Accounts.create.md)
- [Access tokens](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md)
