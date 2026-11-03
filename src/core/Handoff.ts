import { Address, Base64, Bytes, Hex, PublicKey, Secp256k1 } from 'ox'

/**
 * Reads what a Tempo Wallet handoff left on this page. A page named as
 * `tempoWallet({ handoff: { url } })` is opened on the phone that approved a request, with the
 * request's result in its URL fragment and, when it authorized one, an access key that phone
 * generated for this page. Returns `undefined` when the page was opened some other way. Removes
 * the fragment from the address bar and history by default, since it can hold a private key.
 *
 * The landing page did not start the request, so nothing ties the fragment to this browser: anyone
 * can link to the page with a fragment of their own, including a key they authorized for their
 * own account. `read` only returns an access key that the result's key authorization names for its
 * account, but treat the outcome like any link: show the account and let the person confirm it is
 * theirs before signing them in, and verify on chain (or by the authorization's signature)
 * whatever must be trusted.
 *
 * @example
 * ```ts
 * import { Handoff } from 'accounts'
 *
 * const landing = Handoff.read()
 * if (landing?.accessKey && confirm(`Continue as ${landing.account}?`))
 *   localStorage.setItem('key', landing.accessKey.privateKey)
 * ```
 */
export function read(options: read.Options = {}): read.ReturnType {
  const { clear = true } = options
  const href = options.url ?? (typeof window === 'undefined' ? undefined : window.location.href)
  if (!href) return undefined
  const url = new URL(href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  if (fragment.get('tempo_wallet') !== 'approved') return undefined
  if (clear && !options.url && typeof history !== 'undefined') {
    url.hash = ''
    history.replaceState(history.state, '', url.href)
  }

  const result = (() => {
    const value = fragment.get('result')
    if (!value) return undefined
    try {
      return JSON.parse(Bytes.toString(Base64.toBytes(value))) as unknown
    } catch {
      return undefined
    }
  })()
  const { account, keyId } = authorization(result)
  const accessKey = (() => {
    const privateKey = fragment.get('private_key')
    if (!privateKey || !Hex.validate(privateKey) || Hex.size(privateKey) !== 32) return undefined
    const publicKey = Secp256k1.getPublicKey({ privateKey })
    const address = Address.fromPublicKey(publicKey)
    // Only the key the result's authorization names for its account.
    if (!account || !keyId || !Address.isEqual(address, keyId)) return undefined
    return {
      address,
      keyType: 'secp256k1',
      privateKey,
      publicKey: PublicKey.toHex(publicKey),
    } as const
  })()
  return { accessKey, account, result, status: 'approved' }
}

export declare namespace read {
  /** Options for {@link read}. */
  type Options = {
    /** Remove the fragment from the address bar and history. Ignored with `url`. @default true */
    clear?: boolean | undefined
    /** URL to read instead of the current page's. */
    url?: string | undefined
  }

  /** What the handoff left on the page, or `undefined` when there is none. Unauthenticated: see {@link read}. */
  type ReturnType =
    | {
        /** Access key the result's key authorization names for `account`, when the request asked for one. */
        accessKey:
          | {
              /** Address of the access key. */
              address: Address.Address
              /** Key type of the access key. */
              keyType: 'secp256k1'
              /** Private key of the access key. Keep it like any credential. */
              privateKey: Hex.Hex
              /** Public key of the access key. */
              publicKey: Hex.Hex
            }
          | undefined
        /** Account the result names. */
        account: Address.Address | undefined
        /** The request's JSON-RPC result, as the wallet returned it (for example `wallet_connect`'s). */
        result: unknown
        /** The phone approved the request. */
        status: 'approved'
      }
    | undefined
}

/** The account a `wallet_connect` or `wallet_authorizeAccessKey` result names, and its key authorization's key. */
function authorization(result: unknown): {
  account: Address.Address | undefined
  keyId: Address.Address | undefined
} {
  const valid = (value: unknown): Address.Address | undefined =>
    typeof value === 'string' && Address.validate(value) ? value : undefined
  const keyOf = (value: unknown) => {
    if (typeof value !== 'object' || value === null) return undefined
    const { address, keyId } = value as { address?: unknown; keyId?: unknown }
    return valid(keyId) ?? valid(address)
  }
  if (typeof result !== 'object' || result === null) return { account: undefined, keyId: undefined }
  const value = result as {
    accounts?: unknown
    keyAuthorization?: unknown
    rootAddress?: unknown
  }
  if (value.rootAddress !== undefined)
    return { account: valid(value.rootAddress), keyId: keyOf(value.keyAuthorization) }
  if (!Array.isArray(value.accounts)) return { account: undefined, keyId: undefined }
  const [first] = value.accounts as unknown[]
  if (typeof first === 'string') return { account: valid(first), keyId: undefined }
  if (typeof first !== 'object' || first === null) return { account: undefined, keyId: undefined }
  const { address, capabilities } = first as { address?: unknown; capabilities?: unknown }
  const keyAuthorization =
    typeof capabilities === 'object' && capabilities !== null
      ? (capabilities as { keyAuthorization?: unknown }).keyAuthorization
      : undefined
  return { account: valid(address), keyId: keyOf(keyAuthorization) }
}
