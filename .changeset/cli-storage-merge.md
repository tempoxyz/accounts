---
"accounts": minor
---

`Storage.filesystem` merges each write into the file as it is on disk instead of replacing it, so a CLI process no longer undoes changes another process saved after it loaded the store. A write takes a cross-process lock on the file, re-reads it, and applies only the fields this process changed since it last read or wrote them. `accounts` and `accessKeys` merge per record, keyed by address (and by account and chain for access keys); a record another process removed stays removed, and an access key is only added with its account. The active account follows its address, and `auth` follows the selected login. A disconnect or `accessKeys.clear()` replaces what it clears, a `wallet_connect` keeps the accounts it connects even over a concurrent logout, and `maxAccounts` still holds after a merge. When both processes change the same field or record, the later write wins it. A process that has no concurrent writer writes the same file contents as before.

Breaking changes:

- Unless the process runs as root, `Storage.filesystem` refuses a file whose directory another user owns, or that every user can write to without the sticky bit: loading and saving fail with `Lock.UnusableError`. The default `~/.tempo/wallet` is private, and sticky directories such as `/tmp` still work.
- `wallet_connect` and `wallet_disconnect` now fail if storage cannot save the connected or cleared state, instead of reporting success while storage is unchanged.
