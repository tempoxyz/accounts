/**
 * Tests the chain IDs that the package names as constants against Viem's chain definitions.
 * @module
 */
import {
  tempo,
  tempoDevnet,
  tempoLocalnet,
  tempoTestnet,
} from 'viem/tempo/chains'
import { describe, expect, test } from 'vite-plus/test'
import * as Chains from './Chains.js'

describe('Chains', () => {
  test.each([
    ['devnet', Chains.devIds.devnet, tempoDevnet.id],
    ['localnet', Chains.devIds.localnet, tempoLocalnet.id],
    ['mainnet', Chains.ids.mainnet, tempo.id],
    ['testnet', Chains.ids.testnet, tempoTestnet.id],
  ] as const)('names the ID of %s as Viem does', (_, id, expected) => {
    expect(id).toBe(expected)
  })
})
