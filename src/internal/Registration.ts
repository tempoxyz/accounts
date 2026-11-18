/**
 * The options of a passkey registration, which `Actions.passkey.register` uses once, from
 * `POST /v1/account/passkey/options` or from an emailed-code sign-in's response.
 * @module
 */
import { Address, type Hex, type PublicKey } from 'ox'
import { AccountConfig, KeyAuthorization } from 'ox/tempo'
import type { Types } from 'ox/webauthn'
import { Account } from 'viem/tempo'
import type { Config } from '../Accounts.js'
import * as Api from './Api.js'

/** The options of a registration, which one registration uses. */
export type Registration = {
  /** When a registration stops using the options, in milliseconds since the epoch. */
  expiresAt: number
  /**
   * The key authorization that the new passkey signs for the configurable account that it owns,
   * RLP-encoded, without that account and without a signature. Present in place of `proof` for an
   * access key on a chain whose accounts are configurable, where {@link challenge} derives the
   * proof's challenge from it.
   */
  keyAuthorization?: Hex.Hex | undefined
  /** The options of the creation ceremony, with Tempo ID's challenge. */
  options: Types.CredentialCreationOptions<true>
  /**
   * The options of the proof ceremony, without the new passkey's ID. Absent beside
   * `keyAuthorization`, and from a server that returns the proof step instead.
   */
  proof?:
    | {
        /** The proof's request options, with Tempo ID's challenge. */
        options: Types.CredentialRequestOptions<true>
      }
    | undefined
  /**
   * Whether the proof challenge is the access key's digest of the sign-in that returned the options,
   * such as a new user's passkey account's after an emailed code, so a registration with that access
   * key uses them in place of requesting its own.
   */
  signsAccessKey?: true | undefined
}

/**
 * How long a registration uses its options, in milliseconds: a minute short of the 5 minutes that
 * their challenge lasts, so the challenge stays valid through both ceremonies.
 */
const lifetime = 4 * 60 * 1000

/** Returns the registration options of a response, which expire from `requestedAt`. */
export function from(
  value: Omit<Registration, 'expiresAt'>,
  options: from.Options,
): Registration {
  return {
    expiresAt: options.requestedAt + lifetime,
    ...(value.keyAuthorization
      ? { keyAuthorization: value.keyAuthorization }
      : {}),
    options: value.options,
    ...(value.proof ? { proof: value.proof } : {}),
  }
}

export declare namespace from {
  type Options = {
    /**
     * When the request that returned the options started, in milliseconds since the epoch. The
     * challenge's lifetime starts at Tempo ID before the response arrives.
     */
    requestedAt: number
  }
}

/**
 * The options whose registration challenge a request already sent, which Tempo ID spends at that
 * request whether or not the registration succeeds. Weak, so it holds no options alive.
 */
const sent = new WeakSet<Registration>()

/**
 * Records that a request sends the registration challenge of `registration`, so a later
 * registration, such as a retry, requests new options.
 */
export function send(registration: Registration) {
  sent.add(registration)
}

/** Returns `registration`, marked as one whose proof signs the access key of its sign-in. */
export function bind(registration: Registration): Registration {
  return { ...registration, signsAccessKey: true }
}

/**
 * Returns the proof's challenge for options with `keyAuthorization`: the digest of that key
 * authorization for the configurable account that the new passkey with `publicKey` owns alone.
 * The digest binds the account, which has no address before the passkey, so Tempo ID cannot issue
 * it with the options. Tempo ID derives the same digest from the credential, and verifies the
 * proof against it.
 */
export function challenge(
  keyAuthorization: Hex.Hex,
  options: challenge.Options,
): Hex.Hex {
  // Tempo ID installs this configuration for a passkey account: the passkey's key address as the
  // only owner, at Viem's defaults of threshold 1 and the zero salt.
  const account = Account.fromConfig({
    owners: [Address.fromPublicKey(options.publicKey)],
  })
  return AccountConfig.getSignPayload({
    account: account.address,
    config: account.config,
    payload: KeyAuthorization.getSignPayload({
      ...KeyAuthorization.deserialize(keyAuthorization),
      account: account.address,
    }),
  })
}

export declare namespace challenge {
  type Options = {
    /** The public key of the new passkey, as the creation ceremony returned it. */
    publicKey: PublicKey.PublicKey
  }
}

/** Returns whether the proof of `registration` signs the access key of its sign-in. */
export function bound(registration: Registration) {
  return registration.signsAccessKey === true
}

/** Returns whether a registration can use `registration`: unexpired, and its challenge unsent. */
export function usable(registration: Registration | undefined) {
  return (
    registration !== undefined &&
    registration.expiresAt > Date.now() &&
    !sent.has(registration)
  )
}

/**
 * Requests the options of a registration from `POST /v1/account/passkey/options`. With `authorize`,
 * the proof challenge is the digest of its access key, so the proof signs the access key too.
 */
export async function request(
  auth: Config,
  options: request.Options = {},
): Promise<Registration> {
  const { authorize } = options
  const requestedAt = Date.now()
  const requested = await Api.json<Omit<Registration, 'expiresAt'>>(
    await Api.post(auth, '/v1/account/passkey/options', {
      json: authorize ? { authorize } : {},
    }),
  )
  return from(requested, { requestedAt })
}

export declare namespace request {
  type Options = {
    /** The headless authorization request that the registration runs. Absent for a registration alone. */
    authorize?: unknown
  }
}
