/**
 * Demonstrates an MPP subscription: a sign-in, a request to a subscription route of the site, whose
 * 402 challenge opens Tempo ID's dialog for the merchant's access key, and the charges of the
 * merchant. It runs the calls of `examples/mpp-subscription`, with a session in the page.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { react } from 'accounts/react'
import { useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import type { Plan } from '../server/Subscriptions.ts'
import { Charges, time } from './subscriptions/Charges.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key, which `accounts.fetch` needs. The
 * subscription never spends it. Each period of a subscription may charge at most 1 OUSD.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [mpp({ maxAmount: '1' }), react()],
})

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'refresh' | 'signIn' | 'subscribe'; type: 'pending' }
  | {
      action: 'refresh' | 'signIn' | 'subscribe'
      message: string
      type: 'failed'
    }
  | { type: 'ended' }
  | { type: 'idle' }

/** Returns the URL of the merchant's subscription route for the Tempo Account `account`. */
function route(account: string) {
  return `/api/subscriptions/plan?account=${account}`
}

/**
 * Reads the plan of `account` with no payment. Returns `undefined` for a 402 challenge, which the
 * merchant answers without an active subscription.
 */
async function read(account: string) {
  const response = await fetch(route(account))
  if (response.status === 402) return undefined
  if (!response.ok)
    throw new Error(`The merchant failed with status ${response.status}.`)
  return (await response.json()) as Plan
}

/** Signs a user in, subscribes to the merchant with MPP, and shows the merchant's charges. */
export default function PayMppSubscriptions() {
  const { isPending, session } = accounts.useSession()
  const [plan, setPlan] = useState<Plan>()
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const account = session?.accessKey?.account

  useEffect(() => {
    if (!account) return
    // A subscription of an earlier visit shows after a reload. A failed read shows none.
    void read(account).then(setPlan, () => {})
  }, [account])

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(
    action: 'refresh' | 'signIn' | 'subscribe',
    fn: () => Promise<Status>,
  ) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  const signInDetail = (() => {
    if (account) return `Signed in as ${session.user.email ?? account}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const subscribeDetail = (() => {
    if (plan) return `Subscribed until ${time(plan.expires)}.`
    if (status.type === 'ended') return 'The subscription ended.'
    if (failed?.action === 'subscribe')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const chargesDetail = (() => {
    if (failed?.action === 'refresh')
      return <span role="alert">{failed.message}</span>
    return plan && <Charges charges={plan.charges} />
  })()
  const subscribeState = (() => {
    if (plan) return 'done'
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
                return { type: 'idle' }
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={subscribeDetail}
        label="Subscribe for 1 OUSD each minute."
        number={2}
        state={subscribeState}
      >
        {!plan && (
          <DemoButton
            disabled={!account}
            loading={pending === 'subscribe'}
            onClick={() =>
              run('subscribe', async () => {
                if (!account) return { type: 'idle' }
                // The 402 challenge opens Tempo ID's dialog, and the request sends again with the
                // approval of the merchant's access key.
                const response = await accounts.fetch(route(account))
                if (!response.ok)
                  throw new Error(
                    `The merchant failed with status ${response.status}.`,
                  )
                setPlan((await response.json()) as Plan)
                return { type: 'idle' }
              })
            }
          >
            Subscribe
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={chargesDetail}
        label="Read the charges. The merchant charges each period that ended."
        number={3}
        state={plan ? 'active' : 'idle'}
      >
        <DemoButton
          disabled={!plan || !account}
          loading={pending === 'refresh'}
          onClick={() =>
            run('refresh', async () => {
              if (!account) return { type: 'idle' }
              const current = await read(account)
              setPlan(current)
              return { type: current ? 'idle' : 'ended' }
            })
          }
        >
          Refresh
        </DemoButton>
      </DemoStep>
    </>
  )
}
