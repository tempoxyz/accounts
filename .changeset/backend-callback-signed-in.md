---
'accounts': patch
---

Fixed `dialog.signIn` with the `backend` plugin to reject with `signedIn` when the backend's code exchange fails after the user signed in on Tempo ID, such as for an expired code or Tempo ID without an answer. The backend's `POST /callback` now answers such a refusal with `signed_in: true`. A denial still has no `signedIn`.
