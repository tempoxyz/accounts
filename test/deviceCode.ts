import type { RequestListener } from 'node:http'
import { Hex, RpcResponse } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'
import { tempo, tempoDevnet, tempoModerato } from 'viem/tempo/chains'
import { Store, Wata, deviceCode } from 'wata/host'
import { Server } from 'wata/server'
import * as z from 'zod/mini'

import { local as core_local } from '../src/core/adapters/local.js'
import * as core_Provider from '../src/core/Provider.js'
import * as core_Storage from '../src/core/Storage.js'
import * as Rpc from '../src/core/zod/rpc.js'
import { chain, privateKeys } from './config.js'

/**
 * In-process wata device-code host that answers approved requests by signing
 * with the localnet root account. Mirrors the wallet host contract: JSON GET
 * on `/verify` returns the pending record, JSON POST approves or denies.
 */
export function createDeviceCodeHost(options: createDeviceCodeHost.Options = {}) {
  const {
    omitVerificationUriFull = false,
    path = '/auth/device',
    pollingInterval = 50,
    privateKey = privateKeys[0],
    username,
  } = options
  const root = TempoAccount.fromSecp256k1(privateKey)
  const store = Store.memory()
  const metas: unknown[] = []
  const requests: { method: string; params: unknown }[] = []
  let providerOptions: createDeviceCodeHost.ProviderOptions = {}

  async function handle(request: Request): Promise<Response> {
    // The response envelope is persisted by the host session's `onRequest`
    // dispatch, which `actions.approve` kicks off without awaiting — hold the
    // approve response until it lands so the record is settled before the
    // consumer's next poll.
    let settle: (() => void) | undefined
    const responded = new Promise<void>((resolve) => {
      settle = resolve
    })

    // Results are computed before `approve` (mirroring the wallet worker,
    // where the browser supplies them) so the approved-but-unanswered window
    // stays sub-millisecond and fast pollers cannot observe it.
    const errors = new Map<string | number, RpcResponse.ErrorObject>()
    const results = new Map<string | number, unknown>()

    const wata = Wata.create({
      transports: [
        deviceCode({
          html: {
            async authenticate({ actions, request }) {
              const body = (await request.json()) as {
                action?: 'approve' | 'deny' | undefined
                user_code?: string | undefined
              }
              const userCode = String(body.user_code ?? '')
              const record = await actions.get(userCode)
              if (!record) return Response.json({ error: 'unknown_code' }, { status: 404 })
              if (body.action === 'deny') {
                await actions.deny(userCode)
                return Response.json({ status: 'denied' })
              }
              if (record.message.type === 'rpc-requests') {
                const provider = createProvider(root, providerOptions)
                for (const message of record.message.payload) {
                  if (typeof message !== 'object' || message === null || !('id' in message))
                    continue
                  try {
                    const result = await respondTo(provider, message, { account: root, username })
                    results.set(message.id, result ?? null)
                  } catch (error) {
                    const parsed = RpcResponse.parseError(error)
                    errors.set(message.id, {
                      code: parsed.code,
                      ...(parsed.data === undefined ? {} : { data: parsed.data }),
                      message: parsed.message,
                    })
                  }
                }
              }
              await actions.approve(userCode)
              await responded
              return Response.json({ status: 'approved' })
            },
            async render({ meta, record, userCode }) {
              if (!record) return Response.json({ error: 'unknown_code' }, { status: 404 })
              metas.push(meta)
              return Response.json({
                meta: meta ?? null,
                requests: record.message.payload,
                status: 'pending',
                user_code: userCode,
              })
            },
          },
          path,
          pollingInterval,
          store,
        }),
      ],
    })

    const session = wata.start()
    session.onRequest(async (event) => {
      requests.push({ method: event.method, params: event.params })
      try {
        if (errors.has(event.id)) await event.reject(errors.get(event.id)!)
        else if (results.has(event.id)) await event.respond(results.get(event.id))
        else await event.reject({ code: -32601, message: `unsupported method \`${event.method}\`` })
      } finally {
        settle?.()
      }
    })

    const response = await wata.fetch(request)
    if (!omitVerificationUriFull || !new URL(request.url).pathname.endsWith('/register'))
      return response

    const body = (await response.json()) as Record<string, unknown>
    delete body.verification_uri_complete
    return Response.json(body, { status: response.status })
  }

  return {
    setProviderOptions(options: createDeviceCodeHost.ProviderOptions) {
      providerOptions = options
    },
    fetch: handle,
    listener: Server.node({ fetch: handle }).listener as RequestListener,
    metas: () => metas,
    requests: () => requests,
  }
}

