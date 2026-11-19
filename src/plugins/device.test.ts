/**
 * Runs the `device` plugin without a server: what `device.signIn` and `device.authorize` throw for a
 * request without a response.
 * @module
 */
import { PGlite } from '@electric-sql/pglite'
import * as ChildProcess from 'node:child_process'
import * as Fs from 'node:fs'
import * as Http from 'node:http'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { P256, PublicKey } from 'ox'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { device } from './index.js'

describe('device', () => {
  // Nothing listens at the URL, so each request rejects with a network error.
  function create(store: Store.Store = Store.memory()) {
    return Accounts.create({
      accessKey: { expiry: '7d', limits: [{ limit: '100', token: 'ousd' }] },
      chain: 42431,
      clientId: 'cli:acme-example',
      plugins: [device({ onCode: () => {} })],
      store,
      url: 'http://127.0.0.1:9',
    })
  }

  test('authorize throws RequestError with status 0 when the code request receives no response', async () => {
    const accounts = create()

    const error = await accounts.device
      .authorize({
        accessKey: { expiry: '7d', limits: [{ limit: '100', token: 'ousd' }] },
      })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The code request received no response. Check the connection, and request a new code.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  })

  test('signIn rejects with the reason of an aborted signal before the code request, and keeps the user signed out', async () => {
    const accounts = create()
    const controller = new AbortController()
    controller.abort(new Error('Timed out.'))

    const error = await accounts.device
      .signIn({ signal: controller.signal })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(`[Error: Timed out.]`)
    expect({
      session: await accounts.session.get(),
      status: accounts.session.status.get().status,
    }).toMatchInlineSnapshot(`
      {
        "session": undefined,
        "status": "signedOut",
      }
    `)
  })

  test('signIn rejects with the reason of an aborted signal, for a reason that is null', async () => {
    const accounts = create()
    const controller = new AbortController()
    controller.abort(null)

    const error = await accounts.device
      .signIn({ signal: controller.signal })
      .then(
        () => 'signedIn',
        (error: unknown) => error,
      )

    expect(error).toMatchInlineSnapshot(`null`)
  })

  test('signIn rejects with the reason of an aborted signal, and keeps the session, for a reason that is a refusal', async () => {
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","cli:acme-example",42431]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const accounts = create(store)
    await accounts.session.get()
    const controller = new AbortController()
    // An app can forward the error of another call through a shared controller.
    controller.abort(
      new Accounts.RequestError({
        code: 'access_denied',
        message: 'Refused.',
        signedIn: true,
        status: 400,
      }),
    )

    const error = await accounts.device
      .signIn({ signal: controller.signal })
      .catch((error: unknown) => error)

    expect({
      error: String(error),
      user: (await accounts.session.get())?.user.id,
    }).toMatchInlineSnapshot(`
      {
        "error": "Accounts.RequestError: Refused.",
        "user": "user_1",
      }
    `)
  })

  test('signIn rejects with the reason of a signal that aborts while the read of the store stalls', async () => {
    // A read of a FIFO without a writer settles only once a writer opens it.
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-device-'))
    const file = Path.join(directory, 'session.json')
    ChildProcess.execFileSync('mkfifo', [file])
    const codes: device.Code[] = []
    const accounts = Accounts.create({
      accessKey: { expiry: '7d', limits: [{ limit: '100', token: 'ousd' }] },
      chain: 42431,
      clientId: 'cli:acme-example',
      plugins: [device({ onCode: (code) => void codes.push(code) })],
      store: Store.file(file),
      url: 'http://127.0.0.1:9',
    })
    const controller = new AbortController()

    try {
      const signIn = accounts.device
        .signIn({ signal: controller.signal })
        .catch((error: unknown) => error)
      controller.abort(new Error('Timed out.'))
      const error = await signIn

      expect({ codes: codes.length, error }).toMatchInlineSnapshot(`
        {
          "codes": 0,
          "error": [Error: Timed out.],
        }
      `)
    } finally {
      Fs.closeSync(Fs.openSync(file, 'w'))
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('signIn throws RequestError with status 0, and keeps the user signed out in the file, when the code request receives no response', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-device-'))
    const file = Path.join(directory, 'session.json')
    const accounts = create(Store.file(file))

    try {
      const error = await accounts.device
        .signIn()
        .catch((error: unknown) => error)

      expect(error).toMatchInlineSnapshot(
        `[Accounts.RequestError: The code request received no response. Check the connection, and request a new code.]`,
      )
      expect({
        session: await accounts.session.get(),
        status: (error as Accounts.RequestError).status,
        statusAfter: accounts.session.status.get().status,
      }).toMatchInlineSnapshot(`
        {
          "session": undefined,
          "status": 0,
          "statusAfter": "signedOut",
        }
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('signIn throws Store.InvalidFileError before the code request, for a file that holds no valid JSON', async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-device-'))
    const file = Path.join(directory, 'session.json')
    Fs.writeFileSync(file, '{"tempo-id:session', { mode: 0o600 })
    const accounts = create(Store.file(file))

    try {
      const error = await accounts.device
        .signIn()
        .catch((error: unknown) => error)

      // Nothing listens at the URL, so a code request would reject with `Accounts.RequestError`.
      expect(
        String(error).replace(directory, '<directory>'),
      ).toMatchInlineSnapshot(
        `"Store.InvalidFileError: Invalid file: <directory>/session.json holds no valid JSON. Remove the file, and sign in again."`,
      )
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('signIn throws the error of the store before the code request, when the read of the store fails', async () => {
    // A path that names a folder fails each read and each save with `EISDIR`.
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), 'accounts-device-'))
    const codes: device.Code[] = []
    const accounts = Accounts.create({
      accessKey: { expiry: '7d', limits: [{ limit: '100', token: 'ousd' }] },
      chain: 42431,
      clientId: 'cli:acme-example',
      plugins: [device({ onCode: (code) => void codes.push(code) })],
      store: Store.file(directory),
      url: 'http://127.0.0.1:9',
    })

    try {
      const error = await accounts.device
        .signIn()
        .catch((error: unknown) => error)

      // Nothing listens at the URL, so a code request would reject with `Accounts.RequestError`.
      expect({
        codes: codes.length,
        error: String(error).replace(directory, '<directory>'),
      }).toMatchInlineSnapshot(`
        {
          "codes": 0,
          "error": "Error: EISDIR: illegal operation on a directory, read",
        }
      `)
    } finally {
      Fs.rmSync(directory, { force: true, recursive: true })
    }
  })

  test('signIn keeps the configured chain and requests a code, when the stored chain selection of a store that parses each entry alone holds no valid JSON', async () => {
    const database = new PGlite()
    const store = Store.postgres({
      query: (text, values) => database.query(text, [...values]),
    })
    await store.setItem('seed', true)
    await database.query(
      'insert into tempo_id_store (key, value) values ($1, $2)',
      [
        'tempo-id:session:["http://127.0.0.1:9","cli:acme-example",42431]:chain',
        '{"chain',
      ],
    )
    const accounts = create(store)

    const error = await accounts.device
      .signIn()
      .catch((error: unknown) => error)

    // Nothing listens at the URL, so the code request rejects.
    expect(String(error)).toMatchInlineSnapshot(
      `"Accounts.RequestError: The code request received no response. Check the connection, and request a new code."`,
    )
  })

  test('poll throws RequestError with status 0 when the poll receives no response', async () => {
    const accounts = create()

    const error = await accounts.device
      .poll({
        accessKey: {
          publicKey: PublicKey.toHex(
            P256.getPublicKey({ privateKey: P256.randomPrivateKey() }),
          ),
          type: 'p256',
        },
        deviceCode: 'code',
      })
      .catch((error: unknown) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The poll received no response. Check the connection, and poll again.]`,
    )
    expect((error as Accounts.RequestError).status).toMatchInlineSnapshot(`0`)
  })

  test('signIn waits 5 seconds between polls, as RFC 8628 sets, when the code response names no interval', async () => {
    const polls: number[] = []
    // A code that expires in 1 second, without `interval`, which RFC 8628 §3.2 makes optional.
    const server = Http.createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      if (request.url === '/device/code') {
        response.end(
          JSON.stringify({
            device_code: 'device-code',
            expires_in: 1,
            user_code: 'ZZVF-JWQT',
            verification_uri: 'http://127.0.0.1/device',
            verification_uri_complete: 'http://127.0.0.1/device?code=ZZVF-JWQT',
          }),
        )
        return
      }
      polls.push(Date.now())
      response.statusCode = 400
      response.end(JSON.stringify({ error: 'authorization_pending' }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No port.')
    const accounts = Accounts.create({
      accessKey: { expiry: '7d', limits: [{ limit: '100', token: 'ousd' }] },
      chain: 42431,
      clientId: 'cli:acme-example',
      plugins: [device({ onCode: () => {} })],
      store: false,
      url: `http://127.0.0.1:${address.port}`,
    })

    const error = await accounts.device
      .signIn()
      .catch((error: unknown) => error)
    await new Promise((resolve) => server.close(resolve))

    // The first wait ends at the code's expiry, so one poll precedes the expiry.
    expect({ error, polls: polls.length }).toMatchInlineSnapshot(`
      {
        "error": [Accounts.RequestError: Device code expired. Request a new code.],
        "polls": 1,
      }
    `)
  })
})
