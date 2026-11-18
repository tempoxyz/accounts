---
'accounts': patch
---

With `open`, `redirect.signIn` rejects with the store's error before `open` when the reads of the stored chain selection and of the sign-out flag both fail, such as `Store.InvalidFileError` for a `Store.file` file that holds no valid JSON. Before, the user signed in on Tempo ID's pages, and the sign-in then rejected at the save of the session, after it revoked the issued refresh token.

A store that fails only the read of the stored chain selection, or an entry that throws `Store.InvalidValueError`, such as a corrupt row of `Store.postgres`, keeps the configured chain, and the sign-in opens, since the session saves under its own entry.
