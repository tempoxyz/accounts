/**
 * Tests the `local` plugin against the suite's Tempo node: an instance that holds its owner key
 * signs in without Tempo ID, and its access key sends transactions that the node accepts. The first
 * transaction carries the owner's authorization of the access key, and a later one, from a new
 * instance on the same store, sends with the access key that the node registered. The instances run
 * in the worker, as a CLI's do, and each step shows its outcome on the page for its capture.
 * @module
 */
import type { Page } from '@playwright/test'
import { Accounts, Store } from 'accounts'
import { local, viem } from 'accounts/plugins'
import { formatUnits, http, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Chain from '../Chain.js'
import { expect, test } from '../Playwright.js'

/** Returns an instance of the `local` plugin on the suite's first node, which keeps its state in `store`. */
function instance(store: Store.Store) {
  return Accounts.create({
    chain: Chain.chain.id,
    clientId: 'cli:local-e2e',
    plugins: [local(), viem({ transport: http(Chain.rpcUrl) })],
    store,
  })
}

/**
 * Sends 1 OUSD from the session's account to `to` with the `viem` plugin, and waits until it lands.
 * The default access key spends up to 5 OUSD, its fees too, so the fee is in OUSD.
 */
function send(accounts: ReturnType<typeof instance>, to: `0x${string}`) {
  return accounts.viem.token.transferSync({
    amount: parseUnits('1', 6),
    feeToken: Chain.ousd,
    to,
    token: Chain.ousd,
  })
}

/** Shows each line of a step's outcome on `page`, so its capture holds it. */
async function show(page: Page, lines: readonly string[]) {
  await page.setContent(
    `<ul>${lines.map((line) => `<li>${line.replaceAll('<', '&lt;')}</li>`).join('')}</ul>`,
  )
}

test.describe('local', () => {
  test('sends with an access key that the owner authorized, and again from a new instance', async ({
    capture,
    page,
  }) => {
    const store = Store.memory()
    const accounts = instance(store)
    const recipient = privateKeyToAddress(generatePrivateKey())

    const address =
      await test.step('creates an owner key, and funds its account', async () => {
        const { accessKey, address, kind } = await accounts.local.create()
        await Chain.fund({ address })

        expect(kind).toBe('local')
        expect(accessKey?.account).toBe(address)
        await show(page, [
          `account: ${address}`,
          `session: ${kind}`,
          `access key: ${accessKey?.keyAuthorization.keyId}`,
        ])
        await capture('owner key created')
        return address
      })

    await test.step("sends 1 OUSD with the access key, which carries the owner's authorization", async () => {
      const { receipt } = await send(accounts, recipient)

      expect(receipt.status).toBe('success')
      expect(receipt.from.toLowerCase()).toBe(address.toLowerCase())
      await show(page, [
        `transaction: ${receipt.transactionHash}`,
        `status: ${receipt.status}`,
      ])
      await capture('sent with the authorization')
    })

    await test.step('signs in again from a new instance, and sends 1 OUSD with the same access key', async () => {
      // A new instance signs in again, as a program does at its start, and keeps the access key.
      const next = instance(store)
      const session = await next.local.signIn()
      const { receipt } = await send(next, recipient)
      const balance = await Chain.balance({
        address: recipient,
        token: Chain.ousd,
      })

      expect(session.address).toBe(address)
      expect(receipt.status).toBe('success')
      expect(balance).toBe(parseUnits('2', 6))
      await show(page, [
        `transaction: ${receipt.transactionHash}`,
        `recipient's balance: ${formatUnits(balance, 6)} OUSD`,
      ])
      await capture('sent from a new instance')
    })
  })
})
