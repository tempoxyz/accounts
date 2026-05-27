import { type Config, defineConfig, McpSource } from 'vocs/config'

const baseUrl = (() => {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== 'production') return ''
  if (process.env.VITE_BASE_URL && URL.canParse(process.env.VITE_BASE_URL))
    return process.env.VITE_BASE_URL
  if (process.env.VERCEL_ENV === 'production')
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  return ''
})()

const config: Config = defineConfig({
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
        text: 'Tempo Accounts SDK',
        items: [
          { text: 'Getting Started', link: '/docs' },
          { text: 'Deploying to Production', link: '/docs/production' },
          { text: 'FAQ', link: '/docs/faq' },
          { text: 'GitHub', link: 'https://github.com/tempoxyz/accounts' },
        ],
      },
      {
        text: 'Guides',
        items: [
          { text: 'Connect Accounts', link: '/docs/guides/connect-accounts' },
          { text: 'Authentication', link: '/docs/guides/authentication' },
          { text: 'Transfers', link: '/docs/guides/transfers' },
          { text: 'Spend Permissions', link: '/docs/guides/spend-permissions' },
          { text: 'Subscriptions', link: '/docs/guides/subscriptions' },
          { text: 'Fee Sponsorship', link: '/docs/guides/fee-sponsorship' },
          { text: 'Deposits', link: '/docs/guides/deposits' },
          { text: 'Swaps', link: '/docs/guides/swaps' },
          { text: 'Theming', link: '/docs/guides/theming' },
          { text: 'CLI', link: '/docs/guides/cli' },
        ],
      },
      {
        text: 'Adapters',
        items: [
          { text: 'Overview', link: '/docs/adapters' },
          { text: 'Tempo Wallet', link: '/docs/adapters/tempo-wallet' },
          { text: 'WebAuthn (Passkeys)', link: '/docs/adapters/webauthn' },
          { text: 'Turnkey', link: '/docs/adapters/turnkey' },
          { text: 'Privy', link: '/docs/adapters/privy' },
          { text: 'Private Key', link: '/docs/adapters/private-key' },
          { text: 'Custom', link: '/docs/adapters/custom' },
        ],
      },
      {
        text: 'Reference',
        items: [
          {
            text: 'Adapters',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/docs/api/adapters' },
              { text: 'dialog', link: '/docs/api/dialog' },
              { text: 'local', link: '/docs/api/local' },
              { text: 'privy', link: '/docs/api/privy' },
              { text: 'secp256k1', link: '/docs/api/secp256k1' },
              { text: 'turnkey', link: '/docs/api/turnkey' },
              { text: 'webAuthn', link: '/docs/api/webAuthn' },
            ],
          },
          {
            text: 'Core',
            collapsed: true,
            items: [
              {
                text: 'Dialog',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/docs/api/dialogs' },
                  { text: '.iframe', link: '/docs/api/dialog.iframe' },
                  { text: '.popup', link: '/docs/api/dialog.popup' },
                ],
              },
              { text: 'Expiry', link: '/docs/api/expiry' },
              { text: 'Provider', link: '/docs/api/provider' },
              { text: 'Rpc', link: '/docs/api/rpc' },
              { text: 'Schema', link: '/docs/api/schema' },
              {
                text: 'Storage',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/docs/api/storage' },
                  { text: '.combine', link: '/docs/api/storage.combine' },
                  { text: '.cookie', link: '/docs/api/storage.cookie' },
                  { text: '.from', link: '/docs/api/storage.from' },
                  { text: '.idb', link: '/docs/api/storage.idb' },
                  { text: '.localStorage', link: '/docs/api/storage.localStorage' },
                  { text: '.memory', link: '/docs/api/storage.memory' },
                ],
              },
              { text: 'TrustedHosts', link: '/docs/api/trustedHosts' },
              {
                text: 'WebAuthnCeremony',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/docs/api/webauthnceremony' },
                  { text: '.from', link: '/docs/api/webauthnceremony.from' },
                  { text: '.server', link: '/docs/api/webauthnceremony.server' },
                ],
              },
            ],
          },
          {
            text: 'CLI',
            collapsed: true,
            items: [{ text: 'Provider', link: '/docs/cli/provider' }],
          },
          {
            text: 'JSON-RPC',
            collapsed: true,
            items: [
              { text: 'eth_accounts', link: '/docs/rpc/eth_accounts' },
              { text: 'eth_chainId', link: '/docs/rpc/eth_chainId' },
              { text: 'eth_fillTransaction', link: '/docs/rpc/eth_fillTransaction' },
              { text: 'eth_requestAccounts', link: '/docs/rpc/eth_requestAccounts' },
              { text: 'eth_sendTransaction', link: '/docs/rpc/eth_sendTransaction' },
              { text: 'eth_sendTransactionSync', link: '/docs/rpc/eth_sendTransactionSync' },
              { text: 'eth_signTransaction', link: '/docs/rpc/eth_signTransaction' },
              { text: 'eth_signTypedData_v4', link: '/docs/rpc/eth_signTypedData_v4' },
              { text: 'personal_sign', link: '/docs/rpc/personal_sign' },
              { text: 'wallet_authorizeAccessKey', link: '/docs/rpc/wallet_authorizeAccessKey' },
              { text: 'wallet_connect', link: '/docs/rpc/wallet_connect' },
              { text: 'wallet_deposit', link: '/docs/rpc/wallet_deposit' },
              { text: 'wallet_depositZone', link: '/docs/rpc/wallet_depositZone' },
              { text: 'wallet_disconnect', link: '/docs/rpc/wallet_disconnect' },
              { text: 'wallet_getBalances', link: '/docs/rpc/wallet_getBalances' },
              { text: 'wallet_getCallsStatus', link: '/docs/rpc/wallet_getCallsStatus' },
              { text: 'wallet_getCapabilities', link: '/docs/rpc/wallet_getCapabilities' },
              { text: 'wallet_revokeAccessKey', link: '/docs/rpc/wallet_revokeAccessKey' },
              { text: 'wallet_send', link: '/docs/rpc/wallet_send' },
              { text: 'wallet_sendCalls', link: '/docs/rpc/wallet_sendCalls' },
              { text: 'wallet_swap', link: '/docs/rpc/wallet_swap' },
              { text: 'wallet_switchEthereumChain', link: '/docs/rpc/wallet_switchEthereumChain' },
              { text: 'wallet_withdrawZone', link: '/docs/rpc/wallet_withdrawZone' },
            ],
          },
          {
            text: 'Remote',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/docs/api/remote' },
              { text: '.create', link: '/docs/api/remote.create' },
              { text: '.useEnsureVisibility', link: '/docs/api/remote.useEnsureVisibility' },
              { text: '.useState', link: '/docs/api/remote.useState' },
              { text: '.useTheme', link: '/docs/api/remote.useTheme' },
              { text: '.validateSearch', link: '/docs/api/remote.validateSearch' },
            ],
          },
          {
            text: 'Server',
            collapsed: true,
            items: [
              { text: 'Overview', link: '/docs/server' },
              {
                text: 'Handlers',
                collapsed: true,
                items: [
                  { text: '.auth', link: '/docs/server/handler.auth' },
                  { text: '.codeAuth', link: '/docs/server/handler.codeAuth' },
                  { text: '.compose', link: '/docs/server/handler.compose' },
                  { text: '.exchange', link: '/docs/server/handler.exchange' },
                  { text: '.relay', link: '/docs/server/handler.relay' },
                  { text: '.webAuthn', link: '/docs/server/handler.webAuthn' },
                ],
              },
              { text: 'hc', link: '/docs/server/hc' },
              {
                text: 'Kv',
                collapsed: true,
                items: [
                  { text: 'Overview', link: '/docs/server/kv' },
                  { text: '.cloudflare', link: '/docs/server/kv.cloudflare' },
                  { text: '.durableObject', link: '/docs/server/kv.durableObject' },
                  { text: '.from', link: '/docs/server/kv.from' },
                  { text: '.memory', link: '/docs/server/kv.memory' },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  iconUrl: { light: '/tempo-light.svg', dark: '/tempo-dark.svg' },
  logoUrl: { light: '/lockup-light.svg', dark: '/lockup-dark.svg' },
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/tempoxyz/accounts',
    },
  ],
  title: 'Tempo Accounts SDK',
  titleTemplate: '%s | Tempo Accounts SDK',
  topNav: [
    { text: 'Docs', link: '/docs' },
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

export default config
