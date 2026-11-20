---
'accounts': patch
---

Changed `Store.file` to write no file for a value and expiry that an entry holds already, so a second sign-out of a CLI, which writes the signed-out mark and the empty session again, takes no lock and leaves the file as it was.
