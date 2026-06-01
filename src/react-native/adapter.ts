import { Hex, P256, Provider as core_Provider, RpcResponse } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import { z } from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as AccessKeyRequests from '../core/internal/AccessKeyRequests.js'
import * as AccessKeyTransaction from '../core/internal/AccessKeyTransaction.js'
import * as Schema from '../core/Schema.js'
import * as Rpc from '../core/zod/rpc.js'
import { mobileWebAuth } from './mobileWebAuth.js'

/**
 * Creates a React Native adapter that authorizes access keys via the system browser.
 *
 * Authentication opens a browser session and completes via a redirect callback
 * that returns the signed key authorization.
 */
export function reactNative(options: reactNative.Options): Adapter.Adapter {
  const { name = 'Tempo Mobile', rdns = 'xyz.tempo.mobile' } = options

  return Adapter.define({ name, rdns }, ({ getAccount, getClient, store }) => {
    const transport = mobileWebAuth({
      callback: options.redirectUri,
      host: options.host,
      ...(options.id ? { id: options.id } : {}),
      ...(options.open ? { open: options.open } : {}),
    })

    const provider = core_Provider.from(
      {
        async request(request) {
          return await transport.request(request)
        },
      },
      { schema: Schema.ox },
    )

    async function prepareAccessKey(
      parameters: Adapter.authorizeAccessKey.Parameters | undefined,
    ): Promise<prepareAccessKey.ReturnType | undefined> {
      if (!parameters) return undefined

      const { keyType, privateKey, publicKey } = parameters
      const requestedKeyType = keyType === 'p256' || keyType === 'secp256k1' ? keyType : undefined
      if (privateKey) {
        if (keyType === 'webAuthn')
          throw new RpcResponse.InvalidParamsError({
            message: '`privateKey` cannot be used with `keyType: "webAuthn"`.',
          })
        const nextKeyType = requestedKeyType ?? 'secp256k1'
        const account =
          nextKeyType === 'p256'
            ? TempoAccount.fromP256(privateKey)
            : TempoAccount.fromSecp256k1(privateKey)
        const { privateKey: _privateKey, ...request } = parameters
        return {
          material: { privateKey },
          request: { ...request, publicKey: account.publicKey, keyType: nextKeyType },
        }
      }

      if (publicKey || parameters.address) return undefined

      if (keyType && !requestedKeyType)
        throw new RpcResponse.InvalidParamsError({
          message: `\`keyType: "${keyType}"\` requires externally generated key material; provide \`publicKey\` or \`address\`.`,
        })

      const nextKeyType = requestedKeyType === 'p256' ? 'p256' : 'secp256k1'
      const key = nextKeyType === 'p256' ? P256.randomPrivateKey() : Secp256k1.randomPrivateKey()
      const account =
        nextKeyType === 'p256' ? TempoAccount.fromP256(key) : TempoAccount.fromSecp256k1(key)

      return {
        material: { privateKey: key },
        request: { ...parameters, publicKey: account.publicKey, keyType: nextKeyType },
      }
    }

    async function saveAccessKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      keyAuthorization: KeyAuthorization.Rpc,
      accessKey: prepareAccessKey.ReturnType,
    ) {
      if (!accessKey.material) return
      await store.accessKeys.add({
        account: address,
        authorization: KeyAuthorization.fromRpc(keyAuthorization),
        ...accessKey.material,
      })
    }

    async function prepareManagedTransaction(
      client: ReturnType<typeof getClient>,
      parameters: AccessKeyTransaction.create.PrepareParameters,
      options: {
        calls?: AccessKeyTransaction.create.Options['calls'] | undefined
        chainId?: number | undefined
      } = {},
    ) {
      const state = store.getState()
      const address = parameters.from ?? state.accounts[state.activeAccount]?.address
      if (!address) throw new core_Provider.DisconnectedError({ message: 'No active account.' })
      const transaction = await AccessKeyTransaction.create({
        address,
        calls: options.calls,
        chainId: options.chainId ?? state.chainId,
        client,
        store,
      })
      if (!transaction)
        throw new core_Provider.UnauthorizedError({
          message: `Account "${address}" cannot sign with an access key.`,
        })
      return await transaction.prepare(parameters)
    }

    async function loadManagedAccount(address: Adapter.signPersonalMessage.Parameters['address']) {
      const account = await store.accessKeys.select({
        account: address,
        chainId: store.getState().chainId,
      })
      if (account) return account
      return getAccount({ address, signable: true })
    }

    return {
      actions: {
        async authorizeAccessKey(parameters, request) {
          const { accounts, activeAccount } = store.getState()
          const account = accounts[activeAccount]?.address
          const accessKey = await prepareAccessKey(parameters)

          const result = await provider.request({
            ...request,
            params: [
              z.encode(
                Rpc.wallet_authorizeAccessKey.parameters,
                accessKey ? accessKey.request : parameters,
              )!,
            ],
          })

          if (!account)
            store.setState({
              accounts: [{ address: result.rootAddress }],
              activeAccount: 0,
            })
          if (accessKey) await saveAccessKey(result.rootAddress, result.keyAuthorization, accessKey)

          return result
        },
        async createAccount(parameters, request) {
          if (parameters?.digest)
            throw unsupported(
              '`wallet_connect` digest signing not supported by React Native adapter.',
            )

          const accessKey = await prepareAccessKey(parameters?.authorizeAccessKey)

          const { accounts } = await provider.request(
            AccessKeyRequests.withAuthorizeAccessKey(request, accessKey?.request),
          )

          const address = accounts[0]?.address
          const capabilities = accounts[0]?.capabilities
          const keyAuthorization = capabilities?.keyAuthorization

          if (accessKey && address && keyAuthorization)
            await saveAccessKey(address, keyAuthorization, accessKey)

          return {
            accounts: accounts.map((a) => ({ address: a.address, capabilities: a.capabilities })),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
            ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
          }
        },
        async loadAccounts(parameters, request) {
          if (parameters?.digest)
            throw unsupported(
              '`wallet_connect` digest signing not supported by React Native adapter.',
            )

          const accessKey = await prepareAccessKey(parameters?.authorizeAccessKey)

          const { accounts } = await provider.request(
            AccessKeyRequests.withAuthorizeAccessKey(request, accessKey?.request),
          )

          const address = accounts[0]?.address
          const capabilities = accounts[0]?.capabilities
          const keyAuthorization = capabilities?.keyAuthorization

          if (accessKey && address && keyAuthorization)
            await saveAccessKey(address, keyAuthorization, accessKey)

          return {
            accounts: accounts.map((a) => ({ address: a.address, capabilities: a.capabilities })),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
            ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
          }
        },
        async revokeAccessKey() {
          throw unsupported('`wallet_revokeAccessKey` not supported by React Native adapter.')
        },
        async sendTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient(typeof feePayer === 'string' ? { feePayer } : {})
          const prepared = await prepareManagedTransaction(
            client,
            {
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
            },
            {
              calls: parameters.calls as AccessKeyTransaction.create.Options['calls'],
              chainId: parameters.chainId,
            },
          )
          return await prepared.send()
        },
        async sendTransactionSync(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient(typeof feePayer === 'string' ? { feePayer } : {})
          const prepared = await prepareManagedTransaction(
            client,
            {
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
            },
            {
              calls: parameters.calls as AccessKeyTransaction.create.Options['calls'],
              chainId: parameters.chainId,
            },
          )
          return await prepared.sendSync()
        },
        async signPersonalMessage({ address, data }) {
          const account = await loadManagedAccount(address)
          return await account.signMessage({ message: { raw: data } })
        },
        async signTransaction(parameters) {
          const { feePayer, ...rest } = parameters
          const client = getClient(typeof feePayer === 'string' ? { feePayer } : {})
          const prepared = await prepareManagedTransaction(
            client,
            {
              ...rest,
              ...(feePayer ? { feePayer: true } : {}),
            },
            {
              calls: parameters.calls as AccessKeyTransaction.create.Options['calls'],
              chainId: parameters.chainId,
            },
          )
          return await prepared.sign()
        },
        async signTypedData({ address, data }) {
          const account = await loadManagedAccount(address)
          return await account.signTypedData(JSON.parse(data) as never)
        },
      },
      generateAccessKey() {
        return undefined
      },
    }
  })
}

export declare namespace reactNative {
  export type Options = {
    /** Host URL for the mobile auth page. @default "https://wallet.tempo.xyz" */
    host: string
    /** Consumer identifier sent to the wallet mobile auth page. */
    id?: string | undefined
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

declare namespace prepareAccessKey {
  type ReturnType = {
    material?: { privateKey: Hex.Hex } | undefined
    request: Adapter.authorizeAccessKey.Parameters
  }
}

function unsupported(message: string) {
  return new core_Provider.UnsupportedMethodError({ message })
}
