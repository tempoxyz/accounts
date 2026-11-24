/**
 * Guest checkout: a visitor without a Tempo ID sign-in pays from a guest account, a root Tempo
 * Account whose owner is a non-extractable WebCrypto P256 key pair in the instance's store. Tempo
 * ID's payment page reads the payment, funds a shortfall, and sends. The key pair only signs: the
 * guest request that opens the page, and the one transaction that the page posts back.
 * @module
 */
import { Address, Base64, Bytes, Hex, PublicKey, WebCryptoP256 } from 'ox'
import { SignatureEnvelope, TxEnvelopeTempo } from 'ox/tempo'
import { token as TokenActions } from 'viem/tempo/actions'
import { type Config, RequestError } from '../Accounts.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Permissions from '../Permissions.js'
import type { Store } from '../Store.js'

/** The time between the guest request's signature and its expiry, in seconds. */
const lifetime = 4 * 60

/**
 * Returns `value`, a transaction that Tempo ID's page prepared for a guest payment, as a Tempo
 * envelope to sign, if it makes the requested transfer and nothing else, and Tempo ID's sponsor
 * pays its fee. The sender is the account that signs it, so the check reads no sender. The check
 * reads no network.
 *
 * @throws {RequestError} `invalid_request` with the field `transaction` for any other value, such
 *   as a transaction on another chain, with another call or more calls, with an access key or an
 *   authorization, with a signature, or without the sponsor's marker.
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

  // The token's symbol becomes its address on the chain, and the amount its base units.
  const [limit] =
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
  if (!limit) throw refused('its token is unknown.')
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
  // The sponsor's marker, so the guest account pays no fee.
  if (envelope.feePayerSignature !== null)
    throw refused('no sponsor pays its fee.')
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
    /** The token: its symbol on the chain, such as `ousd`, or its address. */
    token: string
  }
}

/**
 * Forgets the instance's guest account: removes its key pair from the store. The next guest payment
 * creates a new guest account. The funds of the forgotten guest account stay on its address, and no
 * key signs for it again.
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
 * Returns the guest account's key pair, which the first call creates and saves, and the guest
 * request that opens Tempo ID's payment page for it: the unpadded URL-safe Base64 of the request's
 * JSON, with the key pair's signature over its message. The request binds the key pair to the app,
 * the redirect URI, and the chain, for 4 minutes. The call reads and writes only the store, and
 * sends no request.
 *
 * @throws {Error} Without a store that keeps a key pair as it is, such as a store with `json`. In a
 *   browser page, also for a store that keeps its values only in the page, such as `Store.memory`,
 *   since a page load would lose the guest account and its funds.
 */
export async function request(
  auth: Config,
  options: request.Options,
): Promise<request.ReturnType> {
  const { chainId, redirectUri } = options
  const store = storeOf(auth)
  if (store.local && typeof document !== 'undefined')
    throw new Error(
      'Invalid `store`: it keeps the guest account only in the page, which a page load loses with its funds. Use a store that persists, such as the default IndexedDB store.',
    )
  const keyPair = await load(store, { key: keyOf(auth) })

  const expiresAt = Math.floor(Date.now() / 1000) + lifetime
  const message = [
    'tempo-id:guest',
    `chain_id=${chainId}`,
    `client_id=${auth.clientId}`,
    `exp=${expiresAt}`,
    `redirect_uri=${redirectUri}`,
  ].join('\n')
  const signature = await WebCryptoP256.sign({
    payload: Bytes.fromString(message),
    privateKey: keyPair.privateKey,
  })
  const value = Base64.fromString(
    JSON.stringify({
      chain_id: chainId,
      client_id: auth.clientId,
      exp: expiresAt,
      public_key: PublicKey.toHex(keyPair.publicKey),
      redirect_uri: redirectUri,
      signature: Hex.concat(
        Hex.fromNumber(signature.r, { size: 32 }),
        Hex.fromNumber(signature.s, { size: 32 }),
      ),
    }),
    { pad: false, url: true },
  )
  return {
    address: Address.fromPublicKey(keyPair.publicKey, { checksum: true }),
    keyPair,
    value,
  }
}

export declare namespace request {
  type Options = {
    /** The payment's chain. */
    chainId: number
    /** The registered redirect URI that the payment page returns to. */
    redirectUri: string
  }

  type ReturnType = {
    /** The guest account's address. */
    address: `0x${string}`
    /** The guest account's key pair. */
    keyPair: WebCryptoP256.createKeyPair.ReturnType
    /** The guest request, as the page's `guest` parameter takes it. */
    value: string
  }
}

/**
 * Returns `envelope` signed by the guest account's key pair, serialized with the sponsor's marker
 * that it holds. WebCrypto hashes the signing payload with SHA-256 before it signs, so the P256
 * envelope marks the signature as prehashed.
 */
export async function sign(
  envelope: TxEnvelopeTempo.TxEnvelopeTempo,
  options: sign.Options,
): Promise<`0x${string}`> {
  const { keyPair } = options
  const signature = await WebCryptoP256.sign({
    payload: TxEnvelopeTempo.getSignPayload(envelope),
    privateKey: keyPair.privateKey,
  })
  return TxEnvelopeTempo.serialize(envelope, {
    signature: SignatureEnvelope.from({
      prehash: true,
      publicKey: keyPair.publicKey,
      signature,
      type: 'p256',
    }),
  })
}

export declare namespace sign {
  type Options = {
    /** The guest account's key pair. */
    keyPair: WebCryptoP256.createKeyPair.ReturnType
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
 * Runs `fn` while it holds the guest account's lock: a Web Lock, or else the store's `lock`. The
 * creation and the removal of the guest account's key pair hold it, so neither undoes the other.
 * Throws in a browser page without either.
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
  // Two pages that create the guest account at once would each save a key pair, and the funds of
  // the overwritten one would stay with no signer.
  if (typeof document !== 'undefined')
    throw new Error(
      'Invalid `store`: the browser has no Web Locks, and the store has no `lock`, so two pages could create two guest accounts. Use a store with `lock`.',
    )
  return await fn()
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
async function load(store: Store, options: load.Options) {
  return await exclusive(store, options, async () => {
    const held = await read(store, options)
    if (held) return held
    const keyPair = await WebCryptoP256.createKeyPair()
    await store.setItem(options.key, keyPair)
    return keyPair
  })
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
