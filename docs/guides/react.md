# React

## Overview

A React app reads the instance's session with `accounts.useSession()`, which the [`react`](../api/react.react.md) plugin adds. The hook returns the session's [status](../api/types.md#sessionstatus), `pending`, `reauthorizing`, `signedIn`, or `signedOut`, with the session to show. It renders again at each change, and its first render restores the saved session. The instance lives at module scope, so every component reads the same session.

```tsx
import { Accounts } from 'accounts'
import { dialog, viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

// 1. One instance for the page, outside any render.
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  }),
  plugins: [dialog(), react(), viem()],
})

function App() {
  // 2. The status, and the session, or `undefined` while signed out.
  const { isPending, session } = accounts.useSession()
  if (isPending) return <p>Checking your Tempo session…</p>

  // 3. A sign-in sets the session, and the hook renders it.
  if (!session)
    return <button onClick={() => accounts.dialog.signIn()}>Sign in</button>

  return (
    <main>
      <p>Signed in as {session.user.email}</p>
      {/* 4. A sign-out empties the session, and the hook renders the button. */}
      <button onClick={() => accounts.signOut()}>Sign out</button>
    </main>
  )
}
```

1. [`Accounts.create`](../api/Accounts.create.md) at module scope creates one session for the page. In a browser, the instance preloads the dialog's frame as it is created.
2. [`accounts.useSession()`](../api/react.react.md) reads the status store with `useSyncExternalStore`. The status is `pending` until the saved session loads, and on a server render.
3. [`dialog.signIn`](../api/plugins.dialog.md#dialogsignin) sets the session, and every component that calls the hook renders it.
4. [`accounts.signOut`](../api/Accounts.create.md#signout) empties the session at once.

[`examples/web`](../../examples/web/main.tsx) runs this flow, and sends OUSD with `accounts.viem`.

## Recipes

### Show the error of a refused callback

With the `redirect` plugin, the first render completes the callback of a redirect. A refused callback, such as a denial, throws to the nearest error boundary.

```tsx
import { ErrorBoundary } from 'react-error-boundary'

createRoot(root).render(
  <ErrorBoundary fallback={<p>Sign-in failed. Try again.</p>}>
    <App />
  </ErrorBoundary>,
)
```

### Show the account while the access key renews

On a page of a first-party app, the first render authorizes the browser's Tempo ID session when the saved session's access key expired. While it runs, the status is `reauthorizing`, and `session` holds the expired session, so the page shows the account. The expired access key signs nothing, so the page disables its sends. If Tempo ID holds no session, the status becomes `signedOut`.

```tsx
const accounts = Accounts.create({
  plugins: [react(), viem()],
})

function Account() {
  const { isReauthorizing, session } = accounts.useSession()
  if (!session) return <SignIn />
  return (
    <>
      <p>Signed in as {session.user.email}</p>
      {isReauthorizing ? <p>Renewing your access key…</p> : null}
      <button disabled={isReauthorizing}>Send</button>
    </>
  )
}
```

### Show the pending state of a sign-in

A sign-in is a promise, so the component keeps its own state while it is pending. [`Accounts.SupersededError`](../api/errors.md#accountssupersedederror) marks a sign-in that a newer one overtook, whose session the hook already renders.

```tsx
function SignIn() {
  const [pending, setPending] = useState(false)
  return (
    <button
      disabled={pending}
      onClick={() => {
        setPending(true)
        accounts.dialog
          .signIn()
          .catch((error: unknown) => {
            if (!(error instanceof Accounts.SupersededError)) throw error
          })
          .finally(() => setPending(false))
      }}
    >
      Sign in
    </button>
  )
}
```

### Select one value of the session

[`accounts.session.actor`](../api/Accounts.create.md#sessionactor) is an XState actor, so `useSelector` from `@xstate/react` selects one value, and renders again only when that value changes.

```tsx
import { useSelector } from '@xstate/react'

function Email() {
  const email = useSelector(
    accounts.session.actor!,
    (snapshot) => snapshot.context.session?.user.email,
  )
  return <span>{email}</span>
}
```

`useSelector` reads no saved session. Call `accounts.useSession()` or `accounts.session.get()` once, such as in the root component.

## Learn more

- [Sessions](sessions.md)
- [`react`](../api/react.react.md)
- [Mobile apps](mobile.md)
