/**
 * Demonstrates the proof of a Tempo Account with a challenge. The site's server issues the
 * challenge, the sign-in signs it, and the server verifies the signature once.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration.
 */
export const accounts = Accounts.create({ chain: 'testnet' })

/** An action of the demo. */
type Action = 'replay' | 'signIn' | 'verify'

/** The proof that the page sends to the server. */
type Proof = {
  /** The Tempo Account that signed the challenge. */
  address: string
  /** The challenge that the server issued. */
  challenge: string
  /** The signature of the challenge by `address`. */
  signature: string
}

/** The answer of a route of the server. */
type Answer = {
  /** The Tempo Account that the server verified. */
  address?: string
  /** The challenge that the server issued. */
  challenge?: string
  /** Why the server refused the request. */
  error?: string
}

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/** Posts `body` to `route` of the site's server, and returns its answer, also of a refusal. */
async function post(route: string, body: object = {}): Promise<Answer> {
  const response = await fetch(`/api/account-proof/${route}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  return (await response.json()) as Answer
}

/** Signs a challenge of the server at sign-in, verifies it there, and sends it a second time. */
export default function SignChallenges() {
  const [proof, setProof] = useState<Proof>()
  const [verified, setVerified] = useState<string>()
  const [refusal, setRefusal] = useState<string>()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

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

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  /** Returns the detail of the step of `action`: its failure, or else `result`. */
  function detail(action: Action, result: string | undefined) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
    return result
  }

  const verifyState = (() => {
    if (verified) return 'done'
    if (proof) return 'active'
    return 'idle'
  })()
  const replayState = (() => {
    if (refusal) return 'done'
    if (verified) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={detail('signIn', proof && `${proof.address} signed it.`)}
        label="Sign in, and sign the challenge of the server."
        number={1}
        state={proof ? 'done' : 'active'}
      >
        {!proof && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                const { challenge } = await post('challenge')
                if (!challenge) throw new Error('The server sent no challenge.')

                const session = await accounts.dialog.signIn({
                  accessKey: false,
                  challenge,
                })
                const { address, challengeSignature: signature } = session
                if (!address || !signature)
                  throw new Error('The sign-in returned no signature.')

                setProof({ address, challenge, signature })
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={detail(
          'verify',
          verified && `The server verified ${verified}.`,
        )}
        label="Send the proof to the server."
        number={2}
        state={verifyState}
      >
        {!verified && (
          <DemoButton
            disabled={!proof}
            loading={pending === 'verify'}
            onClick={() =>
              run('verify', async () => {
                const { address, error } = await post('verify', proof)
                if (!address)
                  throw new Error(`The server refused the proof: ${error}.`)

                setVerified(address)
              })
            }
          >
            Verify
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={detail(
          'replay',
          refusal && `The server refused the spent challenge: ${refusal}.`,
        )}
        label="Send the same proof again."
        number={3}
        state={replayState}
      >
        <DemoButton
          disabled={!verified}
          loading={pending === 'replay'}
          onClick={() =>
            run('replay', async () => {
              const { error } = await post('verify', proof)
              if (!error)
                throw new Error('The server accepted the spent challenge.')

              setRefusal(error)
            })
          }
        >
          Send again
        </DemoButton>
      </DemoStep>
    </>
  )
}
