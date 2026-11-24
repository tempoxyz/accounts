/**
 * Runs `siwe` beside `backend` with a memory store, without a server. Each account signs with a local
 * secp256k1 key. No node listens: the transport of `node` answers each `eth_call` from a script, and
 * records it, so each test names the account's configuration on the chain and the requests of a
 * verification.
 * @module
 */
import { SignatureErc6492 } from 'ox/erc6492'
import { SignatureErc8010 } from 'ox/erc8010'
import { SignatureEnvelope, SignaturePreAuthorized } from 'ox/tempo'
import {
  concat,
  custom,
  hashMessage,
  hexToBytes,
  keccak256,
  type Transport,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount, sign } from 'viem/accounts'
import { parseSiweMessage } from 'viem/siwe'
import { Account } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { backend } from './backend.js'
import { siwe } from './siwe.js'
import { viem } from './viem.js'

const origin = 'https://app.example.com'

/** The precompile that holds each account's config commitment. */
const accountConfiguration = '0xaacc000000000000000000000000000000000000'

/** The precompile that verifies a configurable account's signature. */
const signatureVerifier = '0x5165300000000000000000000000000000000000'

/** A word of zero: the config commitment of an account that is not configurable, or `false`. */
const zero = `0x${'00'.repeat(32)}` as const

/** A word of one: a config commitment, or `true`. */
const one = `0x${'00'.repeat(31)}01` as const

