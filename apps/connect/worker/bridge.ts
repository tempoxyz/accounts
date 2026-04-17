import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { parseUnits } from 'viem'
import * as z from 'zod/mini'

import * as Bridge from '../src/lib/bridge.js'
import * as Middleware from './lib/middleware.js'

/** Unsupported route error codes from Relay. */
const unsupportedRouteCodes = new Set([
  'NO_SWAP_ROUTES_FOUND',
  'INVALID_INPUT_CURRENCY',
  'INVALID_OUTPUT_CURRENCY',
])

/** Zero addresses for Relay `user` field by namespace. */
const zeroAddress = {
  eip155: '0x0000000000000000000000000000000000000000',
  solana: '11111111111111111111111111111111',
} as const

export const bridge = new Hono<{ Bindings: Env }>().post(
  '/deposit',
  Middleware.requireSession(),
  zValidator(
    'json',
    z.object({
      origin: z.object({
        chainId: z.number(),
        token: z.string(),
        decimals: z.number(),
      }),
    }),
  ),
  async (c) => {
    const { origin } = c.req.valid('json')

    // Derive recipient from session — never accept from the client.
    const recipient = c.var.session.address as `0x${string}`

    // Relay uses different zero addresses and casing rules per chain namespace.
    const namespace = Bridge.getNamespace(origin.chainId)

    // Use a tiny nominal amount to clear Relay fee minimums.
    // The deposit address is open-ended — users can send any amount.
    const nominal = Bridge.getNominalAmount(origin.decimals)
    const amount = parseUnits(
      nominal.toFixed(Math.min(origin.decimals, 8)),
      origin.decimals,
    ).toString()

    // Build the Relay quote request.
    // Destination is always USDC on Tempo — autoSwap handles conversion
    // to whatever token the user actually needs.
    const body = {
      user: zeroAddress[namespace],
      originChainId: origin.chainId,
      // Relay expects lowercase for EVM addresses, raw for Solana.
      originCurrency: namespace === 'solana' ? origin.token : origin.token.toLowerCase(),
      destinationChainId: Bridge.destinationChain.id,
      destinationCurrency: Bridge.destinationChain.tokens[0].address,
      recipient,
      amount,
      tradeType: 'EXACT_INPUT',
      usePermit: false,
      useExternalLiquidity: false,
      useDepositAddress: true,
      subsidizeFees: true,
      referrer: 'tempo.xyz',
    }

    const res = await fetch('https://api.relay.link/quote/v2', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.RELAY_API_KEY,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()

      // Parse Relay error codes to distinguish unsupported routes
      // (permanent, no retry) from transient failures.
      const code = (() => {
        try {
          const parsed = JSON.parse(text) as { errorCode?: string }
          return parsed.errorCode ?? null
        } catch {
          return null
        }
      })()

      if (code && unsupportedRouteCodes.has(code))
        return c.json(
          { error: `Unsupported route: ${code}`, code: 'UNSUPPORTED_ROUTE' as const },
          400,
        )

      return c.json({ error: text }, 500)
    }

    const data = (await res.json()) as {
      steps: { id: string; depositAddress?: string; requestId?: string }[]
    }

    // The deposit step contains the address users should send funds to.
    const step = data.steps.find((s) => s.id === 'deposit')
    if (!step?.depositAddress || !step?.requestId)
      return c.json({ error: 'Relay response missing deposit address' }, 500)

    return c.json({ address: step.depositAddress, id: step.requestId })
  },
)
