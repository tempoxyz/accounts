import { Address as core_Address, Base64, Hex, PublicKey } from 'ox'
import { KeyAuthorization as TempoKeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { createClient, http, type Chain, type Client, type Transport } from 'viem'
import type { Address } from 'viem/accounts'
import { verifyHash } from 'viem/actions'
import { tempo } from 'viem/chains'
import * as z from 'zod/mini'

import * as u from '../core/zod/utils.js'
import type { MaybePromise } from '../internal/types.js'
import type { Kv } from './Kv.js'

/** Supported access-key types for CLI bootstrap. */
export const keyType = z.union([z.literal('secp256k1'), z.literal('p256'), z.literal('webAuthn')])

/** Signed key authorization returned by the device-code flow. */
export const keyAuthorization = z.object({
  address: u.address(),
  chainId: u.bigint(),
  expiry: z.nullish(u.number()),
  keyId: u.address(),
  keyType,
  limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
  signature: z.custom<SignatureEnvelope.SignatureEnvelopeRpc>(),
})

/** Request body for `POST /cli-auth/device-code`. */
export const createRequest = z.object({
  account: z.optional(u.address()),
  code_challenge: z.string(),
  expiry: z.optional(z.number()),
  key_type: z.optional(keyType),
  limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
  pub_key: u.hex(),
})

/** Response body for `POST /cli-auth/device-code`. */
export const createResponse = z.object({
  code: z.string(),
})

/** Request body for `POST /cli-auth/poll/:code`. */
export const pollRequest = z.object({
  code_verifier: z.string(),
})

/** Response body for `POST /cli-auth/poll/:code`. */
export const pollResponse = u.oneOf([
  z.object({
    status: z.literal('pending'),
  }),
  z.object({
    status: z.literal('authorized'),
    account_address: u.address(),
    key_authorization: keyAuthorization,
  }),
  z.object({
    status: z.literal('expired'),
  }),
])

/** Response body for `GET /cli-auth/pending/:code`. */
export const pendingResponse = z.object({
  access_key_address: u.address(),
  account: z.optional(u.address()),
  chain_id: u.bigint(),
  code: z.string(),
  expiry: z.number(),
  key_type: keyType,
  limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
  pub_key: u.hex(),
  status: z.literal('pending'),
})

/** Request body for `POST /cli-auth/authorize`. */
export const authorizeRequest = z.object({
  account_address: u.address(),
  code: z.string(),
  key_authorization: keyAuthorization,
})

/** Response body for `POST /cli-auth/authorize`. */
export const authorizeResponse = z.object({
  status: z.literal('authorized'),
})

/** Stored device-code entry schema. */
export const entry = u.oneOf([
  z.object({
    account: z.optional(u.address()),
    chainId: u.bigint(),
    code: z.string(),
    codeChallenge: z.string(),
    createdAt: z.number(),
    expiresAt: z.number(),
    expiry: z.number(),
    keyType,
    limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
    pubKey: u.hex(),
    status: z.literal('pending'),
  }),
  z.object({
    account: z.optional(u.address()),
    accountAddress: u.address(),
    authorizedAt: z.number(),
    chainId: u.bigint(),
    code: z.string(),
    codeChallenge: z.string(),
    createdAt: z.number(),
    expiresAt: z.number(),
    expiry: z.number(),
    keyAuthorization,
    keyType,
    limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
    pubKey: u.hex(),
    status: z.literal('authorized'),
  }),
  z.object({
    account: z.optional(u.address()),
    accountAddress: u.address(),
    authorizedAt: z.number(),
    chainId: u.bigint(),
    code: z.string(),
    codeChallenge: z.string(),
    consumedAt: z.number(),
    createdAt: z.number(),
    expiresAt: z.number(),
    expiry: z.number(),
    keyAuthorization,
    keyType,
    limits: z.optional(z.readonly(z.array(z.object({ token: u.address(), limit: u.bigint() })))),
    pubKey: u.hex(),
    status: z.literal('consumed'),
  }),
])

/** Stored device-code entry. */
export type Entry = z.output<typeof entry>

/** Device-code storage contract. */
export type Store = {
  /** Saves a new pending device-code entry. */
  create: (entry: Entry.Pending) => MaybePromise<void>
  /** Loads a device-code entry by verification code. */
  get: (code: string) => MaybePromise<Entry | undefined>
  /** Marks a pending device-code as authorized. */
  authorize: (options: Store.authorize.Options) => MaybePromise<Entry.Authorized | undefined>
  /** Consumes an authorized device-code exactly once. */
  consume: (code: string) => MaybePromise<Entry.Authorized | undefined>
  /** Deletes a device-code entry. */
  delete: (code: string) => MaybePromise<void>
}

export declare namespace Entry {
  /** Pending device-code entry. */
  export type Pending = Extract<z.output<typeof entry>, { status: 'pending' }>
  /** Authorized device-code entry. */
  export type Authorized = Extract<z.output<typeof entry>, { status: 'authorized' }>
  /** Consumed device-code entry. */
  export type Consumed = Extract<z.output<typeof entry>, { status: 'consumed' }>
}

export declare namespace Store {
  export namespace authorize {
    export type Options = {
      /** Root account that approved the access key. */
      accountAddress: Address
      /** Signed key authorization. */
      keyAuthorization: z.output<typeof keyAuthorization>
      /** Verification code to authorize. */
      code: string
    }
  }

  export namespace kv {
    export type Options = {
      /** Prefix used for KV keys. @default "cli-auth" */
      key?: string | undefined
    }
  }
}

/** Error thrown when pending device-code lookup cannot return a pending request. */
export class PendingError extends Error {
  status: 400 | 404

  constructor(message: string, status: 400 | 404) {
    super(message)
    this.name = 'PendingError'
    this.status = status
  }
}

/** Host validation and sanitization for requested CLI auth defaults. */
export type Policy = {
  /** Validates and optionally rewrites requested policy before the entry is stored. */
  validate: (options: Policy.validate.Options) => MaybePromise<Policy.validate.ReturnType>
}

export declare namespace Policy {
  export namespace validate {
    export type Options = {
      /** Requested root account restriction. */
      account?: Address | undefined
      /** Requested access-key expiry timestamp. Omit to let the server choose one. */
      expiry?: number | undefined
      /** Requested key type. */
      keyType: z.output<typeof keyType>
      /** Requested spending limits. */
      limits?: readonly { token: Address; limit: bigint }[] | undefined
      /** Requested access-key public key. */
      pubKey: Hex.Hex
    }

    export type ReturnType = {
      /** Approved access-key expiry timestamp. */
      expiry: number
      /** Approved spending limits. */
      limits?: readonly { token: Address; limit: bigint }[] | undefined
    }
  }
}

/** Built-in device-code store helpers. */
export const Store = {
  /**
   * Creates an in-memory device-code store.
   *
   * Useful for tests and single-process servers.
   */
  memory(): Store {
    const entries = new Map<string, Entry>()

    return {
      async authorize(options) {
        const current = entries.get(options.code)
        if (!current || current.status !== 'pending') return undefined
        const next = {
          ...current,
          accountAddress: options.accountAddress,
          authorizedAt: Date.now(),
          keyAuthorization: options.keyAuthorization,
          status: 'authorized',
        } satisfies Entry.Authorized
        entries.set(options.code, next)
        return next
      },
      async consume(code) {
        const current = entries.get(code)
        if (!current || current.status !== 'authorized') return undefined
        entries.set(code, {
          ...current,
          consumedAt: Date.now(),
          status: 'consumed',
        } satisfies Entry.Consumed)
        return current
      },
      async create(entry_) {
        entries.set(entry_.code, entry_)
      },
      async delete(code) {
        entries.delete(code)
      },
      async get(code) {
        return entries.get(code)
      },
    }
  },
  /**
   * Creates a key-value backed device-code store.
   *
   * Stored values are encoded through the shared entry schema so they remain
   * JSON-safe across KV implementations.
   */
  kv(kv: Kv, options: Store.kv.Options = {}): Store {
    const key = options.key ?? 'cli-auth'

    function toKey(code: string) {
      return `${key}:${code}`
    }

    return {
      async authorize(options) {
        const current = await this.get(options.code)
        if (!current || current.status !== 'pending') return undefined
        const next = {
          ...current,
          accountAddress: options.accountAddress,
          authorizedAt: Date.now(),
          keyAuthorization: options.keyAuthorization,
          status: 'authorized',
        } satisfies Entry.Authorized
        await kv.set(toKey(options.code), z.encode(entry, next))
        return next
      },
      async consume(code) {
        const current = await this.get(code)
        if (!current || current.status !== 'authorized') return undefined
        await kv.set(
          toKey(code),
          z.encode(entry, {
            ...current,
            consumedAt: Date.now(),
            status: 'consumed',
          } satisfies Entry.Consumed),
        )
        return current
      },
      async create(entry_) {
        await kv.set(toKey(entry_.code), z.encode(entry, entry_))
      },
      async delete(code) {
        await kv.delete(toKey(code))
      },
      async get(code) {
        const value = await kv.get<z.input<typeof entry>>(toKey(code))
        if (!value) return undefined
        return z.decode(entry, value)
      },
    }
  },
}

/** Built-in policy helpers. */
export const Policy = {
  /** Creates an allow-all policy with a default 24-hour expiry when omitted. */
  allow(): Policy {
    return {
      validate({ expiry, limits }) {
        return {
          expiry: expiry ?? Math.floor(Date.now() / 1000) + 60 * 60 * 24,
          ...(limits ? { limits } : {}),
        }
      },
    }
  },
  /** Returns the provided policy unchanged. */
  from(policy: Policy): Policy {
    return policy
  },
}

/** Creates and stores a new device code. */
export async function createDeviceCode(
  options: createDeviceCode.Options,
): Promise<createDeviceCode.ReturnType> {
  const {
    chainId = BigInt(tempo.id),
    now = Date.now,
    policy = Policy.allow(),
    random = randomBytes,
    request,
    store = Store.memory(),
    ttlMs = 10 * 60 * 1_000,
  } = options
  const { account, code_challenge, pub_key } = request
  const keyType = request.key_type ?? 'secp256k1'
  const approved = await policy.validate({
    ...(account ? { account } : {}),
    expiry: request.expiry,
    keyType,
    ...(request.limits ? { limits: request.limits } : {}),
    pubKey: pub_key,
  })

  let code: string | undefined
  for (let i = 0; i < 10; i++) {
    const candidate = createCode(random)
    if (await store.get(candidate)) continue
    code = candidate
    break
  }
  if (!code) throw new Error('Unable to allocate device code.')

  const createdAt = now()

  await store.create({
    ...(account ? { account } : {}),
    chainId: typeof chainId === 'bigint' ? chainId : BigInt(chainId),
    code,
    codeChallenge: code_challenge,
    createdAt,
    expiresAt: createdAt + ttlMs,
    expiry: approved.expiry,
    keyType,
    ...(approved.limits ? { limits: approved.limits } : {}),
    pubKey: pub_key,
    status: 'pending',
  })

  return { code }
}

export declare namespace createDeviceCode {
  export type Options = {
    /** Chain ID embedded into the expected key authorization. @default tempo.id */
    chainId?: bigint | number | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Policy used to validate requested expiry and limits. */
    policy?: Policy | undefined
    /** Random byte generator used for verification code allocation. */
    random?: ((size: number) => Uint8Array) | undefined
    /** Incoming device-code creation request. */
    request: z.output<typeof createRequest>
    /** Device-code store. */
    store?: Store | undefined
    /** Pending entry TTL in milliseconds. @default 600000 */
    ttlMs?: number | undefined
  }

  export type ReturnType = z.output<typeof createResponse>
}

/** Looks up a pending device code for browser approval UIs. */
export async function pending(options: pending.Options): Promise<pending.ReturnType> {
  const { code, now = Date.now, store = Store.memory() } = options
  const normalized = normalizeCode(code)
  const current = await store.get(normalized)
  if (!current) throw new PendingError('Unknown device code.', 404)
  if (isExpired(current, now)) {
    await store.delete(normalized)
    throw new PendingError('Expired device code.', 404)
  }
  if (current.status !== 'pending') throw new PendingError('Device code already completed.', 400)

  return {
    access_key_address: core_Address.fromPublicKey(PublicKey.from(current.pubKey)),
    ...(current.account ? { account: current.account } : {}),
    chain_id: current.chainId,
    code: current.code,
    expiry: current.expiry,
    key_type: current.keyType,
    ...(current.limits ? { limits: current.limits } : {}),
    pub_key: current.pubKey,
    status: 'pending',
  }
}

export declare namespace pending {
  export type Options = {
    /** Verification code from the route path. */
    code: string
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Device-code store. */
    store?: Store | undefined
  }

  export type ReturnType = z.output<typeof pendingResponse>
}

/** Polls a device code with PKCE verification. */
export async function poll(options: poll.Options): Promise<poll.ReturnType> {
  const { code, now = Date.now, request, store = Store.memory() } = options
  const normalized = normalizeCode(code)
  const current = await store.get(normalized)
  if (!current) return { status: 'expired' }
  if (isExpired(current, now)) {
    await store.delete(normalized)
    return { status: 'expired' }
  }
  if (!(await verifyCodeChallenge(request.code_verifier, current.codeChallenge)))
    throw new Error('Invalid code verifier.')
  if (current.status === 'pending') return { status: 'pending' }
  if (current.status === 'consumed') {
    await store.delete(normalized)
    return { status: 'expired' }
  }
  const authorized = await store.consume(normalized)
  if (!authorized) return { status: 'expired' }
  return {
    account_address: authorized.accountAddress,
    key_authorization: authorized.keyAuthorization,
    status: 'authorized',
  }
}

export declare namespace poll {
  export type Options = {
    /** Verification code from the route path. */
    code: string
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Poll request body. */
    request: z.output<typeof pollRequest>
    /** Device-code store. */
    store?: Store | undefined
  }

  export type ReturnType = z.output<typeof pollResponse>
}

/** Authorizes a pending device code after validating the signed key authorization. */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const {
    chainId,
    client = getClient({ chainId }),
    now = Date.now,
    request,
    store = Store.memory(),
  } = options
  const code = normalizeCode(request.code)
  const current = await store.get(code)
  if (!current) throw new Error('Unknown device code.')
  if (isExpired(current, now)) {
    await store.delete(code)
    throw new Error('Expired device code.')
  }
  if (current.status !== 'pending') throw new Error('Device code already completed.')
  if (current.account && current.account.toLowerCase() !== request.account_address.toLowerCase())
    throw new Error('Account does not match requested account.')

  const expected = expectedKeyAuthorization(current)
  const actual = normalizeKeyAuthorization(request.key_authorization)

  if (actual.keyId.toLowerCase() !== expected.address.toLowerCase())
    throw new Error('Key authorization key does not match the device-code request.')
  if (actual.address.toLowerCase() !== expected.address.toLowerCase())
    throw new Error('Key authorization address does not match the device-code request.')
  if (actual.keyType !== expected.type)
    throw new Error('Key authorization key type does not match the device-code request.')
  if (actual.chainId !== expected.chainId)
    throw new Error('Key authorization chain does not match the device-code request.')
  if ((actual.expiry ?? undefined) !== (expected.expiry ?? undefined))
    throw new Error('Key authorization expiry does not match the device-code request.')
  if (!sameLimits(actual.limits, expected.limits))
    throw new Error('Key authorization limits do not match the device-code request.')

  const valid = await verifyHash(client as never, {
    address: request.account_address,
    hash: TempoKeyAuthorization.getSignPayload(expected),
    signature: SignatureEnvelope.serialize(SignatureEnvelope.fromRpc(actual.signature), {
      magic: actual.signature.type === 'webAuthn',
    }),
  })
  if (!valid) throw new Error('Key authorization signature is invalid.')

  const authorized = await store.authorize({
    accountAddress: request.account_address,
    code,
    keyAuthorization: request.key_authorization,
  })
  if (!authorized) throw new Error('Unable to authorize device code.')

  return { status: 'authorized' }
}

