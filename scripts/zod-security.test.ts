import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test, vi } from 'vitest'
import * as legacy from 'zod-v3'
import * as classic from 'zod-v3/v4'
import * as mini from 'zod-v3/v4-mini'

const require = createRequire(import.meta.url)

test('the audit exception covers only patched Zod versions', () => {
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  const snapshots = lock.slice(lock.indexOf('\nsnapshots:\n'))
  const versions = [...snapshots.matchAll(/^  zod@([^:\n]+):/gm)].map(([, version]) =>
    version!.replace(/\(patch_hash=[a-f0-9]+\)/, '(patched)'),
  )
  expect(versions.sort()).toMatchInlineSnapshot(`
    [
      "3.25.76(patched)",
      "4.6.7",
    ]
  `)
})

test('all Vite peers resolve to Vite+ core', () => {
  const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8')
  expect(/^  ['"]?vite@\d/m.test(lock)).toMatchInlineSnapshot('false')
})

describe.each([
  ['v3 ESM', legacy],
  ['v3 CommonJS', require('zod-v3') as typeof legacy],
] as const)('%s collection bounds', (_, z) => {
  test.each(['max', 'length', 'set'] as const)(
    '%s rejects before parsing elements',
    async (kind) => {
      const parse = vi.fn((value: string) => value)
      const element = z.string().transform(parse)
      const schema =
        kind === 'set'
          ? z.set(element).max(2)
          : z.array(element)[kind === 'max' ? 'max' : 'length'](2)
      const oversized = kind === 'set' ? new Set(['a', 'b', 'c']) : ['a', 'b', 'c']
      const result = schema.safeParse(oversized)
      expect(result.success).toMatchInlineSnapshot('false')
      if (result.success) return
      expect(result.error.issues.map(({ code }) => code)).toMatchInlineSnapshot(`
      [
        "too_big",
      ]
    `)
      expect((await schema.safeParseAsync(oversized)).success).toMatchInlineSnapshot('false')
      expect(parse.mock.calls).toMatchInlineSnapshot('[]')
      expect(
        schema.safeParse(kind === 'set' ? new Set(['a', 'b']) : ['a', 'b']).success,
      ).toMatchInlineSnapshot('true')
    },
  )

  test('an oversized union branch does not prevent a valid alternative', () => {
    expect(z.union([z.array(z.string()).max(1), z.array(z.string())]).parse(['a', 'b']))
      .toMatchInlineSnapshot(`
        [
          "a",
          "b",
        ]
      `)
  })
})

describe.each([
  ['embedded v4 ESM', classic],
  ['embedded v4 CommonJS', require('zod-v3/v4') as typeof classic],
] as const)('%s collection bounds', (_, z) => {
  test.each(['max', 'length', 'set', 'map'] as const)(
    '%s rejects before parsing elements',
    async (kind) => {
      const parse = vi.fn((value: string) => value)
      const refine = vi.fn(() => true)
      const element = z.string().transform(parse)
      const schema = (
        kind === 'map'
          ? z.map(element, element).check(z.maxSize(2))
          : kind === 'set'
            ? z.set(element).max(2)
            : z.array(element)[kind === 'max' ? 'max' : 'length'](2)
      ).refine(refine)
      const oversized =
        kind === 'map'
          ? new Map([
              ['a', 'a'],
              ['b', 'b'],
              ['c', 'c'],
            ])
          : kind === 'set'
            ? new Set(['a', 'b', 'c'])
            : ['a', 'b', 'c']
      const result = schema.safeParse(oversized)
      expect(result.success).toMatchInlineSnapshot('false')
      if (result.success) return
      expect(result.error.issues.map(({ code }) => code)).toMatchInlineSnapshot(`
      [
        "too_big",
      ]
    `)
      expect((await schema.safeParseAsync(oversized)).success).toMatchInlineSnapshot('false')
      expect([parse.mock.calls, refine.mock.calls]).toMatchInlineSnapshot(`
      [
        [],
        [],
      ]
    `)
      const valid =
        kind === 'map'
          ? new Map([
              ['a', 'a'],
              ['b', 'b'],
            ])
          : kind === 'set'
            ? new Set(['a', 'b'])
            : ['a', 'b']
      expect(schema.safeParse(valid).success).toMatchInlineSnapshot('true')
    },
  )

  test('a transform before a bound can still shrink the collection', () => {
    expect(
      z
        .array(z.string())
        .overwrite((values) => values.slice(0, 1))
        .max(1)
        .parse(['a', 'b']),
    ).toMatchInlineSnapshot(`
        [
          "a",
        ]
      `)
  })
})

describe.each([
  ['embedded v4 mini ESM', mini],
  ['embedded v4 mini CommonJS', require('zod-v3/v4-mini') as typeof mini],
] as const)('%s collection bounds', (_, z) => {
  test('rejects oversized arrays before parsing elements', async () => {
    const parse = vi.fn(() => true)
    const schema = z.array(z.string().check(z.refine(parse))).check(z.maxLength(2))
    expect(z.safeParse(schema, ['a', 'b', 'c']).success).toMatchInlineSnapshot('false')
    expect((await z.safeParseAsync(schema, ['a', 'b', 'c'])).success).toMatchInlineSnapshot('false')
    expect(parse.mock.calls).toMatchInlineSnapshot('[]')
    expect(z.safeParse(schema, ['a', 'b']).success).toMatchInlineSnapshot('true')
  })
})
