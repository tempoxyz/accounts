---
'accounts': patch
---

Changed `Store.file` to write nothing for a removal of an absent entry. Before, each such removal took the lock and replaced the file, and on a first run it created the file and its folders. A sign-in removes the signed-out mark, and a sign-out with the `viem` plugin removes the registration mark of its access key, so each one wrote the file once more.
