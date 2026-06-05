import {
  Address as core_Address,
  Base64,
  Hex,
  P256,
  Provider as core_Provider,
  RpcResponse,
} from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { custom } from 'viem'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import * as z from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as Rpc from '../core/zod/rpc.js'

/**
 * Creates a React Native adapter that authorizes access keys via the system browser.
 *
 * Authentication opens a browser session and completes via a redirect callback
 * that returns the signed key authorization.
 */
export function reactNative(options: reactNative.Options): Adapter.Adapter {
  const { name = 'Tempo Mobile', rdns = 'xyz.tempo.mobile' } = options

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

    async function openMobileAuth(parameters: Omit<buildAuthUrl.Parameters, 'callback' | 'state'>) {
      const { host, redirectUri, open = defaultOpen } = options
      const state = Base64.fromBytes(Hex.toBytes(Hex.random(16)), { pad: false, url: true })
      const authUrl = buildAuthUrl(host, {
        callback: redirectUri,
        ...parameters,
        state,
      })

      const callbackUrl = await open(authUrl, redirectUri)
      if (!callbackUrl) throw new AuthCancelledError()

      const params = new URL(callbackUrl).searchParams
      const returnedState = params.get('state')
      if (returnedState !== state) throw new StateMismatchError()

      return params
    }

    const provider = core_Provider.from({
      async request(request) {
        switch (request.method) {
          case 'eth_chainId':
            return Hex.fromNumber(store.getState().chainId)
          case 'wallet_authorizeAccessKey': {
            const [parameters] = z.decode(
              Rpc.wallet_authorizeAccessKey.schema.params!,
              request.params as never,
            )
            const publicKey = parameters.publicKey
            if (!publicKey)
              throw new RpcResponse.InvalidParamsError({
                message:
                  '`wallet_authorizeAccessKey` on the React Native adapter requires key parameters.',
              })

            const params = await openMobileAuth({
              chainId: Number(parameters.chainId ?? store.getState().chainId),
              ...(typeof parameters.expiry !== 'undefined' ? { expiry: parameters.expiry } : {}),
              ...(parameters.keyType ? { keyType: parameters.keyType } : {}),
              ...(parameters.limits
                ? { limits: parameters.limits.map((l) => ({ ...l, limit: String(l.limit) })) }
                : {}),
              pubKey: publicKey,
              ...(parameters.showDeposit !== undefined
                ? { showDeposit: parameters.showDeposit }
                : {}),
            })
            const accountAddress = params.get('accountAddress')
            if (!accountAddress) throw new Error('Missing accountAddress in callback.')

            const value = params.get('keyAuthorization')
            if (!value) throw new Error('Missing keyAuthorization in callback.')
            const keyAuthorization = KeyAuthorization.deserialize(value as Hex.Hex)
            if (!keyAuthorization.signature)
              throw new Error('Key authorization in callback is missing a signature.')

            return {
              keyAuthorization: KeyAuthorization.toRpc(keyAuthorization as KeyAuthorization.Signed),
              rootAddress: accountAddress as core_Address.Address,
            } satisfies Rpc.wallet_authorizeAccessKey.Encoded['returns']
          }
          case 'wallet_connect': {
            const [parameters] =
              z.decode(Rpc.wallet_connect.schema.params!, request.params as never) ?? []
            const capabilities = parameters?.capabilities
            const authorizeAccessKey = capabilities?.authorizeAccessKey
            const publicKey = authorizeAccessKey?.publicKey
            if (authorizeAccessKey && !publicKey)
              throw new RpcResponse.InvalidParamsError({
                message:
                  '`wallet_connect` on the React Native adapter requires key parameters when `capabilities.authorizeAccessKey` is set.',
              })

            const params = await openMobileAuth({
              chainId: Number(authorizeAccessKey?.chainId ?? store.getState().chainId),
              ...(typeof authorizeAccessKey?.expiry !== 'undefined'
                ? { expiry: authorizeAccessKey.expiry }
                : {}),
              ...(authorizeAccessKey?.keyType ? { keyType: authorizeAccessKey.keyType } : {}),
              ...(authorizeAccessKey?.limits
                ? {
                    limits: authorizeAccessKey.limits.map((l) => ({
                      ...l,
                      limit: String(l.limit),
                    })),
                  }
                : {}),
              ...(capabilities?.digest ? { digest: capabilities.digest } : {}),
              ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
              ...(publicKey ? { pubKey: publicKey } : {}),
              ...(capabilities?.showDeposit !== undefined
                ? { showDeposit: capabilities.showDeposit }
                : {}),
            })

            const accountAddress = params.get('accountAddress')
            if (!accountAddress) throw new Error('Missing accountAddress in callback.')

            const keyAuthorization = (() => {
              const value = params.get('keyAuthorization')
              if (!value) return undefined
              const keyAuthorization = KeyAuthorization.deserialize(value as Hex.Hex)
              if (!keyAuthorization.signature)
                throw new Error('Key authorization in callback is missing a signature.')
              return keyAuthorization as KeyAuthorization.Signed
            })()
            if (publicKey && !keyAuthorization)
              throw new Error('Missing keyAuthorization in callback.')

            const signature = params.get('signature') as Hex.Hex | null
            const personalSignMessage = params.get('personalSignMessage')

            return {
              accounts: [
                {
                  address: accountAddress as core_Address.Address,
                  capabilities: {
                    ...(keyAuthorization
                      ? { keyAuthorization: KeyAuthorization.toRpc(keyAuthorization) }
                      : {}),
                    ...(personalSignMessage
                      ? { personalSign: { message: personalSignMessage } }
                      : {}),
                    ...(signature ? { signature } : {}),
                  },
                },
              ],
            } satisfies Rpc.wallet_connect.Encoded['returns']
          }
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
    /** Host URL for the mobile auth page. @default "https://wallet.tempo.xyz" */
    host: string
    /** Provider display name. @default "Tempo Mobile" */
    name?: string | undefined
    /**
     * Browser opener override. Opens the auth URL and returns the callback URL.
     * @default Uses `expo-web-browser`'s `openAuthSessionAsync`.
     */
    open?: ((url: string, redirectUri: string) => Promise<string | null>) | undefined
    /** Redirect URI for the auth callback (e.g. your app's deep link scheme). */
    redirectUri: string
    /** Reverse-DNS provider identifier. @default "xyz.tempo.mobile" */
    rdns?: string | undefined
  }
}

class AuthCancelledError extends Error {
  constructor() {
    super('Authentication was cancelled by the user.')
    this.name = 'AuthCancelledError'
  }
}

class StateMismatchError extends Error {
  constructor() {
    super('State parameter mismatch — possible CSRF attack.')
    this.name = 'StateMismatchError'
  }
}

async function defaultOpen(url: string, redirectUri: string): Promise<string | null> {
  const { openAuthSessionAsync } = await import('expo-web-browser')
  const result = await openAuthSessionAsync(url, redirectUri)
  if (result.type !== 'success') return null
  return result.url
}

function buildAuthUrl(host: string, params: buildAuthUrl.Parameters): string {
  const url = new URL('/remote/auth/mobile', host)
  if (params.pubKey) url.searchParams.set('pubKey', params.pubKey)
  if (params.keyType) url.searchParams.set('keyType', params.keyType)
  url.searchParams.set('chainId', Hex.fromNumber(params.chainId))
  if (params.digest) url.searchParams.set('digest', params.digest)
  if (typeof params.expiry !== 'undefined')
    url.searchParams.set('expiry', Hex.fromNumber(params.expiry))
  if (params.limits) url.searchParams.set('limits', JSON.stringify(params.limits))
  if (params.personalSign) url.searchParams.set('personalSign', JSON.stringify(params.personalSign))
  if (params.showDeposit === true) url.searchParams.set('showDeposit', 'true')
  else if (params.showDeposit)
    url.searchParams.set('showDeposit', JSON.stringify(params.showDeposit))
  url.searchParams.set('callback', params.callback)
  url.searchParams.set('state', params.state)
  return url.toString()
}

declare namespace buildAuthUrl {
  type Parameters = {
    callback: string
    chainId: number
    digest?: Hex.Hex | undefined
    expiry?: number | undefined
    keyType?: string | undefined
    limits?: readonly { token: string; limit: string }[] | undefined
    personalSign?: { message: string } | undefined
    pubKey?: Hex.Hex | undefined
    showDeposit?: Adapter.createAccount.Parameters['showDeposit'] | undefined
    state: string
  }
}

function unsupported(message: string) {
  return new core_Provider.UnsupportedMethodError({ message })
}
