/**
 * Demonstrates an MPP session. A session manager pays each request of a metered route of the
 * site's server: the first request opens a channel with a deposit, each later one pays with a
 * voucher of the access key, and the close settles the channel. It runs the calls of
 * `examples/mpp-session`.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { type ReactNode, useState } from 'react'
import { formatUnits } from 'viem'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** The most that the channel of a session holds, in OUSD. */
const maxDeposit = '0.05'

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
  // The `mpp` plugin pays through the client of the `viem` plugin, so it comes after it.
  plugins: [react(), viem(), mpp()],
})

/** The action of a control. */
type Action = 'close' | 'request' | 'signIn' | 'start'

/** The session of the demo: before its start, while its channel is open, or after its close. */
type Stage =
  | {
      /** The deposit of the channel, in base units. */
      deposit: bigint
      /** The fortune of the last request. */
      fortune: string
      /** The manager of the session, which holds the channel in memory. */
      manager: mpp.SessionManager
      /** The total that the vouchers of the session authorize, in base units. */
      spent: bigint
      type: 'open'
    }
  | {
      /** The hash of the close transaction. Absent if the endpoint names none. */
      hash?: string | undefined
      /** The part of the deposit that the endpoint received, in base units. */
      spent: bigint
      type: 'closed'
    }
  | { type: 'idle' }

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { type: 'idle' }

/**
 * Pays one request of the metered route through `manager`, and returns the open stage with its
 * fortune.
 */
async function request(manager: mpp.SessionManager): Promise<Stage> {
  const response = await manager.fetch(
    new URL('/api/sessions/mpp/fortune', location.origin),
  )
  if (!response.ok) throw new Error(`The route failed with ${response.status}.`)
  const { fortune } = (await response.json()) as { fortune: string }

  const { state } = manager
  return {
    deposit: state.status === 'active' ? BigInt(state.deposit) : 0n,
    fortune,
    manager,
    spent: manager.cumulative,
    type: 'open',
  }
}

/** Returns `amount` of base units in OUSD, such as `0.003`. */
function format(amount: bigint) {
  return formatUnits(amount, 6)
}

/**
 * Signs a user in with an access key, starts a session whose channel holds at most 0.05 OUSD, pays
 * 0.001 OUSD for each fortune, and closes the session.
 */
export default function PayWithSessions() {
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
  // A session without an access key signs no voucher, so the first step stays open.
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
          'start',
          stage.type === 'open' &&
            `The first request opened a channel that holds ${format(stage.deposit)} OUSD.`,
        )}
        label={`Start a session that deposits at most ${maxDeposit} OUSD.`}
        number={2}
        state={(() => {
          if (stage.type !== 'idle') return 'done'
          if (accessKey) return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={!accessKey || busy || stage.type === 'open'}
          loading={pending === 'start'}
          onClick={() =>
            run('start', async () => {
              const manager = accounts.mpp.session({ maxDeposit })

              try {
                return await request(manager)
              } catch (error) {
                // A channel that the failed request opened returns its deposit. The request's
                // error stays the one shown, also if the close fails.
                await manager.close().catch(() => undefined)
                throw error
              }
            })
          }
        >
          {stage.type === 'closed' ? 'Start again' : 'Start'}
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail(
          'request',
          stage.type === 'open' && (
            <>
              “{stage.fortune}” Spent {format(stage.spent)} of{' '}
              {format(stage.deposit)} OUSD.
            </>
          ),
        )}
        label="Request a fortune for 0.001 OUSD, with a voucher."
        number={3}
        state={stage.type === 'idle' ? 'idle' : 'done'}
      >
        <DemoButton
          disabled={stage.type !== 'open' || busy}
          loading={pending === 'request'}
          onClick={() =>
            run('request', async () => {
              if (stage.type !== 'open') return stage
              return request(stage.manager)
            })
          }
        >
          Request
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail(
          'close',
          stage.type === 'closed' && (
            <>
              The server received {format(stage.spent)} OUSD, and the channel
              returned the rest of the deposit.{' '}
              {explorer && stage.hash && (
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
        label="Close the session."
        number={4}
        state={(() => {
          if (stage.type === 'closed') return 'done'
          if (stage.type === 'open') return 'active'
          return 'idle'
        })()}
      >
        <DemoButton
          disabled={stage.type !== 'open' || busy}
          loading={pending === 'close'}
          onClick={() =>
            run('close', async () => {
              if (stage.type !== 'open') return stage

              const receipt = await stage.manager.close()
              return {
                hash: receipt?.txHash,
                spent: BigInt(receipt?.spent ?? stage.manager.cumulative),
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
