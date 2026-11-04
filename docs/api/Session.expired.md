# Session.expired

## Overview

Returns whether the session's access key expired, for its access key. A session without an access key never expires here, since its tokens refresh. [`accounts.session.get()`](Accounts.create.md#sessionget) already empties a saved session whose access key expired.

## Usage

```ts
import { Session } from 'accounts'

const session = await accounts.session.get()
// A session can expire while the page stays open.
if (session && Session.expired(session)) await accounts.signOut()
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
