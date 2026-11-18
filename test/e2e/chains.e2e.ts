/**
 * Tests the chains page of the web test app: an instance that serves two chains, each on a node of
 * the suite. The cases cover `switchChain`, the chain that the instance holds after a reload, the
 * access key that a transaction requests on a chain where the session holds none, a chain that no
 * instance serves, and the `chains` option. Each case reads both nodes.
 * @module
 */
import { zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as Web from '../Web.js'

/** The ID of the first node's chain, where each sign-in of the page starts. */
const first = Chain.chain.id

/** The error of `switchChain` for a chain that the instance does not serve. */
const invalid = {
  name: 'Accounts.ChainInvalidError',
}

/** The ID of the second node's chain. */
const second = Chain.second.chain.id

/** Returns the OUSD that `address` holds on each node, in the token's base units. */
async function balances(address: `0x${string}`) {
  const [onFirst, onSecond] = await Promise.all([
    Chain.balance({ address, token: Chain.ousd }),
    Chain.balance({ address, chainId: second, token: Chain.ousd }),
  ])
  return { first: onFirst, second: onSecond }
}

test.describe('chains', () => {
  test('switches to a second chain, requests an access key there, and sends on each chain', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    const key = await Web.enter_dialog(page, {
      capture,
      code,
      email,
      path: Apps.web.paths.chains,
    })

    await test.step('sends OUSD on the first chain', async () => {
      await expect(page.locator('#chain')).toHaveText(String(first))
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(await balances(recipient)).toEqual({
        first: 1_000_000n,
        second: 0n,
      })
      await capture('sent on the first chain')
    })

    await test.step('rejects the switch to a chain that the instance does not serve', async () => {
      const refused = await Playwright.run(page, { name: 'Switch to chain 1' })

      expect(refused).toEqual({
        state: 'rejected',
        value: expect.objectContaining(invalid),
      })
      await expect(page.locator('#chain')).toHaveText(String(first))
      await capture('refused chain 1')
    })

    await test.step('switches to the second chain, and keeps the session', async () => {
      const switched = await Playwright.run(page, {
        name: 'Switch to the second chain',
      })

      expect(switched).toEqual({
        state: 'fulfilled',
        value: { chainId: second },
      })
      await expect(page.locator('#chain')).toHaveText(String(second))
      await expect(page.locator('#status')).toHaveText('signedIn')
      // The session holds no access key on the second chain, and reads the same Tempo Account there.
      expect(await Playwright.run(page, { name: 'Session' })).toMatchObject({
        state: 'fulfilled',
        value: { email, key: null },
      })
      expect(await Playwright.run(page, { name: 'Account' })).toMatchObject({
        state: 'fulfilled',
        value: { address: key.account },
      })
      await Chain.fund({ address: key.account, chainId: second })
      await capture('switched')
    })

    await test.step('sends OUSD on the second chain with the access key that the user approves', async () => {
      await Playwright.submit(page, { amount: '1', to: recipient })
      await Playwright.approve(await Playwright.dialog(page))
      const transfer = await Playwright.outcome(page, { name: 'Send OUSD' })

      expect(transfer.state).toBe('fulfilled')
      expect(await balances(recipient)).toEqual({
        first: 1_000_000n,
        second: 1_000_000n,
      })
      const session = await Playwright.run(page, { name: 'Session' })
      expect(session).toMatchObject({
        state: 'fulfilled',
        value: { key: { account: key.account, chainId: second } },
      })
      const accessKey: `0x${string}` = session.value.key.id
      expect(accessKey).not.toBe(key.id)
      // Each node holds only the access key of its own chain.
      expect(
        await Chain.accessKey({
          accessKey,
          address: key.account,
          chainId: second,
        }),
      ).toMatchObject({ isRevoked: false })
      expect(
        await Chain.accessKey({ accessKey, address: key.account }),
      ).toMatchObject({ address: zeroAddress, expiry: 0n })
      await capture('sent on the second chain')
    })

    await test.step('starts on the second chain after a reload, and sends with no dialog', async () => {
      await page.reload()
      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#chain')).toHaveText(String(second))
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(await balances(recipient)).toEqual({
        first: 1_000_000n,
        second: 2_000_000n,
      })
      await capture('sent after a reload')
    })

    await test.step('switches back to the first chain, and sends with its first access key', async () => {
      const switched = await Playwright.run(page, {
        name: 'Switch to the first chain',
      })
      expect(switched).toEqual({
        state: 'fulfilled',
        value: { chainId: first },
      })
      await expect(page.locator('#chain')).toHaveText(String(first))
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(transfer.state).toBe('fulfilled')
      expect(await balances(recipient)).toEqual({
        first: 2_000_000n,
        second: 2_000_000n,
      })
      expect(await Playwright.run(page, { name: 'Session' })).toMatchObject({
        state: 'fulfilled',
        value: { key: { account: key.account, chainId: first, id: key.id } },
      })
      await capture('sent on the first chain again')
    })
  })

  test('restores no chain outside `chains`, and refuses the switch to it', async ({
    capture,
    code,
    email,
    page,
  }) => {
    const recipient = privateKeyToAddress(generatePrivateKey())
    const key = await Web.enter_dialog(page, {
      capture,
      code,
      email,
      path: Apps.web.paths.chains,
    })

    await test.step('switches to the second chain, which the store keeps', async () => {
      const switched = await Playwright.run(page, {
        name: 'Switch to the second chain',
      })

      expect(switched).toEqual({
        state: 'fulfilled',
        value: { chainId: second },
      })
      await page.reload()
      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#chain')).toHaveText(String(second))
      await capture('kept the second chain')
    })

    await test.step('starts an instance of the first chain alone on its chain, with the session', async () => {
      await page.goto(
        Web.url({ chains: String(first), path: Apps.web.paths.chains }),
      )

      await expect(page.locator('#status')).toHaveText('signedIn')
      await expect(page.locator('#chain')).toHaveText(String(first))
      expect(await Playwright.run(page, { name: 'Session' })).toMatchObject({
        state: 'fulfilled',
        value: {
          email,
          key: { account: key.account, chainId: first, id: key.id },
        },
      })
      await capture('started on the first chain')
    })

    await test.step('rejects the switch to the second chain, and sends on the first chain', async () => {
      const refused = await Playwright.run(page, {
        name: 'Switch to the second chain',
      })
      const transfer = await Playwright.send(page, {
        amount: '1',
        to: recipient,
      })

      expect(refused).toEqual({
        state: 'rejected',
        value: expect.objectContaining(invalid),
      })
      await expect(page.locator('#chain')).toHaveText(String(first))
      expect(transfer.state).toBe('fulfilled')
      expect(await balances(recipient)).toEqual({
        first: 1_000_000n,
        second: 0n,
      })
      await capture('refused the second chain')
    })
  })
})
