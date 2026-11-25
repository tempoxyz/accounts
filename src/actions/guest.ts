/**
 * The guest account: a root Tempo Account whose owner is a P256 key pair in the instance's store,
 * with no Tempo ID sign-in. A guest session holds its address and public key, and the store keeps
 * the key pair under its own entry. The key pair signs the guest session's transactions, the guest
 * request that opens Tempo ID's payment page, and the one transaction that the page posts back.
 * @module
 */
import {
  Address,
  Base64,
  Bytes,
  Hash,
  Hex,
  P256,
  PublicKey,
  WebCryptoP256,
} from 'ox'
import { SignatureEnvelope, TokenId, TxEnvelopeTempo } from 'ox/tempo'
import { type Client, parseUnits, TransactionReceiptNotFoundError } from 'viem'
import { getTransactionReceipt } from 'viem/actions'
import {
  type ActorRefFrom,
  createActor,
  type SnapshotFrom,
  setup,
  waitFor,
} from 'xstate'
import { Account } from 'viem/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import { type Config, RequestError, SignedOutError } from '../Accounts.js'
import * as Api from '../internal/Api.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Payment from '../internal/Payment.js'
import * as Permissions from '../Permissions.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'

/**
 * A guest payment whose transfer can still land, or whose outcome Tempo ID did not confirm before
 * the call stopped, such as after its connection failed past the transfer's window. The store keeps
 * its checkout, so a later `pay` of the same payment, also from another process, resumes it and pays
 * at most once. `checkout` names it.
 */
export class PendingError extends Error {
  override readonly name = 'Actions.guest.PendingError'
  /** The checkout ID of the unresolved payment, which a later `pay` of the same payment resumes. */
  readonly checkout: string

  constructor(options: { checkout: string }) {
    super(
      `Pending payment: the transfer of checkout ${options.checkout} can still land, or its outcome is unknown. Call \`pay\` again with the same payment, which resumes the checkout and pays at most once.`,
    )
    this.checkout = options.checkout
  }
}

/** The attodollars per gas of a fee that charge one base unit of a TIP-20 fee token of 6 decimals. */
const attodollars = 1_000_000_000_000n

/**
 * The prepares of one guest payment at most. A cost above the quote, `quote_changed`, quotes again
 * before the next prepare, and rejects after the last.
 */
const quoteAttempts = 3

/**
 * The time after a transfer's validity window during which the payment still reads its checkout's
 * status, since a transfer can land in the last block of its window, in milliseconds.
 */
const settleMargin = 60_000

/**
 * The lease of a running payment on its stored checkout, in milliseconds. The call renews it every
 * third of it, and releases it when the call ends. A later call of the same payment waits until the
 * lease is released or expires, such as after the call's process exited.
 */
const leaseDuration = 15_000

/**
 * The time after a transaction's window during which Tempo ID still holds a paid checkout, in
 * milliseconds. Tempo ID keeps a paid checkout at least 24 hours after its receipt, which lands
 * within the window. Within it, Tempo ID's status of an unpaid checkout with no send that can land
 * is final.
 */
const retention = 23 * 60 * 60_000

/** The time between the guest request's signature and its expiry, in seconds. */
const lifetime = 4 * 60

/**
 * The guest account's key pair, as the store keeps it: a non-extractable WebCrypto key pair in a
 * store that keeps values as they are, such as IndexedDB, or a P256 private key in a private store
 * of JSON, such as `Store.file`. No store of JSON holds a `CryptoKey`.
 */
type Key =
  | { keyPair: WebCryptoP256.createKeyPair.ReturnType; type: 'webCrypto' }
  | { privateKey: Hex.Hex; publicKey: PublicKey.PublicKey; type: 'p256' }

/** A P256 private key, as a private store of JSON keeps it. */
type P256Entry = { privateKey: Hex.Hex; type: 'p256' }

/**
 * Returns the Viem account of the guest session `session`, a root account whose key pair signs each
 * transaction, message, and typed data. Each signature reads the key pair from the store, so the
 * session holds no `CryptoKey`. A WebCrypto key pair signs a P256 envelope with `prehash`, since
 * WebCrypto hashes the payload with SHA-256 before it signs.
 *
 * @throws {SignedOutError} At a signature, when the store holds another key pair or none, such as
 *   after `guest.disconnect` in another tab.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const account = Actions.guest.account(accounts.config, { session })
 * ```
 */
export function account(
  auth: Config,
  options: account.Options,
): Account.RootAccount {
  const { session } = options
  const signer = async () => {
    const key = await read(storeOf(auth), { key: keyOf(auth) })
    if (
      !key ||
      PublicKey.toHex(publicKeyOf(key)).toLowerCase() !==
        session.publicKey.toLowerCase()
    )
      throw new SignedOutError()
    return key.type === 'webCrypto'
      ? Account.fromWebCryptoP256(key.keyPair)
      : Account.fromP256(key.privateKey)
  }
  return Account.from({
    keyType: 'p256',
    publicKey: PublicKey.fromHex(session.publicKey),
    sign: async (parameters) => (await signer()).sign(parameters),
  })
}

export declare namespace account {
  type Options = {
    /** The guest session. */
    session: Pick<Session.GuestSession, 'publicKey'>
  }
}

/**
 * Returns whether the instance's session `current` is still the guest session `started`: the same
 * guest account, from the same start. A sign-out, another user, or another start of the guest
 * session, also of the same guest account, ends it, though the store keeps the key pair.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * if (!Actions.guest.active({ current: accounts.session.get(), started }))
 *   throw new Accounts.SignedOutError()
 * ```
 */
export function active(options: active.Options): boolean {
  const { current, started } = options
  return (
    !!current &&
    Session.guest(current) &&
    Session.same(current, started) &&
    current.revision === started.revision
  )
}

export declare namespace active {
  type Options = {
    /** The instance's session now. Absent when it holds none. */
    current: Session.Any | undefined
    /** The guest session that started the action. */
    started: Session.GuestSession
  }
}

/**
 * Returns the canonical terms of a guest payment, under which the store keeps its unresolved
 * checkouts: the chain, the amount in base units, the recipient, the token's address, and the memo,
 * with addresses and hex in lowercase. So `1` and `1.00`, a token's symbol and its address, and hex
 * in any case name one payment. A token that the chain does not list keeps its lowercase symbol.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * Actions.guest.canonical({
 *   amount: '1.00',
 *   chainId: 4217,
 *   to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
 *   token: 'ousd',
 * })
 * ```
 */
export function canonical(options: canonical.Options): string {
  const { chainId, memo } = options
  // Each TIP-20 token has 6 decimals.
  const amount = parseUnits(options.amount, 6).toString()
  const token = (() => {
    if (Address.validate(options.token, { strict: false }))
      return options.token.toLowerCase()
    const [resolved] =
      Permissions.resolve(
        {
          limits: [
            {
              limit: options.amount as `${number}`,
              token: options.token as Permissions.Token,
            },
          ],
        },
        { chainId },
      ).limits ?? []
    return (resolved?.token ?? options.token).toLowerCase()
  })()
  return JSON.stringify([
    chainId,
    amount,
    options.to.toLowerCase(),
    token,
    memo?.toLowerCase() ?? null,
  ])
}

export declare namespace canonical {
  type Options = {
    /** The amount, as a decimal string in whole units of the token. */
    amount: string
    /** The payment's chain. */
    chainId: number
    /** The transfer's memo, as hex. Absent for a transfer without one. */
    memo?: `0x${string}` | undefined
    /** The recipient's address. */
    to: string
    /** The token: its symbol that the chain lists, or the address of any TIP-20 token. */
    token: string
  }
}

