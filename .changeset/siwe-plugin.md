---
'accounts': patch
---

Added the `siwe` plugin, which signs users in on a backend with a Sign-In with Ethereum message (EIP-4361) and stores each session with the `backend` plugin, under the same cookie. `accounts.handler` serves `POST /siwe/challenge` and `POST /siwe/verify`, and `accounts.siwe.challenge` and `accounts.siwe.approve` verify an approval of each change once, by the message's nonce. Its `origin` option binds each message to the app's public origin. Added `dialog.signIn({ method: 'siwe' })` with `backend`, which opens the dialog before it requests the message, and `dialog.signMessage`, which signs a message, or the message that a function returns, with the user's Tempo Account and sets no session. Added the `backend` plugin's `accessToken` option, with which `session.get(request)` also verifies an access token in the `Authorization` header.

```ts
const accounts = Accounts.create({
  clientId: 'https://app.example',
  plugins: [backend({ store }), siwe({ origin: 'https://app.example' })],
})

const { message } = await accounts.siwe.challenge({ request, session, statement })
await accounts.siwe.approve({ message, request, session, signature, statement })
```
