import { Address, Base64, Bytes, Hex, PublicKey } from 'ox'
import { KeyAuthorization as TempoKeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { createClient, http, type Chain, type Client, type Transport } from 'viem'
import { verifyHash } from 'viem/actions'
import { Actions } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as z from 'zod/mini'

import * as AccessKey from '../core/AccessKey.js'
import * as u from '../core/zod/utils.js'
import type { MaybePromise } from '../internal/types.js'
import type { Kv } from './Kv.js'

const maxLimits = 10
const limit = z.object({ token: u.address(), limit: u.bigint() })
const limits = z.readonly(z.array(limit).check(z.maxLength(maxLimits)))
const showDeposit = z.optional(
  z.union([
    z.boolean(),
    z.object({
      amount: z.optional(z.string()),
      displayName: z.optional(z.string()),
      on: z.optional(z.union([z.literal('login'), z.literal('register')])),
      token: z.optional(z.union([u.address(), z.string()])),
    }),
  ]),
)
const defaultTtlMs = 10 * 60 * 1_000
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** Supported access key types for CLI bootstrap. */
export const keyType = z.union([z.literal('secp256k1'), z.literal('p256'), z.literal('webAuthn')])

/** Signed key authorization returned by the device code flow. */
export const keyAuthorization = z.object({
  address: u.address(),
  chainId: u.bigint(),
  expiry: z.union([u.number(), z.null(), z.undefined()]),
  keyId: u.address(),
  keyType,
  limits: z.optional(limits),
  signature: z.custom<SignatureEnvelope.SignatureEnvelopeRpc>(),
})

const authorizeAccessKeyCreateRequest = z.object({
  action: z.optional(z.literal('authorizeAccessKey')),
  account: z.optional(u.address()),
  chainId: z.optional(u.bigint()),
  codeChallenge: z.string(),
  expiry: z.optional(z.number()),
  keyType: z.optional(keyType),
  limits: z.optional(limits),
  pubKey: u.hex(),
  showDeposit,
})

const updateAccessKeyCreateRequest = z.object({
  action: z.literal('updateAccessKey'),
  accessKeyAddress: u.address(),
  account: u.address(),
  chainId: z.optional(u.bigint()),
  codeChallenge: z.string(),
  keyAuthorization: z.optional(keyAuthorization),
  limits: z.readonly(z.array(limit).check(z.minLength(1), z.maxLength(maxLimits))),
})

/** CLI auth device code creation request body. */
export const createRequest = u.oneOf([
  authorizeAccessKeyCreateRequest,
  updateAccessKeyCreateRequest,
])

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
    action: z.literal('updateAccessKey'),
    keyAuthorization: z.optional(keyAuthorization),
    status: z.literal('authorized'),
  }),
  z.object({
    status: z.literal('expired'),
  }),
])

/** Response body for `GET /auth/pkce/pending/:code`. */
export const pendingResponse = u.oneOf([
  z.object({
    action: z.optional(z.literal('authorizeAccessKey')),
    accessKeyAddress: u.address(),
    account: z.optional(u.address()),
    chainId: u.bigint(),
    code: z.string(),
    expiry: z.number(),
    keyType,
    limits: z.optional(limits),
    pubKey: u.hex(),
    showDeposit,
    status: z.literal('pending'),
  }),
  z.object({
    action: z.literal('updateAccessKey'),
    accessKeyAddress: u.address(),
    account: u.address(),
    chainId: u.bigint(),
    code: z.string(),
    keyAuthorization: z.optional(keyAuthorization),
    limits: z.readonly(z.array(limit).check(z.minLength(1), z.maxLength(maxLimits))),
    status: z.literal('pending'),
  }),
])

/** Request body for `POST /auth/pkce`. */
export const authorizeRequest = u.oneOf([
  z.object({
    action: z.optional(z.literal('authorizeAccessKey')),
    accountAddress: u.address(),
    code: z.string(),
    keyAuthorization: keyAuthorization,
  }),
  z.object({
    action: z.literal('updateAccessKey'),
    accountAddress: u.address(),
    chainId: u.bigint(),
    code: z.string(),
    keyAuthorization: z.optional(keyAuthorization),
  }),
])