/**
 * Returns `value`, a transaction that Tempo ID's page prepared for a guest payment, as a Tempo
 * envelope to sign, if it makes the requested transfer and nothing else. With the sponsor's marker,
 * Tempo ID's sponsor pays its fee. Without it, the guest account pays its fee. The sender is the
 * account that signs it, so the check reads no sender. The check reads no network.
 *
 * @throws {RequestError} `invalid_request` with the field `transaction` for any other value, such
 *   as a transaction on another chain, with another call or more calls, with an access key or an
 *   authorization, with a signature, or with a fee payer's signature.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const envelope = Actions.guest.check(transaction, {
 *   amount: '12.5',
 *   chainId: 4217,
 *   to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
 *   token: 'ousd',
 * })
 * ```
 */
export function check(
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

  // The token's symbol becomes its address on the chain, and the amount its base units. A token's
  // address needs no listing: each TIP-20 token has 6 decimals.
  const limit = (() => {
    if (Address.validate(options.token, { strict: false })) {
      try {
        TokenId.fromAddress(options.token)
      } catch {
        throw refused('its token is no TIP-20 token.')
      }
      return {
        limit: parseUnits(options.amount, 6),
        token: options.token,
      }
    }
    const [resolved] =
      Permissions.resolve(
        {
          limits: [
            {
              limit: options.amount as `${number}`,
              token: options.token as Permissions.Token,
            },
          ],
        },
        { chainId: options.chainId },
      ).limits ?? []
    if (!resolved) throw refused('its token is unknown.')
    return resolved
  })()
  const expected = TokenActions.transfer.call({
    amount: limit.limit,
    ...(options.memo ? { memo: options.memo } : {}),
    to: options.to,
    token: limit.token,
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
  // The sponsor's marker, `null`, or none, where the guest account pays the fee. A fee payer's
  // signature would name a fee payer that Tempo ID's page did not choose.
  if (
    envelope.feePayerSignature !== null &&
    envelope.feePayerSignature !== undefined
  )
    throw refused('it holds a fee payer signature.')
  if (envelope.signature) throw refused('it holds a signature.')
  const { quote } = options
  // A payment that Tempo ID quoted as sponsored keeps the sponsor's marker, so the guest account
  // pays no fee that the quote did not show.
  if (quote?.sponsored && envelope.feePayerSignature !== null)
    throw refused('it drops the sponsor that the quote names.')
  // Without the sponsor's marker, the guest account pays the fee, in the fee token that Tempo ID
  // quoted, or else in a TIP-20 token.
  if (envelope.feePayerSignature === undefined) {
    const expected = quote ? (quote.fee?.token ?? undefined) : undefined
    const valid = (() => {
      if (envelope.feeToken === undefined) return expected === undefined
      try {
        const feeToken = TokenId.toAddress(envelope.feeToken)
        // A token ID always names a TIP-20 address, and an address must hold the TIP-20 prefix.
        TokenId.fromAddress(feeToken)
        return expected === undefined || Address.isEqual(feeToken, expected)
      } catch {
        return false
      }
    })()
    if (!valid) throw refused('its fee token is not the quoted one.')
    // The most that the guest account pays is the gas times the fee cap per gas, in attodollars
    // per gas, which a TIP-20 fee token of 6 decimals charges as 1e12 attodollars per base unit.
    // The guest approved the quoted fee, which Tempo ID's prepare also bounds the fill by.
    if (quote) {
      if (!quote.fee)
        throw refused('the quote names no fee for the guest account.')
      const { gas, maxFeePerGas } = envelope
      if (gas === undefined || maxFeePerGas === undefined)
        throw refused('it names no gas or fee cap.')
      const most = (gas * maxFeePerGas + attodollars - 1n) / attodollars
      if (most > BigInt(quote.fee.amount))
        throw refused('its fee exceeds the quoted fee.')
    }
  }
  return envelope
}

export declare namespace check {
  type Options = {
    /** The amount of the transfer, as a decimal string in whole units, such as `12.5`. */
    amount: string
    /** The payment's chain. */
    chainId: number
    /**
     * The quote of `GET /i/guest/pay` that the transaction fills. With it, a payment quoted as
     * sponsored must keep the sponsor's marker, and a transaction whose fee the guest account pays
     * must name the quoted fee token, and its gas at its fee cap costs at most the quoted fee.
     * Absent, such a transaction names any TIP-20 fee token, at any fee, as on Tempo ID's own
     * payment page.
     */
    quote?:
      | {
          /** The quoted fee, or `null` when Tempo ID knows none. */
          fee: {
            /** The fee, in base units of the fee token. */
            amount: string
            /** The fee token's address, or `null` when the fill names none. */
            token?: `0x${string}` | null | undefined
          } | null
          /** Whether Tempo ID's sponsor pays the fee. */
          sponsored: boolean
        }
      | undefined
    /** The transfer's memo, as hex. Absent for a transfer without one. */
    memo?: `0x${string}` | undefined
    /** The recipient's address. */
    to: `0x${string}`
    /**
     * The token: its symbol that the chain lists, such as `ousd`, or the address of any TIP-20
     * token.
     */
    token: string
  }
}

/**
 * Forgets the instance's guest account: removes its key pair from the store. The next guest session
 * creates a new guest account. The funds of the forgotten guest account stay on its address, and no
 * key signs for it again. The instance's session stays as it is, so call it after a sign-out.
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
 * Removes the unresolved checkout `checkout` of a guest payment from the store, such as after the
 * app confirmed its outcome by hand. A later `pay` of the same payment then neither settles nor
 * waits for it. A checkout that Tempo ID no longer holds, and whose transaction has no known hash,
 * such as a sponsored one, stays in the store until this call, since no read decides it.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * try {
 *   await accounts.pay({ amount: '5', to, token: 'ousd' })
 * } catch (error) {
 *   if (error instanceof Actions.guest.PendingError)
 *     await Actions.guest.forget(accounts.config, {
 *       amount: '5',
 *       checkout: error.checkout,
 *       to,
 *       token: 'ousd',
 *     })
 * }
 * ```
 */
export async function forget(
  auth: Config,
  options: forget.Options,
): Promise<void> {
  const store = storeOf(auth)
  const memo =
    options.memo === undefined ? undefined : Payment.memo(options.memo)
  const key = `${keyOf(auth)}:payment:${canonical({
    amount: Payment.amount(options.amount),
    chainId: options.chainId ?? auth.chainId,
    memo,
    to: Payment.to(options.to),
    token: options.token,
  })}`
  await exclusive(store, { key }, async (check) => {
    const value = ((await store.getItem(key)) ?? {}) as Unresolved
    const next = Object.fromEntries(
      Object.entries(value).filter(([id]) => id !== options.checkout),
    )
    await check?.()
    if (Object.keys(next).length === 0) await store.removeItem(key)
    else await store.setItem(key, next)
  })
}

export declare namespace forget {
  type Options = {
    /** The payment's amount, as a decimal string in whole units of the token. */
    amount: string
    /** The payment's chain. Defaults to the instance's. */
    chainId?: number | undefined
    /** The checkout ID, such as `PendingError`'s `checkout`. */
    checkout: string
    /** The transfer's memo: a string, or hex of at most 32 bytes. Absent, the transfer has none. */
    memo?: string | undefined
    /** The recipient's address. */
    to: string
    /** The token: its symbol that the chain lists, or the address of any TIP-20 token. */
    token: string
  }
}

/**
 * Returns the address of the instance's guest account, or `undefined` before a guest session creates
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
  const key = await read(storeOf(auth), { key: keyOf(auth) })
  return key && Address.fromPublicKey(publicKeyOf(key), { checksum: true })
}

export declare namespace get {
  /** The guest account's address, or `undefined` without a guest account. */
  type ReturnType = `0x${string}` | undefined
}

/** The page of a guest payment that `GET /i/guest/pay` returns, with the fields the payment reads. */
type Quoted = {
  /** Whether the chain's faucet drips the payment's token. */
  faucet: boolean
  /** The network fee, or `null` when Tempo ID knows none. */
  fee: {
    /** The fee, in base units of the fee token, which the prepare names as the approved fee. */
    amount: string
    /** The fee, in whole units of the fee token. */
    formatted: string
    /** The fee token's address, or `null` when the fill names none. */
    token?: `0x${string}` | null | undefined
  } | null
  /** Why no transaction pays, other than a shortfall. */
  refusal: Refusal | null
  /** What the guest account lacks. */
  shortfall: { formatted: string; symbol: string } | null
  /** Whether Tempo ID's sponsor pays the fee. */
  sponsored: boolean
  /** The token's address. */
  token: `0x${string}`
}

/**
 * The unresolved checkouts of one guest payment, by checkout ID, which the store keeps under the
 * payment's terms.
 */
type Unresolved = Record<
  string,
  {
    /** The guest account that pays. */
    address: `0x${string}`
    /**
     * The hash of the checkout's signed transaction, which the chain's receipt names. Absent for a
     * sponsored transaction, whose sponsor's signature gives the transfer that lands another hash.
     */
    hash?: `0x${string}` | undefined
    /**
     * The end of the lease of the call that owns the checkout, in Unix milliseconds. A later call
     * resumes the checkout only after it.
     */
    leaseUntil: number
    /** The end of the prepared transaction's window, in Unix seconds. */
    validBefore: number
  }
>

/** A guest payment's paid checkout, which each route returns for a checkout that paid. */
type Paid = { paid: { transaction: `0x${string}` } }

/** Why Tempo ID refuses a guest payment. */
type Refusal = { error_description: string; reason: string }

/** A refusal of a guest payment, which `GET /i/guest/pay` returns in place of the page. */
type Refused = { cancel: string; refusal: Refusal }

/**
 * Pays from the guest account outside a page, such as in a CLI, through the routes that Tempo ID's
 * payment page calls. It reads the payment, funds a shortfall, prepares the transfer, checks that
 * the prepared transaction makes exactly the requested transfer, signs it with the key pair, and
 * sends it. Each request carries a fresh guest request of one checkout ID for the call, so a
 * repeated send pays once. The guest request names the instance's `redirectUri`, or the empty
 * string, as a device client's does.
 *
 * A shortfall on a chain whose faucet drips the token requests the faucet. Otherwise `fund` shows a
 * funding code, such as the `device` plugin's `fundGuest`, and the call waits for the funds until
 * the code expires.
 *
 * The prepare names the quoted cost: the sponsor, or the fee that the guest account pays. Tempo ID
 * refuses a fill above it with `quote_changed`, and the call quotes again and prepares at the new
 * quote, up to three prepares. The key pair signs only a fill whose fee is within the quote.
 *
 * Before the first send, the store keeps the checkout under the payment's terms: the chain, amount,
 * recipient, token, and memo. A send without an answer repeats until the prepared transaction's
 * window ends. Then {@link settlement} decides from the checkout's status and the chain's receipt:
 * a paid checkout, or a signed transaction whose receipt the chain holds, returns its transaction,
 * and a checkout whose transaction can no longer land is cancelled, which fences it. A later call of
 * the same payment, also in another process, settles each stored checkout the same way before it
 * opens a new one, so each checkout pays at most once. Calls that run at once each keep their own
 * checkout, under a lock that spans the processes on the store, and each changes only its own. A
 * running call holds a lease of 15 seconds on its checkout, which `machines.lease` renews, and a
 * later call of the same payment waits until it is released or expires, then claims the checkout
 * under the lock. A later call rejects with `PendingError` only while Tempo ID still holds the
 * checkout's outcome. After that, a checkout that no read decides stays in the store, blocks no
 * payment, and {@link forget} removes it. The terms compare as {@link canonical} values.
 *
 * @throws {RequestError} With the reason of Tempo ID's refusal, such as `recipient_not_permitted`.
 *   With `insufficient_balance` and status 0 for a shortfall without a faucet or `fund`, after the
 *   funding code expired, or for a new quote with a shortfall. With `quote_changed` when the third
 *   prepare's fill still costs more than its quote.
 * @throws {RequestError} With `invalid_request` at `transaction`, for a prepared transaction other
 *   than the requested transfer, or whose fee exceeds the quoted fee, which the key pair never
 *   signs.
 * @throws {PendingError} When the transfer can still land, or Tempo ID does not confirm its
 *   outcome, 60 seconds after the transaction's window. The store keeps the checkout, which a later
 *   call of the same payment resumes.
 * @throws {SignedOutError} When the store holds another key pair than the session's, or once
 *   `current` no longer holds the session, such as after a sign-out.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const { transaction } = await Actions.guest.pay(accounts.config, {
 *   amount: '5',
 *   session,
 *   to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
 *   token: 'ousd',
 * })
 * ```
 */
export async function pay(
  auth: Config,
  options: pay.Options,
): Promise<pay.ReturnType> {
  const { current, fund, session, signal, token } = options
  const amount = Payment.amount(options.amount)
  const to = Payment.to(options.to)
  const memo =
    options.memo === undefined ? undefined : Payment.memo(options.memo)
  const chainId = options.chainId ?? auth.chainId
  const store = storeOf(auth)
  // The store keeps each unresolved checkout of a payment under its terms, so a later call of the
  // same payment, also in another process, resumes each one, and Tempo ID pays each once.
  const unresolved = `${keyOf(auth)}:payment:${canonical({ amount, chainId, memo, to, token })}`
  /** Returns the stored checkouts of the payment, by checkout ID. */
  const outstanding = async (): Promise<Unresolved> => {
    const value = (await store.getItem(unresolved)) as Unresolved | undefined
    if (!value || typeof value !== 'object') return {}
    return value
  }
  /**
   * Changes the stored checkouts of the payment under the payment's lock, which spans the processes
   * on the store, so two calls that change them at once each keep the other's checkout.
   */
  const record = async (fn: (value: Unresolved) => Unresolved) =>
    exclusive(store, { key: unresolved }, async (check) => {
      const next = fn(await outstanding())
      await check?.()
      if (Object.keys(next).length === 0) await store.removeItem(unresolved)
      else await store.setItem(unresolved, next)
    })
  /** Removes the stored checkout `id`, whose outcome is final, and keeps the others. */
  const forget = (id: string) =>
    record((value) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => key !== id)),
    )
  // One checkout ID for the call, so each retry pays the same checkout, and Tempo ID pays it once.
  // `Bytes.random` needs only `crypto.getRandomValues`, which React Native polyfills, and the
  // URL-safe Base64 holds only letters, digits, `-`, and `_`.
  const checkout = Base64.fromBytes(Bytes.random(16), { pad: false, url: true })
  const redirectUri = auth.redirectUri ?? ''
  const terms = {
    amount,
    chain_id: chainId,
    client_id: auth.clientId,
    ...(memo !== undefined ? { memo } : {}),
    redirect_uri: redirectUri,
    to,
    token,
  }
  const aborted = () =>
    signal?.reason ??
    Object.assign(new Error('The payment was aborted.'), {
      name: 'AbortError',
    })

  /** Throws `SignedOutError` once the instance's session no longer holds the guest session. */
  const held = () => {
    if (current && !active({ current: current(), started: session }))
      throw new SignedOutError()
  }
  /**
   * Signs a fresh guest request of the checkout, which the key pair signs with no request. It names
   * `target`, which defaults to the redirect URI of the payment's routes.
   */
  const guest = async (
    options: { checkout?: string; redirectUri?: string } = {},
  ) => {
    if (signal?.aborted) throw aborted()
    held()
    const { address, value } = await request(auth, {
      chainId,
      checkout: options.checkout ?? checkout,
      redirectUri: options.redirectUri ?? redirectUri,
    })
    if (!Address.isEqual(address, session.address)) throw new SignedOutError()
    // A sign-out during the signature ends the payment too.
    held()
    return value
  }
  /** Sends a request to Tempo ID, and returns its JSON. */
  const send = async <value>(path: string, init: RequestInit) => {
    const response = await (auth.fetch ?? fetch)(new URL(path, auth.url), {
      ...init,
      redirect: 'manual',
      signal: signal ?? null,
    }).catch((error: unknown) => {
      if (signal?.aborted) throw aborted()
      throw new RequestError({
        cause: error,
        code: 'server_error',
        message:
          'The guest payment request received no response. Check the connection, and try again.',
        status: 0,
      })
    })
    return await Api.json<value>(response)
  }
  const post = async <value>(path: string, body: object) =>
    send<value>(path, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
  const quote = async () =>
    send<Paid | Quoted | Refused>(
      `/i/guest/pay?${new URLSearchParams({ ...terms, chain_id: String(chainId), guest: await guest() })}`,
      { method: 'GET' },
    )
  const refused = (refusal: Refusal) =>
    new RequestError({
      code: 'invalid_request',
      message: refusal.error_description,
      reason: refusal.reason as RequestError.Reason,
      status: 0,
    })
  const short = (message: string) =>
    new RequestError({
      code: 'invalid_request',
      message,
      reason: 'insufficient_balance',
      status: 0,
    })

  /** Returns the paid result, and removes the call's checkout, which no later call resumes. */
  const settled = async (transaction: `0x${string}`) => {
    await forget(checkout)
    return { address: session.address, transaction }
  }
  /**
   * Returns what the chain holds of the signed transaction `hash`: its receipt's status, `missing`
   * for no receipt, or `unknown` without a hash, without a client, or after a failed read.
   */
  const landed = async (
    hash: `0x${string}` | undefined,
  ): Promise<settlement.Options['receipt']> => {
    const client = hash ? options.getClient?.({ chainId }) : undefined
    if (!hash || !client) return 'unknown'
    try {
      return (await getTransactionReceipt(client, { hash })).status
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return 'missing'
      return 'unknown'
    }
  }
  /** Returns whether `error` is Tempo ID's definitive refusal: not a network, server, rate limit, or held send's. */
  const final = (error: unknown) =>
    error instanceof RequestError &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429 &&
    error.reason !== 'payment_pending'
  /** Reads the status of the checkout `id`: the paid transaction and whether a send can land. */
  const status = async (id: string): Promise<settlement.Options['status']> => {
    try {
      // The route nests the paid result, as the other routes return it, beside `pending`.
      const value = await send<{ paid: Paid | null; pending: boolean }>(
        `/i/guest/pay/status?${new URLSearchParams({ ...terms, chain_id: String(chainId), guest: await guest({ checkout: id }) })}`,
        { method: 'GET' },
      )
      return {
        paid: value.paid?.paid.transaction ?? null,
        pending: value.pending,
      }
    } catch (error) {
      if (signal?.aborted) throw aborted()
      if (error instanceof SignedOutError) throw error
      return final(error) ? 'refused' : 'unknown'
    }
  }
  /**
   * Reads the outcome of the checkout `id` until {@link settlement} decides it, and returns the paid
   * transaction, or `undefined` once no transaction of it can land, after its cancellation where
   * Tempo ID admits it. The cancellation stores a fence, so no later send pays the checkout. An
   * outcome that stays unknown rejects with `PendingError`, and the store keeps the checkout.
   */
  const settle = async (id: string, entry: settlement.Options['entry']) => {
    let cancellation: settlement.Options['cancellation']
    for (;;) {
      const read = await status(id)
      const receipt =
        typeof read === 'object' && read.paid
          ? ('unknown' as const)
          : await landed(entry.hash)
      const step = settlement({
        cancellation,
        entry,
        now: Date.now(),
        own: true,
        receipt,
        status: read,
      })
      if (step.type === 'paid') return step.transaction
      if (step.type === 'forget') return undefined
      if (step.type === 'pending') throw new PendingError({ checkout: id })
      if (step.type === 'cancel') {
        cancellation = await post('/i/guest/pay/cancel', {
          chain_id: chainId,
          client_id: auth.clientId,
          guest: await guest({ checkout: id }),
          redirect_uri: redirectUri,
        }).then(
          () => undefined,
          (error: unknown) => {
            if (signal?.aborted) throw aborted()
            if (error instanceof SignedOutError) throw error
            // A held send, such as one that the cancellation found, reads the status again.
            return final(error) ? ('refused' as const) : ('unknown' as const)
          },
        )
        if (cancellation === undefined) return undefined
      }
      await wait(2_000, { aborted, signal })
    }
  }
  /** Returns the stored checkouts of the payment that the guest account pays. */
  const mine = async () =>
    Object.entries(await outstanding()).filter(([, entry]) =>
      Address.isEqual(entry.address, session.address),
    )
  /**
   * Claims each stored checkout of the payment whose lease expired, in one step under the payment's
   * lock, with the call's own lease, so no other call settles it at once. Returns the claimed
   * checkouts, and whether another call still holds the lease of one.
   */
  const claim = async () => {
    const claimed: [string, settlement.Options['entry']][] = []
    let live = false
    await record((value) => {
      const now = Date.now()
      const next = { ...value }
      for (const [id, entry] of Object.entries(value)) {
        if (!Address.isEqual(entry.address, session.address)) continue
        const step = settlement({
          entry,
          now,
          receipt: 'unknown',
          status: 'unknown',
        })
        if (step.type === 'held') {
          live = true
          continue
        }
        next[id] = { ...entry, leaseUntil: now + leaseDuration }
        claimed.push([id, entry])
      }
      return next
    })
    return { claimed, live }
  }
  /** Sets the lease of each checkout of `ids` that the store still keeps to end at `until`. */
  const lend = (ids: readonly string[], until: number) =>
    record((value) => {
      const next = { ...value }
      for (const id of ids) {
        const entry = next[id]
        if (entry) next[id] = { ...entry, leaseUntil: until }
      }
      return next
    })

  // Each stored checkout of the same payment settles before the payment opens its own: its
  // transfer paid, or can still land, or no longer lands. A running call of the same payment holds
  // a lease on its checkout, so the payment waits until the call releases it, which removes a
  // settled checkout, or until the lease expires, such as after the call's process exited. The
  // lease machine polls the store, and renews the leases of the claimed checkouts.
  for (;;) {
    const { claimed, live } = await claim()
    if (claimed.length > 0) {
      const held = new Set(claimed.map(([id]) => id))
      let released: Promise<void> | undefined
      const holder = createActor(
        machines.lease.provide({
          actions: {
            release: () => {
              released = lend([...held], 0).catch(() => undefined)
            },
            renew: () =>
              void lend([...held], Date.now() + leaseDuration).catch(
                () => undefined,
              ),
          },
        }),
      ).start()
      holder.send({ type: 'lease.hold' })
      let paid: `0x${string}` | undefined
      let unknown: string | undefined
      try {
        for (const [id, entry] of claimed) {
          try {
            const transaction = await settle(id, entry)
            held.delete(id)
            await forget(id)
            paid ??= transaction
          } catch (error) {
            if (!(error instanceof PendingError)) throw error
            // Only a call that owns the checkout rejects with `PendingError` once Tempo ID no longer
            // holds its outcome, so a checkout that nothing can decide blocks no later payment.
            // The store keeps it, and `forget` removes it.
            if (Date.now() < entry.validBefore * 1_000 + retention)
              unknown ??= id
          }
        }
      } finally {
        holder.send({ type: 'lease.end' })
        holder.stop()
        await released
      }
      if (paid) return { address: session.address, transaction: paid }
      if (unknown) throw new PendingError({ checkout: unknown })
    }
    if (!live) break
    const waiter = createActor(
      machines.lease.provide({
        actions: {
          check: () =>
            void mine().then(
              (entries) => {
                if (!entries.some(([, entry]) => entry.leaseUntil > Date.now()))
                  waiter.send({ type: 'lease.free' })
              },
              () => undefined,
            ),
        },
      }),
    ).start()
    waiter.send({ type: 'lease.wait' })
    try {
      await waitFor(
        waiter,
        (snapshot) => !machines.waiting(snapshot),
        signal ? { signal } : {},
      )
    } catch (error) {
      if (signal?.aborted) throw aborted()
      throw error
    } finally {
      waiter.stop()
    }
  }

  /** Reads the payment until no shortfall remains, and returns it, or the paid checkout. */
  const covered = async (options: {
    deadline: number
    interval: number
  }): Promise<Paid | Quoted> => {
    for (;;) {
      const next = await quote()
      if ('paid' in next) return next
      if (!('shortfall' in next)) throw refused(next.refusal)
      if (!next.shortfall) return next
      if (Date.now() >= options.deadline)
        throw short(
          `Insufficient balance: the guest account ${session.address} still lacks ${next.shortfall.formatted} ${next.shortfall.symbol}. Fund the guest account, then pay again.`,
        )
      await wait(options.interval, { aborted, signal })
    }
  }

  const read = await quote()
  if ('paid' in read) return await settled(read.paid.transaction)
  if (!('shortfall' in read)) throw refused(read.refusal)
  if (read.refusal && !read.shortfall) throw refused(read.refusal)
  const quoted = await (async () => {
    if (!read.shortfall) return read
    if (read.faucet) {
      await post('/i/guest/fund', {
        chain_id: chainId,
        client_id: auth.clientId,
        guest: await guest(),
        redirect_uri: redirectUri,
      })
      return await covered({ deadline: Date.now() + 60_000, interval: 1_000 })
    }
    if (!fund)
      throw short(
        `Insufficient balance: the guest account ${session.address} lacks ${read.shortfall.formatted} ${read.shortfall.symbol}, and the chain has no faucet. Add the \`device\` plugin with \`onCode\`, so the payment shows a funding code, or fund the guest account.`,
      )
    // The funding hint names the payment's exact token, also an unlisted one, since a deposit of
    // another token pays nothing. The device form names no redirect URI, so its guest request
    // names none either.
    const code = await fund({
      chainId,
      funding: { amount, token: read.token },
      guest: await guest({ redirectUri: '' }),
      signal,
    })
    return await covered({
      deadline: Date.now() + code.expiresIn * 1_000,
      interval: code.interval * 1_000,
    })
  })()
  if ('paid' in quoted) return await settled(quoted.paid.transaction)

  // The prepare names the quoted cost, which bounds the fill: the sponsor, or the fee that the
  // guest pays, also `0` for a sponsored quote. A cost above it receives `quote_changed`, and the
  // payment quotes again, so the key pair signs only a fill within a quote. A quote without a fee
  // names none, and the check below refuses a fill whose fee the guest pays.
  const prepare = async (quote: Quoted) =>
    post<Paid | { tag: string; transaction: string }>('/i/guest/pay', {
      ...terms,
      ...(quote.sponsored
        ? { fee: '0' }
        : quote.fee
          ? { fee: quote.fee.amount }
          : {}),
      guest: await guest(),
      sponsored: quote.sponsored,
    })
  const { approved, prepared } = await (async () => {
    let approved = quoted
    for (let attempt = 1; ; attempt++) {
      try {
        return { approved, prepared: await prepare(approved) }
      } catch (error) {
        const changed =
          error instanceof RequestError && error.reason === 'quote_changed'
        if (!changed || attempt >= quoteAttempts) throw error
      }
      const next = await quote()
      if ('paid' in next) return { approved, prepared: next }
      if (!('shortfall' in next)) throw refused(next.refusal)
      if (next.shortfall)
        throw short(
          `Insufficient balance: the guest account ${session.address} lacks ${next.shortfall.formatted} ${next.shortfall.symbol} at the new quote. Fund the guest account, then pay again.`,
        )
      approved = next
    }
  })()
  if ('paid' in prepared) return await settled(prepared.paid.transaction)
  const envelope = check(prepared.transaction, {
    amount,
    chainId,
    quote: approved,
    memo,
    to,
    token,
  })
  held()
  const transaction = await sign(envelope, {
    account: account(auth, { session }),
  })

  const { tag } = prepared
  // The prepared transaction's window, in seconds, which Tempo ID sets at the prepare. No transfer
  // of it lands after it.
  const validBefore =
    envelope.validBefore ?? Math.floor(Date.now() / 1_000) + lifetime
  // The store keeps the checkout before the first send, so a later call resumes it, also after the
  // process exits before the outcome.
  // Each send repeats the one signed transaction. Without a sponsor, its hash is the hash of the
  // transfer that lands. A sponsor's signature gives the transfer that lands another hash, which
  // the call does not know, so the store keeps none.
  const hash =
    envelope.feePayerSignature === null
      ? undefined
      : Hash.keccak256(transaction)
  await record((value) => ({
    ...value,
    [checkout]: {
      address: session.address,
      ...(hash ? { hash } : {}),
      leaseUntil: Date.now() + leaseDuration,
      validBefore,
    },
  }))
  /** Sets the lease of the call's checkout to end at `until`, if the store still keeps it. */
  const renew = (until: number) =>
    record((value) => {
      const entry = value[checkout]
      return entry
        ? { ...value, [checkout]: { ...entry, leaseUntil: until } }
        : value
    })
  // The call ended, so a later call of the payment resumes a checkout that it kept, such as after
  // `PendingError` or an abort. A failed renewal keeps the earlier lease, which the next one extends.
  let released: Promise<void> | undefined
  const holder = createActor(
    machines.lease.provide({
      actions: {
        release: () => {
          released = renew(0).catch(() => undefined)
        },
        renew: () =>
          void renew(Date.now() + leaseDuration).catch(() => undefined),
      },
    }),
  ).start()
  holder.send({ type: 'lease.hold' })

  try {
    return await sent()
  } finally {
    holder.send({ type: 'lease.end' })
    holder.stop()
    await released
  }

  /** Sends the signed transfer until the checkout's outcome is final, and returns the payment. */
  async function sent() {
    // A send without a response, or of a held payment, sends the same transaction again, which pays
    // the checkout once, until the transaction's window ends. Then the checkout's status decides.
    for (;;) {
      try {
        const value = await guest()
        // The send starts in the same task as the check, so no sign-out lands between them. A send
        // that already left settles as Tempo ID's claim of the checkout decides.
        held()
        const paid = await post<Paid>('/i/guest/pay/send', {
          chain_id: chainId,
          client_id: auth.clientId,
          guest: value,
          redirect_uri: redirectUri,
          tag,
          transaction,
        })
        return await settled(paid.paid.transaction)
      } catch (error) {
        if (signal?.aborted) throw aborted()
        const retried =
          error instanceof RequestError &&
          ((error.status === 0 && error.code === 'server_error') ||
            error.status >= 500 ||
            error.reason === 'payment_pending')
        if (retried && Date.now() < validBefore * 1_000) {
          await wait(1_000, { aborted, signal })
          continue
        }
        // The send's outcome is unknown, or Tempo ID refused it. The status tells a landed transfer
        // from one that can no longer land, which the cancellation fences.
        const transaction = await settle(checkout, {
          hash,
          leaseUntil: 0,
          validBefore,
        })
        if (transaction) return await settled(transaction)
        await forget(checkout)
        throw error
      }
    }
  }
}

