/**
 * The entry of the Expo preset, `accounts/expo`. Only an Expo app installs the Expo modules that
 * the preset imports, so the preset has an entry of its own, which a React Native app without Expo
 * never resolves. Its first import installs `crypto.getRandomValues`, before any module of the
 * package loads, as the `react-native` entry of `accounts` does.
 * @module
 */
/* istanbul ignore file -- The entry loads only in React Native, which only an app drives. */
import 'react-native-get-random-values'

export { expo } from '../plugins/expo.js'
