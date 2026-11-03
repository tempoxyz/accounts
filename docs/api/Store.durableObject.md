# Store.durableObject

## Overview

Returns a [`Store`](types.md#store) in a Durable Object's storage, which keeps each value as it is. An entry with an expiry sets the object's alarm to the earliest expiry. The object's `alarm` handler calls the returned `alarm`, which deletes the expired entries and sets the alarm for the next one. A read skips an expired entry before the alarm runs. [`DurableObject.sessions`](DurableObject.sessions.md) keeps each session in one, so an app needs this store only for a Durable Object of its own.

## Usage

```ts
import { Store } from 'accounts'
import { DurableObject } from 'cloudflare:workers'

export class Cache extends DurableObject<Env> {
  store = Store.durableObject(this.ctx.storage)

  // An entry with an expiry sets the alarm that deletes it.
  alarm() {
    return this.store.alarm()
  }
}
```

## Return type

[`Store`](types.md#store) with `alarm`.

### alarm

- **Type:** `() => Promise<void>`

Deletes the entries whose expiry passed, and sets the alarm for the earliest expiry left. An alarm can fire more than once, so a second call deletes nothing new.

## Parameters

### storage

- **Type:** `DurableObjectStorage`

The object's `ctx.storage`. The store calls `delete`, `get`, `getAlarm`, `list`, `put`, and `setAlarm` on it. It keeps each value under a key that starts with `value:`, and each expiry under a key that starts with `expires:`.

```ts
const store = Store.durableObject(this.ctx.storage)
```
