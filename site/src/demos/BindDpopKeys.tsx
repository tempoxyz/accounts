/**
 * Demonstrates a request that a DPoP proof authenticates. The `dpop` plugin binds the tokens of the
 * sign-in to a DPoP key. The page calls the API route of the site with the access token and a
 * proof, then sends the same request again, which the API refuses.
 * @module
 */
'use client'

import { Accounts, Store } from 'accounts'
import { dpop } from 'accounts/plugins'
import { react } from 'accounts/react'
import { type ReactNode, useRef, useState } from 'react'
import { DemoButton, DemoStep } from '../components/Demo.tsx'
import {
  Call,
  read,
  type Result,
  tokenRoute,
} from './api-authentication/Call.tsx'

/**
 * The store of the demo's session and DPoP key. The other demos of the site share one store in the
 * browser, and hold no DPoP key, so they cannot use a bound session. The demo thus keeps both in
 * memory, and a new load creates a new DPoP key, with no session.
 */
const store = Store.memory()

/**
 * The property of each response of the instance that holds the headers of its request, such as the
 * access token and the proof of a call to the API route. The instance's `fetch` sets it, and the
 * last step sends them again. The page never renders them.
 */
const sent = Symbol('sent')

/** The demo's instance, which binds its tokens to the DPoP key of the `dpop` plugin. */
export const accounts = Accounts.create({
  chain: 'testnet',
  async fetch(input, init) {
    const response = await globalThis.fetch(input, init)
    return Object.assign(response, { [sent]: new Headers(init?.headers) })
  },
  plugins: [await dpop({ store }), react()],
  store,
})

/** An action of the demo: the sign-in, a call with a new proof, or the same call again. */
type Action = 'first' | 'repeated' | 'signIn'

/** The action that runs, or how the last one failed. */
type Status =
  | { action: Action; message: string; type: 'failed' }
  | { action: Action; type: 'pending' }
  | { type: 'idle' }

/** Signs a user in with a DPoP key, calls the API with a proof, then sends the proof again. */
export default function BindDpopKeys() {
  const { isPending, session } = accounts.useSession()
  const [status, setStatus] = useState<Status>({ type: 'idle' })
  const [first, setFirst] = useState<Result>()
  const [repeated, setRepeated] = useState<Result>()
  // The headers of the first call, which the second call sends again.
  const headers = useRef<Headers>(undefined)

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

  if (isPending) return <span aria-label="Loading" data-demo-spinner="" />

  const pending = status.type === 'pending' ? status.action : undefined
  const failed = status.type === 'failed' ? status : undefined

  /** Returns the detail of the step of `action`: its failure, or else `result`. */
  function detail(action: Action, result: ReactNode) {
    if (failed?.action === action)
      return <span role="alert">{failed.message}</span>
    return result
  }
  const firstState = (() => {
    if (first) return 'done'
    if (session) return 'active'
    return 'idle'
  })()
  const repeatedState = (() => {
    if (repeated) return 'done'
    if (first) return 'active'
    return 'idle'
  })()

  return (
    <>
      <DemoStep
        detail={detail(
          'signIn',
          session && `Signed in as ${session.user.email ?? session.user.id}.`,
        )}
        label="Sign in with a DPoP key."
        number={1}
        state={session ? 'done' : 'active'}
      >
        {!session && (
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
        detail={detail('first', first && <Call result={first} />)}
        label="Call the API with a DPoP proof."
        number={2}
        state={firstState}
      >
        <DemoButton
          disabled={!session}
          loading={pending === 'first'}
          onClick={() =>
            run('first', async () => {
              // `accounts.session.fetch` signs a new proof for each request, and the instance's
              // `fetch` attaches the headers that it sent to the response.
              const response = await accounts.session.fetch({ url: tokenRoute })
              headers.current = (response as Response & { [sent]?: Headers })[
                sent
              ]
              setRepeated(undefined)
              setFirst(await read(response))
            })
          }
        >
          Call
        </DemoButton>
      </DemoStep>
      <DemoStep
        detail={detail('repeated', repeated && <Call result={repeated} />)}
        label="Send the same DPoP proof again."
        number={3}
        state={repeatedState}
      >
        <DemoButton
          disabled={!first}
          loading={pending === 'repeated'}
          onClick={() =>
            run('repeated', async () => {
              const response = await fetch(
                tokenRoute,
                headers.current ? { headers: headers.current } : {},
              )
              setRepeated(await read(response))
            })
          }
        >
          Send again
        </DemoButton>
      </DemoStep>
    </>
  )
}
