import { Tidx, QueryBuilder } from 'tidx.ts'

const ACCOUNT_KEYCHAIN = '0xaAAAaaAA00000000000000000000000000000000'
const KEY_AUTHORIZED_SIG =
  'event KeyAuthorized(address indexed account, address indexed publicKey, uint8 signatureType, uint64 expiry)'
const KEY_REVOKED_SIG =
  'event KeyRevoked(address indexed account, address indexed publicKey)'

export async function handleAccessKeys(request: Request): Promise<Response | undefined> {
  const url = new URL(request.url)
  const match = url.pathname.match(/^\/access-keys\/(0x[0-9a-fA-F]{40})$/)
  if (!match) return undefined

  const account = match[1].toLowerCase() as `0x${string}`
  const basicAuth = process.env.TIDX_BASIC_AUTH
  if (!basicAuth) {
    return Response.json({ error: 'TIDX_BASIC_AUTH not configured' }, { status: 500 })
  }

  const isTestnet = process.env.VITE_ENV === 'testnet'
  const chainId = isTestnet ? 42431 : 4217
  const tidx = Tidx.create({ basicAuth, chainId })
  const QB = QueryBuilder.from(tidx)

  const [authorizedResult, revokedResult] = await Promise.all([
    QB.withSignatures([KEY_AUTHORIZED_SIG])
      .selectFrom('keyauthorized')
      .select(['publicKey'])
      .where('address', '=', ACCOUNT_KEYCHAIN)
      .where('account', '=', account)
      .execute(),
    QB.withSignatures([KEY_REVOKED_SIG])
      .selectFrom('keyrevoked')
      .select(['publicKey'])
      .where('address', '=', ACCOUNT_KEYCHAIN)
      .where('account', '=', account)
      .execute(),
  ])

  const revokedSet = new Set(
    revokedResult.map((r) => String(r.publicKey).toLowerCase()),
  )
  const activeKeys = [
    ...new Set(
      authorizedResult
        .map((r) => String(r.publicKey).toLowerCase())
        .filter((keyId) => !revokedSet.has(keyId)),
    ),
  ]

  return Response.json({ keys: activeKeys })
}
