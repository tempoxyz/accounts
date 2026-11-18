---
'accounts': patch
---

Fixed `redirect.signIn` with `open`, such as from `accounts/expo`, for a callback URL outside the redirect URI. A URL whose scheme, host, or path is not the redirect URI's throws `Accounts.RequestError` with `invalid_request` and the `field` `url`, before any request. Before, its code went to the token endpoint, since a system browser such as iOS's returns any URL on the app's scheme.

```ts
const session = await accounts.redirect.signIn()
```