describe('siwe.start', () => {
  test("names the request's host and origin, the instance's chain, the statement, and the zero address for an unknown account", async () => {
    const { accounts } = instance({ statement: 'Sign in to the notes.' })

    const { message } = await accounts.siwe.start({
      request: new Request(`${origin}/api/siwe/challenge`),
    })
    const { expirationTime, issuedAt, nonce, ...fields } =
      parseSiweMessage(message)

    expect(fields).toMatchInlineSnapshot(`
      {
        "address": "0x0000000000000000000000000000000000000000",
        "chainId": 4217,
        "domain": "app.example.com",
        "statement": "Sign in to the notes.",
        "uri": "https://app.example.com",
        "version": "1",
      }
    `)
    expect({
      lifetime: expirationTime!.getTime() - issuedAt!.getTime(),
      nonce: /^[0-9a-f]{32}$/.test(nonce!),
    }).toMatchInlineSnapshot(`
      {
        "lifetime": 600000,
        "nonce": true,
      }
    `)
  })

  test("names the plugin's origin behind a proxy, and refuses a request from another origin", async () => {
    const { accounts } = instance({ origin: 'https://app.example.com/ignored' })
    const proxied = (headers: Record<string, string>) =>
      accounts.siwe
        .start({
          request: new Request('http://127.0.0.1:8787/api/siwe/challenge', {
            headers,
            method: 'POST',
          }),
        })
        .then(({ message }) => {
          const { domain, uri } = parseSiweMessage(message)
          return { domain, uri }
        }, reason)

    const results = await Promise.all([
      proxied({ origin }),
      proxied({ origin: 'https://attacker.example' }),
      // A request without `Origin` counts as its URL's origin, which behind the proxy is another.
      proxied({}),
    ])

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "domain": "app.example.com",
          "uri": "https://app.example.com",
        },
        "origin",
        "origin",
      ]
    `)
  })
})

describe('siwe.complete', () => {
  test("throws for `accessTokens.clientIds: 'any'`, which would accept another app's token", () => {
    expect(() =>
      siwe({
        accessTokens: {
          audience: 'https://api.example',
          clientIds: 'any',
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Invalid \`accessTokens.clientIds\`: \`'any'\` accepts every app's token, which proves no sign-in for this app. Name the app's own client IDs.]`,
    )
  })

  test('stores the SIWE session of the account that signs a message of an unknown account', async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const { id, message } = await start(accounts)

    const session = await accounts.siwe.complete({
      address: account.address.toLowerCase() as `0x${string}`,
      id,
      message,
      signature: await account.signMessage({ message }),
    })
    const stored = await accounts.backend.get({ id })

    expect(stored).toEqual(session)
    expect({
      address: session.address === account.address,
      lifetime: session.expiresAt - session.issuedAt,
      method: session.method,
    }).toMatchInlineSnapshot(`
      {
        "address": true,
        "lifetime": 86400000,
        "method": "siwe",
      }
    `)
  })

  test('verifies each challenge once, also for concurrent calls', async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const { id, message } = await start(accounts)
    const parameters = {
      address: account.address,
      id,
      message,
      signature: await account.signMessage({ message }),
    }

    const results = await Promise.all(
      [1, 2].map(() => accounts.siwe.complete(parameters).then(reason, reason)),
    )
    const replay = await accounts.siwe.complete(parameters).then(reason, reason)

    expect({ replay, results }).toMatchInlineSnapshot(`
      {
        "replay": "challenge",
        "results": [
          "verified",
          "challenge",
        ],
      }
    `)
  })

  test('refuses a message other than the challenge, and spends the challenge', async () => {
    const { accounts } = instance({ statement: 'Sign in to the notes.' })
    const account = privateKeyToAccount(generatePrivateKey())
    const { id, message } = await start(accounts)
    const forged = message.replace('Sign in to the notes.', 'Sign in.')

    const refused = await accounts.siwe
      .complete({
        address: account.address,
        id,
        message: forged,
        signature: await account.signMessage({ message: forged }),
      })
      .then(reason, reason)
    const retried = await accounts.siwe
      .complete({
        address: account.address,
        id,
        message,
        signature: await account.signMessage({ message }),
      })
      .then(reason, reason)

    expect({ refused, retried }).toMatchInlineSnapshot(`
      {
        "refused": "message",
        "retried": "challenge",
      }
    `)
  })

  test('refuses a signature of another account, and a signer other than the address that the message names', async () => {
    const { accounts } = instance()
    const named = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const unknown = await start(accounts)
    const addressed = await start(accounts, { address: named.address })

    const results = await Promise.all([
      // The message of an unknown account, signed by another account than the one that the body names.
      accounts.siwe
        .complete({
          address: named.address,
          id: unknown.id,
          message: unknown.message,
          signature: await other.signMessage({ message: unknown.message }),
        })
        .then(reason, reason),
      // A message that names `named`, signed by `other`, which names itself.
      accounts.siwe
        .complete({
          address: other.address,
          id: addressed.id,
          message: addressed.message,
          signature: await other.signMessage({ message: addressed.message }),
        })
        .then(reason, reason),
    ])

    expect(results).toMatchInlineSnapshot(`
      [
        "signer",
        "signer",
      ]
    `)
    expect(parseSiweMessage(addressed.message).address).toBe(named.address)
  })

  test("refuses the zero address, whose signature the chain's ecrecover forges, before any request", async () => {
    const { sent, transport } = node()
    const { accounts } = instance({ transport })
    const { id, message } = await start(accounts)

    // r = 0, s = 0, v = 27 recovers no key, so the chain's `ecrecover` returns the zero address.
    const result = await accounts.siwe
      .complete({
        address: '0x0000000000000000000000000000000000000000',
        id,
        message,
        signature: `0x${'00'.repeat(64)}1b`,
      })
      .then(reason, reason)

    expect({ result, sent }).toMatchInlineSnapshot(`
      {
        "result": "signer",
        "sent": [],
      }
    `)
  })

  test('reads the config commitment of the account that an owner key signs for', async () => {
    const { sent, transport } = node()
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())

    await signIn(accounts, account)

    expect(sent).toMatchInlineSnapshot(`
      [
        "eth_call 0xaacc000000000000000000000000000000000000",
      ]
    `)
  })

  test('refuses the retired root key of an account that was upgraded in place', async () => {
    // The root key's signature recovers the account's address before and after the upgrade.
    let commitment: `0x${string}` = zero
    const { sent, transport } = node({
      answer: (to) => (to === accountConfiguration ? commitment : undefined),
    })
    const { accounts } = instance({ transport })
    const root = privateKeyToAccount(generatePrivateKey())
    const attempt = async () => {
      const { id, message } = await start(accounts)
      return accounts.siwe
        .complete({
          address: root.address,
          id,
          message,
          signature: await root.signMessage({ message }),
        })
        .then(reason, reason)
    }

    const before = await attempt()
    commitment = one
    const after = await attempt()

    expect({ after, before, sent }).toMatchInlineSnapshot(`
      {
        "after": "signer",
        "before": "verified",
        "sent": [
          "eth_call 0xaacc000000000000000000000000000000000000",
          "eth_call 0xaacc000000000000000000000000000000000000",
        ],
      }
    `)
  })

  test('refuses the retired root key of an upgraded account in a wrapper, whose call the chain accepts', async () => {
    // A wrapper carries a call or an authorization that the signer chooses. The chain answers the
    // call of each wrapper with `true`, as a node that runs it for the retired root key.
    let commitment: `0x${string}` = zero
    const { sent, transport } = node({
      answer: (to) => (to === accountConfiguration ? commitment : one),
    })
    const { accounts } = instance({ transport })
    const root = privateKeyToAccount(generatePrivateKey())
    const attempt = async (
      wrap: (signature: `0x${string}`) => `0x${string}`,
    ) => {
      const { id, message } = await start(accounts)
      return accounts.siwe
        .complete({
          address: root.address,
          id,
          message,
          signature: wrap(await root.signMessage({ message })),
        })
        .then(reason, reason)
    }
    const erc6492 = (signature: `0x${string}`) =>
      SignatureErc6492.wrap({
        data: '0x',
        signature,
        to: '0x0000000000000000000000000000000000000001',
      })
    const erc8010 = (signature: `0x${string}`) =>
      SignatureErc8010.wrap({
        authorization: {
          address: '0x0000000000000000000000000000000000000001',
          chainId: 4217,
          nonce: 0n,
          r: 1n,
          s: 1n,
          yParity: 0,
        },
        signature,
      })
    const attempts = async () => ({
      'in ERC-6492': await attempt(erc6492),
      'in ERC-8010 in ERC-6492': await attempt((signature) =>
        erc6492(erc8010(signature)),
      ),
    })

    const before = await attempts()
    commitment = one
    const after = await attempts()

    expect({ after, before, sent: sent.toSorted() }).toMatchInlineSnapshot(`
      {
        "after": {
          "in ERC-6492": "signer",
          "in ERC-8010 in ERC-6492": "signer",
        },
        "before": {
          "in ERC-6492": "verified",
          "in ERC-8010 in ERC-6492": "verified",
        },
        "sent": [
          "eth_call",
          "eth_call",
          "eth_call",
          "eth_call",
          "eth_call 0xaacc000000000000000000000000000000000000",
          "eth_call 0xaacc000000000000000000000000000000000000",
          "eth_call 0xaacc000000000000000000000000000000000000",
          "eth_call 0xaacc000000000000000000000000000000000000",
        ],
      }
    `)
  })

  test("verifies a configurable account's signature with the chain's signature verifier alone", async () => {
    let valid: `0x${string}` = one
    const { sent, transport } = node({
      answer: (to) => (to === signatureVerifier ? valid : undefined),
    })
    const { accounts } = instance({ transport })
    const owner = privateKeyToAccount(generatePrivateKey())
    const account = Account.fromConfig({
      address: privateKeyToAccount(generatePrivateKey()).address,
      upgrade: { owners: [owner], threshold: 1 },
    })
    const attempt = async () => {
      const { id, message } = await start(accounts)
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          signature: await account.signMessage({ message }),
        })
        .then(reason, reason)
    }

    const current = await attempt()
    valid = zero
    const other = await attempt()

    expect({ current, other, sent }).toMatchInlineSnapshot(`
      {
        "current": "verified",
        "other": "signer",
        "sent": [
          "eth_call 0x5165300000000000000000000000000000000000",
          "eth_call 0x5165300000000000000000000000000000000000",
        ],
      }
    `)
  })

  test("verifies a configurable account's signature in a wrapper with the chain's signature verifier alone, also for an upgraded account", async () => {
    // The account holds a config commitment, and no node answers the call of a wrapper.
    const { sent, transport } = node({
      answer: (to) =>
        to === accountConfiguration || to === signatureVerifier
          ? one
          : undefined,
    })
    const { accounts } = instance({ transport })
    const owner = privateKeyToAccount(generatePrivateKey())
    const account = Account.fromConfig({
      address: privateKeyToAccount(generatePrivateKey()).address,
      upgrade: { owners: [owner], threshold: 1 },
    })
    const attempt = async (
      wrap: (signature: `0x${string}`) => `0x${string}`,
    ) => {
      const { id, message } = await start(accounts)
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          signature: wrap(await account.signMessage({ message })),
        })
        .then(reason, reason)
    }

    const erc6492 = (signature: `0x${string}`) =>
      SignatureErc6492.wrap({
        data: '0x',
        signature,
        to: '0x0000000000000000000000000000000000000001',
      })
    const erc8010 = (signature: `0x${string}`) =>
      SignatureErc8010.wrap({
        authorization: {
          address: '0x0000000000000000000000000000000000000001',
          chainId: 4217,
          nonce: 0n,
          r: 1n,
          s: 1n,
          yParity: 0,
        },
        signature,
      })

    const results = {
      'in ERC-6492': await attempt(erc6492),
      'in ERC-8010': await attempt(erc8010),
      'in ERC-8010 in ERC-6492': await attempt((signature) =>
        erc6492(erc8010(signature)),
      ),
    }

    expect({ results, sent }).toMatchInlineSnapshot(`
      {
        "results": {
          "in ERC-6492": "verified",
          "in ERC-8010": "verified",
          "in ERC-8010 in ERC-6492": "verified",
        },
        "sent": [
          "eth_call 0x5165300000000000000000000000000000000000",
          "eth_call 0x5165300000000000000000000000000000000000",
          "eth_call 0x5165300000000000000000000000000000000000",
        ],
      }
    `)
  })

  test("refuses an access key's keychain envelope before any request, also in a wrapper", async () => {
    // The chain answers each call with `true`, as an account's code that accepts any signature.
    const { sent, transport } = node({ answer: () => one })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const attempt = async (
      version: 'v1' | 'v2',
      wrap: (signature: `0x${string}`) => `0x${string}` = (signature) =>
        signature,
    ) => {
      const { id, message } = await start(accounts)
      const signature = await keychain({
        address: account.address,
        message,
        version,
      })
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          signature: wrap(signature),
        })
        .then(reason, reason)
    }
    const erc6492 = (signature: `0x${string}`) =>
      SignatureErc6492.wrap({
        data: '0x',
        signature,
        to: '0x0000000000000000000000000000000000000001',
      })
    const erc8010 = (signature: `0x${string}`) =>
      SignatureErc8010.wrap({
        authorization: {
          address: '0x0000000000000000000000000000000000000001',
          chainId: 4217,
          nonce: 0n,
          r: 1n,
          s: 1n,
          yParity: 0,
        },
        signature,
      })

    const results = {
      v1: await attempt('v1'),
      v2: await attempt('v2'),
      'v2 in ERC-6492': await attempt('v2', erc6492),
      'v2 in ERC-8010': await attempt('v2', erc8010),
      'v2 in ERC-8010 in ERC-6492': await attempt('v2', (signature) =>
        erc6492(erc8010(signature)),
      ),
    }

    expect({ results, sent }).toMatchInlineSnapshot(`
      {
        "results": {
          "v1": "signer",
          "v2": "signer",
          "v2 in ERC-6492": "signer",
          "v2 in ERC-8010": "signer",
          "v2 in ERC-8010 in ERC-6492": "signer",
        },
        "sent": [],
      }
    `)
  })

  test("refuses an access key's keychain envelope in a form other than a hex string before any request", async () => {
    // The chain answers each call with `true`, as an account's code that accepts any signature.
    const { sent, transport } = node({ answer: () => one })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const attempt = async (form: (signature: `0x${string}`) => unknown) => {
      const { id, message } = await start(accounts)
      const signature = await keychain({
        address: account.address,
        message,
        version: 'v2',
      })
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          // A request's body can hold any JSON value, which the type does not refuse.
          signature: form(signature) as `0x${string}`,
        })
        .then(reason, reason)
    }

    const results = {
      'byte array': await attempt((signature) => [...hexToBytes(signature)]),
      bytes: await attempt(hexToBytes),
      'upper case prefix': await attempt(
        (signature) => `0X${signature.slice(2)}`,
      ),
    }

    expect({ results, sent }).toMatchInlineSnapshot(`
      {
        "results": {
          "byte array": "signer",
          "bytes": "signer",
          "upper case prefix": "signer",
        },
        "sent": [],
      }
    `)
  })

  test("refuses an access key's pre-authorized signature before any request, also in a wrapper and one that does not parse", async () => {
    // The chain answers each call with `true`, as an account's code that accepts any signature.
    const { sent, transport } = node({ answer: () => one })
    const { accounts } = instance({ transport })
    const root = Account.fromSecp256k1(generatePrivateKey())
    const privateKey = generatePrivateKey()
    // An access key with a pending key authorization signs with the authorization (TIP-1165).
    const accessKey = Account.fromSecp256k1(privateKey, {
      access: root,
      keyAuthorization: await root.signKeyAuthorization(
        Account.fromSecp256k1(privateKey, { access: root }),
        { chainId: 4217n },
      ),
    })
    const attempt = async (
      form: (signature: `0x${string}`) => `0x${string}` = (signature) =>
        signature,
    ) => {
      const { id, message } = await start(accounts)
      const signature = await accessKey.signMessage({ message })
      return accounts.siwe
        .complete({
          address: root.address,
          id,
          message,
          signature: form(signature),
        })
        .then(reason, reason)
    }

    const results = {
      'in ERC-6492': await attempt((signature) =>
        SignatureErc6492.wrap({
          data: '0x',
          signature,
          to: '0x0000000000000000000000000000000000000001',
        }),
      ),
      'that does not parse': await attempt(() =>
        concat([one, SignaturePreAuthorized.magicBytes]),
      ),
      'that parses': await attempt((signature) => {
        SignaturePreAuthorized.assert(signature)
        return signature
      }),
    }

    expect({ results, sent }).toMatchInlineSnapshot(`
      {
        "results": {
          "in ERC-6492": "signer",
          "that does not parse": "signer",
          "that parses": "signer",
        },
        "sent": [],
      }
    `)
  })

  test('refuses a wrapper that does not parse before any request', async () => {
    const { sent, transport } = node({ answer: () => one })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const attempt = async (magicBytes: `0x${string}`) => {
      const { id, message } = await start(accounts)
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          signature: concat(['0x00', magicBytes]),
        })
        .then(reason, reason)
    }

    const results = [
      await attempt(SignatureErc6492.magicBytes),
      await attempt(SignatureErc8010.magicBytes),
    ]

    expect({ results, sent }).toMatchInlineSnapshot(`
      {
        "results": [
          "signer",
          "signer",
        ],
        "sent": [],
      }
    `)
  })

  test('refuses a WebAuthn envelope above its size limit before any request, also in a wrapper', async () => {
    const { sent, transport } = node({ answer: () => one })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const envelope = `0x02${'11'.repeat(32_000)}` as const
    const attempt = async (signature: `0x${string}`) => {
      const { id, message } = await start(accounts, {
        address: account.address,
      })
      return accounts.siwe
        .complete({ address: account.address, id, message, signature })
        .then(reason, reason)
    }

    const results = [
      await attempt(`0x02${'11'.repeat(2049)}`),
      await attempt(envelope),
      await attempt(
        SignatureErc6492.wrap({
          data: '0x',
          signature: envelope,
          to: '0x0000000000000000000000000000000000000001',
        }),
      ),
    ]

    expect({ results, sent }).toMatchInlineSnapshot(`
      {
        "results": [
          "signer",
          "signer",
          "signer",
        ],
        "sent": [],
      }
    `)
  })

  test('refuses a signature in more than two wrappers before any request', async () => {
    const { sent, transport } = node({ answer: () => one })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const attempt = async (wrappers: number) => {
      const { id, message } = await start(accounts, {
        address: account.address,
      })
      const signature = await account.signMessage({ message })
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          signature: Array.from({ length: wrappers }).reduce<`0x${string}`>(
            (signature) =>
              SignatureErc6492.wrap({
                data: '0x',
                signature,
                to: '0x0000000000000000000000000000000000000001',
              }),
            signature,
          ),
        })
        .then(reason, reason)
    }

    const result = await attempt(3)

    expect({ result, sent }).toMatchInlineSnapshot(`
      {
        "result": "signer",
        "sent": [],
      }
    `)
  })

  test('signs an owner key in on a chain without configurable accounts', async () => {
    // A chain without the precompile holds no code at its address, so the read returns no data.
    const { sent, transport } = node({
      answer: (to) => (to === accountConfiguration ? '0x' : undefined),
    })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const attempt = async (signer: typeof account) => {
      const { id, message } = await start(accounts)
      return accounts.siwe
        .complete({
          address: account.address,
          id,
          message,
          signature: await signer.signMessage({ message }),
        })
        .then(reason, reason)
    }

    const signed = await attempt(account)
    const requests = [...sent]
    const refused = await attempt(other)

    expect({ refused, requests, signed }).toMatchInlineSnapshot(`
      {
        "refused": "signer",
        "requests": [
          "eth_call 0xaacc000000000000000000000000000000000000",
        ],
        "signed": "verified",
      }
    `)
  })

  test("rejects with the transport's error, and stores no session, if the chain does not answer", async () => {
    const { transport } = node({ answer: () => undefined })
    const { accounts } = instance({ transport })
    const account = privateKeyToAccount(generatePrivateKey())
    const { id, message } = await start(accounts)

    const error = await accounts.siwe
      .complete({
        address: account.address,
        id,
        message,
        signature: await account.signMessage({ message }),
      })
      .then(
        () => undefined,
        (error: Error) => error.name,
      )
    const stored = await accounts.backend.get({ id })

    expect({ error, stored }).toMatchInlineSnapshot(`
      {
        "error": "ContractFunctionExecutionError",
        "stored": undefined,
      }
    `)
  })

  test('refuses an expired challenge', async () => {
    const { accounts, store } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const { id, message } = await start(accounts)
    await store.setItem(`tempo-id:challenge:${id}`, {
      expiresAt: Date.now() - 1,
      message,
    })

    const result = await accounts.siwe
      .complete({
        address: account.address,
        id,
        message,
        signature: await account.signMessage({ message }),
      })
      .then(reason, reason)

    expect(result).toMatchInlineSnapshot(`"challenge"`)
  })
})

