'use client'

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
      onClick={() =>
        connector &&
        connect.mutate(
          { connector },
          {
            onSuccess: () => steps.set('next'),
          },
        )
      }
    >
      Sign in
    </Button>
  )
}
