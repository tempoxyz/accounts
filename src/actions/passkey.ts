/**
 * Signs the user in with a passkey from the app's own sign-in form, and authorizes the app's access key.
 * The handle of {@link prepare} requests the sign-in's options before the user acts, so its sign-in
 * starts the ceremony without a request. {@link register} adds a passkey for the signed-in user
 * from the app's page.
 * @module
 */
import {
  Authentication,
  Credential,
  Registration,
  type Types,
} from 'ox/webauthn'
import { type Config, ChallengeWithoutKeyError, RequestError } from '../Id.js'
import type { Authorization } from '../Authorization.js'
import type * as AccessKey_public from '../AccessKey.js'
import type * as AccessKey from '../internal/accessKey.js'
import * as Api from '../internal/api.js'
import * as Headless from '../internal/headless.js'
import * as RegistrationOptions from '../internal/registration.js'
import type { ChainId, Keyed, WithAccount } from '../Permissions.js'

/**
 * Returns whether a passkey sign-in for the app runs on this page, from `GET /v1/realms`: the page
 * is on one of the app's redirect URI origins, and a realm's passkeys cover the page and Tempo ID.
 * The handle of {@link prepare} requests options only where it returns `true`, so no options request
 * fails. Returns `false` from a server that does not report it, and where the browser cannot read
 * the response, such as on a page of no first-party app, which receives no CORS grant.
 *
 * @example
 * ```ts
 * if (await Actions.passkey.available(auth)) showPasskeyButton()
 * ```
 */
export async function available(auth: Config): Promise<boolean> {
  const response = await (auth.fetch ?? fetch)(
    new URL(
      `/v1/realms?${new URLSearchParams({ client_id: auth.clientId })}`,
      auth.url,
    ),
  ).catch(() => undefined)
  // The browser refuses a response without a CORS grant, as to a page of no first-party app, where
  // the options request would fail too.
  if (!response) return false
  // A refusal or an unreadable body, such as during an outage, offers no passkey either.
  const body = await Api.json<{ passkeys?: boolean | undefined }>(
    response,
  ).catch(() => undefined)
  return body?.passkeys === true
}

/**
 * How long a sign-in uses prepared options, in milliseconds: a minute short of the 5 minutes that
 * their challenge lasts, so the challenge stays valid through the ceremony.
 */
const preparedLifetime = 4 * 60 * 1000

/**
 * Prepares a passkey sign-in before the user acts, such as when the sign-in form shows, and
 * returns its handle. The handle checks {@link available}, and where it returns `true`, requests
 * the sign-in's options and the access key that it authorizes, so the handle's `signIn` starts the
 * ceremony without a request. Create a new handle when the request options change.
 *
 * The handle owns its options. A sign-in uses them once, and requests new ones after 4 minutes.
 * A ceremony that the user cancels leaves them unspent for the next sign-in. A sign-in that sends
 * its assertion spends their challenge, so after a refusal the handle prepares new options.
 *
 * `prepare` never throws, and a failed request leaves no options. The handle's `signIn` then
 * requests them, and throws what {@link signIn} throws.
 *
 * @example
 * ```ts
 * // Once the sign-in form shows:
 * const passkey = Actions.passkey.prepare(auth, { accessKey })
 * if (await passkey.available) showPasskeyButton()
 * // On the passkey button:
 * const result = await passkey.signIn()
 * ```
 */
export function prepare<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: prepare.Options<accessKey> = {},
): prepare.ReturnType<ChainId<accessKey>, Keyed<accessKey>> {
  const ready = available(auth).catch(() => false)
  // Requests options only where passkeys sign in, so no request fails on a page without them.
  const ahead = () =>
    ready
      .then((passkeys) =>
        passkeys ? requestOptions(auth, options) : undefined,
      )
      .catch(() => undefined)
  let pending: Promise<Prepared | undefined> | undefined = ahead()

  return {
    available: ready,
    async signIn(signInOptions = {}) {
      // Takes the options before the first await, so a sign-in that starts beside this one
      // requests options of its own instead of the same challenge.
      const taken = pending
      pending = undefined
      const entry = await taken
      const prepared =
        entry && entry.expiresAt > Date.now()
          ? entry
          : await requestOptions(auth, options)
      const assertion = await sign(prepared, signInOptions).catch(
        (error: unknown) => {
          // The ceremony sent no assertion, so the challenge is unspent for the next sign-in.
          pending ??= Promise.resolve(prepared)
          throw error
        },
      )
      return (await verify(auth, { assertion, prepared }).catch(
        (error: unknown) => {
          pending ??= ahead()
          throw error
        },
      )) as signIn.ReturnType<ChainId<accessKey>, Keyed<accessKey>>
    },
  }
}

