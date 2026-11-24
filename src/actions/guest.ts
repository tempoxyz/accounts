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
import { parseUnits } from 'viem'
import { Account } from 'viem/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import { type Config, RequestError, SignedOutError } from '../Accounts.js'
import * as Api from '../internal/Api.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Payment from '../internal/Payment.js'
import * as Permissions from '../Permissions.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'

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
  return envelope
}

export declare namespace check {
  type Options = {
    /** The amount of the transfer, as a decimal string in whole units, such as `12.5`. */
    amount: string
    /** The payment's chain. */
    chainId: number
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
  /** The network fee. `token`, when present, names the fee token's address. */
  fee: { token?: `0x${string}` | undefined } | null
  /** Why no transaction pays, other than a shortfall. */
  refusal: Refusal | null
  /** What the guest account lacks. */
  shortfall: { formatted: string; symbol: string } | null
  /** Whether Tempo ID's sponsor pays the fee. */
  sponsored: boolean
  /** The token's address. */
  token: `0x${string}`
}

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
 * @throws {RequestError} With the reason of Tempo ID's refusal, such as `recipient_not_permitted`.
 *   With `insufficient_balance` and status 0 for a shortfall without a faucet or `fund`, or after
 *   the funding code expired.
 * @throws {RequestError} With `invalid_request` at `transaction`, for a prepared transaction other
 *   than the requested transfer, which the key pair never signs.
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
  // One checkout ID for the call, so each retry pays the same checkout, and Tempo ID pays it once.
  const checkout = crypto.randomUUID()
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
  const guest = async (target = redirectUri) => {
    if (signal?.aborted) throw aborted()
    held()
    const { address, value } = await request(auth, {
      chainId,
      checkout,
      redirectUri: target,
    })
    if (!Address.isEqual(address, session.address)) throw new SignedOutError()
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
  if ('paid' in read)
    return { address: session.address, transaction: read.paid.transaction }
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
      guest: await guest(''),
      signal,
    })
    return await covered({
      deadline: Date.now() + code.expiresIn * 1_000,
      interval: code.interval * 1_000,
    })
  })()
  if ('paid' in quoted)
    return { address: session.address, transaction: quoted.paid.transaction }

  const prepared = await post<Paid | { tag: string; transaction: string }>(
    '/i/guest/pay',
    { ...terms, guest: await guest(), sponsored: quoted.sponsored },
  )
  if ('paid' in prepared)
    return { address: session.address, transaction: prepared.paid.transaction }
  const envelope = check(prepared.transaction, {
    amount,
    chainId,
    memo,
    to,
    token,
  })
  // Without the sponsor's marker, the guest account pays the fee, so the fee token is the one that
  // Tempo ID quoted, or else a TIP-20 token.
  if (envelope.feePayerSignature === undefined) {
    const expected = quoted.fee?.token
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
    if (!valid)
      throw new RequestError({
        code: 'invalid_request',
        field: 'transaction',
        message:
          'Invalid prepared transaction: its fee token is not the quoted one. The guest account signs only the requested transfer. Try again.',
        status: 0,
      })
  }
  held()
  const transaction = await sign(envelope, {
    account: account(auth, { session }),
  })

  // A send without a response, or of a held payment, sends the same transaction again, which pays
  // the checkout once. The window of a held send ends within the deadline.
  const deadline = Date.now() + 2 * 60_000
  for (;;) {
    try {
      const paid = await post<Paid>('/i/guest/pay/send', {
        chain_id: chainId,
        client_id: auth.clientId,
        guest: await guest(),
        redirect_uri: redirectUri,
        tag: prepared.tag,
        transaction,
      })
      return { address: session.address, transaction: paid.paid.transaction }
    } catch (error) {
      if (signal?.aborted) throw aborted()
      const retried =
        error instanceof RequestError &&
        ((error.status === 0 && error.code === 'server_error') ||
          error.status >= 500 ||
          error.reason === 'payment_pending')
      if (!retried || Date.now() >= deadline) throw error
      await wait(1_000, { aborted, signal })
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
 *   checkout: crypto.randomUUID(),
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
      'Invalid `checkout`: it holds a character other than a letter, a digit, `-`, or `_`, or more than 128 characters. Pass `crypto.randomUUID()`.',
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
     * The payment's checkout ID, such as `crypto.randomUUID()`: up to 128 letters, digits, `-`, or
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
  const publicKey = publicKeyOf(await load(auth))
  return Session.from({
    address: Address.fromPublicKey(publicKey, { checksum: true }),
    kind: 'guest',
    publicKey: PublicKey.toHex(publicKey),
    revision: Date.now(),
  })
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
  fn: () => Promise<value>,
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
  if (locks) return await locks.request(name, fn)
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
  if (store.local && typeof document !== 'undefined')
    throw new Error(
      'Invalid `store`: it keeps the guest account only in the page, which a page load loses with its funds. Use a store that persists, such as the default IndexedDB store.',
    )
  const key = keyOf(auth)
  return await exclusive(store, { key }, async () => {
    const held = await read(store, { key })
    if (held) return held
    if (store.json) {
      const privateKey = P256.randomPrivateKey()
      const value: P256Entry = { privateKey, type: 'p256' }
      await store.setItem(key, value)
      return {
        privateKey,
        publicKey: P256.getPublicKey({ privateKey }),
        type: 'p256',
      }
    }
    const keyPair = await WebCryptoP256.createKeyPair()
    await store.setItem(key, keyPair)
    return { keyPair, type: 'webCrypto' }
  })
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

declare namespace read {
  type Options = {
    /** The store's entry of the guest account. */
    key: string
  }
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
