declare namespace Cloudflare {
  interface Env {
    ALLOWED_FEE_PAYER_TARGETS: string | undefined
    FEE_PAYER_PRIVATE_KEY: `0x${string}`
    KV: KVNamespace
  }
}
