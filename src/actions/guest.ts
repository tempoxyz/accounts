/**
 * Guest payments: a visitor without a Tempo ID sign-in pays in MACH from a guest account, a root
 * Tempo Account whose owner is a non-extractable WebCrypto P256 key pair in the instance's store.
 * Tempo ID's purchase page sells the MACH that the guest account lacks, with Apple Pay or Google
 * Pay, and Tempo ID's sponsor pays the network fee of each payment.
 * @module
 */
import { Address, Hex, PublicKey, WebCryptoP256 } from 'ox'
import { TxEnvelopeTempo } from 'ox/tempo'
import {
  createClient,
  formatUnits,
  http,
  parseUnits,
  type Transport,
} from 'viem'
import { token as TokenActions } from 'viem/tempo/actions'
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
 * The RPC URL of each chain of a guest payment, by ID: Tempo mainnet, where Tempo ID sells MACH,
 * and a local Tempo node, which Tempo ID's test suite runs, as `viem/tempo/chains` names them. A
 * chain definition there adds Viem's Tempo formatters to the instance's bundle, so the action names
 * the URLs.
 */
const rpcUrls: Readonly<Record<number, string>> = {
  [Chains.devIds.localnet]: 'http://localhost:8545',
  [Chains.ids.mainnet]: 'https://rpc.tempo.xyz',
}

/** MACH, the only token of a guest payment, at the address that `Permissions` lists for it. */
const mach = {
  address: '0x20c000000000000000000000f37de3740adec032',
  decimals: 6,
} as const

/** The most reads of the guest account's balance after a purchase. */
const pollAttempts = 30