export declare namespace pay {
  type Options = {
    /** The payment's amount, as a decimal string in whole units of the token, such as `5`. */
    amount: string
    /** The payment's chain. Defaults to the instance's. */
    chainId?: number | undefined
    /**
     * Returns the instance's session. Once it no longer holds `session`, as {@link active} decides,
     * the payment signs and sends nothing more, and rejects with `SignedOutError`. Absent, the
     * payment checks only the stored key pair.
     */
    current?: (() => Session.Any | undefined) | undefined
    /**
     * Returns a client of the chain of `chainId`, which reads the receipt of a checkout's signed
     * transaction. `Accounts.pay` passes one from the `viem` plugin's settings. Absent, the call
     * reads only Tempo ID's status, which forgets a paid checkout a day after its receipt.
     */
    getClient?:
      | ((options: { chainId: number }) => Client | undefined)
      | undefined
    /**
     * Shows a funding code of the guest account for a shortfall on a chain without a faucet, such as
     * the `device` plugin's `fundGuest`, and returns its expiry and poll interval. Absent, such a
     * shortfall rejects with `insufficient_balance`.
     */
    fund?:
      | ((options: {
          chainId: number
          funding: { amount: string; token: string }
          guest: string
          signal?: AbortSignal | undefined
        }) => Promise<{ expiresIn: number; interval: number }>)
      | undefined
    /** The transfer's memo: a string, or hex of at most 32 bytes. Absent, the transfer has none. */
    memo?: string | undefined
    /** The guest session whose guest account pays. */
    session: Session.GuestSession
    /** Rejects the payment with the signal's reason, and stops its requests and waits. */
    signal?: AbortSignal | undefined
    /** The recipient's address. */
    to: string
    /** The token: its symbol that the chain lists, such as `ousd`, or the address of any TIP-20 token. */
    token: string
  }

