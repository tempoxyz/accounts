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

    async function authorizeMobile(request: {
      authorizeAccessKey: Adapter.authorizeAccessKey.Parameters | undefined
      digest?: Adapter.loadAccounts.Parameters['digest'] | undefined
      method: 'wallet_authorizeAccessKey' | 'wallet_connect'
      personalSign?: Adapter.loadAccounts.Parameters['personalSign'] | undefined
      showDeposit?: Adapter.createAccount.Parameters['showDeposit'] | undefined
    }) {
      const { host, redirectUri, open = defaultOpen } = options
      const { authorizeAccessKey, digest, method, personalSign, showDeposit } = request

      const publicKey = authorizeAccessKey?.publicKey
      const keyType = authorizeAccessKey?.keyType

      if (!publicKey && (method === 'wallet_authorizeAccessKey' || authorizeAccessKey))
        throw new RpcResponse.InvalidParamsError({
          message:
            method === 'wallet_connect'
              ? '`wallet_connect` on the React Native adapter requires key parameters when `capabilities.authorizeAccessKey` is set.'
              : '`wallet_authorizeAccessKey` on the React Native adapter requires key parameters.',
        })

      const state = Base64.fromBytes(Hex.toBytes(Hex.random(16)), { pad: false, url: true })
      const authUrl = buildAuthUrl(host, {
        callback: redirectUri,
        chainId: Number(authorizeAccessKey?.chainId ?? store.getState().chainId),
        ...(typeof authorizeAccessKey?.expiry !== 'undefined'
          ? { expiry: authorizeAccessKey.expiry }
          : {}),
        ...(keyType ? { keyType } : {}),
        ...(authorizeAccessKey?.limits
          ? { limits: authorizeAccessKey.limits.map((l) => ({ ...l, limit: String(l.limit) })) }
          : {}),
        ...(digest ? { digest } : {}),
        ...(personalSign ? { personalSign } : {}),
        ...(publicKey ? { pubKey: publicKey } : {}),
        ...(showDeposit !== undefined ? { showDeposit } : {}),
        state,
      })

      const callbackUrl = await open(authUrl, redirectUri)
      if (!callbackUrl) throw new AuthCancelledError()

      const params = new URL(callbackUrl).searchParams
      const returnedState = params.get('state')
      if (returnedState !== state) throw new StateMismatchError()

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
      if (publicKey && !keyAuthorization) throw new Error('Missing keyAuthorization in callback.')

      const signature = params.get('signature') as Hex.Hex | null
      const personalSignMessage = params.get('personalSignMessage')

      return {
        accountAddress: accountAddress as core_Address.Address,
        ...(keyAuthorization ? { keyAuthorization } : {}),
        ...(personalSignMessage ? { personalSign: { message: personalSignMessage } } : {}),
        ...(signature ? { signature } : {}),
      }
    }

    async function authorizeAccessKeyMobile(
      request: Pick<Rpc.wallet_authorizeAccessKey.Encoded, 'method' | 'params'>,
    ): Promise<Rpc.wallet_authorizeAccessKey.Encoded['returns']> {
      const [parameters] = z.decode(Rpc.wallet_authorizeAccessKey.schema.params!, request.params)
      const result = await authorizeMobile({
        authorizeAccessKey: parameters,
        method: 'wallet_authorizeAccessKey',
        ...(parameters.showDeposit !== undefined ? { showDeposit: parameters.showDeposit } : {}),
      })
      if (!result.keyAuthorization) throw new Error('Missing keyAuthorization in callback.')

      return {
        keyAuthorization: KeyAuthorization.toRpc(result.keyAuthorization),
        rootAddress: result.accountAddress,
      }
    }

    async function connectMobile(
      request: Pick<Rpc.wallet_connect.Encoded, 'method' | 'params'>,
    ): Promise<Rpc.wallet_connect.Encoded['returns']> {
      const [parameters] = z.decode(Rpc.wallet_connect.schema.params!, request.params) ?? []
      const capabilities = parameters?.capabilities

      const result = await authorizeMobile({
        authorizeAccessKey: capabilities?.authorizeAccessKey,
        ...(capabilities?.digest ? { digest: capabilities.digest } : {}),
        method: 'wallet_connect',
        ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
        ...(capabilities?.showDeposit !== undefined
          ? { showDeposit: capabilities.showDeposit }
          : {}),
      })

      return {
        accounts: [
          {
            address: result.accountAddress,
            capabilities: {
              ...(result.keyAuthorization
                ? { keyAuthorization: KeyAuthorization.toRpc(result.keyAuthorization) }
                : {}),
              ...(result.personalSign ? { personalSign: result.personalSign } : {}),
              ...(result.signature ? { signature: result.signature } : {}),
            },
          },
        ],
      }
    }

    const provider = core_Provider.from({
      async request(request) {
        switch (request.method) {
          case 'eth_chainId':
            return Hex.fromNumber(store.getState().chainId)
          case 'wallet_authorizeAccessKey':
            return await authorizeAccessKeyMobile(request as never)
          case 'wallet_connect':
            return await connectMobile(request as never)
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

function buildAuthUrl(
  host: string,
  params: {
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
  },
): string {
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

function unsupported(message: string) {
  return new core_Provider.UnsupportedMethodError({ message })
}
