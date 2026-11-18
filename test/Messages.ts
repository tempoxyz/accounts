/**
 * The message shapes that the end-to-end suite signs, as a sign-in's challenge or with a message
 * signature. Tempo ID shows each shape in its own way: plain text with a warning, a Sign-In with
 * Ethereum message that it recognizes with none, and one that it does not recognize as plain text.
 * @module
 */
import { zeroAddress } from 'viem'
import { createSiweMessage, generateSiweNonce } from 'viem/siwe'
import * as Apps from './Apps.js'
import * as Chain from './Chain.js'

/** An address that the `share` shape shares an item with. It holds no account. */
export const teammate = '0x8f3a1c9e2d4b6a8c0e1f3a5b7c9d1e3f5a7bbe21'

/**
 * Each shape, with whether Tempo ID recognizes it. Tempo ID recognizes a Sign-In with Ethereum
 * message that names the app's origin, the signing chain, and the zero address or the signer, and
 * that is valid now.
 *
 * | Shape         | Message                                                           |
 * | ------------- | ----------------------------------------------------------------- |
 * | `text`        | One line of plain text                                            |
 * | `lines`       | Several lines, a tab, and characters outside ASCII                |
 * | `signIn`      | Sign-In with Ethereum for the app's origin, with no resources     |
 * | `share`       | The same, with one resource that shares an item with `teammate`   |
 * | `otherDomain` | Sign-In with Ethereum for the origin `https://example.com`        |
 * | `expired`     | Sign-In with Ethereum for the app's origin, whose expiry passed   |
 */
export const shapes = {
  expired: { recognized: false, siwe: true },
  lines: { recognized: false, siwe: false },
  otherDomain: { recognized: false, siwe: true },
  share: { recognized: true, siwe: true },
  signIn: { recognized: true, siwe: true },
  text: { recognized: false, siwe: false },
} as const

/** A message shape. */
export type Shape = keyof typeof shapes

/** A message, with the fields that its verification checks. */
export type Message = {
  /** The host that a Sign-In with Ethereum message names. */
  domain: string
  /** The message's text. */
  message: string
  /** The nonce of a Sign-In with Ethereum message. */
  nonce: string
  /** The resources of a Sign-In with Ethereum message. */
  resources: readonly string[]
}

/**
 * Returns a new message of `options.shape` for the web test app, on the suite's chain. A Sign-In
 * with Ethereum message names `options.address`, or the zero address, since an app does not know the
 * account before a sign-in. It expires in 10 minutes, unless the shape is `expired`.
 */
export function from(options: from.Options): Message {
  const { address = zeroAddress, shape } = options
  const nonce = generateSiweNonce()
  const site = shape === 'otherDomain' ? 'https://example.com' : Apps.web.url
  const domain = new URL(site).host

  if (shape === 'text')
    return {
      domain,
      message: `Sign in to the web test app: ${nonce}`,
      nonce,
      resources: [],
    }
  if (shape === 'lines')
    return {
      domain,
      message: `Sign in to the web test app\n\tnonce: ${nonce}\n\n“Grüße”, 你好, 👋`,
      nonce,
      resources: [],
    }

  const now = Date.now()
  const resources =
    shape === 'share'
      ? [`${site}/v1/kv/notes/notes/*?grant=read,write&to=${teammate}`]
      : []
  return {
    domain,
    message: createSiweMessage({
      address,
      chainId: Chain.chain.id,
      domain,
      expirationTime: new Date(
        shape === 'expired' ? now - 60 * 1_000 : now + 10 * 60 * 1_000,
      ),
      issuedAt: new Date(shape === 'expired' ? now - 11 * 60 * 1_000 : now),
      nonce,
      // An empty list writes a `Resources:` line with no entry, which no reader reads back the same.
      ...(resources.length ? { resources } : {}),
      statement:
        shape === 'share'
          ? 'Share notes with a teammate.'
          : 'Sign in to the web test app.',
      uri: site,
      version: '1',
    }),
    nonce,
    resources,
  }
}

export declare namespace from {
  type Options = {
    /** The address that a Sign-In with Ethereum message names. Defaults to the zero address. */
    address?: `0x${string}` | undefined
    /** The message's shape. */
    shape: Shape
  }
}
