/**
 * Demonstrates `accounts.pay` with `guest: true`: a payment in MACH on Tempo mainnet from a guest
 * account, which buys the MACH that it lacks on Tempo ID's purchase page, then the read of the guest
 * account's address, and the removal of its key pair from the store.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { type ReactNode, useEffect, useState } from 'react'
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

/** A control of the demo. */
type Action = 'forget' | 'pay'

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/** A payment of the guest account. */
type Paid = {
  /** The amount of MACH, as entered. */
  amount: string
  /** The hash of the transaction that holds the transfer. */
  transaction: `0x${string}`
}

/**
 * Pays the entered amount of MACH to the entered recipient as a guest, shows the guest account's
 * address, and forgets the guest account.
 */
export default function AcceptGuestPayments() {
  const [address, setAddress] = useState<`0x${string}`>()
  const [amount, setAmount] = useState('1')
  const [paid, setPaid] = useState<Paid>()
  const [recipient, setRecipient] = useState<string>(merchant)
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Reads the guest account's address. A failed read shows no guest account. */
  function read() {
    void accounts.guest.get().then(setAddress, () => setAddress(undefined))
  }

  useEffect(read, [])

  /** Runs `fn` as `action`, and shows its failure. */
  function run(action: Action, fn: () => Promise<void>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      () => setStatus({ type: 'idle' }),
      (error: Error) => {
        // A close of the purchase page ends the payment, so the demo shows no failure.
        if (error.name === 'AbortError') return setStatus({ type: 'idle' })
        if (
          error instanceof Accounts.RequestError &&
          error.code === 'access_denied'
        )
          return setStatus({
            action,
            message: 'The purchase was cancelled.',
            type: 'failed',
          })
        setStatus({ action, message: error.message, type: 'failed' })
      },
    )
  }

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  /** Returns the failure of `action`, or `fallback` without one. */
  function detail(action: Action, fallback?: ReactNode) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
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
          onClick={() =>
            // The call starts within the click, so the purchase page's popup opens within it.
            run('pay', async () => {
              // The payment creates the guest account before Tempo ID answers, so a refused
              // payment also shows its address.
              const result = await accounts
                .pay({
                  amount,
                  guest: true,
                  memo: 'demo-order-1',
                  to: recipient as `0x${string}`,
                  token: 'mach',
                })
                .finally(read)
              setPaid({ amount, transaction: result.transaction })
            })
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
          onClick={() =>
            run('forget', async () => {
              await accounts.guest.disconnect()
              setAddress(undefined)
              setPaid(undefined)
            })
          }
        >
          Forget guest
        </DemoButton>
      </DemoStep>
    </>
  )
}
