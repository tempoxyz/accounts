# backend

## Overview

The plugin of a backend's sessions: one for each of its users, under an opaque session ID that the browser holds in an `HttpOnly` cookie. It adds `tempoId.backend.start`, `complete`, `save`, `get`, `fetch`, and `end`. The tokens and the access key stay on the server, so an XSS on the app's pages cannot copy one.

Concurrent requests of one session share one refresh. A [reused refresh token](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#token-refresh) fails with `invalid_grant`, and revokes every refresh token of the app for the user. The plugin holds the refreshes in progress, so one process serves every request of a session:

| Option      | Sessions live in                                                                                   | One process for each                     |
| ----------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `store`     | A [`Store`](types.md#store), such as Postgres or Redis                                             | Server, or replica with session affinity |
| `namespace` | One Durable Object for each session ID, from [`DurableObject.sessions`](DurableObject.sessions.md) | Session ID, on Cloudflare Workers        |

A backend's instance holds no session of its own, since it serves many users. With `store`, the plugin holds the refreshes in progress, so create the instance once for the process. With `namespace`, each object holds them, so a Worker creates the instance in each request.

## Usage

```ts
import { Accounts, Store } from 'accounts'
import { backend } from 'accounts/plugins'

const tempoId = Accounts.create({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  plugins: [backend({ store: Store.redis(redis) })],
})

// GET /login
const { id, url } = await tempoId.backend.start({ redirectUri })
// GET /callback, with the session ID from the cookie
await tempoId.backend.complete({ id, url: request.url })
// Any later request
const session = await tempoId.backend.get({ id })
```

## Return type

`Plugin<'backend', { complete, end, fetch, get, save, start }>`

`complete` and `get` return a [`BackendSession`](types.md#backendsession): the [session](types.md#session) without `idToken` and `refreshToken`, which stay in the store, and with `sid`, the Tempo ID session that signed the user in.

### backend.complete

- **Type:** `(parameters: { id: string; url: string }) => Promise<BackendSession>`

Redeems the callback of `start` for the session `id`, as [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md) does, and stores the session. A second callback for the same ID redeems no code. A callback with a missing or mismatched `state` keeps the pending sign-in. A matching callback consumes it before the token exchange, also when that exchange fails.

```ts
const session = await tempoId.backend.complete({ id, url: c.req.url })
```

### backend.end

- **Type:** `(parameters: { id: string }) => Promise<void>`

Revokes the session's refresh token at `POST /oauth2/revoke`, then deletes the session. A refresh or a `complete` in progress finishes first, so `end` revokes the token that it stored.

```ts
await tempoId.backend.end({ id })
```

### backend.fetch

- **Type:** `(parameters: { id: string; init?: RequestInit; url: string | URL }) => Promise<Response | undefined>`

Sends a request with the session's access token, as [`Actions.fetch`](Actions.fetch.md) does, after a refresh if necessary. `init` holds the request's other options, and its `Authorization` and `DPoP` headers are replaced. Returns `undefined` without a session, and sends no request.

```ts
const response = await tempoId.backend.fetch({
  id,
  url: 'https://api.example.com/me',
})
```

### backend.get

- **Type:** `(parameters: { id: string }) => Promise<BackendSession | undefined>`

Returns the session, after a refresh if its access token expires within 30 seconds. A session without a refresh token, from a sign-in without `offline_access`, lasts until its access token expires. Returns `undefined` if the session never existed, ended, or Tempo ID refused its refresh token.

```ts
const session = await tempoId.backend.get({ id })
if (!session) return c.redirect('/login')
```

### backend.save

- **Type:** `(parameters: { id?: string; session: Session }) => Promise<{ id: string }>`

Stores a session from a sign-in without a redirect, such as the [`email`](plugins.email.md) plugin's [backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md), under `id` or a new session ID, and returns the ID. A new ID is 32 random bytes in URL-safe Base64.

```ts
const session = await tempoId.email.signIn({ code, email: address, userIp })
const { id } = await tempoId.backend.save({ session })
```

### backend.start

- **Type:** `(parameters?: backend.start.Parameters) => Promise<{ id: string; url: string }>`

Starts a redirect sign-in through [`Actions.redirect.createUrl`](Actions.redirect.createUrl.md), and stores its state for 10 minutes. Returns the session ID, for an `HttpOnly` cookie, and the URL to redirect to.

```ts
const { id, url } = await tempoId.backend.start({
  redirectUri: new URL('/callback', c.req.url).href,
})
setCookie(c, 'sid', id, { httpOnly: true, path: '/', sameSite: 'Lax' })
return c.redirect(url, 302)
```

## Parameters

The plugin takes one of `store` and `namespace`.

### namespace

- **Type:** `backend.Namespace`

The Durable Object namespace of [`DurableObject.sessions`](DurableObject.sessions.md), which holds each session in the object that its ID names. The object's name holds the app's client ID beside the session ID, so one class serves several apps.

```ts
const tempoId = Accounts.create({
  clientId: env.CLIENT_ID,
  clientSecret: env.CLIENT_SECRET,
  plugins: [backend({ namespace: env.SESSIONS })],
})
```

### store

- **Type:** [`Store`](types.md#store)

Where the sessions and the redirects in progress live, such as [`Store.postgres`](Store.postgres.md) or [`Store.redis`](Store.redis.md). Keys start with `tempo-id:session:` and `tempo-id:pending:`. A pending entry passes `expiresAt` to `setItem`, so the store deletes an abandoned sign-in.

```ts
const tempoId = Accounts.create({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  plugins: [backend({ store: Store.postgres(pool) })],
})
```

> [!WARNING]
> Keep `store` on the server. Each value holds a refresh token, and an access key's private key.

### backend.start parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key. The user approves the access key, so it may exceed the headless ceiling.

```ts
const { id, url } = await tempoId.backend.start({ accessKey: false })
```

#### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account, which opens the funding page, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.

```ts
const { id, url } = await tempoId.backend.start({ funding: { amount: '10' } })
```

#### id (optional)

- **Type:** `string`
- **Default:** 32 random bytes in URL-safe Base64

The session ID.

```ts
const { url } = await tempoId.backend.start({ id: existing })
```

#### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`

Where Tempo ID redirects back to.

```ts
const { id, url } = await tempoId.backend.start({
  redirectUri: 'https://app.example/callback',
})
```

## Errors

### `Accounts.PendingNotFoundError`

Thrown by `complete` without a redirect in progress for the session ID. This happens for a callback that arrives twice, even at the same time, or more than 10 minutes after `start`. Start the sign-in again.

### `Accounts.RequestError`

Thrown by `complete` for a forged `state` or a refused code, as [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md#errors) lists. Thrown by `get` and `fetch` when a refresh fails for a reason other than `invalid_grant`. A refusal with a 4xx status keeps the session for the next request. A failure without a response, or with a 5xx status, ends the session, since Tempo ID may have rotated the refresh token. Thrown by `end` when the revocation fails. The session stays, so a later `end` revokes it again.
