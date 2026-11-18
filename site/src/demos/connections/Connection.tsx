/**
 * The app of the demos of "Connections": its instance, its requests to the API of the site, and the
 * steps that the demos share. The API is `src/server/Connections.ts`, a registered resource.
 * @module
 */
'use client'

import { Accounts, Store } from 'accounts'
import { react } from 'accounts/react'
import { type ReactNode, useEffect, useState } from 'react'
import { tempoModerato } from 'viem/chains'
import { DemoButton, DemoStep } from '../../components/Demo.tsx'

/**
 * Thrown by a request that the API refuses, such as a payment of a connection that the user never
 * approved.
 */
export class RefusedError extends Error {
  override readonly name = 'Connection.RefusedError'
  /** Reason of the refusal, such as `unknown_allowance`. */
  readonly reason: string
  /** Status of the API's response. */
  readonly status: number

  constructor(options: RefusedError.Options) {
    super(options.message)
    this.reason = options.reason
    this.status = options.status
  }
}

export declare namespace RefusedError {
  /** Options of the error. */
  type Options = {
    /** What the API refused, and how to continue. */
    message: string
    /** Reason of the refusal, such as `unknown_allowance`. */
    reason: string
    /** Status of the API's response. */
    status: number
  }
}

/** A request that Tempo ID sent to the API's access key endpoint. */
export type AccessKeyRequest = {
  /** Address of the access key that the endpoint returned. */
  accessKey: `0x${string}`
  /** When the endpoint answered, in milliseconds. */
  at: number
  /** Client ID of the app whose connection the user approved. */
  clientId: string
}

/** A payment that the API sent for the user. */
export type Payment = {
  /** Address of the API's access key, which signed the payment. */
  accessKey: `0x${string}`
  /** Address of the user's Tempo Account, which paid. */
  account: `0x${string}`
  /** Hash of the payment's transaction. */
  transactionHash: `0x${string}`
}

/** Whether the deployment holds the registration of the API, and the API's resource. */
export type Resource =
  | { identifier: string; type: 'registered' }
  | { type: 'pending' }
  | { type: 'unregistered' }

/**
 * The instance of the demos, on Tempo testnet. The page's origin is its client ID. The app requests
 * no access key, since the API holds the access key of the connection.
 *
 * The session's tokens are for the API alone. The demos of other pages share this origin, so the
 * session stays in memory, where none of them restores it.
 */
export const accounts = Accounts.create({
  chain: 'testnet',
  plugins: [react()],
  store: Store.memory(),
})

/** Path of the API's routes. */
const path = '/api/connections'

/** URL of the block explorer of Tempo testnet. */
const explorer = tempoModerato.blockExplorers.default.url

/**
 * Sends a request to the route `route` of the API with the session's access token, and returns the
 * JSON body of the response.
 * @throws {RefusedError} For a response with an error status.
 */
async function request<body>(route: string, method: 'GET' | 'POST') {
  const response = await accounts.session.fetch({
    init: { method },
    url: new URL(path + route, window.location.origin),
  })
  if (response.ok) return (await response.json()) as body

  // A response that is not JSON, such as a gateway's, holds no reason.
  const refusal = (await response.json().catch(() => ({}))) as {
    error?: string
    error_description?: string
  }
  throw new RefusedError({
    message:
      refusal.error_description ?? `The API responded with ${response.status}.`,
    reason: refusal.error ?? 'server_error',
    status: response.status,
  })
}

/** Returns each access key request of the session's connection, newest first. */
export async function accessKeyRequests() {
  const body = await request<{ requests: readonly AccessKeyRequest[] }>(
    '/access-key-requests',
    'GET',
  )
  return body.requests.toSorted((a, b) => b.at - a.at)
}

/**
 * Asks the API to pay 1 OUSD for the session's user.
 * @throws {RefusedError} When the API holds no access key for the connection, and Tempo ID refuses
 *   a new one.
 */
export function pay() {
  return request<Payment>('/pay', 'POST')
}

/** Asks the API to revoke each access key of the session's connection. */
export function revoke() {
  return request<{ transactionHashes: readonly `0x${string}`[] }>(
    '/revoke',
    'POST',
  )
}

