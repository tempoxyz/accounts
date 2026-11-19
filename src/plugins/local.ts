/**
 * The plugin of a Tempo Account whose owner key the instance holds: a secp256k1 private key in the
 * instance's store, such as a CLI's `Store.file`. The owner signs each access key that the session
 * holds, and its account answers the app's challenge, so `viem`, `pay`, `mpp`, and `siwe` act for
 * it as for a Tempo ID sign-in. Tempo ID takes no part, so a local session holds no tokens, and a
 * call that reads Tempo ID, such as `account.get`, throws `Accounts.LocalSessionError`.
 * @module
 */
import { Address, Hex, PersonalMessage, Secp256k1, Signature } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import * as AccessKey from '../internal/AccessKey.js'
import * as DefaultStore from '../internal/DefaultStore.js'
import * as Lock from '../internal/Lock.js'
import * as Node from '../internal/Node.js'
import * as Permissions from '../Permissions.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import type { Store } from '../Store.js'

/** The version of the stored owner key, which a later release can migrate. */
const version = 1

/**
 * Thrown by `local.create` and `local.import` while the store already holds an owner key, so a call
 * never replaces the key of an account that can hold funds. Call `local.remove` first.
 */
export class ExistsError extends Error {
  override readonly name = 'Plugins.local.ExistsError'

  constructor(options: { address: Address.Address }) {
    super(
      `The store already holds the owner key of ${options.address}. Call \`local.remove\` first to replace it.`,
    )
  }
}

/** Thrown by `local.signIn` and `local.export` while the store holds no owner key. */
export class MissingError extends Error {
  override readonly name = 'Plugins.local.MissingError'

  constructor() {
    super(
      'The store holds no owner key. Call `local.create` or `local.import` first.',
    )
  }
}

/**
 * Thrown for a store that other parties read, such as `Store.postgres` or `Store.redis`, which keeps
 * no owner key: one read of it would yield the account.
 */
export class SharedStoreError extends Error {
  override readonly name = 'Plugins.local.SharedStoreError'

  constructor() {
    super(
      'The store is shared, so it keeps no owner key. Use `Store.file`, `Store.memory`, or the default store of a browser.',
    )
  }
}

/** Thrown outside a browser without `store`, where the instance has nowhere to keep the owner key. */
export class StoreRequiredError extends Error {
  override readonly name = 'Plugins.local.StoreRequiredError'

  constructor() {
    super(
      'The instance has no store for the owner key. Pass `store`, such as `Store.file(...)`, to `Accounts.create`.',
    )
  }
}

/**
 * Thrown by a sign-in of an instance with `accessKey: false`. The owner key signs only access keys,
 * so a local session without one could not send.
 */
export class AccessKeyDisabledError extends Error {
  override readonly name = 'Plugins.local.AccessKeyDisabledError'

  constructor() {
    super(
      'The instance requests no access key (`accessKey: false`), and a local session sends only with one. Pass `accessKey` to the sign-in, or drop `accessKey: false`.',
    )
  }
}

/**
 * The value of a store whose owner key `local.remove` deleted. It keeps the `v0` file from giving
 * the account again.
 */
type Removed = { removed: true; version: typeof version }

/** The owner key, as the store keeps it. */
type Stored = {
  /** The account of the owner key. */
  address: Address.Address
  /** When the key was created or imported, in milliseconds. */
  createdAt: number
  /** The label of the key. */
  name?: string | undefined
  /** The owner's secp256k1 private key. */
  privateKey: Hex.Hex
  type: 'secp256k1'
  version: typeof version
}

/**
 * Returns the plugin of a Tempo Account whose secp256k1 owner key the instance holds. An instance
 * with it receives no default `dialog`. Each sign-in authorizes an access key that the owner signs,
 * with the call's `accessKey`, else the instance's, else the default one, so the owner key signs only
 * access keys and the app's challenge.
 *
 * The store keeps the private key as it is. `Store.file` keeps it in a `0600` file, as accounts v0
 * did. A store that other parties read, such as `Store.postgres`, refuses it.
 *
 * With `v0`, the first read of a store without an owner key takes the active secp256k1 account of an
 * accounts v0 `Storage.filesystem` file, so its address and funds carry over. The v0 file stays as it
 * is.
 *
 * @example
 * ```ts
 * import { Accounts, Store } from 'accounts'
 * import { local, viem } from 'accounts/plugins'
 *
 * const accounts = Accounts.create({
 *   plugins: [
 *     local({ name: 'Mercator', v0: '~/.mercator/wallet.json' }),
 *     viem(),
 *   ],
 *   store: Store.file('~/.mercator/accounts.json'),
 * })
 *
 * const session = (await accounts.local.get())
 *   ? await accounts.local.signIn()
 *   : await accounts.local.create()
 * ```
 */
