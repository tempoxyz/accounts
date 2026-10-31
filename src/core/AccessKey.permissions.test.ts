import { Json } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as Storage from './Storage.js'
import * as Store from './Store.js'

const account = accounts[0]!.address
const address = accounts[1]!.address

describe('stored permission semantics', () => {
  test.each([undefined, [], [{ token: address, limit: 100n }]])(
    'preserves limits through authorization updates and persistence: %#',
    async (limits) => {
      const storage = Storage.memory()
      const store = Store.create({ chainId: 1, storage })
      await Store.waitForHydration(store)
      const scopes = limits === undefined ? undefined : limits.length === 0 ? [] : [{ address }]
      const authorization = KeyAuthorization.from(
        { address, chainId: 1n, type: 'secp256k1', limits, scopes },
        { signature: `0x${'00'.repeat(65)}` },
      )
      const key = store.accessKeys.add({ account, authorization, privateKey: privateKeys[1] })
      expect(key.permissionSemantics).toMatchInlineSnapshot(`1`)
      expect(key.limits).toEqual(limits)
      expect(key.scopes).toEqual(scopes)

      // Replace legacy metadata with a complete authorization, then clear the pending signature.
      store.setState({
        accessKeys: [{ ...key, permissionSemantics: undefined, limits: [], scopes: [] }],
      })
      store.accessKeys.updateAuthorization({
        account,
        accessKey: address,
        chainId: 1,
        authorization,
      })
      store.setState((state) => ({
        accessKeys: state.accessKeys.map((key) => ({ ...key, keyAuthorization: undefined })),
      }))
      const restored = Store.create({ chainId: 1, storage })
      await Store.waitForHydration(restored)
      expect(Json.stringify(restored.getState().accessKeys)).toBe(
        Json.stringify([{ ...key, keyAuthorization: undefined }]),
      )
    },
  )

  test('does not mark legacy records during hydration', async () => {
    const storage = Storage.memory()
    const store = Store.create({ chainId: 1, storage })
    await Store.waitForHydration(store)
    store.setState({
      accessKeys: [
        {
          address,
          access: account,
          chainId: 1,
          keyType: 'secp256k1',
          limits: [],
          scopes: [],
          privateKey: privateKeys[1],
        },
      ],
    })
    const restored = Store.create({ chainId: 1, storage })
    await Store.waitForHydration(restored)
    expect(restored.getState().accessKeys[0]?.permissionSemantics).toMatchInlineSnapshot(
      `undefined`,
    )
  })
})
