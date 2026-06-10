import * as Http from 'node:http'
import type { AddressInfo } from 'node:net'
import { Json } from 'ox'

import * as Storage from '../src/core/Storage.js'

export type Server = Http.Server & {
  closeAsync: () => Promise<unknown>
  url: string
}

/** String-based storage adapter (values survive only as JSON strings). */
export function createJsonStorage() {
  const items = new Map<string, string>()
  return Storage.from({
    getItem<value>(name: string) {
      const value = items.get(name)
      if (!value) return null
      return Json.parse(value) as value
    },
    removeItem(name: string) {
      items.delete(name)
    },
    setItem(name: string, value: unknown) {
      items.set(name, Json.stringify(value))
    },
  })
}

export function createServer(
  handler: Http.RequestListener,
  options: createServer.Options = {},
): Promise<Server> {
  const server = Http.createServer(handler)

  return new Promise((resolve) => {
    server.listen(options.port, () => {
      const { port } = server.address() as AddressInfo
      resolve(
        Object.assign(server, {
          closeAsync() {
            return new Promise((resolve, reject) =>
              server.close((err) => (err ? reject(err) : resolve(undefined))),
            )
          },
          url: `http://localhost:${port}`,
        }),
      )
    })
  })
}

export declare namespace createServer {
  type Options = {
    /** Port to listen on. Defaults to a random available port. */
    port?: number | undefined
  }
}
