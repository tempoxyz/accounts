/**
 * Demonstrates a request that a session cookie authenticates. The dialog signs the user in through
 * the backend routes of the site, which keep the tokens and set the cookie. The page calls the API
 * route with the cookie, then signs out and calls it again, and shows each response. It runs the
 * calls of `examples/authenticated-api`.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { type ReactNode, useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import {
  Call,
  path,
  read,
  type Result,
  route,
} from './api-authentication/Call.tsx'

/**
 * The demo's instance, whose dialog signs in through the backend routes of the site. The site
 * serves no web app manifest, so Tempo ID redirects only to the root of its origin, which the
 * backend also names. The dialog passes the callback URL to the backend, and never loads it.
 */
const instance = Accounts.create({
  chain: 'testnet',
  plugins: [dialog({ backend: path })],
  redirectUri: `${window.location.origin}/`,
})

/**
 * The sign-out that the reset control of the frame calls. The backend holds the session, so the
 * sign-out is a request to its logout route, which ends the session and deletes the cookie.
 */
export const accounts = {
  async signOut() {
    await fetch(`${path}/auth/logout`, { method: 'POST' })
  },
}

/** The session that the page reads: the user, without a token. */
type Session = Awaited<ReturnType<typeof instance.dialog.signIn>>

/** An action of the demo: the sign-in, the call with the session cookie, or the call after a sign-out. */
type Action = 'authenticated' | 'signedOut' | 'signIn'

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { type: 'idle' }

/** Signs a user in through the backend, calls the API with the session cookie, then signs out and calls it again. */
export default function UseSessionCookies() {
  // `undefined` while the page reads the session of the cookie, and `null` without one.
  const [session, setSession] = useState<Session | null>()
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [authenticated, setAuthenticated] = useState<Result>()
  const [signedOut, setSignedOut] = useState<Result>()

  // The cookie can name a session of an earlier visit. Both handlers settle the promise.
  useEffect(() => {
    void fetch(`${path}/auth/session`)
      .then((response) => response.json() as Promise<{ session: Session }>)
      .then(
        (body) => setSession(body.session),
        () => setSession(null),
      )
  }, [])

  /** Runs `fn` as `action`, and shows its failure. */
  function run(action: Action, fn: () => Promise<void>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      () => setStatus({ type: 'idle' }),
      (error: Error) =>
        setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (session === undefined)
    return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  /** Returns the detail of the step of `action`: its failure, or else `result`. */
  function detail(action: Action, result: ReactNode) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
    return result
  }
  const authenticatedState = (() => {
    if (authenticated) return 'done'
    if (session) return 'active'
    return 'idle'
  })()
  const signedOutState = (() => {
    if (signedOut) return 'done'
    if (authenticated) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={detail(
          'signIn',
          session && `Signed in as ${session.user.email ?? session.user.id}.`,
        )}
        label="Sign in through the backend."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                setSession(await instance.dialog.signIn())
                setAuthenticated(undefined)
                setSignedOut(undefined)
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={detail(
          'authenticated',
          authenticated && <Call result={authenticated} />,
        )}
        label="Call the API with the session cookie."
        number={2}
        state={authenticatedState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'authenticated'}
          onClick={() =>
            run('authenticated', async () => {
              // The browser sends the cookie with each request to the page's origin.
              setAuthenticated(await read(await fetch(route)))
            })
          }
        >
          Call
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail('signedOut', signedOut && <Call result={signedOut} />)}
        label="Sign out, and call the API again."
        number={3}
        state={signedOutState}
      >
        <DemoButton
          disabled={!session || !authenticated}
          loading={pending === 'signedOut'}
          onClick={() =>
            run('signedOut', async () => {
              // The logout route ends the session and deletes the cookie, which no script reads.
              await accounts.signOut()
              setSession(null)
              setSignedOut(await read(await fetch(route)))
            })
          }
        >
          Sign out and call
        </DemoButton>
      </DemoStep>
    </>
  )
}
