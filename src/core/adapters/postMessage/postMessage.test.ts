import { afterEach, describe, expect, test, vi } from 'vp/test'

import { postMessage } from './postMessage.js'
import { tempoWallet } from './tempoWallet.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('behavior: partial window-like runtime', () => {
  // React Native / Expo expose `window` without the DOM (see AGENTS.md), so a
  // `window`-only guard must not dereference bare `document`.
  test('behavior: does not throw when `window` exists but `document` does not', () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } })

    expect(typeof document).toBe('undefined')
    expect(() => tempoWallet()).not.toThrow()
    expect(() =>
      postMessage({ host: 'https://wallet.example', name: 'Wallet', rdns: 'com.example' }),
    ).not.toThrow()
  })

  test('behavior: warms the session in a real browser-like window', () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } })
    vi.stubGlobal('document', { body: {} })

    expect(() => tempoWallet()).not.toThrow()
  })
})
