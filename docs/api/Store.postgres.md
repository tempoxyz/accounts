# Store.postgres

## Overview

Returns a [`Store`](types.md#store) in a Postgres table, which it creates on first use. Each value is stored as ox's `Json`, so a `bigint` survives. A read skips an expired row, and a write with an expiry deletes the expired rows.

## Usage

```ts
import { Accounts, Store } from 'accounts'
import { backend } from 'accounts/plugins'
import { Pool } from 'pg'

const tempoId = Accounts.create({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
  plugins: [
    backend({
      store: Store.postgres(
        new Pool({ connectionString: process.env.DATABASE_URL }),
      ),
    }),
  ],
})
```

## Return type

[`Store`](types.md#store)

The store. The table holds `key text primary key`, `value text not null`, and `expires_at bigint`, in milliseconds.

## Parameters

### client

- **Type:** `{ query: (text: string, values: readonly unknown[]) => Promise<{ rows: readonly unknown[] }> }`

A Postgres client with positional parameters, such as a `pg` pool or client. For `postgres`, pass `{ query: async (text, values) => ({ rows: await sql.unsafe(text, values) }) }`.

```ts
const store = Store.postgres(
  new Pool({ connectionString: process.env.DATABASE_URL }),
)
```

### table (optional)

- **Type:** `string`
- **Default:** `'tempo_id_store'`

The table, optionally with its schema, such as `auth.sessions`. Each part holds only letters, digits, and underscores.

```ts
const store = Store.postgres(pool, { table: 'auth.sessions' })
```

## Errors

### `Error`

The `table` is not a table name, or a schema and a table name. The function throws before any query.

> [!WARNING]
> Do not expose the table to other roles. Each row holds a refresh token, and an access key's private key.
