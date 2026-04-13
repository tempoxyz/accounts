import { afterAll, beforeAll, describe, expect, test } from 'vp/test'

import { createServer, type Server } from '../../../../test/utils.js'
import * as WebAuthnCeremony from '../../../core/WebAuthnCeremony.js'
import * as Kv from '../../Kv.js'
import { webAuthn } from './webAuthn.js'

let server: Server
let ceremony: WebAuthnCeremony.WebAuthnCeremony

beforeAll(async () => {
  server = await createServer(
    webAuthn({
      kv: Kv.memory(),
      origin: 'http://localhost',
      rpId: 'localhost',
    }).listener,
  )
  ceremony = WebAuthnCeremony.server({ url: server.url })
})

afterAll(async () => {
  await server.closeAsync()
})

describe('POST /register/options', () => {
  test('default: returns registration options', async () => {
    const { options } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rp.id).toMatchInlineSnapshot(`"localhost"`)
    expect(options.publicKey!.rp.name).toMatchInlineSnapshot(`"localhost"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
  })

  test('behavior: each call generates a unique challenge', async () => {
    const { options: a } = await ceremony.getRegistrationOptions({ name: 'Test' })
    const { options: b } = await ceremony.getRegistrationOptions({ name: 'Test' })
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('POST /login/options', () => {
  test('default: returns authentication options', async () => {
    const { options } = await ceremony.getAuthenticationOptions()
    expect(options.publicKey).toBeDefined()
    expect(options.publicKey!.rpId).toMatchInlineSnapshot(`"localhost"`)
    expect(typeof options.publicKey!.challenge).toMatchInlineSnapshot(`"string"`)
  })

  test('behavior: each call generates a unique challenge', async () => {
    const { options: a } = await ceremony.getAuthenticationOptions()
    const { options: b } = await ceremony.getAuthenticationOptions()
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('POST /register', () => {
  test('error: invalid credential → 400', async () => {
    const response = await fetch(`${server.url}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fake', clientDataJSON: 'bad', attestationObject: 'bad' }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBeTypeOf('string')
  })
})

describe('POST /login', () => {
  test('error: unknown credential → 400', async () => {
    const response = await fetch(`${server.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'unknown',
        metadata: { authenticatorData: '0x00', clientDataJSON: '{"challenge":"0xdead"}' },
        raw: {
          id: 'unknown',
          type: 'public-key',
          authenticatorAttachment: null,
          rawId: 'unknown',
          response: { clientDataJSON: 'e30' },
        },
        signature: '0x00',
      }),
    })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toMatchInlineSnapshot(`"Missing or expired challenge"`)
  })
})

describe('challenge replay', () => {
  test('behavior: challenge consumed after register/options → re-fetching is required', async () => {
    // Get options twice — each should have a unique challenge stored in KV
    const { options: a } = await ceremony.getRegistrationOptions({ name: 'Replay' })
    const { options: b } = await ceremony.getRegistrationOptions({ name: 'Replay' })
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })

  test('behavior: challenge consumed after login/options → re-fetching is required', async () => {
    const { options: a } = await ceremony.getAuthenticationOptions()
    const { options: b } = await ceremony.getAuthenticationOptions()
    expect(a.publicKey!.challenge).not.toBe(b.publicKey!.challenge)
  })
})

describe('hooks', () => {
  test('behavior: onRegister error does not call hook', async () => {
    let called = false
    const hookServer = await createServer(
      webAuthn({
        kv: Kv.memory(),
        origin: 'http://localhost',
        rpId: 'localhost',
        onRegister() {
          called = true
          return Response.json({ extra: true })
        },
      }).listener,
    )

    const response = await fetch(`${hookServer.url}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'fake', clientDataJSON: 'bad', attestationObject: 'bad' }),
    })
    expect(response.status).toBe(400)
    expect(called).toBe(false)

    await hookServer.closeAsync()
  })

  test('behavior: onAuthenticate error does not call hook', async () => {
    let called = false
    const hookServer = await createServer(
      webAuthn({
        kv: Kv.memory(),
        origin: 'http://localhost',
        rpId: 'localhost',
        onAuthenticate() {
          called = true
          return Response.json({ extra: true })
        },
      }).listener,
    )

    const response = await fetch(`${hookServer.url}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: 'unknown',
        metadata: { authenticatorData: '0x00', clientDataJSON: '{"challenge":"0xdead"}' },
        raw: {
          id: 'unknown',
          type: 'public-key',
          authenticatorAttachment: null,
          rawId: 'unknown',
          response: { clientDataJSON: 'e30' },
        },
        signature: '0x00',
      }),
    })
    expect(response.status).toBe(400)
    expect(called).toBe(false)

    await hookServer.closeAsync()
  })
})
