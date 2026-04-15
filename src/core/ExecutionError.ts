import { type DecodeErrorResultReturnType, type Hex, decodeErrorResult } from 'viem'
import { Abis } from 'viem/tempo'

import type { OneOf, UnionOmit } from '../internal/types.js'

type AllAbis = typeof Abis.abis
type AbiErrorName = Extract<AllAbis[number], { type: 'error' }>['name']

/** Decoded execution error from a Tempo precompile revert. */
export type ExecutionError = OneOf<
  | (DecodeErrorResultReturnType<AllAbis> & {
      data: Hex
      message: string
    })
  | { errorName: 'unknown'; message: string }
>

/** RPC-serialized execution error (bigints and numbers as hex). */
export type Rpc = UnionOmit<ExecutionError, 'args'>

/** Human-readable messages keyed by ABI error name. */
export const messages: Record<AbiErrorName, string> = {
  AddressAlreadyHasValidator: 'This address already has a validator.',
  AddressNotReserved: 'Address is not reserved.',
  AddressReserved: 'Address is reserved.',
  AlreadyInitialized: 'Already initialized.',
  BelowMinimumOrderSize: 'Below minimum order size: {0}.',
  CallNotAllowed: 'This call is not allowed.',
  CannotChangeWithPendingFees: 'Cannot change while fees are pending.',
  CannotChangeWithinBlock: 'Cannot change within the same block.',
  ContractPaused: 'Contract is paused.',
  DivisionByZero: 'Division by zero.',
  EmptyV1ValidatorSet: 'Validator set is empty.',
  ExpiringNonceReplay: 'Expiring nonce has already been used.',
  ExpiringNonceSetFull: 'Expiring nonce set is full.',
  ExpiryInPast: 'Expiry is in the past.',
  IdenticalAddresses: 'Addresses must be different.',
  IdenticalTokens: 'Tokens must be different.',
  IncompatiblePolicyType: 'Incompatible policy type.',
  IngressAlreadyExists: 'Ingress "{0}" already exists.',
  InsufficientAllowance: 'Insufficient allowance.',
  InsufficientBalance: 'Insufficient balance. Required: {1}, available: {0}.',
  InsufficientFeeTokenBalance: 'Insufficient fee token balance.',
  InsufficientLiquidity: 'Insufficient liquidity.',
  InsufficientOutput: 'Insufficient output amount.',
  InsufficientReserves: 'Insufficient reserves.',
  InternalError: 'Internal error.',
  InvalidAmount: 'Invalid amount.',
  InvalidBaseToken: 'Invalid base token.',
  InvalidCallScope: 'Invalid call scope.',
  InvalidCurrency: 'Invalid currency.',
  InvalidExpiringNonceExpiry: 'Invalid expiring nonce expiry.',
  InvalidFlipTick: 'Invalid flip tick.',
  InvalidFormat: 'Invalid format.',
  InvalidMasterAddress: 'Invalid master address.',
  InvalidMigrationIndex: 'Invalid migration index.',
  InvalidNonceKey: 'Invalid nonce key.',
  InvalidOwner: 'Invalid owner.',
  InvalidPayload: 'Invalid payload.',
  InvalidPolicyType: 'Invalid policy type.',
  InvalidPublicKey: 'Invalid public key.',
  InvalidQuoteToken: 'Invalid quote token.',
  InvalidRecipient: 'Invalid recipient.',
  InvalidSignature: 'Invalid signature.',
  InvalidSignatureFormat: 'Invalid signature format.',
  InvalidSignatureType: 'Invalid signature type.',
  InvalidSpendingLimit: 'Invalid spending limit.',
  InvalidSupplyCap: 'Invalid supply cap.',
  InvalidSwapCalculation: 'Invalid swap calculation.',
  InvalidTick: 'Invalid tick.',
  InvalidToken: 'Invalid token.',
  InvalidTransferPolicyId: 'Invalid transfer policy.',
  InvalidValidatorAddress: 'Invalid validator address.',
  KeyAlreadyExists: 'Key already exists.',
  KeyAlreadyRevoked: 'Key has already been revoked.',
  KeyExpired: 'Key has expired.',
  KeyNotFound: 'Key not found.',
  LegacyAuthorizeKeySelectorChanged: 'Legacy authorize key selector changed to {0}.',
  MasterIdCollision: 'Master ID collision with {0}.',
  MaxInputExceeded: 'Maximum input exceeded.',
  MigrationNotComplete: 'Migration is not complete.',
  NoOptedInSupply: 'No opted-in supply.',
  NonceOverflow: 'Nonce overflow.',
  NotHostPort: '"{1}" is not a valid host:port for {0}.',
  NotInitialized: 'Not initialized.',
  NotIp: '"{0}" is not a valid IP address.',
  NotIpPort: '"{1}" is not a valid IP:port for {0}.',
  OnlySystemContract: 'Only callable by system contract.',
  OnlyValidator: 'Only callable by a validator.',
  OrderDoesNotExist: 'Order does not exist.',
  OrderNotStale: 'Order is not stale.',
  PairAlreadyExists: 'Pair already exists.',
  PairDoesNotExist: 'Pair does not exist.',
  PermitExpired: 'Permit has expired.',
  PolicyForbids: 'Forbidden by policy.',
  PolicyNotFound: 'Policy not found.',
  PolicyNotSimple: 'Policy is not a simple policy.',
  PoolDoesNotExist: 'Pool does not exist.',
  ProofOfWorkFailed: 'Proof of work failed.',
  ProtectedAddress: 'Address is protected.',
  ProtocolNonceNotSupported: 'Protocol nonce is not supported.',
  PublicKeyAlreadyExists: 'Public key already exists.',
  SignatureTypeMismatch: 'Signature type mismatch. Expected {0}, got {1}.',
  SpendingLimitExceeded: 'Spending limit exceeded.',
  StringTooLong: 'String is too long.',
  SupplyCapExceeded: 'Supply cap exceeded.',
  TickOutOfBounds: 'Tick {0} is out of bounds.',
  TokenAlreadyExists: 'Token {0} already exists.',
  TokenPolicyForbids: 'Forbidden by token policy.',
  TransfersDisabled: 'Transfers are disabled.',
  Unauthorized: 'Unauthorized.',
  UnauthorizedCaller: 'Unauthorized caller.',
  Uninitialized: 'Uninitialized.',
  ValidatorAlreadyDeactivated: 'Validator is already deactivated.',
  ValidatorAlreadyExists: 'Validator already exists.',
  ValidatorNotFound: 'Validator not found.',
  VirtualAddressNotAllowed: 'Virtual address is not allowed.',
  VirtualAddressUnregistered: 'Virtual address is not registered.',
  ZeroPublicKey: 'Public key cannot be zero.',
}