  type ReturnType = {
    /** The guest account, which paid. */
    address: `0x${string}`
    /** The hash of the transaction that paid. */
    transaction: `0x${string}`
  }
}

/**
 * Returns the guest request that opens Tempo ID's payment page for the guest account: the unpadded
 * URL-safe Base64 of the request's JSON, with the key pair's signature over its message. The request
 * binds the key pair to the app, the redirect URI, the chain, and the payment's checkout ID, for 4
 * minutes. The message holds these lines, in order:
 *
 * ```
 * tempo-id:guest
 * chain_id=<chain ID>
 * checkout=<checkout ID>
 * client_id=<client ID>
 * exp=<expiry, in Unix seconds>
 * redirect_uri=<redirect URI>
 * ```
 * The first call
 * creates and saves the key pair. The call reads and writes only the store, and sends no request.
 *
 * @throws {Error} As {@link session} throws it.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const { value } = await Actions.guest.request(accounts.config, {
 *   chainId: 4217,
 *   checkout: Base64.fromBytes(Bytes.random(16), { pad: false, url: true }),
 *   redirectUri: 'https://example.com/',
 * })
 * ```
 */
export async function request(
  auth: Config,
  options: request.Options,
): Promise<request.ReturnType> {
  const { chainId, checkout, redirectUri } = options
  // A line break in the checkout ID would add a line to the signed message.
  if (!/^[\w-]{1,128}$/.test(checkout))
    throw new TypeError(
      'Invalid `checkout`: it holds a character other than a letter, a digit, `-`, or `_`, or more than 128 characters. Pass 16 random bytes as unpadded URL-safe Base64.',
    )
  const key = await load(auth)
  const publicKey = publicKeyOf(key)

  const expiresAt = Math.floor(Date.now() / 1000) + lifetime
  const message = [
    'tempo-id:guest',
    `chain_id=${chainId}`,
    `checkout=${checkout}`,
    `client_id=${auth.clientId}`,
    `exp=${expiresAt}`,
    `redirect_uri=${redirectUri}`,
  ].join('\n')
  const payload = Bytes.fromString(message)
  // Both forms sign the SHA-256 hash of the message, as WebCrypto's ECDSA does.
  const signature =
    key.type === 'webCrypto'
      ? await WebCryptoP256.sign({
          payload,
          privateKey: key.keyPair.privateKey,
        })
      : P256.sign({ payload: Hash.sha256(payload), privateKey: key.privateKey })
  const value = Base64.fromString(
    JSON.stringify({
      chain_id: chainId,
      checkout,
      client_id: auth.clientId,
      exp: expiresAt,
      public_key: PublicKey.toHex(publicKey),
      redirect_uri: redirectUri,
      signature: Hex.concat(
        Hex.fromNumber(signature.r, { size: 32 }),
        Hex.fromNumber(signature.s, { size: 32 }),
      ),
    }),
    { pad: false, url: true },
  )
  return {
    address: Address.fromPublicKey(publicKey, { checksum: true }),
    checkout,
    value,
  }
}

