---
'accounts': patch
---

`device.signIn` rejects with `Store.InvalidFileError` before the code request for a `Store.file` file that holds no valid JSON. Before, the sign-in requested a code, the user approved it on Tempo ID's device page, and the save of the session then threw, so the approval was lost.

```ts
await accounts.device.signIn().catch((error: unknown) => {
  if (error instanceof Store.InvalidFileError) console.error(error.message)
})
```
