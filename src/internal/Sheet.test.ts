/**
 * Runs the dialog's machine through the lifecycle of a deferred request, whose challenge arrives
 * after its `show`: a challenge that arrives after the frame loads or before, a fallback before the
 * challenge, and a replacement while the challenge loads. Decides which popup a loaded page opens at
 * once.
 * @module
 */
import { createActor, fromCallback } from 'xstate'
import { describe, expect, test } from 'vite-plus/test'
import { machines } from './Sheet.js'

describe('machines.sheet', () => {
  /**
   * Starts an actor that records each provided action, with the request and the challenge that a
   * post sends, and each popup that it opens.
   */
  function start() {
    const effects: unknown[] = []
    const record =
      (name: string) => (args: { context: machines.sheet.Context }) =>
        effects.push(
          name === 'post'
            ? [name, args.context.request, args.context.challenge]
            : name,
        )
    const actor = createActor(
      machines.sheet.provide({
        actions: {
          arm: record('arm'),
          offer: record('offer'),
          post: record('post'),
          reveal: record('reveal'),
        },
        actors: {
          popup: fromCallback<{ type: 'received' }, { url: string }>((args) => {
            effects.push(['popup', args.input.url])
          }),
        },
      }),
    ).start()
    return { actor, effects }
  }

  /** A deferred `show`, whose request names no challenge. */
  const show = (id: string) =>
    ({
      deferred: true,
      id,
      onCallback: () => {},
      onClose: () => {},
      request: `q-${id}`,
      timeout: 10_000,
      type: 'show',
    }) as const

  /** The challenge of the deferred `show` of `id`, with its full request. */
  const challenge = (id: string) =>
    ({
      id,
      popupUrl: `https://id.example/oauth2/authorize?q-${id}&challenge=m`,
      request: `q-${id}&challenge=m`,
      type: 'challenge',
    }) as const

  test('posts a deferred request to a loaded frame at once, reveals it once the page shows it, and posts its challenge once it arrives', () => {
    const { actor, effects } = start()

    actor.send({ trusted: true, type: 'embed.loaded' })
    actor.send(show('a'))
    const pending = actor.getSnapshot().value
    actor.send({ id: 'a', type: 'embed.ready' })
    actor.send(challenge('a'))

    expect(pending).toEqual({ open: { dialog: 'pending', frame: 'loaded' } })
    expect(actor.getSnapshot().value).toEqual({
      open: { dialog: 'revealed', frame: 'loaded' },
    })
    expect(effects).toEqual([
      ['post', 'q-a', undefined],
      'reveal',
      'arm',
      ['post', undefined, 'q-a&challenge=m'],
    ])
    expect(actor.getSnapshot().context.challenge).toBeUndefined()
  })

  test('holds the request and a challenge that arrive before the frame loads, and posts both at the load', () => {
    const { actor, effects } = start()

    actor.send(show('a'))
    actor.send(challenge('a'))
    const held = actor.getSnapshot().context
    actor.send({ trusted: false, type: 'embed.loaded' })

    expect([held.request, held.challenge]).toEqual(['q-a', 'q-a&challenge=m'])
    expect(actor.getSnapshot().value).toEqual({
      open: { dialog: 'pending', frame: 'loaded' },
    })
    expect(effects).toEqual(['arm', ['post', 'q-a', 'q-a&challenge=m']])
  })

  test('offers the popup at a fallback before the challenge, and opens it only once the challenge supplies its URL', () => {
    const { actor, effects } = start()

    actor.send(show('a'))
    actor.send({ activated: false, reason: 'unavailable', type: 'fallback' })
    actor.send({ type: 'popup.open' })
    const early = actor.getSnapshot().value
    actor.send(challenge('a'))
    actor.send({ type: 'popup.open' })

    expect(early).toEqual({
      open: { dialog: 'revealed', frame: { failed: 'offered' } },
    })
    expect(actor.getSnapshot().value).toEqual({
      open: { dialog: 'revealed', frame: { failed: 'popup' } },
    })
    expect(effects).toEqual([
      'offer',
      'reveal',
      'arm',
      ['popup', 'https://id.example/oauth2/authorize?q-a&challenge=m'],
    ])
  })

  test.each([
    {
      activated: true,
      deferred: false,
      expected: { failed: 'popup' },
      method: 'google',
      name: "opens a method's popup at once for a gesture",
    },
    {
      activated: false,
      deferred: false,
      expected: { failed: 'offered' },
      method: 'google',
      name: "offers a method's popup without a gesture",
    },
    {
      activated: true,
      deferred: false,
      expected: { failed: 'offered' },
      method: undefined,
      name: 'offers a popup without a method for a gesture',
    },
    {
      activated: true,
      deferred: true,
      expected: { failed: 'offered' },
      method: 'google',
      name: "offers a method's popup for a gesture before a deferred request's URL",
    },
  ] as const)("$name at a loaded page's embed.popup", (row) => {
    const { actor, effects } = start()
    const popupUrl = 'https://id.example/oauth2/authorize?client_id=a'

    actor.send({ trusted: true, type: 'embed.loaded' })
    actor.send(
      row.deferred ? show('a') : { ...show('a'), deferred: false, popupUrl },
    )
    actor.send({ id: 'a', type: 'embed.ready' })
    actor.send({
      activated: row.activated,
      id: 'a',
      ...(row.method ? { method: row.method } : {}),
      type: 'embed.popup',
    })

    expect(actor.getSnapshot().value).toEqual({
      open: { dialog: 'revealed', frame: row.expected },
    })
    expect(effects.filter((entry) => Array.isArray(entry))).toEqual([
      ['post', 'q-a', undefined],
      ...(row.expected.failed === 'popup'
        ? [['popup', `${popupUrl}&method=google`]]
        : []),
    ])
  })

  test("opens a method's offered popup with the method at Continue", () => {
    const { actor, effects } = start()

    actor.send({ trusted: true, type: 'embed.loaded' })
    actor.send({
      ...show('a'),
      deferred: false,
      popupUrl: 'https://id.example/oauth2/authorize?client_id=a',
    })
    actor.send({
      activated: false,
      id: 'a',
      method: 'google',
      type: 'embed.popup',
    })
    actor.send({ type: 'popup.open' })

    expect(effects.at(-1)).toEqual([
      'popup',
      'https://id.example/oauth2/authorize?client_id=a&method=google',
    ])
  })

  test('takes no challenge of a show that a later show replaced', () => {
    const { actor, effects } = start()

    actor.send({ trusted: true, type: 'embed.loaded' })
    actor.send(show('a'))
    actor.send(show('b'))
    actor.send(challenge('a'))
    const ignored = actor.getSnapshot().context
    actor.send(challenge('b'))

    expect(ignored.current?.popupUrl).toBeUndefined()
    expect(effects.filter((entry) => Array.isArray(entry))).toEqual([
      ['post', 'q-a', undefined],
      ['post', 'q-b', undefined],
      ['post', undefined, 'q-b&challenge=m'],
    ])
  })
})

