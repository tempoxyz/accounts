import { beforeAll } from 'vp/test'
import { cdp } from 'vp/test/browser'

beforeAll(async () => {
  const session = cdp()
  // @ts-expect-error -- CDPSession types are empty; `send` provided by playwright at runtime
  await session.send('WebAuthn.enable')
  // @ts-expect-error -- CDPSession types are empty; `send` provided by playwright at runtime
  const result = await session.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'usb',
      hasUserVerification: true,
      isUserVerified: true,
      hasResidentKey: true,
    },
  })
  const authenticatorId = result.authenticatorId

  return async () => {
    // @ts-expect-error -- CDPSession types are empty; `send` provided by playwright at runtime
    await session.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId })
  }
})
