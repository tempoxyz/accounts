import { Address, Hex, PublicKey, WebCryptoP256 } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account as TempoAccount } from 'viem/tempo'

import * as AccessKeyStore from './internal/AccessKeyStore.js'
import type * as Store from './Store.js'

/** Access-key publication states. */
export const status = {
  /** No matching usable access key was found. */
  missing: 'missing',
  /** A matching key exists locally and still needs its first transaction to publish the authorization. */
  pending: 'pending',
  /** A matching key exists on-chain and can be used. */
  published: 'published',
  /** A matching key exists but is past its expiry. */
  expired: 'expired',
} as const

/** Publication state for an access key. */
export type Status = (typeof status)[keyof typeof status]

/** Generates a P256 key pair and access key account. */
export async function generate(options: generate.Options = {}): Promise<generate.ReturnType> {
  const { account } = options
  const keyPair = await WebCryptoP256.createKeyPair()
  const accessKey = TempoAccount.fromWebCryptoP256(
    keyPair,
    account ? { access: account } : undefined,
  )
  return { accessKey, keyPair }
}

export declare namespace generate {
  type Options = {
    /** Root account to attach to the access key. */
    account?: TempoAccount.Account | undefined
  }

  type ReturnType = {
    /** The generated access key account. */
    accessKey: TempoAccount.AccessKeyAccount
    /** Generated key pair to pass to `authorizeAccessKey`. */
    keyPair: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>>
  }
}

/** Prepares an unsigned key authorization and local key material when needed. */
export async function prepareAuthorization(
  options: prepareAuthorization.Options,
): Promise<prepareAuthorization.ReturnType> {
  const { address, chainId, expiry, keyType, limits, publicKey, scopes } = options

  if (address || publicKey) {
    const keyAuthorization = KeyAuthorization.from({
      address: address ?? Address.fromPublicKey(PublicKey.from(publicKey!)),
      chainId: BigInt(chainId),
      expiry,
      limits,
      scopes,
      type: keyType ?? 'secp256k1',
    })
    return { keyAuthorization }
  }

  const keyPair = await WebCryptoP256.createKeyPair()
  const keyAuthorization = KeyAuthorization.from({
    address: Address.fromPublicKey(PublicKey.from(keyPair.publicKey)),
    chainId: BigInt(chainId),
    expiry,
    limits,
    scopes,
    type: 'p256',
  })
  return { keyAuthorization, keyPair }
}

export declare namespace prepareAuthorization {
  /** Options for {@link prepareAuthorization}. */
  type Options = {
    /** External access key address. Alternative to `publicKey`. */
    address?: Address.Address | undefined
    /** Chain ID the key authorization is scoped to. */
    chainId: bigint | number
    /** Unix timestamp when the key expires. */
    expiry: number
    /** External key type. Defaults to `secp256k1` for external keys. */
    keyType?: 'secp256k1' | 'p256' | 'webAuthn' | undefined
    /** TIP-20 spending limits for this key. */
    limits?: readonly KeyAuthorization.TokenLimit[] | undefined
    /** External public key to derive the access key address from. */
    publicKey?: Hex.Hex | undefined
    /** Call scopes restricting which contracts/selectors this key can call. */
    scopes?: readonly KeyAuthorization.Scope[] | undefined
  }

  /** Prepared unsigned key authorization and optional local key material. */
  type ReturnType = {
    /** Unsigned key authorization to sign with the root account. */
    keyAuthorization: KeyAuthorization.KeyAuthorization<false>
    /** Generated WebCrypto key pair for local access keys. */
    keyPair?: Awaited<globalThis.ReturnType<typeof WebCryptoP256.createKeyPair>> | undefined
  }
}

/** Saves a prepared access key authorization with an existing signature. */
export function saveAuthorization(
  options: saveAuthorization.Options,
): saveAuthorization.ReturnType {
  const { address, prepared, signature, store } = options
  const keyAuthorization = KeyAuthorization.from(prepared.keyAuthorization, {
    signature: SignatureEnvelope.from(signature),
  })

  AccessKeyStore.upsertAuthorization({
    address,
    keyAuthorization,
    ...(prepared.keyPair ? { keyPair: prepared.keyPair } : {}),
    state: 'signed',
    store,
  })

  return KeyAuthorization.toRpc(keyAuthorization)
}

export declare namespace saveAuthorization {
  /** Options for {@link saveAuthorization}. */
  type Options = {
    /** Root account address that owns this access key. */
    address: Address.Address
    /** Prepared unsigned key authorization returned by {@link prepareAuthorization}. */
    prepared: prepareAuthorization.ReturnType
    /** Signature over the key authorization digest. */
    signature: Hex.Hex
    /** Reactive state store. */
    store: Store.Store
  }

  /** Signed key authorization in RPC form. */
  type ReturnType = KeyAuthorization.Rpc
}

/** Prepares, signs, and saves an access key authorization. */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { account, chainId, parameters, store } = options
  const prepared = await prepareAuthorization({
    ...parameters,
    chainId: parameters.chainId ?? chainId,
  })
  return await signAuthorization({ account, prepared, store })
}

export declare namespace authorize {
  /** Options for {@link authorize}. */
  type Options = {
    /** Root account that owns this access key and signs its authorization. */
    account: TempoAccount.Account
    /** Default chain ID for the authorization when `parameters.chainId` is not set. */
    chainId: bigint | number
    /** Access key authorization parameters. */
    parameters: Omit<prepareAuthorization.Options, 'chainId'> & {
      /** Chain ID the key authorization is scoped to. */
      chainId?: bigint | number | undefined
    }
    /** Reactive state store. */
    store: Store.Store
  }

  /** Signed key authorization in RPC form. */
  type ReturnType = KeyAuthorization.Rpc
}

async function signAuthorization(
  options: signAuthorization.Options,
): Promise<signAuthorization.ReturnType> {
  const { account, prepared, store } = options
  const digest = KeyAuthorization.getSignPayload(prepared.keyAuthorization)
  const signature = await account.sign({ hash: digest })
  return saveAuthorization({ address: account.address, prepared, signature, store })
}

declare namespace signAuthorization {
  type Options = {
    account: TempoAccount.Account
    prepared: prepareAuthorization.ReturnType
    store: Store.Store
  }

  type ReturnType = KeyAuthorization.Rpc
}
