---
'accounts': patch
---

Added the `tokens` plugin, which adds `tokens.verifyAccessToken`, `tokens.verifyIdToken`, `tokens.verifyChallenge`, and `tokens.userInfo` to a server's instance. `verifyAccessToken` reads the access token of a request's `Authorization` header with the `Bearer` or `DPoP` scheme, checks a DPoP proof against the request's method and `url`, and returns the verified token, or `undefined`. `verifyIdToken` returns the claims of an ID token of the app, or `undefined`. `verifyChallenge` verifies the proof of a challenge for a verified access token, on the instance's chain, and throws `Challenge.InvalidError` for a proof that fails a check. `userInfo` reads the user of a verified access token, or of an access token itself. Added `compliance` to the verified access token, the screening state of each address of the user's Tempo Accounts. `Actions.oauth.userInfo` now throws its refusal with the reason `invalid_token`.

```ts
const accounts = Accounts.create({
  chain: 'testnet',
  clientId: 'https://app.example',
  plugins: [tokens()],
})

const token = await accounts.tokens.verifyAccessToken(request)
if (!token) return Response.json({ error: 'invalid_token' }, { status: 401 })
token.compliance[address] // 'clear'

const { account } = await accounts.tokens.verifyChallenge({
  accessToken: token,
  challenge,
  keyAuthorization,
})

const user = await accounts.tokens.userInfo({ accessToken: token })
```
