import { ChainNotConfiguredError, type Connector, createConnector } from '@wagmi/core'
import {
  type Address,
  numberToHex,
  type RpcError,
  SwitchChainError,
  UserRejectedRequestError,
} from 'viem'
import * as z from 'zod/mini'

import { dialog as core_dialog } from '../core/adapters/dialog.js'
import { webAuthn as webAuthn_adapter } from '../core/adapters/webAuthn.js'
import * as Provider from '../core/Provider.js'
import * as Rpc from '../core/zod/rpc.js'

/**
 * Creates a wagmi connector backed by an accounts provider.
 */
export function setup(parameters: setup.Parameters = {} as setup.Parameters) {
  type Properties = {
    connect<withCapabilities extends boolean = false>(parameters?: {
      capabilities?:
        | NonNullable<z.output<typeof Rpc.wallet_connect.capabilities.request>>
        | undefined
      chainId?: number | undefined
      isReconnecting?: boolean | undefined
      withCapabilities?: withCapabilities | boolean | undefined
    }): Promise<{
      accounts: withCapabilities extends true
        ? readonly {
            address: Address
            capabilities: z.output<typeof Rpc.wallet_connect.capabilities.result>
          }[]
        : readonly Address[]
      chainId: number
    }>
  }
  return createConnector<Provider.Provider, Properties>((wagmiConfig) => {
    const chains = wagmiConfig.chains

    let provider: Provider.Provider | undefined

    let accountsChanged: Connector['onAccountsChanged'] | undefined
    let chainChanged: Connector['onChainChanged'] | undefined
    let connect: Connector['onConnect'] | undefined
    let disconnect: Connector['onDisconnect'] | undefined

    return {
      async connect(params: Parameters<Properties['connect']>[0] = {}) {
        const { chainId, isReconnecting, withCapabilities } = params
        const capabilities = 'capabilities' in params ? params.capabilities : undefined

        let accounts: readonly { address: Address; capabilities: Record<string, unknown> }[] = []
        let currentChainId: number | undefined

        if (isReconnecting)
          accounts = await this.getAccounts()
            .then((accounts) => accounts.map((address) => ({ address, capabilities: {} })))
            .catch(() => [])

        const provider = (await this.getProvider()) as Provider.create.ReturnType

        try {
          if (!accounts?.length && !isReconnecting) {
            const res = await provider.request({
              method: 'wallet_connect',
              params: [
                {
                  ...(chainId ? { chainId } : {}),
                  ...(capabilities
                    ? {
                        capabilities: z.encode(
                          Rpc.wallet_connect.capabilities.request,
                          capabilities,
                        ),
                      }
                    : {}),
                },
              ] as never,
            })
            accounts = res.accounts
          }

          currentChainId ??= await this.getChainId()
          if (!currentChainId) throw new ChainNotConfiguredError()

          if (connect) {
            provider.removeListener('connect', connect)
            connect = undefined
          }
          if (!accountsChanged) {
            accountsChanged = this.onAccountsChanged.bind(this)
            provider.on('accountsChanged', accountsChanged as never)
          }
          if (!chainChanged) {
            chainChanged = this.onChainChanged.bind(this)
            provider.on('chainChanged', chainChanged!)
          }
          if (!disconnect) {
            disconnect = this.onDisconnect.bind(this)
            provider.on('disconnect', disconnect!)
          }

          return {
            accounts: (withCapabilities ? accounts : accounts.map((a) => a.address)) as never,
            chainId: currentChainId,
          }
        } catch (err) {
          const error = err as RpcError
          if (error.code === UserRejectedRequestError.code)
            throw new UserRejectedRequestError(error)
          throw error
        }
      },
      async disconnect() {
        const provider = (await this.getProvider()) as Provider.create.ReturnType

        if (chainChanged) {
          provider.removeListener('chainChanged', chainChanged)
          chainChanged = undefined
        }
        if (disconnect) {
          provider.removeListener('disconnect', disconnect)
          disconnect = undefined
        }
        if (!connect) {
          connect = this.onConnect?.bind(this)
          if (connect) provider.on('connect', connect as never)
        }

        await provider.request({ method: 'wallet_disconnect' })
      },
      async getAccounts() {
        const provider = (await this.getProvider()) as Provider.create.ReturnType
        return provider.request({ method: 'eth_accounts' })
      },
      async getChainId() {
        const provider = (await this.getProvider()) as Provider.create.ReturnType
        const hexChainId = await provider.request({ method: 'eth_chainId' })
        return Number(hexChainId)
      },
      async getProvider() {
        provider ??= Provider.create({
          ...parameters,
          chains: chains as never,
        })
        return provider as never
      },
      icon: parameters.adapter?.icon,
      id: parameters.adapter?.rdns ?? 'com.example',
      async isAuthorized() {
        try {
          const accounts = await this.getAccounts()
          return !!accounts.length
        } catch {
          return false
        }
      },
      name: parameters.adapter?.name ?? 'Accounts',
      async onAccountsChanged(accounts) {
        wagmiConfig.emitter.emit('change', {
          accounts: accounts as readonly Address[],
        })
      },
      onChainChanged(chain) {
        const chainId = Number(chain)
        wagmiConfig.emitter.emit('change', { chainId })
      },
      async onConnect(connectInfo) {
        const accounts = await this.getAccounts()
        if (accounts.length === 0) return

        const chainId = Number(connectInfo.chainId)
        wagmiConfig.emitter.emit('connect', { accounts, chainId })

        const provider = (await this.getProvider()) as Provider.create.ReturnType
        if (connect) {
          provider.removeListener('connect', connect)
          connect = undefined
        }
        if (!accountsChanged) {
          accountsChanged = this.onAccountsChanged.bind(this)
          provider.on('accountsChanged', accountsChanged as never)
        }
        if (!chainChanged) {
          chainChanged = this.onChainChanged.bind(this)
          provider.on('chainChanged', chainChanged!)
        }
        if (!disconnect) {
          disconnect = this.onDisconnect.bind(this)
          provider.on('disconnect', disconnect!)
        }
      },
      async onDisconnect(_error) {
        const provider = (await this.getProvider()) as Provider.create.ReturnType

        wagmiConfig.emitter.emit('disconnect')

        if (chainChanged) {
          provider.removeListener('chainChanged', chainChanged)
          chainChanged = undefined
        }
        if (disconnect) {
          provider.removeListener('disconnect', disconnect)
          disconnect = undefined
        }
        if (!connect) {
          connect = this.onConnect?.bind(this)
          if (connect) provider.on('connect', connect as never)
        }
      },
      async setup() {
        if (!connect) {
          const provider = (await this.getProvider()) as Provider.create.ReturnType
          connect = this.onConnect?.bind(this)
          if (connect) provider.on('connect', connect as never)
        }
      },
      async switchChain({ chainId }) {
        const chain = chains.find((x) => x.id === chainId)
        if (!chain) throw new SwitchChainError(new ChainNotConfiguredError())

        const provider = (await this.getProvider()) as Provider.create.ReturnType
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(chainId) }],
        })

        return chain
      },
      type: 'injected',
    }
  })
}

