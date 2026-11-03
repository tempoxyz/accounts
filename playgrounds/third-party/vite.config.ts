/** Serves and builds the third-party playground with React, and serves its metadata document. @module */
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import * as ApiUrls from '../web/ApiUrls.ts'
import * as Metadata from './metadata.ts'

/** Serves the metadata document on the dev server. */
function metadata(): Plugin {
  return {
    configureServer(server) {
      server.middlewares.use(Metadata.path, (request, response) => {
        const origin =
          process.env.PUBLIC_URL ?? `http://${request.headers.host ?? ''}`
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(Metadata.document({ origin })))
      })
    },
    name: 'third-party-metadata',
  }
}

export default defineConfig((options) => ({
  // The parsed entries only, so a key in `TEMPO_API_URLS` never reaches the bundle.
  define: {
    'import.meta.env.TEMPO_API_URLS': JSON.stringify(
      ApiUrls.parse(loadEnv(options.mode, process.cwd(), '').TEMPO_API_URLS),
    ),
  },
  // Every playground reads the same URL variables, which deploys and tests set once.
  envPrefix: [
    'API_URL',
    'PERMISSIONS',
    'TEMPO_ID_URL',
    'TEMPO_RPC_URL',
    'VITE_',
  ],
  // Prebundled at startup, so a first-visit dependency scan never reloads the page mid-test.
  optimizeDeps: {
    include: [
      '@tanstack/react-query',
      'accounts > ox',
      'accounts > ox/tempo',
      'accounts > xstate',
      'mppx',
      'mppx/client',
      'react',
      'react-dom/client',
      'react/jsx-dev-runtime',
      'viem/tempo',
      'viem/tempo/chains',
    ],
    noDiscovery: true,
  },
  plugins: [react(), metadata()],
}))
