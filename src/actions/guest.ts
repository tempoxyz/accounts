/**
 * Guest payments: a visitor without a Tempo ID sign-in pays in MACH from a guest account, a root
 * Tempo Account whose owner is a non-extractable WebCrypto P256 key pair in the instance's store.
 * The guest account signs each transfer itself, and Tempo ID's sponsor pays its network fee. Tempo
 * ID's purchase page sells the MACH that the guest account lacks, with Apple Pay, Google Pay, or a
 * card, and sends the payment.
 * @module
 */
import { Address, Hex, PublicKey, WebCryptoP256 } from 'ox'
import { TxEnvelopeTempo } from 'ox/tempo'
import { maxUint256, parseUnits } from 'viem'
import { token as TokenActions } from 'viem/tempo/actions'
import {
  type ActorRefFrom,
  assertEvent,
  assign,
  createActor,
  fromCallback,
  type SnapshotFrom,
  setup,
  waitFor,
} from 'xstate'
import { type Config, RequestError } from '../Accounts.js'
import * as Api from '../internal/Api.js'
import * as Callback from '../internal/Callback.js'
import * as Chains from '../internal/Chains.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Payment from '../internal/Payment.js'
import * as Popup from '../internal/Popup.js'
import type { Store } from '../Store.js'
import * as AccountActions from './account.js'

/**
 * The chains of a guest payment: Tempo mainnet, where Tempo ID sells MACH, and a local Tempo node,
 * which Tempo ID's test suite runs.
 */
const chainIds: readonly number[] = [Chains.devIds.localnet, Chains.ids.mainnet]

/**
 * The fee caps and the gas limit of each guest payment. Tempo ID refuses a transaction above
 * `guestMaxFeePerGas`, `guestMaxPriorityFeePerGas`, or `guestGas` of `src/internal/Guest.ts` in
 * `tempoxyz/id`, so these values never exceed them. The gas limit covers `transferWithMemo` of MACH
 * with a margin. Tempo ID's sponsor pays the fee, so the guest account holds only the amount.
 */
const fees = {
  gas: 100_000n,
  maxFeePerGas: 40_000_000_000n,
  maxPriorityFeePerGas: 0n,
} as const

/** MACH, the only token of a guest payment, at the address that `Permissions` lists for it. */
const mach = {
  address: '0x20c000000000000000000000f37de3740adec032',
  decimals: 6,
} as const

/**
 * Seconds from the signature to the end of a transaction's validity, its `validBefore`. Tempo ID
 * admits a `validBefore` more than 10 seconds and at most 290 seconds ahead of its clock, so 60
 * seconds leaves 50 seconds of skew on each side, and a send that outlasts it fails.
 */
const validity = 60

/**
 * Forgets the instance's guest account: removes its key pair from the store. The next guest payment
 * creates a new guest account. The MACH that the forgotten guest account holds stays on its address,
 * and no key signs for it again.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * await Actions.guest.disconnect(accounts.config)
 * ```
 */
export async function disconnect(auth: Config): Promise<void> {
  const store = storeOf(auth)
  const key = keyOf(auth)
  // The removal waits for a creation in progress, which would otherwise save the key pair after it.
  await exclusive(store, { key }, () => store.removeItem(key))
}

/**
 * Returns the address of the instance's guest account, or `undefined` before a guest payment creates
 * one. The read creates no guest account.
 *
 * @throws {Error} For a value at the guest account's entry of the store that is no key pair.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const address = await Actions.guest.get(accounts.config)
 * ```
 */
export async function get(auth: Config): Promise<get.ReturnType> {
  const keyPair = await read(storeOf(auth), { key: keyOf(auth) })
  return keyPair && Address.fromPublicKey(keyPair.publicKey, { checksum: true })
}

export declare namespace get {
  /** The guest account's address, or `undefined` without a guest account. */
  type ReturnType = `0x${string}` | undefined
}

