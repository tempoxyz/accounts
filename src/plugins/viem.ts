/**
 * The plugin of the Viem client: `accounts.viem`, a client whose account follows the instance's
 * session, which a call configures for another chain, a fixed session, or other client options.
 * @module
 */
import { Address } from 'ox'
import { KeyAuthorization, TokenId } from 'ox/tempo'
import {
  type Chain,
  type Client,
  custom,
  formatUnits,
  http,
  type LocalAccount,
  parseUnits,
  type Transport,
} from 'viem'
import {
  type Account,
  Actions,
  createClient,
  type KeyAuthorizationManager,
  withRelay,
} from 'viem/tempo'
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import {
  type ActorRefFrom,
  assertEvent,
  assign,
  createActor,
  fromPromise,
  type SnapshotFrom,
  setup,
  waitFor,
} from 'xstate'
import type * as AccessToken from '../AccessToken.js'
import type * as Accounts from '../Accounts.js'
import {
  AccessKeyRequiredError,
  RequestError,
  SignedOutError,
  SupersededError,
} from '../Accounts.js'
import * as AccessKey_internal from '../internal/AccessKey.js'
import * as AccountActions from '../actions/account.js'
import * as Actions_accounts from '../internal/Actions.js'
import * as Api from '../internal/Api.js'
import * as BackendOperations from '../internal/BackendOperations.js'
import * as Core from '../internal/Core.js'
import * as InternalSession from '../internal/Session.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Request_internal from '../internal/Request.js'
import * as SignIn from '../internal/SignIn.js'
import type { Payment } from '../internal/Payment.js'
import * as AccessKey from '../internal/viem/AccessKey.js'
import * as Retry from '../internal/viem/Retry.js'
import * as Token from '../internal/viem/Token.js'
import * as Signer from '../internal/Signer.js'
import * as Verify from '../internal/viem/Verify.js'
import * as Permissions from '../Permissions.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'
import type { device } from './device.js'

/**
 * The access key of the session on the client's chain expired, so the transaction did not reach the
 * node. On a page whose retry renews the access key, a fill or an estimate of its transaction throws
 * it before the request, and so does the signature of a transaction whose fields are all given. The
 * retry of a transaction renews the access key, then sends again. A call that sends no transaction,
 * such as `estimateGas`, rejects with it. Match it by `name`.
 */
export class AccessKeyExpiredError extends Error {
  override readonly name = 'Plugins.viem.AccessKeyExpiredError'

  constructor() {
    super(
      'The access key expired, so the transaction did not send. Sign in again for a new access key, then send it again.',
    )
  }
}

/**
 * The sign-in for a new access key returned another user or Tempo Account, so the transaction did
 * not send. A transaction whose retry signed in for a new access key throws it. The instance keeps
 * its session. Its `cause` is the transaction's error. Match it by `name`.
 */
export class RetryAccountError extends Error {
  override readonly name = 'Plugins.viem.RetryAccountError'
  /** The failure that the sign-in resolves: `accessKey` or `limit`. */
  readonly kind: Retry.Kind

  constructor(options: { cause: unknown; kind: Retry.Kind }) {
    super(
      'The sign-in for a new access key returned another account. The transaction did not send. Sign in with the same account, then send it again.',
      { cause: options.cause },
    )
    this.kind = options.kind
  }
}

/**
 * The user closed the screen that a failed transaction showed, so the transaction did not send. A
 * transaction whose retry the user ended throws it: a close of the deposit page before a deposit,
 * **Continue to** the app without one, or a close of the sign-in for a new access key. Its `cause`
 * is the transaction's error. The same transaction, sent again, retries. Match it by `name`.
 */
export class RetryClosedError extends Error {
  override readonly name = 'Plugins.viem.RetryClosedError'
  /** The failure that the screen resolves: `accessKey`, `balance`, or `limit`. */
  readonly kind: Retry.Kind

  constructor(options: { cause: unknown; kind: Retry.Kind }) {
    super(
      `${closedMessages[options.kind]} The transaction did not send. Send it again to retry.`,
      { cause: options.cause },
    )
    this.kind = options.kind
  }
}

/**
 * Returns the plugin of the Viem client, which adds `viem`, and the default client's actions and
 * action groups to the instance itself, such as `accounts.token.transferSync()`,
 * `accounts.sendTransaction()`, and `accounts.signMessage()`. `accounts.viem` is the default
 * client: a Tempo client from `viem/tempo`, on the instance's chain, with its transport, and an
 * account that follows the instance's session. Each sign-in sets the account, and a sign-out
 * empties it, so no Viem action passes `account`. `accounts.viem({ … })` returns a client with
 * overrides, such as another chain, or a fixed `session` for one request on a backend.
 *
 * Without options, the clients use Tempo's chains and their own RPC. The plugin takes options, or a
 * function that returns the options of a chain by its ID, such as for a transport of each chain.
 * The options are those of `createClient` from `viem/tempo` but `account`, `chain`, and `testnet`,
 * such as `feeToken` and `transport`, and those of `viem.Options`. A chain ID is valid when it
 * names a Tempo chain, or when its options name a `chain` of that ID.
 *
 * Each action of the instance reads the default client. The client's settings stay on
 * `accounts.viem` alone: its `account`, `chain`, `transport`, and `extend`, since
 * `accounts.account` is the instance's own. Viem's standalone actions take the client, such as
 * `signMessage(accounts.viem, { message })`.
 *
 * The access key signs transactions, messages, and typed data, on a page or not, also before its
 * first transaction registers it on the chain. A session without an access key that signs on the
 * client's chain signs messages and typed data through the account's owner: the cloud wallet through
 * Tempo ID, or the account's passkey. Such a session holds no access key there, holds another app's
 * access key, or holds an expired access key beside a live one on another chain. A fixed session
 * always signs with its access key. A signature of a message or typed data reads nothing from the
 * chain. A cloud wallet signs only for an app with the `tempo-id:sign` scope, on a chain with
 * configurable accounts. If no owner signs alone, such as passkeys below the threshold, the
 * signature throws `Accounts.AccessKeyRequiredError`. A transaction of such a session throws it
 * before the node receives a fill, also through a standalone action, such as
 * `Actions.token.transferSync`. A prepare or an estimate of it still fills.
 *
 * A session without its account, such as after a dialog's sign-in, reads the account at the owner's
 * first signature, with the access token that `session.accessToken` returns. A token that holds for
 * over 5 seconds serves the read while its refresh runs beside it. On a page, without a live token,
 * or for a DPoP token that the instance's `dpop` key does not bind, the read sends the session
 * cookie. Elsewhere, the signature throws the error of `session.accessToken`.
 *
 * An access key signs a message or typed data in a keychain envelope for the Tempo Account, which
 * `accounts.verifyMessage` and `verifyTypedData` verify. The Viem guide describes
 * it under "Sign a message as the Tempo Account". A verifier accepts that signature only while the
 * chain holds the access key. So the access key's first transaction, which registers it, goes
 * before a signature that a verifier checks. `verifyHash`, `verifyMessage`, and `verifyTypedData`
 * take the user's `accessToken` for the app, and count a live access key's signature only
 * when the token names the access key. Each returns `false` for the zero address, which signs
 * nothing, as `verifySiweMessage` does for a message that names it. `Actions.account.signMessage`
 * and `signTypedData` of
 * `accounts/internal` sign as the owner explicitly, and that signature verifies before the
 * registration.
 *
 * A transaction of an access key whose node fills its nonce, and that starts while another
 * transaction of the same account is in flight in the instance, takes an expiring nonce, as Viem's
 * own transactions do within one turn of the event loop. A client of a fixed `session` takes an
 * expiring nonce for each such transaction that attaches no key authorization, since another
 * instance, such as that of another request of a Worker, can send for the session at once.
 * Concurrent requests of a server for one session thus each land, without a request more, once the
 * chain registered the access key. Expiring nonces put no order on transactions, so a transaction
 * of a fixed `session` that depends on an earlier one waits for that one's receipt, as
 * `token.transferSync` and the other synchronous actions do.
 *
 * The access key attaches its key authorization to transactions until the chain registers the
 * access key. While a transaction of the instance attaches it, the fill of another that attaches it
 * waits until the first transaction's receipt or failure, for up to 5 seconds. A fill that no
 * signature follows within 1 second, such as a preview, holds no later fill. Once the first lands,
 * the node refuses the second fill as registered, and Viem fills it again without the key
 * authorization. A receipt of a transaction that attaches
 * it, or a fill that the node refuses for a registered access key, marks the access key in the
 * instance and in its `store`, or else in the `store` of `backend({ store })`. The next
 * transaction of the session after a synchronous send, such as `token.transferSync`, and of a
 * restored or refreshed session, then attaches no key authorization that the node refuses. A client
 * of a session, such as `accounts.viem({ session })` on a new instance of a backend, starts the
 * read of the mark in `store`, and its first transaction waits for that read. A fill that the node
 * refuses for a spent limit or a call outside the scopes keeps the mark, since the chain holds the
 * access key. Any other refused fill without the authorization deletes it. If the node refuses
 * such a fill because the chain does not hold the access key, such as after a reset of a local
 * chain, the transaction fills once more with the key authorization, and sends. A sign-out, or a sign-in with another access key,
 * deletes the mark of each access key that leaves the instance's session, since the instance never
 * reads it again.
 *
 * `accessKey.revoke` and `accessKey.updateLimit`, and their `Sync` forms, change an access key
 * through Tempo ID with the account's owner, unless a call passes `account`, since the chain
 * refuses keychain changes from an access key.
 *
 * On a page, a transaction of the session's access key that the node refuses for a low balance, a
 * spent limit, or an access key that the chain does not hold shows Tempo ID's screen that fixes it,
 * then sends again, unless `retry` turns it off. An expired access key first renews through the
 * browser's Tempo ID session, with no screen. With that retry, the node receives no transaction of
 * an expired access key that this app holds. Outside a page, a transaction of an access key that
 * this app holds on the client's chain, and that expired, rejects before the node receives it, with
 * `Accounts.SignedOutError`, or `Accounts.AccessKeyRequiredError` while an access key on another
 * chain keeps the session. The rejection starts a read of the session, which empties an expired
 * session, so the status changes to `signedOut`. Outside a page, a read of the client's account
 * throws `Accounts.SignedOutError` once the status is `signedOut`, so a standalone Viem action, such as
 * `Actions.token.transferSync(accounts.viem, …)`, rejects with it too. Outside a page, an instance with the `device`
 * plugin, such as a CLI's, retries a low balance and a spent limit through `device.request`, whose
 * `onCode` shows the code.
 *
 * On a page, Tempo ID's payment page sends a `token.transfer` or `token.transferSync` of the default
 * client for a session whose access keys sign no transaction here, and that no sign-in renews: a
 * session without an access key, or one whose access key on the client's chain belongs to another
 * app. The user approves the transfer on the page, Tempo ID's sponsor pays the fee, and the action
 * returns what Viem's own returns. Only `amount`, `memo`, `to`, and `token` apply. A call with
 * `account` or `from`, a client of a fixed `session`, and `Actions.token.transfer(client, …)` are
 * Viem's own. `accounts.pay` sends its transfer with the session's access key in place of the
 * page, if the access key signs on the chain and its limits hold the amount. On a page, a low balance
 * opens the deposit page, unless `retry` turns off `balance`, and the access key sends again once
 * the deposit arrives. With `session`, such
 * as on a backend, the access key of that session sends it. Without `relay`, the
 * limit of the fee token must also hold 0.1 for the fee: `feeToken` or the chain's, else the payment's token if
 * it is a `USD` stablecoin other than MACH. A sponsoring `transport` counts as
 * no relay. Outside a page, the access key sends any amount within the whole limit.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { email, viem } from 'accounts/plugins'
 * import { http } from 'viem'
 * import { Addresses } from 'viem/tempo'
 *
 * const accounts = Accounts.create({
 *   plugins: [
 *     email(),
 *     // A function returns the options of each chain. `viem()` uses each chain's own RPC.
 *     viem((chainId) => ({ transport: http(`https://rpc.example/${chainId}`) })),
 *   ],
 * })
 *
 * await accounts.email.signIn({ code, email: address })
 * const { receipt } = await accounts.token.transferSync({
 *   amount: 10_000n,
 *   to: '0x…',
 *   token: Addresses.ousd,
 * })
 * ```
 */
