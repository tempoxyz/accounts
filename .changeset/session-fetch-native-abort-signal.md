---
'accounts': patch
---

Fixed `session.fetch` with React Native's `AbortSignal`, which has no `throwIfAborted` or `reason`. Before, each call with `init.signal` threw `TypeError: signal?.throwIfAborted is not a function`. An abort now rejects with the signal's `reason`, or an `AbortError` without one.
