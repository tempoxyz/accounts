/**
 * Demonstrates a sign-in that binds a server's challenge to the signature of the access key, and
 * the server's check of that proof. It calls the routes of `src/server/AccessKeys.ts`.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as AccessKey from './access-keys/AccessKey.ts'
import { useRun } from './access-keys/Run.ts'

/** A challenge of the server, as the challenge route returns it. */
type Challenge = {
  /** The message that the sign-in binds. */
  challenge: string
  /** The ID that names the challenge to the verify route. */
  id: string
}

/** What the verify route returns for a proof that it accepts. */
type Proven = {
  /** The access key whose signature binds the challenge. */
  accessKey: string
  /** The Tempo Account that authorized the access key. */
  account: string
}

/** A refusal of a route, as its JSON body. */
type Refusal = {
  /** The code of the refusal. */
  error: string
  /** The fault and the fix. Absent for a refusal without one. */
  message?: string | undefined
}

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that sends up to 10 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react()],
})

/** Returns the JSON body of `response`, or throws the refusal that it holds. */
async function read<body>(response: Response): Promise<body> {
  if (response.ok) return response.json() as Promise<body>
  const refusal = (await response.json()) as Refusal
  throw new Error(refusal.message ?? refusal.error)
}

/** Requests a challenge, binds it to the access key of a sign-in, and verifies it on the server. */
export default function BindChallenges() {
  const { isPending, session } = accounts.useSession()
  const [challenge, setChallenge] = useState<Challenge>()
  // The ID of the challenge that the session's access key binds.
  const [bound, setBound] = useState<string>()
  const [proven, setProven] = useState<Proven>()
  const { failed, pending, run } = useRun<'challenge' | 'signIn' | 'verify'>()

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const accessKey = bound ? session?.accessKey : undefined

  const challengeDetail = (() => {
    if (failed?.action === 'challenge')
      return <span role="alert">{failed.message}</span>
    return challenge?.challenge
  })()
  const signInDetail = (() => {
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    if (accessKey)
      return `Access key ${AccessKey.short(accessKey.keyAuthorization.keyId)} binds the challenge.`
    return undefined
  })()
  const verifyDetail = (() => {
    if (failed?.action === 'verify')
      return <span role="alert">{failed.message}</span>
    if (proven)
      return `The server verified access key ${AccessKey.short(proven.accessKey)} of Tempo Account ${AccessKey.short(proven.account)}.`
    return undefined
  })()
  const signInState = (() => {
    if (accessKey) return 'done'
    if (challenge) return 'active'
    return 'idle'
  })()
  const verifyState = (() => {
    if (proven) return 'done'
    if (accessKey) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={challengeDetail}
        label="Request a challenge from the server."
        number={1}
        state={challenge ? 'done' : 'active'}
      >
        {!challenge && (
          <DemoButton
            loading={pending === 'challenge'}
            onClick={() =>
              run('challenge', async () => {
                const response = await fetch('/api/access-keys/challenge', {
                  method: 'POST',
                })
                setChallenge(await read<Challenge>(response))
              })
            }
          >
            Request
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={signInDetail}
        label="Sign in, and bind the challenge to the access key."
        number={2}
        state={signInState}
      >
        {!accessKey && (
          <DemoButton
            disabled={!challenge}
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                if (!challenge) return
                await accounts.dialog.signIn({ challenge: challenge.challenge })
                setBound(challenge.id)
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={verifyDetail}
        label="Verify the proof on the server."
        number={3}
        state={verifyState}
      >
        <DemoButton
          disabled={!accessKey}
          loading={pending === 'verify'}
          onClick={() =>
            run('verify', async () => {
              if (!accessKey) return
              // The request holds the access token and the signed key authorization, never the
              // access key.
              const response = await accounts.session.fetch({
                init: {
                  body: JSON.stringify({
                    id: bound,
                    keyAuthorization: accessKey.keyAuthorization,
                  }),
                  headers: { 'content-type': 'application/json' },
                  method: 'POST',
                },
                url: '/api/access-keys/verify',
              })
              setProven(await read<Proven>(response))
            })
          }
        >
          {proven ? 'Verify again' : 'Verify'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