export function viem(options: viem.Options | viem.Resolver = {}) {
  /** Returns the options of the chain of `chainId`. */
  const resolve = (chainId: number) =>
    typeof options === 'function' ? options(chainId) : options
  // Only a page shows Tempo ID's screens, which fix a transaction that the node refuses.
  const page = typeof document !== 'undefined'

  // The `session.accessToken` of each instance, by its configuration, which `extend` sets. The relay
  // route's requests read it, so they refresh, wait, and check the DPoP binding as `session.fetch`.
  const sessionTokens = new WeakMap<Accounts.Config, () => Promise<string>>()
  // The `device.request` of each instance with the `device` plugin, which `extend` sets. Outside a
  // page, the retry shows the code of its device grant through it.
  const deviceRequests = new WeakMap<
    Accounts.Config,
    NonNullable<Devices['device']>['request']
  >()
  // The sender of each instance's payments, by its configuration, which `actions` sets. The `pay`
  // hook reads it, so `accounts.pay` sends with the access key of the session, or of its fixed
  // `session`, where it can.
  const senders = new WeakMap<Accounts.Config, Sender>()

  const plugin = Plugin.from({
    actions: (context) => {
      const { config } = context

      /** Returns the chain of `chainId`: its options' `chain`, or Tempo's chain of that ID. */
      function chainOf(chainId: number) {
        const { chain } = resolve(chainId)
        if (chain?.id === chainId) return chain
        return defaultChains.find((entry) => entry.id === chainId)
      }

      // The wagmi plugin's config holds Tempo's chains, and the instance's chain when it is another.
      const tempoChains = defaultChains.map((entry) => chainOf(entry.id)!)
      const instanceChain = chainOf(context.chain.configured)
      const chains = (instanceChain &&
      !tempoChains.some((entry) => entry.id === instanceChain.id)
        ? [instanceChain, ...tempoChains]
        : tempoChains) as unknown as readonly [Chain, ...Chain[]]
      // The account of each session on each chain, so a client rebuilds no access key at each read.
      const accounts = new Map<
        number,
        WeakMap<Session.Any, LocalAccount | undefined>
      >()
      // The account of `current` for each page's client whose retry renews an expired access key.
      const renewing_accounts = new WeakMap<LocalAccount, LocalAccount>()
      // The retry of the plugin's clients, whose transports mark the refusals that it retries.
      const retry = Retry.create()
      // The fix in progress for each screen, which concurrent failures that the screen resolves share:
      // a deposit of one token on one chain, or one sign-in on one chain.
      const fixes = new Map<string, machines.screen.Actor>()
      // The failure that each screen resolves, the account of its deposit, and, outside a page, the
      // balance that its deposit reaches.
      const resolving = new WeakMap<machines.screen.Actor, Screen>()
      // The clients without overrides beyond `chainId`, one for each chain.
      const clients = new Map<number, viem.Client>()
      // The refusals of `refuse` for the instance's session, whose call's rejection starts the read
      // of the session.
      const lapses = new WeakSet<Error>()
      // Each refusal of `refuse`, which no node answered. A refused fill ends the preparation.
      const refusals = new WeakSet<Error>()
      // The verifier of the app's access tokens, loaded and built at the first verification that
      // names one, so a page's bundle holds no token verifier. Its options are those of the
      // instance's chain. A failed load, such as offline, lets the next verification try again.
      let verifier: Promise<AccessToken.create.ReturnType> | undefined
      const tokens = () =>
        (verifier ??= import('../AccessToken.js')
          .then((module) =>
            module.create(
              config,
              resolve(context.chain.configured).accessTokens,
            ),
          )
          .catch((error: unknown) => {
            verifier = undefined
            throw error
          }))
      // The access keys that the chain registered, by chain, account, and access key. Each session
      // and each restore builds a new account, whose own manager attaches the authorization again,
      // which the node refuses. The store keeps the set across page loads.
      const registrations = new Set<string>()
      // The store reads of registration marks in progress, by registration, which `hydrate` starts
      // when a client of the session is created, and which the access key's next fill awaits.
      const reads_mark = new Map<string, Promise<void>>()
      // A backend's instance has no store of its own, so the marks live in the backend plugin's store,
      // which replicas and the instances of other requests share.
      const store = () =>
        DefaultStore.get(config.store) ??
        ((config as Record<symbol, unknown>)[BackendOperations.store] as
          | Store
          | undefined)
      // The signed transactions that attach a key authorization, by their serialized form, with the
      // registration that each makes once it lands.
      const attaching = new Map<string, Registration>()
      // The registrations whose mark kept the authorization off a fill, by chain, account, and
      // access key, so a refused fill drops a stale mark, such as after a reset of a local chain.
      const unattached = new Set<string>()
      // The registrations whose authorization a fill carried and the node refused as registered, so
      // Viem's recovery reads the authorization again, and removes it from the fill.
      const recovering = new Set<string>()
      // The authorization of each registration that Viem removed, so the recovery of a later fill
      // that carried it, and that waited for the transaction that registered it, reads it again.
      const removed = new Map<
        string,
        NonNullable<
          Awaited<
            ReturnType<KeyAuthorizationManager.KeyAuthorizationManager['get']>
          >
        >
      >()
      // The payment in progress whose transaction carries the authorization of each registration,
      // which `turn` returns: when its turn expires, and the promise that settles at its end.
      const carrying = new Map<string, Turn>()
      // The hold of each registration whose fill carries its authorization, until the chain registers
      // it. Of two transactions that carry one authorization at once, the node keeps one, so the
      // next fill waits, and then fills without it.
      const filling = new Map<string, machines.hold.Actor>()
      // The registration of each asynchronous send that carries an authorization, by its hash, until
      // a read of its receipt shows whether the chain applied it.
      const landing = new Map<string, Registration>()
      // The hold of the latest fill of each registration that carries its authorization, with the
      // name of its transaction by nonce and calls, which the transaction's signature takes. A
      // later fill replaces the entry, so a slow signature of an earlier fill names no hold.
      const filled = new Map<string, { hold: number; key: string }>()
      // The transactions in flight of each access key's account, by account, as the expiry of each:
      // from the start of its preparation until its send settles. A send that never follows, such as
      // after a refused fill, leaves its entry until it expires.
      const sending = new Map<string, readonly number[]>()
      // The account of each signed transaction of an access key, whose send ends its entry in
      // `sending`.
      const senders_signed = new Map<string, string>()

      /**
       * Adds a transaction of the account `address` to `sending`, and returns whether another
       * transaction of the account is in flight.
       */
      function startSend(address: string) {
        const now = Date.now()
        const live = (sending.get(address) ?? []).filter(
          (expiresAt) => expiresAt > now,
        )
        // The oldest account goes first, so a long-running backend holds a bounded map.
        if (!sending.has(address) && sending.size >= registeredLimit)
          sending.delete(sending.keys().next().value!)
        sending.set(address, [...live, now + sendLimit])
        return live.length > 0
      }

      /** Removes the earliest transaction of the account `address` from `sending`. */
      function endSend(address: string) {
        const [, ...rest] = sending.get(address) ?? []
        if (rest.length > 0) sending.set(address, rest)
        else sending.delete(address)
      }

      /**
       * Returns `chain`, whose preparation of a transaction of an access key takes an expiring
       * nonce while another transaction of the same account is in flight in the instance, or with
       * `shared`, for each transaction that attaches no key authorization. Both would otherwise fill
       * the same protocol nonce, and the node keeps one of them. Viem detects only transactions that
       * start in one turn of the event loop, and a server's requests start in turns of their own. A
       * client of a fixed session is `shared`, since another instance, such as that of another
       * request or replica, can send for the session at once. A send of `options.account`,
       * the client's own account, that no access key signs rejects with
       * {@link AccessKeyRequiredError} before the fill, so the node receives no request.
       */
      function coordinate(
        chain: Chain,
        options_coordinate: { account: LocalAccount; shared: boolean },
      ): Chain {
        const { account: account_client, shared } = options_coordinate
        const prepare = (chain as TempoChain).prepareTransactionRequest
        if (!Array.isArray(prepare)) return chain
        // Viem types the hook's request by the chain's formatters, which a plain chain does not hold.
        const [fn, options] = prepare as unknown as readonly [
          (request: Prepare.Request, args: Prepare.Args) => unknown,
          unknown,
        ]
        return {
          ...chain,
          prepareTransactionRequest: [
            async (request: Prepare.Request, args: Prepare.Args) => {
              // Viem refills without the authorization of a registered access key. A refusal of a
              // fill whose mark kept the authorization off, such as after a reset of a local chain,
              // drops the mark, so the fill runs again with the authorization, once.
              if (args.phase === 'afterFillTransactionError') {
                // The transport refused the fill of an expired access key before the request. Viem would
                // read the nonce and the fees, then refuse its estimate, so the refusal ends the
                // preparation.
                if (refused(args.error, { refusals })) throw args.error
                return (await fn(request, args)) ?? reattach(request, args)
              }
              const { account, nonce, nonceKey, parameters } = request
              // The client's own account signs a transaction only with an access key on the chain.
              // Without one, the signature of a send would reject after the fill, so the fill would
              // only read the node, and its refusal, such as for a low balance, would hide the cause.
              // Viem's sends alone prepare `sidecars`, so a prepare or an estimate, which signs
              // nothing, still fills.
              if (
                args.phase === 'beforeFillTransaction' &&
                account === account_client &&
                parameters?.includes('sidecars') &&
                account_client.source !== 'accessKey'
              )
                throw new AccessKeyRequiredError()
              // Only a transaction whose nonce the node fills takes the protocol nonce. Viem's
              // estimate prepares no nonce, and sends nothing.
              if (
                args.phase !== 'beforeFillTransaction' ||
                account?.source !== 'accessKey' ||
                typeof account.address !== 'string' ||
                nonce !== undefined ||
                nonceKey !== undefined ||
                !parameters?.includes('nonce')
              )
                return fn(request, args)
              const concurrent = startSend(account.address.toLowerCase())
              const expiring = await (async () => {
                if (concurrent) return true
                if (!shared) return false
                // A transaction that carries the key authorization keeps the protocol nonce. A
                // concurrent one of another instance that carries it too then fails at its send,
                // since the node never includes a second registration of the access key.
                return !(await carries(request))
              })()
              return fn(
                expiring ? { ...request, nonceKey: 'expiring' } : request,
                args,
              )
            },
            options,
          ],
        } as Chain
      }

      /** Returns whether `request` attaches the key authorization of its access key. */
      async function carries(request: Prepare.Request) {
        const { account } = request
        const chainId = request.chainId ?? request.chain?.id
        if (!account?.keyAuthorizationManager || chainId === undefined)
          return false
        const pending = await account.keyAuthorizationManager.get({
          accessKey: account.accessKeyAddress as `0x${string}`,
          address: account.address as `0x${string}`,
          chainId,
        })
        return Boolean(pending)
      }

      /**
       * Returns `request` with the key authorization of its access key, for a fill that the node
       * refused because the chain does not hold the access key, while the request carries no
       * authorization. The watch of the transport dropped the mark of such a fill, so the manager
       * returns the authorization again. Returns `undefined` for any other refusal.
       */
      async function reattach(request: Prepare.Request, args: Prepare.Args) {
        const { account, keyAuthorization } = request
        const chainId = request.chainId ?? request.chain?.id
        if (
          keyAuthorization ||
          account?.source !== 'accessKey' ||
          !account.keyAuthorizationManager ||
          chainId === undefined ||
          !refusedWith(args.error, { name: 'KeyNotFound' })
        )
          return undefined
        const pending = await account.keyAuthorizationManager.get({
          accessKey: account.accessKeyAddress as `0x${string}`,
          address: account.address as `0x${string}`,
          chainId,
        })
        return pending ? { ...request, keyAuthorization: pending } : undefined
      }

      /** Adds `name` to the instance's registrations. */
      function remember(name: string) {
        // The oldest entry goes first, so a long-running backend holds a bounded set.
        if (registrations.size >= registeredLimit)
          registrations.delete(registrations.values().next().value!)
        registrations.add(name)
      }

      /**
       * Records `registration` in the instance at once, and starts its write to the store. The
       * transaction waits for no write.
       */
      function mark(registration: Registration) {
        const { expiresAt, name } = registration
        // The chain holds the access key, so no later fill carries its authorization.
        filling.get(name)?.send({ type: 'registered' })
        filling.delete(name)
        if (expiresAt && expiresAt <= Date.now()) return
        // A transaction in flight when its access key left the session lands later, and would write
        // the mark that `follow` deleted back for good.
        if (departed.has(name)) return
        remember(name)
        // The write only saves a request of a later instance, and a remote store such as Redis
        // takes a round trip, so nothing awaits it, and a failed write changes nothing else.
        write(name, async () =>
          store()?.setItem(name, { expiresAt }, expiresAt ? { expiresAt } : {}),
        )
      }

      // The last store write of each mark in progress, which the next write of the same mark follows,
      // so a deletion never lands before a write that started earlier.
      const writes = new Map<string, Promise<void>>()

      /** Runs `fn`, a store write of the mark `name`, after the earlier writes of the mark. */
      function write(name: string, fn: () => Promise<void>) {
        const run = (writes.get(name) ?? Promise.resolve())
          .then(fn)
          .catch(() => undefined)
          .finally(() => {
            if (writes.get(name) === run) writes.delete(name)
          })
        writes.set(name, run)
      }

      /**
       * Drops the mark `name`, in the instance and in its store, so the next transaction attaches the
       * authorization again.
       */
      function forget(name: string) {
        registrations.delete(name)
        // The next fill attaches the authorization whether the deletion lands or not.
        write(name, async () => store()?.removeItem(name))
      }

      /**
       * Reads the store's marks of the access keys of `session`, on every chain, into `registrations`,
       * when the client is created. A fill that would attach the key authorization waits for this
       * read, up to {@link markReadLimit} after it starts.
       */
      function hydrate(session: Pick<Session.Any, 'accessKey' | 'accessKeys'>) {
        for (const accessKey of [
          session.accessKey,
          ...(session.accessKeys ?? []),
        ])
          if (accessKey) hydrateAccessKey(accessKey)
      }

      /** Reads the store's mark of `accessKey` into `registrations`. */
      function hydrateAccessKey(
        accessKey: NonNullable<Session.Any['accessKey']>,
      ) {
        const held = store()
        if (!held) return
        const name = markName(accessKey)
        if (registrations.has(name) || reads_mark.has(name)) return
        // A failed read changes nothing. A fill of the access key waits for the read in progress, since
        // a fill that attaches a registered access key's authorization is refused and sent again.
        const read = (async () => held.getItem(name))()
          .then(
            (held) => {
              if (!held) return
              // The default IndexedDB store keeps entries past their `expiresAt`, so a read prunes them.
              const { expiresAt } = held as Partial<Registration>
              if (expiresAt && expiresAt <= Date.now()) return forget(name)
              remember(name)
            },
            () => undefined,
          )
          .finally(() => reads_mark.delete(name))
        // One deadline for each read, so every fill after it waits for no stalled store.
        reads_mark.set(name, wait(read))
      }

      /**
       * Waits until no other payment carries the authorization of the access key of `key`. Returns
       * `undefined` once the chain holds the access key, else the function that ends this payment's
       * turn. A payment ends its turn after it starts the confirmation of its landed transaction, so
       * the next payment waits for that read, and finds the registration. A turn expires
       * {@link turnLimit} after it starts, and one waiting payment then takes the turn, so a payment
       * that stalls lets one other payment attach the authorization at a time. An abort of
       * `options.signal` rejects the wait with its reason.
       */
      async function turn(
        key: KeyAuthorizationManager.Key,
        options: viem.Registrations.turn.Options = {},
      ) {
        const { keyAuthorizationManager, signal } = options
        const name = registrationName(key)
        while (true) {
          await reads_mark.get(name)
          if (registrations.has(name)) return undefined
          // A payment whose account holds no pending key authorization attaches none, such as after
          // a refused fill drops the mark of a registered access key, so it takes no turn.
          if (
            keyAuthorizationManager &&
            !(await keyAuthorizationManager.get(key))
          )
            return undefined
          const earlier = carrying.get(name)
          // The earlier payment can stall, such as at an endpoint that never answers. So its turn
          // expires, and the first payment that wakes after the expiry takes the turn. The others
          // wake at the same time, find the new turn, and wait for it.
          if (!earlier) break
          const left = earlier.expiresAt - Date.now()
          if (left <= 0) break
          signal?.throwIfAborted()
          await new Promise<void>((resolve, reject) => {
            const done = () => {
              clearTimeout(timer)
              signal?.removeEventListener('abort', abort)
              resolve()
            }
            const abort = () => {
              clearTimeout(timer)
              reject(signal?.reason)
            }
            const timer = setTimeout(done, left)
            signal?.addEventListener('abort', abort, { once: true })
            void earlier.ended.then(done)
          })
        }
        signal?.throwIfAborted()
        let end = () => {}
        const current: Turn = {
          ended: new Promise<void>((resolve) => {
            end = resolve
          }),
          expiresAt: Date.now() + turnLimit,
        }
        carrying.set(name, current)
        const evict = () => {
          if (carrying.get(name) === current) carrying.delete(name)
        }
        // A payment that never ends its turn, such as a failed charge that sent its credential,
        // leaves the registry at the expiry, so a backend that pays for many access keys keeps none.
        const timer = setTimeout(evict, turnLimit)
        ;(timer as { unref?: () => void }).unref?.()
        return () => {
          // A failed send of the payment can still land, so its turn lasts until it expires.
          if (current.kept) return
          clearTimeout(timer)
          evict()
          end()
        }
      }

      // The marks of the access keys of the session that the instance showed last.
      let followed: readonly string[] = []
      // The marks of the access keys that left the session, which no later `mark` writes again.
      const departed = new Set<string>()

      /**
       * Starts the reads of the marks of the session's access keys, and drops the marks of the access
       * keys that left the session since, such as at a sign-out or at a sign-in with a new access key.
       * The instance never reads those marks again, and a store that keeps entries past their
       * `expiresAt`, such as IndexedDB or the secure store of `expo`, would keep them for good. A
       * status without a session to show yet, `pending`, drops none.
       */
      function follow(status: Session.Status<Session.Any>) {
        if (status.status === 'pending') return
        const { session } = status
        const names = [
          session?.accessKey,
          ...(session?.accessKeys ?? []),
        ].flatMap((accessKey) => (accessKey ? [markName(accessKey)] : []))
        for (const name of followed) {
          if (names.includes(name)) continue
          forget(name)
          if (departed.size >= registeredLimit)
            departed.delete(departed.values().next().value!)
          departed.add(name)
        }
        for (const name of names) departed.delete(name)
        followed = names
        // A saved session whose access key expired before the instance started never shows, since a
        // read of the store empties it. Its expired access keys never sign again, so their marks go.
        const renewing = context.session.renewing()
        for (const accessKey of [
          renewing?.accessKey,
          ...(renewing?.accessKeys ?? []),
        ]) {
          if (!accessKey || !AccessKey_internal.expired(accessKey)) continue
          const name = markName(accessKey)
          if (names.includes(name) || departed.has(name)) continue
          forget(name)
          if (departed.size >= registeredLimit)
            departed.delete(departed.values().next().value!)
          departed.add(name)
        }
        if (session) hydrate(session)
      }
      // The instance's own status, also where only another plugin, such as `mpp`, builds the
      // actions, so each instance that writes marks deletes them.
      follow(context.session.status.get())
      context.session.status.subscribe(follow)

      /**
       * Waits until no other transaction carries the authorization of the registration `name`, and
       * holds it for the fill that starts. Returns the hold's count, and the function that reports
       * the fill's result to its own hold. The hold lasts while its transaction can still register the access key, as
       * `machines.hold` describes, and at most {@link turnLimit}.
       */
      async function hold(name: string) {
        const actor =
          filling.get(name) ??
          createActor(machines.hold, { clock: unrefClock }).start()
        // The oldest hold goes first, so a long-running backend holds a bounded set.
        if (!filling.has(name) && filling.size >= registeredLimit)
          filling.delete(filling.keys().next().value!)
        filling.set(name, actor)
        // Waiting fills wake in turn, and the first takes the hold, so the others wait again. The
        // hold's own timer keeps no process alive, so the timeout of the wait does, and the hold
        // expires before it ends.
        while (!machines.free(actor.getSnapshot()))
          await waitFor(actor, machines.free, { timeout: turnLimit }).catch(
            () => undefined,
          )
        actor.send({ type: 'fill.start' })
        // Each result names its own hold, so a fill that outlives an expired hold ends no later one.
        const { holds } = actor.getSnapshot().context
        return {
          hold: holds,
          settle: (type: 'fill.done' | 'fill.refused') =>
            actor.send({ hold: holds, type }),
        }
      }

      /**
       * Hands the hold `hold` of the registration `name` to the signature of the transaction `key`.
       * A registration has one hold at a time, so the entries of its earlier fills go, and no
       * signature takes a superseded hold. A fill whose hold expired hands off nothing.
       */
      function handOff(name: string, key: string, hold: number) {
        // A fill that outlived its hold hands off nothing, so it removes no later fill's entry.
        if (filling.get(name)?.getSnapshot().context.holds !== hold) return
        filled.delete(name)
        if (filled.size >= registeredLimit)
          filled.delete(filled.keys().next().value!)
        filled.set(name, { hold, key })
      }

      /**
       * Ends the hold of the transaction of `registration` once it can no longer register the
       * access key. A transaction that outlived its hold ends no later one.
       */
      function fail(registration: Registration) {
        const { hold, name } = registration
        if (hold !== undefined)
          filling.get(name)?.send({ hold, type: 'transaction.failed' })
      }

      /**
       * Returns `account`, whose key authorization stays unattached once the chain registered its
       * access key: after a transaction that attached it landed, or after Viem found it registered,
       * in this instance or in an earlier one on the same store.
       */
      function track(account: LocalAccount | undefined) {
        const manager = (account as Account.AccessKeyAccount | undefined)
          ?.keyAuthorizationManager
        if (!account || !manager) return account
        const tracked: KeyAuthorizationManager.KeyAuthorizationManager = {
          async get(key) {
            const pending =
              (await manager.get(key)) ??
              (recovering.has(registrationName(key))
                ? removed.get(registrationName(key))
                : undefined)
            // The store's mark reaches `registrations` through `hydrate`, which starts its read when
            // the client is created, so a transaction starts no store read.
            if (!pending) return undefined
            // An instance that already holds the registration waits for no store.
            if (!registrations.has(registrationName(key)))
              await reads_mark.get(registrationName(key))
            // Viem's recovery of a fill that the node refused reads the authorization again, so a
            // mark that lands after a fill carried it keeps it until Viem removes it.
            if (
              recovering.has(registrationName(key)) ||
              !registrations.has(registrationName(key))
            )
              return pending
            if (unattached.size >= registeredLimit)
              unattached.delete(unattached.values().next().value!)
            unattached.add(registrationName(key))
            return undefined
          },
          // Viem removes the authorization once the chain registered the access key, or once it
          // expired. `mark` skips the expired one.
          async remove(key) {
            const pending = await manager.get(key)
            await manager.remove(key)
            recovering.delete(registrationName(key))
            if (pending) {
              if (removed.size >= registeredLimit)
                removed.delete(removed.keys().next().value!)
              removed.set(registrationName(key), pending)
            }
            if (pending)
              mark({
                expiresAt: Number(pending.expiry ?? 0) * 1000,
                name: registrationName(key),
              })
          },
          set: (key, value) => manager.set(key, value),
        }
        return {
          ...account,
          keyAuthorizationManager: tracked,
          async signTransaction(transaction, options) {
            const signed = await account.signTransaction(transaction, options)
            // A transaction that is signed but never sent stays, so the oldest goes first.
            if (senders_signed.size >= registeredLimit)
              senders_signed.delete(senders_signed.keys().next().value!)
            senders_signed.set(signed, account.address.toLowerCase())
            const { keyAuthorization } = transaction as {
              keyAuthorization?: KeyAuthorization.KeyAuthorization | undefined
            }
            if (keyAuthorization) {
              const name = registrationName({
                accessKey: keyAuthorization.address,
                address: account.address,
                chainId: Number(keyAuthorization.chainId),
              })
              // The transaction takes the hold of its own fill, which its failure names.
              const key = nonceName(name, transaction as Nonced)
              const entry = filled.get(name)
              const hold =
                entry?.key === key || entry?.key === unfilledName(name)
                  ? entry?.hold
                  : undefined
              if (hold !== undefined) filled.delete(name)
              const actor = filling.get(name)
              // A transaction that is signed but never sent stays, so the oldest goes first.
              if (attaching.size >= registeredLimit)
                attaching.delete(attaching.keys().next().value!)
              attaching.set(signed, {
                expiresAt: Number(keyAuthorization.expiry ?? 0) * 1000,
                hold,
                name,
              })
              if (hold !== undefined)
                actor?.send({ hold, type: 'transaction.signed' })
            }
            return signed
          },
        } as LocalAccount
      }

      /**
       * Returns `value`, the transport of the client of `chainId`, which refuses a transaction of an
       * expired access key that this app holds before the request. Outside a page, the refusal is the
       * error of `lapse`: `session.get` empties such a session, and no retry renews its access key
       * there. With `options.renews`, on a page whose retry renews the access key, the refusal is
       * {@link AccessKeyExpiredError}, which the retry reads as an access key that the chain does not
       * hold. A transaction of the access key fills or estimates with its `keyId` first, and
       * `expiring` refuses the signature of one whose fields are all given, so the node receives no
       * request that carries the access key. A refused fill ends the preparation, so Viem reads no
       * nonce or fees after it. Reads, the owner's signatures, and the
       * access key changes that Tempo ID sends make no such request.
       */
      function refuse(
        value: Transport,
        options: {
          chainId: number
          /** Whether a retry on the page renews the access key. Defaults to `false`. */
          renews?: boolean | undefined
          session?: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined
        },
      ): Transport {
        const { chainId, renews = false, session: fixed } = options
        /** Returns the refusal of a transaction of the expired access key. */
        const refusal = () => {
          const error = (() => {
            if (fixed) return lapse_fixed(fixed)
            if (renews) return new AccessKeyExpiredError()
            const error = lapse(context.session.get())
            lapses.add(error)
            return error
          })()
          refusals.add(error)
          return error
        }
        return (parameters) => {
          const instance = value(parameters)
          return {
            ...instance,
            async request(args, options) {
              const request = (
                args.params as readonly unknown[] | undefined
              )?.[0] as { from?: string; keyId?: string } | undefined
              const session = fixed ?? context.session.get()
              const accessKey = accessKeyOn(session, { chainId })
              const keyId = accessKey?.keyAuthorization.keyId
              // The same signing material can hold an authorization for another account, which
              // stays valid, so only a transaction of the access key's own account is refused.
              if (
                prepares.has(args.method) &&
                accessKey &&
                keyId &&
                typeof request?.keyId === 'string' &&
                typeof request.from === 'string' &&
                Address.validate(request.keyId, { strict: false }) &&
                Address.validate(request.from, { strict: false }) &&
                Address.isEqual(request.keyId, keyId) &&
                Address.isEqual(request.from, accessKey.account) &&
                lapsed(session, { chainId })
              )
                // Viem prepares the transaction again after a refused fill, so a read of the session
                // here could adopt a newer session that then sends. The call's rejection starts it.
                throw refusal()
              return await instance.request(args, options)
            },
          } as ReturnType<Transport>
        }
      }

      /**
       * Returns `value`, the transport of the client of `chainId`, whose landed transactions that
       * attach a key authorization mark their access key as registered.
       */
      function watch(value: Transport, chainId: number): Transport {
        return (parameters) => {
          const instance = value(parameters)
          return {
            ...instance,
            async request(args, options) {
              const signed = (
                args.params as readonly unknown[] | undefined
              )?.[0]
              const registration =
                sends.has(args.method) && typeof signed === 'string'
                  ? attaching.get(signed)
                  : undefined
              if (registration) attaching.delete(signed as string)
              const sender =
                sends.has(args.method) && typeof signed === 'string'
                  ? senders_signed.get(signed)
                  : undefined
              if (sender) senders_signed.delete(signed as string)
              const fill = (() => {
                if (args.method !== 'eth_fillTransaction') return undefined
                const request = signed as
                  | {
                      from?: unknown
                      keyAuthorization?: unknown
                      keyId?: unknown
                    }
                  | undefined
                if (
                  !request ||
                  request.keyAuthorization ||
                  typeof request.from !== 'string' ||
                  typeof request.keyId !== 'string'
                )
                  return undefined
                const name = registrationName({
                  accessKey: request.keyId as `0x${string}`,
                  address: request.from as `0x${string}`,
                  chainId,
                })
                return unattached.has(name) ? name : undefined
              })()
              const carried = (() => {
                if (args.method !== 'eth_fillTransaction') return undefined
                const request = signed as
                  | { from?: unknown; keyAuthorization?: { keyId?: unknown } }
                  | undefined
                const accessKey = request?.keyAuthorization?.keyId
                if (
                  typeof request?.from !== 'string' ||
                  typeof accessKey !== 'string'
                )
                  return undefined
                return registrationName({
                  accessKey: accessKey as `0x${string}`,
                  address: request.from as `0x${string}`,
                  chainId,
                })
              })()
              // The fill waits for an earlier transaction that carries the same authorization. Once
              // that one lands, the node refuses this fill as registered, and Viem fills it again
              // without the authorization.
              const held = carried ? await hold(carried) : undefined
              const result = await instance
                .request(args, options)
                // The node holds a sent transaction once the send settles, so a later fill reads the
                // next nonce.
                .finally(() => {
                  if (sender) endSend(sender)
                })
                .catch((error: unknown) => {
                  // Viem sends the transaction of a failed fill, unless the node reverted it, or
                  // refused its authorization as registered. Its signature then takes the hold.
                  if (
                    held &&
                    !reverted(error) &&
                    !refusedWith(error, { name: 'KeyAlreadyExists' })
                  ) {
                    handOff(carried!, unfilledName(carried!), held.hold)
                    held.settle('fill.done')
                  }
                  // A refused fill sends no transaction.
                  else held?.settle('fill.refused')
                  // A refused send rarely lands, and a later fill that carries the authorization
                  // finds a registration that it made through Viem's recovery.
                  if (registration) fail(registration)
                  // A send that carried the authorization and failed can still land, such as one
                  // whose receipt the node did not return in time. So the payment that carries it
                  // keeps its turn until the turn expires, and the next payment then finds the
                  // registration on the chain.
                  if (registration) {
                    const held = carrying.get(registration.name)
                    if (held) held.kept = true
                  }
                  // A refused fill without the authorization can mean that the chain no longer
                  // holds the access key, so its mark goes, and a later fill attaches it again. A
                  // spent limit or a call outside the scopes shows that the chain holds the access
                  // key. The chain checks limits and scopes only for an access key that it holds,
                  // so its mark stays. A revoked access key never registers again, so its mark
                  // stays too: Viem's own preparation would attach the authorization, which the
                  // node refuses as `KeyAlreadyExists`, and the retry would not see the revocation.
                  if (
                    fill &&
                    !refusedWith(error, { name: 'SpendingLimitExceeded' }) &&
                    !refusedWith(error, { name: 'CallNotAllowed' }) &&
                    !refusedWith(error, { name: 'KeyAlreadyRevoked' })
                  )
                    forget(fill)
                  // A fill that carried the authorization of a registered access key, such as one
                  // that another transaction of the session registered meanwhile, is refused.
                  // Viem's recovery then reads the authorization, and removes it from the fill.
                  const refused = refusedWith(error, {
                    name: 'KeyAlreadyExists',
                  })
                  if (carried && refused) {
                    if (recovering.size >= registeredLimit)
                      recovering.delete(recovering.values().next().value!)
                    recovering.add(carried)
                  }
                  throw error
                })
              if (held) {
                const key = nonceName(
                  carried!,
                  (result as { tx?: Nonced } | undefined)?.tx ?? {},
                )
                if (key !== undefined) {
                  handOff(carried!, key, held.hold)
                }
                held.settle('fill.done')
              }
              // Only a successful receipt shows that the chain applied the authorization. An
              // asynchronous send's receipt arrives with a later read.
              if (
                registration &&
                args.method === 'eth_sendRawTransactionSync'
              ) {
                if (
                  (result as { status?: unknown } | undefined)?.status === '0x1'
                )
                  mark(registration)
                else fail(registration)
              } else if (registration && typeof result === 'string') {
                if (landing.size >= registeredLimit)
                  landing.delete(landing.keys().next().value!)
                landing.set(result.toLowerCase(), registration)
              }
              const landed =
                args.method === 'eth_getTransactionReceipt' &&
                typeof signed === 'string' &&
                result
                  ? landing.get(signed.toLowerCase())
                  : undefined
              if (landed) {
                landing.delete((signed as string).toLowerCase())
                if ((result as { status?: unknown }).status === '0x1')
                  mark(landed)
                else fail(landed)
              }
              return result
            },
          } as ReturnType<Transport>
        }
      }

      /** Returns the options of the chain of `chainId` that name its transport and relay route. */
      function routing(chainId: number) {
        if (typeof options === 'function') return options(chainId)
        // The object form names one chain: its `chain`, or the instance's configured chain, which a
        // switch never moves. Other chains keep their own RPC, so one transport or route never
        // serves another chain's requests.
        const target = options.chain?.id ?? context.chain.configured
        return chainId === target ? options : {}
      }

      /** Returns the transport of the chain of `chainId` without its relay route. */
      function rpc(chainId: number): Transport {
        return routing(chainId).transport ?? http()
      }

      // The plugin's chains and transports, which the clients and the wagmi plugin share.
      const own = {
        chain: chainOf,
        chains,
        registrations: {
          hydrate,
          landed(signed: string, confirm: () => Promise<boolean>) {
            const registration = attaching.get(signed)
            if (!registration) return
            attaching.delete(signed)
            const { name } = registration
            // Another sender's report proves nothing, so the chain confirms the registration first.
            // Nothing awaits the read, and the access key's next fill waits for it, up to
            // §markReadLimit§, as for a store read.
            const read = confirm()
              .then(
                (held) => {
                  if (held) mark(registration)
                },
                () => undefined,
              )
              .finally(() => reads_mark.delete(name))
            reads_mark.set(name, wait(read))
          },
          track: (account: Account.AccessKeyAccount) =>
            track(account) as Account.AccessKeyAccount,
          turn,
          watch,
        },
        retry: {
          classify: retry.classify,
          fix: (failure, options) =>
            fix_joined(failure, {
              ...options,
              parameters: undefined,
              relayed: !!routing(options.chainId).relay,
              // The check of a spent limit only reads the chain, so it needs no relay route.
              transport: rpc(options.chainId),
            }),
          kinds: (chainId, call) => kinds(resolve(chainId).retry ?? true, call),
          transport: retry.transport,
        },
        rpc,
        transport: (
          chainId: number,
          options: { token?: boolean | undefined } = {},
        ) => {
          const { token = true } = options
          const { relay } = routing(chainId)
          const transport = rpc(chainId)
          // Viem's `withRelay` sends a fill, and a raw transaction without its fee payer's signature, to
          // the relay route, and every other request to `transport`.
          if (!relay) return transport
          const { credentials = 'same-origin', url: route } =
            typeof relay === 'string' ? { url: relay } : relay
          return withRelay(
            transport,
            http(route, {
              fetchFn: (input, init) =>
                relayFetch(input, init, {
                  credentials: token ? credentials : 'omit',
                }),
            }),
          )
        },
      } satisfies viem.Settings

      /**
       * Sends a request to the relay route with the access token of the instance's session, which
       * `session.accessToken` returns, so the route can verify its caller. With `same-origin`, only
       * a route at one of the app's origins receives the token: the page's, or that of `redirectUri`
       * or `clientId`. With `include`, any route does, and with `omit`, none, as for a fixed
       * session's client. A request that already names an `Authorization` header, such as from a
       * relay URL's credentials, keeps it. Without a token, such as while signed out, after a failed
       * refresh, or for a token that another DPoP key binds, the request carries none.
       */
      async function relayFetch(
        input: string | URL | Request,
        init: RequestInit | undefined,
        options: { credentials: viem.Relay['credentials'] },
      ) {
        const { credentials } = options
        const url = input instanceof Request ? input.url : input
        const send = () => (config.fetch ?? globalThis.fetch)(url, init)
        if (
          credentials === 'omit' ||
          (credentials !== 'include' && !appOrigins().includes(origin(url))) ||
          new Headers(init?.headers).has('authorization')
        )
          return send()

        const token = await sessionTokens
          .get(config)?.()
          .catch(() => undefined)
        if (!token) return send()
        return Actions_accounts.fetch(config, {
          accessToken: token,
          init,
          url,
        })
      }

      /**
       * Returns the app's origins: the page's, and those of `redirectUri` and of a `clientId` that
       * is a URL.
       */
      function appOrigins() {
        return [
          // Only a page has an origin. The `location` getter throws in Deno without `--location`.
          typeof document !== 'undefined' ? location.origin : undefined,
          config.redirectUri && origin(config.redirectUri),
          origin(config.clientId),
        ].filter((value) => value && value !== 'null')
      }

      /**
       * Returns the origin of `url`, resolved against the page, or `undefined` for a URL that does
       * not resolve, such as a relative one outside a page.
       */
      function origin(url: string | URL) {
        try {
          const base =
            typeof document !== 'undefined' ? location.href : undefined
          return new URL(url, base).origin
        } catch {
          return undefined
        }
      }

      /**
       * Returns a live access token of `session`, as `session.accessToken` returns it: a token that
       * holds for over 5 seconds serves while its refresh runs beside it, so the read waits for no
       * refresh. On a page, a failed refresh or a token that another DPoP key binds returns
       * `undefined`, so the read sends the session cookie, as `account.get` does. Elsewhere it throws.
       * Returns `undefined` when the instance holds another user's session.
       */
      async function accessToken(session: Session.Any) {
        const read = sessionTokens.get(config)
        const token = await (async () => {
          // An instance that the `relay` plugin extends without a session refreshes through the
          // context alone.
          if (!read) return refreshed(session)
          if (Api.page() === undefined) return read()
          return read().catch(() => undefined)
        })()
        if (!Session.same(context.session.get(), session)) return undefined
        return token
      }

      /**
       * Returns the access token of the instance's session for `accessKey` when the session holds
       * it, on any chain, since Tempo ID revokes an app's own access key with that token for any app.
       * Returns `undefined` for another access key, or without a session.
       */
      function ownAccessToken(
        accessKey: AccessKey.revoke.Parameters['accessKey'],
      ) {
        const session = context.session.get()
        if (!session) return undefined
        const address =
          typeof accessKey === 'string' ? accessKey : accessKey.accessKeyAddress
        // A string comparison never throws, so a malformed address reaches Tempo ID, which refuses
        // it with `invalid_field`.
        const held = [session.accessKey, ...(session.accessKeys ?? [])].some(
          (entry) =>
            entry?.keyAuthorization.keyId.toLowerCase() ===
            address.toLowerCase(),
        )
        return held ? () => accessToken(session) : undefined
      }

      /**
       * Revokes `accessKey` with `fn`, given the access token of the session that holds it, and then
       * drops the material of the session's access key that it revoked. The access key stays as
       * data, as one that another app holds, so the next transaction rejects with
       * `Accounts.AccessKeyRequiredError` before the node receives it, and the store keeps no private
       * key that signs nothing.
       */
      async function revokeOwn<value>(
        accessKey: AccessKey.revoke.Parameters['accessKey'],
        fn: (
          accessToken: (() => Promise<string | undefined>) | undefined,
        ) => Promise<value>,
      ) {
        const result = await fn(ownAccessToken(accessKey))
        const session = context.session.get()
        if (!session) return result
        const address = (
          typeof accessKey === 'string' ? accessKey : accessKey.accessKeyAddress
        ).toLowerCase()
        const strip = <entry extends Session.Any['accessKey']>(
          entry: entry,
        ) => {
          if (!entry || entry.keyAuthorization.keyId.toLowerCase() !== address)
            return entry
          const { keyPair: _keyPair, privateKey: _privateKey, ...data } = entry
          return data as entry
        }
        const accessKeys = session.accessKeys?.map(strip)
        const next = {
          ...session,
          accessKey: strip(session.accessKey),
          ...(accessKeys ? { accessKeys } : {}),
        }
        if (
          next.accessKey === session.accessKey &&
          accessKeys?.every((entry, i) => entry === session.accessKeys![i]) !==
            false
        )
          return result
        await context.session.change({ update: true }).commit(next)
        return result
      }

      /**
       * Returns a live access token of `session`, refreshed through the context when it expires
       * within 30 seconds.
       */
      async function refreshed(session: Session.Any) {
        if (Session.local(session)) return undefined
        if (session.expiresAt - 30_000 > Date.now()) return session.accessToken
        return (await Core.refresh(context, { margin: 30_000 }))?.accessToken
      }

      /**
       * Returns the account of the instance's session on `chainId`, or `undefined` while signed out.
       * `accounts` caches it for each session.
       */
      function current(chainId: number) {
        let byChain = accounts.get(chainId)
        if (!byChain) accounts.set(chainId, (byChain = new WeakMap()))
        const session = context.session.get()
        if (!session) return undefined
        if (!byChain.has(session))
          byChain.set(
            session,
            track(
              expiring(
                Signer.fromSession(config, session, {
                  accessToken: () => accessToken(session),
                  chainId,
                  signer: 'fallback',
                }),
                {
                  chainId,
                  refusal: lapse_current,
                  session,
                },
              ),
            ),
          )
        return byChain.get(session)
      }

      /**
       * Returns the account of the instance's session on `chainId` for a page whose retry renews the
       * access key: `current`'s account, whose `signTransaction` refuses an expired access key with
       * {@link AccessKeyExpiredError}, so the retry renews it before the node receives the
       * transaction. `renewing_accounts` caches it for each account of `current`, so both share the
       * access key's authorization.
       */
      function current_renewing(chainId: number) {
        const account = current(chainId)
        const session = context.session.get()
        if (!account || !session) return account
        let wrapped = renewing_accounts.get(account)
        if (!wrapped)
          renewing_accounts.set(
            account,
            (wrapped = expiring(account, {
              chainId,
              refusal: () => new AccessKeyExpiredError(),
              renews: true,
              session,
            })!),
          )
        return wrapped
      }

      /**
       * Returns the instance's error among the causes of `error`, as `lapsedCause` does. If it is a
       * refusal of `refuse`, it starts the read of the session, since the transaction has ended.
       */
      function surface(error: unknown) {
        const cause = lapsedCause(error)
        if (cause instanceof Error && lapses.has(cause)) {
          lapses.delete(cause)
          // A failed read keeps the session, as for the refusal of a signature.
          void context.session.load().catch(() => undefined)
        }
        return cause
      }

      /**
       * Returns the error of a transaction of the instance's access key that `lapsed` reports, and
       * starts a read of the session, which empties the expired session and revokes its refresh
       * token, so the status shows the sign-out.
       */
      function lapse_current() {
        const session = context.session.get()
        // The read takes the session's lock, which a caller can hold, such as a hook inside a
        // refresh. The refusal waits for no lock, and a failed read keeps the session.
        void context.session.load().catch(() => undefined)
        return lapse(session)
      }

      /**
       * Returns `account`, whose `signTransaction` rejects with `options.refusal` once the access key
       * that this app holds on `options.chainId`, in `options.session`, expired: outside a page, or,
       * with `options.renews`, on a page whose retry renews the access key. A transaction whose fields
       * are all given fills and estimates nothing, so `refuse` never sees it, and its signature comes
       * before its broadcast. The check reads the session that the account signs for, since
       * `session.get` empties an expired session while a caller can hold the account.
       */
      function expiring(
        account: LocalAccount | undefined,
        options: {
          chainId: number
          refusal: () => Error
          /** Whether a retry on the page renews the access key. Defaults to `false`. */
          renews?: boolean | undefined
          session: Pick<Session.Any, 'accessKey' | 'accessKeys'>
        },
      ) {
        const { chainId, refusal, renews = false, session } = options
        if ((page && !renews) || !account) return account
        return {
          ...account,
          async signTransaction(
            ...args: Parameters<LocalAccount['signTransaction']>
          ) {
            if (lapsed(session, { chainId })) throw refusal()
            return await account.signTransaction(...args)
          },
        } as LocalAccount
      }

      /**
       * Returns whether `token` pays network fees on the chain of `options.chainId`: a TIP-20 token
       * of the `USD` currency, read through `options.transport` in one round.
       */
      async function pays(
        token: `0x${string}`,
        options: { chainId: number; transport: Transport },
      ) {
        const { chainId, transport } = options
        const client = createClient({ chain: chainOf(chainId), transport })
        const { currency } = await Actions.token.getMetadata(client, { token })
        return currency === 'USD'
      }

      /**
       * Returns whether the chain of `options.chainId` holds `accessKey` with part of a limit spent,
       * read through `options.transport` in one round. A chain that does not hold the access key yet
       * holds no spending. Without a spent limit, the transaction needs more than a whole limit.
       * It reads only `options.limits`, the limits that count toward the refusal.
       */
      async function spent(
        accessKey: NonNullable<Session.Any['accessKey']>,
        options: {
          chainId: number
          limits: Retry.counted.ReturnType
          transport: Transport
        },
      ) {
        const { chainId, limits, transport } = options
        const { keyId } = accessKey.keyAuthorization
        const client = createClient({ chain: chainOf(chainId), transport })
        const [metadata, ...remaining] = await Promise.all([
          Actions.accessKey.getMetadata(client, {
            accessKey: keyId,
            account: accessKey.account,
          }),
          ...limits.map((entry) =>
            Actions.accessKey.getRemainingLimit(client, {
              accessKey: keyId,
              account: accessKey.account,
              token: entry.token,
            }),
          ),
        ])
        if (!Address.isEqual(metadata.address, keyId)) return false
        return limits.some(
          (entry, index) => remaining[index]!.remaining < BigInt(entry.limit),
        )
      }

      /**
       * Shows the screen that resolves `failure` of a transaction of the client of `chainId`, and
       * resolves once the transaction can send again. A deposit page opens for a balance, and a sign-in
       * for a new access key with the session's access key's limits and scopes, for an access key or
       * its limit. Outside a page, a device grant takes the place of both: for a balance, its funding
       * hint opens the deposit page after the approval, and the fix sets `options.screen.funding`,
       * which each call of the screen waits for. With `options.raise`, the limit of its token adds
       * its amount, and the sign-in
       * always shows, also for an expired access key. The new access key keeps the old one's
       * expiry while it is in the future. Otherwise it takes the instance's `accessKey` expiry.
       * Without one, it takes the old one's lifetime from now, as a renewal does, or else the
       * expiry that Tempo ID fills. A sign-in that returns another user or account sets no
       * session, and rejects.
       */
      async function fix(
        failure: Retry.Failure,
        options: {
          address: `0x${string}`
          chainId: number
          error: unknown
          /** The amount that the new access key's limit of its token adds to the old limit. */
          raise?: Retry.Spend | undefined
          /** The balance that a deposit needs, in the token's units. Absent for no deposit. */
          needs: Promise<bigint> | undefined
          /** The screen, whose `funding` the fix sets outside a page. */
          screen: Screen
          signal: AbortSignal | undefined
        },
      ) {
        const { address, chainId, error, needs, raise, screen, signal } =
          options
        // The screens load from chunks of their own, so a bundle of the client holds them only once
        // a transaction fails.
        if (failure.kind === 'balance' && page) {
          const Funding = await import('../actions/funding.js')
          const result = await Funding.open(config, {
            address,
            chainId,
            mode: 'frame',
            signal,
            ...(failure.amount === undefined
              ? {}
              : { amount: failure.amount, token: failure.token }),
          })
          if (result?.status !== 'received')
            throw new RetryClosedError({ cause: error, kind: failure.kind })
          return
        }
        // Outside a page, the device grant's funding hint opens the deposit page after the
        // approval, for a Tempo Account that holds less than the hint. The hint is the balance that
        // the transaction needs. `fix_joined` rejects a failure that names no amount and token,
        // such as one of the fee token, before the screen.
        const funding =
          failure.kind === 'balance' && failure.token && needs
            ? { amount: await needs, token: failure.token }
            : undefined
        screen.funding = funding
        const before = context.session.get()
        // The access key on the client's chain, else one on another chain, whose account and
        // permissions the new access key takes, such as after `switchChain`. A session that never
        // held an access key requests none.
        // Tempo ID holds no account of a local session, so neither its authorization nor its dialog
        // renews the access key: the app signs a new one with `local.signIn`.
        if (before && Session.local(before)) throw error
        const onChain = accessKeyOn(before, { chainId })
        const previous = onChain ?? before?.accessKey ?? before?.accessKeys?.[0]
        if (!before || !previous) throw error
        // A sign-in that named a resource in its own call holds tokens for that resource and its API
        // scopes, so the new sign-in names them again, and the resource's API accepts its tokens.
        const grant = Api.grant(config, before.accessToken)
        // An account that holds a live access key on the chain but signs nothing with it, such as
        // another app's access key by its public key, needs no new access key. An expired one renews.
        if (
          failure.kind === 'accessKey' &&
          failure.unsigned &&
          onChain &&
          !AccessKey_internal.expired(onChain)
        )
          throw error
        // The retry sends from the live account, so it sends only from the account that failed: the
        // account of the access key on the chain, or the account that a switch read there. An
        // account's address can differ by chain, so an access key on another chain names none. It is
        // read before the dialog, so a switch during the dialog changes nothing.
        const expected =
          onChain?.account ??
          (chainId === context.chain.get()
            ? before.account?.address
            : undefined)
        const authorization = KeyAuthorization.fromRpc(
          previous.keyAuthorization,
        )
        // The instance's `accessKey` resolves once for the sign-in, so its expiry and its limits come
        // from one result.
        const resolved = context.accessKey()
        // An access key that an earlier release signed with an expiry in milliseconds keeps neither its
        // expiry nor its lifetime, which a sign-in refuses, so the new access key takes the instance's
        // expiry, or the one that Tempo ID fills.
        const milliseconds =
          !!authorization.expiry &&
          authorization.expiry >= Request_internal.millisecondExpiry
        // `kept`: the earliest granted expiry, in Unix seconds, at which the new access key keeps the
        // old one's lifetime. An earlier expiry means that Tempo ID shortened the request.
        const { expiry, kept } = (() => {
          if (
            authorization.expiry &&
            !milliseconds &&
            authorization.expiry * 1000 > Date.now()
          )
            return { expiry: authorization.expiry, kept: authorization.expiry }
          if (resolved) return { expiry: resolved.expiry, kept: undefined }
          if (milliseconds) return { expiry: undefined, kept: undefined }
          // An instance without `accessKey` renews an expired access key that the sign-in named for
          // the same lifetime, as `authorize` does, so the new access key lives no longer than the first.
          // A duration counts from the request, which a popup's Continue prompt can delay, so the
          // request starts no earlier than now.
          if (previous.lifetime && previous.lifetime > 0)
            return {
              expiry: `${previous.lifetime}s` as Permissions.Duration,
              kept: Math.floor(Date.now() / 1000) + previous.lifetime,
            }
          return { expiry: undefined, kept: undefined }
        })()
        // On a chain without an access key, the instance's `accessKey` names the tokens by symbol,
        // which resolve on that chain. Without one, the other chain's limits and scopes apply.
        const configured = onChain ? undefined : resolved
        // An authorization without scopes makes any call.
        const accessKey = configured
          ? Permissions.from({ ...configured, chainId })
          : Permissions.from({
              chainId,
              ...(expiry === undefined ? {} : { expiry }),
              // The old limit stays on top of the spend, since the fees of the access key spend
              // its limit of the fee token too.
              limits: authorization.limits?.map((entry) => ({
                limit:
                  raise && Address.isEqual(entry.token, raise.token)
                    ? entry.limit + raise.amount
                    : entry.limit,
                period: entry.period || undefined,
                token: entry.token,
              })),
              scopes: authorization.scopes ?? 'any',
            })
        // An expired access key renews through the browser's Tempo ID session with no screen, as a
        // restore at a mount does. A third-party app, a passkey that must sign, another user's
        // session, or no Tempo ID session falls back to the sign-in on Tempo ID's page. The headless
        // request names no `resource`, so an instance or a session with one renews on that page too.
        // The renewal is a restore, so a sign-in or a sign-out that completes first overtakes it. A
        // raised limit never renews with no screen, since only the user approves a higher limit. Only
        // a page holds the browser's Tempo ID session.
        const renewal =
          page &&
          !raise &&
          onChain &&
          AccessKey_internal.expired(onChain) &&
          config.resource === undefined &&
          grant.resource === undefined
            ? context.session.change({ restore: true })
            : undefined
        const request = renewal
          ? Actions_accounts.authorize(config, {
              accessKey,
              account: onChain?.account,
              // The session's user most likely still holds the browser's Tempo ID session, so the
              // renewal sends the authorization alone.
              check: false,
              // The renewed account's passkey signs through the instance's ceremony, as a restore's does.
              getFn: config.getFn,
            }).catch(() => undefined)
          : undefined
        /**
         * Ends a renewal that the retry does not keep. After a change that overtook it, the renewal's own
         * change ends it, as a restore's does: a sign-out revokes its refresh token, and a logout
         * that Tempo ID did not refuse, which can have revoked it already, sends no revocation, since
         * one would count as a reuse. After a newer sign-in, that change ends nothing, so the retry
         * revokes the token itself.
         */
        const end = async (result: NonNullable<Awaited<typeof request>>) => {
          const session = SignIn.toSession(result)
          if (renewal?.overtaken()) {
            await renewal.commit(session).catch(() => undefined)
            if (!context.session.get()) return
          }
          context.session.discard(session)
        }
        // A canceled retry stops waiting for the renewal, so it frees the chain's fix at once, and a
        // later transaction starts its own. The renewal that arrives after it ends.
        const renewed = await Retry.abortable(Promise.resolve(request), {
          signal,
        }).catch((reason: unknown) => {
          void request?.then((result) => (result ? end(result) : undefined))
          throw reason
        })
        // A sign-out that runs as the renewal arrives would end the session after its commit, whose new
        // change clears the signed-out mark. The decision waits for it, so the renewal yields to it.
        if (renewal) await context.session.ended()
        // Only the expired access key's user and account keep the renewal, so any other renewal ends.
        const headless =
          renewed?.accessKey &&
          renewed.user.id === Session.subject(before) &&
          onChain &&
          Address.isEqual(renewed.accessKey.account, onChain.account)
            ? renewed
            : undefined
        // Another retry's commit on another chain leaves this chain's access key, so only a change that
        // replaced it, such as a sign-in or a sign-out, supersedes the renewal.
        const current = accessKeyOn(context.session.get(), { chainId })
        const { action, revoke } = Retry.renewal({
          aborted: signal?.aborted ?? false,
          issued: renewed?.refreshToken !== undefined,
          kept: headless !== undefined,
          overtaken: renewal?.overtaken() ?? false,
          replaced:
            !current ||
            !onChain ||
            !Address.isEqual(
              current.keyAuthorization.keyId,
              onChain.keyAuthorization.keyId,
            ),
        })
        // The revocation runs beside the fallback or the rejection, which read nothing from it, so the
        // sign-in waits for no round trip. One without an answer is sent again at the next sign-out.
        if (revoke && renewed)
          context.session.discard(SignIn.toSession(renewed))
        if (action === 'abort') throw signal?.reason
        if (action === 'supersede') {
          if (renewed) await end(renewed)
          else await renewal?.check().catch(() => undefined)
          throw new SupersededError()
        }
        // The commit follows with no wait, so no change overtakes it, and it replaces the expired
        // session as a sign-in does, which revokes its refresh token.
        const change = context.session.change()
        const result =
          (action === 'commit' ? headless : undefined) ??
          (await (async () => {
            // Only an instance with the `device` plugin retries outside a page, and its `onCode`
            // shows the code.
            if (!page) {
              const authorization = await deviceRequests.get(config)!({
                // The new tokens keep the API audiences and the API scopes of the replaced session's
                // tokens.
                ...grant,
                accessKey,
                funding: funding && {
                  amount: formatUnits(funding.amount, 6),
                  token: funding.token,
                },
                signal,
              }).catch((reason: unknown) => {
                // Only the user's denial closes the retry. A refusal of Tempo ID with a `reason`
                // keeps its error.
                if (
                  reason instanceof RequestError &&
                  reason.code === 'access_denied' &&
                  reason.reason === undefined
                )
                  return change.fail(
                    new RetryClosedError({
                      cause: error,
                      kind: failure.kind,
                    }),
                  )
                // A plugin without `onCode` cannot show the code, so the transaction rejects as it
                // would without a retry.
                if (
                  reason instanceof Error &&
                  reason.name === 'Plugins.device.OnCodeRequiredError'
                )
                  return change.fail(error)
                return change.fail(reason)
              })
              // The wait lets a poll in flight finish after every call left the retry. Its approval
              // then ends, and the session keeps its access key.
              if (signal?.aborted) {
                context.session.discard(SignIn.toSession(authorization))
                return change.fail(Retry.aborted(signal))
              }
              return authorization
            }
            const Dialog = await import('../actions/dialog.js')
            return await Dialog.signIn(config, {
              accessKey,
              mode: 'iframe',
              ...(grant.resource ? { resource: grant.resource } : {}),
              // The dialog's `scope` replaces the instance's, so it names both, as the device grant
              // adds the instance's.
              ...(grant.scope
                ? {
                    scope: [
                      ...new Set([
                        ...config.scope.split(' '),
                        ...grant.scope.split(' '),
                      ]),
                    ].join(' '),
                  }
                : {}),
              signal,
            }).catch((reason: unknown) => {
              if (
                !signal?.aborted &&
                reason instanceof DOMException &&
                reason.name === 'AbortError'
              )
                return change.fail(
                  new RetryClosedError({
                    cause: error,
                    kind: failure.kind,
                  }),
                )
              return change.fail(reason)
            })
          })())
        const session = SignIn.toSession(result)
        if (
          Session.subject(session) !== Session.subject(before) ||
          !session.accessKey ||
          (expected && !Address.isEqual(session.accessKey.account, expected))
        ) {
          // The instance keeps no session of the sign-in, so its refresh token ends.
          context.session.discard(session)
          return change.fail(
            new RetryAccountError({ cause: error, kind: failure.kind }),
          )
        }
        // A new access key that Tempo ID granted in full keeps the old one's lifetime, which a later
        // renewal requests. The time left until its expiry is shorter by the sign-in's latency, which
        // repeated retries would add up.
        const granted = KeyAuthorization.fromRpc(
          session.accessKey.keyAuthorization,
        )
        // The user's access keys on other chains stay, since this sign-in only adds an access key
        // on this chain. A switch during the sign-in leaves the session on another chain, so the
        // commit moves the new access key to `accessKeys`. They come from the latest session of the
        // same user, so a retry on another chain that committed during this one stays.
        const latest = context.session.get()
        const held = Session.same(latest, before) ? latest : before
        const others = [held.accessKey, ...(held.accessKeys ?? [])].filter(
          (entry): entry is NonNullable<typeof entry> =>
            !!entry && Number(entry.chainId) !== chainId,
        )
        const next =
          kept !== undefined && granted.expiry && granted.expiry >= kept
            ? {
                ...session,
                accessKey: {
                  ...session.accessKey,
                  lifetime: previous.lifetime,
                },
              }
            : session
        // The session follows the instance's chain, so an access key on another chain, such as a
        // named chain's client, or after a switch during the sign-in, waits in `accessKeys`.
        const moved = InternalSession.toChain(
          others.length ? { ...next, accessKeys: others } : next,
          { chainId: context.chain.get() },
        )
        // An access key on another chain than the instance's leaves the account that the instance
        // read on its own chain in place.
        await change.commit(
          moved.accessKey ||
            moved === next ||
            !Session.same(latest, moved) ||
            !latest.account ||
            latest.accessKey
            ? moved
            : { ...moved, account: latest.account },
        )
      }

      /**
       * Waits on `actor` until it settles, and resolves once it resolved. The screen serves each call
       * that waits on it, so one call's abort closes it only once no other call waits. A call without
       * a signal never leaves. Rejects with the screen's error, or with the signal's reason.
       */
      async function join(
        actor: machines.screen.Actor,
        options: { signal: AbortSignal | undefined },
      ) {
        const { signal } = options
        const leave = () => actor.send({ type: 'call.leave' })
        actor.send({ type: 'call.join' })
        signal?.addEventListener('abort', leave, { once: true })
        try {
          const snapshot = await waitFor(actor, machines.settled)
          // Each call left a screen that closed for none, this one too.
          if (signal?.aborted) throw Retry.aborted(signal)
          if (!machines.resolved(snapshot)) throw snapshot.context.error
        } finally {
          signal?.removeEventListener('abort', leave)
        }
      }

      /**
       * Resolves once `options.address` holds `funding` on the chain of `options.chainId`, read every
       * {@link depositInterval}. The poll of a device grant returns at the approval, before any
       * deposit. A read that fails, such as for a rate limit, counts as no deposit yet. Rejects with
       * `RetryClosedError` after {@link depositLimit}, and with the reason of `options.signal` at
       * its abort.
       */
      async function deposited(
        funding: NonNullable<Screen['funding']>,
        options: {
          address: `0x${string}`
          chainId: number
          /** The error of the failure, which the rejection names as its cause. */
          error: unknown
          /** Ends the loop, and clears its timer. */
          signal: AbortSignal
          transport: Transport
        },
      ) {
        const { address, chainId, error, signal, transport } = options
        const client = createClient({ chain: chainOf(chainId), transport })
        const deadline = Date.now() + depositLimit
        const funded = async () => {
          const balance = await Actions.token
            .getBalance(client, {
              account: address,
              decimals: 6,
              token: funding.token,
            })
            .catch(() => undefined)
          return balance !== undefined && balance.amount >= funding.amount
        }
        while (!(await funded())) {
          if (Date.now() >= deadline)
            throw new RetryClosedError({ cause: error, kind: 'balance' })
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer)
              reject(Retry.aborted(signal))
            }
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', abort)
              resolve()
            }, depositInterval)
            if (signal.aborted) abort()
            else signal.addEventListener('abort', abort, { once: true })
          })
        }
      }

      /**
       * Resolves `failure` of a transaction or a payment that the session's access key sent on the
       * chain of `options.chainId`, and resolves once it can send again. Concurrent failures that one
       * screen resolves share it: a deposit of one token to one account on one chain, or one sign-in
       * on one chain.
       * A spent limit requests a higher limit for a send above the whole limit that Viem's error
       * names. It rejects with `options.error`, without a screen, for a call above the whole limit
       * without that error, and for a refusal without an amount when the access key spent none of
       * its limits. It resolves without a screen once an earlier sign-in replaced the access key.
       * Outside a page, a deposit shares the sign-in, then waits for its own balance. It rejects with
       * `options.error` for a balance without an amount and token, and with `RetryAccountError` once
       * the session holds another user or account.
       */
      async function fix_joined(
        failure: Retry.Failure,
        options: {
          /** The Tempo Account that a deposit funds. */
          address: `0x${string}`
          chainId: number
          /** The error of the failure, which a rejection throws or names as its cause. */
          error: unknown
          /** The call's first argument, such as a transfer's `amount` and `token`. Absent for a payment. */
          parameters: unknown
          /**
           * The read of whether the token of the named spend pays fees, from an earlier pass of the
           * same failure. Absent before a read.
           */
          paying?: Promise<boolean> | undefined
          /** Whether the relay's fee payer pays the fees of the call's transactions. */
          relayed: boolean
          signal: AbortSignal | undefined
          /** The session that the call started with. */
          state: Session.Any | undefined
          /** Reads the spending of the access key on the chain. */
          transport: Transport
        },
      ) {
        const { address, chainId, error, parameters, signal, transport } =
          options
        // A new access key with the same limits sends no more than a whole limit, so a call above
        // a whole limit requests a higher limit of its token, if Viem's error names the spend. A
        // call above a whole limit without that error, or a refusal without an amount when the
        // access key spent none of its limits, rejects with its own error, before it joins a
        // sign-in that another call started. A call that names its amount and limited token
        // decides without a read. The check reads the access key that the call started with,
        // which failed.
        const before = options.state
        const current = accessKeyOn(before, { chainId })
        const named = Retry.refused(error, { parameters })
        // Only Viem's error tells a refusal of the fee payment from one of the spend, so a spend
        // that only the transaction request names raises a limit only above its whole limit.
        const requested =
          named !== undefined && Retry.refused(error) === undefined
        // The amount that the new access key's limit of its token adds to the old limit.
        let raise: Retry.Spend | undefined
        // Whether `limits` hold a named spend within a fee allowance of its whole limit, which the
        // fee takes. The limit of a token that pays the transaction's fee pays the fee too. The
        // relay's fee payer pays each fee of a chain with a relay route. Only that band reads the
        // token.
        let paying = options.paying
        const band = async (limits: Parameters<typeof Retry.within>[0]) =>
          !!named &&
          !options.relayed &&
          !Retry.within(limits, { fees: Retry.fees, parameters: named }) &&
          (await (paying ??= pays(named.token, { chainId, transport }).catch(
            () => false,
          )))
        // Returns the session, once it holds the user and account that failed. The retry sends only
        // from the account that failed, and the session can change to another user or account
        // during the read of `band`.
        const same = () => {
          const after = context.session.get()
          const next = accessKeyOn(after, { chainId })
          if (
            !before ||
            !current ||
            !next ||
            !Session.same(after, before) ||
            !Address.isEqual(next.account, current.account)
          )
            throw new RetryAccountError({ cause: error, kind: failure.kind })
          return after
        }
        // Whether the session's access key, such as one that another call's sign-in granted,
        // sends the named spend of a refused limit, with the fee that the band holds.
        const fits = async () => {
          const next = accessKeyOn(context.session.get(), { chainId })
          if (failure.kind !== 'limit' || !named || !next) return true
          const limits = next.keyAuthorization.limits
          if (Retry.within(limits, { parameters: named }) === false)
            return false
          const fee = await band(limits)
          same()
          return !fee
        }
        // Signs in again from the access key that another call's sign-in granted, whose limit the
        // call's spend is above.
        const again = (): Promise<void> =>
          fix_joined(failure, { ...options, paying, state: same() })
        if (failure.kind === 'limit' && before && current) {
          // A sign-in that ended since the call started replaced the access key, which the retry
          // sends with, so a second sign-in would replace it again. The retry sends only from the
          // account that failed. A refresh in another tab saves a copy of the same access key,
          // which is no replacement.
          const replaced = () => {
            const after = context.session.get()
            const next = accessKeyOn(after, { chainId })
            if (
              next &&
              Address.isEqual(
                next.keyAuthorization.keyId,
                current.keyAuthorization.keyId,
              )
            )
              return false
            if (
              !Session.same(after, before) ||
              !next ||
              !Address.isEqual(next.account, current.account)
            )
              throw new RetryAccountError({
                cause: error,
                kind: failure.kind,
              })
            return true
          }
          if (replaced()) return (await fits()) ? undefined : await again()
          // The call's own `amount` counts only without Viem's error, since a fee refusal, or the
          // amount of a mint or a DEX call, is not the limited spend. A refusal that names no spend,
          // with Viem's error or without it, can be one of the fee payment, which a new access key
          // resolves.
          const limits = current.keyAuthorization.limits
          const within = Retry.within(limits, {
            parameters: named === undefined ? parameters : named,
          })
          // A named spend within the whole limit, whose fee the limit pays too, needs a higher limit.
          const fee = within === true && !requested && (await band(limits))
          // Only a spend that Viem's error or a transaction request's transfer names raises a limit,
          // since the call's own `amount` can be that of a mint or a DEX call, which spends none of
          // the limit. A spend within the
          // whole limit raises it by the fee allowance alone, since a sponsor or another token can
          // pay the fee.
          if (named && within === false) raise = named
          else if (named && fee)
            raise = { amount: Retry.fees, token: named.token }
          else if (
            within === false ||
            ((within === undefined || requested) &&
              !(
                failure.spent &&
                Address.isEqual(failure.spent, current.keyAuthorization.keyId)
              ) &&
              !(await spent(current, {
                chainId,
                limits: Retry.counted(current.keyAuthorization, {
                  refused: requested ? undefined : named,
                }),
                transport,
              }).catch(() => true)))
          )
            throw error
          if (replaced()) return (await fits()) ? undefined : await again()
        }
        // Outside a page, a deposit signs in, so it sends only from the user and account that
        // failed, as a limit does. Its funding hint is the balance that the transaction needs, so a
        // failure that names no amount and token, such as one of the fee token, rejects before it
        // joins a sign-in.
        if (failure.kind === 'balance' && !page) {
          if (failure.amount === undefined || !failure.token) throw error
          same()
        }
        /** Resolves with the balance of `token` that the deposit's account holds. */
        const read = async (token: `0x${string}`) => {
          const balance = await Actions.token.getBalance(
            createClient({ chain: chainOf(chainId), transport }),
            // TIP-20 tokens hold 6 decimals, so the read sends no `decimals` call.
            { account: address, decimals: 6, token },
          )
          return balance.amount
        }
        // The balance that a deposit needs: the balance at the refusal plus the amount that it
        // lacks, and at least the `required` balance of the refusal. The node names `required`
        // against the balance within the transaction, which earlier calls of a batch spend, and a
        // send between the refusal and the read changes the balance. The read runs beside the
        // screen, so it adds no round trip to a deposit page.
        const needs =
          failure.kind === 'balance' &&
          failure.amount !== undefined &&
          failure.token
            ? read(failure.token).then((balance) => {
                const total = balance + parseUnits(failure.amount!, 6)
                const required =
                  failure.required === undefined
                    ? 0n
                    : parseUnits(failure.required, 6)
                return total > required ? total : required
              })
            : undefined
        needs?.catch(() => undefined)
        // A new access key resolves a spent limit and a missing access key at once, and a second
        // sign-in would end the first. A deposit funds one Tempo Account, so a payment of another
        // account, such as a payer's named `account`, shows a deposit page of its own. Outside a
        // page, a deposit starts a device grant for a new access key too, so it shares the sign-in.
        const key =
          failure.kind === 'balance' && page
            ? `balance:${chainId}:${address.toLowerCase()}:${failure.token ?? ''}`
            : `signIn:${chainId}`
        if (signal?.aborted) throw Retry.aborted(signal)
        // A screen that each of its calls left closes, so a later call opens a screen of its own.
        const joined = fixes.get(key)
        const shared = joined && !machines.settled(joined.getSnapshot())
        const screen: Screen = { address, failure }
        const actor = shared
          ? joined
          : createActor(
              machines.screen.provide({
                actors: {
                  show: fromPromise((args) =>
                    fix(failure, {
                      address,
                      chainId,
                      error,
                      needs,
                      raise,
                      screen,
                      signal: args.signal,
                    }),
                  ),
                },
              }),
            ).start()
        fixes.set(key, actor)
        if (!shared) resolving.set(actor, screen)
        try {
          await join(actor, { signal })
        } finally {
          if (fixes.get(key) === actor) fixes.delete(key)
        }
        // A sign-in that another call started requests that call's limits, which can be below
        // this call's spend.
        if (shared && !(await fits())) await again()
        if (failure.kind !== 'balance') return
        const resolved = resolving.get(actor)!
        // Outside a page, the screen settles at the approval of its grant, so a limit that shares
        // the grant does not wait. Each balance of the deposit's token and account waits for one
        // read loop of the screen, with its own signal. The session can change to another user or
        // account during the wait.
        if (
          resolved.funding &&
          failure.token &&
          Address.isEqual(resolved.funding.token, failure.token) &&
          Address.isEqual(resolved.address, address)
        ) {
          const funding = resolved.funding
          // A call that arrives after every earlier call left, or after the wait ended without the
          // deposit, starts the wait again.
          const current = resolved.deposit?.getSnapshot()
          const deposit =
            current &&
            (!machines.settled(current) || machines.resolved(current))
              ? resolved.deposit!
              : createActor(
                  machines.screen.provide({
                    actors: {
                      show: fromPromise((args) =>
                        deposited(funding, {
                          address,
                          chainId,
                          error,
                          signal: args.signal,
                          transport,
                        }),
                      ),
                    },
                  }),
                ).start()
          resolved.deposit = deposit
          await join(deposit, { signal })
          same()
        }
        // The deposit of its own screen funds the call.
        if (resolved === screen) return
        // A balance can join a screen whose deposit funds another amount, or, outside a page, the
        // grant of another failure, which funds another token or account, or none. A deposit can
        // hold more than its screen asked for, and the screen's own call can spend it first, so
        // the call reads the balance, and resends once it holds the balance that it needs.
        // Otherwise it starts a screen of its own for the amount that it still lacks. A failed
        // read resends, as a call without a read of its need does.
        const lacking = await (async () => {
          const need = await needs?.catch(() => undefined)
          if (need === undefined || !failure.token) return undefined
          const balance = await read(failure.token).catch(() => undefined)
          return balance === undefined ? undefined : need - balance
        })()
        if (lacking === undefined || lacking <= 0n) {
          if (!page) same()
          return
        }
        // A deposit page signs in for no access key, so the call's session, such as none for a
        // payer's named `account`, stays.
        return await fix_joined(
          { ...failure, amount: formatUnits(lacking, 6) },
          { ...options, state: page ? options.state : same() },
        )
      }

      /**
       * Returns the kinds of failure that retry: the plugin's `retry`, with the call's `retry` over
       * it, or `false` for none. Outside a page, only the device grant of an instance with the
       * `device` plugin resolves a failure, and only a balance or a spent limit.
       */
      function kinds(
        plugin: viem.RetryOptions,
        call: viem.RetryOptions | undefined,
      ) {
        const merged = merge(plugin, call)
        if (merged === false || (!page && !deviceRequests.has(config)))
          return false
        const value = merged === true ? {} : merged
        return page ? value : { ...value, accessKey: false }
      }

      /** Returns a new client with `overrides`. */
      function create(overrides: viem.Overrides = {}): viem.Client {
        const {
          chainId = config.chainId,
          retry: retryOverride,
          session: fixed,
          transport,
          ...clientOptions
        } = overrides
        // A connection lists every access key that the API holds in `accessKeys`, its `accessKey`
        // too, while a session lists there its access keys of other chains. So only the `accessKey`
        // of a connection signs.
        const session =
          fixed && 'resource' in fixed ? { accessKey: fixed.accessKey } : fixed
        const chain = chainOf(chainId)
        if (!chain)
          throw new Error(
            `Invalid chain: ${chainId} is not a Tempo chain, and its options name no \`chain\`. Return its definition as \`chain\`.`,
          )
        const {
          accessTokens: _accessTokens,
          chain: _chain,
          relay: _relay,
          retry: retryDefault = true,
          transport: _transport,
          ...defaults
        } = resolve(chainId)
        // Only a page or the `device` plugin shows the screens, and only for the session's account,
        // since a fixed session signs on a backend.
        const retries = session ? false : kinds(retryDefault, retryOverride)
        // On a page, a retry of `accessKey` renews an expired access key, so neither the transport nor
        // the account lets a transaction of that access key reach the node.
        const renews = Boolean(page && retries && retries.accessKey !== false)
        const reads = (() => {
          // A fixed session's client sends no token of the instance's session to the relay route.
          const value = watch(
            transport ?? own.transport(chainId, { token: !session }),
            chainId,
          )
          // The clock shows an expired access key, so its transaction never reaches the node, which
          // would refuse it. Outside a page, no retry renews it, so its transaction is refused. On a
          // page, a retry of `accessKey` renews it. Without that retry, a page's transport sends it.
          // Every transport marks each refusal, so `pay` tells a refusal that the payment page takes,
          // or that throws `PageRequiredError` outside a page, from a failure that the node may have
          // taken.
          const sent = (() => {
            if (!page) return refuse(value, { chainId, session })
            if (renews) return refuse(value, { chainId, renews: true })
            return value
          })()
          return retry.transport(sent)
        })()
        const account = (() => {
          if (!session)
            return Signer.live(
              () => {
                if (renews) return current_renewing(chainId)
                const account = current(chainId)
                if (!account || page) return account
                if (context.session.status.get().status !== 'signedOut')
                  return account
                // Outside a page, no retry renews a held session that expired, so its account reads
                // as signed out, as the status does. Viem reads the account before it wraps an
                // action's errors, so a standalone action rejects with `Accounts.SignedOutError`.
                // The read of the session empties it, as the refusal of a transaction does.
                void context.session.load().catch(() => undefined)
                return undefined
              },
              {
                // A renewal of an expired session holds no session, and `session.get` returns
                // its result, as it does in `pending`.
                pending: () => {
                  const { status } = context.session.status.get()
                  return status === 'pending' || status === 'reauthorizing'
                },
              },
            )

          // A fixed session signs on a backend, which holds no Tempo ID session for its owner.
          // A backend holds no instance session, so the client starts the read of the mark. Its first
          // transaction waits for the read, up to `markReadLimit`, then attaches the authorization
          // only if the mark is absent.
          hydrate(session)
          const fixed = track(
            expiring(
              Signer.fromSession(config, session, {
                chainId,
                signer: 'accessKey',
              }),
              { chainId, refusal: () => lapse_fixed(session), session },
            ),
          )
          if (!fixed) throw new AccessKeyRequiredError()
          return fixed
        })()
        const client = build(
          {
            ...defaults,
            ...clientOptions,
            account,
            chain: coordinate(chain, { account, shared: Boolean(session) }),
            transport: reads,
          },
          { verifier: tokens },
        )
        const payer = () => Token.payer(context, { chainId })
        // Only a page shows the payment page, and only for the session's account. A call that names
        // an `account` signs with it.
        const remote = (parameters: Token.transfer.Parameters) =>
          !parameters.account &&
          Token.ownerSends(context.session.get(), { chainId })
        const extended = client.extend((client) => ({
          ...(page && !session
            ? {
                token: {
                  // Each action keeps Viem's helpers, such as `transfer.estimateGas`.
                  transfer: Object.assign(
                    (parameters: Token.transfer.Parameters) =>
                      remote(parameters)
                        ? Token.transfer(client as never, {
                            account: payer,
                            config,
                            parameters,
                          })
                        : client.token.transfer(parameters as never),
                    client.token.transfer,
                  ),
                  transferSync: Object.assign(
                    (parameters: Token.transfer.Parameters) =>
                      remote(parameters)
                        ? Token.transferSync(client as never, {
                            account: payer,
                            config,
                            parameters,
                          })
                        : client.token.transferSync(parameters as never),
                    client.token.transferSync,
                  ),
                },
              }
            : {}),
          /**
           * Viem's `accessKey` actions that change an access key, through Tempo ID with the
           * account's owner. Each returns what Viem's own action returns. They need the app's
           * `tempo-id:sign` scope, and an access key that Tempo ID signed for the user. Only
           * `revoke` and `revokeSync` of an access key that the instance's session holds, the
           * app's own, need no scope: they send the session's access token to
           * `POST /v1/access-keys/revoke`, for any app. On a page without a live access token,
           * such as after a failed refresh, they send the session cookie, as for any other access
           * key. Once Tempo ID revokes the session's own access key, the session keeps it without
           * its private key, so the store holds no material that signs nothing. As for an access
           * key of another app, the next transaction rejects with
           * `Accounts.AccessKeyRequiredError`, and on a page a `token.transfer` opens Tempo ID's
           * payment page. An access key that the chain has not
           * registered registers with the new limit. With an `account` in the parameters, such as
           * the account's root key, each is Viem's own action.
           *
           * @throws {Accounts.RevokedError} For `revoke` and `revokeSync` without `account`, when
           *   the chain holds the access key revoked already.
           * @throws {Accounts.RequestError} When Tempo ID refuses the change, with one of these
           *   `reason` values, which
           *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
           *   - `sign_not_permitted`: The page is not the page of a first-party app with the
           *     `tempo-id:sign` scope, or `clientId` names another app. For `revoke` and
           *     `revokeSync` of the session's own access key, only without a live access token.
           *   - `invalid_token`: For `revoke` and `revokeSync` of the session's own access key,
           *     the access token is expired or revoked.
           *   - `invalid_dpop_proof`: For `revoke` and `revokeSync` of the session's own access
           *     key, with a DPoP access token, the proof is missing, invalid, or replayed.
           *   - `session_required`: The user is not signed in to Tempo ID.
           *   - `unknown_key`: The user holds no live access key at the address on the account and
           *     chain, or, for the session's own access key, none that Tempo ID signed for the app.
           *   - `foreign_account`: The account is not the user's in the realms of the app that
           *     `clientId` names.
           *   - `webauthn_required`: No cloud wallet of the user owns the account on the chain. The
           *     account's passkey changes the access key, on Tempo ID's approval page or its
           *     permissions page.
           *   - `invalid_field`: An address or the chain ID is malformed. For `updateLimit` and
           *     `updateLimitSync`, also a revoked access key, with `field: "address"`, or a token
           *     that the access key has no limit of, with `field` on that token.
           *   - An [access key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules),
           *     for `updateLimit` and `updateLimitSync`, such as `invalid_recipients`, with `field`
           *     on the scope, such as `scopes.0.recipients`.
           *   - `access_key_changing`: For `updateLimit` and `updateLimitSync`, another request
           *     changes the same limit of the access key. Retry after that request ends.
           *   - `insufficient_balance`: The account cannot pay the network fee of the transaction,
           *     and no sponsor pays it. A deposit to the account resolves it.
           *   - `rate_limited`: The user exceeded the limit of account requests. Retry after
           *     `Retry-After` seconds.
           *   - `upstream_unavailable`: The chain or the cloud wallet's provider failed. Retry
           *     later.
           *   - `unexpected`: An unexpected failure. Retry the request.
           *
           * @example
           * ```ts
           * import { Accounts } from 'accounts'
           * import { email, viem } from 'accounts/plugins'
           * import { Addresses } from 'viem/tempo'
           *
           * const accounts = Accounts.create({ plugins: [email(), viem()] })
           *
           * await accounts.accessKey.updateLimitSync({
           *   accessKey,
           *   limit: 5_000_000n,
           *   token: Addresses.ousd,
           * })
           * const { receipt } = await accounts.accessKey.revokeSync({ accessKey })
           * ```
           */
          accessKey: {
            // A fixed session's access key is no access key of the instance's session.
            revoke: (parameters: AccessKey.revoke.Parameters) =>
              session
                ? AccessKey.revoke(client as never, { config, parameters })
                : revokeOwn(parameters.accessKey, (accessToken) =>
                    AccessKey.revoke(client as never, {
                      accessToken,
                      config,
                      parameters,
                    }),
                  ),
            revokeSync: (parameters: AccessKey.revoke.Parameters) =>
              session
                ? AccessKey.revokeSync(client as never, { config, parameters })
                : revokeOwn(parameters.accessKey, (accessToken) =>
                    AccessKey.revokeSync(client as never, {
                      accessToken,
                      config,
                      parameters,
                    }),
                  ),
            updateLimit: (parameters: AccessKey.updateLimit.Parameters) =>
              AccessKey.updateLimit(client as never, {
                config,
                parameters,
              }),
            updateLimitSync: (parameters: AccessKey.updateLimit.Parameters) =>
              AccessKey.updateLimitSync(client as never, {
                config,
                parameters,
              }),
          },
        })) as viem.Client
        // Outside a page, Viem wraps the refusal of `refuse` or `expiring` in its own error, so each
        // transaction rejects with the instance's error among its causes, which the wrap surfaces.
        if (!retries && !page)
          return retry.wrap(extended, {
            enabled: () => false,
            fix: () => Promise.resolve(),
            signal: undefined,
            skip: internal,
            snapshot: () => undefined,
            surface,
            transport: undefined,
          })
        if (!retries) return extended
        return retry.wrap(extended, {
          enabled: (kind) => retries[kind] !== false,
          fix: (failure, error, parameters, state) =>
            fix_joined(failure, {
              address: extended.account.address,
              chainId,
              error,
              parameters,
              // A client's own `transport` sends past the relay route.
              relayed: !transport && !!routing(chainId).relay,
              signal: retries.signal,
              state: state as Session.Any | undefined,
              transport: reads,
            }),
          signal: retries.signal,
          skip: internal,
          snapshot: () => context.session.get(),
          surface: page ? undefined : surface,
          // The client sends through `reads`, so each retry reads the transactions of this client.
          transport: reads,
        })
      }

      /** Returns the client with `overrides`, from the cache when they name at most a chain. */
      function get(overrides: viem.Overrides = {}) {
        if (Object.keys(overrides).some((key) => key !== 'chainId'))
          return create(overrides)
        const chainId = overrides.chainId ?? config.chainId
        let client = clients.get(chainId)
        if (!client) clients.set(chainId, (client = create({ chainId })))
        return client
      }

      // The clients that send a payment of `pay` with the session's access key, one for each chain.
      // On a page, a low balance shows the deposit page, and the access key sends again. The payment
      // page takes each other refusal, so no other screen of a retry shows.
      const payers = new Map<number, viem.Client>()
      const payerRetry = page ? { accessKey: false, limit: false } : false

      /**
       * Sends `transfer`, the transfer of `payment` that `Token.payable` returned, with the access
       * key of the payment's fixed session, else of the instance's session, and returns the
       * transaction's hash. On a page, a low balance of the instance's session opens the deposit
       * page, unless the plugin's `retry` turns off `balance`, and the access key sends again once
       * the deposit arrives. A close of the deposit page rejects with {@link RetryClosedError}. On
       * a page, a refusal of the node that the payment page resolves returns `undefined`: a low
       * balance after the retry, a spent limit, an access key that the chain does not hold, or a
       * call outside the access key's scopes. Outside a page, such a refusal rejects with
       * `Actions.account.PageRequiredError`, whose cause is the refusal, except a low balance, which
       * rejects as it is, and a revoked access key, which rejects with
       * `Accounts.AccessKeyRequiredError`, whose cause is the refusal. A transfer that the chain reverts since its fee spent the rest of the
       * limit counts as a spent limit, once one read of the limit confirms it.
       * Any other failure rejects, since the node may have taken the transaction.
       */
      async function send(
        payment: Payment,
        transfer: Token.payable.ReturnType,
      ) {
        const { chainId, memo, session, signal, to } = payment
        signal?.throwIfAborted()
        // A fixed session's client signs for one request, and a signal ends the deposit page of one
        // payment, so no cache keeps either client.
        const client = (() => {
          if (session) return create({ chainId, session })
          if (signal && payerRetry)
            return create({ chainId, retry: { ...payerRetry, signal } })
          let cached = payers.get(chainId)
          if (!cached)
            payers.set(
              chainId,
              (cached = create({ chainId, retry: payerRetry })),
            )
          return cached
        })()

        try {
          const { receipt } = await Actions.token.transferSync(client, {
            ...transfer,
            ...(memo ? { memo } : {}),
            to,
          })
          return { transaction: receipt.transactionHash }
        } catch (error) {
          // A close of the deposit page cancels the payment. Viem's error holds it among its causes,
          // and its own cause is the node's refusal, which would otherwise show the payment page.
          const closed = (() => {
            const seen = new Set<unknown>()
            let current = error
            while (current instanceof Error && !seen.has(current)) {
              if (current instanceof RetryClosedError) return current
              seen.add(current)
              current = current.cause
            }
            return undefined
          })()
          if (closed) throw closed
          const resolvable =
            retry.classify(error) !== undefined ||
            retry.errorName(error) === 'CallNotAllowed'
          // The chain takes a transfer whose fee spends the rest of its limit, and reverts it. Only
          // a reverted receipt reads the limit that is left, which tells a spent limit from another
          // revert.
          const limited =
            !resolvable &&
            (await reverted_limit(error, {
              chainId,
              client,
              session: session ?? context.session.get(),
              transfer,
            }))
          if (!resolvable && !limited) throw error
          if (page) return undefined
          // Outside a page, only the node's refusal of the access key, its limit, or its scopes takes
          // the error of a payment above the access key's known limits, since a sign-in for another
          // access key fixes it. A low balance, and the instance's own errors, reject as they are.
          const name = retry.errorName(error)
          // A revoked access key sends no payment of any amount, such as after a revocation on Tempo
          // ID's connections page, so the error names the access key, as a charge of `mpp` does.
          if (name === 'KeyAlreadyRevoked')
            throw new AccessKeyRequiredError({ cause: error })
          const kind = retry.classify(error)?.kind
          const signIn =
            limited ||
            (name !== undefined &&
              (name === 'CallNotAllowed' ||
                kind === 'accessKey' ||
                kind === 'limit'))
          if (!signIn) throw error
          throw new AccountActions.PageRequiredError({
            cause: error,
            payment: true,
          })
        }
      }

      // The check is synchronous, so a payment that no access key sends opens the payment page
      // within the gesture.
      senders.set(config, (payment) => {
        // The options' fee token, else the chain's, as the client that sends the payment takes it.
        const chain = chainOf(payment.chainId)
        const feeToken = (() => {
          const value =
            resolve(payment.chainId).feeToken ??
            (chain && 'feeToken' in chain ? chain.feeToken : undefined)
          if (typeof value === 'bigint') return TokenId.toAddress(value)
          if (typeof value === 'string' && Address.validate(value)) return value
          return undefined
        })()
        const transfer = Token.payable(
          payment.session ?? context.session.get(),
          {
            ...payment,
            feeToken,
            // Outside a page, no payment page takes the payment, so the access key sends any amount
            // within the whole limit, as before the allowance, and the chain decides.
            relayed: !page || !!routing(payment.chainId).relay,
          },
        )
        if (!transfer || !chain) return undefined
        return send(payment, transfer)
      })

      // A read of a member goes to the default client, built on first use. A call returns a client
      // with its overrides. The target is an arrow function, whose own keys are all configurable.
      const call = (overrides?: viem.Overrides) => get(overrides)
      return new Proxy(call, {
        apply: (_, __, args: [viem.Overrides?]) => get(args[0]),
        // The settings key returns the plugin's chains and transports, which the wagmi plugin reads.
        // No client holds the key, so it shadows no member.
        get: (_, key) => (key === settings ? own : Reflect.get(get(), key)),
        getOwnPropertyDescriptor(_, key) {
          const descriptor = Reflect.getOwnPropertyDescriptor(get(), key)
          return descriptor && { ...descriptor, configurable: true }
        },
        has: (_, key) => Reflect.has(get(), key),
        ownKeys: () => Reflect.ownKeys(get()),
      }) as unknown as viem.Namespace
    },
    // The default client's actions, also on the instance itself. They read the default client,
    // whose account follows the session, so `accounts.token.transferSync()` sends as
    // `accounts.viem.token.transferSync()` does.
    extend: (instance: Accounts.Accounts) => {
      // A restored or new session reads its access key's mark before its first transaction.
      // The `relay` plugin extends a partial instance without a session, whose route sends no fill.
      if (instance.session)
        sessionTokens.set(instance.config, instance.session.accessToken)
      const devices = instance as unknown as Devices
      if (devices.device)
        deviceRequests.set(instance.config, devices.device.request)
      const namespace = (
        instance as unknown as {
          viem: viem.Namespace & { [settings]: viem.Settings }
        }
      ).viem
      // A client on the first chain names the actions, since the instance's chain may be one that
      // only a call's overrides reach. Each member reads the default client at its use. The sample
      // sends no request, so its transport needs no URL, and a chain without one still builds.
      const sample = build(
        {
          account: Signer.live(() => undefined),
          chain: namespace[settings].chains[0],
          transport: custom({ request: () => Promise.resolve(undefined) }),
        },
        {
          verifier: () =>
            import('../AccessToken.js').then((module) =>
              module.create(instance.config),
            ),
        },
      )
      const members = {}
      for (const key of Object.keys(sample)) {
        if (internal.has(key) || shadowed.has(key)) continue
        const value = deferred(sample[key as keyof viem.Client], {
          path: [key],
          resolve: () => namespace,
        })
        Object.defineProperty(members, key, {
          enumerable: true,
          // The read builds the default client, so a chain that it cannot build throws at the read.
          get: () => (namespace[key as keyof viem.Client], value),
        })
      }
      return members as viem.Actions
    },
    hooks: {
      pay: (context, payment) => senders.get(context.config)?.(payment),
    },
    id: 'viem',
  })
  // The options stay on the plugin, so the wagmi connector rebuilds it over the config's chains.
  return Object.assign(plugin, { [pluginOptions]: options })
}

