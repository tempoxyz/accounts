import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { Base64, Provider as core_Provider, RpcResponse } from 'ox'
import * as z from 'zod/mini'

import * as Adapter from '../core/Adapter.js'
import * as CliAuth from '../server/CliAuth.js'

/**
 * Creates a CLI bootstrap adapter backed by the device-code protocol.
 *
 * Only `wallet_connect` is supported in v1.
 */
export function cli(options: cli.Options): Adapter.Adapter {
  const { name = 'Tempo CLI', rdns = 'xyz.tempo.cli' } = options

  return Adapter.define({ name, rdns }, () => ({
    actions: {
      async createAccount() {
        throw unsupported('`wallet_connect` register flow not supported by CLI adapter.')
      },
      async loadAccounts(parameters) {
        const {
          serviceUrl,
          open = defaultOpen,
          pollIntervalMs = 2_000,
          timeoutMs = 5 * 60 * 1_000,
        } = options
        const authorizeAccessKey = parameters?.authorizeAccessKey

        if (!authorizeAccessKey?.publicKey)
          throw new RpcResponse.InvalidParamsError({
            message:
              '`wallet_connect` on the CLI adapter requires `capabilities.authorizeAccessKey.publicKey`.',
          })
        if (parameters?.digest)
          throw unsupported('`wallet_connect` digest signing not supported by CLI adapter.')

        const codeVerifier = createCodeVerifier()
        const codeChallenge = await createCodeChallenge(codeVerifier)
        const created = await post({
          body: {
            code_challenge: codeChallenge,
            expiry: authorizeAccessKey.expiry,
            key_type: authorizeAccessKey.keyType ?? 'secp256k1',
            ...(authorizeAccessKey.limits ? { limits: authorizeAccessKey.limits } : {}),
            pub_key: authorizeAccessKey.publicKey,
          } satisfies z.output<typeof CliAuth.createRequest>,
          request: CliAuth.createRequest,
          response: CliAuth.createResponse,
          url: getApiUrl(serviceUrl, 'device-code'),
        })
        const url = getBrowserUrl(serviceUrl, created.code)

        try {
          await open(url)
        } catch (error) {
          throw new OpenError(url, created.code, error)
        }

        const startedAt = Date.now()

        while (Date.now() - startedAt < timeoutMs) {
          const result = await post({
            body: {
              code_verifier: codeVerifier,
            } satisfies z.output<typeof CliAuth.pollRequest>,
            request: CliAuth.pollRequest,
            response: CliAuth.pollResponse,
            url: getApiUrl(serviceUrl, `poll/${created.code}`),
          })

          if (result.status === 'pending') {
            await sleep(pollIntervalMs)
            continue
          }
          if (result.status === 'expired')
            throw new Error('Device code expired before authorization completed.')

          return {
            accounts: [
              {
                address: result.account_address,
                capabilities: {},
              },
            ],
            keyAuthorization: z.encode(CliAuth.keyAuthorization, result.key_authorization),
          }
        }

        throw new TimeoutError(url, created.code)
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
  }))
}

export declare namespace cli {
  export type Options = {
    /** Browser page URL for the device-code flow. API calls are made under the same base path. */
    serviceUrl: string
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
  cause?: unknown | undefined
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

async function createCodeChallenge(codeVerifier: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true })
}

function createCodeVerifier() {
  return Base64.fromBytes(crypto.getRandomValues(new Uint8Array(32)), {
    pad: false,
    url: true,
  })
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
