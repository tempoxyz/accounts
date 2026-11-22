/**
 * Tests of the ownership of a pending redirect.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Verifier from './Verifier.js'

describe('Verifier.owns', () => {
  test('refuses the redirect of another Tempo ID deployment with the same app and chain, and a redirect of an earlier version, which names no issuer', () => {
    const auth = Accounts.from({
      chain: 42431,
      clientId: 'tempo-example-web',
      url: 'https://id.example',
    })
    const pending = { chainId: 42431, clientId: 'tempo-example-web' }

    expect({
      earlier: Verifier.owns(auth, pending),
      legacy: Verifier.owns(auth, {}),
      other: Verifier.owns(auth, {
        ...pending,
        issuer: 'https://id.other.example',
      }),
      own: Verifier.owns(auth, {
        ...pending,
        issuer: 'https://id.example',
      }),
    }).toMatchInlineSnapshot(`
      {
        "earlier": false,
        "legacy": false,
        "other": false,
        "own": true,
      }
    `)
  })
})
