# redirect

## Overview

The plugin of sign-in through a redirect to Tempo ID's pages, which adds `accounts.redirect.signIn` and `accounts.redirect.prefetch`. Tempo ID's pages sign the user in, show the access key's limits for approval, and redirect back with a code. The user approves the access key, so its limits may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).

The plugin runs in one of two modes:

| Mode           | `signIn`                                               | Completion                                                  |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------- |
| Without `open` | Leaves the page for Tempo ID's sign-in                 | `accounts.session.get()` on the redirect URI's page         |
| With `open`    | Shows the URL, such as in a system browser on a device | `signIn` itself, when `open` resolves with the callback URL |

With `open`, the system browser keeps its Tempo ID session after the app signs out, also with `everywhere`, since the logout sends the app's cookies, not the browser's. The plugin then sets a flag at the start of `signOut`, in the instance's `store`, and the next `signIn` requests `prompt=login`, so Tempo ID shows its sign-in page before it returns to the app. A sign-in without a sign-out before it, such as after the session expires, reuses the browser's session.

Without `open`, the plugin's `restore` hook completes the redirect at the first `session.get()` of a page load: it checks the callback's state, redeems its code once, and removes `code` and `state` from the address bar. Call `session.get()` before any routing that reads the URL.

## Usage

```ts
import { Accounts } from 'accounts'
import { redirect } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [redirect()] })

// On every page load, complete a redirect that returned here.
const session = await accounts.session.get()
if (!session) button.onclick = () => accounts.redirect.signIn()
```

## Return type

`Plugin<'redirect', { prefetch, signIn }>`

### redirect.prefetch

- **Type:** `() => Promise<readonly string[]>`

Prefetches the scripts and style sheets of Tempo ID's sign-in page, so the page that `signIn` opens loads them from the browser's cache. Returns their URLs. Outside a browser, it prefetches nothing. Never throws. Only a page on Tempo ID's site gains from it, since a browser partitions its cache by site.

```ts
void accounts.redirect.prefetch()
```

### redirect.signIn

- **Type:** `(parameters?: redirect.signIn.Parameters) => Promise<Session | undefined>`

Sends the user to Tempo ID's sign-in. Without `open`, the page leaves, and the promise resolves with `undefined`. With `open`, it builds the URL, redeems the callback, sets the instance's [session](types.md#session), and returns it. It returns `undefined` when `open` resolves with no URL, such as for a dismissed browser. The session holds no Tempo Account.

```ts
await accounts.redirect.signIn()
```

## Parameters

### open (optional)

- **Type:** `(url: string) => Promise<string | undefined>`

Shows the sign-in URL, such as in a system browser, and resolves with the callback URL, or with `undefined` when the user dismissed it. Without it, the page leaves for the URL.

```ts
import * as WebBrowser from 'expo-web-browser'

const accounts = Accounts.create({
  plugins: [
    redirect({
      async open(url) {
        const result = await WebBrowser.openAuthSessionAsync(url, redirectUri)
        return result.type === 'success' ? result.url : undefined
      },
    }),
  ],
  redirectUri,
})
```

### par (optional)

- **Type:** `boolean`
- **Default:** `true` with `clientSecret` or `clientAssertion`, and `false` otherwise

Whether each request goes to `POST /oauth2/par` first ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), so the URL holds only `client_id` and `request_uri`, as [Pushed authorization requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md) describes.

```ts
const accounts = Accounts.create({ plugins: [redirect({ par: true })] })
```

### redirect.signIn parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key.

```ts
await accounts.redirect.signIn({ accessKey: false })
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
await accounts.redirect.signIn({ challenge })
```

#### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account. After the approval, an account that holds less opens Tempo ID's funding page before the callback, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.

```ts
await accounts.redirect.signIn({ funding: { amount: '10', currency: 'USD' } })
```

## Errors

### `Accounts.RequestError`

Thrown by `signIn` with `open`, and by `session.get()` on the callback's page, when the callback carries no valid code, or the token endpoint refuses the code:

#### Requests

- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request exceeded a rate limit. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

#### Without a `reason`

- **`invalid_request`:** The callback's `state` does not match `pending`. Start sign-in again.
- **The callback's `error`:** The callback carries no `code`, such as `access_denied` after a denial. An access key that Tempo ID refuses before sign-in returns its own `error`, such as `invalid_authorization_details` for an access key that breaks a [rule](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#rules), or `unauthorized_client` for a `challenge` without the `tempo-id:sign` scope. `message` is the `error_description`.
- **`invalid_grant`:** The code was already redeemed, expired, or carried no key authorization. Only the first redemption, within 10 minutes of the approval, returns the access key. Start sign-in again.

Thrown by `signIn` without `open`, before the navigation, when `par` is `true` and `POST /oauth2/par` refuses a pushed request, with its `reason`: [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client), [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected), [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`body_too_large`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#body_too_large), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), or a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules)'s reason.

### `Accounts.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.

### `Accounts.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
