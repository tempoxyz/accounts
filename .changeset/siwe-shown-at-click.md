---
'accounts': patch
---

Changed `dialog.signIn()` and `pay()` with the `siwe` plugin's `auth` to show Tempo ID's page at the click, without a skeleton, while the app's server issues the message. The page shows the sign-in or the payment, and its actions wait until the message arrives. The frame receives the message in `tempo-id:embed.challenge`, or with `tempo-id:embed.uncover` for `/embed/pay?deferred=true`.
