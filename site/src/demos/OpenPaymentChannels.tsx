/**
 * Demonstrates a payment channel that the app manages itself. The access key of the sign-in opens
 * the channel with a deposit, and signs a voucher for each fortune. The site's server holds the
 * highest voucher, and closes the channel with it.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { type ReactNode, useState } from 'react'
import { type Address, formatUnits, type Hex, parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Deposit of the demo's channel, in the base units of OUSD. */
const deposit = parseUnits('0.05', 6)

/** Price of one fortune, in the base units of OUSD. */
const price = parseUnits('0.001', 6)

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that spends up to 1 OUSD for a day. Without
 * `scopes`, the access key may open and top up a channel.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '1', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react(), viem()],
})

/** The action of a control. */
type Action = 'close' | 'open' | 'pay' | 'signIn'

/** The channel, as its open returns it. A voucher and the close name it. */
type Channel = {
  /** The address that signs each voucher, the access key's. */
  authorizedSigner: Address
  /** The hash that binds the channel to its open transaction. */
  expiringNonceHash: Hex
  /** The address that may settle for the payee. The zero address names none. */
  operator: Address
  /** The site's server, which receives each payment. */
  payee: Address
  /** The Tempo Account, which holds the deposit. */
  payer: Address
  /** A random value, which sets two channels of the same parties apart. */
  salt: Hex
  /** The token of the deposit. */
  token: Address
}

/** The channel of the demo: before its open, while it is open, or after its close. */
type Stage =
  | {
      channel: Channel
      /** The last fortune that a voucher paid. */
      fortune?: string | undefined
      /** The total of the last voucher that the server accepted, in base units. */
      spent: bigint
      type: 'open'
    }
  | {
      /** The hash of the close transaction. */
      hash: string
      /** The part of the deposit that the Tempo Account received, in base units. */
      refunded: bigint
      /** The part of the deposit that the payee received, in base units. */
      settled: bigint
      type: 'closed'
    }
  | { type: 'idle' }

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { type: 'idle' }

/**
 * Posts `body` to the route `name` of the demo's server, and returns its response. A refusal
 * rejects with its message.
 */
async function post<result>(name: string, body: unknown): Promise<result> {
  const response = await fetch(`/api/sessions/channel/${name}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const result = (await response.json()) as result & { message?: string }
  if (!response.ok)
    throw new Error(
      result.message ?? `The route failed with ${response.status}.`,
    )
  return result
}

/** Returns `amount` of base units in OUSD, such as `0.003`. */
function format(amount: bigint) {
  return formatUnits(amount, 6)
}

/**
 * Signs a user in with an access key, opens a channel with a deposit of 0.05 OUSD, pays 0.001
 * OUSD for each fortune with a voucher, and closes the channel on the site's server.
 */
export default function OpenPaymentChannels() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [stage, setStage] = useState<Stage>({ type: 'idle' })
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows the stage that it returns, or its failure. */
  function run(action: Action, fn: () => Promise<Stage>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(
      (stage) => {
        setStage(stage)
        setStatus({ type: 'idle' })
      },
      (error: Error) =>
        setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  // A session without an access key signs no transaction, so the first step stays open.
  const accessKey = session?.accessKey
  const explorer = accounts.viem.chain.blockExplorers?.default.url
  const busy = isReauthorizing || pending !== undefined

  /** Returns the detail of the step of `action`: its failure, or else `detail`. */
  function detail(action: Action, detail?: ReactNode) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
    return detail
  }

  return (
    <>
      <DemoStep
        detail={detail(
          'signIn',
          accessKey &&
            `Signed in as ${session.user.email ?? accessKey.account}.`,
        )}
        label="Sign in, or create a Tempo Account."
        number={1}
        state={accessKey ? 'done' : 'active'}
      >
        {!accessKey && (
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
        detail={detail(
          'open',
          stage.type === 'open' &&
            `Opened a channel that holds ${format(deposit)} OUSD.`,
        )}
        label={`Open a channel with a deposit of ${format(deposit)} OUSD.`}
        number={2}
        state={(() => {
          if (stage.type !== 'idle') return 'done'
          if (accessKey) return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={!accessKey || busy || stage.type === 'open'}
          loading={pending === 'open'}
          onClick={() =>
            run('open', async () => {
              const response = await fetch('/api/sessions/channel/payee')
              const { message, payee } = (await response.json()) as {
                message?: string
                payee: Address
              }
              if (!response.ok)
                throw new Error(
                  message ?? `The route failed with ${response.status}.`,
                )

              const {
                channelId: _channelId,
                deposit: _deposit,
                receipt: _receipt,
                ...channel
              } = await accounts.channel.openSync({
                // The chain verifies each voucher against this address, the access key's own.
                authorizedSigner: accessKey!.keyAuthorization.keyId,
                deposit,
                // An open is no transfer, so it names the token of its fee. The access key pays
                // a fee only in a token of its limits.
                feeToken: Addresses.ousd,
                payee,
                token: Addresses.ousd,
              })
              return { channel, spent: 0n, type: 'open' }
            })
          }
        >
          {stage.type === 'closed' ? 'Open again' : 'Open'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail(
          'pay',
          stage.type === 'open' && stage.fortune && (
            <>
              “{stage.fortune}” Spent {format(stage.spent)} of {format(deposit)}{' '}
              OUSD.
            </>
          ),
        )}
        label={`Pay ${format(price)} OUSD for a fortune, with a voucher.`}
        number={3}
        state={(() => {
          if (stage.type === 'closed') return 'done'
          if (stage.type === 'idle') return 'idle'
          return stage.spent > 0n ? 'done' : 'active'
        })()}
      >
        <DemoButton
          disabled={stage.type !== 'open' || busy}
          loading={pending === 'pay'}
          onClick={() =>
            run('pay', async () => {
              if (stage.type !== 'open') return stage
              const { channel } = stage

              // A voucher names the total that the channel pays, not the price of one fortune.
              const cumulativeAmount = stage.spent + price
              const signature = await accounts.channel.signVoucher({
                channel,
                cumulativeAmount,
              })
              const { fortune } = await post<{ fortune: string }>('fortune', {
                channel,
                cumulativeAmount: cumulativeAmount.toString(),
                signature,
              })
              return { channel, fortune, spent: cumulativeAmount, type: 'open' }
            })
          }
        >
          {stage.type === 'open' && stage.spent > 0n ? 'Pay again' : 'Pay'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail(
          'close',
          stage.type === 'closed' && (
            <>
              The server received {format(stage.settled)} OUSD, and the channel
              returned {format(stage.refunded)} OUSD.{' '}
              {explorer && (
                <a
                  href={`${explorer}/tx/${stage.hash}`}
                  rel="noreferrer"
                  target="_blank"
                >
                  See the receipt
                </a>
              )}
            </>
          ),
        )}
        label="Close the channel on the server."
        number={4}
        state={(() => {
          if (stage.type === 'closed') return 'done'
          if (stage.type === 'open' && stage.spent > 0n) return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={stage.type !== 'open' || busy}
          loading={pending === 'close'}
          onClick={() =>
            run('close', async () => {
              if (stage.type !== 'open') return stage

              const result = await post<{
                refunded: string
                settled: string
                transactionHash: string
              }>('close', { channel: stage.channel })
              return {
                hash: result.transactionHash,
                refunded: BigInt(result.refunded),
                settled: BigInt(result.settled),
                type: 'closed',
              }
            })
          }
        >
          Close
        </DemoButton>
      </DemoStep>
    </>
  )
}
