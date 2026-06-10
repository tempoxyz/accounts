import { Hex, RpcResponse, Signature } from 'ox'
import { MultisigConfig, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import type { Address, Client } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { Transaction } from 'viem/tempo'

import * as Sponsorship from './sponsorship.js'
import * as Utils from './utils.js'

/** Default submission-claim TTL in milliseconds. */
export const defaultClaimTtl = 30_000

/** Returns whether a raw transaction carries a native multisig signature. */
export function isMultisigTransaction(serialized: Hex.Hex) {
  if (!Utils.isSerializedTempoTransaction(serialized)) return false
  try {
    const transaction = Transaction.deserialize(serialized as never)
    return isMultisigSignature((transaction as { signature?: unknown }).signature)
  } catch {
    return false
  }
}

/** Handles a native multisig raw transaction submission. */
export async function handleRawTransaction(
  options: handleRawTransaction.Options,
): Promise<handleRawTransaction.ReturnType> {
  const result = await collect(options)
  if (result.status.status === 'pending' || result.status.status === 'submitting')
    return result.status.operation.id
  if (result.status.status === 'submitted')
    return result.status.operation.submittedHash ?? result.status.operation.id
  if (options.method === 'eth_sendRawTransactionSync') return result.broadcastResult
  return result.status.operation.submittedHash!
}

export declare namespace handleRawTransaction {
  /** Options for handling a raw multisig transaction submission. */
  type Options = collect.Options

  /** Raw transaction handler return value. */
  type ReturnType = Hex.Hex | unknown
}

async function collect(options: collect.Options): Promise<collect.ReturnType> {
  const {
    claimTtl = defaultClaimTtl,
    finalize = 'sync',
    getClient,
    method,
    request,
    resolveConfig,
    sponsor,
    store,
  } = options
  const serialized = request.params?.[0]
  if (!Utils.isSerializedTempoTransaction(serialized))
    throw new RpcResponse.InvalidParamsError({
      message: 'Only Tempo (0x76/0x78) transactions are supported.',
    })

  const input = parse(serialized)
  const pending = await store.get(input.id)
  const config = await resolveValidatedConfig({
    account: input.account,
    chainId: input.chainId,
    genesisConfigId: input.genesisConfigId,
    init: input.init,
    pending,
    resolveConfig,
  })
  if (!config)
    throw new RpcResponse.InvalidParamsError({
      message:
        'Multisig config is required to collect approvals. Provide it in the bootstrap transaction or configure `multisig.resolveConfig`.',
    })

  const now = Date.now()
  let operation: Operation = {
    account: input.account,
    chainId: input.chainId,
    claimExpiresAt: pending?.claimExpiresAt,
    config,
    createdAt: pending?.createdAt ?? now,
    genesisConfigId: input.genesisConfigId,
    id: input.id,
    init: pending?.init ?? !!input.init,
    payload: input.payload,
    signatures: mergeSignatures([...(pending?.signatures ?? []), ...input.signatures]),
    status: pending?.status === 'submitted' ? 'submitted' : 'pending',
    submittedHash: pending?.submittedHash,
    transaction: serialized as Hex.Hex,
    updatedAt: now,
  }

  let approvals = getApprovals({
    account: input.account,
    config,
    genesisConfigId: input.genesisConfigId,
    payload: input.payload,
    signatures: operation.signatures,
  })
  if (operation.status === 'submitted')
    return {
      broadcastResult: operation.submittedHash,
      status: { operation, status: 'submitted' },
    }

  if (approvals.weight < approvals.threshold) {
    operation = await store.savePending(operation)
    approvals = getApprovals({
      account: operation.account,
      config,
      genesisConfigId: operation.genesisConfigId,
      payload: operation.payload,
      signatures: operation.signatures,
    })
    if (approvals.weight < approvals.threshold)
      return { status: { operation, status: operation.status } }
  }

  const claim = await store.claimSubmission(operation, { ttl: claimTtl })
  if (claim.status !== 'claimed') return { status: claim }

  operation = claim.operation
  approvals = getApprovals({
    account: operation.account,
    config,
    genesisConfigId: operation.genesisConfigId,
    payload: operation.payload,
    signatures: operation.signatures,
  })
  const client = getClient(operation.chainId)
  const final = await serializeFinal({
    account: operation.account,
    config,
    genesisConfigId: operation.genesisConfigId,
    init: operation.init,
    signatures: approvals.signatures,
    transaction: input.transaction,
  })
  const broadcastMethod =
    method === 'eth_sendRawTransaction' && finalize === 'sync'
      ? 'eth_sendRawTransactionSync'
      : method
  const feePayerState = (() => {
    try {
      const transaction = Transaction.deserialize(final as never) as Record<string, unknown>
      // No fee-payer field means finalized transaction does not request sponsorship.
      if (!('feePayerSignature' in transaction)) return {}
      // Preserve fee-token/signature marker for sponsorship decision below.
      return {
        feeToken:
          typeof transaction.feeToken === 'string' ? (transaction.feeToken as Address) : undefined,
        signature: transaction.feePayerSignature,
      }
    } catch {
      // Decode failure falls back to direct broadcast.
      return {}
    }
  })()
  const sponsorFeeToken = await (async () => {
    // No sponsor configured, so finalized multisig transaction broadcasts as-is.
    if (!sponsor) return undefined
    // Explicit relay fee token wins over transaction-derived fee-token state.
    if (sponsor.feeToken) return sponsor.feeToken
    // `null` requests relay-added fee-payer signature.
    if (feePayerState.signature === null) return await sponsor.resolveFeeToken?.(operation.chainId)
    // Pre-sponsored transaction without fee token can use relay default fee token.
    if (feePayerState.signature != null && !feePayerState.feeToken)
      return await sponsor.resolveFeeToken?.(operation.chainId)
    // Otherwise, sponsorship path has no fee token to add.
    return undefined
  })()
  const shouldSponsor = (() => {
    // No sponsor configured, so no sponsorship path to take.
    if (!sponsor) return false
    // `null` requests relay-added fee-payer signature.
    if (feePayerState.signature === null) return true
    // Missing fee-payer state means plain multisig transaction.
    if (feePayerState.signature == null) return false
    // Explicit relay fee token means relay should sponsor with that token.
    if (sponsor.feeToken) return true
    // Pre-sponsored transaction without fee token can complete if one was resolved.
    if (!feePayerState.feeToken && sponsorFeeToken) return true
    // Otherwise, keep finalized transaction unchanged and broadcast directly.
    return false
  })()
  const result = await (async () => {
    // Sponsorship enabled, so sponsor adds/signs fee-payer fields.
    if (shouldSponsor && sponsor)
      return await Sponsorship.handleRawTransaction({
        account: sponsor.account,
        feeToken: sponsorFeeToken,
        getClient,
        method: broadcastMethod,
        request: { params: [final] },
        resolveFeeToken: sponsor.resolveFeeToken,
        sender: operation.account,
        validate: sponsor.validate,
      })
    // Otherwise, multisig transaction is final and can broadcast directly.
    return await client.request({
      method: broadcastMethod,
      params: [final],
    } as never)
  })()
  const submittedHash = (() => {
    if (typeof result === 'string') return result as Hex.Hex
    if (result && typeof result === 'object' && 'transactionHash' in result) {
      const response = result as { transactionHash?: unknown }
      if (typeof response.transactionHash === 'string') return response.transactionHash as Hex.Hex
    }
    throw new Error('Expected transaction hash in multisig broadcast result.')
  })()
  const submitted = await store.setSubmitted(operation.id, submittedHash)

  return {
    broadcastResult: result,
    status: { operation: submitted, status: 'claimed' },
  }
}

/** Resolves a multisig operation id for standard transaction lookup methods. */
export async function handleGetTransaction(
  options: handleGetTransaction.Options,
): Promise<handleGetTransaction.ReturnType> {
  const id = options.request.params?.[0]
  if (typeof id !== 'string') return undefined

  const operation = await options.store.get(id as Hex.Hex)
  if (!operation) return undefined
  if (operation.status !== 'submitted' || !operation.submittedHash) return { result: null }

  const result = await options.getClient(operation.chainId).request({
    method: options.method,
    params: [operation.submittedHash],
  } as never)
  return { result }
}

export declare namespace handleGetTransaction {
  /** Options for resolving a multisig operation id through transaction lookup methods. */
  type Options = {
    /** Client resolver keyed by transaction `chainId`. */
    getClient: (chainId?: number | undefined) => Client
    /** Standard transaction lookup method to handle. */
    method: 'eth_getTransactionByHash' | 'eth_getTransactionReceipt'
    /** Incoming JSON-RPC request. */
    request: { params?: readonly unknown[] | undefined }
    /** Pending multisig operation store. */
    store: Store
  }

  /** Transaction lookup result wrapper. */
  type ReturnType = { result: unknown } | undefined
}

declare namespace collect {
  type Options = {
    /** Submission claim TTL in milliseconds. @default 30000 */
    claimTtl?: number | undefined
    /** How to broadcast once quorum is met. @default 'sync' */
    finalize?: 'submitted' | 'sync' | undefined
    /** Client resolver keyed by transaction `chainId`. */
    getClient: (chainId?: number | undefined) => Client
    /** Raw transaction method to handle. */
    method: 'eth_sendRawTransaction' | 'eth_sendRawTransactionSync'
    /** Incoming JSON-RPC request. */
    request: { params?: readonly unknown[] | undefined }
    /** Resolves the genesis multisig config for quorum checks. */
    resolveConfig?: ResolveConfig | undefined
    /** Optional fee payer used to sponsor finalized multisig transactions. */
    sponsor?: Sponsor | undefined
    /** Pending multisig operation store. */
    store: Store
  }

  type ReturnType = {
    /** Raw broadcast result once quorum is met and this caller claimed submission. */
    broadcastResult?: unknown
    /** Structured operation claim status. */
    status: ClaimSubmissionResult | { operation: Operation; status: 'claimed' }
  }
}

/** Returns a stored native multisig operation status. */
export async function getStatus(options: getStatus.Options): Promise<Status | null> {
  const operation = await options.store.get(options.id)
  if (!operation) return null
  const config = await resolveValidatedConfig({
    account: operation.account,
    chainId: operation.chainId,
    genesisConfigId: operation.genesisConfigId,
    pending: operation,
    resolveConfig: options.resolveConfig,
  })
  if (!config)
    return {
      account: operation.account,
      chainId: operation.chainId,
      genesisConfigId: operation.genesisConfigId,
      id: operation.id,
      signatures: operation.signatures.length,
      status: operation.status,
      submittedHash: operation.submittedHash,
    }
  const approvals = getApprovals({
    account: operation.account,
    config,
    genesisConfigId: operation.genesisConfigId,
    payload: operation.payload,
    signatures: operation.signatures,
  })
  return toStatus({ approvals, operation })
}

export declare namespace getStatus {
  /** Options for reading one multisig operation status. */
  type Options = {
    /** Operation id returned by a pending multisig submission. */
    id: Hex.Hex
    /** Resolves the genesis multisig config for quorum status. */
    resolveConfig?: ResolveConfig | undefined
    /** Pending multisig operation store. */
    store: Store
  }
}

/** Returns pending native multisig operation statuses for an account. */
export async function listStatuses(options: listStatuses.Options): Promise<readonly Status[]> {
  const operations = await options.store.listPendingByAddress(options.account)
  return await Promise.all(
    operations.map(async (operation) => {
      const config = await resolveValidatedConfig({
        account: operation.account,
        chainId: operation.chainId,
        genesisConfigId: operation.genesisConfigId,
        pending: operation,
        resolveConfig: options.resolveConfig,
      })
      if (!config)
        return {
          account: operation.account,
          chainId: operation.chainId,
          genesisConfigId: operation.genesisConfigId,
          id: operation.id,
          signatures: operation.signatures.length,
          status: operation.status,
          submittedHash: operation.submittedHash,
        }
      const approvals = getApprovals({
        account: operation.account,
        config,
        genesisConfigId: operation.genesisConfigId,
        payload: operation.payload,
        signatures: operation.signatures,
      })
      return toStatus({ approvals, operation })
    }),
  )
}

export declare namespace listStatuses {
  /** Options for listing multisig operation statuses. */
  type Options = {
    /** Native multisig account address. */
    account: Address
    /** Resolves the genesis multisig config for quorum status. */
    resolveConfig?: ResolveConfig | undefined
    /** Pending multisig operation store. */
    store: Store
  }
}

/** Creates an in-memory multisig operation store for development and tests only. */
export function memoryStore(): Store {
  const operations = new Map<string, Operation>()
  return {
    async claimSubmission(operation, options) {
      const now = Date.now()
      const existing = operations.get(operation.id)
      if (existing?.status === 'submitted') return { operation: existing, status: 'submitted' }
      if (existing?.status === 'submitting' && (existing.claimExpiresAt ?? 0) > now)
        return { operation: existing, status: 'submitting' }
      const claimed = mergeOperation(existing, operation, {
        claimExpiresAt: now + options.ttl,
        status: 'submitting',
        updatedAt: now,
      })
      operations.set(operation.id, claimed)
      return { operation: claimed, status: 'claimed' }
    },
    async get(id) {
      return operations.get(id)
    },
    async listPendingByAddress(address) {
      return [...operations.values()].filter(
        (operation) =>
          operation.account.toLowerCase() === address.toLowerCase() &&
          operation.status !== 'submitted',
      )
    },
    async savePending(operation) {
      const now = Date.now()
      const existing = operations.get(operation.id)
      if (existing?.status === 'submitted') return existing
      const pending = mergeOperation(existing, operation, {
        status:
          existing?.status === 'submitting' && (existing.claimExpiresAt ?? 0) > now
            ? 'submitting'
            : 'pending',
        updatedAt: now,
      })
      operations.set(operation.id, pending)
      return pending
    },
    async setSubmitted(id, submittedHash) {
      const existing = operations.get(id)
      if (!existing) throw new Error('Cannot mark an unknown multisig operation submitted.')
      const submitted = {
        ...existing,
        claimExpiresAt: undefined,
        status: 'submitted',
        submittedHash,
        updatedAt: Date.now(),
      } satisfies Operation
      operations.set(id, submitted)
      return submitted
    },
  }
}

/** Native multisig relay options. */
export type Options = {
  /** Submission claim TTL in milliseconds. @default 30000 */
  claimTtl?: number | undefined
  /** How to broadcast once quorum is met. @default 'sync' */
  finalize?: 'submitted' | 'sync' | undefined
  /** Resolves the genesis multisig config for quorum checks. */
  resolveConfig?: ResolveConfig | undefined
  /** Pending multisig operation store. */
  store: Store
}

/** Resolves the genesis multisig config for quorum checks. */
export type ResolveConfig = (request: {
  /** Native multisig account address. */
  account: Address
  /** Transaction chain id. */
  chainId: number
  /** Permanent genesis config id. */
  genesisConfigId: Hex.Hex
  /** Bootstrap config carried by the transaction, when present. */
  init?: MultisigConfig.Config | undefined
}) => MultisigConfig.Config | Promise<MultisigConfig.Config | undefined> | undefined

/** Optional fee payer used to sponsor finalized multisig transactions. */
export type Sponsor = {
  /** Account used as the fee payer. */
  account: LocalAccount
  /** Fee token to set before fee payer signing. */
  feeToken?: Address | undefined
  /** Resolves the default fee token for raw sponsorship. */
  resolveFeeToken?:
    | ((chainId: number) => Address | Promise<Address | undefined> | undefined)
    | undefined
  /** Optional sponsorship approval callback. */
  validate?: Sponsorship.handleRawTransaction.Options['validate']
}

/** Storage for native multisig operation approvals and submission claims. */
export type Store = {
  /** Atomically claims submission for a quorum-ready operation. Only a `claimed` result may broadcast. */
  claimSubmission: (
    operation: Operation,
    options: claimSubmission.Options,
  ) => Promise<ClaimSubmissionResult>
  /** Reads a stored operation. */
  get: (id: Hex.Hex) => Promise<Operation | undefined>
  /** Lists non-submitted operations for a native multisig account address. */
  listPendingByAddress: (address: Address) => Promise<readonly Operation[]>
  /** Saves a pending operation, preserving already-stored approvals. */
  savePending: (operation: Operation) => Promise<Operation>
  /** Marks a claimed operation submitted with its real transaction hash. */
  setSubmitted: (id: Hex.Hex, submittedHash: Hex.Hex) => Promise<Operation>
}

/** `Store.claimSubmission` types. */
export declare namespace claimSubmission {
  /** Options for claiming submission. */
  type Options = {
    /** Claim TTL in milliseconds. */
    ttl: number
  }
}

/** Result of atomically claiming a multisig operation for submission. */
export type ClaimSubmissionResult =
  | {
      /** Operation this caller may broadcast. */
      operation: Operation
      /** Claim status. */
      status: 'claimed'
    }
  | {
      /** Current stored operation. */
      operation: Operation
      /** Current non-claimed status. */
      status: 'pending' | 'submitting' | 'submitted'
    }

/** Stored native multisig operation. */
export type Operation = {
  /** Native multisig account address. */
  account: Address
  /** Transaction chain id. */
  chainId: number
  /** Submission claim expiry timestamp in milliseconds. */
  claimExpiresAt?: number | undefined
  /** Resolved genesis config used for approval checks. */
  config?: MultisigConfig.Config | undefined
  /** Creation timestamp in milliseconds. */
  createdAt: number
  /** Permanent genesis config id. */
  genesisConfigId: Hex.Hex
  /** Deterministic operation id. */
  id: Hex.Hex
  /** Whether the finalized transaction must carry the genesis init config. */
  init?: boolean | undefined
  /** Unsigned Tempo transaction sign payload. */
  payload: Hex.Hex
  /** Collected owner approval signatures. */
  signatures: readonly Hex.Hex[]
  /** Operation state. */
  status: 'pending' | 'submitting' | 'submitted'
  /** Transaction hash once submitted. */
  submittedHash?: Hex.Hex | undefined
  /** Last submitted serialized transaction carrying this operation. */
  transaction: Hex.Hex
  /** Last update timestamp in milliseconds. */
  updatedAt: number
}

/** Native multisig operation status. */
export type Status = {
  /** Native multisig account address. */
  account: Address
  /** Transaction chain id. */
  chainId: number
  /** Permanent genesis config id. */
  genesisConfigId: Hex.Hex
  /** Deterministic operation id. */
  id: Hex.Hex
  /** Number of collected owner approvals. */
  signatures: number
  /** Operation state. */
  status: Operation['status']
  /** Submitted transaction hash. */
  submittedHash?: Hex.Hex | undefined
  /** Required owner weight. */
  threshold?: number | undefined
  /** Collected owner weight. */
  weight?: number | undefined
}

function parse(serialized: Hex.Hex) {
  const transaction = Transaction.deserialize(serialized as never) as Record<string, unknown>
  const signature = transaction.signature
  if (!isMultisigSignature(signature))
    throw new RpcResponse.InvalidParamsError({
      message: 'Transaction does not contain a native multisig signature.',
    })

  const { signature: _, ...unsigned } = transaction
  const payload = TxEnvelopeTempo.getSignPayload(TxEnvelopeTempo.from(unsigned as never))
  const chainId = Number(transaction.chainId)
  const id = MultisigConfig.getSignPayload({
    account: signature.account,
    genesisConfigId: signature.genesisConfigId,
    payload,
  })
  const init = signature.init ? MultisigConfig.from(signature.init) : undefined

  return {
    account: signature.account,
    chainId,
    genesisConfigId: signature.genesisConfigId,
    id,
    init,
    payload,
    signatures: signature.signatures.map((value) => SignatureEnvelope.serialize(value)),
    transaction,
  }
}

function isMultisigSignature(value: unknown): value is SignatureEnvelope.Multisig {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'multisig' &&
    typeof (value as { account?: unknown }).account === 'string' &&
    typeof (value as { genesisConfigId?: unknown }).genesisConfigId === 'string' &&
    Array.isArray((value as { signatures?: unknown }).signatures)
  )
}

