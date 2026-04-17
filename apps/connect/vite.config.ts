import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import icons from 'unplugin-icons/vite'
import { defineConfig } from 'vp'

export default defineConfig({
  server: {
    port: 5176,
    allowedHosts: true,
    hmr: {
      overlay: false,
    },
  },
  define: {
    __BUILD_VERSION__: JSON.stringify(
      (process.env.CF_PAGES_COMMIT_SHA ?? process.env.GITHUB_SHA ?? Date.now().toString()).slice(
        0,
        8,
      ),
    ),
  },
  plugins: [
    cloudflare(),
    tanstackRouter({ routeFilePrefix: undefined, routesDirectory: 'src/routes' }),
    react(),
    icons({ compiler: 'jsx', jsx: 'react' }),
    tailwindcss(),
  ],
  optimizeDeps: {
    include: ['cva'],
  },
})
