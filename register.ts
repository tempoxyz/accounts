import type { Capabilities } from 'viem/tempo'

declare module 'viem' {
  interface Register {
    CapabilitiesSchema: Capabilities.Schema
  }
}
