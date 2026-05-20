declare namespace Cloudflare {
  interface Env {
    ACCOUNT_PRIVATE_KEY: `0x${string}`
    MPP_REALM: string
    MPP_SECRET_KEY: string
  }
}

declare namespace NodeJS {
  interface ProcessEnv {
    ACCOUNT_PRIVATE_KEY: `0x${string}`
  }
}