async function resolveValidatedConfig(options: {
  account: Address
  chainId: number
  genesisConfigId: Hex.Hex
  init?: MultisigConfig.Config | undefined
  pending?: Operation | undefined
  resolveConfig?: ResolveConfig | undefined
}) {
  const { account, chainId, genesisConfigId, init, pending, resolveConfig } = options
  const config =
    (await resolveConfig?.({ account, chainId, genesisConfigId, init })) ?? pending?.config ?? init
  if (!config) return undefined

  const normalized = MultisigConfig.from(config)
  const account_expected = MultisigConfig.getAddress({ genesisConfigId })
  if (account_expected.toLowerCase() !== account.toLowerCase())
    throw new RpcResponse.InvalidParamsError({
      message: 'Resolved multisig config does not match account or genesis config id.',
    })
  return normalized
}

function mergeSignatures(signatures: readonly Hex.Hex[]) {
  const seen = new Set<string>()
  const out: Hex.Hex[] = []
  for (const signature of signatures) {
    const key = signature.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(signature)
  }
  return out
}

function getApprovals(options: {
  account: Address
  config: MultisigConfig.Config
  genesisConfigId: Hex.Hex
  payload: Hex.Hex
  signatures: readonly Hex.Hex[]
}) {
  const { account, config, genesisConfigId, payload } = options
  const digest = MultisigConfig.getSignPayload({ account, genesisConfigId, payload })
  const owners = new Map(
    config.owners.map((owner) => [
      owner.owner.toLowerCase(),
      { address: owner.owner, weight: Number(owner.weight) },
    ]),
  )
  const seen = new Set<string>()
  const signatures: Hex.Hex[] = []
  let weight = 0

  for (const value of options.signatures) {
    const signature = SignatureEnvelope.from(value)
    const owner = SignatureEnvelope.extractAddress({ payload: digest, signature })
    const key = owner.toLowerCase()
    const configured = owners.get(key)
    if (!configured)
      throw new RpcResponse.InvalidParamsError({ message: `Signature from non-owner ${owner}.` })
    if (seen.has(key)) continue
    seen.add(key)
    signatures.push(SignatureEnvelope.serialize(signature))
    weight += configured.weight
  }

  return { signatures, threshold: Number(config.threshold), weight }
}

