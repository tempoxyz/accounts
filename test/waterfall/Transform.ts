/**
 * The Vite plugin of the waterfall. It rewrites the package's modules as Vitest loads them, so each
 * action, instance member, fetch, store, WebAuthn ceremony, and popup records through
 * `Recorder.ts`. The published package holds none of it. `vite.config.ts` and
 * `test/waterfall/vite.config.ts` add it only when `ACCOUNTS_WATERFALL` is `true`.
 * @module
 */
import * as Path from 'node:path'
import type { Plugin } from 'vite-plus'

/** The package's sources. */
const source = Path.resolve(import.meta.dirname, '..', '..', 'src')

/** The recorder, which each rewritten module imports. */
const recorder = Path.join(import.meta.dirname, 'Recorder.ts')

/** The name of the recorder's namespace in a rewritten module. */
const namespace = '__waterfall'

/**
 * The fetch of a call site: the instance's `fetch` or the global one, such as
 * `(auth.fetch ?? fetch)`.
 */
const fetchSite = /\((\w+)\.fetch \?\? (?:globalThis\.)?fetch\)/g

/** Each exported function of a module, apart from overload signatures, which repeat its name. */
const exported = /^export (?:async )?function (\w+)/gm

/** The WebAuthn ceremonies of ox, by their call. */
const ceremonies = [
  { call: 'Authentication.sign', name: 'webauthn.get' },
  { call: 'Registration.create', name: 'webauthn.create' },
] as const

/**
 * Returns the plugin, which rewrites each module of `src/` but its tests. A module of `src/actions/`
 * or `src/internal/Actions.ts` records each exported function as an action of `Actions`.
 *
 * @example
 * ```ts
 * import * as Transform from './test/waterfall/Transform.js'
 *
 * export default defineConfig({ plugins: [Transform.plugin()] })
 * ```
 */
export function plugin(): Plugin {
  return {
    enforce: 'pre',
    name: 'accounts:waterfall',
    transform(code, id) {
      const file = id.split('?')[0] ?? id
      if (!file.startsWith(`${source}${Path.sep}`)) return undefined
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) return undefined
      if (file.endsWith('.d.ts')) return undefined

      const relative = Path.relative(source, file).split(Path.sep).join('/')
      const rewritten = rewrite(code, { relative })
      if (rewritten === code) return undefined
      // Each rewrite keeps the module's lines, and the import goes last, since imports hoist.
      return {
        code: `${rewritten}\nimport * as ${namespace} from ${JSON.stringify(recorder)}\n`,
        map: null,
      }
    },
  }
}

/**
 * Returns `code`, the module at `options.relative` in `src/`, with its calls recorded. Each rewrite
 * keeps the module's lines.
 */
export function rewrite(code: string, options: rewrite.Options) {
  const { relative } = options

  let result = code.replace(
    fetchSite,
    (_, receiver: string) =>
      `(${namespace}.fetch(${receiver}.fetch ?? globalThis.fetch))`,
  )
  if (/from 'ox\/webauthn'/.test(code))
    for (const ceremony of ceremonies)
      result = result.replaceAll(
        `${ceremony.call}(`,
        `${namespace}.call('${ceremony.name}', 'webauthn', ${ceremony.call})(`,
      )

  const wraps = wrappers(code, { relative })
  if (wraps.length === 0) return result
  return `${result}\n${wraps.join('\n')}\n`
}

export declare namespace rewrite {
  type Options = {
    /** The module's path in `src/`, with `/` separators, such as `actions/email.ts`. */
    relative: string
  }
}

/** Returns the statements that replace each recorded export of the module with its wrapper. */
function wrappers(code: string, options: rewrite.Options) {
  const { relative } = options

  const names = [
    ...new Set([...code.matchAll(exported)].map((match) => match[1]!)),
  ]
  const actions = (() => {
    if (relative === 'internal/Actions.ts') return 'Actions'
    const match = /^actions\/(.+)\.ts$/.exec(relative)
    if (!match?.[1]) return undefined
    return `Actions.${match[1].split('/').join('.')}`
  })()
  if (actions)
    return names.map(
      (name) => `${name} = ${namespace}.action('${actions}.${name}', ${name})`,
    )

  const store = /^stores\/(\w+)\.ts$/.exec(relative)?.[1]
  if (store && names.includes('create'))
    return [
      `create = ${namespace}.store('${store[0]!.toLowerCase()}${store.slice(1)}', create)`,
    ]

  switch (relative) {
    case 'Accounts.ts':
      return [`create = ${namespace}.instance(create)`]
    case 'internal/IndexedDb.ts':
      return [`create = ${namespace}.store('indexedDb', create)`]
    case 'internal/Popup.ts':
      return [`watchPopup = ${namespace}.popup(watchPopup)`]
    case 'Store.ts':
      return [`from = ${namespace}.store('custom', from)`]
    default:
      return []
  }
}
