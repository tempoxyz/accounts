import { verify } from 'hono/jwt'
import { Hex, Provider as core_Provider, Secp256k1, WebCryptoP256 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { type Address, createClient, createWalletClient, custom, parseUnits } from 'viem'
import {
  getBalance,
  sendCalls,
  sendTransactionSync,
  signMessage,
  verifyHash,
  verifyMessage,
  verifyTypedData,
  waitForTransactionReceipt,
} from 'viem/actions'
import { Account as TempoAccount, Actions, Addresses, Transaction } from 'viem/tempo'
import { tempo, tempoModerato } from 'viem/tempo/chains'
import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { headlessWebAuthn, secp256k1 } from '../../test/adapters.js'
import { accounts, chain, getClient, http } from '../../test/config.js'
import { createJsonStorage, createServer, type Server } from '../../test/utils.js'
import * as Handler from '../server/Handler.js'
import * as Adapter from './Adapter.js'
import { local as core_local } from './adapters/local.js'
import * as Expiry from './Expiry.js'
import * as Keystore from './Keystore.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const adapters = [
  { name: 'headlessWebAuthn', adapter: headlessWebAuthn },
  { name: 'secp256k1', adapter: secp256k1 },
] as const

describe.each(adapters)('$name', ({ adapter }: (typeof adapters)[number]) => {
  function transfer(amount: string) {
    return Actions.token.transfer.call({
      to: '0x0000000000000000000000000000000000000001',
      token: Addresses.pathUsd,
      amount: parseUnits(amount, 6),
    })
  }

  const transferCall = transfer('1')

  /** Connects via login (or register if login returns no accounts), returns the active account address. */
  async function connect(provider: ReturnType<typeof Provider.create>) {
    const login = await provider.request({ method: 'wallet_connect' })
    if (login.accounts.length > 0) return login.accounts[0]!.address
    const register = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })
    return register.accounts[0]!.address
  }

  /** Funds an address with PathUSD from the pre-funded test account. */
  async function fund(address: Address) {
    const client = getClient()
    await Actions.token.transferSync(client, {
      account: accounts[0]!,
      feeToken: Addresses.pathUsd,
      to: address,
      token: Addresses.pathUsd,
      amount: parseUnits('10', 6),
    })
  }

  describe('create', () => {
    test('default: returns an EIP-1193 provider', async () => {
      const provider = Provider.create({ adapter: adapter() })
      expect(typeof provider.request).toMatch(/function/)
    })
  })

  describe('eth_chainId', () => {
    test('default: returns configured chain ID as hex', async () => {
      const provider = Provider.create({ adapter: adapter() })
      const chainId = await provider.request({ method: 'eth_chainId' })
      expect(chainId).toMatchInlineSnapshot(`"0x1079"`)
    })
  })

  describe('eth_accounts', () => {
    test('default: returns empty array initially', async () => {
      const provider = Provider.create({ adapter: adapter() })
      const accounts = await provider.request({ method: 'eth_accounts' })
      expect(accounts).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: returns accounts after connecting', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      const result = await provider.request({ method: 'eth_accounts' })
      expect(result.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('eth_requestAccounts', () => {
    test('default: returns accounts after connecting', async () => {
      const provider = Provider.create({ adapter: adapter() })
      await connect(provider)
      const result = await provider.request({ method: 'eth_requestAccounts' })
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: returns connected accounts without reloading', async () => {
      let calls = 0
      const provider = Provider.create({
        adapter: core_local({
          loadAccounts: async () => {
            calls++
            return { accounts: [accounts[0]!] }
          },
        }),
      })

      const first = await provider.request({ method: 'eth_requestAccounts' })
      const result = await provider.request({ method: 'eth_requestAccounts' })

      expect(calls).toBe(1)
      expect(result).toEqual(first)
    })
  })

  describe('wallet_connect', () => {
    test('default: without capabilities calls loadAccounts', async () => {
      const provider = Provider.create({ adapter: adapter() })
      const result = await provider.request({ method: 'wallet_connect' })
      for (const account of result.accounts) {
        expect(account.address).toMatch(/^0x[0-9a-f]{40}$/i)
        expect(account.capabilities).toMatchInlineSnapshot(`{}`)
      }
    })

    test('behavior: with register capability calls createAccount', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts.length).toMatchInlineSnapshot(`1`)
      expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
    })

    test('behavior: register passes name to createAccount', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', name: 'alice' } }],
      })
      expect(provider.store.getState().accounts.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: register defaults name to "default"', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(provider.store.getState().accounts.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: login sets activeAccount to loaded account', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      const login = await provider.request({ method: 'wallet_connect' })
      const result = await provider.request({ method: 'wallet_connect' })
      expect(result.accounts[0]!.address).toBe(login.accounts[0]!.address)
    })

    test('behavior: login with digest returns signature in account capabilities', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { digest: '0x1234' } }],
      })
      expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: digest signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      await connect(provider)
      const digest = '0x00000000000000000000000000000000000000000000000000000000deadbeef' as const
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { digest } }],
      })

      const valid = await verifyHash(client, {
        address: result.accounts[0]!.address,
        hash: digest,
        signature: result.accounts[0]!.capabilities.signature!,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('behavior: login without digest returns empty capabilities', async () => {
      const provider = Provider.create({ adapter: adapter() })
      await connect(provider)
      const result = await provider.request({ method: 'wallet_connect' })
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
    })

    test('behavior: register without digest returns empty capabilities', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts[0]!.capabilities).toMatchInlineSnapshot(`{}`)
    })

    test('behavior: register with digest returns signature in capabilities', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', digest: '0x1234' } }],
      })
      expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: register digest signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const digest = '0x00000000000000000000000000000000000000000000000000000000deadbeef' as const
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', digest } }],
      })

      const valid = await verifyHash(client, {
        address: result.accounts[0]!.address,
        hash: digest,
        signature: result.accounts[0]!.capabilities.signature!,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('behavior: login with personalSign echoes { message } and surfaces signature at root', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { personalSign: { message: 'hello' } } }],
      })

      expect(result.accounts[0]!.capabilities.personalSign).toEqual({ message: 'hello' })
      expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: login personalSign signature is verifiable via verifyMessage', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      await connect(provider)
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { personalSign: { message: 'hello' } } }],
      })

      const valid = await verifyMessage(client, {
        address: result.accounts[0]!.address,
        message: 'hello',
        signature: result.accounts[0]!.capabilities.signature!,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('behavior: register with personalSign echoes { message } and surfaces signature at root', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: { method: 'register', personalSign: { message: 'hi' } },
          },
        ],
      })

      expect(result.accounts[0]!.capabilities.personalSign).toEqual({ message: 'hi' })
      expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: register personalSign signature is verifiable via verifyMessage', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: { method: 'register', personalSign: { message: 'hi' } },
          },
        ],
      })

      const valid = await verifyMessage(client, {
        address: result.accounts[0]!.address,
        message: 'hi',
        signature: result.accounts[0]!.capabilities.signature!,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('error: personalSign + digest is rejected as invalid params', async () => {
      const provider = Provider.create({ adapter: adapter() })
      await connect(provider)

      await expect(
        provider.request({
          method: 'wallet_connect',
          params: [
            {
              capabilities: {
                digest: '0x1234',
                personalSign: { message: 'hello' },
              },
            },
          ],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InvalidParamsError: \`digest\` and \`personalSign\` cannot both be set on \`wallet_connect\`.]`,
      )
    })

    describe('auth (Server Authentication)', () => {
      let server: Server
      let badServer: Server
      let authBase: string

      beforeAll(async () => {
        // Real Hono app: mount the auth handler under `/auth` and add a
        // protected `/me` route — exactly as a dapp would compose them
        // — so the e2e test below exercises the full flow.
        let listener: Parameters<typeof createServer>[0] | undefined
        server = await createServer((req, res) => {
          if (!listener) {
            const auth = Handler.auth({ origin: server.url })
            const app = Handler.compose([auth], { path: '/auth' })
            app.get('/me', async (c) => {
              const session = await auth.getSession(c.req.raw)
              if (!session) return c.json({ error: 'unauthenticated' }, 401)
              return c.json({ address: session.address, chainId: session.chainId })
            })
            // Bad-challenge / bad-verify endpoints mounted on the same origin
            // as `/auth` so the same-origin enforcement (`absolutizeAuth`)
            // doesn't reject the request before the bad-content paths under
            // test can run. `app.all` so we don't depend on the SDK's request
            // method (POST).
            app.all('/bad/verify-401', (c) => c.json({ error: 'unauthorized' }, 401))
            app.all('/bad/challenge-500', (c) => c.json({ error: 'boom' }, 500))
            app.all('/bad/challenge-empty', (c) => c.json({}))
            app.all('/bad/challenge-evil-domain', (c) =>
              c.json({
                message: [
                  'evil.example wants you to sign in with your Ethereum account:',
                  '0x0000000000000000000000000000000000000000',
                  '',
                  '',
                  'URI: https://evil.example',
                  'Version: 1',
                  'Chain ID: 0',
                  'Nonce: deadbeef00',
                  'Issued At: 2025-01-01T00:00:00Z',
                ].join('\n'),
              }),
            )
            listener = app.listener
          }
          return listener(req, res)
        })
        authBase = `${server.url}/auth`

        // Cross-origin bad server kept around for the same-origin enforcement
        // tests below — its only job is to be on a different port from
        // `server` so origins genuinely differ.
        badServer = await createServer((_req, res) => {
          res.statusCode = 404
          res.end()
        })
      })

      afterAll(() => {
        server.close()
        badServer.close()
      })

      test('default: auth as string shorthand fetches challenge, signs once, posts verify', async () => {
        const provider = Provider.create({ adapter: adapter() })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { method: 'register', auth: authBase } }],
        })

        const capabilities = result.accounts[0]!.capabilities
        expect(capabilities.auth).toEqual({ token: expect.any(String) })
        expect(capabilities.personalSign).toEqual({
          message: expect.stringContaining('wants you to sign in'),
        })
        expect(capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
      })

      test('default: object-form auth with url derives challenge and verify', async () => {
        const provider = Provider.create({ adapter: adapter() })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { method: 'register', auth: { url: authBase } } }],
        })

        const capabilities = result.accounts[0]!.capabilities
        expect(capabilities.auth).toEqual({ token: expect.any(String) })
        expect(capabilities.personalSign).toEqual({
          message: expect.stringContaining('wants you to sign in'),
        })
        expect(capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
      })

      test('default: object-form auth with explicit endpoints uses the override URLs', async () => {
        const provider = Provider.create({ adapter: adapter() })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [
            {
              capabilities: {
                method: 'register',
                auth: {
                  challenge: `${authBase}/challenge`,
                  verify: authBase,
                },
              },
            },
          ],
        })

        expect(result.accounts[0]!.capabilities.auth).toEqual({ token: expect.any(String) })
      })

      test('default: forwarded auth without verify returns signature for downstream verify', async () => {
        const provider = Provider.create({ adapter: adapter() })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [
            {
              capabilities: {
                method: 'register',
                auth: {
                  challenge: `${authBase}/challenge`,
                  logout: `${authBase}/logout`,
                },
              },
            },
          ],
        })

        const capabilities = result.accounts[0]!.capabilities
        expect(capabilities.auth).toBeUndefined()
        expect(capabilities.personalSign).toEqual({
          message: expect.stringContaining('wants you to sign in'),
        })
        expect(capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
      })

      test('error: verify endpoint returns 401 → InternalError; user already signed', async () => {
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: {
                    challenge: `${authBase}/challenge`,
                    verify: `${server.url}/bad/verify-401`,
                  },
                },
              },
            ],
          }),
        ).rejects.toThrow(
          /Server Authentication verify endpoint `http:\/\/localhost:\d+\/bad\/verify-401` returned 401\./,
        )
      })

      test('error: auth + personalSign throws InvalidParamsError synchronously', async () => {
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: authBase,
                  personalSign: { message: 'hi' },
                },
              },
            ],
          }),
        ).rejects.toThrowErrorMatchingInlineSnapshot(
          `[RpcResponse.InvalidParamsError: \`auth\` and \`personalSign\` cannot both be set on \`wallet_connect\`.]`,
        )
      })

      test('default: auth + authorizeAccessKey surfaces both capabilities (one witness-bound ceremony)', async () => {
        const provider = Provider.create({ adapter: adapter() })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [
            {
              capabilities: {
                method: 'register',
                auth: authBase,
                authorizeAccessKey: { expiry: 0 },
              },
            },
          ],
        })

        expect(result.accounts[0]!.capabilities.auth).toEqual({ token: expect.any(String) })
        expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
        // TIP-1053 witness binding: the auth message is folded into the
        // access-key authorization, which doubles as the auth proof.
        expect(result.accounts[0]!.capabilities.personalSign).toEqual({
          keyAuthorization: expect.stringMatching(/^0x[0-9a-f]+$/),
          message: expect.any(String),
        })
        expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
      })

      test('error: challenge endpoint returns 500 → InvalidParamsError; no verify', async () => {
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: {
                    challenge: `${server.url}/bad/challenge-500`,
                    verify: authBase,
                  },
                },
              },
            ],
          }),
        ).rejects.toThrow(
          /Server Authentication challenge endpoint `http:\/\/localhost:\d+\/bad\/challenge-500` returned 500\./,
        )
      })

      test('error: challenge response missing `message` → InvalidParamsError', async () => {
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: {
                    challenge: `${server.url}/bad/challenge-empty`,
                    verify: authBase,
                  },
                },
              },
            ],
          }),
        ).rejects.toThrow(
          /Server Authentication challenge endpoint `http:\/\/localhost:\d+\/bad\/challenge-empty` response missing `message`\./,
        )
      })

      test('error: challenge bound to a different domain → InvalidParamsError; never signs', async () => {
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: {
                    challenge: `${server.url}/bad/challenge-evil-domain`,
                    verify: authBase,
                  },
                },
              },
            ],
          }),
        ).rejects.toThrow(/returned a message bound to `evil\.example`/)
      })

      test('error: `challenge` and `verify` on different origins → InvalidParamsError', async () => {
        // Phishing guard: a malicious dapp must not be able to point
        // `challenge` at the victim and `verify` at attacker.com to
        // harvest a valid signed payload.
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: {
                    challenge: `${authBase}/challenge`,
                    verify: `${badServer.url}/collect`,
                  },
                },
              },
            ],
          }),
        ).rejects.toThrow(
          /`auth` endpoints \(`challenge`, `verify`, `logout`\) must share the same origin\./,
        )
      })

      test('error: `logout` on a different origin → InvalidParamsError', async () => {
        const provider = Provider.create({ adapter: adapter() })

        await expect(
          provider.request({
            method: 'wallet_connect',
            params: [
              {
                capabilities: {
                  method: 'register',
                  auth: {
                    challenge: `${authBase}/challenge`,
                    verify: authBase,
                    logout: `${badServer.url}/logout`,
                  },
                },
              },
            ],
          }),
        ).rejects.toThrow(
          /`auth` endpoints \(`challenge`, `verify`, `logout`\) must share the same origin\./,
        )
      })

      test('default: no auth capability → no auth/personalSign on result', async () => {
        const provider = Provider.create({ adapter: adapter() })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { method: 'register' } }],
        })

        expect(result.accounts[0]!.capabilities.auth).toBeUndefined()
        expect(result.accounts[0]!.capabilities.personalSign).toBeUndefined()
      })

      test('default: login (post-register) + auth populates capabilities.auth', async () => {
        const provider = Provider.create({ adapter: adapter() })

        // Register first so login has an account to load.
        await provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { method: 'register' } }],
        })

        const result = await provider.request({
          method: 'wallet_connect',
          params: [{ capabilities: { auth: authBase } }],
        })

        expect(result.accounts[0]!.capabilities.auth).toEqual({ token: expect.any(String) })
        expect(result.accounts[0]!.capabilities.personalSign).toEqual({
          message: expect.stringContaining('wants you to sign in'),
        })
        expect(result.accounts[0]!.capabilities.signature).toMatch(/^0x[0-9a-f]+$/)
      })

      test('end-to-end: connect → call protected /me with bearer token', async () => {
        const provider = Provider.create({ adapter: adapter() })

        // Token mode: the server returns the session token in the body
        // (no cookie) and the SDK surfaces it on `capabilities.auth.token`.
        const result = await provider.request({
          method: 'wallet_connect',
          params: [
            {
              capabilities: {
                method: 'register',
                auth: { url: authBase, returnToken: true },
              },
            },
          ],
        })

        const token = result.accounts[0]!.capabilities.auth?.token
        expect(token).toMatch(/^[a-z0-9]+$/)

        // Authenticated request resolves the connected address.
        const me = await fetch(`${server.url}/me`, {
          headers: { authorization: `Bearer ${token}` },
        })
        expect(me.status).toBe(200)
        expect(await me.json()).toEqual({
          address: result.accounts[0]!.address,
          chainId: expect.any(Number),
        })

        // Unauthenticated request is rejected.
        const anon = await fetch(`${server.url}/me`)
        expect(anon.status).toBe(401)
      })
    })

    describe('identity (OIDC)', () => {
      let server: Server
      let issuer: string

      // Ed25519 keypair for the issuer (JWK strings).
      const signingKey = JSON.stringify({
        alg: 'Ed25519',
        crv: 'Ed25519',
        d: 'tx-s_Aj4ltT_rpY_AIEKexmitq2eyWMkuuIy5JMzmn4',
        x: 'eZEsf-38KiwfrWnn88cokaJmAoOVgTocC1TndJsz_uQ',
        kty: 'OKP',
      })
      const publicKey = JSON.stringify({
        alg: 'Ed25519',
        crv: 'Ed25519',
        x: 'eZEsf-38KiwfrWnn88cokaJmAoOVgTocC1TndJsz_uQ',
        kty: 'OKP',
      })
      // Sentinel account the issuer treats as having no verified email.
      const unverified = '0x000000000000000000000000000000000000dead'

      beforeAll(async () => {
        // Mount `Handler.oidcProvider` on a real server, exactly as the wallet
        // worker does, so the SDK app mints + verifies tokens over HTTP. Lazy
        // init so the issuer can reference the resolved `server.url`.
        let listener: Parameters<typeof createServer>[0] | undefined
        server = await createServer((req, res) => {
          if (!listener) {
            const oidc = Handler.oidcProvider({
              claimsSupported: [
                'iss',
                'aud',
                'sub',
                'iat',
                'exp',
                'nonce',
                'email',
                'email_verified',
              ],
              getClaims({ subject }) {
                // Mirror the wallet policy: only mint when a verified email exists.
                if (subject.toLowerCase() === unverified) throw new Error('No verified email.')
                return { email: 'alice@tempo.xyz', email_verified: true }
              },
              issuer: `${server.url}/oidc`,
              kid: 'test-1',
              path: '/oidc',
              publicKey,
              signingKey,
            })
            listener = oidc.listener
          }
          return listener(req, res)
        })
        issuer = `${server.url}/oidc`
      })

      afterAll(() => server.close())

      test('end-to-end: connect → mint verified-email id_token → verify via discovery + JWKS', async () => {
        const provider = Provider.create({ adapter: adapter() })
        const address = await connect(provider)

        const audience = 'https://app.example.com'
        const nonce = 'n-localnet'
        // The dialog's mint step: issue a token for the connected account.
        const minted = await fetch(`${issuer}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audience, nonce, subject: address }),
        })
        expect(minted.status).toBe(200)
        const { idToken } = (await minted.json()) as { idToken: string }

        // Relying-party verification path: discovery → JWKS → verify signature.
        const discovery = (await fetch(`${issuer}/.well-known/openid-configuration`).then((r) =>
          r.json(),
        )) as { issuer: string; jwks_uri: string }
        expect(discovery.issuer).toBe(issuer)
        const { keys } = (await fetch(discovery.jwks_uri).then((r) => r.json())) as {
          keys: JsonWebKey[]
        }
        const claims = (await verify(idToken, { ...keys[0]!, alg: 'EdDSA' }, 'EdDSA')) as Record<
          string,
          unknown
        >
        const { exp, iat, ...rest } = claims
        expect(exp).toBe((iat as number) + 300)
        expect(rest).toEqual({
          aud: audience,
          email: 'alice@tempo.xyz',
          email_verified: true,
          iss: issuer,
          nonce,
          sub: address,
        })
      })

      test('error: issuer rejects when no verified email is available (400)', async () => {
        const res = await fetch(`${issuer}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ audience: 'https://app.example.com', subject: unverified }),
        })
        expect(res.status).toBe(400)
      })
    })
  })

  describe('wallet_disconnect', () => {
    test('default: disconnects and clears accounts', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)
      await provider.request({ method: 'wallet_disconnect' })

      const accounts = await provider.request({ method: 'eth_accounts' })
      expect(accounts).toMatchInlineSnapshot(`[]`)
    })
  })

  describe('wallet_switchEthereumChain', () => {
    test('default: switches chain', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
      })

      const chainId = await provider.request({ method: 'eth_chainId' })
      expect(chainId).toMatchInlineSnapshot(`"0xa5bf"`)
    })

    test('error: throws for unconfigured chain', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await expect(
        provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: '0x1' }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedChainIdError: Chain 1 not configured.]`,
      )
    })
  })

  describe('events', () => {
    test('behavior: emits accountsChanged on connect', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const events: unknown[] = []
      provider.on('accountsChanged', (accounts) => events.push(accounts))

      const connected = await connect(provider)

      expect(events).toEqual([[connected]])
    })

    test('behavior: emits connect on status change', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const events: unknown[] = []
      provider.on('connect', (info) => events.push(info))

      await connect(provider)

      expect(events).toMatchInlineSnapshot(`
        [
          {
            "chainId": "0x1079",
          },
        ]
      `)
    })

    test('behavior: emits disconnect on disconnect', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)

      const events: unknown[] = []
      provider.on('disconnect', (error) => events.push(error))

      await provider.request({ method: 'wallet_disconnect' })

      expect(events.length).toMatchInlineSnapshot(`1`)
      expect(events[0]).toBeInstanceOf(core_Provider.DisconnectedError)
    })

    test('behavior: does not emit accountsChanged on duplicate login', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await connect(provider)

      const events: unknown[] = []
      provider.on('accountsChanged', (accounts) => events.push(accounts))

      await provider.request({ method: 'wallet_connect' })

      expect(events).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: emits chainChanged on switch', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const events: unknown[] = []
      provider.on('chainChanged', (chainId) => events.push(chainId))

      await provider.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${tempoModerato.id.toString(16)}` }],
      })

      expect(events).toMatchInlineSnapshot(`
        [
          "0xa5bf",
        ]
      `)
    })
  })

  describe('eth_sendTransaction', () => {
    test('default: sends transaction and returns hash', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    })

    test('behavior: accepts standard to/data fields', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ to: transferCall.to, data: transferCall.data }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)
    })

    test('behavior: transaction is confirmed on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      })

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })

      const {
        blockHash,
        blockNumber,
        cumulativeGasUsed,
        effectiveGasPrice,
        feePayer,
        from,
        gasUsed,
        logs,
        logsBloom,
        transactionHash,
        transactionIndex,
        ...rest
      } = receipt
      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(typeof blockNumber).toMatch(/bigint/)
      expect(typeof cumulativeGasUsed).toMatch(/bigint/)
      expect(typeof effectiveGasPrice).toMatch(/bigint/)
      expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(from).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(typeof gasUsed).toMatch(/bigint/)
      for (const log of logs) expect(log.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(logsBloom).toMatch(/^0x/)
      expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(typeof transactionIndex).toMatch(/number/)
      expect(rest).toMatchInlineSnapshot(`
        {
          "contractAddress": null,
          "feeToken": "0x20c0000000000000000000000000000000000000",
          "status": "success",
          "to": "0x20c0000000000000000000000000000000000000",
          "type": "0x76",
        }
      `)
    })
  })

  describe('eth_sendTransactionSync', () => {
    test('default: sends transaction and returns receipt', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      const {
        blockHash,
        blockNumber,
        cumulativeGasUsed,
        effectiveGasPrice,
        feePayer,
        from,
        gasUsed,
        logs,
        logsBloom,
        transactionHash,
        transactionIndex,
        ...rest
      } = receipt
      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(blockNumber).toMatch(/^0x/)
      expect(cumulativeGasUsed).toMatch(/^0x/)
      expect(effectiveGasPrice).toMatch(/^0x/)
      expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(from).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(gasUsed).toMatch(/^0x/)
      for (const log of logs) expect(log.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(logsBloom).toMatch(/^0x/)
      expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(transactionIndex).toMatch(/^0x/)
      expect(rest).toMatchInlineSnapshot(`
        {
          "contractAddress": null,
          "feeToken": "0x20c0000000000000000000000000000000000000",
          "status": "0x1",
          "to": "0x20c0000000000000000000000000000000000000",
          "type": "0x76",
        }
      `)
    })
  })

  describe('eth_signTransaction', () => {
    test('default: signs transaction and returns serialized', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(signed).toMatch(/^0x/)
    })

    test('behavior: signed transaction can be sent via eth_sendRawTransactionSync', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall] }],
      })

      const receipt = await provider.request({
        method: 'eth_sendRawTransactionSync',
        params: [signed],
      })

      const {
        blockHash,
        blockNumber,
        cumulativeGasUsed,
        effectiveGasPrice,
        // @ts-expect-error
        feePayer,
        from,
        gasUsed,
        logs,
        logsBloom,
        transactionHash,
        transactionIndex,
        ...rest
      } = receipt
      expect(blockHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(blockNumber).toMatch(/^0x/)
      expect(cumulativeGasUsed).toMatch(/^0x/)
      expect(effectiveGasPrice).toMatch(/^0x/)
      expect(feePayer).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(from).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(gasUsed).toMatch(/^0x/)
      for (const log of logs) expect(log.address).toMatch(/^0x[0-9a-f]{40}$/i)
      expect(logsBloom).toMatch(/^0x/)
      expect(transactionHash).toMatch(/^0x[0-9a-f]{64}$/)
      expect(transactionIndex).toMatch(/^0x/)
      expect(rest).toMatchInlineSnapshot(`
        {
          "contractAddress": null,
          "feeToken": "0x20c0000000000000000000000000000000000000",
          "status": "0x1",
          "to": "0x20c0000000000000000000000000000000000000",
          "type": "0x76",
        }
      `)
    })

    test('behavior: signing attaches stored keyAuthorization', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      const accessKey = provider.store.getState().accessKeys[0]!
      expect(accessKey.keyAuthorization).toBeDefined()

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(signed).toMatch(/^0x/)
      const transaction = Transaction.deserialize(signed as `0x${string}`)
      expect(
        (transaction as { keyAuthorization?: { address?: string | undefined } }).keyAuthorization
          ?.address,
      ).toBe(accessKey.address)

      const receipt = await provider.request({
        method: 'eth_sendRawTransactionSync',
        params: [signed],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('error: throws when not connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'eth_signTransaction',
          params: [{ calls: [transferCall] }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('wallet_sendCalls', () => {
    test('default: sends calls and returns id', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [{ calls: [transferCall] }],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: with sync capability returns id and receipt is available', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { sync: true },
          },
        ],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)
      expect(result.capabilities).toMatchInlineSnapshot(`
        {
          "sync": true,
        }
      `)
      expect(result.atomic).toMatchInlineSnapshot(`true`)
      expect(result.chainId).toMatch(/^0x[0-9a-f]+$/)
      expect(result.status).toMatchInlineSnapshot(`200`)
      expect(result.version).toMatchInlineSnapshot(`"2.0.0"`)
      expect(result.receipts?.length).toMatchInlineSnapshot(`1`)
      expect(result.receipts?.[0]?.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('error: preserves adapter failure details for viem fallback handling', async () => {
      const failing = Adapter.define({}, () => ({
        actions: {
          async createAccount() {
            return { accounts: [{ address: accounts[0]!.address }] }
          },
          async loadAccounts() {
            return { accounts: [{ address: accounts[0]!.address }] }
          },
          async sendTransaction() {
            throw new Error('plain send failure')
          },
          async sendTransactionSync() {
            throw new Error('plain sync failure')
          },
          async signPersonalMessage() {
            return '0x'
          },
          async signTransaction() {
            return '0x'
          },
          async signTypedData() {
            return '0x'
          },
        },
      }))
      const provider = Provider.create({
        adapter: failing,
        chains: [chain],
        storage: Storage.memory(),
      })
      await provider.request({ method: 'wallet_connect' })
      const client = createWalletClient({ chain, transport: custom(provider) })

      await expect(
        sendCalls(client, {
          account: accounts[0]!.address,
          calls: [transferCall],
          experimental_fallback: true,
          experimental_fallbackDelay: 0,
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(`
        [TransactionExecutionError: An internal error was received.

        Request Arguments:
          from:  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

        Details: plain send failure
        Version: viem@2.52.2]
      `)
    })
  })

  describe('wallet_getCallsStatus', () => {
    test('default: returns encoded status for a sent call batch', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const { id } = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { sync: true },
          },
        ],
      })

      const result = await provider.request({
        method: 'wallet_getCallsStatus',
        params: [id],
      })

      expect(result.atomic).toMatchInlineSnapshot(`true`)
      expect(result.chainId).toMatch(/^0x[0-9a-f]+$/)
      expect(result.status).toMatchInlineSnapshot(`200`)
      expect(result.version).toMatchInlineSnapshot(`"2.0.0"`)
      expect(result.receipts?.length).toMatchInlineSnapshot(`1`)
      expect(result.receipts?.[0]?.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('error: throws for unsupported id format', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'wallet_getCallsStatus',
          params: ['0xdeadbeef'],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InternalError: \`id\` not supported]`,
      )
    })
  })

  describe('wallet_transfer', () => {
    test('error: throws UnsupportedMethodError when adapter has no transfer action', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      await expect(
        provider.request({
          method: 'wallet_transfer',
          params: [
            {
              amount: '1',
              editable: true,
              to: '0x0000000000000000000000000000000000000001',
              token: Addresses.pathUsd,
            },
          ],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`transfer\` not supported by adapter.]`,
      )
    })
  })

  describe('wallet_swap', () => {
    test('error: throws UnsupportedMethodError when adapter has no swap action', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      await expect(
        provider.request({
          method: 'wallet_swap',
          params: [{ amount: '1', token: Addresses.pathUsd, type: 'sell' }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.UnsupportedMethodError: \`swap\` not supported by adapter.]`,
      )
    })
  })

  describe('wallet_getCapabilities', () => {
    test('default: returns atomic supported for all chains', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({ method: 'wallet_getCapabilities' })
      expect(result).toMatchInlineSnapshot(`
      	{
      	  "0x1079": {
      	    "accessKeys": {
      	      "status": "supported",
      	    },
      	    "atomic": {
      	      "status": "supported",
      	    },
      	    "mpp": {
      	      "status": "supported",
      	    },
      	  },
      	  "0x7a56": {
      	    "accessKeys": {
      	      "status": "supported",
      	    },
      	    "atomic": {
      	      "status": "supported",
      	    },
      	    "mpp": {
      	      "status": "supported",
      	    },
      	  },
      	  "0xa5bf": {
      	    "accessKeys": {
      	      "status": "supported",
      	    },
      	    "atomic": {
      	      "status": "supported",
      	    },
      	    "mpp": {
      	      "status": "supported",
      	    },
      	  },
      	}
      `)
    })

    test('behavior: filters by chainIds', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getCapabilities',
        params: [connected, [Hex.fromNumber(tempoModerato.id)]],
      })
      expect(result).toMatchInlineSnapshot(`
        {
          "0xa5bf": {
            "accessKeys": {
              "status": "supported",
            },
            "atomic": {
              "status": "supported",
            },
            "mpp": {
              "status": "supported",
            },
          },
        }
      `)
    })

    test('behavior: returns empty object for unknown chainIds', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getCapabilities',
        params: [connected, ['0x1']],
      })
      expect(result).toMatchInlineSnapshot(`{}`)
    })

    test('error: throws UnauthorizedError for unconnected address', async () => {
      const provider = Provider.create({ adapter: adapter() })

      await expect(
        provider.request({
          method: 'wallet_getCapabilities',
          params: ['0x0000000000000000000000000000000000000001'],
        }),
      ).rejects.toThrow(core_Provider.UnauthorizedError)
    })

    test('behavior: succeeds with connected address', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getCapabilities',
        params: [connected],
      })
      expect(Object.keys(result).length).toMatchInlineSnapshot(`3`)
      expect(result[Hex.fromNumber(tempo.id)]!.atomic.status).toMatchInlineSnapshot(`"supported"`)
    })

    test('behavior: includes feePayer when configured', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        feePayer: 'https://fee-payer.example.com',
      })

      const result = await provider.request({ method: 'wallet_getCapabilities' })
      expect(result[Hex.fromNumber(tempo.id)]!.feePayer).toMatchInlineSnapshot(`
        {
          "status": "supported",
        }
      `)
    })

    test('behavior: excludes feePayer when not configured', async () => {
      const provider = Provider.create({ adapter: adapter() })

      const result = await provider.request({ method: 'wallet_getCapabilities' })
      expect(result[Hex.fromNumber(tempo.id)]!.feePayer).toBeUndefined()
    })

    test('behavior: excludes mpp when disabled', async () => {
      const provider = Provider.create({ adapter: adapter(), mpp: false })

      const result = await provider.request({ method: 'wallet_getCapabilities' })
      expect(result[Hex.fromNumber(tempo.id)]!.mpp).toBeUndefined()
    })
  })

  describe('wallet_getBalances', () => {
    test('error: throws when no tokens provided', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await connect(provider)

      await expect(
        provider.request({ method: 'wallet_getBalances' }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[RpcResponse.InvalidParamsError: \`tokens\` is required.]`,
      )
    })

    test('default: returns token balances with metadata', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await connect(provider)

      const result = await provider.request({
        method: 'wallet_getBalances',
        params: [{ tokens: ['0x20c0000000000000000000000000000000000001'] }],
      })

      expect(result.length).toMatchInlineSnapshot(`1`)
      expect(result[0]!.address).toMatchInlineSnapshot(
        `"0x20c0000000000000000000000000000000000001"`,
      )
      expect(typeof result[0]!.name).toMatch(/string/)
      expect(typeof result[0]!.symbol).toMatch(/string/)
      expect(typeof result[0]!.decimals).toMatchInlineSnapshot(`"number"`)
      expect(result[0]!.balance).toMatch(/^0x/)
    })

    test('behavior: accepts explicit account param', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)

      const result = await provider.request({
        method: 'wallet_getBalances',
        params: [
          {
            account: connected,
            tokens: ['0x20c0000000000000000000000000000000000001'],
          },
        ],
      })

      expect(result.length).toMatchInlineSnapshot(`1`)
      expect(result[0]!.balance).toMatch(/^0x/)
    })

    test('error: throws DisconnectedError when no accounts connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'wallet_getBalances',
          params: [{ tokens: ['0x20c0000000000000000000000000000000000001'] }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('eth_signTypedData_v4', () => {
    const typedData = {
      domain: { name: 'Test', version: '1', chainId: 1 },
      types: {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' },
        ],
      },
      primaryType: 'Person' as const,
      message: { name: 'Bob', wallet: '0x0000000000000000000000000000000000000000' },
    }

    test('default: signs typed data and returns signature', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [connected, JSON.stringify(typedData)],
      })

      expect(signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const connected = await connect(provider)

      const signature = await provider.request({
        method: 'eth_signTypedData_v4',
        params: [connected, JSON.stringify(typedData)],
      })

      const valid = await verifyTypedData(client, {
        address: connected,
        signature,
        ...typedData,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('error: throws when not connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'eth_signTypedData_v4',
          params: ['0x0000000000000000000000000000000000000001', JSON.stringify(typedData)],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('personal_sign', () => {
    test('default: signs a message and returns signature', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)

      const message = Hex.fromString('hello world')
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, connected],
      })

      expect(signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: signature is verifiable on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const client = provider.getClient()

      const connected = await connect(provider)

      const message = Hex.fromString('hello world')
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, connected],
      })

      const valid = await verifyMessage(client, {
        address: connected,
        message: { raw: message },
        signature,
      })
      expect(valid).toMatchInlineSnapshot(`true`)
    })

    test('error: throws when not connected', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'personal_sign',
          params: [Hex.fromString('hello'), '0x0000000000000000000000000000000000000001'],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No accounts connected.]`,
      )
    })
  })

  describe('persistence', () => {
    test('behavior: new provider hydrates accounts from shared storage', async () => {
      const storage = Storage.memory({ key: 'persist-test' })

      const provider1 = Provider.create({ adapter: adapter(), storage })
      await connect(provider1)

      const accts1 = await provider1.request({ method: 'eth_accounts' })
      expect(accts1.length).toBeGreaterThanOrEqual(1)

      // Create a second provider with the same storage — it should hydrate.
      const provider2 = Provider.create({ adapter: adapter(), storage })

      // Wait for hydration + reconnection.
      await new Promise((resolve) => setTimeout(resolve, 200))

      const accts2 = await provider2.request({ method: 'eth_accounts' })
      expect(accts2.length).toBeGreaterThanOrEqual(1)
      expect(accts2[0]).toBe(accts1[0])
    })

    test('behavior: ignores persisted accounts the adapter cannot restore', async () => {
      const storage = Storage.memory({ key: 'persist-invalid' })
      storage.setItem('store', {
        state: {
          accounts: [{ address: '0x0000000000000000000000000000000000000001' }],
          activeAccount: 0,
          chainId: chain.id,
        },
        version: 0,
      })

      const provider = Provider.create({ adapter: adapter(), chains: [chain], storage })
      await new Promise((resolve) => setTimeout(resolve, 200))

      await expect(provider.request({ method: 'eth_accounts' })).resolves.toMatchInlineSnapshot(
        `[]`,
      )
    })

    test('behavior: concurrent providers with different storage keys are isolated', async () => {
      const providerA = Provider.create({
        adapter: adapter(),
        storage: Storage.memory({ key: 'provider-a' }),
      })
      const providerB = Provider.create({
        adapter: adapter(),
        storage: Storage.memory({ key: 'provider-b' }),
      })

      await connect(providerA)

      const acctsA = await providerA.request({ method: 'eth_accounts' })
      const acctsB = await providerB.request({ method: 'eth_accounts' })

      expect(acctsA.length).toBeGreaterThanOrEqual(1)
      expect(acctsB).toMatchInlineSnapshot(`[]`)
    })
  })

  describe('reconnection', () => {
    test('behavior: hydrated provider has accounts available', async () => {
      const storage = Storage.memory({ key: 'reconnect' })

      const provider1 = Provider.create({ adapter: adapter(), storage })
      await connect(provider1)

      const provider2 = Provider.create({ adapter: adapter(), storage })

      // Wait for hydration.
      await new Promise((resolve) => setTimeout(resolve, 200))

      const accts = await provider2.request({ method: 'eth_accounts' })
      expect(accts.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('viem compatibility', () => {
    test('behavior: works with viem custom() transport', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const client = provider.getClient()

      // Read action: getBalance
      const balance = await getBalance(client, { address })
      expect(balance).toBeGreaterThanOrEqual(0n)
    })

    test('behavior: WalletClient can sign messages', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)

      const client = createClient({
        account: address,
        chain,
        transport: custom(provider),
      })

      const signature = await signMessage(client, {
        account: address,
        message: 'hello',
      })
      expect(signature).toMatch(/^0x[0-9a-f]+$/)
    })

    test('behavior: WalletClient can send transactions', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const client = createClient({
        account: address,
        chain,
        transport: custom(provider),
      })

      const receipt = await sendTransactionSync(client, {
        account: address,
        to: '0x0000000000000000000000000000000000000001',
        value: 0n,
      })
      expect(receipt.status).toBe('success')
    })
  })

  describe('wallet_authorizeAccessKey', () => {
    test('behavior: without publicKey or address requires a connected account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      await expect(
        provider.request({
          method: 'wallet_authorizeAccessKey',
          params: [{ expiry: Expiry.days(1) }],
        }),
      ).rejects.toThrowErrorMatchingInlineSnapshot(
        `[Provider.DisconnectedError: No active account.]`,
      )
    })

    test('default: grants an access key and returns its address', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const rootAddress = await connect(provider)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(result.keyAuthorization.keyId).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(result.rootAddress).toBe(rootAddress)
    })

    test('behavior: granted access key is used for sendTransactionSync', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('behavior: access key status moves from pending to published', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      await expect(provider.getAccessKeyStatus()).resolves.toMatchInlineSnapshot(`"pending"`)

      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      await expect(provider.getAccessKeyStatus()).resolves.toMatchInlineSnapshot(`"published"`)
    })

    test('behavior: with expiry option', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry }],
      })
      expect(result.keyAuthorization.keyId).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(result.keyAuthorization.expiry).toBe(Hex.fromNumber(expiry))
    })

    test('behavior: expired access key falls back to root account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(provider.store.getState().accessKeys.length).toBe(1)

      // Expire the access key by mutating the store.
      const { accessKeys } = provider.store.getState()
      provider.store.setState({
        accessKeys: accessKeys.map((k) => ({
          ...k,
          expiry: Math.floor(Date.now() / 1000) - 1,
        })),
      })

      // Transaction should still succeed via root account fallback.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      // Verify transaction was sent by the root account, not the access key.
      expect(receipt.from.toLowerCase()).toBe(address.toLowerCase())

      // Expired access key should be removed from the store.
      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: with limits option', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('5', 6)) }],
          },
        ],
      })
      expect(result.keyAuthorization.limits).toMatchInlineSnapshot(`
        [
          {
            "limit": "0x4c4b40",
            "token": "0x20c0000000000000000000000000000000000000",
          },
        ]
      `)

      // Transaction within limit should succeed.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('exceeding access key limits falls back to root account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      // Grant access key with a tiny limit (0.01 PUSD).
      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('0.01', 6)) }],
          },
        ],
      })

      // Transfer 1 PUSD — exceeds access key limit, falls back to root account.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toBe('0x1')
      expect(receipt.from.toLowerCase()).toBe(address.toLowerCase())
    })

    test('behavior: access key is preserved after recoverable key-auth error', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      // Grant access key with a tiny limit.
      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('0.01', 6)) }],
          },
        ],
      })

      expect(provider.store.getState().accessKeys).toHaveLength(1)

      // Transfer exceeds limit — key-auth error — access key should fall back
      // to the root account without removing the still-valid access key.
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      expect(provider.store.getState().accessKeys.length).toMatchInlineSnapshot(`1`)
    })

    test('behavior: stale access key is removed and send retries with root account', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(provider.store.getState().accessKeys).toHaveLength(1)

      // Send a tx to register the key on-chain via keyAuthorization.
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      const accessKey = provider.store.getState().accessKeys[0]!
      await provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address, accessKeyAddress: accessKey.address }],
      })

      // Restore stale local state after revocation.
      provider.store.setState({
        accessKeys: [accessKey],
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    })
  })

  describe('wallet_updateAccessKey', () => {
    test('default: updates spending limits in place', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const { keyAuthorization } = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [
          {
            expiry: Expiry.days(1),
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('5', 6)) }],
          },
        ],
      })
      // Publish the key (and spend 1 pathUSD of its allowance).
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      await provider.request({
        method: 'wallet_updateAccessKey',
        params: [
          {
            address,
            accessKeyAddress: keyAuthorization.address!,
            limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(parseUnits('9', 6)) }],
          },
        ],
      })

      // `updateSpendingLimit` writes the remaining allowance directly — the
      // key keeps its address and the prior spend is not subtracted.
      const client = getClient()
      const { remaining } = await Actions.accessKey.getRemainingLimit(client, {
        account: address,
        accessKey: keyAuthorization.address!,
        token: Addresses.pathUsd,
      })
      expect(remaining).toBe(parseUnits('9', 6))

      // The key remains usable under the new allowance.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('error: rejects for an unknown access key', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await expect(
        provider.request({
          method: 'wallet_updateAccessKey',
          params: [
            {
              address,
              accessKeyAddress: '0x000000000000000000000000000000000000dEaD',
              limits: [{ token: Addresses.pathUsd, limit: Hex.fromNumber(1n) }],
            },
          ],
        }),
      ).rejects.toThrow(/key.*not.*found|KeyNotFound/i)
    })
  })

  describe('wallet_revokeAccessKey', () => {
    test('default: revokes a granted access key on-chain', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const connected = (await provider.request({ method: 'eth_accounts' }))[0]!
      await fund(connected)

      const { keyAuthorization } = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      // Send a tx to register the key on-chain via keyAuthorization.
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      // Key should exist on-chain before revocation.
      const client = getClient()
      const before = await Actions.accessKey.getMetadata(client, {
        account: connected,
        accessKey: keyAuthorization.address!,
      })
      expect(before.isRevoked).toBe(false)

      await provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address: connected, accessKeyAddress: keyAuthorization.address! }],
      })

      // Key should be revoked on-chain.
      const after = await Actions.accessKey.getMetadata(client, {
        account: connected,
        accessKey: keyAuthorization.address!,
      })
      expect(after.isRevoked).toBe(true)
    })

    test('behavior: removes key from local store', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const connected = (await provider.request({ method: 'eth_accounts' }))[0]!
      await fund(connected)

      const { keyAuthorization } = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      // Register the key on-chain.
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      expect(provider.store.getState().accessKeys).toHaveLength(1)

      await provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address: connected, accessKeyAddress: keyAuthorization.address! }],
      })

      expect(provider.store.getState().accessKeys).toMatchInlineSnapshot(`[]`)
    })

    test('behavior: root key still works after revoking access key', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      await connect(provider)

      const connected = (await provider.request({ method: 'eth_accounts' }))[0]!
      await fund(connected)

      const { keyAuthorization } = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      // Register the key on-chain, then revoke it.
      await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      await provider.request({
        method: 'wallet_revokeAccessKey',
        params: [{ address: connected, accessKeyAddress: keyAuthorization.address! }],
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })
  })

  describe('eth_fillTransaction', () => {
    const fillTx = { to: transferCall.to, data: transferCall.data } as const

    test('default: proxies to the node without modification', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      const result = await provider.request({
        method: 'eth_fillTransaction',
        params: [{ from: address, ...fillTx }],
      })
      expect(result.tx.gas).toBeDefined()
      expect(result.tx.to).toBeDefined()
    })

    test('behavior: fills stored keyAuthorization for access key accounts', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const { accessKeys } = provider.store.getState()
      expect(accessKeys).toHaveLength(1)
      expect(accessKeys[0]!.keyAuthorization).toBeDefined()

      const result = await provider.request({
        method: 'eth_fillTransaction',
        params: [{ from: address, ...fillTx }],
      })
      expect(result.tx.gas).toBeDefined()
      expect((result.tx as { keyAuthorization?: unknown }).keyAuthorization).toBeDefined()
    })

    test('behavior: fills stored keyAuthorization with the active account when from is omitted', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const result = await provider.request({
        method: 'eth_fillTransaction',
        params: [fillTx],
      })
      expect(result.tx.gas).toBeDefined()
      expect((result.tx as { keyAuthorization?: unknown }).keyAuthorization).toBeDefined()
    })

    test('behavior: does not inject keyAuthorization when already on params', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const { accessKeys } = provider.store.getState()
      const keyAuth = accessKeys[0]!.keyAuthorization!
      const rpcKeyAuth = KeyAuthorization.toRpc(keyAuth)

      const result = await provider.request({
        method: 'eth_fillTransaction',
        params: [
          {
            from: address,
            ...fillTx,
            keyAuthorization: { ...rpcKeyAuth, address: rpcKeyAuth.keyId },
          },
        ],
      })
      expect(result.tx.gas).toBeDefined()
    })
  })

  describe('Provider.create keystore option', () => {
    test('default: the built-in keystore provisions handle-backed records', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        storage: Storage.memory(),
      })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const record = provider.store.getState().accessKeys[0]!
      expect(record.keyType).toBe('p256')
      expect(record.handle).toMatchObject({ kind: 'webcrypto-p256' })
      expect(record.privateKey).toBeUndefined()
      expect(record.keyPair).toBeUndefined()

      // The non-extractable default signs transactions.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('default: provisions a p256 access key backed by the keystore', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { keystore: { p256: Keystore.webCryptoP256({ extractable: true }) } },
        storage: createJsonStorage(),
      })
      await connect(provider)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(result.keyAuthorization.keyType).toBe('p256')

      const record = provider.store.getState().accessKeys[0]!
      expect(record.keyType).toBe('p256')
      expect(record.handle).toMatchObject({ kind: 'webcrypto-p256' })
      expect(record.publicKey).toMatch(/^0x[0-9a-f]+$/i)
      expect(record.privateKey).toBeUndefined()
      expect(record.keyPair).toBeUndefined()
    })

    test('behavior: keystore-backed key signs transactions', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { keystore: { p256: Keystore.webCryptoP256({ extractable: true }) } },
        storage: createJsonStorage(),
      })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      await expect(provider.getAccessKeyStatus()).resolves.toMatchInlineSnapshot(`"pending"`)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)

      // Published status proves the keystore-backed key signed the transaction.
      await expect(provider.getAccessKeyStatus()).resolves.toMatchInlineSnapshot(`"published"`)
    })

    test('behavior: key survives reload through string-based storage without re-auth', async () => {
      const storage = createJsonStorage()

      const provider1 = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { keystore: { p256: Keystore.webCryptoP256({ extractable: true }) } },
        storage,
      })
      const address = await connect(provider1)
      await fund(address)
      await provider1.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      const accessKeyAddress = provider1.store.getState().accessKeys[0]!.address

      // Simulate an app restart: fresh provider, same storage and keystore.
      const provider2 = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { keystore: { p256: Keystore.webCryptoP256({ extractable: true }) } },
        storage,
      })
      await new Promise((resolve) => setTimeout(resolve, 200))

      const record = provider2.store.getState().accessKeys[0]!
      expect(record.address).toBe(accessKeyAddress)
      expect(record.handle).toMatchObject({ kind: 'webcrypto-p256' })
      expect(record.privateKey).toBeUndefined()
      expect(record.keyPair).toBeUndefined()

      const receipt = await provider2.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      await expect(provider2.getAccessKeyStatus()).resolves.toMatchInlineSnapshot(`"published"`)
    })

    test('behavior: json-rpc wallets provision through the keystore', async () => {
      const root = TempoAccount.fromSecp256k1(Secp256k1.randomPrivateKey())
      const forwarded: {
        address: Hex.Hex
        chainId: Hex.Hex
        expiry: Hex.Hex
        keyType: 'p256'
        privateKey?: unknown
        publicKey?: Hex.Hex
      }[] = []

      // Wallet-host stand-in: the dapp-side provider holds no root account and
      // forwards `wallet_authorizeAccessKey` over a JSON-RPC transport.
      const jsonRpcAdapter = Adapter.define({ name: 'JSON-RPC Test' }, () => ({
        actions: {
          createAccount: async () => ({ accounts: [{ address: root.address }] }),
          loadAccounts: async () => ({ accounts: [{ address: root.address }] }),
        },
        getAccount: () => ({
          account: { address: root.address, type: 'json-rpc' as const },
          transport: custom({
            async request({ method, params }: { method: string; params?: unknown[] }) {
              if (method !== 'wallet_authorizeAccessKey')
                throw new Error(`unexpected wallet method: ${method}`)
              const [parameters] = params as [(typeof forwarded)[number]]
              forwarded.push(parameters)
              const signed = await root.signKeyAuthorization(
                { address: parameters.address, type: parameters.keyType },
                { chainId: BigInt(parameters.chainId), expiry: Number(parameters.expiry) },
              )
              return { keyAuthorization: KeyAuthorization.toRpc(signed), rootAddress: root.address }
            },
          }),
        }),
      }))

      const provider = Provider.create({
        adapter: jsonRpcAdapter,
        chains: [chain],
        accessKey: { keystore: { p256: Keystore.webCryptoP256({ extractable: true }) } },
        storage: createJsonStorage(),
      })
      await provider.request({ method: 'wallet_connect' })
      await fund(root.address)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })
      expect(result.rootAddress).toBe(root.address)

      // The wallet received only public key material.
      expect(forwarded).toHaveLength(1)
      expect(forwarded[0]!.publicKey).toMatch(/^0x[0-9a-f]+$/i)
      expect(forwarded[0]!.privateKey).toBeUndefined()

      const record = provider.store.getState().accessKeys[0]!
      expect(record.access).toBe(root.address)
      expect(record.keyType).toBe('p256')
      expect(record.handle).toMatchObject({ kind: 'webcrypto-p256' })
      expect(record.publicKey).toBe(forwarded[0]!.publicKey)
      expect(record.privateKey).toBeUndefined()
      expect(record.keyPair).toBeUndefined()

      // The keystore-backed key signs without round-tripping the wallet.
      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall], from: root.address }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
      await expect(
        provider.getAccessKeyStatus({ address: root.address }),
      ).resolves.toMatchInlineSnapshot(`"published"`)
    })
  })

  describe('wallet_connect with authorizeAccessKey', () => {
    test('default: grants access key during register', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              method: 'register',
              authorizeAccessKey: { expiry: Math.floor(Date.now() / 1000) + 3600 },
            },
          },
        ],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
      expect(result.accounts[0]!.capabilities.keyAuthorization!.keyId).toMatch(/^0x[0-9a-f]{40}$/i)

      // Access key should be provisioned — sendTransactionSync should work
      const address = result.accounts[0]!.address
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('behavior: authorizeAccessKey with expiry during register', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', authorizeAccessKey: { expiry } } }],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
    })

    test('behavior: authorizeAccessKey during login', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      // Register first
      await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })

      // Login with authorizeAccessKey
      const result = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: { authorizeAccessKey: { expiry: Math.floor(Date.now() / 1000) + 3600 } },
          },
        ],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)

      const address = result.accounts[0]!.address
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })
  })

  describe('Provider.create accessKey.authorize option', () => {
    test('default: wallet_connect auto-authorizes access key', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { authorize: () => ({ expiry: Expiry.days(1) }) },
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
      expect(result.accounts[0]!.capabilities.keyAuthorization!.keyId).toMatch(/^0x[0-9a-f]{40}$/i)
    })

    test('default: deprecated `authorizeAccessKey` alias still applies', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        authorizeAccessKey: { expiry: Expiry.days(1) },
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts.length).toBeGreaterThanOrEqual(1)
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeDefined()
      expect(result.accounts[0]!.capabilities.keyAuthorization!.keyId).toMatch(/^0x[0-9a-f]{40}$/i)
    })

    test('behavior: auto-authorized access key can send transactions', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { authorize: () => ({ expiry: Expiry.days(1) }) },
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      const address = result.accounts[0]!.address
      await fund(address)

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })
      expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    })

    test('behavior: sendTransactionSync authorizes matching default access key just-in-time', async () => {
      let authorize = false
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: {
          authorize: () => {
            if (!authorize) return undefined
            return {
              expiry: Expiry.days(1),
              scopes: [{ address: Addresses.pathUsd, selector: 'transfer(address,uint256)' }],
            }
          },
        },
      })
      const address = await connect(provider)
      await fund(address)
      const initialAccessKeys = provider.store.getState().accessKeys.length
      authorize = true

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      expect({
        initialAccessKeys,
        storedAccessKeys: provider.store.getState().accessKeys.length,
        status: receipt.status,
      }).toMatchInlineSnapshot(`
        {
          "initialAccessKeys": 0,
          "status": "0x1",
          "storedAccessKeys": 1,
        }
      `)
    })

    test('behavior: sendTransactionSync skips default access key when scopes do not cover transaction', async () => {
      let authorize = false
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: {
          authorize: () => {
            if (!authorize) return undefined
            return {
              expiry: Expiry.days(1),
              scopes: [
                {
                  address: '0x0000000000000000000000000000000000000099',
                  selector: 'transfer(address,uint256)',
                },
              ],
            }
          },
        },
      })
      const address = await connect(provider)
      await fund(address)
      const initialAccessKeys = provider.store.getState().accessKeys.length
      authorize = true

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [transferCall] }],
      })

      expect({
        fromRoot: receipt.from.toLowerCase() === address.toLowerCase(),
        initialAccessKeys,
        storedAccessKeys: provider.store.getState().accessKeys.length,
        status: receipt.status,
      }).toMatchInlineSnapshot(`
        {
          "fromRoot": true,
          "initialAccessKeys": 0,
          "status": "0x1",
          "storedAccessKeys": 0,
        }
      `)
    })

    test('behavior: wallet_sendCalls authorizes matching default access key just-in-time', async () => {
      let authorize = false
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: {
          authorize: () => {
            if (!authorize) return undefined
            return {
              expiry: Expiry.days(1),
              scopes: [{ address: Addresses.pathUsd, selector: 'transfer(address,uint256)' }],
            }
          },
        },
      })
      const address = await connect(provider)
      await fund(address)
      const initialAccessKeys = provider.store.getState().accessKeys.length
      authorize = true

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { sync: true },
          },
        ],
      })

      expect({
        initialAccessKeys,
        status: result.status,
        storedAccessKeys: provider.store.getState().accessKeys.length,
        sync: result.capabilities?.sync,
      }).toMatchInlineSnapshot(`
        {
          "initialAccessKeys": 0,
          "status": 200,
          "storedAccessKeys": 1,
          "sync": true,
        }
      `)
    })

    test('behavior: explicit authorizeAccessKey overrides default', async () => {
      const expiry = Math.floor(Date.now() / 1000) + 3600
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { authorize: () => ({ expiry: Expiry.days(7) }) },
      })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register', authorizeAccessKey: { expiry } } }],
      })
      expect(result.accounts[0]!.capabilities.keyAuthorization!.expiry).toBe(Hex.fromNumber(expiry))
    })

    test('behavior: login reuses matching default access key', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        accessKey: { authorize: () => ({ expiry: Expiry.days(1) }) },
      })

      await connect(provider)
      const result = await provider.request({ method: 'wallet_connect' })
      expect(result.accounts[0]!.capabilities.keyAuthorization).toMatchInlineSnapshot(`undefined`)
    })

    test('behavior: without option, wallet_connect does not auto-authorize', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const result = await provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'register' } }],
      })
      expect(result.accounts[0]!.capabilities.keyAuthorization).toBeUndefined()
    })
  })

  describe('wallet_authorizeAccessKey with external key', () => {
    test('behavior: external key authorization can be used to send a transaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })
      const rootAddress = await connect(provider)
      await fund(rootAddress)

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const result = await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ ...accessKeyAccount, expiry: Expiry.days(1) }],
      })

      const client = provider.getClient()
      const receipt = await sendTransactionSync(client, {
        account: TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress }),
        calls: [transferCall],
        keyAuthorization: KeyAuthorization.fromRpc(result.keyAuthorization),
      })
      expect(receipt.status).toBe('success')
    })
  })

  describe('wallet_connect with external authorizeAccessKey', () => {
    test('default: external key authorization via register', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const connectResult = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              method: 'register',
              authorizeAccessKey: { expiry, ...accessKeyAccount },
            },
          },
        ],
      })

      const rootAddress = connectResult.accounts[0]!.address
      const keyAuthorization = connectResult.accounts[0]!.capabilities.keyAuthorization
      expect(keyAuthorization).toBeDefined()
      expect(keyAuthorization!.keyId).toBe(accessKeyAccount.address)

      await fund(rootAddress)

      const client = provider.getClient()
      const receipt = await sendTransactionSync(client, {
        account: TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress }),
        calls: [transferCall],
        keyAuthorization: KeyAuthorization.fromRpc(keyAuthorization!),
      })
      expect(receipt.status).toBe('success')
    })

    test('behavior: external key authorization via login', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const rootAddress = await connect(provider)
      await fund(rootAddress)

      const keyPair = await WebCryptoP256.createKeyPair()
      const accessKeyAccount = TempoAccount.fromWebCryptoP256(keyPair)

      const expiry = Math.floor(Date.now() / 1000) + 3600
      const loginResult = await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: { expiry, ...accessKeyAccount },
            },
          },
        ],
      })

      const keyAuthorization = loginResult.accounts[0]!.capabilities.keyAuthorization
      expect(keyAuthorization).toBeDefined()

      const client = provider.getClient()
      const receipt = await sendTransactionSync(client, {
        account: TempoAccount.fromWebCryptoP256(keyPair, { access: rootAddress }),
        calls: [transferCall],
        keyAuthorization: KeyAuthorization.fromRpc(keyAuthorization!),
      })
      expect(receipt.status).toBe('success')
    })
  })

  describe('feePayer', () => {
    const feePayerAccount = accounts[0]!
    let server: Server

    beforeAll(async () => {
      server = await createServer(
        Handler.relay({
          chains: [chain],
          feePayer: {
            account: feePayerAccount,
          },
          transports: { [chain.id]: http() },
        }).listener,
      )
    })

    afterAll(() => {
      server.close()
    })

    test('default: feePayer URL on eth_sendTransaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.01')

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: server.url }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer URL on eth_sendTransactionSync', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('2', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: server.url }],
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer URL on eth_signTransaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall], feePayer: server.url }],
      })

      expect(signed).toMatch(/^0x/)
    })

    test('behavior: feePayer URL on eth_fillTransaction', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)

      const result = await provider.request({
        method: 'eth_fillTransaction',
        params: [{ calls: [transferCall], feePayer: server.url, from: connected }],
      })

      expect((result.tx as { feePayerSignature?: unknown }).feePayerSignature).toBeDefined()
    })

    test('behavior: feePayer: true uses default from Provider.create', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.02')

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: true }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer: true on eth_sendTransactionSync', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('3', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: true }],
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: no feePayer does not use fee payer', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.03')

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall] }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: precedence fee-payer-first (default) on eth_sendTransaction', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.04')

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: true }],
      })

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: precedence fee-payer-first (default) on eth_sendTransactionSync', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('5', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: true }],
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: precedence user-first on eth_sendTransaction', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: { url: server.url, precedence: 'user-first' },
      })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.05')

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: true }],
      })

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: precedence user-first on eth_sendTransactionSync', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: { url: server.url, precedence: 'user-first' },
      })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('6', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: true }],
      })

      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: precedence user-first on eth_signTransaction', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: { url: server.url, precedence: 'user-first' },
      })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall], feePayer: true }],
      })

      expect(signed).toMatch(/^0x78/)
    })

    test('behavior: feePayer: false opts out on eth_sendTransaction', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.06')

      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [{ calls: [transferCall], feePayer: false }],
      })

      expect(hash).toMatch(/^0x[0-9a-f]{64}$/)

      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer: false opts out on eth_sendTransactionSync', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('4', 6),
      })

      const receipt = await provider.request({
        method: 'eth_sendTransactionSync',
        params: [{ calls: [syncTransferCall], feePayer: false }],
      })

      expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: feePayer: false opts out on eth_signTransaction', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)

      const signed = await provider.request({
        method: 'eth_signTransaction',
        params: [{ calls: [transferCall], feePayer: false }],
      })

      expect(signed).toMatch(/^0x76/)
    })

    test('behavior: wallet_sendCalls with feePayer capability', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.07')

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { feePayer: server.url },
          },
        ],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)

      const hash = result.id.slice(0, 66) as `0x${string}`
      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: wallet_sendCalls with feePayer: true uses provider default', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.08')

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { feePayer: true },
          },
        ],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)

      const hash = result.id.slice(0, 66) as `0x${string}`
      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: wallet_sendCalls with feePayer: false opts out', async () => {
      const provider = Provider.create({
        adapter: adapter(),
        chains: [chain],
        feePayer: server.url,
      })

      const connected = await connect(provider)
      await fund(connected)
      const transferCall = transfer('1.09')

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [transferCall],
            capabilities: { feePayer: false },
          },
        ],
      })

      expect(result.id).toMatch(/^0x[0-9a-f]+$/)

      const hash = result.id.slice(0, 66) as `0x${string}`
      const client = provider.getClient()
      const receipt = await waitForTransactionReceipt(client, { hash })
      expect(receipt.feePayer).not.toBe(feePayerAccount.address.toLowerCase())
    })

    test('behavior: wallet_sendCalls with sync and feePayer capability', async () => {
      const provider = Provider.create({ adapter: adapter(), chains: [chain] })

      const connected = await connect(provider)
      await fund(connected)
      const syncTransferCall = Actions.token.transfer.call({
        to: '0x0000000000000000000000000000000000000001',
        token: Addresses.pathUsd,
        amount: parseUnits('7', 6),
      })

      const result = await provider.request({
        method: 'wallet_sendCalls',
        params: [
          {
            calls: [syncTransferCall],
            capabilities: { feePayer: server.url, sync: true },
          },
        ],
      })

      expect(result.receipts?.[0]?.feePayer).toBe(feePayerAccount.address.toLowerCase())
    })
  })
})

describe('transports', () => {
  test('default: proxies unknown RPC methods through configured transport', async () => {
    const calls: { method: string; params?: unknown }[] = []
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      storage: Storage.memory(),
      transports: {
        [tempo.id]: custom({
          async request({ method, params }) {
            calls.push({ method, params })
            if (method === 'eth_blockNumber') return '0x1234'
            return null
          },
        }),
      },
    })

    const result = await provider.request({ method: 'eth_blockNumber' as never })
    expect(result).toMatchInlineSnapshot(`"0x1234"`)
    expect(calls.map((c) => c.method)).toMatchInlineSnapshot(`
      [
        "eth_blockNumber",
      ]
    `)
  })

  test('behavior: caller-provided transports override relay for the same chain', async () => {
    const calls: { method: string; params?: unknown }[] = []
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      relay: 'http://0.0.0.0:1',
      storage: Storage.memory(),
      transports: {
        [tempo.id]: custom({
          async request({ method, params }) {
            calls.push({ method, params })
            if (method === 'eth_blockNumber') return '0x999'
            return null
          },
        }),
      },
    })

    const result = await provider.request({ method: 'eth_blockNumber' as never })
    expect(result).toMatchInlineSnapshot(`"0x999"`)
    expect(calls.length).toMatchInlineSnapshot(`1`)
  })

  test('behavior: relay builds per-chain transport from base URL', async () => {
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      relay: 'http://relay.invalid',
      storage: Storage.memory(),
    })
    let url: string | undefined
    try {
      await provider.request({ method: 'eth_blockNumber' as never })
    } catch (e) {
      const match = (e as Error).message.match(/URL: (\S+)/)
      url = match?.[1]
    }
    expect(url).toMatchInlineSnapshot(`"http://relay.invalid/4217"`)
  })

  test('behavior: relay strips trailing slash from base URL', async () => {
    const provider = Provider.create({
      adapter: secp256k1(),
      chains: [tempo],
      relay: 'http://relay.invalid/',
      storage: Storage.memory(),
    })
    let url: string | undefined
    try {
      await provider.request({ method: 'eth_blockNumber' as never })
    } catch (e) {
      const match = (e as Error).message.match(/URL: (\S+)/)
      url = match?.[1]
    }
    expect(url).toMatchInlineSnapshot(`"http://relay.invalid/4217"`)
  })
})
