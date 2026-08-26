import { Rpc } from 'accounts'
import { Cli, z } from 'incur'
import { Address, Hex } from 'ox'
import { parseUnits } from 'viem'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import { Actions } from 'viem/tempo'

import * as Provider from './provider.js'

const alphaUsd = '0x20c0000000000000000000000000000000000001' as const
const pathUsd = '0x20c0000000000000000000000000000000000000' as const
const recipient = '0x0000000000000000000000000000000000000001' as const

const cli = Cli.create('accounts-playground', {
  description: 'Try common Accounts wallet flows from a terminal',
  env: Provider.env,
  vars: z.object({
    provider: z.custom<Provider.create.ReturnType>().optional(),
  }),
})
  .use(async (c, next) => {
    c.set('provider', Provider.create(c.env))
    await next()
  })
  .command('connect', {
    description: 'Connect and optionally request additional wallet flows',
    options: z.object({
      'auth.url': z.string().optional().describe('SIWE authentication URL'),
      authorizeAccessKey: z.boolean().default(false).describe('Authorize a pathUSD transfer key'),
      'authorizeAccessKey.expiry': z.coerce
        .number()
        .int()
        .optional()
        .describe('Access-key lifetime in seconds (default: 86400)'),
      'authorizeAccessKey.limit': z
        .string()
        .optional()
        .describe('pathUSD spending limit (default: 100)'),
      deposit: z.boolean().default(false).describe('Show deposit after connecting'),
      'deposit.amount': z.string().optional().describe('Deposit amount'),
      'deposit.token': z.string().optional().describe('Deposit token'),
      'identity.email': z.boolean().default(false).describe('Request the verified email claim'),
      name: z.string().optional().describe('Account name when registering'),
      'personalSign.message': z.string().optional().describe('Message to sign while connecting'),
      register: z.boolean().default(false).describe('Create a wallet account'),
    }),
    async run(c) {
      if (c.options['auth.url'] && c.options['personalSign.message'])
        throw new Error('Use either --auth.url or --personal-sign.message, not both.')
      if (c.options.name && !c.options.register) throw new Error('--name requires --register.')

      const accessKey =
        c.options.authorizeAccessKey ||
        c.options['authorizeAccessKey.expiry'] !== undefined ||
        c.options['authorizeAccessKey.limit'] !== undefined
      const deposit =
        c.options['deposit.amount'] !== undefined || c.options['deposit.token'] !== undefined
          ? {
              ...(c.options['deposit.amount'] !== undefined
                ? { amount: c.options['deposit.amount'] }
                : {}),
              ...(c.options['deposit.token'] !== undefined
                ? { token: c.options['deposit.token'] }
                : {}),
            }
          : c.options.deposit || undefined
      const capabilities_base = {
        ...(c.options['auth.url'] ? { auth: { url: c.options['auth.url'] } } : {}),
        ...(accessKey
          ? {
              authorizeAccessKey: {
                expiry:
                  Math.floor(Date.now() / 1_000) +
                  (c.options['authorizeAccessKey.expiry'] ?? 86_400),
                limits: [
                  {
                    limit: parseUnits(c.options['authorizeAccessKey.limit'] ?? '100', 6),
                    token: pathUsd,
                  },
                ],
                scopes: [{ address: pathUsd, selector: 'transfer(address,uint256)' }],
              },
            }
          : {}),
        ...(c.options['identity.email'] ? { identity: { email: true as const } } : {}),
        ...(c.options['personalSign.message']
          ? { personalSign: { message: c.options['personalSign.message'] } }
          : {}),
        ...(deposit !== undefined ? { showDeposit: deposit } : {}),
      }
      const capabilities = c.options.register
        ? {
            ...capabilities_base,
            method: 'register' as const,
            ...(c.options.name ? { name: c.options.name } : {}),
          }
        : capabilities_base
      return await c.var.provider!.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: z.encode(Rpc.wallet_connect.capabilities.request, capabilities),
          },
        ],
      })
    },
  })
  .command('authorize-access-key', {
    description: 'Authorize a one-hour access key that can transfer pathUSD',
    options: z.object({
      amount: z.string().default('100').describe('pathUSD spending limit'),
      showDeposit: z.boolean().default(false).describe('Show deposit after authorization'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const parameters = z.encode(Rpc.wallet_authorizeAccessKey.parameters, {
        expiry: Math.floor(Date.now() / 1_000) + 3_600,
        limits: [{ limit: parseUnits(c.options.amount, 6), token: pathUsd }],
        scopes: [{ address: pathUsd, selector: 'transfer(address,uint256)' }],
        ...(c.options.showDeposit ? { showDeposit: { token: 'pathUSD' } } : {}),
      })
      return await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [parameters],
      })
    },
  })
  .command('balances', {
    description: 'Show pathUSD and alphaUSD balances',
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = accounts[0]
      if (!address) throw new Error('No connected account. Run connect first.')
      return await provider.request({
        method: 'wallet_getBalances',
        params: [
          {
            account: address,
            tokens: [pathUsd, alphaUsd],
          },
        ],
      })
    },
  })
  .command('deposit', {
    description: 'Open a prefilled deposit flow',
    options: z.object({
      amount: z.string().default('25').describe('Deposit amount'),
      token: z.string().default('pathUSD').describe('Deposit token'),
    }),
    async run(c) {
      return await c.var.provider!.request({
        method: 'wallet_deposit',
        params: [{ amount: c.options.amount, token: c.options.token }],
      })
    },
  })
  .command('disconnect', {
    description: 'Disconnect and remove local access-key material',
    async run(c) {
      return await c.var.provider!.request({ method: 'wallet_disconnect' })
    },
  })
  .command('fund', {
    description: 'Fund the connected account on a supported test network',
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = accounts[0]
      if (!address) throw new Error('No connected account. Run connect first.')
      return await provider.request({
        method: 'tempo_fundAddress',
        params: [address],
      } as never)
    },
  })
  .command('send-transaction', {
    description: 'Send a pathUSD transfer as a transaction call',
    options: z.object({
      amount: z.string().default('1').describe('pathUSD amount'),
      sync: z.boolean().default(false).describe('Wait for a receipt'),
      to: z.string().default(recipient).describe('Recipient address'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const calls = [
        Actions.token.transfer.call({
          amount: parseUnits(c.options.amount, 6),
          to: Address.from(c.options.to),
          token: pathUsd,
        }),
      ]
      if (c.options.sync)
        return await provider.request({
          method: 'eth_sendTransactionSync',
          params: [{ calls }],
        })
      return await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls }],
      })
    },
  })
  .command('sign-message', {
    description: 'Sign a plain-text message',
    options: z.object({
      message: z.string().default('hello world').describe('Message to sign'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = accounts[0]
      if (!address) throw new Error('No connected account. Run connect first.')
      return await provider.request({
        method: 'personal_sign',
        params: [Hex.fromString(c.options.message), address],
      })
    },
  })
  .command('sign-siwe', {
    description: 'Sign a Sign-In with Ethereum message',
    options: z.object({
      domain: z.string().default('localhost').describe('SIWE domain'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = accounts[0]
      if (!address) throw new Error('No connected account. Run connect first.')
      const message = createSiweMessage({
        address,
        chainId: provider.store.getState().chainId,
        domain: c.options.domain,
        nonce: generateSiweNonce(),
        statement: 'Sign in to the Accounts playground.',
        uri: `https://${c.options.domain}`,
        version: '1',
      })
      return {
        message,
        signature: await provider.request({
          method: 'personal_sign',
          params: [Hex.fromString(message), address],
        }),
      }
    },
  })
  .command('sign-typed-data', {
    description: 'Sign the web playground Mail example',
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = accounts[0]
      if (!address) throw new Error('No connected account. Run connect first.')
      const data = {
        types: {
          EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
          ],
          Person: [
            { name: 'name', type: 'string' },
            { name: 'wallet', type: 'address' },
          ],
          Mail: [
            { name: 'from', type: 'Person' },
            { name: 'to', type: 'Person' },
            { name: 'contents', type: 'string' },
          ],
        },
        primaryType: 'Mail',
        domain: {
          chainId: String(provider.store.getState().chainId),
          name: 'Accounts playground',
          version: '1',
        },
        message: {
          contents: 'Hello, Bob!',
          from: { name: 'Alice', wallet: address },
          to: { name: 'Bob', wallet: recipient },
        },
      }
      return {
        data,
        signature: await provider.request({
          method: 'eth_signTypedData_v4',
          params: [address, JSON.stringify(data)],
        }),
      }
    },
  })
  .command('status', {
    description: 'Show the active account, chain, and access keys',
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const state = provider.store.getState()
      return {
        accessKeys: state.accessKeys.map((key) => ({
          account: key.access,
          address: key.address,
          chainId: Hex.fromNumber(key.chainId),
          expiry: key.expiry,
          limits: key.limits?.map((limit) => ({
            ...limit,
            limit: Hex.fromNumber(limit.limit),
          })),
          scopes: key.scopes,
        })),
        activeAccount: accounts[0],
        chainId: Hex.fromNumber(state.chainId),
        connected: accounts.length > 0,
      }
    },
  })
  .command('swap', {
    description: 'Open a prefilled pathUSD and alphaUSD swap',
    options: z.object({
      amount: z.string().default('1').describe('Swap amount'),
      type: z.enum(['buy', 'sell']).default('sell').describe('Swap direction'),
    }),
    async run(c) {
      return await c.var.provider!.request({
        method: 'wallet_swap',
        params: [
          {
            amount: c.options.amount,
            pairToken: alphaUsd,
            slippage: 0.01,
            token: pathUsd,
            type: c.options.type,
          },
        ],
      })
    },
  })
  .command('transfer', {
    description: 'Open a prefilled pathUSD transfer',
    options: z.object({
      amount: z.string().default('1').describe('pathUSD amount'),
      editable: z.boolean().default(false).describe('Allow editing in the wallet'),
      memo: z.string().optional().describe('Transfer memo'),
      to: z.string().default(recipient).describe('Recipient address'),
    }),
    async run(c) {
      return await c.var.provider!.request({
        method: 'wallet_transfer',
        params: [
          {
            amount: c.options.amount,
            ...(c.options.editable ? { editable: true as const } : {}),
            ...(c.options.memo ? { memo: c.options.memo } : {}),
            to: Address.from(c.options.to),
            token: 'pathUSD',
          },
        ],
      })
    },
  })
  .command('update-access-key', {
    description: 'Update a pathUSD access-key spending limit',
    options: z.object({
      accessKeyAddress: z
        .string()
        .optional()
        .describe('Access-key address; defaults to the active account’s first key'),
      amount: z.string().default('50').describe('New pathUSD spending limit'),
    }),
    async run(c) {
      const provider = c.var.provider!
      const accounts = await provider.request({ method: 'eth_accounts' })
      const address = accounts[0]
      if (!address) throw new Error('No connected account. Run connect first.')
      const chainId = provider.store.getState().chainId
      const accessKeyAddress =
        c.options.accessKeyAddress ??
        provider.store.accessKeys.list({ account: address, chainId })[0]?.address
      if (!accessKeyAddress)
        throw new Error(
          'No access key found for the active account. Run connect --authorize-access-key first.',
        )
      const parameters = z.encode(Rpc.wallet_updateAccessKey.parameters, {
        accessKeyAddress: Address.from(accessKeyAddress),
        address,
        limits: [{ limit: parseUnits(c.options.amount, 6), token: pathUsd }],
      })
      return await provider.request({
        method: 'wallet_updateAccessKey',
        params: [parameters],
      })
    },
  })

await cli.serve()
