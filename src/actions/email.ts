/**
 * Signs the user in with an emailed code, from the app's own sign-in form.
 * @module
 */
import { Authentication, type Types } from 'ox/webauthn'
import { type Config, RequestError } from '../Accounts.js'
import type { Authorization } from '../internal/Authorization.js'
import * as Api from '../internal/Api.js'
import * as ClientId from '../internal/ClientId.js'
import * as Code from '../internal/Code.js'
import * as Headless from '../internal/Headless.js'
import * as RegistrationOptions from '../internal/Registration.js'
import * as SignIn from '../internal/SignIn.js'
import type { ChainId, HasAccessKey, WithAccount } from '../Permissions.js'
import type { TempoAccount } from '../internal/TempoAccount.js'
import type * as Passkey from './passkey.js'

/**
 * Throws `rejected` with status 400 for a third-party client ID, such as an origin. Tempo ID signs in
 * only a first-party app with an emailed code, so a code request would email a code that no sign-in
 * redeems, and a page receives no CORS grant for the refusal, which reads as a request without a
 * response.
 */
function firstParty(auth: Config) {
  if (!ClientId.thirdParty(auth.clientId)) return
  throw new RequestError({
    code: 'invalid_request',
    message: (() => {
      // A CLI has no browser window or redirect URI, so it signs in through the device grant.
      if (ClientId.cli(auth.clientId))
        return 'Email sign-in refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with `device.signIn`.'
      // A page without `clientId` uses its origin as the client ID, so the fault is often the
      // missing registration ID, not the flow.
      // A regular expression, since some runtimes, such as React Native, have no `URL.parse`.
      if (/^https?:\/\/[^/?#]+$/.test(auth.clientId))
        return "Email sign-in refused: the client ID is an origin, which names a third-party app. Pass `clientId`, the ID of the app's first-party registration, or sign in with `dialog.signIn` or `redirect.signIn`."
      return 'Email sign-in refused: the client ID names a third-party app, which signs in only on an approval page. Sign in with `dialog.signIn` or `redirect.signIn`.'
    })(),
    reason: 'rejected',
    status: 400,
  })
}

/**
 * Emails the user a sign-in code. The response is the same for every address.
 *
 * @throws {Accounts.RequestError} With `rejected` and status 400, when `clientId` names a third-party
 *   app, such as an origin. The call sends no request.
 *
 * @example
 * ```ts
 * await Actions.email.sendCode(auth, { email: 'user@example.com' })
 * ```
 */
export async function sendCode(
  auth: Config,
  options: sendCode.Options,
): Promise<void> {
  firstParty(auth)
  const offline = Api.answered(auth, {
    message:
      'The code request received no response. Check the connection, and request the code again.',
  })
  await Api.json(await Api.post(offline, '/v1/auth/code', { json: options }))
}

export declare namespace sendCode {
  type Options = {
    /** The user's email address. */
    email: string
  }
}

/**
 * Signs the user in with an emailed code, and authorizes a first-party app in the same request. The
 * access key must fit the headless ceiling. A sign-in with an access key creates the user's first Tempo Account.
 *
 * With `link`, the passkey of `Actions.passkey.signIn`'s email step signs again, and signs the access key.
 * In a browser, a passkey that owns the account signs the access key on the page after the code.
 *
 * A refusal after the code verified has `signedIn: true`. Outside a browser, and without `getFn`,
 * an account that a passkey owns throws `webauthn_required`. Another passkey's account, whose
 * relying party does not cover the page, throws it too. Then authorize through
 * `Actions.redirect.start`.
 *
 * A third-party `clientId` throws `rejected` with status 400, before the check of `code`. A `code`
 * that holds other than 6 digits throws `invalid_field` with status 0. Neither sends a request.
 *
 * A new user of an app whose first account is a passkey receives the passkey account's registration in
 * place of the authorization, and the call registers the passkey, whose proof signs the access key,
 * as `Actions.passkey.register` with `accessKey` does. The proof signs a `challenge` too. If a
 * ceremony fails, such as a dismissed prompt, the user stays signed in without an account, and
 * `Actions.passkey.register` with `accessKey` creates it, with no new code.
 *
 * A wallet.tempo passkey's account that waits for its upgrade signs the access key as the passkey's own
 * account, and `upgradeAvailable` is `true`. `Actions.account.upgrade` with the access key then upgrades
 * the account with one more prompt, after Tempo ID registers the access key.
 *
 * @throws {Accounts.RequestError} With `rejected` and status 400, when `clientId` names a third-party
 *   app, such as an origin. The call sends no request.
 *
 * @example
 * ```ts
 * const authorization = await Actions.email.signIn(auth, { code, email })
 * ```
 */
export async function signIn<
  const accessKey extends WithAccount | undefined = undefined,
>(
  auth: Config,
  options: signIn.Options<accessKey>,
): Promise<signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>> {
  const { createFn, email, getFn, link } = options
  firstParty(auth)
  // A code without 6 digits throws before any request, or the prompt of `link`'s passkey.
  const code = Code.from(options.code)
  // The authorization request rides with the sign-in, so one request signs in, creates the first
  // account, and signs the access key. The link's passkey signs again, so a page left at the email step
  // links nothing for the next person, who cannot sign with it. Its options carry the authorization
  // request, so the same assertion signs the access key.
  const prepared = await Headless.prepare(auth, options)
  // A request without a response may have spent the code.
  const offline = Api.answered(auth, {
    message:
      'The sign-in received no response. Check the connection, and sign in again. If the code is refused, request a new code.',
  })
  const assertion = await (async () => {
    if (!link) return undefined
    const requested = await Api.json<{
      options: Types.CredentialRequestOptions<true>
    }>(
      await Api.post(offline, '/v1/auth/passkey/options', {
        json: {
          allow: { link, type: 'link' },
          continue: { authorize: prepared.authorize, type: 'authorize' },
        },
      }),
    )
    const deserialized = Authentication.deserializeOptions(requested.options)
    return Authentication.serializeResponse(
      await Authentication.sign(
        // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
        getFn ? ({ ...deserialized, getFn } as never) : deserialized,
      ).catch(Headless.closed),
    )
  })()
  // The account and the registration options ride with the sign-in, so the page sends no request
  // for either before its passkey ceremony.
  const requestedAt = Date.now()
  // The access key's chain, else the instance's, selects the account's view.
  const chain = options.accessKey?.chainId ?? options.chainId
  type Body = {
    /**
     * The next action of a new user of an app whose first account is a passkey: the creation of
     * the passkey, with its registration options where Tempo ID prepared them.
     */
    next?:
      | (Partial<Omit<RegistrationOptions.Registration, 'expiresAt'>> & {
          type: 'createOwner'
        })
      | undefined
    registration?:
      | Omit<RegistrationOptions.Registration, 'expiresAt'>
      | undefined
    result: Headless.Completion
    tempo?: readonly Api.TempoAccountResponse[] | undefined
    user: { id: string }
  }
  const send = async (withChain: boolean) => {
    // Tempo ID issues the tokens during the request, so their lifetime counts from its start.
    const sentAt = Date.now()
    // The sign-in authorizes in the same request, after the code signed the user in. `accessKey`
    // decides both the type and the runtime value of the result.
    const body = await Headless.read<Body>(
      await Api.post(offline, '/v1/auth/code/verify', {
        // The sign-in carries the authorization, whose code Tempo ID redeems in the same request.
        headers: await Headless.redemption(auth),
        json: {
          code,
          email,
          ...(options.registration ? { registration: true } : {}),
          ...((options.account ?? auth.account) === false
            ? { tempo: false }
            : withChain && chain !== undefined
              ? { account: { chain } }
              : {}),
          ...(link
            ? { link: { assertion, id: link } }
            : {
                continue: {
                  authorize: prepared.authorize,
                  // A passkey that owns the account signs the access key on this page, in place of a redirect.
                  ...(Headless.steps(prepared.authorize, { getFn })
                    ? { passkey: true }
                    : {}),
                  type: 'authorize',
                },
              }),
        },
      }),
    )
    return { body, sentAt }
  }
  // Tempo ID refuses a chain that it does not list before it spends the code, so the sign-in runs
  // again without the chain. A chain that it refused before sends none, with no second request.
  const { body, sentAt, unlisted } = await (async () => {
    if (options.chainListed === false)
      return { ...(await send(false)), unlisted: true }
    try {
      return { ...(await send(true)), unlisted: false }
    } catch (error) {
      if (
        !(error instanceof RequestError) ||
        error.signedIn ||
        !SignIn.unlisted(error, { field: 'account.chain' })
      )
        throw error
      return { ...(await send(false)), unlisted: true }
    }
  })()
  // A new user of an app whose first account is a passkey holds no account yet, so Tempo ID returns
  // the creation of the passkey as the next action, in place of the authorization. Its proof signs
  // the access key, so the new passkey creates the account and signs the access key in one more
  // ceremony.
  const creation = (() => {
    const { next } = body
    // Tempo ID prepares the options where its options request accepts the access key.
    if (next?.type !== 'createOwner' || !next.options) return undefined
    return { ...next, options: next.options }
  })()
  if (creation && prepared.accessKey && options.accessKey) {
    // Only a new user registers here, so the email plugin's bundle loads the passkey actions on demand.
    const { register } = await import('./passkey.js')
    const registered = await register(auth, {
      accessKey: { ...options.accessKey, account: prepared.accessKey.signer },
      challenge: options.challenge,
      createFn,
      getFn,
      registration: RegistrationOptions.bind(
        RegistrationOptions.from(creation, { requestedAt }),
      ),
    }).catch((error: unknown) =>
      // A dismissed or failed ceremony leaves the new user signed in without an account.
      Api.signedIn(error, {
        message:
          'Passkey account registration failed after the sign-in, such as a dismissed prompt. The user is signed in without an account, so register a passkey with `accessKey`, which needs no new code.',
      }),
    )
    const { authorization } = registered
    // The registration's tokens become the session, so they must be the code's user's.
    // A mismatch revokes the registration's refresh token, which no session holds, as
    // `Headless.complete` does.
    await Headless.revoking(auth, {
      body: { tokens: authorization as never },
      fn: () => {
        if (authorization.user.id !== body.user.id)
          Api.signedIn(Headless.sessionChanged())
      },
    })
    return {
      ...authorization,
      // The registration received the generated access key by its account alone, so the access key
      // takes back its material, which the session stores to sign.
      accessKey: { ...authorization.accessKey, ...prepared.accessKey.material },
      account: undefined,
      accounts: [],
      ...(registered.challengeError
        ? { challengeError: registered.challengeError }
        : {}),
    } as unknown as signIn.ReturnType<
      ChainId<accessKey>,
      HasAccessKey<accessKey>
    >
  }
  const authorization = await Headless.complete(auth, {
    accessKey: prepared.accessKey,
    authorize: prepared.authorize,
    body,
    request: options,
    sentAt,
  })
  // A response without the accounts, as where `POST /v1/account` refuses them, leaves `account` out.
  // The page then reads them with `Actions.account.get`, whose refusal does not discard the
  // authorization. Tempo ID lists the access key's account first, then the others oldest first.
  const account = (() => {
    // An unlisted chain has no accounts, so the plugin reads none.
    if (unlisted) return { account: undefined, accounts: [] }
    if (!body.tempo) return undefined
    // An account that the client cannot rebuild stays out of the list, so the sign-in still sets
    // its session. Only the first entry, which the access key names, becomes the session's account.
    const read = body.tempo.map((entry) => {
      try {
        return Api.tempoAccount(entry, { getFn })
      } catch {
        return undefined
      }
    })
    // The list leads with the session's account, so an unreadable first entry leaves it empty.
    const [first] = read
    if (!first) return { account: undefined, accounts: [] }
    return {
      account: first,
      accounts: read.filter((entry) => entry !== undefined),
    }
  })()
  const offered = creation ?? body.registration

  // `accessKey` decides both the type and the runtime value of the authorization, which TypeScript
  // does not narrow through a spread.
  return {
    ...authorization,
    ...account,
    ...(unlisted ? { chainListed: false } : {}),
    // A response without the options leaves `Actions.passkey.register` to request them, and to
    // throw their refusal. The creation of the passkey carries its own options.
    ...(offered
      ? { registration: RegistrationOptions.from(offered, { requestedAt }) }
      : {}),
  } as unknown as signIn.ReturnType<ChainId<accessKey>, HasAccessKey<accessKey>>
}

export declare namespace signIn {
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
     * `false` leaves out `account` and `accounts`, so Tempo ID reads no Tempo Accounts. `true`
     * returns the user's Tempo Account in the realms of the app, as `Actions.account.get` does, on
     * the chain of the access key. A user without one receives one. Defaults to the `account` of
     * `auth`, else `true`.
     */
    account?: boolean | undefined
    /**
     * The chain whose view of the account the sign-in returns, such as a configurable account's
     * address, unless the access key names its own chain. A chain that Tempo ID does not list holds
     * none.
     */
    chainId?: number | undefined
    /**
     * `false` sends no chain for the account's view, as for a chain that Tempo ID refused as
     * unlisted, so the sign-in sends one request and returns no Tempo Account. Defaults to `true`.
     */
    chainListed?: false | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * A sign-in on the app's page needs the `tempo-id:sign` scope.
     */
    challenge?: string | undefined
    /**
     * The 6-digit code that Tempo ID emailed. The call drops each character other than a digit, and
     * reads a full-width or Arabic-Indic digit as its ASCII digit.
     */
    code: string
    /**
     * Runs the creation ceremony of a new user's passkey account, as for `Actions.passkey.register`.
     * Defaults to `navigator.credentials.create`.
     */
    createFn?: Passkey.register.Options['createFn'] | undefined
    /** The address that received the code. */
    email: string
    /**
     * Runs the ceremony of the passkey that `link` names, of the passkey that owns the account, or
     * of a new user's passkey account's proof, as for `Actions.passkey.signIn`. Defaults to
     * `navigator.credentials.get`.
     */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * The `link` from `Actions.passkey.signIn`'s email step, which links that passkey to the user.
     * The call first runs the passkey's ceremony.
     */
    link?: string | undefined
    /**
     * Whether to return passkey registration options as `registration`, in the same request as the
     * sign-in, which `Actions.passkey.register` takes. Defaults to `false`.
     */
    registration?: boolean | undefined
  }

  /**
   * The authorization, without its access key for a sign-in without `accessKey`, and whether its
   * account can upgrade.
   */
  type ReturnType<
    chainId extends number = number,
    hasAccessKey extends boolean = false,
  > = (hasAccessKey extends false
    ? Omit<Authorization<chainId>, 'accessKey' | 'signer'>
    : Authorization<chainId>) & {
    /**
     * The user's Tempo Account, as `Actions.account.get` returns it, for a sign-in with `account`.
     * `undefined` for a user without one in the app's realms. Absent without `account`, and where
     * Tempo ID left the accounts out, such as at the user's limit of account reads. Then read them
     * with `Actions.account.get`, which throws the refusal.
     */
    account?: TempoAccount | undefined
    /**
     * Every Tempo Account of the user in the app's realms, on the chain of `account`: `account` first,
     * then oldest first. Absent where `account` is absent. An app with more than one asks the user,
     * then authorizes the chosen account's access key with `Actions.authorize`.
     */
    accounts?: readonly TempoAccount[] | undefined
    /**
     * `false` where Tempo ID does not list the chain of the account's view, which then holds no
     * Tempo Account. A later sign-in on that chain passes `chainListed: false`. Absent otherwise.
     */
    chainListed?: false | undefined
    /**
     * The failure of the challenge's signature after a new user's passkey account, beside the
     * authorization that its registration returned, as `Actions.passkey.register` returns it.
     */
    challengeError?: RequestError | undefined
    /**
     * The options of a passkey registration, for `Actions.passkey.register`'s `registration`.
     * Absent without `registration`, and where the options request would refuse them.
     */
    registration?: RegistrationOptions.Registration | undefined
    /**
     * Whether the access key's account is a wallet.tempo passkey's that waits for its upgrade on the access key's
     * chain. `Actions.account.upgrade` with the access key upgrades it, and keeps the access key.
     */
    upgradeAvailable: boolean
  }
}
