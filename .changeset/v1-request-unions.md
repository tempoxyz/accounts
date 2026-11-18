---
'accounts': patch
---

The actions send the tagged request bodies of Tempo ID's `/v1` routes, and read the tagged `result` of a sign-in. The sign-in actions send `continue`, `allow`, and `link`. `Actions.account.revokeAccessKey`, `revokeAccessKeys`, and `upgrade` send `target`. No option or return type of an action changes. The package needs a Tempo ID that serves these bodies.
