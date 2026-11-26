/**
 * Reads the signed-in user's Tempo Account for the app, upgrades a wallet.tempo passkey's account
 * from the app's page, signs messages as the account with the user's cloud wallet, and revokes or
 * changes the account's access keys with it, or on Tempo ID's approval pages in a redirect, a frame
 * in a dialog, or a popup.
 * @module
 */
import { Address, Base64, Bytes, Hex } from 'ox'
import { Authentication, type Types } from 'ox/webauthn'
import {
  formatTransactionReceipt,
  type RpcTransactionReceipt,
  type TransactionReceipt,
  type TypedData,
  type TypedDataDefinition,
} from 'viem'
import {
  type ActorRefFrom,
  assertEvent,
  assign,
  createActor,
  fromPromise,
  setup,
  type SnapshotFrom,
  waitFor,
} from 'xstate'
import {
  type Config,
  RequestError,
  SignedOutError,
  SupersededError,
} from '../Accounts.js'
import * as Api from '../internal/Api.js'
import * as AccessKey from '../internal/AccessKey.js'
import * as Callback from '../internal/Callback.js'
import * as FrameTrust from '../internal/FrameTrust.js'
import * as Payment from '../internal/Payment.js'
import * as Popup from '../internal/Popup.js'
import type * as Sheet from '../internal/Sheet.js'
import type { Permissions } from '../Permissions.js'
import type * as Session from '../Session.js'
import type { TempoAccount } from '../internal/TempoAccount.js'

/**
 * The browser blocked the approval page's popup, since the action ran outside a user gesture such
 * as a click.
 */
export class BlockedError extends Error {
  override readonly name = 'Actions.account.BlockedError'

  constructor() {
    super(
      'The browser blocked the approval popup. Call the action in a click handler, before any `await`, or open the approval page in a frame or through a redirect.',
    )
  }
}

/**
 * The redirect URI is on another origin than the page, so the approval page's return in a frame or
 * a popup cannot reach the page that called the action.
 */
export class OriginError extends Error {
  override readonly name = 'Actions.account.OriginError'

  constructor(options: OriginError.Options) {
    super(
      `Invalid redirect URI: ${options.redirectUri} is not on this page's origin, ${options.origin}. Call the action on a page of the redirect URI's origin, or open the approval page through a redirect.`,
    )
  }
}

export declare namespace OriginError {
  type Options = {
    /** The origin of the page that called the action. */
    origin: string
    /** The redirect URI of the approval page. */
    redirectUri: string
  }
}

/**
 * The runtime has no browser page, such as a server or a CLI, so no approval page can open in a
 * frame or a popup from it.
 */
export class PageRequiredError extends Error {
  override readonly name = 'Actions.account.PageRequiredError'

  constructor(options: PageRequiredError.Options = {}) {
    // The payment page has no redirect, so its message names what sends a payment outside a page.
    super(
      (() => {
        if (!options.payment)
          return 'No browser window: the approval page opens in a frame or a popup only from a page. Open it through a redirect instead.'
        if (options.sender === false)
          return "No browser window, and no plugin sends payments: the payment page opens only from a page. Outside a page, add a plugin that sends a payment with the session's access key."
        return "No browser window: the payment page opens only from a page. Outside a page, only the session's access key sends a payment, within its limits and before its expiry, so a payment above them needs a sign-in for an access key that holds it."
      })(),
      options.cause === undefined ? undefined : { cause: options.cause },
    )
  }
}

export declare namespace PageRequiredError {
  type Options = {
    /**
     * The failure that left the page as the only way on, such as the node's refusal of a payment
     * that the access key sent above what is left of its limit.
     */
    cause?: unknown
    /**
     * Whether the page is the payment page, which has no redirect, so the message names a sign-in
     * for an access key that holds the payment. Defaults to `false`.
     */
    payment?: boolean | undefined
    /**
     * Whether a plugin of the instance sends a payment with the session's access key. Without one,
     * the message of the payment page names that plugin as the fix, since no sign-in sends the
     * payment. Defaults to `true`.
     */
    sender?: boolean | undefined
  }
}

/**
 * Returns the connection of the app and the user of `accessToken`, at `GET /v1/connection`: the app,
 * and the connection's live access keys, newest first, the app's own and those that APIs hold for
 * it. Any app reads its own connection. A redirect throws `redirect_refused`, since the request does
 * not follow it. React Native's `fetch` follows it.
 *
 * @example
 * ```ts
 * const connection = await Actions.account.connection(auth, { accessToken })
 * // { accessKeys: [{ address: '0x…', holder: { kind: 'api', name: 'Example API', … }, … }], app: { … } }
 * ```
 */
export async function connection(
  auth: Config,
  options: connection.Options,
): Promise<Connection> {
  const url = new URL(
    `/v1/connection?${new URLSearchParams({ client_id: auth.clientId })}`,
    auth.url,
  )
  const body = await Api.json<Connection.Response>(
    await (auth.fetch ?? fetch)(url, {
      // The route's CORS response admits any origin without credentials, so the token is the only
      // credential.
      credentials: 'omit',
      headers: await Api.tokenHeaders(auth, {
        accessToken: options.accessToken,
        method: 'GET',
        url,
      }),
      // A redirect would send the access token to another origin.
      redirect: 'manual',
    }),
  )
  return toConnection(body)
}

export declare namespace connection {
  type Options = {
    /** The app's access token for Tempo ID, from a sign-in or refresh. */
    accessToken: string
  }
}

/**
 * Lists the signed-in user's connections, one for each app with a live access key, at
 * `GET /v1/account/connections`. Call it from the page of a first-party app with the
 * `tempo-id:sign` scope, which the session cookie authenticates. A redirect throws `redirect_refused`,
 * since the request does not follow it. React Native's `fetch` follows it.
 *
 * @example
 * ```ts
 * const connections = await Actions.account.connections(auth)
 * ```
 */
export async function connections(
  auth: Config,
): Promise<readonly Connection[]> {
  const body = await Api.json<{
    connections: readonly Connection.Response[]
  }>(
    await (auth.fetch ?? fetch)(
      new URL(
        `/v1/account/connections?${new URLSearchParams({ client_id: auth.clientId })}`,
        auth.url,
      ),
      // A redirect would send the session cookie's request to another origin.
      { credentials: 'include', redirect: 'manual' },
    ),
  )
  return body.connections.map(toConnection)
}

/**
 * Ends the connection of the app and the user of `accessToken`, at `POST /v1/connection/disconnect`.
 * Tempo ID removes the user's consent and every token of the app, then revokes each live access key
 * of the connection on its chain with the account's cloud wallet, the app's own and those that APIs
 * hold for it. Returns the revoked access keys, and in `remaining` those that it could not revoke,
 * such as the access keys of an account that only a passkey owns.
 *
 * @example
 * ```ts
 * await Actions.account.disconnect(auth, { accessToken })
 * ```
 */
export async function disconnect(
  auth: Config,
  options: disconnect.Options,
): Promise<disconnect.ReturnType> {
  const path = '/v1/connection/disconnect'
  const body = await Api.json<disconnect.Response>(
    await Api.post(auth, path, {
      credentials: 'omit',
      headers: await Api.tokenHeaders(auth, {
        accessToken: options.accessToken,
        method: 'POST',
        url: new URL(path, auth.url),
      }),
      json: { client_id: auth.clientId },
    }),
  )
  return { remaining: body.remaining ?? [], revoked: body.revoked }
}

export declare namespace disconnect {
  type Options = {
    /** The app's access token for Tempo ID, from a sign-in or refresh. */
    accessToken: string
  }

  type ReturnType = {
    /**
     * The connection's live access keys that the disconnection could not revoke, such as those of an
     * account that only a passkey owns, which the user revokes on Tempo ID's connections page. The
     * grant ends either way. Empty from a Tempo ID that reports none.
     */
    remaining: readonly {
      /** The access key's address. */
      address: `0x${string}`
      /** Why no transaction revoked it. */
      reason:
        | 'foreign_account'
        | 'insufficient_balance'
        | 'unknown_key'
        | 'upstream_unavailable'
        | 'webauthn_required'
    }[]
    /** The access keys that the disconnection revoked. */
    revoked: readonly {
      /** The access key's address. */
      address: `0x${string}`
      /** The revoking transaction's hash, or `null` for an access key revoked already. */
      transaction: `0x${string}` | null
    }[]
  }

  /** The response body, whose `remaining` an earlier Tempo ID leaves out. */
  type Response = Omit<ReturnType, 'remaining'> &
    Partial<Pick<ReturnType, 'remaining'>>
}

/**
 * Ends the signed-in user's connection of the app `app`, at `POST /v1/account/connections/disconnect`,
 * from the page of a first-party app with the `tempo-id:sign` scope, as `disconnect` does for an
 * app's own connection.
 *
 * @example
 * ```ts
 * await Actions.account.disconnectApp(auth, { app: 'client_01JZ…' })
 * ```
 */
export async function disconnectApp(
  auth: Config,
  options: disconnectApp.Options,
): Promise<disconnect.ReturnType> {
  const body = await Api.json<disconnect.Response>(
    await Api.post(auth, '/v1/account/connections/disconnect', {
      json: { app: options.app, client_id: auth.clientId },
    }),
  )
  return { remaining: body.remaining ?? [], revoked: body.revoked }
}

export declare namespace disconnectApp {
  type Options = {
    /** The client ID of the app whose connection ends. */
    app: string
  }
}

/**
 * Returns the user's Tempo Account for the app as a Viem configurable account (TIP-1107): the
 * selected one, or the oldest in the app's realms. For a user without one, it creates an account that a
 * cloud wallet owns in the first realm, if that realm creates cloud wallets. Only a page with the
 * session cookie creates one. Outside a page, a read with `accessToken` for such a user throws
 * `session_required` before the creation request. With `chain`, the address is the account's on that
 * chain. On a chain with configurable accounts, the account carries its
 * configuration, and a passkey of the user's among its owners signs for it through `getFn`.
 * Elsewhere, the account holds its address alone. A redirect throws `redirect_refused`, since the
 * request does not follow it. React Native's `fetch` follows it.
 *
 * @example
 * ```ts
 * const account = await Actions.account.get(auth, { accessToken, chain: 31318 })
 * await client.sendTransaction({ account, calls })
 * // account.keys: [{ address: '0x…', credential: { id, publicKey, rpId }, type: 'webAuthn' }]
 * ```
 */
