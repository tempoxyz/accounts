import { Address } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { createClient, custom, type Client, type Transport } from 'viem'

import * as AccessKey from '../AccessKey.js'
import type * as Store from '../Store.js'

type RequestParameters = {
  method: string
  params?: readonly unknown[] | undefined
}

/** Creates a JSON-RPC account client for mppx charge and subscription methods. */
export function createMppRpcClient(
  options: createMppRpcClient.Options,
): createMppRpcClient.ReturnType {
  const { account, client } = options
  return createClient({
    account: {
      address: account,
      type: 'json-rpc' as const,
    },
    chain: client.chain,
    pollingInterval: client.pollingInterval,
    transport: createTransport({ client }),
  })
}

export declare namespace createMppRpcClient {
  /** Options for {@link createMppRpcClient}. */
  type Options = {
    /** Root account address. */
    account: Address.Address
    /** Client to decorate for mppx. */
    client: Client<Transport>
  }

  /** Viem client decorated with a JSON-RPC root account. */
  type ReturnType = Client<Transport>
}

/** Creates a viem client that lets mppx sessions sign with a managed access key. */
export async function createMppSessionClient(
  options: createMppSessionClient.Options,
): Promise<createMppSessionClient.ReturnType> {
  const { account, chainId, client, store } = options
  const request = client.request.bind(client)
  const selection = await AccessKey.select({
    account,
    chainId,
    client,
    store,
  })
  if (!selection)
    return createMppRpcClient({
      account,
      client,
    })

  const signTransaction = selection.account.signTransaction.bind(selection.account)
  const account_accessKey = {
    ...selection.account,
    accessKeyAddress: selection.accessKey,
    address: account,
    async signTransaction(parameters: Parameters<typeof selection.account.signTransaction>[0]) {
      const signed = await signTransaction({
        ...parameters,
        ...(selection.authorization ? { keyAuthorization: selection.authorization } : {}),
      } as never)

      if (selection.authorization)
        AccessKey.markPending({
          accessKey: selection.accessKey,
          account: selection.record.access,
          chainId: selection.record.chainId,
          store,
        })

      return signed
    },
  }

  return createClient({
    account: account_accessKey,
    chain: client.chain,
    pollingInterval: client.pollingInterval,
    transport: createTransport({
      client,
      async request(parameters) {
        if (parameters.method === 'eth_fillTransaction' && selection.authorization) {
          const [transaction] = parameters.params ?? []
          if (transaction && typeof transaction === 'object')
            return await request({
              ...parameters,
              params: [
                {
                  ...transaction,
                  keyAuthorization: {
                    address: selection.authorization.address,
                    ...KeyAuthorization.toRpc(selection.authorization),
                  },
                },
              ],
            } as never)
        }

        return await request(parameters as never)
      },
    }),
  })
}

export declare namespace createMppSessionClient {
  /** Options for {@link createMppSessionClient}. */
  type Options = {
    /** Root account address. */
    account: Address.Address
    /** Chain ID the access key must be authorized on. */
    chainId: number
    /** Client to decorate for mppx. */
    client: Client<Transport>
    /** Reactive state store. */
    store: Store.Store
  }

  /** Viem client decorated with an mppx session-ready account when a local access key is available. */
  type ReturnType = Client<Transport>
}

function createTransport(options: createTransport.Options): Transport {
  const { client } = options
  const request = options.request ?? client.request.bind(client)

  return custom({ request })
}

declare namespace createTransport {
  type Options = {
    /** Client whose transport metadata should be preserved. */
    client: Client<Transport>
    /** Optional request wrapper. Defaults to forwarding to `client.request`. */
    request?: ((parameters: RequestParameters) => Promise<unknown>) | undefined
  }
}
