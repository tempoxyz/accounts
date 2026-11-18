/**
 * Demonstrates a sign-out of a backend: a sign-in on the site's server through Tempo ID's dialog,
 * the logout route, and a route that refuses the ended session. The routes of
 * `src/server/SignOut.ts` hold the session, as `examples/backend` does.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Path where the site's server mounts the handler of its instance. */
const basePath = '/api/sign-out'

/**
 * The page's instance. Its sign-in runs on the routes of the server, which keeps the session, so
 * the page holds no token. Tempo ID returns an origin without a registration to its root, which
 * the server's instance names too.
 */
const page = Accounts.create({
  chain: 'testnet',
  plugins: [dialog({ backend: basePath })],
  redirectUri: `${window.location.origin}/`,
})

/**
 * What the reset control of the frame signs out: the session of the server, since the page's
 * instance holds none.
 */
export const accounts = { signOut }

/** An action of the demo. */
type Action = 'read' | 'signIn' | 'signOut'

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/** The step that the demo reached. */
type Step =
  | { email: string; status: number; type: 'read' }
  | { email: string; type: 'ended' }
  | { email: string; type: 'signedIn' }
  | { type: 'loading' }
  | { type: 'signedOut' }

/** Reads the route that only a signed-in request reads. Returns its status and its user. */
async function read() {
  const response = await fetch(`${basePath}/profile`)
  if (!response.ok) return { email: undefined, status: response.status }
  const { email } = (await response.json()) as { email: string }
  return { email, status: response.status }
}

/** Ends the session of the server at the logout route, which also deletes the session cookie. */
async function signOut() {
  const response = await fetch(`${basePath}/auth/logout`, { method: 'POST' })
  if (!response.ok)
    throw new Error(`The logout route answered ${response.status}.`)
}

/**
 * Signs a user in on the server, signs the user out there, and reads a route that then refuses the
 * request.
 */
export default function EndBackendSessions() {
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [step, setStep] = useState<Step>({ type: 'loading' })

  /** Runs `fn` as `action`, and shows the step that it returns, or its failure. */
  function run(action: Action, fn: () => Promise<Step>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      (step) => {
        setStep(step)
        setStatus({ type: 'idle' })
      },
      (error: Error) =>
        setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  // The server holds the session, so the first render reads it from the server.
  useEffect(() => {
    const signedOut: Step = { type: 'signedOut' }
    // A failed read shows the first step. Both handlers settle the promise.
    void read().then(
      (result) =>
        setStep(
          result.email ? { email: result.email, type: 'signedIn' } : signedOut,
        ),
      () => setStep(signedOut),
    )
  }, [])

  if (step.type === 'loading')
    return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  // The user of the session, which each step after the sign-in keeps.
  const email = step.type === 'signedOut' ? undefined : step.email
  const ended = step.type === 'ended' || step.type === 'read'

  const signInDetail = (() => {
    if (email) return `Signed in as ${email}, on the server.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signOutDetail = (() => {
    if (ended) return 'The server ended the session, and deleted the cookie.'
    if (failed?.action === 'signOut')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const readDetail = (() => {
    if (step.type === 'read')
      return step.status === 401
        ? 'The server refused the request with 401, since it holds no session.'
        : `The server answered ${step.status}.`
    if (failed?.action === 'read')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signOutState = (() => {
    if (ended) return 'done'
    if (email) return 'active'
    return 'idle'
  })()
  const readState = (() => {
    if (step.type === 'read') return 'done'
    if (ended) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in on the server."
        number={1}
        state={email ? 'done' : 'active'}
      >
        {!email && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                const session = await page.dialog.signIn()
                return { email: session.user.email, type: 'signedIn' }
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={signOutDetail}
        label="Sign out on the server."
        number={2}
        state={signOutState}
      >
        {!ended && (
          <DemoButton
            disabled={!email}
            loading={pending === 'signOut'}
            onClick={() =>
              run('signOut', async () => {
                await signOut()
                // Only a signed-in step enables the control.
                return { email: email ?? '', type: 'ended' }
              })
            }
          >
            Sign out
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={readDetail}
        label="Read a route of the signed-in user."
        number={3}
        state={readState}
      >
        <DemoButton
          disabled={!ended}
          loading={pending === 'read'}
          onClick={() =>
            run('read', async () => {
              const { status } = await read()
              // Only a step after the sign-out enables the control.
              return { email: email ?? '', status, type: 'read' }
            })
          }
        >
          {step.type === 'read' ? 'Read again' : 'Read'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