export declare namespace request {
  type Options = {
    /** The payment's chain. */
    chainId: number
    /**
     * The payment's checkout ID, such as 16 random bytes as unpadded URL-safe Base64: up to 128 letters, digits, `-`, or
     * `_`. Each guest request of one payment, also a renewal, holds the same one.
     */
    checkout: string
    /** The registered redirect URI that the payment page returns to. */
    redirectUri: string
  }

  type ReturnType = {
    /** The guest account's address. */
    address: `0x${string}`
    /** The checkout ID that the request signs. */
    checkout: string
    /** The guest request, as the page's `guest` parameter takes it. */
    value: string
  }
}

/**
 * Returns a new guest session of the instance's guest account, whose key pair the first call creates
 * and saves. The store keeps the key pair, and the session holds only its address and public key,
 * so a save of the session as JSON holds no `CryptoKey`. The call reads and writes only the store,
 * and sends no request.
 *
 * @throws {Error} Without a store, for a store that other parties read, such as `Store.postgres`,
 *   and in a browser page for a store that keeps its values only in the page, such as
 *   `Store.memory`, since a page load would lose the guest account and its funds. Also without Web
 *   Locks or the store's `lock` in a page.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const session = await Actions.guest.session(accounts.config)
 * ```
 */
export async function session(auth: Config): Promise<Session.GuestSession> {
  const store = storeOf(auth)
  persists(store)
  const key = keyOf(auth)
  // The key pair and the revision share one lock, so two starts never take one revision.
  const [held, revision] = await exclusive(store, { key }, async (check) => {
    const held = await create(store, { check, key })
    return [held, await advance(store, { check, key })] as const
  })
  const publicKey = publicKeyOf(held)
  return Session.from({
    address: Address.fromPublicKey(publicKey, { checksum: true }),
    kind: 'guest',
    publicKey: PublicKey.toHex(publicKey),
    revision,
  })
}