export declare namespace prepare {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = {
    /**
     * The access key to request: what it may do, and the app's own access key as `account`, which
     * defaults to a new access key. Without it, the sign-in authorizes no access key. Within the
     * headless ceiling, unless the app holds `tempo-id:sign`.
     */
    accessKey?: accessKey
    /**
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope and an access key.
     */
    challenge?: ([accessKey] extends [undefined] ? never : string) | undefined
    /**
     * The credential ID, or up to 16 IDs, that the browser offers. Each is unpadded base64url of 1
     * to 1,023 bytes, or the call throws `invalid_field`. Defaults to every passkey.
     */
    credentialId?: readonly string[] | string | undefined
    /** The browser's mediation, such as `conditional` for autofill. Defaults to its own. */
    mediation?: 'conditional' | 'optional' | 'required' | 'silent' | undefined
    /**
     * Whether the browser offers every passkey of the relying party, for a sign-in that starts
     * with no known user, such as one that switches accounts. Leave out `credentialId` with it.
     * Defaults to `false`: with a session, the browser offers only the signed-in user's passkeys.
     */
    select?: boolean | undefined
  }

  /** The prepared sign-in's handle. */
  type ReturnType<
    chainId extends number = number,
    key extends boolean = false,
  > = {
    /** Whether a passkey sign-in runs on this page, as {@link available} returns. Never rejects. */
    available: Promise<boolean>
    /**
     * Signs in as {@link signIn} does, with the handle's options. Requests new options if the
     * handle holds none, or if they are older than 4 minutes.
     */
    signIn: (
      options?: SignInOptions,
    ) => Promise<signIn.ReturnType<chainId, key>>
  }

  /** The options of the handle's `signIn`. */
  type SignInOptions = Pick<signIn.Options, 'getFn'>
}

/**
 * Registers a new passkey for the signed-in user from a first-party app's page, and returns its
 * credential ID and the address of the Tempo Account that it owns. The passkey belongs to the
 * `default` realm's relying party, which must cover the page and Tempo ID. It runs two ceremonies:
 * the authenticator creates the passkey, then the new passkey signs a proof challenge, so call it
 * from a click.
 *
 * With `key`, the access key of a sign-in on a cloud wallet's configurable account, the passkey joins that
 * account as a second owner on the access key's chain, through an update that the cloud wallet signs. The
 * access key keeps working. On a chain whose accounts are not configurable, `key` sets nothing, and the
 * passkey owns an account of its own. `account` and `chain` name the account and chain instead.
 *
 * Requires a sign-in within the last 10 minutes, or throws `reauthentication_required`. A user who
 * holds 10 passkeys throws `passkey_limit`, and a page that the relying party does not cover throws
 * `passkey_not_permitted`.
 *
 * @example
 * ```ts
 * const authorization = await Actions.email.signIn(auth, { code, email })
 * const { address, id } = await Actions.passkey.register(auth, {
 *   key: authorization.key,
 * })
 * ```
 */
