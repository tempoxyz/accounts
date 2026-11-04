/**
 * The operations of every instance beyond its session's reads: the authorization of the user's
 * Tempo ID session, the refresh of the session's tokens, and the read and the upgrade of the user's
 * Tempo Account.
 * @module
 */
import * as Actions from './Actions.js'
import { RequestError, SupersededError } from '../Accounts.js'
import * as AccessKey from './AccessKey.js'
import type * as Plugin from '../Plugin.js'
import type * as Session from '../Session.js'
import type * as TempoAccount from './TempoAccount.js'
import * as SignIn from './signIn.js'

/**
 * Requests the app's tokens, and an access key, for the user's Tempo ID session in the
 * browser, with no sign-in. Sets the instance's session, and returns it. Returns `undefined`, and
 * empties the session, when the browser holds no Tempo ID session.
 */
export function authorize(
  context: Plugin.Context,
  parameters: authorize.Parameters = {},
): Promise<authorize.ReturnType> {
  // The status shows the authorization, and the saved session that it renews.
  return context.session.authorize(() => run(context, parameters))
}

export declare namespace authorize {
  type Parameters = {
    /**
     * The access key to request: what it may do, a function that returns it, or `false` for a
     * sign-in without an access key. Defaults to the instance's `accessKey`.
     */
    accessKey?: SignIn.AccessKeyOption
    /** A message whose EIP-191 hash the key authorization binds as its `witness`. */
    challenge?: string | undefined
    /** Runs the ceremony of a passkey that owns the account, in place of `navigator.credentials.get`. */
    getFn?: Actions.authorize.Options['getFn']
    /** Whether a passkey that owns the account signs the access key on the page. Defaults to `false`. */
    passkey?: boolean | undefined
  }

  type ReturnType =
    | (Session.Session & {
        /** Whether the account is a wallet.tempo passkey's that waits for its upgrade. */
        upgradeAvailable: boolean
      })
    | undefined
}

/** Runs {@link authorize}. */
async function run(
  context: Plugin.Context,
  parameters: authorize.Parameters,
): Promise<authorize.ReturnType> {
  const { config } = context
  // The stored session loads first, so a sign-in that another tab saves later counts as newer.
  const held = await context.session.load()
  // The authorization reads the browser's Tempo ID session, which a sign-in that completes first
  // replaces, so that sign-in overtakes it.
  const change = context.session.change({ restore: true })
  const accessKey = SignIn.accessKey(context, parameters.accessKey)

  // The access key may be absent, so the result may hold an access key or not.
  const result: Actions.authorize.ReturnType<number, boolean> =
    await Actions.authorize(config, {
      accessKey,
      challenge: parameters.challenge,
      getFn: parameters.getFn ?? config.getFn,
      passkey: parameters.passkey,
    }).catch(change.fail)
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
  // access key, the session reads the account that Tempo ID selects.
  const account =
    'key' in result
      ? result.key.chainId === config.chainId
        ? result.account
        : undefined
      : await SignIn.account(config, {
          getFn: (parameters.getFn ?? config.getFn) as never,
          userId: result.user.id,
        }).catch(change.fail)
  const session = SignIn.toSession({ ...result, account })
  // Another tab's sign-in takes no lock here, so the store is read again. A sign-in there of another
  // user overtakes this authorization, as one in this instance does. Another tab's restore of the
  // same user does not.
  if (!change.overtaken()) {
    const latest = await context.session.reload().catch(() => undefined)
    if (latest && latest !== held && latest.user.id !== session.user.id)
      throw new SupersededError()
  }
  await change.commit(session)
  return { ...session, upgradeAvailable: result.upgradeAvailable }
}

/**
 * Refreshes the session's tokens with its refresh token, saves them, and returns the session.
 * Returns `undefined` without a session or without a refresh token.
 */
