# Custom sign-in UI

## Overview

A first-party browser app can render its own sign-in form, and call Tempo ID's headless API from the page with the [`email`](../api/plugins.email.md) and [`passkey`](../api/plugins.passkey.md) plugins. The page sends the Tempo ID session cookie, so a user signed in from any app on the site needs no form. Any other app signs in on Tempo ID's pages, as [Redirect sign-in](redirect.md) describes.

```ts
import { Accounts } from 'accounts'
import { email } from 'accounts/plugins'
import { tempo } from 'viem/tempo/chains'

const accounts = Accounts.create({
  // Each sign-in requests an access key that may transfer up to 10 OUSD for a day.
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  }),
  clientId: 'client_…',
  plugins: [email()],
})

// 1. On every page load, restore the saved session, or reuse a session from
//    any app on the site.
const session = (await accounts.session.get()) ?? (await accounts.authorize())

// 2. Otherwise, the email form sends a code…
async function sendCode(address: string) {
  await accounts.email.sendCode({ email: address })
}

// 3. …and signs in with it, which authorizes the app's access key. A new
//    user's first Tempo Account is created on the way.
async function verifyCode(address: string, code: string) {
  await accounts.email.signIn({ code, email: address })
}

// 4. Signing out ends the session for every app on the site.
async function signOut() {
  await accounts.signOut({ everywhere: true })
}
```

1. [`accounts.session.get`](../api/Accounts.create.md#sessionget) reads the session that the instance saved in IndexedDB. [`accounts.authorize`](../api/Accounts.create.md#authorize) returns `undefined` for a visitor without a Tempo ID session.
2. [`email.sendCode`](../api/plugins.email.md#emailsendcode) emails a 6-digit code, with the same response for every address.
3. [`email.signIn`](../api/plugins.email.md#emailsignin) verifies the code, authorizes the access key, and sets the session with the user's Tempo Account. If the authorization fails, the user is signed in, the error's `signedIn` is `true`, and the instance empties its session.
4. [`accounts.signOut`](../api/Accounts.create.md#signout) empties the session. With `everywhere: true`, it also ends the Tempo ID session.

The page's origin must be the origin of one of the app's redirect URIs ([CORS](https://github.com/tempoxyz/id/blob/main/docs/apps.md#app-registry)). No page shows the access key, so its [`accessKey`](access-keys.md) names its limits and scopes, and fits the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), unless the app holds `tempo-id:sign`. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). A sign-in with `accessKey: false` signs in without an access key.

## Recipes

### Sign in with a passkey

`passkey.signIn` offers every passkey that the browser holds for the relying party of the app's realms, so the form needs no email. The page must be on that relying party's domain, such as `https://app.tempo.xyz` for `tempo.xyz`. If the passkey owns the Tempo Account, one assertion signs the user in and signs the access key.

A wallet.tempo passkey without an email returns the email step. The emailed-code sign-in with its `link` asks the passkey to sign again, then links it. An emailed-code sign-in without `link` asks the passkey that owns the account to sign the access key. If that passkey's relying party does not cover the page, either call throws `webauthn_required`, so finish through a redirect.

```ts
import { Accounts } from 'accounts'
import { email, passkey, redirect } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [passkey(), email(), redirect()] })

const result = await accounts.passkey.signIn().catch(approveOnPage)
if (result && 'step' in result) showEmailForm({ link: result.step.link })

// With the step's `link`, the passkey signs again, and Tempo ID links it.
const linked = await accounts.email
  .signIn({ code, email: address, link })
  .catch(approveOnPage)

function approveOnPage(error: unknown) {
  if (
    error instanceof Accounts.RequestError &&
    error.reason === 'webauthn_required'
  )
    return accounts.redirect.signIn()
  throw error
}
```

### Start the passkey ceremony at once

`passkey.prepare` requests the sign-in's options when the form shows, and returns a handle. The handle's `signIn` then starts the ceremony without a request. The handle checks that passkeys sign in on the page first, and never throws. Create a new handle when `accessKey` changes.

```ts
// Once the sign-in form shows:
const prepared = accounts.passkey.prepare()
if (await prepared.available) showPasskeyButton()

// On the passkey button:
const result = await prepared.signIn().catch(approveOnPage)
```

The handle uses its options once. It keeps them after a canceled ceremony, and requests new ones after a refusal or after 4 minutes.

### Upgrade a wallet.tempo passkey's wallet

On a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md), a wallet.tempo passkey's account waits for its upgrade. Each sign-in and `authorize` signs the access key as the passkey's own account, and returns `upgradeAvailable: true`. `accounts.account.upgrade` with the session's access key upgrades the account with one more prompt, such as right after the sign-in in the same click. Tempo ID registers the access key first, so it keeps working.

```ts
const session = await accounts.email.signIn({ code, email: address })
if (session.upgradeAvailable) await accounts.account.upgrade()
```

If the upgrade fails, such as when the user cancels the prompt, the access key still works until the account upgrades. Offer the upgrade again.

### Add a passkey after an emailed code

`passkey.register` adds a passkey for the signed-in user on the app's page, so a user who signed up with an emailed code signs in with the passkey next time. The page must be on the `default` realm's relying party domain, and the sign-in must be less than 10 minutes old. Call it from a click, since the user approves two prompts: the creation, then a proof with the new passkey.

With the session's `key`, the passkey joins the access key's cloud-wallet account as a second owner on the access key's chain, on a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#passkey-on-a-cloud-wallets-account). The account keeps its address, and the access key keeps signing with no prompt.

```ts
const session = await accounts.email.signIn({ code, email: address })

// On the "Add passkey" button:
await accounts.passkey.register({ key: session.key })
```

### Sign in without an access key

`accessKey: false` signs the user in with the tokens and the user alone, and authorizes no access key. An instance without `accessKey` requests no access key for any sign-in.

```ts
const session = await accounts.email.signIn({
  accessKey: false,
  code,
  email: address,
})
```

## Learn more

- [Redirect sign-in](redirect.md)
- [Access keys](access-keys.md)
- [`email`](../api/plugins.email.md)
- [`passkey`](../api/plugins.passkey.md)
- [Authentication](https://github.com/tempoxyz/id/blob/main/docs/authentication.md)
