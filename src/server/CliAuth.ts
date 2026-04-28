import { Address, Base64, Bytes, Hex, PublicKey } from 'ox'
import { KeyAuthorization as TempoKeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { createClient, http, type Chain, type Client, type Transport } from 'viem'
import { verifyHash } from 'viem/actions'
import { tempo } from 'viem/chains'
import * as z from 'zod/mini'

import * as u from '../core/zod/utils.js'
import type { MaybePromise } from '../internal/types.js'
import type { Kv } from './Kv.js'

const limit = z.object({ token: u.address(), limit: u.bigint() })
const limits = z.readonly(z.array(limit))
const defaultTtlMs = 10 * 60 * 1_000
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Supported access-key types for CLI bootstrap. */
export const keyType = z.union([z.literal('secp256k1'), z.literal('p256'), z.literal('webAuthn')])

/** Signed key authorization returned by the device-code flow. */
export const keyAuthorization = z.object({
  address: u.address(),
  chainId: u.bigint(),
  expiry: z.union([u.number(), z.null(), z.undefined()]),
  keyId: u.address(),
  keyType,
  limits: z.optional(limits),
  signature: z.custom<SignatureEnvelope.SignatureEnvelopeRpc>(),
})

/** CLI auth device-code creation request body. */
export const createRequest = z.object({
  account: z.optional(u.address()),
  chainId: z.optional(u.bigint()),
  codeChallenge: z.string(),
  expiry: z.optional(z.number()),
  keyType: z.optional(keyType),
  limits: z.optional(limits),
  pubKey: u.hex(),
})

/** Response body for `POST /cli-auth/device-code`. */
export const createResponse = z.object({
  code: z.string(),
})

/** Request body for `POST /auth/pkce/poll/:code`. */
export const pollRequest = z.object({
  codeVerifier: z.string(),
})

/** Response body for `POST /auth/pkce/poll/:code`. */
export const pollResponse = u.oneOf([
  z.object({
    status: z.literal('pending'),
  }),
  z.object({
    status: z.literal('authorized'),
    accountAddress: u.address(),
    keyAuthorization: keyAuthorization,
  }),
  z.object({
    status: z.literal('expired'),
  }),
])

/** Response body for `GET /auth/pkce/pending/:code`. */
export const pendingResponse = z.object({
  accessKeyAddress: u.address(),
  account: z.optional(u.address()),
  chainId: u.bigint(),
  code: z.string(),
  expiry: z.number(),
  keyType,
  limits: z.optional(limits),
  pubKey: u.hex(),
  status: z.literal('pending'),
})

/** Request body for `POST /auth/pkce`. */
export const authorizeRequest = z.object({
  accountAddress: u.address(),
  code: z.string(),
  keyAuthorization: keyAuthorization,
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
    limits: z.optional(limits),
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
    limits: z.optional(limits),
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
    limits: z.optional(limits),
    pubKey: u.hex(),
    status: z.literal('consumed'),
  }),
])

/** Shared CLI auth helper with pre-bound defaults and cached clients. */
export type CliAuth = {
  /** Creates and stores a new device code. */
  createDeviceCode: (options: createDeviceCode.Parameters) => Promise<createDeviceCode.ReturnType>
  /** Looks up a pending device code for browser approval UIs. */
  pending: (options: pending.Parameters) => Promise<pending.ReturnType>
  /** Polls a device code with PKCE verification. */
  poll: (options: poll.Parameters) => Promise<poll.ReturnType>
  /** Authorizes a pending device code after validating the signed key authorization. */
  authorize: (options: authorize.Parameters) => Promise<authorize.ReturnType>
}

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

