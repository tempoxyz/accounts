/**
 * The operations of every instance beyond its session's reads: the authorization of the user's
 * Tempo ID session, the refresh of the session's tokens, and the read and the upgrade of the user's
 * Tempo Account.
 * @module
 */
import { Address, Bytes, Hash } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import * as AccountActions from '../actions/account.js'
import * as Actions from './Actions.js'
import { RequestError, SupersededError } from '../Accounts.js'
import * as AccessKey from './AccessKey.js'
import * as Api from './Api.js'
import * as ClientId from './ClientId.js'
import * as Permissions from '../Permissions.js'
import type * as Plugin from '../Plugin.js'
import * as Request from './Request.js'
import * as Session from '../Session.js'
import * as InternalSession from './Session.js'
import type * as TempoAccount from './TempoAccount.js'
import * as SignIn from './SignIn.js'

/**
 * Requests the app's tokens, and an access key, for the user's Tempo ID session in the
 * browser, with no sign-in. Sets the instance's session, and returns it. Returns `undefined`, and
 * empties the session, when the browser holds no Tempo ID session.
 */
export function authorize(
  context: Plugin.Context,
  options: authorize.Options = {},
): Promise<authorize.ReturnType> {
  // The status shows the authorization, and the saved session that it renews.
  return context.session.authorize(async () => {
    const result = await run(context, options)
    if (result instanceof RequestError) throw result
    return result
  })
}

export declare namespace authorize {
  type Parameters = {
    /**
     * The access key to request: what it may do, a function that returns it, or `false` for a
     * sign-in without an access key. Defaults to the instance's `accessKey`.
     */
    accessKey?: SignIn.AccessKeyOption
    /**
     * The Tempo Account the access key acts for, one of the user's accounts in the app's realms,
     * such as one of the `accounts` that `email.signIn` returns. Tempo ID keeps it as the app's
     * account for the rest of the browser's Tempo ID session. Defaults to that account, else the
     * user's oldest. An account that is not the user's fails with
     * [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account).
     */
    account?: `0x${string}` | undefined
    /**
     * A message, which `challengeSignature` signs as `address`. Without an access key, the
     * signature is over its EIP-191 hash, as `personal_sign` signs it. With one, the key
     * authorization's `witness` binds that hash, and the signature is the key authorization's.
     * A sign-in on the app's page needs the `tempo-id:sign` scope.
     */
    challenge?: string | undefined
    /** Runs the ceremony of a passkey that owns the account, in place of `navigator.credentials.get`. */
    getFn?: Actions.authorize.Options['getFn']
    /**
     * Whether a passkey that owns the account signs the access key on the page, so a call with
     * `true` runs from a click. Defaults to `false`.
     */
    passkey?: boolean | undefined
  }

  type Options = Parameters & {
    /**
     * Whether the renewal of an expired access key that the sign-in named requests that access
     * key's permissions again, for the same lifetime, when the call names no `accessKey` and no other
     * `account`. `true` on an instance without `accessKey`. Defaults to `false`.
     */
    renew?: boolean | undefined
  }

  type ReturnType =
    | (Session.Session & {
        /** Whether the account is a wallet.tempo passkey's that waits for its upgrade. */
        upgradeAvailable: boolean
      })
    | undefined
}

/**
 * Runs {@link authorize}. Returns the refusal of the access key that a renewal requests, which
 * `authorize` throws, and which `getSession` returns as no session. Throws any other error.
 */
