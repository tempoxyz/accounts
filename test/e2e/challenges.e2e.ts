/**
 * Tests the challenge of a sign-in on the web test app: how Tempo ID's page shows each message
 * shape, the message of a function, the challenge that Tempo ID refuses, and the proof of a
 * challenge that an access key carries. The spec's own process verifies each signature on the node,
 * and each proof with `Challenge.verify`, as an app's backend does. The last cases sign a proof with
 * a root key of the spec's own, which an upgrade in place of its account retires on the node.
 * @module
 */
import type { FrameLocator, Page } from '@playwright/test'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { hashMessage } from 'viem'
import { generatePrivateKey, privateKeyToAddress } from 'viem/accounts'
import { parseSiweMessage } from 'viem/siwe'
import { Account, Addresses } from 'viem/tempo'
import { tempoModerato } from 'viem/tempo/chains'
import * as Apps from '../Apps.js'
import * as Chain from '../Chain.js'
import * as Messages from '../Messages.js'
import * as Playwright from '../Playwright.js'
import { expect, test } from '../Playwright.js'
import * as Verify from '../Verify.js'
import * as Web from '../Web.js'

/** What the sign-in control of the dialog page returned for a sign-in without an access key. */
type Signed = {
  /** The Tempo Account that signed. */
  address: `0x${string}`
  /** The account's signature of the challenge. */
  challengeSignature: `0x${string}`
}

/** A challenge with a bell character, which Tempo ID refuses. */
const control = 'Sign in to the web test app\u0007'

/** The refusal of {@link control} by Tempo ID's authorization page, as a page of the app receives it. */
const refused = {
  code: 'invalid_request',
  message:
    'Invalid request. `challenge`: Remove control and format characters, such as bidi overrides.',
  name: 'Accounts.RequestError',
  reason: null,
  status: 0,
}

/** The kinds of a root key, each with a name for its test, and an account of a new root key. */
const roots = [
  {
    name: 'a secp256k1',
    root: () => Account.fromSecp256k1(generatePrivateKey()),
  },
  { name: 'a P256', root: () => Account.fromP256(generatePrivateKey()) },
] as const

/** The message shapes of a challenge, each with a name for its test. */
const shapes = [
  { name: 'plain text', shape: 'text' },
  {
    name: 'several lines, a tab, and characters outside ASCII',
    shape: 'lines',
  },
  { name: 'a Sign-In with Ethereum message', shape: 'signIn' },
  {
    name: 'a Sign-In with Ethereum message that shares an item',
    shape: 'share',
  },
  {
    name: 'a Sign-In with Ethereum message of another origin',
    shape: 'otherDomain',
  },
  {
    name: 'a Sign-In with Ethereum message that has expired',
    shape: 'expired',
  },
] as const satisfies readonly { name: string; shape: Messages.Shape }[]

/**
 * The wrong inputs of `Challenge.verify`, each with the reason of its `Challenge.InvalidError`. Each
 * row changes one input of a proof that verifies.
 */
const wrong = [
  {
    change: (proof) => ({ ...proof, challenge: `${proof.challenge}.` }),
    name: 'another challenge',
    reason: 'the witness does not bind the challenge',
  },
  {
    change: (proof) => ({
      ...proof,
      keyAuthorization: {
        ...proof.keyAuthorization,
        // 1,000 OUSD, in place of the 100 that the owner signed.
        limits: proof.keyAuthorization.limits?.map((limit) => ({
          ...limit,
          limit: '0x3b9aca00',
        })),
      },
    }),
    name: 'a key authorization with a changed limit',
    reason: "the account's owner did not sign the key authorization",
  },
  {
    change: (proof) => ({
      ...proof,
      keyAuthorization: { ...proof.keyAuthorization, expiry: '0x1' },
    }),
    name: 'a key authorization with a changed expiry',
    reason: "the account's owner did not sign the key authorization",
  },
  {
    change: (proof) => ({
      ...proof,
      keyAuthorization: {
        ...proof.keyAuthorization,
        signature: undefined,
      } as never,
    }),
    name: 'a key authorization without its signature',
    reason: 'the key authorization is malformed',
  },
  {
    change: (proof) => ({ ...proof, chain: tempoModerato }),
    name: 'a client of another chain',
    reason: `the access key acts on chain 1337, not ${tempoModerato.id}`,
  },
] as const satisfies readonly {
  change: (proof: Verify.challenge.Options) => Verify.challenge.Options
  name: string
  reason: string
}[]

