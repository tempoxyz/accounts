# API reference

Each page documents one export of `accounts` or one of its entries. An app creates an instance with [`Id.create`](Id.create.md), and each plugin adds a namespace of actions to it. The low-level [`Actions`](Actions.md) take the instance's configuration, for an app that keeps its state itself. The errors leave out `body_too_large`, `cross_site_request`, and `malformed_body`, which the package's own requests do not cause.

| Entry                 | Exports                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts`            | `AccessKey`, `AccessToken`, `Actions`, `ClientAssertion`, `Dpop`, `Id`, `LogoutToken`, `Permissions`, `Plugin`, `Session`, `Store`, `TempoAccount`, `Tokens` |
| `accounts/internal`   | `Authorization`, `Funding`, `Pending`, `User`, the types that the actions build and return                                                                   |
| `accounts/plugins`    | `backend`, `device`, `dialog`, `email`, `passkey`, `redirect`, `relay`, `viem`                                                                               |
| `accounts/react`      | `react`                                                                                                                                                      |
| `accounts/expo`       | `expo`                                                                                                                                                       |
| `accounts/mpp`        | `mpp` and `mpp.MaxAmountError`                                                                                                                               |
| `accounts/cloudflare` | `DurableObject`, `Id`, `Plugin`, `Store`                                                                                                                     |
| `accounts/wagmi`      | `tempoId`, `wagmi`, and their error classes                                                                                                                  |

## Id

- [`Id.create`](Id.create.md): Creates an instance: its configuration, its session, and the namespace of each plugin.
- [`Id.from`](Id.from.md): Returns the configuration that every action of `Actions` takes, without an instance.
- [`Id.RequestError`](Id.RequestError.md): The error of every refused request.
- [Error classes](errors.md): The other errors of each module, such as `Id.SupersededError`.

## Plugins

Each plugin comes from `accounts/plugins`, and adds the namespace of its name.

- [`backend`](plugins.backend.md): A backend's sessions, one for each user, under a session ID in a cookie.
- [`device`](plugins.device.md): Sign-in with the device grant, such as for a CLI.
- [`dialog`](plugins.dialog.md): Sign-in on Tempo ID's pages in a dialog on the page, or in a popup.
- [`email`](plugins.email.md): Sign-in with an emailed code, in the app's own UI.
- [`funding`](plugins.funding.md): Tempo ID's deposit page for the session's account, which every instance holds.
- [`passkey`](plugins.passkey.md): Sign-in with a passkey in the app's own UI, and the registration of one.
- [`redirect`](plugins.redirect.md): Sign-in through a redirect to Tempo ID's pages.
- [`relay`](plugins.relay.md): The handler of the app's relay route, whose fee payer pays the fees of its pages' transactions.
- [`viem`](plugins.viem.md): A Viem client whose account follows the session.
- [`Plugin.from`](Plugin.from.md): Defines a plugin of the app's own.

## React

- [`react`](react.react.md): From `accounts/react`, adds `tempoId.useSession()`, which returns the session's status and the session to show, and renders again at each change.
- [`expo`](plugins.expo.md): The preset of an Expo app: the secure store, and the sign-in in the system browser.

## wagmi

- [`tempoId`](wagmi.tempoId.md): A wagmi connector whose wallet is a Tempo ID instance, from `accounts/wagmi`.
- [`wagmi`](wagmi.wagmi.md): A plugin that adds `tempoId.wagmi`, a wagmi config whose connector is the instance itself.

## MPP

- [`mpp`](mpp.mpp.md): From `accounts/mpp`, adds `tempoId.fetch` and `tempoId.mpp`, which pay MPP endpoints with the session's access key.

## Cloudflare

- [`DurableObject.sessions`](DurableObject.sessions.md): Returns a Durable Object class that holds a backend's sessions, one object for each session ID.

## Actions

- [`Actions`](Actions.md): The low-level actions, and the instance member or plugin action that calls each.

The actions that every flow shares:

- [`Actions.account.get`](Actions.account.get.md): Returns the user's Tempo Account for the app, with its realm.
- [`Actions.account.revokeAccessKey`](Actions.account.revokeAccessKey.md): Revokes an access key of the user's account, with the user's cloud wallet.
- [`Actions.account.signMessage`](Actions.account.signMessage.md): Signs a message as the user's configurable account, with the user's cloud wallet.
- [`Actions.account.signTypedData`](Actions.account.signTypedData.md): Signs EIP-712 typed data as the user's configurable account, with the user's cloud wallet.
- [`Actions.account.updateAccessKey`](Actions.account.updateAccessKey.md): Changes the limits or scopes of an access key of the user's account, with the user's cloud wallet, headlessly or on Tempo ID's approval page.
- [`Actions.account.upgrade`](Actions.account.upgrade.md): Upgrades a wallet.tempo passkey's account from the app's page, and keeps its access key.
- [`Actions.authorize`](Actions.authorize.md): Authorizes the app for a user already signed in.
- [`Actions.fetch`](Actions.fetch.md): Sends a request with an access token, with a DPoP proof for a DPoP token.
- [`Actions.refresh`](Actions.refresh.md): Exchanges a refresh token for new tokens.
- [`Actions.signOut`](Actions.signOut.md): Ends the user's Tempo ID session.

The actions of each sign-in flow:

- [`Actions.backend.email.sendCode`](Actions.backend.email.sendCode.md): Emails the user a sign-in code from the app's backend.
- [`Actions.backend.email.signIn`](Actions.backend.email.signIn.md): Signs the user in with an emailed code from the app's backend.
- [`Actions.device.authorize`](Actions.device.authorize.md): Starts the device grant for a CLI.
- [`Actions.dialog.callback`](Actions.dialog.callback.md): Posts a popup's callback to the page that opened it, and closes the popup.
- [`Actions.dialog.preload`](Actions.dialog.preload.md): Loads the dialog's frame hidden, so a later sign-in shows at once.
- [`Actions.dialog.signIn`](Actions.dialog.signIn.md): Signs the user in on Tempo ID in a dialog on the page, or in a popup.
- [`Actions.email.sendCode`](Actions.email.sendCode.md): Emails the user a sign-in code.
- [`Actions.email.signIn`](Actions.email.signIn.md): Signs the user in with an emailed code, and authorizes the app.
- [`Actions.funding.complete`](Actions.funding.complete.md): Returns the result of a deposit page that returned through a redirect.
- [`Actions.funding.open`](Actions.funding.open.md): Opens Tempo ID's deposit page for one of the user's accounts, in a popup or through a redirect.
- [`Actions.passkey.available`](Actions.passkey.available.md): Returns whether a passkey sign-in runs on the page.
- [`Actions.passkey.prepare`](Actions.passkey.prepare.md): Prepares a passkey sign-in before the user acts, and returns its handle.
- [`Actions.passkey.register`](Actions.passkey.register.md): Registers a passkey for the signed-in user from the app's page.
- [`Actions.passkey.signIn`](Actions.passkey.signIn.md): Signs the user in with a passkey, and authorizes the app.
- [`Actions.realm.list`](Actions.realm.list.md): Lists the realms that the app reaches.
- [`Actions.redirect.complete`](Actions.redirect.complete.md): Finishes a `redirect.start` on the page that the browser returns to.
- [`Actions.redirect.createUrl`](Actions.redirect.createUrl.md): Returns the sign-in URL and the state to keep.
- [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md): Redeems a redirect's callback for an authorization.
- [`Actions.redirect.prefetch`](Actions.redirect.prefetch.md): Prefetches the sign-in page's scripts and style sheets before a redirect.
- [`Actions.redirect.start`](Actions.redirect.start.md): Sends the browser to Tempo ID's pages to sign in.

The standard OAuth endpoints, for tokens that the app holds:

- [`Actions.oauth.introspect`](Actions.oauth.introspect.md): Checks whether a token is active.
- [`Actions.oauth.jwks`](Actions.oauth.jwks.md): Returns the signing keys that verify every token.
- [`Actions.oauth.userInfo`](Actions.oauth.userInfo.md): Returns the user that an access token names.

## AccessKey

- [`AccessKey.expired`](AccessKey.expired.md): Returns whether an access key's authorization expired.
- [`AccessKey.toAccount`](AccessKey.toAccount.md): Returns a stored access key as a Viem access key account.

## AccessToken

- [`AccessToken.create`](AccessToken.create.md): Creates a verifier of the app's access tokens, for an API.
- [`AccessToken.includes`](AccessToken.includes.md): Returns whether an address is one of a verified token's Tempo Accounts.

## ClientAssertion

- [`ClientAssertion.fromPrivateKey`](ClientAssertion.fromPrivateKey.md): Returns a signer of client assertions for the `clientAssertion` option.
- [`ClientAssertion.sign`](ClientAssertion.sign.md): Signs one client assertion with the app's private key.

## Dpop

- [`Dpop.create`](Dpop.create.md): Generates a DPoP key, whose proofs bind the app's tokens.
- [`Dpop.fromKeyPair`](Dpop.fromKeyPair.md): Returns the DPoP key of the access key's WebCrypto P256 key pair.
- [`Dpop.proof`](Dpop.proof.md): Returns a DPoP proof for one request.

## LogoutToken

- [`LogoutToken.create`](LogoutToken.create.md): Creates a verifier of the logout tokens that Tempo ID posts to the app's backend.

## Permissions

- [`Permissions.resolve`](Permissions.resolve.md): Returns permissions as the key authorization request sends them, with the scopes that the limits fill.

## Session

- [`Session.expired`](Session.expired.md): Returns whether a session's access key expired.

## Store

- [`Store.durableObject`](Store.durableObject.md): Returns a store in a Durable Object's storage, whose alarm deletes expired entries.
- [`Store.file`](Store.file.md): Returns a store in one JSON file of the user's, such as a CLI's session.
- [`Store.memory`](Store.memory.md): Returns a store in the process's memory, for one process.
- [`Store.postgres`](Store.postgres.md): Returns a store in a Postgres table.
- [`Store.redis`](Store.redis.md): Returns a store in Redis.

## TempoAccount

- [`TempoAccount.deserialize`](TempoAccount.deserialize.md): Rebuilds a stored Tempo Account with no request.
- [`TempoAccount.serialize`](TempoAccount.serialize.md): Returns a Tempo Account as JSON to store.

## Types

[Types](types.md) documents each type and its `from`: [`Authorization`](types.md#authorization), [`Config`](types.md#config), [`Dpop`](types.md#dpop), [`Funding`](types.md#funding), [`AccessKey`](types.md#accesskey), [`Pending`](types.md#pending), [`Permissions`](types.md#permissions), [`Permissions.WithAccount`](types.md#permissionswithaccount), [`Session`](types.md#session), [`Store`](types.md#store), [`TempoAccount`](types.md#tempoaccount), [`Tokens`](types.md#tokens), and [`User`](types.md#user).
