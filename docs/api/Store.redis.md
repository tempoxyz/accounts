# Store.redis

## Overview

Returns a [`Store`](types.md#store) in Redis. Each value is stored as ox's `Json`, so a `bigint` survives. An entry with an expiry expires in Redis at `expiresAt`, through `SET` with `PXAT`, so the store needs Redis 6.2 or later.

## Usage

```ts
import { Accounts, Store } from 'accounts'
import { backend } from 'accounts/plugins'
import { createClient } from 'redis'

const redis = await createClient({ url: process.env.REDIS_URL }).connect()
const tempoId = Accounts.create({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  plugins: [backend({ store: Store.redis(redis) })],
})
```

## Return type

[`Store`](types.md#store)

The store. It sends `GET`, `SET`, and `DEL` with each key as it is, such as `tempo-id:session:<id>`.

## Parameters

### client

- **Type:** `{ sendCommand: (args: string[]) => Promise<unknown> }`

A Redis client that sends a raw command, such as a `redis` client. For `ioredis`, pass `{ sendCommand: (args) => client.call(...args) }`.

```ts
const store = Store.redis({ sendCommand: (args) => ioredis.call(...args) })
```

> [!WARNING]
> Use a Redis server with TLS and authentication. Each value holds a refresh token, and an access key's private key.
