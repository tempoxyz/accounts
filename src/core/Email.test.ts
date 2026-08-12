import { afterEach, describe, expect, test, vi } from 'vp/test'

import { acceptsMail } from './Email.js'

afterEach(() => vi.unstubAllGlobals())

describe('acceptsMail', () => {
  test('accepts a domain with an MX record', async () => {
    const fetch = vi.fn().mockResolvedValue(
      Response.json({ Answer: [{ data: '10 mail.example.com.', type: 15 }], Status: 0 }),
    )
    vi.stubGlobal('fetch', fetch)

    await expect(acceptsMail('person@example.com')).resolves.toMatchInlineSnapshot(`true`)
    expect(fetch).toHaveBeenCalledOnce()
  })

  test('accepts an address record when the domain has no MX record', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ Status: 0 }))
      .mockResolvedValueOnce(
        Response.json({ Answer: [{ data: '192.0.2.1', type: 1 }], Status: 0 }),
      )
    vi.stubGlobal('fetch', fetch)

    await expect(acceptsMail('person@example.com')).resolves.toMatchInlineSnapshot(`true`)
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  test('rejects a nonexistent domain', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ Status: 3 })))

    await expect(acceptsMail('person@example.xuz')).resolves.toMatchInlineSnapshot(`false`)
  })

  test('rejects a null MX domain', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(Response.json({ Answer: [{ data: '0 .', type: 15 }], Status: 0 })),
    )

    await expect(acceptsMail('person@example.com')).resolves.toMatchInlineSnapshot(`false`)
  })

  test('fails open when DNS is unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')))

    await expect(acceptsMail('person@example.com')).resolves.toMatchInlineSnapshot(`true`)
  })
})
