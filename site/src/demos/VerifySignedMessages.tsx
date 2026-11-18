/**
 * Demonstrates the proof of a Tempo Account with a message that the access key signs. The site's
 * server verifies the signature with the access token of the request.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Message that the access key signs. */
const message = 'I agree to the terms of this demo.'

/** Recipient of the access key's first transaction, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that sends up to 100 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react(), viem()],
})

/** An action of the demo. */
type Action = 'send' | 'signIn' | 'verify'

/** The answer of the route of the server. */
type Answer = {
  /** The Tempo Account that the server verified. */
  address?: string
  /** Why the server refused the request. */
  error?: string
}

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/** Signs in with an access key, registers it on the chain, and proves the account with it. */
export default function VerifySignedMessages() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [hash, setHash] = useState<string>()
  const [verified, setVerified] = useState<string>()
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

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  // A session without an access key signs no message here, so the first step stays open.
  const account = session?.accessKey?.account
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  const signInDetail = (() => {
    if (account) return `Signed in as ${session.user.email ?? account}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const sendDetail = (() => {
    if (failed?.action === 'send')
      return <span role="alert">{failed.message}</span>
    if (hash)
      return (
        <>
          The chain holds the access key.{' '}
          {explorer && (
            <a href={`${explorer}/tx/${hash}`} rel="noreferrer" target="_blank">
              See the receipt
            </a>
          )}
        </>
      )
    return undefined
  })()
  const verifyDetail = (() => {
    if (failed?.action === 'verify')
      return <span role="alert">{failed.message}</span>
    if (verified) return `The server verified the message for ${verified}.`
    return undefined
  })()
  const sendState = (() => {
    if (hash) return 'done'
    if (account) return 'active'
    return 'idle'
  })()
  const verifyState = (() => {
    if (verified) return 'done'
    if (account) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in, or create a Tempo Account."
        number={1}
        state={account ? 'done' : 'active'}
      >
        {!account && (
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
        detail={sendDetail}
        label="Send the first transaction of the access key, 0.01 OUSD."
        number={2}
        state={sendState}
      >
        <DemoButton
          disabled={!account || isReauthorizing}
          loading={pending === 'send'}
          onClick={() =>
            run('send', async () => {
              const { transaction } = await accounts.pay({
                amount: '0.01',
                to: recipient,
                token: 'ousd',
              })
              setHash(transaction)
            })
          }
        >
          Send
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={verifyDetail}
        label={`Sign "${message}" with the access key, and verify it on the server.`}
        number={3}
        state={verifyState}
      >
        <DemoButton
          disabled={!account || isReauthorizing}
          loading={pending === 'verify'}
          onClick={() =>
            run('verify', async () => {
              setVerified(undefined)
              const signature = await accounts.signMessage({ message })
              const response = await accounts.session.fetch({
                init: {
                  body: JSON.stringify({
                    address: account,
                    message,
                    signature,
                  }),
                  headers: { 'content-type': 'application/json' },
                  method: 'POST',
                },
                url: '/api/account-proof/message',
              })
              const { address, error } = (await response.json()) as Answer
              if (error === 'invalid_signature')
                throw new Error(
                  'The server refused the signature. The chain holds the access key only after its first transaction.',
                )
              if (!address)
                throw new Error(`The server refused the request: ${error}.`)

              setVerified(address)
            })
          }
        >
          Verify
        </DemoButton>
      </DemoStep>
    </>
  )
}
