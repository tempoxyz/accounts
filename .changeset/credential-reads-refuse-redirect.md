---
'accounts': patch
---

`Actions.account.connection`, `Actions.account.connections`, `Actions.account.get`, `Actions.oauth.userInfo`, the session check of `Actions.authorize`, and the account read after a sign-in no longer follow a redirect. A redirect in place of Tempo ID's response throws `Accounts.RequestError` with `redirect_refused`, as every other request with a credential does. Before, the request went on to the redirect's origin, which received the access token in a runtime that keeps the `Authorization` header, and the call returned that origin's answer as Tempo ID's, such as another user from `userInfo`. React Native's `fetch` ignores `redirect` and follows the redirect.