describe('machines.automatic', () => {
  test.each([
    {
      activated: false,
      cover: 'free',
      covered: false,
      expected: true,
      method: true,
      name: "a method's popup of a page without a cover",
    },
    {
      activated: false,
      cover: 'held',
      covered: true,
      expected: false,
      method: true,
      name: "a method's popup of a covered page, before `uncover`",
    },
    {
      activated: false,
      cover: 'listening',
      covered: true,
      expected: false,
      method: true,
      name: "a method's popup of a covered page that listens for `uncover`",
    },
    {
      activated: false,
      cover: 'free',
      covered: true,
      expected: true,
      method: true,
      name: "a method's popup of a covered page, after `uncover`",
    },
    {
      activated: false,
      cover: 'held',
      covered: false,
      expected: true,
      method: true,
      name: "a method's popup of a deferred page, before its challenge",
    },
    {
      activated: false,
      cover: 'listening',
      covered: false,
      expected: true,
      method: true,
      name: "a method's popup of a deferred page that listens for its challenge",
    },
    {
      activated: true,
      cover: 'free',
      covered: false,
      expected: true,
      method: false,
      name: 'a popup without a method, under a gesture',
    },
    {
      activated: false,
      cover: 'free',
      covered: false,
      expected: false,
      method: false,
      name: 'a popup without a method, without a gesture',
    },
    {
      activated: true,
      cover: 'held',
      covered: false,
      expected: false,
      method: false,
      name: 'a popup without a method of a deferred page, under a gesture',
    },
    {
      activated: true,
      cover: 'listening',
      covered: true,
      expected: false,
      method: false,
      name: 'a popup without a method of a covered page, under a gesture',
    },
  ] as const)('returns $expected for $name', (row) => {
    const automatic = machines.automatic({
      activated: row.activated,
      cover: row.cover,
      covered: row.covered,
      method: row.method,
    })

    expect(automatic).toBe(row.expected)
  })
})