export async function get(
  auth: Config,
  options: get.Options = {},
): Promise<get.ReturnType> {
  const { chain } = options
  const url = new URL(
    `/v1/account?${new URLSearchParams({
      ...(chain !== undefined ? { chain: String(chain) } : {}),
      client_id: auth.clientId,
    })}`,
    auth.url,
  )
  const listed = await Api.json<{
    creatable?: boolean | undefined
    id: string
    tempo: readonly Api.TempoAccountResponse[]
  }>(
    await (auth.fetch ?? fetch)(url, {
      credentials: 'include',
      // A redirect would send the access token or the session cookie's request to another origin.
      redirect: 'manual',
      ...(options.accessToken
        ? {
            headers: await Api.tokenHeaders(auth, {
              accessToken: options.accessToken,
              method: 'GET',
              url,
            }),
          }
        : {}),
    }),
  )
  const tempo = await (async () => {
    if (listed.tempo.length > 0) return listed.tempo
    // A realm that creates no account, such as `default`, needs no creation request.
    if (listed.creatable === false) return []
    // The creation reads only a page's session cookie. Outside a page, such as in React Native or
    // a CLI, no cookie reaches Tempo ID, so the creation is refused before its round trip.
    if (options.accessToken !== undefined && Api.page() === undefined)
      throw new RequestError({
        code: 'login_required',
        message:
          'The user holds no account, and only a page with the session cookie creates one. Sign in with an access key, which creates the account.',
        reason: 'session_required',
        status: 0,
      })
    // Creation is a JSON write, which a page on another site cannot send.
    const created = await Api.json<{
      id: string
      tempo: readonly Api.TempoAccountResponse[]
    }>(
      await (auth.fetch ?? fetch)(new URL('/v1/account', auth.url), {
        body: JSON.stringify({
          ...(chain !== undefined ? { chain } : {}),
          client_id: auth.clientId,
        }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        // A redirect would send the session cookie's request to another origin.
        redirect: 'manual',
      }),
    )
    // The creation reads the session cookie, whose user can differ from the token's.
    if (created.id !== listed.id) return []
    return created.tempo
  })()
  const [account] = tempo
  if (!account) return undefined
  return Api.tempoAccount(account, { getFn: options.getFn })
}

export declare namespace get {
  type Options = {
    /**
     * The app's access token, from a sign-in or refresh, which authenticates the read in place of
     * the session cookie, such as in a frame on another site, whose requests carry no cookie. With
     * it, the read sends the token as a Bearer token, or as a DPoP token with a proof from the
     * instance's `dpop` key. A user without an account still needs the session cookie, which the
     * creation of the first account reads. If that cookie names another user, the action returns
     * `undefined`.
     * Outside a page, no cookie reaches Tempo ID, so the action throws `session_required` with
     * status 0, and sends no creation request.
     */
    accessToken?: string | undefined
    /**
     * The chain that the app acts on, by its name in `GET /v1/chains`, such as `testnet`, or its ID.
     * On a chain with configurable accounts, the address is the configuration's. Absent, the owner
     * key's. An unknown chain throws `invalid_field`.
     */
    chain?: number | string | undefined
    /**
     * Runs the ceremony of a passkey owner when the account signs, in place of
     * `navigator.credentials.get`.
     */
    getFn?: Api.tempoAccount.Options['getFn']
  }

  /** The account, or `undefined` when the user has none in the app's realms. */
  type ReturnType = TempoAccount | undefined
}

/**
 * Requests one payment from the user's Tempo Account `account` on Tempo ID's payment page: a
 * transfer of `amount` of `token` to `to`. The account's owner signs the transfer on the page, a
 * passkey included, so the app needs no access key. Tempo ID's sponsor pays the network fee. If
 * the account holds too little of `token`, the transfer swaps from another token of the account,
 * and the page shows the most that the swap spends. If no token covers it, the page offers a deposit.
 *
 * Without `account`, the page signs the user in if needed, and pays from the account selected for
 * the app, else the user's oldest. With `challenge`, a sign-in message that the app's server issues, such as with
 * `siwe.start`, the account also signs the message before the transfer. The app then knows who
 * paid from one approval, with no separate sign-in: its server verifies `challengeSignature` with
 * `siwe.complete`. The approval grants the app no tokens and no access key.
 *
 * The page opens on the app's page: in a frame in a dialog, or in a popup window. The action
 * resolves with the `transaction` once the chain includes the transfer. A Reject on the page throws
 * `Accounts.RequestError` with `access_denied`, and a close of the dialog or the popup throws an
 * `AbortError`. A frame without a Tempo ID session signs the user in on its own page, as the
 * dialog's sign-in does, and creates a new user's passkey account there. A frame that the app's
 * page covers, or whose sign-in cannot show the payment, such as in a browser that keeps no frame
 * cookie, requests a popup, which opens at once within the user's click, else from a click on the
 * dialog's offer. In a browser without IntersectionObserver v2, a call within a click opens the
 * popup at once unless the dialog's preloaded frame reported that Tempo ID trusts the app. A payment that a plugin
 * takes as `attempt` opens it once the attempt sends nothing, within the same click. A deposit shows in the
 * frame, except a purchase by card, which offers the popup. Call it in a click handler, since a
 * popup opens only within one. A page that sends `Cross-Origin-Opener-Policy: same-origin` severs
 * its handle to the popup, so a popup's call stays pending until `signal` aborts.
 *
 * @throws {RequestError} `invalid_request` with the reason `invalid_field` and the field `amount`
 * for an `amount` that is not a decimal above 0 with at most 6 decimal places, and with the field
 * `to` for a `to` that is no address, before any page opens. `invalid_request` for a `memo` over
 * 32 bytes, before any page opens, for a `challenge`
 * that is no Sign-In with Ethereum message for the redirect URI's origin and the payment's chain
 * without resources, and for a return without a transaction hash, an account, or the challenge's
 * signature. `access_denied` when the user rejects the payment.
 * @throws {PageRequiredError} Outside a browser page, for a payment that the session's access key
 * does not send, such as one above its limits or after its expiry, also when the node refuses it,
 * with the refusal as its `cause`. Its message names that fix: a sign-in for an access key that
 * holds the payment, since the payment page has no redirect.
 * @throws {Accounts.AccessKeyRequiredError} Outside a browser page, when the node refuses the
 *   payment since it holds the session's access key revoked, with the refusal as its `cause`.
 * @throws {OriginError} For a redirect URI on another origin than the page.
 * @throws {BlockedError} When the browser blocks the popup.
 *
 * @example
 * ```ts
 * button.onclick = async () => {
 *   const { transaction } = await Actions.account.pay(auth, {
 *     account: session.accessKey.account,
 *     amount: '50',
 *     memo: 'order-123',
 *     note: 'Pro plan, November',
 *     to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
 *     token: 'ousd',
 *   })
 * }
 * ```
 */
export async function pay<const options extends pay.Options>(
  auth: Config,
  options: options,
): Promise<pay.ReturnType<options>> {
  const { account, attempt, challenge, note, to, token } = options
  const amount = Payment.amount(options.amount)
  Payment.to(to)
  // Text goes on the chain as its UTF-8 bytes, and hex as its own bytes.
  const memo =
    options.memo === undefined ? undefined : Payment.memo(options.memo)
  // A dialog needs a page, which also holds the default redirect URI. Without one, only the attempt
  // can send the payment.
  if (typeof document === 'undefined') {
    const sent = await attempt
    if (sent) return sent as pay.ReturnType<options>
    throw new PageRequiredError({ payment: true })
  }
  const redirectUri = approvalRedirectUri(auth, options)
  const chainId = options.chainId ?? auth.chainId
  // A function's message arrives while the dialog or the popup opens, so the user waits for the
  // slower of the two only. Its signal aborts once the call ends.
  const ending = new AbortController()
  const issued =
    typeof challenge === 'function' ? challenge(ending.signal) : undefined
  // A page that fails first leaves the function's rejection unread.
  issued?.catch(() => {})

  const url = await approve(auth, {
    challenge: issued,
    hold: attempt,
    label: 'Pay with Tempo',
    mode: options.mode ?? 'iframe',
    noun: 'payment',
    path: '/pay',
    query: {
      ...(account !== undefined ? { account } : {}),
      amount,
      chain_id: String(chainId),
      ...(typeof challenge === 'string' ? { challenge } : {}),
      client_id: auth.clientId,
      ...(memo !== undefined ? { memo } : {}),
      ...(note !== undefined ? { note } : {}),
      redirect_uri: redirectUri,
      to,
      token,
    },
    signal: options.signal,
    skeleton: 'payment',
    text: 'Continue in a Tempo ID window to pay.',
  })
    .catch(async (error: unknown) => {
      // The attempt can still send the payment after the page ends, such as at a close of the dialog.
      const sent = await attempt
      if (sent) return sent
      throw error
    })
    .finally(() => ending.abort())
  if (!(url instanceof URL)) return url as pay.ReturnType<options>
  const transaction = transactionOf(url, { redirectUri })
  if (!transaction) throw transactionOf.missing()
  const address = (() => {
    const value = Callback.parameter(url, { name: 'account', redirectUri })
    if (value !== undefined && Address.validate(value, { strict: false }))
      return Address.checksum(value)
    // An earlier page returns no account for a request that names one.
    if (value === undefined && account !== undefined) return account
    throw missing('account')
  })()
  if (challenge === undefined)
    return { address, transaction } as pay.ReturnType<options>
  const challengeSignature = Callback.parameter(url, {
    name: 'challenge_signature',
    redirectUri,
  })
  if (!challengeSignature || !Hex.validate(challengeSignature)) {
    // The transfer landed, so the payment of a function's message returns without the signature,
    // such as from an earlier page that takes no message after it loads.
    if (typeof challenge === 'function')
      return { address, transaction } as pay.ReturnType<options>
    throw missing('challenge_signature')
  }
  return { address, challengeSignature, transaction } as pay.ReturnType<options>
}

export declare namespace pay {
  type Options = {
    /**
     * The user's Tempo Account that pays, on the payment's chain. Absent, the page pays from the
     * account selected for the app, else the user's oldest, and signs the user in first if needed.
     */
    account?: `0x${string}` | undefined
    /**
     * The amount that the recipient receives, as a decimal string in whole units above 0, with at
     * most 6 decimal places, such as `50`.
     */
    amount: string
    /**
     * A send of the same payment in progress, such as `accounts.pay`'s send with the session's access
     * key, which resolves with the payment, or `undefined` if it sent nothing. In a frame, the page
     * loads in a hidden dialog until it settles. A payment returns with no dialog, and `undefined`
     * shows the dialog. A popup opens only after it settles. Absent, the page shows at once.
     */
    attempt?:
      | Promise<Pick<ReturnType, 'address' | 'transaction'> | undefined>
      | undefined
    /** The payment's chain. Defaults to the instance's `chainId`. */
    chainId?: number | undefined
    /**
     * A Sign-In with Ethereum message (EIP-4361) for the redirect URI's origin and the payment's
     * chain, without resources, such as the message of `siwe.start`. The paying account signs its
     * EIP-191 hash before the transfer, and the return holds the signature. A function returns the
     * message, such as from the app's server. It runs at the call, and the page receives the
     * message once it resolves: a frame loads meanwhile, and a popup opens blank. Its signal
     * aborts once the call ends. A rejection closes the page, and rejects, before any transfer.
     * Absent, the account signs no message.
     */
    challenge?: string | ((signal: AbortSignal) => Promise<string>) | undefined
    /**
     * The transfer's memo, which the chain records: text, sent as its UTF-8 bytes, or hex, of 1 to
     * 32 bytes. Hex is `0x` and an even count of hex digits. Any other value is text, such as
     * `0xINV-1042`. Absent, the transfer holds no memo.
     */
    memo?: string | undefined
    /**
     * `iframe` opens the payment page on the app's page in a frame in a dialog, and `popup` in a
     * popup window. Defaults to `iframe`.
     */
    mode?: revokeAccessKey.Dialog | undefined
    /**
     * What the payment is for, of at most 140 characters. Only the page shows it, and the chain
     * records none. Absent, the page shows no note.
     */
    note?: string | undefined
    /**
     * The registered redirect URI that the page returns to, on the page's origin. Defaults to the
     * instance's `redirectUri`, or the root of the page's origin, such as `https://app.example/`.
     */
    redirectUri?: string | undefined
    /** Rejects the action with the signal's reason, and closes the dialog or the popup. */
    signal?: AbortSignal | undefined
    /** The recipient's address. */
    to: `0x${string}`
    /** The token that the recipient receives: its symbol in any case, such as `ousd`, or its address. */
    token: string
  }

  /**
   * The options of `accounts.pay`. Without `account` and `challenge`, it reads the session's
   * account. With `challenge`, the page picks the account.
   */
  type Parameters = Options

  type ReturnType<options extends Options = Options> = {
    /** The Tempo Account that paid. */
    address: `0x${string}`
    /** The hash of the transaction that holds the transfer. */
    transaction: `0x${string}`
  } & (options extends { challenge: string }
    ? {
        /**
         * The account's signature of the EIP-191 hash of `challenge`, which `siwe.complete`
         * verifies for the account's current configuration.
         */
        challengeSignature: `0x${string}`
      }
    : options extends { challenge: (signal: AbortSignal) => Promise<string> }
      ? {
          /**
           * The account's signature of the EIP-191 hash of the function's message. Absent for a
           * page that returned none after the transfer, such as an earlier page.
           */
          challengeSignature?: `0x${string}` | undefined
        }
      : {
          /** The account's signature of `challenge`. Present only for a request with one. */
          challengeSignature?: `0x${string}` | undefined
        })
}

/**
 * Requests one payment from the guest account of `session` on Tempo ID's payment page: a transfer
 * of `amount` of `token` to `to`. The page opens with a guest request that the guest account's key
 * pair signs, reads the payment, and offers a deposit for a shortfall. It then posts the transfer,
 * which the key pair signs on the app's page, and Tempo ID's sponsor pays its fee. The key pair
 * signs only the requested transfer, and only one transaction for each payment. Each popup that
 * the page opens later, such as the deposit's, holds a fresh guest request, and the page renews the
 * request before it expires. The call sends no request before the page shows.
 *
 * With `session` as a function, the call makes a guest offer: the page opens as the signed-out
 * payment page with `guest=offer` and a random `state`, and signs the user in. If the user selects
 * Continue as guest, the page posts `tempo-id:guest.request` with the `state`. The call then runs
 * the function, which starts the guest session, and answers with the first guest request, so the
 * same page pays from the guest account. If the user signs in instead, the page pays from the
 * user's account. The call returns the account that the return URL names as `address`: the guest
 * account once its transfer landed, and otherwise the account of the user that signed in, also after
 * a failed start of the guest session or a guest transfer that never landed.
 *
 * @throws {RequestError} As {@link pay} throws it for `amount`, `memo`, and `to`, before any page
 *   opens, and `access_denied` when the user rejects the payment.
 * @throws {PageRequiredError} Outside a browser page.
 * @throws {SupersededError} For a guest offer, when a sign-out since the call started supersedes the
 *   guest session that Continue as guest starts. The page closes.
 * @throws {Accounts.SignedOutError} When the store holds another key pair than the session's.
 * @throws {OriginError} For a redirect URI on another origin than the page.
 * @throws {BlockedError} When the browser blocks the popup.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const session = await Actions.guest.session(accounts.config)
 * const { transaction } = await Actions.account.pay_guest(accounts.config, {
 *   amount: '12.5',
 *   session,
 *   to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
 *   token: 'ousd',
 * })
 * ```
 */
export async function pay_guest(
  auth: Config,
  options: pay_guest.Options,
): Promise<pay_guest.ReturnType> {
  const { note, to, token } = options
  const amount = Payment.amount(options.amount)
  Payment.to(to)
  const memo =
    options.memo === undefined ? undefined : Payment.memo(options.memo)
  if (typeof document === 'undefined')
    throw new PageRequiredError({ payment: true })
  const redirectUri = approvalRedirectUri(auth, options)
  const chainId = options.chainId ?? auth.chainId
  // The guest module loads at the first guest payment, and signs from the store, with no request.
  const loading = import('./guest.js')
  loading.catch(() => {})
  // The checkout ID names this payment. Each guest request of the payment, also a renewal, signs the
  // same one, so Tempo ID keeps one record for it, and another payment never shares that record.
  // `Bytes.random` needs only `crypto.getRandomValues`, which React Native polyfills, and the
  // URL-safe Base64 holds only letters, digits, `-`, and `_`.
  const checkout = Base64.fromBytes(Bytes.random(16), { pad: false, url: true })
  // A guest offer binds the page's selection of Continue as guest to this payment.
  const state =
    typeof options.session === 'function'
      ? Base64.fromBytes(Bytes.random(16), { pad: false, url: true })
      : undefined

  /**
   * Returns the guest module, or throws `SignedOutError` once the instance's session no longer holds
   * the guest session `held`, such as after a sign-out, which keeps the key pair.
   */
  const holding = async (held: Session.GuestSession) => {
    const Guest = await loading
    if (
      options.current &&
      !Guest.active({ current: options.current(), started: held })
    )
      throw new SignedOutError()
    return Guest
  }

  const url = await approve(auth, {
    guest: {
      request: async (held) => {
        const Guest = await holding(held)
        const { address, value } = await Guest.request(auth, {
          chainId,
          checkout,
          redirectUri,
        })
        // A store that lost the session's key pair holds a new guest account, which pays nothing
        // for this session.
        if (!Address.isEqual(address, held.address)) throw new SignedOutError()
        return value
      },
      session: options.session,
      // The instance's session must hold the guest session before and after the signature.
      sign: async (transaction, held) =>
        (await loading).transfer(auth, {
          amount,
          chainId,
          current: options.current,
          memo,
          session: held,
          to,
          token,
          transaction,
        }),
      state,
    },
    label: 'Pay with Tempo',
    mode: options.mode ?? 'iframe',
    noun: 'payment',
    path: '/pay',
    query: {
      amount,
      chain_id: String(chainId),
      client_id: auth.clientId,
      ...(state !== undefined ? { guest: 'offer' } : {}),
      ...(memo !== undefined ? { memo } : {}),
      ...(note !== undefined ? { note } : {}),
      redirect_uri: redirectUri,
      ...(state !== undefined ? { state } : {}),
      to,
      token,
    },
    signal: options.signal,
    skeleton: 'payment',
    text: 'Continue in a Tempo ID window to pay.',
  })
  const transaction = transactionOf(url, { redirectUri })
  if (!transaction) throw transactionOf.missing()
  const address = machines.payer({
    account: Callback.parameter(url, { name: 'account', redirectUri }),
    held:
      typeof options.session === 'function'
        ? undefined
        : options.session.address,
  })
  if (!address) throw missing('account')
  return { address, transaction }
}

export declare namespace pay_guest {
  type Options = Omit<pay.Options, 'account' | 'attempt' | 'challenge'> & {
    /**
     * Returns the instance's session. Once it no longer holds the guest session, as
     * `Actions.guest.active` decides, the guest account signs no transfer and no renewal of the guest
     * request, and the page receives the refusal. Absent, only the stored key pair counts.
     */
    current?: (() => Session.Any | undefined) | undefined
    /**
     * The guest session whose guest account pays, or a function that starts it, for a guest offer
     * on the signed-out payment page. The function runs when the user selects Continue as guest,
     * again after a failure. A close of the page aborts its `signal`, and discards its result.
     */
    session:
      | Session.GuestSession
      | ((options: { signal: AbortSignal }) => Promise<Session.GuestSession>)
  }

  type ReturnType = pay.ReturnType<Omit<Options, 'session'>>
}

/**
 * Revokes the access key `accessKey` of the user's Tempo Account `account` on the chain `chainId`,
 * with the user's cloud wallet as the owner. Tempo ID sends the transaction from the account, since
 * the chain refuses keychain changes from an access key, and returns its receipt, or `null` when the
 * chain held the access key revoked already. An access key that the chain has not registered yet
 * registers without limits or calls and revokes in the same transaction, so its key authorization
 * can never register it later. The access key must be one that Tempo ID signed for the user.
 *
 * With `accessToken`, any app, first-party or third-party, revokes an access key that Tempo ID signed
 * for the app itself, through `POST /v1/access-keys/revoke`, without an approval or a recent
 * sign-in. Without it, the page of a first-party app with the `tempo-id:sign` scope revokes any of
 * the user's access keys through `POST /v1/account/access-keys/revoke`, with the session cookie,
 * after the user approves the revocation there.
 *
 * With `mode: 'redirect'`, any app revokes its own access key on Tempo ID's approval page, where the
 * account's owner signs, a passkey included. The action then returns the page's `url` to send the
 * browser to. The page returns to `redirectUri` with `state` and `transaction`, the hash of the
 * transaction, or with `error` and `error_description`. An app uses it when `accessToken` throws
 * `webauthn_required`, for an account that only a passkey owns.
 *
 * With `mode: 'iframe'` or `mode: 'popup'`, the same approval page opens on the app's page: in a
 * frame in a dialog, the dialog that the sign-in uses, or in a popup window. The action resolves
 * with the `transaction`, or `null` for an access key that the chain held revoked already. A Cancel
 * on the page throws `Accounts.RequestError` with `access_denied`, and a close of the dialog or the
 * popup throws an `AbortError`. A frame without a Tempo ID session, or one that the app's page
 * covers, requests a popup, which opens at once within the user's click, else from a click on the
 * dialog's offer. In a browser without
 * IntersectionObserver v2, a call within a click opens the popup at once unless the dialog's
 * preloaded frame reported that Tempo ID trusts the app. Call it in a click handler, since a popup
 * opens only within one. A page that sends `Cross-Origin-Opener-Policy: same-origin` severs its
 * handle to the popup, so a popup's call stays pending until `signal` aborts.
 *
 * @throws {Accounts.RequestError} When Tempo ID refuses the request, with one of these `reason`
 *   values, which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
 *   - `invalid_token`: With `accessToken`, the token is malformed, expired, or revoked, or belongs
 *     to another app than `clientId`.
 *   - `invalid_dpop_proof`: With a DPoP `accessToken`, the proof is missing, invalid, or replayed.
 *   - `sign_not_permitted`: Without `accessToken`, the page is not the page of a first-party app
 *     with the `tempo-id:sign` scope, or `clientId` names another app.
 *   - `session_required`: Without `accessToken`, the user is not signed in to Tempo ID.
 *   - `unknown_key`: The user holds no live access key at the address on the account and chain,
 *     or, with `accessToken`, none that Tempo ID signed for the app.
 *   - `foreign_account`: The account is not the user's in the realms of the app that `clientId`
 *     names.
 *   - `webauthn_required`: No cloud wallet of the user owns the account on the chain. The
 *     account's passkey revokes the access key, on the approval page or the permissions page.
 *   - `invalid_field`: An address or the chain ID is malformed.
 *   - `insufficient_balance`: The account cannot pay the network fee of the transaction, and no
 *     sponsor pays it. A deposit to the account resolves it.
 *   - `rate_limited`: The user exceeded the limit of account requests. Retry after `Retry-After`
 *     seconds.
 *   - `upstream_unavailable`: The chain or the cloud wallet's provider failed. Retry later.
 *   - `unexpected`: An unexpected failure. Retry the request.
 *
 * @example
 * ```ts
 * const receipt = await Actions.account.revokeAccessKey(auth, {
 *   accessKey: session.accessKey.keyAuthorization.keyId,
 *   accessToken: session.tokens.accessToken,
 *   account: session.accessKey.account,
 *   chainId: 31318,
 * })
 *
 * const { url } = await Actions.account.revokeAccessKey(auth, {
 *   accessKey: session.accessKey.keyAuthorization.keyId,
 *   account: session.accessKey.account,
 *   chainId: 31318,
 *   mode: 'redirect',
 * })
 * window.location.assign(url)
 *
 * button.onclick = async () => {
 *   const { transaction } = await Actions.account.revokeAccessKey(auth, {
 *     accessKey: session.accessKey.keyAuthorization.keyId,
 *     account: session.accessKey.account,
 *     chainId: 31318,
 *     mode: 'iframe',
 *   })
 * }
 * ```
 */
export async function revokeAccessKey<
  const mode extends revokeAccessKey.Mode = 'request',
>(
  auth: Config,
  options: revokeAccessKey.Options<mode>,
): Promise<revokeAccessKey.ReturnType<mode>> {
  const { accessKey, account, chainId } = options
  // The type parameter follows the caller's `mode`. The union of every mode narrows on it.
  const delivery: revokeAccessKey.Options = options

  if (
    delivery.mode === 'iframe' ||
    delivery.mode === 'popup' ||
    delivery.mode === 'redirect'
  ) {
    // A dialog needs a page, which also holds the default redirect URI.
    if (delivery.mode !== 'redirect' && typeof document === 'undefined')
      throw new PageRequiredError()
    const redirectUri = approvalRedirectUri(auth, delivery)
    const state = delivery.mode === 'redirect' ? delivery.state : undefined
    const query = {
      account,
      address: accessKey,
      chain_id: String(chainId),
      client_id: auth.clientId,
      redirect_uri: redirectUri,
      ...(state !== undefined ? { state } : {}),
    }
    if (delivery.mode === 'redirect') {
      const url = new URL('/access-keys/revoke', auth.url)
      url.search = new URLSearchParams(query).toString()
      return { url: url.href } as revokeAccessKey.ReturnType<mode>
    }
    const url = await approve(auth, {
      label: 'Revoke access with Tempo',
      mode: delivery.mode,
      noun: 'revocation',
      path: '/access-keys/revoke',
      query,
      signal: delivery.signal,
      text: 'Continue in a Tempo ID window to revoke access.',
    })
    // A revocation of an access key that the chain held revoked already returns no transaction.
    return {
      transaction: transactionOf(url, { redirectUri }) ?? null,
    } as revokeAccessKey.ReturnType<mode>
  }
  const { accessToken } = delivery

  const shared = { account, chainId, client_id: auth.clientId }
  const response = await (async () => {
    if (!accessToken)
      return await Api.post(auth, '/v1/account/access-keys/revoke', {
        json: { ...shared, target: { address: accessKey, type: 'address' } },
      })
    const path = '/v1/access-keys/revoke'
    // The route's CORS response admits any origin without credentials, which a browser refuses for
    // a request with credentials, so the access token is the only credential.
    return await Api.post(auth, path, {
      credentials: 'omit',
      headers: await Api.tokenHeaders(auth, {
        accessToken,
        method: 'POST',
        url: new URL(path, auth.url),
      }),
      json: { ...shared, address: accessKey },
    })
  })()
  const body = await Api.json<{ receipt?: RpcTransactionReceipt | undefined }>(
    response,
  )
  return (
    body.receipt ? formatTransactionReceipt(body.receipt) : null
  ) as revokeAccessKey.ReturnType<mode>
}

export declare namespace revokeAccessKey {
  /** Where the approval page opens on the app's page: a frame in a dialog, or a popup window. */
  type Dialog = 'iframe' | 'popup'

  /**
   * How the revocation reaches the account's owner: `request` sends it to Tempo ID, which signs
   * with the user's cloud wallet, `redirect` returns the URL of Tempo ID's approval page, and
   * `iframe` and `popup` open that page on the app's page.
   */
  type Mode = Dialog | 'redirect' | 'request'

  type Options<mode extends Mode = Mode> = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /** The address of the user's Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The access key's chain ID. */
    chainId: number
    /**
     * How the revocation reaches the account's owner. `redirect` returns the URL of Tempo ID's
     * approval page, where the account's owner signs, as an account that only a passkey owns needs.
     * `iframe` opens that page on the app's page in a frame in a dialog, and `popup` in a popup
     * window. Defaults to `request`, which opens no page.
     */
    mode?: mode | undefined
  } & Modes[mode]

  /** The options of each mode, which no other mode takes. */
  type Modes = {
    iframe: Modes.Dialog & {
      /** Opens the approval page in a frame in a dialog. */
      mode: 'iframe'
    }
    popup: Modes.Dialog & {
      /** Opens the approval page in a popup window. */
      mode: 'popup'
    }
    redirect: {
      /** Returns the approval page's URL. */
      mode: 'redirect'
      /**
       * The registered redirect URI that the page returns to. Defaults to the instance's
       * `redirectUri`, or the root of the page's origin, such as `https://app.example/`.
       */
      redirectUri?: string | undefined
      /** An opaque value that the page returns as it is. */
      state?: string | undefined
    }
    request: {
      /**
       * The app's access token, from a sign-in or refresh, which authenticates the revocation of the
       * app's own access key, for any app. The request sends it as a Bearer token, or as a DPoP token
       * with a proof from the instance's `dpop` key, and no session cookie. Absent, the request needs
       * the session cookie and the page of a first-party app with `tempo-id:sign`.
       */
      accessToken?: string | undefined
      /** Sends the revocation to Tempo ID, which opens no page. */
      mode?: 'request' | undefined
    }
  }

  namespace Modes {
    /** The options of the modes that open the approval page on the app's page. */
    type Dialog = {
      /**
       * The registered redirect URI that the page returns to, on the page's origin. Defaults to the
       * instance's `redirectUri`, or the root of the page's origin, such as `https://app.example/`.
       */
      redirectUri?: string | undefined
      /** Rejects the action with the signal's reason, and closes the dialog or the popup. */
      signal?: AbortSignal | undefined
    }
  }

  /**
   * What the caller's `mode` returns: the receipt of the revoking transaction, the approval page's
   * URL, or the hash of the transaction that the approval page sent.
   */
  type ReturnType<mode extends Mode = Mode> = Returns[mode]

  /** What each mode returns. */
  type Returns = {
    iframe: Returns.Dialog
    popup: Returns.Dialog
    redirect: {
      /** The approval page's URL, to send the browser to. */
      url: string
    }
    /**
     * The receipt of the revoking transaction, which Tempo ID returns with its response, or `null`
     * when the chain held the access key revoked already.
     */
    request: TransactionReceipt | null
  }

  namespace Returns {
    /** What the modes that open the approval page on the app's page return. */
    type Dialog = {
      /**
       * The hash of the revoking transaction, or `null` when the chain held the access key
       * revoked already.
       */
      transaction: `0x${string}` | null
    }
  }
}

