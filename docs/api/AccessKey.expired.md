# AccessKey.expired

## Overview

Returns whether an access key's authorization expired, so a new sign-in must authorize a new access key.

## Usage

```ts
import { AccessKey } from 'accounts'

if (AccessKey.expired(saved.key)) await signInAgain()
```

## Return type

`boolean`

`true` once the access key's `expiry` is in the past. An access key whose `expiry` is 0 or absent never expires, such as one requested with `expiry: false`.

## Parameters

### key

- **Type:** [`AccessKey.AccessKey`](types.md#accesskey)

The stored access key, such as an authorization's `key`.

```ts
if (AccessKey.expired(saved.key)) await signInAgain()
```
