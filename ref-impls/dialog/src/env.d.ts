interface ImportMetaEnv {
  readonly VITE_RPC_URL: string | undefined
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
