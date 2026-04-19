import {
  Address as core_Address,
  Base64,
  Hex,
  P256,
  Provider as core_Provider,
  PublicKey,
  RpcResponse,
} from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { prepareTransactionRequest } from 'viem/actions'
import { Actions, Account as TempoAccount, Secp256k1 } from 'viem/tempo'

import * as AccessKey from '../core/AccessKey.js'
import * as Adapter from '../core/Adapter.js'
import type * as Storage from '../core/Storage.js'

/**
 * Creates a React Native adapter that authorizes access keys via the system browser.
 *
 * Authentication opens a browser session and completes via a redirect callback
 * that returns the signed key authorization.
 */
export function reactNative(options: reactNative.Options): Adapter.Adapter {
  const { name = 'Tempo Mobile', rdns = 'xyz.tempo.mobile' } = options

  return Adapter.define({ name, rdns }, ({ getAccount, getClient, store }) => {
    async function loadManagedKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      parameters: loadManagedKey.Options = {},
    ): Promise<loadManagedKey.ReturnType | undefined> {
      const { keyType } = parameters
      const { secureStorage } = options
      if (!secureStorage) return undefined

      const { chainId } = store.getState()
      const storageKeys = keyType
        ? [managedKeyStorageKey(address, chainId, keyType)]
        : [
            managedKeyStorageKey(address, chainId, 'secp256k1'),
            managedKeyStorageKey(address, chainId, 'p256'),
            managedKeyStorageKey(address, chainId),
          ]
      let entry: ManagedKeyEntry | null = null
      for (const storageKey of storageKeys) {
        entry = await secureStorage.getItem<ManagedKeyEntry>(storageKey)
        if (entry) break
      }
      if (!entry) return undefined

      const account =
        entry.keyType === 'p256'
          ? TempoAccount.fromP256(entry.key, { access: address })
          : TempoAccount.fromSecp256k1(entry.key, { access: address })
      const keyAddress = core_Address.fromPublicKey(PublicKey.from(account.publicKey))
      const deserialized = KeyAuthorization.deserialize(entry.keyAuthorization)
      if (!deserialized.signature) throw new Error('Managed access key is missing a signature.')
      const keyAuthorization = deserialized as KeyAuthorization.Signed

      if (keyAuthorization.address.toLowerCase() === keyAddress.toLowerCase())
        AccessKey.save({
          address,
          keyAuthorization,
          privateKey: entry.key,
          store,
        })
      else
        store.setState((state) => ({
          accessKeys: state.accessKeys.filter(
            (accessKey) =>
              accessKey.address.toLowerCase() !== keyAuthorization.address.toLowerCase(),
          ),
        }))

      return {
        account,
        expiry: entry.expiry,
        key: entry.key,
        keyAddress,
        keyType: entry.keyType,
        publicKey: account.publicKey,
        storedAuthorization: keyAuthorization,
      }
    }

    async function resolveManagedKey(
      resolveOptions: {
        address?: Adapter.authorizeAccessKey.ReturnType['rootAddress'] | undefined
        keyType?: Adapter.authorizeAccessKey.Parameters['keyType'] | undefined
      } = {},
    ): Promise<resolveManagedKey.ReturnType> {
      const { address, keyType } = resolveOptions

      const requestedKeyType = keyType === 'p256' || keyType === 'secp256k1' ? keyType : undefined
      const entry = address
        ? await loadManagedKey(address, requestedKeyType ? { keyType: requestedKeyType } : {})
        : undefined
      if (entry)
        return {
          account: entry.account,
          key: entry.key,
          keyAddress: entry.keyAddress,
          keyType: entry.keyType,
          publicKey: entry.publicKey,
        }

      const nextKeyType = requestedKeyType === 'p256' ? 'p256' : 'secp256k1'
      const key = nextKeyType === 'p256' ? P256.randomPrivateKey() : Secp256k1.randomPrivateKey()
      const account =
        nextKeyType === 'p256'
          ? TempoAccount.fromP256(key, address ? { access: address } : undefined)
          : TempoAccount.fromSecp256k1(key, address ? { access: address } : undefined)

      return {
        account,
        key,
        keyAddress: core_Address.fromPublicKey(PublicKey.from(account.publicKey)),
        keyType: nextKeyType,
        publicKey: account.publicKey,
      }
    }

    async function saveManagedKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      managedKey: Awaited<ReturnType<typeof resolveManagedKey>>,
      keyAuthorization: KeyAuthorization.Signed,
    ) {
      if (!managedKey) return

      AccessKey.save({
        address,
        keyAuthorization,
        privateKey: managedKey.key,
        store,
      })

      const { secureStorage } = options
      if (!secureStorage) return

      const { chainId } = store.getState()
      const storageKey = managedKeyStorageKey(address, chainId, managedKey.keyType)
      const entry: ManagedKeyEntry = {
        chainId,
        expiry: keyAuthorization.expiry ?? 0,
        key: managedKey.key,
        keyAddress: managedKey.keyAddress,
        keyAuthorization: KeyAuthorization.serialize(keyAuthorization),
        keyType: managedKey.keyType,
        walletAddress: address,
      }
      await secureStorage.setItem(storageKey, entry)
    }

    async function isManagedKeyAuthorized(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      managedKey: loadManagedKey.ReturnType,
    ) {
      try {
        const metadata = await Actions.accessKey.getMetadata(getClient(), {
          account: address,
          accessKey: managedKey.keyAddress,
        })
        return (
          metadata.address.toLowerCase() === managedKey.keyAddress.toLowerCase() &&
          !metadata.isRevoked
        )
      } catch {
        return false
      }
    }

    async function reauthorizeManagedKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      managedKey: loadManagedKey.ReturnType,
    ) {
      const result = await authorize({
        account: address,
        authorizeAccessKey: {
          expiry: managedKey.expiry,
          keyType: managedKey.keyType,
          ...(managedKey.storedAuthorization.limits
            ? { limits: managedKey.storedAuthorization.limits.map((limit) => ({ ...limit })) }
            : {}),
          publicKey: managedKey.publicKey,
        },
        method: 'wallet_authorizeAccessKey',
      })
      await saveManagedKey(address, managedKey, result.keyAuthorization)
      return result.keyAuthorization
    }

    async function withManagedAccessKey<result>(
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed | undefined,
      ) => Promise<result>,
    ) {
      const rootAddress = store.getState().accounts[store.getState().activeAccount]?.address
      const managedKey = rootAddress ? await loadManagedKey(rootAddress) : undefined

      const account = managedKey?.account ?? getAccount({ signable: true })
      let keyAuthorization = AccessKey.getPending(account, { store })
      if (rootAddress && managedKey && !keyAuthorization)
        if (!(await isManagedKeyAuthorized(rootAddress, managedKey)))
          keyAuthorization = await reauthorizeManagedKey(rootAddress, managedKey)

      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch (error) {
        AccessKey.remove(account, { store })
        throw error
      }
    }

    async function authorize(request: {
      account?: Adapter.authorizeAccessKey.ReturnType['rootAddress'] | undefined
      authorizeAccessKey: Adapter.authorizeAccessKey.Parameters | undefined
      method: 'wallet_authorizeAccessKey' | 'wallet_connect'
    }) {
      const { host, redirectUri, open = defaultOpen } = options
      const { account, authorizeAccessKey, method } = request

      const managedKey =
        authorizeAccessKey && !authorizeAccessKey.publicKey && !authorizeAccessKey.address
          ? await resolveManagedKey({
              ...(account ? { address: account } : {}),
              ...(authorizeAccessKey.keyType ? { keyType: authorizeAccessKey.keyType } : {}),
            })
          : undefined

      const publicKey = authorizeAccessKey?.publicKey ?? managedKey?.publicKey
      const keyType = authorizeAccessKey?.keyType ?? managedKey?.keyType

      if (!publicKey)
        throw new RpcResponse.InvalidParamsError({
          message:
            method === 'wallet_connect'
              ? '`wallet_connect` on the React Native adapter requires `capabilities.authorizeAccessKey`.'
              : '`wallet_authorizeAccessKey` on the React Native adapter requires key parameters.',
        })

      const state = Base64.fromBytes(Hex.toBytes(Hex.random(16)), { pad: false, url: true })
      const authUrl = buildAuthUrl(host, {
        callback: redirectUri,
        chainId: store.getState().chainId,
        ...(typeof authorizeAccessKey?.expiry !== 'undefined'
          ? { expiry: authorizeAccessKey.expiry }
          : {}),
        ...(keyType ? { keyType } : {}),
        ...(authorizeAccessKey?.limits
          ? { limits: authorizeAccessKey.limits.map((l) => ({ ...l, limit: String(l.limit) })) }
          : {}),
        pubKey: publicKey,
        state,
      })

      const callbackUrl = await open(authUrl, redirectUri)
      if (!callbackUrl) throw new AuthCancelledError()

      const params = new URL(callbackUrl).searchParams
      const returnedState = params.get('state')
      if (returnedState !== state) throw new StateMismatchError()

      const accountAddress = params.get('accountAddress')
      if (!accountAddress) throw new Error('Missing accountAddress in callback.')

      const keyAuthorizationHex = params.get('keyAuthorization')
      if (!keyAuthorizationHex) throw new Error('Missing keyAuthorization in callback.')

      const keyAuthorization = KeyAuthorization.deserialize(keyAuthorizationHex as Hex.Hex)
      if (!keyAuthorization.signature)
        throw new Error('Key authorization in callback is missing a signature.')
      const signed = keyAuthorization as KeyAuthorization.Signed

      if (managedKey)
        await saveManagedKey(accountAddress as core_Address.Address, managedKey, signed)

      return {
        accountAddress: accountAddress as core_Address.Address,
        keyAuthorization: signed,
      }
    }

    return {
      actions: {
        async authorizeAccessKey(parameters) {
          const { accounts, activeAccount } = store.getState()
          const account = accounts[activeAccount]?.address
          const result = await authorize({
            ...(account ? { account } : {}),
            authorizeAccessKey: parameters,
            method: 'wallet_authorizeAccessKey',
          })

          if (!account)
            store.setState({
              accounts: [{ address: result.accountAddress }],
              activeAccount: 0,
            })

          return {
            keyAuthorization: KeyAuthorization.toRpc(result.keyAuthorization),
            rootAddress: result.accountAddress,
          }
        },
        async createAccount(params, request) {
          return this.loadAccounts(params, request)
        },
        async loadAccounts(parameters) {
          if (parameters?.digest)
            throw unsupported(
              '`wallet_connect` digest signing not supported by React Native adapter.',
            )

          const result = await authorize({
            authorizeAccessKey: parameters?.authorizeAccessKey,
            method: 'wallet_connect',
          })

          return {
            accounts: [
              {
                address: result.accountAddress,
                capabilities: {},
              },
            ],
            keyAuthorization: KeyAuthorization.toRpc(result.keyAuthorization),
          }
        },
        async revokeAccessKey() {
          throw unsupported('`wallet_revokeAccessKey` not supported by React Native adapter.')
        },
        async sendTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient(typeof feePayer === 'string' ? { feePayer } : {})
          const { account, prepared } = await withManagedAccessKey(
            async (account, keyAuthorization) => ({
              account,
              prepared: await prepareTransactionRequest(client, {
                account,
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
                ...(keyAuthorization ? { keyAuthorization } : {}),
                type: 'tempo',
              } as never),
            }),
          )
          const signed = await account.signTransaction(prepared as never)
          return await client.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient(typeof feePayer === 'string' ? { feePayer } : {})
          const { account, prepared } = await withManagedAccessKey(
            async (account, keyAuthorization) => ({
              account,
              prepared: await prepareTransactionRequest(client, {
                account,
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
                ...(keyAuthorization ? { keyAuthorization } : {}),
                type: 'tempo',
              } as never),
            }),
          )
          const signed = await account.signTransaction(prepared as never)
          return await client.request({
            method: 'eth_sendRawTransactionSync' as never,
            params: [signed],
          })
        },
        async signPersonalMessage({ address, data }) {
          await loadManagedKey(address)
          const account = getAccount({ address, signable: true })
          return await account.signMessage({ message: { raw: data } })
        },
        async signTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient(typeof feePayer === 'string' ? { feePayer } : {})
          const { account, prepared } = await withManagedAccessKey(
            async (account, keyAuthorization) => ({
              account,
              prepared: await prepareTransactionRequest(client, {
                account,
                ...rest,
                ...(feePayer ? { feePayer: true } : {}),
                ...(keyAuthorization ? { keyAuthorization } : {}),
                type: 'tempo',
              } as never),
            }),
          )
          return await account.signTransaction(prepared as never)
        },
        async signTypedData({ address, data }) {
          await loadManagedKey(address)
          const account = getAccount({ address, signable: true })
          return await account.signTypedData(JSON.parse(data) as never)
        },
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
    /** Secure storage adapter for persisting managed access keys. */
    secureStorage?: Storage.Storage | undefined
  }
}

