/**
 * Signs the user in with a passkey from the app's own sign-in form, and authorizes the app's access key.
 * The handle of {@link prepare} requests the sign-in's options before the user acts, so its sign-in
 * starts the ceremony without a request. {@link register} adds a passkey for the signed-in user
 * from the app's page.
 * @module
 */
import { Address } from 'ox'
import {
  Authentication,
  Credential,
  Registration,
  type Types,
} from 'ox/webauthn'
import { type Config, RequestError } from '../Accounts.js'
import type { Authorization } from '../internal/Authorization.js'
import type * as AccessKey_public from '../internal/AccessKey.js'
import type * as AccessKey from '../internal/AccessKey.js'
import * as Api from '../internal/Api.js'
import * as Headless from '../internal/Headless.js'
import * as RegistrationOptions from '../internal/Registration.js'
import { request } from '../internal/Request.js'
import type { TempoAccount } from '../internal/TempoAccount.js'
import type { ChainId, HasAccessKey, WithAccount } from '../Permissions.js'

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
 * ceremony without a request. With `available`, the handle uses that value and sends no
 * `GET /v1/realms`. Create a new handle when the request options change.
 *
 * The handle owns its options. A sign-in uses them once, and requests new ones after 4 minutes.
 * A ceremony that the user cancels leaves them unspent for the next sign-in. A sign-in that sends
 * its assertion spends their challenge, so after a refusal the handle prepares new options.
 *
 * `prepare` never throws. If Tempo ID refuses the options request, the handle's next `signIn` within 4
 * minutes, on the same chain, throws that refusal without a request. Any other failed request leaves no options. The
 * handle's `signIn` then requests them, and throws what {@link signIn} throws.
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
): prepare.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>> {
  const ready =
    options.available === undefined
      ? available(auth).catch(() => false)
      : Promise.resolve(options.available)
  // Requests options only where passkeys sign in, so no request fails on a page without them. A
  // refusal repeats for the same options, so the handle keeps it for the next sign-in, as long as
  // it keeps options.
  const ahead = () => {
    // The request names the chain of this copy, which a switch during the request leaves as it is,
    // so a refusal holds the chain that its request named.
    const named = { ...auth, chainId: auth.chainId }
    return ready
      .then((passkeys) =>
        passkeys ? requestOptions(named, options) : undefined,
      )
      .catch((error: unknown): Refusal | undefined =>
        refused(error)
          ? {
              chainId: named.chainId,
              error: error as RequestError,
              expiresAt: Date.now() + preparedLifetime,
            }
          : undefined,
      )
  }
  let pending: Promise<Prepared | Refusal | undefined> | undefined = ahead()

  return {
    available: ready,
    async signIn(signInOptions = {}) {
      // Takes the options before the first await, so a sign-in that starts beside this one
      // requests options of its own instead of the same challenge.
      const taken = pending
      pending = undefined
      const entry = await taken
      const fresh = entry && entry.expiresAt > Date.now() ? entry : undefined
      // Tempo ID refused the options ahead of the sign-in on the same chain, so another request
      // returns the same refusal. A switch since then names another chain in the request.
      if (fresh && 'error' in fresh && fresh.chainId === auth.chainId)
        throw fresh.error
      const prepared =
        fresh && 'options' in fresh
          ? fresh
          : await requestOptions(auth, options)
      const assertion = await sign(prepared, signInOptions).catch(
        (error: unknown) => {
          // The ceremony sent no assertion, so the challenge is unspent for the next sign-in.
          pending ??= Promise.resolve(prepared)
          throw error
        },
      )
      return (await verify(auth, {
        assertion,
        getFn: signInOptions.getFn,
        prepared,
      }).catch((error: unknown) => {
        pending ??= ahead()
        throw error
      })) as signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>
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
     * `false` leaves out `account`, so Tempo ID reads no Tempo Accounts. Absent, the sign-in returns
     * the user's Tempo Account in the realms of the app, as `Actions.account.get` does, on the
     * chain of the access key, so no read follows it.
     */
    account?: false | undefined
    /**
     * Whether a passkey sign-in runs on this page, if the app knows it, such as a first-party app
     * on its own origin. The handle then sends no `GET /v1/realms`, and with `true` requests the
     * options at once. Absent, the handle reads it as {@link available} does.
     */
    available?: boolean | undefined
    /**
     * The chain whose view of the account the sign-in returns, such as a configurable account's
     * address, unless the access key names its own chain. A chain that Tempo ID does not list holds
     * none.
     */
    chainId?: number | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * A sign-in on the app's page needs the `tempo-id:sign` scope.
     */
    challenge?: string | undefined
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
     * A promise of it, such as of a read of the store, runs beside the realms read, and only the
     * options request awaits it.
     */
    select?: boolean | Promise<boolean | undefined> | undefined
  }

  /** The prepared sign-in's handle. */
  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = false,
  > = {
    /** Whether a passkey sign-in runs on this page, as {@link available} returns. Never rejects. */
    available: Promise<boolean>
    /**
     * Signs in as {@link signIn} does, with the handle's options. Requests new options if the
     * handle holds none, or if they are older than 4 minutes.
     */
    signIn: (
      options?: SignInOptions,
    ) => Promise<signIn.ReturnType<chainId, hasAccessKey>>
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
 * With `existingAccessKey`, the access key of a sign-in on a cloud wallet's configurable account,
 * the passkey joins that account as a second owner on the access key's chain, through an update
 * that the cloud wallet signs. The access key keeps working. On a chain whose accounts are not
 * configurable, `existingAccessKey` sets nothing, and the passkey owns an account of its own.
 * `account` and `chain` name the account and chain instead.
 *
 * With `accessKey`, the proof's one assertion also signs the access key for the account that the
 * new passkey owns, as `signIn` does, and the call returns the authorization in `authorization`. On
 * a chain whose accounts are configurable, the access key's digest binds that account, so the call
 * derives the proof's challenge from the new passkey's public key. The access key fits the headless
 * ceiling, unless the app holds `tempo-id:sign`. Its options take no `account`, `chain`, or
 * `existingAccessKey`, and only they take `challenge`. A Tempo ID without `authorize` on the options
 * throws `server_error` after the passkey is stored.
 *
 * A user who holds 10 passkeys throws `passkey_limit`, and a page that the relying party does not
 * cover throws `passkey_not_permitted`.
 *
 * @example
 * ```ts
 * const { address, authorization } = await Actions.passkey.register(auth, {
 *   accessKey: { expiry: '1h' },
 * })
 * ```
 */
export async function register<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: register.Options<accessKey> = {},
): Promise<register.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>> {
  const { createFn, existingAccessKey, getFn } = options
  // Only the access key's registration selects the new passkey's account, which signs the challenge.
  if (options.challenge !== undefined && !options.accessKey)
    throw new RequestError({
      code: 'invalid_request',
      field: 'challenge',
      message:
        "Invalid options: `challenge` signs as the new passkey's account, which only a registration with `accessKey` selects. Pass `accessKey`, or sign in with the challenge.",
      status: 0,
    })
  // Tempo ID reads a chain ID in `chain` as it reads a name. It decides whether the access key's chain
  // takes an owner, so the page reads no chain list.
  const { chain } = options
  // The new passkey owns its own account, which the access key acts for, so it joins no account.
  if (
    options.accessKey &&
    (existingAccessKey || options.account !== undefined || chain !== undefined)
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'accessKey',
      message:
        'Invalid options: `accessKey` signs for the account that the new passkey owns, which joins no account. Pass `accessKey` without `account`, `chain`, or `existingAccessKey`.',
      status: 0,
    })
  // The options carry the authorization request, so the proof challenge is its access key's digest.
  // Its witness is the hash of the challenge, so the proof signs the challenge too.
  const headless = options.accessKey
    ? await Headless.prepare(auth, {
        accessKey: options.accessKey,
        challenge: options.challenge,
      })
    : undefined
  // A sign-in's registration options save the options request while their challenge lasts. Their
  // proof signs no access key, so a registration with `accessKey` requests its own, unless the
  // sign-in's options already sign that access key, as a new user's passkey account's do.
  const prepared =
    options.registration &&
    RegistrationOptions.usable(options.registration) &&
    (!headless || RegistrationOptions.bound(options.registration))
      ? options.registration
      : await RegistrationOptions.request(Api.answered(auth, unregistered), {
          authorize: headless?.authorize,
        })
  // A server whose options carry no proof predates the access key on the verify request, and would
  // register the passkey on an account of its own. The call refuses before any prompt instead.
  if (
    existingAccessKey &&
    !prepared.proof &&
    (options.account === undefined || chain === undefined)
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'existingAccessKey',
      message: `Unsupported option: Tempo ID at ${auth.url} predates \`existingAccessKey\` on passkey registration. Pass \`account\` and \`chain\` in its place, or update Tempo ID.`,
      status: 0,
    })
  const deserialized = Registration.deserializeOptions(prepared.options)
  const passkey = await Registration.create(
    // ox reads `createFn` beside creation options at runtime, which its types admit only beside flat options.
    createFn ? ({ ...deserialized, createFn } as never) : deserialized,
  ).catch(excluded)
  const credential = Credential.serialize(passkey)

  const created = {
    credentialId: credential.id,
    rpId: prepared.options.publicKey!.rp.id!,
  }
  // Options with the proof challenge, or with the key authorization that derives it, need no proof
  // request, so the verify request carries the credential.
  const single = Boolean(prepared.proof ?? prepared.keyAuthorization)

  // The attestation proves no private key, so the new passkey signs a proof challenge before
  // Tempo ID stores it. The options carry the proof challenge, so the proof needs no request, and
  // the verify request carries the credential. An access key of a configurable account has a digest
  // that binds the account, which the new passkey's public key derives, so the page derives that
  // proof challenge. A server without either returns the proof step. A failure before the proof
  // leaves the passkey unstored, so the authenticator drops it.
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
        if (prepared.keyAuthorization)
          return Authentication.getOptions({
            challenge: RegistrationOptions.challenge(
              prepared.keyAuthorization,
              { publicKey: passkey.publicKey },
            ),
            credentialId: credential.id,
            rpId: created.rpId,
            userVerification: 'required',
          })
        // The request spends the registration challenge, so a retry requests new options.
        RegistrationOptions.send(prepared)
        const { next } = await Api.json<{
          next: { options: Types.CredentialRequestOptions<true> }
        }>(
          await Api.post(
            Api.answered(auth, unregistered),
            '/v1/account/passkey',
            {
              json: { credential },
            },
          ),
        )
        return Authentication.deserializeOptions(next.options)
      })()
      return Authentication.serializeResponse(
        await Authentication.sign(
          // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
          getFn ? ({ ...proof, getFn } as never) : proof,
        ).catch(Headless.closed),
      )
    } catch (error) {
      forget(created)
      throw error
    }
  })()

  // With the credential, the verify request spends the registration challenge, so a retry requests
  // new options.
  if (single) RegistrationOptions.send(prepared)
  // A request that receives no response throws here, and the authenticator keeps the passkey,
  // since Tempo ID may have stored it.
  const response = await Api.post(
    Api.answered(auth, {
      message:
        'The registration received no response, and the passkey can be registered. Check the connection, then sign in with the passkey or register it again.',
    }),
    '/v1/account/passkey/verify',
    {
      // The authorization's code redeems in the same request.
      ...(headless ? { headers: await Headless.redemption(auth) } : {}),
      json: {
        ...(options.account ? { account: options.account } : {}),
        assertion,
        ...(chain !== undefined ? { chain } : {}),
        ...(single ? { credential } : {}),
        ...(existingAccessKey
          ? {
              accessKey: {
                account: existingAccessKey.account,
                chainId: existingAccessKey.chainId,
              },
            }
          : {}),
      },
    },
  )
  const registered = await (async () => {
    try {
      return await Api.json<{
        address: `0x${string}`
        authorization?: Api.Headless | undefined
        id: string
      }>(response)
    } catch (error) {
      // Tempo ID marks a failure after the store, such as `config_conflict` from the owner change, so
      // the authenticator keeps that passkey. A response without a `reason`, such as a gateway's, may
      // follow the store, so it keeps the passkey too. A server whose options carry no proof marks
      // none, so only its refusals drop the passkey.
      const dropped = single
        ? response.headers.get(storedHeader) !== 'true' &&
          error instanceof RequestError &&
          error.reason !== undefined
        : refused(error)
      if (dropped) forget(created)
      throw error
    }
  })()
  const result = { address: registered.address, id: registered.id }
  if (!headless)
    return result as register.ReturnType<never, HasAccessKey<accessKey>>

  // Tempo ID stored the passkey, so a failure from here on keeps it. The proof signed the access
  // key, so only a server that predates `authorize` on the options returns no authorization.
  const signed = registered.authorization
  if (!signed)
    throw new RequestError({
      code: 'server_error',
      message: `Unsupported option: Tempo ID at ${auth.url} predates \`accessKey\` on passkey registration. The passkey is registered, so sign in with it, or update Tempo ID.`,
      status: response.status,
    })
  // No session holds the tokens of a refused authorization, so its refresh token is revoked.
  const authorization = await Headless.revoking(auth, {
    body: signed,
    fn: () => {
      if (
        !signed.account ||
        !Address.isEqual(signed.account, registered.address)
      )
        throw new RequestError({
          code: 'server_error',
          message:
            'Account mismatch: Tempo ID signed the access key for another account than the new passkey. The passkey is registered, so sign in with it.',
          status: response.status,
        })
      return Api.authorization<ChainId<accessKey>>(signed, headless.accessKey!)
    },
  })
  // A proof whose witness is the hash of the challenge signed it, so the authorization carries its
  // signature. A Tempo ID that binds its own witness returns none, so the new passkey signs the
  // challenge in another ceremony, as the new passkey's account on the access key's chain. A failure
  // of that step keeps the registration's authorization, and returns the failure beside it.
  const challenged =
    options.challenge === undefined || authorization.challengeSignature
      ? {}
      : await challenge(
          { ...auth, chainId: Number(authorization.accessKey.chainId) },
          {
            account: registered.address,
            challenge: options.challenge,
            getFn,
            userId: authorization.user.id,
          },
        )
  return {
    ...result,
    authorization: {
      ...authorization,
      ...('challengeError' in challenged ? {} : challenged),
      upgradeAvailable: signed.upgrade_available === true,
    },
    ...('challengeError' in challenged
      ? { challengeError: challenged.challengeError }
      : {}),
  } as register.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>
}

