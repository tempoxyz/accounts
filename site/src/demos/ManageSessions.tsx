/**
 * Demonstrates a component that manages the session of an instance with `accounts.useSession()`:
 * the status of the session, a sign-in button while signed out, and the user and a sign-out button
 * after the sign-in. It renders what the walkthrough of the guide builds.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. A sign-in passes `accessKey: false`, since the demo only renders the session.
 */
export const accounts = Accounts.create({
  accessKey: false,
  chain: 'testnet',
  plugins: [react()],
})

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'signIn' | 'signOut'; message: string; type: 'failed' }
  | { type: 'idle' }
  | { action: 'signIn' | 'signOut'; type: 'pending' }

/** Path data of the status row's icon, a pulse on a 24 by 24 grid, drawn as a stroke. */
const pulse = 'M22 12h-4l-3 9L9 3l-3 9H2'

/** Font of the status, which the row shows as code. Vocs pads a `code` element of a page. */
const mono = {
  fontFamily: 'var(--vocs-font-family-mono, ui-monospace, monospace)',
}

/** Renders the status of the session, a sign-in button, the user, and a sign-out button. */
export default function ManageSessions() {
  const { isPending, session, status: sessionStatus } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its failure. */
  function run(action: 'signIn' | 'signOut', fn: () => Promise<unknown>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      () => setStatus({ type: 'idle' }),
      (error: Error) =>
        setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  // An action that runs disables each control, so no result settles after a later one.
  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  const signInDetail = (() => {
    if (session) return `Signed in as ${session.user.email}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signInState = (() => {
    if (session) return 'done'
    if (isPending) return 'idle'
    return 'active'
  })()

  return (
    <>
      {/* The hook's read is no step that the user takes, so its row holds an icon, not a number. */}
      <div data-demo-step="" data-state="active">
        <span aria-hidden="true" data-demo-step-number="">
          <svg
            fill="none"
            height="1em"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            width="1em"
          >
            <path d={pulse} />
          </svg>
        </span>
        <div data-demo-step-text="">
          <span data-demo-step-label="">Read the session with the hook.</span>
          <span data-demo-step-detail="" role="status" style={mono}>
            status = {sessionStatus}
          </span>
        </div>
      </div>
      <DemoStep
        detail={signInDetail}
        label="Sign in, or create a Tempo Account."
        number={1}
        state={signInState}
      >
        {!session && (
          <DemoButton
            disabled={isPending || pending !== undefined}
            loading={pending === 'signIn'}
            onClick={() => run('signIn', () => accounts.dialog.signIn())}
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={
          failed?.action === 'signOut' && (
            <span role="alert">{failed.message}</span>
          )
        }
        label="Sign out."
        number={2}
        state={session ? 'active' : 'idle'}
      >
        <DemoButton
          disabled={!session || pending !== undefined}
          loading={pending === 'signOut'}
          onClick={() => run('signOut', () => accounts.signOut())}
        >
          Sign out
        </DemoButton>
      </DemoStep>
    </>
  )
}
