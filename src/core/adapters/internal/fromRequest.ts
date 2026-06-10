import { Hex, P256, Provider as core_Provider, RpcResponse } from 'ox'
import { custom } from 'viem'
import { Account as TempoAccount, Secp256k1 } from 'viem/tempo'
import { z } from 'zod/mini'

import * as Adapter from '../../Adapter.js'
import * as Rpc from '../../zod/rpc.js'

/**
 * Builds an adapter that forwards wallet RPC to a remote wallet through a
 * single request function.
 *
 * Shared core for adapters whose wallet lives behind a request/response
 * session (e.g. Wata mobile web auth or postMessage). Access keys are
 * generated locally; every other wallet action round-trips through
 * `request`.
 */
export function fromRequest(options: fromRequest.Options): Adapter.Adapter {
  const { bind, cleanup, close, icon, name, rdns, request: requestRemote } = options

  return Adapter.define({ ...(icon ? { icon } : {}), name, rdns }, ({ getAccount, store }) => {
    // Late-bind the store so the request channel can reconcile local
    // connection state (e.g. a wallet `accountsChanged` notification).
    bind?.({ store })

    function generateAccessKey(
      parameters: Adapter.generateAccessKey.Options = {},
    ): Adapter.generateAccessKey.ReturnType {
      const { keyType } = parameters
      if (keyType && keyType !== 'p256' && keyType !== 'secp256k1')
        throw new RpcResponse.InvalidParamsError({
          message: `\`keyType: "${keyType}"\` requires externally generated key material; provide \`publicKey\` or \`address\`.`,
        })
      const type = keyType ?? 'secp256k1'
      const privateKey = type === 'p256' ? P256.randomPrivateKey() : Secp256k1.randomPrivateKey()
      const account =
        type === 'p256' ? TempoAccount.fromP256(privateKey) : TempoAccount.fromSecp256k1(privateKey)
      return {
        keyType: type,
        privateKey,
        publicKey: account.publicKey,
      }
    }

    const provider = core_Provider.from({
      async request(request) {
        if (request.method === 'eth_chainId') return Hex.fromNumber(store.getState().chainId)
        return await requestRemote({
          method: request.method,
          params: request.params as readonly unknown[] | undefined,
        })
      },
    })

    // Connect capabilities are read from the first account only: the remote
    // wallet connects a single account per exchange.
    function toConnectReturn(result: Rpc.wallet_connect.Encoded['returns']) {
      const capabilities = result.accounts[0]?.capabilities
      return {
        accounts: result.accounts.map((account) => ({ address: account.address })),
        ...(capabilities?.auth ? { auth: capabilities.auth } : {}),
        ...(capabilities?.identity ? { identity: capabilities.identity } : {}),
        ...(capabilities?.keyAuthorization
          ? { keyAuthorization: capabilities.keyAuthorization }
          : {}),
        ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
        ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
      }
    }

    return {
      forwardsAuth: true,
      actions: {
        async createAccount(_parameters, request) {
          return toConnectReturn(
            (await provider.request(request)) as Rpc.wallet_connect.Encoded['returns'],
          )
        },
        async loadAccounts(_parameters, request) {
          return toConnectReturn(
            (await provider.request(request)) as Rpc.wallet_connect.Encoded['returns'],
          )
        },
        async deposit(_parameters, request) {
          return (await provider.request(request)) as Rpc.wallet_deposit.Encoded['returns']
        },
        async depositZone(parameters, request) {
          return (await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_depositZone.parameters, parameters)] as const,
          })) as Rpc.wallet_depositZone.Encoded['returns']
        },
        // `disconnect` (when `close` is set) only tears down the local
        // wallet session — it is never forwarded. No `switchChain` action:
        // chain selection is local state the provider handles itself, and
        // forwarding it would open a wallet session for nothing.
        ...(close ? { disconnect: close } : {}),
        async swap(_parameters, request) {
          return (await provider.request(request)) as Rpc.wallet_swap.Encoded['returns']
        },
        async transfer(parameters, request) {
          return (await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_transfer.parameters, parameters)] as const,
          })) as Rpc.wallet_transfer.Encoded['returns']
        },
        async withdrawZone(parameters, request) {
          return (await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_withdrawZone.parameters, parameters)] as const,
          })) as Rpc.wallet_withdrawZone.Encoded['returns']
        },
      },
      ...(cleanup ? { cleanup } : close ? { cleanup: () => void close() } : {}),
      generateAccessKey,
      getAccount(parameters = {}) {
        return {
          account: {
            address: parameters.address ?? getAccount({ signable: false }).address,
            type: 'json-rpc' as const,
          },
          transport: custom(provider),
        }
      },
    }
  })
}

export declare namespace fromRequest {
  /** Options for {@link fromRequest}. */
  export type Options = {
    /**
     * Called once during setup with the adapter's store, for late wiring
     * that needs to mutate local state (e.g. reconciling connection state
     * from a wallet `accountsChanged` notification on the request channel).
     */
    bind?: ((context: { store: Adapter.SetupFn.Parameters['store'] }) => void) | undefined
    /**
     * Tears down adapter-owned resources (sessions, mounted UI) when the
     * provider discards the adapter instance. @default `close`, when set.
     */
    cleanup?: (() => void) | undefined
    /** Data URI of the provider icon, announced via EIP-6963. */
    icon?: Adapter.Meta['icon'] | undefined
    /**
     * Tears down the adapter's wallet session. Wired to the `disconnect`
     * action and instance cleanup; never forwarded to the remote wallet.
     * Omit for single-exchange transports with no session to clean up.
     */
    close?: (() => Promise<void>) | undefined
    /** Provider display name. */
    name: string
    /** Reverse-DNS provider identifier. */
    rdns: string
    /** Forwards a single wallet JSON-RPC request to the remote wallet. */
    request: (request: {
      /** JSON-RPC method name. */
      method: string
      /** JSON-RPC params. */
      params?: readonly unknown[] | undefined
    }) => Promise<unknown>
  }
}