/**
 * Signs `challenge` with the passkey that a registration just stored, as its account, through
 * `POST /v1/authorize` and its passkey step. Revokes the refresh token of that authorization's
 * grant, which the registration's own tokens replace. Returns the signature and its account, or the
 * failure as `challengeError`, such as a dismissed prompt, a signature by another account or user.
 */
async function challenge(auth: Config, options: challenge.Options) {
  try {
    const { response } = await Headless.post(auth, {
      getFn: options.getFn,
      json: request(auth, {
        account: options.account,
        challenge: options.challenge,
      }),
    })
    const body = await Api.json<Api.Headless>(response)
    const tokens =
      'accessToken' in body.tokens ? body.tokens : Api.tokens(body.tokens)
    // The registration's tokens hold the session, so this grant's refresh token goes.
    if (tokens.refreshToken)
      await Api.revoke(auth, { refreshToken: tokens.refreshToken }).catch(
        () => undefined,
      )
    const signed = Api.challengeSignature(body, { challenged: true })
    if (
      Api.user(tokens).id !== options.userId ||
      !Address.isEqual(signed.address!, options.account)
    )
      throw new RequestError({
        code: 'server_error',
        message:
          "Account mismatch: Tempo ID signed the challenge as another account or user than the new passkey's. The passkey is registered, so sign in with it and the challenge.",
        status: 200,
      })
    return signed
  } catch (error) {
    return {
      challengeError:
        error instanceof RequestError
          ? error
          : new RequestError({
              cause: error,
              code: 'server_error',
              message:
                'Challenge signature failed after the registration, with no response from Tempo ID. The passkey is registered, so sign in with it and the challenge.',
              status: 0,
            }),
    }
  }
}

