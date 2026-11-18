/**
 * Tests the decisions of the popup that need no browser window: whether a page on `http:` signs in
 * with a popup in place of a frame.
 * @module
 */
import { describe, expect, test } from 'vite-plus/test'
import * as Popup from './Popup.js'

describe('http', () => {
  const rows = [
    {
      expected: true,
      name: 'opens a popup on a local page for a Tempo ID on `https:`',
      page: 'http://localhost:5190/',
      url: 'https://id.tempo.xyz',
    },
    {
      expected: true,
      name: 'opens a popup on a page of a loopback address for a Tempo ID on `https:`',
      page: 'http://127.0.0.1:5190/settings?tab=keys',
      url: 'https://id.tempo.xyz',
    },
    {
      expected: false,
      name: 'keeps the frame on a page on `https:`',
      page: 'https://app.example/',
      url: 'https://id.tempo.xyz',
    },
    {
      expected: false,
      name: 'keeps the frame on a local page for a local Tempo ID on `http:`',
      page: 'http://localhost:5290/',
      url: 'http://localhost:8787',
    },
    {
      expected: false,
      name: 'keeps the frame on a page on `https:` for a local Tempo ID on `http:`',
      page: 'https://localhost:5290/',
      url: 'http://localhost:8787',
    },
  ] as const

  for (const row of rows)
    test(row.name, () => {
      const result = Popup.http({ page: row.page, url: row.url })

      expect(result).toBe(row.expected)
    })
})