export declare namespace setup {
  type Parameters = Provider.create.Options
}

/**
 * Creates a wagmi connector backed by a WebAuthn adapter.
 *
 * @example
 * ```ts
 * import { createConfig, http } from 'wagmi'
 * import { tempoModerato } from 'wagmi/chains'
 * import { webAuthn } from 'accounts/wagmi'
 *
 * const config = createConfig({
 *   chains: [tempoModerato],
 *   connectors: [webAuthn()],
 *   transports: { [tempoModerato.id]: http() },
 * })
 * ```
 */
export function webAuthn(options: webAuthn.Options = {}) {
  const { ceremony, icon, name, rdns, ...rest } = options
  return setup({
    ...rest,
    adapter: webAuthn_adapter({ ceremony, icon, name, rdns }),
  })
}

export declare namespace webAuthn {
  type Options = webAuthn_adapter.Options & Omit<setup.Parameters, 'adapter'>
}

/**
 * Creates a wagmi connector backed by a dialog adapter.
 *
 * @example
 * ```ts
 * import { createConfig, http } from 'wagmi'
 * import { tempoModerato } from 'wagmi/chains'
 * import { dialog } from 'accounts/wagmi'
 *
 * const config = createConfig({
 *   chains: [tempoModerato],
 *   connectors: [dialog()],
 *   transports: { [tempoModerato.id]: http() },
 * })
 * ```
 */
export function dialog(options: dialog.Options = {}) {
  const { dialog: dialogOption, host, icon, name, rdns, ...rest } = options
  return setup({
    ...rest,
    adapter: core_dialog({ dialog: dialogOption, host, icon, name, rdns }),
  })
}

export declare namespace dialog {
  type Options = core_dialog.Options & Omit<setup.Parameters, 'adapter'>
}
