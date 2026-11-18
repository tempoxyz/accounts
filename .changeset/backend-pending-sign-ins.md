---
'accounts': patch
---

Fixed `GET /auth/callback` of the `backend` plugin refusing a sign-in that another tab of the browser started before the last one. `GET /auth/login` and `POST /auth/login` now keep the 3 newest sign-ins in progress in a new cookie, `__Host-tempo-id.pendings`, each with its `returnTo`. `__Host-tempo-id.pending` and `__Host-tempo-id.return` still hold the newest sign-in as before, so the earlier release completes it during a gradual deployment or a rollback. Each callback completes the sign-in that its `state` names, returns to that sign-in's `returnTo`, and keeps the others. Before, each sign-in replaced the cookie, so the callback of an earlier tab returned the dialog's relay page, and then `/?error=invalid_request`.

Only `POST /auth/callback` completes a sign-in of the dialog. Each entry leaves the cookie 10 minutes after its sign-in started, a crafted cookie names at most 3 sign-ins, and older sign-ins leave first when the cookie exceeds 3072 bytes.
