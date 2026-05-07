import { Hex as ox_Hex, Provider as ox_Provider } from 'ox'

import * as Adapter from '../Adapter.js'
import * as Dialog from '../Dialog.js'
import * as Schema from '../Schema.js'
import type * as Store from '../Store.js'
import * as Request from '../zod/request.js'
import { dialog as dialogAdapter } from './dialog.js'
import { turnkey } from './turnkey.js'

/**
 * Creates a Turnkey + Tempo surface adapter.
 *
 * Turnkey owns account connection, account provisioning, and disconnect
 * semantics. Tempo owns post-connect action consent and delegates confirmed
 * signing requests back to the Turnkey signer in the parent page.
 *
 * @example
 * ```ts
 * import { Provider, turnkeyTempo } from 'accounts'
 *
 * const provider = Provider.create({
 *   adapter: turnkeyTempo({
 *     loadAccounts: async () => ({ accounts: [{ address: '0x...' }] }),
 *     signRawPayload: async (params) => turnkeyClient.signRawPayload(params),
 *   }),
 * })
 * ```
 */
export function turnkeyTempo(options: turnkeyTempo.Options = {}): Adapter.Adapter {
  const {
    dialog = Dialog.isInsecureContext() ? Dialog.popup() : Dialog.iframe(),
    host = 'https://wallet.tempo.xyz/embed',
    icon,
    name = 'Turnkey Tempo',
    rdns = 'xyz.tempo.turnkey',
  } = options

  return Adapter.define({ icon, name, rdns }, (parameters) => {
    const { store } = parameters
    const signer = turnkey(options)(parameters)
    const signerProvider = createSignerProvider(signer.actions, store)
    const surface = dialogAdapter({
      dialog,
      host,
      icon,
      name,
      provider: signerProvider,
      rdns,
    })(parameters)

    return {
      cleanup() {
        surface.cleanup?.()
        signer.cleanup?.()
      },
      actions: surface.actions,
    }
  })
}

export declare namespace turnkeyTempo {
  /** Adapter options for Turnkey-backed accounts with Tempo post-connect approval UI. */
  type Options = turnkey.Options & {
    /** Dialog to use for Tempo post-connect approval UI. @default `Dialog.iframe()` */
    dialog?: Dialog.Dialog | undefined
    /** URL of the Tempo remote app. @default `'https://wallet.tempo.xyz/embed'` */
    host?: string | undefined
  }
}

type SignerProvider = {
  request: (request: { method: string; params?: unknown | undefined }) => Promise<unknown>
}

function createSignerProvider(
  actions: Adapter.Instance['actions'],
  store: Store.Store,
): SignerProvider {
  return ox_Provider.from(
    {
      async request(r) {
        const request = Request.validate(Schema.Request, r)

        switch (request.method) {
          case 'eth_accounts':
            return store.getState().accounts.map((a) => a.address)

          case 'eth_chainId':
            return ox_Hex.fromNumber(store.getState().chainId)

          case 'eth_requestAccounts': {
            const result = await actions.loadAccounts(undefined, {
              method: 'wallet_connect',
              originMethod: 'eth_requestAccounts',
              params: undefined,
            })
            store.setState({ accounts: result.accounts, activeAccount: 0 })
            return result.accounts.map((a) => a.address)
          }

          case 'wallet_connect': {
            const capabilities = request._decoded.params?.[0]?.capabilities
            const result =
              capabilities?.method === 'register'
                ? await actions.createAccount(
                    {
                      authorizeAccessKey: capabilities.authorizeAccessKey,
                      digest: capabilities.digest,
                      name: capabilities.name ?? 'default',
                      userId: capabilities.userId,
                    },
                    request,
                  )
                : await actions.loadAccounts(
                    {
                      authorizeAccessKey: capabilities?.authorizeAccessKey,
                      credentialId: capabilities?.credentialId,
                      digest: capabilities?.digest,
                      selectAccount: capabilities?.selectAccount,
                    },
                    request,
                  )

            store.setState({ accounts: result.accounts, activeAccount: 0 })
            return result.accounts
          }

          case 'wallet_disconnect':
            await actions.disconnect?.()
            store.setState({ accessKeys: [], accounts: [], activeAccount: 0 })
            return

          case 'personal_sign': {
            const [data, address] = request._decoded.params
            return await actions.signPersonalMessage({ address, data }, request)
          }

          case 'eth_signTypedData_v4': {
            const [address, data] = request._decoded.params
            return await actions.signTypedData({ address, data }, request)
          }

          case 'eth_signTransaction': {
            const [decoded] = request._decoded.params
            return await actions.signTransaction(toTransactionParameters(decoded, store), request)
          }

          case 'eth_sendTransaction': {
            const [decoded] = request._decoded.params
            return await actions.sendTransaction(toTransactionParameters(decoded, store), request)
          }

          case 'eth_sendTransactionSync': {
            const [decoded] = request._decoded.params
            return await actions.sendTransactionSync(
              toTransactionParameters(decoded, store),
              request,
            )
          }

          case 'wallet_authorizeAccessKey': {
            if (!actions.authorizeAccessKey)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`authorizeAccessKey` not supported by adapter.',
              })
            const [decoded] = request._decoded.params
            return await actions.authorizeAccessKey(decoded, request)
          }

          case 'wallet_revokeAccessKey': {
            if (!actions.revokeAccessKey)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`revokeAccessKey` not supported by adapter.',
              })
            const [decoded] = request._decoded.params
            await actions.revokeAccessKey(decoded, request)
            return
          }

          case 'wallet_deposit': {
            if (!actions.deposit)
              throw new ox_Provider.UnsupportedMethodError({
                message: '`deposit` not supported by adapter.',
              })
            const [decoded] = request._decoded.params
            return await actions.deposit(decoded, request)
          }

          case 'wallet_switchEthereumChain': {
            const { chainId } = request._decoded.params[0]
            await actions.switchChain?.({ chainId })
            store.setState({ chainId })
            return
          }
        }

        throw new ox_Provider.UnsupportedMethodError({
          message: `Unsupported signer bridge method "${request.method}".`,
        })
      },
    },
    { schema: Schema.ox },
  )
}

function toTransactionParameters(
  decoded: Adapter.signTransaction.Parameters & { to?: unknown | undefined },
  store: Store.Store,
): Adapter.signTransaction.Parameters {
  const { data, to, ...rest } = decoded
  const calls = decoded.calls ?? (to ? [{ to, data, value: decoded.value }] : undefined)
  return {
    ...rest,
    chainId: decoded.chainId ?? store.getState().chainId,
    ...(calls ? { calls: calls as never } : {}),
  }
}
