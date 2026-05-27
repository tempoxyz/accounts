import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import mkcert from 'vite-plugin-mkcert'
import { vocs } from 'vocs/vite'

function wakuRscOptimizeDeps(): Plugin {
  return {
    name: 'site:waku-rsc-optimize-deps',
    configEnvironment(_name, config) {
      if (!config.optimizeDeps?.include) return
      config.optimizeDeps.include = config.optimizeDeps.include.map((entry) => {
        if (entry.startsWith('@vitejs/plugin-rsc')) return `waku > ${entry}`
        return entry
      })
    },
  }
}

function landingStylesheet(): Plugin {
  return {
    name: 'site:landing-stylesheet',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url === '/src/landing/styles.css')
          req.url = '/src/landing/styles.css?direct'
        next()
      })
    },
  }
}

export default defineConfig(({ command }) => {
  const dev = command === 'serve'
  const https = process.env.VITE_HTTPS !== '0'
  const disableUserTiming = {
    // React 19 dev User Timing walks component props for perf labels. The
    // Tempo iframe can put cross-origin objects in that path, which makes
    // Firefox throw a DOMException and trips the Vite error overlay.
    'performance.measure': 'undefined',
  }

  return {
    ...(dev ? { define: disableUserTiming } : {}),
    optimizeDeps: {
      include: ['mermaid', 'vocs > @codesandbox/sandpack-react > anser'],
      ...(dev
        ? {
            esbuildOptions: {
              define: disableUserTiming,
            },
          }
        : {}),
    },
    server: {
      allowedHosts: true,
      host: process.env.VITE_HOST ?? 'localhost',
      port: Number(process.env.PORT ?? 5176),
      strictPort: true,
    },
    plugins: [
      landingStylesheet(),
      tailwindcss(),
      vocs(),
      wakuRscOptimizeDeps(),
      react(),
      ...(https ? [mkcert()] : []),
    ],
  }
})
