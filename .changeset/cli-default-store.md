---
'accounts': patch
---

Added a default `store` for a CLI. Outside a browser, an instance with a `cli:` client ID and no `store` keeps its session in the file that every CLI of the user shares: `~/.tempo/id/store.json`, or `id/store.json` in the folder that `TEMPO_HOME` names. Before, it held no session, so each run of the CLI signed in again. `Store.file()` without a path returns the same file, for a CLI with a registered client ID. An instance with any other client ID and no `store` still holds no session, as a backend's. `store: false` refuses the file, for a service that signs in many users with a `cli:` client ID: its instance holds no session and writes nothing, as before.

```ts
const accounts = Accounts.create({
  clientId: 'cli:acme-deploy',
  plugins: [device({ onCode })],
})
```
