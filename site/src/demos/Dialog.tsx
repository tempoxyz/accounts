/**
 * Demonstrates a sign-in through Tempo ID's dialog, and a sign-out. It runs the calls of
 * `examples/web`, without the access key and the payment.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/**
 * The demo's instance, on Tempo testnet. It names no sign-in plugin, so it signs in through the
 * dialog. The page's origin is its client ID, so the site needs no registration.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'signIn' | 'signOut'; type: 'pending' }
  | { action: 'signIn' | 'signOut'; message: string; type: 'failed' }
  | { type: 'closed' }
  | { type: 'denied' }
  | { type: 'idle' }
  | { type: 'signedOut' }

/** Signs a user in through the dialog, shows the user, and signs out. */
export default function Dialog() {
  const { isPending, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: 'signIn' | 'signOut', fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus(
        ((): Status => {
          // The user ended the sign-in, which is no failure of it.
          if (error.name === 'AbortError') return { type: 'closed' }
          if (
            error instanceof Accounts.RequestError &&
            error.code === 'access_denied'
          )
            return { type: 'denied' }
          return { action, message: error.message, type: 'failed' }
        })(),
      ),
    )
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  const signInDetail = (() => {
    if (session) return `Signed in as ${session.user.email}.`
    if (status.type === 'closed') return 'The dialog closed without a sign-in.'
    if (status.type === 'denied') return 'The user denied the app.'
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signOutDetail = (() => {
    if (session) return undefined
    if (status.type === 'signedOut') return 'Signed out of the app.'
    if (failed?.action === 'signOut')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signOutState = (() => {
    if (session) return 'active'
    if (status.type === 'signedOut') return 'done'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in, or create a Tempo Account."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                await accounts.dialog.signIn()
                return { type: 'idle' }
              })
            }
          >
            Sign in
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
          disabled={!session}
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
