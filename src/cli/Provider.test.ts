import { vi } from 'vitest'
import { beforeEach, expect, test } from 'vp/test'

const mock = vi.hoisted(() => ({
  cli: vi.fn(() => ({})),
  create: vi.fn(() => ({})),
  filesystem: vi.fn(() => ({})),
}))

vi.mock('../core/Provider.js', () => ({ create: mock.create }))
vi.mock('./adapter.js', () => ({ cli: mock.cli }))
vi.mock('./storage.js', () => ({ filesystem: mock.filesystem }))

import { create } from './Provider.js'

beforeEach(() => {
  vi.clearAllMocks()
})

test('defaults to the Tempo Wallet device-code endpoint', () => {
  create({})

  expect(mock.cli.mock.calls).toMatchInlineSnapshot(`
    [
      [
        {
          "host": "https://wallet.tempo.xyz/api/auth/device",
        },
      ],
    ]
  `)
})
