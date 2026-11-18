---
'accounts': patch
---

Added `dialog.updateAccessKey` and `dialog.revokeAccessKey` to the `dialog` plugin, and `dialog: 'iframe' | 'popup'` to `Actions.account.updateAccessKey` and `Actions.account.revokeAccessKey`. Each opens Tempo ID's approval page of the app's own access key in the dialog that the sign-in uses, or in a popup, and resolves with the transaction's hash. The account's owner signs on the page, a passkey included, so any app changes or revokes its own access key without `tempo-id:sign`. The TSDoc and docs of `challenge` no longer state that a challenge beside an access key needs `tempo-id:sign`: Tempo ID's pages show it for any app, an access key by `address` included.

```ts
const { transaction } = await accounts.dialog.updateAccessKey({
  accessKey: '0x9f10…0f08',
  limits: [{ limit: 20_000_000n, token: '0x20c0000000000000000000000000000000000000' }],
})
```