declare namespace challenge {
  type Options = {
    /** The new passkey's account, which signs. */
    account: `0x${string}`
    /** The app's challenge. */
    challenge: string
    /** Runs the passkey's ceremony. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The user that the registration signed in. */
    userId: string
  }
}

export declare namespace register {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = {
    /** Runs the creation ceremony in place of `navigator.credentials.create`. */
    createFn?: Registration.create.Options['createFn'] | undefined
    /** Runs the proof ceremony in place of `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * The registration options that `Actions.email.signIn` returned with `registration: true`,
     * which save the options request. Options older than 4 minutes, or absent, are requested. A
     * registration with `accessKey` requests its own.
     */
    registration?: Registration | undefined
  } & (Options.WithAccessKey<accessKey> | Options.WithoutAccessKey)

  namespace Options {
    /**
     * The options of a registration that signs an access key for the account that the new passkey
     * owns, which joins no account.
     */
    type WithAccessKey<
      accessKey extends WithAccount | undefined = WithAccount | undefined,
    > = {
      /**
       * The access key to request: what it may do, and the app's own access key as `account`, which
       * defaults to a new access key. The proof's assertion signs it for the new passkey's account.
       * Within the headless ceiling, unless the app holds `tempo-id:sign`.
       */
      accessKey: NonNullable<accessKey>
      account?: undefined
      chain?: undefined
      /**
       * A message that the new passkey's account signs on the access key's chain, as the
       * authorization's `challengeSignature` by `address`. The access key's witness is its EIP-191
       * hash, so the proof signs it, and the signature is the key authorization's. A Tempo ID that
       * binds its own witness returns no signature, and the call runs a third ceremony for the
       * challenge, whose failure returns `challengeError` beside the authorization. Needs the
       * `tempo-id:sign` scope.
       */
      challenge?: string | undefined
      existingAccessKey?: undefined
    }

