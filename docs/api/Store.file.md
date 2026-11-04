# Store.file

## Overview

Returns a [`Store`](types.md#store) in one JSON file of the user's, such as a CLI's session. Outside a browser, an instance holds a session only with a store, so a CLI passes this one to [`Accounts.create`](Accounts.create.md#configuration).

Each write replaces the file atomically with mode `0600`, in a folder with mode `0700`, so a crash leaves the earlier file, and no other user reads it. Writes run in order. Each write reads and replaces the file while it holds a lock file beside it, `<path>.lock`, so the writes of several processes, such as two runs of a CLI, never overwrite each other. A lock older than 10 seconds belongs to a process that ended without releasing it, and the next write removes it. Each value is stored as ox's `Json`, so a `bigint` survives. A read skips an expired entry, and a write deletes the expired entries. The Node modules load on first use, so a browser bundle holds none of them.

## Usage

```ts
import { Accounts, Store } from 'accounts'
import { device } from 'accounts/plugins'

const tempoId = Accounts.create({
  clientId: 'cli:acme-deploy',
  plugins: [device({ onCode })],
  store: Store.file('~/.config/acme-deploy/session.json'),
})
```

## Return type

[`Store`](types.md#store)

The store.

## Parameters

### path

- **Type:** `string`

The file's path. A path that starts with `~/` starts in the user's home directory. The first write creates the file and its folders.

```ts
const store = Store.file('~/.config/acme-deploy/session.json')
```

> [!WARNING]
> Keep the file in the user's own folder. It holds a refresh token, and an access key's private key.
