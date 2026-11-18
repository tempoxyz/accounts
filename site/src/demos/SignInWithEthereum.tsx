/**
 * Demonstrates a sign-in with a SIWE message that the site's server issues, the user's Tempo Account
 * signs in Tempo ID's dialog, and the server verifies. It runs the calls of `examples/siwe`.
 * @module
 */
'use client'

import { Accounts, Plugin } from 'accounts'
import { dialog } from 'accounts/plugins'
import { useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Path of the site's routes of the demo, where the server mounts its handler. */
const backend = '/api/siwe'

/**
 * Ends the session on the server at each sign-out. The server keeps the session, so the reset
 * control of the frame, which signs out of the instance, ends it through this plugin.
 */
const logout = Plugin.from({
  hooks: {
    async beforeSignOut() {
      await fetch(`${backend}/auth/logout`, { method: 'POST' })
    },
  },
  id: 'logout',
})

/**
 * The demo's instance, on Tempo testnet. Its dialog signs the server's messages, and the server's
 * routes keep the session. The page's origin is its client ID, so the site needs no registration.
 *
 * With `backend`, the dialog's redirect URI defaults to the backend's callback route, which Tempo ID
 * accepts only from the web app manifest of a deployed origin. A SIWE sign-in redirects nowhere, so
 * the instance names the origin's root, which every origin client ID may use.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [dialog({ backend }), logout],
  redirectUri: `${window.location.origin}/`,
})

/** The session that the page reads: the account that signed in. */
type Session = Awaited<ReturnType<typeof signIn>>

/** What the server reads from the session of a request. */
type Account = {
  /** Address of the account that signed in. */
  account: `0x${string}`
  /** When the session ends, in Unix milliseconds. */
  expiresAt: number
}

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'read' | 'signIn'; type: 'pending' }
  | { action: 'read' | 'signIn'; message: string; type: 'failed' }
  | { account: Account; type: 'read' }
  | { type: 'idle' }

/** Signs the user in with a message of the server, which the user's Tempo Account signs. */
function signIn() {
  return accounts.dialog.signIn({ method: 'siwe' })
}

/** Returns the session of the page's cookie from the server, or `null` without one. */
async function restore() {
  const response = await fetch(`${backend}/auth/session`)
  const body = (await response.json()) as { session: Session | null }
  return body.session
}

/** Returns what the server reads from the session of the page's cookie. */
async function read() {
  const response = await fetch(`${backend}/account`)
  if (response.status === 401)
    throw new Error('The session ended. Reset the demo, and sign in again.')
  if (!response.ok) throw new Error('The server returned no account.')
  return (await response.json()) as Account
}

/** Signs a user in with a SIWE message, then reads the session's account from the server. */
export default function SignInWithEthereum() {
  // `undefined` until the server returns the session of the cookie, which can hold an earlier one.
  const [session, setSession] = useState<Session | null>()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  useEffect(() => {
    let mounted = true
    // A failed read shows the sign-in. Both handlers settle the promise.
    void restore().then(
      (session) => mounted && setSession(session),
      () => mounted && setSession(null),
    )
    return () => {
      mounted = false
    }
  }, [])

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: 'read' | 'signIn', fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (session === undefined)
    return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  const signInDetail = (() => {
    if (session) return `Signed in as ${session.account}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const readDetail = (() => {
    if (status.type === 'read')
      return `The server reads ${status.account.account}, until ${new Date(status.account.expiresAt).toLocaleString()}.`
    if (failed?.action === 'read')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const readState = (() => {
    if (status.type === 'read') return 'done'
    if (session) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign a message of the server with a Tempo Account."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                setSession(await signIn())
                return { type: 'idle' }
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={readDetail}
        label="Read the account of the session on the server."
        number={2}
        state={readState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'read'}
          onClick={() =>
            run('read', async () => ({ account: await read(), type: 'read' }))
          }
        >
          {status.type === 'read' ? 'Read again' : 'Read'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