export function refresh(
  context: Plugin.Context,
): Promise<Session.Session | undefined> {
  // One refresh runs at a time, also across a browser's tabs, and each reads the stored session
  // first, so it never sends a refresh token that another tab rotated.
  return context.session.exclusive(async () => {
    await context.session.load()
    const current = await context.session.reload()
    const refreshToken = current?.refreshToken
    if (!current || !refreshToken) return undefined
    const change = context.session.change({ sent: refreshToken, update: true })
    const send = () => Actions.refresh(context.config, { refreshToken })

    // Without Tempo ID's answer, it may have rotated the token. For 30 seconds after a rotation,
    // the rotated token returns the same tokens, so retries within that time recover them. After
    // an unanswered attempt, Tempo ID can still be rotating the token, and refuses it until the
    // rotation returns, so that refusal is retried too.
    let rotating = false
    // The session that another context saved over the sent token, which a refusal of it keeps.
    let replaced: Session.Session | undefined
    const tokens = await (async () => {
      for (const delay of retryDelays) {
        const result = await send().then(
          (tokens) => ({ tokens }),
          (error: unknown) => ({ error }),
        )
        if ('tokens' in result) return result.tokens
        const retry =
          unanswered(result.error) ||
          (rotating &&
            result.error instanceof RequestError &&
            result.error.code === 'invalid_grant')
        if (!retry || delay === undefined) throw result.error
        rotating = true
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
      throw new Error('Unreachable.')
    })().catch(async (error: unknown) => {
      // A refused refresh token never refreshes again, so the session ends. A device that stays
      // offline keeps its token, so it signs in again only when Tempo ID refuses the token.
      if (error instanceof RequestError && error.code === 'invalid_grant') {
        // Another tab's sign-in or refresh can have saved other tokens since this one was sent.
        // The refusal then ends nothing, and the refresh returns the stored session.
        const latest = await context.session.reload().catch(() => undefined)
        if (latest && latest.refreshToken !== refreshToken) {
          // The change still completes, so a sign-out that overtook it skips the sent token, which
          // an unanswered attempt may have rotated. The newer session moved the version, so the
          // commit leaves it.
          await change
            .commit(undefined, { error, unanswered: rotating })
            .catch(() => undefined)
          replaced = latest
          return undefined
        }
        await change.commit(undefined, { error, unanswered: rotating })
        throw error
      }
      return change.fail(error, { unanswered: rotating })
    })
    if (!tokens) return replaced
    // A sign-in in another tab takes no lock, so the refresh reads the store again, and a newer
    // session there overtakes it. The commit of an overtaken refresh changes nothing, and after a
    // sign-out it revokes the new tokens.
    const held = context.session.get()
    const latest = await context.session.reload()
    const session = { ...current, ...tokens }
    // A sign-out in another tab emptied the store, and waits for this lock to revoke the token that
    // it reads then. The new session goes to the store, so that sign-out revokes the new token, and
    // never the rotated one. Only a browser's Web Locks span the contexts that share a store: its
    // pages and workers, which also hold IndexedDB. Node's span the threads of one process, so in
    // another process the sign-out has ended, and the store stays empty.
    if (held && !latest) {
      const spansContexts =
        typeof indexedDB !== 'undefined' &&
        (globalThis.navigator as { locks?: unknown } | undefined)?.locks
      if (!spansContexts) return undefined
      await context.session.change({ update: true }).commit(session)
      return session
    }
    return change.commit(session).then(
      () => session,
      (error: unknown) => {
        if (error instanceof SupersededError) return context.session.get()
        throw error
      },
    )
  })
}

/**
 * The waits before each retry of an unanswered refresh, in milliseconds, all within the 30 seconds
 * in which a rotated token returns the same tokens. `undefined` ends the retries.
 */
const retryDelays = [1_000, 3_000, 6_000, undefined] as const

/** Returns whether a request failed without Tempo ID's answer: a network error, or a server error. */
function unanswered(error: unknown) {
  if (error instanceof RequestError)
    return error.status === 0 || error.status >= 500
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
  return Actions.account.get(context.config, {
    accessToken: parameters.accessToken,
    chainId: context.config.chainId,
    getFn: parameters.getFn ?? context.config.getFn,
  })
}

export declare namespace getAccount {
  type Parameters = {
    /** The app's access token, which authenticates the read in place of the session cookie. */
    accessToken?: string | undefined
    /** Runs the ceremony of a passkey owner of the account, in place of `navigator.credentials.get`. */
    getFn?: Actions.account.get.Options['getFn']
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
): Promise<Session.Session | undefined> {
  const { restore } = options
  if (!options.reauthorize) {
    await restore()
    return await context.session.load()
  }

  const fn = (() => {
    if (typeof options.reauthorize === 'function') return options.reauthorize
    const parameters = options.reauthorize === true ? {} : options.reauthorize
    return async () => {
      const authorized = await run(context, parameters).catch(
        (error: unknown) => {
          // A refusal that calls for an interactive sign-in, such as a passkey's, leaves the visitor
          // signed out, so the page shows its sign-in. A `webauthn_required` with a cause is a
          // ceremony that ran on the page and failed, such as a dismissed prompt, so it throws. Tempo
          // ID's own `webauthn_required`, sent before any ceremony, has no cause.
          if (
            error instanceof RequestError &&
            interactive.has(error.reason!) &&
            !(error.reason === 'webauthn_required' && error.cause !== undefined)
          )
            return undefined
          throw error
        },
      )
      if (!authorized) return undefined
      const { upgradeAvailable: _, ...session } = authorized
      return session
    }
  })()

  // One authorization spans the restore, so the status shows no sign-out between the two.
  return await context.session.authorize(async () => {
    await restore()
    const loaded = await context.session.load()
    if (loaded) return loaded
    // The mark is read after the restore, so a sign-out during a slow hook still applies.
    if (await options.signedOut?.()) return undefined
    return await fn()
  })
}

/** The reasons of a refusal that only an interactive sign-in resolves, which `getSession` returns as no session. */
const interactive = new Set<RequestError.Reason>([
  // `rejected` also covers an app's registration or scope, which no sign-in resolves, so it throws.
  'reauthentication_required',
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
      | (() => Promise<Session.Session | undefined>)
      | undefined
  }

  type Options = Parameters & {
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
  const key = current?.key
  const upgraded = await Actions.account.upgrade(context.config, {
    // The session's own access key signs its registration, also one with material that the store kept.
    ...(key && (key.keyPair || key.privateKey)
      ? { accessKey: AccessKey.toAccount(AccessKey.from(key)) }
      : {}),
    addOwner: parameters.addOwner,
    getFn: parameters.getFn ?? context.config.getFn,
    key,
  })
  if (current)
    // Another tab can refresh the tokens during the upgrade, so the account merges into the latest
    // stored session of the same user, under the lock that a refresh holds.
    await context.session.exclusive(async () => {
      const latest = await context.session.reload()
      if (latest?.user.id !== current.user.id) return
      const change = context.session.change({ update: true })
      await change.commit({ ...latest, account: upgraded })
    })
  return upgraded
}

export declare namespace upgradeAccount {
  type Parameters = {
    /** Adds the user's Privy wallet as a second owner in the same transaction. */
    addOwner?: 'privy' | undefined
    /** Runs the passkey's ceremony in place of `navigator.credentials.get`. */
    getFn?: Actions.account.upgrade.Options['getFn']
  }
}
