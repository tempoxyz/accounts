import { http, type Chain, type Transport } from 'viem'
import { tempo, tempoModerato } from 'viem/chains'
import { describe, expectTypeOf, test } from 'vp/test'

import * as Handler from './Handler.js'

describe('codeAuth options', () => {
  test('supports chain-agnostic chains/transports configuration', () => {
    expectTypeOf<Handler.codeAuth.Options>().toMatchTypeOf<{
      chains?: readonly [Chain, ...Chain[]] | undefined
      transports?: Record<number, Transport> | undefined
    }>()
  })

  test('accepts derived clients from chains/transports', () => {
    void Handler.codeAuth({
      chains: [tempo, tempoModerato],
      transports: {
        [tempo.id]: http('https://rpc.tempo.xyz'),
        [tempoModerato.id]: http('https://rpc.moderato.tempo.xyz'),
      },
    })
  })
})
