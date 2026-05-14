import { PrivyProvider } from '@privy-io/react-auth'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './index.css'
import { PrivyReactBridge } from './privyReactBridge.js'

const privyAppId = import.meta.env.VITE_PRIVY_APP_ID

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {privyAppId ? (
      <PrivyProvider
        appId={privyAppId}
        clientId={import.meta.env.VITE_PRIVY_CLIENT_ID}
        config={{
          embeddedWallets: {
            ethereum: { createOnLogin: 'users-without-wallets' },
          },
        }}
      >
        <PrivyReactBridge />
        <App />
      </PrivyProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
)
