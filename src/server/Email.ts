type Answer = { data: string; type: number }

type Response = {
  Answer?: readonly Answer[] | undefined
  Status: number
}

/** Checks whether an email domain can receive mail using its MX or address records. */
export async function acceptsMail(email: string) {
  const domain = email.slice(email.lastIndexOf('@') + 1)

  try {
    const mx = await resolve(domain, 'MX')
    if (mx.Status === 3) return false
    if (mx.Status !== 0) return true

    const exchanges = mx.Answer?.filter((answer) => answer.type === 15) ?? []
    if (exchanges.length > 0) return exchanges.some((answer) => !answer.data.endsWith(' .'))

    // RFC 5321 permits domains without MX records to receive mail at an A or
    // AAAA address, so check those before rejecting the domain.
    const a = await resolve(domain, 'A')
    if (a.Status === 3) return false
    if (a.Status !== 0) return true
    if (a.Answer?.some((answer) => answer.type === 1)) return true

    const aaaa = await resolve(domain, 'AAAA')
    if (aaaa.Status === 3) return false
    if (aaaa.Status !== 0) return true
    return aaaa.Answer?.some((answer) => answer.type === 28) ?? false
  } catch {
    // DNS availability should not prevent legitimate users from receiving an
    // OTP. The email provider remains the final authority when this check fails.
    return true
  }
}

async function resolve(domain: string, type: 'A' | 'AAAA' | 'MX') {
  const url = new URL('https://cloudflare-dns.com/dns-query')
  url.searchParams.set('name', domain)
  url.searchParams.set('type', type)
  const response = await fetch(url, { headers: { accept: 'application/dns-json' } })
  if (!response.ok) throw new Error('DNS query failed')
  return (await response.json()) as Response
}