/**
 * Revokes the access keys `keyIds` of the user's Tempo Account `account` on the chain `chainId` in
 * one transaction, from the page of a first-party app with the `tempo-id:sign` scope, through
 * `POST /v1/account/access-keys/revoke` with the session cookie, after the user approves the
 * revocation there. Without `keyIds`, it revokes every live access key of the account on the chain,
 * at most 100, newest first. A cloud wallet signs on the server. For an account that a passkey owns,
 * the passkey signs once at the page's origin, which the passkey's relying party must cover beside
 * Tempo ID's. An access key that the chain has not registered yet registers without limits or calls
 * and revokes in the same transaction. Each access key must be one that Tempo ID signed for the user.
 *
 * Returns the transaction's receipt, or `null` when the chain sent no transaction, and each access
 * key with the hash of its transaction, or `null` for one that the chain held revoked already.
 *
 * @example
 * ```ts
 * const { receipt, revoked } = await Actions.account.revokeAccessKeys(auth, {
 *   account: tempoAccount.address,
 *   chainId: 31318,
 *   keyIds: ['0x81c0…52fb', '0x9f10…0f08'],
 * })
 * ```
 */
export async function revokeAccessKeys(
  auth: Config,
  options: revokeAccessKeys.Options,
): Promise<revokeAccessKeys.ReturnType> {
  const { account, chainId, getFn, keyIds } = options
  const json = {
    account,
    chainId,
    client_id: auth.clientId,
    target: keyIds ? { keyIds, type: 'ids' } : { type: 'all' },
  }
  const path = '/v1/account/access-keys/revoke'
  const first = await Api.json<
    | revokeAccessKeys.Response
    | { next: { options: Types.CredentialRequestOptions<true> } }
  >(await Api.post(auth, path, { json }))
  const body = await (async () => {
    if (!('next' in first)) return first
    const deserialized = Authentication.deserializeOptions(first.next.options)
    const assertion = Authentication.serializeResponse(
      await Authentication.sign(
        // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
        getFn ? ({ ...deserialized, getFn } as never) : deserialized,
      ),
    )
    return await Api.json<revokeAccessKeys.Response>(
      await Api.post(auth, path, { json: { ...json, passkey: { assertion } } }),
    )
  })()
  return {
    receipt: body.receipt ? formatTransactionReceipt(body.receipt) : null,
    revoked: body.revoked,
  }
}

