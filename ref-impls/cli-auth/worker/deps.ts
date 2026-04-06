import { CliAuth } from 'accounts/server'
import { createClient, http } from 'viem'
import { tempoModerato } from 'viem/chains'

/** Viem client for Tempo Moderato RPC used by `Handler.codeAuth` and `approve`. */
export const client = createClient({
  chain: tempoModerato,
  transport: http(tempoModerato.rpcUrls.default.http[0]),
})

/** In-memory pending device-code store shared by the worker handler and approve route. */
export const store = CliAuth.Store.memory()