export async function register(
  auth: Config,
  options: register.Options = {},
): Promise<register.ReturnType> {
  const { createFn, getFn, key } = options
  // Tempo ID reads a chain ID in `chain` as it reads a name. It decides whether the access key's chain
  // takes an owner, so the page reads no chain list.
  const chain = options.chain ?? options.chainId
  // A sign-in's registration options save the options request while their challenge lasts.
  const prepared =
    options.registration && RegistrationOptions.usable(options.registration)
      ? options.registration
      : await RegistrationOptions.request(auth)
  // A server whose options carry no proof predates `key` on the verify request, and would register
  // the passkey on an account of its own. The call refuses before any prompt instead.
  if (
    key &&
    !prepared.proof &&
    (options.account === undefined || chain === undefined)
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'key',
      message: `Unsupported option: Tempo ID at ${auth.url} predates \`key\` on passkey registration. Pass \`account\` and \`chain\` in its place, or update Tempo ID.`,
      status: 0,
    })
  const deserialized = Registration.deserializeOptions(prepared.options)
  const credential = Credential.serialize(
    await Registration.create(
      // ox reads `createFn` beside creation options at runtime, which its types admit only beside flat options.
      createFn ? ({ ...deserialized, createFn } as never) : deserialized,
    ),
  )

  const created = {
    credentialId: credential.id,
    rpId: prepared.options.publicKey!.rp.id!,
  }

  // The attestation proves no private key, so the new passkey signs a proof challenge before
  // Tempo ID stores it. The options carry the proof challenge, so the proof needs no request, and
  // the verify request carries the credential. A server without it returns the proof step. A
  // failure before the proof leaves the passkey unstored, so the authenticator drops it.
  const assertion = await (async () => {
    try {
      const proof = await (async () => {
        if (prepared.proof)
          return Authentication.deserializeOptions({
            publicKey: {
              ...prepared.proof.options.publicKey!,
              allowCredentials: [{ id: credential.id, type: 'public-key' }],
            },
          })
        // The request spends the registration challenge, so a retry requests new options.
        RegistrationOptions.send(prepared)
        const { step } = await Api.json<{
          step: { options: Types.CredentialRequestOptions<true> }
        }>(
          await Api.post(auth, '/v1/account/passkey', { json: { credential } }),
        )
        return Authentication.deserializeOptions(step.options)
      })()
      return Authentication.serializeResponse(
        await Authentication.sign(
          // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
          getFn ? ({ ...proof, getFn } as never) : proof,
        ),
      )
    } catch (error) {
      forget(created)
      throw error
    }
  })()

  // With the credential, the verify request spends the registration challenge, so a retry requests
  // new options.
  if (prepared.proof) RegistrationOptions.send(prepared)
  // A request that receives no response throws here, and the authenticator keeps the passkey,
  // since Tempo ID may have stored it.
  const response = await Api.post(auth, '/v1/account/passkey/verify', {
    json: {
      ...(options.account ? { account: options.account } : {}),
      assertion,
      ...(chain !== undefined ? { chain } : {}),
      ...(prepared.proof ? { credential } : {}),
      ...(key
        ? { accessKey: { account: key.account, chainId: key.chainId } }
        : {}),
    },
  })
  try {
    const registered = await Api.json<register.ReturnType>(response)
    return { address: registered.address, id: registered.id }
  } catch (error) {
    // Tempo ID marks a failure after the store, such as `config_conflict` from the owner change, so
    // the authenticator keeps that passkey. A response without a `reason`, such as a gateway's, may
    // follow the store, so it keeps the passkey too. A server whose options carry no proof marks
    // none, so only its refusals drop the passkey.
    const dropped = prepared.proof
      ? response.headers.get(storedHeader) !== 'true' &&
        error instanceof RequestError &&
        error.reason !== undefined
      : refused(error)
    if (dropped) forget(created)
    throw error
  }
}

export declare namespace register {
  type Options = {
    /**
     * A configurable Tempo Account of the user's cloud wallet, which the passkey joins as a second
     * owner on `chain`. Defaults to `key.account` on a chain whose accounts are configurable, else
     * none, and the passkey owns an account of its own.
     */
    account?: `0x${string}` | undefined
    /**
     * The chain whose accounts are configurable, by its name in `GET /v1/chains`, such as
     * `testnet`, or its ID. It selects where `account` is, and the chain of the address that the
     * call returns. Defaults to the chain of `key` when its accounts are configurable, else the
     * first such chain for `account`, and the passkey's own address otherwise. Tempo ID refuses an
     * unknown chain with `invalid_field` at the last request, after both ceremonies.
     */
    chain?: number | string | undefined
    /** The chain whose accounts are configurable, by its ID, in place of `chain`. */
    chainId?: number | undefined
    /** Runs the creation ceremony in place of `navigator.credentials.create`. */
    createFn?: Registration.create.Options['createFn'] | undefined
    /** Runs the proof ceremony in place of `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * The access key of a sign-in on the cloud wallet's account, such as `authorization.key`. Tempo ID
     * reads its chain: on a chain whose accounts are configurable, the access key sets the default
     * `account` and `chain`. Registration does not use the access key otherwise.
     */
    key?: Pick<AccessKey_public.AccessKey, 'account' | 'chainId'> | undefined
    /**
     * The registration options that `Actions.email.signIn` returned with `registration: true`,
     * which save the options request. Options older than 4 minutes, or absent, are requested.
     */
    registration?: Registration | undefined
  }

