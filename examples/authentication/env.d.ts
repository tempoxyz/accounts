/// <reference types="vite-plugin-cloudflare-tunnel/virtual" />

declare namespace Cloudflare {
  interface Env {
    ORIGIN: string
  }
}
