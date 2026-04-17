import { blockedHtml } from './blocked-html.js'

const blockedCountries = new Set(['BY', 'CU', 'IR', 'KP', 'MM', 'RU', 'SY', 'UA', 'VE'])
const blockedTitle = 'This site can’t be reached'
const blockedMessage = 'Tempo Connect is not available in your region at this time.'

/** Returns true when the request country is geo-blocked. */
export function isBlockedRegion(country: string | null) {
  return country != null && blockedCountries.has(country)
}

/** Returns a 451 response for blocked requests, or `null` when access is allowed. */
export function handleGeoBlock(request: Request): Response | null {
  const cf = (request as Request & { cf?: { country?: string | null } }).cf
  const countryCode = (cf?.country ?? request.headers.get('cf-ipcountry'))?.toUpperCase() ?? null

  if (!isBlockedRegion(countryCode)) return null

  const body = request.method === 'HEAD' ? null : blockedHtml(blockedTitle, blockedMessage)
  return new Response(body, {
    status: 451,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/html; charset=utf-8',
      Vary: 'CF-IPCountry',
    },
  })
}
