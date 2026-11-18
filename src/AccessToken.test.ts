/**
 * Tests the configuration that `AccessToken.create` accepts, which needs no server. Tempo ID's
 * integration suite in `tempoxyz/id` verifies tokens.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as AccessToken from './AccessToken.js'

/** The origin of the issuer, which no test reaches. */
const url = 'https://id.test'

/** The registered resource of the API. */
const resource = 'https://mcp.example.com/mcp'

describe('create', () => {
  test('creates a verifier from a configuration without `clientId`, with `clientIds`', () => {
    expect(() =>
      AccessToken.create({ url }, { audience: resource, clientIds: 'any' }),
    ).not.toThrow()
  })

  test('throws for a configuration without `clientId`, and no `clientIds`', () => {
    expect(() =>
      AccessToken.create({ url }, { audience: resource }),
    ).toThrowErrorMatchingInlineSnapshot(
      `[Error: Missing \`clientIds\`: the configuration names no \`clientId\`. Name the client IDs, or set \`clientId\`.]`,
    )
  })
})
