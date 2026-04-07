/// <reference types="vite-plugin-cloudflare-tunnel/virtual" />

declare namespace Cloudflare {
  interface Env {
    FEE_PAYER_PRIVATE_KEY: `0x${string}`
  }
}
