# Plugin.from

## Overview

Instantiates a plugin, which adds a namespace of actions to an instance, and keeps its `id` and actions as literal types, so the instance's type holds `tempoId[id]`. The built-in plugins of `accounts/plugins` use it. An app writes a plugin of its own for actions that share the instance's configuration and session, or for hooks at the instance's sign-in and sign-out.

A plugin changes the session only through `context.session.change()`, which holds the race guard of the instance's sign-ins and saves the session.

## Usage

```ts
import { Actions, Id, Plugin } from 'accounts'

function realms() {
  return Plugin.from({
    actions: (context) => ({
      list: () => Actions.realm.list(context.config),
    }),
    hooks: {
      afterSignIn: (context, session) => analytics.identify(session.user.id),
    },
    id: 'realms',
  })
}

const tempoId = Id.create({ plugins: [realms()] })
const list = await tempoId.realms.list()
```

## Return type

`Plugin.Plugin<id, actions>`

The plugin, as it was given.

## Parameters

### actions (optional)

- **Type:** `(context: Plugin.Context) => actions`

Builds the plugin's namespace on the instance, once, at `Id.create`. Without it, the plugin adds no namespace.

```ts
const plugin = Plugin.from({
  actions: (context) => ({ clientId: () => context.config.clientId }),
  id: 'app',
})
```

#### context.accessKey

- **Type:** `() => Permissions | undefined`

Returns the access key of a sign-in that names none, or `undefined` for a sign-in without an access key.

#### context.config

- **Type:** [`Id.Config`](types.md#config)

The instance's configuration, which every action of `Actions` takes.

#### context.session.authorize

- **Type:** `<value>(fn: () => Promise<value>) => Promise<value>`

Runs `fn`, an authorization of the browser's Tempo ID session, and holds the session's [status](types.md#sessionstatus) at `pending` while it runs, or at `reauthorizing` while it renews a saved session that expired.

#### context.session.change

- **Type:** `() => { check; commit; fail }`

Begins a change to the session, the only way to change it. `commit(session)` sets the session, or empties it for `undefined`, and saves it. `fail(error)` rethrows a sign-in's error, and empties the session for an `Id.RequestError` marked `signedIn`. `check()` throws `Id.SupersededError` if a newer change completed. A newer change overtakes this one, and its `commit` then throws `Id.SupersededError`.

#### context.session.get

- **Type:** `() => Session | undefined`

Returns the session, without a read of the store.

### config (optional)

- **Type:** `() => Partial<Id.from.Options>`

Returns options of `Id.create` that the plugin sets, such as a platform's `store`. The options that `Id.create` receives win over them, and a later plugin's options win over an earlier plugin's.

```ts
Plugin.from({ config: () => ({ store: Store.memory() }), id: 'memory' })
```

### extend (optional)

- **Type:** `(instance: Id.Id, context: Plugin.Context) => members`

Returns members that the plugin adds to the instance itself, such as the `react` plugin's `useSession`. It receives the instance that the core and the other plugins build, and the context that the plugin's actions receive. `Id.create` throws for a member whose name the instance holds.

```ts
Plugin.from({
  extend: (instance) => ({ clientIdOf: () => instance.config.clientId }),
  id: 'client',
})
```

### hooks (optional)

- **Type:** `{ afterSignIn?; afterSignOut?; beforeSignOut?; restore? }`

Runs at the points of the instance's lifecycle, each in the order of `plugins`.

```ts
const plugin = Plugin.from({
  hooks: { afterSignOut: () => cache.clear() },
  id: 'cache',
})
```

#### hooks.afterSignIn (optional)

- **Type:** `(context: Plugin.Context, session: Session) => Promise<void> | void`

Runs after a change sets a session. In a browser, it also runs after another tab's sign-in sets a session where this instance held none or another user's.

#### hooks.afterSignOut (optional)

- **Type:** `(context: Plugin.Context) => Promise<void> | void`

Runs after `signOut`. In a browser, it also runs after another tab's sign-out empties this instance's session.

#### hooks.beforeSignOut (optional)

- **Type:** `(context: Plugin.Context) => Promise<void> | void`

Runs at the start of `signOut`, while the instance ends the session, and `signOut` waits for it. It runs also when the sign-out rejects, such as for a revocation that received no answer.

#### hooks.restore (optional)

- **Type:** `(context: Plugin.Context) => Promise<void>`

Runs at each `session.get()`, before the read of the session, such as to complete a redirect's callback through `context.session.change()`.

### id

- **Type:** `string`

The name of the plugin's namespace on the instance, such as `email`. It cannot be `account`, `authorize`, `config`, `session`, or `signOut`. A plugin whose `id` is one of `backend`, `device`, `dialog`, `email`, `passkey`, or `redirect` counts as a sign-in plugin, so the instance receives no default `dialog` plugin.

```ts
const plugin = Plugin.from({ id: 'app' })
```

### setup (optional)

- **Type:** `(context: Plugin.Context) => void`

Runs once at `Id.create`, after the plugin's `actions`, such as to preload a frame.

```ts
const plugin = Plugin.from({
  id: 'warmup',
  setup: (context) => void fetch(new URL('/health', context.config.url)),
})
```

## Presets

A preset is a function that returns a list of plugins, as Vite's plugins do. `Id.create`'s `plugins` flattens each list in order, and skips a falsy entry, such as `enabled && email()`. The [`expo`](plugins.expo.md) preset returns a plugin whose `config` sets the store and the redirect URI, and the `redirect` plugin.

```ts
const preset = (options: { redirectUri: string }) => [
  Plugin.from({
    config: () => ({ redirectUri: options.redirectUri }),
    id: 'preset',
  }),
  redirect(),
]

const tempoId = Id.create({ plugins: [preset({ redirectUri }), viem()] })
```