export function local(options: local.Options = {}) {
  const { name, v0 } = options
  // Each instance of the plugin, by the context that `extend` and `actions` share, for its sign-out in
  // `local.remove`. One plugin can serve several instances.
  const instances = new WeakMap<object, { signOut: () => Promise<void> }>()

  return Plugin.from({
    actions: (context) => {
      const key = `tempo-id:local:${JSON.stringify(context.config.clientId ?? null)}`
      // Orders the reads and writes of the owner key, also of other instances on a store with a
      // `lock`, so two calls of `create` never both find no key and each write one.
      const fallback = Lock.create()
      function exclusive<result>(fn: () => Promise<result>): Promise<result> {
        const { lock } = store()
        return lock ? lock(key, fn) : fallback(key, fn)
      }

      function store(): Store {
        const store = DefaultStore.get(context.config.store)
        if (!store) throw new StoreRequiredError()
        // A store that keeps JSON for other parties to read, such as a database, keeps no private key.
        if (store.json && !store.private) throw new SharedStoreError()
        return store
      }

      /** Returns the owner key, from the store or else the `v0` file. Runs inside `exclusive`. */
      async function read(): Promise<Stored | undefined> {
        const value = (await store().getItem(key)) as
          | Removed
          | Stored
          | null
          | undefined
        if (value && 'removed' in value) return undefined
        if (value?.version === version && value.type === 'secp256k1')
          return value
        if (!v0) return undefined
        const privateKey = await readV0(v0)
        if (!privateKey) return undefined
        return await write(privateKey)
      }

      async function write(privateKey: Hex.Hex): Promise<Stored> {
        const value: Stored = {
          address: Address.checksum(
            Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
          ),
          createdAt: Date.now(),
          ...(name ? { name } : {}),
          privateKey,
          type: 'secp256k1',
          version,
        }
        await store().setItem(key, value)
        return value
      }

      /** Returns an access key on `chainId` that `owner` signed, with `permissions`. */
      async function authorize(
        owner: Stored,
        permissions: Permissions.Permissions,
        chainId: number,
      ): Promise<AccessKey.AccessKey> {
        // An access key that the app supplies as `account` or `publicKey` holds no material.
        const { material, signer } = await AccessKey.resolve(
          permissions as AccessKey.own.Options,
        )
        const resolved = Permissions.resolve(
          {
            ...permissions,
            expiry: permissions.expiry ?? AccessKey.defaultExpiry,
          },
          { chainId },
        )
        const limits = resolved.limits && [
          ...resolved.limits,
          ...(resolved.fees ?? []),
        ]
        const authorization = KeyAuthorization.from({
          address: signer.accessKeyAddress ?? signer.address,
          chainId: BigInt(resolved.chainId),
          ...(resolved.expiry ? { expiry: resolved.expiry } : {}),
          ...(limits ? { limits } : {}),
          ...(resolved.scopes ? { scopes: resolved.scopes } : {}),
          type: signer.keyType as Exclude<
            KeyAuthorization.KeyAuthorization['type'],
            'configurable'
          >,
        })
        const signature = Secp256k1.sign({
          payload: KeyAuthorization.getSignPayload(authorization),
          privateKey: owner.privateKey,
        })
        return {
          account: owner.address,
          chainId: resolved.chainId,
          keyAuthorization: KeyAuthorization.toRpc(
            KeyAuthorization.from(authorization, { signature }),
          ),
          ...(resolved.expiry
            ? { lifetime: resolved.expiry - Math.floor(Date.now() / 1000) }
            : {}),
          ...material,
        }
      }

      /** Returns the sign-in's access key permissions, or throws for an instance that requests none. */
      function requested(parameters: local.signIn.Parameters) {
        const permissions =
          parameters.accessKey ??
          context.accessKey() ??
          context.defaultAccessKey()
        if (!permissions) throw new AccessKeyDisabledError()
        return permissions
      }

      /** Signs in with `owner`, answers the app's challenge, and commits the session. */
      async function signIn(
        owner: Stored,
        parameters: local.signIn.Parameters,
      ): Promise<local.signIn.ReturnType> {
        // A new instance reads the chain that `switchChain` saved, and the session, first.
        await context.chain.load().catch(() => undefined)
        const current = context.session.get() ?? (await context.session.load())
        const permissions = requested(parameters)
        const change = context.session.change()
        try {
          const chainId = context.chain.get()
          const own =
            current &&
            Session.local(current) &&
            Address.isEqual(current.address, owner.address)
              ? current
              : undefined
          // A live access key of the same owner on the chain serves a sign-in that names none.
          const kept =
            parameters.accessKey === undefined
              ? [own?.accessKey, ...(own?.accessKeys ?? [])].find(
                  (entry) =>
                    !!entry &&
                    entry.chainId === chainId &&
                    AccessKey.held(entry) &&
                    !AccessKey.expired(entry),
                )
              : undefined
          const accessKey =
            kept ?? (await authorize(owner, permissions, chainId))
          const source = context.challenge()
          const challenged = source
            ? await (async () => {
                const message = await source.message({
                  chainId,
                  signal: new AbortController().signal,
                })
                // The challenge's EIP-191 hash, as `personal_sign` signs it, so Viem's
                // `verifyMessage` verifies it.
                const signature = Signature.toHex(
                  Secp256k1.sign({
                    payload: PersonalMessage.getSignPayload(
                      Hex.fromString(message),
                    ),
                    privateKey: owner.privateKey,
                  }),
                )
                const auth = await source.settle({
                  address: owner.address,
                  message,
                  signature,
                })
                return { auth, signature }
              })()
            : undefined
          // The live access keys of other chains, once each: a switch keeps the moved key in both
          // `accessKey` and `accessKeys`.
          const others = [own?.accessKey, ...(own?.accessKeys ?? [])].filter(
            (entry, index, entries): entry is AccessKey.AccessKey =>
              !!entry &&
              entry.chainId !== accessKey.chainId &&
              !AccessKey.expired(entry) &&
              entries.findIndex(
                (other) =>
                  other?.keyAuthorization.keyId ===
                  entry.keyAuthorization.keyId,
              ) === index,
          )
          const session = Session.from({
            accessKey,
            accessKeys: [accessKey, ...others],
            address: owner.address,
            ...(challenged ? { challengeSignature: challenged.signature } : {}),
            kind: 'local',
            // Orders this session after the one it replaces, also within one millisecond.
            revision: Math.max(Date.now(), (own?.revision ?? 0) + 1),
          })
          await change.commit(session)
          return challenged ? { ...session, auth: challenged.auth } : session
        } catch (error) {
          return await change.fail(error)
        }
      }

      return {
        /**
         * Creates an owner key, stores it, and signs in with it.
         *
         * @throws {ExistsError} While the store already holds an owner key.
         * @throws {StoreRequiredError} Outside a browser without `store`.
         * @throws {SharedStoreError} For a store that other parties read.
         *
         * @example
         * ```ts
         * const { address } = await accounts.local.create()
         * ```
         */
        async create(
          parameters: local.signIn.Parameters = {},
        ): Promise<local.signIn.ReturnType> {
          // Stores no key for a sign-in that could not authorize an access key.
          requested(parameters)
          const owner = await exclusive(async () => {
            const existing = await read()
            if (existing) throw new ExistsError({ address: existing.address })
            return await write(Secp256k1.randomPrivateKey())
          })
          return await signIn(owner, parameters)
        },
        /**
         * Returns the owner's private key, such as for a backup. Keep it as secret as the
         * account's funds.
         *
         * @throws {MissingError} While the store holds no owner key.
         *
         * @example
         * ```ts
         * const privateKey = await accounts.local.export()
         * ```
         */
        async export(): Promise<Hex.Hex> {
          const owner = await exclusive(read)
          if (!owner) throw new MissingError()
          return owner.privateKey
        },
        /**
         * Returns the stored owner key's account, without its private key, or `undefined`. With
         * `v0`, the first read takes the account of the v0 file.
         *
         * @example
         * ```ts
         * const owner = await accounts.local.get()
         * if (!owner) await accounts.local.create()
         * ```
         */
        async get(): Promise<local.get.ReturnType> {
          const owner = await exclusive(read)
          if (!owner) return undefined
          return {
            address: owner.address,
            createdAt: owner.createdAt,
            ...(owner.name ? { name: owner.name } : {}),
            type: owner.type,
          }
        },
        /**
         * Stores `privateKey` as the owner key, and signs in with it.
         *
         * @throws {ExistsError} While the store already holds an owner key.
         *
         * @example
         * ```ts
         * await accounts.local.import({ privateKey: process.env.PRIVATE_KEY })
         * ```
         */
        async import(
          parameters: local.ImportParameters,
        ): Promise<local.signIn.ReturnType> {
          const { privateKey, ...rest } = parameters
          // Rejects a value that is no secp256k1 private key before the store changes.
          Secp256k1.getPublicKey({ privateKey })
          requested(rest)
          const owner = await exclusive(async () => {
            const existing = await read()
            if (existing) throw new ExistsError({ address: existing.address })
            return await write(privateKey)
          })
          return await signIn(owner, rest)
        },
        /**
         * Signs out a local session, and deletes the owner key from the store. The account and its
         * funds stay on chain, and only the private key reaches them, so call `local.export`
         * first to keep it.
         *
         * @example
         * ```ts
         * await accounts.local.remove()
         * ```
         */
        async remove(): Promise<void> {
          // The key goes first, so no sign-in that starts during the sign-out finds it.
          const removed: Removed = { removed: true, version }
          await exclusive(() => store().setItem(key, removed))
          // A new instance reads the saved session first, so its access key stops signing too. The
          // instance's sign-out overtakes a sign-in that started before, such as one that waits for
          // the app's challenge, so none restores the removed account, and it runs the hooks.
          const current =
            context.session.get() ?? (await context.session.load())
          if (current && Session.local(current))
            await instances.get(context)?.signOut()
        },
        /**
         * Signs in with the stored owner key. A live access key of the session on the instance's
         * chain serves a sign-in without `accessKey`. Otherwise the owner signs a new one.
         *
         * @throws {MissingError} While the store holds no owner key.
         *
         * @example
         * ```ts
         * const session = await accounts.local.signIn()
         * ```
         */
        async signIn(
          parameters: local.signIn.Parameters = {},
        ): Promise<local.signIn.ReturnType> {
          const owner = await exclusive(read)
          if (!owner) throw new MissingError()
          return await signIn(owner, parameters)
        },
      }
    },
    extend: (instance, context) => {
      instances.set(context, instance)
      return {}
    },
    id: 'local',
  })
}

