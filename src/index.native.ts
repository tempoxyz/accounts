/**
 * The entry of `accounts` in React Native, which a bundler reads through the `react-native`
 * condition. It installs `crypto.getRandomValues`, which keys need and React Native lacks, before
 * any module of the package loads, since the hash library reads `crypto` once as it loads.
 * @module
 */
/* istanbul ignore file -- The entry loads only in React Native, which only an app drives. */
import 'react-native-get-random-values'

export * from './index.js'
