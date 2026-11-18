/**
 * The Metro config of the Expo oracle. A `.js` file, as the docs show: an app of npm fails to load
 * the TypeScript form.
 * @module
 */
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)

// ox ships each entry's TypeScript source, which Metro picks over its build.
config.resolver.resolveRequest = (context, name, platform) =>
  context.resolveRequest(
    name.startsWith('ox/')
      ? {
          ...context,
          sourceExts: context.sourceExts.filter((ext) => ext !== 'ts'),
        }
      : context,
    name,
    platform,
  )

module.exports = config
