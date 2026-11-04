# Actions

## Overview

`Actions` holds the low-level actions, one for each request or flow of Tempo ID. Each takes the configuration of an instance, `tempoId.config`, or the value of [`Accounts.from`](Accounts.from.md) without an instance, then an options object. An action keeps no session. It returns its result, and the app keeps it.

The instance and its plugins call these actions, and keep the session. An app calls them directly when it keeps its state itself, such as a backend that seals the session into a cookie, or for a request that no plugin sends, such as introspection.

| Instance member or plugin action       | Low-level action                                                                                                                                                                                                |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tempoId.authorize`                    | [`Actions.authorize`](Actions.authorize.md)                                                                                                                                                                     |
| `tempoId.account.get`                  | [`Actions.account.get`](Actions.account.get.md)                                                                                                                                                                 |
| `tempoId.account.upgrade`              | [`Actions.account.upgrade`](Actions.account.upgrade.md)                                                                                                                                                         |
| `tempoId.session.refresh`              | [`Actions.refresh`](Actions.refresh.md)                                                                                                                                                                         |
| `tempoId.signOut`                      | A revocation of the refresh token. With `everywhere`, then [`Actions.signOut`](Actions.signOut.md)                                                                                                              |
| `tempoId.email.sendCode`               | [`Actions.email.sendCode`](Actions.email.sendCode.md), or [`Actions.backend.email.sendCode`](Actions.backend.email.sendCode.md) on a backend                                                                    |
| `tempoId.email.signIn`                 | [`Actions.email.signIn`](Actions.email.signIn.md), or [`Actions.backend.email.signIn`](Actions.backend.email.signIn.md) on a backend                                                                            |
| `tempoId.passkey.available`            | [`Actions.passkey.available`](Actions.passkey.available.md)                                                                                                                                                     |
| `tempoId.passkey.prepare`              | [`Actions.passkey.prepare`](Actions.passkey.prepare.md)                                                                                                                                                         |
| `tempoId.passkey.register`             | [`Actions.passkey.register`](Actions.passkey.register.md)                                                                                                                                                       |
| `tempoId.passkey.signIn`               | [`Actions.passkey.signIn`](Actions.passkey.signIn.md)                                                                                                                                                           |
| `tempoId.dialog.signIn`                | [`Actions.dialog.signIn`](Actions.dialog.signIn.md), after [`Actions.dialog.preload`](Actions.dialog.preload.md)                                                                                                |
| `tempoId.dialog.callback`              | [`Actions.dialog.callback`](Actions.dialog.callback.md)                                                                                                                                                         |
| `tempoId.redirect.signIn`              | [`Actions.redirect.start`](Actions.redirect.start.md), or [`Actions.redirect.createUrl`](Actions.redirect.createUrl.md) and [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md) with `open` |
| `tempoId.session.get`, with `redirect` | [`Actions.redirect.complete`](Actions.redirect.complete.md)                                                                                                                                                     |
| `tempoId.redirect.prefetch`            | [`Actions.redirect.prefetch`](Actions.redirect.prefetch.md)                                                                                                                                                     |
| `tempoId.device.signIn`                | [`Actions.device.authorize`](Actions.device.authorize.md)                                                                                                                                                       |
| `tempoId.backend.start`, `complete`    | [`Actions.redirect.createUrl`](Actions.redirect.createUrl.md) and [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md)                                                                       |
| `tempoId.backend.fetch`                | [`Actions.fetch`](Actions.fetch.md)                                                                                                                                                                             |
| `tempoId.viem`, message signatures     | [`Actions.account.signMessage`](Actions.account.signMessage.md) and [`Actions.account.signTypedData`](Actions.account.signTypedData.md)                                                                         |
| `tempoId.accessKey`                    | [`Actions.account.revokeAccessKey`](Actions.account.revokeAccessKey.md) and [`Actions.account.updateAccessKey`](Actions.account.updateAccessKey.md)                                                             |

The actions without an instance member:

- [`Actions.fetch`](Actions.fetch.md): Sends a request with an access token, with a DPoP proof for a DPoP token.
- [`Actions.funding.complete`](Actions.funding.complete.md): Returns the result of a deposit page that returned through a redirect.
- [`Actions.funding.open`](Actions.funding.open.md): Opens Tempo ID's deposit page for one of the user's accounts, in a popup or through a redirect.
- [`Actions.oauth.introspect`](Actions.oauth.introspect.md): Checks whether a token is active.
- [`Actions.oauth.jwks`](Actions.oauth.jwks.md): Returns the signing keys that verify every token.
- [`Actions.oauth.userInfo`](Actions.oauth.userInfo.md): Returns the user that an access token names.
- [`Actions.realm.list`](Actions.realm.list.md): Lists the realms that the app reaches.

## Usage

```ts
import { Accounts } from 'accounts'
import { Actions } from 'accounts/internal'

// With an instance, the actions take its configuration.
const active = await Actions.oauth.introspect(tempoId.config, { token })

// Without an instance, `Accounts.from` returns the configuration.
const config = Accounts.from({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
})
const tokens = await Actions.refresh(config, { refreshToken })
```

## Return type

Each action returns its own result, as its page documents. A sign-in action returns an [`Authorization`](types.md#authorization): the tokens, the user, and, for a sign-in with `accessKey`, the access key as a Viem account and as data. An instance's sign-in returns a [`Session`](types.md#session) instead, which holds the access key as data alone.

## Parameters

### config

- **Type:** [`Accounts.Config`](types.md#config)

The configuration: `tempoId.config`, or the value of [`Accounts.from`](Accounts.from.md).

```ts
await Actions.signOut(tempoId.config)
```

### options

- **Type:** An object, which each action's page documents

Each action's own options, such as `accessKey`, which requests an access key. Without `accessKey`, a sign-in action authorizes no access key.

```ts
await Actions.email.sendCode(config, { email: 'user@example.com' })
```

## Errors

Each action throws [`Accounts.RequestError`](Accounts.RequestError.md) for each refusal that its page lists. The errors leave out `body_too_large`, `cross_site_request`, and `malformed_body`, which the package's own requests do not cause.
