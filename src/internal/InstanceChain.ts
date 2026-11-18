/**
 * The chain of an instance: the configured `chainId`, until `switchChain` selects another. The
 * instance saves the selection to its store, so a later load starts on it.
 * @module
 */
import type { Store } from '../Store.js'
import * as Chains from './Chains.js'

/**
 * The key of the configuration property that holds the instance's configured chain, which
 * `switchChain` never changes. The redirect's mark names the instance by it, so another instance of
 * the app on another chain never takes the mark. The entries of the package do not export it.
 *
 * @example
 * ```ts
 * const chainId = (config as Record<symbol, unknown>)[InstanceChain.configured] as number | undefined
 * ```
 */
export const configured = Symbol('chain.configured')

/**
 * Creates the chain of an instance, on `chainId` until the stored selection loads. Without a
 * `store`, the selection lasts as long as the instance. A stored selection of a chain outside
 * `chains` never applies.
 */
export function create(options: create.Options): create.ReturnType {
  const { name, store } = options
  const key = `${name}:chain`
  const chains = served(options)
  const listeners = new Set<(chainId: number, previous: number) => void>()

  let chainId = options.chainId
  // The read of the stored selection, shared by every `load`. A failed read clears it, so the next
  // `load` reads again.
  let loading: Promise<void> | undefined = store ? undefined : Promise.resolve()

  function apply(next: number) {
    const previous = chainId
    if (next === previous) return
    chainId = next
    for (const listener of listeners) listener(next, previous)
  }

  async function read() {
    const stored = await store?.getItem(key)
    if (
      typeof stored === 'number' &&
      Number.isSafeInteger(stored) &&
      chains.includes(stored)
    )
      return stored
    return undefined
  }

  function load() {
    loading ??= (async () => {
      const stored = await read()
      if (stored !== undefined) apply(stored)
    })().catch((error: unknown) => {
      loading = undefined
      throw error
    })
    return loading
  }

  return {
    configured: options.chainId,
    get: () => chainId,
    load,
    serves: (next) => chains.includes(next),
    stored: async () => (await read()) ?? options.chainId,
    async set(next) {
      // The stored selection applies first, so it never replaces a later one.
      await load().catch(() => undefined)
      await store?.setItem(key, next)
      apply(next)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export declare namespace create {
  type Options = {
    /** The configured chain, which applies until a stored selection loads. */
    chainId: number
    /**
     * The chains that the instance serves. Defaults to the configured chain and Tempo's built-in
     * chains.
     */
    chains?: readonly number[] | undefined
    /** The name of the instance's session in `store`. The selection saves under `<name>:chain`. */
    name: string
    /** Where the selection saves. Absent, it lasts as long as the instance. */
    store: Store | undefined
  }

  type ReturnType = {
    /** The configured chain ID, which a selection never changes. */
    configured: number
    /** Returns the instance's chain ID. */
    get: () => number
    /**
     * Reads the stored selection once, and applies it. A failed read leaves the chain as it is,
     * rejects, and the next call reads again.
     */
    load: () => Promise<void>
    /** Returns whether the instance serves `chainId`. */
    serves: (chainId: number) => boolean
    /**
     * Reads the chain ID that a new instance on the same store selects: the stored selection, else
     * the configured chain. It selects nothing. Rejects when the read fails.
     */
    stored: () => Promise<number>
    /**
     * Saves `chainId` after the stored selection loads, then selects it and notifies the listeners.
     * Rejects when the save fails, and selects nothing.
     */
    set: (chainId: number) => Promise<void>
    /** Calls `listener` at each change of the chain. Returns the function that unsubscribes. */
    subscribe: (
      listener: (chainId: number, previous: number) => void,
    ) => () => void
  }
}

/**
 * Returns the chains that an instance serves: `options.chains`, else the configured chain and
 * Tempo's built-in chains. The configured chain is always one of them.
 */
export function served(options: served.Options): readonly number[] {
  const { chainId } = options
  const chains = options.chains ?? [
    ...Object.values(Chains.ids),
    ...Object.values(Chains.devIds),
  ]
  return chains.includes(chainId) ? chains : [chainId, ...chains]
}

export declare namespace served {
  type Options = Pick<create.Options, 'chainId' | 'chains'>
}