async function run(
  context: Plugin.Context,
  parameters: authorize.Options,
): Promise<authorize.ReturnType | RequestError> {
  const { config } = context
  // The stored session loads first, so a sign-in that another tab saves later counts as newer.
  const held = await context.session.load()
  // The headless authorization names no `resource`, so its tokens are for Tempo ID's origin, which
  // the resource's API refuses. An instance with a resource thus sends none and keeps its session,
  // as the viem retry does, and signs in with a redirect, which names the resource. An empty list
  // names Tempo ID's origin, as no `resource` does. A session whose sign-in named a resource in its
  // own call holds tokens for that resource too, also an expired session that a renewal replaces.
  if (
    Request.resources(config).length > 0 ||
    scoped(held ?? context.session.renewing(), { config })
  ) {
    // Only a call that requests nothing beyond the held session returns it. A challenge, an access
    // key, a passkey, or another account needs a new authorization, which only a sign-in on a page
    // sends, so the call never returns the held session as its result. A local session is no
    // Tempo ID sign-in, so it never answers the call either.
    if (held && !Session.local(held) && holds(held, parameters))
      return { ...held, upgradeAvailable: false }
    if (!held) {
      // Without a session, the status settles as for an authorization that finds no Tempo ID
      // session.
      const change = context.session.change({ restore: true })
      if (!change.overtaken())
        await context.session.reload().catch(() => undefined)
      await change.commit(undefined)
    }
    throw new RequestError({
      code: 'interaction_required',
      field: 'resource',
      message:
        'Authorization refused: a session or an instance with `resource` authorizes only through a sign-in on a page. Sign in with a redirect or the dialog.',
      status: 0,
    })
  }
  // The authorization reads the browser's Tempo ID session, which a sign-in that completes first
  // replaces, so that sign-in overtakes it.
  const change = context.session.change({ restore: true })
  // The renewal of an access key that the sign-in named requests its permissions again, for the
  // same lifetime, so the session keeps an access key. It names the expired access key's account,
  // so Tempo ID refuses it for another user, and a renewal for another account requests none.
  // A switch of chain moves the kept session's access keys, so a renewal after one requests none
  // from the chain that the switch left.
  const renewed = context.session.renewing()
  const renewing = renewed?.accessKey
  const derived =
    parameters.renew &&
    parameters.accessKey === undefined &&
    // A lifetime that ended before the response renews without the derived access key, as its
    // expiry has passed.
    renewing?.lifetime &&
    renewing.lifetime > 0 &&
    (parameters.account === undefined ||
      Address.isEqual(parameters.account, renewing.account))
      ? {
          ...Permissions.fromAccessKey(renewing),
          expiry: Math.floor(Date.now() / 1000) + renewing.lifetime,
        }
      : undefined

  // The app's own access key, which the sign-in named by its public key or as a Viem account, leaves
  // no material in the session, which keeps neither its public key nor its signer. Its renewal
  // could only request a new access key in its place, which the app does not hold, so it refuses
  // before any request, and the page signs in again with the app's access key.
  const foreign =
    derived && !AccessKey.held(renewing)
      ? new RequestError({
          code: 'invalid_request',
          field: 'accessKey',
          message:
            "Renewal refused: the expired access key is the app's own, whose signer the session does not keep. Sign in again with the app's `accessKey`.",
          reason: 'missing_key',
          status: 0,
        })
      : undefined

  // The access key may be absent, so the result may hold an access key or not.
  const result: Actions.authorize.ReturnType<number, boolean> | RequestError =
    await (
      foreign
        ? Promise.reject(foreign)
        : Actions.authorize(config, {
            accessKey:
              derived ??
              SignIn.accessKey(context, parameters.accessKey, {
                challenge: parameters.challenge !== undefined,
              }),
            account: derived
              ? (parameters.account ?? renewing?.account)
              : parameters.account,
            challenge: parameters.challenge,
            // A held or saved session shows that the user most likely holds the Tempo ID session. So
            // the call sends the authorization alone. Its `session_required` refusal returns no
            // session.
            check: renewed === undefined && held === undefined,
            getFn: parameters.getFn ?? config.getFn,
            passkey: parameters.passkey,
          })
    )
      .catch(change.fail)
      .catch((error: unknown) => {
        // A renewal never continues without the access key that the sign-in named, so a session
        // with an access key never becomes one without, in this instance. A later instance, such as
        // after a reload, holds no expired access key, so it renews none. Tempo ID can refuse the
        // derived access key where an interactive sign-in grants it, such as for a passkey that must
        // sign it, for limits above the headless ceiling that a page sign-in approved, or for an
        // account of another user, whom the browser's Tempo ID session holds. The session then stays
        // empty, so the page shows its sign-in. A derived access key whose lifetime ends before the
        // request throws `expiry_passed` before it, and counts too, as does one whose stored
        // limits name one token twice, which throws `duplicate_limit` before its request. Any other
        // error rejects as it is, as an authorization without the access key rejects with it too:
        // a refusal of the app, such as `rejected` for its registration, a rate limit, a passkey
        // ceremony that failed on the page, and a failure without Tempo ID's answer.
        if (derived && refusal(error)) return error
        throw error
      })
  if (result instanceof RequestError) return result
  if (!result) {
    // Another tab's sign-in that the store holds stays, so the empty result clears only this
    // instance's earlier session. An overtaken change commits nothing, so it adopts nothing either,
    // which a sign-out in progress would then keep.
    if (!change.overtaken())
      await context.session.reload().catch(() => undefined)
    await change.commit(undefined)
    return undefined
  }

  // The response lists the access key's account on the access key's chain. The session holds the
  // account on the instance's chain, so an access key on another chain leaves it out. Without an
  // access key, the session reads the account that Tempo ID selects, unless the instance signs
  // users in without one.
  const account = await (async () => {
    if ('accessKey' in result)
      return result.accessKey.chainId === config.chainId
        ? result.account
        : undefined
    if (config.account === false) return undefined
    return await SignIn.account(config, {
      getFn: (parameters.getFn ?? config.getFn) as never,
      userId: result.user.id,
    }).catch(change.fail)
  })()
  // A renewal that Tempo ID grants with the derived expiry keeps the requested lifetime. The time
  // left at the response is shorter by the request's latency, which repeated renewals add up.
  const session = (() => {
    const session = SignIn.toSession({ ...result, account })
    if (!derived || !session.accessKey) return session
    if (
      KeyAuthorization.fromRpc(session.accessKey.keyAuthorization).expiry !==
      derived.expiry
    )
      return session
    return {
      ...session,
      accessKey: { ...session.accessKey, lifetime: renewing?.lifetime },
    }
  })()
  // Another tab's sign-in takes no lock here, so the store is read again. A sign-in there of another
  // user overtakes this authorization, as one in this instance does. Another tab's restore of the
  // same user does not.
  if (!change.overtaken()) {
    const latest = await context.session.reload().catch(() => undefined)
    if (
      latest &&
      latest !== held &&
      Session.subject(latest) !== Session.subject(session)
    )
      throw new SupersededError()
  }
  await change.commit(session)
  return { ...session, upgradeAvailable: result.upgradeAvailable }
}