describe('siwe sessions', () => {
  test('serve session.get(request), end at their expiry, end without a request, and send no request with session.fetch(request)', async () => {
    const { accounts } = instance({ lifetime: 200 })
    const account = privateKeyToAccount(generatePrivateKey())
    const [expiring, ended] = await Promise.all([
      signIn(accounts, account),
      signIn(accounts, account),
    ])
    const request = new Request(origin, {
      headers: { cookie: `__Host-tempo-id.sid=${ended.id}` },
    })

    const read = await accounts.session.get(request)
    const response = await accounts.session.fetch(request, {
      url: 'http://127.0.0.1:9/me',
    })
    await accounts.backend.end({ id: ended.id })

    expect({
      address: read?.method === 'siwe' && read.address === account.address,
      method: read?.method,
      response,
    }).toMatchInlineSnapshot(`
      {
        "address": true,
        "method": "siwe",
        "response": undefined,
      }
    `)
    expect(await accounts.backend.get({ id: ended.id })).toMatchInlineSnapshot(
      `undefined`,
    )
    await expect
      .poll(() => accounts.backend.get({ id: expiring.id }), { timeout: 2_000 })
      .toBeUndefined()
  })

  test('throw at the creation of an instance without the backend plugin', () => {
    const error = (() => {
      try {
        Accounts.create({ clientId: origin, plugins: [siwe()] })
        return undefined
      } catch (error) {
        return (error as Error).message
      }
    })()

    expect(error).toMatchInlineSnapshot(
      `"Invalid plugins: the siwe plugin stores its sessions with the backend plugin, which \`plugins\` lacks. Add \`backend({ store })\` or \`backend({ remote })\` beside it."`,
    )
  })
})

