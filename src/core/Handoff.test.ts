import { describe, expect, test } from 'vp/test'

import * as Handoff from './Handoff.js'

const privateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const keyId = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const account = '0x0000000000000000000000000000000000000001'

function url(result: unknown, key = privateKey) {
  const encoded = Buffer.from(JSON.stringify(result)).toString('base64url')
  return `https://app.example/play#tempo_wallet=approved&account=${account}&result=${encoded}&private_key=${key}`
}

describe('read', () => {
  test('default: reads the result and the access key its authorization names', () => {
    expect(
      Handoff.read({
        url: url({
          accounts: [{ address: account, capabilities: { keyAuthorization: { keyId } } }],
        }),
      }),
    ).toMatchInlineSnapshot(`
      {
        "accessKey": {
          "address": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
          "keyType": "secp256k1",
          "privateKey": "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
          "publicKey": "0x04ba5734d8f7091719471e7f7ed6b9df170dc70cc661ca05e688601ad984f068b0d67351e5f06073092499336ab0839ef8a521afd334e53807205fa2f08eec74f4",
        },
        "account": "0x0000000000000000000000000000000000000001",
        "result": {
          "accounts": [
            {
              "address": "0x0000000000000000000000000000000000000001",
              "capabilities": {
                "keyAuthorization": {
                  "keyId": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
                },
              },
            },
          ],
        },
        "status": "approved",
      }
    `)
  })

  test('behavior: drops a key the result does not authorize', () => {
    expect([
      Handoff.read({ url: url({ accounts: [{ address: account, capabilities: {} }] }) })?.accessKey,
      Handoff.read({
        url: url({
          accounts: [
            {
              address: account,
              capabilities: {
                keyAuthorization: { keyId: '0x0000000000000000000000000000000000000002' },
              },
            },
          ],
        }),
      })?.accessKey,
      Handoff.read({ url: url({ keyAuthorization: { keyId }, rootAddress: account }) })?.accessKey
        ?.address,
    ]).toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      ]
    `)
  })

  test('behavior: other pages and malformed values', () => {
    expect([
      Handoff.read({ url: 'https://app.example/#foo=bar' }),
      Handoff.read({ url: 'https://app.example/#tempo_wallet=rejected' }),
      Handoff.read({
        url: 'https://app.example/#tempo_wallet=approved&account=nope&result=%%%&private_key=0x01',
      }),
    ]).toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        {
          "accessKey": undefined,
          "account": undefined,
          "result": undefined,
          "status": "approved",
        },
      ]
    `)
  })
})