/**
 * Returns the proof of `challenge` that `signer` signs, for a new access key on the suite's chain:
 * the key authorization in the node's RPC format, whose witness binds the challenge.
 */
async function sign(options: sign.Options) {
  const unsigned = KeyAuthorization.from({
    address: privateKeyToAddress(generatePrivateKey()),
    chainId: BigInt(Chain.chain.id),
    expiry: 1_893_456_000,
    type: 'secp256k1',
    witness: hashMessage(options.challenge),
  })
  const signature = SignatureEnvelope.deserialize(
    await options.signer.sign({
      hash: KeyAuthorization.getSignPayload(unsigned),
    }),
  )
  if (signature.type === 'keychain')
    throw new Error(
      'An access key signed the proof. Sign with a root key, or with a configurable account.',
    )

  return KeyAuthorization.toRpc(KeyAuthorization.from(unsigned, { signature }))
}

declare namespace sign {
  type Options = {
    /** The challenge. */
    challenge: string
    /** The account that signs: a root key's, or a configurable account's with its owners. */
    signer: Pick<Account.Account, 'sign'>
  }
}

/**
 * Asserts how Tempo ID's sign-in form in `target` shows the challenge `message` of `shape`: plain
 * text and a message that it does not recognize with a warning, a sign-in message with no note, and
 * a share as a row of what the app receives.
 */
async function shown(target: FrameLocator | Page, options: shown.Options) {
  const { message, shape } = options
  const grant = Playwright.grant(target)
  await expect(Playwright.form(target)).toBeVisible()

  if (shape === 'signIn') return expect(grant).toHaveCount(0)
  if (shape === 'share') {
    await expect(grant).toContainText(['Share “notes” with another account'])
    return expect(grant).not.toContainText(['expect this message'])
  }
  await expect(grant).toContainText([
    'Sign in only if you started this sign-in and expect this message.',
  ])
  await expect(grant).toContainText([message])
}

declare namespace shown {
  type Options = {
    /** The challenge. */
    message: string
    /** The challenge's shape. */
    shape: Messages.Shape
  }
}

/**
 * Signs `email` in with the app's own form on the custom page of the web test app, for the app that
 * holds `tempo-id:sign`, with `challenge` and an access key. Returns the inputs of `Challenge.verify`
 * for the session.
 */
async function prove(
  page: Page,
  options: prove.Options,
): Promise<Verify.challenge.Options> {
  const { challenge, code, email } = options
  await page.goto(Web.url({ challenge, clientId: Apps.web.clientIdSign }))
  const session = await Playwright.signIn_custom(page, { code, email })
  expect(session.state).toBe('fulfilled')
  const proof = await Playwright.run(page, { name: 'Proof' })

  return {
    accessToken: proof.value.accessToken,
    challenge,
    clientId: Apps.web.clientIdSign,
    keyAuthorization: proof.value.keyAuthorization,
  }
}

declare namespace prove {
  type Options = {
    /** The challenge of the sign-in. */
    challenge: string
    /** Returns the code that the inbox holds for an address. */
    code: Playwright.Code
    /** The address to sign in. */
    email: string
  }
}

