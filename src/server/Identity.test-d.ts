import { describe, expectTypeOf, test } from 'vp/test'

import * as Identity from './Identity.js'

describe('verify', () => {
  test('resolves the verified claims', () => {
    expectTypeOf(Identity.verify).toBeFunction()
    expectTypeOf(Identity.verify).returns.resolves.toMatchTypeOf<{
      email: string | undefined
      nonce: string | undefined
      subject: string
    }>()
  })

  test('Options pins audience + issuer with optional nonce/subject', () => {
    expectTypeOf<Identity.verify.Options>().toMatchTypeOf<{
      audience: string
      issuer: string
      nonce?: string | undefined
      subject?: string | undefined
    }>()
  })
})
