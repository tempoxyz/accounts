---
'accounts': patch
---

Added `Store['lock']`, which `Store.memory` and the store of `accounts/expo` set. Without Web Locks, such as in React Native, the instances on such a store refresh its session one at a time, so two instances send one refresh.
