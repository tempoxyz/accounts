---
'accounts': patch
---

`Store.memory` keeps a structured clone of each value, as IndexedDB does, and each read returns a new clone. A change to a value after its write, or to a value that a read returned, no longer changes the stored value until the next write. An instance's own session still holds the objects that a sign-in and `session.get` return, so its next save writes a change to them. A value that a structured clone refuses, such as a function, rejects the write.

A runtime without `structuredClone`, such as React Native on Hermes, keeps each value as it is, as before.
