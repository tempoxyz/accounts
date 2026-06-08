import { Hex, P256, Provider as core_Provider, RpcResponse } from 'ox'
import { custom } from 'viem'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import { Wata, mobileWebAuth as core_mobileWebAuth, type MobileWebAuth } from 'wata'
import { z } from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as Rpc from '../core/zod/rpc.js'

/**
 * Creates a mobile web auth adapter that forwards wallet RPC through Wata.
 *
 * Authentication opens a browser session and completes via an encrypted app-link
 * callback carrying the wallet RPC response.
 */
export function mobileWebAuth(options: mobileWebAuth.Options): Adapter.Adapter {
  const { baseUrl, fetch, host, name, open, openAuthSession, rdns, redirectUri } = options

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
      const authSession =
        openAuthSession ??
        (async ({
          authorizationUrl,
          callback,
        }: Parameters<NonNullable<MobileWebAuth.Options['openAuthSession']>>[0]) => {
          if (!open) throw new Error('`mobileWebAuth` requires `open` or `openAuthSession`.')
          const result = await open(authorizationUrl, callback)
          return result ?? undefined
        })

      // Mobile web auth is single-exchange: one authorization URL carries one
      // RPC request envelope, and one callback URL carries one response.
      const session = Wata.create({
        baseUrl,
        meta: { name },
        transports: [
          core_mobileWebAuth({
            callback: redirectUri,
            host,
            openAuthSession: authSession,
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

    function toConnectReturn(result: Rpc.wallet_connect.Encoded['returns']) {
      const capabilities = result.accounts[0]?.capabilities
      return {
        accounts: result.accounts.map((account) => ({ address: account.address })),
        ...(capabilities?.keyAuthorization
          ? { keyAuthorization: capabilities.keyAuthorization }
          : {}),
        ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
        ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
      }
    }

    return {
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
        async disconnect() {
          await provider.request({ method: 'wallet_disconnect' })
        },
        async swap(_parameters, request) {
          return (await provider.request(request)) as Rpc.wallet_swap.Encoded['returns']
        },
        async switchChain(parameters) {
          await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: Hex.fromNumber(parameters.chainId) }],
          })
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

/** Creates the Tempo Wallet React Native adapter using Wata mobile web auth. */
export function tempoWallet(options: tempoWallet.Options): Adapter.Adapter {
  const {
    baseUrl = 'https://wallet.tempo.xyz',
    host = 'https://wallet.tempo.xyz',
    name = 'Tempo Wallet',
    rdns = 'xyz.tempo',
    ...rest
  } = options
  return mobileWebAuth({ ...rest, baseUrl, host, name, rdns })
}

export declare namespace mobileWebAuth {
  /** Browser opener override. Opens the auth URL and returns the callback URL. */
  export type Open = (url: string, redirectUri: string) => Promise<string | null>
  /** Platform opener options for mobile web auth. */
  export type OpenOptions =
    | {
        /** Browser opener override. Opens the auth URL and returns the callback URL. */
        open: Open
        /** Wata browser auth-session override. */
        openAuthSession?: MobileWebAuth.Options['openAuthSession'] | undefined
      }
    | {
        /** Browser opener override. Opens the auth URL and returns the callback URL. */
        open?: undefined
        /** Wata browser auth-session override. */
        openAuthSession: MobileWebAuth.Options['openAuthSession']
      }
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
    /** Redirect URI for the auth callback (e.g. your app's deep link scheme). */
    redirectUri: string
    /** Reverse-DNS provider identifier. */
    rdns: string
  }
  /** Options for {@link mobileWebAuth}. */
  export type Options = BaseOptions & OpenOptions
}

export declare namespace tempoWallet {
  /** Options for {@link tempoWallet}. */
  export type Options = Omit<mobileWebAuth.BaseOptions, 'baseUrl' | 'host' | 'name' | 'rdns'> &
    mobileWebAuth.OpenOptions & {
      /** Consumer discovery origin. @default "https://wallet.tempo.xyz" */
      baseUrl?: mobileWebAuth.Options['baseUrl'] | undefined
      /** Tempo Wallet discovery origin or preloaded Wata host document. @default "https://wallet.tempo.xyz" */
      host?: mobileWebAuth.Options['host'] | undefined
      /** Provider display name. @default "Tempo Wallet" */
      name?: mobileWebAuth.Options['name'] | undefined
      /** Reverse-DNS provider identifier. @default "xyz.tempo" */
      rdns?: mobileWebAuth.Options['rdns'] | undefined
    }
}
