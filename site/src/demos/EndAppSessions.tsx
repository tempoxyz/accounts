/**
 * Demonstrates a sign-out of the app: a sign-in through Tempo ID's dialog, then `signOut`, with the
 * status of the session after each step. It runs the calls of `examples/web`.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'signIn' | 'signOut'; type: 'pending' }
  | { action: 'signIn' | 'signOut'; message: string; type: 'failed' }
  | { type: 'idle' }
  | { type: 'signedOut' }

/** Signs a user in, then signs the user out of the app, and shows the status of the session. */
export default function EndAppSessions() {
  const session = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: 'signIn' | 'signOut', fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (session.isPending)
    return <span aria-label="Loading" data-demo-spinner="" />

  // An action that runs disables each control, so no result settles after a later one.
  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  const user = session.session?.user

  const signInDetail = (() => {
    if (user)
      return `Signed in as ${user.email}. The status is ${session.status}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signOutDetail = (() => {
    if (failed?.action === 'signOut')
      return <span role="alert">{failed.message}</span>
    if (status.type === 'signedOut')
      return `Signed out of the app. The status is ${session.status}.`
    return undefined
  })()
  const signOutState = (() => {
    if (status.type === 'signedOut') return 'done'
    if (user) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in, or create a Tempo Account."
        number={1}
        state={user ? 'done' : 'active'}
      >
        {!user && (
          <DemoButton
            disabled={pending !== undefined}
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                await accounts.dialog.signIn()
                return { type: 'idle' }
              })
            }
          >
            {status.type === 'signedOut' ? 'Sign in again' : 'Sign in'}
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={signOutDetail}
        label="Sign out of the app."
        number={2}
        state={signOutState}
      >
        <DemoButton
          disabled={!user || pending !== undefined}
          loading={pending === 'signOut'}
          onClick={() =>
            run('signOut', async () => {
              await accounts.signOut()
              return { type: 'signedOut' }
            })
          }
        >
          Sign out
        </DemoButton>
      </DemoStep>
    </>
  )
}
