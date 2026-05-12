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
        text: 'Accounts SDK',
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
          { text: 'Payments', link: '/docs/guides/payments' },
          { text: 'Spend Permissions', link: '/docs/guides/spend-permissions' },
          { text: 'Subscriptions', link: '/docs/guides/subscriptions' },
          { text: 'Fee Sponsorship', link: '/docs/guides/fee-sponsorship' },
          { text: 'Theming', link: '/docs/guides/theming' },
          { text: 'Machine Payments (MPP)', link: '/docs/guides/machine-payments' },
          { text: 'React Native', link: '/docs/guides/react-native' },
          { text: 'CLI', link: '/docs/guides/cli' },
        ],
      },
      {
        text: 'Adapters',
        items: [
          { text: 'Overview', link: '/docs/adapters' },
          { text: 'Tempo Wallet', link: '/docs/adapters/tempo-wallet' },
          { text: 'WebAuthn', link: '/docs/adapters/webauthn' },
          { text: 'Custom', link: '/docs/adapters/custom' },
        ],
      },
      {
        text: 'Enterprise',
        items: [
          {
            text: 'Bring Your Auth',
            items: [
              { text: 'Overview', link: '/docs/enterprise/bring-your-auth' },
              { text: 'Privy', link: '/docs/enterprise/bring-your-auth/privy' },
              { text: 'AWS KMS', link: '/docs/enterprise/bring-your-auth/aws-kms' },
              { text: 'Turnkey', link: '/docs/enterprise/bring-your-auth/turnkey' },
              { text: 'Custom', link: '/docs/enterprise/bring-your-auth/custom' },
            ],
          },
          { text: 'Hosted Universal Wallets', link: '/docs/enterprise/hosted-universal-wallets' },
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
              { text: 'Rpc 🚧', disabled: true },
              { text: 'Schema 🚧', disabled: true },
              {
                text: 'Storage',
                collapsed: true,
                items: [
                  { text: '.combine 🚧', disabled: true },
                  { text: '.cookie 🚧', disabled: true },
                  { text: '.from 🚧', disabled: true },
                  { text: '.idb 🚧', disabled: true },
                  { text: '.localStorage 🚧', disabled: true },
                  { text: '.memory 🚧', disabled: true },
                ],
              },
              { text: 'TrustedHosts 🚧', disabled: true },
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
          { text: 'CLI 🚧', disabled: true },
          {
            text: 'JSON-RPC',
            collapsed: true,
            items: [
              { text: 'eth_accounts 🚧', disabled: true },
              { text: 'eth_chainId 🚧', disabled: true },
              { text: 'eth_fillTransaction', link: '/docs/rpc/eth_fillTransaction' },
              { text: 'eth_requestAccounts 🚧', disabled: true },
              { text: 'eth_sendTransaction', link: '/docs/rpc/eth_sendTransaction' },
              { text: 'eth_sendTransactionSync', link: '/docs/rpc/eth_sendTransactionSync' },
              { text: 'eth_signTransaction 🚧', disabled: true },
              { text: 'eth_signTypedData_v4 🚧', disabled: true },
              { text: 'personal_sign', link: '/docs/rpc/personal_sign' },
              { text: 'wallet_authorizeAccessKey', link: '/docs/rpc/wallet_authorizeAccessKey' },
              { text: 'wallet_connect', link: '/docs/rpc/wallet_connect' },
              { text: 'wallet_deposit 🚧', disabled: true },
              { text: 'wallet_depositZone 🚧', disabled: true },
              { text: 'wallet_disconnect', link: '/docs/rpc/wallet_disconnect' },
              { text: 'wallet_getBalances', link: '/docs/rpc/wallet_getBalances' },
              { text: 'wallet_getCallsStatus', link: '/docs/rpc/wallet_getCallsStatus' },
              { text: 'wallet_getCapabilities', link: '/docs/rpc/wallet_getCapabilities' },
              { text: 'wallet_revokeAccessKey', link: '/docs/rpc/wallet_revokeAccessKey' },
              { text: 'wallet_send 🚧', disabled: true },
              { text: 'wallet_sendCalls', link: '/docs/rpc/wallet_sendCalls' },
              { text: 'wallet_swap 🚧', disabled: true },
              { text: 'wallet_switchEthereumChain 🚧', disabled: true },
              { text: 'wallet_withdrawZone 🚧', disabled: true },
            ],
          },
          {
            text: 'Remote',
            collapsed: true,
            items: [
              { text: '.create 🚧', disabled: true },
              { text: '.useEnsureVisibility 🚧', disabled: true },
              { text: '.useState 🚧', disabled: true },
              { text: '.useTheme 🚧', disabled: true },
              { text: '.validateSearch 🚧', disabled: true },
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
                  { text: '.auth 🚧', disabled: true },
                  { text: '.codeAuth 🚧', disabled: true },
                  { text: '.compose', link: '/docs/server/handler.compose' },
                  { text: '.exchange 🚧', disabled: true },
                  { text: '.relay', link: '/docs/server/handler.relay' },
                  { text: '.webAuthn', link: '/docs/server/handler.webAuthn' },
                ],
              },
              { text: 'hc 🚧', disabled: true },
              {
                text: 'Kv',
                collapsed: true,
                items: [
                  { text: '.cloudflare 🚧', disabled: true },
                  { text: '.durableObject 🚧', disabled: true },
                  { text: '.from 🚧', disabled: true },
                  { text: '.memory 🚧', disabled: true },
                ],
              },
            ],
          },
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
