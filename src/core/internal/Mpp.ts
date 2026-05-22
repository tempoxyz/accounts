import { Challenge as mpp_Challenge } from 'mppx'
import { Address, Hex, RpcResponse } from 'ox'
import { encodeFunctionData } from 'viem'
import { Abis, Actions } from 'viem/tempo'

import type * as Adapter from '../Adapter.js'

/** Parsed Machine Payment Protocol challenge. */
export type Challenge = mpp_Challenge.Challenge

/** Transaction call metadata used to match access-key scopes. */
export type Call = {
  /** Calldata for the target call. */
  data?: Hex.Hex | undefined
  /** Target contract address. */
  to?: Address.Address | undefined
}

/** Parses and validates an `mpp_authorize` request. */
export function parseAuthorization(
  parameters: Adapter.authorizeMpp.Parameters,
): parseAuthorization.ReturnType {
  const challenges = parameters.challenges.map(parseChallenge)
  for (const challenge of challenges) {
    if (challenge.method !== 'tempo')
      throw new RpcResponse.InvalidParamsError({
        message: 'Only Tempo payment challenges are supported.',
      })
  }

  if (parameters.session && challenges.length !== 1)
    throw new RpcResponse.InvalidParamsError({
      message: '`session` can only be used with one challenge.',
    })

  const challenge = challenges[0]!
  if (parameters.session && challenge.intent !== 'session')
    throw new RpcResponse.InvalidParamsError({
      message: '`session` can only be used with a session challenge.',
    })

  return { challenge, challenges }
}

export declare namespace parseAuthorization {
  /** Parsed and validated authorization request. */
  type ReturnType = {
    /** First parsed challenge. */
    challenge: Challenge
    /** All parsed challenges from the request. */
    challenges: readonly Challenge[]
  }
}

/** Parses a serialized MPP challenge. */
export function parseChallenge(value: string): Challenge {
  try {
    return mpp_Challenge.deserialize(value)
  } catch (error) {
    throw new RpcResponse.InvalidParamsError({
      message: error instanceof Error ? error.message : 'Invalid payment challenge.',
    })
  }
}

/** Creates the synthetic HTTP 402 response consumed by `mppx`. */
export function createResponse(challenges: readonly string[]): Response {
  return new Response(null, {
    headers: { 'WWW-Authenticate': challenges.join(', ') },
    status: 402,
  })
}

/** Builds additional credential context for a validated MPP challenge. */
export function getContext(
  parameters: Adapter.authorizeMpp.Parameters,
  challenge: Challenge,
): Record<string, unknown> {
  const { session } = parameters
  if (!session) return {}

  const details = getMethodDetails(challenge)
  const channelId = typeof details?.channelId === 'string' ? details.channelId : undefined
  if (channelId && channelId.toLowerCase() !== session.channelId.toLowerCase())
    throw new RpcResponse.InvalidParamsError({
      message: '`session.channelId` conflicts with the payment challenge.',
    })

  return {
    action: session.action,
    authorizedSigner: session.authorizedSigner,
    channelId: session.channelId,
    cumulativeAmountRaw: session.cumulativeAmount,
  }
}

/** Infers payment-related calls for access-key scope matching. */
export function getCalls(challenge: Challenge, options: getCalls.Options): getCalls.ReturnType {
  try {
    if (challenge.intent === 'charge') return getChargeCalls(challenge)
    if (challenge.intent === 'session') return getSessionCalls(challenge, options)
    return undefined
  } catch {
    return undefined
  }
}

export declare namespace getCalls {
  /** Options for {@link getCalls}. */
  type Options = {
    /** MPP adapter options. */
    mpp: Adapter.mpp.Options
  }

  /** Inferred calls, or `undefined` when the challenge cannot map to concrete calls. */
  type ReturnType = readonly Call[] | undefined
}

/** Gets the MPP challenge chain ID, falling back to the active chain. */
export function getChainId(challenge: Challenge, fallback: number): number {
  const details = getMethodDetails(challenge)
  return typeof details?.chainId === 'number' ? details.chainId : fallback
}

