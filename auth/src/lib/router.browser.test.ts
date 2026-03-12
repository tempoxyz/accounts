import { describe, expect, test } from 'vitest'

import * as Router from './router.js'

const stubAddress = '0x0000000000000000000000000000000000000000'

describe('route validators', () => {
  test('wallet_connect: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '1', method: 'wallet_connect' },
      { method: 'wallet_connect' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"wallet_connect"`)
  })

  test('wallet_connect: accepts with capabilities', () => {
    const result = Router.validateSearch(
      {
        id: '1',
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      },
      { method: 'wallet_connect' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"wallet_connect"`)
  })

  test('eth_sendTransaction: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '2', method: 'eth_sendTransaction', params: [{ to: stubAddress }] },
      { method: 'eth_sendTransaction' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"eth_sendTransaction"`)
  })

  test('eth_sendTransactionSync: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '3', method: 'eth_sendTransactionSync', params: [{ to: stubAddress }] },
      { method: 'eth_sendTransactionSync' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"eth_sendTransactionSync"`)
  })

  test('eth_signTransaction: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '4', method: 'eth_signTransaction', params: [{ to: stubAddress }] },
      { method: 'eth_signTransaction' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"eth_signTransaction"`)
  })

  test('personal_sign: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '5', method: 'personal_sign', params: ['0xdeadbeef', stubAddress] },
      { method: 'personal_sign' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"personal_sign"`)
  })

  test('eth_signTypedData_v4: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '6', method: 'eth_signTypedData_v4', params: [stubAddress, '{}'] },
      { method: 'eth_signTypedData_v4' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"eth_signTypedData_v4"`)
  })

  test('wallet_authorizeAccessKey: accepts valid search', () => {
    const result = Router.validateSearch(
      { id: '7', method: 'wallet_authorizeAccessKey' },
      { method: 'wallet_authorizeAccessKey' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"wallet_authorizeAccessKey"`)
  })

  test('wallet_revokeAccessKey: accepts valid search', () => {
    const result = Router.validateSearch(
      {
        id: '8',
        method: 'wallet_revokeAccessKey',
        params: [{ address: stubAddress, accessKeyAddress: stubAddress }],
      },
      { method: 'wallet_revokeAccessKey' },
    )
    expect(result._decoded.method).toMatchInlineSnapshot(`"wallet_revokeAccessKey"`)
  })

  test('behavior: rejects wrong method for route', () => {
    expect(() =>
      Router.validateSearch(
        { id: '1', method: 'eth_sendTransaction', params: [{ to: stubAddress }] },
        { method: 'wallet_connect' },
      ),
    ).toThrow('Method mismatch')
  })

  test('behavior: rejects unknown method', () => {
    expect(() =>
      Router.validateSearch({ id: '1', method: 'eth_foo' }, { method: 'wallet_connect' }),
    ).toThrow('Invalid request params')
  })
})
