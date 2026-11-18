/**
 * Demonstrates a request that the access token of a session authenticates. The page calls the API
 * route of the site with the access token, then without it, and shows each response.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { type ReactNode, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import {
  Call,
  read,
  type Result,
  tokenRoute,
} from './api-authentication/Call.tsx'

/**
 * The demo's instance. The page's origin is its client ID, so the site needs no registration. The
 * sign-in requests no access key, since the demo signs no transaction.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** An action of the demo: the sign-in, or a call with or without the access token. */
type Action = 'anonymous' | 'authenticated' | 'signIn'

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { type: 'idle' }

/** Signs a user in, then calls the API with the access token of the session, and without it. */
export default function AuthenticateRequests() {
  const { isPending, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [authenticated, setAuthenticated] = useState<Result>()
  const [anonymous, setAnonymous] = useState<Result>()

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

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

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
  const anonymousState = (() => {
    if (anonymous) return 'done'
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
        label="Call the API with the access token."
        number={2}
        state={authenticatedState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'authenticated'}
          onClick={() =>
            run('authenticated', async () => {
              const response = await accounts.session.fetch({ url: tokenRoute })
              setAuthenticated(await read(response))
            })
          }
        >
          Call
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail('anonymous', anonymous && <Call result={anonymous} />)}
        label="Call the API without the access token."
        number={3}
        state={anonymousState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'anonymous'}
          onClick={() =>
            run('anonymous', async () => {
              setAnonymous(await read(await fetch(tokenRoute)))
            })
          }
        >
          Call
        </DemoButton>
      </DemoStep>
    </>
  )
}
