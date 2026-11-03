/**
 * Seeds passkeys for the software authenticator in `WebAuthn.ts` or Chromium's virtual
 * authenticator. The Admin API stores no passkey, so each seed writes its row to the database.
 * @module
 */
import * as Crypto from 'node:crypto'
import type { Page } from '@playwright/test'
import { Address, Base64, Hex, PublicKey } from 'ox'
import { type Database, Env, Schema } from './TempoId.js'
import * as WebAuthn from './WebAuthn.js'

/** The relying party of the `default` realm: the host of {@link Env.origin}. */
export const rpId = new URL(Env.origin).hostname

/**
 * Creates a passkey of {@link rpId} for `userId`, stores it, and adds it to a virtual authenticator
 * on `page`. Returns its checksummed address. Attach it after the page loads.
 */
export async function attach(
  database: Pick<ReturnType<typeof Database.connect>, 'db'>,
  options: attach.Options,
) {
  const { page, userId } = options
  const pair = Crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = pair.publicKey.export({ format: 'jwk' })
  const publicKey = Hex.concat(
    '0x04',
    Base64.toHex(jwk.x!),
    Base64.toHex(jwk.y!),
  )
  const id = crypto.getRandomValues(new Uint8Array(32))
  const address = Address.fromPublicKey(PublicKey.fromHex(publicKey))
  await database.db.insert(Schema.keys).values({
    address: owns(options) ? address.toLowerCase() : null,
    id: Base64.fromBytes(id, { pad: false, url: true }),
    publicKey,
    rpId,
    source: options.source ?? 'tempo-id',
    type: 'passkey',
    userId,
  })

  await virtual(page, { id, pair, userHandle: userId })
  return Address.checksum(address)
}

export declare namespace attach {
  type Options = {
    /**
     * Whether the passkey owns its address's Tempo Account. Defaults to `true` for `tempo-wallet`.
     */
    account?: boolean | undefined
    /** The page whose ceremonies reach the authenticator. */
    page: Page
    /** `tempo-id`, the default, or `tempo-wallet` for a link from wallet.tempo. */
    source?: 'tempo-id' | 'tempo-wallet' | undefined
    /** The user the passkey signs in. */
    userId: string
  }
}

/**
 * Adds a passkey of {@link rpId} to `page`'s virtual authenticator, and stores no row. Returns its
 * ID and its wallet.tempo credential, for `Harness.seedWallet`.
 */
export async function attachWallet(page: Page, options: attachWallet.Options) {
  const pair = Crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const jwk = pair.publicKey.export({ format: 'jwk' })
  const publicKey = Hex.concat(
    '0x04',
    Base64.toHex(jwk.x!),
    Base64.toHex(jwk.y!),
  )
  const id = crypto.getRandomValues(new Uint8Array(32))
  await virtual(page, { id, pair, userHandle: options.email })
  return {
    credential: {
      address: Address.checksum(
        Address.fromPublicKey(PublicKey.fromHex(publicKey)),
      ),
      createdAt: null,
      email: options.email,
      publicKey,
    },
    id: Base64.fromBytes(id, { pad: false, url: true }),
  }
}

export declare namespace attachWallet {
  type Options = {
    /** The account's verified email on wallet.tempo. */
    email: string
  }
}

/** Creates and stores a passkey of {@link rpId} for `userId`, and returns its authenticator. */
export async function create(
  database: Pick<ReturnType<typeof Database.connect>, 'db'>,
  options: create.Options,
) {
  const passkey = WebAuthn.create({ origin: Env.origin, rpId })
  await database.db.insert(Schema.keys).values({
    address: owns(options)
      ? Address.fromPublicKey(
          PublicKey.fromHex(passkey.publicKey),
        ).toLowerCase()
      : null,
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    id: passkey.id,
    publicKey: passkey.publicKey,
    rpId,
    source: options.source ?? 'tempo-id',
    type: 'passkey',
    userId: options.userId,
  })
  return passkey
}

export declare namespace create {
  type Options = {
    /**
     * Whether the passkey owns its address's Tempo Account. Defaults to `true` for `tempo-wallet`.
     */
    account?: boolean | undefined
    /** Defaults to the database's clock. */
    createdAt?: Date | undefined
    /** `tempo-id`, the default, or `tempo-wallet` for a link from wallet.tempo. */
    source?: 'tempo-id' | 'tempo-wallet' | undefined
    /** The user the passkey signs in. */
    userId: string
  }
}

/**
 * Creates a passkey of {@link rpId} that only wallet.tempo stores. Returns it and its wallet.tempo
 * credential.
 */
export function wallet(options: wallet.Options = {}) {
  const passkey = WebAuthn.create({ origin: Env.origin, rpId })
  const credential = {
    address: Address.fromPublicKey(PublicKey.fromHex(passkey.publicKey)),
    createdAt: options.createdAt ?? null,
    email: options.email ?? null,
    publicKey: passkey.publicKey,
  }
  return { credential, passkey }
}

export declare namespace wallet {
  type Options = {
    /** When wallet.tempo created the passkey, in milliseconds. */
    createdAt?: number | undefined
    /** The account's verified email on wallet.tempo. */
    email?: string | undefined
  }
}

/**
 * Returns whether a seeded passkey owns its account. Defaults to whether it links from
 * wallet.tempo.
 */
function owns(options: {
  account?: boolean | undefined
  source?: 'tempo-id' | 'tempo-wallet' | undefined
}) {
  return options.account ?? options.source === 'tempo-wallet'
}

/** Returns the checksummed address of `passkey`'s Tempo Account. */
export function address(passkey: ReturnType<typeof WebAuthn.create>) {
  return Address.checksum(
    Address.fromPublicKey(PublicKey.fromHex(passkey.publicKey)),
  )
}

/** Adds a Chromium virtual authenticator with the passkey to `page`. It signs without a prompt. */
async function virtual(page: Page, options: virtual.Options) {
  const { id, pair, userHandle } = options
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send(
    'WebAuthn.addVirtualAuthenticator',
    {
      options: {
        automaticPresenceSimulation: true,
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        protocol: 'ctap2',
        transport: 'internal',
      },
    },
  )
  await cdp.send('WebAuthn.addCredential', {
    authenticatorId,
    credential: {
      credentialId: Base64.fromBytes(id),
      isResidentCredential: true,
      privateKey: pair.privateKey
        .export({ format: 'der', type: 'pkcs8' })
        .toString('base64'),
      rpId,
      signCount: 0,
      userHandle: Base64.fromString(userHandle),
    },
  })
}

declare namespace virtual {
  type Options = {
    /** The credential ID. */
    id: Uint8Array
    /** The passkey's P-256 key pair. */
    pair: { privateKey: Crypto.KeyObject }
    /** The user's ID or email, which the credential stores as its user handle. */
    userHandle: string
  }
}