export declare namespace revokeAccessKeys {
  type Options = {
    /** The address of the user's Tempo Account that the access keys act for. */
    account: `0x${string}`
    /** The access keys' chain ID. */
    chainId: number
    /** Runs the WebAuthn ceremony of a passkey owner in place of `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /** The IDs of the access keys, at most 100, each once. Absent for every live access key of the account on the chain. */
    keyIds?: readonly `0x${string}`[] | undefined
  }

  type ReturnType = {
    /** The receipt of the revoking transaction, or `null` when the chain sent no transaction. */
    receipt: TransactionReceipt | null
    /** The revoked access keys, in the order of `keyIds`, or newest first. */
    revoked: Response['revoked']
  }

  /** The response body after the revocation. */
  type Response = {
    /** The node's receipt, in its RPC format. Absent when the chain sent no transaction. */
    receipt?: RpcTransactionReceipt | undefined
    /** The revoked access keys. */
    revoked: readonly {
      /** The access key's ID. */
      keyId: `0x${string}`
      /** The hash of the revoking transaction, or `null` when the chain held the access key revoked already. */
      transaction: `0x${string}` | null
    }[]
  }
}

/**
 * Signs `message` as the user's Tempo Account `account`, with the user's cloud wallet as the owner.
 * Tempo ID signs the message's EIP-191 hash. On a chain with configurable accounts, it returns the
 * account's serialized signature envelope (TIP-1107), which the signature verifier precompile's
 * `verifyConfigurableAccount` accepts. On a chain that `chain` names without them, the account is
 * the cloud wallet's own address, and it returns the cloud wallet's secp256k1 signature. Call it from the page of a first-party app with
 * the `tempo-id:sign` scope. An account that only a passkey owns throws `webauthn_required`, since
 * its passkey signs in the browser.
 *
 * @example
 * ```ts
 * const signature = await Actions.account.signMessage(auth, {
 *   account: tempoAccount.address,
 *   chain: 'devnet',
 *   message: 'Sign in to app.example.com',
 * })
 * ```
 */
export async function signMessage(
  auth: Config,
  options: signMessage.Options,
): Promise<`0x${string}`> {
  const { account, chain, message } = options
  const body = await Api.json<{ signature: `0x${string}` }>(
    await Api.post(auth, '/v1/account/sign-message', {
      json: {
        account,
        // An empty name goes to the API, whose schema refuses it, so no default chain signs.
        ...(chain !== undefined ? { chain } : {}),
        client_id: auth.clientId,
        message:
          typeof message === 'string'
            ? message
            : {
                raw:
                  typeof message.raw === 'string'
                    ? message.raw
                    : Hex.fromBytes(message.raw),
              },
      },
    }),
  )
  return body.signature
}

export declare namespace signMessage {
  type Options = {
    /** The address of the user's Tempo Account on `chain`, which the user's cloud wallet owns. */
    account: `0x${string}`
    /**
     * The chain whose configuration of the account signs, by its name in `GET /v1/chains`, such as
     * `devnet`, or its ID. Defaults to the first chain whose accounts are configurable.
     */
    chain?: number | string | undefined
    /** The message, as UTF-8 text, or as raw bytes or hex. */
    message:
      | string
      | {
          /** The message's raw bytes. */
          raw: `0x${string}` | Uint8Array
        }
  }
}

/**
 * Signs `typedData` (EIP-712) as the user's Tempo Account `account`, with the user's cloud wallet as
 * the owner, as {@link signMessage} signs a message. Tempo ID derives the typed data's EIP-712 hash,
 * and returns the account's serialized signature envelope on a chain with configurable accounts, or
 * the cloud wallet's secp256k1 signature on a chain that `chain` names without them. Each
 * bigint travels as a decimal string.
 *
 * @example
 * ```ts
 * const signature = await Actions.account.signTypedData(auth, {
 *   account: tempoAccount.address,
 *   typedData: {
 *     domain: { name: 'App', version: '1', chainId: 31318 },
 *     message: { amount: 1_000_000n },
 *     primaryType: 'Order',
 *     types: { Order: [{ name: 'amount', type: 'uint256' }] },
 *   },
 * })
 * ```
 */
export async function signTypedData<
  const typedData extends TypedData | Record<string, unknown>,
  primaryType extends keyof typedData | 'EIP712Domain',
>(
  auth: Config,
  options: signTypedData.Options<typedData, primaryType>,
): Promise<`0x${string}`> {
  const { account, chain, typedData } = options
  const body = await Api.json<{ signature: `0x${string}` }>(
    await Api.post(auth, '/v1/account/sign-typed-data', {
      json: {
        account,
        // An empty name goes to the API, whose schema refuses it, so no default chain signs.
        ...(chain !== undefined ? { chain } : {}),
        client_id: auth.clientId,
        // JSON holds no bigint, so each one travels as its decimal string, which the hash reads.
        typedData: JSON.parse(
          JSON.stringify(
            {
              domain: typedData.domain ?? {},
              message: typedData.message,
              primaryType: typedData.primaryType,
              types: typedData.types,
            },
            (_, value: unknown) =>
              typeof value === 'bigint' ? value.toString() : value,
          ),
        ) as unknown,
      },
    }),
  )
  return body.signature
}