/** Host validation and sanitization for requested CLI auth defaults. */
export type Policy = {
  /** Validates and optionally rewrites requested defaults before the entry is stored. */
  validate: (options: Policy.validate.Options) => MaybePromise<Policy.validate.ReturnType>
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
      accountAddress: Address.Address
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

export declare namespace Policy {
  export namespace validate {
    export type Options = {
      /** Requested root account restriction. */
      account?: Address.Address | undefined
      /** Requested chain ID. */
      chainId: bigint
      /** Requested access-key expiry timestamp. Omit to let the server choose one. */
      expiry?: number | undefined
      /** Requested key type. */
      keyType: z.output<typeof keyType>
      /** Requested spending limits. */
      limits?: readonly { token: Address.Address; limit: bigint }[] | undefined
      /** Requested access-key public key. */
      pubKey: Hex.Hex
    }

    export type ReturnType = {
      /** Suggested access-key expiry timestamp. */
      expiry: number
      /** Suggested spending limits. */
      limits?: readonly { token: Address.Address; limit: bigint }[] | undefined
    }
  }
}

/** Error thrown when pending device-code lookup cannot return a pending request. */
export class PendingError extends Error {
  /** HTTP status returned by handler surfaces. */
  status: 400 | 404

  constructor(message: string, status: 400 | 404) {
    super(message)
    this.name = 'PendingError'
    this.status = status
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

/**
 * Instantiates a CLI auth helper with shared defaults and cached clients.
 *
 *
 * @param {from.Options} options - Shared CLI auth defaults.
 * @returns {CliAuth} CLI auth helper.
 *
 * @example
 * ```ts
 * import { CliAuth } from 'accounts/server'
 *
 * const cli = CliAuth.from({
 *   store: CliAuth.Store.memory(),
 * })
 *
 * const created = await cli.createDeviceCode({ request })
 * const authorized = await cli.authorize({ request })
 * const polled = await cli.poll({ request })
 * const pending = await cli.pending({ code })
 * ```
 */
export function from(options: from.Options = {}): CliAuth {
  const cache = createClientCache(options)
  const {
    chainId,
    now = Date.now,
    policy = Policy.allow(),
    random = randomBytes,
    store = Store.memory(),
    ttlMs = defaultTtlMs,
  } = options

  return {
    async authorize(options) {
      const code = normalizeCode(options.request.code)
      const current = await store.get(code)
      if (!current) throw new Error('Unknown device code.')
      if (isExpired(current, now)) {
        await store.delete(code)
        throw new Error('Expired device code.')
      }
      if (current.status !== 'pending') throw new Error('Device code already completed.')
      if (
        current.account &&
        current.account.toLowerCase() !== options.request.accountAddress.toLowerCase()
      )
        throw new Error('Account does not match requested account.')

      const expected = expectedKeyAuthorization(current)
      const actual = normalizeKeyAuthorization(options.request.keyAuthorization)

      if (actual.keyId.toLowerCase() !== expected.address.toLowerCase())
        throw new Error('Key authorization key does not match the device-code request.')
      if (actual.address.toLowerCase() !== expected.address.toLowerCase())
        throw new Error('Key authorization address does not match the device-code request.')
      if (actual.keyType !== expected.type)
        throw new Error('Key authorization key type does not match the device-code request.')
      if (actual.chainId !== expected.chainId)
        throw new Error('Key authorization chain does not match the device-code request.')

      const signed = TempoKeyAuthorization.from({
        address: actual.address,
        chainId: actual.chainId,
        expiry: actual.expiry,
        ...(actual.limits ? { limits: actual.limits } : {}),
        type: actual.keyType,
      })

      const valid = await verifyHash((options.client ?? cache.get(current.chainId)) as never, {
        address: options.request.accountAddress,
        hash: TempoKeyAuthorization.getSignPayload(signed),
        signature: SignatureEnvelope.serialize(SignatureEnvelope.fromRpc(actual.signature), {
          magic: actual.signature.type === 'webAuthn',
        }),
      })
      if (!valid) throw new Error('Key authorization signature is invalid.')

      const signedKeyAuthorization = {
        address: options.request.keyAuthorization.address,
        chainId: options.request.keyAuthorization.chainId,
        expiry: actual.expiry,
        keyId: options.request.keyAuthorization.keyId,
        keyType: options.request.keyAuthorization.keyType,
        ...(actual.limits ? { limits: actual.limits } : {}),
        signature: options.request.keyAuthorization.signature,
      } satisfies z.output<typeof keyAuthorization>

      const authorized = await store.authorize({
        accountAddress: options.request.accountAddress,
        code,
        keyAuthorization: signedKeyAuthorization,
      })
      if (!authorized) throw new Error('Unable to authorize device code.')

      return { status: 'authorized' }
    },
    async createDeviceCode(options) {
      const nextChainId = options.request.chainId ?? chainId ?? cache.defaultChainId
      const { account, codeChallenge, pubKey } = options.request
      const keyType = options.request.keyType ?? 'secp256k1'
      const approved = await policy.validate({
        ...(account ? { account } : {}),
        chainId: typeof nextChainId === 'bigint' ? nextChainId : BigInt(nextChainId),
        expiry: options.request.expiry,
        keyType,
        ...(options.request.limits ? { limits: options.request.limits } : {}),
        pubKey,
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
        chainId: typeof nextChainId === 'bigint' ? nextChainId : BigInt(nextChainId),
        code,
        codeChallenge,
        createdAt,
        expiresAt: createdAt + ttlMs,
        expiry: approved.expiry,
        keyType,
        ...(approved.limits ? { limits: approved.limits } : {}),
        pubKey,
        status: 'pending',
      })

      return { code }
    },
    async pending(options) {
      const normalized = normalizeCode(options.code)
      const current = await store.get(normalized)
      if (!current) throw new PendingError('Unknown device code.', 404)
      if (isExpired(current, now)) {
        await store.delete(normalized)
        throw new PendingError('Expired device code.', 404)
      }
      if (current.status !== 'pending')
        throw new PendingError('Device code already completed.', 400)

      return {
        accessKeyAddress: Address.fromPublicKey(PublicKey.from(current.pubKey)),
        ...(current.account ? { account: current.account } : {}),
        chainId: current.chainId,
        code: current.code,
        expiry: current.expiry,
        keyType: current.keyType,
        ...(current.limits ? { limits: current.limits } : {}),
        pubKey: current.pubKey,
        status: 'pending',
      }
    },
    async poll(options) {
      const normalized = normalizeCode(options.code)
      const current = await store.get(normalized)
      if (!current) return { status: 'expired' }
      if (isExpired(current, now)) {
        await store.delete(normalized)
        return { status: 'expired' }
      }
      if (!(await verifyCodeChallenge(options.request.codeVerifier, current.codeChallenge)))
        throw new Error('Invalid code verifier.')
      if (current.status === 'pending') return { status: 'pending' }
      if (current.status === 'consumed') {
        await store.delete(normalized)
        return { status: 'expired' }
      }
      const authorized = await store.consume(normalized)
      if (!authorized) return { status: 'expired' }
      return {
        accountAddress: authorized.accountAddress,
        keyAuthorization: authorized.keyAuthorization,
        status: 'authorized',
      }
    },
  }
}

export declare namespace from {
  /** Shared CLI auth helper configuration. */
  export type Options = {
    /** Default chain ID embedded into created device codes. @default tempo.id */
    chainId?: bigint | number | undefined
    /**
     * Preconfigured chains used to build and cache viem clients.
     *
     * Unknown chain IDs are cached lazily using a tempo-shaped chain object so
     * standalone helpers can still verify signatures without a full chain list.
     *
     * @default [tempo]
     */
    chains?: readonly [Chain, ...Chain[]] | undefined
    /** Time source used for TTL evaluation. */
    now?: (() => number) | undefined
    /** Policy used to validate requested expiry and limits. */
    policy?: Policy | undefined
    /** Random byte generator used for verification code allocation. */
    random?: ((size: number) => Uint8Array) | undefined
    /** Device-code store. */
    store?: Store | undefined
    /** Pending entry TTL in milliseconds. @default 600000 */
    ttlMs?: number | undefined
    /** Transports keyed by chain ID. Defaults to `http()` for each chain. */
    transports?: Record<number, Transport> | undefined
  }
}

/**
 * Creates and stores a new device code.
 *
 * @param {createDeviceCode.Options} options - Shared defaults plus the incoming request.
 * @returns {Promise<createDeviceCode.ReturnType>} Created device code.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { CliAuth } from 'accounts/server'
 * import { zValidator } from '@hono/zod-validator'
 *
 * export default new Hono<{ Bindings: Cloudflare.Env }>()
 *   // ... other routes (`/authorize`, `/poll:code`, `/pending:code`)
 *   .post('/code',
 *    zValidator('json', CliAuth.createRequest),
 *    async (c) => {
 *      const request = c.req.valid('json')
 *      const result = await CliAuth.createDeviceCode({ request })
 *      return c.json(z.encode(CliAuth.createResponse, result))
 *    })
 * ```
 */
export async function createDeviceCode(
  options: createDeviceCode.Options,
): Promise<createDeviceCode.ReturnType> {
  const { request, ...rest } = options
  return from(rest).createDeviceCode({ request })
}

export declare namespace createDeviceCode {
  /** Parameters for creating a new device code. */
  export type Parameters = {
    /** Incoming device-code creation request. */
    request: z.output<typeof createRequest>
  }

  /** Shared CLI auth defaults plus create-device-code parameters. */
  export type Options = from.Options & Parameters

  /** Created device-code response body. */
  export type ReturnType = z.output<typeof createResponse>
}

/**
 * Looks up a pending device code for browser approval UIs.
 *
 * @param {pending.Options} options - Shared defaults plus the pending lookup parameters.
 * @returns {Promise<pending.ReturnType>} Pending device-code payload.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { CliAuth } from 'accounts/server'
 * import { zValidator } from '@hono/zod-validator'
 *
 * export default new Hono<{ Bindings: Cloudflare.Env }>()
 *   // ... other routes (`/code`, `/authorize`, `/poll:code`)
 *   .get('/pending:code',
 *    zValidator('param', z.object({ code: z.string() })),
 *    async (c) => {
 *      const code = c.req.param('code')
 *      const result = await CliAuth.pending({ code })
 *      return c.json(z.encode(CliAuth.pendingResponse, result))
 *    })
 */
export async function pending(options: pending.Options): Promise<pending.ReturnType> {
  const { code, ...rest } = options
  return from(rest).pending({ code })
}

export declare namespace pending {
  /** Parameters for looking up a pending device code. */
  export type Parameters = {
    /** Verification code from the route path. */
    code: string
  }

  /** Shared CLI auth defaults plus pending lookup parameters. */
  export type Options = from.Options & Parameters

  /** Pending device-code response body. */
  export type ReturnType = z.output<typeof pendingResponse>
}

/**
 * Polls a device code with PKCE verification.
 *
 * @param {poll.Options} options - Shared defaults plus the poll parameters.
 * @returns {Promise<poll.ReturnType>} Pending, authorized, or expired poll response.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { CliAuth } from 'accounts/server'
 * import { zValidator } from '@hono/zod-validator'
 *
 * export default new Hono<{ Bindings: Cloudflare.Env }>()
 *   // ... other routes (`/code`, `/authorize`, `/pending:code`)
 *   .post('/poll:code',
 *    zValidator('json', CliAuth.pollRequest),
 *    async (c) => {
 *      const request = c.req.valid('json')
 *      const result = await CliAuth.poll({ request })
 *      return c.json(z.encode(CliAuth.pollResponse, result))
 *    })
 * ```
 */
export async function poll(options: poll.Options): Promise<poll.ReturnType> {
  const { code, request, ...rest } = options
  return from(rest).poll({ code, request })
}

export declare namespace poll {
  /** Parameters for polling a device code. */
  export type Parameters = {
    /** Verification code from the route path. */
    code: string
    /** Poll request body. */
    request: z.output<typeof pollRequest>
  }

  /** Shared CLI auth defaults plus poll parameters. */
  export type Options = from.Options & Parameters

  /** Poll response body. */
  export type ReturnType = z.output<typeof pollResponse>
}

/**
 * Authorizes a pending device code after validating the signed key authorization.
 *
 * @param {authorize.Options} options - Shared defaults plus the authorization request.
 * @returns {Promise<authorize.ReturnType>} Authorized response body.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono'
 * import { CliAuth } from 'accounts/server'
 * import { zValidator } from '@hono/zod-validator'
 *
 * export default new Hono<{ Bindings: Cloudflare.Env }>()
 *   // ... other routes (`/code`, `/poll:code`, `/pending:code`)
 *   .post('/authorize',
 *    zValidator('json', CliAuth.authorizeRequest),
 *    async (c) => {
 *      const request = c.req.valid('json')
 *      const result = await CliAuth.authorize({ request })
 *      return c.json(z.encode(CliAuth.authorizeResponse, result))
 *    })
 * ```
 */
export async function authorize(options: authorize.Options): Promise<authorize.ReturnType> {
  const { client, request, ...rest } = options
  return from(rest).authorize({
    ...(client ? { client } : {}),
    request,
  })
}

export declare namespace authorize {
  /** Parameters for authorizing a pending device code. */
  export type Parameters = {
    /** Client used to verify the signed key authorization. */
    client?: Client<Transport, Chain | undefined> | undefined
    /** Authorize request body. */
    request: z.output<typeof authorizeRequest>
  }

  /** Shared CLI auth defaults plus authorization parameters. */
  export type Options = from.Options & Parameters

  /** Authorization response body. */
  export type ReturnType = z.output<typeof authorizeResponse>
}

/** @internal */
function randomBytes(size: number) {
  return Bytes.random(size)
}

/** @internal */
function createCode(random: (size: number) => Uint8Array) {
  const bytes = random(8)
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return code
}

/** @internal */
function createClientCache(options: from.Options = {}) {
  const chains = options.chains ?? [tempo]
  const transports = options.transports ?? {}
  const clients = new Map<number, Client<Transport, Chain | undefined>>()

  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(chain.id, createClient({ chain, transport }))
  }

  const defaultChainId = options.chainId ?? chains[0]!.id

  return {
    defaultChainId,
    get(chainId: bigint | number = defaultChainId) {
      const id = typeof chainId === 'bigint' ? Number(chainId) : chainId
      const current = clients.get(id)
      if (current) return current
      const client = createClient({
        chain: {
          ...tempo,
          id,
        },
        transport: transports[id] ?? http(),
      })
      clients.set(id, client)
      return client
    },
  }
}

/** @internal */
function normalizeCode(code: string) {
  return code.replaceAll('-', '').toUpperCase()
}

/** @internal */
function expectedKeyAuthorization(entry: Entry.Pending) {
  return TempoKeyAuthorization.from({
    address: Address.fromPublicKey(PublicKey.from(entry.pubKey)),
    chainId: entry.chainId,
    expiry: entry.expiry,
    ...(entry.limits ? { limits: entry.limits } : {}),
    type: entry.keyType,
  })
}

/** @internal */
function isExpired(entry: Entry, now: () => number) {
  return now() > entry.expiresAt
}

/** @internal */
function normalizeKeyAuthorization(value: z.output<typeof keyAuthorization>) {
  return {
    ...value,
    expiry: value.expiry ?? undefined,
    limits: value.limits ?? undefined,
  }
}

/** @internal */
async function verifyCodeChallenge(codeVerifier: string, codeChallenge: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true }) === codeChallenge
}