/**
 * Pays `amount` of MACH to `to` from the instance's guest account, which the first call creates: a
 * non-extractable WebCrypto P256 key pair that the instance's store keeps, whose address is a root
 * Tempo Account. The guest account pays every later guest payment while the store keeps it.
 *
 * A guest account that the store keeps signs the transfer with no read, and sends it to Tempo ID in
 * one request, `POST /v1/guest/pay`. Tempo ID checks it, its sponsor pays the fee, and it answers
 * once the chain includes the transfer. The transaction stays valid for 60 seconds.
 *
 * A new guest account, or a send that Tempo ID refuses with `insufficient_balance`, opens Tempo ID's
 * purchase page in a popup. The page receives the key pair through a message to the popup, which
 * keeps it non-extractable. The page checks the payment, sells the MACH that the guest account
 * lacks with Apple Pay, Google Pay, or a card, then signs and sends the transfer. Outside a user
 * gesture, a dialog offers the popup, and its Continue opens it. The send is a request, so a
 * gesture that expires while it runs also gets the dialog.
 *
 * @throws {RequestError} With the reason `invalid_field` for an `amount`, a `to`, or a `memo` that
 *   `Actions.account.pay` refuses, `invalid_chain` for a chain other than Tempo mainnet or a local
 *   Tempo node, and `unsupported_token` for a token other than MACH, each before any request.
 *   `invalid_request` with the field `store` in a browser page for a store that sets `local`, such
 *   as `Store.memory`, before the guest account is created, since a page load loses the guest
 *   account and its MACH. `access_denied` for a Cancel on the purchase page. When Tempo ID or its
 *   purchase page refuses the payment, with one of these `reason` values, which
 *   [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
 *   - `insufficient_balance`: Outside a page, the guest account holds less MACH than `amount`.
 *   - `invalid_field`: A field of the request is malformed, such as a chain where Tempo ID sells no
 *     MACH, or a transaction that expired before Tempo ID checked it.
 *   - `cross_site_request`: The request holds no origin of the app's registered redirect URIs.
 *   - `rejected`: Tempo ID knows no app of the instance's client ID, or the app is disabled.
 *   - `recipient_not_permitted`: MACH's transfer policy does not permit `to`.
 *   - `rate_limited`: The page's address or the guest account exceeded the limit of guest payments.
 *     Retry after `Retry-After` seconds.
 *   - `payment_pending`: The chain did not include the transfer in time. Check the guest account on
 *     the chain before a new payment.
 *   - `payment_reverted`: The chain reverted the transfer.
 *   - `upstream_unavailable`: The chain failed. Retry later.
 * @throws {AccountActions.PageRequiredError} Outside a browser page, for a new guest account, and
 *   when Tempo ID refuses the send with `insufficient_balance`, since the purchase page opens only
 *   from a page.
 * @throws {AccountActions.OriginError} For a redirect URI on another origin than the page.
 * @throws {AccountActions.BlockedError} When the browser blocks the popup.
 * @throws {TypeError} For a store that keeps each value as JSON, such as `Store.redis`.
 * @throws {Error} Without a store, such as outside a browser without `store`.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * button.onclick = async () => {
 *   const { address, transaction } = await Actions.guest.pay(accounts.config, {
 *     amount: '12.5',
 *     memo: 'order-123',
 *     to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
 *     token: 'mach',
 *   })
 * }
 * ```
 */
