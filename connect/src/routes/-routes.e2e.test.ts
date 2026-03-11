import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

const url = process.env.CONNECT_BASE_URL!
const address = '0x0000000000000000000000000000000000000000'

let browser: Browser
let page: Page

beforeAll(async () => {
  browser = await chromium.launch()
  page = await browser.newPage()
})

afterAll(async () => {
  await browser?.close()
})

describe('routes', () => {
  test('default: / renders home', async () => {
    await page.goto(`${url}/`)
    await page.getByText('Tempo Connect').waitFor()
  })

  test('default: wallet_connect renders with valid search', async () => {
    await page.goto(`${url}/rpc/wallet_connect?method=wallet_connect&id=1`)
    await page.getByText('wallet_connect').waitFor()
  })

  test('default: eth_sendTransaction renders with valid search', async () => {
    const params = encodeURIComponent(JSON.stringify([{ to: address }]))
    await page.goto(
      `${url}/rpc/eth_sendTransaction?method=eth_sendTransaction&id=2&params=${params}`,
    )
    await page.getByText('eth_sendTransaction').waitFor()
  })

  test('default: eth_sendTransactionSync renders with valid search', async () => {
    const params = encodeURIComponent(JSON.stringify([{ to: address }]))
    await page.goto(
      `${url}/rpc/eth_sendTransactionSync?method=eth_sendTransactionSync&id=3&params=${params}`,
    )
    await page.getByText('eth_sendTransactionSync').waitFor()
  })

  test('default: eth_signTransaction renders with valid search', async () => {
    const params = encodeURIComponent(JSON.stringify([{ to: address }]))
    await page.goto(
      `${url}/rpc/eth_signTransaction?method=eth_signTransaction&id=4&params=${params}`,
    )
    await page.getByText('eth_signTransaction').waitFor()
  })

  test('default: personal_sign renders with valid search', async () => {
    const params = encodeURIComponent(JSON.stringify(['0xdeadbeef', address]))
    await page.goto(
      `${url}/rpc/personal_sign?method=personal_sign&id=5&params=${params}`,
    )
    await page.getByText('personal_sign').waitFor()
  })

  test('default: eth_signTypedData_v4 renders with valid search', async () => {
    const params = encodeURIComponent(JSON.stringify([address, '{}']))
    await page.goto(
      `${url}/rpc/eth_signTypedData_v4?method=eth_signTypedData_v4&id=6&params=${params}`,
    )
    await page.getByText('eth_signTypedData_v4').waitFor()
  })

  test('default: wallet_authorizeAccessKey renders with valid search', async () => {
    await page.goto(
      `${url}/rpc/wallet_authorizeAccessKey?method=wallet_authorizeAccessKey&id=7`,
    )
    await page.getByText('wallet_authorizeAccessKey').waitFor()
  })

  test('default: wallet_revokeAccessKey renders with valid search', async () => {
    const params = encodeURIComponent(
      JSON.stringify([{ address: address, accessKeyAddress: address }]),
    )
    await page.goto(
      `${url}/rpc/wallet_revokeAccessKey?method=wallet_revokeAccessKey&id=8&params=${params}`,
    )
    await page.getByText('wallet_revokeAccessKey').waitFor()
  })

  test('default: unknown /rpc path renders Not Found', async () => {
    await page.goto(`${url}/rpc/nonexistent_method`)
    await page.getByText('Not Found').waitFor()
  })

  test('behavior: wrong method for route returns error', async () => {
    const params = encodeURIComponent(JSON.stringify(['0xdeadbeef', address]))
    const response = await page.goto(
      `${url}/rpc/wallet_connect?method=personal_sign&id=1&params=${params}`,
    )
    expect(response?.status()).toMatchInlineSnapshot(`500`)
  })
})
