---
'accounts': patch
---

Added `funding.preload` to the `funding` plugin, and `Actions.funding.preload` and `Actions.funding.discard`. Each loads Tempo ID's deposit page in a hidden dialog, so the next `funding.open` of the same page in `frame` mode shows the loaded page at once, without the dialog's skeleton. Each preloaded frame serves one `open`, and a sign-out closes it. Without a session, outside a browser page, or where `open` opens no frame, `preload` loads nothing and never rejects.

```ts
button.addEventListener('pointerenter', () => accounts.funding.preload({ amount: '10' }))
button.addEventListener('click', () => accounts.funding.open({ amount: '10' }))
```
