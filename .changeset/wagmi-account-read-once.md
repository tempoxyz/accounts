---
'accounts': patch
---

The `tempoId` connector sends one `GET /v1/account` for a session without an access key or an account, such as after a dialog's sign-in without an access key. Before, the connector's session subscriber and `connect` each sent a read.