export declare namespace signTypedData {
  type Options<
    typedData extends TypedData | Record<string, unknown> = TypedData,
    primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
  > = {
    /** The address of the user's Tempo Account on `chain`, which the user's cloud wallet owns. */
    account: `0x${string}`
    /**
     * The chain whose configuration of the account signs, by its name in `GET /v1/chains`, such as
     * `devnet`, or its ID. Defaults to the first chain whose accounts are configurable.
     */
    chain?: number | string | undefined
    /** The typed data, as Viem's `signTypedData` takes it. */
    typedData: TypedDataDefinition<typedData, primaryType>
  }
}

/**
 * Changes the limits, the scopes, or both of the access key `accessKey` of the user's Tempo Account
 * `account` on the chain `chainId`, with the user's cloud wallet as the owner. Each limit replaces the
 * amount of its token that the access key can still spend, and keeps the limit's period. A token
 * that `limits` leaves out keeps its limit. `scopes` replace the access key's scopes. An access key
 * that the chain has not registered yet registers with the new permissions, so its earlier key
 * authorization can never register it. The new permissions meet the rules of every flow.
 *
 * Without `mode`, the page of a first-party app with the `tempo-id:sign` scope changes any of the
 * user's access keys through `POST /v1/account/access-keys/update`, after the user approves the
 * change there, and the action returns the receipt. With `mode: 'redirect'`, any app changes its own
 * access key on Tempo ID's approval page, which shows the change. The action then returns the page's `url` to send the browser to. The page
 * returns to `redirectUri` with `state` and `transaction`, the hash of the transaction, or with
 * `error` and `error_description`.
 *
 * With `mode: 'iframe'` or `mode: 'popup'`, the same approval page opens on the app's page: in a
 * frame in a dialog, the dialog that the sign-in uses, or in a popup window. The account's owner
 * signs there, a passkey included, and the action resolves with the `transaction`. A Cancel on the
 * page throws `Accounts.RequestError` with `access_denied`, and a close of the dialog or the popup
 * throws an `AbortError`. A frame without a Tempo ID session, or one that the app's page covers,
 * requests a popup, which opens at once within the user's click, else from a click on the dialog's
 * offer. In a browser without IntersectionObserver v2,
 * a call within a click opens the popup at once unless the dialog's preloaded frame reported that
 * Tempo ID trusts the app. Call it in a click handler, since a popup opens only within one. A
 * page that sends `Cross-Origin-Opener-Policy: same-origin` severs its handle to the popup, so a
 * popup's call stays pending until `signal` aborts.
 *
 * @throws {Accounts.RequestError} When Tempo ID refuses the request without `mode: 'redirect'`,
 *   with one of these `reason` values, which
 *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes. The approval page
 *   returns the same reasons to the redirect URI as `error_description`, and a visitor without a
 *   session as `error=login_required`.
 *   - `sign_not_permitted`: The page is not the page of a first-party app with the `tempo-id:sign`
 *     scope, or `clientId` names another app.
 *   - `session_required`: The user is not signed in to Tempo ID.
 *   - `unknown_key`: The user holds no live access key at the address on the account and chain,
 *     or, on the approval page, none of the app's.
 *   - `foreign_account`: The account is not the user's in the realms of the app that `clientId`
 *     names.
 *   - `webauthn_required`: No cloud wallet of the user owns the account on the chain. The
 *     account's passkey changes the access key on the approval page.
 *   - `invalid_field`: The access key is revoked, with `field: "address"`. Or a token of `limits`
 *     is one that the access key has no limit of, or appears twice, with `field` on that token. Or
 *     the request names neither `limits` nor `scopes`, or a field is malformed. A negative limit,
 *     with `field` on that limit, and a token that appears twice throw before any request in every
 *     `mode`, so a dialog opens no window.
 *   - An [access key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules),
 *     such as `invalid_recipients`, with `field` on the scope, such as `scopes.0.recipients`.
 *   - `access_key_changing`: Another request changes the same limit or the scopes of the access
 *     key. Retry after that request ends.
 *   - `insufficient_balance`: The account cannot pay the network fee of the transaction, and no
 *     sponsor pays it. A deposit to the account resolves it.
 *   - `rate_limited`: The user exceeded the limit of account requests. Retry after `Retry-After`
 *     seconds.
 *   - `upstream_unavailable`: The chain or the cloud wallet's provider failed. Retry later.
 *   - `unexpected`: An unexpected failure. Retry the request.
 *
 * @example
 * ```ts
 * const receipt = await Actions.account.updateAccessKey(auth, {
 *   accessKey: '0x9f10…',
 *   account: tempoAccount.address,
 *   chainId: 31318,
 *   limits: [{ limit: 10_000_000n, token: '0x20c0…' }],
 * })
 *
 * const { url } = await Actions.account.updateAccessKey(auth, {
 *   accessKey: session.accessKey.keyAuthorization.keyId,
 *   account: session.accessKey.account,
 *   chainId: 31318,
 *   mode: 'redirect',
 *   scopes: [Scopes.tip20('0x20c0…').transfer()],
 * })
 * window.location.assign(url)
 *
 * button.onclick = async () => {
 *   const { transaction } = await Actions.account.updateAccessKey(auth, {
 *     accessKey: session.accessKey.keyAuthorization.keyId,
 *     account: session.accessKey.account,
 *     chainId: 31318,
 *     limits: [{ limit: 10_000_000n, token: '0x20c0…' }],
 *     mode: 'iframe',
 *   })
 * }
 * ```
 */
export async function updateAccessKey<
  const mode extends updateAccessKey.Mode = 'request',
>(
  auth: Config,
  options: updateAccessKey.Options<mode>,
): Promise<updateAccessKey.ReturnType<mode>> {
  const { accessKey, account, chainId } = options
  // The type parameter follows the caller's `mode`. The union of every mode narrows on it.
  const delivery: updateAccessKey.Options = options

  // Tempo ID refuses a negative limit and two limits on one token, so they are refused before any
  // request, and a dialog opens no window, as a sign-in refuses them.
  const limits = options.limits ?? []
  const negative = limits.findIndex((entry) => entry.limit < 0n)
  if (negative !== -1)
    throw new RequestError({
      code: 'invalid_request',
      field: `limits.${negative}.limit`,
      message: `Invalid limit on ${limits[negative]!.token}: the limit is negative. Use a limit of 0 or more.`,
      reason: 'invalid_field',
      status: 0,
    })

  // Tokens compare as lowercase text, so a malformed token reaches Tempo ID, which refuses it.
  const repeated = limits.findIndex((entry, index) =>
    limits
      .slice(0, index)
      .some(
        (earlier) => earlier.token.toLowerCase() === entry.token.toLowerCase(),
      ),
  )
  if (repeated !== -1)
    throw new RequestError({
      code: 'invalid_request',
      field: `limits.${repeated}.token`,
      message: `Duplicate limit for ${limits[repeated]!.token}. Limit each token once.`,
      reason: 'invalid_field',
      status: 0,
    })

  const change = {
    ...(options.limits
      ? {
          limits: options.limits.map((entry) => ({
            limit: Hex.fromNumber(entry.limit),
            token: entry.token,
          })),
        }
      : {}),
    ...(options.scopes ? { scopes: options.scopes } : {}),
  }

  if (
    delivery.mode === 'iframe' ||
    delivery.mode === 'popup' ||
    delivery.mode === 'redirect'
  ) {
    // A dialog needs a page, which also holds the default redirect URI.
    if (delivery.mode !== 'redirect' && typeof document === 'undefined')
      throw new PageRequiredError()
    const redirectUri = approvalRedirectUri(auth, delivery)
    const state = delivery.mode === 'redirect' ? delivery.state : undefined
    const query = {
      account,
      address: accessKey,
      chain_id: String(chainId),
      client_id: auth.clientId,
      redirect_uri: redirectUri,
      ...(state !== undefined ? { state } : {}),
      update: Base64.fromString(JSON.stringify(change), {
        pad: false,
        url: true,
      }),
    }
    if (delivery.mode === 'redirect') {
      const url = new URL('/access-keys/update', auth.url)
      url.search = new URLSearchParams(query).toString()
      return { url: url.href } as updateAccessKey.ReturnType<mode>
    }
    const url = await approve(auth, {
      label: 'Change access with Tempo',
      mode: delivery.mode,
      noun: 'change',
      path: '/access-keys/update',
      query,
      signal: delivery.signal,
      text: 'Continue in a Tempo ID window to change access.',
    })
    const transaction = transactionOf(url, { redirectUri })
    if (!transaction) throw transactionOf.missing()
    return { transaction } as updateAccessKey.ReturnType<mode>
  }

  const body = await Api.json<{ receipt: RpcTransactionReceipt }>(
    await Api.post(auth, '/v1/account/access-keys/update', {
      json: {
        account,
        address: accessKey,
        chainId,
        client_id: auth.clientId,
        ...change,
      },
    }),
  )
  return formatTransactionReceipt(
    body.receipt,
  ) as updateAccessKey.ReturnType<mode>
}

export declare namespace updateAccessKey {
  /** Where the approval page opens on the app's page: a frame in a dialog, or a popup window. */
  type Dialog = revokeAccessKey.Dialog

  /**
   * How the change reaches the account's owner: `request` sends it to Tempo ID, `redirect` returns
   * the URL of Tempo ID's approval page, and `iframe` and `popup` open that page on the app's page.
   */
  type Mode = revokeAccessKey.Mode

  type Options<mode extends Mode = Mode> = {
    /** The access key's address. */
    accessKey: `0x${string}`
    /** The address of the user's Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The access key's chain ID. */
    chainId: number
    /**
     * The new remaining limits, one for each token that the access key's limits name. A token that
     * the list leaves out keeps its limit. Absent, every limit stays.
     */
    limits?:
      | readonly {
          /** The amount of the token that the access key can still spend, in base units. */
          limit: bigint
          /** The TIP-20 token. */
          token: `0x${string}`
        }[]
      | undefined
    /**
     * How the change reaches the account's owner. `redirect` returns the URL of Tempo ID's approval
     * page, which shows the change, as a third-party app needs, since its own page cannot show what
     * the user approves. `iframe` opens that page on the app's page in a frame in a dialog, and
     * `popup` in a popup window. Defaults to `request`, which opens no page.
     */
    mode?: mode | undefined
    /** The calls that the access key can make after the change. Absent, the scopes stay. */
    scopes?: Permissions['scopes']
  } & Modes[mode]

  /** The options of each mode, which no other mode takes. */
  type Modes = Omit<revokeAccessKey.Modes, 'request'> & {
    request: {
      /** Sends the change to Tempo ID, which opens no page. */
      mode?: 'request' | undefined
    }
  }

  /**
   * What the caller's `mode` returns: the receipt of the transaction that changed the access key,
   * the approval page's URL, or the hash of the transaction that the approval page sent.
   */
  type ReturnType<mode extends Mode = Mode> = Returns[mode]

  /** What each mode returns. */
  type Returns = {
    iframe: Returns.Dialog
    popup: Returns.Dialog
    redirect: revokeAccessKey.Returns['redirect']
    /** The receipt of the transaction that changed the access key. */
    request: TransactionReceipt
  }

  namespace Returns {
    /** What the modes that open the approval page on the app's page return. */
    type Dialog = {
      /** The hash of the transaction that changed the access key. */
      transaction: `0x${string}`
    }
  }
}

/**
 * Returns the redirect URI of an approval page: `options.redirectUri`, the instance's, or the root
 * of the page's origin, which registers with its trailing slash, as the sign-in's default does.
 */
function approvalRedirectUri(
  auth: Config,
  options: approvalRedirectUri.Options,
) {
  const redirectUri =
    options.redirectUri ??
    auth.redirectUri ??
    (globalThis.location ? `${globalThis.location.origin}/` : undefined)
  if (!redirectUri)
    throw new Error('The approval page needs `redirectUri` to return to.')
  return redirectUri
}

declare namespace approvalRedirectUri {
  type Options = {
    /** The redirect URI that the action names. */
    redirectUri?: string | undefined
  }
}

/**
 * Opens Tempo ID's approval page at `options.path` on the app's page: in a frame in a dialog at
 * `/embed` and the path, or in a popup window with `display=popup`. Resolves with the return to the
 * app, the redirect URI with `transaction`, or with the result of `options.hold`. Throws the page's
 * refusal or Cancel as `Accounts.RequestError`, and a close of the dialog or the popup as an
 * `AbortError`.
 */
