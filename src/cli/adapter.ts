import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  Address,
  Base64,
  Hash,
  Hex,
  P256,
  Provider as core_Provider,
  PublicKey,
  RpcResponse,
} from 'ox'
import { KeyAuthorization, Transaction as core_Transaction } from 'ox/tempo'
import { prepareTransactionRequest } from 'viem/actions'
import { Account as TempoAccount, Secp256k1, Transaction } from 'viem/tempo'
import * as z from 'zod/mini'

import * as AccessKey from '../core/AccessKey.js'
import * as Adapter from '../core/Adapter.js'
import { signTempoTransaction } from '../core/internal/signTempoTransaction.js'
import * as CliAuth from '../server/CliAuth.js'
import * as Keyring from './keyring.js'

/**
 * Creates a CLI bootstrap adapter backed by the device-code protocol.
 */
export function cli(options: cli.Options): Adapter.Adapter {
  const { name = 'Tempo CLI', rdns = 'xyz.tempo.cli' } = options

  return Adapter.define({ name, rdns }, ({ getAccount, getClient, store }) => {
    async function loadManagedKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      parameters: loadManagedKey.Options = {},
    ): Promise<Keyring.Entry | undefined> {
      const { keyType } = parameters
      const { chainId } = store.getState()
      const entry = await Keyring.find({
        chainId,
        ...(keyType ? { keyType } : {}),
        ...(options.keysPath ? { path: options.keysPath } : {}),
        walletAddress: address,
      })
      if (!entry) return

      const deserialized = KeyAuthorization.deserialize(entry.keyAuthorization)
      if (!deserialized.signature) throw new Error('Managed access key is missing a signature.')
      const keyAuthorization = deserialized as KeyAuthorization.Signed
      AccessKey.save({
        address,
        keyAuthorization,
        privateKey: entry.key,
        store,
      })

      return entry
    }

    async function resolveManagedKey(
      options: {
        address?: Adapter.authorizeAccessKey.ReturnType['rootAddress'] | undefined
        keyType?: Adapter.authorizeAccessKey.Parameters['keyType'] | undefined
      } = {},
    ): Promise<resolveManagedKey.ReturnType> {
      const { address, keyType } = options

      const requestedKeyType = keyType === 'p256' || keyType === 'secp256k1' ? keyType : undefined
      const entry = address
        ? await loadManagedKey(address, requestedKeyType ? { keyType: requestedKeyType } : {})
        : undefined
      if (entry) {
        const account =
          entry.keyType === 'p256'
            ? TempoAccount.fromP256(entry.key, { access: address })
            : TempoAccount.fromSecp256k1(entry.key, { access: address })
        return {
          account,
          key: entry.key,
          keyAddress: entry.keyAddress,
          keyType: entry.keyType,
          publicKey: account.publicKey,
        }
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
        keyAddress: Address.fromPublicKey(PublicKey.from(account.publicKey)),
        keyType: nextKeyType,
        publicKey: account.publicKey,
      }
    }

    async function saveManagedKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      managedKey: Awaited<ReturnType<typeof resolveManagedKey>>,
      keyAuthorization: z.output<typeof CliAuth.keyAuthorization>,
    ) {
      if (!managedKey) return

      const signed = KeyAuthorization.fromRpc(z.encode(CliAuth.keyAuthorization, keyAuthorization))
      AccessKey.save({
        address,
        keyAuthorization: signed,
        privateKey: managedKey.key,
        store,
      })

      await Keyring.upsert(
        {
          chainId: Number(keyAuthorization.chainId),
          expiry: keyAuthorization.expiry ?? 0,
          key: managedKey.key,
          keyAddress: managedKey.keyAddress,
          keyAuthorization: KeyAuthorization.serialize(signed),
          keyType: managedKey.keyType,
          ...(keyAuthorization.limits
            ? { limits: keyAuthorization.limits.map((limit) => ({ ...limit })) }
            : {}),
          walletAddress: address,
          walletType: 'passkey',
        },
        options.keysPath ? { path: options.keysPath } : {},
      )
    }

    async function withManagedAccessKey<result>(
      fn: (
        account: TempoAccount.Account,
        keyAuthorization?: KeyAuthorization.Signed | undefined,
      ) => Promise<result>,
    ) {
      const rootAddress = store.getState().accounts[store.getState().activeAccount]?.address
      if (rootAddress) await loadManagedKey(rootAddress)

      const account = getAccount({ signable: true })
      const keyAuthorization = AccessKey.getPending(account, { store })
      try {
        const result = await fn(account, keyAuthorization ?? undefined)
        AccessKey.removePending(account, { store })
        return result
      } catch (error) {
        AccessKey.remove(account, { store })
        throw error
      }
    }

    // When feePayer is a URL, we call `eth_fillTransaction` on the sponsor
    // directly instead of going through `prepareTransactionRequest`. This is
    // necessary because `prepareTransactionRequest` drops sponsor-injected
    // fields (like `feePayerSignature`) from the fill result.
    async function prepareSponsorableTransaction(
      parameters:
        | Adapter.sendTransaction.Parameters
        | Adapter.sendTransactionSync.Parameters
        | Adapter.signTransaction.Parameters,
    ) {
      const { feePayer, ...rest } = parameters
      const client = getClient()
      const prepared = await withManagedAccessKey(async (account, keyAuthorization) => ({
        account,
        prepared: await (async () => {
          if (typeof feePayer === 'string') {
            const result = (await getClient({ feePayer }).request({
              method: 'eth_fillTransaction' as never,
              params: [
                {
                  ...rest,
                  chainId: rest.chainId ?? client.chain.id,
                  feePayer: true,
                  from: account.address,
                  ...(keyAuthorization ? { keyAuthorization } : {}),
                  type: 'tempo',
                },
              ],
            })) as { tx: core_Transaction.Rpc }

            const tx = core_Transaction.fromRpc(result.tx)!
            return Transaction.deserialize(
              await Transaction.serialize(tx as Transaction.TransactionSerializable),
            )
          }

          return await prepareTransactionRequest(client, {
            account,
            ...rest,
            ...(feePayer ? { feePayer: true } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            type: 'tempo',
          } as never)
        })(),
      }))

      return {
        client,
        prepared: prepared.prepared,
        account: prepared.account,
      }
    }

    async function authorize(request: {
      account?: Adapter.authorizeAccessKey.ReturnType['rootAddress'] | undefined
      authorizeAccessKey: Adapter.authorizeAccessKey.Parameters | undefined
      method: 'wallet_authorizeAccessKey' | 'wallet_connect'
    }) {
      const {
        host,
        open = defaultOpen,
        pollIntervalMs = 2_000,
        timeoutMs = 5 * 60 * 1_000,
      } = options
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
              ? '`wallet_connect` on the CLI adapter requires `capabilities.authorizeAccessKey`.'
              : '`wallet_authorizeAccessKey` on the CLI adapter requires key parameters.',
        })

      const codeVerifier = createCodeVerifier()
      const codeChallenge = createCodeChallenge(codeVerifier)
      const body: z.output<typeof CliAuth.createRequest> = {
        ...(account ? { account } : {}),
        chainId: BigInt(store.getState().chainId),
        codeChallenge,
        ...(typeof authorizeAccessKey?.expiry !== 'undefined'
          ? { expiry: authorizeAccessKey.expiry }
          : {}),
        ...(keyType ? { keyType } : {}),
        ...(authorizeAccessKey?.limits ? { limits: authorizeAccessKey.limits } : {}),
        pubKey: publicKey,
      }
      const created = await post({
        body,
        request: CliAuth.createRequest,
        response: CliAuth.createResponse,
        url: getApiUrl(host, 'code'),
      })
      const url = getBrowserUrl(host, created.code)

      try {
        await open(url)
      } catch (error) {
        throw new OpenError(url, created.code, error)
      }

      const startedAt = Date.now()

      while (Date.now() - startedAt < timeoutMs) {
        const result = await post({
          body: {
            codeVerifier,
          } satisfies z.output<typeof CliAuth.pollRequest>,
          request: CliAuth.pollRequest,
          response: CliAuth.pollResponse,
          url: getApiUrl(host, `poll/${created.code}`),
        })

        if (result.status === 'pending') {
          await sleep(pollIntervalMs)
          continue
        }
        if (result.status === 'expired')
          throw new Error('Device code expired before authorization completed.')

        if (managedKey)
          await saveManagedKey(result.accountAddress, managedKey, result.keyAuthorization)

        return result
      }

      throw new TimeoutError(url, created.code)
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
            keyAuthorization: z.encode(CliAuth.keyAuthorization, result.keyAuthorization),
            rootAddress: result.accountAddress,
          }
        },
        async createAccount(params, request) {
          return this.loadAccounts(params, request)
        },
        async loadAccounts(parameters) {
          if (parameters?.digest)
            throw unsupported('`wallet_connect` digest signing not supported by CLI adapter.')

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
            keyAuthorization: z.encode(CliAuth.keyAuthorization, result.keyAuthorization),
          }
        },
        async revokeAccessKey() {
          throw unsupported('`wallet_revokeAccessKey` not supported by CLI adapter.')
        },
        async sendTransaction(parameters) {
          const { account, client, prepared } = await prepareSponsorableTransaction(parameters)
          const signed = await signTempoTransaction({ account, transaction: prepared })
          return await client.request({
            method: 'eth_sendRawTransaction' as never,
            params: [signed],
          })
        },
        async sendTransactionSync(parameters) {
          const { account, client, prepared } = await prepareSponsorableTransaction(parameters)
          const signed = await signTempoTransaction({ account, transaction: prepared })
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
          const { account, prepared } = await prepareSponsorableTransaction(parameters)
          return await signTempoTransaction({ account, transaction: prepared })
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

export declare namespace cli {
  export type Options = {
    /** Host URL for the device-code flow. API calls are made under the same base path. */
    host: string
    /** Provider display name. @default "Tempo CLI" */
    name?: string | undefined
    /** Path for managed CLI access keys. @default "~/.tempo/wallet/keys.toml" */
    keysPath?: string | undefined
    /** Browser opener override. */
    open?: ((url: string) => Promise<void> | void) | undefined
    /** Poll interval in milliseconds. @default 2000 */
    pollIntervalMs?: number | undefined
    /** Reverse-DNS provider identifier. @default "xyz.tempo.cli" */
    rdns?: string | undefined
    /** Poll timeout in milliseconds. @default 300000 */
    timeoutMs?: number | undefined
  }
}

declare namespace resolveManagedKey {
  type ReturnType = {
    account: TempoAccount.Account
    key: Hex.Hex
    keyAddress: Keyring.Entry['keyAddress']
    keyType: Keyring.Entry['keyType']
    publicKey: Hex.Hex
  }
}

declare namespace loadManagedKey {
  type Options = {
    keyType?: Keyring.Entry['keyType'] | undefined
  }
}

class OpenError extends Error {
  code: string
  override cause?: unknown | undefined
  url: string

  constructor(url: string, code: string, cause?: unknown) {
    super(`Failed to open browser for device code ${formatCode(code)}. Open ${url} manually.`)
    this.name = 'OpenError'
    this.code = code
    this.cause = cause
    this.url = url
  }
}

class TimeoutError extends Error {
  code: string
  url: string

  constructor(url: string, code: string) {
    super(`Timed out waiting for device code ${formatCode(code)}. Continue at ${url}.`)
    this.name = 'TimeoutError'
    this.code = code
    this.url = url
  }
}

function createCodeChallenge(codeVerifier: string) {
  return Base64.fromBytes(Hash.sha256(Hex.fromString(codeVerifier), { as: 'Bytes' }), {
    pad: false,
    url: true,
  })
}

function createCodeVerifier() {
  return Base64.fromBytes(Hex.toBytes(Hex.random(32)), { pad: false, url: true })
}

function formatCode(code: string) {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code
}

function defaultOpen(url: string) {
  const command =
    process.platform === 'darwin'
      ? { command: 'open', args: [url] }
      : process.platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'start', '', url] }
        : { command: 'xdg-open', args: [url] }

  const child = spawn(command.command, command.args, {
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
}

function getApiUrl(serviceUrl: string, path: string) {
  const url = new URL(serviceUrl)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
  url.search = ''
  return url.toString()
}

function getBrowserUrl(serviceUrl: string, code: string) {
  const url = new URL(serviceUrl)
  url.searchParams.set('code', code)
  return url.toString()
}

async function post<
  const request extends z.ZodMiniType,
  const response extends z.ZodMiniType,
>(options: {
  body: z.output<request>
  request: request
  response: response
  url: string
}): Promise<z.output<response>> {
  const result = await fetch(options.url, {
    body: JSON.stringify(z.encode(options.request, options.body)),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const json = (await result.json().catch(() => ({}))) as z.input<response>

  if (!result.ok) {
    const error = (json as { error?: unknown }).error
    throw new Error(typeof error === 'string' ? error : `Request failed: ${result.status}`)
  }

  return z.decode(options.response, json)
}

function unsupported(message: string) {
  return new core_Provider.UnsupportedMethodError({ message })
}
