---
'accounts': patch
---

Fixed `signOut` with `everywhere` on a page that reloads before the logout's answer. The store now holds a signed-out mark of the logout, so `session.get` with `reauthorize` and the `react` plugin's first render sign nothing in. The logout's answer clears it, and after a reload during the logout, the next sign-in does. Before, the reload signed the user in again.

```ts
void accounts.signOut({ everywhere: true })
location.reload() // the page renders signed out
```
