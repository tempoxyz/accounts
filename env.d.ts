interface ImportMetaEnv {
  readonly VITE_RPC_PORT: string
  readonly VITE_NODE_LOG: 'trace' | 'debug' | 'info' | 'warn' | 'error' | boolean | undefined
  readonly VITE_HTTP_LOG: 'true' | 'false'
  readonly VITE_NODE_ENV: 'localnet' | 'testnet' | 'devnet'
  readonly VITE_NODE_TAG: string
  readonly VITE_RPC_CREDENTIALS: string
  readonly VITE_BITGO_ACCESS_TOKEN: string
  readonly VITE_BITGO_WALLET_ID: string
  readonly VITE_BITGO_WALLET_PASSPHRASE: string
  readonly VITE_BITGO_COIN: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
