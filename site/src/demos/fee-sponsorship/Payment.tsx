/**
 * The parts that the demos of "Fee sponsorship" share: the instance of a page that sends through a
 * relay route, the steps of its payment, and the result of a sponsored payment.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useEffect, useState } from 'react'
import { type Address, isAddressEqual, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { DemoButton, DemoStep } from '../../components/Demo.tsx'

/** Recipient of the demos' payment, an address that no one holds. */
export const recipient = '0x000000000000000000000000000000000000dEaD'

/** Amount of the demos' payment, 1 OUSD. */
export const amount = parseUnits('1', 6)

/** The limit of the routes of the demos, which a demo shows for a payment beyond it. */
export const limit = '3 payments a minute for each user'

/**
 * Returns the instance of a page that sends through the relay route at `relay`, on Tempo testnet.
 * The page's origin is its client ID. Each sign-in requests an access key that sends up to 10 OUSD
 * for an hour.
 *
 * @example
 * ```ts
 * import * as Payment from './fee-sponsorship/Payment.tsx'
 *
 * export const accounts = Payment.create({ relay: '/api/relay' })
 * ```
 */
export function create(options: create.Options) {
  const { relay } = options

  return Accounts.create({
    accessKey: () => ({
      expiry: '1h',
      limits: [{ limit: '10', token: 'ousd' }],
    }),
    chain: 'testnet',
    plugins: [react(), viem({ relay })],
  })
}

export declare namespace create {
  /** Options of the instance. */
  type Options = {
    /** Path of the relay route of the demo. */
    relay: string
  }

  /** The instance of a demo. */
  type ReturnType = globalThis.ReturnType<typeof create>
}

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { feePayer: Address | undefined; hash: string; type: 'sent' }
  | { type: 'idle' }

/** An action of the demo. */
type Action = 'fund' | 'send' | 'signIn'

/**
 * Signs a user in with an access key, funds the Tempo Account on testnet, and sends 1 OUSD through
 * the relay route of `accounts`. The last step names the account that paid the fee.
 *
 * @example
 * ```tsx
 * import * as Payment from './fee-sponsorship/Payment.tsx'
 *
 * export const accounts = Payment.create({ relay: '/api/relay' })
 *
 * export default function Demo() {
 *   return <Payment.Steps accounts={accounts} sponsor="The sponsor" />
 * }
 * ```
 */
export function Steps(props: Steps.Props) {
  const { accounts, sponsor } = props

  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [funded, setFunded] = useState(false)
  // A session without an access key signs no transaction, so the first step stays open.
  const account = session?.accessKey?.account

  // A Tempo Account that holds the amount needs no funds, so the second step is complete.
  useEffect(() => {
    if (!account) return setFunded(false)
    let current = true
    // A failed read leaves the step open, so the user funds the Tempo Account.
    void accounts.token.getBalance({ account, token: Addresses.ousd }).then(
      (balance) => current && setFunded(balance.amount >= amount),
      () => {},
    )
    return () => {
      current = false
    }
  }, [account, accounts])

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: Action, fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  const sent = status.type === 'sent' ? status : undefined

  const signInDetail = (() => {
    if (account) return `Signed in as ${session.user.email ?? account}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const fundDetail = (() => {
    if (failed?.action === 'fund')
      return <span role="alert">{failed.message}</span>
    if (funded) return 'The Tempo Account holds OUSD.'
    return undefined
  })()
  const sendDetail = (() => {
    if (sent && account)
      return (
        <Result
          account={account}
          explorer={accounts.viem.chain.blockExplorers?.default.url}
          feePayer={sent.feePayer}
          hash={sent.hash}
          // Viem sends a payment that the route refused without a sponsor.
          reason={`The route sponsors only ${limit}.`}
          sponsor={sponsor}
        />
      )
    if (failed?.action === 'send')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const fundState = (() => {
    if (funded) return 'done'
    if (account) return 'active'
    return 'idle'
  })()
  const sendState = (() => {
    if (sent) return 'done'
    if (funded) return 'active'
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
        detail={fundDetail}
        label="Fund the Tempo Account on testnet."
        number={2}
        state={fundState}
      >
        {!funded && (
          <DemoButton
            disabled={!account}
            loading={pending === 'fund'}
            onClick={() =>
              run('fund', async () => {
                await accounts.faucet.fundSync({ account: account! })
                setFunded(true)
                return { type: 'idle' }
              })
            }
          >
            Fund
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={sendDetail}
        label="Send 1 OUSD with no fee."
        number={3}
        state={sendState}
      >
        <DemoButton
          disabled={!funded || isReauthorizing}
          loading={pending === 'send'}
          onClick={() =>
            run('send', async () => {
              const { receipt } = await accounts.token.transferSync({
                amount,
                to: recipient,
                token: Addresses.ousd,
              })
              return {
                feePayer: receipt.feePayer,
                hash: receipt.transactionHash,
                type: 'sent',
              }
            })
          }
        >
          {sent ? 'Send again' : 'Send'}
        </DemoButton>
      </DemoStep>
    </>
  )
}

export declare namespace Steps {
  /** Properties for the Steps component. */
  type Props = {
    /** Instance of the demo, which {@link create} returns. */
    accounts: create.ReturnType
    /** Name of the fee payer of the relay route, which starts the sentence of the result. */
    sponsor: string
  }
}

/**
 * Shows the result of a payment: the account that paid its fee, and a link to its receipt.
 *
 * @example
 * ```tsx
 * import * as Payment from './fee-sponsorship/Payment.tsx'
 *
 * <Payment.Result account={account} feePayer={receipt.feePayer} hash={hash} sponsor="The sponsor" />
 * ```
 */
export function Result(props: Result.Props) {
  const { account, explorer, feePayer, hash, reason, sponsor } = props

  // The receipt names the account that paid the fee.
  const sponsored = feePayer && !isAddressEqual(feePayer, account)

  return (
    <>
      Sent 1 OUSD.{' '}
      {sponsored
        ? `${sponsor} ${feePayer.slice(0, 6)}…${feePayer.slice(-4)} paid the fee.`
        : `The Tempo Account paid the fee.${reason ? ` ${reason}` : ''}`}{' '}
      {explorer && (
        <a href={`${explorer}/tx/${hash}`} rel="noreferrer" target="_blank">
          See the receipt
        </a>
      )}
    </>
  )
}

export declare namespace Result {
  /** Properties for the Result component. */
  type Props = {
    /** The Tempo Account that sent the payment. */
    account: Address
    /** URL of the explorer of the chain. Without it, the result links no receipt. */
    explorer?: string | undefined
    /** The account that paid the fee, as the receipt names it. */
    feePayer: Address | null | undefined
    /** Hash of the transaction. */
    hash: string
    /** Why a route refuses a fee, which follows the result of a payment without a sponsor. */
    reason?: string | undefined
    /** Name of the fee payer of the demo, which starts the sentence of the result. */
    sponsor: string
  }
}
