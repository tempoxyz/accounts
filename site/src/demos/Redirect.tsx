/**
 * Demonstrates a sign-in through a redirect: the page leaves for Tempo ID's pages, and the first
 * `accounts.session.get()` after the return completes the sign-in.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { redirect } from 'accounts/plugins'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as Return from './redirect/Return.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, and the root of that
 * origin is its redirect URI, so the site needs no registration. Each sign-in requests no access
 * key.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [redirect()],
})

/** Whether the page leaves for Tempo ID, or how the last sign-in failed. */
type Status =
  | { message: string; type: 'failed' }
  | { type: 'idle' }
  | { type: 'leaving' }

/** Signs a user in on Tempo ID's pages, and shows the user after the return. */
export default function Redirect() {
  const { session, status: sessionStatus } = useSyncExternalStore(
    accounts.session.status.subscribe,
    accounts.session.status.get,
  )
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Shows the failure of a sign-in. */
  function fail(error: Error) {
    setStatus({ message: error.message, type: 'failed' })
  }

  useEffect(() => {
    // A page that the browser restores from its cache, such as after "Back" on Tempo ID's page,
    // did not leave.
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setStatus({ type: 'idle' })
    }

    // A callback that reaches the page left no saved path. A page load without one drops the path
    // of a sign-in that never returned.
    Return.clear()
    // The first read of a page load completes a redirect that returned to it. A refused callback,
    // such as a denial, rejects it before the read of the saved session, so the status stays
    // `pending`. The second read applies no callback, and settles the status. The failure handler
    // settles each rejection.
    void accounts.session
      .get()
      .catch((error: Error) => {
        fail(error)
        return accounts.session.get()
      })
      .catch(fail)
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [])

  if (sessionStatus === 'pending')
    return <span aria-label="Loading" data-demo-spinner="" />

  return (
    <>
      <DemoStep
        detail={
          status.type === 'failed' && <span role="alert">{status.message}</span>
        }
        label="Leave the page for Tempo ID's sign-in."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={status.type === 'leaving'}
            onClick={() => {
              setStatus({ type: 'leaving' })
              Return.save()
              // The page leaves before the promise resolves. The failure handler settles a
              // sign-in that Tempo ID refuses before the page leaves.
              void accounts.redirect.signIn().catch(fail)
            }}
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={session && `Signed in as ${session.user.email}.`}
        label="Return to the page with the session."
        number={2}
        state={session ? 'done' : 'idle'}
      />
    </>
  )
}
