import { TurnkeyProvider } from '@turnkey/react-wallet-kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@turnkey/react-wallet-kit/styles.css'
import { App } from './App.js'
import './index.css'

const turnkeyConfig = {
  organizationId: import.meta.env.VITE_TURNKEY_ORGANIZATION_ID,
  authProxyConfigId: import.meta.env.VITE_TURNKEY_AUTH_PROXY_CONFIG_ID,
  autoRefreshManagedState: false,
  auth: {
    methods: {
      emailOtpAuthEnabled: true,
      passkeyAuthEnabled: true,
    },
  },
  ui: {
    supressMissingStylesError: true,
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TurnkeyProvider config={turnkeyConfig}>
      <App />
    </TurnkeyProvider>
  </StrictMode>,
)
