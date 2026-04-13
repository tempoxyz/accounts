import { Mnemonic } from 'ox'
import {
  type Chain,
  type Client,
  type ClientConfig,
  createClient,
  defineChain,
  type HttpTransportConfig,
  type Transport,
  type Account as viem_Account,
  http as viem_http,
} from 'viem'
import { type Address, english, generateMnemonic, type JsonRpcAccount } from 'viem/accounts'
import { tempoDevnet, tempoLocalnet, tempoModerato } from 'viem/chains'
import {
  // biome-ignore lint/correctness/noUnusedImports: This is needed to ensure TypeScript can reference viem/tempo types portably
  type z_TokenId as _,
  Account,
} from 'viem/tempo'

export const id =
  (typeof process !== 'undefined' &&
    Number(process.env.VITEST_POOL_ID ?? 1) + Math.floor(Math.random() * 10_000)) ||
  1 + Math.floor(Math.random() * 10_000)

export const nodeEnv = import.meta.env.VITE_NODE_ENV || 'localnet'

export const rpcUrl = (() => {
  const rpcPort = process.env.VITE_RPC_PORT ?? import.meta.env.VITE_RPC_PORT ?? '8545'
  if (nodeEnv === 'testnet') return tempoModerato.rpcUrls.default.http[0]
  if (nodeEnv === 'devnet') return tempoDevnet.rpcUrls.default.http[0]
  return `http://localhost:${rpcPort}/${id}`
})()

const accountsMnemonic = (() => {
  if (nodeEnv === 'localnet') return 'test test test test test test test test test test test junk'
  return generateMnemonic(english)
})()

export const privateKeys = Array.from({ length: 20 }, (_, i) =>
  Mnemonic.toPrivateKey(accountsMnemonic, {
    as: 'Hex',
    path: Mnemonic.path({ account: i }),
  }),
) as unknown as FixedArray<`0x${string}`, 20>

export const accounts = privateKeys.map((privateKey) =>
  Account.fromSecp256k1(privateKey),
) as unknown as FixedArray<Account.RootAccount, 20>

export const webAuthnAccounts = privateKeys.map((privateKey) =>
  Account.fromHeadlessWebAuthn(privateKey, {
    rpId: 'example.com',
    origin: 'https://example.com',
  }),
) as unknown as FixedArray<Account.RootAccount, 20>

export const addresses = {
  alphaUsd: '0x20c0000000000000000000000000000000000001',
} as const

export const chain = (() => {
  if (nodeEnv === 'testnet') return tempoModerato
  return defineChain({
    ...tempoLocalnet,
    rpcUrls: { default: { http: [rpcUrl] } },
  })
})()

export const chainId = (() => {
  if (nodeEnv === 'testnet') return tempoModerato.id
  if (nodeEnv === 'devnet') return tempoDevnet.id
  return tempoLocalnet.id
})()

export const fetchOptions = {
  headers: {
    Authorization: `Basic ${btoa(import.meta.env.VITE_RPC_CREDENTIALS)}`,
  },
} as const

export const http = (url = rpcUrl) =>
  viem_http(url, {
    ...debugOptions({
      rpcUrl: url,
    }),
  })

export function debugOptions({ rpcUrl }: { rpcUrl: string }): HttpTransportConfig | undefined {
  if (import.meta.env.VITE_HTTP_LOG !== 'true') return undefined
  return {
    async onFetchRequest(_, init) {
      console.log(`curl \\
${rpcUrl} \\
-X POST \\
-H "Content-Type: application/json" \\
-d '${JSON.stringify(JSON.parse(init.body as string))}'`)
    },
    async onFetchResponse(response) {
      console.log(`> ${JSON.stringify(await response.clone().json())}`)
    },
  }
}

export declare namespace fundAddress {
  export type Parameters = {
    /** Account to fund. */
    address: Address
  }
}

export function getClient<
  chain extends Chain | undefined = typeof tempoLocalnet,
  accountOrAddress extends viem_Account | Address | undefined = undefined,
>(
  parameters: Partial<
    Pick<ClientConfig<Transport, chain, accountOrAddress>, 'account' | 'chain' | 'transport'>
  > = {},
): Client<
  Transport,
  chain,
  accountOrAddress extends Address ? JsonRpcAccount<accountOrAddress> : accountOrAddress
> {
  return createClient({
    pollingInterval: 100,
    chain,
    transport: http(rpcUrl),
    ...parameters,
  }) as never
}

type FixedArray<
  type,
  count extends number,
  result extends readonly type[] = [],
> = result['length'] extends count ? result : FixedArray<type, count, readonly [...result, type]>
