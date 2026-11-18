---
'accounts': patch
---

**Breaking:** The `backend` plugin takes `sessions`, and the `connections` option of `Accounts.create` takes `adapter`, in place of the Durable Object `namespace`. Each one reaches the sessions, or the connections, that live outside the process. `accounts/cloudflare` returns them for a Durable Object namespace: `Sessions.durableObject` returns the plugin's `sessions`, and `Connections.durableObject` takes the `resource` and returns the whole `connections` option. The types `backend.Namespace`, `backend.Stub`, `Connections.Namespace`, and `Connections.Stub` are now `Sessions.durableObject.Namespace`, `Sessions.durableObject.Stub`, `Connections.durableObject.Namespace`, and `Connections.durableObject.Stub` of `accounts/cloudflare`. `Connections.name` and `Connections.parseName` of `accounts/internal` are removed.

```diff
+import { Connections, Sessions } from 'accounts/cloudflare'
+
 const accounts = Accounts.create({
   clientId,
-  connections: { namespace: env.CONNECTIONS, resource },
-  plugins: [backend({ namespace: env.SESSIONS })],
+  connections: Connections.durableObject(env.CONNECTIONS, { resource }),
+  plugins: [backend({ sessions: Sessions.durableObject(env.SESSIONS) })],
 })
```

```diff
 type Env = {
-  CONNECTIONS: Connections.Namespace
-  SESSIONS: backend.Namespace
+  CONNECTIONS: Connections.durableObject.Namespace
+  SESSIONS: Sessions.durableObject.Namespace
 }
```
