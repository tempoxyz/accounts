/**
 * Demonstrates a plugin of the app's own: an `analytics` plugin whose `track` action sends an event
 * with the signed-in user's ID, and whose hooks send an event at each sign-in and sign-out. The
 * demo shows each event that the plugin sends, in place of a request to an analytics service.
 * @module
 */
'use client'

import { Accounts, Plugin } from 'accounts'
import { react } from 'accounts/react'
import { useEffect, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Receives each event that the plugin sends, and dispatches it to the demo's component. */
const events = new EventTarget()

/**
 * Returns the plugin that adds `analytics.track`, and sends an event at each sign-in and sign-out.
 */
function analytics(options: analytics.Options) {
  const { send } = options

  return Plugin.from({
    actions: (context) => ({
      track: (name: string) =>
        send({
          chainId: context.chain.get(),
          name,
          // A `local` plugin's session names no user.
          userId: context.session.get()?.user?.id,
        }),
    }),
    hooks: {
      afterSignIn: (context, session) =>
        send({
          chainId: context.chain.get(),
          name: 'signIn',
          userId: session.user?.id,
        }),
      afterSignOut: (context) =>
        send({ chainId: context.chain.get(), name: 'signOut' }),
    },
    id: 'analytics',
  })
}

declare namespace analytics {
  /** An event that the plugin sends. */
  type Event = {
    /** The instance's chain when the event occurs. */
    chainId: number
    /** The name of the event, such as `signIn`. */
    name: string
    /** The signed-in user's ID. Absent without a session. */
    userId?: string | undefined
  }

  type Options = {
    /** Sends an event, such as to an analytics service. */
    send: (event: Event) => void
  }
}

/** The demo's instance, on Tempo testnet. The page's origin is its client ID. */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [
    react(),
    analytics({
      send: (event) =>
        events.dispatchEvent(new CustomEvent('event', { detail: event })),
    }),
  ],
})

/** An action of the demo. */
type Action = 'signIn' | 'signOut' | 'track'

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/**
 * Signs a user in, tracks an event, and signs out, and shows the event that the plugin sends at each
 * step.
 */
export default function Plugins() {
  const { isPending, session } = accounts.useSession()
  const [sent, setSent] = useState<Partial<Record<string, analytics.Event>>>({})
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<analytics.Event>).detail
      setSent((sent) => ({ ...sent, [detail.name]: detail }))
    }
    events.addEventListener('event', listener)
    return () => events.removeEventListener('event', listener)
  }, [])

  /** Runs `fn` as `action`, and shows its failure. */
  function run(action: Action, fn: () => Promise<void> | void) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void (async () => fn())().then(
      () => setStatus({ type: 'idle' }),
      (error: Error) =>
        setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  /** Returns the failure of `action`, or the event of `name` that the plugin sent. */
  function detail(action: Action, name: string) {
    if (status.type === 'failed' && status.action === action)
      return <span role="alert">{status.message}</span>
    const event = sent[name]
    if (!event) return undefined
    return (
      <>
        Sent <code>{JSON.stringify(event)}</code>
      </>
    )
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined

  return (
    <>
      <DemoStep
        detail={(() => {
          const shown = detail('signIn', 'signIn')
          if (!session) return status.type === 'failed' ? shown : undefined
          // A session that the page restored ran no sign-in, so the plugin sent no event for it.
          return shown ?? `Signed in as ${session.user.email}.`
        })()}
        label="Sign in. The afterSignIn hook sends a signIn event."
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
        detail={detail('track', 'checkout.start')}
        label="Track an event with the plugin's track action."
        number={2}
        state={(() => {
          if (sent['checkout.start']) return 'done'
          if (session) return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={!session || pending !== undefined}
          onClick={() =>
            run('track', () => accounts.analytics.track('checkout.start'))
          }
        >
          Track
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail('signOut', 'signOut')}
        label="Sign out. The afterSignOut hook sends a signOut event."
        number={3}
        state={(() => {
          if (sent.signOut && !session) return 'done'
          if (session) return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={!session || pending !== undefined}
          loading={pending === 'signOut'}
          onClick={() =>
            run('signOut', async () => {
              await accounts.signOut()
            })
          }
        >
          Sign out
        </DemoButton>
      </DemoStep>
    </>
  )
}
