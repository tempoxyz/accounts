/**
 * The plugin of an app's relay route: `tempoId.relay`, the handler on the app's server that pays the
 * fees of its pages' transactions, through the Tempo API's sponsor or the app's own fee payer.
 * @module
 */
import { createClient, type LocalAccount } from 'viem'
import { Relay } from 'viem/tempo'
import type * as Accounts from '../Accounts.js'
import * as RelayRoute from '../internal/relayRoute.js'
import * as Plugin from '../Plugin.js'
import { settings, viem } from './viem.js'

/**
 * Returns the plugin of the app's relay route, which adds `tempoId.relay`: a handler of the Fetch
 * API that the app's server serves at the URL of the page's `viem({ relay })`.
 *
 * With `apiKey`, the handler forwards each request to the Tempo API's `/rpc/sponsor`, whose sponsor
 * pays the fees. Otherwise it serves Viem's relay over the chains and transports of the `viem`
 * plugin, and `account` pays the fees through `Relay.feePayer`. Without a `viem` plugin in
 * `plugins`, it adds the Viem client itself, as `viem()` does.
 *
 * The handler checks no caller, so any caller that reaches the route spends the fee payer's balance,
 * within the limits of the API key or of the relay's plugins.
 *
 * @example
 * ```ts
 * const tempoId = Accounts.create({
 *   clientId: 'https://app.example',
 *   plugins: [relay({ account: privateKeyToAccount(env.FEE_PAYER_KEY) })],
 * })
 *
 * app.post('/api/relay', (c) => tempoId.relay.fetch(c.req.raw))
 * ```
 */
export function relay(options: relay.Options) {
  return Plugin.from({
    extend(instance: Accounts.Accounts, context: Plugin.Context) {
      // The instance's `viem` plugin, or one of the plugin's own, whose members the plugin adds.
      const held = (instance as unknown as { viem?: viem.Namespace }).viem
      const added = held ? undefined : viem()
      const client = held ?? (added!.actions!(context) as viem.Namespace)
      const { chains, transport } = client[
        settings as never
      ] as unknown as viem.Settings
      const chainId = options.chainId ?? instance.config.chainId

      const route = (() => {
        if (options.apiKey !== undefined)
          return RelayRoute.handler({
            apiKey: options.apiKey,
            chainId,
            ...(options.apiUrl ? { apiUrl: options.apiUrl } : {}),
          })
        const { account, plugins = [], ...relayOptions } = options
        return RelayRoute.handler({
          ...relayOptions,
          chainId,
          getClient: (clientOptions: { chainId: number }) => {
            const chain = chains.find(
              (entry) => entry.id === clientOptions.chainId,
            )
            if (!chain)
              throw new Error(
                `Invalid chain: ${clientOptions.chainId} is not a chain of the viem plugin. Return its definition as \`chain\`.`,
              )
            return createClient({
              chain,
              transport: transport(clientOptions.chainId),
            })
          },
          plugins: [
            ...(account ? [Relay.feePayer({ account })] : []),
            ...plugins,
          ],
        })
      })()

      const members = { relay: route } as relay.Members
      if (!added) return members
      // The viem plugin's members read the client at each use, so they stay getters.
      return Object.defineProperties(
        Object.assign(members, { viem: client }),
        Object.getOwnPropertyDescriptors(
          added.extend!({ viem: client } as never, context),
        ),
      )
    },
    id: 'relay',
  })
}

export declare namespace relay {
  type Options = Options.TempoApi | Options.Viem

  namespace Options {
    /** The options of the Tempo API mode, whose sponsor pays the fees. */
    type TempoApi = {
      account?: undefined
      /** The app's Tempo API key, with the `rpc-relay:sponsor` scope. Its sponsor pays the fees. */
      apiKey: string
      /** The origin of the Tempo API. Defaults to `https://api.tempo.xyz`. */
      apiUrl?: string | undefined
      /**
       * The chain whose transactions the route relays. A fill names no chain, so a route serves one
       * chain. Defaults to the instance's `chainId`.
       */
      chainId?: number | undefined
    }

    /** The options of the Viem relay mode: those of Viem's `Relay.handleRequest`, and `account`. */
    type Viem = Relay.handleRequest.Options & {
      /** The fee payer, which signs for the fees of each transaction through `Relay.feePayer`. */
      account?: LocalAccount | undefined
      apiKey?: undefined
      /**
       * The chain of a request that names none, such as Viem's fill. Defaults to the instance's
       * `chainId`.
       */
      chainId?: number | undefined
    }
  }

  /**
   * The members that the plugin adds to the instance: `relay`, and the `viem` plugin's members when
   * `plugins` holds no `viem` plugin.
   */
  type Members = {
    /** The handler of the app's relay route. */
    relay: RelayRoute.handler.ReturnType
    /** The Viem client, as the `viem` plugin adds it. */
    viem: viem.Namespace
  } & viem.Actions
}
