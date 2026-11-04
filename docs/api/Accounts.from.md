# Accounts.from

## Overview

Returns an instance's configuration, with its defaults, and no session or plugin. [`Accounts.create`](Accounts.create.md) builds its own with it, as `accounts.config`, and takes the same parameters.

The scope always holds `openid` and `email`, since every authorization reads the user from the ID token.

## Usage

```ts
import { Accounts } from 'accounts'

const config = Accounts.from({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
})
const { scope, url } = config
```

## Return type

[`Accounts.Config`](types.md#config)

The configuration, with `chainId`, `clientId`, `scope`, and `url` filled in.

## Parameters

### chainId (optional)

- **Type:** `number`
- **Default:** Tempo mainnet, `4217`, or Tempo testnet, `42431`, with `dev`

The chain that the app's access keys act on, unless a sign-in's `accessKey.chainId` names another.

```ts
import { tempoTestnet } from 'viem/tempo/chains'

const config = Accounts.from({ chainId: tempoTestnet.id })
```

### clientAssertion (optional)

- **Type:** `ClientAssertion.Signer`

Signs a new [client assertion](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions) for each request that authenticates the app, for an app with `private_key_jwt`. Only a backend holds one. Leave out `clientSecret` with it.

```ts
const config = Accounts.from({
  clientAssertion: ClientAssertion.fromPrivateKey({ privateKey: jwk }),
  clientId: env.CLIENT_ID,
})
```

### clientId (optional)

- **Type:** `string`
- **Default:** The page's origin, in a browser

The app's client ID. It is one of these:

| Client ID                                            | For                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| The ID of the app's registration                     | A registered OAuth app, such as `client_…`                                                                                              |
| The URL of the app's metadata document               | An app that publishes its metadata                                                                                                      |
| The page's origin, such as `https://app.example`     | A web app without a registration, or a localhost origin in development                                                                  |
| `cli:` and the CLI's name, such as `cli:acme-deploy` | A CLI without a registration, as [Unregistered CLIs](https://github.com/tempoxyz/id/blob/main/docs/apps.md#unregistered-clis) describes |

Outside a browser, the call needs it.

```ts
const config = Accounts.from({ clientId: 'client_…' })
```

### clientSecret (optional)

- **Type:** `string`

The app's client secret, which each request that authenticates the app sends. Only a backend holds one.

```ts
const config = Accounts.from({
  clientId: env.CLIENT_ID,
  clientSecret: env.CLIENT_SECRET,
})
```

### dev (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether the app's access keys act on Tempo testnet, unless `chainId` names another chain.

```ts
const config = Accounts.from({ dev: true })
```

### dpop (optional)

- **Type:** [`Dpop.Dpop`](types.md#dpop)

The key that binds the app's tokens ([RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)). Each token request sends a proof from it, and Tempo ID issues `DPoP` tokens. Without it, the tokens are Bearer tokens, and an app with [`dpop`](https://github.com/tempoxyz/id/blob/main/docs/dpop.md#required-proofs) cannot redeem a code.

```ts
const config = Accounts.from({
  clientId: 'tempo-cli',
  dpop: await Dpop.create(),
})
```

### fetch (optional)

- **Type:** `typeof globalThis.fetch`
- **Default:** The global `fetch`

Calls Tempo ID.

```ts
const config = Accounts.from({ fetch: loggedFetch })
```

### par (optional)

- **Type:** `boolean`
- **Default:** `true` with `clientSecret` or `clientAssertion`, and `false` otherwise

Whether a redirect or a dialog pushes each authorization request to `POST /oauth2/par` ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), so the browser's URL holds only `client_id` and `request_uri`. [`dialog.signIn`](plugins.dialog.md#dialogsignin) pushes it too, and then signs in with a popup. An app that [requires pushed requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md#required-pushed-requests) sets it, or holds a client secret or a client assertion. [`Accounts.create`](Accounts.create.md) takes no `par`. The [`dialog`](plugins.dialog.md#par-optional) and [`redirect`](plugins.redirect.md#par-optional) plugins take it instead.

```ts
const config = Accounts.from({ clientId: 'client_…', par: true })
```

### redirectUri (optional)

- **Type:** `string`
- **Default:** The page's origin, in a browser

Where Tempo ID redirects back to, such as a mobile app's custom scheme. Register it with the app first.

```ts
const config = Accounts.from({
  clientId: 'client_…',
  redirectUri: 'com.example.app:/callback',
})
```

### scope (optional)

- **Type:** `string`
- **Default:** `'offline_access'`, for a refresh token

The space-separated scopes of the app's tokens beyond `openid` and `email`.

```ts
const config = Accounts.from({ scope: 'offline_access profile' })
```

### store (optional)

- **Type:** [`Store.Store`](types.md#store)
- **Default:** IndexedDB, in a browser

Where an instance keeps its session, and where a redirect or a popup keeps its state until Tempo ID redirects back. It must store values without serializing them, since a browser access key is a non-extractable `CryptoKey`. With the default, [`redirect.signIn`](plugins.redirect.md#redirectsignin) also keeps the PKCE verifier, without the access key, in the tab's `sessionStorage`. A custom `store` holds the whole state alone.

```ts
const config = Accounts.from({
  clientId: 'client_…',
  store: Store.from({ getItem, removeItem, setItem }),
})
```

### url (optional)

- **Type:** `string`
- **Default:** `'https://id.tempo.xyz'`

Where Tempo ID runs, such as a self-hosted deployment. The actions call its JSON API under `/v1` and its OAuth endpoints under `/oauth2`.

```ts
const config = Accounts.from({ url: 'https://id.example.com' })
```

## Errors

### `Accounts.ClientIdRequiredError`

Thrown outside a browser without `clientId`, where no page's origin can serve as one.
