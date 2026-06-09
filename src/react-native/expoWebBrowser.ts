import * as WebBrowser from 'expo-web-browser'
import type { MobileWebAuth } from 'wata'

/** Opens mobile web auth requests with Expo WebBrowser. */
export const openAuthSession: NonNullable<MobileWebAuth.Options['openAuthSession']> = async ({
  authorizationUrl,
  callback,
}) => {
  const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, callback)
  if (result.type !== 'success') return undefined
  return result.url
}
