---
'accounts': patch
---

Fixed `react`'s retry of a refused redirect. If the default authorization of `useSession` throws `redirect_refused`, such as for a `url` that redirects, the plugin now treats it as a decline, so a component that mounts later authorizes nothing until the status changes. Before, the plugin treated the refusal as transient, since it has status 0, and authorized again at each mount after 30 seconds, which met the same redirect.

```tsx
const { isSignedOut } = accounts.useSession()
```