/**
 * Returns `error` as the refusal of an access key or of its account, by Tempo ID or before the
 * request. Returns `false` for any other error, such as a refusal of the app. The refusal's `field`
 * decides: `account`, or a path in the instance's `accessKey` or in the request's
 * `key_authorization`.
 */
function refusal(error: unknown): error is RequestError {
  // A server error carries no answer about the access key.
  if (!(error instanceof RequestError) || error.status >= 500) return false
  return (
    error.field === 'account' ||
    /^(accessKey|key_authorization)(\.|$)/.test(error.field ?? '')
  )
}

/**
 * Refreshes the session's tokens with its refresh token, saves them, and returns the session.
 * Returns `undefined` without a session or without a refresh token. With `margin`, returns the
 * session without a request if its access token expires later than `margin` from now. Without
 * `margin`, returns the stored session without a request when another refresh or a sign-in replaced
 * the refresh token while the call waited for the lock, and its access token holds. If a sign-out
 * in this instance empties the session while the call reads the store, the call sends no request
 * and returns the instance's session.
 */
export function refresh(
  context: Plugin.Context,
  options: refresh.Options = {},
): Promise<Session.Any | undefined> {
  const { margin } = options
  // The instance's session, and the time, when the call starts, before it waits for the lock.
  const started = context.session.get()
  const startedAt = Date.now()

  // One refresh runs at a time, also across a browser's tabs, and each reads the stored session
  // first, so it never sends a refresh token that another tab rotated.
  return context.session.exclusive(async () => {
    // A change that is no update yields only to a sign-out that empties this instance's session at
    // once, as its own does. Another tab's sign-out waits for the lock that the refresh holds, so
    // only the refresh's read of the store sets it, which the refresh's own change yields to.
    // This change commits nothing.
    const signedOut = context.session.change().overtaken
    await context.session.load({ locked: true })
    const loaded = context.session.get()
    // The rotations read beside the session, so the refresh waits for one round trip of the store
    // before its record of the pending rotation. A refresh that sends no request ignores them.
    const [current, rotations] = await Promise.all([
      context.session.reload(),
      context.session.rotations(),
    ])
    // A sign-out in this instance can empty the session after the read returned it. The refresh
    // then sends no request, since each change below starts after that sign-out, and its commit
    // would set the session again. No step from here to the start of a change waits.
    if (signedOut()) return context.session.get()
    const refreshToken = current?.refreshToken
    if (!current || !refreshToken) return undefined
    // The reads end together, so a change in this instance, such as a sign-in, can commit after the
    // read of the session. The refresh then returns its session, and sends no request.
    if (context.session.get()?.refreshToken !== refreshToken)
      return context.session.get()
    // Tokens that another DPoP key binds, such as a key that a page created at an earlier load,
    // never refresh with this instance, so the refresh sends no request. The session stays, since
    // another context on the same store, such as another tab, can hold the key that binds it.
    Api.checkBound(context.config, { accessToken: current.accessToken })
    // A refresh that held the lock first, in this context or another tab, saved tokens that hold.
    // The commit saves them under the lock, so a sign-out that waits for the lock reads the saved
    // copy. It runs the plugins' `afterSignIn` hooks, as a refresh's commit does.
    if (margin !== undefined && current.expiresAt - margin > Date.now()) {
      await context.session.change({ update: true }).commit(current)
      return context.session.get()
    }
    // A refresh or a sign-in that held the lock while this call waited saved tokens newer than the
    // call, so overlapping calls rotate the refresh token once, and each returns the same tokens.
    // Tokens that another context saved before the call refresh, also where this instance has not
    // read them yet, such as another process on the same store. A call with `margin` returns only
    // tokens that hold past it, so it refreshes here.
    if (
      margin === undefined &&
      InternalSession.machines.rotated({
        current,
        lifetime: Api.lifetime(current.accessToken),
        now: Date.now(),
        started,
        startedAt,
      })
    ) {
      await context.session.change({ update: true }).commit(current)
      return context.session.get()
    }
    // Another context saved other tokens during the reads, so its rotation can have completed
    // after the read of the rotations. The change then reads them again, after the session, so the
    // record of the pending rotation never drops that rotation.
    const change = context.session.change({
      rotations:
        refreshToken === loaded?.refreshToken
          ? Promise.resolve(rotations)
          : undefined,
      sent: refreshToken,
      update: true,
    })
    // The store records the pending rotation before Tempo ID can rotate the token, so no context
    // revokes a rotated token as a reuse. A refresh whose record fails sends no request.
    await change.prepare().catch(change.fail)
    const locks = !!(globalThis.navigator as { locks?: unknown } | undefined)
      ?.locks
    // Only a browser's Web Locks span every context on the store: its pages and workers, which
    // also hold IndexedDB. Node's span the threads of one process only.
    const spansContexts = typeof indexedDB !== 'undefined' && locks
    // A local store, such as `Store.memory`, has no context outside the process, so a lock there
    // serializes every refresh of its token, and a refusal is final too. Without Web Locks, such as
    // in React Native, the store's own lock serializes them. A store that outlives the process, such
    // as `Store.durableObject`, can hold the pending rotation of a run that a restart ended while
    // Tempo ID still rotates its token. A refusal of that token, or after a failed read of the
    // rotations, is then not final.
    const sentDigest = Hash.sha256(Bytes.fromString(refreshToken), {
      as: 'Hex',
    })
    const pending =
      !rotations ||
      rotations.some((entry) => entry.from === sentDigest && !entry.to)
    const final =
      spansContexts ||
      (context.config.store?.local === true &&
        !pending &&
        (locks || !!context.config.store.lock))
    // Where the lock spans every context, it serializes the refreshes of this store, so a refusal
    // is final. Elsewhere, such as two runs of a CLI on one file, another process can rotate the
    // same token at once, and Tempo ID refuses it until that rotation returns. After the first
    // refusal, the refresh sends the same token again once, unless the store holds other tokens
    // already. An attempt after an unanswered one also retries a refusal.
    const send = () => Api.refresh(context.config, { refreshToken })

    // Without Tempo ID's answer, it may have rotated the token. For 30 seconds after a rotation,
    // the rotated token returns the same tokens, so retries within that time recover them. After
    // an unanswered attempt, Tempo ID can still be rotating the token, and refuses it until the
    // rotation returns, so that refusal is retried too.
    let rotating = false
    // Whether a refusal of the sent token was sent again already. Another process can rotate the
    // token then, so its rotation stays unknown, as after an unanswered attempt.
    let refused = false
    // The session that another context saved over the sent token, which a refusal of it keeps.
    let replaced: Session.Any | undefined
    // The stored session that the loop read after a refusal, which the refusal's handling reuses.
    let stored: Session.Any | undefined
    // When Tempo ID first refused the sent token, which bounds every later send of it.
    let refusedAt: number | undefined
    // Tempo ID's first refusal of the sent token.
    let refusalError: unknown
    const tokens = await (async () => {
      for (const delay of retryDelays) {
        const result = await send().then(
          (tokens) => ({ tokens }),
          (error: unknown) => ({ error }),
        )
        if ('tokens' in result) return result.tokens
        // A server error carries no answer, also with `invalid_grant`, so it never counts as a refusal.
        const refusal =
          !unanswered(result.error) &&
          result.error instanceof RequestError &&
          result.error.code === 'invalid_grant'
        const retry =
          unanswered(result.error) ||
          (refusal && (rotating || (!final && !refused)))
        // After Tempo ID refused the token, the refresh ends with that refusal, whatever answered
        // the attempts after it, so the session never keeps the token.
        if (!retry || delay === undefined) throw refusalError ?? result.error
        if (!refusal) rotating = true
        // A retry of a refusal after an unanswered attempt keeps the refusal, also on a local store.
        if (refusal && !spansContexts && refusedAt === undefined) {
          refusedAt = Date.now()
          refusalError = result.error
        }
        const end = () => refusalError ?? result.error
        // A wait that ends past the resend window ends the refresh now, with no send after it.
        if (
          refusedAt !== undefined &&
          Date.now() + delay - refusedAt > resendWindow
        )
          throw end()
        await new Promise((resolve) => setTimeout(resolve, delay))
        // Outside a browser, once Tempo ID refused the token, every later send of it checks the
        // store first, whatever answered the attempts between.
        if (refusedAt !== undefined) {
          // A sign-out that overtook the refresh ends the session, so the token is never sent again.
          if (change.overtaken()) throw end()
          stored = await context.session.reload().catch(() => undefined)
          // Only a store that still holds the sent token receives it again. Other tokens come from
          // another process's saved rotation, and an empty store or a failed read can be a sign-out.
          if (stored?.refreshToken !== refreshToken || change.overtaken())
            throw end()
          stored = undefined
          // A process that paused, or a send that hung, can pass the 30 seconds in which a rotated
          // token returns the same tokens. A later send reads as a reuse, which revokes every token.
          if (Date.now() - refusedAt > resendWindow) throw end()
        }
        if (refusal) refused = true
      }
      throw new Error('Unreachable.')
    })().catch(async (error: unknown) => {
      // A refused refresh token never refreshes again, so the session ends. A device that stays
      // offline keeps its token, so it signs in again only when Tempo ID refuses the token.
      const refusal =
        error instanceof RequestError && error.code === 'invalid_grant'
      // Another tab's sign-in or refresh can have saved other tokens since this one was sent. After
      // a resend, another process can also have saved its rotation, whatever the resend's error.
      // The failure then ends nothing, and the refresh returns the stored session.
      if (refusal || refused) {
        const latest =
          stored ?? (await context.session.reload().catch(() => undefined))
        if (latest && latest.refreshToken !== refreshToken) {
          // The change still completes, so a sign-out that overtook it skips the sent token, which
          // an unanswered attempt may have rotated. The newer session moved the version, so the
          // commit leaves it.
          await change
            .commit(undefined, { error, unanswered: rotating || refused })
            .catch(() => undefined)
          replaced = latest
          return undefined
        }
      }
      if (refusal) {
        await change.commit(undefined, {
          error,
          unanswered: rotating || refused,
        })
        throw error
      }
      return change.fail(error, { unanswered: rotating || refused })
    })
    if (!tokens) return replaced
    // A sign-in in another tab takes no lock, so the refresh reads the store again, and a newer
    // session there overtakes it. The commit of an overtaken refresh changes nothing, and after a
    // sign-out it revokes the new tokens.
    const held = context.session.get()
    const latest = await context.session.reload()
    // A refresh may omit the ID token, which still names the same user, so the session keeps it.
    const session = {
      ...current,
      ...tokens,
      idToken: tokens.idToken ?? current.idToken,
    }
    const commit = () =>
      change.commit(session).then(
        () => session,
        (error: unknown) => {
          if (error instanceof SupersededError) return context.session.get()
          throw error
        },
      )
    // A sign-out in another tab emptied the store, and waits for this lock to revoke the token that
    // it reads then. The new session goes to the store, so that sign-out revokes the new token, and
    // never the rotated one. Without a lock that spans the contexts, the sign-out in another
    // process can have ended, and the store stays empty. The commit then revokes the new tokens,
    // and marks the sent token revoked, so a sign-out that waits for the lock skips it.
    if (held && !latest) {
      // A refusal or a sign-out in this instance emptied the session. The commit then revokes the
      // new tokens, and records the sent token as rotated, so neither revokes it. The hand-off
      // would set the session again, which that sign-out would keep. Another tab's sign-out also
      // moves the version, and keeps the hand-off below.
      if (change.refused() || signedOut()) return commit()
      if (!spansContexts) return commit()
      await context.session.change({ update: true }).commit(session)
      return session
    }
    return commit()
  })
}

