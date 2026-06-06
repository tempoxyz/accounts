import { Hex, RpcResponse, Signature } from 'ox'
import { MultisigConfig, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import type { Address, Client } from 'viem'
import type { LocalAccount } from 'viem/accounts'
import { Transaction } from 'viem/tempo'

import * as Sponsorship from './sponsorship.js'
import * as Utils from './utils.js'

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
  if (result.status.status === 'pending') return result.status.id
  if (options.method === 'eth_sendRawTransactionSync') return result.broadcastResult
  return result.status.submittedHash!
}

export declare namespace handleRawTransaction {
  type Options = collect.Options

  type ReturnType = Hex.Hex | unknown
}

async function collect(options: collect.Options): Promise<collect.ReturnType> {
  const {
    finalize = 'sync',
    getClient,
    method,
    request,
    resolveConfig = ({ init }) => init,
    sponsor,
    store,
  } = options
  const serialized = request.params?.[0]
  if (!Utils.isSerializedTempoTransaction(serialized))
    throw new RpcResponse.InvalidParamsError({
      message: 'Only Tempo transactions (0x76 or fee-payer 0x78) are supported.',
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

  const signatures = mergeSignatures([...(pending?.signatures ?? []), ...input.signatures])
  const approvals = getApprovals({
    account: input.account,
    genesisConfigId: input.genesisConfigId,
    payload: input.payload,
    signatures,
    config,
  })
  if (pending?.submittedHash)
    return {
      broadcastResult: pending.submittedHash,
      status: toResult({
        entry: pending,
        approvals,
        status: 'submitted',
      }),
    }

  const now = Date.now()
  const entry = {
    account: input.account,
    chainId: input.chainId,
    createdAt: pending?.createdAt ?? now,
    genesisConfigId: input.genesisConfigId,
    config,
    id: input.id,
    payload: input.payload,
    signatures: approvals.signatures,
    transaction: serialized as Hex.Hex,
    updatedAt: now,
  } satisfies Entry

  if (approvals.weight < approvals.threshold) {
    await store.set(entry)
    return {
      status: toResult({ entry, approvals, status: 'pending' }),
    }
  }

  const client = getClient(input.chainId)
  const final = await serializeFinal({
    config,
    signatures: approvals.signatures,
    transaction: input.transaction,
  })
  const broadcastMethod =
    method === 'eth_sendRawTransaction' && finalize === 'sync'
      ? 'eth_sendRawTransactionSync'
      : method
  const feePayerState = getFeePayerState(final as Hex.Hex)
  const sponsorFeeToken =
    sponsor &&
    (sponsor.feeToken ||
      feePayerState.signature === null ||
      (feePayerState.signature != null && !feePayerState.feeToken))
      ? (sponsor.feeToken ?? (await sponsor.resolveFeeToken?.(input.chainId)))
      : undefined
  const shouldSponsor =
    sponsor &&
    (feePayerState.signature === null ||
      (feePayerState.signature != null &&
        (sponsor.feeToken || (!feePayerState.feeToken && sponsorFeeToken))))
  const result = shouldSponsor
    ? await Sponsorship.handleRawTransaction({
        account: sponsor.account,
        feeToken: sponsorFeeToken,
        getClient,
        method: broadcastMethod,
        request: { params: [final] },
        resolveFeeToken: sponsor.resolveFeeToken,
        sender: input.account,
        validate: sponsor.validate,
      })
    : await client.request({
        method: broadcastMethod,
        params: [final],
      } as never)
  const hash = getTransactionHash(result)
  const submitted = {
    ...entry,
    submittedHash: hash,
  } satisfies Entry

  if (pending) await store.set(submitted)
  else await store.delete(input.id)

  return {
    broadcastResult: result,
    status: toResult({
      entry: submitted,
      approvals,
      status: 'submitted',
    }),
  }
}

/** Resolves a multisig operation id for standard transaction lookup methods. */
export async function handleGetTransaction(
  options: handleGetTransaction.Options,
): Promise<handleGetTransaction.ReturnType> {
  const id = options.request.params?.[0]
  if (typeof id !== 'string') return undefined

  const entry = await options.store.get(id as Hex.Hex)
  if (!entry) return undefined
  if (!entry.submittedHash) return { result: null }

  const result = await options.getClient(entry.chainId).request({
    method: options.method,
    params: [entry.submittedHash],
  } as never)
  if (options.method === 'eth_getTransactionReceipt' && result) await options.store.delete(entry.id)
  return { result }
}

export declare namespace handleGetTransaction {
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

  type ReturnType = { result: unknown } | undefined
}

declare namespace collect {
  type Options = {
    /** How to broadcast once quorum is met. @default 'sync' */
    finalize?: 'submitted' | 'sync' | undefined
    /** Client resolver keyed by transaction `chainId`. */
    getClient: (chainId?: number | undefined) => Client
    /** Raw transaction method to handle. */
    method: 'eth_sendRawTransaction' | 'eth_sendRawTransactionSync'
    /** Incoming JSON-RPC request. */
    request: { params?: readonly unknown[] | undefined }
    /** Resolves the genesis multisig config for quorum checks. */
    resolveConfig?: Options_multisig['resolveConfig']
    /** Optional fee payer used to sponsor finalized multisig transactions. */
    sponsor?:
      | {
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
      | undefined
    /** Pending multisig operation store. */
    store: Store
  }

  type ReturnType = {
    /** Raw broadcast result once quorum is met. */
    broadcastResult?: unknown
    /** Structured operation status. */
    status: Status
  }
}

/** Returns a stored native multisig operation status. */
export async function getStatus(options: getStatus.Options): Promise<Status | null> {
  const entry = await options.store.get(options.id)
  if (!entry) return null
  const config = await resolveValidatedConfig({
    account: entry.account,
    chainId: entry.chainId,
    genesisConfigId: entry.genesisConfigId,
    pending: entry,
    resolveConfig: options.resolveConfig,
  })
  if (!config)
    return {
      account: entry.account,
      chainId: entry.chainId,
      genesisConfigId: entry.genesisConfigId,
      id: entry.id,
      signatures: entry.signatures.length,
      status: entry.submittedHash ? 'submitted' : 'pending',
      submittedHash: entry.submittedHash,
    }
  const approvals = getApprovals({
    account: entry.account,
    genesisConfigId: entry.genesisConfigId,
    payload: entry.payload,
    signatures: entry.signatures,
    config,
  })
  return toResult({
    entry,
    approvals,
    status: entry.submittedHash ? 'submitted' : 'pending',
  })
}

export declare namespace getStatus {
  type Options = {
    /** Operation id returned by a pending multisig submission. */
    id: Hex.Hex
    /** Resolves the genesis multisig config for quorum status. */
    resolveConfig?: Options_multisig['resolveConfig']
    /** Pending multisig operation store. */
    store: Store
  }
}

/** Returns pending native multisig operations for an account. */
export async function listStatuses(options: listStatuses.Options): Promise<readonly Status[]> {
  const entries = await options.store.listPendingByAddress(options.account)
  return await Promise.all(
    entries.map(async (entry) => {
      const config = await resolveValidatedConfig({
        account: entry.account,
        chainId: entry.chainId,
        genesisConfigId: entry.genesisConfigId,
        pending: entry,
        resolveConfig: options.resolveConfig,
      })
      if (!config)
        return {
          account: entry.account,
          chainId: entry.chainId,
          genesisConfigId: entry.genesisConfigId,
          id: entry.id,
          signatures: entry.signatures.length,
          status: entry.submittedHash ? 'submitted' : 'pending',
          submittedHash: entry.submittedHash,
        }
      const approvals = getApprovals({
        account: entry.account,
        genesisConfigId: entry.genesisConfigId,
        payload: entry.payload,
        signatures: entry.signatures,
        config,
      })
      return toResult({
        entry,
        approvals,
        status: entry.submittedHash ? 'submitted' : 'pending',
      })
    }),
  )
}

export declare namespace listStatuses {
  type Options = {
    /** Native multisig account address. */
    account: Address
    /** Resolves the genesis multisig config for quorum status. */
    resolveConfig?: Options_multisig['resolveConfig']
    /** Pending multisig operation store. */
    store: Store
  }
}

/** Storage for pending native multisig operation approvals. */
export type Store = {
  /** Deletes a finalized operation. */
  delete: (id: Hex.Hex) => Promise<void>
  /** Reads a pending operation. */
  get: (id: Hex.Hex) => Promise<Entry | undefined>
  /** Lists pending operations for a native multisig account address. */
  listPendingByAddress: (address: Address) => Promise<readonly Entry[]>
  /** Writes a pending operation. */
  set: (entry: Entry) => Promise<void>
}

/** Pending native multisig operation. */
export type Entry = {
  /** Native multisig account address. */
  account: Address
  /** Transaction chain id. */
  chainId: number
  /** Creation timestamp in milliseconds. */
  createdAt: number
  /** Permanent genesis config id. */
  genesisConfigId: Hex.Hex
  /** Resolved genesis config used for approval checks. */
  config?: MultisigConfig.Config | undefined
  /** Deterministic operation id. */
  id: Hex.Hex
  /** Unsigned Tempo transaction sign payload. */
  payload: Hex.Hex
  /** Collected owner approval signatures. */
  signatures: readonly Hex.Hex[]
  /** Last submitted serialized transaction carrying this operation. */
  transaction: Hex.Hex
  /** Transaction hash once submitted. */
  submittedHash?: Hex.Hex | undefined
  /** Last update timestamp in milliseconds. */
  updatedAt: number
}

/** Native multisig relay options. */
export type Options_multisig = {
  /** How to broadcast once quorum is met. @default 'sync' */
  finalize?: 'submitted' | 'sync' | undefined
  /** Resolves the genesis multisig config for quorum checks. */
  resolveConfig?:
    | ((request: {
        /** Native multisig account address. */
        account: Address
        /** Transaction chain id. */
        chainId: number
        /** Permanent genesis config id. */
        genesisConfigId: Hex.Hex
        /** Bootstrap config carried by the transaction, when present. */
        init?: MultisigConfig.Config | undefined
      }) => MultisigConfig.Config | Promise<MultisigConfig.Config | undefined> | undefined)
    | undefined
  /** Pending multisig operation store. */
  store: Store
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
  status: 'pending' | 'submitted'
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
  pending?: Entry | undefined
  resolveConfig?: Options_multisig['resolveConfig']
}) {
  const { account, chainId, genesisConfigId, init, pending, resolveConfig } = options
  const config =
    (await resolveConfig?.({
      account,
      chainId,
      genesisConfigId,
      init,
    })) ?? pending?.config
  if (!config) return undefined

  const normalized = MultisigConfig.from(config)
  const account_expected = MultisigConfig.getAddress(normalized)
  const id_expected = MultisigConfig.toId(normalized)
  if (
    account_expected.toLowerCase() !== account.toLowerCase() ||
    id_expected.toLowerCase() !== genesisConfigId.toLowerCase()
  )
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
  const digest = MultisigConfig.getSignPayload({
    account,
    genesisConfigId,
    payload,
  })
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
      throw new RpcResponse.InvalidParamsError({
        message: `Signature from non-owner ${owner}.`,
      })
    if (seen.has(key)) continue
    seen.add(key)
    signatures.push(SignatureEnvelope.serialize(signature))
    weight += configured.weight
  }

  return {
    signatures,
    threshold: Number(config.threshold),
    weight,
  }
}

async function serializeFinal(options: {
  config: MultisigConfig.Config
  signatures: readonly Hex.Hex[]
  transaction: Record<string, unknown>
}) {
  const { signature: _, ...transaction } = options.transaction
  const envelope = TxEnvelopeTempo.from({
    ...transaction,
    feePayerSignature: normalizeFeePayerSignature(transaction.feePayerSignature),
  } as never)
  const payload = TxEnvelopeTempo.getSignPayload(envelope)
  const signatures = options.signatures.map((approval) => SignatureEnvelope.from(approval))
  const sorted = SignatureEnvelope.sortMultisigApprovals({
    genesisConfig: options.config,
    payload,
    signatures,
  })
  const signature = SignatureEnvelope.from({
    genesisConfig: options.config,
    signatures: sorted,
    ...((transaction.nonce as number | bigint | undefined) ? {} : { init: true }),
  })
  return TxEnvelopeTempo.serialize(envelope, {
    feePayerSignature: undefined,
    signature,
  })
}

function normalizeFeePayerSignature(value: unknown) {
  if (!value) return value
  return Signature.from(value as never)
}

function getFeePayerState(serialized: Hex.Hex) {
  try {
    const transaction = Transaction.deserialize(serialized as never) as Record<string, unknown>
    if (!('feePayerSignature' in transaction)) return {}
    return {
      feeToken:
        typeof transaction.feeToken === 'string' ? (transaction.feeToken as Address) : undefined,
      signature: transaction.feePayerSignature,
    }
  } catch {
    return {}
  }
}

function getTransactionHash(result: unknown) {
  if (typeof result === 'string') return result as Hex.Hex
  if (
    result &&
    typeof result === 'object' &&
    'transactionHash' in result &&
    typeof result.transactionHash === 'string'
  )
    return result.transactionHash as Hex.Hex
  throw new Error('Expected transaction hash in multisig broadcast result.')
}

function toResult(options: {
  approvals: { signatures: readonly Hex.Hex[]; threshold: number; weight: number }
  entry: Entry
  status: Status['status']
}): Status {
  const { approvals, entry, status } = options
  return {
    account: entry.account,
    chainId: entry.chainId,
    genesisConfigId: entry.genesisConfigId,
    id: entry.id,
    signatures: approvals.signatures.length,
    status,
    submittedHash: entry.submittedHash,
    threshold: approvals.threshold,
    weight: approvals.weight,
  }
}
