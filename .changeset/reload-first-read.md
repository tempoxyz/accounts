---
'accounts': patch
---

Changed the session's `reload` to read the store once when it awaits the first read of the stored session. Before, a page with the dialog plugin read the stored session twice from IndexedDB at each load.
