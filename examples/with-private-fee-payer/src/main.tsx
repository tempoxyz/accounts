import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'

import App from './App.tsx'
import { config } from './config.ts'

const queryClient = new QueryClient()

const rootElement = document.querySelector('div#root')
if (!rootElement) throw new Error('Root element not found')

createRoot(rootElement).render(
  <React.StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </WagmiProvider>
  </React.StrictMode>,
)