  /** The options of a registration, which one registration uses. */
  type Registration = RegistrationOptions.Registration

  /** The new passkey and the account that it owns. */
  type ReturnType = {
    /** The address of the Tempo Account that the passkey owns: `account`, or its own on `chain`. */
    address: `0x${string}`
    /** The credential ID of the passkey, base64url. */
    id: string
  }
}

/**
 * Signs the user in with a passkey, and authorizes a first-party app with the same assertion. The
 * access key must fit the headless ceiling. A user without a Tempo Account receives one.
 *
 * Returns an email step for a wallet.tempo passkey whose account has no email. Pass its `link` to
 * `Actions.email.signIn`.
 *
 * A page off the app's redirect URI origins throws `invalid_origin`, and one that the realms'
 * relying party does not cover throws `passkey_not_permitted`. A refusal after the passkey verified
 * has `signedIn: true`. An account that another passkey owns throws `webauthn_required`, so
 * authorize through `Actions.redirect.start`.
 *
 * A wallet.tempo passkey's account that waits for its upgrade signs the access key as the passkey's own
 * account, and `upgradeAvailable` is `true`. `Actions.account.upgrade` with the access key then upgrades
 * the account with one more prompt, after Tempo ID registers the access key.
 *
 * It requests the sign-in's options when called. {@link prepare} requests them before the user
 * acts instead.
 *
 * @example
 * ```ts
 * const result = await Actions.passkey.signIn(auth)
 * if ('step' in result) showEmailForm()
 * ```
 */
export async function signIn<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: signIn.Options<accessKey> = {},
): Promise<signIn.ReturnType<ChainId<accessKey>, Keyed<accessKey>>> {
  const prepared = await requestOptions(auth, options)
  const assertion = await sign(prepared, options)
  // `key` decides both the type and the runtime value of the result.
  return (await verify(auth, { assertion, prepared })) as signIn.ReturnType<
    ChainId<accessKey>,
    Keyed<accessKey>
  >
}

export declare namespace signIn {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = prepare.Options<accessKey> & {
    /**
     * Runs the WebAuthn ceremony in place of `navigator.credentials.get`. Its assertion must report
     * the page's origin, so Tempo ID refuses an Android facet origin.
     */
    getFn?: Authentication.sign.Options['getFn'] | undefined
  }

  /** The step of a wallet.tempo passkey without an email: an emailed code links it. */
  type EmailStep = {
    /** The `link` that `Actions.email.signIn` takes to link the passkey to its user. */
    link: string
    /** The kind of step. */
    type: 'email'
  }

  /**
   * The authorization, without its access key for a sign-in without `accessKey`, and whether its
   * account can upgrade, or the email step.
   */
  type ReturnType<
    chainId extends number = number,
    key extends boolean = false,
  > =
    | ((key extends false
        ? Omit<Authorization<chainId>, 'accessKey' | 'key'>
        : Authorization<chainId>) & {
        /**
         * Whether the access key's account is a wallet.tempo passkey's that waits for its upgrade on the
         * access key's chain. `Actions.account.upgrade` with the access key upgrades it, and keeps the access key.
         */
        upgradeAvailable: boolean
      })
    | {
        /** The email step, which comes before the authorization. */
        step: EmailStep
      }
}

/**
 * Signals the browser to drop the passkey `credentialId`, which Tempo ID did not store, where the
 * browser supports the signal. The signal is best effort: a passkey that stays signs in nowhere.
 */
function forget(options: { credentialId: string; rpId: string }) {
  if (typeof PublicKeyCredential === 'undefined') return
  const signal = (
    PublicKeyCredential as {
      signalUnknownCredential?: (options: {
        credentialId: string
        rpId: string
      }) => Promise<void>
    }
  ).signalUnknownCredential
  // The registration's result does not depend on the signal, so its failure is ignored.
  void signal
    ?.call(PublicKeyCredential, {
      credentialId: options.credentialId,
      rpId: options.rpId,
    })
    .catch(() => {})
}

