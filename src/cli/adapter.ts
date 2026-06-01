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
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import * as z from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as AccessKeyTransaction from '../core/internal/AccessKeyTransaction.js'
import * as CliAuth from '../server/CliAuth.js'

/**
 * Creates a CLI bootstrap adapter backed by the device-code protocol.
 */
export function cli(options: cli.Options): Adapter.Adapter {
  const { name = 'Tempo CLI', rdns = 'xyz.tempo.cli' } = options

  return Adapter.define({ name, rdns }, ({ getAccount, getClient, store }) => {
    async function resolveManagedKey(
      options: {
        address?: Adapter.authorizeAccessKey.ReturnType['rootAddress'] | undefined
        keyType?: Adapter.authorizeAccessKey.Parameters['keyType'] | undefined
      } = {},
    ): Promise<resolveManagedKey.ReturnType> {
      const { address, keyType } = options

      const requestedKeyType = keyType === 'p256' || keyType === 'secp256k1' ? keyType : undefined
      if (address) {
        const { chainId } = store.getState()
        const entries = store.accessKeys.list({
          account: address,
          chainId,
        })
        for (const entry of entries) {
          if (requestedKeyType && entry.keyType !== requestedKeyType) continue
          if (entry.keyType !== 'p256' && entry.keyType !== 'secp256k1') continue
          const account = await store.accessKeys.get({
            accessKey: entry.address,
            account: address,
            chainId,
          })
          if (!account) continue
          return {
            account,
            existing: true,
            keyAddress: entry.address,
            keyType: entry.keyType,
            publicKey: account.publicKey,
          }
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
        existing: false,
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
      if (managedKey.existing) {
        await store.accessKeys.updateAuthorization({
          accessKey: managedKey.keyAddress,
          account: address,
          authorization: signed,
          chainId: Number(signed.chainId),
        })
        return
      }
      await store.accessKeys.add({
        account: address,
        authorization: signed,
        privateKey: managedKey.key!,
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
      return getAccount({ address, signable: true })
    }

    async function authorize(request: {
      account?: Adapter.authorizeAccessKey.ReturnType['rootAddress'] | undefined
      authorizeAccessKey: Adapter.authorizeAccessKey.Parameters | undefined
      method: 'wallet_authorizeAccessKey' | 'wallet_connect'
      showDeposit?: Adapter.createAccount.Parameters['showDeposit'] | undefined
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
        ...(request.showDeposit !== undefined ? { showDeposit: request.showDeposit } : {}),
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
            ...(parameters.showDeposit !== undefined
              ? { showDeposit: parameters.showDeposit }
              : {}),
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
        async createAccount(parameters) {
          if (parameters?.digest)
            throw unsupported('`wallet_connect` digest signing not supported by CLI adapter.')

          const result = await authorize({
            authorizeAccessKey: parameters?.authorizeAccessKey,
            method: 'wallet_connect',
            ...(parameters?.showDeposit !== undefined
              ? { showDeposit: parameters.showDeposit }
              : {}),
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
        async loadAccounts(parameters) {
          if (parameters?.digest)
            throw unsupported('`wallet_connect` digest signing not supported by CLI adapter.')

          const result = await authorize({
            authorizeAccessKey: parameters?.authorizeAccessKey,
            method: 'wallet_connect',
            ...(parameters?.showDeposit !== undefined
              ? { showDeposit: parameters.showDeposit }
              : {}),
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

export declare namespace cli {
  export type Options = {
    /** Host URL for the device-code flow. API calls are made under the same base path. */
    host: string
    /** Provider display name. @default "Tempo CLI" */
    name?: string | undefined
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
    existing: boolean
    key?: Hex.Hex | undefined
    keyAddress: Address.Address
    keyType: 'secp256k1' | 'p256'
    publicKey: Hex.Hex
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