export declare namespace local {
  type Options = {
    /** A label for the owner key, which `local.get` returns. */
    name?: string | undefined
    /**
     * The accounts v0 `Storage.filesystem` file, such as `~/.mercator/wallet.json`, whose active
     * secp256k1 account becomes the owner key at the first read without one, outside a browser. Of
     * the file's `<key>.store` entries, the first that holds one gives it.
     */
    v0?: string | undefined
  }

  namespace get {
    type ReturnType =
      | {
          address: Address.Address
          createdAt: number
          name?: string | undefined
          type: 'secp256k1'
        }
      | undefined
  }

  /** The parameters of `local.import`. */
  type ImportParameters = signIn.Parameters & {
    /** The owner's secp256k1 private key. */
    privateKey: Hex.Hex
  }

  namespace signIn {
    type Parameters = {
      /** The access key's permissions. Defaults to the instance's `accessKey`, else the default one. */
      accessKey?: Permissions.Permissions | undefined
    }

    type ReturnType = Session.LocalSession & {
      /** The result of the app's challenge, such as the `siwe` plugin's. */
      auth?: Plugin.Challenge.Result | undefined
    }
  }
}

/**
 * Returns the private key of the active secp256k1 account in an accounts v0 `Storage.filesystem`
 * file, or `undefined` without the file, its entry, or such an account, and outside Node.
 */
