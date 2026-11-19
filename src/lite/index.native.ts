/**
 * The entry of `accounts/lite` in React Native, which a bundler reads through the `react-native`
 * condition. It installs `crypto.getRandomValues` before any module of the package loads, as the
 * root entry's `index.native.ts` does.
 * @module
 */
/* istanbul ignore file -- The entry loads only in React Native, which only an app drives. */
import 'react-native-get-random-values'

export * from './index.js'
