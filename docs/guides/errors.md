# Errors

## Overview

Every request that Tempo ID refuses throws an [`Id.RequestError`](../api/Id.RequestError.md), whose fields an app branches on. A sign-in that fails after Tempo ID signed the user in has `signedIn: true`, and the instance empties its session.

```ts
import { Id } from 'accounts'

async function verifyCode(address: string, code: string) {
  try {
    return await tempoId.email.signIn({ code, email: address })
  } catch (error) {
    if (!(error instanceof Id.RequestError)) throw error

    // 1. Branch on the refusal's `reason`.
    if (error.reason === 'invalid_code')
      return showError('That code is wrong or expired. Request a new code.')
    // 2. Retry a temporary failure later.
    if (error.code === 'temporarily_unavailable')
      return showError('Sign-in is busy. Try again in a minute.')
    // 3. Show any other refusal's message.
    return showError(error.message)
  }
}
```

1. `reason` is a stable name for the refusal. [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reasons) lists every reason.
2. `code` is the OAuth error code. `rate_limited` and `upstream_unavailable` share `temporarily_unavailable`.
3. `message` states the fault and its fix. `field` names the request field at fault, and `meta` holds the values that the refusal compared.

Each API page lists, under Errors, the reasons that its function throws and its own error classes, such as `Id.KeyRequiredError`. [Error classes](../api/errors.md) lists every class.

## Recipes

### Show a limit's maximum

An access key over the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling) fails with `limit_exceeds_maximum` or `expiry_exceeds_maximum`. For a limit, `meta.maximum` is in base units, as a decimal string. Sign in on Tempo ID's pages instead, with a [dialog or a redirect](redirect.md) or the [device grant](cli.md), where the user approves any limit.

```ts
try {
  await tempoId.authorize({
    accessKey: {
      expiry: Expiry.days(30),
      limits: [{ limit: 5_000_000_000n, token: ousd }],
      scopes: [Scopes.tip20(ousd).transfer()],
    },
  })
} catch (error) {
  if (
    error instanceof Id.RequestError &&
    error.reason === 'limit_exceeds_maximum'
  )
    showMaximum(error.meta?.maximum)
}
```

### Ignore an overtaken sign-in

A sign-in that another sign-in or a sign-out overtook throws [`Id.SupersededError`](../api/errors.md#idsupersedederror), such as a second click on a sign-in button. The instance keeps the newer session, so the app renders that one.

```ts
await tempoId.dialog.signIn().catch((error: unknown) => {
  if (error instanceof Id.SupersededError) return
  throw error
})
```

## Learn more

- [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md)
- [`Id.RequestError`](../api/Id.RequestError.md)
- [Error classes](../api/errors.md)
