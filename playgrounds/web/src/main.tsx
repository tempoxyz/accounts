import { PrivyProvider } from '@privy-io/react-auth'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import './index.css'
import { PrivyReactBridge } from './PrivyReactBridge.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

function Root() {
  const app_id = import.meta.env.VITE_PRIVY_APP_ID
  if (!app_id) return <App />

  return (
    <PrivyProvider
      appId={app_id}
      config={{
        embeddedWallets: {
          ethereum: { createOnLogin: 'users-without-wallets' },
        },
      }}
      {...(import.meta.env.VITE_PRIVY_CLIENT_ID
        ? { clientId: import.meta.env.VITE_PRIVY_CLIENT_ID }
        : {})}
    >
      <PrivyReactBridge />
      <App />
    </PrivyProvider>
  )
}