/** Extracts Tempo method details from an MPP challenge. */
export function getMethodDetails(challenge: Challenge): Record<string, unknown> | undefined {
  const value = challenge.request.methodDetails
  if (!value || typeof value !== 'object') return undefined
  return value as Record<string, unknown>
}

function getChargeCalls(challenge: Challenge) {
  const request = challenge.request as { amount?: unknown; currency?: unknown; recipient?: unknown }
  if (
    typeof request.amount !== 'string' ||
    typeof request.currency !== 'string' ||
    typeof request.recipient !== 'string'
  )
    return undefined

  const currency = Address.from(request.currency)
  const recipient = Address.from(request.recipient)
  return getTransfers({
    amount: request.amount,
    details: getMethodDetails(challenge),
    recipient,
  }).map((transfer) =>
    Actions.token.transfer.call({
      amount: BigInt(transfer.amount),
      ...(transfer.memo ? { memo: transfer.memo } : {}),
      to: transfer.recipient,
      token: currency,
    }),
  )
}

function getSessionCalls(challenge: Challenge, options: getCalls.Options) {
  const request = challenge.request as { currency?: unknown; recipient?: unknown }
  const details = getMethodDetails(challenge)
  const escrow = typeof details?.escrowContract === 'string' ? details.escrowContract : undefined
  const escrow_ = escrow ?? options.mpp.escrowContract
  if (
    typeof request.currency !== 'string' ||
    typeof request.recipient !== 'string' ||
    typeof escrow_ !== 'string'
  )
    return undefined

  const currency = Address.from(request.currency)
  const recipient = Address.from(request.recipient)
  const escrowContract = Address.from(escrow_)
  return [
    {
      to: currency,
      data: encodeFunctionData({
        abi: Abis.tip20,
        functionName: 'approve',
        args: [escrowContract, 0n],
      }),
    },
    {
      to: escrowContract,
      data: encodeFunctionData({
        abi: mppEscrowAbi,
        functionName: 'open',
        args: [recipient, currency, 0n, Hex.padLeft('0x00', 32), recipient],
      }),
    },
  ]
}

function getTransfers(options: {
  amount: string
  details?: Record<string, unknown> | undefined
  recipient: Address.Address
}) {
  const total = BigInt(options.amount)
  const splits = getSplits(options.details)
  const split_total = splits.reduce((sum, split) => sum + BigInt(split.amount), 0n)
  if (split_total >= total) return []

  const primary = total - split_total
  if (primary <= 0n) return []

  return [
    {
      amount: primary.toString(),
      ...(typeof options.details?.memo === 'string' && Hex.validate(options.details.memo)
        ? { memo: options.details.memo as Hex.Hex }
        : {}),
      recipient: options.recipient,
    },
    ...splits,
  ].map((transfer) => ({
    amount: transfer.amount,
    ...(typeof transfer.memo === 'string' && Hex.validate(transfer.memo)
      ? { memo: transfer.memo as Hex.Hex }
      : {}),
    recipient: transfer.recipient,
  }))
}

function getSplits(
  details?: Record<string, unknown> | undefined,
): readonly { amount: string; memo?: Hex.Hex | undefined; recipient: Address.Address }[] {
  if (!Array.isArray(details?.splits)) return []
  return details.splits.flatMap((split) => {
    if (!split || typeof split !== 'object') return []
    const value = split as { amount?: unknown; memo?: unknown; recipient?: unknown }
    if (typeof value.amount !== 'string' || typeof value.recipient !== 'string') return []
    return [
      {
        amount: value.amount,
        ...(typeof value.memo === 'string' && Hex.validate(value.memo)
          ? { memo: value.memo as Hex.Hex }
          : {}),
        recipient: Address.from(value.recipient),
      },
    ]
  })
}

const mppEscrowAbi = [
  {
    type: 'function',
    name: 'open',
    inputs: [
      { name: 'payee', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'deposit', type: 'uint128' },
      { name: 'salt', type: 'bytes32' },
      { name: 'authorizedSigner', type: 'address' },
    ],
    outputs: [{ name: 'channelId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
] as const
