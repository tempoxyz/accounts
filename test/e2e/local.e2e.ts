/**
 * Tests the `local` plugin against the suite's Tempo node: an instance that holds its owner key
 * signs in without Tempo ID, and its access key sends transactions that the node accepts. The first
 * transaction carries the owner's authorization of the access key, and a later one, from a new
 * instance on the same store, sends with the access key that the node registered.
 * @module
 */
import { Accounts, Store } from 'accounts'
import { local, viem } from 'accounts/plugins'
import { http, parseUnits } from 'viem'
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

test.describe('local', () => {
  test('sends with an access key that the owner authorized, and again from a new instance', async () => {
    const store = Store.memory()
    const accounts = instance(store)
    const { address } = await accounts.local.create()
    await Chain.fund({ address })
    const recipient = privateKeyToAddress(generatePrivateKey())

    const first = await send(accounts, recipient)
    // A new instance signs in again, as a program does at its start, and keeps the access key.
    const next = instance(store)
    const session = await next.local.signIn()
    const second = await send(next, recipient)

    expect(first.receipt.status).toBe('success')
    expect(second.receipt.status).toBe('success')
    expect(first.receipt.from.toLowerCase()).toBe(address.toLowerCase())
    expect(session.address).toBe(address)
    expect(await Chain.balance({ address: recipient, token: Chain.ousd })).toBe(
      parseUnits('2', 6),
    )
  })
})
