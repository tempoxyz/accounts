import { describe, expectTypeOf, test } from 'vp/test'

import * as WebAuthnCeremony from './WebAuthnCeremony.js'

type RequestExtensions = {
  hostContext?: { value: string } | undefined
}

type ResponseExtensions = {
  hostContext?: { id: string } | undefined
}

describe('WebAuthnCeremony extensions types', () => {
  test('options calls accept extensions data', () => {
    expectTypeOf<
      WebAuthnCeremony.getRegistrationOptions.Parameters<RequestExtensions>['extensions']
    >().toEqualTypeOf<RequestExtensions | undefined>()
    expectTypeOf<
      WebAuthnCeremony.getAuthenticationOptions.Parameters<RequestExtensions>['extensions']
    >().toEqualTypeOf<RequestExtensions | undefined>()
  })

  test('server accepts a default extensions provider', () => {
    expectTypeOf<WebAuthnCeremony.server.Options<RequestExtensions>>().toMatchTypeOf<{
      getExtensions?:
        | (() => RequestExtensions | undefined | Promise<RequestExtensions | undefined>)
        | undefined
      url: string
    }>()
  })

  test('verify results expose host-defined data under extensions', () => {
    expectTypeOf<
      WebAuthnCeremony.verifyRegistration.ReturnType<ResponseExtensions>['extensions']
    >().toEqualTypeOf<ResponseExtensions | undefined>()
    expectTypeOf<
      WebAuthnCeremony.verifyAuthentication.ReturnType<ResponseExtensions>['extensions']
    >().toEqualTypeOf<ResponseExtensions | undefined>()
  })

  test('server ceremony carries request and response extension types', () => {
    const ceremony = WebAuthnCeremony.server<RequestExtensions, ResponseExtensions>({
      url: '/webauthn',
      getExtensions: () => ({
        hostContext: { value: 'example' },
      }),
    })

    type AuthenticationOptions = NonNullable<
      Parameters<typeof ceremony.getAuthenticationOptions>[number]
    >
    type AuthenticationResult = Awaited<ReturnType<typeof ceremony.verifyAuthentication>>

    expectTypeOf<AuthenticationOptions['extensions']>().toEqualTypeOf<
      RequestExtensions | undefined
    >()
    expectTypeOf<AuthenticationResult['extensions']>().toEqualTypeOf<
      ResponseExtensions | undefined
    >()
  })
})