export async function pay(
  auth: Config,
  options: pay.Options,
): Promise<pay.ReturnType> {
  const { signal, to, token } = options
  const amount = Payment.amount(options.amount)
  Payment.to(to)
  const memo =
    options.memo === undefined ? undefined : Payment.memo(options.memo)
  const chainId = options.chainId ?? auth.chainId
  if (!chainIds.includes(chainId))
    throw new RequestError({
      code: 'invalid_request',
      field: 'chainId',
      message: `Invalid \`chainId\`: a guest payment runs only on chain ${Chains.ids.mainnet}, not on ${chainId}. Pay on chain ${Chains.ids.mainnet}, or sign the user in.`,
      reason: 'invalid_chain',
      status: 0,
    })
  if (
    token.toLowerCase() !== 'mach' &&
    !(
      Address.validate(token, { strict: false }) &&
      Address.isEqual(token, mach.address)
    )
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'token',
      message: `Invalid \`token\`: a guest payment pays only in MACH, not in ${token}. Pass \`'mach'\`, or sign the user in.`,
      reason: 'unsupported_token',
      status: 0,
    })
  signal?.throwIfAborted()
  const store = storeOf(auth)
  // A page load empties a store that only the page holds, and with it the guest account and the MACH
  // that a purchase sends to it. Outside a page, no purchase page opens, so such a store only pays
  // from the balance that the guest account holds.
  if (store.local && typeof document !== 'undefined')
    throw new RequestError({
      code: 'invalid_request',
      field: 'store',
      message:
        'Invalid store: it holds its values only in this page, and a page load loses the guest account and its MACH. Keep the guest account in a store that persists across page loads, such as the default.',
      status: 0,
    })

  // The dialogs' chunk loads beside the key pair and the send, so a purchase that follows opens its
  // popup with no further wait, within the gesture where it lasts. `buy` loads it again if this
  // load fails.
  if (typeof document !== 'undefined')
    void import('../internal/Sheet.js').catch(() => undefined)
  const { created, keyPair } = await load(store, { key: keyOf(auth) })
  const payment = {
    address: Address.fromPublicKey(keyPair.publicKey, { checksum: true }),
    amount,
    chainId,
    keyPair,
    memo,
    signal,
    to,
  }

  // A new guest account holds no MACH, so it sends nothing before the purchase page.
  if (!created) {
    const sent = await send(auth, payment).catch((error: unknown) => ({
      error,
    }))
    if (!('error' in sent)) return sent
    // A purchase fixes only a refusal for the balance.
    if (
      !(sent.error instanceof RequestError) ||
      sent.error.reason !== 'insufficient_balance'
    )
      throw sent.error
  }
  return await buy(auth, { ...payment, redirectUri: options.redirectUri })
}

export declare namespace pay {
  type Options = Pick<
    AccountActions.pay.Options,
    'amount' | 'chainId' | 'memo' | 'redirectUri' | 'signal' | 'to' | 'token'
  >

  type ReturnType = {
    /** The guest account that paid. */
    address: `0x${string}`
    /** The hash of the transaction that holds the transfer. */
    transaction: `0x${string}`
  }
}

/**
 * Pays on Tempo ID's purchase page, which buys the MACH that the guest account lacks, then signs and
 * sends the transfer with the key pair. {@link machines.purchase} runs the page, and this function
 * provides its effects: the popup within the gesture, or else from the Continue of a dialog, the
 * dialog that names the popup's window, and the key pair for the page. Throws the page's refusal
 * or Cancel as `RequestError`, and a close of the popup or the dialog as an `AbortError`.
 */
