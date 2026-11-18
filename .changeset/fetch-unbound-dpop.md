---
'accounts': patch
---

Changed `session.fetch`, `connection.get`, `connection.disconnect`, and `backend.fetch` to throw `invalid_dpop_proof`, with that `reason`, without a request when another DPoP key, or no key, binds the session's access token. Before, each sent a request that the API refused, with `invalid_token` for an instance without a key. Actions that take an access token from the caller, such as `Actions.oauth.userInfo`, keep their errors.
