/**
 * Demonstrates a sign-out with `everywhere` from an app that is not first-party: the call rejects,
 * and the session stays. A sign-out without `everywhere` then ends the session of the app.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the demo is not a
 * first-party app, and Tempo ID ends no Tempo ID session for it.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** An action of the demo. */
type Action = 'signIn' | 'signOut' | 'signOutEverywhere'

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }
  | { type: 'signedOut' }

/**
 * Signs a user in, requests a sign-out of every app, which the instance refuses, and signs the user
 * out of the app.
 */
export default function EndAllSessions() {
  const session = accounts.useSession()
  // The message of a refused sign-out of every app, which stays after the sign-out of the app.
  const [refusal, setRefusal] = useState<string>()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: Action, fn: () => Promise<Status>) {
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
    if (user) return `Signed in as ${user.email}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const everywhereDetail = (() => {
    if (failed?.action === 'signOutEverywhere')
      return <span role="alert">{failed.message}</span>
    if (refusal)
      return (
        <>
          <span role="alert">{refusal}</span>
          {user && ` The status is still ${session.status}.`}
        </>
      )
    return undefined
  })()
  const signOutDetail = (() => {
    if (failed?.action === 'signOut')
      return <span role="alert">{failed.message}</span>
    if (status.type === 'signedOut')
      return `Signed out of this app. The status is ${session.status}.`
    return undefined
  })()
  // A refused step shows no check, and stays beside the step that follows it.
  const everywhereState = user || refusal ? 'active' : 'idle'
  const signOutState = (() => {
    if (status.type === 'signedOut') return 'done'
    if (user && refusal) return 'active'
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
                setRefusal(undefined)
                return { type: 'idle' }
              })
            }
          >
            {status.type === 'signedOut' ? 'Sign in again' : 'Sign in'}
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={everywhereDetail}
        label="Sign out of every app."
        number={2}
        state={everywhereState}
      >
        <DemoButton
          disabled={!user || pending !== undefined}
          loading={pending === 'signOutEverywhere'}
          onClick={() =>
            run('signOutEverywhere', async () => {
              try {
                await accounts.signOut({ everywhere: true })
              } catch (error) {
                if (!(error instanceof Accounts.EverywhereNotAllowedError))
                  throw error
                // The refusal ends no session, so the last step follows it.
                setRefusal(error.message)
                return { type: 'idle' }
              }
              return { type: 'signedOut' }
            })
          }
        >
          Sign out of every app
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={signOutDetail}
        label="Sign out of this app only."
        number={3}
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
