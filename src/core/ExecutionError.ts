import { type DecodeErrorResultReturnType, type Hex, decodeErrorResult } from 'viem'
import { Abis, ExecutionError as core_ExecutionError } from 'viem/tempo'

import type { OneOf, UnionOmit } from '../internal/types.js'

type AllAbis = typeof Abis.all
type AbiErrorName = Extract<AllAbis[number], { type: 'error' }>['name']
type CoreErrorName = Extract<(typeof Abis.coreErrors)[number], { type: 'error' }>['name']

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

/**
 * Messages for errors in `Abis.all` outside `Abis.coreErrors`, which
 * `viem/tempo`'s `ExecutionError` does not decode.
 */
const messages_extra: Record<Exclude<AbiErrorName, CoreErrorName>, string> = {
  ActiveSupplyWithoutBacking: 'Active supply has no backing.',
  AdminRelinquishmentFailed: 'Admin relinquishment failed.',
  AmountExceedsLimit: 'Amount exceeds limit.',
  AmountIsZero: 'Amount cannot be zero.',
  AmountOverflow: 'Amount overflow.',
  AssetsNotArrived: 'Assets for request {0} have not arrived.',
  BadFlow: 'Invalid execution flow.',
  BaseAssetSweepBlocked: 'Base asset sweep is blocked by {0} unresolved claims.',
  CallbackDataTooLarge: 'Callback data too large.',
  CannotSweepEngineBacking: 'Cannot sweep engine backing.',
  ClaimNotClaimable: 'Claim {0} is not claimable.',
  ClaimNotOpen: 'Claim {0} is not open.',
  ClaimsExpired: 'Claims have expired.',
  ClaimsNotExpired: 'Claims have not expired.',
  CreditExceedsBalance:
    'Credit for asset {0} exceeds the balance. Available: {1}, requested total: {2}.',
  CustomerIdIsZero: 'Customer ID cannot be zero.',
  DeadlineExpired: 'Deadline {0} has expired at timestamp {1}.',
  DepositsNotPaused: 'Deposits are not paused.',
  DepositsPaused: 'Deposits are paused.',
  DistributorFeeUpdateNotPending: 'No distributor fee update is pending.',
  DistributorFeeUpdateNotReady: 'Distributor fee update is not executable until {0}.',
  DistributorTransferNotPending: 'No distributor transfer is pending.',
  DuplicateRequest: 'Request {0} is duplicated.',
  EarnShareAlreadyExists: 'Earn share {0} already exists.',
  EarnShareSupplyNotZero: 'Earn share supply is not zero.',
  EarnShareSupplyOutOfBounds: 'Earn share supply {0} exceeds the maximum {1}.',
  EarnVaultNotSet: 'Earn vault is not set.',
  EmptyDeploymentId: 'Deployment ID cannot be empty.',
  EmptyEarnShareMetadata: 'Empty earn share metadata.',
  EmptyInstallation: 'Installation cannot be empty.',
  EmptyMetadata: 'Empty metadata.',
  EngineAlreadyBound: 'Earn vault {0} is already bound to an engine.',
  EngineAlreadyExists: 'Engine {0} already exists.',
  EngineAssetMismatch: 'Engine asset mismatch.',
  EngineCapabilityUnsupported: 'Engine capability {0} is unsupported.',
  EngineEarnVaultMismatch: 'Engine earn vault mismatch.',
  EngineExitUnsupported: 'This engine does not support exits.',
  EngineSharesTooLarge: 'Engine share amount {0} is too large.',
  ExactBalanceDeltaFailed: 'Balance change for {0} was {2}, expected {1}.',
  ExceedsMaxEarnShares: 'Maximum earn shares exceeded.',
  ExcessiveConversionLoss:
    'Conversion loss is excessive. Input shares: {0}, represented shares: {1}.',
  ExcessiveMigrationClassificationError:
    'Migration managed assets mismatch. Expected {0}, got {1}.',
  ExtraDecryptionData: 'Unexpected decryption data.',
  FactoryCannotBeFinalOwner: 'The factory cannot be the final owner.',
  FailedDeployment: 'Deployment failed.',
  FeeValuationStale: 'Fee valuation is stale.',
  FinalizedAssetMismatch: 'Finalized asset {0} does not match.',
  FutureOracleTimestamp: 'Oracle timestamp {0} is after the current time ({1}).',
  GasLimitTooHigh: 'Gas limit too high.',
  GlobalFeeDisableUnavailable: 'Global fee disabling is unavailable.',
  Inactive: 'This contract is inactive.',
  InitialEarnShareSupplyNotZero: 'Initial earn share supply must be zero.',
  InsufficientAssetsReceived: 'Insufficient assets received. Minimum: {0}, actual: {1}.',
  InsufficientClaimableEarnShares: 'Insufficient claimable earn shares.',
  InsufficientEngineShareSurplus:
    'Insufficient engine share surplus. Available: {0}, requested: {1}.',
  InsufficientFunding: 'Insufficient funding. Required: {0}, actual: {1}.',
  InsufficientInventory: 'Insufficient inventory for {0}: available {1}, required {2}.',
  InvalidAddress: 'Invalid address.',
  InvalidArrayLengths: 'Invalid array lengths.',
  InvalidAsset: 'Invalid asset. Expected {0}, got {1}.',
  InvalidAuthority: 'Invalid authority.',
  InvalidBlockNumber: 'Invalid block number.',
  InvalidCurrentTxHash: 'Invalid current transaction hash.',
  InvalidDepositQueueHash: 'Invalid deposit queue hash.',
  InvalidDistributorConfig: 'Invalid distributor config.',
  InvalidDistributorConfiguration: 'Invalid distributor configuration.',
  InvalidDistributorFeeConfiguration: 'Invalid distributor fee configuration.',
  InvalidEarnDecimals: 'Invalid earn decimals.',
  InvalidEarnFeesImplementation: 'Invalid earn fees implementation.',
  InvalidEarnVault: 'Invalid earn vault.',
  InvalidEarnVaultImplementation: 'Invalid earn vault implementation.',
  InvalidEncryptedSenderCount: 'Invalid encrypted sender count. Expected {1}, got {0}.',
  InvalidEncryptedSenderLength: 'Invalid encrypted sender length. Expected {1}, got {0}.',
  InvalidEngine: 'Invalid engine.',
  InvalidEngineShareScale: 'Invalid engine share scale.',
  InvalidExistingDeployment: 'Existing deployment {0} is invalid.',
  InvalidFallbackRecipient: 'Invalid fallback recipient.',
  InvalidFeeClaimReceiver: 'Invalid fee claim receiver.',
  InvalidFeeConfiguration: 'Invalid fee configuration.',
  InvalidMaxOracleAge: 'Invalid maximum oracle age.',
  InvalidMaxPriceDeviationBps: 'Maximum price deviation {0} exceeds {1} basis points.',
  InvalidMaxRateAge: 'Invalid maximum rate age.',
  InvalidMultiproof: 'Invalid multiproof.',
  InvalidOraclePriceToleranceBps: 'Oracle price tolerance {0} exceeds {1} basis points.',
  InvalidPrice: 'Invalid price.',
  InvalidPrivateAsset: 'Invalid private asset.',
  InvalidRateTimestamp: 'Rate timestamp {0} is invalid at current time {1}.',
  InvalidReturnToken: 'Invalid return token.',
  InvalidRevealTo: 'Invalid reveal to.',
  InvalidRewardConfiguration: 'Invalid reward configuration.',
  InvalidRoutePair: 'Invalid route pair.',
  InvalidSharedSecretProof: 'Invalid shared secret proof.',
  InvalidSourcePortal: 'Invalid source portal.',
  InvalidTokenEnablementHash: 'Invalid token enablement hash.',
  InvalidTrackedRequest: 'Tracked request {0} is invalid.',
  InvalidTransactionLimit: 'Invalid transaction limit.',
  InvalidTransferPolicy: 'Transfer policy {0} is invalid.',
  InvalidVedaPeriphery: 'Account {0} is not a valid Veda periphery.',
  InvalidVedaPeripheryWiring:
    'Invalid Veda periphery wiring for component {0}. Expected {1}, got {2}.',
  InvalidVedaRateBounds: 'Invalid Veda rate bounds. Minimum: {0}, maximum: {1}.',
  InvalidVenueShareDecimals: 'Invalid venue share decimals.',
  InvalidWithdrawalBounceBack: 'Invalid withdrawal bounce-back.',
  InvalidWithdrawalCount: 'Invalid withdrawal count. Expected {1}, got {0}.',
  IssuerGrantFailed: 'Issuer grant failed.',
  MaxManagedAssetsExceeded: 'Maximum managed assets {0} exceeded by actual amount {1}.',
  MerkleProofInvalidMultiproof: 'Invalid Merkle multiproof.',
  MinimumAssetsNotMet: 'Minimum assets not met. Minimum: {0}, actual: {1}.',
  MinimumEarnSharesNotMet: 'Minimum earn shares not met. Minimum: {0}, actual: {1}.',
  MinimumEngineSharesNotMet: 'Minimum engine shares not met. Minimum: {0}, actual: {1}.',
  MissingDecryptionData: 'Missing decryption data.',
  NoEarnShares: 'No earn shares were received.',
  NoPublishedVedaPeriphery: 'No Veda periphery has been published.',
  NoRecoverableClaims: 'No recoverable claims were found.',
  NoVenueSharesReceived: 'No venue shares were received.',
  NotAuthorizedForwarder: 'Caller {0} is not an authorized forwarder.',
  NotDistributor: 'Not distributor.',
  NotEarnVault: 'Not earn vault.',
  NotEmergencyGuardianOrOperator: 'Caller is not the emergency guardian or operator.',
  NotEngine: 'Not engine.',
  NotGuardianOrOwner: 'Not the guardian or owner.',
  NotOperator: 'Not operator.',
  NotPaused: 'Not paused.',
  NotPendingDistributor: 'Not pending distributor.',
  NotPendingOperator: 'Not the pending operator.',
  NotPendingOwner: 'Not the pending owner.',
  NotRequesterOrJanitor: 'Caller is not the requester or janitor.',
  NotZoneMessenger: 'Not zone messenger.',
  NothingOwed: 'Nothing is owed.',
  OnlySequencer: 'Only the sequencer may call this function.',
  OnlyZoneInbox: 'Only the zone inbox may call this function.',
  OperatorMigrationDisabled: 'Operator migration disabled.',
  OperatorTransferNotPending: 'No operator transfer is pending.',
  OracleDecimalsChanged: 'Oracle decimals changed from {0} to {1}.',
  OraclePriceToleranceExceeded: 'Oracle price {1} differs from {0} by more than {2} basis points.',
  OracleTimestampTooOld: 'Oracle timestamp {1} is before the minimum ({0}).',
  OwnableInvalidOwner: 'Owner {0} is invalid.',
  OwnableUnauthorizedAccount: 'Account {0} is not authorized.',
  OwnershipRenunciationDisabled: 'Ownership renunciation disabled.',
  Paused: 'This contract is paused.',
  PausedLiabilityIncrease: 'Cannot increase liabilities while paused.',
  PendingRedeemsOpen: 'Pending redemptions are still open.',
  PriceAnchorNotInitialized: 'Price anchor is not initialized for direction {0}.',
  PriceDeviationExceeded:
    'Price {1} deviates from anchor {2} by more than {3} basis points for direction {0}.',
  QueueTrackingDisabled: 'Tracking is disabled for queue {0}.',
  QueueUnavailable: 'Queue unavailable.',
  QueuedAssetsBelowMinimum: 'Queued assets ({1}) are below the minimum ({0}).',
  RateChangedWithinTransaction: 'Rate changed within the transaction. Expected {0}, got {1}.',
  RecipientNotAllowed: 'Recipient {0} is not allowed.',
  ReentrancyGuardReentrantCall: 'Reentrant call blocked.',
  ReentrantCall: 'Reentrant call blocked.',
  RegistryEngineMismatch: 'Registry engine mismatch. Expected {0}, got {1}.',
  RequestNotOpen: 'Request {0} is not open.',
  ResidualBacking: 'Residual backing remains.',
  ResidualBalance: 'Residual balance remains.',
  RewardRateLimitExceeded: 'Normalized reward rate {0} exceeds the baseline rate {1}.',
  RootTotalDecreased: 'Root total decreased from {0} to {1}.',
  RootTotalExceeded: 'Requested amount {0} exceeds the remaining entitlement {1}.',
  SameEngine: 'Same engine.',
  SameToken: 'Tokens must be different.',
  SettlementAlreadyConsumed: 'Settlement {0} has already been consumed.',
  SlippageExceeded: 'Amount {1} exceeds slippage limit {0}.',
  SolveUnderfunded: 'Solve for asset {0} is underfunded. Delivered: {1}, required: {2}.',
  StaleAccountantRate: 'Accountant rate updated at {0} is stale at time {1}; maximum age is {2}.',
  StaleOraclePrice: 'Oracle price timestamp {0} exceeds the maximum age ({1}).',
  StaleRootVersion: 'Stale root version. Expected {0}, got {1}.',
  StaticCallNotAllowed: 'Static call not allowed.',
  SweepExceedsAvailableBalance:
    'Sweep for token {0} exceeds the balance. Available: {1}, requested: {2}.',
  TakerNotAllowed: 'Taker {0} is not allowed.',
  TokenCallFailed: 'Token call failed.',
  TokenCallFalse: 'Token call returned false.',
  TokenTransferFailed: 'Transfer of token {0} failed.',
  TooManyWithdrawalsThisBlock: 'Too many withdrawals this block.',
  TransferPolicyMismatch: 'Transfer policy mismatch. Expected {0}, got {1}.',
  UnexpectedAssetsReceived: 'Unexpected assets received. Expected {0}, got {1}.',
  UnexpectedEarnShares: 'Unexpected earn shares. Reported: {0}, measured: {1}.',
  UnexpectedRetainedAssets: 'Unexpected assets retained. Balance before: {0}, after: {1}.',
  UnexpectedVenueSharesBurned: 'Unexpected venue shares burned. Expected {0}, got {1}.',
  UnexpectedVenueSharesQueued: 'Unexpected venue shares queued. Expected {0}, got {1}.',
  UnsupportedAccountantFreshness: 'Accountant {0} does not support freshness checks.',
  UnsupportedDecimals: 'Unsupported decimals: base {0}, quote {1}, oracle {2}.',
  UnsupportedToken: 'Token {0} is not supported.',
  UnsupportedTransferPolicy: 'Transfer policy {0} has unsupported type {1}.',
  VedaRateOutOfBounds: 'Veda rate {0} is outside the allowed range of {1} to {2}.',
  WrongInputToken: 'Incorrect input token.',
  WrongSourceZone: 'Incorrect source zone.',
  ZeroAddress: 'Address cannot be zero.',
  ZeroAmount: 'Amount cannot be zero.',
  ZeroAmountWithdrawal: 'Withdrawal amount cannot be zero.',
  ZeroCampaignId: 'Campaign ID cannot be zero.',
  ZeroDeadline: 'Deadline cannot be zero.',
  ZeroMinimumAssets: 'Minimum assets cannot be zero.',
  ZeroMinimumEarnShares: 'Minimum earn shares cannot be zero.',
  ZeroMinimumEngineShares: 'Minimum engine shares cannot be zero.',
  ZeroMinimumQueuedAssets: 'Minimum queued assets cannot be zero.',
  ZeroRoot: 'Root cannot be zero.',
  ZeroSettlementId: 'Settlement ID cannot be zero.',
  ZeroStatementHash: 'Statement hash cannot be zero.',
}