/**
 * Returns the next step of `Actions.guest.pay` for a stored checkout of an unresolved payment, from
 * its lease, Tempo ID's status, and the chain's receipt of its signed transaction.
 *
 * | Step      | When                                                                                          |
 * | --------- | --------------------------------------------------------------------------------------------- |
 * | `held`    | Another running call holds the checkout's lease. The payment waits until it ends.             |
 * | `paid`    | Tempo ID's status names the paid transaction, or the chain holds a receipt of the signed one. |
 * | `cancel`  | No transaction of it can land: a reverted receipt, or after the window no receipt, or Tempo ID still holds paid checkouts and reads it unpaid with no send that can land. |
 * | `forget`  | Tempo ID refuses the checkout or its cancellation for good, and the chain shows that it did not land. |
 * | `wait`    | The outcome is not known yet, before the window's end and `settleMargin`.                     |
 * | `pending` | The outcome is still unknown after the window's end and `settleMargin`, also after cancellations that failed. |
 *
 * Tempo ID's status is a fast path: it forgets a paid checkout a day after its receipt, and a
 * sponsored transaction has no known hash, so after that time only a receipt decides.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const step = Actions.guest.settlement({
 *   entry: { leaseUntil: 0, validBefore: 1_700_000_000 },
 *   now: Date.now(),
 *   receipt: 'unknown',
 *   status: { paid: null, pending: false },
 * })
 * ```
 */
