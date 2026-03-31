import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Address, Hex } from 'ox'

/** Managed CLI access key persisted in `~/.tempo/wallet/keys.toml`. */
export type Entry = {
  /** Wallet type that approved the key. */
  walletType: 'passkey'
  /** Root wallet address. */
  walletAddress: Address
  /** Chain ID for the authorization. */
  chainId: number
  /** Authorized access-key type. */
  keyType: 'secp256k1' | 'p256'
  /** Derived access-key address. */
  keyAddress: Address
  /** Exported private key for the managed access key. */
  key: Hex
  /** Serialized key authorization payload. */
  keyAuthorization: Hex
  /** Authorization expiry timestamp. */
  expiry: number
  /** TIP-20 spending limits. */
  limits?: readonly { token: Address; limit: bigint }[] | undefined
}

/** Returns the default managed-key file path. */
export function defaultPath(): string {
  return join(homedir(), '.tempo', 'wallet', 'keys.toml')
}

/** Loads managed CLI access keys from `keys.toml`. */
export async function load(options: load.Options = {}): Promise<readonly Entry[]> {
  const path = options.path ?? defaultPath()

  try {
    return parse(await readFile(path, 'utf8'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

export declare namespace load {
  export type Options = {
    /** Override path for the managed-key TOML file. */
    path?: string | undefined
  }
}

/** Finds a managed key by wallet address and chain ID. */
export async function find(options: find.Options): Promise<Entry | undefined> {
  const { chainId, path, walletAddress } = options
  const keys = await load(path ? { path } : {})
  return keys.find(
    (key) =>
      key.chainId === chainId && key.walletAddress.toLowerCase() === walletAddress.toLowerCase(),
  )
}

export declare namespace find {
  export type Options = {
    /** Chain ID for the managed key. */
    chainId: number
    /** Override path for the managed-key TOML file. */
    path?: string | undefined
    /** Root wallet address. */
    walletAddress: Address
  }
}

/** Inserts or replaces a managed key in `keys.toml`. */
export async function upsert(entry: Entry, options: upsert.Options = {}): Promise<void> {
  const path = options.path ?? defaultPath()
  const keys = await load({ path })
  const next = [
    ...keys.filter(
      (key) =>
        !(
          key.chainId === entry.chainId &&
          key.walletAddress.toLowerCase() === entry.walletAddress.toLowerCase() &&
          key.keyAddress.toLowerCase() === entry.keyAddress.toLowerCase()
        ),
    ),
    entry,
  ]

  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, stringify(next), 'utf8')
}

export declare namespace upsert {
  export type Options = {
    /** Override path for the managed-key TOML file. */
    path?: string | undefined
  }
}

function parse(text: string): readonly Entry[] {
  const keys: Entry[] = []
  let key: Partial<Entry> | undefined
  let limit: Partial<{ token: Address; limit: bigint }> | undefined

  function flushLimit() {
    if (!key || !limit?.token || typeof limit.limit === 'undefined') return
    key.limits = [...(key.limits ?? []), { token: limit.token, limit: limit.limit }]
    limit = undefined
  }

  function flushKey() {
    flushLimit()
    if (
      !key?.walletAddress ||
      typeof key.chainId === 'undefined' ||
      !key.keyType ||
      !key.keyAddress ||
      !key.key ||
      !key.keyAuthorization ||
      typeof key.expiry === 'undefined'
    )
      return
    keys.push({
      chainId: key.chainId,
      expiry: key.expiry,
      key: key.key,
      keyAddress: key.keyAddress,
      keyAuthorization: key.keyAuthorization,
      keyType: key.keyType,
      ...(key.limits?.length ? { limits: key.limits } : {}),
      walletAddress: key.walletAddress,
      walletType: 'passkey',
    })
    key = undefined
  }

  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue

    if (line === '[[keys]]') {
      flushKey()
      key = { walletType: 'passkey' }
      continue
    }

    if (line === '[[keys.limits]]') {
      flushLimit()
      limit = {}
      continue
    }

    const match = line.match(/^([a-z_]+)\s*=\s*(.+)$/)
    if (!match) continue
    const [, name, rawValue] = match
    const value = rawValue!.trim()

    if (limit) {
      if (name === 'currency') limit.token = stripQuotes(value) as Address
      if (name === 'limit') limit.limit = BigInt(stripQuotes(value))
      continue
    }

    if (!key) continue
    if (name === 'wallet_address') key.walletAddress = stripQuotes(value) as Address
    if (name === 'chain_id') key.chainId = Number.parseInt(value, 10)
    if (name === 'key_type') key.keyType = stripQuotes(value) as Entry['keyType']
    if (name === 'key_address') key.keyAddress = stripQuotes(value) as Address
    if (name === 'key') key.key = stripQuotes(value) as Hex
    if (name === 'key_authorization') key.keyAuthorization = stripQuotes(value) as Hex
    if (name === 'expiry') key.expiry = Number.parseInt(value, 10)
  }

  flushKey()
  return keys
}

function stringify(keys: readonly Entry[]) {
  return [
    '# Tempo wallet keys — managed by `tempo wallet`',
    '# Do not edit manually.',
    '',
    ...keys.flatMap((key) => [
      '[[keys]]',
      `wallet_type = "passkey"`,
      `wallet_address = "${key.walletAddress}"`,
      `chain_id = ${key.chainId}`,
      `key_type = "${key.keyType}"`,
      `key_address = "${key.keyAddress}"`,
      `key = "${key.key}"`,
      `key_authorization = "${key.keyAuthorization}"`,
      `expiry = ${key.expiry}`,
      '',
      ...(key.limits ?? []).flatMap((limit) => [
        '[[keys.limits]]',
        `currency = "${limit.token}"`,
        `limit = "${limit.limit}"`,
        '',
      ]),
    ]),
  ].join('\n')
}

function stripQuotes(value: string) {
  return value.replace(/^"|"$/g, '')
}