async function buy(
  auth: Config,
  options: buy.Options,
): Promise<pay.ReturnType> {
  const { address, keyPair, signal } = options
  // React Native defines `window` without `location`, so the check reads `document`.
  if (typeof document === 'undefined')
    throw new AccountActions.PageRequiredError({ guest: true })
  const redirectUri =
    options.redirectUri ?? auth.redirectUri ?? `${window.location.origin}/`
  // Tempo ID posts the return only to the redirect URI's origin.
  if (new URL(redirectUri).origin !== window.location.origin)
    throw new AccountActions.OriginError({
      origin: window.location.origin,
      redirectUri,
    })

  const origin = new URL(auth.url).origin
  const url = new URL('/pay/guest', auth.url)
  url.search = new URLSearchParams({
    account: address,
    amount: options.amount,
    chain_id: String(options.chainId),
    client_id: auth.clientId,
    display: 'popup',
    ...(options.memo !== undefined ? { memo: options.memo } : {}),
    redirect_uri: redirectUri,
    to: options.to,
  }).toString()
  // The dialogs' module loads from a chunk of its own, as `funding.open` loads it. It loads before
  // the purchase starts, so the popup and its dialog open in one step. A gesture that expires
  // meanwhile gets the dialog that offers the popup. The page reads the guest account's address
  // from the public key, which the store keeps as a point, so it moves as a `CryptoKey`.
  const [Sheet, publicKey] = await Promise.all([
    import('../internal/Sheet.js'),
    crypto.subtle.importKey(
      'raw',
      new Uint8Array(PublicKey.toBytes(keyPair.publicKey)),
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify'],
    ),
  ])
  const actor = createActor(
    machines.purchase.provide({
      actors: {
        offer: fromCallback<machines.purchase.Event>((args) =>
          Sheet.prompt({
            label: 'Buy MACH with Tempo',
            onCancel: () => args.sendBack({ type: 'offer.cancel' }),
            // The machine opens the popup in the transition of this event, within the click.
            onContinue: () => args.sendBack({ type: 'offer.continue' }),
            text: 'Continue in a Tempo ID window to buy MACH.',
          }),
        ),
        popup: fromCallback<machines.purchase.Event>((args) => {
          const popup = Popup.openPopup(url.href)
          if (popup === null) {
            args.sendBack({ type: 'popup.blocked' })
            return undefined
          }
          // The page asks for the key pair once it can take it, and again after a reload. Only
          // Tempo ID's page in this popup receives it, and structured cloning keeps the private
          // key non-extractable.
          const handOff = (event: MessageEvent) => {
            if (event.origin !== origin || event.source !== popup) return
            if (
              (event.data as { type?: unknown } | null)?.type !==
              'tempo-id:guest.ready'
            )
              return
            popup.postMessage(
              {
                keyPair: { privateKey: keyPair.privateKey, publicKey },
                type: 'tempo-id:guest.key',
              },
              origin,
            )
          }
          window.addEventListener('message', handOff)
          const unblock = Sheet.waiting({
            onCancel: () => args.sendBack({ type: 'dialog.cancel' }),
            popup,
          })
          const unwatch = Popup.watchPopup(popup, {
            onCallback: (value) =>
              args.sendBack(returned(value, { address, redirectUri })),
            onClose: () => args.sendBack({ type: 'popup.close' }),
            // The page takes input again once the popup closes, while a late return can still arrive.
            onClosed: unblock,
            origin,
          })
          return () => {
            window.removeEventListener('message', handOff)
            unblock()
            unwatch()
            popup.close()
          }
        }),
      },
    }),
  ).start()
  const abort = () => actor.send({ type: 'purchase.abort' })
  signal?.addEventListener('abort', abort, { once: true })

  try {
    // An abort event never repeats for a later listener, so a signal that aborted before, such as
    // during the creation of the key pair or the send, ends the purchase before the popup opens.
    if (signal?.aborted) abort()
    else actor.send({ activated: Popup.activated(), type: 'purchase.start' })
    const snapshot = await waitFor(
      actor,
      (snapshot) => snapshot.status === 'done',
    )
    const { error, transaction } = snapshot.context
    const status = machines.status(snapshot)
    if (status === 'paid' && transaction) return { address, transaction }
    if (status === 'aborted') throw signal?.reason
    if (status === 'blocked') throw new AccountActions.BlockedError()
    if (status === 'cancelled') throw closed()
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    actor.stop()
  }
}

declare namespace buy {
  type Options = send.Options & {
    /** The registered redirect URI that the page returns to. Defaults to the instance's. */
    redirectUri: string | undefined
  }
}

/** Returns the error of a close of the purchase page or of its dialog. */
function closed() {
  return new DOMException('The user closed the purchase.', 'AbortError')
}

/**
 * Returns the store's entry of the guest account. A guest account belongs to one deployment and
 * app. The JSON tuple keeps the entry unique, since an origin and a client ID can both hold a colon.
 */
function keyOf(auth: Config) {
  return `tempo-id:guest:${JSON.stringify([new URL(auth.url).origin, auth.clientId])}`
}

/**
 * Runs `fn` while it holds the guest account's lock: a Web Lock, or else the store's `lock`. The
 * creation and the removal of the guest account's key pair hold it, so neither undoes the other.
 */
async function exclusive<value>(
  store: Store,
  options: exclusive.Options,
  fn: () => Promise<value>,
): Promise<value> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
    ?.locks
  // The lock's name is no entry of the store, so a store that locks each entry never waits for the
  // lock that its caller holds.
  if (locks) return await locks.request(`${options.key}:exclusive`, fn)
  if (store.lock) return await store.lock(`${options.key}:exclusive`, fn)
  return await fn()
}

