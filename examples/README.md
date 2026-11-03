# Examples

Each example is a small app that signs in with Tempo ID through `accounts`, and sends OUSD on Tempo testnet with the access key of the sign-in. The examples hold no configuration beyond Tempo ID's URL. [`playgrounds/`](../playgrounds) holds the configurable apps that the end-to-end tests drive.

| Example                | Sign-in                                     | Client ID                                   |
| ---------------------- | ------------------------------------------- | ------------------------------------------- |
| [`web`](web)           | A dialog on the page                        | The page's origin, with no registration     |
| [`backend`](backend)   | A redirect, with the session on the server  | A registered app with a client secret       |
| [`cli`](cli)           | The device grant, with a code in a browser  | `cli:tempo-example`, with no registration   |
| [`mobile`](mobile)     | A redirect in the system browser            | A registered native app with a URL scheme   |
| [`wagmi`](wagmi)       | A dialog on the page, through wagmi's `connect` | The page's origin, with no registration |

Each example signs in to `http://localhost:5173` by default, as `pnpm dev:app` in `tempoxyz/id` serves Tempo ID, and its README names the variable for another deployment. Each example is a standalone project: copy its folder, install its dependencies, and run it.
