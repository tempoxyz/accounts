// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse } from 'waku/router';


// prettier-ignore
type Page =
| { path: '/'; render: 'static' }
| { path: '/accounts/faq'; render: 'static' }
| { path: '/accounts'; render: 'static' }
| { path: '/accounts/production'; render: 'static' }
| { path: '/accounts/wagmi/tempoWallet'; render: 'static' }
| { path: '/accounts/wagmi/webAuthn'; render: 'static' }
| { path: '/accounts/server/handler.compose'; render: 'static' }
| { path: '/accounts/server/handler.feePayer'; render: 'static' }
| { path: '/accounts/server/handler.relay'; render: 'static' }
| { path: '/accounts/server/handler.webAuthn'; render: 'static' }
| { path: '/accounts/server'; render: 'static' }
| { path: '/accounts/server/kv'; render: 'static' }
| { path: '/accounts/rpc/eth_fillTransaction'; render: 'static' }
| { path: '/accounts/rpc/eth_sendTransaction'; render: 'static' }
| { path: '/accounts/rpc/eth_sendTransactionSync'; render: 'static' }
| { path: '/accounts/rpc/personal_sign'; render: 'static' }
| { path: '/accounts/rpc/wallet_authorizeAccessKey'; render: 'static' }
| { path: '/accounts/rpc/wallet_connect'; render: 'static' }
| { path: '/accounts/rpc/wallet_disconnect'; render: 'static' }
| { path: '/accounts/rpc/wallet_getBalances'; render: 'static' }
| { path: '/accounts/rpc/wallet_getCallsStatus'; render: 'static' }
| { path: '/accounts/rpc/wallet_getCapabilities'; render: 'static' }
| { path: '/accounts/rpc/wallet_revokeAccessKey'; render: 'static' }
| { path: '/accounts/rpc/wallet_sendCalls'; render: 'static' }
| { path: '/accounts/guides/create-and-use-accounts'; render: 'static' }
| { path: '/accounts/api/adapters'; render: 'static' }
| { path: '/accounts/api/dialog.iframe'; render: 'static' }
| { path: '/accounts/api/dialog'; render: 'static' }
| { path: '/accounts/api/dialog.popup'; render: 'static' }
| { path: '/accounts/api/dialogs'; render: 'static' }
| { path: '/accounts/api/expiry'; render: 'static' }
| { path: '/accounts/api/local'; render: 'static' }
| { path: '/accounts/api/provider'; render: 'static' }
| { path: '/accounts/api/webAuthn'; render: 'static' }
| { path: '/accounts/api/webauthnceremony.from'; render: 'static' }
| { path: '/accounts/api/webauthnceremony'; render: 'static' }
| { path: '/accounts/api/webauthnceremony.server'; render: 'static' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
  }
}
