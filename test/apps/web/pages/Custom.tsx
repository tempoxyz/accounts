/**
 * The custom page of the web test app, at `/custom/`: a sign-in with the app's own form, which shows
 * no page of Tempo ID. The `email` plugin sends a code to the address of the `Email` field, and
 * signs in with the code of the `Code` field. `accounts.authorize` then requests an access key for
 * the browser's Tempo ID session. The `passkey` plugin registers a passkey for the signed-in user,
 * and signs in with it. "Upgrade the account" requests the upgrade of the session's account.
 * @module
 */
import { Accounts } from 'accounts'
import { email, passkey } from 'accounts/plugins'
import * as App from '../App.js'

/** Creates the page's instance, and renders the page. */
export async function start() {
  const options = await App.options()
  const accounts = Accounts.create({
    ...options,
    plugins: [email(), passkey(), ...App.plugins()],
  })
  /** The passkey sign-in that "Prepare a passkey sign-in" requested, which the next control runs. */
  let prepared: ReturnType<typeof accounts.passkey.prepare> | undefined
  /** The registration options of "Sign in for a passkey registration", which one registration uses. */
  let registration:
    | Awaited<ReturnType<typeof accounts.email.signIn>>['registration']
    | undefined

  App.mount(accounts, {
    actions: {
      Authorize: async () =>
        App.describe(await accounts.authorize(App.request())),
      'Passkey available': () => accounts.passkey.available(),
      'Prepare a passkey sign-in': async () => {
        prepared = accounts.passkey.prepare(App.request())
        return { available: await prepared.available }
      },
      // The passkey owns an account of its own, or joins the session's account where the chain's
      // accounts are configurable. The session stays as it is.
      'Register a passkey': async () => {
        const existingAccessKey = (await accounts.session.get())?.accessKey
        const used = registration
        registration = undefined
        return accounts.passkey.register({
          ...(existingAccessKey ? { existingAccessKey } : {}),
          registration: used,
        })
      },
      // The proof's assertion also signs an access key for the new passkey's account.
      'Register a passkey with an access key': async () => {
        const result = await accounts.passkey.register({
          accessKey: options.accessKey,
        })
        return {
          ...(await App.describe(result)),
          id: result.id,
          passkeyAccount: result.address,
          upgradeAvailable: result.upgradeAvailable,
        }
      },
      'Send code': (fields) =>
        accounts.email.sendCode({ email: fields.Email ?? '' }),
      'Sign in': async (fields) => {
        const result = await accounts.email.signIn({
          code: fields.Code ?? '',
          email: fields.Email ?? '',
          ...App.request(),
        })
        return {
          ...(await App.describe(result)),
          accounts: result.accounts.map((account) => account.address),
          upgradeAvailable: result.upgradeAvailable,
        }
      },
      // The sign-in's response holds the options of a passkey registration, which
      // "Register a passkey" then uses in place of a request.
      'Sign in for a passkey registration': async (fields) => {
        const result = await accounts.email.signIn({
          code: fields.Code ?? '',
          email: fields.Email ?? '',
          registration: true,
        })
        registration = result.registration
        return {
          ...(await App.describe(result)),
          registration: Boolean(result.registration),
        }
      },
      'Sign in with a passkey': async () =>
        signedIn(await accounts.passkey.signIn(App.request())),
      'Sign in with the prepared passkey': async () => {
        if (!prepared) return null
        return signedIn(await prepared.signIn())
      },
      'Sign in without an access key': async (fields) =>
        App.describe(
          await accounts.email.signIn({
            accessKey: false,
            code: fields.Code ?? '',
            email: fields.Email ?? '',
          }),
        ),
      // Tempo ID upgrades only a passkey's own account, on a chain whose accounts are configurable.
      'Upgrade the account': async () => {
        const account = await accounts.account.upgrade()
        return { address: account.address, owner: account.owner }
      },
    },
    fields: ['Email', 'Code'],
  })

  /** Returns what a spec reads of a passkey sign-in: its session, or the kind of its email step. */
  async function signedIn(
    result: Awaited<ReturnType<typeof accounts.passkey.signIn>>,
  ) {
    if ('next' in result) return { next: result.next.type }
    return {
      ...(await App.describe(result)),
      upgradeAvailable: result.upgradeAvailable,
    }
  }
}
