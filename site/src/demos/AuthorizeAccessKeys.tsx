/**
 * Demonstrates a sign-in through Tempo ID's dialog that requests an access key with a selected
 * limit and expiry, and a later request that authorizes a new access key for the signed-in user on
 * Tempo ID's approval page.
 * @module
 */
'use client'

import { Accounts, Permissions } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as AccessKey from './access-keys/AccessKey.ts'
import { useRun } from './access-keys/Run.ts'
import { Select } from './access-keys/Select.tsx'

/** Expiries that the demo offers, each as a duration from the request. */
const expiries = [
  { label: '1 hour', value: '1h' },
  { label: '1 day', value: '1d' },
  { label: '7 days', value: '7d' },
] as const

/** Limits that the demo offers, each in whole OUSD. */
const limits = [
  { label: '5 OUSD', value: '5' },
  { label: '25 OUSD', value: '25' },
  { label: '100 OUSD', value: '100' },
] as const

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. It names no access key, since each request of the demo names its own.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/**
 * Signs a user in with an access key of the selected limit and expiry, then authorizes a new one
 * for the signed-in user.
 */
export default function AuthorizeAccessKeys() {
  const { isPending, session } = accounts.useSession()
  const [expiry, setExpiry] = useState<(typeof expiries)[number]['value']>('1d')
  const [limit, setLimit] = useState<(typeof limits)[number]['value']>('25')
  // The ID of the access key that the second step authorized.
  const [authorized, setAuthorized] = useState<string>()
  const { failed, pending, run } = useRun<'authorize' | 'signIn'>()

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const accessKey = session?.accessKey
  const permissions = Permissions.from({
    expiry,
    limits: [{ limit, token: 'ousd' }],
  })
  const done = accessKey && accessKey.keyAuthorization.keyId === authorized
  const signInDetail = (() => {
    if (failed?.action === 'signIn')
      return <span role="alert">{failed.message}</span>
    if (done) return `Signed in as ${session.user.email}.`
    if (accessKey) return AccessKey.describe(accessKey)
    return undefined
  })()
  const authorizeDetail = (() => {
    if (failed?.action === 'authorize')
      return <span role="alert">{failed.message}</span>
    if (done) return AccessKey.describe(accessKey)
    return undefined
  })()
  const authorizeState = (() => {
    if (done) return 'done'
    if (session) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        label="Select the limit and the expiry."
        number={1}
        state={session ? 'done' : 'active'}
      >
        <Select
          disabled={pending !== undefined}
          label="Limit"
          onChange={setLimit}
          options={limits}
          value={limit}
        />
        <Select
          disabled={pending !== undefined}
          label="Expiry"
          onChange={setExpiry}
          options={expiries}
          value={expiry}
        />
      </DemoStep>
      <DemoStep
        detail={signInDetail}
        label="Sign in, and approve the access key."
        number={2}
        state={session ? 'done' : 'active'}
      >
        {!session && (
          <DemoButton
            loading={pending === 'signIn'}
            onClick={() =>
              run('signIn', async () => {
                await accounts.dialog.signIn({ accessKey: permissions })
              })
            }
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={authorizeDetail}
        label="Authorize a new access key of the selected limit and expiry."
        number={3}
        state={authorizeState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'authorize'}
          onClick={() =>
            run('authorize', async () => {
              // The user holds a Tempo ID session, so the dialog shows only the approval page.
              const next = await accounts.dialog.signIn({
                accessKey: permissions,
              })
              setAuthorized(next.accessKey?.keyAuthorization.keyId)
            })
          }
        >
          {done ? 'Authorize again' : 'Authorize'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