async function serializeFinal(options: {
  account: Address
  config: MultisigConfig.Config
  genesisConfigId: Hex.Hex
  init?: boolean | undefined
  signatures: readonly Hex.Hex[]
  transaction: Record<string, unknown>
}) {
  const { signature: _, ...transaction } = options.transaction
  const envelope = TxEnvelopeTempo.from({
    ...transaction,
    feePayerSignature: (() => {
      const value = transaction.feePayerSignature
      // Preserve missing/null fee-payer markers so sponsorship can add signature later.
      if (!value) return value
      // Normalize RPC-shaped signatures before rebuilding final transaction envelope.
      if (typeof value === 'object' && 'r' in value && 's' in value) {
        const signature = value as {
          r: bigint | number | string
          s: bigint | number | string
          v?: bigint | number | string | undefined
          yParity?: bigint | number | string | undefined
        }
        const yParity = (() => {
          const value = signature.yParity ?? signature.v
          // Some signature shapes omit parity until later normalization.
          if (typeof value === 'undefined') return undefined
          const number = Number(value)
          // RPC signatures may carry Ethereum 27/28 `v`; `ox` expects 0/1 parity.
          if (number === 27 || number === 28) return number - 27
          return number
        })()
        if (typeof yParity === 'number')
          return Signature.from({ r: BigInt(signature.r), s: BigInt(signature.s), yParity })
      }
      // Fall back to `ox` for already-normalized signature inputs.
      return Signature.from(value as never)
    })(),
  } as never)
  const payload = TxEnvelopeTempo.getSignPayload(envelope)
  const signatures = options.signatures.map((approval) => SignatureEnvelope.from(approval))
  const sorted = SignatureEnvelope.sortMultisigApprovals({
    account: options.account,
    genesisConfigId: options.genesisConfigId,
    payload,
    signatures,
  })
  const signature = SignatureEnvelope.from({
    account: options.account,
    genesisConfigId: options.genesisConfigId,
    signatures: sorted,
    ...(options.init ? { init: options.config } : {}),
  })
  return TxEnvelopeTempo.serialize(envelope, { feePayerSignature: undefined, signature })
}

function mergeOperation(
  existing: Operation | undefined,
  operation: Operation,
  patch: Partial<Operation>,
) {
  return {
    ...operation,
    ...existing,
    ...patch,
    config: operation.config ?? existing?.config,
    signatures: mergeSignatures([...(existing?.signatures ?? []), ...operation.signatures]),
    transaction: operation.transaction,
  } satisfies Operation
}

function toStatus(options: {
  approvals: { signatures: readonly Hex.Hex[]; threshold: number; weight: number }
  operation: Operation
}): Status {
  const { approvals, operation } = options
  return {
    account: operation.account,
    chainId: operation.chainId,
    genesisConfigId: operation.genesisConfigId,
    id: operation.id,
    signatures: approvals.signatures.length,
    status: operation.status,
    submittedHash: operation.submittedHash,
    threshold: approvals.threshold,
    weight: approvals.weight,
  }
}