declare namespace exclusive {
  type Options = {
    /** The store's entry of the guest account. */
    key: string
  }
}

/**
 * Returns the guest account's key pair, or creates and saves one, and whether it created it. Web
 * Locks, or else the store's `lock`, serialize the calls, so two tabs keep one guest account. A
 * refused read or write throws, so no new key pair replaces a stored one, and no purchase pays a key
 * pair that the store lost.
 */
async function load(store: Store, options: load.Options) {
  const run = async () => {
    const held = await read(store, options)
    if (held) return { created: false, keyPair: held }
    const keyPair = await WebCryptoP256.createKeyPair()
    await store.setItem(options.key, keyPair)
    return { created: true, keyPair }
  }
  return await exclusive(store, options, run)
}

declare namespace load {
  type Options = {
    /** The store's entry of the guest account. */
    key: string
  }
}

/**
 * Returns the guest account's key pair from the store, or `undefined` without one. Throws for a
 * value that is no key pair, which the action never replaces.
 */
async function read(store: Store, options: read.Options) {
  const value = await store.getItem(options.key)
  if (value === undefined || value === null) return undefined
  const keyPair = value as Partial<WebCryptoP256.createKeyPair.ReturnType>
  if (
    typeof CryptoKey !== 'undefined' &&
    keyPair.privateKey instanceof CryptoKey &&
    keyPair.publicKey !== undefined &&
    PublicKey.validate(keyPair.publicKey)
  )
    return keyPair as WebCryptoP256.createKeyPair.ReturnType
  throw new Error(
    'Invalid guest account: its entry of the store holds no key pair. Remove the entry with `guest.disconnect`, then pay again.',
  )
}

declare namespace read {
  type Options = {
    /** The store's entry of the guest account. */
    key: string
  }
}

/**
 * Returns the event of `value`, the message that the purchase page posts: `popup.return` for a
 * return URL that names the guest account and a transaction hash, or `popup.refuse` with the error
 * of any other message. A refusal carries the page's `reason`.
 */
function returned(
  value: Callback.Received,
  options: returned.Options,
): machines.purchase.Event {
  const { address, redirectUri } = options
  try {
    // The purchase page posts only its return URL, so any other message ends the purchase.
    if (!('url' in value))
      throw new RequestError({
        code: 'invalid_request',
        message:
          'Invalid return: the purchase page posted no return URL. Try again.',
        status: 0,
      })
    const url = Callback.url(value.url)
    const parameter = (name: string) =>
      Callback.parameter(url, { name, redirectUri })
    const refusal = Callback.error(url, { redirectUri })
    if (refusal)
      throw new RequestError({
        code: refusal.code,
        message: refusal.message,
        reason: parameter('reason') as RequestError.Reason | undefined,
        status: 0,
        uri: refusal.uri,
      })
    const account = parameter('account')
    if (
      account === undefined ||
      !Address.validate(account, { strict: false }) ||
      !Address.isEqual(account, address)
    )
      throw new RequestError({
        code: 'invalid_request',
        field: 'account',
        message:
          'Invalid `account` in the return URL: it is missing, or names another account than the guest account. Check the guest account on the chain before a new payment.',
        status: 0,
      })
    const transaction = parameter('transaction')
    if (
      transaction === undefined ||
      !Hex.validate(transaction) ||
      Hex.size(transaction) !== 32
    )
      throw new RequestError({
        code: 'invalid_request',
        field: 'transaction',
        message:
          'Invalid `transaction` in the return URL: it is missing, or no transaction hash. Check the guest account on the chain before a new payment.',
        status: 0,
      })
    return { transaction, type: 'popup.return' }
  } catch (error) {
    return { error, type: 'popup.refuse' }
  }
}

declare namespace returned {
  type Options = {
    /** The guest account's address. */
    address: `0x${string}`
    /** The registered redirect URI that the page returns to. */
    redirectUri: string
  }
}

/**
 * Signs the transfer with the key pair, as the root account of its public key, and resolves once
 * Tempo ID sends it, with no read before. The transaction takes an expiring nonce (TIP-1106), so it
 * needs no read of the account's nonce, and holds the sponsor's marker, so the guest account pays no
 * fee.
 */
