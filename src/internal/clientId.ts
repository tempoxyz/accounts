/**
 * The rules of a client ID that the instance reads without a request. The module imports nothing,
 * so an entry such as `accounts/react` loads it before a React Native app installs its
 * `crypto` polyfill, and loads no hashing module.
 * @module
 */

/**
 * Returns whether `clientId` names a third-party app, which Tempo ID grants no first-party route:
 * an origin, a metadata document's URL, a registrar's `app_` ID, or a CLI's `cli:` name.
 */
export function thirdParty(clientId: string) {
  return /^(https?:\/\/|app_|cli:)/.test(clientId)
}