export declare namespace refresh {
  type Options = {
    /**
     * In milliseconds. If the access token expires later than `margin` from now, the refresh sends
     * no request and returns the session. Without it, the refresh always sends a request.
     */
    margin?: number | undefined
  }
}

/**
 * The waits before each retry of an unanswered refresh, in milliseconds, all within the 30 seconds
 * in which a rotated token returns the same tokens. `undefined` ends the retries.
 */
const retryDelays = [1_000, 3_000, 6_000, undefined] as const

/**
 * The most milliseconds after a refusal in which a refresh sends the refused token again, well
 * within the 30 seconds in which a rotated token returns the same tokens.
 */
const resendWindow = 10_000

/**
 * Returns whether a request failed without Tempo ID's answer: a network error, or a server error. A
 * refused redirect is final, since a retry meets the same redirect.
 */
function unanswered(error: unknown) {
  if (error instanceof RequestError)
    return (
      !Api.redirectRefused(error) && (error.status === 0 || error.status >= 500)
    )
  return error instanceof TypeError
}

/**
 * Returns the user's Tempo Account that Tempo ID selects for the app, on the instance's chain, and
 * creates one for a user who has none in the app's realms. Returns `undefined` when the realms hold
 * no account and the app's realm cannot create one.
 */
export function getAccount(
  context: Plugin.Context,
  parameters: getAccount.Parameters = {},
): Promise<TempoAccount.TempoAccount | undefined> {
  return AccountActions.get(context.config, {
    accessToken: parameters.accessToken,
    chain: parameters.chainId ?? context.config.chainId,
    getFn: parameters.getFn ?? context.config.getFn,
  })
}

