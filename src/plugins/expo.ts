/**
 * The preset of an Expo app: the device's secure store for the session, and the redirect sign-in in
 * the system browser.
 * @module
 */
/* istanbul ignore file -- Expo's modules run only in a native app, which only an app drives. */
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import * as DeviceStore from '../internal/DeviceStore.js'
import * as Plugin from '../Plugin.js'
import { redirect } from './redirect.js'

/**
 * Returns the plugins of an Expo app, from `accounts/expo`. The first sets the instance's `store`,
 * the device's secure store from `expo-secure-store`, and its `redirectUri`, the app's scheme. The
 * second is `redirect`, whose `signIn` opens Tempo ID's pages in the system browser with
 * `expo-web-browser`, and resolves with the session. Options that `Accounts.create` receives win
 * over the preset's.
 *
 * The secure store holds the session, with its keys encoded to the characters that it accepts, and
 * each value as ox's `Json`, which keeps a `bigint`. Every instance on an `expo` preset in the app,
 * also of two presets, shares the device's secure store, and React Native has no Web Locks. So the
 * store's `lock` serializes their session refreshes. A sign-out of one instance empties the session
 * of the other instances on the same preset at once.
 *
 * The preset has an entry of its own, since it imports Expo modules that only an Expo app installs,
 * so a React Native app without Expo never resolves them. `expo-secure-store`, `expo-web-browser`,
 * and `react-native-get-random-values` are optional peer dependencies of `accounts`, which an Expo
 * app installs. Any React Native app installs `react-native-get-random-values`, since React Native
 * links only the native modules that the app's own `package.json` names.
 *
 * In React Native, `accounts`, `accounts/plugins`, and `accounts/expo` install
 * `crypto.getRandomValues` through `react-native-get-random-values`, before any of their modules
 * loads. Access keys need it, and React Native lacks it. An app that imports `viem` or `ox` before
 * `accounts` imports `react-native-get-random-values` first, since their hash library reads
 * `crypto` once as it loads.
 *
 * @throws {Store.InvalidValueError} From a read of the secure store, for a stored value that holds
 *   no valid JSON, such as after a partial write. Its message names neither the key nor the value,
 *   and it has no `cause`, since the value holds tokens. Match it with
 *   `instanceof Store.InvalidValueError`.
 *
 * @example
 * ```ts
 * import { Accounts } from 'accounts'
 * import { expo } from 'accounts/expo'
 *
 * const accounts = Accounts.create({
 *   clientId: 'client_…',
 *   plugins: [expo({ redirectUri: 'com.example.app:/callback' })],
 * })
 *
 * const session = await accounts.redirect.signIn()
 * ```
 */
export function expo(options: expo.Options) {
  const { ephemeral = true, redirectUri } = options

  const store = DeviceStore.create(SecureStore)

  return [
    Plugin.from({ config: () => ({ redirectUri, store }), id: 'expo' }),
    redirect({
      // The sheet closes at the redirect URI of the sign-in URL, which a `redirectUri` of
      // `Accounts.create` sets over the preset's.
      async open(url, options) {
        const result = await WebBrowser.openAuthSessionAsync(
          url,
          options.redirectUri,
          { preferEphemeralSession: ephemeral },
        )
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
    /**
     * The app's redirect URI on its custom scheme, such as `myapp:/callback`, which the app's
     * registration lists.
     */
    redirectUri: string
  }
}
