---
'accounts': patch
---

Fixed `LogoutToken.create`'s `verify` for a logout token whose `aud` names several apps. It throws `LogoutToken.InvalidError` if any app of `aud` is outside `clientIds`. Before, such a token verified if one app of `aud` was in `clientIds`, and `clientId` held the first app of `aud`, which `clientIds` did not always hold.
