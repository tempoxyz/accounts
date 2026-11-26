/**
 * Inputs of the typescript pack's library metrics: the entries to leave out, and the members that
 * apps call most.
 * @module
 */
import type { Config } from '../metrics/library.ts'

export default {
  // `./cloudflare` imports `cloudflare:workers`, which only a Worker resolves. `./expo` and the
  // React Native entries import `react-native-get-random-values`, which only Metro loads. The test
  // entries hold the placeholder tokens of test builds, which no app ships.
  exclude: [
    './cloudflare',
    './expo',
    './index.native',
    './lite.native',
    './plugins.native',
    './test',
    './test/playwright',
  ],
  // The calls that every app writes: the instance, its sign-in and Viem plugins, the React and
  // wagmi bindings, and an API's verifier.
  hot: [
    'accounts',
    'accounts:AccessToken.create',
    'accounts:Accounts.create',
    'accounts/plugins:dialog',
    'accounts/plugins:viem',
    'accounts/react:react',
    'accounts/wagmi:tempoId',
  ],
} satisfies Config
