import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, HeadContent, Outlet, Scripts, useSearch } from '@tanstack/react-router'
import { reconnect } from '@wagmi/core'
import type { ReactNode } from 'react'
import { WagmiProvider } from 'wagmi'

import '../styles/index.css'
import { remote, wagmiConfig } from '../lib/config'
import { store, useStore } from '../lib/store.js'
import { router } from '../router'

const queryClient = new QueryClient()

remote.onDialogRequest(async ({ account, origin, request }) => {
  if (!request) return

  store.setState({ origin, ready: true })

  await reconnect(wagmiConfig)

  const existing = router.state.location.search as Record<string, unknown>
  router.navigate({
    to: `/rpc/${request.method}`,
    search: { ...existing, ...request, account } as never,
  })
})

remote.ready()

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Tempo Auth' },
    ],
    links: [
      { rel: 'icon', href: '/favicon-light.svg', media: '(prefers-color-scheme: light)' },
      { rel: 'icon', href: '/favicon-dark.svg', media: '(prefers-color-scheme: dark)' },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    icon: (search.icon as string) ?? undefined,
    iconDark: (search.iconDark as string) ?? undefined,
    mode: (search.mode as 'iframe' | 'popup') ?? undefined,
  }),
  component: RootComponent,
})

function RootComponent() {
  const ready = useStore((s) => s.ready)

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RootDocument>
          <Container>
            {ready && (
              <Dialog>
                <Outlet />
              </Dialog>
            )}
          </Container>
        </RootDocument>
      </QueryClientProvider>
    </WagmiProvider>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function Container({ children }: Readonly<{ children: ReactNode }>) {
  const { mode } = useSearch({ from: '__root__' })

  if (mode === 'iframe')
    return (
      <div
        className="animate-fade-in flex items-end sm:items-start sm:justify-center h-full sm:p-4 bg-overlay"
        onClick={() => remote.rejectAll()}
      >
        {children}
      </div>
    )

  return <>{children}</>
}

function Dialog({ children }: Readonly<{ children: ReactNode }>) {
  const { icon, iconDark, mode } = useSearch({ from: '__root__' })
  const origin = useStore((s) => s.origin)

  if (!mode) return children

  const host = origin ? new URL(origin).host : undefined

  return (
    <div
      data-iframe={mode === 'iframe' ? '' : undefined}
      className="animate-fade-in data-iframe:max-sm:animate-slide-up bg-primary dark:bg-secondary flex flex-col w-[360px] data-iframe:border data-iframe:border-default data-iframe:max-sm:w-full!"
      onClick={mode === 'iframe' ? (e) => e.stopPropagation() : undefined}
    >
      {/* Titlebar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-default">
        <span className="flex items-center gap-3 text-12 leading-17 text-secondary">
          {icon && (
            <>
              <img
                src={icon}
                alt=""
                className="size-[20px] -m-1 rounded-sm dark:hidden"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
              <img
                src={iconDark ?? icon}
                alt=""
                className="size-[20px] -m-1 rounded-sm hidden dark:block"
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </>
          )}
          {host}
        </span>
        <button
          className="text-tertiary hover:text-primary text-12"
          onClick={() => remote.rejectAll()}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  )
}
