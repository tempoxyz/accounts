# Dpop.create

## Overview

Generates a [DPoP key](https://github.com/tempoxyz/id/blob/main/docs/dpop.md): an ECDSA P-256 key pair whose private key signs each proof with ES256. With the key as the instance's [`dpop`](Accounts.from.md#dpop-optional), each token request sends a proof, and Tempo ID issues `DPoP` tokens that work only with a proof from the same key.

The private key is non-extractable by default, so no script can read its bytes. A browser keeps it in IndexedDB, which stores a `CryptoKey` as it is.

## Usage

```ts
import { Accounts } from 'accounts'
import { Actions, Dpop } from 'accounts/internal'

const dpop = (await store.get('dpop')) ?? (await Dpop.create())
await store.set('dpop', dpop)

const config = Accounts.from({ clientId: 'tempo-cli', dpop })
const tokens = await Actions.refresh(config, { refreshToken })
```

## Return type

[`Dpop.Dpop`](types.md#dpop)

## Parameters

### extractable (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether `crypto.subtle.exportKey` can export the private key, such as for a CLI that writes the key to a file between runs.

```ts
const dpop = await Dpop.create({ extractable: true })
const jwk = await crypto.subtle.exportKey('jwk', dpop.privateKey)
```
