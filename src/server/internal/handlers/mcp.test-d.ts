import { expectTypeOf, test } from 'vp/test'

import { mcp } from './mcp.js'

test('rpc callback receives the granted chain and unchanged request', () => {
  const rpc: NonNullable<mcp.Options['rpc']> = {
    methods: ['personal_sign'],
    async request(request) {
      expectTypeOf(request.chainId).toEqualTypeOf<number>()
      expectTypeOf(request.method).toEqualTypeOf<string>()
      expectTypeOf(request.params).toEqualTypeOf<readonly unknown[] | undefined>()
      return '0x1'
    },
  }
  expectTypeOf(rpc.request).returns.toEqualTypeOf<Promise<unknown>>()
})
