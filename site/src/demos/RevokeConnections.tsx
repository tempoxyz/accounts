/**
 * Demonstrates the revocation of a connection by its API. The API of the site pays once with the
 * access key of the connection, then revokes each access key of it. Tempo ID refuses the next
 * payment, since the connection holds no approval for a new access key.
 * @module
 */
'use client'

import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as Connection from './connections/Connection.tsx'

export { accounts } from './connections/Connection.tsx'

/** An action of the demo. */
type Action = 'pay' | 'payAgain' | 'revoke' | 'signIn'

/** The result of the payment after the revocation. */
type Second =
  | { payment: Connection.Payment; type: 'paid' }
  | { reason: string; status: number; type: 'refused' }

/**
 * Signs a user in for the API, asks the API to pay 1 OUSD, to revoke the connection, and to pay
 * again, and shows the refusal of the second payment.
 */
export default function RevokeConnections() {
  const resource = Connection.useResource()
  const { isPending, session } = Connection.accounts.useSession()
  const { failure, pending, run } = Connection.useRun<Action>()
  const [payment, setPayment] = useState<Connection.Payment>()
  const [revocation, setRevocation] = useState<readonly `0x${string}`[]>()
  const [second, setSecond] = useState<Second>()

  if (isPending || resource.type === 'pending')
    return <span aria-label="Loading" data-demo-spinner="" />
  if (resource.type === 'unregistered') return <Connection.Unregistered />

  // Each step is the next one once the step before it is complete.
  const next = ((): Action | 'complete' => {
    if (!session) return 'signIn'
    if (!payment) return 'pay'
    if (!revocation) return 'revoke'
    if (!second) return 'payAgain'
    return 'complete'
  })()
  const state = (action: Action, done: boolean) => {
    if (done) return 'done'
    return next === action ? 'active' : 'idle'
  }

  return (
    <>
      <Connection.SignIn
        failure={failure('signIn')}
        loading={pending === 'signIn'}
        onSignIn={() =>
          run('signIn', () => Connection.signIn(resource.identifier))
        }
      />
      <DemoStep
        detail={
          failure('pay') ??
          (payment && (
            <>
              The API paid 1 OUSD with its access key{' '}
              {Connection.short(payment.accessKey)}.{' '}
              <Connection.Receipt hash={payment.transactionHash} />
            </>
          ))
        }
        label="Ask the API to pay 1 OUSD."
        number={2}
        state={state('pay', !!payment)}
      >
        {!payment && (
          <DemoButton
            disabled={next !== 'pay' || pending !== undefined}
            loading={pending === 'pay'}
            onClick={() =>
              run('pay', async () => setPayment(await Connection.pay()))
            }
          >
            Pay
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={
          failure('revoke') ??
          (revocation && (
            <>
              The API revoked its access key.{' '}
              {revocation[0] && <Connection.Receipt hash={revocation[0]} />}
            </>
          ))
        }
        label="Ask the API to revoke the connection."
        number={3}
        state={state('revoke', !!revocation)}
      >
        {!revocation && (
          <DemoButton
            disabled={next !== 'revoke' || pending !== undefined}
            loading={pending === 'revoke'}
            onClick={() =>
              run('revoke', async () => {
                const { transactionHashes } = await Connection.revoke()
                setRevocation(transactionHashes)
              })
            }
          >
            Revoke
          </DemoButton>
        )}
      </DemoStep>
      <DemoStep
        detail={
          failure('payAgain') ??
          (() => {
            if (second?.type === 'refused')
              return (
                <>
                  Tempo ID refused a new access key with {second.reason}, so the
                  API responded with {second.status}. A new sign-in approves the
                  API again.
                </>
              )
            if (second?.type === 'paid')
              return (
                <>
                  The API paid 1 OUSD with a new access key{' '}
                  {Connection.short(second.payment.accessKey)}.{' '}
                  <Connection.Receipt hash={second.payment.transactionHash} />
                </>
              )
            return undefined
          })()
        }
        label="Ask the API to pay again."
        number={4}
        state={state('payAgain', !!second)}
      >
        {!second && (
          <DemoButton
            disabled={next !== 'payAgain' || pending !== undefined}
            loading={pending === 'payAgain'}
            onClick={() =>
              run('payAgain', async () => {
                // The refusal of the connection is the result of the step. Each other failure is
                // shown as one.
                const result = await Connection.pay().catch(
                  (error: unknown) => {
                    if (
                      error instanceof Connection.RefusedError &&
                      error.status === 403
                    )
                      return error
                    throw error
                  },
                )
                setSecond(
                  result instanceof Connection.RefusedError
                    ? {
                        reason: result.reason,
                        status: result.status,
                        type: 'refused',
                      }
                    : { payment: result, type: 'paid' },
                )
              })
            }
          >
            Pay
          </DemoButton>
        )}
      </DemoStep>
    </>
  )
}
