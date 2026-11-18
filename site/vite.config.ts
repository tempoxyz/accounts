/** Configures Vite for the documentation site: Vocs, React, and the browser build of the demos. @module */
import react from '@vitejs/plugin-react'
import * as ChildProcess from 'node:child_process'
import { defineConfig, type Plugin } from 'vite'
import { vocs } from 'vocs/vite'

/** ID of the empty module that replaces a Node built-in in the browser bundle. */
const empty = '\0site:empty'

export default defineConfig({
  // `SourceLink` links each declaration at the commit that the build reads, so its line matches
  // the file on GitHub. The site workflow checks out a pushed commit, never a merge ref.
  define: {
    'import.meta.env.SITE_COMMIT': JSON.stringify(
      ChildProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
    ),
  },
  plugins: [browserBuiltins(), react(), vocs()],
})

/**
 * Resolves `node:worker_threads` to an empty module in the browser bundle.
 *
 * The demos import `viem/tempo`, whose Node-only branch loads the built-in. The static build
 * bundles every import of the browser bundle, and fails on a Node built-in.
 */
function browserBuiltins(): Plugin {
  return {
    applyToEnvironment: (environment) => environment.name === 'client',
    enforce: 'pre',
    load(id) {
      if (id === empty) return 'export {}'
      return undefined
    },
    name: 'site:browser-builtins',
    resolveId(id) {
      if (id === 'node:worker_threads') return empty
      return undefined
    },
  }
}
