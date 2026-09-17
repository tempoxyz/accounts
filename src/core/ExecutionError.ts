import { type DecodeErrorResultReturnType, type Hex, decodeErrorResult } from 'viem'
import { Abis } from 'viem/tempo'

import type { OneOf, UnionOmit } from '../internal/types.js'

type AllAbis = typeof Abis.all
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
  AbdicationAlreadyScheduled: 'Capability {0} abdication is already scheduled.',
  AccountAlreadyInitialized: 'Account already initialized.',
  AccountNotAllowed: 'Account {0} is not allowed.',
  ActiveLeaderRemoved: 'The active leader cannot be removed.',
  ActiveSupplyWithoutBacking: 'Active supply has no backing.',
  AddressAlreadyHasValidator: 'This address already has a validator.',
  AddressNotReserved: 'Address is not reserved.',
  AddressReserved: 'Address is reserved.',
  AdminRelinquishmentFailed: 'Admin relinquishment failed.',
  AlreadyInitialized: 'Already initialized.',
  AmountExceedsDeposit: 'Amount exceeds deposit.',
  AmountExceedsLimit: 'Amount exceeds limit.',
  AmountNotIncreasing: 'Amount is not increasing.',
  AmountOverflow: 'Amount overflow.',
  AssetsNotArrived: 'Assets for request {0} have not arrived.',
  BadFlow: 'Invalid execution flow.',
  BaseAssetSweepBlocked: 'Base asset sweep is blocked by {0} unresolved claims.',
  BelowMinimumOrderSize: 'Order size is below the minimum allowed ({0}).',
  CallNotAllowed: 'This call is not allowed.',
  CallbackDataTooLarge: 'Callback data too large.',
  CallbackDidNotReturnToZone: 'Callback did not return to the zone.',
  CallbackRejected: 'Callback rejected.',
  CannotChangeWithinBlock: 'Cannot change within the same block.',
  CannotSweepEngineBacking: 'Cannot sweep engine backing.',
  CapabilityAbdicated: 'Capability {0} has been abdicated.',
  CaptureAmountInvalid: 'Capture amount is invalid.',
  ChannelAlreadyExists: 'Channel already exists.',
  ChannelNotFound: 'Channel not found.',
  ClaimNotClaimable: 'Claim {0} is not claimable.',
  ClaimNotOpen: 'Claim {0} is not open.',
  ClaimsExpired: 'Claims have expired.',
  ClaimsNotExpired: 'Claims have not expired.',
  CloseNotReady: 'Channel is not ready to close.',
  ContractPaused: 'Contract is paused.',
  CreditExceedsBalance:
    'Credit for asset {0} exceeds the balance. Available: {1}, requested total: {2}.',
  DepositBlockCapacityExceeded: 'Deposit block capacity of {0} exceeded.',
  DepositOverflow: 'Deposit overflow.',
  DepositTooSmall: 'Deposit too small.',
  DepositsNotActive: 'Deposits are not active.',
  DepositsNotPaused: 'Deposits are not paused.',
  DepositsPaused: 'Deposits are paused.',
  DistributorFeeUpdateNotPending: 'No distributor fee update is pending.',
  DistributorFeeUpdateNotReady: 'Distributor fee update is not executable until {0}.',
  DistributorTransferNotPending: 'No distributor transfer is pending.',
  DivisionByZero: 'Division by zero.',
  DuplicateAllowedAccount: 'Duplicate allowed account.',
  DuplicateOwner: 'Duplicate owner.',
  DuplicateRequest: 'Request {0} is duplicated.',
  DuplicateZoneGateway: 'Duplicate zone gateway.',
  EarnShareAlreadyExists: 'Earn share {0} already exists.',
  EarnShareSupplyNotZero: 'Earn share supply is not zero.',
  EarnShareSupplyOutOfBounds: 'Earn share supply {0} exceeds the maximum {1}.',
  EarnVaultNotSet: 'Earn vault is not set.',
  EmptyDeploymentId: 'Deployment ID cannot be empty.',
  EmptyEarnShareMetadata: 'Empty earn share metadata.',
  EmptyMetadata: 'Empty metadata.',
  EmptyV1ValidatorSet: 'Validator set is empty.',
  EncryptionKeyExpired: 'Encryption key {0}, activated at block {1}, expired at block {2}.',
  EngineAlreadyBound: 'Earn vault {0} is already bound to an engine.',
  EngineAlreadyExists: 'Engine {0} already exists.',
  EngineAssetMismatch: 'Engine asset mismatch.',
  EngineCapabilityUnsupported: 'Engine capability {0} is unsupported.',
  EngineEarnVaultMismatch: 'Engine earn vault mismatch.',
  EngineExitUnsupported: 'This engine does not support exits.',
  EngineSharesTooLarge: 'Engine share amount {0} is too large.',
  ExceedsMaxEarnShares: 'Maximum earn shares exceeded.',
  ExcessiveConversionLoss:
    'Conversion loss is excessive. Input shares: {0}, represented shares: {1}.',
  ExcessiveMigrationClassificationError:
    'Migration managed assets mismatch. Expected {0}, got {1}.',
  ExpiringNonceHashNotSet: 'Expiring nonce hash is not set.',
  ExpiringNonceReplay: 'Expiring nonce has already been used.',
  ExpiringNonceSetFull: 'Expiring nonce set is full.',
  ExpiryInPast: 'Expiry is in the past.',
  FactoryCannotBeFinalOwner: 'The factory cannot be the final owner.',
  FailedDeployment: 'Deployment failed.',
  FeeValuationStale: 'Fee valuation is stale.',
  FinalizedAssetMismatch: 'Finalized asset {0} does not match.',
  GasFeeRateTooHigh: 'Gas fee rate too high.',
  GasLimitTooHigh: 'Gas limit too high.',
  GlobalFeeDisableUnavailable: 'Global fee disabling is unavailable.',
  IdenticalAddresses: 'Addresses must be different.',
  IdenticalTokens: 'Cannot swap a token for itself — input and output tokens must be different.',
  Inactive: 'This contract is inactive.',
  IncompatiblePolicyType: 'Incompatible policy type.',
  IndexAlreadySet: 'Index already set.',
  IngressAlreadyExists: 'Ingress "{0}" already exists.',
  InitialEarnShareSupplyNotZero: 'Initial earn share supply must be zero.',
  InsufficientAllowance: 'Insufficient allowance.',
  InsufficientAssetsReceived: 'Insufficient assets received. Minimum: {0}, actual: {1}.',
  InsufficientBalance: 'Insufficient balance. Required: {1}, available: {0}.',
  InsufficientClaimableEarnShares: 'Insufficient claimable earn shares.',
  InsufficientEngineShareSurplus:
    'Insufficient engine share surplus. Available: {0}, requested: {1}.',
  InsufficientFeeTokenBalance: 'Insufficient fee token balance.',
  InsufficientFunding: 'Insufficient funding. Required: {0}, actual: {1}.',
  InsufficientLiquidity: 'Not enough liquidity in the order book to fill this trade.',
  InsufficientOutput:
    'The output amount is below the slippage minimum — try increasing slippage tolerance.',
  InsufficientReserves: 'Insufficient reserves.',
  InvalidAccount: 'Invalid account.',
  InvalidAdmin: 'Invalid admin.',
  InvalidAmount: 'Invalid amount.',
  InvalidArrayLengths: 'Invalid array lengths.',
  InvalidAsset: 'Invalid asset. Expected {0}, got {1}.',
  InvalidAuthority: 'Invalid authority.',
  InvalidBaseToken: 'This token is not a valid base token for the requested pair.',
  InvalidBlockNumber: 'Invalid block number.',
  InvalidBouncebackRecipient: 'Invalid bounceback recipient.',
  InvalidCallScope: 'Invalid call scope.',
  InvalidCallbackTarget: 'Invalid callback target.',
  InvalidCiphertextLength: 'Invalid ciphertext length. Expected {1}, got {0}.',
  InvalidClaimAddress: 'Invalid claim address.',
  InvalidClosedLoopConfig: 'Invalid closed loop config.',
  InvalidConfig: 'Invalid config.',
  InvalidCurrency: 'Invalid currency.',
  InvalidCurrentTxHash: 'Invalid current transaction hash.',
  InvalidDepositTransition: 'Invalid deposit transition.',
  InvalidDistributorConfig: 'Invalid distributor config.',
  InvalidDistributorConfiguration: 'Invalid distributor configuration.',
  InvalidDistributorFeeConfiguration: 'Invalid distributor fee configuration.',
  InvalidEarnDecimals: 'Invalid earn decimals.',
  InvalidEarnFeesImplementation: 'Invalid earn fees implementation.',
  InvalidEarnVault: 'Invalid earn vault.',
  InvalidEarnVaultImplementation: 'Invalid earn vault implementation.',
  InvalidEncryptedSenderCount: 'Invalid encrypted sender count. Expected {1}, got {0}.',
  InvalidEncryptedSenderLength: 'Invalid encrypted sender length. Expected {1}, got {0}.',
  InvalidEncryptionKeyIndex: 'Encryption key index {0} is invalid.',
  InvalidEngine: 'Invalid engine.',
  InvalidEngineShareScale: 'Invalid engine share scale.',
  InvalidEphemeralPubkey: 'Invalid ephemeral pubkey.',
  InvalidExpiringNonceExpiry: 'Invalid expiring nonce expiry.',
  InvalidFallbackRecipient: 'Invalid fallback recipient.',
  InvalidFeeClaimReceiver: 'Invalid fee claim receiver.',
  InvalidFeeConfiguration: 'Invalid fee configuration.',
  InvalidFlipTick: 'The flip-order price tick is invalid.',
  InvalidFormat: 'Invalid format.',
  InvalidKeyAuthorizationWitness: 'Invalid key authorization witness.',
  InvalidKeyId: 'Invalid key ID.',
  InvalidLeader: 'Invalid leader.',
  InvalidLogoURI: 'Invalid logo URI.',
  InvalidMasterAddress: 'Invalid master address.',
  InvalidMaxRateAge: 'Invalid maximum rate age.',
  InvalidMigrationIndex: 'Invalid migration index.',
  InvalidMode: 'Invalid mode.',
  InvalidMultiproof: 'Invalid multiproof.',
  InvalidNonceKey: 'Invalid nonce key.',
  InvalidOwner: 'Invalid owner.',
  InvalidOwnerOrder: 'Invalid owner order.',
  InvalidPayee: 'Invalid payee.',
  InvalidPayload: 'Invalid payload.',
  InvalidPolicyType: 'Invalid policy type.',
  InvalidPrivateAsset: 'Invalid private asset.',
  InvalidProof: 'Invalid proof.',
  InvalidProofOfPossession: 'Invalid proof of possession.',
  InvalidPublicKey: 'Invalid public key.',
  InvalidQuorumCertificate: 'Invalid quorum certificate.',
  InvalidQuoteToken: 'Invalid quote token.',
  InvalidRateTimestamp: 'Rate timestamp {0} is invalid at current time {1}.',
  InvalidReceipt: 'Invalid receipt.',
  InvalidReceivePolicyType: 'Invalid receive policy type.',
  InvalidRecipient: 'Invalid recipient.',
  InvalidRecoveryAuthority: 'Invalid recovery authority.',
  InvalidReturnToken: 'Invalid return token.',
  InvalidRevealTo: 'Invalid reveal to.',
  InvalidRoutePair: 'Invalid route pair.',
  InvalidSequencerSet: 'Invalid sequencer set.',
  InvalidSignature: 'Invalid signature.',
  InvalidSignatureFormat: 'Invalid signature format.',
  InvalidSignatureType: 'Invalid signature type.',
  InvalidSourcePortal: 'Invalid source portal.',
  InvalidSpendingLimit: 'Invalid spending limit.',
  InvalidSupplyCap: 'Invalid supply cap.',
  InvalidSwapCalculation: 'Invalid swap calculation.',
  InvalidTempoBlockNumber: 'Invalid tempo block number.',
  InvalidThreshold: 'Invalid threshold.',
  InvalidTick: 'The price tick is invalid.',
  InvalidToken: 'This token is not supported on the exchange.',
  InvalidTrackedRequest: 'Tracked request {0} is invalid.',
  InvalidTransactionLimit: 'Invalid transaction limit.',
  InvalidTransferPolicy: 'Transfer policy {0} is invalid.',
  InvalidTransferPolicyId: 'Invalid transfer policy.',
  InvalidValidatorAddress: 'Invalid validator address.',
  InvalidVedaPeriphery: 'Account {0} is not a valid Veda periphery.',
  InvalidVedaPeripheryWiring:
    'Invalid Veda periphery wiring for component {0}. Expected {1}, got {2}.',
  InvalidVedaRateBounds: 'Invalid Veda rate bounds. Minimum: {0}, maximum: {1}.',
  InvalidVenueShareDecimals: 'Invalid venue share decimals.',
  InvalidWeight: 'Invalid weight.',
  InvalidWithdrawalCount: 'Invalid withdrawal count. Expected {1}, got {0}.',
  IssuerGrantFailed: 'Issuer grant failed.',
  KeyAlreadyExists: 'Key already exists.',
  KeyAlreadyRevoked: 'Key has already been revoked.',
  KeyAuthorizationWitnessAlreadyBurned: 'Key authorization witness has already been burned.',
  KeyExpired: 'Key has expired.',
  KeyNotFound: 'Key not found.',
  LeaderAlreadyUpdatedThisBlock: 'The leader has already been updated this block.',
  LegacyAuthorizeKeySelectorChanged: 'Legacy authorize key selector changed to {0}.',
  LogoURITooLong: 'Logo URI is too long.',
  MasterIdCollision: 'Master ID collision with {0}.',
  MaxInputExceeded:
    'The required input exceeds the slippage maximum — try increasing slippage tolerance.',
  MaxManagedAssetsExceeded: 'Maximum managed assets {0} exceeded by actual amount {1}.',
  MerkleProofInvalidMultiproof: 'Invalid Merkle multiproof.',
  MigrationNotComplete: 'Migration is not complete.',
  MinimumAssetsNotMet: 'Minimum assets not met. Minimum: {0}, actual: {1}.',
  MinimumEarnSharesNotMet: 'Minimum earn shares not met. Minimum: {0}, actual: {1}.',
  MinimumEngineSharesNotMet: 'Minimum engine shares not met. Minimum: {0}, actual: {1}.',
  MustDelegateCall: 'This function must be called with delegatecall.',
  NoEarnShares: 'No earn shares were received.',
  NoEncryptionKeyAtBlock: 'No encryption key exists at block {0}.',
  NoEncryptionKeySet: 'No encryption key set.',
  NoOptedInSupply: 'No opted-in supply.',
  NoPublishedVedaPeriphery: 'No Veda periphery has been published.',
  NoRecoverableClaims: 'No recoverable claims were found.',
  NoVenueSharesReceived: 'No venue shares were received.',
  NonceOverflow: 'Nonce overflow.',
  NotAdmin: 'Not admin.',
  NotAuthorizedForwarder: 'Caller {0} is not an authorized forwarder.',
  NotDistributor: 'Not distributor.',
  NotEarnVault: 'Not earn vault.',
  NotEmergencyGuardianOrOperator: 'Caller is not the emergency guardian or operator.',
  NotEngine: 'Not engine.',
  NotFactory: 'Not factory.',
  NotHostPort: '"{1}" is not a valid host:port for {0}.',
  NotInitialized: 'Not initialized.',
  NotIp: '"{0}" is not a valid IP address.',
  NotIpPort: '"{1}" is not a valid IP:port for {0}.',
  NotMultisigAccount: 'Not multisig account.',
  NotOperator: 'Not operator.',
  NotOwner: 'Not owner.',
  NotPauseAuthority: 'Not pause authority.',
  NotPayeeOrOperator: 'Not payee or operator.',
  NotPayer: 'Not payer.',
  NotPendingAdmin: 'Not pending admin.',
  NotPendingDistributor: 'Not pending distributor.',
  NotRequesterOrJanitor: 'Caller is not the requester or janitor.',
  NotSelf: 'Not self.',
  NotSequencer: 'Not sequencer.',
  NotZoneMessenger: 'Not zone messenger.',
  NothingOwed: 'Nothing is owed.',
  OnlyDirectCall: 'Only direct calls are allowed.',
  OnlySequencer: 'Only the sequencer may call this function.',
  OnlyZoneInbox: 'Only the zone inbox may call this function.',
  OperatorMigrationDisabled: 'Operator migration disabled.',
  OrderDoesNotExist: 'No order exists with the given ID.',
  OrderNotStale: 'This order is not yet eligible for stale-cleanup.',
  OwnableInvalidOwner: 'Owner {0} is invalid.',
  OwnableUnauthorizedAccount: 'Account {0} is not authorized.',
  OwnershipRenunciationDisabled: 'Ownership renunciation disabled.',
  PairAlreadyExists: 'A trading pair for these tokens has already been created.',
  PairDoesNotExist: 'No trading pair exists for these tokens.',
  Paused: 'This contract is paused.',
  PausedLiabilityIncrease: 'Cannot increase liabilities while paused.',
  PendingRedeemsOpen: 'Pending redemptions are still open.',
  PermitExpired: 'Permit has expired.',
  PolicyForbids: 'Forbidden by policy.',
  PolicyNotFound: 'Policy not found.',
  PolicyNotSimple: 'Policy is not a simple policy.',
  PortalIsPaused: 'Portal is paused.',
  ProofOfWorkFailed: 'Proof of work failed.',
  ProtectedAddress: 'Address is protected.',
  ProtocolNonceNotSupported: 'Protocol nonce is not supported.',
  PublicKeyAlreadyExists: 'Public key already exists.',
  QueueTrackingDisabled: 'Tracking is disabled for queue {0}.',
  QueueUnavailable: 'Queue unavailable.',
  RateChangedWithinTransaction: 'Rate changed within the transaction. Expected {0}, got {1}.',
  ReentrancyGuardReentrantCall: 'Reentrant call blocked.',
  ReentrantCall: 'Reentrant call blocked.',
  ReentrantWithdrawal: 'Reentrant withdrawal blocked.',
  RegistryEngineMismatch: 'Registry engine mismatch. Expected {0}, got {1}.',
  RequestNotOpen: 'Request {0} is not open.',
  ResidualBacking: 'Residual backing remains.',
  ResidualBalance: 'Residual balance remains.',
  RewardRateLimitExceeded: 'Normalized reward rate {0} exceeds the baseline rate {1}.',
  RootTotalDecreased: 'Root total decreased from {0} to {1}.',
  RootTotalExceeded: 'Requested amount {0} exceeds the remaining entitlement {1}.',
  SameEngine: 'Same engine.',
  SameTransactionUpdateNotAllowed: 'Same transaction update not allowed.',
  SequencerConfigurationUnchanged: 'Sequencer configuration unchanged.',
  SignatureTypeMismatch: 'Signature type mismatch. Expected {0}, got {1}.',
  SolveUnderfunded: 'Solve for asset {0} is underfunded. Delivered: {1}, required: {2}.',
  SpendingLimitExceeded: 'Spending limit exceeded.',
  StaleAccountantRate: 'Accountant rate updated at {0} is stale at time {1}; maximum age is {2}.',
  StaleLeadershipEpoch: 'Stale leadership epoch. Expected {0}, got {1}.',
  StaleRootVersion: 'Stale root version. Expected {0}, got {1}.',
  StaticCallNotAllowed: 'Static call not allowed.',
  SupplyCapExceeded: 'Supply cap exceeded.',
  SweepExceedsAvailableBalance:
    'Sweep for token {0} exceeds the balance. Available: {1}, requested: {2}.',
  TickOutOfBounds: 'Price tick {0} is outside the allowed range.',
  TokenAlreadyEnabled: 'Token already enabled.',
  TokenAlreadyExists: 'Token {0} already exists.',
  TokenCallFailed: 'Token call failed.',
  TokenCallFalse: 'Token call returned false.',
  TokenEnablementBlockCapacityExceeded: 'Token enablement block capacity of {0} exceeded.',
  TokenMetadataTooLong: 'Token metadata too long.',
  TokenNotEnabled: 'Token not enabled.',
  TokenTransferPolicyNotSet: 'Token transfer policy not set.',
  TooManyOwners: 'Too many owners.',
  TooManyWithdrawalsThisBlock: 'Too many withdrawals this block.',
  TransferFailed: 'Transfer failed.',
  TransferPolicyMismatch: 'Transfer policy mismatch. Expected {0}, got {1}.',
  Unauthorized: 'Unauthorized.',
  UnauthorizedCaller: 'Unauthorized caller.',
  UnauthorizedClaimer: 'Unauthorized claimer.',
  UnexpectedAssetsReceived: 'Unexpected assets received. Expected {0}, got {1}.',
  UnexpectedEarnShares: 'Unexpected earn shares. Reported: {0}, measured: {1}.',
  UnexpectedRetainedAssets: 'Unexpected assets retained. Balance before: {0}, after: {1}.',
  UnexpectedVenueSharesBurned: 'Unexpected venue shares burned. Expected {0}, got {1}.',
  UnexpectedVenueSharesQueued: 'Unexpected venue shares queued. Expected {0}, got {1}.',
  Uninitialized: 'Uninitialized.',
  UnsupportedAccountantFreshness: 'Accountant {0} does not support freshness checks.',
  UnsupportedTransferPolicy: 'Transfer policy {0} has unsupported type {1}.',
  ValidatorAlreadyDeactivated: 'Validator is already deactivated.',
  ValidatorAlreadyExists: 'Validator already exists.',
  ValidatorNotFound: 'Validator not found.',
  VedaRateOutOfBounds: 'Veda rate {0} is outside the allowed range of {1} to {2}.',
  VirtualAddressNotAllowed: 'Virtual address is not allowed.',
  VirtualAddressUnregistered: 'Virtual address is not registered.',
  WrongInputToken: 'Incorrect input token.',
  WrongSourceZone: 'Incorrect source zone.',
  ZeroAddress: 'Address cannot be zero.',
  ZeroAmount: 'Amount cannot be zero.',
  ZeroAmountWithdrawal: 'Withdrawal amount cannot be zero.',
  ZeroCampaignId: 'Campaign ID cannot be zero.',
  ZeroDeadline: 'Deadline cannot be zero.',
  ZeroDeposit: 'Deposit cannot be zero.',
  ZeroMinimumAssets: 'Minimum assets cannot be zero.',
  ZeroMinimumEarnShares: 'Minimum earn shares cannot be zero.',
  ZeroMinimumEngineShares: 'Minimum engine shares cannot be zero.',
  ZeroPublicKey: 'Public key cannot be zero.',
  ZeroRoot: 'Root cannot be zero.',
  ZeroStatementHash: 'Statement hash cannot be zero.',
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
      const decoded = decodeErrorResult({ abi: Abis.all, data })
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
