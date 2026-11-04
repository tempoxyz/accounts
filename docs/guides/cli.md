# CLIs

## Overview

A command-line tool signs in through the device grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) with the [`device`](../api/plugins.device.md) plugin. The user approves a code in any browser, and the CLI polls until they do. No redirect URI or local server is involved. [`Store.file`](../api/Store.file.md) saves the session, so each later run restores it.

```ts
import { Accounts, Store } from 'accounts'
import { device, viem } from 'accounts/plugins'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

const accounts = Accounts.create({
  // The CLI's access key may transfer up to 1,000 OUSD for a year.
  accessKey: () => ({
    expiry: '365d',
    limits: [{ limit: '1000', token: 'ousd' }],
  }),
  // 1. A CLI without a registration sends `cli:` and its name.
  clientId: 'cli:acme-deploy',
  plugins: [
    device({
      onCode: (code) =>
        console.log(
          `Open ${code.verificationUriComplete}, and confirm ${code.userCode}.`,
        ),
    }),
    viem(),
  ],
  // 4. The session saves to a file that only the user reads.
  store: Store.file('~/.config/acme-deploy/session.json'),
})

async function login() {
  // 2. Request a code, and show it. 3. Resolve once the user approves it.
  const { user } = await accounts.device.signIn()
  console.log(`Signed in as ${user.email}.`)
}

// Any other command restores the session, and sends with its access key.
async function send(to: `0x${string}`, amount: bigint) {
  if (!(await accounts.session.get())) throw new Error('Run `login` first.')
  await accounts.token.transferSync({ amount, to, token: ousd })
}
```

1. `clientId` names the app, whose realms the sign-in uses. An unregistered CLI sends `cli:` and its name, and the device page shows the name as an unverified app's, as [Unregistered CLIs](https://github.com/tempoxyz/id/blob/main/docs/apps.md#unregistered-clis) describes. Tempo ID's registered `tempo-cli` app serves any CLI, and a CLI for other realms names its own, such as `tempo-cli-cash`.
2. [`device.signIn`](../api/plugins.device.md#devicesignin) requests a code with the device's name and the access key, and passes it to `onCode`. `accessKey` names `expiry`, `limits`, and `scopes`, which may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).
3. The user opens `verificationUriComplete`, and signs in on the page that shows the code beside the access key's limits, which approves it. The code is 8 consonants in two groups of four, such as `BCDF-GHJK`, and expires after 10 minutes. The sign-in polls at the interval that Tempo ID sets, then sets the session.
4. The access key is a secp256k1 private key, so the file has mode `0600`. [`session.get`](../api/Accounts.create.md#sessionget) reads it in each later run, and empties a session whose access key expired.

[`examples/cli`](../../examples/cli/index.ts) runs this flow with `login`, `whoami`, `send`, and `logout` commands.

## Recipes

### Sign out

[`accounts.signOut`](../api/Accounts.create.md#signout) empties the saved session, and revokes its refresh token. The CLI holds no Tempo ID session cookie, so the revocation ends its session.

```ts
await accounts.signOut()
```

### Handle a denial or an expired code

`device.signIn` throws an [`Accounts.RequestError`](../api/Accounts.RequestError.md) when the user denies the code, or it expires.

```ts
const session = await accounts.device.signIn().catch((error: unknown) => error)
if (session instanceof Accounts.RequestError) console.error(session.message)
```

## Learn more

- [Sessions](sessions.md)
- [`device`](../api/plugins.device.md)
- [Device grant](https://github.com/tempoxyz/id/blob/main/docs/device-grant.md)
- [Authentication](https://github.com/tempoxyz/id/blob/main/docs/authentication.md)
- [Tempo ID CLI](https://github.com/tempoxyz/id/blob/main/docs/cli.md#sign-in), whose `tempo-id login` uses this flow
