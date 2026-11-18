---
'accounts': patch
---

Added the `dpop` plugin, which sets the instance's DPoP key and keeps it in a store, IndexedDB by default in a browser, so a restored session refreshes with the DPoP key that bound its tokens. The factory reads the DPoP key from the store, or creates one, whose private key cannot be exported, and writes it there. It replaces an entry that holds no DPoP key. Outside a browser without `store`, each call creates a new DPoP key.

```ts
import { Accounts } from 'accounts'
import { dpop } from 'accounts/plugins'
import { react } from 'accounts/react'

const accounts = Accounts.create({ plugins: [await dpop(), react()] })
```
