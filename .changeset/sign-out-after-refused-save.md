---
'accounts': patch
---

Fixed `signOut` after a sign-in whose save the store refused, such as a full disk or a store without a JSON form for a browser's access key. The store then held no session, so the sign-out revoked nothing, and the sign-in's refresh token stayed live. After a failed write, the sign-out now revokes the instance's session when the store holds none or another user's session, unless the store's rotations show that another context rotated its token.
