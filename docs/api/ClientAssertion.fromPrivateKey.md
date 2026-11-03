# ClientAssertion.fromPrivateKey

## Overview

Returns a signer of [client assertions](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions) with the app's private key, for [`Id.from`](Id.from.md)'s `clientAssertion`. The instance then signs a new assertion for each request that authenticates the app, in place of a client secret. Only the app's backend holds the key.

## Usage

```ts
import { ClientAssertion, Id } from 'accounts'

const config = Id.from({
  clientAssertion: ClientAssertion.fromPrivateKey({
    privateKey: JSON.parse(process.env.TEMPO_ID_PRIVATE_KEY!),
  }),
  clientId: 'DkqRtYbW…',
})
```

## Return type

`ClientAssertion.Signer`

A function that takes `{ audience, clientId }` and returns a new signed assertion.

## Parameters

Takes the options of [`ClientAssertion.sign`](ClientAssertion.sign.md) without `audience` and `clientId`, which the instance passes: `algorithm`, `expiresIn`, `keyId`, and `privateKey`.

```ts
ClientAssertion.fromPrivateKey({ keyId: 'backend-2026-10', privateKey: jwk })
```