export declare namespace viem {
  type Options = Omit<
    NonNullable<Parameters<typeof createClient>[0]>,
    'account' | 'chain' | 'testnet' | 'transport'
  > & {
    /**
     * The options of the verifier of the app's access tokens, which `verifyHash`, `verifyMessage`,
     * and `verifyTypedData` read `accessToken` with, as the `tokens` plugin takes them without
     * `url`. Set `issuer` for a backend that reaches Tempo ID at an internal `url`, and `clientIds`
     * for one that accepts the tokens of several apps. Defaults to the instance's issuer and client
     * ID.
     */
    accessTokens?: AccessToken.create.Options | undefined
    /**
     * The chain of the options' chain ID, such as one with a `feeToken` or another RPC URL. A chain of
     * another ID does not apply, so the object form names one chain. A chain ID that is not Tempo's
     * needs a `chain`, or a read of its client throws. Defaults to Tempo's chain of the ID:
     * mainnet, testnet, devnet, or a local node.
     */
    chain?: Chain | undefined
    /**
     * Which refused transactions of the session's access key retry: `false` for none, or
     * an object that turns off each kind with `false`, while the other kinds stay on. A retry first
     * shows Tempo ID's screen that fixes the failure, then sends the same transaction again, with
     * no other action from the app. Defaults to `true`, every kind. The `mpp` plugin's payments
     * retry with the same screens, and take this `retry` as their default.
     *
     * A retry runs only when the node refused the transaction before it took it, from
     * `eth_fillTransaction`, `eth_estimateGas`, or `eth_sendRawTransaction`. A transaction that
     * reverted on the chain, or a request that did not reach the node, rejects with its error, so a
     * retry never sends one transaction twice. Each kind retries once for each call, and a second
     * failure of the kind rejects with its error. Concurrent failures that one screen resolves
     * share it: a deposit of one token on one chain, or one sign-in on one chain. Other errors,
     * such as `CallNotAllowed`, reject with Viem's `TempoExecutionError`.
     *
     * A retry sends the whole call again. So an action that sends several transactions, such as
     * `accounts.earn.configureExitSafePolicy()`, retries only before the node takes its first one.
     * A refusal after that rejects with its error, and the transactions that settled stay. A
     * refusal of a call also rejects with its error if the node took a transaction of another
     * call of the same client since the call started. A refusal first waits for each transaction
     * that the client sent, and that has no answer yet. A transaction of another client changes
     * nothing, such as one of another chain, or an `mpp` payment.
     *
     * A retry covers only the actions that send a transaction from the client's account. Actions
     * that send nothing reject as they are, such as `estimateGas`, `fillTransaction`,
     * `prepareTransactionRequest`, `simulateContract`, and an action's own `estimateGas` or
     * `simulate`. So do calls that name an `account` other than the client's own, such as the
     * account's root key. A retry covers the client's own actions, also on a client that `extend`
     * returns, such as `accounts.token.transferSync()`. It also covers Viem's standalone actions
     * that send through the client's `sendTransaction` or `sendTransactionSync` member with its own
     * account, such as `Actions.token.transferSync(accounts.viem, …)`, and wagmi's actions. Viem's
     * standalone `sendTransaction` and `sendTransactionSync` send without the member, so they do
     * not retry. A fixed `session` never retries.
     *
     * Outside a page, only an instance with the `device` plugin, such as a CLI's, retries, and only
     * `balance` and `limit`. In place of a screen, the retry starts a device grant for a new access
     * key through `device.request`, and the plugin's `onCode` shows its code. Without `onCode`, the
     * transaction rejects with its own error. Elsewhere, a client outside a page never retries. A
     * user who denies the code closes the retry. After a deposit grant, the transaction waits up to
     * 10 minutes for the deposit, and sends only if the session still holds the same user and Tempo
     * Account.
     *
     * Each screen shows without a click: the deposit page at `/embed/deposit`, and the sign-in at
     * `/embed`. Where only a popup can show it, a dialog offers **Continue**, whose click opens the
     * popup. Such cases are Buy MACH for a hint of `MACH` on Tempo mainnet on iOS and iPadOS, and
     * the sign-in and the deposit page of an app that is neither first-party nor verified in a
     * browser without IntersectionObserver v2.
     *
     * If the session's access key on the client's chain expired, the retry first authorizes the
     * browser's Tempo ID session for the new access key, as `accounts.authorize` does, and shows no
     * screen. If that authorization fails, such as for a third-party app, a passkey that must sign,
     * or no Tempo ID session of the same user, the sign-in shows. An instance with `resource`, or a
     * session whose sign-in named a resource, shows the sign-in, since the authorization requests no
     * resource. The sign-in requests the resources and the API scopes of the session's access token
     * again.
     *
     * The new access key keeps the old one's expiry while it is in the future. An expired access
     * key's replacement takes the expiry of the instance's `accessKey`. Without it, the replacement
     * takes the expired access key's lifetime, counted from the retry's request, as
     * `accounts.authorize` renews it, so it lives no longer than the first. An access key without a
     * lifetime, such as one that never expires, takes the expiry that Tempo ID fills. A sign-in
     * that returns another user or Tempo Account sets no session, and the call rejects with
     * {@link RetryAccountError}.
     */
    retry?: RetryOptions | undefined
    /**
     * The URL of the app's relay route, such as `/api/relay`, which the `relay` plugin serves, or
     * an object with the URL and `credentials`. The chain's transport then sends each fill, and
     * each raw transaction without its fee payer's signature, to the route, and every other request
     * over `transport`. So the relay's fee payer pays the fees of each transaction. Each request
     * to a route at the app's origin carries the access token of the instance's session, which
     * `session.accessToken` returns, so the route can verify its caller. The object form's
     * `credentials` changes which routes receive it. A request whose URL holds its own credentials,
     * and a fixed `session`'s client, send none. Without a token, such as while signed out or after
     * a failed refresh, a request carries none. In the object form of the plugin, it applies to the
     * same chain as `transport`, and other chains pay their own fees. A call's `transport` override
     * sends without it. Absent, each transaction pays its own fees, unless `transport` sponsors
     * them.
     */
    relay?: string | Relay | undefined
    /**
     * The transport of the chain's clients. In the object form, it applies to the options' `chain`,
     * or to the instance's configured `chain` without one, which `accounts.switchChain` never
     * moves, and other chains use `http()`. A function of the plugin returns a transport for each
     * chain. A transport to a sponsor relay, such as the Tempo API's `/rpc/relay`, lets the relay's
     * fee payer pay for each transaction, as the fee sponsorship guide describes under "Sponsor
     * from a backend". Defaults to `http()`, the chain's own RPC.
     */
    transport?: Transport | undefined
  }

