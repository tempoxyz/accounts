import { expect, test } from 'vp/test'

import * as Storage from './Storage.js'

// In runtimes that expose `window` but not IndexedDB (React Native/Expo, some
// SSR), `idb()` is still selected as the default storage. It must degrade to a
// working in-memory adapter instead of throwing: idb-keyval treats an
// `undefined` store as "use the default store", which opens IndexedDB and
// throws `ReferenceError: indexedDB is not defined`.
test('idb: degrades to in-memory storage when IndexedDB is unavailable', async () => {
  expect(typeof indexedDB).toBe('undefined')

  const storage = Storage.idb()

  await storage.setItem('accounts', ['0xabc'])
  expect(await storage.getItem('accounts')).toMatchInlineSnapshot(`
    [
      "0xabc",
    ]
  `)

  await storage.removeItem('accounts')
  expect(await storage.getItem('accounts')).toMatchInlineSnapshot(`null`)
})
