---
'accounts': patch
---

Changed `device.signIn`, `device.authorize`, `device.poll`, `Actions.device.authorize`, and `Actions.device.poll` to throw `Accounts.RequestError` with `server_error` and status 0 when the code request or a poll receives no response, such as offline. Before, they threw the platform's `TypeError`.
