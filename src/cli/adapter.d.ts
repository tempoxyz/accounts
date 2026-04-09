import * as Adapter from '../core/Adapter.js'
/**
 * Creates a CLI bootstrap adapter backed by the device-code protocol.
 */
export declare function cli(options: cli.Options): Adapter.Adapter
export declare namespace cli {
  type Options = {
    /** Host URL for the device-code flow. API calls are made under the same base path. */
    host: string
    /** Provider display name. @default "Tempo CLI" */
    name?: string | undefined
    /** Path for managed CLI access keys. @default "~/.tempo/wallet/keys.toml" */
    keysPath?: string | undefined
    /** Browser opener override. */
    open?: ((url: string) => Promise<void> | void) | undefined
    /** Poll interval in milliseconds. @default 2000 */
    pollIntervalMs?: number | undefined
    /** Reverse-DNS provider identifier. @default "xyz.tempo.cli" */
    rdns?: string | undefined
    /** Poll timeout in milliseconds. @default 300000 */
    timeoutMs?: number | undefined
  }
}
//# sourceMappingURL=adapter.d.ts.map
