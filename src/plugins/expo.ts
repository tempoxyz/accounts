/**
 * The preset of an Expo app: the device's secure store for the session, and the redirect sign-in in
 * the system browser.
 * @module
 */
/* istanbul ignore file -- Expo's modules run only in a native app, which only an app drives. */
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { Json } from 'ox'
import * as Plugin from '../Plugin.js'
import * as Store from '../Store.js'
import { redirect } from './redirect.js'

/**
 * Returns the plugins of an Expo app. The first sets the instance's `store`, the device's secure
 * store, and its `redirectUri`, the app's scheme. The second is `redirect`, whose sign-in opens
 * Tempo ID in the system browser, and resolves with the session.
 *
 * @example
 * ```ts
 * import { expo } from 'accounts/expo'
 *
 * const tempoId = Accounts.create({
 *   clientId: 'client_…',
 *   plugins: [expo({ redirectUri: 'myapp:/callback' })],
 * })
 *
 * const session = await tempoId.redirect.signIn()
 * ```
 */
export function expo(options: expo.Options) {
  const { ephemeral = true, redirectUri } = options

  // The secure store holds strings under keys of letters, digits, `.`, `-`, and `_`, so the store
  // encodes both. The key's encoding escapes `_` too, so two keys never share one. ox's `Json`
  // keeps a `bigint`.
  const encode = (key: string) =>
    key.replace(
      /[^A-Za-z0-9.-]/g,
      (character) =>
        `_${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
    )
  const store = Store.from({
    async getItem(key) {
      const text = await SecureStore.getItemAsync(encode(key))
      return text === null ? undefined : Json.parse(text)
    },
    removeItem: (key) => SecureStore.deleteItemAsync(encode(key)),
    setItem: (key, value) =>
      SecureStore.setItemAsync(encode(key), Json.stringify(value)),
  })

  return [
    Plugin.from({ config: () => ({ redirectUri, store }), id: 'expo' }),
    redirect({
      async open(url) {
        const result = await WebBrowser.openAuthSessionAsync(url, redirectUri, {
          preferEphemeralSession: ephemeral,
        })
        return result.type === 'success' ? result.url : undefined
      },
    }),
  ] as const
}

export declare namespace expo {
  type Options = {
    /**
     * Whether the system browser keeps no cookies on iOS, so each sign-in asks again, and a
     * sign-out in the app leaves no Tempo ID session behind. Defaults to `true`.
     */
    ephemeral?: boolean | undefined
    /** The app's redirect URI on its scheme, such as `myapp:/callback`. */
    redirectUri: string
  }
}
