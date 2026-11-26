/**
 * Demonstrates a guest checkout: a sign-in that offers Continue as guest, and a payment that the
 * guest account's key pair signs on Tempo ID's payment page.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Recipient of the demo's payment, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in offers Continue as guest.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  guest: true,
  plugins: [react(), viem()],
})

/** A control of the demo. */
type Action = 'pay' | 'signIn'

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { transaction: `0x${string}`; type: 'paid' }
  | { type: 'idle' }

/** Signs a visitor in as a guest, then pays 1 OUSD from the guest account, and links the transaction. */
export default function GuestCheckout() {
  const { isPending, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: Action, fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) => {
      // A close of the dialog ends the call, so the demo shows no failure.
      if (error.name === 'AbortError') return setStatus({ type: 'idle' })
      setStatus({ action, message: error.message, type: 'failed' })
    })
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  const signInDetail = (() => {
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    if (!session) return undefined
    if (session.kind === 'guest') return `Guest account ${session.address}.`
    return `Signed in as ${session.user.email ?? session.address}.`
  })()
  const payDetail = (() => {
    if (failed?.action === 'pay')
      return <span role="alert">{failed.message}</span>
    if (status.type !== 'paid') return undefined
    return (
      <>
        Paid 1 OUSD.{' '}
        {explorer && (
          <a
            href={`${explorer}/tx/${status.transaction}`}
            rel="noreferrer"
            target="_blank"
          >
            See the transaction
          </a>
        )}
      </>
    )
  })()
  const payState = (() => {
    if (status.type === 'paid') return 'done'
    if (session) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in, and select Continue as guest."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                await accounts.dialog.signIn()
                return { type: 'idle' }
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={payDetail}
        label="Pay 1 OUSD on Tempo ID's payment page. For a new guest account, Deposit offers the faucet."
        number={2}
        state={payState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'pay'}
          onClick={() =>
            run('pay', async () => {
              const { transaction } = await accounts.pay({
                amount: '1',
                note: 'Demo order',
                to: recipient,
                token: 'ousd',
              })
              return { transaction, type: 'paid' }
            })
          }
        >
          {status.type === 'paid' ? 'Pay again' : 'Pay'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