declare namespace resolveManagedKey {
  type ReturnType = {
    account: TempoAccount.Account
    key: Hex.Hex
    keyAddress: core_Address.Address
    keyType: 'secp256k1' | 'p256'
    publicKey: Hex.Hex
  }
}

declare namespace loadManagedKey {
  type Options = {
    keyType?: 'secp256k1' | 'p256' | undefined
  }

  type ReturnType = resolveManagedKey.ReturnType & {
    expiry: number
    storedAuthorization: KeyAuthorization.Signed
  }
}

/** Entry shape persisted to secure storage for managed access keys. */
type ManagedKeyEntry = {
  chainId: number
  expiry: number
  key: Hex.Hex
  keyAddress: core_Address.Address
  keyAuthorization: Hex.Hex
  keyType: 'secp256k1' | 'p256'
  walletAddress: core_Address.Address
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
    expiry?: number | undefined
    keyType?: string | undefined
    limits?: readonly { token: string; limit: string }[] | undefined
    pubKey: Hex.Hex
    state: string
  },
): string {
  const url = new URL('/mobile-auth', host)
  url.searchParams.set('pubKey', params.pubKey)
  if (params.keyType) url.searchParams.set('keyType', params.keyType)
  url.searchParams.set('chainId', String(params.chainId))
  if (typeof params.expiry !== 'undefined') url.searchParams.set('expiry', String(params.expiry))
  if (params.limits) url.searchParams.set('limits', JSON.stringify(params.limits))
  url.searchParams.set('callback', params.callback)
  url.searchParams.set('state', params.state)
  return url.toString()
}

function managedKeyStorageKey(
  address: core_Address.Address,
  chainId: number,
  keyType?: string | undefined,
): string {
  return `managedKey.${address.toLowerCase()}.${chainId}${keyType ? `.${keyType}` : ''}`
}

function unsupported(message: string) {
  return new core_Provider.UnsupportedMethodError({ message })
}
