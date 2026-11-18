/**
 * Demonstrates the sign-in of an end-to-end test: the `dialog` stand-in of `accounts/test` signs in
 * with no dialog and no request to Tempo ID, the faucet funds the new Tempo Account, and the access
 * key sends a transfer on Tempo testnet.
 * @module
 */
'use client'

import { Accounts, Store } from 'accounts'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import * as test from 'accounts/test'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'

/** Recipient of the demo's transfer, an address that no one holds. */
const recipient = '0x000000000000000000000000000000000000dEaD'

/**
 * The demo's instance, on Tempo testnet. Its session holds placeholder tokens, so a memory store
 * keeps it apart from the stored session that the other demos share. Each sign-in requests an
 * access key that sends up to 100 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react(), test.dialog(), viem()],
  store: Store.memory(),
})

/** An action of the demo. */
type Action = 'fund' | 'send' | 'signIn'

/** The action that runs, or how the last one ended. */
type Status =
  | { action: Action; type: 'pending' }
  | { action: Action; message: string; type: 'failed' }
  | { type: 'idle' }

/** Signs in with no dialog, funds the Tempo Account, then sends 1 OUSD with the access key. */
export default function EndToEndTests() {
  const { session } = accounts.useSession()
  const [funded, setFunded] = useState(false)
  const [hash, setHash] = useState<string>()
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

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined
  const account = session?.accessKey?.account
  const explorer = accounts.viem.chain.blockExplorers?.default.url

  /** The failure of `action`, as an alert, or `undefined`. */
  const failure = (action: Action) =>
    failed?.action === action ? (
      <span role="alert">{failed.message}</span>
    ) : undefined

  const signInDetail = account
    ? `Signed in as ${session.user.email}, with the Tempo Account ${account}.`
    : failure('signIn')
  const fundDetail = funded ? 'The Tempo Account holds OUSD.' : failure('fund')
  const sendDetail = hash ? (
    <>
      Sent 1 OUSD.{' '}
      {explorer && (
        <a href={`${explorer}/tx/${hash}`} rel="noreferrer" target="_blank">
          See the receipt
        </a>
      )}
    </>
  ) : (
    failure('send')
  )
  const fundState = (() => {
    if (funded) return 'done'
    if (account) return 'active'
    return 'idle'
  })()
  const sendState = (() => {
    if (hash) return 'done'
    if (funded) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in with no dialog."
        number={1}
        state={account ? 'done' : 'active'}
      >
        {!account && (
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
              })
            }
          >
            Fund
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={sendDetail}
        label="Send 1 OUSD with the access key."
        number={3}
        state={sendState}
      >
        <DemoButton
          disabled={!funded}
          loading={pending === 'send'}
          onClick={() =>
            run('send', async () => {
              const { transaction } = await accounts.pay({
                amount: '1',
                to: recipient,
                token: 'ousd',
              })
              setHash(transaction)
            })
          }
        >
          {hash ? 'Send again' : 'Send'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
