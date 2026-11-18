---
'accounts': patch
---

Fixed the renewal of an expired access key while another user holds the browser's Tempo ID session. The renewal requests the expired access key's limits and scopes only for that access key's account, so the other user's session receives no access key.
