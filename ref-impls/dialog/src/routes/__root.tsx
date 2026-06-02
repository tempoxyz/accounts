import { createRootRoute, Outlet } from '@tanstack/react-router'
import { reconnect } from '@wagmi/core'
import { Dialog } from 'accounts/react'

import { EnsureVisibility } from '../components/EnsureVisibility'
import { host, wagmiConfig } from '../lib/config'
import { router } from '../router'

host.onUserRequest(async ({ account, request }) => {
  await reconnect(wagmiConfig as never)

  const existing = router.state.location.search as Record<string, unknown>
  router.navigate({
    to: `/rpc/${request.method}`,
    search: { ...existing, ...request, account } as never,
  })
})

host.ready()

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const ready = Dialog.host.useState(host, (s) => s.ready)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 16,
        background: 'rgba(0, 0, 0, 0.5)',
      }}
      onClick={() => host.rejectAll()}
    >
      {ready && (
        <div
          style={{
            background: 'white',
            color: 'black',
            border: '1px solid #ddd',
            borderRadius: 8,
            width: 360,
            display: 'flex',
            flexDirection: 'column',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <EnsureVisibility>
            <Outlet />
          </EnsureVisibility>
        </div>
      )}
    </div>
  )
}
