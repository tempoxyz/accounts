import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Base64, Hash, Hex, Provider as core_Provider, RpcResponse } from 'ox'
import * as z from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as CliAuth from '../server/CliAuth.js'

/**
 * Creates a CLI bootstrap adapter backed by the device-code protocol.
 */
export function cli(options: cli.Options): Adapter.Adapter {
  const { name = 'Tempo CLI', rdns = 'xyz.tempo.cli' } = options

  return Adapter.define({ name, rdns }, ({ store }) => {
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

      if (!authorizeAccessKey?.publicKey)
        throw new RpcResponse.InvalidParamsError({
          message:
            method === 'wallet_connect'
              ? '`wallet_connect` on the CLI adapter requires `capabilities.authorizeAccessKey.publicKey`.'
              : '`wallet_authorizeAccessKey` on the CLI adapter requires `publicKey`.',
        })

      const codeVerifier = createCodeVerifier()
      const codeChallenge = createCodeChallenge(codeVerifier)
      const created = await post({
        body: {
          ...(account ? { account } : {}),
          chainId: BigInt(store.getState().chainId),
          codeChallenge,
          ...(typeof authorizeAccessKey.expiry !== 'undefined'
            ? { expiry: authorizeAccessKey.expiry }
            : {}),
          ...(authorizeAccessKey.keyType ? { keyType: authorizeAccessKey.keyType } : {}),
          ...(authorizeAccessKey.limits ? { limits: authorizeAccessKey.limits } : {}),
          pubKey: authorizeAccessKey.publicKey,
        } satisfies z.output<typeof CliAuth.createRequest>,
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
        async sendTransaction() {
          throw unsupported('`eth_sendTransaction` not supported by CLI adapter.')
        },
        async sendTransactionSync() {
          throw unsupported('`eth_sendTransactionSync` not supported by CLI adapter.')
        },
        async signPersonalMessage() {
          throw unsupported('`personal_sign` not supported by CLI adapter.')
        },
        async signTransaction() {
          throw unsupported('`eth_signTransaction` not supported by CLI adapter.')
        },
        async signTypedData() {
          throw unsupported('`eth_signTypedData_v4` not supported by CLI adapter.')
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
