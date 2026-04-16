import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { hashKey, QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { RouterProvider } from '@tanstack/react-router'
import { Json } from 'ox'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'

import { wagmiConfig } from './lib/config.js'
import { router } from './router.js'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      gcTime: 1000 * 60 * 60 * 24,
      queryKeyHashFn: (key) => hashKey(JSON.parse(Json.stringify(key))),
    },
  },
})

const persister = createSyncStoragePersister({
  storage: globalThis.localStorage,
  serialize: (data) => Json.stringify(data),
  deserialize: (data) => JSON.parse(data),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <PersistQueryClientProvider client={queryClient} persistOptions={{ persister }}>
        <RouterProvider router={router} />
      </PersistQueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
