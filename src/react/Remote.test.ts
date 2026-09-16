import { vi } from 'vitest'
import { afterEach, describe, expect, test } from 'vp/test'

const hooks = vi.hoisted(() => ({ cleanups: [] as (() => void)[] }))

vi.mock('react', () => ({
  useCallback: (fn: unknown) => fn,
  useEffect: (effect: () => void | (() => void)) => {
    const cleanup = effect()
    if (cleanup) hooks.cleanups.push(cleanup)
  },
  useMemo: (fn: () => unknown) => fn(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => {}],
}))

import { useTheme } from './Remote.js'

afterEach(() => {
  hooks.cleanups.length = 0
  vi.unstubAllGlobals()
})

describe('useTheme', () => {
  test('behavior: applies URL theme values to the document', () => {
    const root = createRoot()
    stubBrowser(root, '?accent=%23b9a3ff&radius=medium&scheme=dark')

    useTheme()

    expect(readRoot(root)).toMatchInlineSnapshot(`
      {
        "attributes": {
          "data-theme": "dark",
          "data-theme-accent": "custom",
          "data-theme-radius": "medium",
        },
        "colorScheme": "dark",
        "properties": {
          "--theme-accent": "#b9a3ff",
        },
      }
    `)
  })

  test('behavior: replaces URL overrides with live theme updates', () => {
    const root = createRoot()
    stubBrowser(root, '?accent=purple&radius=full&scheme=dark')
    let update: ((theme: { scheme?: string }) => void) | undefined
    const remote = {
      messenger: {
        on(_topic: string, listener: typeof update) {
          update = listener
          return () => {}
        },
      },
    }
    useTheme(remote as never)

    update?.({ scheme: 'light' })

    expect(readRoot(root)).toMatchInlineSnapshot(`
      {
        "attributes": {
          "data-theme": "light",
        },
        "colorScheme": "light",
        "properties": {},
      }
    `)
  })

  test('behavior: restores the document theme when unmounted', () => {
    const root = createRoot(
      {
        'data-theme': 'light',
        'data-theme-accent': 'custom',
        'data-theme-radius': 'small',
      },
      'light',
      { '--theme-accent': '#ff007a' },
    )
    stubBrowser(root, '?accent=blue&radius=full&scheme=dark')
    useTheme()

    hooks.cleanups[0]?.()

    expect(readRoot(root)).toMatchInlineSnapshot(`
      {
        "attributes": {
          "data-theme": "light",
          "data-theme-accent": "custom",
          "data-theme-radius": "small",
        },
        "colorScheme": "light",
        "properties": {
          "--theme-accent": "#ff007a",
        },
      }
    `)
  })
})

// Helpers

function stubBrowser(root: ReturnType<typeof createRoot>, search: string) {
  vi.stubGlobal('document', { documentElement: root })
  vi.stubGlobal('window', { location: { search } })
}

function createRoot(
  initialAttributes: Record<string, string> = {},
  colorScheme = '',
  initialProperties: Record<string, string> = {},
) {
  const attributes = new Map(Object.entries(initialAttributes))
  const properties = new Map(Object.entries(initialProperties))
  return {
    attributes,
    getAttribute(name: string) {
      return attributes.get(name) ?? null
    },
    removeAttribute(name: string) {
      attributes.delete(name)
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value)
    },
    style: {
      colorScheme,
      getPropertyValue(name: string) {
        return properties.get(name) ?? ''
      },
      removeProperty(name: string) {
        const value = properties.get(name) ?? ''
        properties.delete(name)
        return value
      },
      setProperty(name: string, value: string) {
        properties.set(name, value)
      },
    },
    properties,
  }
}

function readRoot(root: ReturnType<typeof createRoot>) {
  return {
    attributes: Object.fromEntries(root.attributes),
    colorScheme: root.style.colorScheme,
    properties: Object.fromEntries(root.properties),
  }
}
