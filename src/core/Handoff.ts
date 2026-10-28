import { Address, Base64, Bytes, Hex, PublicKey, Secp256k1 } from 'ox'

/**
 * Reads what a Tempo Wallet handoff left on this page. A page named as `tempoWallet({ handoff: { url } })`
 * is opened on the phone that approved a request, with the outcome in its URL fragment: the
 * request's result and, when it authorized one, an access key that phone generated for this page.
 * Returns `undefined` when the page was opened some other way. Removes the fragment from the
 * address bar and history by default, since it can hold a private key.
 *
 * @example
 * ```ts
 * import { Handoff } from 'accounts'
 *
 * const landing = Handoff.read()
 * if (landing?.status === 'approved' && landing.accessKey)
 *   localStorage.setItem('key', landing.accessKey.privateKey)
 * ```
 */
export function read(options: read.Options = {}): read.ReturnType {
  const { clear = true } = options
  const href = options.url ?? (typeof window === 'undefined' ? undefined : window.location.href)
  if (!href) return undefined
  const url = new URL(href)
  const fragment = new URLSearchParams(url.hash.slice(1))
  const status = fragment.get('tempo_wallet')
  if (status !== 'approved' && status !== 'rejected') return undefined
  if (clear && !options.url && typeof history !== 'undefined') {
    url.hash = ''
    history.replaceState(history.state, '', url.href)
  }
  if (status === 'rejected') return { status }

  const account = fragment.get('account')
  const result = (() => {
    const value = fragment.get('result')
    if (!value) return undefined
    try {
      return JSON.parse(Bytes.toString(Base64.toBytes(value))) as unknown
    } catch {
      return undefined
    }
  })()
  const accessKey = (() => {
    const privateKey = fragment.get('private_key')
    if (!privateKey || !Hex.validate(privateKey) || Hex.size(privateKey) !== 32) return undefined
    const address = Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey }))
    return {
      address,
      keyType: 'secp256k1',
      privateKey,
      publicKey: PublicKey.toHex(Secp256k1.getPublicKey({ privateKey })),
    } as const
  })()
  return {
    accessKey,
    account: account && Address.validate(account) ? account : undefined,
    result,
    status,
  }
}

export declare namespace read {
  /** Options for {@link read}. */
  type Options = {
    /** Remove the fragment from the address bar and history. Ignored with `url`. @default true */
    clear?: boolean | undefined
    /** URL to read instead of the current page's. */
    url?: string | undefined
  }

  /** What the handoff left on the page, or `undefined` when there is none. */
  type ReturnType =
    | {
        /** Access key the phone authorized for this page, when the request asked for one. */
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
        /** Account that approved the request. */
        account: Address.Address | undefined
        /** The request's JSON-RPC result, as the wallet returned it (for example `wallet_connect`'s). */
        result: unknown
        /** The phone approved the request. */
        status: 'approved'
      }
    | {
        /** The phone rejected the request. */
        status: 'rejected'
      }
    | undefined
}
