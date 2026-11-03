/**
 * The options of a passkey registration, which `Actions.passkey.register` uses once, from
 * `POST /v1/account/passkey/options` or from an emailed-code sign-in's response.
 * @module
 */
import type { Types } from 'ox/webauthn'
import type { Config } from '../Id.js'
import * as Api from './api.js'

/** The options of a registration, which one registration uses. */
export type Registration = {
  /** When a registration stops using the options, in milliseconds since the epoch. */
  expiresAt: number
  /** The options of the creation ceremony, with Tempo ID's challenge. */
  options: Types.CredentialCreationOptions<true>
  /**
   * The options of the proof ceremony, without the new passkey's ID. Absent from a server that
   * returns the proof step instead.
   */
  proof?:
    | {
        /** The proof's request options, with Tempo ID's challenge. */
        options: Types.CredentialRequestOptions<true>
      }
    | undefined
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

/** Returns whether a registration can use `registration`: unexpired, and its challenge unsent. */
export function usable(registration: Registration | undefined) {
  return (
    registration !== undefined &&
    registration.expiresAt > Date.now() &&
    !sent.has(registration)
  )
}

/** Requests the options of a registration from `POST /v1/account/passkey/options`. */
export async function request(auth: Config): Promise<Registration> {
  const requestedAt = Date.now()
  const requested = await Api.json<Omit<Registration, 'expiresAt'>>(
    await Api.post(auth, '/v1/account/passkey/options', { json: {} }),
  )
  return from(requested, { requestedAt })
}