/** The header of a failed registration whose passkey Tempo ID stored, as `Passkey.storedHeader`. */
const storedHeader = 'Tempo-Id-Passkey-Stored'

/**
 * Returns whether Tempo ID refused a request with a 4xx and a `reason`, so it stored nothing. An
 * owner change can return `config_conflict` or `rate_limited` after it stores the passkey.
 */
function refused(error: unknown) {
  return (
    error instanceof RequestError &&
    error.reason !== undefined &&
    error.reason !== 'config_conflict' &&
    error.reason !== 'rate_limited' &&
    error.status < 500
  )
}

/** A passkey sign-in's options and the access key that they authorize, which one sign-in uses. */
type Prepared = {
  /** The authorization request that the options carry, which the passkey step repeats. */
  authorize: Awaited<ReturnType<typeof Headless.prepare>>['authorize']
  /** When a sign-in stops using the options, in milliseconds since the epoch. */
  expiresAt: number
  /** The access key that the options authorize. Absent without `accessKey`. */
  key: AccessKey.resolve.ReturnType | undefined
  /** The options of the WebAuthn ceremony, with Tempo ID's challenge. */
  options: Types.CredentialRequestOptions
  /** The request options, which the authorization reads once the passkey verifies. */
  request: prepare.Options
}

/**
 * Requests the options of a passkey sign-in, and the access key that they authorize.
 * @throws {ChallengeWithoutKeyError} For a challenge without `accessKey`, before any request.
 */
async function requestOptions(
  auth: Config,
  options: prepare.Options,
): Promise<Prepared> {
  const { credentialId, mediation, select } = options
  // A challenge rides in the access key, so a sign-in without one refuses it before it signs in.
  if (!options.accessKey && options.challenge !== undefined)
    throw new ChallengeWithoutKeyError()
  // The options carry the authorization request, so the challenge is its access key's digest.
  const { authorize, key } = await Headless.prepare(auth, options)
  // The challenge's lifetime starts at Tempo ID before the response arrives, so the options' does too.
  const requestedAt = Date.now()
  const requested = await Api.json<{
    options: Types.CredentialRequestOptions<true>
  }>(
    await Api.post(auth, '/v1/auth/passkey/options', {
      json: {
        authorize,
        // The app's realms decide the relying party, which must cover the page's origin.
        client_id: auth.clientId,
        ...(credentialId === undefined ? {} : { credentialId }),
        ...(mediation === undefined ? {} : { mediation }),
        ...(select ? { select: true } : {}),
      },
    }),
  )
  return {
    authorize,
    expiresAt: requestedAt + preparedLifetime,
    key,
    options: Authentication.deserializeOptions(requested.options),
    request: options,
  }
}

/** Runs the WebAuthn ceremony over the prepared options, and returns the serialized assertion. */
async function sign(prepared: Prepared, options: prepare.SignInOptions) {
  const { getFn } = options
  return Authentication.serializeResponse(
    await Authentication.sign(
      // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
      getFn ? ({ ...prepared.options, getFn } as never) : prepared.options,
    ),
  )
}

/** Sends the assertion, and returns the authorization, or the email step of a passkey without one. */
async function verify(auth: Config, options: verify.Options) {
  const { assertion, prepared } = options
  const body = await Headless.read<
    | { authorization?: Api.Headless | undefined; user: { id: string } }
    | { step: signIn.EmailStep }
  >(
    await Api.post(auth, '/v1/auth/passkey/verify', {
      // The prepared authorization's code redeems in the same request.
      headers: await Headless.redemption(auth),
      json: { assertion },
    }),
  )
  if ('step' in body)
    return { step: { link: body.step.link, type: body.step.type } }
  return await Headless.complete(auth, {
    authorize: prepared.authorize,
    body,
    key: prepared.key,
    request: prepared.request,
  })
}

declare namespace verify {
  type Options = {
    /** The serialized assertion over the prepared options' challenge. */
    assertion: ReturnType<typeof Authentication.serializeResponse>
    /** The options that the assertion signed. */
    prepared: Prepared
  }
}
