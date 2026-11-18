---
'accounts': patch
---

Fixed `accounts.funding.open` and `Actions.funding.open` outside a browser page, such as on a server, in a CLI, or in a React Native app. Each mode now throws `Actions.funding.PageRequiredError` before it reads the account. Before, the call threw `ReferenceError: window is not defined`, or a `TypeError` on React Native's `window` without `location`, and `mode: 'redirect'` first loaded the session and read the account from Tempo ID.