/** Milliseconds between two reads of the guest account's balance after a purchase. */
const pollInterval = 1_000

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
  await storeOf(auth).removeItem(keyOf(auth))
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
 * The action reads the guest account's MACH balance beside Tempo ID's preparation of the transfer,
 * whose fee Tempo ID's sponsor pays. A new guest account holds no MACH, so it reads neither. If the
 * balance is below `amount`, Tempo ID's purchase page opens in a popup, and sells the MACH that the
 * account lacks with Apple Pay or Google Pay: at least 5 MACH, and at most 100 MACH. Outside a user
 * gesture, a dialog offers the popup, and its Continue opens it. Once the balance holds `amount`,
 * the transfer prepares again. The action checks that the prepared transaction makes the requested
 * transfer and nothing else, signs it with the key pair, and Tempo ID sends it. The action resolves
 * once the chain includes the transfer. A prepared transfer stays valid for about 4 minutes.
 *
 * @throws {RequestError} With the reason `invalid_field` for an `amount`, a `to`, or a `memo` that
 *   `Actions.account.pay` refuses, `invalid_chain` for a chain other than Tempo mainnet or a local
 *   Tempo node, and `unsupported_token` for a token other than MACH, each before any request.
 *   `access_denied` for a Cancel on the purchase page. `invalid_request` with the field
 *   `transaction` for a prepared transaction that makes anything but the requested transfer, which
 *   the key pair never signs. When Tempo ID refuses the request, with one of these `reason` values,
 *   which [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md) describes:
 *   - `insufficient_balance`: The guest account holds less MACH than `amount`. The action also throws
 *     it when the purchased MACH does not reach the account within 30 seconds.
 *   - `invalid_field`: A field of the request is malformed, or the signed transaction is not the
 *     prepared transfer.
 *   - `invalid_chain`: Tempo ID sells no MACH on the chain.
 *   - `cross_site_request`: The page is on no origin of the app's registered redirect URIs.
 *   - `rejected`: Tempo ID knows no app of the instance's client ID, or the app is disabled.
 *   - `recipient_not_permitted`: MACH's transfer policy does not permit `to`.
 *   - `rate_limited`: The page's address or the guest account exceeded the limit of guest payments.
 *     Retry after `Retry-After` seconds.
 *   - `payment_reverted`: The chain reverted the transfer.
 *   - `upstream_unavailable`: The chain failed. Retry later.
 * @throws {AccountActions.PageRequiredError} Outside a browser page, when the guest account holds
 *   less than `amount`, since the purchase page opens only from a page.
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
  const rpcUrl = rpcUrls[chainId]
  if (!rpcUrl)
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

  const { created, keyPair } = await load(store, { key: keyOf(auth) })
  const address = Address.fromPublicKey(keyPair.publicKey, { checksum: true })
  const client = createClient({
    transport: options.transport ?? http(rpcUrl),
  })
  const required = parseUnits(amount, mach.decimals)
  /** Returns the guest account's MACH balance, in base units. */
  const balance = async () =>
    (
      await TokenActions.getBalance(client, {
        account: address,
        decimals: mach.decimals,
        token: mach.address,
      })
    ).amount
  /** Returns the transfer that Tempo ID prepares, once it passes the check. */
  const prepare = async () => {
    const body = await Api.json<{ transaction?: unknown }>(
      await Api.post(auth, '/v1/guest/pay/prepare', {
        credentials: 'omit',
        json: {
          account: address,
          amount,
          chain_id: chainId,
          client_id: auth.clientId,
          ...(memo !== undefined ? { memo } : {}),
          to,
        },
        signal,
      }),
    )
    // The key pair signs only the requested transfer, whatever Tempo ID returns.
    return check(body.transaction, { amount: required, chainId, memo, to })
  }
  /**
   * Signs the prepared transfer with the key pair, as the root account of its public key, and
   * resolves once Tempo ID sends it. The transfer keeps the sponsor's marker.
   */
  const send = async (envelope: TxEnvelopeTempo.TxEnvelopeTempo) => {
    const signature = await WebCryptoP256.sign({
      payload: TxEnvelopeTempo.getSignPayload(envelope),
      privateKey: keyPair.privateKey,
    })
    const signed = TxEnvelopeTempo.serialize(envelope, {
      signature: {
        prehash: true,
        publicKey: keyPair.publicKey,
        signature,
        type: 'p256',
      },
    })
    const body = await Api.json<{ transaction?: unknown }>(
      await Api.post(auth, '/v1/guest/pay/send', {
        credentials: 'omit',
        json: {
          chain_id: chainId,
          client_id: auth.clientId,
          transaction: signed,
        },
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

  // A new guest account holds no MACH, so it reads no balance. Otherwise the transfer prepares
  // beside the read, and a balance below the amount discards it.
  const [held, prepared] = created
    ? [0n, undefined]
    : await Promise.all([
        balance(),
        prepare().catch((error: unknown) => ({ error })),
      ])
  if (held >= required && prepared) {
    if ('error' in prepared) throw prepared.error
    return await send(prepared)
  }

  await buy(auth, {
    account: address,
    amount: formatUnits(required - held, mach.decimals),
    chainId,
    redirectUri: options.redirectUri,
    signal,
  })
  // The purchase page returns once the chain holds the purchase, so the first read usually holds
  // it. A node behind the page's node reads it a block later.
  for (let attempt = 1; (await balance()) < required; attempt++) {
    if (attempt >= pollAttempts)
      throw new RequestError({
        code: 'invalid_request',
        field: 'account',
        message:
          'Insufficient balance: the purchased MACH did not reach the guest account. Pay again once it arrives.',
        reason: 'insufficient_balance',
        status: 0,
      })
    await delay(pollInterval, { signal })
  }
  return await send(await prepare())
}

export declare namespace pay {
  type Options = Pick<
    AccountActions.pay.Options,
    'amount' | 'chainId' | 'memo' | 'redirectUri' | 'signal' | 'to' | 'token'
  > & {
    /**
     * The transport of the reads of the guest account's balance. Defaults to the RPC of the
     * payment's chain.
     */
    transport?: Transport | undefined
  }

  type ReturnType = {
    /** The guest account that paid. */
    address: `0x${string}`
    /** The hash of the transaction that holds the transfer. */
    transaction: `0x${string}`
  }
}

/**
 * Opens Tempo ID's purchase page for the guest account in a popup, and resolves once the page
 * returns the account. The popup opens within the gesture, or else from the Continue of a dialog.
 * Throws the page's refusal or Cancel as `RequestError`, and a close of the popup or the dialog as
 * an `AbortError`.
 */
async function buy(auth: Config, options: buy.Options): Promise<void> {
  const { account, signal } = options
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

  const url = new URL('/pay/guest', auth.url)
  url.search = new URLSearchParams({
    account,
    amount: options.amount,
    chain_id: String(options.chainId),
    client_id: auth.clientId,
    display: 'popup',
    redirect_uri: redirectUri,
  }).toString()
  // A popup blocker accepts `window.open` only within the gesture, which the reads before the
  // purchase can outlast.
  const popup = Popup.activated()
    ? Popup.openPopup(url.href)
    : await offer(url.href, { signal })
  if (popup === null) throw new AccountActions.BlockedError()

  const returned = await watch(auth, { popup, signal })
  const refusal = Callback.error(returned, { redirectUri })
  if (refusal) throw refusal
  const value = Callback.parameter(returned, { name: 'account', redirectUri })
  if (
    value === undefined ||
    !Address.validate(value, { strict: false }) ||
    !Address.isEqual(value, account)
  )
    throw new RequestError({
      code: 'invalid_request',
      field: 'account',
      message:
        'Invalid `account` in the return URL: it is missing, or names another account than the guest account. Try again.',
      status: 0,
    })
}

declare namespace buy {
  type Options = {
    /** The guest account's address. */
    account: `0x${string}`
    /** The MACH that the guest account lacks, as a decimal string in whole units. */
    amount: string
    /** The payment's chain. */
    chainId: number
    /** The registered redirect URI that the page returns to. Defaults to the instance's. */
    redirectUri: string | undefined
    /** Rejects with the signal's reason, and closes the popup or the dialog. */
    signal: AbortSignal | undefined
  }
}

/**
 * Returns `value`, a transaction that Tempo ID prepared, as a Tempo envelope to sign, if it makes
 * the requested transfer of MACH and nothing else, and Tempo ID's sponsor pays its fee. The sender
 * is the account that signs it, so the check reads no sender.
 */
function check(
  value: unknown,
  options: check.Options,
): TxEnvelopeTempo.TxEnvelopeTempo {
  const refused = (fault: string) =>
    new RequestError({
      code: 'invalid_request',
      field: 'transaction',
      message: `Invalid prepared transaction: ${fault} The guest account signs only the requested transfer. Try again.`,
      status: 0,
    })
  if (
    typeof value !== 'string' ||
    !Hex.validate(value) ||
    !value.startsWith('0x76')
  )
    throw refused('it is no Tempo transaction.')
  const envelope = (() => {
    try {
      return TxEnvelopeTempo.deserialize(value as TxEnvelopeTempo.Serialized)
    } catch {
      throw refused('it is no Tempo transaction.')
    }
  })()

  const expected = TokenActions.transfer.call({
    amount: options.amount,
    memo: options.memo,
    to: options.to,
    token: mach.address,
  })
  const [call, ...rest] = envelope.calls ?? []
  if (envelope.chainId !== options.chainId)
    throw refused('it is for another chain.')
  if (!call || rest.length > 0) throw refused('it makes more than one call.')
  if (
    !call.to ||
    !Address.isEqual(call.to, expected.to) ||
    (call.value ?? 0n) !== 0n ||
    call.data?.toLowerCase() !== expected.data.toLowerCase()
  )
    throw refused('its call is not the requested transfer.')
  if (envelope.keyAuthorization || envelope.authorizationList?.length)
    throw refused('it changes the account.')
  // The sponsor's marker, so the guest account pays no fee from its MACH.
  if (envelope.feePayerSignature !== null)
    throw refused('no sponsor pays its fee.')
  if (envelope.signature) throw refused('it holds a signature.')
  return envelope
}

declare namespace check {
  type Options = {
    /** The amount of the transfer, in base units. */
    amount: bigint
    /** The payment's chain. */
    chainId: number
    /** The transfer's memo, as hex. Absent for a transfer without one. */
    memo: `0x${string}` | undefined
    /** The recipient's address. */
    to: `0x${string}`
  }
}

/** Returns the error of a close of the purchase page or of its dialog. */
function closed() {
  return new DOMException('The user closed the purchase.', 'AbortError')
}

/** Resolves after `ms` milliseconds, or rejects with the signal's reason once it aborts. */
function delay(ms: number, options: { signal: AbortSignal | undefined }) {
  const { signal } = options
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted()
    const abort = () => {
      clearTimeout(timeout)
      reject(signal?.reason)
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Returns the store's entry of the guest account. A guest account belongs to one deployment and
 * app. The JSON tuple keeps the entry unique, since an origin and a client ID can both hold a colon.
 */
function keyOf(auth: Config) {
  return `tempo-id:guest:${JSON.stringify([new URL(auth.url).origin, auth.clientId])}`
}

/**
 * Returns the guest account's key pair, or creates and saves one, and whether it created it. Web
 * Locks, or else the store's `lock`, serialize the calls, so two tabs keep one guest account. A
 * refused read or write throws, so no new key pair replaces a stored one, and no purchase pays a key
 * pair that the store lost.
 */
async function load(store: Store, options: { key: string }) {
  const run = async () => {
    const held = await read(store, options)
    if (held) return { created: false, keyPair: held }
    const keyPair = await WebCryptoP256.createKeyPair()
    await store.setItem(options.key, keyPair)
    return { created: true, keyPair }
  }
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
    ?.locks
  // The lock's name is no entry of the store, so a store that locks each entry never waits for the
  // lock that its caller holds.
  if (locks) return await locks.request(`${options.key}:exclusive`, run)
  if (store.lock) return await store.lock(`${options.key}:exclusive`, run)
  return await run()
}

/**
 * Offers the popup in a dialog, for a call outside a user gesture, and resolves with the popup that
 * the Continue of the dialog opens, or `null` when the browser blocks it.
 */
async function offer(
  url: string,
  options: { signal: AbortSignal | undefined },
) {
  const { signal } = options
  const Sheet = await import('../internal/Sheet.js')
  signal?.throwIfAborted()
  return await new Promise<Window | null>((resolve, reject) => {
    const abort = () => {
      close()
      reject(signal?.reason)
    }
    const close = Sheet.prompt({
      label: 'Buy MACH with Tempo',
      onCancel: () => {
        close()
        signal?.removeEventListener('abort', abort)
        reject(closed())
      },
      onContinue: () => {
        close()
        signal?.removeEventListener('abort', abort)
        resolve(Popup.openPopup(url))
      },
      text: 'Continue in a Tempo ID window to buy MACH.',
    })
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Returns the guest account's key pair from the store, or `undefined` without one. Throws for a
 * value that is no key pair, which the action never replaces.
 */
async function read(store: Store, options: { key: string }) {
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

/**
 * Resolves with the return URL that the purchase page in `options.popup` posts, and closes the
 * popup. While the popup is open, a dialog on the page names the window.
 */
async function watch(auth: Config, options: watch.Options): Promise<URL> {
  const { popup, signal } = options
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
          unblock = Sheet.waiting({ onCancel: () => reject(closed()), popup })
        },
        () => undefined,
      )
      abort = () => reject(signal?.reason)
      signal?.addEventListener('abort', abort, { once: true })
      unwatch = Popup.watchPopup(popup, {
        onCallback: (value) => {
          // The purchase page posts only its return URL, so any other message ends the call.
          if (!('url' in value))
            return reject(
              new RequestError({
                code: 'invalid_request',
                message:
                  'Invalid return: the purchase page posted no return URL. Try again.',
                status: 0,
              }),
            )
          try {
            resolve(Callback.url(value.url))
          } catch (error) {
            reject(error)
          }
        },
        onClose: () => reject(closed()),
        onClosed: () => unblock?.(),
        origin: new URL(auth.url).origin,
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

declare namespace watch {
  type Options = {
    /** The popup that holds the purchase page. */
    popup: Window
    /** Rejects with the signal's reason, and closes the popup. */
    signal: AbortSignal | undefined
  }
}
