/**
 * The Metro configuration of the mobile playground. Metro 0.84 finds `metro.config.mts`, and Node
 * runs it as a TypeScript ES module, so the playground needs no `metro.config.js`. Node resolves the
 * import by its file name, since Expo's package declares no `exports` for it.
 * @module
 */
import { getDefaultConfig } from 'expo/metro-config.js'

const config = getDefaultConfig(import.meta.dirname)

/** Metro's resolver, which the configuration replaces for ox. */
type Resolver = NonNullable<typeof config.resolver.resolveRequest>

// ox ships each entry's TypeScript source beside a folder whose `package.json` points at the build.
// Metro reads that folder as the package, skips ox's `exports`, and picks the source, whose imports fail.
const resolveRequest: Resolver = (context, name, platform) =>
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

export default { ...config, resolver: { ...config.resolver, resolveRequest } }