async function readV0(file: string): Promise<Hex.Hex | undefined> {
  const modules = Node.modules()
  if (!modules) return undefined
  const { Fs, Os, Path } = modules
  const path = file.startsWith('~/')
    ? Path.join(Os.homedir(), file.slice(2))
    : file
  const text = await Fs.readFile(path, 'utf8').catch(() => undefined)
  if (!text) return undefined
  const entries = parse<Record<string, unknown>>(text)
  if (!entries || typeof entries !== 'object') return undefined
  // v0's zustand `persist` keeps each instance's state under `<key>.store`, as a JSON string or as an
  // object. A file holds one wallet in practice, so the first entry with an account gives it.
  for (const [key, raw] of Object.entries(entries)) {
    if (!key.endsWith('.store')) continue
    const entry = (typeof raw === 'string' ? parse(raw) : raw) as
      | {
          state?: {
            accounts?: readonly { keyType?: string; privateKey?: string }[]
            activeAccount?: number
          }
        }
      | undefined
    const accounts = entry?.state?.accounts ?? []
    const active = accounts[entry?.state?.activeAccount ?? 0]
    const account = [active, ...accounts].find(
      (account) =>
        account?.keyType === 'secp256k1' &&
        typeof account.privateKey === 'string' &&
        Hex.validate(account.privateKey, { strict: true }),
    )
    if (account) return account.privateKey as Hex.Hex
  }
  return undefined
}

/** Returns `text` parsed as JSON, or `undefined` for text that is no JSON. */
function parse<value = unknown>(text: string): value | undefined {
  try {
    return JSON.parse(text) as value
  } catch {
    return undefined
  }
}
