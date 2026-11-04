# Dpop.fromKeyPair

## Overview

Returns the [DPoP key](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) of a WebCrypto P256 key pair, such as the one that a browser app creates for its access key. One non-extractable key pair then signs both transactions and proofs, so the app stores one key in place of two.

The app creates the pair before the sign-in. It passes the pair's account as the sign-in's `accessKey`, and this key as the instance's [`dpop`](Accounts.from.md#dpop-optional), so the sign-in's redemption binds the tokens to the same pair. The tokens then work only until the app replaces the pair. Outside a browser, create a key with [`Dpop.create`](Dpop.create.md).

## Usage

```ts
import { Accounts, Actions, Dpop } from 'accounts'
import { WebCryptoP256 } from 'ox'
import { Account } from 'viem/tempo'

const keyPair =
  (await store.get('keyPair')) ?? (await WebCryptoP256.createKeyPair())
await store.set('keyPair', keyPair)

const config = Accounts.from({
  clientId: 'client_…',
  dpop: Dpop.fromKeyPair(keyPair),
})
const authorization = await Actions.email.signIn(config, {
  accessKey: Account.fromWebCryptoP256(keyPair),
  code,
  email,
})
```

## Return type

[`Dpop.Dpop`](types.md#dpop)

## Parameters

### keyPair

- **Type:** `WebCryptoP256.createKeyPair.ReturnType`

A key pair from ox's `WebCryptoP256.createKeyPair`, whose private key is a non-extractable `CryptoKey`.