  /**
   * Which refused transactions retry: `true` for every kind, `false` for none, or an object whose
   * kinds default to `true`.
   */
  type RetryOptions =
    | boolean
    | {
        /**
         * An access key that the chain does not hold, expired, or revoked, signs in for a new one
         * with the same limits and scopes: the node's `KeyNotFound`, `KeyExpired`, and
         * `KeyAlreadyRevoked`. The embedded sign-in shows. An expired access key renews with no
         * screen first.
         *
         * A session with an access key on another chain, such as after `accounts.switchChain`,
         * signs no transaction on a chain without one. The account rejects with
         * `Accounts.AccessKeyRequiredError` before any send, so the embedded sign-in requests an
         * access key on the client's chain, and the call then sends once. The request takes the
         * instance's `accessKey`, whose token symbols resolve on that chain. Without one, it takes
         * the limits, scopes, and lifetime of the session's access key on another chain, by token
         * address. The session keeps its access keys on the other chains. A session whose access
         * key on the client's chain signs nothing here, such as another app's access key by its
         * public key, rejects with the error and requests none.
         */
        accessKey?: boolean | undefined
        /**
         * A balance below the transaction's need opens the deposit page: the node's
         * `InsufficientBalance` and `InsufficientFeeTokenBalance`. The page shows in a frame, with
         * the amount and token that the error names, and the transaction retries on `received`.
         *
         * Outside a page, the device grant carries a funding hint: the balance plus the amount that
         * the error names, read in one round. After the approval, Tempo ID's device page opens the
         * deposit page. The retry then reads the balance every 2 seconds, and the transaction
         * retries once it holds the hint. After 10 minutes without it, the call rejects with
         * {@link RetryClosedError}. A refusal without an amount and token, such as one of the fee
         * token, rejects with its error.
         */
        balance?: boolean | undefined
        /**
         * A spent limit of the access key signs in for a new access key with the same limits and
         * scopes, in the embedded sign-in: the node's `SpendingLimitExceeded`. Outside a page, a
         * device grant requests the new access key.
         *
         * A new access key with the same limits sends no more than a whole limit. So before the
         * sign-in, the retry compares the refused amount with its token's whole limit. It takes the
         * amount and token of Viem's `AccessKeySpendingLimitExceededError`, or, without that error,
         * the TIP-20 `transfer` or `transferWithMemo` of a transaction request of one call, such as
         * one that `transferSync` of `wagmi/tempo` sends, or else the call's own `amount` and
         * `token`, such as those of `token.transferSync`. For an amount above the whole limit that
         * Viem's error or such a transfer names, the new access key's limit of the token is the old
         * limit plus the amount, so the old limit still pays the fees. For a named amount
         * of a `USD` token within 0.1 of the whole limit, which the fees can take, the new limit is
         * the old limit plus 0.1, unless `relay` pays the fees of a client without its own
         * `transport`. Only such a spend reads the token's currency, in one round. A transfer that
         * joins the sign-in of another transfer, whose new limit is below its amount, signs in
         * again from the new access key. Tempo ID can refuse that limit, such as with
         * `limit_exceeds_maximum`. A call's own amount above the whole limit, such as that of a
         * mint, can be no spend of the limit, so the call rejects with its error, without a screen.
         *
         * For a refusal of the fee payment, or without an amount and token, the retry reads the
         * chain in one round. A transaction that the access key spent none of its limits for then
         * rejects with its error, without a screen.
         */
        limit?: boolean | undefined
        /**
         * Rejects the call with the signal's reason, and the call stops its own wait on the screen.
         * The screen closes once no call waits on it, so a screen that another call shares stays
         * open.
         */
        signal?: AbortSignal | undefined
      }