export declare namespace getAccount {
  type Parameters = {
    /**
     * The app's access token, which authenticates the read in place of the session cookie. Defaults
     * to the session's access token outside a browser and on a page outside Tempo ID's host, and to
     * none on Tempo ID's own pages.
     */
    accessToken?: string | undefined
    /**
     * The chain to read the account on, such as the chain that a page shows. Defaults to the
     * instance's chain at the call.
     */
    chainId?: number | undefined
    /** Runs the ceremony of a passkey owner of the account, in place of `navigator.credentials.get`. */
    getFn?: AccountActions.get.Options['getFn']
  }
}

/**
 * Returns the session. Runs `restore`, the plugins' `restore` hooks, then reads the saved session.
 * With `reauthorize`, a call that finds no session, or a session whose access key expired, authorizes
 * the browser's Tempo ID session, and the status shows the expired session until it returns.
 */
export async function getSession(
  context: Plugin.Context,
  options: getSession.Options,
): Promise<Session.Any | undefined> {
  const { delegate = (fn) => fn() } = options
  // A hook that throws, such as for a refused redirect callback, leaves the saved session in the
  // store, so the read still settles the status. The read takes the restore's own read of the
  // store, and a failed read keeps the hook's error.
  const restore = (run: () => Promise<void> = options.restore) =>
    run().catch(async (error: unknown) => {
      await context.session.load().catch(() => undefined)
      throw error
    })
  // An authorization that runs now, such as `accounts.authorize` beside a sign-in, sets the session
  // that the read returns, so a read without a session waits for it, in place of a second
  // authorization.
  if (!options.reauthorize) {
    await restore()
    const loaded = await context.session.load()
    if (loaded || !(await context.session.settled())) return loaded
    return await context.session.load()
  }

  const fn = (() => {
    const { reauthorize } = options
    if (typeof reauthorize === 'function') return () => delegate(reauthorize)
    const parameters = options.reauthorize === true ? {} : options.reauthorize
    return async () => {
      // A third-party app signs in only on an approval page, so the visitor stays signed out, and
      // the page shows its sign-in.
      if (ClientId.thirdParty(context.config.clientId)) return undefined
      // Outside a browser without `redirectUri`, such as a CLI or a server, no page origin can
      // serve as the redirect URI, so Tempo ID would refuse the authorization. The program signs in
      // again, such as with the device grant. `Api.page` counts a `location` getter that throws, as
      // in Deno without `--location`, as no page.
      if (context.config.redirectUri === undefined && Api.page() === undefined)
        return undefined
      const authorized = await run(context, {
        ...parameters,
        renew: options.renew,
      }).catch((error: unknown) => {
        // A refusal that only an interactive sign-in resolves leaves the visitor signed out, so the
        // page shows its sign-in.
        if (interactiveRefusal(error)) return undefined
        throw error
      })
      // A renewal whose access key Tempo ID refuses leaves the visitor signed out too.
      if (!authorized || authorized instanceof RequestError) return undefined
      const { upgradeAvailable: _, ...session } = authorized
      return session
    }
  })()

  // A sign-out without `everywhere`, in this instance or in another tab, stops the authorization, so
  // a signed-out instance holds no authorization, and its status stays `signedOut`. The check reads
  // no store.
  if (options.declined?.()) {
    await restore()
    return await context.session.load()
  }

  // A session that an authorization in flight sets needs no second authorization.
  await context.session.settled()
  // One authorization spans the restore, so the status shows no sign-out between the two.
  // The callbacks run inside the authorization, so a session read in them waits for none.
  return await context.session.authorize(async () => {
    await restore(() => delegate(options.restore))
    const loaded = await context.session.load()
    if (loaded) return loaded
    // The mark is read after the restore, so a sign-out during a slow hook still applies.
    if (await options.signedOut?.()) return undefined
    return await fn()
  })
}

