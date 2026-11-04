# CLIs

## Overview

A command-line tool signs in through the device grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) with the [`device`](../api/plugins.device.md) plugin. The user approves a code in any browser, and the CLI polls until they do. No redirect URI or local server is involved. [`Store.file`](../api/Store.file.md) saves the session, so each later run restores it.

```ts
import { Accounts, Store } from 'accounts'
import { device, viem } from 'accounts/plugins'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

const tempoId = Accounts.create({
  // The CLI's access key may transfer up to 1,000 OUSD for a year.
  accessKey: () => ({
    expiry: Expiry.days(365),
    limits: [{ limit: 1_000_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
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
  const { user } = await tempoId.device.signIn()
  console.log(`Signed in as ${user.email}.`)
}

// Any other command restores the session, and sends with its access key.
async function send(to: `0x${string}`, amount: bigint) {
  if (!(await tempoId.session.get())) throw new Error('Run `login` first.')
  await tempoId.token.transferSync({ amount, to, token: ousd })
}
```

1. `clientId` names the app, whose realms the sign-in uses. An unregistered CLI sends `cli:` and its name, and the device page shows the name as an unverified app's, as [Unregistered CLIs](https://github.com/tempoxyz/id/blob/main/docs/apps.md#unregistered-clis) describes. Tempo ID's registered `tempo-cli` app serves any CLI, and a CLI for other realms names its own, such as `tempo-cli-cash`.
2. [`device.signIn`](../api/plugins.device.md#devicesignin) requests a code with the device's name and the access key, and passes it to `onCode`. `accessKey` names `expiry`, `limits`, and `scopes`, which may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).
3. The user opens `verificationUriComplete`, and signs in on the page that shows the code beside the access key's limits, which approves it. The code is 8 consonants in two groups of four, such as `BCDF-GHJK`, and expires after 10 minutes. The sign-in polls at the interval that Tempo ID sets, then sets the session.
4. The access key is a secp256k1 private key, so the file has mode `0600`. [`session.get`](../api/Accounts.create.md#sessionget) reads it in each later run, and empties a session whose access key expired.

[`examples/cli`](../../examples/cli/index.ts) runs this flow with `login`, `whoami`, `send`, and `logout` commands.

## Recipes

### Sign out

[`tempoId.signOut`](../api/Accounts.create.md#signout) empties the saved session, and revokes its refresh token. The CLI holds no Tempo ID session cookie, so the revocation ends its session.

```ts
await tempoId.signOut()
```

### Handle a denial or an expired code

`device.signIn` throws an [`Accounts.RequestError`](../api/Accounts.RequestError.md) when the user denies the code, or it expires.

```ts
const session = await tempoId.device.signIn().catch((error: unknown) => error)
if (session instanceof Accounts.RequestError) console.error(session.message)
```

### Name the device

The approval page shows the device's name. The name defaults to the machine's hostname. The low-level [`Actions.device.authorize`](../api/Actions.device.authorize.md#device-optional) takes `device`, at most 64 characters, to set another. It returns the authorization, which the app keeps itself.

```ts
import { Actions } from 'accounts'

const grant = await Actions.device.authorize(tempoId.config, {
  accessKey: permissions,
  device: 'build-server',
})
console.log(`Open ${grant.verificationUriComplete}.`)
const authorization = await grant.wait()
```

### Bind the tokens to a key

Pass a DPoP key as `dpop`, so the code's redemption and each refresh send a [DPoP proof](https://github.com/tempoxyz/id/blob/main/docs/dpop.md). The refresh token works only with the key that it is bound to, so a CLI that refreshes in a later run keeps the key between runs. Create an extractable key once, and write its private JWK beside the session, as securely as the refresh token. In a later run, import the JWK and pass it to `Dpop.from`.

```ts
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import { Dpop } from 'accounts'

const path = `${os.homedir()}/.config/my-cli/dpop.json`
const algorithm = { name: 'ECDSA', namedCurve: 'P-256' }

const dpop = await (async () => {
  const saved = await fs.readFile(path, 'utf8').catch(() => undefined)
  if (saved) {
    const jwk = JSON.parse(saved) as JsonWebKey
    const privateKey = await crypto.subtle.importKey(
      'jwk',
      jwk,
      algorithm,
      false,
      ['sign'],
    )
    return Dpop.from({
      jwk: { crv: jwk.crv!, kty: jwk.kty!, x: jwk.x!, y: jwk.y! },
      privateKey,
    })
  }
  const created = await Dpop.create({ extractable: true })
  const jwk = await crypto.subtle.exportKey('jwk', created.privateKey)
  await fs.writeFile(path, JSON.stringify(jwk), { mode: 0o600 })
  return created
})()

const tempoId = Accounts.create({
  clientId: 'tempo-cli',
  dpop,
  plugins: [device({ onCode })],
  store: Store.file('~/.config/my-cli/session.json'),
})
```

## Learn more

- [Sessions](sessions.md)
- [`device`](../api/plugins.device.md)
- [Device grant](https://github.com/tempoxyz/id/blob/main/docs/device-grant.md)
- [Authentication](https://github.com/tempoxyz/id/blob/main/docs/authentication.md)
- [Tempo ID CLI](https://github.com/tempoxyz/id/blob/main/docs/cli.md#sign-in), whose `tempo-id login` uses this flow
