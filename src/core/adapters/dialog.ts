import { Hex, Provider as ox_Provider } from 'ox'
import { custom } from 'viem'
import { z } from 'zod/mini'

import * as Adapter from '../Adapter.js'
import * as Dialog from '../Dialog.js'
import * as RemoteRequests from '../internal/RemoteRequests.js'
import * as Schema from '../Schema.js'
import * as Rpc from '../zod/rpc.js'

/**
 * Creates a dialog adapter that delegates signing to a remote embed app
 * via an iframe or popup dialog.
 *
 * @deprecated Prefer {@link tempoWallet} (the Wata `postMessage` transport).
 * The bespoke-messenger dialog adapter remains available for now.
 *
 * @example
 * ```ts
 * import { dialog, Provider } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: dialog(),
 * })
 * ```
 */
export function dialog(options: dialog.Options = {}): Adapter.Adapter {
  const {
    dialog = Dialog.isInsecureContext() ? Dialog.popup() : Dialog.iframe(),
    host = 'https://wallet.tempo.xyz/embed',
    icon = 'data:image/svg+xml,<svg width="269" height="269" viewBox="0 0 269 269" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="269" height="269" fill="black"/><path d="M123.273 190.794H93.445L121.09 105.318H85.7334L93.445 80.2642H191.95L184.238 105.318H150.773L123.273 190.794Z" fill="white"/></svg>',
    name = 'Tempo Wallet',
    rdns = 'xyz.tempo',
    theme,
  } = options

  if (typeof window !== 'undefined' && !window.isSecureContext)
    console.warn(
      '[accounts] Detected insecure context (HTTP).',
      `\n\nThe Tempo Wallet iframe dialog is not supported on HTTP origins (${window.location.origin})`,
      'due to lack of WebAuthn passkey support in non-secure contexts.',
    )

  return Adapter.define({ icon, name, rdns }, ({ getAccount, store }) => {
    const detach = RemoteRequests.attach(host, { dialog, host, store, theme })

    /** Returns the active account from the adapter source store. */
    function getActiveAccount(): { address: string } | undefined {
      const { accounts, activeAccount } = store.getState()
      const account = accounts[activeAccount]
      if (!account) return undefined
      return { address: account.address }
    }

    /**
     * An ox provider that queues RPC requests in the store. The store
     * subscription syncs the pending queue to the dialog via `syncRequests`.
     */
    const provider = ox_Provider.from(
      {
        async request(r) {
          if (r.method === 'eth_chainId') return Hex.fromNumber(store.getState().chainId)
          return RemoteRequests.request(host, {
            account: getActiveAccount(),
            chainId: store.getState().chainId,
            request: r,
          })
        },
      },
      { schema: Schema.ox },
    )

    return {
      cleanup() {
        detach()
      },
      forwardsAuth: true,
      actions: {
        async createAccount(_parameters, request) {
          const { accounts } = await provider.request({
            ...request,
          })

          const capabilities = accounts[0]?.capabilities
          const keyAuthorization = capabilities?.keyAuthorization

          return {
            accounts: accounts.map((a) => ({ address: a.address })),
            ...(capabilities?.auth ? { auth: capabilities.auth } : {}),
            ...(capabilities?.identity ? { identity: capabilities.identity } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
            ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
          }
        },

        async loadAccounts(_parameters, request) {
          const { accounts } = await provider.request({
            ...request,
          })

          const capabilities = accounts[0]?.capabilities
          const keyAuthorization = capabilities?.keyAuthorization

          return {
            accounts: accounts.map((a) => ({ address: a.address })),
            ...(capabilities?.auth ? { auth: capabilities.auth } : {}),
            ...(capabilities?.identity ? { identity: capabilities.identity } : {}),
            ...(keyAuthorization ? { keyAuthorization } : {}),
            ...(capabilities?.signature ? { signature: capabilities.signature } : {}),
            ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
          }
        },

        async deposit(_params, request) {
          return await provider.request(request)
        },

        async transfer(params, request) {
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_transfer.parameters, params)] as const,
          })
        },

        async swap(_params, request) {
          return await provider.request(request)
        },

        async depositZone(params, request) {
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_depositZone.parameters, params)] as const,
          })
        },

        async withdrawZone(params, request) {
          return await provider.request({
            ...request,
            params: [z.encode(Rpc.wallet_withdrawZone.parameters, params)] as const,
          })
        },

        async disconnect() {
          store.disconnect()
        },
      },
      getAccount(options = {}) {
        const account = getAccount({ address: options.address, signable: false })
        return {
          account: { address: account.address, type: 'json-rpc' as const },
          transport: custom(provider),
        }
      },
    }
  })
}

export declare namespace dialog {
  type Options = {
    /** Dialog to use for the embed app. @default `Dialog.iframe()` (or `Dialog.popup()` in Safari/insecure contexts) */
    dialog?: Dialog.Dialog | undefined
    /** URL of the embed app. @default `'https://wallet.tempo.xyz/embed'` */
    host?: string | undefined
    /** Data URI of the provider icon. */
    icon?: `data:image/${string}` | undefined
    /** Display name of the provider. @default `'Tempo'` */
    name?: string | undefined
    /** Reverse DNS identifier. @default `'xyz.tempo'` */
    rdns?: string | undefined
    /** Visual theme overrides for the wallet dialog. */
    theme?: Dialog.Theme | undefined
  }
}