/** Human-readable messages keyed by ABI error name. */
export const messages = {
  // Keyed by signature in viem; the last overload of a name wins.
  ...Object.fromEntries(
    Object.entries(core_ExecutionError.messages).map(([signature, message]) => [
      signature.slice(0, signature.indexOf('(')),
      message,
    ]),
  ),
  ...messages_extra,
} as Record<AbiErrorName, string>

/** Interpolate `{0}`, `{1}`, … placeholders with args. */
function interpolate(template: string, args?: readonly unknown[]): string {
  if (!args) return template
  return template.replace(/\{(\d+)\}/g, (_, i) => {
    const v = args[Number(i)]
    return v === undefined ? `{${i}}` : String(v)
  })
}

/**
 * Parse a viem error into a structured execution error.
 *
 * Decodes `Abis.coreErrors` with `viem/tempo`'s `ExecutionError`, then falls
 * back to the rest of `Abis.all`.
 */
export function parse(error: Error): ExecutionError {
  const parsed = core_ExecutionError.from(error)
  if (parsed.errorName !== 'unknown') {
    const { abiItem, args, data, errorName, message } = parsed
    return { abiItem, args, data, errorName, message } as never
  }

  const data = extractRevertData(error)
  if (data) {
    try {
      const decoded = decodeErrorResult({ abi: Abis.all, data })
      const template = messages[decoded.errorName]
      return {
        ...decoded,
        data,
        message: template
          ? interpolate(template, decoded.args as readonly unknown[])
          : parsed.message,
      } as never
    } catch {}
  }

  // Fallback: extract error name from human-readable revert message.
  const raw =
    (error as { details?: string }).details ??
    (error as { shortMessage?: string }).shortMessage ??
    error.message
  const errorName = /:\s*(\w+)\(\w+/.exec(raw)?.[1]
  if (errorName && errorName in messages_extra)
    return {
      errorName: 'unknown',
      message: messages_extra[errorName as keyof typeof messages_extra],
    }

  return { errorName: 'unknown', message: parsed.message }
}

/** Serializes an ExecutionError for RPC transport (bigints/numbers → hex). */
export function serialize(preimage: ExecutionError): Rpc {
  return core_ExecutionError.serialize(preimage as never) as never
}

function extractRevertData(error: unknown, seen = new Set<unknown>()): Hex | null {
  if (!error || typeof error !== 'object' || seen.has(error)) return null
  seen.add(error)
  const e = error as Record<string, unknown>
  if (typeof e.data === 'string' && /^0x(?:[\da-f]{2})*$/i.test(e.data)) return e.data as Hex
  for (const inner of [e.data, e.cause, e.error]) {
    const data = extractRevertData(inner, seen)
    if (data) return data
  }
  if (typeof e.walk === 'function') {
    const inner = (e as { walk: (fn: (e: unknown) => boolean) => unknown }).walk(
      (e) => typeof (e as Record<string, unknown>).data === 'string',
    )
    if (inner) return extractRevertData(inner, seen)
  }
  return null
}
