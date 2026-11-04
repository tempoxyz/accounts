# Guides

Each guide opens with an overview, then lists recipes for its tasks.

## Sign-in flows

Every flow sets the same [session](../api/types.md#session) on the instance, and returns it. A sign-in requests an access key only with `accessKey`, its own or the instance's. In a custom UI, the access key must fit the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), unless the app holds `tempo-id:sign`. In every other flow, the user approves the access key's limits on a page, so they may exceed it.

| Guide                             | For                                 | Plugins                | Sign-in UI                                                 |
| --------------------------------- | ----------------------------------- | ---------------------- | ---------------------------------------------------------- |
| [Redirect sign-in](redirect.md)   | A browser app                       | `dialog`, `redirect`   | Tempo ID's pages, in a dialog, a popup, or the same window |
| [Custom sign-in UI](custom-ui.md) | A first-party web page              | `email`, `passkey`     | The app's own                                              |
| [Mobile apps](mobile.md)          | A React Native or Expo app          | `redirect` with `open` | Tempo ID's pages                                           |
| [Backends](backend.md)            | A server that holds a client secret | `backend`, `email`     | Tempo ID's pages, or the app's own UI with backend sign-in |
| [CLIs](cli.md)                    | A command-line tool                 | `device`               | Any browser                                                |

## Tasks after sign-in

- [Access keys](access-keys.md): access key permissions, passkey-owned accounts, and challenges.
- [Sessions](sessions.md): the saved session, token refresh, and sign-out.
- [React](react.md): the session in a React render, with `accounts.useSession()`.
- [MPP payments](mpp.md): charges and sessions of MPP endpoints, paid with the access key through the `mpp` plugin.
- [Viem](viem.md): the client of the `viem` plugin, and its chains.
- [wagmi](wagmi.md): the `wagmi` plugin and the `tempoId` connector, which connect a wagmi app through Tempo ID.
- [Errors](errors.md): refusals and recovery.
