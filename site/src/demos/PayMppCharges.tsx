/**
 * Demonstrates a payment of an MPP charge: a sign-in for an access key with a limit, whose funding
 * hint opens Tempo ID's deposit page for a low balance, and a request to a paid route of the site,
 * whose 402 charge the access key pays.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { Receipt } from 'mppx'
import { type ReactNode, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** The paid route of the site, which charges 0.01 OUSD for one fortune. */
const route = '/api/payments/fortune'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that spends up to 1 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [mpp(), react(), viem()],
})

/** A control of the demo. */
type Action = 'fetch' | 'signIn'

/** The content of a paid request, and the hash of the transaction that paid it. */
type Paid = { fortune: string; hash: string }

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/**
 * Signs a user in with an access key and a funding hint of 1 OUSD, then fetches a paid route of the
 * site, and shows its content and the receipt of the payment.
 */
export default function PayMppCharges() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [paid, setPaid] = useState<Paid>()
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
  // A session without an access key pays no charge, so the first step stays open.
  const account = session?.accessKey?.account
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  /** Returns the failure of `action`, or `fallback` without one. */
  function detail(action: Action, fallback?: ReactNode) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
    return fallback
  }
  const fetchState = (() => {
    if (paid) return 'done'
    if (account) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={detail(
          'signIn',
          account && `Signed in as ${session.user.email ?? account}.`,
        )}
        label="Sign in for an access key that spends up to 1 OUSD for a day."
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
                  funding: { amount: '1', token: 'OUSD' },
                })
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={detail(
          'fetch',
          paid && (
            <>
              “{paid.fortune}” Paid 0.01 OUSD.{' '}
              {explorer && (
                <a
                  href={`${explorer}/tx/${paid.hash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  See the receipt
                </a>
              )}
            </>
          ),
        )}
        label="Fetch a fortune, which costs 0.01 OUSD."
        number={2}
        state={fetchState}
      >
        <DemoButton
          disabled={!account || isReauthorizing}
          loading={pending === 'fetch'}
          onClick={() =>
            run('fetch', async () => {
              const response = await accounts.fetch(route)
              if (!response.ok)
                throw new Error(
                  `The route refused the request with status ${response.status}. Fetch again.`,
                )

              const { fortune } = (await response.json()) as { fortune: string }
              setPaid({
                fortune,
                hash: Receipt.fromResponse(response).reference,
              })
            })
          }
        >
          {paid ? 'Fetch again' : 'Fetch'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
