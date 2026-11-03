/**
 * The entry of the built-in plugins in React Native, which a bundler reads through the
 * `react-native` condition of `accounts/plugins`. Its first import installs
 * `crypto.getRandomValues`, before any module of the package loads, as the `react-native` entry of
 * `accounts` does. The Expo preset has an entry of its own, `accounts/expo`.
 * @module
 */
/* istanbul ignore file -- The entry loads only in React Native, which only an app drives. */
import 'react-native-get-random-values'

export * from './index.js'
