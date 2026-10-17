---
"accounts": patch
---

`Storage.filesystem` merges each write into the file as it is on disk instead of replacing it, so a CLI process no longer undoes changes another process saved after it loaded the store. A write takes a cross-process lock on the file, re-reads it, and applies only the fields this process changed since it last read or wrote them. `accounts` and `accessKeys` merge per record, keyed by address (and by account and chain for access keys), and `activeAccount` follows its account's address. When both processes change the same field or record, the later write wins it. A process that has no concurrent writer writes the same file contents as before.
