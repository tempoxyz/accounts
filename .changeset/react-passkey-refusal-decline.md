---
'accounts': patch
---

Fixed `react`'s retry of a passkey prompt that the user dismissed. A failed passkey ceremony in the default authorization of `useSession` throws `webauthn_required` with status 0, which the plugin now treats as a decline, so a component that mounts later shows no new prompt until the status changes. Before, the plugin treated it as transient, and authorized again, with a new passkey prompt, at each mount after 30 seconds.

```tsx
const { isSignedOut } = accounts.useSession()
```
