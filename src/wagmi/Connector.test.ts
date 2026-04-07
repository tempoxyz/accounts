import { tempo } from 'viem/chains'
import { afterEach, describe, expect, test, vi } from 'vp/test'

import { webAuthn } from './Connector.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('webAuthn', () => {
  test('behavior: uses authUrl for server-backed authentication', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const connector = webAuthn({ authUrl: 'https://wallet.test/auth' })({
      chains: [tempo],
      emitter: { emit() {} },
    } as never)
    const provider = await connector.getProvider()

    await expect(
      provider.request({ method: 'eth_requestAccounts' }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[RpcResponse.InternalError: network down]`)
    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0]![0]).toMatchInlineSnapshot(
      `"https://wallet.test/auth/login/options"`,
    )
  })
})
