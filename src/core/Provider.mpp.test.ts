import { Challenge, Credential } from 'mppx'
import { Mppx } from 'mppx/client'
import { Hex } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { Account as TempoAccount, Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import { afterEach, describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
import type * as Account from './Account.js'
import type * as Adapter from './Adapter.js'
import { local } from './adapters/local.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const rootAddress = accounts[0]!.address

afterEach(() => Mppx.restore())

describe('mpp_authorize', () => {
  test('error: rejects non-Tempo challenges', async () => {
    const provider = createProvider()

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [createChallenge({ intent: 'charge', method: 'stripe' })],
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Only Tempo payment challenges are supported.]`,
    )
  })

  test('error: rejects session continuation with multiple challenges', async () => {
    const provider = createProvider()

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({ intent: 'session', method: 'tempo' }),
              createChallenge({ intent: 'session', method: 'tempo' }),
            ],
            session: {
              action: 'voucher',
              authorizedSigner: rootAddress,
              channelId: '0x01',
              cumulativeAmount: '1',
            },
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`session\` can only be used with one challenge.]`,
    )
  })

  test('error: rejects session channel mismatch', async () => {
    const provider = createProvider()

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({
                intent: 'session',
                method: 'tempo',
                request: { methodDetails: { channelId: '0x02' } },
              }),
            ],
            session: {
              action: 'close',
              authorizedSigner: rootAddress,
              channelId: '0x01',
              cumulativeAmount: '1',
            },
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`session.channelId\` conflicts with the payment challenge.]`,
    )
  })

  test('behavior: authorizes charge without recursive mpp_authorize', async () => {
    const provider = createProvider({ account: accounts[0]! })
    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'charge',
              method: 'tempo',
              request: {
                amount: '0',
                currency: Addresses.pathUsd,
                methodDetails: { chainId: tempoLocalnet.id },
                recipient: accounts[1]!.address,
              },
            }),
          ],
        },
      ],
    })

    const credential = Credential.deserialize(result.authorization)
    const payload = credential.payload as { type?: string | undefined }
    expect({
      challenge: credential.challenge.id,
      payloadType: payload.type,
      source: credential.source,
    }).toMatchInlineSnapshot(`
      {
        "challenge": "tempo-charge",
        "payloadType": "proof",
        "source": "did:pkh:eip155:1337:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('behavior: authorizes session continuation with root signer', async () => {
    const provider = createProvider({ account: accounts[0]! })
    const channelId = Hex.padLeft('0x01', 32)
    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'session',
              method: 'tempo',
              request: {
                amount: '1',
                currency: Addresses.pathUsd,
                methodDetails: {
                  chainId: tempoLocalnet.id,
                  channelId,
                  escrowContract: accounts[2]!.address,
                },
                recipient: accounts[1]!.address,
              },
            }),
          ],
          session: {
            action: 'voucher',
            authorizedSigner: rootAddress,
            channelId,
            cumulativeAmount: '1',
          },
        },
      ],
    })

    const credential = Credential.deserialize(result.authorization)
    const payload = credential.payload as {
      action?: string | undefined
      channelId?: string | undefined
      cumulativeAmount?: string | undefined
      signature?: string | undefined
    }
    const { signature: _signature, ...payload_ } = payload
    expect({
      payload: payload_,
      source: credential.source,
    }).toMatchInlineSnapshot(`
      {
        "payload": {
          "action": "voucher",
          "channelId": "0x0000000000000000000000000000000000000000000000000000000000000001",
          "cumulativeAmount": "1",
        },
        "source": "did:pkh:eip155:1337:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('behavior: authorizes with access key before root signer', async () => {
    const provider = createProvider({
      account: { address: rootAddress },
    })
    const account = TempoAccount.fromSecp256k1(privateKeys[2]!, { access: rootAddress })
    const keyAuthorization = KeyAuthorization.from({
      address: account.accessKeyAddress,
      chainId: BigInt(tempoLocalnet.id),
      signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`),
      type: 'secp256k1',
    })
    AccessKey.add({
      account: rootAddress,
      authorization: keyAuthorization,
      privateKey: privateKeys[2]!,
      store: provider.store,
    })

    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'charge',
              method: 'tempo',
              request: {
                amount: '0',
                currency: Addresses.pathUsd,
                methodDetails: { chainId: tempoLocalnet.id },
                recipient: accounts[1]!.address,
              },
            }),
          ],
        },
      ],
    })

    const credential = Credential.deserialize(result.authorization)
    const payload = credential.payload as { type?: string | undefined }
    expect({
      payloadType: payload.type,
      source: credential.source,
    }).toMatchInlineSnapshot(`
      {
        "payloadType": "proof",
        "source": "did:pkh:eip155:1337:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('error: requires a concrete signable account', async () => {
    const provider = createProvider({
      account: { address: rootAddress },
    })

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({
                intent: 'charge',
                method: 'tempo',
                request: {
                  amount: '1',
                  currency: Addresses.pathUsd,
                  methodDetails: { chainId: tempoLocalnet.id },
                  recipient: accounts[1]!.address,
                },
              }),
            ],
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" cannot sign.]`,
    )
  })
})

function createProvider(
  options: { account?: Account.Store | undefined; adapter?: Adapter.Adapter | undefined } = {},
) {
  const provider = Provider.create({
    adapter:
      options.adapter ??
      local({
        loadAccounts: async () => ({ accounts: [] }),
      }),
    mpp: { polyfill: false },
    storage: Storage.memory(),
  })
  provider.store.setState({
    accounts: [options.account ?? { address: rootAddress }],
    activeAccount: 0,
  })
  return provider
}

function createChallenge(options: {
  intent: string
  method: string
  request?: Record<string, unknown> | undefined
}) {
  const { intent, method, request = {} } = options
  return Challenge.serialize(
    Challenge.from({
      id: `${method}-${intent}`,
      intent,
      method,
      realm: 'example.test',
      request,
    }),
  )
}
