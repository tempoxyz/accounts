import { describe, expect, test } from 'vp/test'

import * as ExecutionError from './ExecutionError.js'

// ABI-encoded revert data fixtures.
const insufficientBalanceData =
  '0x832f98b500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000020c0000000000000000000000000000000000001' as const
const unauthorizedData = '0x82b42900' as const
const tokenAlreadyExistsData =
  '0x15ef3a5700000000000000000000000020c0000000000000000000000000000000000001' as const

describe('parse', () => {
  test('decodes InsufficientBalance from revert data', () => {
    const error = Object.assign(new Error('reverted'), {
      data: insufficientBalanceData,
    })
    const result = ExecutionError.parse(error)
    expect(result).toMatchInlineSnapshot(`
    	{
    	  "abiItem": {
    	    "inputs": [
    	      {
    	        "name": "available",
    	        "type": "uint256",
    	      },
    	      {
    	        "name": "required",
    	        "type": "uint256",
    	      },
    	      {
    	        "name": "token",
    	        "type": "address",
    	      },
    	    ],
    	    "name": "InsufficientBalance",
    	    "type": "error",
    	  },
    	  "args": [
    	    0n,
    	    100000000n,
    	    "0x20C0000000000000000000000000000000000001",
    	  ],
    	  "data": "0x832f98b500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000020c0000000000000000000000000000000000001",
    	  "errorName": "InsufficientBalance",
    	  "message": "Insufficient balance. Required: 100000000, available: 0.",
    	}
    `)
  })

  test('decodes Unauthorized (no args)', () => {
    const error = Object.assign(new Error('reverted'), {
      data: unauthorizedData,
    })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('Unauthorized')
    expect(result.message).toBe('Unauthorized.')
  })

  test('decodes TokenAlreadyExists with templated message', () => {
    const error = Object.assign(new Error('reverted'), {
      data: tokenAlreadyExistsData,
    })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('TokenAlreadyExists')
    expect(result.message).toBe('Token 0x20C0000000000000000000000000000000000001 already exists.')
  })

  test('extracts revert data from nested cause', () => {
    const inner = Object.assign(new Error('inner'), {
      data: unauthorizedData,
    })
    const error = Object.assign(new Error('outer'), { cause: inner })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('Unauthorized')
  })

  test('extracts revert data from nested error property', () => {
    const inner = Object.assign(new Error('inner'), {
      data: insufficientBalanceData,
    })
    const error = Object.assign(new Error('outer'), { error: inner })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('InsufficientBalance')
  })

  test('extracts revert data via walk method', () => {
    const inner = { data: unauthorizedData }
    const error = Object.assign(new Error('walkable'), {
      walk: (fn: (e: unknown) => boolean) => (fn(inner) ? inner : null),
    })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('Unauthorized')
  })

  test('fallback: extracts error name from human-readable revert message', () => {
    const error = new Error('execution reverted: Unauthorized(something)')
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('unknown')
    expect(result.message).toBe('Unauthorized.')
  })

  test('fallback: uses details property', () => {
    const error = Object.assign(new Error('ignored'), {
      details: 'execution reverted: Unauthorized(x)',
    })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('unknown')
    expect(result.message).toBe('Unauthorized.')
  })

  test('fallback: uses shortMessage property', () => {
    const error = Object.assign(new Error('ignored'), {
      shortMessage: 'execution reverted: Unauthorized(x)',
    })
    const result = ExecutionError.parse(error)
    expect(result.errorName).toBe('unknown')
    expect(result.message).toBe('Unauthorized.')
  })

  test('unknown error: returns raw message', () => {
    const error = new Error('something went wrong')
    const result = ExecutionError.parse(error)
    expect(result.message).toBe('something went wrong')
    expect(result.errorName).toBe('unknown')
  })

  test('unknown error: strips "execution reverted:" prefix', () => {
    const error = new Error('execution reverted: mystery failure')
    const result = ExecutionError.parse(error)
    expect(result.message).toBe('mystery failure')
  })

  test('undecodable revert data falls back to raw message', () => {
    const error = Object.assign(new Error('bad revert'), {
      data: '0xdeadbeef',
    })
    const result = ExecutionError.parse(error)
    expect(result.message).toBe('bad revert')
    expect(result.errorName).toBe('unknown')
  })
})

describe('serialize', () => {
  test('serializes InsufficientBalance', () => {
    const parsed = ExecutionError.parse(
      Object.assign(new Error(''), { data: insufficientBalanceData }),
    )
    const serialized = ExecutionError.serialize(parsed)
    expect(serialized).toMatchInlineSnapshot(`
      {
        "abiItem": {
          "inputs": [
            {
              "name": "available",
              "type": "uint256",
            },
            {
              "name": "required",
              "type": "uint256",
            },
            {
              "name": "token",
              "type": "address",
            },
          ],
          "name": "InsufficientBalance",
          "type": "error",
        },
        "data": "0x832f98b500000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000005f5e10000000000000000000000000020c0000000000000000000000000000000000001",
        "errorName": "InsufficientBalance",
        "message": "Insufficient balance. Required: 100000000, available: 0.",
      }
    `)
  })

  test('serializes unknown error', () => {
    const parsed = ExecutionError.parse(new Error('boom'))
    const serialized = ExecutionError.serialize(parsed)
    expect(serialized).toMatchInlineSnapshot(`
      {
        "errorName": "unknown",
        "message": "boom",
      }
    `)
  })

  test('serializes error with no args', () => {
    const parsed = ExecutionError.parse(Object.assign(new Error(''), { data: unauthorizedData }))
    const serialized = ExecutionError.serialize(parsed)
    expect(serialized.errorName).toBe('Unauthorized')
  })
})

describe('messages', () => {
  test('all messages end with a period', () => {
    for (const [name, msg] of Object.entries(ExecutionError.messages))
      expect(msg, `${name} message should end with "."`).toMatch(/\.$/)
  })

  test('templated messages contain placeholders', () => {
    expect(ExecutionError.messages.InsufficientBalance).toContain('{0}')
    expect(ExecutionError.messages.InsufficientBalance).toContain('{1}')
    expect(ExecutionError.messages.TokenAlreadyExists).toContain('{0}')
  })
})