/** Returns `address` with its middle left out, such as `0x1234…cdef`. */
export function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Reads the API's resource once, from `GET /api/connections/resource`. */
export function useResource(): Resource {
  const [resource, setResource] = useState<Resource>({ type: 'pending' })

  useEffect(() => {
    let current = true
    const load = async (): Promise<Resource> => {
      const response = await fetch(`${path}/resource`)
      if (!response.ok) return { type: 'unregistered' }
      const body = (await response.json()) as { resource: string }
      return { identifier: body.resource, type: 'registered' }
    }
    // A failed request shows the same notice as a deployment without the registration.
    void load()
      .catch((): Resource => ({ type: 'unregistered' }))
      .then((value) => {
        if (current) setResource(value)
      })
    return () => {
      current = false
    }
  }, [])

  return resource
}

/**
 * Runs the actions of a demo one at a time, and returns the one that runs, and the failure of the
 * last one.
 */
export function useRun<action extends string>(): useRun.ReturnType<action> {
  const [status, setStatus] = useState<useRun.Status<action>>({ type: 'idle' })

  return {
    failure: (action) =>
      status.type === 'failed' && status.action === action ? (
        <span role="alert">{status.message}</span>
      ) : undefined,
    pending: status.type === 'pending' ? status.action : undefined,
    run(action, fn) {
      setStatus({ action, type: 'pending' })
      // The failure handler settles each rejection.
      void fn().then(
        () => setStatus({ type: 'idle' }),
        (error: Error) =>
          setStatus({ action, message: error.message, type: 'failed' }),
      )
    },
  }
}

export declare namespace useRun {
  /** The action that runs, or how the last one failed. */
  type Status<action extends string> =
    | { action: action; message: string; type: 'failed' }
    | { action: action; type: 'pending' }
    | { type: 'idle' }

  type ReturnType<action extends string> = {
    /** Returns the failure of `action` to show, if the last action was `action` and failed. */
    failure: (action: action) => ReactNode
    /** The action that runs. */
    pending: action | undefined
    /** Runs `fn` as `action`. `fn` keeps its own result. */
    run: (action: action, fn: () => Promise<void>) => void
  }
}

/** Links the receipt of the transaction `hash` on the block explorer. */
export function Receipt(props: Receipt.Props) {
  const { hash } = props

  return (
    <a href={`${explorer}/tx/${hash}`} rel="noreferrer" target="_blank">
      See the receipt
    </a>
  )
}

export declare namespace Receipt {
  /** Properties for the Receipt component. */
  type Props = {
    /** Hash of the transaction. */
    hash: string
  }
}

/**
 * Shows the step that signs the user in for the API. Tempo ID's page shows what the API may do, and
 * the user approves the connection there.
 */
export function SignIn(props: SignIn.Props) {
  const { failure, loading, onSignIn } = props
  const { session } = accounts.useSession()

  return (
    <DemoStep
      detail={
        session
          ? `Signed in as ${session.user.email}. The app holds no access key.`
          : failure
      }
      label="Sign in, and approve what the API may do."
      number={1}
      state={session ? 'done' : 'active'}
    >
      {!session && (
        <DemoButton loading={loading} onClick={onSignIn}>
          Sign in
        </DemoButton>
      )}
    </DemoStep>
  )
}

export declare namespace SignIn {
  /** Properties for the SignIn component. */
  type Props = {
    /** Failure of the last sign-in. */
    failure?: ReactNode | undefined
    /** Whether a sign-in runs. */
    loading: boolean
    /** Starts the sign-in, within the click. */
    onSignIn: () => void
  }
}

/**
 * Signs the user in with tokens for the API `resource`. Tempo ID approves a connection only on its
 * own page, so the sign-in runs in a popup window.
 */
export async function signIn(resource: string) {
  await accounts.dialog.signIn({ mode: 'popup', resource })
}

/** Shows that the deployment holds no registration of the API, so the demo cannot run. */
export function Unregistered() {
  return (
    <span data-demo-step-detail="">
      This deployment holds no registration of the API with Tempo ID, so the
      demo does not run here.
    </span>
  )
}
