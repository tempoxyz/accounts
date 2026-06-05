import { Hex, P256, Provider as core_Provider, RpcResponse } from 'ox'
import { custom } from 'viem'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import { Wata, mobileWebAuth, type MobileWebAuth } from 'wata'

import * as Adapter from '../core/Adapter.js'
import * as Rpc from '../core/zod/rpc.js'

/**
 * Creates a React Native adapter that forwards mobile wallet RPC through Wata.
 *
 * Authentication opens a browser session and completes via an encrypted app-link
 * callback carrying the wallet RPC response.
 */
export function reactNative(options: reactNative.Options): Adapter.Adapter {
  const {
    baseUrl,
    fetch,
    host = 'https://wallet.tempo.xyz',
    name = 'Tempo Mobile',
    open,
    openAuthSession,
    rdns = 'xyz.tempo.mobile',
    redirectUri,
  } = options

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

    async function requestMobile(
      request: Pick<Rpc.wallet_authorizeAccessKey.Encoded, 'method' | 'params'>,
    ): Promise<Rpc.wallet_authorizeAccessKey.Encoded['returns']>
    async function requestMobile(
      request: Pick<Rpc.wallet_connect.Encoded, 'method' | 'params'>,
    ): Promise<Rpc.wallet_connect.Encoded['returns']>
    async function requestMobile(request: {
      method: 'wallet_authorizeAccessKey' | 'wallet_connect'
      params: readonly unknown[] | undefined
    }): Promise<unknown> {
      const session = Wata.create({
        baseUrl,
        meta: { name },
        transports: [
          mobileWebAuth({
            callback: redirectUri,
            host,
            openAuthSession:
              openAuthSession ??
              (async ({ authorizationUrl, callback }) => {
                const result = await (open ?? defaultOpen)(authorizationUrl, callback)
                return result ?? undefined
              }),
            ...(fetch ? { fetch } : {}),
          }),
        ],
      })
      return (await session.send({ method: request.method, params: request.params ?? [] })).result
    }

    const provider = core_Provider.from({
      async request(request) {
        switch (request.method) {
          case 'eth_chainId':
            return Hex.fromNumber(store.getState().chainId)
          case 'wallet_authorizeAccessKey':
            return await requestMobile(request as never)
          case 'wallet_connect':
            return await requestMobile(request as never)
          default:
            throw unsupported(`\`${request.method}\` not supported by React Native adapter.`)
        }
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
        async revokeAccessKey() {
          throw unsupported('`wallet_revokeAccessKey` not supported by React Native adapter.')
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

export declare namespace reactNative {
  export type Options = {
    /** Public HTTPS origin that hosts this app's Wata consumer discovery document. */
    baseUrl: string
    /** Override the Wata discovery `fetch` implementation. */
    fetch?: MobileWebAuth.Options['fetch'] | undefined
    /** Host discovery origin or preloaded Wata host document. @default "https://wallet.tempo.xyz" */
    host?: MobileWebAuth.Options['host'] | undefined
    /** Provider display name. @default "Tempo Mobile" */
    name?: string | undefined
    /**
     * Browser opener override. Opens the auth URL and returns the callback URL.
     * @default Uses `expo-web-browser`'s `openAuthSessionAsync`.
     */
    open?: ((url: string, redirectUri: string) => Promise<string | null>) | undefined
    /** Wata browser auth-session override. */
    openAuthSession?: MobileWebAuth.Options['openAuthSession'] | undefined
    /** Redirect URI for the auth callback (e.g. your app's deep link scheme). */
    redirectUri: string
    /** Reverse-DNS provider identifier. @default "xyz.tempo.mobile" */
    rdns?: string | undefined
  }
}

async function defaultOpen(url: string, redirectUri: string): Promise<string | null> {
  const { openAuthSessionAsync } = await import('expo-web-browser')
  const result = await openAuthSessionAsync(url, redirectUri)
  if (result.type !== 'success') return null
  return result.url
}

function unsupported(message: string) {
  return new core_Provider.UnsupportedMethodError({ message })
}
