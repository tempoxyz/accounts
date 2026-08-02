---
'accounts': minor
---

Rewrote `accounts/cli` onto the Wata device-code transport and replaced `CliAuth` and `Handler.codeAuth` with `Handler.deviceCode`.

```diff
- Provider.create({
-   host: 'https://wallet.example.com/api/auth/cli',
-   pollIntervalMs: 1000,
-   timeoutMs: 60_000,
- })
+ Provider.create({
+   host: 'https://wallet.example.com/auth/device',
+   pollingInterval: 1000,
+   timeout: 60_000,
+ })
```
