# API reference

Each page documents one export of `accounts` or one of its entries. An app creates an instance with [`Accounts.create`](Accounts.create.md), and each plugin adds a namespace of actions to it. The errors leave out `body_too_large`, `cross_site_request`, and `malformed_body`, which the package's own requests do not cause.

| Entry                 | Exports                                                                        |
| --------------------- | ------------------------------------------------------------------------------ |
| `accounts`            | `Accounts`, `Permissions`, `Plugin`, `Session`, `Store`                        |
| `accounts/plugins`    | `backend`, `device`, `dialog`, `email`, `passkey`, `redirect`, `relay`, `viem` |
| `accounts/react`      | `react`                                                                        |
| `accounts/expo`       | `expo`                                                                         |
| `accounts/mpp`        | `mpp` and `mpp.MaxAmountError`                                                 |
| `accounts/cloudflare` | `Accounts`, `DurableObject`, `Plugin`, `Store`                                 |
| `accounts/wagmi`      | `tempoId`, `wagmi`, and their error classes                                    |

## Accounts

- [`Accounts.create`](Accounts.create.md): Creates an instance: its configuration, its session, and the namespace of each plugin.
- [`Accounts.from`](Accounts.from.md): Returns an instance's configuration, with its defaults, without an instance.
- [`Accounts.RequestError`](Accounts.RequestError.md): The error of every refused request.
- [Error classes](errors.md): The other errors of each module, such as `Accounts.SupersededError`.

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

- [`react`](react.react.md): From `accounts/react`, adds `accounts.useSession()`, which returns the session's status and the session to show, and renders again at each change.
- [`expo`](plugins.expo.md): The preset of an Expo app: the secure store, and the sign-in in the system browser.

## wagmi

- [`tempoId`](wagmi.tempoId.md): A wagmi connector whose wallet is a Tempo ID instance, from `accounts/wagmi`.
- [`wagmi`](wagmi.wagmi.md): A plugin that adds `accounts.wagmi`, a wagmi config whose connector is the instance itself.

## MPP

- [`mpp`](mpp.mpp.md): From `accounts/mpp`, adds `accounts.fetch` and `accounts.mpp`, which pay MPP endpoints with the session's access key.

## Cloudflare

- [`DurableObject.sessions`](DurableObject.sessions.md): Returns a Durable Object class that holds a backend's sessions, one object for each session ID.

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

## Types

[Types](types.md) documents each type that an instance takes or returns: [`AccessKey`](types.md#accesskey), [`BackendSession`](types.md#backendsession), [`Config`](types.md#config), [`Dpop`](types.md#dpop), [`Funding`](types.md#funding), [`Permissions`](types.md#permissions), [`Session`](types.md#session), [`Store`](types.md#store), [`TempoAccount`](types.md#tempoaccount), [`Tokens`](types.md#tokens), and [`User`](types.md#user).