    /**
     * The options of a registration that authorizes no access key. Its passkey joins an account of
     * the user's cloud wallet, or owns an account of its own.
     */
    type WithoutAccessKey = {
      accessKey?: undefined
      /**
       * A configurable Tempo Account of the user's cloud wallet, which the passkey joins as a
       * second owner on `chain`. Defaults to `existingAccessKey.account` on a chain whose accounts
       * are configurable, else none, and the passkey owns an account of its own.
       */
      account?: `0x${string}` | undefined
      /**
       * The chain whose accounts are configurable, by its name in `GET /v1/chains`, such as
       * `testnet`, or its ID. It selects where `account` is, and the chain of the address that the
       * call returns. Defaults to the chain of `existingAccessKey` when its accounts are
       * configurable, else the first such chain for `account`, and the passkey's own address
       * otherwise. Tempo ID refuses an unknown chain with `invalid_field` at the last request,
       * after both ceremonies.
       */
      chain?: number | string | undefined
      challenge?: undefined
      /**
       * The access key of a sign-in on the cloud wallet's account, such as
       * `authorization.accessKey`. Tempo ID reads its chain: on a chain whose accounts are
       * configurable, the access key sets the default `account` and `chain`. Registration does not
       * use the access key otherwise.
       */
      existingAccessKey?:
        | Pick<AccessKey_public.AccessKey, 'account' | 'chainId'>
        | undefined
    }
  }

