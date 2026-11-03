# Session.expired

## Overview

Returns whether the session's access key expired, as [`AccessKey.expired`](AccessKey.expired.md) does for its access key. A session without an access key never expires here, since its tokens refresh. [`tempoId.session.get()`](Id.create.md#sessionget) already empties a saved session whose access key expired.

## Usage

```ts
import { Session } from 'accounts'

const session = await tempoId.session.get()
// A session can expire while the page stays open.
if (session && Session.expired(session)) await tempoId.signOut()
```

## Return type

`boolean`

`true` when the access key's authorization names an expiry that passed.

## Parameters

### session

- **Type:** [`Session`](types.md#session)

The session to check.

```ts
const expired = Session.expired(session)
```
