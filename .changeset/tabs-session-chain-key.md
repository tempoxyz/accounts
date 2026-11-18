---
'accounts': patch
---

Fixed the access key of a session that an instance reads from the store on another chain. If a tab on an earlier chain saved a refresh after another tab's `switchChain`, the switched tab and a new tab held that chain's access key as `key`, with its account. A session read from the store now holds its access key on the instance's chain as `key`, and its other access keys in `keys`.
