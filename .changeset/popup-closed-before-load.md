---
'accounts': patch
---

Fixed `dialog.signIn` hanging when the user closes a popup whose Tempo ID page never loaded, such as offline. It now rejects with the `AbortError` "The user closed the sign-in.", as it does for a popup closed after its page loads. A popup whose handle this page's `Cross-Origin-Opener-Policy` severs still counts as open.
