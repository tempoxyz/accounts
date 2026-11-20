/**
 * Node's built-in modules of a file store, read with no import. The module imports nothing, so a
 * browser bundle holds no `node:` module.
 * @module
 */

/** The part of Node's `process` that the module reads, which Bun and Deno provide too. */
type Process = Partial<Pick<NodeJS.Process, 'env' | 'getBuiltinModule'>>

/**
 * Returns the value of the environment variable `name`, or `undefined` for an absent or empty one,
 * and in a runtime without Node's `process`, such as a browser.
 */
export function env(name: string) {
  const process = Reflect.get(globalThis, 'process') as Process | undefined
  return process?.env?.[name] || undefined
}

/**
 * Returns the Node modules that `Store.file` uses, or `undefined` in a runtime without them, such
 * as a browser or React Native, and in a Cloudflare Worker. `getBuiltinModule` loads them at first
 * use with no import, so a bundler never resolves a `node:` module, and a browser bundle builds
 * without them.
 */
export function modules() {
  const process = Reflect.get(globalThis, 'process') as Process | undefined
  if (typeof process?.getBuiltinModule !== 'function') return undefined
  // With `nodejs_compat`, a Worker's `node:fs` keeps its files in the memory of one isolate, which
  // other isolates never read and an eviction drops. A file there would lose each session.
  if (
    (Reflect.get(globalThis, 'navigator') as Navigator | undefined)
      ?.userAgent === 'Cloudflare-Workers'
  )
    return undefined
  const loaded = {
    Fs: process.getBuiltinModule('node:fs/promises'),
    Os: process.getBuiltinModule('node:os'),
    Path: process.getBuiltinModule('node:path'),
  }
  // A partial Node layer can hold the loader, which returns no module that it lacks.
  if (!loaded.Fs || !loaded.Os || !loaded.Path) return undefined
  return loaded
}
