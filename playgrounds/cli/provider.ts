import { Provider, Storage } from 'accounts/cli'
import { z } from 'incur'

/** Environment variables supported by the CLI playground. */
export const env = z.object({
  HOST: z.string().optional().describe('Wallet device-auth URL'),
  STORAGE_PATH: z
    .string()
    .default('~/.tempo/wallet/playground.json')
    .describe('Filesystem state path'),
  TESTNET: z.enum(['true', 'false']).default('true').describe('Whether to use the Tempo testnet'),
})

/** Creates a provider from the CLI's parsed environment variables. */
export function create(options: create.Options): create.ReturnType {
  const { STORAGE_PATH, TESTNET, HOST } = options
  return Provider.create({
    ...(HOST ? { host: HOST } : {}),
    storage: Storage.filesystem({
      key: 'tempo-cli-playground',
      path: STORAGE_PATH,
    }),
    testnet: TESTNET !== 'false',
  })
}

export declare namespace create {
  /** Parsed CLI environment variables. */
  export type Options = z.output<typeof env>
  /** Accounts CLI provider. */
  export type ReturnType = Provider.create.ReturnType
}
