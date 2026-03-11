import * as Http from 'node:http'
import type { AddressInfo } from 'node:net'

export type Server = Http.Server & {
  closeAsync: () => Promise<unknown>
  url: string
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
