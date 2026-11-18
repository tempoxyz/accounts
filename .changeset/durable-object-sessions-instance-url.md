---
'accounts': patch
---

Fixed `DurableObject.sessions` calling `https://id.tempo.xyz` when its `config` names no `url`: the object now uses the `url` of the Worker's instance, as `Sessions.durableObject` sends it with each call.
