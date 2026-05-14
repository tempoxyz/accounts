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
 */
export function ConnectAccount() {
  const steps = Steps.use()
  const connection = useConnection()
  const connectors = useConnectors()
  const connector = connectors[0]
  const connect = useConnect()
  const disconnect = useDisconnect()

  const connected = connection.status === 'connected'

  // Auto-advance whenever this step is active and the wallet is connected.
  // Covers both fresh connections (clicking "Sign in") and cached
  // connections on page load. Safe against reset because `Demo.Reset`
  // awaits `disconnectAsync()` before navigating back to step 1.
  useEffect(() => {
    if (steps.active && connected) steps.set('next')
  }, [steps.active, connected, steps.set])

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
      variant={steps.active ? 'primary' : 'secondary'}
      disabled={!steps.active || !connector}
      loading={connect.isPending}
      onClick={() => connector && connect.mutate({ connector })}
    >
      Sign in
    </Button>
  )
}
