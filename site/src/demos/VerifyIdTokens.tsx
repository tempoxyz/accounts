/**
 * Demonstrates the verification of an ID token on a server: a sign-in through Tempo ID's dialog,
 * then two requests to the site's `/api/identity/verify` route. The first sends the ID token of the
 * session, and the second sends a copy with another email address, which the route refuses.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { Base64 } from 'ox'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import './identity/Fields.css'
import { Fields } from './identity/Fields.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. The instance sets `provision: 'wallet'`, since the demo signs no transaction.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
  provision: 'wallet',
})

/** An action of the demo. */
type Action = 'forge' | 'signIn' | 'verify'

/** How a request to the route ended. */
type Result =
  | {
      /** The claims of the verified ID token, as `tokens.verifyIdToken` returns them. */
      claims: Record<string, unknown>
      type: 'verified'
    }
  | {
      /** The server's error code, `invalid_token`. */
      error: string
      type: 'refused'
    }

/** An action that ended with an error. */
type Failure = {
  /** The message of the error. */
  message: string
  type: 'failed'
}

/** How the last run of each action ended. An action that never ran holds no entry. */
type Results = { [action in Action]?: Failure | Result | undefined }

/** Sends `idToken` to the site's server, which verifies it. */
async function send(idToken: string): Promise<Result> {
  const response = await fetch('/api/identity/verify', {
    body: JSON.stringify({ idToken }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const body = (await response.json()) as {
    claims?: Record<string, unknown>
    error?: string
  }

  if (response.ok) return { claims: body.claims ?? {}, type: 'verified' }
  if (response.status === 401)
    return { error: body.error ?? 'invalid_token', type: 'refused' }
  throw new Error(`The server responded with status ${response.status}.`)
}

/** Returns a copy of `idToken` whose `email` claim names another address, under the same signature. */
function forge(idToken: string): string {
  const [header, payload = '', signature] = idToken.split('.')

  const claims = JSON.parse(Base64.toString(payload)) as Record<string, unknown>
  const forged = Base64.fromString(
    JSON.stringify({ ...claims, email: 'attacker@example.com' }),
    { pad: false, url: true },
  )
  return [header, forged, signature].join('.')
}

/** Signs a user in, then sends the ID token of the session, and a forged copy, to the server. */
export default function VerifyIdTokens() {
  const { isPending, session } = accounts.useSession()
  const [pending, setPending] = useState<Action>()
  const [results, setResults] = useState<Results>({})

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: Action, fn: () => Promise<Result | undefined>) {
    setPending(action)
    // The failure handler settles each rejection.
    void fn()
      .then(
        (result) => result,
        (error: Error): Failure => ({ message: error.message, type: 'failed' }),
      )
      .then((result) => {
        setResults((results) => ({ ...results, [action]: result }))
        setPending(undefined)
      })
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  // A refresh may return no ID token, so a signed-in session can hold none.
  const idToken = session?.idToken
  const { forge: forged, signIn, verify: verified } = results

  const verifyDetail = (() => {
    if (session && !idToken)
      return (
        <span role="alert">
          The session holds no ID token. Reset the demo, and sign in again.
        </span>
      )
    if (verified?.type === 'verified')
      return (
        <Fields
          entries={Object.entries(verified.claims).map(([name, value]) => [
            name,
            typeof value === 'string' ? value : JSON.stringify(value),
          ])}
        />
      )
    if (verified?.type === 'refused')
      return (
        <span role="alert">
          The server refused the ID token with{' '}
          <code data-identity-code="">{verified.error}</code>. Reset the demo,
          and sign in again.
        </span>
      )
    if (verified?.type === 'failed')
      return <span role="alert">{verified.message}</span>
    return undefined
  })()
  const forgeDetail = (() => {
    if (forged?.type === 'refused')
      return (
        <>
          The server refused the ID token with{' '}
          <code data-identity-code="">{forged.error}</code>.
        </>
      )
    if (forged?.type === 'verified')
      return <span role="alert">The server verified the forged ID token.</span>
    if (forged?.type === 'failed')
      return <span role="alert">{forged.message}</span>
    return undefined
  })()

  return (
    <>
      <DemoStep
        detail={
          signIn?.type === 'failed' && (
            <span role="alert">{signIn.message}</span>
          )
        }
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
                return undefined
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={verifyDetail}
        label="Send the ID token to the server, which verifies it."
        number={2}
        state={(() => {
          if (verified?.type === 'verified') return 'done'
          if (idToken) return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={!idToken}
          loading={pending === 'verify'}
          onClick={() => run('verify', () => send(idToken!))}
        >
          Verify
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={forgeDetail}
        label="Send a copy with another email address."
        number={3}
        state={(() => {
          if (forged?.type === 'refused') return 'done'
          if (verified?.type === 'verified') return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={!idToken || verified?.type !== 'verified'}
          loading={pending === 'forge'}
          onClick={() => run('forge', () => send(forge(idToken!)))}
        >
          Send
        </DemoButton>
      </DemoStep>
    </>
  )
}
