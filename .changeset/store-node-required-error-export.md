---
'accounts': patch
---

Exported `Store.NodeRequiredError`, which `Store.file` throws in a runtime without Node's built-in modules. Before, the class was not exported, so `instanceof Store.NodeRequiredError` threw a `TypeError`.

```ts
try {
  Store.file('~/.config/my-cli/session.json')
} catch (error) {
  if (error instanceof Store.NodeRequiredError) console.error(error.message)
}
```
