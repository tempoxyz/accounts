import { custom, type EIP1193Parameters } from 'viem'
import { Addresses } from 'viem/tempo'
import { tempoModerato } from 'viem/tempo/chains'
import { describe, expect, test } from 'vp/test'

import { privateKeys, webAuthnAccounts } from '../../test/config.js'
import { local as core_local } from './adapters/local.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

describe('eth_fillTransaction', () => {
  test('behavior: forwards connected WebAuthn key type for root-account gas estimation', async () => {
    const requests: EIP1193Parameters[] = []
    const provider = Provider.create({
      adapter: core_local({
        loadAccounts: async () => ({
          accounts: [
            {
              address: webAuthnAccounts[0]!.address,
              keyType: 'webAuthn_headless',
              privateKey: privateKeys[0]!,
              origin: 'https://example.com',
              rpId: 'example.com',
            },
          ],
        }),
      }),
      chains: [tempoModerato],
      storage: Storage.memory({ key: crypto.randomUUID() }),
      transports: {
        [tempoModerato.id]: custom({
          async request(parameters) {
            requests.push(parameters)
            if (parameters.method === 'eth_chainId') return '0x1079'
            if (parameters.method === 'eth_fillTransaction') return { tx: { gas: '0x1' } }
            return null
          },
        }),
      },
    })

    const connect = await provider.request({ method: 'wallet_connect' })
    await provider.request({
      method: 'eth_fillTransaction',
      params: [
        {
          calls: [
            {
              to: Addresses.pathUsd,
              data: '0x',
            },
          ],
          feePayer: false,
          from: connect.accounts[0]!.address,
        },
      ],
    })

    const request = requests[0] as {
      method: string
      params: [
        {
          from?: unknown
          [key: string]: unknown
        },
      ]
    }
    const { from, ...param } = request.params[0]

    expect({ from: typeof from, method: request.method, param }).toMatchInlineSnapshot(`
      {
        "from": "string",
        "method": "eth_fillTransaction",
        "param": {
          "calls": [
            {
              "data": "0x",
              "to": "0x20c0000000000000000000000000000000000000",
              "value": "0x",
            },
          ],
          "chainId": "0xa5bf",
          "data": undefined,
          "feePayer": false,
          "keyType": "webAuthn",
          "to": undefined,
          "type": "0x76",
          "value": undefined,
        },
      }
    `)
  })
})
