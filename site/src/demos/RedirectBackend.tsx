/**
 * Demonstrates a redirect sign-in that the site's server runs with the `backend` plugin. The server
 * keeps the session, and the page holds only the session cookie, with no instance. It runs the
 * flow of `examples/backend` against the routes of `src/server/Backend.ts`.
 * @module
 */
'use client'

import { useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as Return from './redirect/Return.tsx'

/** Path of the server's routes, the `handler.basePath` of the server's instance. */
const path = '/api/backend'

/** The sign-out of the reset control. The server holds the session, so the server ends it. */
export const accounts = {
  async signOut() {
    await fetch(`${path}/auth/logout`, { method: 'POST' })
  },
}

/** A request of the demo to the server. */
type Action = 'read' | 'signIn' | 'signOut'

/** The session that the page reads from the server: the user, without tokens. */
type Session = {
  /** User of the session. */
  user: {
    /** Email address of the user. */
    email: string
  }
}

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { type: 'ended' }
  | { type: 'idle' }

/** Signs a user in on the server through a redirect, reads the user, and ends the session. */
export default function RedirectBackend() {
  // `undefined` while the page reads the session, and `null` without one.
  const [session, setSession] = useState<Session | null>()
  // The email address that the server returned for the session.
  const [email, setEmail] = useState<string>()
  const [status, setStatus] = useState<Status>(() => {
    // The callback route returns a denial to the page as `?error=`.
    const error = new URLSearchParams(window.location.search).get('error')
    if (!error) return { type: 'idle' }
    return {
      action: 'signIn',
      message: `Tempo ID returned ${error}.`,
      type: 'failed',
    }
  })

  useEffect(() => {
    // A page that the browser restores from its cache, such as after "Back" on Tempo ID's page,
    // did not leave.
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setStatus({ type: 'idle' })
    }

    // A callback that reaches the server left no saved path. A page load without one drops the
    // path of a sign-in that never returned.
    Return.clear()
    // The cookie can name a session of this sign-in, or of an earlier visit. Both handlers settle
    // the promise. A failed read shows the first step.
    void fetch(`${path}/auth/session`)
      .then(
        (response) => response.json() as Promise<{ session: Session | null }>,
      )
      .then(
        (body) => setSession(body.session),
        () => setSession(null),
      )
    window.addEventListener('pageshow', restore)
    return () => window.removeEventListener('pageshow', restore)
  }, [])

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: Action, fn: () => Promise<Status>) {
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
    if (session) return 'The server holds the session. The page holds a cookie.'
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const readDetail = (() => {
    if (email) return `The server returned ${email}.`
    if (failed?.action === 'read')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const readState = (() => {
    if (email) return 'done'
    if (session) return 'active'
    return 'idle'
  })()
  const signOutDetail = (() => {
    if (status.type === 'ended')
      return 'The server ended the session, and deleted the cookie.'
    if (failed?.action === 'signOut')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const signOutState = (() => {
    if (status.type === 'ended') return 'done'
    if (email) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Leave the page for Tempo ID's sign-in, through the server."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() => {
              setStatus({ action: 'signIn', type: 'pending' })
              // The site has no web app manifest, so Tempo ID returns to the root, which forwards
              // the callback to the server's callback route.
              Return.save({ path: `${path}/auth/callback` })
              const returnTo = window.location.pathname
              window.location.assign(
                `${path}/auth/login?${new URLSearchParams({ returnTo })}`,
              )
            }}
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={readDetail}
        label="Read the user from the server."
        number={2}
        state={readState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'read'}
          onClick={() =>
            run('read', async () => {
              const response = await fetch(`${path}/me`)
              if (response.status === 401) {
                setSession(null)
                setEmail(undefined)
                throw new Error('The session ended. Sign in again.')
              }
              if (!response.ok)
                throw new Error(`The server failed with ${response.status}.`)

              const body = (await response.json()) as Session
              setEmail(body.user.email)
              return { type: 'idle' }
            })
          }
        >
          Read
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={signOutDetail}
        label="End the session on the server."
        number={3}
        state={signOutState}
      >
        <DemoButton
          disabled={!email}
          loading={pending === 'signOut'}
          onClick={() =>
            run('signOut', async () => {
              const response = await fetch(`${path}/auth/logout`, {
                method: 'POST',
              })
              // The route deletes the cookie also when it fails, so the page holds no session.
              setSession(null)
              setEmail(undefined)
              if (!response.ok)
                throw new Error(`The server failed with ${response.status}.`)

              return { type: 'ended' }
            })
          }
        >
          Sign out
        </DemoButton>
      </DemoStep>
    </>
  )
}