/** Interpolate `{0}`, `{1}`, … placeholders with args. */
function interpolate(template: string, args?: readonly unknown[]): string {
  if (!args) return template
  return template.replace(/\{(\d+)\}/g, (_, i) => {
    const v = args[Number(i)]
    return v === undefined ? `{${i}}` : String(v)
  })
}

/** Parse a viem error into a structured execution error. */
export function parse(error: Error): ExecutionError {
  const raw =
    (error as { details?: string }).details ??
    (error as { shortMessage?: string }).shortMessage ??
    error.message

  const data = extractRevertData(error)
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: Abis.abis, data })
      const template = messages[decoded.errorName as AbiErrorName]
      return {
        ...decoded,
        data,
        message: template
          ? interpolate(template, decoded.args as readonly unknown[])
          : raw.replace(/^execution reverted:\s*/i, ''),
      } as never
    } catch {}
  }

  // Fallback: extract error name from human-readable revert message.
  const nameMatch = /:\s*(\w+)\(\w+/.exec(raw)
  const errorName = nameMatch?.[1]
  if (errorName && errorName in messages)
    return { errorName: 'unknown', message: messages[errorName as AbiErrorName]! }

  return {
    errorName: 'unknown',
    message: raw.replace(/^execution reverted:\s*/i, ''),
  }
}

/** Serializes an ExecutionError for RPC transport (bigints/numbers → hex). */
export function serialize(preimage: ExecutionError): Rpc {
  if (preimage.errorName === 'unknown') return { errorName: 'unknown', message: preimage.message }
  return {
    errorName: preimage.errorName,
    abiItem: preimage.abiItem,
    message: preimage.message,
    data: preimage.data,
  } as never
}

function extractRevertData(error: unknown): Hex | null {
  if (!error || typeof error !== 'object') return null
  const e = error as Record<string, unknown>
  if (typeof e.data === 'string' && e.data.startsWith('0x')) return e.data as Hex
  if (e.cause) return extractRevertData(e.cause)
  if (e.error) return extractRevertData(e.error)
  if (typeof e.walk === 'function') {
    const inner = (e as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
      (e) => typeof (e as Record<string, unknown>).data === 'string',
    )
    if (inner) return extractRevertData(inner)
  }
  return null
}
