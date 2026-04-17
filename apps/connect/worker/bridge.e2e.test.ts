/**
 * End-to-end bridge test: Base USDC → Tempo USDC via Relay deposit address.
 *
 * Requires `TEST_BRIDGE_PRIVATE_KEY` in env — a funded wallet with USDC
 * on Base mainnet. Skipped when the env var is not set.
 *
 * Cost: ~$1.03 per run (1 USDC + gas + Relay fee).
 * Duration: 30-120s depending on Relay fill time.
 */

import { createClient, encodeFunctionData, erc20Abi, http, parseUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sendTransactionSync } from 'viem/actions'
import { base } from 'viem/chains'
import { beforeAll, describe, expect, test } from 'vp/test'

import * as TestSession from '../test/session.js'
import app from './index.js'

const privateKey = process.env.TEST_BRIDGE_PRIVATE_KEY

/** Base mainnet USDC. */
const baseUsdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const

describe.skipIf(!privateKey)('deposit e2e: Base USDC → Tempo', () => {
  beforeAll(() => TestSession.install())

  test('bridges USDC from Base to Tempo via deposit address', { timeout: 180_000 }, async () => {
    const account = privateKeyToAccount(privateKey! as `0x${string}`)
    const cookie = await TestSession.cookie(account.address)

    // 1. Get a deposit address from our endpoint.
    const depositRes = await app.request('/api/bridge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        cookie,
      },
      body: JSON.stringify({
        origin: { chainId: base.id, token: baseUsdc, decimals: 6 },
      }),
    })

    expect(depositRes.status).toBe(200)
    const { address: depositAddress, id: requestId } = (await depositRes.json()) as {
      address: string
      id: string
    }
    console.log(`Deposit address: ${depositAddress}`)
    console.log(`Request ID: ${requestId}`)

    // 2. Send 1 USDC on Base to the deposit address.
    const client = createClient({
      account,
      chain: base,
      transport: http(),
    })

    const receipt = await sendTransactionSync(client, {
      to: baseUsdc,
      data: encodeFunctionData({
        abi: erc20Abi,
        functionName: 'transfer',
        args: [depositAddress as `0x${string}`, parseUnits('1', 6)],
      }),
    })
    console.log(`Base tx confirmed in block ${receipt.blockNumber}`)

    // 3. Poll Relay until the bridge completes.
    // Poll by deposit address, not requestId — open-ended deposits
    // may regenerate the requestId when the actual amount differs
    // from the quoted nominal amount.
    const status = await pollRelayByAddress(depositAddress)
    console.log(`Relay status: ${status.status}`)
    expect(status.status).toBe('success')

    if (status.txHashes?.[0]) console.log(`Tempo tx: ${status.txHashes[0]}`)
  })
})

/** Poll Relay's requests API by deposit address until terminal. */
async function pollRelayByAddress(depositAddress: string) {
  const maxAttempts = 120
  const interval = 2_000

  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(
      `https://api.relay.link/requests/v2?depositAddress=${depositAddress}&sortBy=updatedAt&sortDirection=desc&limit=1`,
    )
    const data = (await res.json()) as {
      requests?: { status: string; data?: { outTxs?: { hash?: string }[] } }[]
    }

    const request = data.requests?.[0]
    if (request) {
      const { status } = request
      if (status === 'success' || status === 'failure') {
        const txHashes = request.data?.outTxs
          ?.map((tx) => tx.hash)
          .filter((h): h is string => Boolean(h))
        return { status, txHashes }
      }

      // Log progress every 10 polls.
      if (i > 0 && i % 10 === 0) console.log(`  polling… (${i * 2}s, status: ${status})`)
    }

    await new Promise((r) => setTimeout(r, interval))
  }

  throw new Error(`Relay bridge timed out after ${(maxAttempts * interval) / 1000}s`)
}
