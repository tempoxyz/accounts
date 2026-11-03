/** Serves and builds the web playground with React. @module */
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import * as ApiUrls from './ApiUrls.ts'

export default defineConfig((options) => {
  const env = loadEnv(options.mode, process.cwd(), '')
  // `CSP` sets the page's Content-Security-Policy, such as a strict `style-src` that the dialog must
  // work under.
  const headers = env.CSP ? { 'content-security-policy': env.CSP } : {}
  return {
    // The parsed entries only, so a key in `TEMPO_API_URLS` never reaches the bundle.
    define: {
      'import.meta.env.TEMPO_API_URLS': JSON.stringify(
        ApiUrls.parse(env.TEMPO_API_URLS),
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
    plugins: [react()],
    preview: { headers },
    server: { headers },
  }
})
