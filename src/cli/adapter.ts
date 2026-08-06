import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Base64, Hash, Hex, Provider as core_Provider, RpcResponse } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import * as z from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as Keystore from '../core/Keystore.js'
import * as CliAuth from '../server/CliAuth.js'

/**
 * Creates a CLI bootstrap adapter backed by the device code protocol.
 */
export function cli(options: cli.Options): Adapter.Adapter {
  const { name = 'Tempo CLI', rdns = 'xyz.tempo.cli' } = options

  return Adapter.define({ name, rdns }, ({ getClient, store }) => {
    // The CLI persists to string-based filesystem storage, so its p256
    // default opts into an extractable WebCrypto key (a non-extractable one
    // could not survive a restart). secp256k1 stays available for explicit
    // requests. Shared between the device code ceremony and the instance
    // declaration so records hydrate through the same keystores.
    const keystores = {
      p256: Keystore.webCryptoP256({ extractable: true }),
      secp256k1: Keystore.secp256k1(),
    }

    async function saveGeneratedAccessKey(
      address: Adapter.authorizeAccessKey.ReturnType['rootAddress'],
      accessKey: Awaited<ReturnType<Keystore.Keystore['createKey']>>,
      keyAuthorization: z.output<typeof CliAuth.keyAuthorization>,
    ) {
      const signed = KeyAuthorization.fromRpc(z.encode(CliAuth.keyAuthorization, keyAuthorization))
      store.accessKeys.add({
        account: address,
        authorization: signed,
        handle: accessKey.handle,
        publicKey: accessKey.publicKey,
      })
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

      // p256 by default; secp256k1 only when explicitly requested.
      const generatedKeyType = authorizeAccessKey?.keyType === 'secp256k1' ? 'secp256k1' : 'p256'
      const generatedAccessKey =
        authorizeAccessKey && !authorizeAccessKey.publicKey && !authorizeAccessKey.address
          ? await keystores[generatedKeyType].createKey()
          : undefined

      const publicKey = authorizeAccessKey?.publicKey ?? generatedAccessKey?.publicKey
      const keyType =
        authorizeAccessKey?.keyType ?? (generatedAccessKey ? generatedKeyType : undefined)

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
        if (result.action === 'updateAccessKey')
          throw new Error('Device code action does not match the authorization request.')

        if (generatedAccessKey)
          await saveGeneratedAccessKey(
            result.accountAddress,
            generatedAccessKey,
            result.keyAuthorization,
          )

        return result
      }

      throw new TimeoutError(url, created.code)
    }

    async function update(parameters: Adapter.updateAccessKey.Parameters) {
      const {
        host,
        open = defaultOpen,
        pollIntervalMs = 2_000,
        timeoutMs = 5 * 60 * 1_000,
      } = options
      const chainId = Number(parameters.chainId ?? store.getState().chainId)
      const current = store.accessKeys.list({
        accessKey: parameters.accessKeyAddress,
        account: parameters.address,
        chainId,
      })[0]
      const status = current?.keyAuthorization
        ? await store.accessKeys.getStatus({
            accessKey: parameters.accessKeyAddress,
            account: parameters.address,
            chainId,
            client: getClient({ chainId }),
          })
        : undefined
      const pendingKeyAuthorization =
        status === 'pending' && current?.keyAuthorization
          ? KeyAuthorization.toRpc(current.keyAuthorization)
          : undefined
      const codeVerifier = createCodeVerifier()
      const body = {
        action: 'updateAccessKey',
        accessKeyAddress: parameters.accessKeyAddress,
        account: parameters.address,
        chainId: BigInt(chainId),
        codeChallenge: createCodeChallenge(codeVerifier),
        ...(pendingKeyAuthorization
          ? {
              keyAuthorization: z.decode(CliAuth.keyAuthorization, {
                ...pendingKeyAuthorization,
                address: pendingKeyAuthorization.keyId,
              }),
            }
          : {}),
        limits: parameters.limits,
      } satisfies z.output<typeof CliAuth.createRequest>
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
          body: { codeVerifier },
          request: CliAuth.pollRequest,
          response: CliAuth.pollResponse,
          url: getApiUrl(host, `poll/${created.code}`),
        })
        if (result.status === 'pending') {
          await sleep(pollIntervalMs)
          continue
        }
        if (result.status === 'expired')
          throw new Error('Device code expired before access key update completed.')
        if (result.action !== 'updateAccessKey')
          throw new Error('Device code action does not match the access key update request.')
        if (result.keyAuthorization) {
          store.accessKeys.updateAuthorization({
            accessKey: parameters.accessKeyAddress,
            account: parameters.address,
            authorization: KeyAuthorization.fromRpc(
              z.encode(CliAuth.keyAuthorization, result.keyAuthorization),
            ),
            chainId,
          })
        }
        return
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
        async updateAccessKey(parameters) {
          await update(parameters)
        },
      },
      async getAccount(options = {}) {
        const { accounts, activeAccount, chainId } = store.getState()
        const address = options.address ?? accounts[activeAccount]?.address
        if (!address) throw new core_Provider.DisconnectedError({ message: 'No active account.' })
        const account = await store.accessKeys.select({ account: address, chainId })
        if (!account)
          throw new core_Provider.UnauthorizedError({
            message: `Account "${address}" cannot sign with an access key.`,
          })
        return { account }
      },
      accessKey: { keystores },
    }
  })
}

export declare namespace cli {
  export type Options = {
    /** Host URL for the device code flow. API calls are made under the same base path. */
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
