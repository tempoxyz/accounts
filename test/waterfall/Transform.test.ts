/**
 * Tests the waterfall's rewrite of the package's modules, one row per kind of module.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Transform from './Transform.js'

describe('Transform.rewrite', () => {
  test('records each fetch site and exported function of an action module', () => {
    const code = [
      'export async function get(auth: Config) {',
      '  return (auth.fetch ?? fetch)(new URL("/v1/account", auth.url))',
      '}',
    ].join('\n')

    expect(Transform.rewrite(code, { relative: 'actions/account.ts' }))
      .toMatchInlineSnapshot(`
        "export async function get(auth: Config) {
          return (__waterfall.fetch(auth.fetch ?? globalThis.fetch))(new URL("/v1/account", auth.url))
        }
        get = __waterfall.action('Actions.account.get', get)
        "
      `)
  })

  test('names the actions of `src/internal/Actions.ts` and of a nested action module', () => {
    const code = 'export function refresh() {}\nexport function refresh() {}'

    expect([
      Transform.rewrite(code, { relative: 'internal/Actions.ts' }),
      Transform.rewrite(code, { relative: 'actions/backend/email.ts' }),
    ]).toMatchInlineSnapshot(`
      [
        "export function refresh() {}
      export function refresh() {}
      refresh = __waterfall.action('Actions.refresh', refresh)
      ",
        "export function refresh() {}
      export function refresh() {}
      refresh = __waterfall.action('Actions.backend.email.refresh', refresh)
      ",
      ]
    `)
  })

  test('records a store, the instance, a popup, and a WebAuthn ceremony', () => {
    expect([
      Transform.rewrite('export function create() {}', {
        relative: 'stores/DurableObject.ts',
      }),
      Transform.rewrite('export function create() {}', {
        relative: 'Accounts.ts',
      }),
      Transform.rewrite('export function watchPopup() {}', {
        relative: 'internal/Popup.ts',
      }),
      Transform.rewrite(
        "import { Authentication } from 'ox/webauthn'\nAuthentication.sign(options)",
        { relative: 'internal/Headless.ts' },
      ),
    ]).toMatchInlineSnapshot(`
      [
        "export function create() {}
      create = __waterfall.store('durableObject', create)
      ",
        "export function create() {}
      create = __waterfall.instance(create)
      ",
        "export function watchPopup() {}
      watchPopup = __waterfall.popup(watchPopup)
      ",
        "import { Authentication } from 'ox/webauthn'
      __waterfall.call('webauthn.get', 'webauthn', Authentication.sign)(options)",
      ]
    `)
  })

  test('leaves a module without calls to record as it is', () => {
    const code = 'export function from() {}'

    expect(Transform.rewrite(code, { relative: 'Permissions.ts' })).toBe(code)
  })
})
