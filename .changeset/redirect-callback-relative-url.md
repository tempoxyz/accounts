---
'accounts': patch
---

Fixed the refusal of a callback URL that is not absolute, such as a request's path. `Actions.redirect.handleCallback`, `backend.complete`, and `redirect.signIn` with an `open` that resolves with such a URL, throw `Accounts.RequestError` with the code `invalid_request` and the field `url` before any request, and the error quotes none of the URL. Before, the parser's `TypeError` held the whole URL in Node's `input`, so the authorization code reached the app's logs.

```ts
const authorization = await Actions.redirect.handleCallback(auth, {
  pending,
  url: new URL(request.url, origin),
})
```

