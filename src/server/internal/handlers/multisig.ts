import { Hex, RpcResponse } from 'ox'
import { MultisigConfig, SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import type { Address, Client } from 'viem'
import { Transaction } from 'viem/tempo'

/** Returns whether a raw transaction carries a native multisig signature. */
export function isMultisigTransaction(serialized: Hex.Hex) {
  if (!serialized.startsWith('0x76')) return false
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
    store,
  } = options
  const serialized = request.params?.[0]
  if (typeof serialized !== 'string' || !serialized.startsWith('0x76'))
    throw new RpcResponse.InvalidParamsError({
      message: 'Only Tempo (0x76) transactions are supported.',
    })

  const input = parse(serialized as Hex.Hex)
  const config = await resolveConfig({
    account: input.account,
    chainId: input.chainId,
    genesisConfigId: input.genesisConfigId,
    init: input.init,
  })
  if (!config)
    throw new RpcResponse.InvalidParamsError({
      message:
        'Multisig config is required to collect approvals. Provide it in the bootstrap transaction or configure `multisig.resolveConfig`.',
    })

  const pending = await store.get(input.id)
  const signatures = mergeSignatures([...(pending?.signatures ?? []), ...input.signatures])
  const approvals = getApprovals({
    account: input.account,
    genesisConfigId: input.genesisConfigId,
    payload: input.payload,
    signatures,
    config,
  })
  const now = Date.now()
  const entry = {
    account: input.account,
    chainId: input.chainId,
    createdAt: pending?.createdAt ?? now,
    genesisConfigId: input.genesisConfigId,
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
  const result = await client.request({
    method:
      method === 'eth_sendRawTransaction' && finalize === 'sync'
        ? 'eth_sendRawTransactionSync'
        : method,
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

/** Resolves a fake multisig operation hash for standard transaction lookup methods. */
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
  const config = await options.resolveConfig?.({
    account: entry.account,
    chainId: entry.chainId,
    genesisConfigId: entry.genesisConfigId,
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
      const config = await options.resolveConfig?.({
        account: entry.account,
        chainId: entry.chainId,
        genesisConfigId: entry.genesisConfigId,
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
  if (transaction.feePayerSignature)
    throw new RpcResponse.InvalidParamsError({
      message: 'Native multisig fee payer transactions are not supported yet.',
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
  return await Transaction.serialize({
    ...transaction,
    multisig: options.config,
    signatures: options.signatures,
  } as never)
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
