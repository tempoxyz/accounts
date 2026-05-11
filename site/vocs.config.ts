import { defineConfig, McpSource } from 'vocs/config'

const baseUrl = (() => {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return ''
  if (URL.canParse(process.env.VITE_BASE_URL)) return process.env.VITE_BASE_URL
  if (process.env.VERCEL_ENV === 'production')
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return ''
})()

export default defineConfig({
  baseUrl: baseUrl || undefined,
  cacheDir: '.vocs/cache',
  checkDeadlinks: 'warn',
  description: 'Tempo Accounts SDK documentation',
  editLink: {
    link: 'https://github.com/tempoxyz/accounts/edit/main/site/src/pages/:path',
    text: 'Suggest changes to this page',
  },
  mcp: {
    enabled: true,
    sources: [
      McpSource.github({ repo: 'tempoxyz/accounts' }),
      McpSource.github({ repo: 'tempoxyz/docs' }),
      McpSource.github({ repo: 'wevm/viem' }),
      McpSource.github({ repo: 'wevm/wagmi' }),
      McpSource.github({ repo: 'wevm/ox' }),
    ],
  },
  rootDir: '.',
  sidebar: {
    '/': [
      {
        text: 'Accounts SDK',
        items: [
          { text: 'Getting Started', link: '/accounts' },
          { text: 'Deploying to Production', link: '/accounts/production' },
          { text: 'FAQ', link: '/accounts/faq' },
          {
            text: 'Guides',
            items: [{ text: 'Create & Use Accounts', link: '/accounts/guides/create-and-use-accounts' }],
          },
        ],
      },
      {
        text: 'Core',
        items: [
          { text: 'Provider', link: '/accounts/api/provider' },
          {
            text: 'Adapters',
            items: [
              { text: 'Overview', link: '/accounts/api/adapters' },
              { text: 'dialog / tempoWallet', link: '/accounts/api/dialog' },
              { text: 'webAuthn', link: '/accounts/api/webAuthn' },
              { text: 'local', link: '/accounts/api/local' },
            ],
          },
          {
            text: 'Dialog',
            items: [
              { text: 'Overview', link: '/accounts/api/dialogs' },
              { text: '.iframe', link: '/accounts/api/dialog.iframe' },
              { text: '.popup', link: '/accounts/api/dialog.popup' },
            ],
          },
          { text: 'Expiry', link: '/accounts/api/expiry' },
          {
            text: 'WebAuthnCeremony',
            items: [
              { text: 'Overview', link: '/accounts/api/webauthnceremony' },
              { text: '.from', link: '/accounts/api/webauthnceremony.from' },
              { text: '.server', link: '/accounts/api/webauthnceremony.server' },
            ],
          },
        ],
      },
      {
        text: 'Wagmi',
        items: [
          { text: 'tempoWallet', link: '/accounts/wagmi/tempoWallet' },
          { text: 'webAuthn', link: '/accounts/wagmi/webAuthn' },
        ],
      },
      {
        text: 'Server',
        items: [
          { text: 'Overview', link: '/accounts/server' },
          { text: '.compose', link: '/accounts/server/handler.compose' },
          { text: '.feePayer', link: '/accounts/server/handler.feePayer' },
          { text: '.relay', link: '/accounts/server/handler.relay' },
          { text: '.webAuthn', link: '/accounts/server/handler.webAuthn' },
          { text: 'Kv', link: '/accounts/server/kv' },
        ],
      },
      {
        text: 'JSON-RPC',
        items: [
          { text: 'wallet_connect', link: '/accounts/rpc/wallet_connect' },
          { text: 'wallet_disconnect', link: '/accounts/rpc/wallet_disconnect' },
          { text: 'wallet_authorizeAccessKey', link: '/accounts/rpc/wallet_authorizeAccessKey' },
          { text: 'wallet_revokeAccessKey', link: '/accounts/rpc/wallet_revokeAccessKey' },
          { text: 'wallet_getBalances', link: '/accounts/rpc/wallet_getBalances' },
          { text: 'wallet_getCapabilities', link: '/accounts/rpc/wallet_getCapabilities' },
          { text: 'wallet_getCallsStatus', link: '/accounts/rpc/wallet_getCallsStatus' },
          { text: 'wallet_sendCalls', link: '/accounts/rpc/wallet_sendCalls' },
          { text: 'eth_sendTransaction', link: '/accounts/rpc/eth_sendTransaction' },
          { text: 'eth_sendTransactionSync', link: '/accounts/rpc/eth_sendTransactionSync' },
          { text: 'eth_fillTransaction', link: '/accounts/rpc/eth_fillTransaction' },
          { text: 'personal_sign', link: '/accounts/rpc/personal_sign' },
        ],
      },
    ],
  },
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/tempoxyz/accounts',
    },
  ],
  title: 'Accounts SDK',
  titleTemplate: '%s | Accounts SDK',
  topNav: [
    { text: 'Docs', link: '/accounts' },
    { text: 'Examples', link: 'https://github.com/tempoxyz/accounts/tree/main/examples' },
    { text: 'Tempo', link: 'https://docs.tempo.xyz' },
  ],
  twoslash: {
    throws: false,
    twoslashOptions: {
      compilerOptions: {
        moduleResolution: 100,
      },
    },
  },
})
