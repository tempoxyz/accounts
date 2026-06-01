import { z } from 'zod/mini'

import * as Rpc from '../zod/rpc.js'

type WalletConnectRequest = Pick<Rpc.wallet_connect.Encoded, 'method' | 'params'>

/**
 * Returns a `wallet_connect` request with an encoded access-key capability.
 */
export function withAuthorizeAccessKey(
  request: WalletConnectRequest,
  authorizeAccessKey: withAuthorizeAccessKey.Parameters | undefined,
) {
  if (!authorizeAccessKey) return request
  return {
    ...request,
    params: [
      {
        ...request.params?.[0],
        capabilities: {
          ...request.params?.[0]?.capabilities,
          authorizeAccessKey: z.encode(Rpc.wallet_connect.authorizeAccessKey, authorizeAccessKey),
        },
      },
    ] as const,
  }
}

export declare namespace withAuthorizeAccessKey {
  type Parameters = NonNullable<
    NonNullable<
      NonNullable<Rpc.wallet_connect.Decoded['params']>[number]['capabilities']
    >['authorizeAccessKey']
  >
}