/**
 * Returns whether the held session answers `parameters` as it is: the call names no challenge, no
 * access key, no passkey, and no account other than the session's own.
 */
function holds(session: Session.Session, parameters: authorize.Options) {
  if (parameters.challenge !== undefined) return false
  if (parameters.accessKey !== undefined) return false
  if (parameters.passkey) return false
  if (parameters.account === undefined) return true
  const { account } = parameters
  return [
    session.accessKey?.account,
    session.account?.address,
    session.address,
  ].some((entry) => entry !== undefined && Address.isEqual(entry, account))
}

/**
 * Returns whether the access token of `session` names a resource outside Tempo ID, as the tokens of
 * a sign-in that named `resource` in its own call do. `false` without a session or an access token.
 */
function scoped(
  session: Session.Any | undefined,
  options: scoped.Options,
): boolean {
  if (!session?.accessToken) return false
  return Api.grant(options.config, session.accessToken).resource !== undefined
}

declare namespace scoped {
  type Options = {
    /** The instance's configuration, whose `url` and `scope` read the token. */
    config: Plugin.Context['config']
  }
}

/**
 * Returns whether `error` is a refusal that only an interactive sign-in resolves, such as a
 * passkey's. A `webauthn_required` with a cause is a ceremony that ran on the page and failed, such
 * as a dismissed prompt, so it is not one. Tempo ID's own `webauthn_required`, sent before any
 * ceremony, has no cause.
 */
