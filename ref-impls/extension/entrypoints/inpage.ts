import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script'
import { Provider } from 'accounts'

import * as Messenger from '../lib/Messenger.js'

/** Methods handled by the accounts SDK provider (not proxied to RPC). */
const providerMethods = new Set([
  'eth_accounts',
  'eth_chainId',
  'eth_requestAccounts',
  'eth_sendTransaction',
  'eth_signTransaction',
  'eth_sendTransactionSync',
  'eth_signTypedData_v4',
  'personal_sign',
  'wallet_sendCalls',
  'wallet_getBalances',
  'wallet_getCallsStatus',
  'wallet_getCapabilities',
  'wallet_connect',
  'wallet_disconnect',
  'wallet_authorizeAccessKey',
  'wallet_revokeAccessKey',
  'wallet_switchEthereumChain',
])

export default defineUnlistedScript(() => {
  const provider = Provider.create()

  // Wrap request so fallback RPC reads route through the background
  // worker instead of fetch(), avoiding CSP restrictions on the host page.
  const originalRequest = provider.request.bind(provider)
  provider.request = (async (args: { method: string; params?: any }) => {
    if (providerMethods.has(args.method))
      return await originalRequest(args)
    return await extensionRpc(args.method, args.params)
  }) as typeof provider.request

  ;(window as any).ethereum = provider
})

/** Pending RPC requests waiting for a response from the background worker. */
const pending = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason: unknown) => void }
>()

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (!Messenger.isMessage(event.data)) return
  if (event.data.type !== 'rpc-response') return

  const { id, result, error } = event.data
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)

  if (error) p.reject(new Error(error.message))
  else p.resolve(result)
})

/** Sends an RPC request through the extension messenger (inpage → content → background). */
function extensionRpc(method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    pending.set(id, { resolve, reject })
    window.postMessage(Messenger.request(id, method, params), '*')
  })
}
