import { describe, expect, test } from 'vp/test'
import { Registration, Authentication } from 'webauthx/client'

import { hooksUrl, url as webauthnUrl } from '../../test/webauthn.constants.js'
import { webAuthn } from './adapters/webAuthn.js'
import * as Ceremony from './Ceremony.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

describe('local', () => {
  test('default: creates a passkey and verifies registration', async () => {
    const ceremony = Ceremony.local()
    const { options } = await ceremony.getRegistrationOptions({ name: 'Test' })
    const credential = await Registration.create({ options })
    const result = await ceremony.verifyRegistration(credential)

    expect(result.publicKey).toMatch(/^0x[0-9a-f]+$/)
    expect(result.credentialId).toBeTypeOf('string')
  })

  test('behavior: authenticates with an existing passkey', async () => {
    const ceremony = Ceremony.local()
    const { options: regOptions } = await ceremony.getRegistrationOptions({ name: 'Test' })
    const credential = await Registration.create({ options: regOptions })
    const { publicKey } = await ceremony.verifyRegistration(credential)

    const { options: authOptions } = await ceremony.getAuthenticationOptions({
      credentialId: credential.id,
    })
    const response = await Authentication.sign({ options: authOptions })
    const result = await ceremony.verifyAuthentication(response)

    expect(result.publicKey).toMatchInlineSnapshot(`"${publicKey}"`)
    expect(result.credentialId).toBeTypeOf('string')
  })

  test('behavior: register → authenticate → publicKeys match', async () => {
    const ceremony = Ceremony.local()
    const { options: regOptions } = await ceremony.getRegistrationOptions({ name: 'Round-trip' })
    const credential = await Registration.create({ options: regOptions })
    const reg = await ceremony.verifyRegistration(credential)

    const { options: authOptions } = await ceremony.getAuthenticationOptions({
      credentialId: reg.credentialId,
    })
    const response = await Authentication.sign({ options: authOptions })
    const auth = await ceremony.verifyAuthentication(response)

    expect(auth.publicKey).toBe(reg.publicKey)
    expect(auth.credentialId).toBe(reg.credentialId)
  })
})

describe('server', () => {
  const ceremony = Ceremony.server({ url: webauthnUrl })

  test('default: register → verify returns valid publicKey hex', async () => {
    const { options } = await ceremony.getRegistrationOptions({ name: 'Server Test' })
    const credential = await Registration.create({ options })
    const result = await ceremony.verifyRegistration(credential)

    expect(result.credentialId).toBeTypeOf('string')
    expect(result.publicKey).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: authentication publicKeys match registration', async () => {
    const { options: regOptions } = await ceremony.getRegistrationOptions({ name: 'Server Auth' })
    const credential = await Registration.create({ options: regOptions })
    const reg = await ceremony.verifyRegistration(credential)

    const { options: authOptions } = await ceremony.getAuthenticationOptions({
      credentialId: reg.credentialId,
    })
    const response = await Authentication.sign({ options: authOptions })
    const auth = await ceremony.verifyAuthentication(response)

    expect(auth.publicKey).toBe(reg.publicKey)
    expect(auth.credentialId).toBe(reg.credentialId)
  })

  test('behavior: challenge consumed after use (replay → 400)', async () => {
    const { options } = await ceremony.getRegistrationOptions({ name: 'Replay Test' })
    const credential = await Registration.create({ options })

    // First verify succeeds
    const result = await ceremony.verifyRegistration(credential)
    expect(result.credentialId).toBeTypeOf('string')

    // Replay same credential → 400 (challenge consumed)
    const response = await fetch(`${webauthnUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatchInlineSnapshot(`"Missing or expired challenge"`)
  })

  test('behavior: multiple credentials return correct publicKeys', async () => {
    const { options: regA } = await ceremony.getRegistrationOptions({ name: 'User A' })
    const credA = await Registration.create({ options: regA })
    const a = await ceremony.verifyRegistration(credA)

    const { options: regB } = await ceremony.getRegistrationOptions({ name: 'User B' })
    const credB = await Registration.create({ options: regB })
    const b = await ceremony.verifyRegistration(credB)

    expect(a.publicKey).not.toBe(b.publicKey)

    // Login with credential A
    const { options: authA } = await ceremony.getAuthenticationOptions({
      credentialId: a.credentialId,
    })
    const resA = await Authentication.sign({ options: authA })
    const authResultA = await ceremony.verifyAuthentication(resA)
    expect(authResultA.publicKey).toBe(a.publicKey)

    // Login with credential B
    const { options: authB } = await ceremony.getAuthenticationOptions({
      credentialId: b.credentialId,
    })
    const resB = await Authentication.sign({ options: authB })
    const authResultB = await ceremony.verifyAuthentication(resB)
    expect(authResultB.publicKey).toBe(b.publicKey)
  })
})

describe('server (provider round-trip)', () => {
  const ceremony = Ceremony.server({ url: webauthnUrl })

  function createProvider() {
    return Provider.create({
      storage: Storage.idb({ key: crypto.randomUUID() }),
      adapter: webAuthn({ ceremony }),
    })
  }

  test('behavior: wallet_connect register → eth_accounts returns address', async () => {
    const provider = createProvider()

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0]!.address).toMatch(/^0x[0-9a-fA-F]{40}$/)

    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toHaveLength(1)
    expect(accounts[0]).toBe(result.accounts[0]!.address)
  })

  test('behavior: register two accounts → eth_accounts returns both', async () => {
    const provider = createProvider()

    // Register first
    const first = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    // Register second
    const second = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register' } }],
    })

    expect(second.accounts).toHaveLength(2)
    expect(second.accounts[0]!.address).not.toBe(first.accounts[0]!.address)

    const accounts = await provider.request({ method: 'eth_accounts' })
    expect(accounts).toHaveLength(2)
  })
})

describe('server (hooks)', () => {
  test('behavior: onRegister merges extra JSON and headers', async () => {
    const regOptionsRes = await fetch(`${hooksUrl}/register/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hook Test' }),
    })
    const { options } = await regOptionsRes.json()
    const credential = await Registration.create({ options })

    const res = await fetch(`${hooksUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })

    const body = await res.json()
    expect(body.credentialId).toBeTypeOf('string')
    expect(body.publicKey).toMatch(/^0x[0-9a-f]+$/)
    expect(body.sessionToken).toBe(`reg_${body.credentialId}`)
    expect(res.headers.get('x-custom')).toBe('register-hook')
  })

  test('behavior: onAuthenticate merges extra JSON and headers', async () => {
    // Register first
    const regOptionsRes = await fetch(`${hooksUrl}/register/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Hook Auth Test' }),
    })
    const { options: regOptions } = await regOptionsRes.json()
    const credential = await Registration.create({ options: regOptions })

    const regRes = await fetch(`${hooksUrl}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credential),
    })
    const { credentialId } = await regRes.json()

    // Authenticate
    const authOptionsRes = await fetch(`${hooksUrl}/login/options`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialId }),
    })
    const { options: authOptions } = await authOptionsRes.json()
    const response = await Authentication.sign({ options: authOptions })

    const res = await fetch(`${hooksUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    })

    const body = await res.json()
    expect(body.credentialId).toBe(credentialId)
    expect(body.publicKey).toMatch(/^0x[0-9a-f]+$/)
    expect(body.sessionToken).toBe(`auth_${credentialId}`)
    expect(res.headers.get('x-custom')).toBe('authenticate-hook')
  })
})
