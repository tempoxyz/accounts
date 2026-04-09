import * as Adapter from '../Adapter.js'
import * as Dialog from '../Dialog.js'
/**
 * Creates a dialog adapter that delegates signing to a remote embed app
 * via an iframe or popup dialog.
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
export declare function dialog(options?: dialog.Options): Adapter.Adapter
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
  }
}
//# sourceMappingURL=dialog.d.ts.map
