---
'accounts': minor
---

Added `auth` to the `siwe` plugin on a page, which names the app's Sign-In with Ethereum routes. `dialog.signIn()`, and `pay()` without `account` while the instance holds no session, request the message at the click, while the dialog or the popup opens, post the signature to the verify route, and return its JSON object as `auth`. A payment whose verification fails resolves with `authError` and the transaction. `challenge` of `pay` and `dialog.signIn` also takes a function, which runs at the click.

```ts
const accounts = Accounts.create({ plugins: [siwe({ auth: '/api/auth/siwe' })] })

// POST /api/auth/siwe/challenge ← { chainId } → { message } or { id, message }
// POST /api/auth/siwe ← { address, id, message, signature }
const { address, auth, transaction } = await accounts.pay({ amount: '5', to, token: 'ousd' })
```

A `dialog.signIn()` with an access key and the plugin's `auth` signs in with one passkey prompt: the account signs the key authorization, whose witness is the message's hash. The page posts `{ address, id, keyAuthorization, message }` to the verify route with the sign-in's access token, and the backend's `siwe.complete` takes `keyAuthorization` and `request` in place of `signature`. `siwe({ accessTokens })` sets the options of the access tokens' verifier, such as `clientIds`.

Added `chainId` to `siwe.start`, and to the body of `POST /auth/siwe/challenge`, which names the message's chain. A chain outside the plugin's new `chains`, which defaults to the instance's chain, receives 400 `invalid_request`.

Added `POST /auth/siwe` to the `siwe` plugin's routes of `accounts.handler`, which verifies as `POST /auth/siwe/verify` does, so `siwe({ auth: '/api/auth/siwe' })` names them.

Added `token` to the `siwe` plugin on a backend, for an API on another origin than the page. The challenge route returns `{ id, message }`, the verify routes take `id` and return `{ session, token }`, and no route sets a cookie. `session.get(request)`, `GET /auth/session`, and `POST /auth/logout` read `Authorization: Bearer <token>`, and the routes answer the plugin's `origin` with CORS headers. `origin` also takes a list of the pages' origins.

```ts
siwe({ origin: 'https://app.example.com', token: true })
```
