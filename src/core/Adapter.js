/** Creates an adapter from metadata and a setup function. */
export function define(meta, fn) {
  const { name, ...rest } = meta
  Object.defineProperty(fn, 'name', { value: name, configurable: true })
  return Object.assign(fn, rest)
}
//# sourceMappingURL=Adapter.js.map
