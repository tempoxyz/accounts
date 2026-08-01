import type { RequestListener } from 'node:http'
import { Address, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { Store, Wata, deviceCode } from 'wata/host'
import { Server } from 'wata/server'
import * as z from 'zod/mini'

import * as Rpc from '../src/core/zod/rpc.js'
import { accounts, chain } from './config.js'

const root = accounts[0]!

/**
 * In-process wata device-code host that answers approved requests by signing
 * with the localnet root account. Mirrors the wallet host contract: JSON GET
 * on `/verify` returns the pending record, JSON POST approves or denies.
 */
export function createDeviceCodeHost(options: createDeviceCodeHost.Options = {}) {
  const { path = '/auth/device', pollingInterval = 50 } = options
  const store = Store.memory()
  const requests: { method: string; params: unknown }[] = []

  async function handle(request: Request): Promise<Response> {
    // The response envelope is persisted by the host session's `onRequest`
    // dispatch, which `actions.approve` kicks off without awaiting — hold the
    // approve response until it lands so the record is settled before the
    // consumer's next poll.
    let settle: (() => void) | undefined
    const responded = new Promise<void>((resolve) => {
      settle = resolve
    })

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
              await actions.approve(userCode)
              await responded
              return Response.json({ status: 'approved' })
            },
            async render({ record, userCode }) {
              if (!record) return Response.json({ error: 'unknown_code' }, { status: 404 })
              return Response.json({
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
        if (event.method === 'wallet_connect') {
          const [parameters] =
            z.decode(Rpc.wallet_connect.schema.params!, event.params as never) ?? []
          const authorization = parameters?.capabilities?.authorizeAccessKey
          await event.respond({
            accounts: [
              {
                address: root.address,
                capabilities: authorization
                  ? {
                      keyAuthorization: KeyAuthorization.toRpc(
                        await signKeyAuthorization(authorization),
                      ),
                    }
                  : {},
              },
            ],
          })
          return
        }
        if (event.method === 'wallet_authorizeAccessKey') {
          const [parameters] = z.decode(
            Rpc.wallet_authorizeAccessKey.schema.params!,
            event.params as never,
          )
          await event.respond({
            keyAuthorization: KeyAuthorization.toRpc(await signKeyAuthorization(parameters)),
            rootAddress: root.address,
          })
          return
        }
        await event.reject({ code: -32601, message: `unsupported method \`${event.method}\`` })
      } finally {
        settle?.()
      }
    })

    return await wata.fetch(request)
  }

  return {
    fetch: handle,
    listener: Server.node({ fetch: handle }).listener as RequestListener,
    requests: () => requests,
  }
}

export declare namespace createDeviceCodeHost {
  type Options = {
    /** Mount path for the device-code routes. @default '/auth/device' */
    path?: string | undefined
    /** Advertised poll interval in milliseconds. @default 50 */
    pollingInterval?: number | undefined
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

async function signKeyAuthorization(
  parameters: NonNullable<Rpc.wallet_authorizeAccessKey.Decoded['params']>[number],
) {
  return await root.signKeyAuthorization(
    {
      accessKeyAddress: accessKeyAddress(parameters),
      keyType: parameters.keyType ?? 'p256',
    },
    {
      chainId: parameters.chainId ?? BigInt(chain.id),
      expiry: parameters.expiry,
      ...(parameters.limits ? { limits: parameters.limits } : {}),
    },
  )
}

function accessKeyAddress(
  parameters: NonNullable<Rpc.wallet_authorizeAccessKey.Decoded['params']>[number],
) {
  if (parameters.address) return parameters.address
  if (!parameters.publicKey)
    throw new Error('Expected access key address or public key in wallet request.')
  return Address.fromPublicKey(PublicKey.fromHex(parameters.publicKey))
}
