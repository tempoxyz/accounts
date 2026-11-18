/**
 * Demonstrates a change of the limit of a session's access key, and its revocation, each on Tempo
 * ID's approval page in the dialog.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { type ReactNode, useState } from 'react'
import { parseUnits } from 'viem'
import { tempoTestnet } from 'viem/chains'
import { Addresses } from 'viem/tempo'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as AccessKey from './access-keys/AccessKey.ts'
import { useRun } from './access-keys/Run.ts'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. Each sign-in requests an access key that sends up to 10 OUSD for a day.
 */
export const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  }),
  chain: 'testnet',
  plugins: [react()],
})

/** Hash of the transaction of a change or a revocation, or `null` for no transaction. */
type Transaction = `0x${string}` | null

/** Signs a user in with an access key, lowers the limit of the access key, then revokes it. */
export default function RevokeAccessKeys() {
  const { isPending, session } = accounts.useSession()
  const [changed, setChanged] = useState<Transaction>()
  const [revoked, setRevoked] = useState<Transaction>()
  const { failed, pending, run } = useRun<'change' | 'revoke' | 'signIn'>()

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const accessKey = session?.accessKey
  const explorer = tempoTestnet.blockExplorers.default.url

  /** Returns the result of an action, with the link of its transaction. */
  function result(text: string, transaction: Transaction): ReactNode {
    if (!transaction) return text
    return (
      <>
        {text}{' '}
        <a
          href={`${explorer}/tx/${transaction}`}
          rel="noreferrer"
          target="_blank"
        >
          See the transaction
        </a>
      </>
    )
  }

  const signInDetail = (() => {
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    if (accessKey) return AccessKey.describe(accessKey)
    return undefined
  })()
  const changeDetail = (() => {
    if (failed?.action === 'change')
      return <span role="alert">{failed.message}</span>
    if (changed)
      return result('The access key now sends up to 5 OUSD.', changed)
    return undefined
  })()
  const revokeDetail = (() => {
    if (failed?.action === 'revoke')
      return <span role="alert">{failed.message}</span>
    if (revoked) return result('The access key is revoked.', revoked)
    if (revoked === null) return 'The access key was revoked already.'
    return undefined
  })()
  const changeState = (() => {
    if (changed) return 'done'
    if (accessKey) return 'active'
    return 'idle'
  })()
  const revokeState = (() => {
    if (revoked !== undefined) return 'done'
    if (accessKey) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={signInDetail}
        label="Sign in with an access key that sends up to 10 OUSD."
        number={1}
        state={accessKey ? 'done' : 'active'}
      >
        {!accessKey && (
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
        detail={changeDetail}
        label="Lower the limit to 5 OUSD."
        number={2}
        state={changeState}
      >
        <DemoButton
          disabled={!accessKey || revoked !== undefined}
          loading={pending === 'change'}
          onClick={() =>
            run('change', async () => {
              const { transaction } = await accounts.dialog.updateAccessKey({
                limits: [{ limit: parseUnits('5', 6), token: Addresses.ousd }],
              })
              setChanged(transaction)
            })
          }
        >
          Change
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={revokeDetail}
        label="Revoke the access key."
        number={3}
        state={revokeState}
      >
        <DemoButton
          disabled={!accessKey || revoked !== undefined}
          loading={pending === 'revoke'}
          onClick={() =>
            run('revoke', async () => {
              const { transaction } = await accounts.dialog.revokeAccessKey()
              setRevoked(transaction)
            })
          }
        >
          Revoke
        </DemoButton>
      </DemoStep>
    </>
  )
}
