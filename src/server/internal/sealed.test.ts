import { describe, expect, test } from 'vp/test'

import * as Sealed from './sealed.js'

const secret = 'test-sealing-secret-0123456789abcdef'

describe('seal', () => {
  test('default: round-trips a payload for the same kind', async () => {
    const value = await Sealed.seal({ kind: 'a', payload: { n: 1 }, secret, ttl: 60 })
    await expect(Sealed.unseal({ kind: 'a', secret, value })).resolves.toMatchInlineSnapshot(`
      {
        "n": 1,
      }
    `)
  })

  test('behavior: rejects another kind, secret, expiry, or tampering', async () => {
    const value = await Sealed.seal({ kind: 'a', payload: 1, secret, ttl: 60 })
    const expired = await Sealed.seal({ kind: 'a', payload: 1, secret, ttl: -1 })
    const tampered = `${value.slice(0, -2)}${value.endsWith('A') ? 'BB' : 'AA'}`
    await expect(
      Promise.all([
        Sealed.unseal({ kind: 'b', secret, value }),
        Sealed.unseal({ kind: 'a', secret: `${secret}-other`, value }),
        Sealed.unseal({ kind: 'a', secret, value: expired }),
        Sealed.unseal({ kind: 'a', secret, value: tampered }),
        Sealed.unseal({ kind: 'a', secret, value: 'not-sealed' }),
      ]),
    ).resolves.toMatchInlineSnapshot(`
      [
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      ]
    `)
  })
})