function createProvider(
  root: TempoAccount.RootAccount,
  options: createDeviceCodeHost.ProviderOptions,
) {
  const provider = core_Provider.create({
    adapter: core_local({
      createAccount: async () => ({ accounts: [root] }),
      loadAccounts: async () => ({ accounts: [root] }),
    }),
    chains: [chain, tempo, tempoModerato, tempoDevnet],
    ...options,
    storage: core_Storage.memory(),
  })
  provider.store.setState({ accounts: [root] })
  return provider
}

export declare namespace createDeviceCodeHost {
  type ProviderOptions = Pick<core_Provider.create.Options, 'feePayer' | 'identity'>

  type Options = {
    /** Omits the optional complete verification URI from registration responses. */
    omitVerificationUriFull?: boolean | undefined
    /** Mount path for the device-code routes. @default '/auth/device' */
    path?: string | undefined
    /** Advertised poll interval in milliseconds. @default 50 */
    pollingInterval?: number | undefined
    /** Private key used by the local wallet provider. */
    privateKey?: Hex.Hex | undefined
    /** Username capability returned by `wallet_connect`. */
    username?: string | null | undefined
  }
}

/** Approves or denies a pending device code through the verify endpoint. */
export async function submitVerify(
  prompt: { userCode: string; verificationUri: string },
  options: { action?: 'approve' | 'deny' | undefined } = {},
) {
  const response = await fetch(prompt.verificationUri, {
    body: JSON.stringify({ action: options.action ?? 'approve', user_code: prompt.userCode }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  if (!response.ok) throw new Error(`verify submit failed: ${response.status}`)
  return (await response.json()) as { status: 'approved' | 'denied' }
}

/** Produces the signed response for a queued request, before approval. */
async function respondTo(
  provider: core_Provider.Provider,
  message: {
    context?: { chainId?: number | undefined } | undefined
    method: string
    params?: unknown
  },
  options: {
    account: TempoAccount.RootAccount
    username?: string | null | undefined
  },
): Promise<unknown> {
  const chainId = message.context?.chainId
  if (chainId !== undefined && provider.store.getState().chainId !== chainId)
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: Hex.fromNumber(chainId) }],
    })

  const pendingUpdate = await replacePendingAccessKey(message, options.account)
  if (pendingUpdate) return pendingUpdate

  const request = toHostRequest(message)
  const result = await provider.request({
    method: message.method,
    ...(request.params === undefined ||
    (Array.isArray(request.params) && request.params.length === 0)
      ? {}
      : { params: request.params }),
  } as never)
  if (message.method !== 'wallet_connect' || options.username === undefined) return result

  const connect = result as Rpc.wallet_connect.Decoded['returns']
  return {
    ...connect,
    accounts: connect.accounts.map((account) => ({
      ...account,
      capabilities: { ...account.capabilities, username: options.username },
    })),
  }
}

async function replacePendingAccessKey(
  message: { method: string; params?: unknown },
  account: TempoAccount.RootAccount,
) {
  if (message.method !== 'wallet_updateAccessKey' || !Array.isArray(message.params))
    return undefined
  const raw = message.params[0]
  if (!raw || typeof raw !== 'object' || !('keyAuthorization' in raw)) return undefined

  // Pending updates use a wallet-only extension that the public Provider schema cannot decode yet.
  const parameters = z.decode(Rpc.wallet_updateAccessKey.parameters, raw as never)
  const current = KeyAuthorization.fromRpc(raw.keyAuthorization as KeyAuthorization.Rpc)
  const authorization = await account.signKeyAuthorization(
    {
      accessKeyAddress: parameters.accessKeyAddress,
      keyType: current.type,
    },
    {
      chainId: parameters.chainId ?? current.chainId,
      expiry: current.expiry,
      limits: parameters.limits,
      scopes: current.scopes,
    },
  )
  return { keyAuthorization: KeyAuthorization.toRpc(authorization) }
}

function toHostRequest(message: { method: string; params?: unknown }) {
  if (
    message.method !== 'wallet_connect' ||
    !Array.isArray(message.params) ||
    message.params.length === 0
  )
    return message
  const [parameters] = z.decode(Rpc.wallet_connect.schema.params!, message.params as never) ?? []
  const auth = parameters?.capabilities?.auth
  if (!auth || typeof auth === 'string' || !auth.verify) return message
  const { verify: _verify, ...authWithoutVerify } = auth
  return {
    ...message,
    params: [
      {
        ...parameters,
        capabilities: { ...parameters.capabilities, auth: authWithoutVerify },
      },
    ],
  }
}