test.describe('challenges', () => {
  test.describe('shapes in the frame', () => {
    for (const { name, shape } of shapes)
      test(`signs ${name} in the frame, without an access key`, async ({
        capture,
        code,
        email,
        page,
      }) => {
        const { domain, message, nonce, resources } = Messages.from({ shape })
        await page.goto(
          Web.url({
            accessKey: false,
            challenge: message,
            path: Apps.web.paths.dialog,
          }),
        )

        const frame =
          await test.step('shows the message as Tempo ID reads it', async () => {
            await Playwright.start(page, { name: 'Sign in' })
            const frame = await Playwright.dialog(page)

            await shown(frame, { message, shape })
            await capture('challenge')
            return frame
          })

        const signed =
          await test.step('returns the account and its signature, and no access key', async () => {
            await Playwright.signIn(frame, { code, email })
            const session = await Playwright.outcome(page, { name: 'Sign in' })

            expect(session).toMatchObject({
              state: 'fulfilled',
              value: {
                address: expect.stringMatching(/^0x/),
                challengeSignature: expect.stringMatching(/^0x/),
                key: null,
              },
            })
            await capture('signed in')
            return session.value as Signed
          })

        await test.step('verifies the signature on the node, for the same bytes and account alone', async () => {
          const { address, challengeSignature: signature } = signed

          expect(await Verify.message({ address, message, signature })).toBe(
            true,
          )
          expect(
            await Verify.message({
              address,
              message: `${message} `,
              signature,
            }),
          ).toBe(false)
          expect(
            await Verify.message({
              address: Messages.teammate,
              message,
              signature,
            }),
          ).toBe(false)
          if (shape === 'lines')
            expect(
              await Verify.message({
                address,
                message: message.replaceAll('\n', '\r\n'),
                signature,
              }),
            ).toBe(false)
          await capture('verified')
        })

        if (!Messages.shapes[shape].siwe) return
        await test.step('checks the fields of the Sign-In with Ethereum message, as a backend does', async () => {
          const { address, challengeSignature: signature } = signed
          const host = new URL(Apps.web.url).host

          // Tempo ID signs a message that it does not recognize, so the backend's checks decide.
          expect(
            await Verify.siwe({
              address,
              domain: host,
              message,
              nonce,
              signature,
            }),
          ).toBe(Messages.shapes[shape].recognized)
          expect(
            await Verify.siwe({ address, domain, message, nonce, signature }),
          ).toBe(shape !== 'expired')
          expect(parseSiweMessage(message).resources ?? []).toEqual(resources)
          await capture('checked')
        })
      })
  })

  test.describe('a message from a function', () => {
    const name = 'Sign a message from a function'

    test('requests the message before the dialog opens, and signs what the function returned', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { domain, message, nonce } = Messages.from({ shape: 'signIn' })
      const key = await Web.enter_dialog(page, {
        capture,
        code,
        email,
        fund: false,
        message,
      })

      await test.step('waits for the message, with no dialog', async () => {
        await Playwright.start(page, { name })

        await expect(
          page.locator(`output[data-action="${name}"]`),
        ).toHaveAttribute('data-state', 'pending')
        await expect(Playwright.prompt(page)).toHaveCount(0)
        await capture('waiting for the message')
      })

      await test.step('shows the approval once the function returns, and signs the message', async () => {
        await Playwright.issue(page)
        const frame = await Playwright.dialog(page)
        await capture('approval')
        await Playwright.approve(frame)
        const signed = await Playwright.outcome(page, { name })

        expect(signed).toEqual({
          state: 'fulfilled',
          value: {
            address: key.account,
            message,
            signature: expect.stringMatching(/^0x/),
          },
        })
        expect(
          await Verify.siwe({
            address: key.account,
            domain,
            message,
            nonce,
            signature: signed.value.signature,
          }),
        ).toBe(true)
        await capture('signed')
      })
    })

    test('rejects with the error of the function, and aborts the function’s signal', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await Web.enter_dialog(page, { capture, code, email, fund: false })

      await test.step('rejects once the function rejects, with no dialog', async () => {
        await Playwright.start(page, { name })
        await Playwright.issue(page, { refuse: true })

        expect(await Playwright.outcome(page, { name })).toMatchObject({
          state: 'rejected',
          value: { message: 'The page issued no message.', name: 'Error' },
        })
        await expect(page.locator('html')).toHaveAttribute(
          'data-message-signal',
          'aborted',
        )
        await expect(Playwright.prompt(page)).toHaveCount(0)
        await capture('rejected')
      })
    })

    test('ends the wait for the message once a later request replaces it', async ({
      capture,
      code,
      email,
      page,
    }) => {
      await Web.enter_dialog(page, { capture, code, email, fund: false })

      await test.step('rejects the first request, and aborts the function’s signal', async () => {
        await Playwright.start(page, { name })
        await Playwright.start(page, { name: 'Sign a message' })

        expect(await Playwright.outcome(page, { name })).toMatchObject({
          state: 'rejected',
          value: {
            message: 'A later sign-in replaced this one.',
            name: 'AbortError',
          },
        })
        await expect(page.locator('html')).toHaveAttribute(
          'data-message-signal',
          'aborted',
        )
        await capture('replaced')
      })

      await test.step('shows the approval of the later request', async () => {
        await Playwright.approve(await Playwright.dialog(page))

        expect(
          (await Playwright.outcome(page, { name: 'Sign a message' })).state,
        ).toBe('fulfilled')
        await capture('signed')
      })
    })
  })

  test.describe('refusals of Tempo ID', () => {
    test('refuses a control character in the frame, and in the popup that the frame offers', async ({
      capture,
      page,
    }) => {
      await page.goto(
        Web.url({
          accessKey: false,
          challenge: control,
          path: Apps.web.paths.dialog,
        }),
      )

      const window =
        await test.step('offers a popup in place of the frame', async () => {
          await Playwright.start(page, { name: 'Sign in' })
          await expect(Playwright.prompt(page)).toContainText(
            'Continue in a new window to finish signing in.',
          )
          await capture('popup offer')
          return Playwright.popup(page, {
            open: () => Playwright.choose(page, { name: 'Continue' }),
          })
        })

      await test.step('rejects the sign-in with Tempo ID’s refusal, and closes the popup', async () => {
        expect(await Playwright.outcome(page, { name: 'Sign in' })).toEqual({
          state: 'rejected',
          value: refused,
        })
        await expect.poll(() => window.isClosed()).toBe(true)
        await expect(page.locator('#status')).toHaveText('signedOut')
        await capture('refused')
      })
    })

    test('refuses a control character at the return of a redirect', async ({
      capture,
      page,
    }) => {
      await page.goto(
        Web.url({
          accessKey: false,
          challenge: control,
          path: Apps.web.paths.redirect,
        }),
      )

      await test.step('returns to the page with Tempo ID’s refusal, which `useSession` throws', async () => {
        await Playwright.start(page, { name: 'Sign in' })

        expect(await Playwright.failure(page)).toEqual(refused)
        await capture('refused')
      })
    })

    test('refuses a control character from the app’s own form', async ({
      capture,
      code,
      email,
      errors,
      page,
    }) => {
      await page.goto(
        Web.url({ challenge: control, clientId: Apps.web.clientIdSign }),
      )

      await test.step('rejects the sign-in with the reason, and holds no session', async () => {
        const session = await Playwright.signIn_custom(page, { code, email })

        expect(session).toMatchObject({
          state: 'rejected',
          value: {
            message:
              'Invalid request. `continue.authorize.challenge`: Remove control and format characters, such as bidi overrides.',
            name: 'Accounts.RequestError',
            reason: 'invalid_field',
            status: 400,
          },
        })
        await expect(page.locator('#status')).toHaveText('signedOut')
        // The browser logs the refused request.
        expect(errors.splice(0)).toEqual([Web.consoleErrors[400]])
        await capture('refused')
      })
    })
  })

  test.describe('proof with an access key', () => {
    for (const { name, shape } of shapes.slice(0, 4))
      test(`binds ${name} to the access key, and verifies the proof`, async ({
        capture,
        code,
        email,
        page,
      }) => {
        const { message } = Messages.from({ shape })

        await test.step('signs in with the app’s own form, and verifies the proof twice', async () => {
          const proof = await prove(page, { challenge: message, code, email })
          const session = await Playwright.run(page, { name: 'Session' })

          expect(proof.keyAuthorization.witness).toBe(hashMessage(message))
          const verified = {
            accessKey: session.value.key.id,
            account: session.value.key.account,
          }
          expect(await Verify.challenge(proof)).toEqual(verified)
          // Neither Tempo ID nor the node spends a challenge. The app's backend does.
          expect(await Verify.challenge(proof)).toEqual(verified)
          await capture('signed in')
        })
      })
  })

  test.describe('proof that fails', () => {
    test('rejects a proof with one changed input, and the access token of another app', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })

      await test.step('verifies the proof, and rejects each changed one with its reason', async () => {
        const proof = await prove(page, { challenge: message, code, email })

        expect(await Verify.challenge(proof)).toBeTruthy()
        for (const { change, name, reason } of wrong)
          await expect(
            Verify.challenge(change(proof)),
            name,
          ).rejects.toMatchObject({
            message: expect.stringContaining(reason),
            name: 'Challenge.InvalidError',
          })
        // The token of another app fails before the proof.
        await expect(
          Verify.challenge({ ...proof, clientId: Apps.web.clientId }),
        ).rejects.toMatchObject({ name: 'AccessToken.InvalidError' })
        await capture('signed in')
      })
    })

    test('rejects the key authorization of another user', async ({
      capture,
      code,
      email,
      page,
    }) => {
      const { message } = Messages.from({ shape: 'text' })
      const other = `accounts-test+${crypto.randomUUID()}@example.org`

      const first =
        await test.step('signs a first user in, and out', async () => {
          const proof = await prove(page, {
            challenge: message,
            code,
            email: other,
          })
          await Playwright.run(page, { name: 'Sign out' })

          await capture('signed out')
          return proof
        })

      await test.step('rejects the first user’s key authorization with the second user’s token', async () => {
        const proof = await prove(page, { challenge: message, code, email })

        await expect(
          Verify.challenge({
            ...proof,
            keyAuthorization: first.keyAuthorization,
          }),
        ).rejects.toMatchObject({
          message: expect.stringContaining(
            "the app's access token does not name the access key",
          ),
          name: 'Challenge.InvalidError',
        })
        await capture('signed in')
      })
    })
  })

  test.describe('proof of a root key', () => {
    /** The one request of a root key's proof: the read of the account's config commitment. */
    const read = `eth_call ${Addresses.configurableAccount}`
    const refusal = {
      message: expect.stringContaining(
        "the account's owner did not sign the key authorization",
      ),
      name: 'Challenge.InvalidError',
    }

    for (const { name, root: create } of roots)
      test(`verifies the proof of ${name} root key, and refuses it once an upgrade in place retires the root key`, async () => {
        const { message: challenge } = Messages.from({ shape: 'text' })
        const root = create()
        const owner = Account.fromSecp256k1(generatePrivateKey())
        const other = privateKeyToAddress(generatePrivateKey())
        const keyAuthorization = await sign({ challenge, signer: root })
        const accessKey = keyAuthorization.keyId

        await test.step('verifies the root key’s proof with one read of the account’s configuration', async () => {
          expect(
            await Verify.proof({
              accounts: [root.address],
              challenge,
              keyAuthorization,
            }),
          ).toEqual({
            requests: [read],
            state: 'fulfilled',
            value: { accessKey, account: root.address },
          })
          // The root key derives one address, so a token of several accounts adds no read.
          expect(
            await Verify.proof({
              accounts: [other, root.address],
              challenge,
              keyAuthorization,
            }),
          ).toEqual({
            requests: [read],
            state: 'fulfilled',
            value: { accessKey, account: root.address },
          })
          // A token that names another account alone fails before the read.
          expect(
            await Verify.proof({
              accounts: [other],
              challenge,
              keyAuthorization,
            }),
          ).toEqual({ requests: [], state: 'rejected', value: refusal })
        })

        await test.step('upgrades the account in place, which installs a configuration', async () => {
          await Chain.fund({ address: root.address })

          expect(await Chain.upgrade({ owner: owner.address, root })).toMatch(
            /^0x(?!0{64}$)[0-9a-f]{64}$/,
          )
        })

        await test.step('refuses the retired root key’s proof, after the same one read', async () => {
          expect(
            await Verify.proof({
              accounts: [root.address],
              challenge,
              keyAuthorization,
            }),
          ).toEqual({ requests: [read], state: 'rejected', value: refusal })
        })

        await test.step('verifies the proof that the new owner signs, on the node alone', async () => {
          const configured = Account.fromConfig({
            address: root.address,
            upgrade: { owners: [owner], threshold: 1 },
          })
          const proof = await sign({ challenge, signer: configured })

          expect(
            await Verify.proof({
              accounts: [root.address],
              challenge,
              keyAuthorization: proof,
            }),
          ).toEqual({
            requests: [`eth_call ${Addresses.signatureVerifier}`],
            state: 'fulfilled',
            value: { accessKey: proof.keyId, account: root.address },
          })
          // The new owner's own signature, with no account around it, derives another address.
          expect(
            await Verify.proof({
              accounts: [root.address],
              challenge,
              keyAuthorization: await sign({ challenge, signer: owner }),
            }),
          ).toEqual({ requests: [], state: 'rejected', value: refusal })
        })
      })
  })
})