export function settlement(options: settlement.Options): settlement.ReturnType {
  const { cancellation, entry, now, receipt, status } = options
  if (!options.own && entry.leaseUntil > now) return { type: 'held' }
  if (typeof status === 'object' && status.paid)
    return { transaction: status.paid, type: 'paid' }
  if (receipt === 'success' && entry.hash)
    return { transaction: entry.hash, type: 'paid' }

  const ended = now >= entry.validBefore * 1_000
  // A reverted transaction spent its nonce, and a transaction without a receipt after its window
  // never lands.
  const landless = receipt === 'reverted' || (ended && receipt === 'missing')
  const late = now >= entry.validBefore * 1_000 + settleMargin
  if (typeof status === 'object' && !status.pending) {
    const remembered = now < entry.validBefore * 1_000 + retention
    if (landless || (ended && remembered)) {
      if (cancellation === undefined) return { type: 'cancel' }
      // A cancellation that failed on the network or the server tries again until the margin.
      if (cancellation === 'unknown')
        return late ? { type: 'pending' } : { type: 'cancel' }
      // Tempo ID refuses the cancellation for good, so the chain decides, as for a refused status.
    }
  }
  if ((status === 'refused' || cancellation === 'refused') && landless)
    return { type: 'forget' }
  return late ? { type: 'pending' } : { type: 'wait' }
}

export declare namespace settlement {
  type Options = {
    /**
     * The outcome of the last cancellation of the checkout: `refused` for Tempo ID's definitive
     * refusal, or `unknown` after a network or server failure. Absent before a cancellation.
     */
    cancellation?: 'refused' | 'unknown' | undefined
    /** The stored checkout. */
    entry: {
      /** The hash of its signed transaction. Absent for a sponsored one, whose hash is unknown. */
      hash?: `0x${string}` | undefined
      /** The end of the lease of the call that owns it, in Unix milliseconds. */
      leaseUntil: number
      /** The end of its transaction's window, in Unix seconds. */
      validBefore: number
    }
    /** The time, in Unix milliseconds. */
    now: number
    /** Whether the checkout is the call's own, which no lease holds back. Defaults to `false`. */
    own?: boolean | undefined
    /**
     * The chain's receipt of the signed transaction: its status, `missing` for none, or `unknown`
     * without a hash, without a client, or after a failed read.
     */
    receipt: 'missing' | 'reverted' | 'success' | 'unknown'
    /**
     * Tempo ID's status of the checkout: the paid transaction and whether a send can land,
     * `refused` for a definitive refusal, or `unknown` after a failed read.
     */
    status:
      | {
          /** The hash of the transaction that paid, or `null` before a payment. */
          paid: `0x${string}` | null
          /** Whether a transaction of the checkout can still land. */
          pending: boolean
        }
      | 'refused'
      | 'unknown'
  }

  type ReturnType =
    | { type: 'cancel' }
    | { type: 'forget' }
    | { type: 'held' }
    | {
        /** The hash of the transaction that paid. */
        transaction: `0x${string}`
        type: 'paid'
      }
    | { type: 'pending' }
    | { type: 'wait' }
}

/**
 * Returns `envelope` signed by `account`, the guest session's account, serialized with the sponsor's
 * marker that it holds, if any.
 *
 * @example
 * ```ts
 * import { Actions } from 'accounts/internal'
 *
 * const signed = await Actions.guest.sign(envelope, { account })
 * ```
 */
export async function sign(
  envelope: TxEnvelopeTempo.TxEnvelopeTempo,
  options: sign.Options,
): Promise<`0x${string}`> {
  const { account } = options
  const signature = await account.sign({
    hash: TxEnvelopeTempo.getSignPayload(envelope),
  })
  return TxEnvelopeTempo.serialize(envelope, {
    signature: SignatureEnvelope.from(signature),
  })
}

export declare namespace sign {
  type Options = {
    /** The guest session's account, from {@link account}. */
    account: Account.RootAccount
  }
}

/**
 * Returns the store's entry of the guest account. A guest account belongs to one deployment and
 * app. The JSON tuple keeps the entry unique, since an origin and a client ID can both hold a colon.
 */
function keyOf(auth: Config) {
  return `tempo-id:guest:${JSON.stringify([new URL(auth.url).origin, auth.clientId])}`
}

/**
 * Runs `fn` while it holds the guest account's lock: a Web Lock, the store's `lock`, or both for a
 * store that other processes share. The creation and the removal of the guest account's key pair
 * hold it, so neither undoes the other. Throws without Web Locks and without the store's `lock`.
 */
async function exclusive<value>(
  store: Store,
  options: exclusive.Options,
  fn: (check?: () => Promise<void>) => Promise<value>,
): Promise<value> {
  const locks = (globalThis.navigator as { locks?: LockManager } | undefined)
    ?.locks
  // The lock's name is no entry of the store, so a store that locks each entry never waits for the
  // lock that its caller holds.
  const name = `${options.key}:exclusive`
  // Web Locks span one browser or one Node process only, so the store's own lock, such as the lock
  // file of `Store.file`, also serializes other processes. The Web Lock orders the process's runs.
  if (locks && store.lock && !store.local)
    return await locks.request(name, () => store.lock!(name, fn))
  if (locks) return await locks.request(name, () => fn())
  if (store.lock) return await store.lock(name, fn)
  // Two pages or processes that create the guest account at once would each save a key pair, and
  // the funds of the overwritten one would stay with no signer.
  throw new Error(
    'Invalid `store`: the runtime has no Web Locks, and the store has no `lock`, so two callers could create two guest accounts. Use a store with `lock`.',
  )
}

declare namespace exclusive {
  type Options = {
    /** The store's entry of the guest account. */
    key: string
  }
}

/**
 * Returns the guest account's key pair, or creates and saves one. Web Locks, or else the store's
 * `lock`, serialize the calls, so two tabs keep one guest account. A refused read or write throws,
 * so no new key pair replaces a stored one.
 */
async function load(auth: Config): Promise<Key> {
  const store = storeOf(auth)
  persists(store)
  const key = keyOf(auth)
  return await exclusive(store, { key }, (check) =>
    create(store, { check, key }),
  )
}

/**
 * Returns the guest account's stored key pair, or creates and saves one. The caller holds the lock
 * of {@link exclusive}, whose `check` throws once another process took it.
 */
