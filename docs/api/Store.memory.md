# Store.memory

## Overview

Returns a [`Store`](types.md#store) that holds each value in the process's memory. A read skips an expired entry, and each write deletes the expired entries. A restart loses every value, so it serves one process, such as in development or tests.

## Usage

```ts
import { Accounts, Store } from 'accounts'
import { backend } from 'accounts/plugins'

const tempoId = Accounts.create({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  plugins: [backend({ store: Store.memory() })],
})
```

## Return type

[`Store`](types.md#store)

The store, which keeps each value as it is, without serializing it.