function interactiveRefusal(error: unknown) {
  // A session or an instance with `resource` authorizes only on a page, so its refusal leaves the
  // visitor signed out too.
  if (
    error instanceof RequestError &&
    error.code === 'interaction_required' &&
    error.field === 'resource'
  )
    return true
  return (
    error instanceof RequestError &&
    interactive.has(error.reason!) &&
    !(error.reason === 'webauthn_required' && error.cause !== undefined)
  )
}

/** The reasons of a refusal that only an interactive sign-in resolves, which `getSession` returns as no session. */
const interactive = new Set<RequestError.Reason>([
  // `rejected` also covers an app's registration or scope, which no sign-in resolves, so it throws.
  'upgrade_required',
  'webauthn_required',
])

export declare namespace getSession {
  type Parameters = {
    /**
     * Whether a call that finds no session, or an expired one, authorizes the browser's Tempo ID
     * session, as `authorize` does: `true`, the parameters of that authorization, or a function that
     * authorizes and returns the session, such as one that calls `authorize` with a fallback.
     * With `true` or the parameters, a refusal that only an interactive sign-in resolves, such as
     * `webauthn_required`, returns `undefined`. Defaults to `false`.
     */
    reauthorize?:
      | boolean
      | authorize.Parameters
      | (() => Promise<Session.Any | undefined>)
      | undefined
  }