  /** Returns the options of the chain of `chainId`. */
  type Resolver = (chainId: number) => Options

  /**
   * The overrides of a client, for one call: the options of `createClient` from `viem/tempo` but
   * `account`, `chain`, and `testnet`, such as `transport`, and these.
   */
  type Overrides = Omit<
    NonNullable<Parameters<typeof createClient>[0]>,
    'account' | 'chain' | 'testnet'
  > & {
    /**
     * The chain ID: a Tempo chain, or one whose options name its `chain`. Defaults to the instance's
     * `chainId`. The session's access key authorizes one chain. On another chain, the client's
     * account keeps the address of the access key's account, `session.accessKey.account`, and a
     * transaction throws `Accounts.AccessKeyRequiredError`.
     *
     * Configurable accounts (TIP-1107) are enabled per chain, and they change the account's
     * address:
     *
     * - On a chain with configurable accounts, the Tempo Account is a contract account that its
     *   owners control. Its address derives from its configuration of owners.
     * - On a chain without configurable accounts, the Tempo Account is the owner key itself, at the
     *   owner key's own address.
     *
     * So `session.accessKey.account` is the account's address on another chain only when both
     * chains have configurable accounts, or neither does.
     */
    chainId?: number | undefined
    /**
     * Which refused transactions of the client retry, for one call. A boolean replaces the plugin's
     * `retry`. An object turns on or off the kinds that it names, over the plugin's, and keeps the
     * plugin's other kinds. Defaults to the plugin's `retry`.
     */
    retry?: RetryOptions | undefined
    /**
     * A fixed session, such as one that `accounts.backend.get` returns, or an API's connection from
     * `accounts.connections.connect`, whose access key signs. On a server, it takes the place of
     * the default client, which follows the instance's own session. A client of a session without
     * an access key throws `Accounts.AccessKeyRequiredError`. Outside a page, a transaction of its
     * expired access key rejects before the node receives it, with `Accounts.SignedOutError`, or
     * `Accounts.AccessKeyRequiredError` while an access key of the session on another chain lives.
     * The node receives no fill, estimate, or signed transaction of that access key. A client of a
     * fixed session must not outlive its request, since its account signs with that one user's
     * access key.
     */
    session?: Pick<Session.Any, 'accessKey' | 'account'> | undefined
  }

