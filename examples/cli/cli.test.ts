import { Provider } from 'accounts/cli'
import { CliAuth, Handler } from 'accounts/server'
import { Base64 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vp/test'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../test/config.js'
import { createServer } from '../../test/utils.js'

// Test with:
// `pnpm vp test --include 'examples/**/*.test.ts' examples/cli/cli.test.ts`

const root = accounts[0]!
const accessKey = accounts[1]!
const expiry = Math.floor(Date.now() / 1000) + 3_600

function createHandler() {
  return Handler.codeAuth({
    path: '/cli-auth',
    chainId: chain.id,
    client: getClient({ chain }),
    policy: {
      validate({ expiry: requestedExpiry, limits }) {
        return {
          expiry: requestedExpiry ?? expiry,
          ...(limits ? { limits } : {}),
        }
      },
    },
    random: () => new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
  })
}

async function createPkce() {
  const codeVerifier = Base64.fromBytes(crypto.getRandomValues(new Uint8Array(32)), {
    pad: false,
    url: true,
  })
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier))
  const codeChallenge = Base64.fromBytes(new Uint8Array(hash), { pad: false, url: true })
  return { codeVerifier, codeChallenge }
}

async function createCode(serverUrl: string) {
  const { codeVerifier, codeChallenge } = await createPkce()
  const res = await postJson(
    `${serverUrl}/cli-auth/code`,
    z.encode(CliAuth.createRequest, {
      codeChallenge,
      expiry,
      keyType: accessKey.keyType,
      pubKey: accessKey.publicKey,
    }),
  )
  const { code } = z.decode(CliAuth.createResponse, (await res.json()) as never)
  return { code, codeVerifier }
}

async function signAuthorization(code: string) {
  const signed = await root.signKeyAuthorization(
    { accessKeyAddress: accessKey.address, keyType: accessKey.keyType },
    { chainId: BigInt(chain.id), expiry },
  )
  const rpc = KeyAuthorization.toRpc(signed)
  return z.encode(CliAuth.authorizeRequest, {
    accountAddress: root.address,
    code,
    keyAuthorization: z.decode(CliAuth.keyAuthorization, {
      ...rpc,
      address: rpc.keyId,
    }),
  })
}

function postJson(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('device-code HTTP flow', () => {
  test('POST /code creates a device code', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    try {
      const { code } = await createCode(server.url)
      expect(code).toMatchInlineSnapshot(`"ABCDEFGH"`)
    } finally {
      await server.closeAsync()
    }
  })

  test('GET /pending/:code returns the pending entry', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    try {
      await createCode(server.url)
      const res = await fetch(`${server.url}/cli-auth/pending/ABCDEFGH`)
      expect(res.ok).toBe(true)
      const data = z.decode(CliAuth.pendingResponse, (await res.json()) as never)
      expect(data.status).toMatchInlineSnapshot(`"pending"`)
      expect(data.code).toMatchInlineSnapshot(`"ABCDEFGH"`)
      expect(data.keyType).toBe(accessKey.keyType)
    } finally {
      await server.closeAsync()
    }
  })

  test('POST /poll/:code returns pending before approval', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    try {
      const { code, codeVerifier } = await createCode(server.url)
      const res = await postJson(
        `${server.url}/cli-auth/poll/${code}`,
        z.encode(CliAuth.pollRequest, { codeVerifier }),
      )
      expect(res.ok).toBe(true)
      expect(z.decode(CliAuth.pollResponse, (await res.json()) as never)).toMatchInlineSnapshot(`
        {
          "status": "pending",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })

  test('POST /poll/:code rejects invalid code verifier', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    try {
      const { code } = await createCode(server.url)
      const res = await postJson(
        `${server.url}/cli-auth/poll/${code}`,
        z.encode(CliAuth.pollRequest, { codeVerifier: 'wrong' }),
      )
      expect(res.status).toMatchInlineSnapshot(`400`)
    } finally {
      await server.closeAsync()
    }
  })

  test('full cycle: create → authorize → poll returns authorized', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    try {
      const { code, codeVerifier } = await createCode(server.url)

      const authorizeRes = await postJson(`${server.url}/cli-auth`, await signAuthorization(code))
      expect(authorizeRes.ok).toBe(true)

      const pollRes = await postJson(
        `${server.url}/cli-auth/poll/${code}`,
        z.encode(CliAuth.pollRequest, { codeVerifier }),
      )
      expect(pollRes.ok).toBe(true)
      const result = z.decode(CliAuth.pollResponse, (await pollRes.json()) as never)
      expect(result.status).toBe('authorized')
      if (result.status === 'authorized') expect(result.accountAddress).toBe(root.address)
    } finally {
      await server.closeAsync()
    }
  })

  test('second poll after consumption returns expired', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    try {
      const { code, codeVerifier } = await createCode(server.url)
      await postJson(`${server.url}/cli-auth`, await signAuthorization(code))

      await postJson(
        `${server.url}/cli-auth/poll/${code}`,
        z.encode(CliAuth.pollRequest, { codeVerifier }),
      )

      const res = await postJson(
        `${server.url}/cli-auth/poll/${code}`,
        z.encode(CliAuth.pollRequest, { codeVerifier }),
      )
      expect(res.ok).toBe(true)
      expect(z.decode(CliAuth.pollResponse, (await res.json()) as never)).toMatchInlineSnapshot(`
        {
          "status": "expired",
        }
      `)
    } finally {
      await server.closeAsync()
    }
  })
})

describe('Provider.create', () => {
  test('wallet_connect through device-code flow', async () => {
    const handler = createHandler()
    const server = await createServer(handler.listener)
    const opened: string[] = []
    try {
      const provider = Provider.create({
        open: async (url) => {
          opened.push(url)
          const code = new URL(url).searchParams.get('code')!
          await postJson(`${server.url}/cli-auth`, await signAuthorization(code))
        },
        host: `${server.url}/cli-auth`,
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: {
                expiry,
                publicKey: accessKey.publicKey,
              },
            },
          },
        ],
      })

      expect(result.accounts[0]!.address).toBe(root.address)
      expect(opened.map((u) => u.replace(server.url, 'http://service'))).toMatchInlineSnapshot(`
        [
          "http://service/cli-auth?code=ABCDEFGH",
        ]
      `)
    } finally {
      await server.closeAsync()
    }
  })
})
