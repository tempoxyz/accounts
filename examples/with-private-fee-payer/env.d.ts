interface Env {
  PORT: string
  ALLOWED_FEE_PAYER_TARGETS: string
  FEE_PAYER_PRIVATE_KEY: `0x${string}`
  KV: KVNamespace
}

declare namespace NodeJS {
  interface ProcessEnv extends Env {}
}
