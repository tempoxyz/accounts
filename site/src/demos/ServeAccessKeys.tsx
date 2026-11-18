/**
 * Demonstrates the access key endpoint of an API. The user approves a connection of the page to the
 * API of the site, and Tempo ID requests the connection's access key from the API's endpoint. The
 * demo shows each request beside the payment that the access key signs.
 * @module
 */
'use client'

import { useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import * as Connection from './connections/Connection.tsx'
import './connections/ServeAccessKeys.css'

export { accounts } from './connections/Connection.tsx'

/** Path of the access key endpoint, as the log names it. */
const endpoint = 'POST /api/connections/access-keys'

/**
 * Signs a user in for the API, shows the access key requests that the API's endpoint answered, then
 * asks the API to pay 1 OUSD with the access key.
 */
export default function ServeAccessKeys() {
  const resource = Connection.useResource()
  const { isPending, session } = Connection.accounts.useSession()
  const { failure, pending, run } = Connection.useRun<'pay' | 'signIn'>()
  const [payment, setPayment] = useState<Connection.Payment>()
  const [requests, setRequests] =
    useState<readonly Connection.AccessKeyRequest[]>()

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
          run('signIn', async () => {
            await Connection.signIn(resource.identifier)
            setRequests(await Connection.accessKeyRequests())
          })
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
      <Log payment={payment} requests={requests} />
    </>
  )
}

/** Shows each access key request that the API's endpoint answered for the connection. */
function Log(props: Log.Props) {
  const { payment, requests } = props

  return (
    <div data-connections-log="">
      <div data-connections-log-title="">
        <span>Access key endpoint</span>
        <code>{endpoint}</code>
      </div>
      {requests?.length ? (
        <ol aria-label="Access key requests">
          {requests.map((request) => (
            <li key={request.accessKey}>
              <time dateTime={new Date(request.at).toISOString()}>
                {new Date(request.at).toLocaleTimeString()}
              </time>
              <span>
                Tempo ID requested an access key for{' '}
                {new URL(request.clientId).host}. The endpoint returned{' '}
                {Connection.short(request.accessKey)}.
              </span>
              {payment?.accessKey.toLowerCase() ===
                request.accessKey.toLowerCase() && (
                <span data-connections-log-mark="">Signed the payment</span>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p>
          {requests
            ? 'No request for this connection yet.'
            : 'Tempo ID calls the endpoint when the user approves.'}
        </p>
      )}
    </div>
  )
}

declare namespace Log {
  /** Properties for the Log component. */
  type Props = {
    /** Payment whose access key the log marks. */
    payment: Connection.Payment | undefined
    /** Access key requests of the connection, newest first. Absent before the sign-in. */
    requests: readonly Connection.AccessKeyRequest[] | undefined
  }
}