  /** A client of the plugin, with its account and its chain. */
  type Client = ReturnType<typeof build>

  /**
   * The default client's actions and action groups, which the instance also holds, without the
   * client's account, chain, transport, and other settings.
   */
  type Actions = Omit<Client, Internal | Shadowed>

  /**
   * The actions of a client that the instance's own members replace: `switchChain` selects the
   * instance's chain, in place of a request to a wallet.
   */
  type Shadowed = 'switchChain'

  /** The members of a client that are its settings, not its actions. */
  type Internal =
    | 'account'
    | 'batch'
    | 'cacheTime'
    | 'ccipRead'
    | 'chain'
    | 'dataSuffix'
    | 'extend'
    | 'key'
    | 'name'
    | 'pollingInterval'
    | 'request'
    | 'scope'
    | 'tokens'
    | 'transport'
    | 'type'
    | 'uid'

  /** The app's relay route, with the routes that receive the instance's access token. */
  type Relay = {
    /**
     * Which relay routes receive the access token of the instance's session: `same-origin`, a route
     * at one of the app's origins, `include`, any route, or `omit`, none. The app's origins are the
     * page's, and those of `redirectUri` and of a `clientId` that is a URL. `include` serves the
     * app's API on another origin, or the server of a mobile app or CLI. Defaults to `same-origin`.
     */
    credentials?: 'include' | 'omit' | 'same-origin' | undefined
    /** The URL of the app's relay route, such as `https://api.example.com/relay`. */
    url: string
  }

