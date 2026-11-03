import { Fetch, Mppx, tempo } from 'mppx/client'
import { afterEach, beforeEach, expect, test, vi } from 'vp/test'

import { accounts } from '../../../test/config.js'
import * as MppxPolyfill from './MppxPolyfill.js'

const fetch_original = globalThis.fetch
const headers: (string | null)[] = []
const fetch_raw = async (_input: RequestInfo | URL, init?: RequestInit) => {
  headers.push(new Headers(init?.headers).get('accept-payment'))
  return new Response('ok')
}

beforeEach(() => {
  headers.length = 0
  globalThis.fetch = fetch_raw
})

afterEach(() => {
  Fetch.restore()
  globalThis.fetch = fetch_original
})

function install() {
  MppxPolyfill.install(({ tempo }) => [tempo({ account: accounts[0]! })])
}

test('behavior: a fetch sent before mppx loads goes through mppx', async () => {
  install()
  expect(globalThis.fetch === fetch_raw).toMatchInlineSnapshot(`false`)

  await fetch('https://api.example/resource')

  expect(headers).toMatchInlineSnapshot(`
    [
      "tempo/charge, tempo/session",
    ]
  `)
})

test('behavior: hands the global to mppx once loaded', async () => {
  install()
  const fetch_lazy = globalThis.fetch
  await fetch('https://api.example/resource')

  expect(globalThis.fetch === fetch_lazy).toMatchInlineSnapshot(`false`)
  Fetch.restore()
  expect(globalThis.fetch === fetch_raw).toMatchInlineSnapshot(`true`)
})

test('behavior: keeps a fetch installed over it before mppx loads', async () => {
  install()
  const fetch_lazy = globalThis.fetch
  const fetch_app: typeof fetch = (input, init) => fetch_lazy(input, init)
  globalThis.fetch = fetch_app

  await fetch('https://api.example/resource')

  expect(globalThis.fetch === fetch_app).toMatchInlineSnapshot(`true`)
  expect(headers).toMatchInlineSnapshot(`
    [
      "tempo/charge, tempo/session",
    ]
  `)
})

test('behavior: stops paying once another mppx polyfill replaces it before mppx loads', async () => {
  install()
  const fetch_lazy = globalThis.fetch
  // e.g. the app's own client; mppx then records the placeholder as the fetch to restore.
  Mppx.create({ methods: [tempo({ account: accounts[1]! })] })
  // Waits for mppx to load.
  await fetch_lazy('https://api.example/resource')

  Fetch.restore()
  await fetch('https://api.example/resource')

  expect(globalThis.fetch === fetch_lazy).toMatchInlineSnapshot(`true`)
  expect(headers).toMatchInlineSnapshot(`
    [
      null,
      null,
    ]
  `)
})

test('behavior: falls back to the original fetch when creating the client fails', async () => {
  MppxPolyfill.install(() => {
    throw new Error('Invalid method')
  })
  await fetch('https://api.example/resource')

  expect(globalThis.fetch === fetch_raw).toMatchInlineSnapshot(`true`)
  expect(headers).toMatchInlineSnapshot(`
    [
      null,
    ]
  `)
})

test('behavior: falls back to the original fetch when mppx fails to load', async () => {
  vi.doMock('mppx/client', () => {
    throw new Error('Failed to fetch dynamically imported module')
  })
  try {
    install()
    await fetch('https://api.example/resource')

    expect(globalThis.fetch === fetch_raw).toMatchInlineSnapshot(`true`)
    expect(headers).toMatchInlineSnapshot(`
      [
        null,
      ]
    `)
  } finally {
    vi.doUnmock('mppx/client')
  }
})

test('behavior: rejects an aborted fetch while mppx loads', async () => {
  vi.doMock('mppx/client', () => new Promise(() => {}))
  try {
    install()
    const controller = new AbortController()
    const request = fetch('https://api.example/resource', { signal: controller.signal })
    controller.abort()

    await expect(request).rejects.toThrowErrorMatchingInlineSnapshot(
      `[AbortError: This operation was aborted]`,
    )
    await expect(
      fetch('https://api.example/resource', { signal: AbortSignal.abort() }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[AbortError: This operation was aborted]`)
    expect(headers).toMatchInlineSnapshot(`[]`)
  } finally {
    vi.doUnmock('mppx/client')
  }
})
