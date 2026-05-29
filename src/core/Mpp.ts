import { Challenge } from 'mppx'
import { tempo as mppx_tempo } from 'mppx/client'
import { Charge, Session } from 'mppx/tempo'
import { Address, Hex, Provider, RpcResponse } from 'ox'
import { parseUnits, type Client } from 'viem'
import type { Account as ViemAccount } from 'viem/accounts'
import * as z from 'zod/mini'

import type * as AccessKey from './AccessKey.js'
import type * as Rpc from './zod/rpc.js'

/** Creates an MPP authorization for Tempo charge and session challenges. */
export async function authorize(options: authorize.Options): Promise<string> {
  const { account, challenges, defaultChainId, resolveSigner, session } = options
  const challenge = (() => {
    if (session) return challenges[0]
    return challenges.find((challenge) => challenge.intent === 'charge') ?? challenges[0]
  })()
  if (!challenge)
    throw new RpcResponse.InvalidParamsError({
      message: '`challenges` must include at least one challenge.',
    })

  const chainId = getChainId(challenge) ?? defaultChainId
  const client = createSigningClient(options.getClient({ chainId }))
  const { mode = 'push', polyfill: _polyfill, ...options_mpp } = options.options
  switch (challenge.intent) {
    case 'charge': {
      const filled = await Charge.fill(client, {
        autoSwap: options_mpp.autoSwap,
        challenge: challenge as Charge.ChargeChallenge,
        clientId: options_mpp.clientId,
        expectedRecipients: options_mpp.expectedRecipients,
        payer: account.address,
      })
      const signer = await resolveSigner({
        chainId: filled.chainId,
        // Proof credentials have no transaction calls, but should still use a locally
        // authorized access key when one is available.
        calls: filled.kind === 'calls' ? filled.calls : [],
      })
      return await Charge.createCredential(client, { filled, mode, signer })
    }

    case 'session': {
      const challenge_session = challenge as Session.SessionChallenge
      if (!session) {
        let signer = await resolveSigner({ chainId, keyType: 'secp256k1' })
        const fill = async () =>
          await Session.open.fill(client, {
            authorizedSigner: getSignerAddress(signer),
            challenge: challenge_session,
            deposit: (() => {
              const decimals = options_mpp.decimals ?? 6
              const suggestedDeposit = challenge_session.request.suggestedDeposit
                ? BigInt(challenge_session.request.suggestedDeposit)
                : undefined
              const maxDeposit =
                options_mpp.maxDeposit !== undefined
                  ? parseUnits(options_mpp.maxDeposit, decimals)
                  : undefined
              if (options_mpp.deposit !== undefined)
                return parseUnits(options_mpp.deposit, decimals)
              if (suggestedDeposit !== undefined && maxDeposit !== undefined)
                return suggestedDeposit < maxDeposit ? suggestedDeposit : maxDeposit
              if (maxDeposit !== undefined) return maxDeposit
              if (suggestedDeposit !== undefined) return suggestedDeposit
              throw new RpcResponse.InvalidParamsError({
                message:
                  'No session deposit amount available. Set `mpp.deposit`, `mpp.maxDeposit`, or use a challenge with `suggestedDeposit`.',
              })
            })(),
            escrowContract: options_mpp.escrowContract,
            payer: account.address,
          })
        let filled = await fill()
        const signer_open = await resolveSigner({
          calls: filled.calls,
          chainId: filled.chainId,
          keyType: 'secp256k1',
        })
        if (
          getSignerAddress(signer).toLowerCase() !== getSignerAddress(signer_open).toLowerCase()
        ) {
          signer = signer_open
          filled = await fill()
        }
        return await Session.open.createCredential(client, {
          filled,
          signer: signer_open,
          voucherSigner: signer,
        })
      }

      const signer = await resolveSigner({
        chainId,
        keyType: 'secp256k1',
        requiredSigner: session.authorizedSigner,
      })
      switch (session.action) {
        case 'voucher':
          return await Session.voucher.createCredential(client, {
            challenge: challenge_session,
            channelId: session.channelId,
            cumulativeAmount: BigInt(session.cumulativeAmount),
            signer,
          })
        case 'close':
          return await Session.close.createCredential(client, {
            challenge: challenge_session,
            channelId: session.channelId,
            cumulativeAmount: BigInt(session.cumulativeAmount),
            signer,
          })
        case 'topUp':
          throw new Provider.UnsupportedMethodError({
            message: '`mpp_authorize` session topUp is not supported yet.',
          })
      }
    }

    default:
      throw new RpcResponse.InvalidParamsError({
        message: `Unsupported Tempo challenge intent "${challenge.intent}".`,
      })
  }
}

function createSigningClient(client: Client): Client {
  const request = client.request
  return Object.assign(client, {
    async request(
      parameters: { method: string; params?: unknown },
      options?: Parameters<typeof request>[1],
    ) {
      const result = await request(parameters as never, options as never)
      if (parameters.method !== 'wallet_getCapabilities') return result
      if (!result || typeof result !== 'object') return result
      return Object.fromEntries(
        Object.entries(result).map(([chainId, capabilities]) => {
          if (!capabilities || typeof capabilities !== 'object') return [chainId, capabilities]
          const { mpp: _mpp, ...rest } = capabilities as { mpp?: unknown } & Record<string, unknown>
          return [chainId, rest]
        }),
      ) as never
    },
  }) as never
}

function getChainId(challenge: Challenge.Challenge) {
  const methodDetails = challenge.request.methodDetails as
    | { chainId?: number | undefined }
    | undefined
  return methodDetails?.chainId
}

function getSignerAddress(account: ViemAccount): Address.Address {
  if ('accessKeyAddress' in account && typeof account.accessKeyAddress === 'string')
    return account.accessKeyAddress as Address.Address
  return account.address
}

export declare namespace authorize {
  /** Options for {@link authorize}. */
  type Options = {
    /** Root payer account. */
    account: { address: Address.Address }
    /** Parsed Payment challenges from `mpp_authorize`. */
    challenges: readonly Challenge.Challenge[]
    /** Fallback chain ID when a challenge does not include one. */
    defaultChainId: number
    /** Returns a provider-backed client for the selected chain. */
    getClient: (options: { chainId: number }) => Client
    /** MPP integration options. */
    options: mpp.Options
    /** Resolves the concrete account used to sign the credential. */
    resolveSigner: (options?: {
      calls?:
        | readonly { to?: Address.Address | undefined; data?: Hex.Hex | undefined }[]
        | undefined
      chainId?: number | undefined
      keyType?: AccessKey.AccessKey['keyType'] | undefined
      requiredSigner?: Address.Address | undefined
    }) => Promise<ViemAccount>
    /** Session context for voucher, top-up, or close authorization. */
    session?: z.output<typeof Rpc.mpp_authorize.session> | undefined
  }
}

export declare namespace mpp {
  /** Options for Machine Payment Protocol (mppx) integration. */
  type Options = Omit<mppx_tempo.Parameters, 'account' | 'getClient'> & {
    /**
     * Whether to polyfill `globalThis.fetch` with the payment-aware wrapper.
     *
     * Defaults to `true` when `globalThis.fetch` is writable, and `false`
     * otherwise (e.g. Cloudflare Workers, where `globalThis.fetch` is
     * read-only).
     */
    polyfill?: boolean | undefined
  }
}
