# AccessKey.toAccount

## Overview

Returns a stored access key as a Viem access key account for its Tempo Account. The account attaches the access key's authorization to transactions until the chain registers the access key.

## Usage

```ts
import { AccessKey } from 'accounts'

const account = AccessKey.toAccount(saved.key)
await client.token.transferSync({ account, amount, to, token })
```

## Return type

`Account.AccessKeyAccount`, from `viem/tempo`

## Parameters

### key

- **Type:** [`AccessKey.AccessKey`](types.md#accesskey)

The stored access key, such as an authorization's `key`.

```ts
const account = AccessKey.toAccount(saved.key)
```

### accessKey (optional)

- **Type:** `Account.Account`, from `viem/tempo`

The app's own access key that the app supplied to the sign-in as `accessKey.account`, which then signs. An access key without material requires it.

```ts
const accessKeyAccount = AccessKey.toAccount(saved.key, { accessKey: account })
```

## Errors

### `AccessKey.AccessKeyRequiredError`

Thrown when the access key carries no material and the call passes no `accessKey`.
