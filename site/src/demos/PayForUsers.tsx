/**
 * Demonstrates a payment that an API sends for a user. The user approves a connection of the page
 * to the API of the site. The API then pays with the access key that it holds for the connection.
 * @module
 */
'use client'

import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as Connection from './connections/Connection.tsx'

export { accounts } from './connections/Connection.tsx'

/** Signs a user in for the API, then asks the API to pay 1 OUSD for the user. */
export default function PayForUsers() {
  const resource = Connection.useResource()
  const { isPending, session } = Connection.accounts.useSession()
  const { failure, pending, run } = Connection.useRun<'pay' | 'signIn'>()
  const [payment, setPayment] = useState<Connection.Payment>()

  if (isPending || resource.type === 'pending')
    return <span aria-label="Loading" data-demo-spinner="" />
  if (resource.type === 'unregistered') return <Connection.Unregistered />

  const payState = (() => {
    if (payment) return 'done'
    if (session) return 'active'
    return 'idle'
  })()

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
        state={payState}
      >
        <DemoButton
          disabled={!session || pending !== undefined}
          loading={pending === 'pay'}
          onClick={() =>
            run('pay', async () => setPayment(await Connection.pay()))
          }
        >
          {payment ? 'Pay again' : 'Pay'}
        </DemoButton>
      </DemoStep>
    </>
  )
}