describe('siwe.approve', () => {
  test("verifies the session's account's signature of a change once", async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, account)
    const change = {
      resources: [`${origin}/v1/notes/1?action=delete`],
      statement: 'Delete note 1.',
    }

    const { message } = await accounts.siwe.challenge({
      ...change,
      request: new Request(`${origin}/v1/notes/1/challenge`),
      session,
    })
    const signature = await account.signMessage({ message })
    const approved = await accounts.siwe
      .approve({
        ...change,
        request: new Request(origin),
        message,
        session,
        signature,
      })
      .then(reason, reason)
    const replay = await accounts.siwe
      .approve({
        ...change,
        request: new Request(origin),
        message,
        session,
        signature,
      })
      .then(reason, reason)
    const {
      expirationTime,
      issuedAt,
      nonce: _,
      ...fields
    } = parseSiweMessage(message)

    expect({ approved, replay }).toMatchInlineSnapshot(`
      {
        "approved": "verified",
        "replay": "challenge",
      }
    `)
    expect({
      ...fields,
      address: fields.address === account.address,
      lifetime: expirationTime!.getTime() - issuedAt!.getTime(),
    }).toMatchInlineSnapshot(`
      {
        "address": true,
        "chainId": 4217,
        "domain": "app.example.com",
        "lifetime": 300000,
        "resources": [
          "https://app.example.com/v1/notes/1?action=delete",
        ],
        "statement": "Delete note 1.",
        "uri": "https://app.example.com",
        "version": "1",
      }
    `)
  })

  test('refuses the retired root key of a session whose account was upgraded in place', async () => {
    let commitment: `0x${string}` = zero
    const { sent, transport } = node({
      answer: (to) => (to === accountConfiguration ? commitment : undefined),
    })
    const { accounts } = instance({ transport })
    const root = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, root)
    const change = { request: new Request(origin), statement: 'Delete note 1.' }
    const attempt = async () => {
      const { message } = await accounts.siwe.challenge({ ...change, session })
      return accounts.siwe
        .approve({
          ...change,
          message,
          session,
          signature: await root.signMessage({ message }),
        })
        .then(reason, reason)
    }

    const before = await attempt()
    commitment = one
    const after = await attempt()

    expect({ after, before, sent }).toMatchInlineSnapshot(`
      {
        "after": "signer",
        "before": "verified",
        "sent": [
          "eth_call 0xaacc000000000000000000000000000000000000",
          "eth_call 0xaacc000000000000000000000000000000000000",
          "eth_call 0xaacc000000000000000000000000000000000000",
        ],
      }
    `)
  })

  test('refuses another change, and spends the approval', async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, account)
    const change = {
      resources: [`${origin}/v1/notes/1?action=delete`],
      statement: 'Delete note 1.',
    }
    const { message } = await accounts.siwe.challenge({
      ...change,
      request: new Request(origin),
      session,
    })
    const signature = await account.signMessage({ message })

    const results = [
      await accounts.siwe
        .approve({
          request: new Request(origin),
          message,
          resources: [`${origin}/v1/notes/2?action=delete`],
          session,
          signature,
          statement: change.statement,
        })
        .then(reason, reason),
      await accounts.siwe
        .approve({
          ...change,
          request: new Request(origin),
          message,
          session,
          signature,
        })
        .then(reason, reason),
    ]

    expect(results).toMatchInlineSnapshot(`
      [
        "message",
        "challenge",
      ]
    `)
  })

  test("refuses a message other than the challenge's under its nonce, also when the account signs it", async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, account)
    const change = { statement: 'Delete note 1.' }
    const { message } = await accounts.siwe.challenge({
      ...change,
      request: new Request(origin),
      session,
    })
    // The same nonce under a later expiry, which the account signs.
    const forged = message.replace(
      /Expiration Time: .*/,
      'Expiration Time: 2100-01-01T00:00:00.000Z',
    )

    const result = await accounts.siwe
      .approve({
        request: new Request(origin),
        ...change,
        message: forged,
        session,
        signature: await account.signMessage({ message: forged }),
      })
      .then(reason, reason)

    expect({ forged: forged !== message, result }).toMatchInlineSnapshot(`
      {
        "forged": true,
        "result": "message",
      }
    `)
  })

  test("refuses another session's approval, and another account's signature", async () => {
    const { accounts } = instance()
    const owner = privateKeyToAccount(generatePrivateKey())
    const other = privateKeyToAccount(generatePrivateKey())
    const [session, intruder] = await Promise.all([
      signIn(accounts, owner),
      signIn(accounts, other),
    ])
    const change = { statement: 'Delete note 1.' }
    const [first, second] = await Promise.all(
      [1, 2].map(() =>
        accounts.siwe.challenge({
          ...change,
          request: new Request(origin),
          session,
        }),
      ),
    )

    const results = [
      // The approval of `session`, which another session's cookie presents with its own signature.
      await accounts.siwe
        .approve({
          request: new Request(origin),
          ...change,
          message: first!.message,
          session: intruder,
          signature: await other.signMessage({ message: first!.message }),
        })
        .then(reason, reason),
      await accounts.siwe
        .approve({
          request: new Request(origin),
          ...change,
          message: second!.message,
          session,
          signature: await other.signMessage({ message: second!.message }),
        })
        .then(reason, reason),
    ]

    expect(results).toMatchInlineSnapshot(`
      [
        "challenge",
        "signer",
      ]
    `)
  })

  test("refuses a message of another origin than the request's, such as an alias that shares the store", async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, account)
    const alias = 'https://alias.example.com'
    const change = { statement: 'Delete note 1.' }
    const { message } = await accounts.siwe.challenge({
      ...change,
      request: new Request(alias),
      session,
    })
    const signature = await account.signMessage({ message })

    const results = [
      await accounts.siwe
        .approve({
          ...change,
          message,
          request: new Request(origin),
          session,
          signature,
        })
        .then(reason, reason),
      await accounts.siwe
        .approve({
          ...change,
          message,
          request: new Request(alias),
          session,
          signature,
        })
        .then(reason, reason),
    ]

    expect(results).toMatchInlineSnapshot(`
      [
        "message",
        "verified",
      ]
    `)
  })

  test('refuses a long message that names no challenge without parsing it, and keeps the approval', async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, account)
    const change = { statement: 'Delete note 1.' }
    const { message } = await accounts.siwe.challenge({
      ...change,
      request: new Request(origin),
      session,
    })
    const signature = await account.signMessage({ message })

    const start = performance.now()
    const refused = await accounts.siwe
      .approve({
        ...change,
        message: 'URI: '.repeat(200_000),
        request: new Request(origin),
        session,
        signature: '0x00',
      })
      .then(reason, reason)
    const elapsed = performance.now() - start
    const approved = await accounts.siwe
      .approve({
        ...change,
        message,
        request: new Request(origin),
        session,
        signature,
      })
      .then(reason, reason)

    expect({ approved, fast: elapsed < 1_000, refused }).toMatchInlineSnapshot(`
      {
        "approved": "verified",
        "fast": true,
        "refused": "challenge",
      }
    `)
  })

  test("refuses an approval's challenge as a sign-in under a session ID that names it", async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const session = await signIn(accounts, account)
    const change = { request: new Request(origin), statement: 'Delete note 1.' }
    const { message } = await accounts.siwe.challenge({ ...change, session })
    const signature = await account.signMessage({ message })

    const signedIn = await accounts.siwe
      .complete({
        address: account.address,
        id: `${session.id}:${parseSiweMessage(message).nonce}`,
        message,
        signature,
      })
      .then(reason, reason)
    const approved = await accounts.siwe
      .approve({ ...change, message, session, signature })
      .then(reason, reason)

    expect({ approved, signedIn }).toMatchInlineSnapshot(`
      {
        "approved": "verified",
        "signedIn": "challenge",
      }
    `)
  })

  test('serves a Tempo ID session that names an account, and refuses one that names none', async () => {
    const { accounts } = instance()
    const account = privateKeyToAccount(generatePrivateKey())
    const [named, anonymous] = await Promise.all(
      [{ address: account.address }, {}].map(async (fields) => {
        const { id } = await accounts.backend.save({
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            user: { email: 'user@example.com', id: 'user_1' },
            ...fields,
          }),
        })
        return (await accounts.backend.get({ id }))!
      }),
    )
    const change = { request: new Request(origin), statement: 'Delete note 1.' }

    const { message } = await accounts.siwe.challenge({
      ...change,
      session: named!,
    })
    const approved = await accounts.siwe
      .approve({
        request: new Request(origin),
        message,
        session: named!,
        signature: await account.signMessage({ message }),
        statement: change.statement,
      })
      .then(reason, reason)
    const refused = await accounts.siwe
      .challenge({ ...change, session: anonymous! })
      .then(reason, reason)

    expect({ approved, refused }).toMatchInlineSnapshot(`
      {
        "approved": "verified",
        "refused": "account",
      }
    `)
  })
})