export declare namespace authorize {
  export type Options = {
    /** Chain ID embedded into the expected key authorization. Defaults to the client chain or tempo.id. */
    chainId?: bigint | number | undefined
    /** Client used to verify the signed key authorization. */
    client?: Client<Transport, Chain | undefined> | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Authorize request body. */
    request: z.output<typeof authorizeRequest>
    /** Device-code store. */
    store?: Store | undefined
  }

  export type ReturnType = z.output<typeof authorizeResponse>
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function createCode(random: (size: number) => Uint8Array) {
  const bytes = random(8)
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return code
}

function normalizeCode(code: string) {
  return code.replaceAll('-', '').toUpperCase()
}

function expectedKeyAuthorization(entry: Entry.Pending) {
  return TempoKeyAuthorization.from({
    address: core_Address.fromPublicKey(PublicKey.from(entry.pubKey)),
    chainId: entry.chainId,
    expiry: entry.expiry,
    ...(entry.limits ? { limits: entry.limits } : {}),
    type: entry.keyType,
  })
}

function getClient(options: { chainId?: bigint | number | undefined } = {}) {
  const chainId = options.chainId
  return createClient({
    chain: chainId
      ? {
          ...tempo,
          id: typeof chainId === 'bigint' ? Number(chainId) : chainId,
        }
      : tempo,
    transport: http(),
  })
}

function isExpired(entry: Entry, now: () => number) {
  return now() > entry.expiresAt
}

function normalizeKeyAuthorization(value: z.output<typeof keyAuthorization>) {
  return {
    ...value,
    expiry: value.expiry ?? undefined,
    limits: value.limits ?? undefined,
  }
}

function randomBytes(size: number) {
  return crypto.getRandomValues(new Uint8Array(size))
}

function sameLimits(
  a: readonly { token: Address; limit: bigint }[] | undefined,
  b: readonly { token: Address; limit: bigint }[] | undefined,
) {
  if (!a && !b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((limit, i) => {
    const other = b[i]
    if (!other) return false
    return limit.token.toLowerCase() === other.token.toLowerCase() && limit.limit === other.limit
  })
}

async function verifyCodeChallenge(codeVerifier: string, codeChallenge: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true }) === codeChallenge
}