async function send(
  auth: Config,
  options: send.Options,
): Promise<pay.ReturnType> {
  const { address, chainId, keyPair, signal } = options
  const envelope = TxEnvelopeTempo.from({
    calls: [
      TokenActions.transfer.call({
        amount: parseUnits(options.amount, mach.decimals),
        memo: options.memo,
        to: options.to,
        token: mach.address,
      }),
    ],
    chainId,
    feePayerSignature: null,
    ...fees,
    nonce: 0n,
    nonceKey: maxUint256,
    validBefore: Math.floor(Date.now() / 1000) + validity,
  })
  const signature = await WebCryptoP256.sign({
    payload: TxEnvelopeTempo.getSignPayload(envelope),
    privateKey: keyPair.privateKey,
  })
  const transaction = TxEnvelopeTempo.serialize(envelope, {
    signature: {
      prehash: true,
      publicKey: keyPair.publicKey,
      signature,
      type: 'p256',
    },
  })

  const body = await Api.json<{ transaction?: unknown }>(
    await Api.post(auth, '/v1/guest/pay', {
      credentials: 'omit',
      json: { chain_id: chainId, client_id: auth.clientId, transaction },
      signal,
    }),
  )
  if (
    typeof body.transaction !== 'string' ||
    !Hex.validate(body.transaction) ||
    Hex.size(body.transaction) !== 32
  )
    throw new RequestError({
      code: 'server_error',
      field: 'transaction',
      message:
        'Invalid response: it holds no transaction hash. Check the guest account on the chain before a new payment.',
      status: 0,
    })
  return { address, transaction: body.transaction }
}

declare namespace send {
  type Options = {
    /** The guest account's address. */
    address: `0x${string}`
    /** The amount of the transfer, as a decimal string in whole units. */
    amount: string
    /** The payment's chain. */
    chainId: number
    /** The guest account's key pair. */
    keyPair: WebCryptoP256.createKeyPair.ReturnType
    /** The transfer's memo, as hex. Absent for a transfer without one. */
    memo: `0x${string}` | undefined
    /** Rejects with the signal's reason, and closes the popup or the dialog. */
    signal: AbortSignal | undefined
    /** The recipient's address. */
    to: `0x${string}`
  }
}

/**
 * Returns the instance's store, which keeps the guest account's non-extractable key pair as it is.
 * Throws without one, and for a store that keeps each value as JSON.
 */
