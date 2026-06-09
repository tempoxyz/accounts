import { Hex, P256, Provider as core_Provider, RpcResponse } from 'ox'
import { custom } from 'viem'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import { Wata, mobileWebAuth as core_mobileWebAuth, type MobileWebAuth } from 'wata'
import { z } from 'zod/mini'

import * as Adapter from '../../Adapter.js'
import * as Rpc from '../../zod/rpc.js'

/**
 * Creates a mobile web auth adapter that forwards wallet RPC through Wata.
 *
 * Authentication opens a browser session and completes via an encrypted app-link
 * callback carrying the wallet RPC response.
 */
export function mobileWebAuth(options: mobileWebAuth.Options): Adapter.Adapter {
  const { baseUrl, fetch, host, name, openAuthSession, rdns, redirectUri } = options

  return Adapter.define({ name, rdns }, ({ getAccount, store }) => {
    function generateAccessKey(
      parameters: Adapter.generateAccessKey.Options = {},
    ): Adapter.generateAccessKey.ReturnType {
      const { keyType } = parameters
      if (keyType && keyType !== 'p256' && keyType !== 'secp256k1')
        throw new RpcResponse.InvalidParamsError({
          message: `\`keyType: "${keyType}"\` requires externally generated key material; provide \`publicKey\` or \`address\`.`,
        })
      const type = keyType ?? 'secp256k1'
      const privateKey = type === 'p256' ? P256.randomPrivateKey() : Secp256k1.randomPrivateKey()
      const account =
        type === 'p256' ? TempoAccount.fromP256(privateKey) : TempoAccount.fromSecp256k1(privateKey)
      return {
        keyType: type,
        privateKey,
        publicKey: account.publicKey,
      }
    }

    async function requestMobile(request: {
      method: string
      params?: readonly unknown[] | undefined
    }): Promise<unknown> {
      // Mobile web auth is single-exchange: one authorization URL carries one
      // RPC request envelope, and one callback URL carries one response.
      // The wallet learns this app's identity from the consumer discovery
      // document served at `baseUrl`, not from session metadata.
      const session = Wata.create({
        baseUrl,
        transports: [
          core_mobileWebAuth({
            callback: redirectUri,
            host,
            openAuthSession,
            ...(fetch !== undefined ? { fetch } : {}),
          }),
        ],
      })
      return (await session.send({ method: request.method, params: request.params ?? [] })).result
    }

    const provider = core_Provider.from({
      async request(request) {
        if (request.method === 'eth_chainId') return Hex.fromNumber(store.getState().chainId)
        return await requestMobile({
          method: request.method,
          params: request.params as readonly unknown[] | undefined,
        })
      },
    })

    // Connect capabilities are read from the first account only: mobile web
    // auth connects a single wallet account per exchange.
    function toConnectReturn(result: Rpc.wallet_connect.Encoded['returns']) {
      const capabilities = result.accounts[0]?.capabilities
      return {
        accounts: result.accounts.map((account) => ({ address: account.address })),
        ...(capabilities?.auth ? { auth: capabilities.auth } : {}),
        ...(capabilities?.identity ? { identity: capabilities.identity } : {}),
        ...(capabilities?.keyAuthorization
          ? { keyAuthorization: capabilities.keyAuthorization }
          : {}),
        ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
        ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
      }
    }

    return {
      forwardsAuth: true,
      actions: {
        async createAccount(_parameters, request) {
          return toConnectReturn(
            (await provider.request(request)) as Rpc.wallet_connect.Encoded['returns'],
          )
        },
        async loadAccounts(_parameters, request) {
          return toConnectReturn(
            (await provider.request(request)) as Rpc.wallet_connect.Encoded['returns'],
          )
        },
        async deposit(_parameters, request) {
          return (await provider.request(request)) as Rpc.wallet_deposit.Encoded['returns']
        },
        async depositZone(parameters, request) {
          return (await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_depositZone.parameters, parameters)] as const,
          })) as Rpc.wallet_depositZone.Encoded['returns']
        },
        // No `disconnect`/`switchChain` actions: both are local state
        // changes the provider handles itself, and mobile web auth has no
        // persistent wallet-side session to clean up. Forwarding them would
        // open a browser auth session for nothing.
        async swap(_parameters, request) {
          return (await provider.request(request)) as Rpc.wallet_swap.Encoded['returns']
        },
        async transfer(parameters, request) {
          return (await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_transfer.parameters, parameters)] as const,
          })) as Rpc.wallet_transfer.Encoded['returns']
        },
        async withdrawZone(parameters, request) {
          return (await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_withdrawZone.parameters, parameters)] as const,
          })) as Rpc.wallet_withdrawZone.Encoded['returns']
        },
      },
      generateAccessKey,
      getAccount(parameters = {}) {
        return {
          account: {
            address: parameters.address ?? getAccount({ signable: false }).address,
            type: 'json-rpc' as const,
          },
          transport: custom(provider),
        }
      },
    }
  })
}

export declare namespace mobileWebAuth {
  /** Base options for {@link mobileWebAuth}. */
  export type BaseOptions = {
    /** Public HTTPS origin that hosts this app's Wata consumer discovery document. */
    baseUrl: string
    /** Override the Wata discovery `fetch` implementation. */
    fetch?: MobileWebAuth.Options['fetch'] | undefined
    /** Host discovery origin or preloaded Wata host document. */
    host: MobileWebAuth.Options['host']
    /** Provider display name. */
    name: string
    /** Opens the browser auth session and returns the callback URL. */
    openAuthSession: NonNullable<MobileWebAuth.Options['openAuthSession']>
    /** Redirect URI for the auth callback (e.g. your app's deep link scheme). */
    redirectUri: string
    /** Reverse-DNS provider identifier. */
    rdns: string
  }
  /** Options for {@link mobileWebAuth}. */
  export type Options = BaseOptions
}