async function approve<held = never>(
  auth: Config,
  options: approve.Options<held>,
): Promise<URL | held> {
  const { challenge, guest, hold, mode, path, query, signal } = options
  const redirectUri = query.redirect_uri
  signal?.throwIfAborted()
  // React Native defines `window` without `location`, so the check reads `document`.
  if (typeof document === 'undefined') throw new PageRequiredError()
  // Tempo ID posts the return only to the redirect URI's origin.
  if (new URL(redirectUri).origin !== window.location.origin)
    throw new OriginError({ origin: window.location.origin, redirectUri })

  const origin = new URL(auth.url).origin
  /** Returns the message of `error` that the page shows. */
  const fault = (error: unknown) =>
    error instanceof Error ? error.message : 'Signing failed.'
  // The values of the page's URL, the guest requests of the payment, and the guest account's one
  // signature, which the machine holds.
  // A guest offer opens the signed-out page, whose URL waits for no guest request. The guest
  // request arrives once the user selects Continue as guest.
  const actor = createActor(
    machines.approval.provide({
      actors: {
        // The machine's end aborts the signature, such as at a close of the dialog or an abort of
        // the payment, so the page receives no signature that the call no longer awaits.
        sign: fromPromise<void, machines.approval.Signature>(async (args) => {
          const { id, source, transaction } = args.input
          const post = (message: object) => {
            if (args.signal.aborted) return
            source.postMessage(
              { id, type: 'tempo-id:guest.signature', ...message },
              origin,
            )
          }
          if (!guest) throw new Error('No guest payment.')
          try {
            post({
              transaction: await guest.sign(transaction, await session()),
            })
          } catch (error) {
            // No signature exists, so the page can post the transaction again.
            post({ error: fault(error) })
            throw error
          }
        }),
        start: fromPromise((args) =>
          typeof guest?.session === 'function'
            ? guest.session({ signal: args.signal })
            : Promise.reject(new Error('No guest offer.')),
        ),
      },
    }),
    {
      input: {
        challenge: challenge !== undefined,
        guest: guest !== undefined && guest.state === undefined,
        offer: typeof guest?.session === 'function',
      },
    },
  ).start()
  challenge?.then(
    (message) => actor.send({ message, type: 'challenge.resolve' }),
    () => {},
  )
  /**
   * Returns the guest session: the held one, or the guest offer's, which the machine starts once at
   * the user's selection. A failed start lets the next selection try again, and fails no payment,
   * since the user can still sign in on the page. A supersession ends the call below.
   */
  const session = async () => {
    if (!guest) throw new Error('No guest payment.')
    if (typeof guest.session !== 'function') return guest.session
    actor.send({ type: 'offer.start' })
    const result = machines.guest(
      await waitFor(
        actor,
        (snapshot) => !snapshot.matches({ offer: 'starting' }),
      ),
    )
    if (result.type === 'started') return result.session
    if (result.type === 'failed' || result.type === 'superseded')
      throw result.error
    throw new Error('No guest offer.')
  }
  // A sign-out since the payment started supersedes the whole payment, so its guest offer ends the
  // page, and the call rejects with `SupersededError`.
  const superseded = new Promise<never>((_, reject) => {
    const subscription = actor.subscribe((snapshot) => {
      const result = machines.guest(snapshot)
      if (result.type !== 'superseded') return
      subscription.unsubscribe()
      reject(result.error)
    })
  })
  superseded.catch(() => {})
  /** Signs a fresh guest request, which the page's URL holds from then on. */
  const renew = async () => {
    if (!guest) throw new Error('No guest payment.')
    const value = await guest.request(await session())
    actor.send({ type: 'guest.resolve', value })
    return value
  }
  // The first guest request, which the guest account signs from the store, with no request. A
  // guest offer signs none until the user selects Continue as guest.
  const requested = guest && guest.state === undefined && renew()
  // The values that the page's URL waits for. Each rejects the call itself, so `pending` only signals.
  const pending =
    challenge || requested
      ? Promise.all([challenge, requested]).then(() => undefined)
      : undefined
  pending?.catch(() => {})
  /**
   * Returns the page's URL: in a frame at `/embed` and the path, or in a popup at the path. A popup
   * keeps the method that the frame requests, such as `mach` for Buy MACH.
   */
  const toUrl = (
    display: 'frame' | 'popup',
    method?: Sheet.load.Popup['method'],
  ) => {
    const values = machines.values(actor.getSnapshot())
    const url = new URL(display === 'frame' ? `/embed${path}` : path, auth.url)
    url.search = new URLSearchParams({
      ...query,
      ...(display === 'popup' && values.message !== undefined
        ? { challenge: values.message }
        : {}),
      ...(values.guest !== undefined ? { guest: values.guest } : {}),
      ...(display === 'popup' ? { display } : {}),
      ...(method ? { method } : {}),
    }).toString()
    return url.href
  }
  // The windows of this payment's frame and popups, the only sources of its guest messages, so a
  // concurrent payment's page never reaches this one's listener.
  const sources = new Set<Window>()
  /**
   * Opens the popup within the gesture: at the page, or blank until the values of its URL arrive,
   * since a popup blocker accepts `window.open` only within the gesture. A later popup of a guest
   * payment, such as the frame's deposit, holds a fresh guest request, since the first one expires.
   * Returns the popup, and the navigation of a blank popup, which rejects as its values do.
   */
  const open = (entry: approve.Popup = {}) => {
    // A guest offer that the user has not taken signs no guest request for a later popup.
    const renewal =
      entry.later && guest && machines.values(actor.getSnapshot()).guest
        ? renew()
        : undefined
    if (!renewal && machines.ready(actor.getSnapshot())) {
      const popup = Popup.openPopup(toUrl('popup', entry.method))
      if (popup) sources.add(popup)
      return { popup }
    }
    const popup = Popup.openPopup('about:blank')
    if (popup) sources.add(popup)
    const shown = (renewal ?? pending ?? Promise.resolve()).then(() => {
      if (popup && !popup.closed)
        popup.location.href = toUrl('popup', entry.method)
    })
    shown.catch(() => {})
    return { popup, shown }
  }
  const closed = () =>
    new DOMException(`The user closed the ${options.noun}.`, 'AbortError')
  /** Returns the return to the app, or throws the page's refusal or Cancel. */
  const finish = (value: string) => {
    const url = new URL(value)
    const refusal = Callback.error(url, { redirectUri })
    if (refusal) throw refusal
    return url
  }

  /**
   * Resolves once the page in `popup` returns to the app, or the user closes the popup. `shown` is
   * the navigation of a blank popup.
   */
  const watch = async (popup: Window, shown?: Promise<void>) => {
    let abort: (() => void) | undefined
    let settled = false
    let unblock: (() => void) | undefined
    let unwatch: (() => void) | undefined
    try {
      return await new Promise<URL>((resolve, reject) => {
        // The dialog's module loads from a chunk of its own, as `funding.open` loads it.
        void import('../internal/Sheet.js').then(
          (Sheet) => {
            if (settled) return
            unblock = Sheet.waiting({
              onCancel: () => reject(closed()),
              popup,
            })
          },
          () => undefined,
        )
        abort = () => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        superseded.catch(reject)
        // A rejected challenge or guest request closes the blank popup before any page shows. A
        // blank popup sends no `tempo-id:popup.open`, so the watcher misses its close, which the
        // end of `shown` reads.
        shown?.then(() => {
          if (popup.closed) reject(closed())
        }, reject)
        unwatch = Popup.watchPopup(popup, {
          onCallback: (value) => {
            // The watcher stops at the first message, and an approval page posts only its return
            // URL, so any other message ends the call.
            if (!('url' in value))
              return reject(
                new RequestError({
                  code: 'invalid_request',
                  message:
                    'Invalid return: the approval page posted no return URL. Try again.',
                  status: 0,
                }),
              )
            try {
              resolve(finish(value.url))
            } catch (error) {
              reject(error)
            }
          },
          onClose: () => reject(closed()),
          onClosed: () => unblock?.(),
          origin,
        })
      })
    } finally {
      settled = true
      if (abort) signal?.removeEventListener('abort', abort)
      unblock?.()
      unwatch?.()
      popup.close()
    }
  }

  // The page posts the guest payment's transaction for the guest account to sign, and asks for a
  // fresh guest request before the last one expires, from Tempo ID's origin, with a guest request of
  // this payment. The check accepts only the requested transfer, and the guest account signs one
  // transaction for each payment, so no second prepared transaction ever lands.
  const listener = (event: MessageEvent) => {
    // Only this payment's own frame or popups post its messages.
    if (!event.source || !sources.has(event.source as Window)) return
    const data = event.data as {
      guest?: unknown
      id?: unknown
      state?: unknown
      transaction?: unknown
      type?: unknown
    } | null
    if (!guest || event.origin !== origin) return
    // The guest requests are unique to this payment, so another payment's page never reaches it. A
    // guest offer's selection names the offer's `state` in place of a guest request, and asks for
    // the first one.
    const offered =
      guest.state !== undefined &&
      data?.type === 'tempo-id:guest.request' &&
      data.state === guest.state
    if (
      !offered &&
      (typeof data?.guest !== 'string' ||
        !machines.issued(actor.getSnapshot(), { value: data.guest }))
    )
      return
    const source = event.source as Window
    if (data.type === 'tempo-id:guest.request') {
      renew().then(
        (value) =>
          source.postMessage(
            { id: data.id, type: 'tempo-id:guest.requested', value },
            origin,
          ),
        (error: unknown) =>
          source.postMessage(
            {
              error: fault(error),
              id: data.id,
              type: 'tempo-id:guest.requested',
            },
            origin,
          ),
      )
      return
    }
    if (data.type !== 'tempo-id:guest.sign') return
    if (!machines.signs(actor.getSnapshot())) {
      source.postMessage(
        {
          error:
            'Refused signature: the guest account signs one transaction for each payment. Start the payment again.',
          id: data.id,
          type: 'tempo-id:guest.signature',
        },
        origin,
      )
      return
    }
    actor.send({
      id: data.id,
      source,
      transaction: data.transaction,
      type: 'sign.start',
    })
  }
  if (guest) window.addEventListener('message', listener)
  try {
    return await present()
  } finally {
    if (guest) window.removeEventListener('message', listener)
    actor.stop()
  }

  /** Shows the page in a popup or in the dialog's frame, and resolves with its return. */
  async function present(): Promise<URL | held> {
    // A popup blocker accepts `window.open` only within the gesture, so the popup opens before any
    // `await`. A popup cannot cover a send in progress, so `hold` settles first. As in a sign-in, a
    // browser without IntersectionObserver v2 opens the popup within the gesture unless the preloaded
    // frame reports the app as trusted. A plugin's send that outlasts the gesture leaves no popup to
    // open, so the frame's page offers it, and the user's click on Continue opens it.
    const direct =
      mode === 'popup' || (Popup.activated() && !FrameTrust.frames(auth))
    if (direct) {
      const held = hold && (await hold)
      if (held) return held
      if (mode === 'popup' || Popup.activated()) {
        const { popup, shown } = open()
        if (popup === null) throw new BlockedError()
        return await watch(popup, shown)
      }
    }
    // A send that settled before the frame leaves its page without a cover.
    const covering = direct ? undefined : hold

    const Sheet = await import('../internal/Sheet.js')
    // The guest request is local work, so the frame's URL waits for it with no request.
    if (requested) await requested
    // An abort while the dialog's module loads fired before the listener below, so it rejects here.
    signal?.throwIfAborted()
    const sheet = Sheet.load({
      // The page runs the passkey ceremony of the account's owner, for Tempo ID's origin. The payment
      // page also signs a visitor without a session in, which creates a new user's passkey account.
      allow:
        options.path === '/pay'
          ? `publickey-credentials-create ${origin}; publickey-credentials-get ${origin}`
          : `publickey-credentials-get ${origin}`,
      // A page that waits for `hold` takes no input until it settles. A page that waits for the
      // challenge's message shows the payment meanwhile, and keeps Pay busy itself.
      covered: covering !== undefined,
      deferred: challenge !== undefined,
      label: options.label,
      origin,
      // The payment page's sign-in opens its legal links in a new, unsandboxed tab.
      sandbox:
        'allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts',
      skeleton: options.skeleton,
      text: options.text,
      // A covered page shows its own skeleton, measured from its screen, until the cover lifts.
      url: `${toUrl('frame')}${covering ? '&covered=true' : ''}${challenge ? '&deferred=true' : ''}`,
    })
    const framed = sheet.window()
    if (framed) sources.add(framed)
    let abort: (() => void) | undefined
    try {
      return await new Promise<URL | held>((resolve, reject) => {
        abort = () => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        superseded.catch(reject)
        const show = () =>
          sheet.show({
            onCallback: (value) => {
              try {
                resolve(finish(value))
              } catch (error) {
                reject(error)
              }
            },
            onCancel: () => reject(closed()),
            onPopup: (entry) => {
              // The payment page opens the deposit pages at once for a frame's Buy MACH.
              const { popup, shown } = open({
                later: true,
                method: entry.method,
              })
              if (popup === null) {
                // The offer's Continue is the user's click, so only a blocker refuses it.
                if (!entry.automatic) reject(new BlockedError())
                return false
              }
              sheet.close()
              watch(popup, shown).then(resolve, reject)
              return true
            },
          })
        // The page loads in the hidden dialog while `hold` runs, so an access key's send shows no
        // dialog. A send of `hold` ends the call, and the dialog shows only once it sends nothing.
        if (covering)
          covering.then((held) => (held ? resolve(held) : show()), reject)
        else show()
        // The cover lifts once, after `hold` sends nothing and the message arrives, so the page takes
        // no input while `hold` can still send, and receives the message with the lift.
        if (covering || challenge)
          Promise.all([covering, challenge]).then(([held, value]) => {
            if (!held) sheet.uncover({ challenge: value })
          }, reject)
      })
    } finally {
      if (abort) signal?.removeEventListener('abort', abort)
      sheet.close()
    }
  }
}

