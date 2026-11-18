/**
 * Tests the account of a session on one chain, for a session that holds access keys on several
 * chains.
 * @module
 */
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account } from 'viem/tempo'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as AccessKey from './AccessKey.js'
import * as Signer from './Signer.js'
import * as TempoAccount from './TempoAccount.js'

const owner = Account.fromSecp256k1(
  '0x0123456789012345678901234567890123456789012345678901234567890123',
)

const config = Accounts.from({
  chain: 4217,
  clientId: 'https://app.example.com',
  url: 'http://127.0.0.1:9',
})

describe('fromSession', () => {
  test('signs with the live access key of another chain on that chain', async () => {
    const session = {
      accessKey: await createAccessKey({ chainId: 4217, expired: true }),
      accessKeys: [await createAccessKey({ chainId: 42431 })],
    }

    const account = Signer.fromSession(config, session, {
      chainId: 42431,
      signer: 'accessKey',
    })

    expect(account?.source).toMatchInlineSnapshot(`"accessKey"`)
  })

  test('rejects a transaction with AccessKeyRequiredError for an expired access key on the chain, beside a live one on another chain, and names its account', async () => {
    const session = {
      accessKey: await createAccessKey({ chainId: 4217, expired: true }),
      accessKeys: [await createAccessKey({ chainId: 42431 })],
    }

    const account = Signer.fromSession(config, session, {
      chainId: 4217,
      signer: 'accessKey',
    })
    const error = await account
      ?.signTransaction({ chainId: 4217 } as never)
      .catch((error: unknown) => error)

    expect(account?.address === owner.address).toMatchInlineSnapshot(`true`)
    expect(error).toBeInstanceOf(Accounts.AccessKeyRequiredError)
  })

  test('signs a message with the access key in a keychain envelope with `fallback`, without a read of the chain', async () => {
    const session = { accessKey: await createAccessKey({ chainId: 4217 }) }

    const signature = await Signer.fromSession(config, session, {
      chainId: 4217,
      signer: 'fallback',
    })?.signMessage({ message: 'hello' })

    expect(
      SignatureEnvelope.deserialize(signature!).type,
    ).toMatchInlineSnapshot(`"keychain"`)
  })

  test("reads the account of an expired parked access key's chain for its owner, not the session's account of the instance's chain", async () => {
    const config = Accounts.from({
      chain: 42431,
      clientId: 'https://app.example.com',
      url: 'http://127.0.0.1:9',
    })
    // The session switched to 42431, without an access key there, and holds 42431's account. Its
    // access key on 4217 is parked and expired, so the owner signs there.
    const session = {
      accessKeys: [await createAccessKey({ chainId: 4217, expired: true })],
      account: TempoAccount.deserialize({
        address: owner.address,
        keys: [],
        owner: 'secp256k1',
        realm: { id: 'default', name: 'Tempo' },
      }),
    }

    // Nothing listens at Tempo ID's URL, so the read of the account rejects with a network error.
    const errors = await Promise.all(
      [4217, 31318].map(async (chainId) =>
        Signer.fromSession(config, session, {
          chainId,
          signer: 'fallback',
        })
          ?.signMessage({ message: 'hello' })
          .catch((error: unknown) => error),
      ),
    )

    expect(errors).toMatchInlineSnapshot(`
      [
        [TypeError: fetch failed],
        [TypeError: fetch failed],
      ]
    `)
  })
})

/** Returns an access key of the owner's account on `options.chainId`, with its private key. */
async function createAccessKey(options: {
  chainId: number
  expired?: boolean | undefined
}) {
  const privateKey =
    '0x0123456789012345678901234567890123456789012345678901234567890124'
  const accessKey = Account.fromSecp256k1(privateKey)
  const authorization = await owner.signKeyAuthorization(
    { address: accessKey.address, type: 'secp256k1' },
    {
      chainId: BigInt(options.chainId),
      ...(options.expired ? { expiry: 1 } : {}),
    },
  )
  return AccessKey.from({
    account: owner.address,
    chainId: options.chainId,
    keyAuthorization: KeyAuthorization.toRpc(authorization),
    privateKey,
  })
}
