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
            text: 'Core',
            items: [
              { text: 'Provider', link: '/docs/api/provider' },
              {
                text: 'Adapters',
                items: [
                  { text: 'Overview', link: '/docs/api/adapters' },
                  { text: 'dialog / tempoWallet', link: '/docs/api/dialog' },
                  { text: 'webAuthn', link: '/docs/api/webAuthn' },
                  { text: 'local', link: '/docs/api/local' },
                ],
              },
              {
                text: 'Dialog',
                items: [
                  { text: 'Overview', link: '/docs/api/dialogs' },
                  { text: '.iframe', link: '/docs/api/dialog.iframe' },
                  { text: '.popup', link: '/docs/api/dialog.popup' },
                ],
              },
              { text: 'Expiry', link: '/docs/api/expiry' },
              {
                text: 'WebAuthnCeremony',
                items: [
                  { text: 'Overview', link: '/docs/api/webauthnceremony' },
                  { text: '.from', link: '/docs/api/webauthnceremony.from' },
                  { text: '.server', link: '/docs/api/webauthnceremony.server' },
                ],
              },
            ],
          },
          {
            text: 'Wagmi',
            items: [
              { text: 'tempoWallet', link: '/docs/wagmi/tempoWallet' },
              { text: 'webAuthn', link: '/docs/wagmi/webAuthn' },
            ],
          },
          {
            text: 'Server',
            items: [
              { text: 'Overview', link: '/docs/server' },
              { text: '.compose', link: '/docs/server/handler.compose' },
              { text: '.feePayer', link: '/docs/server/handler.feePayer' },
              { text: '.relay', link: '/docs/server/handler.relay' },
              { text: '.webAuthn', link: '/docs/server/handler.webAuthn' },
              { text: 'Kv', link: '/docs/server/kv' },
            ],
          },
          {
            text: 'JSON-RPC',
            items: [
              { text: 'wallet_connect', link: '/docs/rpc/wallet_connect' },
              { text: 'wallet_disconnect', link: '/docs/rpc/wallet_disconnect' },
              { text: 'wallet_authorizeAccessKey', link: '/docs/rpc/wallet_authorizeAccessKey' },
              { text: 'wallet_revokeAccessKey', link: '/docs/rpc/wallet_revokeAccessKey' },
              { text: 'wallet_getBalances', link: '/docs/rpc/wallet_getBalances' },
              { text: 'wallet_getCapabilities', link: '/docs/rpc/wallet_getCapabilities' },
              { text: 'wallet_getCallsStatus', link: '/docs/rpc/wallet_getCallsStatus' },
              { text: 'wallet_sendCalls', link: '/docs/rpc/wallet_sendCalls' },
              { text: 'eth_sendTransaction', link: '/docs/rpc/eth_sendTransaction' },
              { text: 'eth_sendTransactionSync', link: '/docs/rpc/eth_sendTransactionSync' },
              { text: 'eth_fillTransaction', link: '/docs/rpc/eth_fillTransaction' },
              { text: 'personal_sign', link: '/docs/rpc/personal_sign' },
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
