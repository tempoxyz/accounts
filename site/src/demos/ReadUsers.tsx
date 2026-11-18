/**
 * Demonstrates the user of a session: a sign-in through Tempo ID's dialog, then the ID and the
 * email address that the session holds.
 * @module
 */
'use client'

import { Accounts } from 'accounts'
import { react } from 'accounts/react'
import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import { Fields } from './identity/Fields.tsx'

/**
 * The demo's instance, on Tempo testnet. The page's origin is its client ID, so the site needs no
 * registration. A sign-in requests no access key, since the demo signs no transaction.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
})

/** The sign-in that runs, or how the last one ended. */
type Status =
  | { message: string; type: 'failed' }
  | { type: 'idle' }
  | { type: 'pending' }

/** Signs a user in, then shows the user of the session. */
export default function ReadUsers() {
  const { isPending, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const user = session?.user

  return (
    <>
      <DemoStep
        detail={
          status.type === 'failed' && <span role="alert">{status.message}</span>
        }
        label="Sign in, or create a Tempo Account."
        number={1}
        state={user ? 'done' : 'active'}
      >
        {!user && (
          <DemoButton
            loading={status.type === 'pending'}
            onClick={() => {
              setStatus({ type: 'pending' })
              // The failure handler settles each rejection.
              void accounts.dialog.signIn().then(
                () => setStatus({ type: 'idle' }),
                (error: Error) =>
                  setStatus({ message: error.message, type: 'failed' }),
              )
            }}
          >
            Sign in
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={
          user && (
            <Fields
              entries={[
                ['id', user.id],
                ['email', user.email],
              ]}
            />
          )
        }
        label="Read the user of the session."
        number={2}
        state={user ? 'done' : 'idle'}
      />
    </>
  )
}
