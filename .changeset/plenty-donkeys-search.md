---
'accounts': minor
---

Added a `deviceCode` adapter (`accounts/deviceCode`) that forwards wallet RPC through the Wata device-code transport (RFC 8628 with PKCE), with a `tempoWallet` preset.

```ts
import { deviceCode } from 'accounts/deviceCode'

const adapter = deviceCode({
  name: 'Example CLI',
  onPrompt: ({ userCode, verificationUriFull }) => console.log(userCode, verificationUriFull),
  rdns: 'com.example.cli',
  url: 'https://wallet.tempo.xyz/auth/device',
})
```
