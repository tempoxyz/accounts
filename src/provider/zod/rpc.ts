import * as z from 'zod/mini'

import * as Schema from '../Schema.js'
import * as u from './utils.js'

export const eth_accounts = Schema.defineItem({
  method: z.literal('eth_accounts'),
  params: undefined,
  returns: z.readonly(z.array(u.address())),
})
export type eth_accounts = Schema.DefineItem<typeof eth_accounts>

export const eth_chainId = Schema.defineItem({
  method: z.literal('eth_chainId'),
  params: undefined,
  returns: u.hex(),
})
export type eth_chainId = Schema.DefineItem<typeof eth_chainId>

export const eth_requestAccounts = Schema.defineItem({
  method: z.literal('eth_requestAccounts'),
  params: undefined,
  returns: z.readonly(z.array(u.address())),
})
export type eth_requestAccounts = Schema.DefineItem<typeof eth_requestAccounts>

export const wallet_connect = Schema.defineItem({
  method: z.literal('wallet_connect'),
  params: z.optional(
    z.readonly(
      z.tuple([
        z.object({
          capabilities: z.optional(
            z.object({
              method: z.optional(z.union([z.literal('register'), z.literal('login')])),
            }),
          ),
        }),
      ]),
    ),
  ),
  returns: z.readonly(z.array(u.address())),
})
export type wallet_connect = Schema.DefineItem<typeof wallet_connect>

export const wallet_disconnect = Schema.defineItem({
  method: z.literal('wallet_disconnect'),
  params: undefined,
  returns: undefined,
})
export type wallet_disconnect = Schema.DefineItem<typeof wallet_disconnect>

export const wallet_switchEthereumChain = Schema.defineItem({
  method: z.literal('wallet_switchEthereumChain'),
  params: z.readonly(z.tuple([z.object({ chainId: u.number() })])),
  returns: undefined,
})
export type wallet_switchEthereumChain = Schema.DefineItem<typeof wallet_switchEthereumChain>