/**
 * Returns an instance with `siwe` beside `backend`, and its store, at a URL where nothing listens.
 * Its chain is the one of `transport`. Defaults to a chain whose accounts hold no config commitment.
 */
function instance(
  options: siwe.Options & { transport?: Transport | undefined } = {},
) {
  const { transport = node().transport, ...rest } = options
  const store = Store.memory()
  const accounts = Accounts.create({
    chain: 4217,
    clientId: origin,
    plugins: [backend({ store }), siwe(rest), viem({ transport })],
    url: 'http://127.0.0.1:9',
  })
  return { accounts, store }
}

/**
 * Returns the transport of a scripted chain, and the requests that it receives, each as its method
 * and the address that it calls. The chain answers an `eth_call` with the result of `answer` for
 * the called address, which a call that deploys its own code lacks, and no other request. Defaults
 * to a config commitment of zero for each account, and no answer of another call.
 */
function node(
  options: {
    answer?: ((to: string | undefined) => `0x${string}` | undefined) | undefined
  } = {},
) {
  const { answer = (to) => (to === accountConfiguration ? zero : undefined) } =
    options
  const sent: string[] = []
  const transport = custom(
    {
      request(args: { method: string; params?: unknown }) {
        const [call] = (args.params ?? []) as [{ to?: string }?]
        const to = call?.to?.toLowerCase()
        sent.push(to ? `${args.method} ${to}` : args.method)

        const result = args.method === 'eth_call' ? answer(to) : undefined
        if (result === undefined)
          return Promise.reject(new Error('No node listens.'))
        return Promise.resolve(result)
      },
    },
    { retryCount: 0 },
  )
  return { sent, transport }
}