declare namespace approve {
  /** A popup that the approval opens. */
  type Popup = {
    /** Whether the frame's page opens the popup, after the page showed. */
    later?: boolean | undefined
    /** The method that the frame requests, such as `mach` for Buy MACH. */
    method?: Sheet.load.Popup['method']
  }

  type Options<held = never> = {
    /**
     * The message that the account signs before the transfer, once it resolves. The frame's page
     * shows the payment at once, and receives the message with the lift. A popup opens blank, and loads the
     * page once the message arrives. A rejection closes the page, and rejects. Absent, the query
     * holds any challenge.
     */
    challenge?: Promise<string> | undefined
    /**
     * The guest account of a guest payment: the signer of each guest request, which the page's URL
     * holds, and of the one transaction that the page posts. A popup opens blank until the request
     * arrives. Absent, the page signs the user in.
     */
    guest?:
      | {
          /** Signs a fresh guest request of the guest session, with no request. */
          request: (session: Session.GuestSession) => Promise<string>
          /**
           * The guest session, or a function that starts it, for a guest offer. The approval's
           * machine runs the function at the user's selection, and aborts its `signal` at its end.
           */
          session:
            | Session.GuestSession
            | ((options: {
                signal: AbortSignal
              }) => Promise<Session.GuestSession>)
          /**
           * Checks and signs the transaction that the page posts as the guest session, and returns
           * it serialized.
           */
          sign: (
            transaction: unknown,
            session: Session.GuestSession,
          ) => Promise<`0x${string}`>
          /**
           * The `state` of a guest offer, which the signed-out page's URL holds beside
           * `guest=offer`. The page's `tempo-id:guest.request` names it once the user selects
           * Continue as guest, and the answer holds the first guest request. Absent, the page's URL
           * holds the first guest request.
           */
          state?: string | undefined
        }
      | undefined
    /**
     * Another send of the same payment, which resolves with its result, or `undefined` if it sent
     * nothing. The frame loads in a hidden dialog until it settles, and a result returns with no
     * dialog. The dialog, or a popup, shows only after it sends nothing. Absent, the page shows at
     * once.
     */
    hold?: Promise<held | undefined> | undefined
    /** The dialog's accessible name. */
    label: string
    /** Where the page opens: a frame in a dialog, or a popup window. */
    mode: revokeAccessKey.Dialog
    /** What the page approves, as the error of a close names it, such as `change`. */
    noun: string
    /** The approval page's path, such as `/access-keys/update`. */
    path: '/access-keys/revoke' | '/access-keys/update' | '/pay'
    /** The page's query, with the registered redirect URI that it returns to. */
    query: Record<string, string> & {
      /** The registered redirect URI, on the page's origin. */
      redirect_uri: string
    }
    /** Rejects the action with the signal's reason, and closes the dialog or the popup. */
    signal: AbortSignal | undefined
    /** The skeleton before the page shows, such as `payment`. Defaults to a list. */
    skeleton?: Sheet.load.Options['skeleton']
    /** The offer of a popup in place of the frame. */
    text: string
  }
}

/**
 * Upgrades a wallet.tempo passkey's account in place to a configurable account (TIP-1113), on the
 * chain of `accessKey`, from a page that the passkey's relying party covers. The passkey signs
 * once. With `accessKey`, an access key that signed as the passkey's own account, Tempo ID first
 * registers the access key through a transaction that the access key signs and Tempo ID sponsors,
 * so the access key keeps working after the upgrade. The account keeps its address. The passkey
 * stays its only owner, unless `addOwner` adds the user's cloud wallet in the same transaction. Call
 * it when a sign-in or `Actions.authorize` returns `upgradeAvailable: true`.
 *
 * An account that is configurable already throws `owner_exists`, unless `addOwner` adds the cloud
 * wallet to an account that the passkey alone owns.
 *
 * A cloud wallet's own account from another chain upgrades with `account` and `chain` alone. Tempo
 * ID signs that upgrade, so no passkey signs, and `addOwner` or `accessKey` throws `invalid_field`.
 *
 * @example
 * ```ts
 * const authorization = await Actions.email.signIn(auth, { code, email })
 * if (authorization.upgradeAvailable)
 *   await Actions.account.upgrade(auth, { accessKey: authorization.accessKey })
 * ```
 */
export async function upgrade(
  auth: Config,
  options: upgrade.Options,
): Promise<TempoAccount> {
  const { accessKey, getFn } = options
  const account = options.account ?? accessKey?.account
  // An access key without material and without `signer` throws here, before any request.
  const signer = accessKey
    ? AccessKey.toAccount(accessKey, { signer: options.signer })
    : undefined
  // Tempo ID reads a chain ID in `chain` as it reads a name.
  const { chain } = options
  const json = {
    ...(chain !== undefined ? { chain } : {}),
    client_id: auth.clientId,
    ...(options.addOwner ? { add_owner: options.addOwner } : {}),
    ...(accessKey ? { key_authorization: accessKey.keyAuthorization } : {}),
    target: { account, type: 'account' },
  }
  const first = await Api.json<
    | { account: Api.TempoAccountResponse }
    | {
        next: {
          accessKey?: { digest: `0x${string}` } | undefined
          options: Types.CredentialRequestOptions<true>
        }
      }
  >(await Api.post(auth, '/v1/account/upgrade', { json }))
  // An upgrade that the chain holds already, or that Tempo ID signs, returns the account without a
  // step.
  if ('account' in first) return Api.tempoAccount(first.account, { getFn })

  const { next } = first
  const deserialized = Authentication.deserializeOptions(next.options)
  const assertion = Authentication.serializeResponse(
    await Authentication.sign(
      // ox reads `getFn` beside request options at runtime, which its types admit only beside a challenge.
      getFn ? ({ ...deserialized, getFn } as never) : deserialized,
    ),
  )
  // The access key signs its registration raw, and Tempo ID wraps the signature for the account.
  const signature =
    next.accessKey && signer
      ? await signer.sign({ hash: next.accessKey.digest, raw: true })
      : undefined
  const upgraded = await Api.json<{ account: Api.TempoAccountResponse }>(
    await Api.post(auth, '/v1/account/upgrade', {
      json: {
        ...json,
        ...(signature ? { accessKey: { signature } } : {}),
        passkey: { assertion },
      },
    }),
  )
  return Api.tempoAccount(upgraded.account, { getFn })
}

export declare namespace upgrade {
  type Options = {
    /**
     * The access key of an authorization with `upgradeAvailable: true`, which the chain registers
     * before the upgrade. Without it, an access key that the passkey signed as its own account stops
     * working.
     */
    accessKey?: AccessKey.AccessKey | undefined
    /** The account to upgrade. Defaults to `accessKey.account`. */
    account?: `0x${string}` | undefined
    /**
     * The owner that the upgrade adds beside the passkey. `privy` adds the user's cloud wallet, so an
     * emailed-code sign-in reaches the account and signs its access keys. For an upgraded account that the
     * passkey alone owns, the passkey signs the update that adds it. Absent, the passkey stays the
     * only owner.
     */
    addOwner?: 'privy' | undefined
    /**
     * The chain to upgrade on, by its name in `GET /v1/chains`, such as `testnet`, or its ID.
     * Defaults to the chain of `accessKey`, or the first chain whose accounts are configurable. An
     * unknown chain throws `invalid_field` before the passkey's prompt.
     */
    chain?: number | string | undefined
    /** Runs the WebAuthn ceremony in place of `navigator.credentials.get`. */
    getFn?: Authentication.sign.Options['getFn'] | undefined
    /**
     * The account that the app supplied to the sign-in as its access key, which signs when
     * `accessKey` carries no material.
     */
    signer?: AccessKey.toAccount.Options['signer']
  }
}

/**
 * One user's connection of an app: the app, and the live access keys that the app and the APIs of
 * its connection hold.
 */
export type Connection = {
  /** The connection's live access keys, newest first. */
  accessKeys: readonly Connection.AccessKey[]
  /** The app of the connection. */
  app: {
    /** The app's client ID. */
    clientId: string
    /** The app's logo URL, or `null`. */
    logo: string | null
    /** The app's name, or `null`. */
    name: string | null
  }
}

export declare namespace Connection {
  /** One live access key of a connection. */
  type AccessKey = {
    /** The Tempo Account that the access key acts for. */
    account: `0x${string}`
    /** The access key's address. */
    address: `0x${string}`
    /** The access key's chain ID. */
    chainId: number
    /** When Tempo ID signed the access key, in milliseconds. */
    createdAt: number
    /** When the access key expires, in milliseconds. */
    expiresAt: number
    /** Who holds the access key: the app, or an API that holds it for the app's connection. */
    holder:
      | {
          /** The app holds the access key. */
          kind: 'app'
        }
      | {
          /** The API's registered resource, or `null` after its removal. */
          identifier: string | null
          /** An API holds the access key for the connection. */
          kind: 'api'
          /** The API's name, or `null` after its removal. */
          name: string | null
        }
  }

  /** A connection as Tempo ID's response holds it. */
  type Response = Omit<Connection, 'accessKeys'> & {
    /** The live access keys, with their times in Unix seconds. */
    accessKeys: readonly (Omit<AccessKey, 'createdAt' | 'expiresAt'> & {
      /** When Tempo ID signed the access key, in Unix seconds. */
      createdAt: number
      /** What the access key may do, of which the package reads the expiry. */
      description: {
        /** When the access key expires, in Unix seconds. */
        expiry: number
      }
    })[]
  }
}

/** Reads a connection from Tempo ID's response. */
function toConnection(body: Connection.Response): Connection {
  return {
    accessKeys: body.accessKeys.map((entry) => ({
      account: entry.account,
      address: entry.address,
      chainId: entry.chainId,
      createdAt: entry.createdAt * 1000,
      expiresAt: entry.description.expiry * 1000,
      holder: entry.holder,
    })),
    app: body.app,
  }
}

/**
 * Returns the hash of the transaction that an approval page's return names, or `undefined` for a
 * return without one. Throws `Accounts.RequestError` for a value that is not a transaction hash.
 */
