'use client'

import { useEffect } from 'react'
import { Button } from 'regen-ui'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'

import * as Steps from './Steps.js'

/**
 * Action button for the "Create an account" step. Renders "Sign in" when
 * disconnected, "Disconnect" when connected. Advances the surrounding
 * {@link Steps.Provider} to the next step on successful connect via the
 * Wagmi mutation's `onSuccess` callback (so reset can return here without
 * being immediately re-advanced by a stale connection state).
 *
 * Pass `standalone` when rendering outside of a `<Steps.Step>` to keep the
 * button always-active (no step coordination).
 */
export function ConnectAccount(props: ConnectAccount.Props = {}) {
  const { standalone = false } = props
  const steps = Steps.use()
  const connection = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]
  const connect = useConnect()
  const disconnect = useDisconnect()

  const connected = connection.status === 'connected'
  const active = standalone || steps.active

  // Auto-advance whenever this step is active and the wallet is connected.
  // Covers both fresh connections (clicking "Sign in") and cached
  // connections on page load. Safe against reset because `Demo.Reset`
  // awaits `disconnectAsync()` before navigating back to step 1.
  useEffect(() => {
    if (standalone) return
    if (steps.active && connected) steps.set('next')
  }, [standalone, steps.active, connected, steps.set])

  if (connected)
    return (
      <Button
        variant="secondary"
        loading={disconnect.isPending}
        onClick={() => disconnect.mutate()}
      >
        Disconnect
      </Button>
    )

  return (
    <Button
      variant={active ? 'primary' : 'secondary'}
      disabled={!active || !connector}
      loading={connect.isPending}
      onClick={() => connector && connect.mutate({ connector })}
    >
      Sign in
    </Button>
  )
}

export namespace ConnectAccount {
  export type Props = {
    /**
     * Render without coordinating with the surrounding {@link Steps.Provider}.
     * The button stays primary/enabled regardless of the current step, and
     * connecting does not advance the step.
     */
    standalone?: boolean | undefined
  }
}