/**
 * Returns the keychain envelope of an access key's signature of `message` for `address`: the
 * access key signs the message's hash in `v1`, and the hash bound to the account in `v2`.
 */
async function keychain(options: {
  address: `0x${string}`
  message: string
  version: 'v1' | 'v2'
}) {
  const { address, message, version } = options
  const hash = hashMessage(message)
  const { r, s, yParity } = await sign({
    hash: version === 'v2' ? keccak256(concat(['0x04', hash, address])) : hash,
    privateKey: generatePrivateKey(),
  })

  return SignatureEnvelope.serialize({
    inner: {
      signature: { r: BigInt(r), s: BigInt(s), yParity: yParity! },
      type: 'secp256k1',
    },
    type: 'keychain',
    userAddress: address,
    version,
  })
}

/** Starts a sign-in of the request at the app's challenge route. */
function start(
  accounts: ReturnType<typeof instance>['accounts'],
  options: { address?: `0x${string}` | undefined } = {},
) {
  return accounts.siwe.start({
    ...options,
    request: new Request(`${origin}/api/siwe/challenge`),
  })
}

/** Signs `account` in, and returns its SIWE session. */
async function signIn(
  accounts: ReturnType<typeof instance>['accounts'],
  account: ReturnType<typeof privateKeyToAccount>,
) {
  const { id, message } = await start(accounts)
  return accounts.siwe.complete({
    address: account.address,
    id,
    message,
    signature: await account.signMessage({ message }),
  })
}

/** Returns the `reason` of a refusal, or `verified` for a result. Rethrows any other error. */
function reason(value: unknown) {
  if (value instanceof Error) {
    if (value.name !== 'Plugins.siwe.InvalidError') throw value
    return (value as Error & { reason: string }).reason
  }
  return 'verified'
}
