import { Rpc } from 'accounts'
import { Cli, z } from 'incur'
import { Address, Hex } from 'ox'

import * as Provider from './provider.js'

const cli = Cli.create('accounts', {
  description: 'Accounts CLI playground',
  env: Provider.env,
  vars: z.object({
    provider: z.custom<Provider.create.ReturnType>().optional(),
  }),
})
  .use(async (c, next) => {
    c.set('provider', Provider.create(c.env))
    await next()
  })
  .command('wallet_connect', {
    description: 'Connect in the browser and request optional capabilities',
    options: z.object({
      auth: json(Rpc.wallet_connect.auth).describe('auth capability as a JSON string or object'),
      authorizeAccessKey: json(Rpc.wallet_connect.authorizeAccessKey).describe(
        'authorizeAccessKey capability as a JSON object',
      ),
      identity: json(Rpc.wallet_connect.identity).describe('identity capability as a JSON object'),
      method: z.enum(['login', 'register']).optional().describe('Authentication method'),
      personalSign: json(Rpc.wallet_connect.personalSign).describe(
        'personalSign capability as a JSON object',
      ),
      showDeposit: json(Rpc.wallet_connect.showDeposit).describe(
        'showDeposit capability as a JSON boolean or object',
      ),
    }),
    async run(c) {
      const provider = c.var.provider!
      if (c.options.auth !== undefined && c.options.personalSign !== undefined)
        throw new Error('Use either --auth or --personal-sign, not both.')

      const capabilities = z.encode(Rpc.wallet_connect.capabilities.request, {
        ...(c.options.auth !== undefined ? { auth: c.options.auth } : {}),
        ...(c.options.authorizeAccessKey !== undefined
          ? { authorizeAccessKey: c.options.authorizeAccessKey }
          : {}),
        ...(c.options.identity !== undefined ? { identity: c.options.identity } : {}),
        ...(c.options.personalSign !== undefined ? { personalSign: c.options.personalSign } : {}),
        ...(c.options.showDeposit !== undefined ? { showDeposit: c.options.showDeposit } : {}),
        ...(c.options.method === 'register'
          ? { method: 'register' as const }
          : c.options.method === 'login'
            ? { method: 'login' as const }
            : {}),
      })

      return await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities }],
      })
    },
  })
  .command('eth_accounts', {
    description: 'List connected account addresses',
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({ method: 'eth_accounts' })
    },
  })
  .command('eth_blockNumber', {
    description: 'Show the latest block number',
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({ method: 'eth_blockNumber' } as never)
    },
  })
  .command('eth_chainId', {
    description: 'Show the active chain ID',
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({ method: 'eth_chainId' })
    },
  })
  .command('eth_getTransactionReceipt', {
    description: 'Get a transaction receipt',
    args: z.object({ value: z.string().describe('Transaction hash') }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'eth_getTransactionReceipt',
        params: [c.args.value],
      } as never)
    },
  })
  .command('eth_requestAccounts', {
    description: 'Connect when no account is already available',
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({ method: 'eth_requestAccounts' })
    },
  })
  .command('eth_sendTransaction', {
    description: 'Send a transaction',
    options: z.object({
      request: z.string().describe('JSON request object'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'eth_sendTransaction',
        params: [parseObject(c.options.request, 'transaction request')],
      } as never)
    },
  })
  .command('eth_sendTransactionSync', {
    description: 'Send a transaction and wait for its receipt',
    options: z.object({
      request: z.string().describe('JSON request object'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'eth_sendTransactionSync',
        params: [parseObject(c.options.request, 'transaction request')],
      } as never)
    },
  })
  .command('eth_signTransaction', {
    description: 'Sign a transaction without broadcasting it',
    options: z.object({
      request: z.string().describe('JSON request object'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'eth_signTransaction',
        params: [parseObject(c.options.request, 'transaction request')],
      } as never)
    },
  })
  .command('eth_signTypedData_v4', {
    description: 'Sign EIP-712 typed data with the connected local access key',
    args: z.object({ data: z.string().describe('Typed-data JSON') }),
    options: z.object({
      address: z
        .string()
        .optional()
        .describe('Connected account address; defaults to active account'),
    }),
    async run(c) {
      const provider = c.var.provider!
      parseJson(c.args.data, 'typed data')
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = Address.from(
        c.options.address ?? accounts[0] ?? provider.getAccount().address,
      )
      return await provider.request({
        method: 'eth_signTypedData_v4',
        params: [address, c.args.data],
      })
    },
  })
  .command('personal_sign', {
    description: 'Sign a message with the connected local access key',
    args: z.object({ message: z.string().describe('UTF-8 message') }),
    options: z.object({
      address: z
        .string()
        .optional()
        .describe('Connected account address; defaults to active account'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = Address.from(
        c.options.address ?? accounts[0] ?? provider.getAccount().address,
      )
      return await provider.request({
        method: 'personal_sign',
        params: [Hex.fromString(c.args.message), address],
      })
    },
  })
  .command('rpc', {
    description: 'Send any JSON-RPC method through the Accounts provider',
    args: z.object({ method: z.string().describe('JSON-RPC method') }),
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: c.args.method,
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('status', {
    description: 'Show the persisted connection without exposing signing material',
    async run(c) {
      const provider = c.var.provider!
      await provider.request({ method: 'eth_accounts' })
      const state = provider.store.getState()
      return {
        accessKeys: state.accessKeys.map((key) => ({
          accessKeyAddress: key.address,
          account: key.access,
          chainId: key.chainId,
          expiry: key.expiry,
          keyType: key.keyType,
          limits: key.limits?.map((limit) => ({
            ...limit,
            limit: Hex.fromNumber(limit.limit),
          })),
          scopes: key.scopes,
        })),
        accounts: state.accounts.map((account) => ({
          address: account.address,
          ...('keyType' in account ? { keyType: account.keyType } : {}),
          ...(account.label ? { label: account.label } : {}),
        })),
        activeAccount: state.accounts[state.activeAccount]?.address,
        chainId: Hex.fromNumber(state.chainId),
        connected: state.accounts.length > 0,
      }
    },
  })
  .command('tempo_fundAddress', {
    description: 'Fund an address on supported test networks',
    args: z.object({
      address: z.string().optional().describe('Address; defaults to active account'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = c.args.address ?? accounts[0] ?? provider.getAccount().address
      return await provider.request({ method: 'tempo_fundAddress', params: [address] } as never)
    },
  })
  .command('wallet_authorizeAccessKey', {
    description: 'Authorize a new access key',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_deposit', {
    description: 'Open or prefill the wallet deposit flow',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_deposit',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_depositZone', {
    description: 'Open or prefill a zone deposit',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_depositZone',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_disconnect', {
    description: 'Disconnect and remove local access-key material',
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({ method: 'wallet_disconnect' })
    },
  })
  .command('wallet_getBalances', {
    description: 'Get wallet balances',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_getBalances',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_getCallsStatus', {
    description: 'Get the status of wallet calls',
    args: z.object({ value: z.string().describe('Transaction id') }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_getCallsStatus',
        params: [c.args.value],
      } as never)
    },
  })
  .command('wallet_revokeAccessKey', {
    description: 'Revoke an access key',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_revokeAccessKey',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_swap', {
    description: 'Open or prefill the wallet swap flow',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_swap',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_switchEthereumChain', {
    description: 'Switch the active chain',
    args: z.object({ chainId: z.string().describe('Hex or decimal chain ID') }),
    async run(c) {
      const provider = c.var.provider!
      const chainId = Hex.fromNumber(Number(c.args.chainId))
      return await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId }],
      })
    },
  })
  .command('wallet_transfer', {
    description: 'Open or prefill the wallet transfer flow',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_transfer',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_updateAccessKey', {
    description: 'Update an access key spending limit',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_updateAccessKey',
        params: parseParams(c.options.params),
      } as never)
    },
  })
  .command('wallet_withdrawZone', {
    description: 'Open or prefill a zone withdrawal',
    options: z.object({
      params: z.string().default('[]').describe('JSON array of RPC parameters'),
    }),
    async run(c) {
      const provider = c.var.provider!
      return await provider.request({
        method: 'wallet_withdrawZone',
        params: parseParams(c.options.params),
      } as never)
    },
  })

await cli.serve()

function json<const schema extends z.core.$ZodType>(schema: schema) {
  return z.preprocess((value, context) => {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value)
    } catch {
      context.addIssue({ code: 'custom', message: 'Invalid JSON.' })
      return z.NEVER
    }
  }, schema)
}

function parseParams(value: string): readonly unknown[] {
  const params = parseJson(value, 'params')
  if (!Array.isArray(params)) throw new Error('--params must contain a JSON array.')
  return params
}

function parseObject(value: string, label: string): Record<string, unknown> {
  const parsed = parseJson(value, label)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object.`)
  return parsed as Record<string, unknown>
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new Error(`Invalid ${label} JSON.`, { cause: error })
  }
}
