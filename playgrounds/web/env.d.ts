declare namespace NodeJS {
  interface ProcessEnv {
    ORIGIN: string
    RP_ID: string
    MPP_SECRET_KEY: string
    PRIVATE_KEY: `0x${string}`
  }
}
