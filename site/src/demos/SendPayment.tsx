/**
 * Demonstrates a sign-in through Tempo ID's dialog, and a payment that the access key of the
 * sign-in signs. It runs the calls of `examples/web`.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Recipient of the demo's payment, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that sends up to 100 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react(), viem()],
})

/** The action that runs, or how the last one ended. */
type Status =
  | { action: 'send' | 'signIn'; type: 'pending' }
  | { action: 'send' | 'signIn'; message: string; type: 'failed' }
  | { hash: string; type: 'sent' }
  | { type: 'idle' }

/** Signs a user in with an access key, then sends 1 OUSD with the access key. */
export default function SendPayment() {
  const { isPending, isReauthorizing, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  /** Runs `fn` as `action`, and shows its result or its failure. */
  function run(action: 'send' | 'signIn', fn: () => Promise<Status>) {
    setStatus({ action, type: 'pending' })
    // The failure handler settles each rejection.
    void fn().then(setStatus, (error: Error) =>
      setStatus({ action, message: error.message, type: 'failed' }),
    )
  }

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  // A session without an access key signs no transaction, so the first step stays open.
  const account = session?.accessKey?.account
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  const signInDetail = (() => {
    if (account) return `Signed in as ${session.user.email ?? account}.`
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const sendDetail = (() => {
    if (status.type === 'sent')
      return (
        <>
          Sent 1 OUSD.{' '}
          {explorer && (
            <a
              href={`${explorer}/tx/${status.hash}`}
              rel="noreferrer"
              target="_blank"
            >
              See the receipt
            </a>
          )}
        </>
      )
    if (failed?.action === 'send')
      return <span role="alert">{failed.message}</span>
    return undefined
  })()
  const sendState = (() => {
    if (status.type === 'sent') return 'done'
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
        detail={sendDetail}
        label="Send 1 OUSD with the access key."
        number={2}
        state={sendState}
      >
        <DemoButton
          disabled={!account || isReauthorizing}
          loading={pending === 'send'}
          onClick={() =>
            run('send', async () => {
              const { transaction } = await accounts.pay({
                amount: '1',
                to: recipient,
                token: 'ousd',
              })
              return { hash: transaction, type: 'sent' }
            })
          }
        >
          {status.type === 'sent' ? 'Send again' : 'Send'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
