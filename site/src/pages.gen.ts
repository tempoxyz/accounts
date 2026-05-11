// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';


// prettier-ignore
type Page =
| { path: '/'; render: 'static' }
| { path: '/docs/faq'; render: 'static' }
| { path: '/docs'; render: 'static' }
| { path: '/docs/production'; render: 'static' }
| { path: '/docs/wagmi/tempoWallet'; render: 'static' }
| { path: '/docs/wagmi/webAuthn'; render: 'static' }
| { path: '/docs/server/handler.compose'; render: 'static' }
| { path: '/docs/server/handler.feePayer'; render: 'static' }
| { path: '/docs/server/handler.relay'; render: 'static' }
| { path: '/docs/server/handler.webAuthn'; render: 'static' }
| { path: '/docs/server'; render: 'static' }
| { path: '/docs/server/kv'; render: 'static' }
| { path: '/docs/rpc/eth_fillTransaction'; render: 'static' }
| { path: '/docs/rpc/eth_sendTransaction'; render: 'static' }
| { path: '/docs/rpc/eth_sendTransactionSync'; render: 'static' }
| { path: '/docs/rpc/personal_sign'; render: 'static' }
| { path: '/docs/rpc/wallet_authorizeAccessKey'; render: 'static' }
| { path: '/docs/rpc/wallet_connect'; render: 'static' }
| { path: '/docs/rpc/wallet_disconnect'; render: 'static' }
| { path: '/docs/rpc/wallet_getBalances'; render: 'static' }
| { path: '/docs/rpc/wallet_getCallsStatus'; render: 'static' }
| { path: '/docs/rpc/wallet_getCapabilities'; render: 'static' }
| { path: '/docs/rpc/wallet_revokeAccessKey'; render: 'static' }
| { path: '/docs/rpc/wallet_sendCalls'; render: 'static' }
| { path: '/docs/guides/authentication'; render: 'static' }
| { path: '/docs/guides/cli'; render: 'static' }
| { path: '/docs/guides/connect-accounts'; render: 'static' }
| { path: '/docs/guides/fee-sponsorship'; render: 'static' }
| { path: '/docs/guides/machine-payments'; render: 'static' }
| { path: '/docs/guides/payments'; render: 'static' }
| { path: '/docs/guides/react-native'; render: 'static' }
| { path: '/docs/guides/spend-permissions'; render: 'static' }
| { path: '/docs/guides/subscriptions'; render: 'static' }
| { path: '/docs/guides/theming'; render: 'static' }
| { path: '/docs/enterprise/hosted-universal-wallets'; render: 'static' }
| { path: '/docs/enterprise/bring-your-auth/aws-kms'; render: 'static' }
| { path: '/docs/enterprise/bring-your-auth/custom'; render: 'static' }
| { path: '/docs/enterprise/bring-your-auth'; render: 'static' }
| { path: '/docs/enterprise/bring-your-auth/privy'; render: 'static' }
| { path: '/docs/enterprise/bring-your-auth/turnkey'; render: 'static' }
| { path: '/docs/api/adapters'; render: 'static' }
| { path: '/docs/api/dialog.iframe'; render: 'static' }
| { path: '/docs/api/dialog'; render: 'static' }
| { path: '/docs/api/dialog.popup'; render: 'static' }
| { path: '/docs/api/dialogs'; render: 'static' }
| { path: '/docs/api/expiry'; render: 'static' }
| { path: '/docs/api/local'; render: 'static' }
| { path: '/docs/api/provider'; render: 'static' }
| { path: '/docs/api/webAuthn'; render: 'static' }
| { path: '/docs/api/webauthnceremony.from'; render: 'static' }
| { path: '/docs/api/webauthnceremony'; render: 'static' }
| { path: '/docs/api/webauthnceremony.server'; render: 'static' }
| { path: '/docs/adapters/custom'; render: 'static' }
| { path: '/docs/adapters'; render: 'static' }
| { path: '/docs/adapters/tempo-wallet'; render: 'static' }
| { path: '/docs/adapters/webauthn'; render: 'static' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
