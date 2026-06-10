export {
  defaultClaimTtl,
  getStatus,
  listStatuses,
  memoryStore,
} from './internal/handlers/multisig.js'

export type {
  ClaimSubmissionResult,
  Operation,
  Options,
  ResolveConfig,
  Sponsor,
  Status,
  Store,
} from './internal/handlers/multisig.js'

export declare namespace claimSubmission {
  /** Options for claiming submission. */
  type Options = {
    /** Claim TTL in milliseconds. */
    ttl: number
  }
}
