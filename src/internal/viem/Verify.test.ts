/**
 * Tests the refusal of the zero address by the verifiers of the Viem plugin's client, without a
 * server: a transport and a fetch that record each request, and answer none.
 * @module
 */
import { custom } from 'viem'
import { createSiweMessage } from 'viem/siwe'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../../Accounts.js'
import { viem } from '../../plugins/viem.js'
import * as Store from '../../Store.js'

const zeroAddress = '0x0000000000000000000000000000000000000000'

const hash = `0x${'11'.repeat(32)}` as const

// r = 0 and s = 0 recover no key, so the chain's `ecrecover` returns the zero address for each `v`.
const signatures = [`0x${'00'.repeat(64)}1b`, `0x${'00'.repeat(64)}1c`] as const

// The default mode, each mode that skips the token, and the branch that reads the token.
const modes = [
  {},
  { mode: 'eoa' },
  { mode: 'allowAccessKey' },
  { accessToken: 'access-token' },
] as const

/**
 * Returns an instance whose client verifies on a chain and at a Tempo ID that answer nothing, and
 * the requests that reach either.
 */
function instance() {
  const sent: string[] = []
  const accounts = Accounts.create({
    chain: 4217,
    clientId: 'https://app.example.com',
    fetch(input) {
      sent.push(new URL(new Request(input).url).pathname)
      return Promise.reject(new Error('No server listens.'))
    },
    plugins: [
      viem({
        transport: custom(
          {
            request(args) {
              sent.push(args.method)
              return Promise.reject(new Error('No node listens.'))
            },
          },
          { retryCount: 0 },
        ),
      }),
    ],
    store: Store.memory(),
    url: 'http://127.0.0.1:9',
  })
  return { accounts, sent }
}

/** Returns the results of `verify` for each signature in each mode. */
async function each(
  verify: (
    options: (typeof modes)[number] & { signature: `0x${string}` },
  ) => Promise<boolean>,
) {
  return await Promise.all(
    signatures.flatMap((signature) =>
      modes.map((mode) => verify({ ...mode, signature })),
    ),
  )
}

describe('hash', () => {
  test("refuses the zero address, whose signature the chain's ecrecover forges, before any request", async () => {
    const { accounts, sent } = instance()

    const results = await each((options) =>
      accounts.viem.verifyHash({ ...options, address: zeroAddress, hash }),
    )

    expect({ results: [...new Set(results)], sent }).toMatchInlineSnapshot(`
      {
        "results": [
          false,
        ],
        "sent": [],
      }
    `)
  })

  test('asks the chain for any other address', async () => {
    const { accounts, sent } = instance()

    const result = await accounts.viem.verifyHash({
      address: '0x0000000000000000000000000000000000000001',
      hash,
      signature: signatures[0],
    })

    expect({ result, sent }).toMatchInlineSnapshot(`
      {
        "result": false,
        "sent": [
          "eth_call",
        ],
      }
    `)
  })
})

describe('message', () => {
  test('refuses the zero address before any request', async () => {
    const { accounts, sent } = instance()

    const results = await each((options) =>
      accounts.viem.verifyMessage({
        ...options,
        address: zeroAddress,
        message: 'hello',
      }),
    )

    expect({ results: [...new Set(results)], sent }).toMatchInlineSnapshot(`
      {
        "results": [
          false,
        ],
        "sent": [],
      }
    `)
  })
})

describe('siweMessage', () => {
  test('refuses a message that names the zero address before any request', async () => {
    const { accounts, sent } = instance()
    const message = createSiweMessage({
      address: zeroAddress,
      chainId: 4217,
      domain: 'app.example.com',
      nonce: 'abcdefgh12345678',
      uri: 'https://app.example.com',
      version: '1',
    })

    const results = await Promise.all(
      signatures.map((signature) =>
        accounts.viem.verifySiweMessage({ message, signature }),
      ),
    )

    expect({ results: [...new Set(results)], sent }).toMatchInlineSnapshot(`
      {
        "results": [
          false,
        ],
        "sent": [],
      }
    `)
  })

  test('asks the chain for a message that names any other address', async () => {
    const { accounts, sent } = instance()
    const message = createSiweMessage({
      address: '0x0000000000000000000000000000000000000001',
      chainId: 4217,
      domain: 'app.example.com',
      nonce: 'abcdefgh12345678',
      uri: 'https://app.example.com',
      version: '1',
    })

    const result = await accounts.viem.verifySiweMessage({
      message,
      signature: signatures[0],
    })

    expect({ result, sent }).toMatchInlineSnapshot(`
      {
        "result": false,
        "sent": [
          "eth_call",
        ],
      }
    `)
  })
})

describe('typedData', () => {
  test('refuses the zero address before any request', async () => {
    const { accounts, sent } = instance()

    const results = await each((options) =>
      accounts.viem.verifyTypedData({
        ...options,
        address: zeroAddress,
        domain: { chainId: 4217, name: 'Example' },
        message: { contents: 'hello' },
        primaryType: 'Mail',
        types: { Mail: [{ name: 'contents', type: 'string' }] },
      }),
    )

    expect({ results: [...new Set(results)], sent }).toMatchInlineSnapshot(`
      {
        "results": [
          false,
        ],
        "sent": [],
      }
    `)
  })
})
