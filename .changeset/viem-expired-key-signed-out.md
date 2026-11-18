---
'accounts': patch
---

Changed the `viem` plugin's client outside a page, such as in React Native or Node, to refuse a transaction of an expired access key that the app holds on the client's chain before the node receives it. The transaction rejects with Viem's error, whose causes hold `Accounts.SignedOutError`, or `Accounts.KeyRequiredError` while the app's access key on another chain keeps the session. Reads, the owner's signatures, and `accessKey` changes that Tempo ID sends stay. Before, the node received the transaction and refused the access key as `Key not found`.
