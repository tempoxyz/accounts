'use client'

import * as React from 'react'
import { useEffect, useState } from 'react'
import { Button } from 'regen-ui'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'
import LucideCircleCheck from '~icons/lucide/circle-check'
import LucideCircleX from '~icons/lucide/circle-x'

/**
 * Two-step interactive demo for the Authentication guide.
 *
 * Both steps are always interactive so the user can hit `GET /me` before
 * connecting (to see the `401`) and again after authenticating (to see the
 * `200`). The wallet connection is real (via the site's wagmi config); the
 * `/me` response is computed client-side from the connected address so the
 * demo stays self-contained inside the static docs site.
 */
export function Authenticate() {
  return (
    <div className="flex flex-col gap-3">
      <Step number={1} label="Sign in or create an account" action={<ConnectAction />} />
      <MeStep />
    </div>
  )
}

function ConnectAction() {
  const connection = useConnection()
  const [connector] = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()

  if (connection.status === 'connected')
    return (
      <Button
        variant="secondary"
        loading={disconnect.isPending}
        onClick={() => disconnect.mutate()}
      >
        Sign out
      </Button>
    )

  return (
    <Button
      variant="primary"
      loading={connect.isPending}
      disabled={!connector}
      onClick={() => connector && connect.mutate({ connector })}
    >
      Sign in
    </Button>
  )
}

function MeStep() {
  const { address, chainId } = useConnection()
  const [state, setState] = useState<MeState>({ status: 'idle' })

  async function fetchMe() {
    setState({ status: 'loading' })
    // Simulate the round-trip latency of a real `/me` call so the loading
    // state is visible. The response itself is derived from the connected
    // address — the docs site is static and has no backend of its own.
    await new Promise((r) => setTimeout(r, 250))
    if (!address || !chainId)
      return setState({
        status: 'error',
        statusCode: 401,
        body: { error: 'unauthenticated' },
      })
    setState({
      status: 'success',
      statusCode: 200,
      body: { address, chainId },
    })
  }

  // Re-fetch whenever the connected address changes so the panel mirrors
  // the example's UX: connect → 200 with new address; sign out → 401.
  useEffect(() => {
    if (state.status === 'idle') return
    fetchMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address])

  return (
    <Step
      number={2}
      label="Call an authenticated resource"
      action={
        <Button variant="primary" loading={state.status === 'loading'} onClick={fetchMe}>
          GET /me
        </Button>
      }
    >
      {state.status === 'success' || state.status === 'error' ? (
        <div className="flex flex-col gap-2">
          <StatusBadge ok={state.status === 'success'} statusCode={state.statusCode} />
          <pre className="bg-secondary text-primary px-3 py-2 text-[12px] font-mono overflow-x-auto">
            {JSON.stringify(state.body, null, 2)}
          </pre>
        </div>
      ) : null}
    </Step>
  )
}

function Step(props: {
  number: number
  label: React.ReactNode
  action: React.ReactNode
  children?: React.ReactNode
}) {
  const { number, label, action, children } = props
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex shrink-0 size-7 items-center justify-center border border-primary text-secondary text-[13px]">
          {number}
        </div>
        <div className="flex-1 text-primary text-[14px]">{label}</div>
        {action}
      </div>
      {children ? (
        <div className="ml-11 border-l border-primary pl-4 text-primary text-[14px]">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function StatusBadge(props: { ok: boolean; statusCode: number }) {
  const { ok, statusCode } = props
  const Icon = ok ? LucideCircleCheck : LucideCircleX
  return (
    <span
      className={`inline-flex items-center gap-1 text-[12px] font-mono font-medium ${
        ok ? 'text-success' : 'text-destructive'
      }`}
    >
      <Icon aria-hidden className="size-3.5" />
      {statusCode}
    </span>
  )
}

type MeState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; statusCode: 200; body: { address: string; chainId: number } }
  | { status: 'error'; statusCode: number; body: { error: string } }
