import { Handler } from 'accounts/server'

// `trustProxy` defaults to `true` on Cloudflare Workers because the runtime
// is always edge-fronted (Cloudflare Tunnel in dev, Cloudflare's edge in
// prod sets `x-forwarded-proto: https`).
const auth = Handler.auth({ path: '/auth' })

export default {
  async fetch(request) {
    const url = new URL(request.url)

    // Reads the SIWE-issued session and returns the connected address.
    // Demonstrates how an authenticated endpoint consumes Handler.auth.
    if (url.pathname === '/me') {
      const session = await auth.getSession(request)
      if (!session) return Response.json({ error: 'unauthenticated' }, { status: 401 })
      return Response.json({ address: session.address, chainId: session.chainId })
    }

    return auth.fetch(request)
  },
} satisfies ExportedHandler<Cloudflare.Env>
