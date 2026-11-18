/**
 * Demonstrates `accounts.pay`: a sign-in for an access key with a limit, whose funding hint opens
 * Tempo ID's deposit page for a low balance, a payment within the limit that the access key sends,
 * and a payment above the limit that the user approves on Tempo ID's payment page.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { type ReactNode, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Recipient of the demo's payments, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

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
  plugins: [react(), viem()],
})

/** A control of the demo. */
type Action = 'payAbove' | 'payWithin' | 'signIn'

/** How the last payment of a control ended: its transaction, or a rejection on the payment page. */
type Result =
  | { transaction: `0x${string}`; type: 'paid' }
  | { type: 'rejected' }

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/**
 * Signs a user in with an access key and a funding hint of 20 OUSD, then pays 1 OUSD with the
 * access key and 12 OUSD on the payment page, and links each transaction.
 */
export default function SendPayments() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [results, setResults] = useState<
    Partial<Record<'payAbove' | 'payWithin', Result>>
  >({})
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its failure. */
  function run(action: Action, fn: () => Promise<void>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      () => setStatus({ type: 'idle' }),
      (error: Error) => {
        // A close of the dialog ends the payment, so the demo shows no failure.
        if (error.name === 'AbortError') return setStatus({ type: 'idle' })
        setStatus({ action, message: error.message, type: 'failed' })
      },
    )
  }

  /** Pays `amount` OUSD as `action`, and keeps how the payment ended. */
  function pay(action: 'payAbove' | 'payWithin', amount: string) {
    run(action, async () => {
      const paid = await accounts
        .pay({
          amount,
          memo: 'demo-order-1',
          note: 'Demo order',
          to: recipient,
          token: 'ousd',
        })
        .catch((error: unknown) => {
          // A Reject on the page is an answer of the user, not a failure.
          if (
            error instanceof Accounts.RequestError &&
            error.code === 'access_denied'
          )
            return undefined
          throw error
        })
      setResults((current) => ({
        ...current,
        [action]: paid
          ? { transaction: paid.transaction, type: 'paid' }
          : { type: 'rejected' },
      }))
    })
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  // A session without an access key sends no payment with it, so the first step stays open.
  const account = session?.accessKey?.account
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  /** Returns the failure of `action`, or `fallback` without one. */
  function detail(action: Action, fallback?: ReactNode) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
    return fallback
  }
  /** Returns how the last payment of `action` ended, with a link to its transaction. */
  function paidDetail(action: 'payAbove' | 'payWithin', amount: string) {
    const result = results[action]
    if (result?.type === 'rejected') return 'The payment was rejected.'
    if (result?.type === 'paid')
      return (
        <>
          Paid {amount} OUSD.{' '}
          {explorer && (
            <a
              href={`${explorer}/tx/${result.transaction}`}
              rel="noreferrer"
              target="_blank"
            >
              See the transaction
            </a>
          )}
        </>
      )
    return undefined
  }
  /** Returns the state of the step of `action`. */
  function payState(action: 'payAbove' | 'payWithin') {
    if (results[action]?.type === 'paid') return 'done'
    if (account) return 'active'
    return 'idle'
  }

  return (
    <>
      <DemoStep
        detail={detail(
          'signIn',
          account && `Signed in as ${session.user.email ?? account}.`,
        )}
        label="Sign in for an access key that sends up to 10 OUSD for a day."
        number={1}
        state={account ? 'done' : 'active'}
      >
        {!account && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                // A Tempo Account that holds less opens the deposit page after the approval.
                await accounts.dialog.signIn({
                  funding: { amount: '20', token: 'OUSD' },
                })
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={detail('payWithin', paidDetail('payWithin', '1'))}
        label="Pay 1 OUSD, which the access key sends with no prompt."
        number={2}
        state={payState('payWithin')}
      >
        <DemoButton
          disabled={!account || isReauthorizing}
          loading={pending === 'payWithin'}
          onClick={() => pay('payWithin', '1')}
        >
          {results.payWithin?.type === 'paid' ? 'Pay again' : 'Pay'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail('payAbove', paidDetail('payAbove', '12'))}
        label="Pay 12 OUSD, above the limit, on Tempo ID's payment page."
        number={3}
        state={payState('payAbove')}
      >
        <DemoButton
          disabled={!account || isReauthorizing}
          loading={pending === 'payAbove'}
          onClick={() => pay('payAbove', '12')}
        >
          {results.payAbove?.type === 'paid' ? 'Pay again' : 'Pay'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
