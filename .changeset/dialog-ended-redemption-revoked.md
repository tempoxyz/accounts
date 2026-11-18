---
'accounts': patch
---

Changed `dialog.signIn` to revoke the refresh token of a sign-in that ends after Tempo ID issued its tokens. A `signal` that aborts, a close of the dialog, or a later sign-in during the redemption of the code, or a `signal` that aborts while the deposit page shows, no longer leaves a valid refresh token that no session holds.
