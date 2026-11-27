---
'accounts': patch
---

Fixed `authorize` without an access key on an instance with `account: false` to send no `chain_id`, and to return no `account`, as `account: false` states.
