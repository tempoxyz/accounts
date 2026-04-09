import { Json } from 'ox'
export function from(kv) {
  return kv
}
export function cloudflare(kv) {
  return from({
    delete: kv.delete.bind(kv),
    async get(key) {
      return kv.get(key, 'json')
    },
    async set(key, value) {
      return kv.put(key, Json.stringify(value))
    },
  })
}
export function memory() {
  const store = new Map()
  return from({
    async delete(key) {
      Promise.resolve(store.delete(key))
    },
    async get(key) {
      return store.get(key)
    },
    async set(key, value) {
      store.set(key, value)
    },
  })
}
//# sourceMappingURL=Kv.js.map