  /** The chains and transports of the plugin, which `accounts.viem[settings]` returns. */
  type Settings = {
    /**
     * Returns the chain of `chainId`: its options' `chain`, or Tempo's chain of that ID. Absent when
     * neither holds the ID.
     */
    chain: (chainId: number) => Chain | undefined
    /** Tempo's chains, with the instance's chain first when it is another, each from its options. */
    chains: readonly [Chain, ...Chain[]]
    /**
     * The access keys that the chain registered, which the clients and the `mpp` plugin's payers
     * share, and which the instance's store keeps across runs.
     */
    registrations: Registrations
    /**
     * The retry of the plugin's clients, which the `mpp` plugin's payers share, so a failed payment
     * and a failed transaction show one screen.
     */
    retry: Retries
    /**
     * Returns the transport of the chain of `chainId` without its relay route, or `http()` when its
     * options hold none. The `relay` plugin relays to it, so its route never sends to itself.
     */
    rpc: (chainId: number) => Transport
    /**
     * Returns the transport of the chain of `chainId`, with its relay route, or `http()` when its
     * options hold none. With `token: false`, the relay route receives no access token of the
     * instance's session. Defaults to `true`.
     */
    transport: (
      chainId: number,
      options?: {
        /** Whether the relay route receives the instance's access token. Defaults to `true`. */
        token?: boolean | undefined
      },
    ) => Transport
  }

  /** The retry of the plugin's clients, as {@link Settings} shares it. */
  type Retries = {
    /**
     * Returns the failure of `error`, or `undefined` for an error that no retry handles, or one
     * that the node may have taken a transaction for.
     */
    classify: (error: unknown) => Retry.Failure | undefined
    /**
     * Shows the screen that resolves `failure`, and resolves once the payment can send again: the
     * deposit page for a balance, and a sign-in for a new access key for an access key or its
     * limit. Joins the screen of another failure that it resolves too. Rejects with
     * {@link RetryClosedError} when the user closes it.
     */
    fix: (
      failure: Retry.Failure,
      options: {
        /** The Tempo Account that a deposit funds. */
        address: `0x${string}`
        /** The chain of the payment. */
        chainId: number
        /** The error of the failure, which a rejection throws or names as its cause. */
        error: unknown
        /** Closes the screen, and rejects with the signal's reason. */
        signal: AbortSignal | undefined
        /** The session that the payment started with. */
        state: Session.Any | undefined
      },
    ) => Promise<void>
    /**
     * Returns the kinds of failure that retry on the chain of `chainId`: its options' `retry`, with
     * `call` over it. Returns `false` for none, and outside a page without the `device` plugin.
     */
    kinds: (
      chainId: number,
      call?: RetryOptions,
    ) => false | Exclude<RetryOptions, boolean>
    /** Returns `transport`, whose refusals of a send carry the mark that `classify` reads. */
    transport: (transport: Transport) => Transport
  }

  /** The access keys that the chain registered, as {@link Settings} shares them. */
  type Registrations = {
    /**
     * Starts the store reads of the registrations of the access keys of `session`. The next fill of
     * each access key waits for its read.
     */
    hydrate: (session: Pick<Session.Any, 'accessKey' | 'accessKeys'>) => void
    /**
     * Records the registration that `signed` attached, after another sender, such as an MPP endpoint
     * that broadcasts a charge, reports that the transaction landed. `confirm` reads the chain, and
     * only a result of `true` records it. Ignores a transaction that attached no key authorization,
     * without a call of `confirm`.
     */
    landed: (signed: string, confirm: () => Promise<boolean>) => void
    /**
     * Returns `account`, whose key authorization stays unattached once the chain registered its
     * access key.
     */
    track: (account: Account.AccessKeyAccount) => Account.AccessKeyAccount
    /**
     * Waits until no other payment carries the authorization of the access key of `key`, so
     * concurrent payments of an access key that the chain does not hold attach it once. Resolves
     * with `undefined` once the chain holds the access key, else with the function that ends the
     * turn, which the payment calls once it settles. A turn expires after 5 seconds, and one waiting
     * payment then takes it, so a payment that stalls blocks the others no longer.
     */
    turn: (
      key: KeyAuthorizationManager.Key,
      options?: Registrations.turn.Options,
    ) => Promise<(() => void) | undefined>
    /**
     * Returns `transport` of the chain of `chainId`, whose landed transactions record their
     * registrations, and whose refused fills drop stale ones.
     */
    watch: (transport: Transport, chainId: number) => Transport
  }

  namespace Registrations {
    namespace turn {
      type Options = {
        /**
         * The key authorizations of the payment's account. If it holds none for `key`, the payment
         * attaches none, and takes no turn. Absent, the payment takes a turn whenever the chain does
         * not hold the access key.
         */
        keyAuthorizationManager?:
          | Pick<KeyAuthorizationManager.KeyAuthorizationManager, 'get'>
          | undefined
        /** Ends the wait for an earlier payment. Its abort rejects with the signal's reason. */
        signal?: AbortSignal | undefined
      }
    }
  }

  /**
   * `accounts.viem`: the default client, which a call configures. The default client holds the
   * instance's chain, its transport, and an account that follows the instance's session. Each Viem
   * action of `viem/tempo` is a member, such as `accounts.token.transferSync`. A call returns a
   * client with the {@link Overrides}. A call that names at most `chainId` returns one cached
   * client for each chain.
   *
   * Outside a page, the client's transport refuses each request that fills or estimates a
   * transaction with an expired access key that this app holds, on the client's chain, so the node
   * never receives it. The client takes the transaction's error from the causes of Viem's error.
   * The transaction's rejection then starts a read of the session, which empties the expired session
   * and revokes its refresh token, so the status changes to `signedOut`. Reads and the owner's
   * signatures stay until that read. After it, `accessKey` changes that Tempo ID sends reject with
   * `Accounts.SignedOutError`, and send nothing.
   *
   * @throws {Error} When `chainId`, or the instance's `chainId`, is not a Tempo chain and its
   *   options name no `chain`. The chain's definition, returned as `chain`, resolves it.
   * @throws {Accounts.AccessKeyRequiredError} For a transaction of an account whose session holds
   *   no access key on the client's chain, unless a retry of `accessKey` requests one. Also for
   *   `accounts.viem({ session })` with a session without an access key. Outside a page, also for a
   *   transaction of an expired access key, while an access key on another chain keeps the session.
   * @throws {Accounts.SignedOutError} When an action reads the account while the instance holds no
   *   session, and, outside a page, for a transaction of an expired access key that this app holds
   *   on the client's chain. Before the instance reads its saved session, the message names
   *   `session.get`, which restores it.
   * @throws {Accounts.ChainUnavailableError} When the account's owner signs on a chain that Tempo
   *   ID does not list.
   * @throws {RetryAccountError} For a transaction whose retry signed in for a new access key, when
   *   the sign-in returned another user or Tempo Account.
   * @throws {RetryClosedError} For a transaction whose retry the user ended.
   * @throws {Accounts.RequestError} When Tempo ID refuses a signature of `signMessage` or
   *   `signTypedData`, with one of these `reason` values, which
   *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
   *   - `sign_not_permitted`: The page is not the page of a first-party app with the
   *     `tempo-id:sign` scope, or `clientId` names another app.
   *   - `session_required`: The user is not signed in to Tempo ID.
   *   - `configurable_accounts_disabled`: The chain's accounts are not configurable.
   *   - `foreign_account`: The account is not the user's in the app's realms.
   *   - `webauthn_required`: No cloud wallet of the user owns the account on the chain. The
   *     account's passkey signs.
   *   - `config_conflict`: The chain holds a configuration that Tempo ID did not send.
   *   - `invalid_field`: `message` is empty or too long, or `account` is not an address.
   *   - `rate_limited`: The user exceeded the limit of account requests. Retry after `Retry-After`
   *     seconds.
   *   - `upstream_unavailable`: The chain or the cloud wallet's provider failed. Retry later.
   *   - `unexpected`: An unexpected failure. Retry the request.
   *
   * @example
   * ```ts
   * import { Accounts } from 'accounts'
   * import { backend, viem } from 'accounts/plugins'
   * import { Addresses } from 'viem/tempo'
   * import { tempoTestnet } from 'viem/tempo/chains'
   *
   * const accounts = Accounts.create({ plugins: [backend(), viem()] })
   *
   * await accounts.token.transferSync({ amount, to, token: Addresses.ousd })
   * await accounts
   *   .viem({ chainId: tempoTestnet.id })
   *   .token.transferSync({ amount, to, token: Addresses.ousd })
   *
   * // A signal ends the wait of one call on a retry's screen.
   * const controller = new AbortController()
   * await accounts
   *   .viem({ retry: { signal: controller.signal } })
   *   .token.transferSync({ amount, to, token: Addresses.ousd })
   *
   * // On a backend, a fixed session's access key signs for one request.
   * const session = await accounts.backend.get({ id })
   * if (session?.method === 'tempo-id')
   *   await accounts
   *     .viem({ session })
   *     .token.transferSync({ amount, to, token: Addresses.ousd })
   * ```
   */
  type Namespace = Client & ((overrides?: Overrides) => Client)
}

/**
 * The key of `accounts.viem` that returns the plugin's {@link viem.Settings}. The entries of the
 * package do not export it, so only the package's own plugins read it.
 */
export const settings = Symbol('viem.settings')

/**
 * The key of a `viem` plugin that holds the options it was created with. The entries of the package
 * do not export it, so only the package's own plugins read it.
 */
export const pluginOptions = Symbol('viem.options')

/**
 * Returns the retries of a client: the plugin's `retry`, with the call's `retry` over it. A call's
 * object turns on or off the kinds that it names, and keeps the plugin's other kinds.
 */
function merge(
  plugin: viem.RetryOptions,
  call: viem.RetryOptions | undefined,
): viem.RetryOptions {
  if (call === undefined || typeof call === 'boolean') return call ?? plugin
  const base =
    plugin === false
      ? { accessKey: false, balance: false, limit: false }
      : plugin === true
        ? {}
        : plugin
  return { ...base, ...call }
}

/** What the user closed, for each kind of failure, in the message of {@link RetryClosedError}. */
const closedMessages = {
  accessKey: 'The user closed the sign-in for a new access key.',
  balance: 'The user closed the deposit page before a deposit arrived.',
  limit: 'The user closed the sign-in for a new access key with a new limit.',
} as const satisfies Record<Retry.Kind, string>

/** Tempo's chains, which a chain ID without a `chain` in its options uses. */
const defaultChains = [tempo, tempoTestnet, tempoDevnet, tempoLocalnet] as const

/** The most access keys that an instance records as registered on the chain. */
const registeredLimit = 10_000

/**
 * How long a fill waits for the store's read of a registration mark, in milliseconds. A read that
 * stalls, such as on a store that queues commands while it reconnects, then changes nothing.
 */
const markReadLimit = 1_000

/** The namespace that the `device` plugin adds to an instance, absent without the plugin. */
type Devices = Partial<Plugin.Namespaces<readonly [ReturnType<typeof device>]>>

/** A screen of the retry. `fix` sets `funding` outside a page. */
type Screen = {
  /** The Tempo Account that the deposit funds. */
  address: `0x${string}`
  /**
   * Outside a page, the wait for the deposit, which the first call that waits starts. It ends once
   * the deposit arrives, or once no call waits on it.
   */
  deposit?: machines.screen.Actor | undefined
  /** The failure that the screen resolves. */
  failure: Retry.Failure
  /** Outside a page, the balance that the deposit reaches. */
  funding?: { amount: bigint; token: `0x${string}` } | undefined
}

/**
 * How long a retry outside a page waits for a deposit after the approval of its device grant, in
 * milliseconds.
 */
const depositLimit = 600_000

/** How often a retry outside a page reads the balance while it waits for a deposit, in milliseconds. */
const depositInterval = 2_000

/**
 * How long a payment holds the turn of its access key before another payment can take it, in
 * milliseconds. A payment that stalls, such as at an endpoint that never answers, then blocks the
 * others no longer. A charge that the endpoint broadcasts lands within a few blocks.
 */
const turnLimit = 5_000

/**
 * How long a transaction of an access key counts as in flight without its send, in milliseconds. A
 * preparation that no send follows, such as after a refused fill, then gives the next transaction
 * of the account the protocol nonce again.
 */
const sendLimit = 30_000

/**
 * How long a hold waits for the signature of a filled transaction, in milliseconds. A fill that no
 * signature follows, such as a preview of the transaction, then holds the next fill no longer.
 */
const signLimit = 1_000

/**
 * The clock of the hold machines, whose timers keep no process alive, such as a CLI that exits
 * after its last send. A fill that waits on a hold keeps the process alive with its own wait.
 */
const unrefClock = {
  clearTimeout: (id: unknown) =>
    clearTimeout(id as ReturnType<typeof setTimeout>),
  setTimeout(fn: (...args: unknown[]) => void, timeout: number) {
    const timer = setTimeout(fn, timeout)
    ;(timer as { unref?: () => void }).unref?.()
    return timer
  },
}

/** The turn of a payment whose transaction carries the authorization of a registration. */
type Turn = {
  /** Settles once the payment ends its turn. */
  ended: Promise<void>
  /** When the turn expires, in Unix milliseconds. */
  expiresAt: number
  /** Whether a send that carried the authorization failed, so that the turn lasts until it expires. */
  kept?: boolean | undefined
}

/** Returns a promise that settles with `read`, or after {@link markReadLimit}, whichever ends first. */
async function wait(read: Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    read,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, markReadLimit)
    }),
  ])
  clearTimeout(timer)
}

/** The methods that fill or estimate a transaction before it is signed, with its `keyId`. */
const prepares = new Set(['eth_estimateGas', 'eth_fillTransaction'])

/** The methods that send a signed transaction. */
const sends = new Set(['eth_sendRawTransaction', 'eth_sendRawTransactionSync'])

/** The nonce and call fields of a transaction, as a fill returns them or as Viem signs them. */
type Nonced = {
  /** The calls, as a fill returns them, or as Viem signs a transaction of several. */
  calls?:
    | readonly { data?: unknown; input?: unknown; to?: unknown }[]
    | undefined
  /** The data of a transaction of one call, as Viem signs it. */
  data?: unknown
  /** The nonce, as a number, a bigint, or a hex string. */
  nonce?: unknown
  /** The nonce key, as a bigint or a hex string. Absent for the protocol nonce. */
  nonceKey?: unknown
  /** The target of a transaction of one call, as Viem signs it. */
  to?: unknown
}

/**
 * Returns the name of the filled transaction of the registration `name` by its nonce and calls, or
 * `undefined` for a nonce that does not parse. Sequential transactions of the protocol nonce share
 * a nonce, so their calls tell them apart.
 */