function transactionOf(url: URL, options: { redirectUri: string }) {
  const transaction = Callback.parameter(url, {
    name: 'transaction',
    redirectUri: options.redirectUri,
  })
  if (transaction === undefined) return undefined
  if (Hex.validate(transaction) && Hex.size(transaction) === 32)
    return transaction
  throw transactionOf.missing()
}

/** Returns the error of a payment's return without a valid `name` parameter. */
function missing(name: 'account' | 'challenge_signature') {
  return new RequestError({
    code: 'invalid_request',
    field: name,
    message: `Invalid \`${name}\` in the return URL: it is missing or malformed. Check the account on Tempo ID, then try again.`,
    status: 0,
  })
}

/** Returns the error of a return without a valid transaction hash. */
transactionOf.missing = () =>
  new RequestError({
    code: 'invalid_request',
    field: 'transaction',
    message:
      'Invalid `transaction` in the return URL: it is not a transaction hash. Check the account on Tempo ID, then try again.',
    status: 0,
  })

export namespace machines {
  /**
   * The approval page's readiness, the guest account's signature, and the start of a guest offer's
   * guest session, in two parallel regions. The page's URL waits for the challenge's message and the
   * first guest request, and the guest account signs one transaction for each payment.
   *
   * | Region  | State        | Meaning                                                                  |
   * | ------- | ------------ | ------------------------------------------------------------------------ |
   * | `page`  | `settling`   | Transient. Routes to the status that {@link select} returns.             |
   * | `page`  | `waiting`    | The challenge's message or the first guest request has not arrived.      |
   * | `page`  | `ready`      | The page's URL holds its values. The guest account signs no transaction. |
   * | `page`  | `signing`    | The guest account signs a transaction, and refuses another. The machine's end aborts the signature. |
   * | `page`  | `signed`     | The guest account signed the payment's transaction, and signs no other.  |
   * | `offer` | `settling`   | Transient. Routes to `idle` for a guest offer, or `none`.                |
   * | `offer` | `none`       | No guest offer: a held guest session, or no guest payment.               |
   * | `offer` | `idle`       | The user has not selected Continue as guest.                             |
   * | `offer` | `starting`   | The guest session starts. The machine's end aborts the start.            |
   * | `offer` | `started`    | The guest session started.                                               |
   * | `offer` | `failed`     | The last start failed. The next selection starts it again.               |
   * | `offer` | `superseded` | A sign-out since the payment started superseded the payment.             |
   */
  export const approval = setup({
    actions: {
      /** Adds the event's guest request, which the page's URL holds from then on. */
      addRequest: assign({
        requests: (args) => {
          assertEvent(args.event, 'guest.resolve')
          return [...args.context.requests, args.event.value]
        },
      }),
      /** Drops the failure of the last start of the guest session, before another start. */
      clearFailure: assign({ failure: undefined }),
      /** Holds the failure of the last start of the guest session, which its waiters throw. */
      setFailure: assign((_, params: { error: unknown }) => ({
        failure: params.error,
      })),
      /** Holds the challenge's message. */
      setMessage: assign({
        message: (args) => {
          assertEvent(args.event, 'challenge.resolve')
          return args.event.message
        },
      }),
      /** Holds the started guest session. */
      setSession: assign((_, params: { session: Session.GuestSession }) => ({
        failure: undefined,
        session: params.session,
      })),
    },
    actors: {
      /**
       * Signs the page's transaction as the guest session, and posts the signature or the failure
       * to the page, unless the machine ended. `approve` provides it from `guest.sign`.
       */
      sign: fromPromise<void, approval.Signature>(() =>
        Promise.reject(new Error('No guest payment.')),
      ),
      /** Starts the guest session of a guest offer. `approve` provides it from `guest.session`. */
      start: fromPromise<Session.GuestSession>(() =>
        Promise.reject(new Error('No guest offer.')),
      ),
    },
    guards: {
      /** Whether the approval offers a guest session that the user's selection starts. */
      offers: (args) => args.context.offer,
      /** Whether {@link select} returns `params.status`. */
      selects: (args, params: { status: approval.Status }) =>
        select(args.context) === params.status,
      /** Whether a sign-out since the payment started superseded the start of the guest session. */
      supersedes: (_, params: { error: unknown }) =>
        params.error instanceof SupersededError,
    },
    types: {
      context: {} as approval.Context,
      events: {} as approval.Event,
      input: {} as approval.Input,
    },
  }).createMachine({
    context: (args) => ({
      challenge: args.input.challenge,
      failure: undefined,
      guest: args.input.guest,
      message: undefined,
      offer: args.input.offer,
      requests: [],
      session: undefined,
    }),
    id: 'approval',
    states: {
      offer: {
        initial: 'settling',
        states: {
          failed: {
            on: {
              'offer.start': { actions: 'clearFailure', target: 'starting' },
            },
          },
          idle: { on: { 'offer.start': { target: 'starting' } } },
          none: {},
          settling: {
            always: [{ guard: 'offers', target: 'idle' }, { target: 'none' }],
          },
          started: {},
          starting: {
            invoke: {
              id: 'start',
              onDone: {
                actions: {
                  params: (args) => ({ session: args.event.output }),
                  type: 'setSession',
                },
                target: 'started',
              },
              onError: [
                {
                  actions: {
                    params: (args) => ({ error: args.event.error }),
                    type: 'setFailure',
                  },
                  guard: {
                    params: (args) => ({ error: args.event.error }),
                    type: 'supersedes',
                  },
                  target: 'superseded',
                },
                {
                  actions: {
                    params: (args) => ({ error: args.event.error }),
                    type: 'setFailure',
                  },
                  target: 'failed',
                },
              ],
              src: 'start',
            },
          },
          superseded: {},
        },
      },
      page: {
        initial: 'settling',
        states: {
          ready: {
            on: {
              'guest.resolve': { actions: 'addRequest' },
              'sign.start': { target: 'signing' },
            },
            tags: 'ready',
          },
          settling: {
            always: [
              {
                guard: { params: { status: 'ready' }, type: 'selects' },
                target: 'ready',
              },
              { target: 'waiting' },
            ],
          },
          signed: {
            on: { 'guest.resolve': { actions: 'addRequest' } },
            tags: 'ready',
          },
          signing: {
            invoke: {
              id: 'sign',
              input: (args) => {
                assertEvent(args.event, 'sign.start')
                const { id, source, transaction } = args.event
                return { id, source, transaction }
              },
              onDone: { target: 'signed' },
              // No signature exists, so the page can post a transaction again.
              onError: { target: 'ready' },
              src: 'sign',
            },
            on: { 'guest.resolve': { actions: 'addRequest' } },
            tags: 'ready',
          },
          waiting: {
            on: {
              'challenge.resolve': {
                actions: 'setMessage',
                target: 'settling',
              },
              'guest.resolve': { actions: 'addRequest', target: 'settling' },
            },
          },
        },
      },
    },
    type: 'parallel',
  })

  export declare namespace approval {
    type Context = {
      /** Whether the page's URL waits for the challenge's message. */
      challenge: boolean
      /** The failure of the last start of the guest session. Absent outside `failed` and `superseded`. */
      failure: unknown
      /** Whether the page's URL waits for a guest request. */
      guest: boolean
      /** The challenge's message. Absent until it arrives, and without a challenge. */
      message: string | undefined
      /** Whether the approval offers a guest session that the user's selection starts. */
      offer: boolean
      /** The guest requests of the payment, in the order of their signatures. Empty without one. */
      requests: readonly string[]
      /** The guest offer's started guest session. Absent before its start, and without an offer. */
      session: Session.GuestSession | undefined
    }

    type Event =
      | {
          /** The challenge's message. */
          message: string
          /** The challenge's message arrived. */
          type: 'challenge.resolve'
        }
      | {
          /** The guest account signed a fresh guest request. */
          type: 'guest.resolve'
          /** The guest request. */
          value: string
        }
      | {
          /** The user selected Continue as guest, which starts the guest offer's guest session. */
          type: 'offer.start'
        }
      | (Signature & {
          /** The page posted a transaction for the guest account to sign. */
          type: 'sign.start'
        })

    type Input = Pick<Context, 'challenge' | 'guest' | 'offer'>

    /** A transaction that the page posted for the guest account to sign. */
    type Signature = {
      /** The ID of the page's message, which the answer names. */
      id: unknown
      /** The page that posted the transaction, which receives the answer. */
      source: Pick<Window, 'postMessage'>
      /** The transaction, as the page posted it. */
      transaction: unknown
    }

    /** The readiness of the page's URL. */
    type Status = 'ready' | 'waiting'

    type Actor = ActorRefFrom<typeof approval>

    type Snapshot = SnapshotFrom<typeof approval>
  }

  /**
   * Returns the start of the guest offer's guest session: `none` without an offer, `idle` before the
   * user's selection, `starting`, `started` with the session, or `failed` or `superseded` with the
   * failure.
   */
  export function guest(snapshot: approval.Snapshot): guest.ReturnType {
    const { failure, session } = snapshot.context
    if (snapshot.matches({ offer: 'started' }) && session)
      return { session, type: 'started' }
    if (snapshot.matches({ offer: 'failed' }))
      return { error: failure, type: 'failed' }
    if (snapshot.matches({ offer: 'superseded' }))
      return { error: failure, type: 'superseded' }
    if (snapshot.matches({ offer: 'starting' })) return { type: 'starting' }
    if (snapshot.matches({ offer: 'idle' })) return { type: 'idle' }
    return { type: 'none' }
  }

  export declare namespace guest {
    type ReturnType =
      | {
          /** The failure of the start. */
          error: unknown
          type: 'failed' | 'superseded'
        }
      | { type: 'idle' | 'none' | 'starting' }
      | {
          /** The started guest session. */
          session: Session.GuestSession
          type: 'started'
        }
  }

  /** Returns whether `snapshot` holds a guest request of the payment that equals `options.value`. */
  export function issued(
    snapshot: approval.Snapshot,
    options: { value: string },
  ) {
    return snapshot.context.requests.includes(options.value)
  }

  /**
   * Returns the account that paid a guest payment. A payment of a held guest session returns its
   * guest account, also when the return URL names no `account`, and `undefined` for an `account`
   * that names another address. A guest offer's payment returns the account that the return URL
   * names as `account`: the guest account after its transfer landed, or the account of a user that
   * signed in on the page. A signature of the guest account proves no payment there, since its
   * transfer can fail to land, and the relay's fee payer signature changes the hash of a sponsored
   * transfer. Returns `undefined` for a missing or malformed `account` of a guest offer.
   */
  export function payer(options: payer.Options): `0x${string}` | undefined {
    const { account, held } = options
    const named =
      account !== undefined && Address.validate(account, { strict: false })
        ? Address.checksum(account)
        : undefined
    if (held === undefined) return named
    if (account === undefined) return held
    return named && Address.isEqual(named, held) ? held : undefined
  }

  export declare namespace payer {
    type Options = {
      /** The `account` parameter of the return URL. Absent when the page returned none. */
      account: string | undefined
      /** The guest account of a held guest session. Absent for a guest offer. */
      held?: `0x${string}` | undefined
    }
  }

  /** Returns whether the page's URL holds its values. */
  export function ready(snapshot: approval.Snapshot) {
    return snapshot.hasTag('ready')
  }

  /**
   * Returns the readiness of the page's URL:
   *
   * | Status    | When                                                                   |
   * | --------- | ---------------------------------------------------------------------- |
   * | `waiting` | A challenge without its message, or a guest payment without a request. |
   * | `ready`   | Otherwise.                                                             |
   */
  export function select(context: approval.Context): approval.Status {
    if (context.challenge && context.message === undefined) return 'waiting'
    if (context.guest && context.requests.length === 0) return 'waiting'
    return 'ready'
  }

  /** Returns whether the guest account signs a transaction that the page posts now. */
  export function signs(snapshot: approval.Snapshot) {
    return snapshot.matches({ page: 'ready' })
  }

  /** Returns the values of the page's URL: the challenge's message, and the latest guest request. */
  export function values(snapshot: approval.Snapshot) {
    return {
      guest: snapshot.context.requests.at(-1),
      message: snapshot.context.message,
    }
  }
}
