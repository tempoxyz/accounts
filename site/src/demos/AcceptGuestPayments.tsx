/**
 * Demonstrates `accounts.pay` with `guest: true`: a payment in MACH on Tempo mainnet from a guest
 * account, which buys the MACH that it lacks on Tempo ID's purchase page, then the read of the guest
 * account's address, and the removal of its key pair from the store.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import {
  type ReactNode,
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  type ActorRefFrom,
  assertEvent,
  assign,
  createActor,
  fromPromise,
  setup,
  type SnapshotFrom,
} from 'xstate'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import './guest/Guest.css'

/**
 * Default recipient of the demo's payments: the initial merchant of MACH's deployment, which MACH's
 * transfer policy permits. The policy refuses most addresses, such as `0x…dEaD`.
 */
const merchant = '0xA74666CD3AAb591a2628e3eFa160530EC13f2f15'

/**
 * The demo's instance, on Tempo mainnet, where Tempo ID sells MACH. The page's origin is its client
 * ID, so the site needs no registration. The demo holds no session, so it exports no instance for
 * the reset control, and the guest account stays in the store until "Forget" removes it.
 */
const accounts = Accounts.create({
  chain: 'mainnet',
  plugins: [viem()],
})

/**
 * Pays the entered amount of MACH to the entered recipient as a guest, shows the guest account's
 * address, and forgets the guest account.
 */
