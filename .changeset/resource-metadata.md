---
'accounts': minor
---

Added `connections.metadata`, the access key policy and app key of an API that Tempo ID discovers without a registration. `accounts.handler` then serves the API's protected resource metadata (RFC 9728) at `/.well-known/oauth-protected-resource` and the resource's path, and its app's metadata document at `/client.json` under `basePath`. The policy names the handler's `/access-keys` route as its access key endpoint. The instance's client ID defaults to the document's URL, and it signs its client assertions with `metadata.privateKey`. `metadata.accessKey` names the access key policy, and `metadata.publicKeys` publishes more keys, such as the next key of a rotation.
