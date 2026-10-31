import { afterEach, describe, expect, test, vi } from 'vp/test'

import * as Mount from './mount.js'
import { postMessage } from './postMessage.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('auto', () => {
  test('behavior: chooses popup without IO v2 for untrusted hosts', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      location: {
        hostname: 'app.example',
        protocol: 'https:',
      },
    })

    expect(Mount.auto({ trustedHosts: ['trusted.example'] }).mode).toMatchInlineSnapshot(`"popup"`)
  })

  test('behavior: chooses iframe without IO v2 for trusted hosts', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      location: {
        hostname: 'app.example',
        protocol: 'https:',
      },
    })

    expect(Mount.auto({ trustedHosts: ['app.example'] }).mode).toMatchInlineSnapshot(`"iframe"`)
  })

  test('behavior: chooses iframe without IO v2 for bundled trusted hosts', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      location: {
        hostname: 'app.polyhedge.capital',
        protocol: 'https:',
      },
    })

    expect(Mount.auto({ source: 'wallet.tempo.xyz' }).mode).toMatchInlineSnapshot(`"iframe"`)
  })

  test('behavior: chooses iframe without IO v2 for same-site hosts', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      location: {
        hostname: 'app.tempo.xyz',
        protocol: 'https:',
      },
    })

    expect(Mount.auto({ source: 'wallet.tempo.xyz' }).mode).toMatchInlineSnapshot(`"iframe"`)
  })

  test('behavior: chooses popup in insecure contexts even for trusted hosts', () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      location: {
        hostname: 'app.example',
        protocol: 'http:',
      },
    })

    expect(Mount.auto({ trustedHosts: ['app.example'] }).mode).toMatchInlineSnapshot(`"popup"`)
  })
})

describe('iframe', () => {
  test('behavior: matches the iframe color scheme to the wallet theme', () => {
    const elements: Record<string, unknown>[] = []
    vi.stubGlobal('document', {
      body: {
        appendChild() {},
      },
      createElement(tag: string) {
        const element = {
          appendChild() {},
          contentWindow: null,
          dataset: {},
          innerHTML: '',
          remove() {},
          setAttribute() {},
          style: {},
          tag,
        }
        elements.push(element)
        return element
      },
    })
    vi.stubGlobal(
      'MutationObserver',
      class {
        disconnect() {}
        observe() {}
      },
    )

    Mount.iframe()({
      host: 'https://wallet.tempo.xyz/post-message?scheme=dark',
      onDismiss() {},
      onInvalidate() {},
    })

    expect(elements.find((element) => element.tag === 'iframe')?.style).toMatchInlineSnapshot(`
      {
        "backgroundColor": "transparent",
        "border": "0",
        "colorScheme": "dark",
        "height": "100%",
        "left": "0",
        "position": "fixed",
        "top": "0",
        "width": "100%",
      }
    `)
  })
})

describe('postMessage', () => {
  test('behavior: derives trusted hosts from the wallet host', () => {
    const factory = Object.assign(
      () => ({
        close() {},
        destroy() {},
        hide() {},
        mode: 'popup' as const,
        show() {},
        target: () => null,
      }),
      { mode: 'popup' as const },
    )
    const auto = vi.spyOn(Mount, 'auto').mockReturnValue(factory)
    vi.stubGlobal('document', { body: {} })
    vi.stubGlobal('window', {
      location: {
        origin: 'https://app.example',
      },
    })

    postMessage({
      host: 'https://wallet.tempo.xyz/post-message',
      name: 'Tempo Wallet',
      rdns: 'xyz.tempo',
    })

    expect(auto.mock.calls[0]![0]).toMatchInlineSnapshot(`
      {
        "source": "wallet.tempo.xyz",
      }
    `)
  })
})
