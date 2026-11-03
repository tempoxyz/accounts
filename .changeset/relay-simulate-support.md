---
"accounts": patch
---

`Handler.relay` records that a node serves `tempo_simulateV1`, not only that it doesn't. Before every simulation the relay looked up a key that only an unsupported node ever wrote, so on supported nodes each fill missed, which a store shared across instances (such as one backed by the Cache API) answers with a remote read before the simulation can start. The lookup now hits the stored result.
