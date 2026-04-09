import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { Address, Hex } from 'ox'
/** Returns the default managed-key file path. */
export function defaultPath() {
  return join(homedir(), '.tempo', 'wallet', 'keys.toml')
}
/** Loads managed CLI access keys from `keys.toml`. */
export async function load(options = {}) {
  const path = options.path ?? defaultPath()
  try {
    return parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}
/** Finds a managed key by wallet address and chain ID. */
export async function find(options) {
  const { chainId, keyType, path, walletAddress } = options
  const keys = await load(path ? { path } : {})
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i]
    if (key.chainId !== chainId) continue
    if (key.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) continue
    if (keyType && key.keyType !== keyType) continue
    return key
  }
}
/** Inserts or replaces a managed key in `keys.toml`. */
export async function upsert(entry, options = {}) {
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
function parse(text) {
  const keys = []
  let key
  let limit
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
    const value = rawValue.trim()
    if (limit) {
      if (name === 'currency') limit.token = stripQuotes(value)
      if (name === 'limit') limit.limit = BigInt(stripQuotes(value))
      continue
    }
    if (!key) continue
    if (name === 'wallet_address') key.walletAddress = stripQuotes(value)
    if (name === 'chain_id') key.chainId = Number.parseInt(value, 10)
    if (name === 'key_type') key.keyType = stripQuotes(value)
    if (name === 'key_address') key.keyAddress = stripQuotes(value)
    if (name === 'key') key.key = stripQuotes(value)
    if (name === 'key_authorization') key.keyAuthorization = stripQuotes(value)
    if (name === 'expiry') key.expiry = Number.parseInt(value, 10)
  }
  flushKey()
  return keys
}
function stringify(keys) {
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
function stripQuotes(value) {
  return value.replace(/^"|"$/g, '')
}
//# sourceMappingURL=keyring.js.map
