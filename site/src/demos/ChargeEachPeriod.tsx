/**
 * Demonstrates a subscription that the site's server charges: a sign-in through the backend with
 * an access key that sends 1 OUSD each minute, and a charge of the period from the server. It runs
 * the calls of `examples/backend`, with a periodic limit.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import type { Charge, ChargeResult } from '../server/Subscriptions.ts'
import { Charges, time } from './subscriptions/Charges.tsx'

/** Path of the site's routes of the topic, whose `/auth` routes the `backend` plugin serves. */
const backend = '/api/subscriptions'

/**
 * The page's instance, which only opens Tempo ID's dialog. The backend builds each sign-in, names
 * the access key, and keeps the session. The page's origin is the client ID of both.
 */
const page = Accounts.create({
  chain: 'testnet',
  plugins: [dialog({ backend })],
  // Without a registration, Tempo ID returns only to the root of the origin.
  redirectUri: `${location.origin}/`,
})

/** The reset control of the frame ends the session that the backend holds. */
export const accounts = {
  async signOut() {
    await fetch(`${backend}/auth/logout`, { method: 'POST' })
  },
}

/** The subscriber, as the backend's session names it. */
type Subscriber = {
  /** Email address of the user, or the Tempo Account without one. */
  name: string
}

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'charge' | 'subscribe'; type: 'pending' }
  | { action: 'charge' | 'subscribe'; message: string; type: 'failed' }
  | { periodEnd?: string | undefined; type: 'refused' }
  | { type: 'ended' }
  | { type: 'idle' }

/** Reads the subscriber of the backend's session, or `null` without one. */
async function read(): Promise<Subscriber | null> {
  const response = await fetch(`${backend}/auth/session`)
  if (!response.ok) return null
  const { session } = (await response.json()) as {
    session: Awaited<ReturnType<typeof page.dialog.signIn>> | null
  }
  if (session?.method !== 'tempo-id' || !session.account) return null
  return { name: session.user.email ?? session.account }
}

/** Subscribes a user with an access key of 1 OUSD each minute, then charges each period. */
export default function ChargeEachPeriod() {
  const [charges, setCharges] = useState<readonly Charge[]>([])
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  // `undefined` until the backend answers for the session of the page's cookie.
  const [subscriber, setSubscriber] = useState<Subscriber | null>()

  useEffect(() => {
    // A failed read shows the first step, as a page without a session does.
    void read().then(setSubscriber, () => setSubscriber(null))
  }, [])

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: 'charge' | 'subscribe', fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (subscriber === undefined)
    return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  const subscribeDetail = (() => {
    if (subscriber) return `Subscribed as ${subscriber.name}.`
    if (status.type === 'ended')
      return 'The access key expired, so the subscription ended.'
    if (failed?.action === 'subscribe')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const chargeDetail = (() => {
    if (status.type === 'refused')
      return (
        <span role="alert">
          Refused: the access key spent its limit of this period.
          {status.periodEnd &&
            ` The next period starts at ${time(status.periodEnd)}.`}
        </span>
      )
    if (failed?.action === 'charge')
      return <span role="alert">{failed.message}</span>
    return <Charges charges={charges} />
  })()

  return (
    <>
      <DemoStep
        detail={subscribeDetail}
        label="Subscribe for 1 OUSD each minute."
        number={1}
        state={subscriber ? 'done' : 'active'}
      >
        {!subscriber && (
          <DemoButton
            loading={pending === 'subscribe'}
            onClick={() =>
              run('subscribe', async () => {
                const session = await page.dialog.signIn()
                setCharges([])
                setSubscriber({
                  name: session.user.email ?? session.account ?? '',
                })
                return { type: 'idle' }
              })
            }
          >
            Subscribe
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={chargeDetail}
        label="Charge the period from the server."
        number={2}
        state={subscriber ? 'active' : 'idle'}
      >
        <DemoButton
          disabled={!subscriber}
          loading={pending === 'charge'}
          onClick={() =>
            run('charge', async () => {
              const response = await fetch(`${backend}/charge`, {
                method: 'POST',
              })
              if (![200, 401, 409].includes(response.status))
                throw new Error(
                  `The charge failed with status ${response.status}.`,
                )
              const result = (await response.json()) as ChargeResult

              if (!('error' in result)) {
                setCharges((charges) => [...charges, result])
                return { type: 'idle' }
              }
              if (result.error === 'limit_exceeded')
                return { periodEnd: result.periodEnd, type: 'refused' }
              setSubscriber(null)
              return { type: 'ended' }
            })
          }
        >
          Charge
        </DemoButton>
      </DemoStep>
    </>
  )
}