function nonceName(name: string, transaction: Nonced) {
  const { nonce, nonceKey } = transaction
  try {
    const parse = (value: unknown) =>
      typeof value === 'bigint' ||
      typeof value === 'number' ||
      typeof value === 'string'
        ? BigInt(value)
        : 0n
    const text = (value: unknown) =>
      typeof value === 'string' ? value.toLowerCase() : ''
    const calls = (
      transaction.calls?.length
        ? transaction.calls
        : [{ data: transaction.data, to: transaction.to }]
    )
      .map(
        (call) => `${text(call.to)}:${text(call.data ?? call.input) || '0x'}`,
      )
      .join(',')
    return `${name}:${parse(nonceKey)}:${parse(nonce)}:${calls}`
  } catch {
    return undefined
  }
}

/** A registration of an access key on the chain, which the instance records. */
type Registration = {
  /** When the access key expires, in milliseconds, or 0 for an access key that never expires. */
  expiresAt: number
  /** The hold of the transaction's fill, as `machines.hold` counted it. Absent without a hold. */
  hold?: number | undefined
  /** The key of the registration in the store. */
  name: string
}

/** Returns whether `error`, or an error in its causes, is in `options.refusals`. */
function refused(error: unknown, options: { refusals: WeakSet<Error> }) {
  for (
    let cause: unknown = error;
    cause;
    cause = (cause as { cause?: unknown }).cause
  )
    if (cause instanceof Error && options.refusals.has(cause)) return true
  return false
}

/**
 * Returns whether the node refused a request with the error `options.name`, such as
 * `KeyAlreadyExists`, in `error` or its causes. A bundle can hold two copies of Viem's errors, so
 * the causes are read by shape.
 */
function refusedWith(error: unknown, options: refusedWith.Options) {
  for (
    let cause: unknown = error;
    cause;
    cause = (cause as { cause?: unknown }).cause
  )
    if (String((cause as { details?: unknown }).details).includes(options.name))
      return true
  return false
}

/**
 * Returns whether the node reverted the call of `error`, which Viem rethrows from a fill instead of
 * sending the transaction.
 */
function reverted(error: unknown) {
  for (
    let cause: unknown = error;
    cause;
    cause = (cause as { cause?: unknown }).cause
  ) {
    const { code, message } = cause as { code?: unknown; message?: unknown }
    if (
      code === 3 ||
      /execution reverted|gas required exceeds allowance/.test(String(message))
    )
      return true
  }
  return false
}

/**
 * Returns the name of the transaction of the registration `name` whose fill failed, which Viem
 * sends without the fill's nonce.
 */
function unfilledName(name: string) {
  return `${name}:unfilled`
}

declare namespace refusedWith {
  type Options = {
    /** The node's error name, such as `SpendingLimitExceeded`, which the refusal's details hold. */
    name: string
  }
}

/**
 * Returns the `Accounts.SignedOutError` or `Accounts.AccessKeyRequiredError` among the causes of
 * `error`, which `refuse` and `expiring` throw inside Viem's action, or `error` without one.
 */
function lapsedCause(error: unknown) {
  for (
    let cause: unknown = error;
    cause;
    cause = (cause as { cause?: unknown }).cause
  )
    if (
      cause instanceof SignedOutError ||
      cause instanceof AccessKeyRequiredError
    )
      return cause
  return error
}

/** Returns the store key of the registration of the session's access key `accessKey`. */
function markName(accessKey: NonNullable<Session.Any['accessKey']>) {
  const { address, chainId } = KeyAuthorization.fromRpc(
    accessKey.keyAuthorization,
  )
  return registrationName({
    accessKey: address,
    address: accessKey.account,
    chainId: Number(chainId),
  })
}

/** Returns the store key of the registration of the access key of `key` on its chain. */
function registrationName(key: KeyAuthorizationManager.Key) {
  return `tempo-id:registered:${JSON.stringify([Number(key.chainId), key.address.toLowerCase(), key.accessKey.toLowerCase()])}`
}

/** A chain with the formatters of Tempo's chains, which type the Tempo fields of each action. */
type TempoChain = Chain & Pick<typeof tempo, 'formatters'>

declare namespace Prepare {
  /** The fields of a transaction request that the preparation hook of `coordinate` reads. */
  type Request = {
    /** The account that signs the transaction. */
    account?:
      | {
          /** The address of the access key, for an account of an access key. */
          accessKeyAddress?: string | undefined
          address?: string
          /** The key authorizations of an account of an access key. */
          keyAuthorizationManager?:
            | KeyAuthorizationManager.KeyAuthorizationManager
            | undefined
          source?: string
        }
      | undefined
    /** The chain of the request. */
    chain?: { id: number } | undefined
    /** The chain ID of the request. */
    chainId?: number | undefined
    /** The key authorization that the transaction carries. Absent before the fill attaches one. */
    keyAuthorization?: unknown
    /** The nonce of the request, absent when the node fills it. */
    nonce?: unknown
    /** The nonce key of the request, absent for the protocol nonce. */
    nonceKey?: unknown
    /** The fields that the preparation fills. */
    parameters?: readonly string[] | undefined
  }

  /** The arguments of the preparation hook of a chain. */
  type Args = {
    /** The error of the fill, in the phase `afterFillTransactionError`. */
    error?: unknown
    /** The phase of the preparation. */
    phase: string
  }
}

/**
 * Creates a Tempo client with an account and a chain, so its type holds both. Its `verifyHash`,
 * `verifyMessage`, and `verifyTypedData` take the app's `accessToken`, and count an access key's
 * signature only when the token names the access key, as `Verify.hash` describes. Its
 * `verifySiweMessage` refuses a message that names the zero address, as `Verify.siweMessage`
 * describes.
 */
function build(
  parameters: Omit<
    NonNullable<Parameters<typeof createClient>[0]>,
    'account' | 'chain' | 'transport'
  > & { account: LocalAccount; chain: Chain; transport: Transport },
  options: { verifier: () => Promise<AccessToken.create.ReturnType> },
) {
  const { verifier } = options
  // Each chain of the plugin is one of Tempo's, or the options' `chain` of a Tempo chain, so it
  // holds Tempo's formatters. Their type adds the Tempo fields to each action, such as `calls`.
  const client = createClient({
    ...parameters,
    chain: parameters.chain as TempoChain,
  })
  // Verification reads the chain and signs nothing, so it runs on a client without the account. A
  // signed-out instance's account throws at each read, such as Viem's read of a call's `from`.
  let reader: Client<Transport, Chain> | undefined
  const read = () =>
    (reader ??= createClient({ ...parameters, account: undefined }))
  return client.extend(() => ({
    verifyHash: (parameters: Omit<Verify.hash.Options, 'verifier'>) =>
      Verify.hash(read(), { ...parameters, verifier }),
    verifyMessage: (parameters: Omit<Verify.message.Options, 'verifier'>) =>
      Verify.message(read(), { ...parameters, verifier }),
    verifySiweMessage: (parameters: Verify.siweMessage.Options) =>
      Verify.siweMessage(read(), parameters),
    verifyTypedData: (parameters: Omit<Verify.typedData.Options, 'verifier'>) =>
      Verify.typedData(read(), { ...parameters, verifier }),
  }))
}

/**
 * Returns whether the access key of `session` on the chain `options.chainId`, in `accessKey` or
 * `accessKeys`, expired. Only an access key that this app holds, with its material, signs here.
 * Another app's access key leaves the owner to sign. An access key on another chain that still
 * lives keeps the session, but not this access key.
 */
function lapsed(
  session: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined,
  options: lapsed.Options,
) {
  const accessKey = accessKeyOn(session, options)
  if (!accessKey) return false
  if (!AccessKey_internal.held(accessKey)) return false
  return AccessKey_internal.expired(accessKey)
}

/**
 * Returns the error of a transaction of an access key that `lapsed` reports:
 * `Accounts.SignedOutError` once the session expired, or `Accounts.AccessKeyRequiredError` while an
 * access key on another chain keeps it, as an account that `Signer.fromSession` reads anew throws.
 */
function lapse(session: Session.Any | undefined) {
  return !session || Session.expired(session)
    ? new SignedOutError()
    : new AccessKeyRequiredError()
}

/**
 * Returns the error of a transaction of a fixed session's access key that `lapsed` reports:
 * `Accounts.AccessKeyRequiredError` while an access key of the session on another chain lives, or
 * else `Accounts.SignedOutError`, as `lapse` returns for the instance's session.
 */
function lapse_fixed(session: Pick<Session.Any, 'accessKey' | 'accessKeys'>) {
  const live = [session.accessKey, ...(session.accessKeys ?? [])].some(
    (entry) => entry && !AccessKey_internal.expired(entry),
  )
  return live ? new AccessKeyRequiredError() : new SignedOutError()
}

declare namespace lapsed {
  type Options = {
    /** The chain of the client that signs. */
    chainId: number
  }
}

/** The members of a client that are its settings, not its actions, which the instance leaves out. */
const internal = new Set<string>([
  'account',
  'batch',
  'cacheTime',
  'ccipRead',
  'chain',
  'dataSuffix',
  'extend',
  'key',
  'name',
  'pollingInterval',
  'request',
  'scope',
  'tokens',
  'transport',
  'type',
  'uid',
] satisfies readonly viem.Internal[])

/** The actions of a client that the instance's own members replace. */
const shadowed = new Set<string>(['switchChain'] satisfies viem.Shadowed[])

/**
 * Returns an action of `value`'s shape, whose calls run the action at `options.path` of the
 * namespace at the call. An app can hold an action, such as `accounts.token`, across a
 * `switchChain`, and its calls then run on the selected chain's client.
 */
function deferred(
  value: unknown,
  options: { path: readonly string[]; resolve: () => unknown },
): unknown {
  const { path, resolve } = options
  const lookup = () =>
    path.reduce<unknown>(
      (target, key) => (target as Record<string, unknown>)[key],
      resolve(),
    )
  // An action's helpers, such as `transfer.estimateGas` and `transfer.simulate`, defer too.
  const members = (target: object) =>
    Object.fromEntries(
      Object.entries(target).map(([key, entry]) => [
        key,
        deferred(entry, { path: [...path, key], resolve }),
      ]),
    )
  if (typeof value === 'function')
    return Object.assign(
      (...args: readonly unknown[]) =>
        (lookup() as (...args: readonly unknown[]) => unknown)(...args),
      members(value),
    )
  // Data, such as an ABI, is the same on every chain.
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value
  return members(value)
}

/**
 * Sends a payment of `accounts.pay` with the session's access key, and returns its transaction.
 * Returns `undefined` for a payment that the access key does not send, which the payment page takes.
 */
type Sender = (
  payment: Payment,
) => Promise<{ transaction: `0x${string}` } | undefined> | undefined

/** Returns the access key of `session` on `options.chainId`, from `accessKey` or `accessKeys`. */
function accessKeyOn(
  session: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined,
  options: { chainId: number },
) {
  return [session?.accessKey, ...(session?.accessKeys ?? [])].find(
    (entry) => entry && Number(entry.chainId) === options.chainId,
  )
}

/**
 * Returns whether `error` is the revert of a transfer of `options.transfer` that the limit left to
 * the access key of `options.session` no longer holds, such as after its own fee spent the rest. It
 * reads the limit in one round, only for a reverted receipt. A failed read returns `false`, so
 * the error stands.
 */
async function reverted_limit(error: unknown, options: reverted_limit.Options) {
  const { chainId, client, session, transfer } = options
  const seen = new Set<unknown>()
  let current = error
  // Several copies of Viem can load, so the error's name identifies it.
  while (
    current instanceof Error &&
    !seen.has(current) &&
    current.name !== 'TransactionReceiptRevertedError'
  ) {
    seen.add(current)
    current = current.cause
  }
  if (!(current instanceof Error) || seen.has(current)) return false

  const accessKey = accessKeyOn(session, { chainId })
  if (!accessKey?.keyAuthorization.limits) return false
  const read = await Actions.accessKey
    .getRemainingLimit(client, {
      accessKey: accessKey.keyAuthorization.keyId,
      account: accessKey.account,
      token: transfer.token,
    })
    .catch(() => undefined)
  return read !== undefined && read.remaining < transfer.amount
}

declare namespace reverted_limit {
  type Options = {
    /** The chain of the transfer. */
    chainId: number
    /** The client that sent the transfer, which reads the limit. */
    client: Client
    /** The session whose access key sent the transfer. */
    session: Pick<Session.Any, 'accessKey' | 'accessKeys'> | undefined
    /** The transfer, in base units, as `Token.payable` returns it. */
    transfer: Token.payable.ReturnType
  }
}

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The machine of the hold of one registration, which one transaction whose fill carries its
   * authorization takes at a time. The hold lasts while that transaction can still register the
   * access key, and at most {@link turnLimit} in each stage. A fill result, a signature, or a
   * failure of an earlier, expired hold changes no later one.
   *
   * | State     | The registration                                                              |
   * | --------- | ----------------------------------------------------------------------------- |
   * | `free`    | Held by no transaction, so the next fill that carries it starts               |
   * | `filling` | Carried by a fill in flight                                                    |
   * | `filled`  | Carried by a filled transaction, for {@link signLimit} until its signature     |
   * | `sending` | Carried by a signed transaction, until its receipt or its failure              |
   */
  export const hold = setup({
    actions: {
      /** Counts the hold that a fill takes. */
      take: assign((args) => ({ holds: args.context.holds + 1 })),
    },
    delays: { signLimit, turnLimit },
    guards: {
      /** Whether the fill or the transaction of the event took the current hold. */
      current: (args) => {
        assertEvent(args.event, [
          'fill.done',
          'fill.refused',
          'transaction.failed',
          'transaction.signed',
        ])
        return args.event.hold === args.context.holds
      },
    },
    types: {
      context: {} as hold.Context,
      events: {} as hold.Event,
    },
  }).createMachine({
    context: { holds: 0 },
    id: 'hold',
    initial: 'free',
    states: {
      filled: {
        after: { signLimit: { target: 'free' } },
        on: {
          registered: { target: 'free' },
          'transaction.signed': { guard: 'current', target: 'sending' },
        },
      },
      filling: {
        after: { turnLimit: { target: 'free' } },
        on: {
          'fill.done': { guard: 'current', target: 'filled' },
          'fill.refused': { guard: 'current', target: 'free' },
          registered: { target: 'free' },
        },
      },
      free: {
        on: { 'fill.start': { actions: 'take', target: 'filling' } },
      },
      sending: {
        after: { turnLimit: { target: 'free' } },
        on: {
          registered: { target: 'free' },
          'transaction.failed': { guard: 'current', target: 'free' },
        },
      },
    },
  })

  export declare namespace hold {
    /** The machine's context. */
    type Context = {
      /** The count of holds that fills took, which names the current hold. */
      holds: number
    }

    /** An event of a hold. */
    type Event =
      | {
          /** The hold that the fill took, as `holds` counted it. */
          hold: number
          /** The node answered a fill that carries the authorization. */
          type: 'fill.done'
        }
      | {
          /** The hold that the fill took, as `holds` counted it. */
          hold: number
          /** The node refused a fill that carries the authorization, so it sent no transaction. */
          type: 'fill.refused'
        }
      | {
          /** A fill that carries the authorization started. */
          type: 'fill.start'
        }
      | {
          /** The chain registered the access key. */
          type: 'registered'
        }
      | {
          /** The hold that the transaction's fill took, as `holds` counted it. */
          hold: number
          /** The send of the transaction failed, or its receipt shows a failure. */
          type: 'transaction.failed'
        }
      | {
          /** The access key signed a transaction that carries the authorization. */
          /** The hold that the transaction's fill took, as `holds` counted it. */
          hold: number
          type: 'transaction.signed'
        }

    /** A running machine. */
    type Actor = ActorRefFrom<typeof hold>

    /** A snapshot of the machine. */
    type Snapshot = SnapshotFrom<typeof hold>
  }

  /** Returns whether no transaction holds the registration, so a fill that carries it starts. */
  export function free(snapshot: hold.Snapshot) {
    return snapshot.matches('free')
  }

  /**
   * The machine of one screen of a retry, which each call that the screen resolves waits on. The
   * screen shows in `open`, and an exit from `open` stops `show`, whose signal closes the screen. A
   * call without a signal never leaves, so its screen stays open until it settles.
   *
   * | State       | The screen                                                  |
   * | ----------- | ----------------------------------------------------------- |
   * | `abandoned` | Closed, since each call that waited on it left              |
   * | `open`      | Shows for the calls that wait on it                         |
   * | `rejected`  | Rejected with `context.error`, such as at the user's close  |
   * | `resolved`  | Resolved, so each call that waits on it sends again         |
   */
  export const screen = setup({
    actions: {
      /** Records the error of the screen. */
      fail: assign((_, params: { error: unknown }) => ({
        error: params.error,
      })),
      /** Counts a call that waits on the screen. */
      join: assign((args) => ({ waits: args.context.waits + 1 })),
      /** Counts a call that left the screen. */
      leave: assign((args) => ({ waits: args.context.waits - 1 })),
    },
    actors: {
      /**
       * Shows the screen, and resolves once a call can send again. Its `signal` closes the screen.
       * The plugin's joined fix provides it.
       */
      show: fromPromise<void>(() => Promise.resolve()),
    },
    guards: {
      /** Whether the call that leaves is the last one that waits. */
      last: (args) => args.context.waits === 1,
    },
    types: {
      context: {} as screen.Context,
      events: {} as screen.Event,
    },
  }).createMachine({
    context: { error: undefined, waits: 0 },
    id: 'screen',
    initial: 'open',
    states: {
      abandoned: { type: 'final' },
      open: {
        invoke: {
          id: 'show',
          onDone: { target: 'resolved' },
          onError: {
            actions: {
              params: (args) => ({ error: args.event.error }),
              type: 'fail',
            },
            target: 'rejected',
          },
          src: 'show',
        },
        on: {
          'call.join': { actions: 'join' },
          'call.leave': [
            { actions: 'leave', guard: 'last', target: 'abandoned' },
            { actions: 'leave' },
          ],
        },
      },
      rejected: { type: 'final' },
      resolved: { type: 'final' },
    },
  })

  export declare namespace screen {
    /** The machine's context. */
    type Context = {
      /** The error that the screen rejected with. `undefined` before a rejection. */
      error: unknown
      /** The count of calls that wait on the screen. */
      waits: number
    }

    /** An event of a screen. */
    type Event =
      | {
          /** A call started its wait on the screen. */
          type: 'call.join'
        }
      | {
          /** The signal of a call that waits on the screen aborted. */
          type: 'call.leave'
        }

    /** A running machine. */
    type Actor = ActorRefFrom<typeof screen>

    /** A snapshot of the machine. */
    type Snapshot = SnapshotFrom<typeof screen>
  }

  /** Returns whether the screen resolved, so a call that waits on it sends again. */
  export function resolved(snapshot: screen.Snapshot) {
    return snapshot.matches('resolved')
  }

  /** Returns whether the screen closed: it resolved, it rejected, or each call left it. */
  export function settled(snapshot: screen.Snapshot) {
    return !snapshot.matches('open')
  }
}
