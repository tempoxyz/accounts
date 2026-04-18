import { Handler } from 'accounts/server'
import { Hono } from 'hono'
import { type Address, isAddressEqual } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import * as FeePayer from './lib/fee-payer.js'
import * as Session from './lib/session.js'

export const relay = new Hono<{ Bindings: Env }>().all('/*', async (c) => {
  const session = await Session.fromRequest(c, process.env.SESSION_PUBLIC_KEY!)

  const feePayer = (() => {
    const key = process.env.RELAY_PRIVATE_KEY
    if (!key) return undefined
    const account = privateKeyToAccount(key as `0x${string}`)
    const budgetValidate = FeePayer.create(account.address, c.env.KV, {
      dailyLimitUsd: process.env.FEE_PAYER_DAILY_LIMIT_USD,
      globalDailyLimitUsd: process.env.FEE_PAYER_GLOBAL_DAILY_LIMIT_USD,
    })
    return {
      account,
      validate: (request: { from?: Address | undefined }) => {
        if (!session || !request.from) return false
        if (!isAddressEqual(session.address as Address, request.from as Address)) return false
        return budgetValidate(request)
      },
    }
  })()

  return Handler.relay({
    cors: false,
    feePayer,
    features: 'all',
    path: '/api/relay',
  }).fetch(c.req.raw)
})