  type Options = Parameters & {
    /**
     * Returns whether the instance is `signedOut` after a sign-out without `everywhere`, in this
     * instance or in another tab, so the call skips the authorization, and its status stays
     * `signedOut`. Absent, every call with `reauthorize` holds the status.
     */
    declined?: (() => boolean) | undefined
    /**
     * Runs a callback inside the authorization, the plugins' `restore` hooks or a function
     * `reauthorize`, so a read of the session in it waits for no authorization that waits for it.
     * Absent, the callback runs as it is.
     */
    delegate?: (<value>(fn: () => Promise<value>) => Promise<value>) | undefined
    /**
     * Whether a renewal of an access key that the sign-in named requests that access key's
     * permissions again, when the call names no `accessKey`. `true` on an instance without
     * `accessKey`. Defaults to `false`.
     */
    renew?: boolean | undefined
    /** Runs the plugins' `restore` hooks, such as a redirect's callback. */
    restore: () => Promise<void>
    /**
     * Returns whether a sign-out without `everywhere` followed the last sign-in, which stops
     * `reauthorize`. Absent, nothing stops it.
     */
    signedOut?: (() => Promise<boolean>) | undefined
  }
}

/**
 * Upgrades a wallet.tempo passkey's account in place to a configurable account, when a sign-in
 * returns `upgradeAvailable: true`. The session's access key registers first, so it keeps working after the
 * upgrade. The passkey signs once. Sets the session's account to the upgraded account, and returns
 * it.
 */
export async function upgradeAccount(
  context: Plugin.Context,
  parameters: upgradeAccount.Parameters = {},
): Promise<TempoAccount.TempoAccount> {
  const current = await context.session.load()
  const chainId = context.chain.get()
  const accessKey = current?.accessKey
  const upgraded = await AccountActions.upgrade(context.config, {
    // The session's own access key signs its registration, also one with material that the store kept.
    ...(accessKey && AccessKey.held(accessKey)
      ? { signer: AccessKey.toAccount(AccessKey.from(accessKey)) }
      : {}),
    accessKey,
    addOwner: parameters.addOwner,
    chain: chainId,
    getFn: parameters.getFn ?? context.config.getFn,
  })
  if (current)
    // Another tab can refresh the tokens during the upgrade, so the account merges into the latest
    // stored session of the same user, under the lock that a refresh holds.
    await context.session.exclusive(async () => {
      const latest = await context.session.reload()
      // An account belongs to one chain, so a switch during the upgrade keeps the session's account.
      if (context.chain.get() !== chainId) return
      if (!Session.same(latest, current)) return
      const change = context.session.change({ update: true })
      await change.commit({ ...latest, account: upgraded })
    })
  return upgraded
}

export declare namespace upgradeAccount {
  type Parameters = {
    /** Adds the user's cloud wallet as a second owner in the same transaction. */
    addOwner?: 'privy' | undefined
    /** Runs the passkey's ceremony in place of `navigator.credentials.get`. */
    getFn?: AccountActions.upgrade.Options['getFn']
  }
}
