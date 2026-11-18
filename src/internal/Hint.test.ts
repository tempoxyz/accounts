/**
 * Tests the read of the session hint from a cookie string, and the cookie assignments that set and
 * remove it.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Hint from './Hint.js'

describe('Hint.has', () => {
  test.each([
    ['the hint alone', 'tempo_session=1', undefined, true],
    [
      'the hint after another cookie',
      'theme=dark; tempo_session=1',
      undefined,
      true,
    ],
    ['a header without spaces', 'theme=dark;tempo_session=1', undefined, true],
    ['an empty string', '', undefined, false],
    ['an expired hint', 'tempo_session=', undefined, false],
    ['another value', 'tempo_session=0', undefined, false],
    ['a name that ends with the name', 'my_tempo_session=1', undefined, false],
    ['the value as a prefix', 'tempo_session=12', undefined, false],
    ['a named cookie', 'theme=dark; app_hint=1', 'app_hint', true],
    [
      'the default cookie for a named one',
      'tempo_session=1',
      'app_hint',
      false,
    ],
  ] as const)('reads %s', (_, value, cookie, expected) => {
    expect(Hint.has(value, { cookie })).toBe(expected)
  })

  test('reads the cookie that `serialize` sets, and not the one that `expire` sets', () => {
    const pair = (assignment: string) => assignment.split(';')[0]!

    expect(Hint.has(pair(Hint.serialize()))).toBe(true)
    expect(Hint.has(pair(Hint.expire()))).toBe(false)
  })
})

describe('Hint.serialize', () => {
  test('sets the cookie for 30 days on every path', () => {
    expect(Hint.serialize({ cookie: 'app_hint' })).toMatchInlineSnapshot(
      `"app_hint=1; Max-Age=2592000; Path=/; SameSite=Lax"`,
    )
  })
})

describe('Hint.expire', () => {
  test('removes the cookie on every path', () => {
    expect(Hint.expire()).toMatchInlineSnapshot(
      `"tempo_session=; Max-Age=0; Path=/; SameSite=Lax"`,
    )
  })
})