export default function AcceptGuestPayments() {
  const [actor, setActor] = useState<machines.guest.Actor>()
  const [amount, setAmount] = useState('1')
  const [recipient, setRecipient] = useState<string>(merchant)

  // The actor lives only as long as the demo, so a reset or a change of page stops it. Its stop
  // aborts the signal of the payment, so no purchase page opens after it.
  useEffect(() => {
    const actor = createActor(
      machines.guest.provide({
        actors: {
          forget: fromPromise(() => accounts.guest.disconnect()),
          pay: fromPromise<machines.guest.Paid, machines.guest.Payment>(
            async (args) => {
              const { amount, to } = args.input
              const result = await accounts.pay({
                amount,
                guest: true,
                memo: 'demo-order-1',
                signal: args.signal,
                to: to as `0x${string}`,
                token: 'mach',
              })
              return { amount, transaction: result.transaction }
            },
          ),
          read: fromPromise(() => accounts.guest.get()),
        },
      }),
    ).start()
    setActor(actor)
    return () => {
      actor.stop()
    }
  }, [])

  const subscribe = useCallback(
    (onChange: () => void) => {
      const subscription = actor?.subscribe(onChange)
      return () => subscription?.unsubscribe()
    },
    [actor],
  )
  // Before the actor starts, such as in the server render, the demo shows no guest account.
  const snapshot = useSyncExternalStore(
    subscribe,
    () => actor?.getSnapshot(),
    () => undefined,
  )
  const address = snapshot?.context.address
  const failure = snapshot?.context.failure
  const paid = snapshot?.context.paid
  const pending = snapshot && machines.pending(snapshot)
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  /** Returns the failure of `action`, or `fallback` without one. */
  function detail(action: machines.guest.Action, fallback?: ReactNode) {
    if (failure?.action === action)
      return <span role="alert">{failure.message}</span>
    return fallback
  }

  const payDetail = detail(
    'pay',
    paid ? (
      <>
        Paid {paid.amount} MACH.{' '}
        {explorer && (
          <a
            href={`${explorer}/tx/${paid.transaction}`}
            rel="noreferrer"
            target="_blank"
          >
            See the transaction
          </a>
        )}
      </>
    ) : (
      'A purchase charges a real card, Apple Pay, or Google Pay at least $5.'
    ),
  )
  const addressDetail = address ? (
    <>
      {explorer ? (
        <a
          href={`${explorer}/address/${address}`}
          rel="noreferrer"
          target="_blank"
        >
          {address}
        </a>
      ) : (
        address
      )}
    </>
  ) : (
    'No guest account yet. The first payment creates it.'
  )

  return (
    <>
      <div data-demo-guest-fields="">
        <label data-demo-guest-label="">
          Amount
          <input
            data-demo-guest-amount=""
            data-demo-guest-input=""
            disabled={pending !== undefined}
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            value={amount}
          />
          MACH
        </label>
        <label data-demo-guest-label="" data-demo-guest-recipient="">
          To
          <input
            data-demo-guest-input=""
            disabled={pending !== undefined}
            onChange={(event) => setRecipient(event.target.value)}
            spellCheck={false}
            value={recipient}
          />
        </label>
      </div>
      <DemoStep
        detail={payDetail}
        label="Pay the amount on Tempo mainnet as a guest, with no sign-in."
        number={1}
        state={paid ? 'done' : 'active'}
      >
        <DemoButton
          disabled={pending !== undefined || !amount || !recipient}
          loading={pending === 'pay'}
          // The send starts the payment within the click, so the purchase page's popup opens within it.
          onClick={() =>
            actor?.send({ amount, to: recipient, type: 'pay.start' })
          }
        >
          {paid ? 'Pay again' : 'Pay as a guest'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={addressDetail}
        label="Read the guest account's address."
        number={2}
        state={address ? 'done' : 'idle'}
      />
      <DemoStep
        detail={detail(
          'forget',
          address &&
            'Its MACH stays on its address, and no key pair signs for it again.',
        )}
        label="Forget the guest account. The next payment creates a new one."
        number={3}
        state={address ? 'active' : 'idle'}
      >
        <DemoButton
          disabled={!address || pending !== undefined}
          loading={pending === 'forget'}
          onClick={() => actor?.send({ type: 'forget.start' })}
        >
          Forget guest
        </DemoButton>
      </DemoStep>
    </>
  )
}

export namespace machines {
  /**
   * The demo's guest account: the reads of its address, its payments, and its removal. The runner
   * provides each effect as an invoked actor, so the exit of its state, or the stop of the actor,
   * aborts it and discards its result. A payment ends in a read of the address.
   *
   * | State        | Meaning                                                                   |
   * | ------------ | ------------------------------------------------------------------------- |
   * | `forgetting` | The removal of the guest account's key pair runs.                         |
   * | `idle`       | No effect runs.                                                           |
   * | `paying`     | A payment of the guest account runs.                                      |
   * | `reading`    | A read of the guest account's address runs. A start of an action ends it. |
   */
  export const guest = setup({
    actions: {
      /** Clears the failure of the last action. */
      clear: assign({ failure: undefined }),
      /** Holds the failure of `params.action`, if `params.error` shows one. */
      fail: assign(
        (_args, params: { action: guest.Action; error: unknown }) => {
          const message = machines.message(params.error)
          return {
            failure:
              message === undefined
                ? undefined
                : { action: params.action, message },
          }
        },
      ),
      /** Clears the guest account and its payment. */
      forget: assign({ address: undefined, paid: undefined }),
      /** Holds the payment. */
      pay: assign((_args, params: { paid: guest.Paid }) => ({
        paid: params.paid,
      })),
      /** Holds the guest account's address. */
      read: assign((_args, params: { address: `0x${string}` | undefined }) => ({
        address: params.address,
      })),
    },
    actors: {
      /** Removes the guest account's key pair from the store. The demo provides it. */
      forget: fromPromise<void>(() => Promise.resolve()),
      /** Pays as the guest account, and aborts the payment at its stop. The demo provides it. */
      pay: fromPromise<guest.Paid, guest.Payment>((args) =>
        Promise.resolve({ amount: args.input.amount, transaction: '0x' }),
      ),
      /** Returns the guest account's address, or `undefined` without one. The demo provides it. */
      read: fromPromise<`0x${string}` | undefined>(() =>
        Promise.resolve(undefined),
      ),
    },
    types: {
      context: {} as guest.Context,
      events: {} as guest.Event,
    },
  }).createMachine({
    context: { address: undefined, failure: undefined, paid: undefined },
    id: 'guest',
    initial: 'reading',
    states: {
      forgetting: {
        entry: 'clear',
        invoke: {
          onDone: { actions: 'forget', target: 'idle' },
          onError: {
            actions: {
              params: (args) => ({ action: 'forget', error: args.event.error }),
              type: 'fail',
            },
            target: 'idle',
          },
          src: 'forget',
        },
      },
      idle: {
        on: { 'forget.start': 'forgetting', 'pay.start': 'paying' },
      },
      paying: {
        entry: 'clear',
        invoke: {
          input: (args) => {
            assertEvent(args.event, 'pay.start')
            return { amount: args.event.amount, to: args.event.to }
          },
          onDone: {
            actions: {
              params: (args) => ({ paid: args.event.output }),
              type: 'pay',
            },
            target: 'reading',
          },
          // The payment creates the guest account before Tempo ID answers, so a refused payment
          // also reads its address.
          onError: {
            actions: {
              params: (args) => ({ action: 'pay', error: args.event.error }),
              type: 'fail',
            },
            target: 'reading',
          },
          src: 'pay',
        },
      },
      reading: {
        invoke: {
          onDone: {
            actions: {
              params: (args) => ({ address: args.event.output }),
              type: 'read',
            },
            target: 'idle',
          },
          // A failed read shows no guest account.
          onError: {
            actions: { params: { address: undefined }, type: 'read' },
            target: 'idle',
          },
          src: 'read',
        },
        on: { 'forget.start': 'forgetting', 'pay.start': 'paying' },
      },
    },
  })

  /** The types of {@link guest}. */
  export namespace guest {
    /** A control of the demo. */
    export type Action = 'forget' | 'pay'

    /** The context of the machine. */
    export type Context = {
      /** The guest account's address. Absent before a read finds one, and after a removal. */
      address: `0x${string}` | undefined
      /** The failure of the last action, and its message. Absent once an action starts. */
      failure: { action: Action; message: string } | undefined
      /** The last payment of the guest account. Absent before one, and after a removal. */
      paid: Paid | undefined
    }

    /** An event of the machine. */
    export type Event =
      /** The user selected "Forget guest". */
      | { type: 'forget.start' }
      /** The user selected "Pay as a guest" or "Pay again". */
      | {
          /** The amount of MACH, as entered. */
          amount: string
          /** The recipient, as entered. */
          to: string
          type: 'pay.start'
        }

    /** A payment of the guest account. */
    export type Paid = {
      /** The amount of MACH, as entered. */
      amount: string
      /** The hash of the transaction that holds the transfer. */
      transaction: `0x${string}`
    }

    /** The input of a payment. */
    export type Payment = {
      /** The amount of MACH, as entered. */
      amount: string
      /** The recipient, as entered. */
      to: string
    }

    /** A running machine. */
    export type Actor = ActorRefFrom<typeof guest>

    /** A snapshot of the machine. */
    export type Snapshot = SnapshotFrom<typeof guest>
  }

  /**
   * Returns the message of `error`, the failure of an action, or `undefined` for an `AbortError`.
   * A close of the purchase page ends the payment with an `AbortError`, so the demo shows no
   * failure.
   */
  export function message(error: unknown) {
    if (error instanceof Error && error.name === 'AbortError') return undefined
    if (
      error instanceof Accounts.RequestError &&
      error.code === 'access_denied'
    )
      return 'The purchase was cancelled.'
    return error instanceof Error ? error.message : String(error)
  }

  /** Returns the action that runs, or `undefined` without one. */
  export function pending(snapshot: guest.Snapshot): guest.Action | undefined {
    if (snapshot.matches('forgetting')) return 'forget'
    if (snapshot.matches('paying')) return 'pay'
    return undefined
  }
}