async function create(store: Store, options: create.Options): Promise<Key> {
  const { check, key } = options
  const held = await read(store, { key })
  if (held) return held
  const value: P256Entry | WebCryptoP256.createKeyPair.ReturnType = store.json
    ? { privateKey: P256.randomPrivateKey(), type: 'p256' }
    : await WebCryptoP256.createKeyPair()
  // A holder that lost the lock to another process, such as after a pause past a stale lock,
  // writes nothing, and runs again, so it reads the other process's key pair.
  await check?.()
  // The first key pair lands only on an empty entry, so a key pair that another process saved,
  // whose guest account it may have shown for funding, stays.
  if (store.update) {
    const stored = await store.update(key, (current) =>
      current === undefined || current === null
        ? { result: value as unknown, value }
        : { result: current, value: current },
    )
    return decode(stored)
  }
  const again = await read(store, { key })
  if (again) return again
  await store.setItem(key, value)
  return decode(value)
}

declare namespace create {
  type Options = {
    /** Throws once another process took the lock. Absent for a lock without an owner's check. */
    check?: (() => Promise<void>) | undefined
    /** The store's entry of the guest account. */
    key: string
  }
}

/**
 * Returns the next revision of the guest session: the clock, or one more than the last revision
 * that the store holds, whichever is greater. A clock that steps back, or two starts in one
 * millisecond, then still give a later revision, which another context adopts. The caller holds the
 * lock of {@link exclusive}.
 */
async function advance(store: Store, options: create.Options): Promise<number> {
  const { check } = options
  const key = `${options.key}:revision`
  const next = (current: unknown) =>
    Math.max(Date.now(), typeof current === 'number' ? current + 1 : 0)
  await check?.()
  if (store.update)
    return await store.update(key, (current) => {
      const value = next(current)
      return { result: value, value }
    })
  const value = next(await store.getItem(key))
  await store.setItem(key, value)
  return value
}

/**
 * Throws in a browser page for a store that keeps its values only in the page, such as
 * `Store.memory`, since a page load would lose the guest account and its funds. Outside a page, such
 * as in Node, the process holds the store for its lifetime, so the store passes.
 */
function persists(store: Store) {
  if (store.local && typeof document !== 'undefined')
    throw new Error(
      'Invalid `store`: it keeps the guest account only in the page, which a page load loses with its funds. Use a store that persists, such as the default IndexedDB store.',
    )
}

/** Returns the public key of `key`. */
function publicKeyOf(key: Key) {
  return key.type === 'webCrypto' ? key.keyPair.publicKey : key.publicKey
}

/**
 * Returns the guest account's key pair from the store, or `undefined` without one. Throws for a
 * value that is no key pair, which the action never replaces.
 */
async function read(
  store: Store,
  options: read.Options,
): Promise<Key | undefined> {
  const value = await store.getItem(options.key)
  if (value === undefined || value === null) return undefined
  return decode(value)
}

declare namespace read {
  type Options = {
    /** The store's entry of the guest account. */
    key: string
  }
}

/** Returns the key pair of a stored value. Throws for a value that is no key pair. */
function decode(value: unknown): Key {
  const stored = value as {
    privateKey?: unknown
    publicKey?: PublicKey.PublicKey | undefined
    type?: unknown
  }
  if (
    typeof CryptoKey !== 'undefined' &&
    stored.privateKey instanceof CryptoKey &&
    stored.publicKey !== undefined &&
    PublicKey.validate(stored.publicKey)
  )
    return {
      keyPair: stored as WebCryptoP256.createKeyPair.ReturnType,
      type: 'webCrypto',
    }
  if (
    stored.type === 'p256' &&
    typeof stored.privateKey === 'string' &&
    Hex.validate(stored.privateKey, { strict: true })
  )
    return {
      privateKey: stored.privateKey,
      publicKey: P256.getPublicKey({ privateKey: stored.privateKey }),
      type: 'p256',
    }
  throw new Error(
    'Invalid guest account: its entry of the store holds no key pair. Remove the entry with `guest.disconnect`, then start the guest session again.',
  )
}

/**
 * Returns the instance's store, which keeps the guest account's key pair: a store that keeps values
 * as they are, or a private store of JSON, such as `Store.file`. Throws without one, and for a store
 * that other parties read, such as `Store.postgres`.
 */
function storeOf(auth: Config): Store {
  const store = DefaultStore.get(auth.store)
  if (!store)
    throw new Error(
      'Missing `store`: a guest account needs a store that keeps its key pair, such as IndexedDB in a browser. Pass `store` to the instance.',
    )
  if (store.json && !store.private)
    throw new TypeError(
      'Invalid `store`: other parties read it, so it keeps no key pair of a guest account. Use IndexedDB in a browser, or `Store.file`.',
    )
  return store
}

/**
 * Resolves after `ms` milliseconds, or rejects with `options.aborted()` once `options.signal` aborts.
 */
async function wait(ms: number, options: wait.Options) {
  const { aborted, signal } = options
  if (signal?.aborted) throw aborted()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(aborted())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

declare namespace wait {
  type Options = {
    /** Returns the error of an aborted wait. */
    aborted: () => unknown
    /** Rejects the wait once it aborts. */
    signal?: AbortSignal | undefined
  }
}

/** The state machines that this module runs. */
export namespace machines {
  /**
   * The lease of a guest payment on a stored checkout, which `pay` runs. In `holding`, the call
   * renews the lease of its own checkout every third of its time. In `waiting`, the call checks the
   * store until another call's lease ends.
   *
   * | State      | Meaning                                                                  |
   * | ---------- | ------------------------------------------------------------------------ |
   * | `idle`     | The call holds no lease, and waits for none.                             |
   * | `waiting`  | Another call holds the lease of a checkout of the same payment.          |
   * | `holding`  | The call holds the lease of its own checkout, and renews it.             |
   * | `released` | The call ended, and released its lease.                                  |
   */
  export const lease = setup({
    actions: {
      /** Reads the store, and sends `lease.free` once no other call holds a lease. `pay` provides it. */
      check: () => {},
      /** Ends the call's lease, so a later call resumes its checkout. `pay` provides it. */
      release: () => {},
      /** Extends the call's lease by its time. `pay` provides it. */
      renew: () => {},
    },
    delays: {
      /** The time between two checks of another call's lease, in milliseconds. */
      check: 1_000,
      /** The time between two renewals of the call's lease, in milliseconds. */
      renewal: leaseDuration / 3,
    },
    types: {
      events: {} as lease.Event,
    },
  }).createMachine({
    id: 'lease',
    initial: 'idle',
    states: {
      holding: {
        after: {
          renewal: { actions: 'renew', reenter: true, target: 'holding' },
        },
        on: { 'lease.end': { actions: 'release', target: 'released' } },
      },
      idle: {
        on: {
          'lease.end': { target: 'released' },
          'lease.hold': { target: 'holding' },
          'lease.wait': { target: 'waiting' },
        },
      },
      released: { type: 'final' },
      waiting: {
        after: {
          check: { actions: 'check', reenter: true, target: 'waiting' },
        },
        on: {
          'lease.end': { target: 'released' },
          'lease.free': { target: 'idle' },
        },
      },
    },
  })

  export declare namespace lease {
    /** An event of the call. */
    type Event =
      | {
          /** The call ended. */
          type: 'lease.end'
        }
      | {
          /** No other call holds a lease of the payment. */
          type: 'lease.free'
        }
      | {
          /** The call stored its own checkout, and holds its lease. */
          type: 'lease.hold'
        }
      | {
          /** Another call holds the lease of a checkout of the same payment. */
          type: 'lease.wait'
        }

    /** A running machine. */
    type Actor = ActorRefFrom<typeof lease>

    /** A snapshot of the machine. */
    type Snapshot = SnapshotFrom<typeof lease>
  }

  /** Returns whether the call waits for another call's lease. */
  export function waiting(snapshot: lease.Snapshot) {
    return snapshot.matches('waiting')
  }
}
