---
'accounts': patch
---

Added `accounts/test`, whose `dialog` plugin replaces the `dialog` plugin in end-to-end tests. Its `dialog.signIn` shows no dialog and sends no request. A local secp256k1 Tempo Account authorizes a new access key with the requested permissions, and the call commits the session as a sign-in does, so the `afterSignIn` hooks run and the `tempoId` connector of `accounts/wagmi` connects. The session holds a placeholder access token, so each request to Tempo ID fails.

```ts
import { dialog } from 'accounts/plugins'
import * as test from 'accounts/test'
import { tempoId } from 'accounts/wagmi'

const connector = tempoId({
  plugins: [import.meta.env.VITE_E2E ? test.dialog() : dialog()],
})
```
