/**
 * Signs the user in with an emailed code, from the app's own sign-in form.
 * @module
 */
import { Authentication, type Types } from 'ox/webauthn'
import { type Config, ChallengeWithoutKeyError } from '../Accounts.js'
import type { Authorization } from '../internal/Authorization.js'
import * as Api from '../internal/api.js'
import * as Headless from '../internal/headless.js'
import * as RegistrationOptions from '../internal/registration.js'
import type { ChainId, Keyed, WithAccount } from '../Permissions.js'
import type { TempoAccount } from '../internal/TempoAccount.js'
import type * as AccountActions from './account.js'

/**
 * Emails the user a sign-in code. The response is the same for every address.
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
  await Api.json(await Api.post(auth, '/v1/auth/code', { json: options }))
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
 * A wallet.tempo passkey's account that waits for its upgrade signs the access key as the passkey's own
 * account, and `upgradeAvailable` is `true`. `Actions.account.upgrade` with the access key then upgrades
 * the account with one more prompt, after Tempo ID registers the access key.
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
): Promise<signIn.ReturnType<ChainId<accessKey>, Keyed<accessKey>>> {
  const { code, email, getFn, link } = options
  // A challenge rides in the access key, so a sign-in without one refuses it before it signs in.
  if (!options.accessKey && options.challenge !== undefined)
    throw new ChallengeWithoutKeyError()
  // The authorization request rides with the sign-in, so one request signs in, creates the first
  // account, and signs the access key. The link's passkey signs again, so a page left at the email step
  // links nothing for the next person, who cannot sign with it. Its options carry the authorization
  // request, so the same assertion signs the access key.
  const prepared = await Headless.prepare(auth, options)
  const assertion = await (async () => {
    if (!link) return undefined
    const requested = await Api.json<{
      options: Types.CredentialRequestOptions<true>
    }>(
      await Api.post(auth, '/v1/auth/passkey/options', {
        json: { authorize: prepared.authorize, client_id: auth.clientId, link },
      }),
    )
    const deserialized = Authentication.deserializeOptions(requested.options)
    return Authentication.serializeResponse(
      await Authentication.sign(
        // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
        getFn ? ({ ...deserialized, getFn } as never) : deserialized,
      ),
    )
  })()
  // The account and the registration options ride with the sign-in, so the page sends no request
  // for either before its passkey ceremony. Tempo ID reads a chain ID in `chain` as it reads a name,
  // and refuses an unknown chain before it spends the code.
  const chain = options.account?.chain ?? options.account?.chainId
  const requestedAt = Date.now()
  const response = await Api.post(auth, '/v1/auth/code/verify', {
    // The sign-in carries the authorization, whose code Tempo ID redeems in the same request.
    headers: await Headless.redemption(auth),
    json: {
      ...(options.account
        ? {
            account: {
              ...(chain !== undefined ? { chain } : {}),
              client_id: auth.clientId,
            },
          }
        : {}),
      code,
      email,
      ...(options.registration ? { registration: true } : {}),
      ...(link
        ? { assertion, link }
        : {
            authorize: prepared.authorize,
            // A passkey that owns the account signs the access key on this page, in place of a redirect.
            ...(Headless.steps(prepared.authorize, { getFn })
              ? { passkey: true }
              : {}),
          }),
    },
  })
  // The sign-in authorizes in the same request, after the code signed the user in. `key` decides
  // both the type and the runtime value of the result.
  const body = await Headless.read<{
    authorization?: Api.Headless | undefined
    registration?:
      | Omit<RegistrationOptions.Registration, 'expiresAt'>
      | undefined
    tempo?: readonly Api.TempoAccountResponse[] | undefined
    user: { id: string }
  }>(response)
  const authorization = await Headless.complete(auth, {
    body,
    authorize: prepared.authorize,
    key: prepared.key,
    request: options,
  })
  // A response without the accounts, as where `POST /v1/account` refuses them, leaves `account` out.
  // The page then reads them with `Actions.account.get`, whose refusal does not discard the
  // authorization.
  const account = (() => {
    if (!options.account || !body.tempo) return undefined
    const [first] = body.tempo
    return {
      account: first
        ? Api.tempoAccount(first, { getFn: options.account.getFn })
        : undefined,
    }
  })()
  // `key` decides both the type and the runtime value of the authorization, which TypeScript does
  // not narrow through a spread.
  return {
    ...authorization,
    ...account,
    // A response without the options leaves `Actions.passkey.register` to request them, and to
    // throw their refusal.
    ...(body.registration
      ? {
          registration: RegistrationOptions.from(body.registration, {
            requestedAt,
          }),
        }
      : {}),
  } as unknown as signIn.ReturnType<ChainId<accessKey>, Keyed<accessKey>>
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
     * Returns the user's Tempo Account as `account`, as `Actions.account.get` does with these
     * options, in the same request as the sign-in. A user without one receives one.
     */
    account?:
      | Pick<AccountActions.get.Options, 'chain' | 'chainId' | 'getFn'>
      | undefined
    /**
     * A message whose EIP-191 hash the key authorization binds as its `witness`. Needs the
     * `tempo-id:sign` scope and an access key.
     */
    challenge?: ([accessKey] extends [undefined] ? never : string) | undefined
    /** The 6-digit code that Tempo ID emailed. */
    code: string
    /** The address that received the code. */
    email: string
    /**
     * Runs the ceremony of the passkey that `link` names, or of the passkey that owns the account,
     * as for `Actions.passkey.signIn`. Defaults to `navigator.credentials.get`.
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
    key extends boolean = false,
  > = (key extends false
    ? Omit<Authorization<chainId>, 'accessKey' | 'key'>
    : Authorization<chainId>) & {
    /**
     * The user's Tempo Account, as `Actions.account.get` returns it, for a sign-in with `account`.
     * `undefined` for a user without one in the app's realms. Absent without `account`, and where
     * Tempo ID left the accounts out, such as at the user's limit of account reads. Then read them
     * with `Actions.account.get`, which throws the refusal.
     */
    account?: TempoAccount | undefined
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
