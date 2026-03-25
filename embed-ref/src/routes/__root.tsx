import { createRootRoute, Outlet } from '@tanstack/react-router'
import { reconnect } from '@wagmi/core'
import { Remote } from 'tempodk'

import { remote, wagmiConfig } from '../lib/config'
import { router } from '../router'

remote.onUserRequest(async ({ account, request }) => {
  if (!request) return

  await reconnect(wagmiConfig as never)

  const existing = router.state.location.search as Record<string, unknown>
  router.navigate({
    to: `/rpc/${request.method}`,
    search: { ...existing, ...request, account } as never,
  })
})

remote.ready()

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  const ready = Remote.useState(remote, (s) => s.ready)

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
      onClick={() => remote.rejectAll()}
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
          <Outlet />
        </div>
      )}
    </div>
  )
}