/** Response body for `POST /cli-auth/authorize`. */
export const authorizeResponse = z.object({
  status: z.literal('authorized'),
})

/** Stored device code entry schema. */
export const entry = u.oneOf([
  z.object({
    action: z.optional(z.literal('authorizeAccessKey')),
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
    showDeposit,
    status: z.literal('pending'),
  }),
  z.object({
    action: z.optional(z.literal('authorizeAccessKey')),
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
    showDeposit,
    status: z.literal('authorized'),
  }),
  z.object({
    action: z.optional(z.literal('authorizeAccessKey')),
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
    showDeposit,
    status: z.literal('consumed'),
  }),
  z.object({
    action: z.literal('updateAccessKey'),
    accessKeyAddress: u.address(),
    account: u.address(),
    chainId: u.bigint(),
    code: z.string(),
    codeChallenge: z.string(),
    createdAt: z.number(),
    expiresAt: z.number(),
    keyAuthorization: z.optional(keyAuthorization),
    limits: z.readonly(z.array(limit).check(z.minLength(1), z.maxLength(maxLimits))),
    status: z.literal('pending'),
  }),
  z.object({
    action: z.literal('updateAccessKey'),
    accessKeyAddress: u.address(),
    account: u.address(),
    accountAddress: u.address(),
    authorizedAt: z.number(),
    chainId: u.bigint(),
    code: z.string(),
    codeChallenge: z.string(),
    createdAt: z.number(),
    expiresAt: z.number(),
    keyAuthorization: z.optional(keyAuthorization),
    limits: z.readonly(z.array(limit).check(z.minLength(1), z.maxLength(maxLimits))),
    status: z.literal('authorized'),
  }),
  z.object({
    action: z.literal('updateAccessKey'),
    accessKeyAddress: u.address(),
    account: u.address(),
    accountAddress: u.address(),
    authorizedAt: z.number(),
    chainId: u.bigint(),
    code: z.string(),
    codeChallenge: z.string(),
    consumedAt: z.number(),
    createdAt: z.number(),
    expiresAt: z.number(),
    keyAuthorization: z.optional(keyAuthorization),
    limits: z.readonly(z.array(limit).check(z.minLength(1), z.maxLength(maxLimits))),
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

/** Stored device code entry. */
export type Entry = z.output<typeof entry>

/** Device code storage contract. */
export type Store = {
  /** Saves a new pending device code entry. */
  create: (entry: Entry.Pending) => MaybePromise<void>
  /** Loads a device code entry by verification code. */
  get: (code: string) => MaybePromise<Entry | undefined>
  /** Marks a pending device code as authorized. */
  authorize: (options: Store.authorize.Options) => MaybePromise<Entry.Authorized | undefined>
  /** Marks a pending access key update as complete. */
  update: (options: Store.update.Options) => MaybePromise<Entry.Authorized | undefined>
  /** Consumes an authorized device code exactly once. */
  consume: (code: string) => MaybePromise<Entry.Authorized | undefined>
  /** Deletes a device code entry. */
  delete: (code: string) => MaybePromise<void>
}

/** Host validation and sanitization for requested CLI auth defaults. */
export type Policy = {
  /** Validates and optionally rewrites requested defaults before the entry is stored. */
  validate: (options: Policy.validate.Options) => MaybePromise<Policy.validate.ReturnType>
  /** Validates and optionally rewrites requested access key limit updates. */
  update?: ((options: Policy.update.Options) => MaybePromise<Policy.update.ReturnType>) | undefined
}

/** Request rate limiter used by CLI auth handlers. */
export type RateLimit = {
  /** Returns whether the request is allowed to continue. */
  limit: (options: RateLimit.limit.Options) => MaybePromise<RateLimit.limit.ReturnType>
}

export declare namespace Entry {
  /** Pending device code entry. */
  export type Pending = Extract<z.output<typeof entry>, { status: 'pending' }>
  /** Authorized device code entry. */
  export type Authorized = Extract<z.output<typeof entry>, { status: 'authorized' }>
  /** Consumed device code entry. */
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

  export namespace update {
    export type Options = {
      /** Root account that updated the access key. */
      accountAddress: Address.Address
      /** Replacement authorization for an access key that is still pending publication. */
      keyAuthorization?: z.output<typeof keyAuthorization> | undefined
      /** Verification code to complete. */
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
      /** Requested access key expiry timestamp. Omit to let the server choose one. */
      expiry?: number | undefined
      /** Requested key type. */
      keyType: z.output<typeof keyType>
      /** Requested spending limits. */
      limits?: readonly { token: Address.Address; limit: bigint }[] | undefined
      /** Requested access key public key. */
      pubKey: Hex.Hex
    }

    export type ReturnType = {
      /** Suggested access key expiry timestamp. */
      expiry: number
      /** Suggested spending limits. */
      limits?: readonly { token: Address.Address; limit: bigint }[] | undefined
    }
  }

  export namespace update {
    export type Options = {
      /** Access key to update. */
      accessKeyAddress: Address.Address
      /** Root account that owns the access key. */
      account: Address.Address
      /** Requested chain ID. */
      chainId: bigint
      /** Requested spending limits. */
      limits: readonly { token: Address.Address; limit: bigint }[]
    }

    export type ReturnType = {
      /** Approved spending limits. */
      limits: readonly { token: Address.Address; limit: bigint }[]
    }
  }
}

export declare namespace RateLimit {
  export namespace limit {
    export type Options = {
      /** Rate-limit key derived from the request. */
      key: string
      /** Incoming request being rate-limited. */
      request: Request
    }

    export type ReturnType = {
      /** Whether the request is allowed to continue. */
      success: boolean
    }
  }

  export namespace memory {
    export type Options = {
      /** Maximum requests per key in a window. */
      max: number
      /** Window duration in milliseconds. */
      windowMs: number
    }
  }

  export namespace cloudflare {
    export type Limiter = {
      /** Cloudflare Rate Limit binding method. */
      limit: (options: { key: string }) => MaybePromise<{ success: boolean }>
    }

    export type Options = {
      /** Prefix added to the derived request key. @default "cli-auth" */
      key?: string | undefined
    }
  }
}

/** Error thrown when pending device code lookup cannot return a pending request. */
export class PendingError extends Error {
  /** HTTP status returned by handler surfaces. */
  status: 400 | 404

  constructor(message: string, status: 400 | 404) {
    super(message)
    this.name = 'PendingError'
    this.status = status
  }
}

/** Built-in device code store helpers. */
export const Store = {
  /**
   * Creates an in-memory device code store.
   *
   * Useful for tests and single-process servers.
   */
  memory(): Store {
    const entries = new Map<string, Entry>()

    return {
      async authorize(options) {
        const current = entries.get(options.code)
        if (!current || current.status !== 'pending' || current.action === 'updateAccessKey')
          return undefined
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
      async update(options) {
        const current = entries.get(options.code)
        if (!current || current.status !== 'pending' || current.action !== 'updateAccessKey')
          return undefined
        const next = {
          ...current,
          accountAddress: options.accountAddress,
          authorizedAt: Date.now(),
          ...(options.keyAuthorization ? { keyAuthorization: options.keyAuthorization } : {}),
          status: 'authorized',
        } satisfies Entry.Authorized
        entries.set(options.code, next)
        return next
      },
    }
  },
  /**
   * Creates a key-value backed device code store.
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
        if (!current || current.status !== 'pending' || current.action === 'updateAccessKey')
          return undefined
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
      async update(options) {
        const current = await this.get(options.code)
        if (!current || current.status !== 'pending' || current.action !== 'updateAccessKey')
          return undefined
        const next = {
          ...current,
          accountAddress: options.accountAddress,
          authorizedAt: Date.now(),
          ...(options.keyAuthorization ? { keyAuthorization: options.keyAuthorization } : {}),
          status: 'authorized',
        } satisfies Entry.Authorized
        await kv.set(toKey(options.code), z.encode(entry, next))
        return next
      },
    }
  },
}

/** Built-in policy helpers. */
export const Policy = {
  /** Creates an allow-all policy with a default 24-hour expiry when omitted. */
  allow(): Policy {
    return {
      update({ limits }) {
        return { limits }
      },
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

/** Built-in CLI auth rate-limit helpers. */
export const RateLimit = {
  /**
   * Creates a Cloudflare Rate Limit binding adapter.
   *
   * Uses the request-derived key for all CLI auth endpoints so one budget is
   * shared across create, pending, poll, and authorize requests.
   */
  cloudflare(
    limiter: RateLimit.cloudflare.Limiter,
    options: RateLimit.cloudflare.Options = {},
  ): RateLimit {
    const key = options.key ?? 'cli-auth'
    return {
      async limit(options) {
        return limiter.limit({ key: `${key}:${options.key}` })
      },
    }
  },
  /** Creates an in-memory fixed-window limiter for dev and single-process servers. */
  memory(options: RateLimit.memory.Options): RateLimit {
    const entries = new Map<string, { count: number; resetAt: number }>()

    return {
      limit({ key }) {
        const now = Date.now()
        const current = entries.get(key)
        if (!current || now >= current.resetAt) {
          entries.set(key, { count: 1, resetAt: now + options.windowMs })
          return { success: true }
        }
        if (current.count >= options.max) return { success: false }
        current.count++
        return { success: true }
      },
    }
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

      if (current.action === 'updateAccessKey') {
        if (options.request.action !== 'updateAccessKey')
          throw new Error('Device code action does not match the completion request.')
        if (options.request.chainId !== current.chainId)
          throw new Error('Access key update chain does not match the device code request.')

        const client = options.client ?? cache.get(current.chainId)
        let replacement: z.output<typeof keyAuthorization> | undefined
        if (current.keyAuthorization) {
          const metadata = await Actions.accessKey
            .getMetadata(client, {
              account: options.request.accountAddress,
              accessKey: current.accessKeyAddress,
            })
            .catch((error) => {
              if (AccessKey.isUnavailableError(error)) return undefined
              throw error
            })
          if (metadata?.address.toLowerCase() === current.accessKeyAddress.toLowerCase())
            throw new Error('Access key was published while the update was pending.')
          if (!options.request.keyAuthorization)
            throw new Error('Pending access key update requires a replacement key authorization.')
          const previous = normalizeKeyAuthorization(current.keyAuthorization)
          const next = await verifyKeyAuthorizationSignature({
            account: options.request.accountAddress,
            client,
            keyAuthorization: options.request.keyAuthorization,
          })
          if (
            next.address.toLowerCase() !== current.accessKeyAddress.toLowerCase() ||
            next.keyId.toLowerCase() !== current.accessKeyAddress.toLowerCase()
          )
            throw new Error('Replacement key authorization does not match the access key request.')
          if (next.chainId !== current.chainId)
            throw new Error(
              'Replacement key authorization chain does not match the device code request.',
            )
          if (next.keyType !== previous.keyType || next.expiry !== previous.expiry)
            throw new Error('Replacement key authorization changed immutable access key fields.')
          if (!sameLimits(next.limits, current.limits))
            throw new Error(
              'Replacement key authorization limits do not match the device code request.',
            )
          replacement = toStoredKeyAuthorization(options.request.keyAuthorization, next)
        } else {
          if (options.request.keyAuthorization)
            throw new Error('Published access key update cannot return a key authorization.')
          for (const limit of current.limits) {
            const result = await Actions.accessKey.getRemainingLimit(client, {
              account: options.request.accountAddress,
              accessKey: current.accessKeyAddress,
              token: limit.token,
            })
            if (result.remaining !== limit.limit)
              throw new Error('Access key spending limits do not match the device code request.')
          }
        }

        const authorized = await store.update({
          accountAddress: options.request.accountAddress,
          code,
          ...(replacement ? { keyAuthorization: replacement } : {}),
        })
        if (!authorized) throw new Error('Unable to complete access key update.')
        return { status: 'authorized' }
      }

      if (options.request.action === 'updateAccessKey')
        throw new Error('Device code action does not match the completion request.')

      const expected = expectedKeyAuthorization(current)
      const actual = normalizeKeyAuthorization(options.request.keyAuthorization)

      if (actual.keyId.toLowerCase() !== expected.address.toLowerCase())
        throw new Error('Key authorization key does not match the device code request.')
      if (actual.address.toLowerCase() !== expected.address.toLowerCase())
        throw new Error('Key authorization address does not match the device code request.')
      if (actual.keyType !== expected.type)
        throw new Error('Key authorization key type does not match the device code request.')
      if (actual.chainId !== expected.chainId)
        throw new Error('Key authorization chain does not match the device code request.')

      const signed = TempoKeyAuthorization.from({
        address: actual.address,
        chainId: actual.chainId,
        expiry: actual.expiry,
        ...(actual.limits ? { limits: actual.limits } : {}),
        type: actual.keyType,
      })

      const client = options.client ?? cache.get(current.chainId)
      const valid = await verifyHash(client, {
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
      const chainId_resolved = typeof nextChainId === 'bigint' ? nextChainId : BigInt(nextChainId)

      let code: string | undefined
      for (let i = 0; i < 10; i++) {
        const candidate = createCode(random)
        if (await store.get(candidate)) continue
        code = candidate
        break
      }
      if (!code) throw new Error('Unable to allocate device code.')

      const createdAt = now()

      if (options.request.action === 'updateAccessKey') {
        if (!policy.update) throw new Error('Access key updates are not supported by this policy.')
        const approved = await policy.update({
          accessKeyAddress: options.request.accessKeyAddress,
          account: options.request.account,
          chainId: chainId_resolved,
          limits: options.request.limits,
        })
        const tokens = new Set<string>()
        for (const limit of approved.limits) {
          const token = limit.token.toLowerCase()
          if (tokens.has(token)) throw new Error('Access key update limits must use unique tokens.')
          tokens.add(token)
        }
        let pendingKeyAuthorization: z.output<typeof keyAuthorization> | undefined
        if (options.request.keyAuthorization) {
          const actual = await verifyKeyAuthorizationSignature({
            account: options.request.account,
            client: options.client ?? cache.get(chainId_resolved),
            keyAuthorization: options.request.keyAuthorization,
          })
          if (
            actual.address.toLowerCase() !== options.request.accessKeyAddress.toLowerCase() ||
            actual.keyId.toLowerCase() !== options.request.accessKeyAddress.toLowerCase()
          )
            throw new Error('Pending key authorization does not match the access key request.')
          if (actual.chainId !== chainId_resolved)
            throw new Error(
              'Pending key authorization chain does not match the device code request.',
            )
          pendingKeyAuthorization = toStoredKeyAuthorization(
            options.request.keyAuthorization,
            actual,
          )
        }
        await store.create({
          action: 'updateAccessKey',
          accessKeyAddress: options.request.accessKeyAddress,
          account: options.request.account,
          chainId: chainId_resolved,
          code,
          codeChallenge: options.request.codeChallenge,
          createdAt,
          expiresAt: createdAt + ttlMs,
          ...(pendingKeyAuthorization ? { keyAuthorization: pendingKeyAuthorization } : {}),
          limits: approved.limits,
          status: 'pending',
        })
        return { code }
      }

      const { account, codeChallenge, pubKey } = options.request
      const keyType = options.request.keyType ?? 'secp256k1'
      PublicKey.assert(PublicKey.from(pubKey))
      const approved = await policy.validate({
        ...(account ? { account } : {}),
        chainId: chainId_resolved,
        expiry: options.request.expiry,
        keyType,
        ...(options.request.limits ? { limits: options.request.limits } : {}),
        pubKey,
      })

      await store.create({
        ...(account ? { account } : {}),
        chainId: chainId_resolved,
        code,
        codeChallenge,
        createdAt,
        expiresAt: createdAt + ttlMs,
        expiry: approved.expiry,
        keyType,
        ...(approved.limits ? { limits: approved.limits } : {}),
        pubKey,
        ...(options.request.showDeposit !== undefined
          ? { showDeposit: options.request.showDeposit }
          : {}),
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

      if (current.action === 'updateAccessKey')
        return {
          action: current.action,
          accessKeyAddress: current.accessKeyAddress,
          account: current.account,
          chainId: current.chainId,
          code: current.code,
          ...(current.keyAuthorization ? { keyAuthorization: current.keyAuthorization } : {}),
          limits: current.limits,
          status: current.status,
        }

      return {
        accessKeyAddress: Address.fromPublicKey(PublicKey.from(current.pubKey)),
        ...(current.account ? { account: current.account } : {}),
        chainId: current.chainId,
        code: current.code,
        expiry: current.expiry,
        keyType: current.keyType,
        ...(current.limits ? { limits: current.limits } : {}),
        pubKey: current.pubKey,
        ...(current.showDeposit !== undefined ? { showDeposit: current.showDeposit } : {}),
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
      if (authorized.action === 'updateAccessKey')
        return {
          action: authorized.action,
          ...(authorized.keyAuthorization ? { keyAuthorization: authorized.keyAuthorization } : {}),
          status: 'authorized',
        }
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
    /** Device code store. */
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
  const { client, request, ...rest } = options
  return from(rest).createDeviceCode({
    ...(client ? { client } : {}),
    request,
  })
}

export declare namespace createDeviceCode {
  /** Parameters for creating a new device code. */
  export type Parameters = {
    /** Client used to verify a pending key authorization. */
    client?: Client<Transport, Chain | undefined> | undefined
    /** Incoming device code creation request. */
    request: z.output<typeof createRequest>
  }

  /** Shared CLI auth defaults plus create device code parameters. */
  export type Options = from.Options & Parameters

  /** Created device code response body. */
  export type ReturnType = z.output<typeof createResponse>
}

/**
 * Looks up a pending device code for browser approval UIs.
 *
 * @param {pending.Options} options - Shared defaults plus the pending lookup parameters.
 * @returns {Promise<pending.ReturnType>} Pending device code payload.
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

  /** Pending device code response body. */
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
  const [defaultChain] = chains
  const transports = options.transports ?? {}
  const clients = new Map<number, Client<Transport, Chain | undefined>>()

  for (const chain of chains) {
    const transport = transports[chain.id] ?? http()
    clients.set(chain.id, createClient({ chain, transport }))
  }

  const defaultChainId = options.chainId ?? defaultChain.id

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
function expectedKeyAuthorization(entry: Exclude<Entry.Pending, { action: 'updateAccessKey' }>) {
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
async function verifyKeyAuthorizationSignature(options: {
  account: Address.Address
  client: Client<Transport, Chain | undefined>
  keyAuthorization: z.output<typeof keyAuthorization>
}) {
  const actual = normalizeKeyAuthorization(options.keyAuthorization)
  const unsigned = TempoKeyAuthorization.from({
    address: actual.address,
    chainId: actual.chainId,
    expiry: actual.expiry,
    ...(actual.limits ? { limits: actual.limits } : {}),
    type: actual.keyType,
  })
  const valid = await verifyHash(options.client, {
    address: options.account,
    hash: TempoKeyAuthorization.getSignPayload(unsigned),
    signature: SignatureEnvelope.serialize(SignatureEnvelope.fromRpc(actual.signature), {
      magic: actual.signature.type === 'webAuthn',
    }),
  })
  if (!valid) throw new Error('Key authorization signature is invalid.')
  return actual
}

/** @internal */
function toStoredKeyAuthorization(
  value: z.output<typeof keyAuthorization>,
  normalized = normalizeKeyAuthorization(value),
) {
  return {
    address: value.address,
    chainId: value.chainId,
    expiry: normalized.expiry,
    keyId: value.keyId,
    keyType: value.keyType,
    ...(normalized.limits ? { limits: normalized.limits } : {}),
    signature: value.signature,
  } satisfies z.output<typeof keyAuthorization>
}

/** @internal */
function sameLimits(
  actual: readonly { token: Address.Address; limit: bigint }[] | undefined,
  expected: readonly { token: Address.Address; limit: bigint }[],
) {
  if (!actual || actual.length !== expected.length) return false
  const normalize = (items: readonly { token: Address.Address; limit: bigint }[]) =>
    items.map((item) => `${item.token.toLowerCase()}:${item.limit}`).sort()
  const actualNormalized = normalize(actual)
  const expectedNormalized = normalize(expected)
  return actualNormalized.every((value, index) => value === expectedNormalized[index])
}

/** @internal */
async function verifyCodeChallenge(codeVerifier: string, codeChallenge: string) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  return Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true }) === codeChallenge
}