function storeOf(auth: Config): Store {
  const store = DefaultStore.get(auth.store)
  if (!store)
    throw new Error(
      'Missing `store`: a guest account needs a store that keeps its key pair, such as IndexedDB in a browser. Pass `store` to the instance.',
    )
  if (store.json)
    throw new TypeError(
      'Invalid `store`: it keeps each value as JSON, which holds no non-extractable key pair. Use a store that keeps values as they are, such as IndexedDB.',
    )
  return store
}

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The payment on Tempo ID's purchase page, which buys the MACH that the guest account lacks, then
   * sends the transfer. The runner provides each effect as an invoked actor, so the exit of its
   * state ends it: `offer` closes the dialog that offers the popup, and `popup` closes the popup and
   * the dialog that names its window. `purchase.abort` ends the purchase in each state, also before
   * its start.
   *
   * | State       | Meaning                                                           |
   * | ----------- | ----------------------------------------------------------------- |
   * | `idle`      | The purchase waits for its start. No effect runs.                 |
   * | `offering`  | Outside a user gesture, a dialog offers the popup.                |
   * | `watching`  | The popup holds the purchase page, and a dialog names its window. |
   * | `paid`      | The page sent the transfer. `context.transaction` holds its hash. |
   * | `cancelled` | The user closed the popup, or selected Cancel on a dialog.        |
   * | `blocked`   | The browser blocked the popup.                                    |
   * | `failed`    | The page refused the payment. `context.error` holds the refusal.  |
   * | `aborted`   | The signal aborted.                                               |
   */
  export const purchase = setup({
    actions: {
      /** Holds the error that ends the purchase. */
      fail: assign((_args, params: { error: unknown }) => ({
        error: params.error,
      })),
      /** Holds the hash of the transaction that the page sent. */
      pay: assign((_args, params: { transaction: `0x${string}` }) => ({
        transaction: params.transaction,
      })),
    },
    actors: {
      /**
       * Shows the dialog that offers the popup, and sends `offer.continue` or `offer.cancel`. Its
       * stop closes the dialog. `guest.ts` provides it.
       */
      offer: fromCallback<purchase.Event>(() => {}),
      /**
       * Opens the popup and the dialog that names its window, hands the key pair to the page, and
       * sends what the popup and the dialog report, or `popup.blocked`. Its stop closes both.
       * `guest.ts` provides it.
       */
      popup: fromCallback<purchase.Event>(() => {}),
    },
    guards: {
      /** Whether the page holds a user gesture, so the popup opens at once. */
      activated: (args) => {
        assertEvent(args.event, 'purchase.start')
        return args.event.activated
      },
    },
    types: {
      context: {} as purchase.Context,
      events: {} as purchase.Event,
    },
  }).createMachine({
    context: { error: undefined, transaction: undefined },
    id: 'purchase',
    initial: 'idle',
    states: {
      aborted: { type: 'final' },
      blocked: { type: 'final' },
      cancelled: { type: 'final' },
      failed: { type: 'final' },
      idle: {
        on: {
          'purchase.abort': 'aborted',
          'purchase.start': [
            { guard: 'activated', target: 'watching' },
            { target: 'offering' },
          ],
        },
      },
      offering: {
        invoke: { src: 'offer' },
        on: {
          'offer.cancel': 'cancelled',
          // The popup opens in this transition, within the click on Continue.
          'offer.continue': 'watching',
          'purchase.abort': 'aborted',
        },
      },
      paid: { type: 'final' },
      watching: {
        invoke: { src: 'popup' },
        on: {
          'dialog.cancel': 'cancelled',
          'popup.blocked': 'blocked',
          'popup.close': 'cancelled',
          'popup.refuse': {
            actions: {
              params: (args) => ({ error: args.event.error }),
              type: 'fail',
            },
            target: 'failed',
          },
          'popup.return': {
            actions: {
              params: (args) => ({ transaction: args.event.transaction }),
              type: 'pay',
            },
            target: 'paid',
          },
          'purchase.abort': 'aborted',
        },
      },
    },
  })

  /** The types of {@link purchase}. */
  export namespace purchase {
    /** The context of the machine. */
    export type Context = {
      /** The error that ends the purchase in `failed`. Absent in every other state. */
      error: unknown
      /** The hash of the transaction that the page sent, in `paid`. Absent in every other state. */
      transaction: `0x${string}` | undefined
    }

    /** An event of the machine. */
    export type Event =
      /** The user selected Cancel on the dialog that names the popup's window, or pressed Escape. */
      | { type: 'dialog.cancel' }
      /** The user selected Cancel on the dialog that offers the popup, or pressed Escape. */
      | { type: 'offer.cancel' }
      /** The user selected Continue on the dialog that offers the popup. */
      | { type: 'offer.continue' }
      /** The browser blocked the popup. */
      | { type: 'popup.blocked' }
      /** The user closed the popup without a return. */
      | { type: 'popup.close' }
      /** The purchase page posted a refusal, or a return without the guest account or a hash. */
      | {
          /** The error that ends the purchase. */
          error: unknown
          type: 'popup.refuse'
        }
      /** The purchase page returned the guest account and the hash of the sent transfer. */
      | {
          /** The hash of the transaction that holds the transfer. */
          transaction: `0x${string}`
          type: 'popup.return'
        }
      /** The signal aborted. */
      | { type: 'purchase.abort' }
      /** The purchase starts. */
      | {
          /** Whether the page holds a user gesture, within which a popup blocker accepts the popup. */
          activated: boolean
          type: 'purchase.start'
        }

    /** A running purchase. */
    export type Actor = ActorRefFrom<typeof purchase>

    /** A snapshot of the purchase. */
    export type Snapshot = SnapshotFrom<typeof purchase>
  }

  /** Returns the status of a purchase: the name of its state. */
  export function status(snapshot: purchase.Snapshot) {
    return snapshot.value
  }
}