  /** The options of a registration, which one registration uses. */
  type Registration = RegistrationOptions.Registration

  /** The new passkey and the account that it owns, with the authorization for `accessKey`. */
  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = false,
  > = {
    /** The address of the Tempo Account that the passkey owns: `account`, or its own on `chain`. */
    address: `0x${string}`
    /** The credential ID of the passkey, base64url. */
    id: string
  } & (hasAccessKey extends true
    ? {
        /**
         * The authorization of `accessKey`, whose access key acts for the new passkey's account, and
         * whether that account can upgrade.
         */
        authorization: Authorization<chainId> & {
          /** Whether the account waits for its upgrade on the access key's chain. */
          upgradeAvailable: boolean
        }
        /**
         * Why the new passkey did not sign `challenge`, such as a dismissed prompt. The passkey and
         * `authorization` stand. Absent when it signed, or without `challenge`.
         */
        challengeError?: RequestError | undefined
      }
    : {})
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
 * if ('next' in result) showEmailForm()
 * ```
 */
export async function signIn<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: signIn.Options<accessKey> = {},
): Promise<signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>> {
  const prepared = await requestOptions(auth, options)
  const assertion = await sign(prepared, options)
  // `accessKey` decides both the type and the runtime value of the result.
  return (await verify(auth, {
    assertion,
    getFn: options.getFn,
    prepared,
  })) as signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>
}

export declare namespace signIn {
  type Options<
    accessKey extends WithAccount | undefined = WithAccount | undefined,
  > = Omit<prepare.Options<accessKey>, 'available'> & {
    /**
     * Runs the WebAuthn ceremony in place of `navigator.credentials.get`. Its assertion must report
     * the page's origin, so Tempo ID refuses an Android facet origin.
     */
    getFn?: Authentication.sign.Options['getFn'] | undefined
  }

  /** The next action of a wallet.tempo passkey without an email: an emailed code links it. */
  type EmailStep = {
    /** The `link` that `Actions.email.signIn` takes to link the passkey to its user. */
    link: string
    /** The kind of action. */
    type: 'email'
  }

  /**
   * The authorization, without its access key for a sign-in without `accessKey`, and whether its
   * account can upgrade, or the email step.
   */
  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = false,
  > =
    | ((hasAccessKey extends false
        ? Omit<Authorization<chainId>, 'accessKey' | 'signer'>
        : Authorization<chainId>) & {
        /**
         * The user's Tempo Account, as `Actions.account.get` returns it, for a sign-in with `account`
         * and without `accessKey`. `undefined` for a user without one in the app's realms. Absent
         * without `account`, and where Tempo ID left the accounts out.
         */
        account?: TempoAccount | undefined
        /**
         * Whether the access key's account is a wallet.tempo passkey's that waits for its upgrade on the
         * access key's chain. `Actions.account.upgrade` with the access key upgrades it, and keeps the access key.
         */
        upgradeAvailable: boolean
      })
    | {
        /** The next action: the email step, which comes before the authorization. */
        next: EmailStep
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

/**
 * Throws an \`InvalidStateError\` for a creation that the authenticator refused because it holds one
 * of the user's passkeys, which the options exclude, else what {@link Headless.closed} throws. The
 * browser rejects such a creation with an \`InvalidStateError\`, which ox wraps. The error holds ox's
 * error as its \`cause\`. It is an \`Error\`, since Hermes has no \`DOMException\`.
 */
function excluded(error: unknown): never {
  if (
    (error as { cause?: { name?: unknown } } | undefined)?.cause?.name ===
    'InvalidStateError'
  )
    throw Object.assign(
      new Error(
        'The authenticator already holds a passkey of the user. Sign in with that passkey, or register on another authenticator.',
      ),
      { cause: error, name: 'InvalidStateError' },
    )
  return Headless.closed(error)
}

/** The error message of a registration request without a response, before Tempo ID stores the passkey. */
const unregistered = {
  message:
    'The registration received no response. Check the connection, and register the passkey again.',
}

/**
 * Returns `auth` whose sign-in requests throw `RequestError` with status 0 when they receive no
 * response. The authorization after the sign-in keeps the `signedIn` error of `Api.signedIn`.
 */
function offline(auth: Config) {
  return Api.answered(auth, {
    message:
      'The sign-in received no response. Check the connection, and sign in again.',
  })
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

/** A refusal of the options request ahead of a sign-in, which the next sign-in throws. */
type Refusal = {
  /** The chain that the refused request named. */
  chainId: number
  /** The refusal. */
  error: RequestError
  /** When a sign-in stops throwing the refusal, in milliseconds since the epoch. */
  expiresAt: number
}

/** A passkey sign-in's options and the access key that they authorize, which one sign-in uses. */
type Prepared = {
  /** The access key that the options authorize. Absent without `accessKey`. */
  accessKey: AccessKey.resolve.ReturnType | undefined
  /** The authorization request that the options carry, which the passkey step repeats. */
  authorize: Awaited<ReturnType<typeof Headless.prepare>>['authorize']
  /** When a sign-in stops using the options, in milliseconds since the epoch. */
  expiresAt: number
  /** The options of the WebAuthn ceremony, with Tempo ID's challenge. */
  options: Types.CredentialRequestOptions
  /** The request options, which the authorization reads once the passkey verifies. */
  request: prepare.Options
}

/**
 * Requests the options of a passkey sign-in, and the access key that they authorize.
 */
async function requestOptions(
  auth: Config,
  options: prepare.Options,
): Promise<Prepared> {
  const { credentialId, mediation } = options
  // The options carry the authorization request, so the challenge is its access key's digest.
  const [{ accessKey, authorize }, select] = await Promise.all([
    Headless.prepare(auth, options),
    options.select,
  ])
  // `allow` names one case, so `select` takes the place of `credentialId`.
  const allow = (() => {
    if (select) return { type: 'all' } as const
    if (credentialId === undefined) return undefined
    return { credentialId, type: 'credentials' } as const
  })()
  // The challenge's lifetime starts at Tempo ID before the response arrives, so the options' does too.
  const requestedAt = Date.now()
  const requested = await Api.json<{
    options: Types.CredentialRequestOptions<true>
  }>(
    await Api.post(offline(auth), '/v1/auth/passkey/options', {
      json: {
        ...(allow ? { allow } : {}),
        // The realms of the request's app decide the relying party, which must cover the page's origin.
        continue: { authorize, type: 'authorize' },
        ...(mediation === undefined ? {} : { mediation }),
      },
    }),
  )
  return {
    accessKey,
    authorize,
    expiresAt: requestedAt + preparedLifetime,
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
    ).catch(Headless.closed),
  )
}

/** Sends the assertion, and returns the authorization, or the email step of a passkey without one. */
async function verify(auth: Config, options: verify.Options) {
  const { assertion, getFn, prepared } = options
  // The access key's chain, else the instance's, selects the account's view.
  const chain = prepared.request.accessKey?.chainId ?? prepared.request.chainId
  // Tempo ID issues the tokens during the request, so their lifetime counts from its start.
  const sentAt = Date.now()
  const body = await Headless.read<
    | {
        result: Headless.Completion
        tempo?: readonly Api.TempoAccountResponse[] | undefined
        user: { id: string }
      }
    | { next: signIn.EmailStep }
  >(
    await Api.post(offline(auth), '/v1/auth/passkey/verify', {
      // The prepared authorization's code redeems in the same request.
      headers: await Headless.redemption(auth),
      json: {
        assertion,
        ...(prepared.request.account === false
          ? { tempo: false }
          : chain !== undefined
            ? { account: { chain } }
            : {}),
      },
    }),
  )
  if ('next' in body)
    return { next: { link: body.next.link, type: body.next.type } }
  const authorization = await Headless.complete(auth, {
    accessKey: prepared.accessKey,
    authorize: prepared.authorize,
    body,
    request: prepared.request,
    sentAt,
  })
  // A response without the accounts, as from a server that predates them or where
  // `POST /v1/account` refuses them, leaves `account` out. Tempo ID lists the authorization's
  // account first.
  if (!body.tempo) return authorization
  const [first] = body.tempo
  // An account that the client cannot rebuild stays out, so the sign-in still sets its session.
  const account = (() => {
    try {
      return first ? Api.tempoAccount(first, { getFn }) : undefined
    } catch {
      return undefined
    }
  })()
  return { ...authorization, account }
}

declare namespace verify {
  type Options = {
    /** The serialized assertion over the prepared options' challenge. */
    assertion: ReturnType<typeof Authentication.serializeResponse>
    /** Runs the ceremony of the account's passkey owner, which the returned account signs with. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The options that the assertion signed. */
    prepared: Prepared
  }
}
