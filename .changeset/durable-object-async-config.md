---
'accounts': patch
---

Added a `config` of `DurableObject.sessions` that returns a promise, such as one that imports a DPoP key. The object awaits it once, and concurrent calls share it. Before, the object spread the promise, so it held no client authentication or URL, and its sign-ins went to `https://id.tempo.xyz`.
